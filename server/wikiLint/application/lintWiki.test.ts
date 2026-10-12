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
  WikiGlobalIndexInput,
  WikiParentEdge,
  WikiSnapshotCollection,
  WikiSnapshotDocument,
} from "../core/contracts";
import type * as DocumentRules from "../core/documentRules";
import { evaluateDocumentRules } from "../core/documentRules";
import type * as GraphRules from "../core/graphRules";
import { evaluateGraphCheck } from "../core/graphRules";
import { extractInternalLinks } from "../core/internalLinks";
import type { PolicySet } from "../core/policySet";
import { buildPolicySet, policyIdentity } from "../core/policySet";
import {
  createFinding,
  createSystemFailure,
  requiredChecks,
} from "../core/registry";
import { Deadline, DeadlineFloorError } from "./deadline";
import type { LintWikiOutcome, LintWikiReader } from "./lintWiki";
import {
  LINT_WIKI_DEADLINE_MS,
  LINT_WIKI_STOP_MARGIN_MS,
  lintWiki,
  wikiUnits,
} from "./lintWiki";
import { WikiResourceLimitError } from "./snapshotLimits";

vi.mock("../core/documentRules", async (importOriginal) => {
  const actual = await importOriginal<typeof DocumentRules>();
  return {
    ...actual,
    evaluateDocumentRules: vi.fn(actual.evaluateDocumentRules),
  };
});

vi.mock("../core/graphRules", async (importOriginal) => {
  const actual = await importOriginal<typeof GraphRules>();
  return {
    ...actual,
    evaluateGraphCheck: vi.fn(actual.evaluateGraphCheck),
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
/** The same rules as `ALL_CHECKS`. */
const ALL_CHECKS_2 = "00000000-0000-4000-8000-0000000000c8";
/** An invalid entry. */
const INVALID = "00000000-0000-4000-8000-0000000000c5";
/** A second invalid entry. */
const INVALID_2 = "00000000-0000-4000-8000-0000000000c6";
/** No entry. */
const UNCONFIGURED = "00000000-0000-4000-8000-0000000000c7";
/** A required-sections rule plus a hierarchy rule. */
const MIXED = "00000000-0000-4000-8000-0000000000c9";

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

/** DOC_1 is the surface of the indexes DOC_2 and DOC_3. */
const allChecksPolicy = {
  activation: "read_only",
  rules: [
    {
      kind: "global_index_links",
      surfaceDocumentId: DOC_1,
      globalIndexDocumentIds: [DOC_3, DOC_2],
    },
    requiredSections,
    { kind: "parent_document_resolved" },
  ],
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
    rules: [
      { kind: "hierarchy_acyclic" },
      { kind: "published_documents_in_structure" },
    ],
  },
  [ALL_CHECKS]: allChecksPolicy,
  [ALL_CHECKS_2]: allChecksPolicy,
  [MIXED]: {
    activation: "read_only",
    rules: [requiredSections, { kind: "hierarchy_acyclic" }],
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

/** The detail of the `Details` section that `DEFECTIVE` lacks. */
const DETAILS_SECTION = {
  kind: "section",
  heading: "Details",
  headingLevel: 2,
} as const;

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

const NONE: WikiParentEdge = { state: "none" };

/**
 * Gives a document the parent edge of an authorized graph.
 *
 * @param document - the snapshot document.
 * @param parent - its parent edge.
 * @returns the document with the edge.
 */
const withParent = (
  document: WikiSnapshotDocument,
  parent: WikiParentEdge = NONE
): WikiSnapshotDocument => ({ ...document, parent });

/**
 * The global-index inputs of `allChecksPolicy`: the surface DOC_1 links DOC_2
 * by ID and DOC_3 by URL identifier.
 */
const LINKED_INDEXES: WikiGlobalIndexInput = {
  surface: {
    documentId: DOC_1,
    links: [
      { key: DOC_2, keyKind: "id", position: null },
      { key: "UrlIdOfDoc3", keyKind: "urlId", position: null },
    ],
  },
  indexes: [
    { documentId: DOC_2, urlId: "UrlIdOfDoc2" },
    { documentId: DOC_3, urlId: "UrlIdOfDoc3" },
  ],
};

/**
 * Builds an authorized collection graph.
 *
 * @param structureDocumentIds - the structure's document IDs.
 * @param globalIndex - the global-index inputs.
 * @returns the graph.
 */
const graphOf = (
  structureDocumentIds: string[],
  globalIndex: WikiGlobalIndexInput | null = null
): WikiCollectionGraph => ({
  authorized: true,
  structureDocumentIds,
  globalIndex,
});

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
 * @param admit - the admission; admits by default.
 * @returns the outcome.
 */
function run(
  reader: LintWikiReader,
  collectionId?: string,
  set: PolicySet = policySet,
  admit: () => boolean = () => true
): Promise<LintWikiOutcome> {
  return lintWiki({
    collectionId,
    actor,
    policySet: set,
    deadline: new Deadline(LINT_WIKI_DEADLINE_MS, clock),
    reader,
    instanceOrigin: ORIGIN,
    admit,
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

/** A clock reading that leaves one millisecond less than the stop margin. */
const PAST_MARGIN = LINT_WIKI_DEADLINE_MS - LINT_WIKI_STOP_MARGIN_MS + 1;

/**
 * Lets the given call of a spied rule function run, then moves the clock past
 * the stop margin, as if the unit had taken that long.
 *
 * @param spied - the spied rule function.
 * @param call - the one-based call after which the margin is crossed.
 * @param remainingMs - the remainder left after that call; one millisecond
 *   less than the stop margin by default.
 */
function crossMarginDuring<A extends unknown[], R>(
  spied: (...args: A) => R,
  call: number,
  remainingMs = LINT_WIKI_STOP_MARGIN_MS - 1
) {
  const spy = vi.mocked(spied);
  const actual = spy.getMockImplementation() as (...args: A) => R;
  let calls = 0;
  spy.mockImplementation((...args: A) => {
    const result = actual(...args);
    calls++;
    if (calls === call) {
      now = LINT_WIKI_DEADLINE_MS - remainingMs;
    }
    return result;
  });
}

/** Restores the clock and the rule spies to their real behavior. */
function resetRun() {
  now = 0;
  vi.mocked(evaluateDocumentRules).mockReset();
  vi.mocked(evaluateGraphCheck).mockReset();
}

beforeEach(resetRun);

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

    const outcome = await run(reader, STRUCTURE);

    expect(outcome).toStrictEqual({ kind: "failed", cause: error });
    expect(outcome.kind === "failed" && outcome.cause).toBe(error);
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

  it("completes every check of an authorized graph", async () => {
    const reader = fakeReader(
      ALL_CHECKS,
      snapshotRead([
        collectionOf(
          ALL_CHECKS,
          [
            withParent(documentOf(DOC_1, CLEAN)),
            withParent(documentOf(DOC_2, CLEAN), {
              state: "resolved",
              documentId: DOC_1,
              sameCollection: true,
            }),
            withParent(documentOf(DOC_3, CLEAN)),
          ],
          graphOf([DOC_1, DOC_2, DOC_3], LINKED_INDEXES)
        ),
      ])
    );

    await expect(resultOf(reader, ALL_CHECKS)).resolves.toStrictEqual({
      state: "complete",
      complete: true,
      clean: true,
      errors: [],
      warnings: [],
      systemFailures: [],
      scope: {
        kind: "collection",
        collectionId: ALL_CHECKS,
        evaluatedDocumentCount: 3,
        evaluatedLinkCount: 0,
        completedChecks: ["documents", "hierarchy", "global_index"],
      },
      policies: [identityOf(ALL_CHECKS)],
    });
    expect(
      vi.mocked(evaluateGraphCheck).mock.calls.map(([{ check }]) => check)
    ).toEqual(["hierarchy", "global_index"]);
  });

  it("keeps the Findings of a partially provable check", async () => {
    const reader = fakeReader(
      ALL_CHECKS,
      snapshotRead([
        collectionOf(
          ALL_CHECKS,
          [withParent(documentOf(DOC_1, CLEAN))],
          graphOf([DOC_1], {
            surface: { documentId: DOC_1, links: [] },
            indexes: [{ documentId: DOC_2, urlId: "UrlIdOfDoc2" }],
          })
        ),
      ])
    );

    const result = await resultOf(reader, ALL_CHECKS);

    expect(result).toStrictEqual({
      state: "incomplete",
      complete: false,
      clean: false,
      errors: [
        createFinding(
          "GLOBAL_INDEX_LINK_MISSING",
          {
            kind: "relationship",
            documentId: DOC_1,
            relationshipKind: "global_index",
          },
          { kind: "global_index", documentId: DOC_2, urlId: "UrlIdOfDoc2" }
        ),
      ],
      warnings: [],
      systemFailures: [failure("VALIDATION_RUNTIME_FAILED", cs(ALL_CHECKS))],
      scope: {
        kind: "collection",
        collectionId: ALL_CHECKS,
        evaluatedDocumentCount: 1,
        evaluatedLinkCount: 0,
        completedChecks: ["documents", "hierarchy"],
      },
      policies: [identityOf(ALL_CHECKS)],
    });
    expect(JSON.stringify(result)).not.toContain(DOC_3);
  });

  it("fails a check whose rule kind throws and keeps the other kind's Findings", async () => {
    const reader = fakeReader(
      HIERARCHY,
      snapshotRead([
        collectionOf(
          HIERARCHY,
          [
            { documentId: DOC_1, content: null, parent: null },
            { documentId: DOC_2, content: null, parent: NONE },
          ],
          graphOf([DOC_1])
        ),
      ])
    );

    await expect(resultOf(reader, HIERARCHY)).resolves.toStrictEqual({
      state: "failed",
      complete: false,
      clean: false,
      errors: [
        createFinding("PUBLISHED_DOCUMENT_MISSING_FROM_STRUCTURE", {
          kind: "relationship",
          documentId: DOC_2,
          relationshipKind: "collection_structure",
        }),
      ],
      warnings: [],
      systemFailures: [failure("VALIDATION_RUNTIME_FAILED", cs(HIERARCHY))],
      scope: { kind: "collection", ...zeroEntry(HIERARCHY) },
      policies: [identityOf(HIERARCHY)],
    });
  });

  it("completes a vacuous hierarchy check", async () => {
    const reader = fakeReader(
      HIERARCHY,
      snapshotRead([collectionOf(HIERARCHY, [], graphOf([DOC_1]))])
    );

    await expect(resultOf(reader, HIERARCHY)).resolves.toStrictEqual({
      state: "complete",
      complete: true,
      clean: true,
      errors: [],
      warnings: [],
      systemFailures: [],
      scope: {
        kind: "collection",
        collectionId: HIERARCHY,
        evaluatedDocumentCount: 0,
        evaluatedLinkCount: 0,
        completedChecks: ["hierarchy"],
      },
      policies: [identityOf(HIERARCHY)],
    });
    expect(evaluateGraphCheck).toHaveBeenCalledTimes(1);
  });

  it("fails the graph checks of an unauthorized graph without evaluating them", async () => {
    const reader = fakeReader(
      ALL_CHECKS,
      snapshotRead([
        collectionOf(ALL_CHECKS, [documentOf(DOC_1, CLEAN)], {
          authorized: false,
        }),
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
    expect(evaluateGraphCheck).not.toHaveBeenCalled();
  });

  it("fails a graph-only collection that is no longer readable, not vacuously", async () => {
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
    expect(evaluateGraphCheck).not.toHaveBeenCalled();
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
    const finding = createFinding(
      "REQUIRED_SECTION_MISSING",
      { kind: "document", documentId: DOC_1 },
      DETAILS_SECTION
    );
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

  /**
   * Builds a reader of three clean STRUCTURE documents.
   *
   * @returns the reader.
   */
  const threeDocuments = () =>
    fakeReader(
      STRUCTURE,
      snapshotRead([
        collectionOf(STRUCTURE, [
          documentOf(DOC_1, CLEAN),
          documentOf(DOC_2, CLEAN),
          documentOf(DOC_3, CLEAN),
        ]),
      ])
    );

  /**
   * Lets every unit record its document, and the first unit schedule a
   * macrotask that records its own mark and then runs the given step.
   *
   * @param marks - the marks to record into.
   * @param step - what the macrotask does after recording.
   */
  function scheduleDuringFirstUnit(marks: string[], step = () => {}) {
    const spy = vi.mocked(evaluateDocumentRules);
    const actual = spy.getMockImplementation() as typeof evaluateDocumentRules;
    spy.mockImplementation((input) => {
      marks.push(input.documentId);
      if (marks.length === 1) {
        setImmediate(() => {
          marks.push("callback");
          step();
        });
      }
      return actual(input);
    });
  }

  it("yields to the event loop between units", async () => {
    const marks: string[] = [];
    scheduleDuringFirstUnit(marks);

    await resultOf(threeDocuments(), STRUCTURE);

    expect(marks).toEqual([DOC_1, "callback", DOC_2, DOC_3]);
  });

  it("stops when the margin is crossed while it yields", async () => {
    scheduleDuringFirstUnit([], () => {
      now = PAST_MARGIN;
    });

    await expect(resultOf(threeDocuments(), STRUCTURE)).resolves.toStrictEqual({
      state: "incomplete",
      complete: false,
      clean: false,
      errors: [],
      warnings: [],
      systemFailures: [failure("VALIDATION_TIMEOUT", cs(STRUCTURE))],
      scope: {
        kind: "collection",
        collectionId: STRUCTURE,
        evaluatedDocumentCount: 1,
        evaluatedLinkCount: 0,
        completedChecks: [],
      },
      policies: [identityOf(STRUCTURE)],
    });
    expect(evaluateDocumentRules).toHaveBeenCalledTimes(1);
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

  it("lists and evaluates units in the AD-11 order", async () => {
    const snapshot = snapshotRead([
      collectionOf(STRUCTURE, [documentOf(DOC_3, CLEAN)]),
      collectionOf(HIERARCHY, [], { authorized: false }),
      collectionOf(
        ALL_CHECKS,
        [
          withParent(documentOf(DOC_1, CLEAN)),
          withParent(documentOf(DOC_2, CLEAN)),
        ],
        graphOf([DOC_1, DOC_2], LINKED_INDEXES)
      ),
      collectionOf(ALL_CHECKS_2, [], graphOf([], LINKED_INDEXES)),
    ]);
    if (!snapshot.ok) {
      throw new Error("Expected a snapshot");
    }

    const units = wikiUnits(snapshot.snapshot, (collectionId) => {
      const entry = policySet.entries.find(
        (candidate) => candidate.collectionId === collectionId
      );
      if (entry?.status !== "valid") {
        throw new Error("Expected a valid entry");
      }
      return requiredChecks(entry.policy.rules);
    });

    expect(
      units.map(({ collection, check, document }) => [
        collection.collectionId,
        check,
        document?.documentId,
      ])
    ).toEqual([
      [STRUCTURE, "documents", DOC_3],
      [ALL_CHECKS, "documents", DOC_1],
      [ALL_CHECKS, "documents", DOC_2],
      [ALL_CHECKS_2, "documents", undefined],
      [HIERARCHY, "hierarchy", undefined],
      [ALL_CHECKS, "hierarchy", undefined],
      [ALL_CHECKS, "global_index", undefined],
      [ALL_CHECKS_2, "hierarchy", undefined],
      [ALL_CHECKS_2, "global_index", undefined],
    ]);

    const result = await resultOf(fakeReader(null, snapshot));

    const documentCalls = vi.mocked(evaluateDocumentRules).mock;
    const graphCalls = vi.mocked(evaluateGraphCheck).mock;
    expect(documentCalls.calls.map(([{ documentId }]) => documentId)).toEqual([
      DOC_3,
      DOC_1,
      DOC_2,
    ]);
    expect(
      graphCalls.calls.map(([{ check, documents }]) => [
        check,
        documents.map(({ documentId }) => documentId),
      ])
    ).toEqual([
      ["hierarchy", [DOC_1, DOC_2]],
      ["global_index", [DOC_1, DOC_2]],
      ["hierarchy", []],
      ["global_index", []],
    ]);
    expect(Math.max(...documentCalls.invocationCallOrder)).toBeLessThan(
      Math.min(...graphCalls.invocationCallOrder)
    );
    expect(result).toMatchObject({
      state: "incomplete",
      systemFailures: [failure("VALIDATION_RUNTIME_FAILED", cs(HIERARCHY))],
      scope: {
        collections: [
          {
            collectionId: STRUCTURE,
            evaluatedDocumentCount: 1,
            completedChecks: ["documents"],
          },
          zeroEntry(HIERARCHY),
          {
            collectionId: ALL_CHECKS,
            evaluatedDocumentCount: 2,
            completedChecks: ["documents", "hierarchy", "global_index"],
          },
          {
            collectionId: ALL_CHECKS_2,
            evaluatedDocumentCount: 0,
            completedChecks: ["documents", "hierarchy", "global_index"],
          },
        ],
      },
    });
  });

  it("orders graph Findings by their collection", async () => {
    const reader = fakeReader(
      null,
      snapshotRead([
        collectionOf(
          ALL_CHECKS,
          [withParent(documentOf(DOC_3, CLEAN), { state: "unresolved" })],
          graphOf([DOC_3], LINKED_INDEXES)
        ),
        collectionOf(
          ALL_CHECKS_2,
          [withParent(documentOf(DOC_1, DEFECTIVE))],
          graphOf([DOC_1], LINKED_INDEXES)
        ),
      ])
    );

    const result = await resultOf(reader);

    expect(result.state).toBe("complete");
    expect(result.errors).toEqual([
      createFinding("PARENT_DOCUMENT_UNRESOLVED", {
        kind: "relationship",
        documentId: DOC_3,
        relationshipKind: "parent",
      }),
      createFinding(
        "REQUIRED_SECTION_MISSING",
        { kind: "document", documentId: DOC_1 },
        DETAILS_SECTION
      ),
    ]);
  });

  it("rejects a snapshot collection outside the policy set", async () => {
    const reader = fakeReader(
      null,
      snapshotRead([collectionOf(UNCONFIGURED, [])])
    );

    await expect(run(reader)).rejects.toThrow("Unexpected snapshot collection");
  });
});

describe("Finding detail", () => {
  it.each([
    ["a collection scope", ALL_CHECKS],
    ["the default scope", undefined],
  ])(
    "names each missing item in configured order in %s",
    async (_name, collectionId) => {
      const reader = fakeReader(
        collectionId ?? null,
        snapshotRead([
          collectionOf(
            ALL_CHECKS,
            [withParent(documentOf(DOC_1, DEFECTIVE))],
            graphOf([DOC_1], {
              surface: { documentId: DOC_1, links: [] },
              indexes: LINKED_INDEXES.indexes,
            })
          ),
        ])
      );

      const result = await resultOf(reader, collectionId);

      expect(result.state).toBe("complete");
      // The policy configures DOC_3 before DOC_2, the reverse of sorted order.
      expect(result.errors.map(({ code, detail }) => [code, detail])).toEqual([
        ["REQUIRED_SECTION_MISSING", DETAILS_SECTION],
        [
          "GLOBAL_INDEX_LINK_MISSING",
          { kind: "global_index", documentId: DOC_3, urlId: "UrlIdOfDoc3" },
        ],
        [
          "GLOBAL_INDEX_LINK_MISSING",
          { kind: "global_index", documentId: DOC_2, urlId: "UrlIdOfDoc2" },
        ],
      ]);
      for (const spied of [evaluateDocumentRules, evaluateGraphCheck]) {
        const { calls } = vi.mocked(spied).mock;
        expect(calls.length).toBeGreaterThan(0);
        for (const [input] of calls) {
          expect(input.detailVisible).toBe(true);
        }
      }
    }
  );
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

describe("snapshot failure with a readable sentinel", () => {
  it.each([
    [
      "the floor refused a batch",
      () => failedRead(new DeadlineFloorError(), [INVALID]),
      "VALIDATION_TIMEOUT",
    ],
    [
      "the deadline expired during the read",
      () => {
        now = LINT_WIKI_DEADLINE_MS;
        return failedRead(new Error("raw detail"), [INVALID]);
      },
      "VALIDATION_TIMEOUT",
    ],
    [
      "a query failed",
      () => failedRead(new Error("raw detail"), [INVALID]),
      "VALIDATION_RUNTIME_FAILED",
    ],
    [
      "a resource limit was exceeded",
      () => failedRead(new WikiResourceLimitError(), [INVALID]),
      "VALIDATION_RESOURCE_LIMIT_EXCEEDED",
    ],
  ] as const)("keeps the sentinel when %s", async (_name, read, code) => {
    const reader = fakeReader(null, async () => read());

    await expect(resultOf(reader)).resolves.toStrictEqual({
      state: "failed",
      complete: false,
      clean: false,
      errors: [],
      warnings: [],
      systemFailures: [
        failure("POLICY_CONFIGURATION_INVALID", cs(INVALID)),
        failure(code, { kind: "scope", scopeKind: "configured_collections" }),
      ],
      scope: {
        kind: "configured_collections",
        collections: [zeroEntry(INVALID)],
      },
      policies: [identityOf(INVALID)],
    });
  });
});

describe("resource limit", () => {
  it("fails a collection with one run-wide System Failure", async () => {
    const reader = fakeReader(
      STRUCTURE,
      failedRead(new WikiResourceLimitError())
    );

    await expect(resultOf(reader, STRUCTURE)).resolves.toStrictEqual({
      state: "failed",
      complete: false,
      clean: false,
      errors: [],
      warnings: [],
      systemFailures: [
        failure("VALIDATION_RESOURCE_LIMIT_EXCEEDED", cs(STRUCTURE)),
      ],
      scope: { kind: "collection", ...zeroEntry(STRUCTURE) },
      policies: [identityOf(STRUCTURE)],
    });
  });

  it("takes precedence over an expired deadline", async () => {
    const reader = fakeReader(STRUCTURE, async () => {
      now = LINT_WIKI_DEADLINE_MS;
      return failedRead(new WikiResourceLimitError());
    });

    await expect(resultOf(reader, STRUCTURE)).resolves.toMatchObject({
      state: "failed",
      systemFailures: [
        failure("VALIDATION_RESOURCE_LIMIT_EXCEEDED", cs(STRUCTURE)),
      ],
    });
  });
});

describe("stop margin", () => {
  /**
   * Builds the MIXED collection: DOC_1 misses a section, DOC_2 and DOC_3 are
   * clean, and its hierarchy is authorized.
   *
   * @returns the collection.
   */
  const mixedCollection = () =>
    collectionOf(
      MIXED,
      [
        withParent(documentOf(DOC_1, DEFECTIVE)),
        withParent(documentOf(DOC_2, CLEAN)),
        withParent(documentOf(DOC_3, CLEAN)),
      ],
      graphOf([DOC_1, DOC_2, DOC_3])
    );

  const missingDetails = (documentId: string) =>
    createFinding(
      "REQUIRED_SECTION_MISSING",
      { kind: "document", documentId },
      DETAILS_SECTION
    );

  const configuredTimeout = failure("VALIDATION_TIMEOUT", {
    kind: "scope",
    scopeKind: "configured_collections",
  });

  it("keeps the finished document units when it stops mid-documents", async () => {
    crossMarginDuring(evaluateDocumentRules, 2);
    const reader = fakeReader(MIXED, snapshotRead([mixedCollection()]));

    await expect(resultOf(reader, MIXED)).resolves.toStrictEqual({
      state: "incomplete",
      complete: false,
      clean: false,
      errors: [missingDetails(DOC_1)],
      warnings: [],
      systemFailures: [failure("VALIDATION_TIMEOUT", cs(MIXED))],
      scope: {
        kind: "collection",
        collectionId: MIXED,
        evaluatedDocumentCount: 2,
        evaluatedLinkCount: 0,
        completedChecks: [],
      },
      policies: [identityOf(MIXED)],
    });
    expect(evaluateDocumentRules).toHaveBeenCalledTimes(2);
    expect(evaluateGraphCheck).not.toHaveBeenCalled();
  });

  it.each([
    ["exactly the margin", LINT_WIKI_STOP_MARGIN_MS, 2, "complete"],
    ["one millisecond less", LINT_WIKI_STOP_MARGIN_MS - 1, 1, "incomplete"],
  ] as const)(
    "starts the next unit only when %s remains",
    async (_name, remainingMs, calls, state) => {
      crossMarginDuring(evaluateDocumentRules, 1, remainingMs);
      const reader = fakeReader(
        STRUCTURE,
        snapshotRead([
          collectionOf(STRUCTURE, [
            documentOf(DOC_1, CLEAN),
            documentOf(DOC_2, CLEAN),
          ]),
        ])
      );

      await expect(resultOf(reader, STRUCTURE)).resolves.toMatchObject({
        state,
      });
      expect(evaluateDocumentRules).toHaveBeenCalledTimes(calls);
    }
  );

  it("fails with only the timeout when it stops before the first unit", async () => {
    const reader = fakeReader(MIXED, async () => {
      now = PAST_MARGIN;
      return snapshotRead([mixedCollection()]);
    });

    await expect(resultOf(reader, MIXED)).resolves.toStrictEqual({
      state: "failed",
      complete: false,
      clean: false,
      errors: [],
      warnings: [],
      systemFailures: [failure("VALIDATION_TIMEOUT", cs(MIXED))],
      scope: { kind: "collection", ...zeroEntry(MIXED) },
      policies: [identityOf(MIXED)],
    });
    expect(evaluateDocumentRules).not.toHaveBeenCalled();
  });

  it("lists the collection with zero counts when the default scope stops before the first unit", async () => {
    const reader = fakeReader(null, async () => {
      now = PAST_MARGIN;
      return snapshotRead([mixedCollection()]);
    });

    await expect(resultOf(reader)).resolves.toStrictEqual({
      state: "failed",
      complete: false,
      clean: false,
      errors: [],
      warnings: [],
      systemFailures: [configuredTimeout],
      scope: {
        kind: "configured_collections",
        collections: [zeroEntry(MIXED)],
      },
      policies: [identityOf(MIXED)],
    });
  });

  it("keeps a finished failed unit and the next unit's Findings", async () => {
    crossMarginDuring(evaluateDocumentRules, 1);
    const reader = fakeReader(
      MIXED,
      snapshotRead([
        collectionOf(
          MIXED,
          [
            { documentId: DOC_1, content: "unavailable", parent: NONE },
            withParent(documentOf(DOC_2, DEFECTIVE)),
          ],
          graphOf([DOC_1, DOC_2])
        ),
      ])
    );

    await expect(resultOf(reader, MIXED)).resolves.toStrictEqual({
      state: "incomplete",
      complete: false,
      clean: false,
      errors: [missingDetails(DOC_2)],
      warnings: [],
      systemFailures: [
        failure("VALIDATION_RUNTIME_FAILED", ds(DOC_1, MIXED)),
        failure("VALIDATION_TIMEOUT", cs(MIXED)),
      ],
      scope: {
        kind: "collection",
        collectionId: MIXED,
        evaluatedDocumentCount: 1,
        evaluatedLinkCount: 0,
        completedChecks: [],
      },
      policies: [identityOf(MIXED)],
    });
    expect(evaluateGraphCheck).not.toHaveBeenCalled();
  });

  it("adds no failure for an unreached check of an unauthorized graph", async () => {
    crossMarginDuring(evaluateDocumentRules, 1);
    const reader = fakeReader(
      MIXED,
      snapshotRead([
        collectionOf(MIXED, [documentOf(DOC_1, CLEAN)], { authorized: false }),
      ])
    );

    await expect(resultOf(reader, MIXED)).resolves.toStrictEqual({
      state: "incomplete",
      complete: false,
      clean: false,
      errors: [],
      warnings: [],
      systemFailures: [failure("VALIDATION_TIMEOUT", cs(MIXED))],
      scope: {
        kind: "collection",
        collectionId: MIXED,
        evaluatedDocumentCount: 1,
        evaluatedLinkCount: 0,
        completedChecks: ["documents"],
      },
      policies: [identityOf(MIXED)],
    });
  });

  it("does not list an unreached vacuous check", async () => {
    crossMarginDuring(evaluateDocumentRules, 1);
    const reader = fakeReader(
      null,
      snapshotRead([
        collectionOf(STRUCTURE, [documentOf(DOC_3, CLEAN)]),
        collectionOf(HIERARCHY, [], graphOf([])),
      ])
    );

    await expect(resultOf(reader)).resolves.toStrictEqual({
      state: "incomplete",
      complete: false,
      clean: false,
      errors: [],
      warnings: [],
      systemFailures: [configuredTimeout],
      scope: {
        kind: "configured_collections",
        collections: [
          {
            collectionId: STRUCTURE,
            evaluatedDocumentCount: 1,
            evaluatedLinkCount: 0,
            completedChecks: ["documents"],
          },
          zeroEntry(HIERARCHY),
        ],
      },
      policies: [identityOf(STRUCTURE), identityOf(HIERARCHY)],
    });
    expect(evaluateGraphCheck).not.toHaveBeenCalled();
  });

  it("lists the finished checks when it stops before the global index", async () => {
    crossMarginDuring(evaluateGraphCheck, 1);
    const reader = fakeReader(
      ALL_CHECKS,
      snapshotRead([
        collectionOf(
          ALL_CHECKS,
          [
            withParent(documentOf(DOC_1, CLEAN)),
            withParent(documentOf(DOC_2, CLEAN)),
            withParent(documentOf(DOC_3, CLEAN)),
          ],
          graphOf([DOC_1, DOC_2, DOC_3], LINKED_INDEXES)
        ),
      ])
    );

    await expect(resultOf(reader, ALL_CHECKS)).resolves.toStrictEqual({
      state: "incomplete",
      complete: false,
      clean: false,
      errors: [],
      warnings: [],
      systemFailures: [failure("VALIDATION_TIMEOUT", cs(ALL_CHECKS))],
      scope: {
        kind: "collection",
        collectionId: ALL_CHECKS,
        evaluatedDocumentCount: 3,
        evaluatedLinkCount: 0,
        completedChecks: ["documents", "hierarchy"],
      },
      policies: [identityOf(ALL_CHECKS)],
    });
    expect(
      vi.mocked(evaluateGraphCheck).mock.calls.map(([{ check }]) => check)
    ).toEqual(["hierarchy"]);
  });

  it("keeps a readable sentinel next to the run-wide timeout", async () => {
    crossMarginDuring(evaluateDocumentRules, 1);
    const reader = fakeReader(
      null,
      snapshotRead(
        [
          collectionOf(STRUCTURE, [
            documentOf(DOC_1, DEFECTIVE),
            documentOf(DOC_2, CLEAN),
          ]),
        ],
        [INVALID]
      )
    );

    const result = await resultOf(reader);

    expect(result).toMatchObject({
      state: "incomplete",
      complete: false,
      clean: false,
      warnings: [],
      systemFailures: [
        failure("POLICY_CONFIGURATION_INVALID", cs(INVALID)),
        configuredTimeout,
      ],
      scope: {
        kind: "configured_collections",
        collections: [
          {
            collectionId: STRUCTURE,
            evaluatedDocumentCount: 1,
            evaluatedLinkCount: 0,
            completedChecks: [],
          },
          zeroEntry(INVALID),
        ],
      },
      policies: [identityOf(STRUCTURE), identityOf(INVALID)],
    });
    expect(
      result.errors.map(({ code, location }) => [code, location.documentId])
    ).toEqual([
      ["HEADING_LEVEL_NOT_ALLOWED", DOC_1],
      ["REQUIRED_SECTION_MISSING", DOC_1],
    ]);
  });
});

describe("admission", () => {
  const configuredRejection = {
    state: "failed",
    complete: false,
    clean: false,
    errors: [],
    warnings: [],
    systemFailures: [
      failure("VALIDATION_RESOURCE_LIMIT_EXCEEDED", {
        kind: "scope",
        scopeKind: "configured_collections",
      }),
    ],
    scope: { kind: "configured_collections", collections: [] },
    policies: [],
  };

  it("admits a scoped request after its lookup and before its snapshot", async () => {
    const admit = vi.fn(() => true);
    const reader = fakeReader(
      STRUCTURE,
      snapshotRead([collectionOf(STRUCTURE, [documentOf(DOC_1, CLEAN)])])
    );

    await expect(
      run(reader, STRUCTURE, policySet, admit)
    ).resolves.toMatchObject({ result: { state: "complete" } });
    expect(admit).toHaveBeenCalledTimes(1);
    const [lookup] = reader.authorizeLintCollection.mock.invocationCallOrder;
    const [admission] = admit.mock.invocationCallOrder;
    const [snapshot] = reader.readWikiSnapshot.mock.invocationCallOrder;
    expect(lookup).toBeLessThan(admission);
    expect(admission).toBeLessThan(snapshot);
  });

  it("admits a default request before its snapshot", async () => {
    const admit = vi.fn(() => true);
    const reader = fakeReader(null, snapshotRead([], [INVALID]));

    await run(reader, undefined, policySet, admit);

    expect(admit).toHaveBeenCalledTimes(1);
    expect(admit.mock.invocationCallOrder[0]).toBeLessThan(
      reader.readWikiSnapshot.mock.invocationCallOrder[0]
    );
  });

  it("rejects a scoped request while the slot is held", async () => {
    const reader = fakeReader(STRUCTURE);

    await expect(
      run(reader, STRUCTURE, policySet, () => false)
    ).resolves.toStrictEqual({
      kind: "result",
      result: {
        state: "failed",
        complete: false,
        clean: false,
        errors: [],
        warnings: [],
        systemFailures: [
          failure("VALIDATION_RESOURCE_LIMIT_EXCEEDED", cs(STRUCTURE)),
        ],
        scope: { kind: "collection", ...zeroEntry(STRUCTURE) },
        policies: [identityOf(STRUCTURE)],
      },
    });
    expect(reader.readWikiSnapshot).not.toHaveBeenCalled();
  });

  it("rejects a default request without its sentinels while the slot is held", async () => {
    const reader = fakeReader(null, snapshotRead([], [INVALID]));

    await expect(
      run(reader, undefined, policySet, () => false)
    ).resolves.toStrictEqual({ kind: "result", result: configuredRejection });
    expect(reader.readWikiSnapshot).not.toHaveBeenCalled();
  });

  it.each([
    ["a denied collection", fakeReader(null), STRUCTURE, policySet],
    ["a failed lookup", fakeReader(new Error("raw")), STRUCTURE, policySet],
    ["a sentinel collection", fakeReader(INVALID), INVALID, policySet],
    [
      "an unconfigured collection",
      fakeReader(UNCONFIGURED),
      UNCONFIGURED,
      policySet,
    ],
    ["an empty policy set", fakeReader(null), undefined, policySetFor({})],
  ])(
    "answers %s without admission while the slot is held",
    async (_name, reader, collectionId, set) => {
      const admit = vi.fn(() => false);

      const held = await run(reader, collectionId, set, admit);

      expect(admit).not.toHaveBeenCalled();
      expect(held).toStrictEqual(await run(reader, collectionId, set));
      expect(reader.readWikiSnapshot).not.toHaveBeenCalled();
    }
  );
});

describe("determinism", () => {
  it("returns identical results for repeated runs", async () => {
    const scenarios: (() => Promise<LintWikiOutcome>)[] = [
      // Stop margin.
      () => {
        crossMarginDuring(evaluateDocumentRules, 2);
        return run(
          fakeReader(
            MIXED,
            snapshotRead([
              collectionOf(
                MIXED,
                [
                  withParent(documentOf(DOC_1, DEFECTIVE)),
                  withParent(documentOf(DOC_2, CLEAN)),
                  withParent(documentOf(DOC_3, CLEAN)),
                ],
                graphOf([DOC_1, DOC_2, DOC_3])
              ),
            ])
          ),
          MIXED
        );
      },
      // Deadline expiry after the snapshot.
      () =>
        run(
          fakeReader(null, async () => {
            now = LINT_WIKI_DEADLINE_MS;
            return snapshotRead([], [INVALID]);
          })
        ),
      // Resource limit.
      () =>
        run(
          fakeReader(null, failedRead(new WikiResourceLimitError(), [INVALID]))
        ),
      // Isolated rule failure.
      () => {
        vi.mocked(evaluateDocumentRules).mockReturnValueOnce({
          findings: [
            {
              issue: createFinding(
                "REQUIRED_SECTION_MISSING",
                { kind: "document", documentId: DOC_1 },
                DETAILS_SECTION
              ),
              ordinal: 0,
            },
          ],
          failedKinds: ["allowed_heading_levels"],
        });
        return run(
          fakeReader(
            STRUCTURE,
            snapshotRead([
              collectionOf(STRUCTURE, [
                documentOf(DOC_1, DEFECTIVE),
                documentOf(DOC_2, CLEAN),
              ]),
            ])
          ),
          STRUCTURE
        );
      },
      // Unavailable document content.
      () =>
        run(
          fakeReader(
            STRUCTURE,
            snapshotRead([
              collectionOf(STRUCTURE, [
                { documentId: DOC_1, content: "unavailable", parent: null },
                documentOf(DOC_2, DEFECTIVE),
              ]),
            ])
          ),
          STRUCTURE
        ),
      // Snapshot failure.
      () => run(fakeReader(null, failedRead(new Error("raw"), [INVALID]))),
      // Concurrent admission.
      () => run(fakeReader(STRUCTURE), STRUCTURE, policySet, () => false),
    ];

    for (const scenario of scenarios) {
      resetRun();
      const first = await scenario();
      resetRun();
      const second = await scenario();

      expect(second).toStrictEqual(first);
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
      expect(first).toMatchObject({
        kind: "result",
        result: { complete: false, clean: false },
      });
    }
  });
});
