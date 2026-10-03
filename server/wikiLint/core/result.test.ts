import type {
  CheckName,
  ConfiguredCollectionsScope,
  EvaluatedScope,
  Finding,
  IssueItem,
  PolicyIdentity,
  ScopeLocation,
  SystemFailure,
} from "./contracts";
import { WikiLintContractError } from "./contracts";
import { createFinding, createSystemFailure } from "./registry";
import { buildReadOnlyResult, deriveResultState } from "./result";

/**
 * Returns deterministic permutations of a list using a fixed-seed generator.
 *
 * @param list - the list to permute.
 * @param count - the number of permutations.
 * @returns the permutations.
 */
function permutations<T>(list: readonly T[], count: number): T[][] {
  let seed = 0x5eed1234;
  const next = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, () => {
    const copy = [...list];
    for (let index = copy.length - 1; index > 0; index--) {
      const swap = Math.floor(next() * (index + 1));
      [copy[index], copy[swap]] = [copy[swap], copy[index]];
    }
    return copy;
  });
}

const documentId = "00000000-0000-4000-8000-000000000001";
const otherDocumentId = "00000000-0000-4000-8000-000000000002";
const collectionId = "00000000-0000-4000-8000-000000000011";
const otherCollectionId = "00000000-0000-4000-8000-000000000012";
const fingerprintA = `sha256:${"a".repeat(64)}`;
const fingerprintB = `sha256:${"b".repeat(64)}`;

const documentScope: EvaluatedScope = {
  kind: "document",
  documentId,
  collectionId,
  evaluatedDocumentCount: 1,
  evaluatedLinkCount: 0,
};

const zeroDocumentScope: EvaluatedScope = {
  ...documentScope,
  evaluatedDocumentCount: 0,
};

const validPolicy: PolicyIdentity = {
  collectionId,
  status: "valid",
  policySchemaVersion: 1,
  policyFingerprint: fingerprintA,
};

const error: IssueItem<Finding> = {
  issue: createFinding("HEADING_LEVEL_NOT_ALLOWED", {
    kind: "text",
    documentId,
    line: 3,
    column: 1,
    path: [2],
  }),
  ordinal: 0,
};

const warning: IssueItem<Finding> = {
  issue: createFinding("DISCOURAGED_MARKDOWN_STRUCTURE", {
    kind: "text",
    documentId,
    line: 5,
    column: 1,
    path: [4],
  }),
  ordinal: 0,
};

const missingSection = createFinding("REQUIRED_SECTION_MISSING", {
  kind: "document",
  documentId,
});

const sectionDetail = { kind: "section", heading: "Summary", headingLevel: 2 };

const runtimeFailure: IssueItem<SystemFailure> = {
  issue: createSystemFailure("VALIDATION_RUNTIME_FAILED", {
    kind: "scope",
    scopeKind: "document",
    documentId,
    collectionId,
  }),
};

/**
 * Builds a document-scope result whose document count is its completed units,
 * so failed results carry zero counts.
 *
 * @param items - the issues.
 * @param completedUnits - the completed atomic units.
 * @param requiredUnits - the required atomic units.
 * @returns the result.
 */
const documentResult = (
  items: IssueItem[],
  completedUnits: number,
  requiredUnits = 1
) =>
  buildReadOnlyResult({
    requiredUnits,
    completedUnits,
    items,
    scope: { ...documentScope, evaluatedDocumentCount: completedUnits },
    policies: [validPolicy],
  });

describe("deriveResultState", () => {
  it.each([
    [1, 1, 0, "complete"],
    [0, 0, 0, "complete"],
    [2, 1, 1, "incomplete"],
    [2, 2, 1, "incomplete"],
    [2, 0, 3, "failed"],
  ] as const)(
    "required=%i completed=%i failures=%i is %s",
    (requiredUnits, completedUnits, systemFailureCount, state) => {
      expect(
        deriveResultState({ requiredUnits, completedUnits, systemFailureCount })
      ).toBe(state);
    }
  );

  it.each([
    ["completed below required without a System Failure", 2, 1, 0],
    ["completed above required", 1, 2, 1],
    ["a negative count", -1, 0, 1],
    ["a fractional count", 1.5, 1, 1],
  ])(
    "rejects %s",
    (_name, requiredUnits, completedUnits, systemFailureCount) => {
      expect(() =>
        deriveResultState({ requiredUnits, completedUnits, systemFailureCount })
      ).toThrow(WikiLintContractError);
    }
  );
});

describe("buildReadOnlyResult", () => {
  it("reports a warning-only complete result as clean", () => {
    const result = documentResult([warning], 1);

    expect(result.state).toBe("complete");
    expect(result.complete).toBe(true);
    expect(result.clean).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([warning.issue]);
    expect(result.systemFailures).toEqual([]);
    expect("reason" in result).toBe(false);
  });

  it("reports a complete result with Errors as not clean", () => {
    const result = documentResult([error, warning], 1);

    expect(result.state).toBe("complete");
    expect(result.complete).toBe(true);
    expect(result.clean).toBe(false);
    expect(result.errors).toEqual([error.issue]);
  });

  it("reports an incomplete result", () => {
    const result = buildReadOnlyResult({
      requiredUnits: 2,
      completedUnits: 1,
      items: [runtimeFailure, error],
      scope: {
        kind: "collection",
        collectionId,
        evaluatedDocumentCount: 1,
        evaluatedLinkCount: 0,
        completedChecks: [],
      },
      policies: [validPolicy],
    });

    expect(result.state).toBe("incomplete");
    expect(result.complete).toBe(false);
    expect(result.clean).toBe(false);
    expect("reason" in result).toBe(false);
  });

  it("retains Findings in a failed result", () => {
    const result = documentResult([warning, runtimeFailure, error], 0);

    expect(result.state).toBe("failed");
    expect(result.complete).toBe(false);
    expect(result.clean).toBe(false);
    expect(result.errors).toEqual([error.issue]);
    expect(result.warnings).toEqual([warning.issue]);
    expect(result.systemFailures).toEqual([runtimeFailure.issue]);
    expect(result.scope).toEqual(zeroDocumentScope);
    expect("reason" in result).toBe(false);
  });

  it("never reports a failed result without Errors as clean", () => {
    const result = documentResult(
      [
        warning,
        {
          issue: createSystemFailure("VALIDATION_TIMEOUT", {
            kind: "scope",
            scopeKind: "document",
            documentId,
          }),
        },
      ],
      0
    );

    expect(result.state).toBe("failed");
    expect(result.complete).toBe(false);
    expect(result.clean).toBe(false);
  });

  it("retains Findings in a failed wiki result with zero counts", () => {
    const result = buildReadOnlyResult({
      requiredUnits: 2,
      completedUnits: 0,
      items: [
        error,
        {
          issue: createSystemFailure("VALIDATION_TIMEOUT", {
            kind: "scope",
            scopeKind: "collection",
            collectionId,
          }),
        },
      ],
      scope: {
        kind: "collection",
        collectionId,
        evaluatedDocumentCount: 0,
        evaluatedLinkCount: 0,
        completedChecks: [],
      },
      policies: [validPolicy],
    });

    expect(result.state).toBe("failed");
    expect(result.errors).toEqual([error.issue]);
    expect(result.systemFailures.map((failure) => failure.code)).toEqual([
      "VALIDATION_TIMEOUT",
    ]);
  });

  it("reports not_evaluated with its reason and nothing else", () => {
    const result = buildReadOnlyResult({
      notEvaluated: true,
      items: [],
      scope: zeroDocumentScope,
      policies: [],
    });

    expect(result).toEqual({
      state: "not_evaluated",
      complete: false,
      clean: false,
      errors: [],
      warnings: [],
      systemFailures: [],
      scope: zeroDocumentScope,
      policies: [],
      reason: "POLICY_NOT_CONFIGURED",
    });
    expect(Object.keys(result)).toEqual([
      "state",
      "complete",
      "clean",
      "errors",
      "warnings",
      "systemFailures",
      "scope",
      "policies",
      "reason",
    ]);
  });

  it("rejects a not_evaluated result with issues or policies", () => {
    expect(() =>
      buildReadOnlyResult({
        notEvaluated: true,
        items: [warning],
        scope: zeroDocumentScope,
        policies: [],
      })
    ).toThrow(WikiLintContractError);
    expect(() =>
      buildReadOnlyResult({
        notEvaluated: true,
        items: [],
        scope: zeroDocumentScope,
        policies: [validPolicy],
      })
    ).toThrow(WikiLintContractError);
  });

  it.each([
    ["document", zeroDocumentScope],
    [
      "collection",
      {
        kind: "collection",
        collectionId,
        evaluatedDocumentCount: 0,
        evaluatedLinkCount: 0,
        completedChecks: [],
      },
    ],
    [
      "configured_collections",
      { kind: "configured_collections", collections: [] },
    ],
  ])("accepts a zero-count %s scope as not_evaluated", (_name, scope) => {
    expect(
      buildReadOnlyResult({
        notEvaluated: true,
        items: [],
        scope: scope as EvaluatedScope,
        policies: [],
      }).scope
    ).toEqual(scope);
  });

  it.each([
    ["a document count", documentScope],
    ["a link count", { ...zeroDocumentScope, evaluatedLinkCount: 1 }],
    [
      "a completed check",
      {
        kind: "collection",
        collectionId,
        evaluatedDocumentCount: 0,
        evaluatedLinkCount: 0,
        completedChecks: ["hierarchy"],
      },
    ],
    [
      "a collection count",
      {
        kind: "collection",
        collectionId,
        evaluatedDocumentCount: 2,
        evaluatedLinkCount: 0,
        completedChecks: [],
      },
    ],
    [
      "a configured collection",
      {
        kind: "configured_collections",
        collections: [
          {
            collectionId,
            evaluatedDocumentCount: 0,
            evaluatedLinkCount: 0,
            completedChecks: [],
          },
        ],
      },
    ],
  ])("rejects a not_evaluated scope with %s", (_name, scope) => {
    expect(() =>
      buildReadOnlyResult({
        notEvaluated: true,
        items: [],
        scope: scope as EvaluatedScope,
        policies: [],
      })
    ).toThrow(WikiLintContractError);
  });

  it("rejects impossible algebra", () => {
    expect(() => documentResult([], 0)).toThrow(WikiLintContractError);
  });

  it.each([
    [
      "a startup-only code",
      {
        code: "POLICY_CONFIGURATION_MALFORMED",
        message: "The lint configuration is malformed.",
        location: { kind: "scope", scopeKind: "document", documentId },
      },
    ],
    [
      "a lint_wiki-only code",
      {
        ...createSystemFailure("VALIDATION_RESOURCE_LIMIT_EXCEEDED", {
          kind: "scope",
          scopeKind: "collection",
          collectionId,
        }),
      },
    ],
    [
      "a wiki-surface code",
      createFinding("HIERARCHY_CYCLE", {
        kind: "relationship",
        documentId,
        relationshipKind: "parent",
      }),
    ],
    [
      "a mismatched location kind",
      { ...error.issue, location: { kind: "document", documentId } },
    ],
    [
      "a code with a foreign location kind",
      { ...error.issue, code: "REQUIRED_SECTION_MISSING" },
    ],
    ["a foreign message", { ...error.issue, message: "Something else." }],
    ["a severity override", { ...error.issue, severity: "warning" }],
    ["an extra key", { ...error.issue, title: "Summary" }],
    [
      "a severity on a System Failure",
      { ...runtimeFailure.issue, severity: "error" },
    ],
    [
      "a document scope location without a document",
      {
        ...runtimeFailure.issue,
        location: { kind: "scope", scopeKind: "document", collectionId },
      },
    ],
    ["an unknown code", { ...error.issue, code: "NOT_A_CODE" }],
    ["a detail on another code", { ...error.issue, detail: sectionDetail }],
    [
      "a detail of another kind",
      { ...missingSection, detail: { kind: "metadata_field", field: "Owner" } },
    ],
    [
      "an extra detail key",
      { ...missingSection, detail: { ...sectionDetail, pattern: ".*" } },
    ],
    ["an undefined detail key", { ...missingSection, detail: undefined }],
    [
      "a detail on a System Failure",
      { ...runtimeFailure.issue, detail: sectionDetail },
    ],
  ])("rejects %s in a document scope", (_name, issue) => {
    expect(() =>
      documentResult([{ issue: issue as Finding }, runtimeFailure], 0)
    ).toThrow(WikiLintContractError);
  });

  it.each<[EvaluatedScope, ScopeLocation]>([
    [
      {
        kind: "collection",
        collectionId,
        evaluatedDocumentCount: 0,
        evaluatedLinkCount: 0,
        completedChecks: [],
      },
      { kind: "scope", scopeKind: "collection", collectionId },
    ],
    [
      { kind: "configured_collections", collections: [] },
      { kind: "scope", scopeKind: "configured_collections" },
    ],
  ])("accepts wiki and lint_wiki codes in a %j scope", (scope, at) => {
    const result = buildReadOnlyResult({
      requiredUnits: 1,
      completedUnits: 0,
      items: [
        {
          issue: createSystemFailure("VALIDATION_RESOURCE_LIMIT_EXCEEDED", at),
        },
        {
          issue: createFinding("HIERARCHY_CYCLE", {
            kind: "relationship",
            documentId,
            relationshipKind: "parent",
          }),
          sortCollectionId: collectionId,
        },
        {
          issue: createFinding("GLOBAL_INDEX_LINK_MISSING", {
            kind: "relationship",
            documentId,
            relationshipKind: "global_index",
          }),
          sortCollectionId: collectionId,
        },
      ],
      scope,
      policies: [],
    });

    expect(result.state).toBe("failed");
    expect(result.errors.map((finding) => finding.code)).toEqual([
      "GLOBAL_INDEX_LINK_MISSING",
      "HIERARCHY_CYCLE",
    ]);
    expect(result.systemFailures.map((failure) => failure.code)).toEqual([
      "VALIDATION_RESOURCE_LIMIT_EXCEEDED",
    ]);
  });

  it.each([
    [["hierarchy", "documents"]],
    [["documents", "documents"]],
    [["documents", "unknown"]],
  ])("rejects completedChecks %j", (completedChecks) => {
    expect(() =>
      buildReadOnlyResult({
        requiredUnits: 0,
        completedUnits: 0,
        items: [],
        scope: {
          kind: "collection",
          collectionId,
          evaluatedDocumentCount: 0,
          evaluatedLinkCount: 0,
          completedChecks: completedChecks as CheckName[],
        },
        policies: [],
      })
    ).toThrow(WikiLintContractError);
  });

  it.each([
    ["an extra scope key", { ...documentScope, title: "Doc" }],
    ["a negative count", { ...documentScope, evaluatedLinkCount: -1 }],
    ["an unknown scope kind", { ...documentScope, kind: "workspace" }],
  ])("rejects %s", (_name, scope) => {
    expect(() =>
      buildReadOnlyResult({
        requiredUnits: 0,
        completedUnits: 0,
        items: [],
        scope: scope as EvaluatedScope,
        policies: [],
      })
    ).toThrow(WikiLintContractError);
  });

  it.each([
    ["a malformed fingerprint", { ...validPolicy, policyFingerprint: "abc" }],
    [
      "a fingerprint on the wrong variant",
      { ...validPolicy, invalidFingerprint: fingerprintB },
    ],
    ["a different schema version", { ...validPolicy, policySchemaVersion: 2 }],
  ])("rejects a policy with %s", (_name, policy) => {
    expect(() =>
      buildReadOnlyResult({
        requiredUnits: 0,
        completedUnits: 0,
        items: [],
        scope: documentScope,
        policies: [policy as PolicyIdentity],
      })
    ).toThrow(WikiLintContractError);
  });

  it("rejects duplicate policies and configured collections", () => {
    const entry = {
      collectionId,
      evaluatedDocumentCount: 0,
      evaluatedLinkCount: 0,
      completedChecks: [],
    };
    expect(() =>
      buildReadOnlyResult({
        requiredUnits: 0,
        completedUnits: 0,
        items: [],
        scope: { kind: "configured_collections", collections: [] },
        policies: [validPolicy, validPolicy],
      })
    ).toThrow(WikiLintContractError);
    expect(() =>
      buildReadOnlyResult({
        requiredUnits: 0,
        completedUnits: 0,
        items: [],
        scope: { kind: "configured_collections", collections: [entry, entry] },
        policies: [],
      })
    ).toThrow(WikiLintContractError);
  });

  it("emits exactly the AD-12 keys in a fixed order", () => {
    const invalidPolicy: PolicyIdentity = {
      collectionId: otherCollectionId,
      status: "invalid",
      invalidFingerprint: fingerprintB,
    };
    const result = buildReadOnlyResult({
      requiredUnits: 2,
      completedUnits: 1,
      items: [error, runtimeFailure],
      scope: {
        kind: "configured_collections",
        collections: [
          {
            completedChecks: ["documents", "global_index"],
            evaluatedLinkCount: 2,
            evaluatedDocumentCount: 1,
            collectionId,
          },
        ],
      },
      policies: [
        {
          invalidFingerprint: fingerprintB,
          status: "invalid",
          collectionId: otherCollectionId,
        },
        {
          policyFingerprint: fingerprintA,
          policySchemaVersion: 1,
          status: "valid",
          collectionId,
        },
      ],
    });

    expect(Object.keys(result)).toEqual([
      "state",
      "complete",
      "clean",
      "errors",
      "warnings",
      "systemFailures",
      "scope",
      "policies",
    ]);
    expect(Object.keys(result.errors[0])).toEqual([
      "code",
      "severity",
      "message",
      "location",
    ]);
    expect(Object.keys(result.systemFailures[0])).toEqual([
      "code",
      "message",
      "location",
    ]);
    expect(result.policies).toEqual([validPolicy, invalidPolicy]);
    expect(result.policies.map((policy) => Object.keys(policy))).toEqual([
      ["collectionId", "status", "policySchemaVersion", "policyFingerprint"],
      ["collectionId", "status", "invalidFingerprint"],
    ]);
    expect(Object.keys(result.scope)).toEqual(["kind", "collections"]);
    expect(
      Object.keys((result.scope as ConfiguredCollectionsScope).collections[0])
    ).toEqual([
      "collectionId",
      "evaluatedDocumentCount",
      "evaluatedLinkCount",
      "completedChecks",
    ]);
  });

  it("revalidates a Finding detail and rebuilds it last, in a fixed key order", () => {
    const result = documentResult(
      [
        {
          issue: {
            detail: { headingLevel: 2, heading: "Summary", kind: "section" },
            location: { documentId, kind: "document" },
            message: missingSection.message,
            severity: "error",
            code: "REQUIRED_SECTION_MISSING",
          } as Finding,
          ordinal: 0,
        },
        { issue: missingSection, ordinal: 1 },
      ],
      1
    );

    expect(JSON.stringify(result.errors)).toBe(
      JSON.stringify([
        { ...missingSection, detail: sectionDetail },
        missingSection,
      ])
    );
    expect(Object.keys(result.errors[0])).toEqual([
      "code",
      "severity",
      "message",
      "location",
      "detail",
    ]);
  });

  it.each([
    [
      { ...documentScope, collectionId: undefined },
      ["kind", "documentId", "evaluatedDocumentCount", "evaluatedLinkCount"],
    ],
    [
      {
        evaluatedLinkCount: 0,
        evaluatedDocumentCount: 1,
        collectionId,
        documentId,
        kind: "document",
      },
      [
        "kind",
        "documentId",
        "collectionId",
        "evaluatedDocumentCount",
        "evaluatedLinkCount",
      ],
    ],
    [
      {
        completedChecks: ["documents"],
        evaluatedLinkCount: 0,
        evaluatedDocumentCount: 1,
        collectionId,
        kind: "collection",
      },
      [
        "kind",
        "collectionId",
        "evaluatedDocumentCount",
        "evaluatedLinkCount",
        "completedChecks",
      ],
    ],
  ])("emits the %j scope keys in a fixed order", (scope, keys) => {
    const result = buildReadOnlyResult({
      requiredUnits: 0,
      completedUnits: 0,
      items: [],
      scope: scope as EvaluatedScope,
      policies: [],
    });
    expect(Object.keys(result.scope)).toEqual(keys);
  });

  it("orders by the server-derived collection before the document", () => {
    const missing = (id: string) =>
      createFinding("REQUIRED_SECTION_MISSING", {
        kind: "document",
        documentId: id,
      });
    const result = buildReadOnlyResult({
      requiredUnits: 2,
      completedUnits: 2,
      items: [
        { issue: missing(documentId), sortCollectionId: otherCollectionId },
        { issue: missing(otherDocumentId), sortCollectionId: collectionId },
      ],
      scope: { kind: "configured_collections", collections: [] },
      policies: [],
    });

    expect(result.errors.map((finding) => finding.location)).toEqual([
      { kind: "document", documentId: otherDocumentId },
      { kind: "document", documentId },
    ]);
  });

  it("is byte-identical for every input order", () => {
    const items: IssueItem[] = [
      { ...error, sortCollectionId: collectionId },
      { ...warning, sortCollectionId: collectionId },
      {
        issue: createFinding("REQUIRED_SECTION_MISSING", {
          kind: "document",
          documentId: otherDocumentId,
        }),
        sortCollectionId: otherCollectionId,
        ordinal: 0,
      },
      {
        issue: createFinding("REQUIRED_SECTION_MISSING", {
          kind: "document",
          documentId: otherDocumentId,
        }),
        sortCollectionId: otherCollectionId,
        ordinal: 1,
      },
      {
        issue: createFinding("GLOBAL_INDEX_LINK_MISSING", {
          kind: "relationship",
          documentId,
          relationshipKind: "global_index",
        }),
        sortCollectionId: collectionId,
      },
      runtimeFailure,
      {
        issue: createSystemFailure("VALIDATION_TIMEOUT", {
          kind: "scope",
          scopeKind: "configured_collections",
        }),
      },
    ];
    const collections = [
      {
        collectionId: otherCollectionId,
        evaluatedDocumentCount: 1,
        evaluatedLinkCount: 0,
        completedChecks: ["documents" as const],
      },
      {
        collectionId,
        evaluatedDocumentCount: 2,
        evaluatedLinkCount: 3,
        completedChecks: ["documents" as const, "hierarchy" as const],
      },
    ];
    const policies: PolicyIdentity[] = [
      validPolicy,
      {
        collectionId: otherCollectionId,
        status: "invalid",
        invalidFingerprint: fingerprintB,
      },
    ];
    const build = (
      orderedItems: IssueItem[],
      orderedCollections: typeof collections,
      orderedPolicies: PolicyIdentity[]
    ) =>
      JSON.stringify(
        buildReadOnlyResult({
          requiredUnits: 5,
          completedUnits: 3,
          items: orderedItems,
          scope: {
            kind: "configured_collections",
            collections: orderedCollections,
          },
          policies: orderedPolicies,
        })
      );

    const reference = build(items, collections, policies);
    const itemOrders = permutations(items, 30);
    const collectionOrders = permutations(collections, 30);
    const policyOrders = permutations(policies, 30);
    for (let index = 0; index < 30; index++) {
      expect(
        build(itemOrders[index], collectionOrders[index], policyOrders[index])
      ).toBe(reference);
    }

    const parsed = JSON.parse(reference);
    expect(parsed.state).toBe("incomplete");
    expect(
      parsed.scope.collections.map(
        (entry: { collectionId: string }) => entry.collectionId
      )
    ).toEqual([collectionId, otherCollectionId]);
    expect(
      parsed.policies.map(
        (policy: { collectionId: string }) => policy.collectionId
      )
    ).toEqual([collectionId, otherCollectionId]);
    expect(
      parsed.errors.map((finding: { code: string }) => finding.code)
    ).toEqual([
      "HEADING_LEVEL_NOT_ALLOWED",
      "GLOBAL_INDEX_LINK_MISSING",
      "REQUIRED_SECTION_MISSING",
      "REQUIRED_SECTION_MISSING",
    ]);
    expect(parsed.warnings).toEqual([warning.issue]);
    expect(
      parsed.systemFailures.map((failure: { code: string }) => failure.code)
    ).toEqual(["VALIDATION_RUNTIME_FAILED", "VALIDATION_TIMEOUT"]);
  });
});
