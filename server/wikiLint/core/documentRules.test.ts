import { parseCanonicalMarkdown } from "../adapters/canonicalSyntax";
import type {
  CanonicalSyntax,
  InternalLinkReference,
  LinkTargetState,
} from "./contracts";
import { WikiLintContractError } from "./contracts";
import {
  documentSurfaceRules,
  evaluateDocumentRules,
  isIsoDate,
} from "./documentRules";
import type { RuleConfig } from "./registry";
import { ruleConfigSchema } from "./registry";

const documentId = "00000000-0000-4000-8000-000000000001";

/**
 * Parses a rule entry through the configuration schema, as policy loading does.
 *
 * @param entry - the configured rule entry.
 * @returns the validated rule.
 */
const rule = (entry: unknown): RuleConfig => ruleConfigSchema.parse(entry);

/**
 * Lints Markdown lines with the given rules through the adapter and core.
 *
 * @param lines - the canonical Markdown lines.
 * @param rules - the rules to evaluate.
 * @returns the evaluation output.
 */
const lint = (lines: string[], ...rules: RuleConfig[]) =>
  evaluateDocumentRules({
    documentId,
    syntax: parseCanonicalMarkdown(lines.join("\n")),
    rules,
  });

const documentLocation = { kind: "document", documentId };

const at = (line: number, column: number, path: number[]) => ({
  kind: "text",
  documentId,
  line,
  column,
  path,
});

const metadataSection = { heading: "Metadata", headingLevel: 2 };

describe("required_sections", () => {
  const sections = rule({
    kind: "required_sections",
    headingLevel: 2,
    headings: ["Summary", "Details"],
  });

  it("passes when every section is a root heading at the level", () => {
    const result = lint(["## Details", "", "## Summary"], sections);

    expect(result).toEqual({ findings: [], failedKinds: [] });
  });

  it("reports missing sections in configured order at the document", () => {
    const result = lint(
      ["### Summary", "", "> ## Details", "", "- ## Summary"],
      sections
    );

    expect(result.failedKinds).toEqual([]);
    expect(result.findings).toEqual([
      {
        issue: expect.objectContaining({
          code: "REQUIRED_SECTION_MISSING",
          severity: "error",
          location: documentLocation,
        }),
        ordinal: 0,
      },
      {
        issue: expect.objectContaining({
          code: "REQUIRED_SECTION_MISSING",
          location: documentLocation,
        }),
        ordinal: 1,
      },
    ]);
    expect(Object.keys(result.findings[0].issue.location)).toEqual([
      "kind",
      "documentId",
    ]);
  });
});

describe("section_order", () => {
  const order = rule({
    kind: "section_order",
    headingLevel: 2,
    headings: ["Summary", "Details", "Notes"],
  });

  it("passes sections in order, with gaps, repeats, and other headings", () => {
    const result = lint(
      ["## Summary", "## Other", "## Notes", "## Notes", "### Details"],
      order
    );

    expect(result).toEqual({ findings: [], failedKinds: [] });
  });

  it("orders only root-level sections", () => {
    const result = lint(
      ["## Details", "", "> ## Summary"],
      rule({
        kind: "section_order",
        headingLevel: 2,
        headings: ["Summary", "Details"],
      })
    );

    expect(result).toEqual({ findings: [], failedKinds: [] });
  });

  it("reports each section below the running maximum at its heading", () => {
    const result = lint(
      ["## Notes", "", "## Summary", "", "## Details"],
      order
    );

    expect(result.findings.map((item) => item.issue.location)).toEqual([
      at(3, 1, [1]),
      at(5, 1, [2]),
    ]);
    expect(result.findings.map((item) => item.ordinal)).toEqual([0, 1]);
    expect(result.findings[0].issue.code).toBe("SECTION_ORDER_INVALID");
  });
});

describe("allowed_heading_levels", () => {
  const levels = rule({ kind: "allowed_heading_levels", levels: [2, 3] });

  it("passes allowed levels", () => {
    expect(lint(["## A", "### B"], levels).findings).toEqual([]);
  });

  it("reports headings at any depth in pre-order, with their paths", () => {
    const result = lint(
      ["# Title", "", "- item", "", "  #### Nested", "", "> ##### Quoted"],
      levels
    );

    expect(result.findings.map((item) => item.issue.location)).toEqual([
      at(1, 1, [0]),
      at(5, 3, [1, 0, 1]),
      at(7, 1, [2, 0]),
    ]);
    expect(result.findings.map((item) => item.issue.code)).toEqual([
      "HEADING_LEVEL_NOT_ALLOWED",
      "HEADING_LEVEL_NOT_ALLOWED",
      "HEADING_LEVEL_NOT_ALLOWED",
    ]);
  });
});

describe("required_metadata_fields", () => {
  const fields = rule({
    kind: "required_metadata_fields",
    metadataSection,
    fields: ["Owner", "Status", "Updated"],
  });

  it("passes when every field is in the metadata section", () => {
    const result = lint(
      [
        "## Metadata",
        "",
        "* Owner: Alice",
        "",
        "### Sub",
        "",
        "* Status: draft",
        "* Updated:",
      ],
      fields
    );

    expect(result).toEqual({ findings: [], failedKinds: [] });
  });

  it("reports fields outside the section or root bullet lists as missing", () => {
    const result = lint(
      [
        "* Owner: Alice",
        "",
        "## Metadata",
        "",
        "* Note: none",
        "  * Status: draft",
        "",
        "1. Updated: 2024-01-01",
        "",
        "## Next",
        "",
        "* Status: draft",
      ],
      fields
    );

    expect(result.findings).toEqual(
      [0, 1, 2].map((ordinal) => ({
        issue: expect.objectContaining({
          code: "REQUIRED_METADATA_FIELD_MISSING",
          location: documentLocation,
        }),
        ordinal,
      }))
    );
  });

  it("ends the metadata section at a higher-level root heading", () => {
    const result = lint(
      [
        "## Metadata",
        "",
        "* Owner: Alice",
        "",
        "# Appendix",
        "",
        "* Status: draft",
        "* Updated:",
      ],
      fields
    );

    expect(result.findings).toEqual(
      [0, 1].map((ordinal) => ({
        issue: expect.objectContaining({
          code: "REQUIRED_METADATA_FIELD_MISSING",
          location: documentLocation,
        }),
        ordinal,
      }))
    );
  });

  it("requires the metadata heading at the configured level", () => {
    const result = lint(
      ["### Metadata", "", "* Owner: Alice"],
      rule({
        kind: "required_metadata_fields",
        metadataSection,
        fields: ["Owner"],
      })
    );

    expect(result.findings).toEqual([
      {
        issue: expect.objectContaining({
          code: "REQUIRED_METADATA_FIELD_MISSING",
          location: documentLocation,
        }),
        ordinal: 0,
      },
    ]);
  });

  it("counts only the first metadata section", () => {
    const markdown = [
      "## Metadata",
      "",
      "* Owner: Alice",
      "",
      "## Metadata",
      "",
      "* Status: draft",
    ];
    const only = (name: string) =>
      rule({
        kind: "required_metadata_fields",
        metadataSection,
        fields: [name],
      });

    expect(lint(markdown, only("Owner")).findings).toEqual([]);
    expect(lint(markdown, only("Status")).findings).toHaveLength(1);
  });

  it("reports every field when the section is absent", () => {
    expect(lint(["## Summary"], fields).findings).toHaveLength(3);
  });
});

describe("metadata_field_formats", () => {
  const formats = rule({
    kind: "metadata_field_formats",
    metadataSection,
    fields: [
      { name: "Updated", format: "iso_date" },
      { name: "Statusż😀", format: "one_of", values: ["draft", "final"] },
    ],
  });

  it("passes valid values and ignores unconfigured fields", () => {
    const result = lint(
      [
        "## Metadata",
        "",
        "* Updated: 2024-02-29",
        "* Statusż😀: final",
        "* Owner: anyone",
      ],
      formats
    );

    expect(result).toEqual({ findings: [], failedKinds: [] });
  });

  it("reports invalid values at the value, counting code points", () => {
    const result = lint(
      [
        "## Metadata",
        "",
        "* Statusż😀: nope",
        "* Updated: 2023-02-29",
        "* Updated:",
        "",
        "## Other",
        "",
        "* Updated: never",
      ],
      formats
    );

    expect(result.findings.map((item) => item.issue.location)).toEqual([
      at(3, 13, [1, 0]),
      at(4, 12, [1, 1]),
      at(5, 11, [1, 2]),
    ]);
    expect(result.findings.map((item) => item.ordinal)).toEqual([0, 1, 2]);
    expect(result.findings[0].issue.code).toBe("METADATA_FIELD_FORMAT_INVALID");
  });
});

describe("isIsoDate", () => {
  it.each([
    ["2024-02-29", true],
    ["2000-02-29", true],
    ["1900-02-29", false],
    ["2023-02-29", false],
    ["2024-04-31", false],
    ["2024-12-31", true],
    ["2024-13-01", false],
    ["2024-00-10", false],
    ["2024-01-00", false],
    ["2024-1-01", false],
    ["2024-01-01T00:00", false],
    ["２０２４-01-01", false],
  ])("%s is %s", (value, expected) => {
    expect(isIsoDate(value)).toBe(expected);
  });
});

describe("markdown structure rules", () => {
  const all = [
    "blockquote",
    "code_block",
    "horizontal_rule",
    "table",
    "notice",
    "math_block",
    "toggle_block",
  ];
  const markdown = [
    "> quote",
    "",
    "```",
    "fenced",
    "```",
    "",
    "    indented",
    "",
    "---",
    "",
    "| a |",
    "|---|",
    "| 1 |",
    "",
    ":::info",
    "notice",
    ":::",
    "",
    "$$",
    "x",
    "$$",
    "",
    "+++ Toggle",
    "body",
    "+++",
    "",
    "- item",
    "",
    "  > nested",
  ];

  it("passes a document without configured structures", () => {
    const result = lint(
      ["## Heading", "", "Text", "", "- item"],
      rule({ kind: "unsupported_markdown_structures", structures: all })
    );

    expect(result).toEqual({ findings: [], failedKinds: [] });
  });

  it("reports unsupported structures at any depth as Errors", () => {
    const result = lint(
      markdown,
      rule({ kind: "unsupported_markdown_structures", structures: all })
    );

    expect(result.failedKinds).toEqual([]);
    expect(result.findings.map((item) => item.issue.location)).toEqual([
      at(1, 1, [0]),
      at(3, 1, [1]),
      at(7, 5, [2]),
      at(9, 1, [3]),
      at(11, 1, [4]),
      at(15, 1, [5]),
      at(19, 1, [6]),
      at(23, 1, [7]),
      at(29, 3, [8, 0, 1]),
    ]);
    expect(
      result.findings.every(
        (item) =>
          item.issue.code === "MARKDOWN_STRUCTURE_UNSUPPORTED" &&
          item.issue.severity === "error"
      )
    ).toBe(true);
  });

  it("passes a document without discouraged structures", () => {
    const result = lint(
      ["## Heading", "", "Text", "", "- item"],
      rule({ kind: "discouraged_markdown_structures", structures: all })
    );

    expect(result).toEqual({ findings: [], failedKinds: [] });
  });

  it("reports only the configured discouraged structures as Warnings", () => {
    const result = lint(
      markdown,
      rule({
        kind: "discouraged_markdown_structures",
        structures: ["horizontal_rule", "code_block"],
      })
    );

    expect(result.findings.map((item) => item.issue.location)).toEqual([
      at(3, 1, [1]),
      at(7, 5, [2]),
      at(9, 1, [3]),
    ]);
    expect(result.findings.map((item) => item.issue.severity)).toEqual([
      "warning",
      "warning",
      "warning",
    ]);
  });
});

describe("evaluateDocumentRules", () => {
  it("numbers ordinals from zero per rule kind", () => {
    const result = lint(
      ["# A", "", "# B", "", "---"],
      rule({ kind: "allowed_heading_levels", levels: [2] }),
      rule({
        kind: "discouraged_markdown_structures",
        structures: ["horizontal_rule"],
      })
    );

    expect(
      result.findings.map((item) => [item.issue.code, item.ordinal])
    ).toEqual([
      ["HEADING_LEVEL_NOT_ALLOWED", 0],
      ["HEADING_LEVEL_NOT_ALLOWED", 1],
      ["DISCOURAGED_MARKDOWN_STRUCTURE", 0],
    ]);
  });

  it("isolates a failing kind and keeps its earlier Findings", () => {
    const syntax: CanonicalSyntax = {
      children: [
        {
          kind: "heading",
          level: 1,
          text: "A",
          position: { line: 1, column: 1, path: [0] },
          children: [],
        },
        { kind: "heading", level: 1, text: "B", position: null, children: [] },
      ],
      links: [],
    };

    const result = evaluateDocumentRules({
      documentId,
      syntax,
      rules: [
        rule({ kind: "allowed_heading_levels", levels: [2] }),
        rule({ kind: "required_sections", headingLevel: 2, headings: ["C"] }),
      ],
    });

    expect(result.failedKinds).toEqual(["allowed_heading_levels"]);
    expect(
      result.findings.map((item) => [item.issue.code, item.ordinal])
    ).toEqual([
      ["HEADING_LEVEL_NOT_ALLOWED", 0],
      ["REQUIRED_SECTION_MISSING", 0],
    ]);
  });

  it.each([
    { kind: "parent_document_resolved" },
    { kind: "hierarchy_acyclic" },
    { kind: "published_documents_in_structure" },
    { kind: "parent_collection_consistent" },
    {
      kind: "global_index_links",
      surfaceDocumentId: documentId,
      globalIndexDocumentIds: ["00000000-0000-4000-8000-000000000002"],
    },
  ])("rejects the non-structure kind $kind", (entry) => {
    expect(() => lint(["## A"], rule(entry))).toThrow(WikiLintContractError);
  });

  it("rejects a repeated kind", () => {
    const levels = rule({ kind: "allowed_heading_levels", levels: [2] });

    expect(() => lint(["## A"], levels, levels)).toThrow(WikiLintContractError);
  });

  it("keeps document-located Findings free of positions", () => {
    const result = lint(
      ["## Summary"],
      rule({ kind: "required_sections", headingLevel: 2, headings: ["X"] }),
      rule({ kind: "required_metadata_fields", metadataSection, fields: ["Y"] })
    );

    for (const { issue } of result.findings) {
      expect(issue.location).toEqual(documentLocation);
      expect(issue.location).not.toHaveProperty("line");
      expect(issue.location).not.toHaveProperty("column");
      expect(issue.location).not.toHaveProperty("relationshipKind");
    }
  });
});

describe("internal_links", () => {
  const links = rule({ kind: "internal_links" });
  const levels = rule({ kind: "allowed_heading_levels", levels: [2] });
  const syntax = parseCanonicalMarkdown("# Title");
  const A = "00000000-0000-4000-8000-0000000000a1";
  const B = "00000000-0000-4000-8000-0000000000b1";

  /**
   * Builds a reference to a UUID key.
   *
   * @param key - the key.
   * @param line - the line of its position, or null for no position.
   * @returns the reference.
   */
  const ref = (key: string, line: number | null): InternalLinkReference => ({
    key,
    keyKind: "id",
    position: line === null ? null : { line, column: 3, path: [line - 1] },
  });

  /**
   * Evaluates the link rule after a structure rule.
   *
   * @param references - the references.
   * @param targets - the target states.
   * @returns the evaluation output.
   */
  const evaluate = (
    references: InternalLinkReference[],
    targets: [string, LinkTargetState][]
  ) =>
    evaluateDocumentRules({
      documentId,
      syntax,
      rules: [levels, links],
      links: { references, targets: new Map(targets) },
    });

  it("reports each unresolved occurrence in order with its own ordinal", () => {
    const result = evaluate(
      [ref(A, 2), ref(B, 3), ref(A, 4), ref(B, 5)],
      [
        [A, "unresolved"],
        [B, "resolved"],
      ]
    );

    expect(result.failedKinds).toEqual([]);
    expect(result.findings).toEqual([
      {
        issue: expect.objectContaining({ code: "HEADING_LEVEL_NOT_ALLOWED" }),
        ordinal: 0,
      },
      {
        issue: {
          code: "INTERNAL_LINK_TARGET_UNRESOLVED",
          severity: "error",
          message: expect.any(String),
          location: at(2, 3, [1]),
        },
        ordinal: 0,
      },
      {
        issue: expect.objectContaining({
          code: "INTERNAL_LINK_TARGET_UNRESOLVED",
          location: at(4, 3, [3]),
        }),
        ordinal: 1,
      },
    ]);
  });

  it("emits nothing when every target resolves", () => {
    expect(
      evaluateDocumentRules({
        documentId,
        syntax,
        rules: [links],
        links: {
          references: [ref(A, null), ref(A, 2)],
          targets: new Map([[A, "resolved"]]),
        },
      })
    ).toEqual({ findings: [], failedKinds: [] });
  });

  it("fails only its kind on an unresolved occurrence without a position", () => {
    const result = evaluate(
      [ref(A, 2), ref(B, null), ref(A, 4)],
      [
        [A, "unresolved"],
        [B, "unresolved"],
      ]
    );

    expect(result.failedKinds).toEqual(["internal_links"]);
    expect(
      result.findings.map((item) => [item.issue.code, item.ordinal])
    ).toEqual([
      ["HEADING_LEVEL_NOT_ALLOWED", 0],
      ["INTERNAL_LINK_TARGET_UNRESOLVED", 0],
    ]);
  });

  it("fails its kind when a key has no target state", () => {
    const result = evaluate([ref(A, 2), ref(B, 3)], [[A, "unresolved"]]);

    expect(result.failedKinds).toEqual(["internal_links"]);
    expect(result.findings.map((item) => item.issue.code)).toEqual([
      "HEADING_LEVEL_NOT_ALLOWED",
      "INTERNAL_LINK_TARGET_UNRESOLVED",
    ]);
  });

  it("fails its kind when the links were not resolved", () => {
    const result = evaluateDocumentRules({
      documentId,
      syntax,
      rules: [links, levels],
    });

    expect(result.failedKinds).toEqual(["internal_links"]);
    expect(result.findings.map((item) => item.issue.code)).toEqual([
      "HEADING_LEVEL_NOT_ALLOWED",
    ]);
  });

  it("reveals nothing about a target in its Finding", () => {
    const result = evaluate([ref(A, 2)], [[A, "unresolved"]]);

    expect(Object.keys(result.findings[0].issue)).toEqual([
      "code",
      "severity",
      "message",
      "location",
    ]);
    expect(JSON.stringify(result)).not.toContain(A);
  });
});

describe("documentSurfaceRules", () => {
  const structureRules = [
    rule({ kind: "discouraged_markdown_structures", structures: ["table"] }),
    rule({ kind: "required_sections", headingLevel: 2, headings: ["A"] }),
    rule({ kind: "section_order", headingLevel: 2, headings: ["A", "B"] }),
    rule({ kind: "allowed_heading_levels", levels: [2] }),
    rule({ kind: "required_metadata_fields", metadataSection, fields: ["F"] }),
    rule({
      kind: "metadata_field_formats",
      metadataSection,
      fields: [{ name: "F", format: "iso_date" }],
    }),
    rule({ kind: "unsupported_markdown_structures", structures: ["table"] }),
  ];
  const wikiRules = [
    rule({ kind: "parent_document_resolved" }),
    rule({ kind: "hierarchy_acyclic" }),
    rule({ kind: "published_documents_in_structure" }),
    rule({ kind: "parent_collection_consistent" }),
    rule({
      kind: "global_index_links",
      surfaceDocumentId: documentId,
      globalIndexDocumentIds: ["00000000-0000-4000-8000-000000000002"],
    }),
  ];
  const links = rule({ kind: "internal_links" });

  it("keeps the structure kinds and internal links in configured order", () => {
    const rules = [
      wikiRules[0],
      structureRules[0],
      links,
      ...wikiRules.slice(1),
      ...structureRules.slice(1),
    ];

    expect(documentSurfaceRules(rules)).toEqual([
      structureRules[0],
      links,
      ...structureRules.slice(1),
    ]);
  });

  it("drops hierarchy and global-index kinds", () => {
    expect(documentSurfaceRules(wikiRules)).toEqual([]);
  });

  it("returns an empty selection for no rules", () => {
    expect(documentSurfaceRules([])).toEqual([]);
  });
});
