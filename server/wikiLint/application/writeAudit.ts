import type { User } from "@server/models";
import type {
  AuditDataV1,
  AuditEventRow,
  AuditEventWriter,
} from "../adapters/auditEvents";
import { insertAuditEvent } from "../adapters/auditEvents";
import type {
  IssueCode,
  IssueItem,
  ScopeLocation,
  SystemFailure,
  SystemFailureCode,
  WriteValidation,
} from "../core/contracts";
import { documentSurfaceRules } from "../core/documentRules";
import { compareUtf8, sortIssues } from "../core/ordering";
import type { RuleConfig } from "../core/registry";
import {
  UUID_PATTERN,
  createSystemFailure,
  getIssueDefinition,
} from "../core/registry";
import { AUDIT_WRITE_BOUND_MS, monotonicClock } from "./deadline";
import type { ProjectionValidation } from "./enforcedWrite";
import { awaitAuditWrite } from "./readAudit";

/** The server-owned credential of an enforced write, from `AuthInfo.extra`. */
export type AuthEnvelope =
  | { credentialAuthType: "api" }
  | { credentialAuthType: "oauth"; authenticatedClientId: string };

/**
 * Reads the server-owned credential envelope from `AuthInfo.extra`.
 *
 * @param extra - the `/mcp`-filled extra.
 * @returns the envelope; undefined when it is invalid.
 */
export function authEnvelopeOf(
  extra: Record<string, unknown> | undefined
): AuthEnvelope | undefined {
  const type = extra?.credentialAuthType;
  const clientId = extra?.authenticatedClientId;
  if (type === "api") {
    return { credentialAuthType: "api" };
  }
  if (type === "oauth" && typeof clientId === "string" && clientId !== "") {
    return { credentialAuthType: "oauth", authenticatedClientId: clientId };
  }
  return undefined;
}

/** The evaluated document and link counts of a write summary. */
export interface EvaluatedCounts {
  evaluatedDocumentCount: number;
  evaluatedLinkCount: number;
}

/**
 * How an established enforced write attempt ended, for its summary: a
 * decided validation, an AD-7 policy-configuration rejection, or an abort in
 * AD-20 row 3 or 5.
 */
export type WriteAuditOutcome =
  | {
      kind: "decided";
      validation: WriteValidation;
      evaluated: EvaluatedCounts;
    }
  | { kind: "policy_rejection" }
  | { kind: "aborted"; row: 3 | 5 };

/** The outcomes of a committed write. */
const COMMITTED_OUTCOMES: ReadonlySet<unknown> = new Set([
  "validated",
  "validated_with_warnings",
  "degraded_validation",
]);

const NOT_EVALUATED: EvaluatedCounts = {
  evaluatedDocumentCount: 0,
  evaluatedLinkCount: 0,
};

/**
 * Counts the document unit of a write: one document, and its internal-link
 * references when `internal_links` is enabled, only when the unit completed,
 * that is, it ran document-surface rules and produced no System Failure.
 *
 * @param validated - the P5 validation.
 * @param rules - the classified policy's rules.
 * @returns the counts; zero when the unit did not complete.
 */
export function evaluatedCounts(
  validated: ProjectionValidation,
  rules: readonly RuleConfig[]
): EvaluatedCounts {
  const surface = documentSurfaceRules(rules);
  if (
    surface.length === 0 ||
    validated.items.some((item) => !("severity" in item.issue))
  ) {
    return NOT_EVALUATED;
  }
  return {
    evaluatedDocumentCount: 1,
    evaluatedLinkCount: surface.some((rule) => rule.kind === "internal_links")
      ? (validated.measures.linkReferences ?? 0)
      : 0,
  };
}

/**
 * Maps an established enforced write attempt to its closed AD-14 summary
 * data. The policy fields are the request-time identity of the valid
 * `enforced` policy, whether or not the actor can read the collection; a
 * write classified under an invalid-policy sentinel has none.
 *
 * @param input.requestId - the server-generated request ID.
 * @param input.operation - the write operation.
 * @param input.outcome - how the attempt ended.
 * @param input.durationMs - the elapsed time, in whole milliseconds.
 * @param input.policyFingerprint - the request-time policy fingerprint;
 *   omitted for a sentinel, which then omits both policy fields.
 * @param input.auth - the server-owned credential envelope.
 * @returns the summary data.
 */
export function writeAuditData(input: {
  requestId: string;
  operation: "create_document" | "update_document";
  outcome: WriteAuditOutcome;
  durationMs: number;
  policyFingerprint?: string;
  auth: AuthEnvelope;
}): AuditDataV1 {
  const { requestId, operation, outcome, durationMs, auth } = input;
  let summaryOutcome: AuditDataV1["outcome"];
  let complete = false;
  let evaluated = NOT_EVALUATED;
  let counts: AuditDataV1["counts"] = {
    errors: 0,
    warnings: 0,
    systemFailures: 0,
    byCode: {},
  };

  switch (outcome.kind) {
    case "decided": {
      const { validation } = outcome;
      const { status, errors, warnings, systemFailures } = validation;
      summaryOutcome = status;
      complete =
        status === "validated" ||
        status === "validated_with_warnings" ||
        (status === "rejected" && systemFailures.length === 0);
      evaluated = outcome.evaluated;
      const tally = new Map<IssueCode, number>();
      for (const { code } of [...errors, ...warnings, ...systemFailures]) {
        tally.set(code, (tally.get(code) ?? 0) + 1);
      }
      const byCode: AuditDataV1["counts"]["byCode"] = {};
      for (const code of [...tally.keys()].sort(compareUtf8)) {
        byCode[code] = tally.get(code);
      }
      counts = {
        errors: errors.length,
        warnings: warnings.length,
        systemFailures: systemFailures.length,
        byCode,
      };
      break;
    }
    case "policy_rejection":
      summaryOutcome = "rejected";
      counts = {
        errors: 0,
        warnings: 0,
        systemFailures: 1,
        byCode: { POLICY_CONFIGURATION_INVALID: 1 },
      };
      break;
    case "aborted":
      summaryOutcome =
        outcome.row === 3
          ? "aborted_before_decision"
          : "aborted_after_decision";
      break;
    default: {
      const unhandled: never = outcome;
      return unhandled;
    }
  }

  return {
    schemaVersion: 1,
    requestId,
    operation,
    outcome: summaryOutcome,
    complete,
    durationMs,
    scopeKind: "collection",
    ...(input.policyFingerprint !== undefined && {
      policySchemaVersion: 1 as const,
      policyFingerprint: input.policyFingerprint,
    }),
    evaluatedDocumentCount: evaluated.evaluatedDocumentCount,
    evaluatedLinkCount: evaluated.evaluatedLinkCount,
    counts,
    runtimeFailOpenExercised: summaryOutcome === "degraded_validation",
    credentialAuthType: auth.credentialAuthType,
    ...(auth.credentialAuthType === "oauth" && {
      authenticatedClientId: auth.authenticatedClientId,
    }),
  };
}

/**
 * Builds the `wikiLint.write_validation` Event row of an enforced write.
 *
 * @param input.invocationId - the invocation, the Event ID.
 * @param input.actor - the acting user.
 * @param input.sourceIp - the source IP, if any.
 * @param input.collectionId - the classified collection.
 * @param input.documentId - the document, only when its row exists.
 * @param input.data - the summary data.
 * @returns the row.
 */
export function writeAuditRow(input: {
  invocationId: string;
  actor: Pick<User, "id" | "teamId">;
  sourceIp: string | null;
  collectionId: string;
  documentId?: string;
  data: AuditDataV1;
}): AuditEventRow {
  return {
    id: input.invocationId,
    name: "wikiLint.write_validation",
    teamId: input.actor.teamId,
    actorId: input.actor.id,
    ip: input.sourceIp,
    collectionId: input.collectionId,
    ...(input.documentId !== undefined && { documentId: input.documentId }),
    data: input.data,
  };
}

/**
 * Records the summary of an enforced write, waiting at most
 * `AUDIT_WRITE_BOUND_MS`. Expiry and every error, including one thrown while
 * building the row, are an audit failure: logged once with only the
 * correlation identifiers and a reason, never affecting the outcome.
 *
 * @param row - the row, or a function that builds it.
 * @param correlation - the identifiers logged on failure.
 * @param correlation.requestId - the request ID, when it is valid.
 * @param correlation.invocationId - the invocation ID.
 * @param write - the Event writer.
 * @returns a promise that resolves once the write settles or its bound
 *   expires; it never rejects.
 */
export function recordWriteAudit(
  row: AuditEventRow | (() => AuditEventRow),
  correlation: { requestId: string | undefined; invocationId: string },
  write: AuditEventWriter = insertAuditEvent
): Promise<void> {
  return awaitAuditWrite(correlation, () =>
    write(typeof row === "function" ? row() : row, AUDIT_WRITE_BOUND_MS)
  );
}

/** The request-path inputs of an enforced write's summary. */
export interface RequestAuditInput {
  /** The `/mcp`-filled `AuthInfo.extra`, the only source of attribution. */
  extra: Record<string, unknown> | undefined;
  /** The handler's first monotonic clock reading. */
  enteredAt: number;
  /** The audit Event writer; defaults to `insertAuditEvent`. */
  write?: AuditEventWriter;
}

/**
 * Records the summary of an enforced write on the request path, waiting at
 * most `AUDIT_WRITE_BOUND_MS`. Attribution comes only from `extra`: an
 * invalid `requestId` or credential envelope is an audit failure, thrown
 * while building the row so that it is logged like any other. `durationMs`
 * is read when the write is initiated.
 *
 * @param input.extra - the `/mcp`-filled `AuthInfo.extra`.
 * @param input.enteredAt - the handler's first monotonic clock reading.
 * @param input.write - the audit Event writer.
 * @param input.invocationId - the invocation, the Event ID.
 * @param input.actor - the acting user.
 * @param input.operation - the write operation.
 * @param input.collectionId - the classified collection.
 * @param input.documentId - the document, only when its row exists.
 * @param input.policyFingerprint - the request-time policy fingerprint;
 *   omitted for a sentinel.
 * @param input.outcome - how the attempt ended.
 * @returns a promise that resolves once the write settles or its bound
 *   expires; it never rejects.
 */
export function recordRequestWriteAudit(
  input: RequestAuditInput & {
    invocationId: string;
    actor: Pick<User, "id" | "teamId">;
    operation: "create_document" | "update_document";
    collectionId: string;
    documentId?: string;
    policyFingerprint?: string;
    outcome: WriteAuditOutcome;
  }
): Promise<void> {
  const { extra, invocationId } = input;
  const candidate = extra?.requestId;
  const requestId =
    typeof candidate === "string" && UUID_PATTERN.test(candidate)
      ? candidate
      : undefined;
  return recordWriteAudit(
    () => {
      const auth = authEnvelopeOf(extra);
      if (requestId === undefined || auth === undefined) {
        throw new Error("Invalid audit attribution");
      }
      const durationMs = Math.max(
        0,
        Math.round(monotonicClock() - input.enteredAt)
      );
      if (!Number.isFinite(durationMs)) {
        throw new Error("Invalid audit duration");
      }
      return writeAuditRow({
        invocationId,
        actor: input.actor,
        sourceIp: typeof extra?.ip === "string" ? extra.ip : null,
        collectionId: input.collectionId,
        documentId: input.documentId,
        data: writeAuditData({
          requestId,
          operation: input.operation,
          outcome: input.outcome,
          durationMs,
          policyFingerprint: input.policyFingerprint,
          auth,
        }),
      });
    },
    { requestId, invocationId },
    input.write
  );
}

/**
 * Rebuilds the `validation` of a committed enforced write from its stored
 * summary: `status` is the stored outcome, `errors` and `warnings` are empty
 * because the original arrays are not recoverable, and `systemFailures` has
 * one fixed-message entry per counted result System Failure code, located at
 * the classified collection. The policy identity and the location's
 * `collectionId` appear only for a reader of the collection.
 *
 * @param summary - the stored summary data, if any.
 * @param identity.readable - whether the actor can read the collection.
 * @param identity.collectionId - the classified collection.
 * @param identity.policyFingerprint - the classified policy fingerprint.
 * @returns the validation; undefined unless the summary is a committed one.
 */
export function validationFromSummary(
  summary: unknown,
  identity: {
    readable: boolean;
    collectionId: string;
    policyFingerprint: string;
  }
): WriteValidation | undefined {
  try {
    const data = summary as Partial<AuditDataV1> | null;
    const byCode = data?.counts?.byCode as Record<string, unknown> | undefined;
    if (
      !data ||
      !COMMITTED_OUTCOMES.has(data.outcome) ||
      typeof byCode !== "object" ||
      byCode === null
    ) {
      return undefined;
    }
    const { readable, collectionId, policyFingerprint } = identity;
    const location: ScopeLocation = {
      kind: "scope",
      scopeKind: "collection",
      ...(readable && { collectionId }),
    };
    const items: IssueItem<SystemFailure>[] = [];
    for (const [code, count] of Object.entries(byCode)) {
      const definition = getIssueDefinition(code);
      if (
        typeof count === "number" &&
        count > 0 &&
        definition?.class === "system_failure" &&
        definition.surfaces !== "startup_diagnostics_only"
      ) {
        items.push({
          issue: createSystemFailure(code as SystemFailureCode, location),
          sortCollectionId: collectionId,
        });
      }
    }
    return {
      status: data.outcome as WriteValidation["status"],
      ...(readable && {
        policySchemaVersion: 1 as const,
        policyFingerprint,
      }),
      errors: [],
      warnings: [],
      systemFailures: sortIssues(items),
    };
  } catch {
    return undefined;
  }
}
