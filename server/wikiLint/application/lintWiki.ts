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

/** The server-owned `lint_wiki` deadline, in milliseconds. */
export const LINT_WIKI_DEADLINE_MS = 60000;

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
 * @param input.collectionId - the requested collection identifier, or
 *   undefined for the default scope.
 * @param input.actor - the acting user.
 * @param input.policySet - the startup policy set.
 * @param input.deadline - the request deadline.
 * @param input.reader - the database steps.
 * @param input.instanceOrigin - the instance origin that internal links are
 *   recognized against.
 * @returns the outcome.
 */
export async function lintWiki(input: {
  collectionId?: string;
  actor: User;
  policySet: PolicySet;
  deadline: Deadline;
  reader: LintWikiReader;
  instanceOrigin: string;
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
    } catch {
      return { kind: "failed" };
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

  if (!read.ok || deadline.expired()) {
    // A canonicalization failure is never a timeout.
    const code: SystemFailureCode =
      read.ok ||
      (!(read.error instanceof CanonicalMarkdownError) &&
        (read.error instanceof DeadlineFloorError ||
          isDatabaseTimeout(read.error) ||
          deadline.expired()))
        ? "VALIDATION_TIMEOUT"
        : "VALIDATION_RUNTIME_FAILED";
    if (scope.kind === "collection") {
      return {
        kind: "result",
        result: buildReadOnlyResult({
          requiredUnits: 1,
          completedUnits: 0,
          items: [
            {
              issue: createSystemFailure(
                code,
                collectionLocation(scope.collectionId)
              ),
            },
          ],
          scope: collectionScope(zeroEntry(scope.collectionId)),
          policies: entries.map(policyIdentity),
        }),
      };
    }
    const items: IssueItem[] = [
      {
        issue: createSystemFailure(code, {
          kind: "scope",
          scopeKind: "configured_collections",
        }),
      },
    ];
    const collections: ConfiguredCollectionEntry[] = [];
    const policies: PolicyIdentity[] = [];
    addSentinels(
      read.ok
        ? read.snapshot.sentinelCollectionIds
        : read.sentinelCollectionIds,
      items,
      collections,
      policies
    );
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
          failedChecks: new Set<CheckName>(),
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

  let requiredUnits = 0;
  let completedUnits = 0;
  for (const { collection, check, document } of wikiUnits(
    snapshot,
    (collectionId) => accountOf(collectionId).checks
  )) {
    const { collectionId } = collection;
    const account = accountOf(collectionId);
    requiredUnits++;
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
          items.push(failure);
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
          });
          for (const finding of findings) {
            items.push({ ...finding, sortCollectionId: collectionId });
          }
          if (failedKinds.length > 0) {
            items.push(failure);
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
        });
        for (const finding of result.findings) {
          items.push({ ...finding, sortCollectionId: collectionId });
        }
        completed = result.complete;
      }
      if (!completed) {
        items.push({
          issue: createSystemFailure(
            "VALIDATION_RUNTIME_FAILED",
            collectionLocation(collectionId)
          ),
        });
      }
    }

    if (completed) {
      completedUnits++;
    } else {
      account.failedChecks.add(check);
    }
  }

  const collections: ConfiguredCollectionEntry[] = snapshot.collections.map(
    ({ collectionId }) => {
      const account = accountOf(collectionId);
      return {
        collectionId,
        evaluatedDocumentCount: account.evaluatedDocumentCount,
        evaluatedLinkCount: account.evaluatedLinkCount,
        completedChecks: account.checks.filter(
          (check) => !account.failedChecks.has(check)
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

  return {
    kind: "result",
    result: buildReadOnlyResult({
      requiredUnits,
      completedUnits,
      items,
      scope: evaluatedScope,
      policies,
    }),
  };
}
