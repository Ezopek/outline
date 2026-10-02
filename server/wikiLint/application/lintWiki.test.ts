import { createHash } from "node:crypto";
import { DatabaseError } from "sequelize";
import type { User } from "@server/models";
import {
  CanonicalMarkdownError,
  parseCanonicalMarkdown,
} from "../adapters/canonicalSyntax";
import type { WikiSnapshotRead } from "../adapters/wikiReader";
import type {
  LinkTargetState,
  ReadOnlyResult,
  ScopeLocation,
  SystemFailureCode,
  WikiCollectionGraph,
  WikiSnapshotCollection,
  WikiSnapshotDocument,
} from "../core/contracts";
import type * as DocumentRules from "../core/documentRules";
import { evaluateDocumentRules } from "../core/documentRules";
import { extractInternalLinks } from "../core/internalLinks";
import type { PolicySet } from "../core/policySet";
import { buildPolicySet, policyIdentity } from "../core/policySet";
import { createFinding, createSystemFailure } from "../core/registry";
import { Deadline, DeadlineFloorError } from "./deadline";
import type { LintWikiOutcome, LintWikiReader } from "./lintWiki";
import { LINT_WIKI_DEADLINE_MS, lintWiki } from "./lintWiki";

vi.mock("../core/documentRules", async (importOriginal) => {
  const actual = await importOriginal<typeof DocumentRules>();
  return {
    ...actual,
    evaluateDocumentRules: vi.fn(actual.evaluateDocumentRules),
  };
});

/** Structure rules only. */
const STRUCTURE = "00000000-0000-4000-8000-0000000000c1";
/** A structure rule plus `internal_links`. */
const LINKS = "00000000-0000-4000-8000-0000000000c2";
/** Hierarchy rules only. */
const HIERARCHY = "00000000-0000-4000-8000-0000000000c3";
/** Structure, hierarchy, and global-index rules. */
const ALL_CHECKS = "00000000-0000-4000-8000-0000000000c4";
/** An invalid entry. */
const INVALID = "00000000-0000-4000-8000-0000000000c5";
/** A second invalid entry. */
const INVALID_2 = "00000000-0000-4000-8000-0000000000c6";
/** No entry. */
const UNCONFIGURED = "00000000-0000-4000-8000-0000000000c7";

const DOC_1 = "00000000-0000-4000-8000-0000000000d1";
const DOC_2 = "00000000-0000-4000-8000-0000000000d2";
const DOC_3 = "00000000-0000-4000-8000-0000000000d3";

const ORIGIN = "https://wiki.example.test";
const TARGET_A = "00000000-0000-4000-8000-0000000000a1";
const TARGET_B = "00000000-0000-4000-8000-0000000000b1";

const sha256Hex = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const requiredSections = {
  kind: "required_sections",
  headingLevel: 2,
  headings: ["Overview", "Details"],
};

/**
 * Builds a policy set over the test collections.
 *
 * @param collections - the policy entry of each collection ID.
 * @returns the policy set.
 */
function policySetFor(collections: Record<string, unknown>): PolicySet {
  const loaded = buildPolicySet(
    Buffer.from(JSON.stringify({ schemaVersion: 1, collections }), "utf8"),
    sha256Hex
  );
  if (!loaded.ok) {
    throw new Error("The test configuration must load");
  }
  return loaded.policySet;
}

const policySet = policySetFor({
  [STRUCTURE]: {
    activation: "read_only",
    rules: [requiredSections, { kind: "allowed_heading_levels", levels: [2] }],
  },
  [LINKS]: {
    activation: "read_only",
    rules: [requiredSections, { kind: "internal_links" }],
  },
  [HIERARCHY]: {
    activation: "read_only",
    rules: [{ kind: "hierarchy_acyclic" }],
  },
  [ALL_CHECKS]: {
    activation: "read_only",
    rules: [
      {
        kind: "global_index_links",
        surfaceDocumentId: DOC_1,
        globalIndexDocumentIds: [DOC_2],
      },
      requiredSections,
      { kind: "parent_document_resolved" },
    ],
  },
  [INVALID]: { activation: "read_only", rules: [] },
  [INVALID_2]: { activation: "enforced", rules: [] },
});

/**
 * Returns the AD-12 identity of a configured collection.
 *
 * @param collectionId - the collection.
 * @returns the identity.
 */
function identityOf(collectionId: string) {
  const entry = policySet.entries.find((e) => e.collectionId === collectionId);
  if (!entry) {
    throw new Error("Unknown test collection");
  }
  return policyIdentity(entry);
}

/** Markdown with both required sections and only level-2 headings. */
const CLEAN = "## Overview\n\nSummary\n\n## Details\n\nBody";

/** Markdown missing `Details`, with a level-1 heading on line 3. */
const DEFECTIVE = "## Overview\n\n# Title\n\nBody";

/** Markdown missing `Details`, linking A twice and B once on line 3. */
const LINKING = [
  "## Overview",
  "",
  `See [a](/doc/${TARGET_A}) or [b](${ORIGIN}/doc/${TARGET_B}) or [a](/d/${TARGET_A})`,
].join("\n");

/**
 * Builds an evaluated document with content.
 *
 * @param documentId - the document.
 * @param markdown - the canonical Markdown.
 * @param withLinks - whether its links are recognized.
 * @returns the snapshot document.
 */
function documentOf(
  documentId: string,
  markdown: string,
  withLinks = false
): WikiSnapshotDocument {
  const syntax = parseCanonicalMarkdown(markdown);
  return {
    documentId,
    content: {
      syntax,
      links: withLinks ? extractInternalLinks(syntax.links, ORIGIN) : null,
    },
    parent: null,
  };
}

/**
 * Builds a snapshot collection.
 *
 * @param collectionId - the collection.
 * @param documents - its documents.
 * @param graph - its graph inputs.
 * @returns the collection.
 */
const collectionOf = (
  collectionId: string,
  documents: WikiSnapshotDocument[],
  graph: WikiCollectionGraph | null = null
): WikiSnapshotCollection => ({ collectionId, documents, graph });

/**
 * Builds a successful snapshot read.
 *
 * @param collections - the evaluated collections.
 * @param sentinelCollectionIds - the readable sentinels.
 * @param targets - the link target states.
 * @returns the read.
 */
const snapshotRead = (
  collections: WikiSnapshotCollection[],
  sentinelCollectionIds: string[] = [],
  targets: [string, LinkTargetState][] = []
): WikiSnapshotRead => ({
  ok: true,
  snapshot: { collections, sentinelCollectionIds, targets: new Map(targets) },
});

/**
 * Builds a failed snapshot read.
 *
 * @param error - the failure.
 * @param sentinelCollectionIds - the sentinels established before it.
 * @returns the read.
 */
const failedRead = (
  error: unknown,
  sentinelCollectionIds: string[] = []
): WikiSnapshotRead => ({ ok: false, error, sentinelCollectionIds });

const actor = {} as User;

let now = 0;
const clock = () => now;

/**
 * Builds a fake reader.
 *
 * @param collectionId - the lookup result, or an error to throw.
 * @param read - the snapshot read, or a function producing it.
 * @returns the reader with spied steps.
 */
function fakeReader(
  collectionId: string | null | Error,
  read: WikiSnapshotRead | (() => Promise<WikiSnapshotRead>) = snapshotRead([])
) {
  return {
    authorizeLintCollection: vi.fn<LintWikiReader["authorizeLintCollection"]>(
      async () => {
        if (collectionId instanceof Error) {
          throw collectionId;
        }
        return collectionId;
      }
    ),
    readWikiSnapshot: vi.fn<LintWikiReader["readWikiSnapshot"]>(async () =>
      typeof read === "function" ? read() : read
    ),
  };
}

/**
 * Runs `lintWiki` with a fresh deadline.
 *
 * @param reader - the fake reader.
 * @param collectionId - the requested collection, or undefined for the
 *   default scope.
 * @param set - the policy set.
 * @returns the outcome.
 */
function run(
  reader: LintWikiReader,
  collectionId?: string,
  set: PolicySet = policySet
): Promise<LintWikiOutcome> {
  return lintWiki({
    collectionId,
    actor,
    policySet: set,
    deadline: new Deadline(LINT_WIKI_DEADLINE_MS, clock),
    reader,
    instanceOrigin: ORIGIN,
  });
}

/**
 * Runs `lintWiki` and returns its modeled result.
 *
 * @param reader - the fake reader.
 * @param collectionId - the requested collection, if any.
 * @returns the result.
 */
async function resultOf(
  reader: LintWikiReader,
  collectionId?: string
): Promise<ReadOnlyResult> {
  const outcome = await run(reader, collectionId);
  if (outcome.kind !== "result") {
    throw new Error("Expected a result");
  }
  return outcome.result;
}

/**
 * Builds a collection-scope location.
 *
 * @param collectionId - the collection.
 * @returns the location.
 */
const cs = (collectionId: string): ScopeLocation => ({
  kind: "scope",
  scopeKind: "collection",
  collectionId,
});

/**
 * Builds a document-scope location in a collection.
 *
 * @param documentId - the document.
 * @param collectionId - the collection.
 * @returns the location.
 */
const ds = (documentId: string, collectionId: string): ScopeLocation => ({
  kind: "scope",
  scopeKind: "document",
  documentId,
  collectionId,
});

/**
 * Builds a System Failure.
 *
 * @param code - the code.
 * @param location - the location.
 * @returns the System Failure.
 */
const failure = (code: SystemFailureCode, location: ScopeLocation) =>
  createSystemFailure(code, location);

/**
 * Builds a zero-count entry.
 *
 * @param collectionId - the collection.
 * @returns the entry.
 */
const zeroEntry = (collectionId: string) => ({
  collectionId,
  evaluatedDocumentCount: 0,
  evaluatedLinkCount: 0,
  completedChecks: [],
});

/**
 * Builds a Sequelize database error with a Postgres error code.
 *
 * @param code - the Postgres error code.
 * @returns the error.
 */
const databaseError = (code: string) =>
  new DatabaseError(
    Object.assign(new Error("database error"), { code, sql: "" })
  );

beforeEach(() => {
  now = 0;
  vi.mocked(evaluateDocumentRules).mockClear();
});

describe("collection scope", () => {
  it("completes when every unit completes", async () => {
    const reader = fakeReader(
      STRUCTURE,
      snapshotRead([collectionOf(STRUCTURE, [documentOf(DOC_1, CLEAN)])])
    );

    await expect(
      resultOf(reader, "any-name-abcdefghij")
    ).resolves.toStrictEqual({
      state: "complete",
      complete: true,
      clean: true,
      errors: [],
      warnings: [],
      systemFailures: [],
      scope: {
        kind: "collection",
        collectionId: STRUCTURE,
        evaluatedDocumentCount: 1,
        evaluatedLinkCount: 0,
        completedChecks: ["documents"],
      },
      policies: [identityOf(STRUCTURE)],
    });
    expect(reader.authorizeLintCollection).toHaveBeenCalledWith({
      id: "any-name-abcdefghij",
      actor,
      deadline: expect.any(Deadline),
    });
    expect(reader.readWikiSnapshot).toHaveBeenCalledWith({
      scope: { kind: "collection", collectionId: STRUCTURE },
      entries: [policySet.entries.find((e) => e.collectionId === STRUCTURE)],
      actor,
      deadline: expect.any(Deadline),
      instanceOrigin: ORIGIN,
    });
  });

  it("answers denied without a snapshot", async () => {
    const reader = fakeReader(null);

    await expect(run(reader, STRUCTURE)).resolves.toEqual({ kind: "denied" });
    expect(reader.readWikiSnapshot).not.toHaveBeenCalled();
  });

  it.each([
    ["the floor refused the lookup", new DeadlineFloorError()],
    ["the lookup timed out", databaseError("57014")],
    ["the lookup failed", new Error("raw detail")],
  ])("fails when %s", async (_name, error) => {
    const reader = fakeReader(error);

    await expect(run(reader, STRUCTURE)).resolves.toEqual({ kind: "failed" });
    expect(reader.readWikiSnapshot).not.toHaveBeenCalled();
  });

  it("is not evaluated for an unconfigured collection", async () => {
    const reader = fakeReader(UNCONFIGURED);

    await expect(resultOf(reader, UNCONFIGURED)).resolves.toStrictEqual({
      state: "not_evaluated",
      complete: false,
      clean: false,
      errors: [],
      warnings: [],
      systemFailures: [],
      scope: { kind: "collection", ...zeroEntry(UNCONFIGURED) },
      policies: [],
      reason: "POLICY_NOT_CONFIGURED",
    });
    expect(reader.readWikiSnapshot).not.toHaveBeenCalled();
  });

  it("fails a sentinel without a snapshot", async () => {
    const reader = fakeReader(INVALID);

    await expect(resultOf(reader, INVALID)).resolves.toStrictEqual({
      state: "failed",
      complete: false,
      clean: false,
      errors: [],
      warnings: [],
      systemFailures: [failure("POLICY_CONFIGURATION_INVALID", cs(INVALID))],
      scope: { kind: "collection", ...zeroEntry(INVALID) },
      policies: [identityOf(INVALID)],
    });
    expect(reader.readWikiSnapshot).not.toHaveBeenCalled();
  });

  it("fails graph checks closed whether or not the graph is authorized", async () => {
    for (const graph of [
      { authorized: false } as const,
      {
        authorized: true,
        structureDocumentIds: [],
        globalIndex: { surface: null, indexes: [] },
      } as const,
    ]) {
      const reader = fakeReader(
        ALL_CHECKS,
        snapshotRead([
          collectionOf(ALL_CHECKS, [documentOf(DOC_1, CLEAN)], graph),
        ])
      );

      await expect(resultOf(reader, ALL_CHECKS)).resolves.toStrictEqual({
        state: "incomplete",
        complete: false,
        clean: false,
        errors: [],
        warnings: [],
        systemFailures: [
          failure("VALIDATION_RUNTIME_FAILED", cs(ALL_CHECKS)),
          failure("VALIDATION_RUNTIME_FAILED", cs(ALL_CHECKS)),
        ],
        scope: {
          kind: "collection",
          collectionId: ALL_CHECKS,
          evaluatedDocumentCount: 1,
          evaluatedLinkCount: 0,
          completedChecks: ["documents"],
        },
        policies: [identityOf(ALL_CHECKS)],
      });
    }
  });

  it("fails a graph-only collection that is no longer readable", async () => {
    const reader = fakeReader(
      HIERARCHY,
      snapshotRead([collectionOf(HIERARCHY, [], { authorized: false })])
    );

    await expect(resultOf(reader, HIERARCHY)).resolves.toMatchObject({
      state: "failed",
      systemFailures: [failure("VALIDATION_RUNTIME_FAILED", cs(HIERARCHY))],
      scope: { kind: "collection", ...zeroEntry(HIERARCHY) },
      policies: [identityOf(HIERARCHY)],
    });
  });

  it("completes a vacuous documents check", async () => {
    const reader = fakeReader(
      STRUCTURE,
      snapshotRead([collectionOf(STRUCTURE, [])])
    );

    await expect(resultOf(reader, STRUCTURE)).resolves.toMatchObject({
      state: "complete",
      clean: true,
      scope: {
        evaluatedDocumentCount: 0,
        evaluatedLinkCount: 0,
        completedChecks: ["documents"],
      },
    });
  });

  it("isolates an unavailable document", async () => {
    const reader = fakeReader(
      STRUCTURE,
      snapshotRead([
        collectionOf(STRUCTURE, [
          { documentId: DOC_1, content: "unavailable", parent: null },
          documentOf(DOC_2, DEFECTIVE),
        ]),
      ])
    );

    const result = await resultOf(reader, STRUCTURE);

    expect(result).toMatchObject({
      state: "incomplete",
      systemFailures: [
        failure("VALIDATION_RUNTIME_FAILED", ds(DOC_1, STRUCTURE)),
      ],
      scope: {
        evaluatedDocumentCount: 1,
        evaluatedLinkCount: 0,
        completedChecks: [],
      },
    });
    expect(result.errors.map(({ code }) => code)).toEqual([
      "HEADING_LEVEL_NOT_ALLOWED",
      "REQUIRED_SECTION_MISSING",
    ]);
  });

  it("keeps the Findings of a unit whose rule kind failed", async () => {
    const finding = createFinding("REQUIRED_SECTION_MISSING", {
      kind: "document",
      documentId: DOC_1,
    });
    vi.mocked(evaluateDocumentRules).mockReturnValueOnce({
      findings: [{ issue: finding, ordinal: 0 }],
      failedKinds: ["allowed_heading_levels"],
    });
    const reader = fakeReader(
      STRUCTURE,
      snapshotRead([
        collectionOf(STRUCTURE, [
          documentOf(DOC_1, DEFECTIVE),
          documentOf(DOC_2, CLEAN),
        ]),
      ])
    );

    await expect(resultOf(reader, STRUCTURE)).resolves.toMatchObject({
      state: "incomplete",
      errors: [finding],
      systemFailures: [
        failure("VALIDATION_RUNTIME_FAILED", ds(DOC_1, STRUCTURE)),
      ],
      scope: { evaluatedDocumentCount: 1, completedChecks: [] },
    });
  });

  it("counts the links of completed units when internal_links is enabled", async () => {
    const reader = fakeReader(
      LINKS,
      snapshotRead(
        [
          collectionOf(LINKS, [
            documentOf(DOC_1, LINKING, true),
            documentOf(DOC_2, CLEAN, true),
          ]),
        ],
        [],
        [
          [TARGET_A, "resolved"],
          [TARGET_B, "unresolved"],
        ]
      )
    );

    const result = await resultOf(reader, LINKS);

    expect(result.scope).toEqual({
      kind: "collection",
      collectionId: LINKS,
      evaluatedDocumentCount: 2,
      evaluatedLinkCount: 3,
      completedChecks: ["documents"],
    });
    expect(result.errors.map(({ code, location }) => [code, location])).toEqual(
      [
        [
          "INTERNAL_LINK_TARGET_UNRESOLVED",
          expect.objectContaining({ documentId: DOC_1, line: 3 }),
        ],
        ["REQUIRED_SECTION_MISSING", { kind: "document", documentId: DOC_1 }],
      ]
    );
  });

  it("fails a unit whose links are missing", async () => {
    const reader = fakeReader(
      LINKS,
      snapshotRead([collectionOf(LINKS, [documentOf(DOC_1, LINKING)])])
    );

    await expect(resultOf(reader, LINKS)).resolves.toMatchObject({
      state: "failed",
      systemFailures: [failure("VALIDATION_RUNTIME_FAILED", ds(DOC_1, LINKS))],
      scope: { evaluatedDocumentCount: 0, evaluatedLinkCount: 0 },
    });
  });
});

describe("default scope", () => {
  it("is not evaluated without a statement for an empty policy set", async () => {
    const reader = fakeReader(null);

    const outcome = await run(reader, undefined, policySetFor({}));

    expect(outcome).toEqual({
      kind: "result",
      result: expect.objectContaining({
        state: "not_evaluated",
        scope: { kind: "configured_collections", collections: [] },
        policies: [],
        reason: "POLICY_NOT_CONFIGURED",
      }),
    });
    expect(reader.authorizeLintCollection).not.toHaveBeenCalled();
    expect(reader.readWikiSnapshot).not.toHaveBeenCalled();
  });

  it("reads every entry and is not evaluated when nothing is readable", async () => {
    const reader = fakeReader(null, snapshotRead([]));

    await expect(resultOf(reader)).resolves.toMatchObject({
      state: "not_evaluated",
      scope: { kind: "configured_collections", collections: [] },
      policies: [],
    });
    expect(reader.authorizeLintCollection).not.toHaveBeenCalled();
    expect(reader.readWikiSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { kind: "configured_collections" },
        entries: policySet.entries,
      })
    );
  });

  it("fails when a sentinel is the only readable collection", async () => {
    const reader = fakeReader(null, snapshotRead([], [INVALID]));

    await expect(resultOf(reader)).resolves.toStrictEqual({
      state: "failed",
      complete: false,
      clean: false,
      errors: [],
      warnings: [],
      systemFailures: [failure("POLICY_CONFIGURATION_INVALID", cs(INVALID))],
      scope: {
        kind: "configured_collections",
        collections: [zeroEntry(INVALID)],
      },
      policies: [identityOf(INVALID)],
    });
  });

  it("is incomplete with a sentinel when another unit completed", async () => {
    const reader = fakeReader(
      null,
      snapshotRead(
        [collectionOf(STRUCTURE, [documentOf(DOC_1, CLEAN)])],
        [INVALID]
      )
    );

    await expect(resultOf(reader)).resolves.toStrictEqual({
      state: "incomplete",
      complete: false,
      clean: false,
      errors: [],
      warnings: [],
      systemFailures: [failure("POLICY_CONFIGURATION_INVALID", cs(INVALID))],
      scope: {
        kind: "configured_collections",
        collections: [
          {
            collectionId: STRUCTURE,
            evaluatedDocumentCount: 1,
            evaluatedLinkCount: 0,
            completedChecks: ["documents"],
          },
          zeroEntry(INVALID),
        ],
      },
      policies: [identityOf(STRUCTURE), identityOf(INVALID)],
    });
  });

  it("is failed with a sentinel when no other unit completed", async () => {
    const reader = fakeReader(
      null,
      snapshotRead(
        [
          collectionOf(STRUCTURE, [
            { documentId: DOC_1, content: "unavailable", parent: null },
          ]),
        ],
        [INVALID]
      )
    );

    await expect(resultOf(reader)).resolves.toMatchObject({
      state: "failed",
      systemFailures: [
        failure("VALIDATION_RUNTIME_FAILED", ds(DOC_1, STRUCTURE)),
        failure("POLICY_CONFIGURATION_INVALID", cs(INVALID)),
      ],
      scope: {
        collections: [zeroEntry(STRUCTURE), zeroEntry(INVALID)],
      },
    });
  });

  it("orders Findings by collection, then document", async () => {
    const reader = fakeReader(
      null,
      snapshotRead([
        collectionOf(STRUCTURE, [documentOf(DOC_3, DEFECTIVE)]),
        collectionOf(LINKS, [documentOf(DOC_1, DEFECTIVE, true)]),
      ])
    );

    const result = await resultOf(reader);

    expect(
      result.errors.map(({ code, location }) => [code, location.documentId])
    ).toEqual([
      ["HEADING_LEVEL_NOT_ALLOWED", DOC_3],
      ["REQUIRED_SECTION_MISSING", DOC_3],
      ["REQUIRED_SECTION_MISSING", DOC_1],
    ]);
    expect(result.state).toBe("complete");
    expect(result.scope).toEqual({
      kind: "configured_collections",
      collections: [
        {
          collectionId: STRUCTURE,
          evaluatedDocumentCount: 1,
          evaluatedLinkCount: 0,
          completedChecks: ["documents"],
        },
        {
          collectionId: LINKS,
          evaluatedDocumentCount: 1,
          evaluatedLinkCount: 0,
          completedChecks: ["documents"],
        },
      ],
    });
  });

  it("rejects a snapshot collection outside the policy set", async () => {
    const reader = fakeReader(
      null,
      snapshotRead([collectionOf(UNCONFIGURED, [])])
    );

    await expect(run(reader)).rejects.toThrow("Unexpected snapshot collection");
  });
});

describe("snapshot failure", () => {
  it.each([
    [
      "the floor refused a batch",
      new DeadlineFloorError(),
      "VALIDATION_TIMEOUT",
    ],
    ["a statement timed out", databaseError("57014"), "VALIDATION_TIMEOUT"],
    ["a lock wait timed out", databaseError("55P03"), "VALIDATION_TIMEOUT"],
    ["a query failed", new Error("raw detail"), "VALIDATION_RUNTIME_FAILED"],
  ] as const)(
    "keeps a collection's identity when %s",
    async (_name, error, code) => {
      const reader = fakeReader(STRUCTURE, failedRead(error));

      await expect(resultOf(reader, STRUCTURE)).resolves.toStrictEqual({
        state: "failed",
        complete: false,
        clean: false,
        errors: [],
        warnings: [],
        systemFailures: [failure(code, cs(STRUCTURE))],
        scope: { kind: "collection", ...zeroEntry(STRUCTURE) },
        policies: [identityOf(STRUCTURE)],
      });
    }
  );

  it("times out after expiry unless canonicalization failed", async () => {
    for (const [error, code] of [
      [new Error("raw detail"), "VALIDATION_TIMEOUT"],
      [new CanonicalMarkdownError("raw"), "VALIDATION_RUNTIME_FAILED"],
    ] as const) {
      const reader = fakeReader(STRUCTURE, async () => {
        now = LINT_WIKI_DEADLINE_MS;
        return failedRead(error);
      });

      await expect(resultOf(reader, STRUCTURE)).resolves.toMatchObject({
        systemFailures: [failure(code, cs(STRUCTURE))],
      });
      now = 0;
    }
  });

  it("keeps only the sentinels established before a default-scope failure", async () => {
    const reader = fakeReader(
      null,
      failedRead(new DeadlineFloorError(), [INVALID_2])
    );

    await expect(resultOf(reader)).resolves.toStrictEqual({
      state: "failed",
      complete: false,
      clean: false,
      errors: [],
      warnings: [],
      systemFailures: [
        failure("POLICY_CONFIGURATION_INVALID", cs(INVALID_2)),
        failure("VALIDATION_TIMEOUT", {
          kind: "scope",
          scopeKind: "configured_collections",
        }),
      ],
      scope: {
        kind: "configured_collections",
        collections: [zeroEntry(INVALID_2)],
      },
      policies: [identityOf(INVALID_2)],
    });
  });

  it("returns one run-wide failure when the enumeration fails", async () => {
    const reader = fakeReader(null, failedRead(new Error("raw detail")));

    await expect(resultOf(reader)).resolves.toStrictEqual({
      state: "failed",
      complete: false,
      clean: false,
      errors: [],
      warnings: [],
      systemFailures: [
        failure("VALIDATION_RUNTIME_FAILED", {
          kind: "scope",
          scopeKind: "configured_collections",
        }),
      ],
      scope: { kind: "configured_collections", collections: [] },
      policies: [],
    });
  });

  it("fails when the reader throws", async () => {
    const reader = fakeReader(STRUCTURE, async () => {
      throw new Error("raw detail");
    });

    await expect(resultOf(reader, STRUCTURE)).resolves.toMatchObject({
      state: "failed",
      systemFailures: [failure("VALIDATION_RUNTIME_FAILED", cs(STRUCTURE))],
    });
  });

  it("times out when the deadline expired after the snapshot", async () => {
    const reader = fakeReader(null, async () => {
      now = LINT_WIKI_DEADLINE_MS;
      return snapshotRead(
        [collectionOf(STRUCTURE, [documentOf(DOC_1, DEFECTIVE)])],
        [INVALID]
      );
    });

    await expect(resultOf(reader)).resolves.toStrictEqual({
      state: "failed",
      complete: false,
      clean: false,
      errors: [],
      warnings: [],
      systemFailures: [
        failure("POLICY_CONFIGURATION_INVALID", cs(INVALID)),
        failure("VALIDATION_TIMEOUT", {
          kind: "scope",
          scopeKind: "configured_collections",
        }),
      ],
      scope: {
        kind: "configured_collections",
        collections: [zeroEntry(INVALID)],
      },
      policies: [identityOf(INVALID)],
    });
    expect(evaluateDocumentRules).not.toHaveBeenCalled();
  });
});
