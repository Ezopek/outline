import Logger from "@server/logging/Logger";
import type { User } from "@server/models";
import type {
  AuditDataV1,
  AuditEventRow,
  AuditEventWriter,
} from "../adapters/auditEvents";
import { insertAuditEvent } from "../adapters/auditEvents";
import type { IssueCode } from "../core/contracts";
import { compareUtf8 } from "../core/ordering";
import { UUID_PATTERN } from "../core/registry";
import type { MonotonicClock } from "./deadline";
import { AUDIT_WRITE_BOUND_MS } from "./deadline";
import type { LintDocumentOutcome } from "./lintDocument";

/** A read-only lint operation. */
export type ReadOperation = AuditDataV1["operation"];

/** The outcome of a lint invocation that returned a lint result. */
export type ReadResultOutcome = Extract<
  LintDocumentOutcome,
  { kind: "result" }
>;

/** The server-owned attribution of an invocation, from `AuthInfo.extra`. */
interface ReadAttribution {
  requestId: string;
  credentialAuthType: AuditDataV1["credentialAuthType"];
  /** Read only for an OAuth credential; anything else is ignored. */
  authenticatedClientId?: unknown;
}

/**
 * Maps a lint result to its closed AD-14 summary data.
 *
 * @param input.operation - the lint operation.
 * @param input.outcome - the lint result and, for `lint_document`, the valid
 *   policy identity of the document's collection.
 * @param input.attribution - the server-owned request attribution.
 * @param input.durationMs - the elapsed handler time, in whole milliseconds.
 * @returns the summary data.
 */
export function readAuditData(input: {
  operation: ReadOperation;
  outcome: ReadResultOutcome;
  attribution: ReadAttribution;
  durationMs: number;
}): AuditDataV1 {
  const { operation, outcome, attribution, durationMs } = input;
  const { result, auditPolicy } = outcome;
  const { scope } = result;
  const { requestId, credentialAuthType, authenticatedClientId } = attribution;

  // A document scope takes the identity reported beside the result, so the
  // summary does not depend on whether the actor can read the collection; a
  // collection scope is always actor-readable.
  const policy =
    scope.kind === "document"
      ? auditPolicy
      : scope.kind === "collection"
        ? result.policies[0]
        : undefined;
  const evaluated =
    scope.kind === "configured_collections" ? scope.collections : [scope];

  const tally = new Map<IssueCode, number>();
  for (const { code } of [
    ...result.errors,
    ...result.warnings,
    ...result.systemFailures,
  ]) {
    tally.set(code, (tally.get(code) ?? 0) + 1);
  }
  const byCode: AuditDataV1["counts"]["byCode"] = {};
  for (const code of [...tally.keys()].sort(compareUtf8)) {
    byCode[code] = tally.get(code);
  }

  let readOutcome: AuditDataV1["outcome"];
  if (result.state === "complete") {
    readOutcome = result.errors.length === 0 ? "clean" : "findings";
  } else {
    readOutcome = result.state;
  }

  return {
    schemaVersion: 1,
    requestId,
    operation,
    outcome: readOutcome,
    complete: result.complete,
    durationMs,
    scopeKind: scope.kind,
    ...(policy?.status === "valid"
      ? {
          policySchemaVersion: policy.policySchemaVersion,
          policyFingerprint: policy.policyFingerprint,
        }
      : {}),
    evaluatedDocumentCount: evaluated.reduce(
      (sum, entry) => sum + entry.evaluatedDocumentCount,
      0
    ),
    evaluatedLinkCount: evaluated.reduce(
      (sum, entry) => sum + entry.evaluatedLinkCount,
      0
    ),
    counts: {
      errors: result.errors.length,
      warnings: result.warnings.length,
      systemFailures: result.systemFailures.length,
      byCode,
    },
    runtimeFailOpenExercised: false,
    credentialAuthType,
    ...(credentialAuthType === "oauth" &&
    typeof authenticatedClientId === "string" &&
    authenticatedClientId !== ""
      ? { authenticatedClientId }
      : {}),
  };
}

/**
 * Builds the audit Event row of a lint result. Attribution comes only from
 * the server-filled `AuthInfo.extra`.
 *
 * @param input - see `recordReadAudit`.
 * @param requestId - the validated request identity.
 * @returns the row.
 * @throws when the attribution or the clock reading is invalid.
 */
function readAuditRow(
  input: Parameters<typeof recordReadAudit>[0],
  requestId: string
): AuditEventRow {
  const { operation, outcome, actor, extra, invocationId, enteredAt, clock } =
    input;
  const credentialAuthType = extra?.credentialAuthType;
  if (credentialAuthType !== "oauth" && credentialAuthType !== "api") {
    throw new Error("Invalid audit attribution");
  }
  const durationMs = Math.max(0, Math.round(clock() - enteredAt));
  if (!Number.isFinite(durationMs)) {
    throw new Error("Invalid audit duration");
  }

  const { scope } = outcome.result;
  return {
    id: invocationId,
    name: operation === "lint_document" ? "wikiLint.document" : "wikiLint.wiki",
    teamId: actor.teamId,
    actorId: actor.id,
    ip: typeof extra?.ip === "string" ? extra.ip : null,
    ...(scope.kind === "document" ? { documentId: scope.documentId } : {}),
    ...(scope.kind === "collection"
      ? { collectionId: scope.collectionId }
      : {}),
    data: readAuditData({
      operation,
      outcome,
      attribution: {
        requestId,
        credentialAuthType,
        authenticatedClientId: extra?.authenticatedClientId,
      },
      durationMs,
    }),
  };
}

/**
 * Records the audit summary of a lint result, waiting at most
 * `AUDIT_WRITE_BOUND_MS`. Expiry and every error, including invalid
 * attribution and a failing clock, are an audit failure: it is logged once
 * with only the correlation identifiers and a reason, and never affects the
 * caller. Expiry stops the wait, not the write's transaction, so `timeout`
 * means the outcome is unknown: the summary may still be stored later.
 *
 * @param input.operation - the lint operation.
 * @param input.outcome - the lint result outcome.
 * @param input.actor - the acting user.
 * @param input.extra - the `AuthInfo.extra` filled by the `/mcp` route.
 * @param input.invocationId - the invocation identity, used as the Event ID.
 * @param input.enteredAt - the first clock reading of the tool handler.
 * @param input.clock - the handler's monotonic clock.
 * @param write - the Event writer.
 * @returns a promise that resolves once the write settles or its bound
 *   expires; it never rejects.
 */
export async function recordReadAudit(
  input: {
    operation: ReadOperation;
    outcome: ReadResultOutcome;
    actor: User;
    extra: Record<string, unknown> | undefined;
    invocationId: string;
    enteredAt: number;
    clock: MonotonicClock;
  },
  write: AuditEventWriter = insertAuditEvent
): Promise<void> {
  const { invocationId } = input;
  let requestId: string | undefined;
  let timer: NodeJS.Timeout | undefined;

  /**
   * Logs the audit failure; a logging failure is ignored.
   *
   * @param reason - whether the bound expired or an error occurred.
   */
  const warn = (reason: "timeout" | "error") => {
    try {
      Logger.warn("Wiki lint audit write failed", {
        requestId,
        invocationId,
        reason,
      });
    } catch {
      // The audit step never rejects.
    }
  };

  try {
    const candidate = input.extra?.requestId;
    if (typeof candidate !== "string" || !UUID_PATTERN.test(candidate)) {
      throw new Error("Invalid audit attribution");
    }
    requestId = candidate;

    const pending = Promise.resolve(
      write(readAuditRow(input, requestId), AUDIT_WRITE_BOUND_MS)
    );
    pending.catch(() => undefined);
    const expiry = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), AUDIT_WRITE_BOUND_MS);
    });
    if (
      (await Promise.race([pending.then(() => "ok" as const), expiry])) ===
      "timeout"
    ) {
      warn("timeout");
    }
  } catch {
    warn("error");
  } finally {
    clearTimeout(timer);
  }
}
