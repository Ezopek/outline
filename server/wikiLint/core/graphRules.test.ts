import type {
  InternalLinkReference,
  RelationshipKind,
  WikiGlobalIndexInput,
  WikiParentEdge,
  WikiSnapshotDocument,
} from "./contracts";
import { evaluateGraphCheck } from "./graphRules";
import type { RuleConfig } from "./registry";
import { createFinding, ruleConfigSchema } from "./registry";

/**
 * Builds a fixture document ID that sorts by its number.
 *
 * @param n - the number.
 * @returns the lowercase UUID.
 */
const idOf = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

/**
 * Parses a rule entry through the configuration schema, as policy loading does.
 *
 * @param entry - the configured rule entry.
 * @returns the validated rule.
 */
const rule = (entry: unknown): RuleConfig => ruleConfigSchema.parse(entry);

const PARENT_RESOLVED = rule({ kind: "parent_document_resolved" });
const PARENT_COLLECTION = rule({ kind: "parent_collection_consistent" });
const IN_STRUCTURE = rule({ kind: "published_documents_in_structure" });
const ACYCLIC = rule({ kind: "hierarchy_acyclic" });
const HIERARCHY_RULES = [
  PARENT_RESOLVED,
  PARENT_COLLECTION,
  IN_STRUCTURE,
  ACYCLIC,
];

const NONE: WikiParentEdge = { state: "none" };
const UNRESOLVED: WikiParentEdge = { state: "unresolved" };

/**
 * Builds a resolved parent edge.
 *
 * @param documentId - the parent.
 * @param sameCollection - whether the parent is in the evaluated collection.
 * @returns the edge.
 */
const resolved = (
  documentId: string,
  sameCollection = true
): WikiParentEdge => ({ state: "resolved", documentId, sameCollection });

/**
 * Builds an evaluated document of an authorized graph.
 *
 * @param documentId - the document.
 * @param parent - its parent edge.
 * @returns the snapshot document.
 */
const doc = (
  documentId: string,
  parent: WikiParentEdge | null = NONE
): WikiSnapshotDocument => ({ documentId, content: null, parent });

/**
 * Evaluates the hierarchy check.
 *
 * @param documents - the evaluated documents, sorted.
 * @param options.structure - the structure IDs; every document by default.
 * @param options.rules - the policy rules; every hierarchy kind by default.
 * @returns the evaluation output.
 */
const hierarchy = (
  documents: WikiSnapshotDocument[],
  options: { structure?: string[]; rules?: RuleConfig[] } = {}
) =>
  evaluateGraphCheck({
    check: "hierarchy",
    documents,
    graph: {
      authorized: true,
      structureDocumentIds:
        options.structure ?? documents.map((d) => d.documentId),
      globalIndex: null,
    },
    rules: options.rules ?? HIERARCHY_RULES,
  });

/**
 * Builds an expected graph Finding.
 *
 * @param code - the code.
 * @param documentId - the location document.
 * @param relationshipKind - the relationship kind.
 * @param ordinal - the per-kind ordinal.
 * @returns the expected issue item.
 */
const finding = (
  code: Parameters<typeof createFinding>[0],
  documentId: string,
  relationshipKind: RelationshipKind,
  ordinal = 0
) => ({
  issue: createFinding(code, {
    kind: "relationship",
    documentId,
    relationshipKind,
  }),
  ordinal,
});

const cycleAt = (documentId: string) =>
  finding("HIERARCHY_CYCLE", documentId, "parent");

describe("hierarchy", () => {
  it("completes a valid hierarchy without Findings", () => {
    const root = idOf(1);
    const child = idOf(2);

    expect(hierarchy([doc(root), doc(child, resolved(root))])).toEqual({
      findings: [],
      complete: true,
    });
  });

  it("completes vacuously without documents", () => {
    expect(hierarchy([], { structure: [idOf(9)] })).toEqual({
      findings: [],
      complete: true,
    });
  });

  it("accepts an editorially odd but valid hierarchy", () => {
    const chain = [doc(idOf(1), resolved(idOf(99)))];
    for (let n = 2; n <= 50; n++) {
      chain.push(doc(idOf(n), resolved(idOf(n - 1))));
    }

    expect(hierarchy(chain)).toEqual({ findings: [], complete: true });
  });

  it("reports an unresolved parent", () => {
    const child = idOf(1);

    expect(hierarchy([doc(child, UNRESOLVED)])).toEqual({
      findings: [finding("PARENT_DOCUMENT_UNRESOLVED", child, "parent")],
      complete: true,
    });
  });

  it("reports a cross-collection parent only as a mismatch", () => {
    const child = idOf(1);

    expect(hierarchy([doc(child, resolved(idOf(2), false))])).toEqual({
      findings: [finding("PARENT_COLLECTION_MISMATCH", child, "parent")],
      complete: true,
    });
  });

  it("reports a published document missing from the structure", () => {
    const missing = idOf(2);

    expect(
      hierarchy([doc(idOf(1)), doc(missing)], { structure: [idOf(1)] })
    ).toEqual({
      findings: [
        finding(
          "PUBLISHED_DOCUMENT_MISSING_FROM_STRUCTURE",
          missing,
          "collection_structure"
        ),
      ],
      complete: true,
    });
  });

  it("reports several codes on one document", () => {
    const a = idOf(1);
    const b = idOf(2);
    const c = idOf(3);

    const { findings, complete } = hierarchy(
      [doc(a, resolved(b)), doc(b, resolved(a)), doc(c, UNRESOLVED)],
      { structure: [] }
    );

    expect(complete).toBe(true);
    expect(findings).toEqual(
      expect.arrayContaining([
        finding("PARENT_DOCUMENT_UNRESOLVED", c, "parent"),
        cycleAt(a),
        cycleAt(b),
        ...[a, b, c].map((id) =>
          finding(
            "PUBLISHED_DOCUMENT_MISSING_FROM_STRUCTURE",
            id,
            "collection_structure"
          )
        ),
      ])
    );
    expect(findings).toHaveLength(6);
  });

  it("reports each document on a cycle exactly once, and no tail", () => {
    // T (1) leads into A (2) <-> B (3); S (4) is its own parent; C (5) ->
    // D (6) -> E (7) -> C is a disjoint cycle; U (8) -> T is a longer tail.
    const [t, a, b, s, c, d, e, u] = [1, 2, 3, 4, 5, 6, 7, 8].map(idOf);

    const { findings, complete } = hierarchy(
      [
        doc(t, resolved(a)),
        doc(a, resolved(b)),
        doc(b, resolved(a)),
        doc(s, resolved(s)),
        doc(c, resolved(d)),
        doc(d, resolved(e)),
        doc(e, resolved(c)),
        doc(u, resolved(t)),
      ],
      { rules: [ACYCLIC] }
    );

    expect(complete).toBe(true);
    expect(findings).toEqual([a, b, s, c, d, e].map(cycleAt));
  });

  it("stops a walk at a parent that is not evaluated", () => {
    const a = idOf(1);
    const b = idOf(2);
    const draft = idOf(3);

    expect(hierarchy([doc(a, resolved(b)), doc(b, resolved(draft))])).toEqual({
      findings: [],
      complete: true,
    });
  });

  it("never follows a cross-collection edge", () => {
    const a = idOf(1);
    const b = idOf(2);

    expect(
      hierarchy([doc(a, resolved(b)), doc(b, resolved(a, false))])
    ).toEqual({
      findings: [finding("PARENT_COLLECTION_MISMATCH", b, "parent")],
      complete: true,
    });
  });

  it("runs only the enabled kinds of the check", () => {
    const a = idOf(1);
    const b = idOf(2);

    const result = hierarchy([doc(a, resolved(a)), doc(b, UNRESOLVED)], {
      structure: [a],
      rules: [
        rule({
          kind: "required_sections",
          headingLevel: 2,
          headings: ["Overview"],
        }),
        IN_STRUCTURE,
        rule({
          kind: "global_index_links",
          surfaceDocumentId: a,
          globalIndexDocumentIds: [b],
        }),
      ],
    });

    expect(result).toEqual({
      findings: [
        finding(
          "PUBLISHED_DOCUMENT_MISSING_FROM_STRUCTURE",
          b,
          "collection_structure"
        ),
      ],
      complete: true,
    });
  });

  it("isolates a rule kind that throws on a missing parent edge", () => {
    const a = idOf(1);
    const b = idOf(2);
    const c = idOf(3);

    const result = hierarchy([doc(a, UNRESOLVED), doc(b, null), doc(c)], {
      structure: [],
      rules: [ACYCLIC, PARENT_RESOLVED, IN_STRUCTURE],
    });

    expect(result).toEqual({
      findings: [
        finding("PARENT_DOCUMENT_UNRESOLVED", a, "parent"),
        ...[a, b, c].map((id) =>
          finding(
            "PUBLISHED_DOCUMENT_MISSING_FROM_STRUCTURE",
            id,
            "collection_structure"
          )
        ),
      ],
      complete: false,
    });
  });

  it("is byte-equal on repeated evaluation", () => {
    const documents = [
      doc(idOf(1), resolved(idOf(2))),
      doc(idOf(2), resolved(idOf(1))),
      doc(idOf(3), UNRESOLVED),
      doc(idOf(4), resolved(idOf(9), false)),
    ];

    expect(JSON.stringify(hierarchy(documents, { structure: [] }))).toBe(
      JSON.stringify(hierarchy(documents, { structure: [] }))
    );
  });
});

describe("global_index_links", () => {
  const SURFACE = idOf(100);
  const [I1, I2, I3, I4] = [101, 102, 103, 104].map(idOf);
  const urlIdOf = (documentId: string) => `UrlId${documentId.slice(-3)}AbC`;
  const ALL_INDEXES = [I1, I2, I3, I4].map((documentId) => ({
    documentId,
    urlId: urlIdOf(documentId),
  }));

  /**
   * Builds a recognized link reference.
   *
   * @param key - the lookup key.
   * @param keyKind - the key kind.
   * @returns the reference.
   */
  const link = (
    key: string,
    keyKind: "id" | "urlId" = "id"
  ): InternalLinkReference => ({ key, keyKind, position: null });

  /**
   * Evaluates the global-index check.
   *
   * @param globalIndex - the global-index inputs.
   * @param configured - the configured index IDs, in configured order.
   * @param detailVisible - the shell's flag, or undefined to omit it.
   * @returns the evaluation output.
   */
  const globalIndex = (
    globalIndex: WikiGlobalIndexInput | null,
    configured = [I3, I1, I4, I2],
    detailVisible?: boolean
  ) =>
    evaluateGraphCheck({
      check: "global_index",
      documents: [doc(SURFACE)],
      graph: { authorized: true, structureDocumentIds: [], globalIndex },
      rules: [
        ...HIERARCHY_RULES,
        rule({
          kind: "global_index_links",
          surfaceDocumentId: SURFACE,
          globalIndexDocumentIds: configured,
        }),
      ],
      ...(detailVisible === undefined ? {} : { detailVisible }),
    });

  const missing = (ordinal: number) =>
    finding("GLOBAL_INDEX_LINK_MISSING", SURFACE, "global_index", ordinal);

  /**
   * Builds an expected missing-link Finding that names its index.
   *
   * @param ordinal - the per-kind ordinal.
   * @param documentId - the missing index.
   * @returns the expected issue item.
   */
  const missingNamed = (ordinal: number, documentId: string) => ({
    issue: createFinding(
      "GLOBAL_INDEX_LINK_MISSING",
      {
        kind: "relationship",
        documentId: SURFACE,
        relationshipKind: "global_index",
      },
      { kind: "global_index", documentId, urlId: urlIdOf(documentId) }
    ),
    ordinal,
  });

  const UNLINKED: WikiGlobalIndexInput = {
    surface: { documentId: SURFACE, links: [] },
    indexes: ALL_INDEXES,
  };

  it("completes when the surface links each index by ID or URL identifier", () => {
    expect(
      globalIndex({
        surface: {
          documentId: SURFACE,
          links: [
            link(I1),
            link(urlIdOf(I2), "urlId"),
            link(I3),
            link(urlIdOf(I4), "urlId"),
          ],
        },
        indexes: ALL_INDEXES,
      })
    ).toEqual({ findings: [], complete: true });
  });

  it("reports each unlinked index with ordinals in configured order", () => {
    expect(
      globalIndex({
        surface: {
          documentId: SURFACE,
          links: [
            link(I2),
            link(urlIdOf(I1).toLowerCase(), "urlId"),
            link(urlIdOf(I3)),
            link(I4, "urlId"),
          ],
        },
        indexes: ALL_INDEXES,
      })
    ).toEqual({ findings: [0, 1, 2].map(missing), complete: true });
  });

  it("reports only the provable pairs when an index is unreadable", () => {
    const result = globalIndex({
      surface: { documentId: SURFACE, links: [link(I2)] },
      indexes: ALL_INDEXES.filter(({ documentId }) => documentId !== I3),
    });

    expect(result).toEqual({ findings: [0, 1].map(missing), complete: false });
    expect(JSON.stringify(result)).not.toContain(I3);
  });

  it("names each unlinked index in configured order when visible", () => {
    expect(globalIndex(UNLINKED, [I2, I1], true)).toEqual({
      findings: [missingNamed(0, I2), missingNamed(1, I1)],
      complete: true,
    });
    expect(globalIndex(UNLINKED, [I1, I2], true)).toEqual({
      findings: [missingNamed(0, I1), missingNamed(1, I2)],
      complete: true,
    });
  });

  it.each([false, undefined])(
    "names no index when detailVisible is %s, and is otherwise byte-identical",
    (detailVisible) => {
      const hidden = globalIndex(UNLINKED, [I2, I1], detailVisible);
      const shown = globalIndex(UNLINKED, [I2, I1], true);

      expect(hidden).toEqual({ findings: [0, 1].map(missing), complete: true });
      expect(JSON.stringify(hidden)).toBe(
        JSON.stringify({
          findings: shown.findings.map(({ issue, ordinal }) => {
            const { detail: _detail, ...rest } = issue;
            return { issue: rest, ordinal };
          }),
          complete: shown.complete,
        })
      );
    }
  );

  it("names only the readable index when the other configured index is unreadable", () => {
    const result = globalIndex(
      {
        surface: { documentId: SURFACE, links: [] },
        indexes: ALL_INDEXES.filter(({ documentId }) => documentId !== I1),
      },
      [I2, I1],
      true
    );

    expect(result).toEqual({
      findings: [missingNamed(0, I2)],
      complete: false,
    });
    expect(JSON.stringify(result)).not.toContain(I1);
    expect(JSON.stringify(result)).not.toContain(urlIdOf(I1));
  });

  it("reports nothing when the surface is unprovable", () => {
    expect(globalIndex({ surface: null, indexes: ALL_INDEXES })).toEqual({
      findings: [],
      complete: false,
    });
  });

  it("fails without global-index inputs", () => {
    expect(globalIndex(null)).toEqual({ findings: [], complete: false });
  });

  it("fails when the inputs name another surface", () => {
    expect(
      globalIndex({
        surface: { documentId: I1, links: [] },
        indexes: ALL_INDEXES,
      })
    ).toEqual({ findings: [], complete: false });
  });

  it("runs no global-index kind for the hierarchy check", () => {
    expect(
      evaluateGraphCheck({
        check: "hierarchy",
        documents: [],
        graph: {
          authorized: true,
          structureDocumentIds: [],
          globalIndex: null,
        },
        rules: [
          rule({
            kind: "global_index_links",
            surfaceDocumentId: SURFACE,
            globalIndexDocumentIds: [I1],
          }),
        ],
      })
    ).toEqual({ findings: [], complete: true });
  });

  it("completes vacuously when no global-index kind is enabled", () => {
    expect(
      evaluateGraphCheck({
        check: "global_index",
        documents: [doc(SURFACE, UNRESOLVED)],
        graph: {
          authorized: true,
          structureDocumentIds: [],
          globalIndex: null,
        },
        rules: HIERARCHY_RULES,
      })
    ).toEqual({ findings: [], complete: true });
  });
});
