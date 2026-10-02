import type { User } from "@server/models";
import type {
  DocumentScope,
  IssueItem,
  PolicyIdentity,
  ReadOnlyResult,
  ScopeLocation,
  SystemFailureCode,
} from "../core/contracts";
import {
  documentSurfaceRules,
  evaluateDocumentRules,
} from "../core/documentRules";
import type { PolicySet, PolicySetEntry } from "../core/policySet";
import { createSystemFailure } from "../core/registry";
import { buildReadOnlyResult } from "../core/result";
import { CanonicalMarkdownError } from "../adapters/canonicalSyntax";
import type { DocumentSnapshot, LintTarget } from "../adapters/documentReader";
import {
  authorizeLintTarget,
  isDatabaseTimeout,
  readDocumentSnapshot,
} from "../adapters/documentReader";
import type { Deadline, MonotonicClock } from "./deadline";
import { DeadlineFloorError } from "./deadline";

/** The server-owned `lint_document` deadline, in milliseconds. */
export const LINT_DOCUMENT_DEADLINE_MS = 9000;

/** The database steps of `lint_document`. */
export interface LintDocumentReader {
  /** Authorizes the target; null when it is missing or not readable. */
  authorizeLintTarget(input: {
    id: string;
    actor: User;
    deadline: Deadline;
  }): Promise<LintTarget | null>;
  /**
   * Reads the target's snapshot; resolves its internal links when an instance
   * origin is given.
   */
  readDocumentSnapshot(input: {
    documentId: string;
    collectionId: string;
    deadline: Deadline;
    actor: User;
    instanceOrigin?: string;
  }): Promise<DocumentSnapshot>;
}

/** The database adapter. */
export const defaultLintDocumentReader: LintDocumentReader = {
  authorizeLintTarget,
  readDocumentSnapshot,
};

/** Injectable dependencies of `lint_document`; production uses the defaults. */
export interface LintDocumentDependencies {
  policySet?: PolicySet;
  clock?: MonotonicClock;
  reader?: LintDocumentReader;
  /** The instance origin that internal links are recognized against. */
  instanceOrigin?: string;
}

/** The outcome of linting one document. */
export type LintDocumentOutcome =
  | { kind: "result"; result: ReadOnlyResult }
  | { kind: "denied" }
  | { kind: "failed" };

/**
 * Builds a document scope, with zero counts by default.
 *
 * @param documentId - the document.
 * @param collectionId - the collection, only when the actor can read it.
 * @param evaluatedDocumentCount - the number of evaluated documents.
 * @param evaluatedLinkCount - the number of evaluated internal-link references.
 * @returns the scope.
 */
function documentScope(
  documentId: string,
  collectionId: string | undefined,
  evaluatedDocumentCount = 0,
  evaluatedLinkCount = 0
): DocumentScope {
  return collectionId === undefined
    ? {
        kind: "document",
        documentId,
        evaluatedDocumentCount,
        evaluatedLinkCount,
      }
    : {
        kind: "document",
        documentId,
        collectionId,
        evaluatedDocumentCount,
        evaluatedLinkCount,
      };
}

/**
 * Builds a document-scope location.
 *
 * @param documentId - the document.
 * @param collectionId - the collection, only when the actor can read it.
 * @returns the location.
 */
function documentLocation(
  documentId: string,
  collectionId?: string
): ScopeLocation {
  return collectionId === undefined
    ? { kind: "scope", scopeKind: "document", documentId }
    : { kind: "scope", scopeKind: "document", documentId, collectionId };
}

/**
 * Builds the AD-12 identity of a policy set entry, without its policy.
 *
 * @param entry - the entry.
 * @returns the identity.
 */
function policyIdentity(entry: PolicySetEntry): PolicyIdentity {
  return entry.status === "valid"
    ? {
        collectionId: entry.collectionId,
        status: "valid",
        policySchemaVersion: entry.policySchemaVersion,
        policyFingerprint: entry.policyFingerprint,
      }
    : {
        collectionId: entry.collectionId,
        status: "invalid",
        invalidFingerprint: entry.invalidFingerprint,
      };
}

/**
 * Builds a failed result whose unit did not complete.
 *
 * @param input.items - the Findings kept and the System Failure.
 * @param input.scope - the zero-count scope.
 * @param input.policies - the visible policy identities.
 * @returns the result outcome.
 */
function failedResult(input: {
  items: readonly IssueItem[];
  scope: DocumentScope;
  policies: readonly PolicyIdentity[];
}): LintDocumentOutcome {
  return {
    kind: "result",
    result: buildReadOnlyResult({
      requiredUnits: 1,
      completedUnits: 0,
      ...input,
    }),
  };
}

/**
 * Lints one document the actor can read under its collection policy. Denied
 * and missing targets are indistinguishable. Collection and policy identity
 * appear only when the actor can read the collection.
 *
 * @param input.id - a document UUID or URL identifier.
 * @param input.actor - the acting user.
 * @param input.policySet - the startup policy set.
 * @param input.deadline - the request deadline.
 * @param input.reader - the database steps.
 * @param input.instanceOrigin - the instance origin that internal links are
 *   recognized against.
 * @returns the outcome.
 */
export async function lintDocument(input: {
  id: string;
  actor: User;
  policySet: PolicySet;
  deadline: Deadline;
  reader: LintDocumentReader;
  instanceOrigin: string;
}): Promise<LintDocumentOutcome> {
  const { id, actor, policySet, deadline, reader, instanceOrigin } = input;

  let target: LintTarget | null;
  try {
    target = await reader.authorizeLintTarget({ id, actor, deadline });
  } catch {
    return { kind: "failed" };
  }
  if (!target) {
    return { kind: "denied" };
  }

  const { documentId, collectionId, collectionReadability } = target;
  const visibleCollectionId =
    collectionReadability === "readable" && collectionId !== null
      ? collectionId
      : undefined;
  const entry =
    collectionId === null
      ? undefined
      : policySet.entries.find((item) => item.collectionId === collectionId);
  const zeroScope = documentScope(documentId, visibleCollectionId);
  const policies =
    entry && visibleCollectionId !== undefined ? [policyIdentity(entry)] : [];

  if (!entry) {
    return {
      kind: "result",
      result: buildReadOnlyResult({
        notEvaluated: true,
        items: [],
        scope: zeroScope,
        policies: [],
      }),
    };
  }

  if (entry.status === "invalid") {
    // A reader without collection access sees only the policy class, at the
    // document; when readability is unestablished, the failure stays generic.
    const failure =
      visibleCollectionId !== undefined
        ? createSystemFailure("POLICY_CONFIGURATION_INVALID", {
            kind: "scope",
            scopeKind: "collection",
            collectionId: visibleCollectionId,
          })
        : createSystemFailure(
            collectionReadability === "unreadable"
              ? "POLICY_CONFIGURATION_INVALID"
              : "VALIDATION_RUNTIME_FAILED",
            documentLocation(documentId)
          );
    return failedResult({
      items: [{ issue: failure }],
      scope: zeroScope,
      policies,
    });
  }

  const rules = documentSurfaceRules(entry.policy.rules);
  if (rules.length === 0) {
    return {
      kind: "result",
      result: buildReadOnlyResult({
        requiredUnits: 0,
        completedUnits: 0,
        items: [],
        scope: zeroScope,
        policies,
      }),
    };
  }

  /**
   * Builds the failed result of a snapshot or construction failure, located
   * at the document without its collection.
   *
   * @param code - the System Failure code.
   * @returns the result outcome.
   */
  const constructionFailure = (code: SystemFailureCode) =>
    failedResult({
      items: [
        {
          issue: createSystemFailure(code, documentLocation(documentId)),
        },
      ],
      scope: zeroScope,
      policies,
    });

  const hasInternalLinks = rules.some((rule) => rule.kind === "internal_links");
  let snapshot: DocumentSnapshot;
  try {
    snapshot = await reader.readDocumentSnapshot({
      documentId,
      collectionId: entry.collectionId,
      deadline,
      actor,
      ...(hasInternalLinks ? { instanceOrigin } : {}),
    });
  } catch (error) {
    // A canonicalization failure is never a timeout.
    return constructionFailure(
      !(error instanceof CanonicalMarkdownError) &&
        (error instanceof DeadlineFloorError ||
          isDatabaseTimeout(error) ||
          deadline.expired())
        ? "VALIDATION_TIMEOUT"
        : "VALIDATION_RUNTIME_FAILED"
    );
  }
  if (deadline.expired()) {
    return constructionFailure("VALIDATION_TIMEOUT");
  }

  const { findings, failedKinds } = evaluateDocumentRules({
    documentId,
    syntax: snapshot.syntax,
    rules,
    links: snapshot.links ?? undefined,
  });

  if (failedKinds.length > 0) {
    return failedResult({
      items: [
        ...findings,
        {
          issue: createSystemFailure(
            "VALIDATION_RUNTIME_FAILED",
            documentLocation(documentId, visibleCollectionId)
          ),
        },
      ],
      scope: zeroScope,
      policies,
    });
  }

  return {
    kind: "result",
    result: buildReadOnlyResult({
      requiredUnits: 1,
      completedUnits: 1,
      items: findings,
      scope: documentScope(
        documentId,
        visibleCollectionId,
        1,
        hasInternalLinks ? (snapshot.links?.references.length ?? 0) : 0
      ),
      policies,
    }),
  };
}
