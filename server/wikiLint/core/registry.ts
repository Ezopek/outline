import { z } from "zod";
import type {
  CheckName,
  Finding,
  FindingCode,
  IssueCode,
  IssueLocation,
  LocationKind,
  RelationshipKind,
  ScopeLocation,
  SystemFailure,
  SystemFailureCode,
} from "./contracts";
import { WikiLintContractError } from "./contracts";

/** The stable `not_evaluated` reason. It is not an issue code. */
export const POLICY_NOT_CONFIGURED = "POLICY_NOT_CONFIGURED";

/** The stable tool-execution error identifier for a concurrent collection change. */
export const COLLECTION_CONFLICT = "collection_conflict";

export type IssueClass = "error" | "warning" | "system_failure";

/** The surfaces an issue may appear on. */
export type IssueSurfaces =
  | "document"
  | "wiki"
  | "all"
  | "lint_wiki"
  | "startup_diagnostics_only";

export interface IssueDefinition {
  class: IssueClass;
  code: IssueCode;
  /** The only location kind the issue may carry; null when it is never located. */
  locationKind: LocationKind | null;
  /** The fixed relationship kind of a relationship-located issue. */
  relationshipKind?: RelationshipKind;
  surfaces: IssueSurfaces;
  /** The check a rule code belongs to; null for System Failures. */
  check: CheckName | null;
  /** Fixed generic message. Its wording is not part of the stable contract. */
  message: string;
}

const definitions: IssueDefinition[] = [
  {
    class: "error",
    code: "REQUIRED_SECTION_MISSING",
    locationKind: "document",
    surfaces: "document",
    check: "documents",
    message: "A required section is missing.",
  },
  {
    class: "error",
    code: "SECTION_ORDER_INVALID",
    locationKind: "text",
    surfaces: "document",
    check: "documents",
    message: "A section is out of the required order.",
  },
  {
    class: "error",
    code: "HEADING_LEVEL_NOT_ALLOWED",
    locationKind: "text",
    surfaces: "document",
    check: "documents",
    message: "A heading uses a level that is not allowed.",
  },
  {
    class: "error",
    code: "REQUIRED_METADATA_FIELD_MISSING",
    locationKind: "document",
    surfaces: "document",
    check: "documents",
    message: "A required metadata field is missing.",
  },
  {
    class: "error",
    code: "METADATA_FIELD_FORMAT_INVALID",
    locationKind: "text",
    surfaces: "document",
    check: "documents",
    message: "A metadata field value has an invalid format.",
  },
  {
    class: "error",
    code: "MARKDOWN_STRUCTURE_UNSUPPORTED",
    locationKind: "text",
    surfaces: "document",
    check: "documents",
    message: "The document contains an unsupported structure.",
  },
  {
    class: "error",
    code: "INTERNAL_LINK_TARGET_UNRESOLVED",
    locationKind: "text",
    surfaces: "document",
    check: "documents",
    message: "An internal link target cannot be resolved.",
  },
  {
    class: "error",
    code: "PARENT_DOCUMENT_UNRESOLVED",
    locationKind: "relationship",
    relationshipKind: "parent",
    surfaces: "wiki",
    check: "hierarchy",
    message: "The parent document cannot be resolved.",
  },
  {
    class: "error",
    code: "HIERARCHY_CYCLE",
    locationKind: "relationship",
    relationshipKind: "parent",
    surfaces: "wiki",
    check: "hierarchy",
    message: "The document hierarchy contains a cycle.",
  },
  {
    class: "error",
    code: "PUBLISHED_DOCUMENT_MISSING_FROM_STRUCTURE",
    locationKind: "relationship",
    relationshipKind: "collection_structure",
    surfaces: "wiki",
    check: "hierarchy",
    message: "A published document is missing from the collection structure.",
  },
  {
    class: "error",
    code: "PARENT_COLLECTION_MISMATCH",
    locationKind: "relationship",
    relationshipKind: "parent",
    surfaces: "wiki",
    check: "hierarchy",
    message: "A parent relationship crosses collections inconsistently.",
  },
  {
    class: "error",
    code: "GLOBAL_INDEX_LINK_MISSING",
    locationKind: "relationship",
    relationshipKind: "global_index",
    surfaces: "wiki",
    check: "global_index",
    message: "The document does not link to a required global index.",
  },
  {
    class: "warning",
    code: "DISCOURAGED_MARKDOWN_STRUCTURE",
    locationKind: "text",
    surfaces: "document",
    check: "documents",
    message: "The document contains a discouraged structure.",
  },
  {
    class: "system_failure",
    code: "POLICY_CONFIGURATION_INVALID",
    locationKind: "scope",
    surfaces: "all",
    check: null,
    message: "The collection lint policy is invalid.",
  },
  {
    class: "system_failure",
    code: "POLICY_SCHEMA_VERSION_UNSUPPORTED",
    locationKind: null,
    surfaces: "startup_diagnostics_only",
    check: null,
    message: "The lint configuration schema version is unsupported.",
  },
  {
    class: "system_failure",
    code: "POLICY_CONFIGURATION_MALFORMED",
    locationKind: null,
    surfaces: "startup_diagnostics_only",
    check: null,
    message: "The lint configuration is malformed.",
  },
  {
    class: "system_failure",
    code: "VALIDATION_RUNTIME_FAILED",
    locationKind: "scope",
    surfaces: "all",
    check: null,
    message: "Validation could not be completed.",
  },
  {
    class: "system_failure",
    code: "VALIDATION_TIMEOUT",
    locationKind: "scope",
    surfaces: "all",
    check: null,
    message: "Validation did not finish before the deadline.",
  },
  {
    class: "system_failure",
    code: "VALIDATION_RESOURCE_LIMIT_EXCEEDED",
    locationKind: "scope",
    surfaces: "lint_wiki",
    check: null,
    message: "A validation resource limit was exceeded.",
  },
];

/** The closed issue registry: exactly the AD-3 rows. */
export const ISSUE_REGISTRY: readonly Readonly<IssueDefinition>[] =
  Object.freeze(definitions.map((definition) => Object.freeze(definition)));

const issuesByCode = new Map<string, Readonly<IssueDefinition>>(
  ISSUE_REGISTRY.map((definition) => [definition.code, definition])
);

/**
 * Looks up the registry definition of an issue code.
 *
 * @param code - the code to look up.
 * @returns the definition, or undefined when the code is not registered.
 */
export function getIssueDefinition(
  code: string
): Readonly<IssueDefinition> | undefined {
  return issuesByCode.get(code);
}

const trimmedString = z
  .string()
  .min(1)
  .refine((value) => value.trim() === value);

const headingLevel = z.number().int().min(1).max(6);

/** A lowercase canonical 8-4-4-4-12 hexadecimal UUID. */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const uuid = z.string().regex(UUID_PATTERN);

const hasUniqueItems = (items: readonly unknown[]) =>
  new Set(items).size === items.length;

const stringList = (min: number) =>
  z.array(trimmedString).min(min).refine(hasUniqueItems);

/** The closed set of block structures a structure rule may name. */
export const markdownStructureSchema = z.enum([
  "blockquote",
  "code_block",
  "horizontal_rule",
  "table",
  "notice",
  "math_block",
  "toggle_block",
]);

export type MarkdownStructure = z.infer<typeof markdownStructureSchema>;

const structureList = z
  .array(markdownStructureSchema)
  .min(1)
  .refine(hasUniqueItems);

/** A metadata field name: the source text before a field's first colon. */
const fieldName = trimmedString.refine((value) => !value.includes(":"));

const metadataSection = z.strictObject({
  heading: trimmedString,
  headingLevel,
});

const metadataFieldFormat = z.discriminatedUnion("format", [
  z.strictObject({ name: fieldName, format: z.literal("iso_date") }),
  z.strictObject({
    name: fieldName,
    format: z.literal("one_of"),
    values: stringList(1),
  }),
]);

const requiredSections = z.strictObject({
  kind: z.literal("required_sections"),
  headingLevel,
  headings: stringList(1),
});

const sectionOrder = z.strictObject({
  kind: z.literal("section_order"),
  headingLevel,
  headings: stringList(2),
});

const allowedHeadingLevels = z.strictObject({
  kind: z.literal("allowed_heading_levels"),
  levels: z.array(headingLevel).min(1).refine(hasUniqueItems),
});

const requiredMetadataFields = z.strictObject({
  kind: z.literal("required_metadata_fields"),
  metadataSection,
  fields: z.array(fieldName).min(1).refine(hasUniqueItems),
});

const metadataFieldFormats = z.strictObject({
  kind: z.literal("metadata_field_formats"),
  metadataSection,
  fields: z
    .array(metadataFieldFormat)
    .min(1)
    .refine((fields) => hasUniqueItems(fields.map((field) => field.name))),
});

const unsupportedMarkdownStructures = z.strictObject({
  kind: z.literal("unsupported_markdown_structures"),
  structures: structureList,
});

const discouragedMarkdownStructures = z.strictObject({
  kind: z.literal("discouraged_markdown_structures"),
  structures: structureList,
});

const internalLinks = z.strictObject({ kind: z.literal("internal_links") });

const parentDocumentResolved = z.strictObject({
  kind: z.literal("parent_document_resolved"),
});

const hierarchyAcyclic = z.strictObject({
  kind: z.literal("hierarchy_acyclic"),
});

const publishedDocumentsInStructure = z.strictObject({
  kind: z.literal("published_documents_in_structure"),
});

const parentCollectionConsistent = z.strictObject({
  kind: z.literal("parent_collection_consistent"),
});

const globalIndexLinks = z.strictObject({
  kind: z.literal("global_index_links"),
  surfaceDocumentId: uuid,
  globalIndexDocumentIds: z.array(uuid).min(1).refine(hasUniqueItems),
});

const ruleKinds = {
  required_sections: {
    code: "REQUIRED_SECTION_MISSING",
    schema: requiredSections,
  },
  section_order: { code: "SECTION_ORDER_INVALID", schema: sectionOrder },
  allowed_heading_levels: {
    code: "HEADING_LEVEL_NOT_ALLOWED",
    schema: allowedHeadingLevels,
  },
  required_metadata_fields: {
    code: "REQUIRED_METADATA_FIELD_MISSING",
    schema: requiredMetadataFields,
  },
  metadata_field_formats: {
    code: "METADATA_FIELD_FORMAT_INVALID",
    schema: metadataFieldFormats,
  },
  unsupported_markdown_structures: {
    code: "MARKDOWN_STRUCTURE_UNSUPPORTED",
    schema: unsupportedMarkdownStructures,
  },
  discouraged_markdown_structures: {
    code: "DISCOURAGED_MARKDOWN_STRUCTURE",
    schema: discouragedMarkdownStructures,
  },
  internal_links: {
    code: "INTERNAL_LINK_TARGET_UNRESOLVED",
    schema: internalLinks,
  },
  parent_document_resolved: {
    code: "PARENT_DOCUMENT_UNRESOLVED",
    schema: parentDocumentResolved,
  },
  hierarchy_acyclic: { code: "HIERARCHY_CYCLE", schema: hierarchyAcyclic },
  published_documents_in_structure: {
    code: "PUBLISHED_DOCUMENT_MISSING_FROM_STRUCTURE",
    schema: publishedDocumentsInStructure,
  },
  parent_collection_consistent: {
    code: "PARENT_COLLECTION_MISMATCH",
    schema: parentCollectionConsistent,
  },
  global_index_links: {
    code: "GLOBAL_INDEX_LINK_MISSING",
    schema: globalIndexLinks,
  },
} as const satisfies Record<string, { code: FindingCode; schema: z.ZodType }>;

for (const entry of Object.values(ruleKinds)) {
  Object.freeze(entry);
}

/**
 * The closed rule-kind registry. Each kind emits exactly one Finding code, so
 * its severity is fixed by that code. The registry and its entries are frozen;
 * the Zod schemas they reference are not, because Zod initializes schema
 * internals lazily.
 */
export const RULE_REGISTRY = Object.freeze(ruleKinds);

/** A configured rule entry: `{ kind, ...params }`, strictly validated. */
export const ruleConfigSchema = z.discriminatedUnion("kind", [
  requiredSections,
  sectionOrder,
  allowedHeadingLevels,
  requiredMetadataFields,
  metadataFieldFormats,
  unsupportedMarkdownStructures,
  discouragedMarkdownStructures,
  internalLinks,
  parentDocumentResolved,
  hierarchyAcyclic,
  publishedDocumentsInStructure,
  parentCollectionConsistent,
  globalIndexLinks,
]);

export type RuleKind = keyof typeof RULE_REGISTRY;

export type RuleConfig = z.infer<typeof ruleConfigSchema>;

/**
 * Returns the checks the enabled rule kinds belong to.
 *
 * @param rules - the configured rules.
 * @returns the unique checks, in the order `documents`, `hierarchy`,
 *   `global_index`.
 */
export function requiredChecks(rules: readonly RuleConfig[]): CheckName[] {
  const checks = new Set(
    rules.map(
      (rule) => getIssueDefinition(RULE_REGISTRY[rule.kind].code)?.check
    )
  );
  return (["documents", "hierarchy", "global_index"] as const).filter((check) =>
    checks.has(check)
  );
}

const identifier = z.string().min(1);
const positiveInteger = z.number().int().min(1);

const locationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("text"),
    documentId: identifier,
    line: positiveInteger,
    column: positiveInteger,
    path: z.array(z.union([z.number().int().min(0), z.string()])).optional(),
  }),
  z.strictObject({ kind: z.literal("document"), documentId: identifier }),
  z.strictObject({
    kind: z.literal("relationship"),
    documentId: identifier,
    relationshipKind: z.enum([
      "parent",
      "collection_structure",
      "global_index",
    ]),
  }),
  z.strictObject({
    kind: z.literal("scope"),
    scopeKind: z.enum(["document", "collection", "configured_collections"]),
    collectionId: identifier.optional(),
    documentId: identifier.optional(),
  }),
]);

/**
 * Validates a location against an issue definition and rebuilds it in the
 * fixed key order.
 *
 * @param definition - the registry definition of the issue.
 * @param input - the location supplied by the caller.
 * @returns a new location with a fixed key order.
 */
function normalizeLocation(
  definition: Readonly<IssueDefinition>,
  input: IssueLocation
): IssueLocation {
  const parsed = locationSchema.safeParse(input);
  if (!parsed.success || parsed.data.kind !== definition.locationKind) {
    throw new WikiLintContractError("Issue location does not match its code");
  }

  const location = parsed.data;
  switch (location.kind) {
    case "text":
      return location.path === undefined
        ? {
            kind: "text",
            documentId: location.documentId,
            line: location.line,
            column: location.column,
          }
        : {
            kind: "text",
            documentId: location.documentId,
            line: location.line,
            column: location.column,
            path: [...location.path],
          };
    case "document":
      return { kind: "document", documentId: location.documentId };
    case "relationship":
      if (location.relationshipKind !== definition.relationshipKind) {
        throw new WikiLintContractError(
          "Issue relationship kind does not match its code"
        );
      }
      return {
        kind: "relationship",
        documentId: location.documentId,
        relationshipKind: location.relationshipKind,
      };
    case "scope": {
      if (
        location.scopeKind === "document" &&
        location.documentId === undefined
      ) {
        throw new WikiLintContractError(
          "Document scope location requires a document"
        );
      }
      const scope: ScopeLocation = {
        kind: "scope",
        scopeKind: location.scopeKind,
      };
      if (location.collectionId !== undefined) {
        scope.collectionId = location.collectionId;
      }
      if (location.documentId !== undefined) {
        scope.documentId = location.documentId;
      }
      return scope;
    }
    default:
      throw new WikiLintContractError("Unknown location kind");
  }
}

/**
 * Creates a Finding whose severity and message come from the registry.
 *
 * @param code - a registered Error or Warning code.
 * @param location - the location, which must match the code's location kind.
 * @returns the Finding with a fixed key order.
 * @throws WikiLintContractError when the code or location is not allowed.
 */
export function createFinding(
  code: FindingCode,
  location: IssueLocation
): Finding {
  const definition = getIssueDefinition(code);
  if (!definition || definition.class === "system_failure") {
    throw new WikiLintContractError("Not a registered Finding code");
  }
  return {
    code: definition.code as FindingCode,
    severity: definition.class,
    message: definition.message,
    location: normalizeLocation(definition, location),
  };
}

/**
 * Creates a System Failure whose message comes from the registry.
 *
 * @param code - a registered System Failure code that may appear in a result.
 * @param location - a scope location.
 * @returns the System Failure with a fixed key order.
 * @throws WikiLintContractError when the code or location is not allowed.
 */
export function createSystemFailure(
  code: SystemFailureCode,
  location: ScopeLocation
): SystemFailure {
  const definition = getIssueDefinition(code);
  if (
    !definition ||
    definition.class !== "system_failure" ||
    definition.surfaces === "startup_diagnostics_only"
  ) {
    throw new WikiLintContractError("Not a result System Failure code");
  }
  return {
    code: definition.code as SystemFailureCode,
    message: definition.message,
    location: normalizeLocation(definition, location) as ScopeLocation,
  };
}
