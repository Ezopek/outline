import type {
  FindingCode,
  FindingDetail,
  IssueLocation,
  ScopeLocation,
} from "./contracts";
import { WikiLintContractError } from "./contracts";
import {
  COLLECTION_CONFLICT,
  ISSUE_REGISTRY,
  POLICY_NOT_CONFIGURED,
  RULE_REGISTRY,
  createFinding,
  createSystemFailure,
  getIssueDefinition,
  requiredChecks,
  ruleConfigSchema,
} from "./registry";
import type { RuleConfig } from "./registry";

const documentId = "00000000-0000-4000-8000-000000000001";
const collectionId = "00000000-0000-4000-8000-000000000002";

/** The AD-3 table: class, code, location kind, relationship kind, surfaces, check. */
const ad3Rows = [
  [
    "error",
    "REQUIRED_SECTION_MISSING",
    "document",
    undefined,
    "document",
    "documents",
  ],
  [
    "error",
    "SECTION_ORDER_INVALID",
    "text",
    undefined,
    "document",
    "documents",
  ],
  [
    "error",
    "HEADING_LEVEL_NOT_ALLOWED",
    "text",
    undefined,
    "document",
    "documents",
  ],
  [
    "error",
    "REQUIRED_METADATA_FIELD_MISSING",
    "document",
    undefined,
    "document",
    "documents",
  ],
  [
    "error",
    "METADATA_FIELD_FORMAT_INVALID",
    "text",
    undefined,
    "document",
    "documents",
  ],
  [
    "error",
    "MARKDOWN_STRUCTURE_UNSUPPORTED",
    "text",
    undefined,
    "document",
    "documents",
  ],
  [
    "error",
    "INTERNAL_LINK_TARGET_UNRESOLVED",
    "text",
    undefined,
    "document",
    "documents",
  ],
  [
    "error",
    "PARENT_DOCUMENT_UNRESOLVED",
    "relationship",
    "parent",
    "wiki",
    "hierarchy",
  ],
  ["error", "HIERARCHY_CYCLE", "relationship", "parent", "wiki", "hierarchy"],
  [
    "error",
    "PUBLISHED_DOCUMENT_MISSING_FROM_STRUCTURE",
    "relationship",
    "collection_structure",
    "wiki",
    "hierarchy",
  ],
  [
    "error",
    "PARENT_COLLECTION_MISMATCH",
    "relationship",
    "parent",
    "wiki",
    "hierarchy",
  ],
  [
    "error",
    "GLOBAL_INDEX_LINK_MISSING",
    "relationship",
    "global_index",
    "wiki",
    "global_index",
  ],
  [
    "warning",
    "DISCOURAGED_MARKDOWN_STRUCTURE",
    "text",
    undefined,
    "document",
    "documents",
  ],
  [
    "system_failure",
    "POLICY_CONFIGURATION_INVALID",
    "scope",
    undefined,
    "all",
    null,
  ],
  [
    "system_failure",
    "POLICY_SCHEMA_VERSION_UNSUPPORTED",
    null,
    undefined,
    "startup_diagnostics_only",
    null,
  ],
  [
    "system_failure",
    "POLICY_CONFIGURATION_MALFORMED",
    null,
    undefined,
    "startup_diagnostics_only",
    null,
  ],
  [
    "system_failure",
    "VALIDATION_RUNTIME_FAILED",
    "scope",
    undefined,
    "all",
    null,
  ],
  ["system_failure", "VALIDATION_TIMEOUT", "scope", undefined, "all", null],
  [
    "system_failure",
    "VALIDATION_RESOURCE_LIMIT_EXCEEDED",
    "scope",
    undefined,
    "lint_wiki",
    null,
  ],
] as const;

describe("ISSUE_REGISTRY", () => {
  it("contains exactly the AD-3 rows", () => {
    const rows = ISSUE_REGISTRY.map(({ message: _message, ...row }) => row);
    expect(rows).toEqual(
      ad3Rows.map(
        ([cls, code, locationKind, relationshipKind, surfaces, check]) => ({
          class: cls,
          code,
          locationKind,
          ...(relationshipKind ? { relationshipKind } : {}),
          surfaces,
          check,
        })
      )
    );
  });

  it("gives every code one fixed, generic message", () => {
    const messages = ISSUE_REGISTRY.map((definition) => definition.message);
    expect(new Set(messages).size).toBe(messages.length);
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toMatch(/AD-\d|[0-9a-f]{8}-[0-9a-f]{4}/i);
    }
  });

  it("is deeply frozen", () => {
    expect(Object.isFrozen(ISSUE_REGISTRY)).toBe(true);
    for (const definition of ISSUE_REGISTRY) {
      expect(Object.isFrozen(definition)).toBe(true);
    }
    expect(() => {
      (ISSUE_REGISTRY[0] as { message: string }).message = "changed";
    }).toThrow(TypeError);
  });

  it("keeps POLICY_NOT_CONFIGURED as a reason, not a code", () => {
    expect(POLICY_NOT_CONFIGURED).toBe("POLICY_NOT_CONFIGURED");
    expect(getIssueDefinition(POLICY_NOT_CONFIGURED)).toBeUndefined();
    expect(getIssueDefinition("__proto__")).toBeUndefined();
  });

  it("owns the collection_conflict identifier", () => {
    expect(COLLECTION_CONFLICT).toBe("collection_conflict");
  });
});

describe("RULE_REGISTRY", () => {
  it("maps each rule kind to its Finding code", () => {
    expect(
      Object.fromEntries(
        Object.entries(RULE_REGISTRY).map(([kind, entry]) => [kind, entry.code])
      )
    ).toEqual({
      required_sections: "REQUIRED_SECTION_MISSING",
      section_order: "SECTION_ORDER_INVALID",
      allowed_heading_levels: "HEADING_LEVEL_NOT_ALLOWED",
      required_metadata_fields: "REQUIRED_METADATA_FIELD_MISSING",
      metadata_field_formats: "METADATA_FIELD_FORMAT_INVALID",
      unsupported_markdown_structures: "MARKDOWN_STRUCTURE_UNSUPPORTED",
      discouraged_markdown_structures: "DISCOURAGED_MARKDOWN_STRUCTURE",
      internal_links: "INTERNAL_LINK_TARGET_UNRESOLVED",
      parent_document_resolved: "PARENT_DOCUMENT_UNRESOLVED",
      hierarchy_acyclic: "HIERARCHY_CYCLE",
      published_documents_in_structure:
        "PUBLISHED_DOCUMENT_MISSING_FROM_STRUCTURE",
      parent_collection_consistent: "PARENT_COLLECTION_MISMATCH",
      global_index_links: "GLOBAL_INDEX_LINK_MISSING",
    });
  });

  it("is frozen with its entries", () => {
    expect(Object.isFrozen(RULE_REGISTRY)).toBe(true);
    for (const entry of Object.values(RULE_REGISTRY)) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
    expect(() => {
      (RULE_REGISTRY.section_order as { code: string }).code =
        "HEADING_LEVEL_NOT_ALLOWED";
    }).toThrow(TypeError);
    expect(() => {
      (RULE_REGISTRY as Record<string, unknown>).custom_rule = {};
    }).toThrow(TypeError);
  });

  it("maps each of the 13 rule kinds to exactly one distinct Finding code", () => {
    const codes = Object.values(RULE_REGISTRY).map((entry) => entry.code);
    const findingCodes = ISSUE_REGISTRY.filter(
      (definition) => definition.class !== "system_failure"
    ).map((definition) => definition.code);

    expect(codes).toHaveLength(13);
    expect([...codes].sort()).toEqual([...findingCodes].sort());
  });
});

describe("ruleConfigSchema", () => {
  const uuid = "00000000-0000-4000-8000-000000000003";
  const metadataSection = { heading: "Metadata", headingLevel: 2 };
  const valid = [
    { kind: "required_sections", headingLevel: 2, headings: ["Summary"] },
    {
      kind: "section_order",
      headingLevel: 2,
      headings: ["Summary", "Details"],
    },
    { kind: "allowed_heading_levels", levels: [2, 3] },
    { kind: "required_metadata_fields", metadataSection, fields: ["Owner"] },
    {
      kind: "metadata_field_formats",
      metadataSection,
      fields: [
        { name: "Updated", format: "iso_date" },
        { name: "Status", format: "one_of", values: ["draft", "final"] },
      ],
    },
    {
      kind: "unsupported_markdown_structures",
      structures: ["table", "notice"],
    },
    {
      kind: "discouraged_markdown_structures",
      structures: ["horizontal_rule"],
    },
    { kind: "internal_links" },
    { kind: "parent_document_resolved" },
    { kind: "hierarchy_acyclic" },
    { kind: "published_documents_in_structure" },
    { kind: "parent_collection_consistent" },
    {
      kind: "global_index_links",
      surfaceDocumentId: uuid,
      globalIndexDocumentIds: [documentId],
    },
  ];

  it("accepts one valid entry of every registered kind", () => {
    expect(valid.map((entry) => entry.kind).sort()).toEqual(
      Object.keys(RULE_REGISTRY).sort()
    );
    for (const entry of valid) {
      expect(ruleConfigSchema.safeParse(entry).success).toBe(true);
    }
  });

  it.each(["severity", "code", "pattern", "regex", "fn"])(
    "rejects an extra %s key on every kind",
    (key) => {
      for (const entry of valid) {
        expect(
          ruleConfigSchema.safeParse({ ...entry, [key]: "x" }).success
        ).toBe(false);
      }
    }
  );

  it.each([
    ["an unknown kind", { kind: "custom_rule" }],
    ["a missing kind", { headingLevel: 2, headings: ["Summary"] }],
    [
      "a duplicate heading",
      { kind: "required_sections", headingLevel: 2, headings: ["A", "A"] },
    ],
    [
      "an empty heading list",
      { kind: "required_sections", headingLevel: 2, headings: [] },
    ],
    ["level 0", { kind: "allowed_heading_levels", levels: [0] }],
    ["level 7", { kind: "allowed_heading_levels", levels: [7] }],
    ["a fractional level", { kind: "allowed_heading_levels", levels: [1.5] }],
    ["a duplicate level", { kind: "allowed_heading_levels", levels: [2, 2] }],
    [
      "an untrimmed heading",
      { kind: "required_sections", headingLevel: 2, headings: [" Summary"] },
    ],
    [
      "an empty heading",
      { kind: "required_sections", headingLevel: 2, headings: [""] },
    ],
    [
      "a single ordered section",
      { kind: "section_order", headingLevel: 2, headings: ["Summary"] },
    ],
    [
      "an untrimmed metadata heading",
      {
        kind: "required_metadata_fields",
        metadataSection: { heading: "Metadata\t", headingLevel: 2 },
        fields: ["Owner"],
      },
    ],
    [
      "an extra metadata section key",
      {
        kind: "required_metadata_fields",
        metadataSection: { ...metadataSection, pattern: ".*" },
        fields: ["Owner"],
      },
    ],
    [
      "duplicate format field names",
      {
        kind: "metadata_field_formats",
        metadataSection,
        fields: [
          { name: "Updated", format: "iso_date" },
          { name: "Updated", format: "one_of", values: ["x"] },
        ],
      },
    ],
    [
      "an unknown format",
      {
        kind: "metadata_field_formats",
        metadataSection,
        fields: [{ name: "Updated", format: "regex", pattern: ".*" }],
      },
    ],
    [
      "an extra key on an iso_date format",
      {
        kind: "metadata_field_formats",
        metadataSection,
        fields: [{ name: "Updated", format: "iso_date", pattern: "^x$" }],
      },
    ],
    [
      "an extra key on a one_of format",
      {
        kind: "metadata_field_formats",
        metadataSection,
        fields: [
          { name: "Status", format: "one_of", values: ["a"], severity: "x" },
        ],
      },
    ],
    [
      "an empty one_of value list",
      {
        kind: "metadata_field_formats",
        metadataSection,
        fields: [{ name: "Status", format: "one_of", values: [] }],
      },
    ],
    [
      "an unknown structure",
      { kind: "unsupported_markdown_structures", structures: ["image"] },
    ],
    [
      "a duplicate structure",
      {
        kind: "discouraged_markdown_structures",
        structures: ["table", "table"],
      },
    ],
    [
      "an uppercase UUID",
      {
        kind: "global_index_links",
        surfaceDocumentId: "00000000-0000-4000-8000-00000000000A",
        globalIndexDocumentIds: [documentId],
      },
    ],
    [
      "a UUID without hyphens",
      {
        kind: "global_index_links",
        surfaceDocumentId: uuid,
        globalIndexDocumentIds: ["00000000000040008000000000000001"],
      },
    ],
    [
      "a braced UUID",
      {
        kind: "global_index_links",
        surfaceDocumentId: `{${uuid}}`,
        globalIndexDocumentIds: [documentId],
      },
    ],
    [
      "a duplicate global index",
      {
        kind: "global_index_links",
        surfaceDocumentId: uuid,
        globalIndexDocumentIds: [documentId, documentId],
      },
    ],
    ["parameters on a parameterless kind", { kind: "internal_links", x: 1 }],
    ["an empty level list", { kind: "allowed_heading_levels", levels: [] }],
    [
      "an empty structure list",
      { kind: "unsupported_markdown_structures", structures: [] },
    ],
    [
      "an empty required field list",
      { kind: "required_metadata_fields", metadataSection, fields: [] },
    ],
    [
      "an empty global index list",
      {
        kind: "global_index_links",
        surfaceDocumentId: uuid,
        globalIndexDocumentIds: [],
      },
    ],
    [
      "a duplicate required field",
      {
        kind: "required_metadata_fields",
        metadataSection,
        fields: ["Owner", "Owner"],
      },
    ],
    [
      "a duplicate one_of value",
      {
        kind: "metadata_field_formats",
        metadataSection,
        fields: [{ name: "Status", format: "one_of", values: ["a", "a"] }],
      },
    ],
    [
      "an untrimmed one_of value",
      {
        kind: "metadata_field_formats",
        metadataSection,
        fields: [{ name: "Status", format: "one_of", values: ["draft "] }],
      },
    ],
    [
      "a required field name with a colon",
      { kind: "required_metadata_fields", metadataSection, fields: ["A:B"] },
    ],
    [
      "a format field name with a colon",
      {
        kind: "metadata_field_formats",
        metadataSection,
        fields: [{ name: "Updated:", format: "iso_date" }],
      },
    ],
    [
      "an untrimmed field name",
      { kind: "required_metadata_fields", metadataSection, fields: ["Owner "] },
    ],
  ])("rejects %s", (_name, entry) => {
    expect(ruleConfigSchema.safeParse(entry).success).toBe(false);
  });

  describe("length caps in UTF-16 code units", () => {
    const astral = "\u{1F600}";
    const sections = (heading: string) => ({
      kind: "required_sections",
      headingLevel: 2,
      headings: [heading],
    });
    const fields = (field: string) => ({
      kind: "required_metadata_fields",
      metadataSection,
      fields: [field],
    });

    it.each([
      ["a 200-unit heading", true, sections("h".repeat(200))],
      [
        "a 198-unit heading plus an astral character",
        true,
        sections(`${"h".repeat(198)}${astral}`),
      ],
      ["a 201-unit heading", false, sections("h".repeat(201))],
      [
        "a 199-unit heading plus an astral character",
        false,
        sections(`${"h".repeat(199)}${astral}`),
      ],
      ["a 64-unit field", true, fields("f".repeat(64))],
      [
        "a 62-unit field plus an astral character",
        true,
        fields(`${"f".repeat(62)}${astral}`),
      ],
      ["a 65-unit field", false, fields("f".repeat(65))],
      [
        "a 63-unit field plus an astral character",
        false,
        fields(`${"f".repeat(63)}${astral}`),
      ],
    ])("accepts %s: %s", (_name, valid, entry) => {
      expect(ruleConfigSchema.safeParse(entry).success).toBe(valid);
    });
  });
});

describe("createFinding", () => {
  it("takes severity and message from the registry in a fixed key order", () => {
    const finding = createFinding("DISCOURAGED_MARKDOWN_STRUCTURE", {
      path: [1, 0],
      column: 3,
      line: 2,
      documentId,
      kind: "text",
    });

    expect(JSON.stringify(finding)).toBe(
      JSON.stringify({
        code: "DISCOURAGED_MARKDOWN_STRUCTURE",
        severity: "warning",
        message: getIssueDefinition("DISCOURAGED_MARKDOWN_STRUCTURE")?.message,
        location: {
          kind: "text",
          documentId,
          line: 2,
          column: 3,
          path: [1, 0],
        },
      })
    );
  });

  it("accepts a matching relationship kind", () => {
    expect(
      createFinding("GLOBAL_INDEX_LINK_MISSING", {
        kind: "relationship",
        documentId,
        relationshipKind: "global_index",
      }).location
    ).toEqual({
      kind: "relationship",
      documentId,
      relationshipKind: "global_index",
    });
  });

  it.each([
    [
      "REQUIRED_SECTION_MISSING with a text location",
      "REQUIRED_SECTION_MISSING",
      { kind: "text", documentId, line: 1, column: 1 },
    ],
    [
      "HIERARCHY_CYCLE with a global_index relationship",
      "HIERARCHY_CYCLE",
      { kind: "relationship", documentId, relationshipKind: "global_index" },
    ],
    [
      "a text location with line 0",
      "HEADING_LEVEL_NOT_ALLOWED",
      { kind: "text", documentId, line: 0, column: 1 },
    ],
    [
      "a text location with an extra key",
      "HEADING_LEVEL_NOT_ALLOWED",
      { kind: "text", documentId, line: 1, column: 1, collectionId },
    ],
    [
      "a document location without a document",
      "REQUIRED_SECTION_MISSING",
      { kind: "document" },
    ],
    [
      "a System Failure code",
      "VALIDATION_RUNTIME_FAILED",
      { kind: "scope", scopeKind: "document", documentId },
    ],
    ["an unknown code", "NOT_A_CODE", { kind: "document", documentId }],
  ])("rejects %s", (_name, code, location) => {
    expect(() =>
      createFinding(code as FindingCode, location as IssueLocation)
    ).toThrow(WikiLintContractError);
  });

  describe("detail", () => {
    const missingAt = { kind: "document" as const, documentId };
    const surfaceAt = {
      kind: "relationship" as const,
      documentId,
      relationshipKind: "global_index" as const,
    };

    it("omits the key without a detail", () => {
      expect(
        Object.keys(createFinding("REQUIRED_SECTION_MISSING", missingAt))
      ).toEqual(["code", "severity", "message", "location"]);
    });

    it.each([
      [
        "REQUIRED_SECTION_MISSING",
        missingAt,
        { headingLevel: 2, heading: "Summary", kind: "section" },
        { kind: "section", heading: "Summary", headingLevel: 2 },
      ],
      [
        "REQUIRED_METADATA_FIELD_MISSING",
        missingAt,
        { field: "Owner", kind: "metadata_field" },
        { kind: "metadata_field", field: "Owner" },
      ],
      [
        "GLOBAL_INDEX_LINK_MISSING",
        surfaceAt,
        { urlId: "AbCdEfGhIj", documentId: collectionId, kind: "global_index" },
        { kind: "global_index", documentId: collectionId, urlId: "AbCdEfGhIj" },
      ],
    ] as const)(
      "rebuilds the %s detail last, in a fixed key order",
      (code, location, input, detail) => {
        const finding = createFinding(code, location, input);

        expect(JSON.stringify(finding)).toBe(
          JSON.stringify({
            code,
            severity: "error",
            message: getIssueDefinition(code)?.message,
            location,
            detail,
          })
        );
        expect(finding.detail).not.toBe(input);
      }
    );

    it.each([
      ["a 200-unit heading", "h".repeat(200)],
      [
        "a 198-unit heading plus an astral character",
        `${"h".repeat(198)}\u{1F600}`,
      ],
    ])("accepts %s", (_name, heading) => {
      expect(
        createFinding("REQUIRED_SECTION_MISSING", missingAt, {
          kind: "section",
          heading,
          headingLevel: 6,
        }).detail
      ).toEqual({ kind: "section", heading, headingLevel: 6 });
    });

    it.each([
      ["a 64-unit field", "f".repeat(64)],
      [
        "a 62-unit field plus an astral character",
        `${"f".repeat(62)}\u{1F600}`,
      ],
    ])("accepts %s", (_name, field) => {
      expect(
        createFinding("REQUIRED_METADATA_FIELD_MISSING", missingAt, {
          kind: "metadata_field",
          field,
        }).detail
      ).toEqual({ kind: "metadata_field", field });
    });

    it.each([
      [
        "a detail on another code",
        "SECTION_ORDER_INVALID",
        { kind: "text", documentId, line: 1, column: 1 },
        { kind: "section", heading: "Summary", headingLevel: 2 },
      ],
      [
        "a detail on a code without its kind",
        "REQUIRED_SECTION_MISSING",
        missingAt,
        { kind: "metadata_field", field: "Owner" },
      ],
      [
        "a global-index kind on a metadata code",
        "REQUIRED_METADATA_FIELD_MISSING",
        missingAt,
        { kind: "global_index", documentId, urlId: "AbCdEfGhIj" },
      ],
      [
        "an extra key",
        "REQUIRED_SECTION_MISSING",
        missingAt,
        { kind: "section", heading: "Summary", headingLevel: 2, pattern: ".*" },
      ],
      [
        "allowed values",
        "REQUIRED_METADATA_FIELD_MISSING",
        missingAt,
        { kind: "metadata_field", field: "Status", values: ["Active"] },
      ],
      [
        "a missing key",
        "GLOBAL_INDEX_LINK_MISSING",
        surfaceAt,
        { kind: "global_index", documentId },
      ],
      [
        "a 201-unit heading",
        "REQUIRED_SECTION_MISSING",
        missingAt,
        { kind: "section", heading: "h".repeat(201), headingLevel: 2 },
      ],
      [
        "a 199-unit heading plus an astral character",
        "REQUIRED_SECTION_MISSING",
        missingAt,
        {
          kind: "section",
          heading: `${"h".repeat(199)}\u{1F600}`,
          headingLevel: 2,
        },
      ],
      [
        "an untrimmed heading",
        "REQUIRED_SECTION_MISSING",
        missingAt,
        { kind: "section", heading: " Summary", headingLevel: 2 },
      ],
      [
        "heading level 7",
        "REQUIRED_SECTION_MISSING",
        missingAt,
        { kind: "section", heading: "Summary", headingLevel: 7 },
      ],
      [
        "a 65-unit field",
        "REQUIRED_METADATA_FIELD_MISSING",
        missingAt,
        { kind: "metadata_field", field: "f".repeat(65) },
      ],
      [
        "a 63-unit field plus an astral character",
        "REQUIRED_METADATA_FIELD_MISSING",
        missingAt,
        { kind: "metadata_field", field: `${"f".repeat(63)}\u{1F600}` },
      ],
      [
        "a field with a colon",
        "REQUIRED_METADATA_FIELD_MISSING",
        missingAt,
        { kind: "metadata_field", field: "A:B" },
      ],
      [
        "an uppercase index UUID",
        "GLOBAL_INDEX_LINK_MISSING",
        surfaceAt,
        {
          kind: "global_index",
          documentId: "00000000-0000-4000-8000-00000000000A",
          urlId: "AbCdEfGhIj",
        },
      ],
      [
        "an empty URL identifier",
        "GLOBAL_INDEX_LINK_MISSING",
        surfaceAt,
        { kind: "global_index", documentId, urlId: "" },
      ],
      [
        "an empty heading",
        "REQUIRED_SECTION_MISSING",
        missingAt,
        { kind: "section", heading: "", headingLevel: 2 },
      ],
      [
        "heading level 0",
        "REQUIRED_SECTION_MISSING",
        missingAt,
        { kind: "section", heading: "Summary", headingLevel: 0 },
      ],
      [
        "a fractional heading level",
        "REQUIRED_SECTION_MISSING",
        missingAt,
        { kind: "section", heading: "Summary", headingLevel: 1.5 },
      ],
      [
        "a string heading level",
        "REQUIRED_SECTION_MISSING",
        missingAt,
        { kind: "section", heading: "Summary", headingLevel: "2" },
      ],
      [
        "an empty field",
        "REQUIRED_METADATA_FIELD_MISSING",
        missingAt,
        { kind: "metadata_field", field: "" },
      ],
      [
        "an untrimmed field",
        "REQUIRED_METADATA_FIELD_MISSING",
        missingAt,
        { kind: "metadata_field", field: "Owner " },
      ],
      [
        "a lowercase index ID that is not a UUID",
        "GLOBAL_INDEX_LINK_MISSING",
        surfaceAt,
        {
          kind: "global_index",
          documentId: "index-abcdefghij",
          urlId: "AbCdEfGhIj",
        },
      ],
      [
        "a non-string URL identifier",
        "GLOBAL_INDEX_LINK_MISSING",
        surfaceAt,
        { kind: "global_index", documentId, urlId: 42 },
      ],
      ["a string detail", "REQUIRED_SECTION_MISSING", missingAt, "Summary"],
      [
        "an array detail",
        "REQUIRED_SECTION_MISSING",
        missingAt,
        ["section", "Summary", 2],
      ],
      ["a null detail", "REQUIRED_SECTION_MISSING", missingAt, null],
    ])("rejects %s", (_name, code, location, detail) => {
      expect(() =>
        createFinding(
          code as FindingCode,
          location as IssueLocation,
          detail as FindingDetail
        )
      ).toThrow(WikiLintContractError);
    });
  });
});

describe("createSystemFailure", () => {
  it("builds a scope-located System Failure in a fixed key order", () => {
    const failure = createSystemFailure("VALIDATION_TIMEOUT", {
      documentId,
      collectionId,
      scopeKind: "document",
      kind: "scope",
    });

    expect(Object.keys(failure)).toEqual(["code", "message", "location"]);
    expect(Object.keys(failure.location)).toEqual([
      "kind",
      "scopeKind",
      "collectionId",
      "documentId",
    ]);
  });

  it.each([
    "POLICY_SCHEMA_VERSION_UNSUPPORTED",
    "POLICY_CONFIGURATION_MALFORMED",
    "REQUIRED_SECTION_MISSING",
    "NOT_A_CODE",
  ])("rejects %s", (code) => {
    expect(() =>
      createSystemFailure(code as "VALIDATION_TIMEOUT", {
        kind: "scope",
        scopeKind: "collection",
        collectionId,
      })
    ).toThrow(WikiLintContractError);
  });

  it("requires a document on a document scope location", () => {
    expect(() =>
      createSystemFailure("VALIDATION_RUNTIME_FAILED", {
        kind: "scope",
        scopeKind: "document",
        collectionId,
      })
    ).toThrow(WikiLintContractError);
  });

  it("rejects a non-scope location", () => {
    expect(() =>
      createSystemFailure("VALIDATION_RUNTIME_FAILED", {
        kind: "document",
        documentId,
      } as unknown as ScopeLocation)
    ).toThrow(WikiLintContractError);
  });
});

describe("requiredChecks", () => {
  const surface = "00000000-0000-4000-8000-000000000003";

  it("returns the unique checks of the enabled kinds in canonical order", () => {
    expect(
      requiredChecks([
        {
          kind: "global_index_links",
          surfaceDocumentId: surface,
          globalIndexDocumentIds: [surface],
        },
        { kind: "hierarchy_acyclic" },
        { kind: "internal_links" },
        { kind: "parent_document_resolved" },
        { kind: "allowed_heading_levels", levels: [2] },
      ])
    ).toEqual(["documents", "hierarchy", "global_index"]);
  });

  it("returns only the checks of the enabled kinds", () => {
    expect(requiredChecks([{ kind: "internal_links" }])).toEqual(["documents"]);
    expect(
      requiredChecks([
        { kind: "published_documents_in_structure" },
        { kind: "parent_collection_consistent" },
      ])
    ).toEqual(["hierarchy"]);
    expect(requiredChecks([])).toEqual([]);
  });

  it("maps every rule kind to its code's check", () => {
    for (const [kind, { code }] of Object.entries(RULE_REGISTRY)) {
      expect(requiredChecks([{ kind } as RuleConfig])).toEqual([
        getIssueDefinition(code)?.check,
      ]);
    }
  });
});
