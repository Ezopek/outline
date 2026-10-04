import { randomUUID } from "node:crypto";
import FileStorage from "@server/storage/files";
import type { APIContext } from "@server/types";
import type { AuditEventWriter } from "../adapters/auditEvents";
import { probeImport } from "../adapters/writeTransaction";
import type { WriteValidation } from "../core/contracts";
import { UUID_PATTERN } from "../core/registry";
import {
  COMMIT_PROBE_BOUND_MS,
  Deadline,
  ENFORCED_IMPORT_WAIT_MS,
  POST_COMMIT_ASSEMBLY_BOUND_MS,
  WRITE_PREPARATION_BOUND_MS,
  monotonicClock,
  within,
} from "./deadline";
import type {
  EnforcedImportIntent,
  EnforcedImportResult,
} from "./enforcedImport";
import {
  deleteStagedSource,
  parseEnforcedImportIntent,
  parseEnforcedImportResult,
  stagedSourceKey,
} from "./enforcedImport";
import type {
  EnforcedClassification,
  EnforcedWriteOutcome,
} from "./enforcedWrite";
import {
  authEnvelopeOf,
  recordWriteAudit,
  validationFromSummary,
  writeAuditData,
  writeAuditRow,
} from "./writeAudit";
import { abortMessage } from "./writeDecision";

/**
 * The AD-20 row an enforced HTML create ends in. A committed create carries
 * its document ID instead of the document, and its post-commit assembly
 * deadline, started once the outcome was known.
 */
export type EnforcedHtmlOutcome =
  | Exclude<EnforcedWriteOutcome, { row: 6 }>
  | {
      row: 6;
      documentId: string;
      validation: WriteValidation;
      assembly: Deadline;
    };

/** The HTML create arguments, as the MCP handler maps them. */
export interface HtmlCreateArguments {
  title?: string;
  text?: string;
  icon?: string;
  color?: string;
  fullWidth?: boolean;
  publish: boolean;
  parentDocumentId?: string;
  sourceFileName?: string;
}

/** Schedules the enforced import job of an intent. */
export type EnforcedImportScheduler = (
  intent: EnforcedImportIntent
) => Promise<{ finished(): Promise<unknown> }>;

/** Thrown when the staging of the source does not finish within its bound. */
class StagingExpiredError extends Error {
  name = "StagingExpiredError";

  constructor() {
    super("The source was not staged in time");
  }
}

/** Thrown when the server-owned attribution of a write is invalid. */
class InvalidAttributionError extends Error {
  name = "InvalidAttributionError";

  constructor() {
    super("Invalid audit attribution");
  }
}

/** Thrown at a cancellation check when the handler's signal was aborted. */
class RequestCancelledError extends Error {
  name = "RequestCancelledError";

  constructor() {
    super("The write was cancelled");
  }
}

const NO_RESULT = Symbol("no result");

/**
 * Waits for a promise until a deadline or the handler's cancellation,
 * whichever is first.
 *
 * @param promise - the promise.
 * @param deadline - the deadline.
 * @param signal - the handler's signal, if any.
 * @returns the promise's value, or `NO_RESULT` on a rejection, expiry, or
 *   cancellation.
 */
async function waitFor<T>(
  promise: Promise<T>,
  deadline: Deadline,
  signal: AbortSignal | undefined
): Promise<T | typeof NO_RESULT> {
  if (signal?.aborted || deadline.expired()) {
    promise.catch(() => undefined);
    return NO_RESULT;
  }
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<typeof NO_RESULT>((resolve) => {
    onAbort = () => resolve(NO_RESULT);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await within(
      Promise.race([promise.catch((): typeof NO_RESULT => NO_RESULT), aborted]),
      deadline.remainingMs(),
      NO_RESULT
    );
  } finally {
    if (onAbort) {
      signal?.removeEventListener("abort", onAbort);
    }
  }
}

/**
 * Requests an enforced MCP HTML create classified under a valid `enforced`
 * policy (AD-7): it stages the source, schedules the distinct worker task
 * with a credential-free trusted intent, and waits for its result until
 * `deadlineAt`. Before reporting anything but a commit, it probes the
 * pre-allocated document once. It writes a summary only for a row 3 it
 * determines before scheduling, and then deletes the staged source itself.
 *
 * @param args.ctx - the handler's API context.
 * @param args.classification - the enforced classification, with the
 *   pre-allocated document ID.
 * @param args.input - the create arguments, as the handler maps them.
 * @param args.extra - the `/mcp`-filled `AuthInfo.extra`.
 * @param args.enteredAt - the monotonic clock reading at handler entry.
 * @param args.enteredAtEpochMs - the epoch milliseconds at handler entry.
 * @param args.signal - the handler's cancellation signal.
 * @param args.schedule - schedules the job.
 * @param args.write - the audit Event writer.
 * @returns the row the create ended in.
 */
export async function enforceHtmlCreate(args: {
  ctx: APIContext;
  classification: EnforcedClassification;
  input: HtmlCreateArguments;
  extra: Record<string, unknown> | undefined;
  enteredAt: number;
  enteredAtEpochMs: number;
  signal?: AbortSignal;
  schedule: EnforcedImportScheduler;
  write?: AuditEventWriter;
}): Promise<EnforcedHtmlOutcome> {
  const classifiedAtEpochMs = Date.now();
  const wait = new Deadline(ENFORCED_IMPORT_WAIT_MS, monotonicClock);
  const preparation = new Deadline(WRITE_PREPARATION_BOUND_MS, monotonicClock);
  const { ctx, classification, input, extra, signal } = args;
  const { entry, readable, documentId } = classification;
  const { collectionId, policyFingerprint } = entry;
  const actor = ctx.state.auth.user;
  const invocationId = randomUUID();
  const key = stagedSourceKey(invocationId, actor.id);
  const candidate = extra?.requestId;
  const requestId =
    typeof candidate === "string" && UUID_PATTERN.test(candidate)
      ? candidate
      : undefined;
  const auth = authEnvelopeOf(extra);
  const sourceIp = typeof extra?.ip === "string" ? extra.ip : null;

  /**
   * Ends the create in row 3 before scheduling: deletes the staged source
   * and records the one requester summary.
   *
   * @param error - the failure.
   * @returns the row.
   */
  const abortBeforeSchedule = async (
    error: unknown
  ): Promise<EnforcedHtmlOutcome> => {
    await deleteStagedSource(key);
    const durationMs = Math.max(
      0,
      Math.round(monotonicClock() - args.enteredAt)
    );
    await recordWriteAudit(
      () => {
        if (requestId === undefined || auth === undefined) {
          throw new InvalidAttributionError();
        }
        return writeAuditRow({
          invocationId,
          actor,
          sourceIp,
          collectionId,
          data: writeAuditData({
            requestId,
            operation: "create_document",
            outcome: { kind: "aborted", row: 3 },
            durationMs,
            policyFingerprint,
            auth,
          }),
        });
      },
      { requestId, invocationId },
      args.write
    );
    return { row: 3, message: abortMessage(error) };
  };

  let intent: EnforcedImportIntent;
  try {
    if (requestId === undefined || auth === undefined || !documentId) {
      throw new InvalidAttributionError();
    }
    if (signal?.aborted) {
      throw new RequestCancelledError();
    }
    const body = Buffer.from(input.text ?? "", "utf8");
    const staged = await within(
      FileStorage.store({
        body,
        contentLength: body.length,
        contentType: "text/html",
        key,
        acl: "private",
      }).then(() => true),
      preparation.remainingMs(),
      false
    );
    if (!staged) {
      throw new StagingExpiredError();
    }
    intent = parseEnforcedImportIntent({
      requestId,
      invocationId,
      actorId: actor.id,
      sourceIp,
      documentId,
      expectedPolicyFingerprint: policyFingerprint,
      readable,
      handlerEnteredAtEpochMs: args.enteredAtEpochMs,
      classifiedAtEpochMs,
      deadlineAt: classifiedAtEpochMs + ENFORCED_IMPORT_WAIT_MS,
      authEnvelope: auth,
      key,
      sourceMetadata: {
        fileName: input.sourceFileName ?? "document.html",
        mimeType: "text/html",
      },
      ...(input.title !== undefined && { title: input.title }),
      ...(input.icon !== undefined && { icon: input.icon }),
      ...(input.color !== undefined && { color: input.color }),
      ...(input.fullWidth !== undefined && { fullWidth: input.fullWidth }),
      publish: input.publish,
      collectionId,
      ...(input.parentDocumentId !== undefined && {
        parentDocumentId: input.parentDocumentId,
      }),
    });
    if (signal?.aborted) {
      throw new RequestCancelledError();
    }
  } catch (error) {
    return abortBeforeSchedule(error);
  }

  // The worker owns the source and the summary from here on.
  let result: EnforcedImportResult | undefined;
  const job = await waitFor(
    Promise.resolve().then(() => args.schedule(intent)),
    wait,
    signal
  );
  if (job !== NO_RESULT) {
    const value = await waitFor(
      Promise.resolve().then(() => job.finished()),
      wait,
      signal
    );
    if (value !== NO_RESULT) {
      result = parseEnforcedImportResult(value, intent);
    }
  }
  if (result?.kind === "committed") {
    return {
      row: 6,
      documentId: result.documentId,
      validation: result.validation,
      assembly: new Deadline(POST_COMMIT_ASSEMBLY_BOUND_MS, monotonicClock),
    };
  }

  // One probe, never retried, before any other report.
  const probe = await probeImport(
    intent.documentId,
    invocationId,
    COMMIT_PROBE_BOUND_MS
  );
  if (typeof probe === "object") {
    const validation = validationFromSummary(probe.summary, {
      readable,
      collectionId,
      policyFingerprint,
    });
    return validation
      ? {
          row: 6,
          documentId: intent.documentId,
          validation,
          assembly: new Deadline(POST_COMMIT_ASSEMBLY_BOUND_MS, monotonicClock),
        }
      : { row: 7 };
  }
  switch (result?.kind) {
    case "rejected":
      return { row: 4, validation: result.validation };
    case "conflict":
      return { row: 2 };
    case "aborted":
      return { row: result.row, message: result.message };
    default:
      return { row: 7 };
  }
}
