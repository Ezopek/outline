import type {
  CanonicalSyntax,
  Finding,
  IssueItem,
  IssueLocation,
  SyntaxField,
  SyntaxNode,
  SyntaxPosition,
  TextLocation,
} from "./contracts";
import { WikiLintContractError } from "./contracts";
import type { MarkdownStructure, RuleConfig, RuleKind } from "./registry";
import { RULE_REGISTRY, createFinding, getIssueDefinition } from "./registry";

type StructureRuleKind =
  | "required_sections"
  | "section_order"
  | "allowed_heading_levels"
  | "required_metadata_fields"
  | "metadata_field_formats"
  | "unsupported_markdown_structures"
  | "discouraged_markdown_structures";

type RuleOf<K extends RuleKind> = Extract<RuleConfig, { kind: K }>;

type Emit = (location: IssueLocation) => void;

interface RuleContext {
  documentId: string;
  syntax: CanonicalSyntax;
  emit: Emit;
}

const structureRuleKinds: ReadonlySet<string> = new Set<StructureRuleKind>([
  "required_sections",
  "section_order",
  "allowed_heading_levels",
  "required_metadata_fields",
  "metadata_field_formats",
  "unsupported_markdown_structures",
  "discouraged_markdown_structures",
]);

/** Block kinds produced by the adapter for each configurable structure. */
const structureByNodeKind: ReadonlyMap<string, MarkdownStructure> = new Map([
  ["blockquote", "blockquote"],
  ["fence", "code_block"],
  ["code_block", "code_block"],
  ["hr", "horizontal_rule"],
  ["table", "table"],
  ["container_notice", "notice"],
  ["math_block", "math_block"],
  ["container_toggle", "toggle_block"],
]);

/**
 * Builds a text location by copying an adapter-produced position.
 *
 * @param documentId - the evaluated document.
 * @param position - the position produced by the adapter.
 * @returns the text location.
 * @throws WikiLintContractError when the adapter produced no position.
 */
function textLocation(
  documentId: string,
  position: SyntaxPosition | null
): TextLocation {
  if (!position) {
    throw new WikiLintContractError("Node has no source position");
  }
  return {
    kind: "text",
    documentId,
    line: position.line,
    column: position.column,
    path: [...position.path],
  };
}

/**
 * Visits nodes at any depth in pre-order.
 *
 * @param nodes - the nodes to visit.
 * @param visit - called for each node.
 */
function preOrder(
  nodes: readonly SyntaxNode[],
  visit: (node: SyntaxNode) => void
): void {
  for (const node of nodes) {
    visit(node);
    preOrder(node.children, visit);
  }
}

/**
 * Returns the level of a heading node.
 *
 * @param node - a heading node produced by the adapter.
 * @returns the heading level.
 * @throws WikiLintContractError when the adapter produced no level.
 */
function headingLevel(node: SyntaxNode): number {
  if (node.level === undefined) {
    throw new WikiLintContractError("Heading has no level");
  }
  return node.level;
}

/**
 * Returns the root-level headings of the document, which define its sections.
 *
 * @param syntax - the canonical syntax.
 * @returns root-level heading nodes in document order.
 */
function rootHeadings(syntax: CanonicalSyntax): SyntaxNode[] {
  return syntax.children.filter((node) => node.kind === "heading");
}

/**
 * Returns the fields of the metadata section: the fields of root-level bullet
 * lists from the first root heading matching the section through the next
 * root heading at that level or higher.
 *
 * @param syntax - the canonical syntax.
 * @param section - the configured metadata section.
 * @returns the fields in document order.
 */
function metadataFields(
  syntax: CanonicalSyntax,
  section: { heading: string; headingLevel: number }
): SyntaxField[] {
  const roots = syntax.children;
  const start = roots.findIndex(
    (node) =>
      node.kind === "heading" &&
      node.level === section.headingLevel &&
      node.text === section.heading
  );
  if (start === -1) {
    return [];
  }

  const fields: SyntaxField[] = [];
  for (const node of roots.slice(start + 1)) {
    if (node.kind === "heading" && headingLevel(node) <= section.headingLevel) {
      break;
    }
    if (node.kind === "bullet_list") {
      for (const item of node.children) {
        if (item.field) {
          fields.push(item.field);
        }
      }
    }
  }
  return fields;
}

/**
 * Checks for a `YYYY-MM-DD` value that is a valid Gregorian date, using
 * arithmetic only.
 *
 * @param value - the value to check.
 * @returns whether the value is a valid ISO calendar date.
 */
export function isIsoDate(value: string): boolean {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) {
    return false;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const monthLengths = [
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return (
    month >= 1 && month <= 12 && day >= 1 && day <= monthLengths[month - 1]
  );
}

function requiredSections(
  rule: RuleOf<"required_sections">,
  { documentId, syntax, emit }: RuleContext
): void {
  const present = new Set(
    rootHeadings(syntax)
      .filter((node) => node.level === rule.headingLevel)
      .map((node) => node.text)
  );
  for (const heading of rule.headings) {
    if (!present.has(heading)) {
      emit({ kind: "document", documentId });
    }
  }
}

function sectionOrder(
  rule: RuleOf<"section_order">,
  { documentId, syntax, emit }: RuleContext
): void {
  let maxRank = -1;
  for (const node of rootHeadings(syntax)) {
    const rank =
      node.level === rule.headingLevel && node.text !== undefined
        ? rule.headings.indexOf(node.text)
        : -1;
    if (rank === -1) {
      continue;
    }
    if (rank < maxRank) {
      emit(textLocation(documentId, node.position));
    } else {
      maxRank = rank;
    }
  }
}

function allowedHeadingLevels(
  rule: RuleOf<"allowed_heading_levels">,
  { documentId, syntax, emit }: RuleContext
): void {
  preOrder(syntax.children, (node) => {
    if (node.kind === "heading" && !rule.levels.includes(headingLevel(node))) {
      emit(textLocation(documentId, node.position));
    }
  });
}

function requiredMetadataFields(
  rule: RuleOf<"required_metadata_fields">,
  { documentId, syntax, emit }: RuleContext
): void {
  const present = new Set(
    metadataFields(syntax, rule.metadataSection).map((field) => field.name)
  );
  for (const name of rule.fields) {
    if (!present.has(name)) {
      emit({ kind: "document", documentId });
    }
  }
}

function metadataFieldFormats(
  rule: RuleOf<"metadata_field_formats">,
  { documentId, syntax, emit }: RuleContext
): void {
  for (const field of metadataFields(syntax, rule.metadataSection)) {
    const format = rule.fields.find((entry) => entry.name === field.name);
    if (!format) {
      continue;
    }
    const valid =
      format.format === "iso_date"
        ? isIsoDate(field.value)
        : format.values.includes(field.value);
    if (!valid) {
      emit(textLocation(documentId, field.valuePosition));
    }
  }
}

function markdownStructures(
  rule: RuleOf<
    "unsupported_markdown_structures" | "discouraged_markdown_structures"
  >,
  { documentId, syntax, emit }: RuleContext
): void {
  preOrder(syntax.children, (node) => {
    const structure = structureByNodeKind.get(node.kind);
    if (structure && rule.structures.includes(structure)) {
      emit(textLocation(documentId, node.position));
    }
  });
}

/**
 * Runs one structure rule, emitting each Finding location as it is found.
 *
 * @param rule - the rule to run.
 * @param context - the document, its syntax, and the emit callback.
 */
function evaluateRule(rule: RuleConfig, context: RuleContext): void {
  switch (rule.kind) {
    case "required_sections":
      return requiredSections(rule, context);
    case "section_order":
      return sectionOrder(rule, context);
    case "allowed_heading_levels":
      return allowedHeadingLevels(rule, context);
    case "required_metadata_fields":
      return requiredMetadataFields(rule, context);
    case "metadata_field_formats":
      return metadataFieldFormats(rule, context);
    case "unsupported_markdown_structures":
    case "discouraged_markdown_structures":
      return markdownStructures(rule, context);
    default:
      throw new WikiLintContractError("Not a document structure rule");
  }
}

/**
 * Selects the rules that run on the document surface: those whose registry
 * code's surface is `document`.
 *
 * @param rules - the configured rules.
 * @returns the document-surface rules, in configured order.
 */
export function documentSurfaceRules(
  rules: readonly RuleConfig[]
): RuleConfig[] {
  return rules.filter(
    (rule) =>
      getIssueDefinition(RULE_REGISTRY[rule.kind].code)?.surfaces === "document"
  );
}

/**
 * Evaluates the document-structure rules of one document. Each rule kind runs
 * in isolation: a kind that throws is reported in `failedKinds`, the Findings
 * it emitted before throwing are kept, and later kinds still run.
 *
 * @param input.documentId - the evaluated document.
 * @param input.syntax - the document's canonical syntax from the adapter.
 * @param input.rules - the enabled structure rules, at most one per kind.
 * @returns Findings with zero-based per-kind ordinals, and the failed kinds.
 * @throws WikiLintContractError when a rule is not a structure rule or a kind repeats.
 */
export function evaluateDocumentRules(input: {
  documentId: string;
  syntax: CanonicalSyntax;
  rules: readonly RuleConfig[];
}): { findings: IssueItem<Finding>[]; failedKinds: RuleKind[] } {
  const { documentId, syntax, rules } = input;
  const kinds = rules.map((rule) => rule.kind);
  if (
    kinds.some((kind) => !structureRuleKinds.has(kind)) ||
    new Set(kinds).size !== kinds.length
  ) {
    throw new WikiLintContractError("Invalid document structure rules");
  }

  const findings: IssueItem<Finding>[] = [];
  const failedKinds: RuleKind[] = [];
  for (const rule of rules) {
    const code = RULE_REGISTRY[rule.kind].code;
    let ordinal = 0;
    const emit: Emit = (location) => {
      findings.push({ issue: createFinding(code, location), ordinal });
      ordinal++;
    };
    try {
      evaluateRule(rule, { documentId, syntax, emit });
    } catch {
      failedKinds.push(rule.kind);
    }
  }
  return { findings, failedKinds };
}
