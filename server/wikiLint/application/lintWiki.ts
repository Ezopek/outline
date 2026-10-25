import type { User } from "@server/models";
import type {
  CheckName,
  CollectionScope,
  ConfiguredCollectionEntry,
  EvaluatedScope,
  IssueItem,
  PolicyIdentity,
  ScopeLocation,
  SystemFailureCode,
  WikiSnapshot,
  WikiSnapshotCollection,
  WikiSnapshotDocument,
} from "../core/contracts";
import { WikiLintContractError } from "../core/contracts";
import {
  documentSurfaceRules,
  evaluateDocumentRules,
} from "../core/documentRules";
import { evaluateGraphCheck } from "../core/graphRules";
import type { PolicySet, PolicySetEntry } from "../core/policySet";
import { policyIdentity } from "../core/policySet";
import { createSystemFailure, requiredChecks } from "../core/registry";
import { buildReadOnlyResult } from "../core/result";
import { CanonicalMarkdownError } from "../adapters/canonicalSyntax";
import { isDatabaseTimeout } from "../adapters/documentReader";
import type { WikiScope, WikiSnapshotRead } from "../adapters/wikiReader";
import {
  authorizeLintCollection,
  readWikiSnapshot,
} from "../adapters/wikiReader";
import type { Deadline } from "./deadline";
import { DeadlineFloorError } from "./deadline";
import type {
  LintDocumentDependencies,
  LintDocumentOutcome,
} from "./lintDocument";
import { WikiResourceLimitError } from "./snapshotLimits";
import { span } from "./timingProbe";

/** The server-owned `lint_wiki` deadline, in milliseconds. */
export const LINT_WIKI_DEADLINE_MS = 60000;

/**
 * The remainder, in milliseconds, below which `lint_wiki` starts no further
 * unit; result assembly is charged to it. Fixed by the Story 3.3 criterion 7
 * rule from the AD-17 reference run of 2026-10-25 (source commit
 * `7631d00b0`).
 */
export const LINT_WIKI_STOP_MARGIN_MS = 2000;

/** The database steps of `lint_wiki`. */
export interface LintWikiReader {
  /** Authorizes the requested collection; null when it is missing or unreadable. */
  authorizeLintCollection(input: {
    id: string;
    actor: User;
    deadline: Deadline;
  }): Promise<string | null>;
  /** Reads the snapshot of the scope. */
  readWikiSnapshot(input: {
    scope: WikiScope;
    entries: readonly PolicySetEntry[];
    actor: User;
    deadline: Deadline;
    instanceOrigin: string;
  }): Promise<WikiSnapshotRead>;
}

/** The database adapter. */
export const defaultLintWikiReader: LintWikiReader = {
  authorizeLintCollection,
  readWikiSnapshot,
};

/** Injectable dependencies of `lint_wiki`; production uses the defaults. */
export interface LintWikiDependencies extends Omit<
  LintDocumentDependencies,
  "reader"
> {
  reader?: LintWikiReader;
}

/** The outcome of linting a Wiki scope. */
export type LintWikiOutcome = LintDocumentOutcome;

/**
 * Builds a collection-scope location.
 *
 * @param collectionId - the collection.
 * @returns the location.
 */
const collectionLocation = (collectionId: string): ScopeLocation => ({
  kind: "scope",
  scopeKind: "collection",
  collectionId,
});

/**
 * Builds a configured-collection entry, with zero counts by default.
 *
 * @param collectionId - the collection.
 * @returns the entry.
 */
const zeroEntry = (collectionId: string): ConfiguredCollectionEntry => ({
  collectionId,
  evaluatedDocumentCount: 0,
  evaluatedLinkCount: 0,
  completedChecks: [],
});

/**
 * Builds a collection scope from a configured-collection entry.
 *
 * @param entry - the entry.
 * @returns the scope.
 */
const collectionScope = (
  entry: ConfiguredCollectionEntry
): CollectionScope => ({
  kind: "collection",
  ...entry,
});

/**
 * Wraps a not-evaluated result.
 *
 * @param scope - the zero-count scope.
 * @returns the result outcome.
 */
const notEvaluated = (scope: EvaluatedScope): LintWikiOutcome => ({
  kind: "result",
  result: buildReadOnlyResult({
    notEvaluated: true,
    items: [],
    scope,
    policies: [],
  }),
});

/** One atomic unit of a `lint_wiki` run. */
export interface WikiUnit {
  collection: WikiSnapshotCollection;
  check: CheckName;
  /** The evaluated document of a `documents` unit; absent for a vacuous one. */
  document?: WikiSnapshotDocument;
}

/**
 * Lists the atomic units of a snapshot in the fixed AD-11 order: first every
 * `documents` unit, by collection and then document, with one vacuous unit
 * for a collection without documents; then, per collection, its `hierarchy`
 * unit followed by its `global_index` unit. Only required checks get units.
 *
 * @param snapshot - the snapshot, whose collections and documents are sorted.
 * @param checksOf - the required checks of a collection, in canonical order.
 * @returns the units.
 */
export function wikiUnits(
  snapshot: WikiSnapshot,
  checksOf: (collectionId: string) => readonly CheckName[]
): WikiUnit[] {
  const units: WikiUnit[] = [];
  for (const collection of snapshot.collections) {
    if (checksOf(collection.collectionId).includes("documents")) {
      if (collection.documents.length === 0) {
        units.push({ collection, check: "documents" });
      }
      for (const document of collection.documents) {
        units.push({ collection, check: "documents", document });
      }
    }
  }
  for (const collection of snapshot.collections) {
    for (const check of checksOf(collection.collectionId)) {
      if (check !== "documents") {
        units.push({ collection, check });
      }
    }
  }
  return units;
}

/**
 * Lints the Wiki scope of one readable collection, or by default of every
 * readable configured collection, from one coherent snapshot. Denied and
 * missing collections are indistinguishable, and unreadable collections
 * contribute nothing. Each graph check runs over its collection's authorized
 * graph; without `readDocument` on the collection it fails with one generic
 * System Failure and its rules never run.
 *
 * Admission (AD-16) follows the scoped lookup and the sentinel, unconfigured,
 * and empty-set returns, and precedes the snapshot; a rejected request fails
 * with `VALIDATION_RESOURCE_LIMIT_EXCEEDED`, as does a snapshot that exceeds
 * a resource limit. Units run in the AD-11 order, and none starts once less
 * than `LINT_WIKI_STOP_MARGIN_MS` remains: the finished units are kept, and
 * one run-wide `VALIDATION_TIMEOUT` is added. The loop yields to the event
 * loop before each unit, so the stop margin is checked after the yield.
 *
 * @param input.collectionId - the requested collection identifier, or
 *   undefined for the default scope.
 * @param input.actor - the acting user.
 * @param input.policySet - the startup policy set.
 * @param input.deadline - the request deadline.
 * @param input.reader - the database steps.
 * @param input.instanceOrigin - the instance origin that internal links are
 *   recognized against.
 * @param input.admit - claims the per-process scan slot; called at most once,
 *   and false rejects the request.
 * @returns the outcome.
 */
export async function lintWiki(input: {
  collectionId?: string;
  actor: User;
  policySet: PolicySet;
  deadline: Deadline;
  reader: LintWikiReader;
  instanceOrigin: string;
  admit: () => boolean;
}): Promise<LintWikiOutcome> {
  const { actor, policySet, deadline, reader, instanceOrigin } = input;
  const entryById = new Map(
    policySet.entries.map((entry) => [entry.collectionId, entry])
  );

  /**
   * Returns the policy set entry of a collection the reader returned.
   *
   * @param collectionId - the collection.
   * @param status - the expected entry status.
   * @returns the entry.
   */
  const entryOf = <S extends PolicySetEntry["status"]>(
    collectionId: string,
    status: S
  ) => {
    const entry = entryById.get(collectionId);
    if (entry?.status !== status) {
      throw new WikiLintContractError("Unexpected snapshot collection");
    }
    return entry as Extract<PolicySetEntry, { status: S }>;
  };

  let scope: WikiScope;
  let entries: readonly PolicySetEntry[];
  if (input.collectionId !== undefined) {
    let collectionId: string | null;
    try {
      collectionId = await reader.authorizeLintCollection({
        id: input.collectionId,
        actor,
        deadline,
      });
    } catch (cause) {
      return { kind: "failed", cause };
    }
    if (collectionId === null) {
      return { kind: "denied" };
    }

    const entry = entryById.get(collectionId);
    if (!entry) {
      return notEvaluated(collectionScope(zeroEntry(collectionId)));
    }
    if (entry.status === "invalid") {
      return {
        kind: "result",
        result: buildReadOnlyResult({
          requiredUnits: 0,
          completedUnits: 0,
          items: [
            {
              issue: createSystemFailure(
                "POLICY_CONFIGURATION_INVALID",
                collectionLocation(collectionId)
              ),
            },
          ],
          scope: collectionScope(zeroEntry(collectionId)),
          policies: [policyIdentity(entry)],
        }),
      };
    }
    scope = { kind: "collection", collectionId };
    entries = [entry];
  } else {
    if (policySet.entries.length === 0) {
      return notEvaluated({ kind: "configured_collections", collections: [] });
    }
    scope = { kind: "configured_collections" };
    entries = policySet.entries;
  }

  /** Where a run-wide System Failure is located. */
  const runLocation: ScopeLocation =
    scope.kind === "collection"
      ? collectionLocation(scope.collectionId)
      : { kind: "scope", scopeKind: "configured_collections" };

  /**
   * Adds the System Failure, identity, and zero entry of each sentinel.
   *
   * @param sentinelIds - the sentinels established as readable.
   * @param items - the issues to add to.
   * @param collections - the configured-collection entries to add to.
   * @param policies - the policy identities to add to.
   */
  const addSentinels = (
    sentinelIds: readonly string[],
    items: IssueItem[],
    collections: ConfiguredCollectionEntry[],
    policies: PolicyIdentity[]
  ) => {
    for (const collectionId of sentinelIds) {
      items.push({
        issue: createSystemFailure(
          "POLICY_CONFIGURATION_INVALID",
          collectionLocation(collectionId)
        ),
      });
      collections.push(zeroEntry(collectionId));
      policies.push(policyIdentity(entryOf(collectionId, "invalid")));
    }
  };

  /**
   * Builds a run-wide failure: one System Failure at the run location, no
   * Findings, and zero counts, plus each readable sentinel in the default
   * scope.
   *
   * @param code - the System Failure code.
   * @param sentinelIds - the sentinels established as readable.
   * @returns the outcome.
   */
  const runFailure = (
    code: SystemFailureCode,
    sentinelIds: readonly string[]
  ): LintWikiOutcome => {
    const items: IssueItem[] = [
      { issue: createSystemFailure(code, runLocation) },
    ];
    if (scope.kind === "collection") {
      return {
        kind: "result",
        result: buildReadOnlyResult({
          requiredUnits: 1,
          completedUnits: 0,
          items,
          scope: collectionScope(zeroEntry(scope.collectionId)),
          policies: entries.map(policyIdentity),
        }),
      };
    }
    const collections: ConfiguredCollectionEntry[] = [];
    const policies: PolicyIdentity[] = [];
    addSentinels(sentinelIds, items, collections, policies);
    return {
      kind: "result",
      result: buildReadOnlyResult({
        requiredUnits: 1,
        completedUnits: 0,
        items,
        scope: { kind: "configured_collections", collections },
        policies,
      }),
    };
  };

  if (!input.admit()) {
    return runFailure("VALIDATION_RESOURCE_LIMIT_EXCEEDED", []);
  }

  let read: WikiSnapshotRead;
  try {
    read = await reader.readWikiSnapshot({
      scope,
      entries,
      actor,
      deadline,
      instanceOrigin,
    });
  } catch (error) {
    read = { ok: false, error, sentinelCollectionIds: [] };
  }

  if (!read.ok || deadline.expired()) {
    let code: SystemFailureCode;
    if (!read.ok && read.error instanceof WikiResourceLimitError) {
      code = "VALIDATION_RESOURCE_LIMIT_EXCEEDED";
    } else if (
      read.ok ||
      // A canonicalization failure is never a timeout.
      (!(read.error instanceof CanonicalMarkdownError) &&
        (read.error instanceof DeadlineFloorError ||
          isDatabaseTimeout(read.error) ||
          deadline.expired()))
    ) {
      code = "VALIDATION_TIMEOUT";
    } else {
      code = "VALIDATION_RUNTIME_FAILED";
    }
    return runFailure(
      code,
      read.ok ? read.snapshot.sentinelCollectionIds : read.sentinelCollectionIds
    );
  }

  const { snapshot } = read;
  const items: IssueItem[] = [];
  const policies: PolicyIdentity[] = [];
  const accounts = new Map(
    snapshot.collections.map(({ collectionId }) => {
      const entry = entryOf(collectionId, "valid");
      policies.push(policyIdentity(entry));
      const { rules } = entry.policy;
      const documentRules = documentSurfaceRules(rules);
      return [
        collectionId,
        {
          rules,
          checks: requiredChecks(rules),
          documentRules,
          linksEnabled: documentRules.some(
            (rule) => rule.kind === "internal_links"
          ),
          /** The units of each check not yet completed. */
          pending: new Map<CheckName, number>(),
          evaluatedDocumentCount: 0,
          evaluatedLinkCount: 0,
        },
      ];
    })
  );

  /**
   * Returns the accounting of a snapshot collection.
   *
   * @param collectionId - the collection.
   * @returns the accounting.
   */
  const accountOf = (collectionId: string) => {
    const account = accounts.get(collectionId);
    if (!account) {
      throw new WikiLintContractError("Unexpected snapshot collection");
    }
    return account;
  };

  const units = wikiUnits(
    snapshot,
    (collectionId) => accountOf(collectionId).checks
  );
  for (const { collection, check } of units) {
    const { pending } = accountOf(collection.collectionId);
    pending.set(check, (pending.get(check) ?? 0) + 1);
  }

  let completedUnits = 0;
  let stopped = false;
  for (const { collection, check, document } of units) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (deadline.remainingMs() < LINT_WIKI_STOP_MARGIN_MS) {
      stopped = true;
      break;
    }
    const unitStartedAt = performance.now();
    const { collectionId } = collection;
    const account = accountOf(collectionId);
    // The unit's issues are kept only once it finishes.
    const buffer: IssueItem[] = [];
    let completed: boolean;

    if (check === "documents") {
      completed = true;
      if (document) {
        const { documentId, content } = document;
        const failure = {
          issue: createSystemFailure("VALIDATION_RUNTIME_FAILED", {
            kind: "scope",
            scopeKind: "document",
            documentId,
            collectionId,
          }),
        };
        if (content === null || content === "unavailable") {
          buffer.push(failure);
          completed = false;
        } else {
          const { findings, failedKinds } = evaluateDocumentRules({
            documentId,
            syntax: content.syntax,
            rules: account.documentRules,
            links:
              content.links === null
                ? undefined
                : { references: [...content.links], targets: snapshot.targets },
            // Every evaluated collection is actor-readable: a collection scope
            // passed its pre-admission read check, and the default scope keeps
            // only collections the actor can read.
            detailVisible: true,
          });
          for (const finding of findings) {
            buffer.push({ ...finding, sortCollectionId: collectionId });
          }
          if (failedKinds.length > 0) {
            buffer.push(failure);
            completed = false;
          } else {
            account.evaluatedDocumentCount++;
            if (account.linksEnabled) {
              account.evaluatedLinkCount += content.links?.length ?? 0;
            }
          }
        }
      }
    } else {
      // A graph check runs only over an authorized graph; otherwise it fails
      // generically without invoking its rules.
      const { graph } = collection;
      completed = false;
      if (graph?.authorized === true) {
        const result = evaluateGraphCheck({
          check,
          documents: collection.documents,
          graph,
          rules: account.rules,
          // Every evaluated collection is actor-readable, as for documents.
          detailVisible: true,
        });
        for (const finding of result.findings) {
          buffer.push({ ...finding, sortCollectionId: collectionId });
        }
        completed = result.complete;
      }
      if (!completed) {
        buffer.push({
          issue: createSystemFailure(
            "VALIDATION_RUNTIME_FAILED",
            collectionLocation(collectionId)
          ),
        });
      }
    }

    for (const item of buffer) {
      items.push(item);
    }
    if (completed) {
      completedUnits++;
      account.pending.set(check, (account.pending.get(check) ?? 0) - 1);
    }
    span("unit", performance.now() - unitStartedAt);
  }
  // Result assembly is charged to the stop margin.
  const assemblyStartedAt = performance.now();
  if (stopped) {
    items.push({
      issue: createSystemFailure("VALIDATION_TIMEOUT", runLocation),
    });
  }

  const collections: ConfiguredCollectionEntry[] = snapshot.collections.map(
    ({ collectionId }) => {
      const account = accountOf(collectionId);
      return {
        collectionId,
        evaluatedDocumentCount: account.evaluatedDocumentCount,
        evaluatedLinkCount: account.evaluatedLinkCount,
        // A check is listed only when every one of its units completed.
        completedChecks: account.checks.filter(
          (check) => account.pending.get(check) === 0
        ),
      };
    }
  );

  let evaluatedScope: EvaluatedScope;
  if (scope.kind === "collection") {
    if (
      collections.length !== 1 ||
      collections[0].collectionId !== scope.collectionId ||
      snapshot.sentinelCollectionIds.length > 0
    ) {
      throw new WikiLintContractError("Unexpected snapshot scope");
    }
    evaluatedScope = collectionScope(collections[0]);
  } else {
    addSentinels(snapshot.sentinelCollectionIds, items, collections, policies);
    if (collections.length === 0) {
      return notEvaluated({ kind: "configured_collections", collections: [] });
    }
    evaluatedScope = { kind: "configured_collections", collections };
  }

  const outcome: LintWikiOutcome = {
    kind: "result",
    result: buildReadOnlyResult({
      requiredUnits: units.length,
      completedUnits,
      items,
      scope: evaluatedScope,
      policies,
    }),
  };
  span("result_assembly", performance.now() - assemblyStartedAt);
  return outcome;
}
