import { z } from "zod";
import type {
  CheckName,
  ConfiguredCollectionEntry,
  EvaluatedScope,
  Finding,
  IssueItem,
  PolicyIdentity,
  ReadOnlyResult,
  ResultState,
  SystemFailure,
} from "./contracts";
import { WikiLintContractError } from "./contracts";
import { compareUtf8, sortIssues } from "./ordering";
import type { IssueSurfaces } from "./registry";
import {
  POLICY_NOT_CONFIGURED,
  createFinding,
  createSystemFailure,
  getIssueDefinition,
} from "./registry";

const checkOrder: readonly CheckName[] = [
  "documents",
  "hierarchy",
  "global_index",
];

const identifier = z.string().min(1);
const count = z.number().int().min(0);
const fingerprint = z.string().regex(/^sha256:[0-9a-f]{64}$/);

const completedChecks = z
  .array(z.enum(["documents", "hierarchy", "global_index"]))
  .refine((checks) =>
    checks.every(
      (check, index) =>
        index === 0 ||
        checkOrder.indexOf(checks[index - 1]) < checkOrder.indexOf(check)
    )
  );

const scopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("document"),
    documentId: identifier,
    collectionId: identifier.optional(),
    evaluatedDocumentCount: count,
    evaluatedLinkCount: count,
  }),
  z.strictObject({
    kind: z.literal("collection"),
    collectionId: identifier,
    evaluatedDocumentCount: count,
    evaluatedLinkCount: count,
    completedChecks,
  }),
  z.strictObject({
    kind: z.literal("configured_collections"),
    collections: z.array(
      z.strictObject({
        collectionId: identifier,
        evaluatedDocumentCount: count,
        evaluatedLinkCount: count,
        completedChecks,
      })
    ),
  }),
]);

const policySchema = z.discriminatedUnion("status", [
  z.strictObject({
    collectionId: identifier,
    status: z.literal("valid"),
    policySchemaVersion: z.literal(1),
    policyFingerprint: fingerprint,
  }),
  z.strictObject({
    collectionId: identifier,
    status: z.literal("invalid"),
    invalidFingerprint: fingerprint,
  }),
]);

/** Surfaces whose issues may appear in a result of each scope kind. */
const surfacesByScopeKind: Record<
  EvaluatedScope["kind"],
  ReadonlySet<IssueSurfaces>
> = {
  document: new Set(["document", "all"]),
  collection: new Set(["document", "wiki", "all", "lint_wiki"]),
  configured_collections: new Set(["document", "wiki", "all", "lint_wiki"]),
};

/**
 * Derives the state of an evaluated result from its atomic-unit counts.
 *
 * @param input.requiredUnits - the number of atomic units the run requires.
 * @param input.completedUnits - the number of atomic units that completed.
 * @param input.systemFailureCount - the number of System Failures.
 * @returns `complete`, `incomplete`, or `failed`.
 * @throws WikiLintContractError when the counts are impossible.
 */
export function deriveResultState(input: {
  requiredUnits: number;
  completedUnits: number;
  systemFailureCount: number;
}): Exclude<ResultState, "not_evaluated"> {
  const { requiredUnits, completedUnits, systemFailureCount } = input;
  if (
    !count.safeParse(requiredUnits).success ||
    !count.safeParse(completedUnits).success ||
    !count.safeParse(systemFailureCount).success ||
    completedUnits > requiredUnits
  ) {
    throw new WikiLintContractError("Invalid result unit counts");
  }
  if (systemFailureCount === 0) {
    if (completedUnits !== requiredUnits) {
      throw new WikiLintContractError(
        "Incomplete units require a System Failure"
      );
    }
    return "complete";
  }
  return completedUnits > 0 ? "incomplete" : "failed";
}

/**
 * Validates an evaluated scope and rebuilds it in the fixed key order, with
 * configured collections sorted by collection ID.
 *
 * @param input - the scope supplied by the caller.
 * @returns the normalized scope.
 */
function normalizeScope(input: EvaluatedScope): EvaluatedScope {
  const parsed = scopeSchema.safeParse(input);
  if (!parsed.success) {
    throw new WikiLintContractError("Invalid evaluated scope");
  }
  const scope = parsed.data;
  switch (scope.kind) {
    case "document":
      return scope.collectionId === undefined
        ? {
            kind: "document",
            documentId: scope.documentId,
            evaluatedDocumentCount: scope.evaluatedDocumentCount,
            evaluatedLinkCount: scope.evaluatedLinkCount,
          }
        : {
            kind: "document",
            documentId: scope.documentId,
            collectionId: scope.collectionId,
            evaluatedDocumentCount: scope.evaluatedDocumentCount,
            evaluatedLinkCount: scope.evaluatedLinkCount,
          };
    case "collection":
      return {
        kind: "collection",
        collectionId: scope.collectionId,
        evaluatedDocumentCount: scope.evaluatedDocumentCount,
        evaluatedLinkCount: scope.evaluatedLinkCount,
        completedChecks: [...scope.completedChecks],
      };
    case "configured_collections": {
      const collections: ConfiguredCollectionEntry[] = scope.collections
        .map((entry) => ({
          collectionId: entry.collectionId,
          evaluatedDocumentCount: entry.evaluatedDocumentCount,
          evaluatedLinkCount: entry.evaluatedLinkCount,
          completedChecks: [...entry.completedChecks],
        }))
        .sort((a, b) => compareUtf8(a.collectionId, b.collectionId));
      assertUniqueCollections(collections);
      return { kind: "configured_collections", collections };
    }
    default:
      throw new WikiLintContractError("Invalid evaluated scope");
  }
}

/**
 * Validates policy identities and rebuilds them in the fixed key order,
 * sorted by collection ID.
 *
 * @param input - the identities supplied by the caller.
 * @returns the normalized, sorted identities.
 */
function normalizePolicies(input: readonly PolicyIdentity[]): PolicyIdentity[] {
  const policies = input
    .map((identity): PolicyIdentity => {
      const parsed = policySchema.safeParse(identity);
      if (!parsed.success) {
        throw new WikiLintContractError("Invalid policy identity");
      }
      const policy = parsed.data;
      return policy.status === "valid"
        ? {
            collectionId: policy.collectionId,
            status: "valid",
            policySchemaVersion: 1,
            policyFingerprint: policy.policyFingerprint,
          }
        : {
            collectionId: policy.collectionId,
            status: "invalid",
            invalidFingerprint: policy.invalidFingerprint,
          };
    })
    .sort((a, b) => compareUtf8(a.collectionId, b.collectionId));
  assertUniqueCollections(policies);
  return policies;
}

/**
 * Asserts that sorted entries name each collection at most once.
 *
 * @param sorted - entries sorted by collection ID.
 */
function assertUniqueCollections(
  sorted: readonly { collectionId: string }[]
): void {
  for (let index = 1; index < sorted.length; index++) {
    if (sorted[index].collectionId === sorted[index - 1].collectionId) {
      throw new WikiLintContractError("Duplicate collection entry");
    }
  }
}

/**
 * Re-validates an issue against the registry and the result's scope kind.
 *
 * @param issue - the issue supplied by the caller.
 * @param scopeKind - the kind of the result's evaluated scope.
 * @returns the issue rebuilt from the registry.
 */
function revalidateIssue(
  issue: Finding | SystemFailure,
  scopeKind: EvaluatedScope["kind"]
): Finding | SystemFailure {
  const definition = getIssueDefinition(issue.code);
  if (!definition || !surfacesByScopeKind[scopeKind].has(definition.surfaces)) {
    throw new WikiLintContractError("Issue code is not allowed in this scope");
  }
  const rebuilt =
    definition.class === "system_failure"
      ? createSystemFailure(
          (issue as SystemFailure).code,
          (issue as SystemFailure).location
        )
      : createFinding(
          (issue as Finding).code,
          issue.location,
          (issue as Finding).detail
        );
  const expectedKeys = Object.keys(rebuilt);
  const actualKeys = Object.keys(issue);
  if (
    actualKeys.length !== expectedKeys.length ||
    !expectedKeys.every((key) => actualKeys.includes(key)) ||
    issue.message !== rebuilt.message ||
    ("severity" in rebuilt && (issue as Finding).severity !== rebuilt.severity)
  ) {
    throw new WikiLintContractError("Issue does not match the registry");
  }
  return rebuilt;
}

/**
 * Checks that a scope records no evaluation: zero counts, no completed
 * checks, and no configured collections.
 *
 * @param scope - a normalized scope.
 * @returns whether the scope is a zero-count scope.
 */
function hasZeroCounts(scope: EvaluatedScope): boolean {
  switch (scope.kind) {
    case "document":
      return (
        scope.evaluatedDocumentCount === 0 && scope.evaluatedLinkCount === 0
      );
    case "collection":
      return (
        scope.evaluatedDocumentCount === 0 &&
        scope.evaluatedLinkCount === 0 &&
        scope.completedChecks.length === 0
      );
    default:
      return scope.collections.length === 0;
  }
}

/** Input for an evaluated read-only result. */
export interface EvaluatedResultInput {
  notEvaluated?: false;
  /** The number of atomic units the run requires. */
  requiredUnits: number;
  /** The number of atomic units that completed. */
  completedUnits: number;
  /** Findings and System Failures with their sort keys, in emission order. */
  items: readonly IssueItem[];
  scope: EvaluatedScope;
  policies: readonly PolicyIdentity[];
}

/** Input for a result whose actor-readable scope holds no policy. */
export interface NotEvaluatedResultInput {
  notEvaluated: true;
  items: readonly IssueItem[];
  scope: EvaluatedScope;
  policies: readonly PolicyIdentity[];
}

/**
 * Builds a read-only lint result. Issues are re-validated against the
 * registry and the scope's surfaces, then sorted; policies and configured
 * collections are sorted by collection ID. Keys are emitted in a fixed order
 * so the serialized result is byte-stable.
 *
 * @param input - the evaluated or not-evaluated result input.
 * @returns the result.
 * @throws WikiLintContractError when any part violates the contract.
 */
export function buildReadOnlyResult(
  input: EvaluatedResultInput | NotEvaluatedResultInput
): ReadOnlyResult {
  const scope = normalizeScope(input.scope);
  const policies = normalizePolicies(input.policies);

  if (input.notEvaluated === true) {
    if (
      input.items.length > 0 ||
      policies.length > 0 ||
      !hasZeroCounts(scope)
    ) {
      throw new WikiLintContractError(
        "A not-evaluated result carries no issues, policies, or counts"
      );
    }
    return {
      state: "not_evaluated",
      complete: false,
      clean: false,
      errors: [],
      warnings: [],
      systemFailures: [],
      scope,
      policies,
      reason: POLICY_NOT_CONFIGURED,
    };
  }

  const errors: IssueItem<Finding>[] = [];
  const warnings: IssueItem<Finding>[] = [];
  const systemFailures: IssueItem<SystemFailure>[] = [];
  for (const item of input.items) {
    const issue = revalidateIssue(item.issue, scope.kind);
    const sorted = {
      issue,
      sortCollectionId: item.sortCollectionId,
      ordinal: item.ordinal,
    };
    if (!("severity" in issue)) {
      systemFailures.push(sorted as IssueItem<SystemFailure>);
    } else if (issue.severity === "error") {
      errors.push(sorted as IssueItem<Finding>);
    } else {
      warnings.push(sorted as IssueItem<Finding>);
    }
  }

  const state = deriveResultState({
    requiredUnits: input.requiredUnits,
    completedUnits: input.completedUnits,
    systemFailureCount: systemFailures.length,
  });
  const complete = state === "complete";

  return {
    state,
    complete,
    clean: complete && errors.length === 0,
    errors: sortIssues(errors),
    warnings: sortIssues(warnings),
    systemFailures: sortIssues(systemFailures),
    scope,
    policies,
  };
}
