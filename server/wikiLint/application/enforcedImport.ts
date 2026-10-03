import { isDeepStrictEqual } from "node:util";
import { QueryTypes } from "sequelize";
import { z } from "zod";
import { authorizeDocumentCreate } from "@server/commands/documentCreator";
import documentImporter from "@server/commands/documentImporter";
import { createContext } from "@server/context";
import env from "@server/env";
import { User } from "@server/models";
import AttachmentHelper from "@server/models/helpers/AttachmentHelper";
import { sequelize } from "@server/storage/database";
import FileStorage from "@server/storage/files";
import type { APIContext } from "@server/types";
import { AuthenticationType } from "@server/types";
import type { AuditEventWriter } from "../adapters/auditEvents";
import type { PreparedMarkdownCreate } from "../adapters/documentProjection";
import {
  prepareHtmlCreate,
  projectMarkdownCreate,
  refuseImportableMedia,
} from "../adapters/documentProjection";
import { getPolicySet } from "../adapters/policyConfig";
import {
  isPreallocatedIdConflict,
  persistProjectedCreate,
} from "../adapters/projectionWriter";
import { probeCommit, readWriteSummary } from "../adapters/writeTransaction";
import type {
  Finding,
  SystemFailure,
  WriteValidation,
} from "../core/contracts";
import { WikiLintContractError } from "../core/contracts";
import {
  OPERATION_FAILED,
  UUID_PATTERN,
  createFinding,
  createSystemFailure,
} from "../core/registry";
import {
  AUDIT_WRITE_BOUND_MS,
  COMMIT_PROBE_BOUND_MS,
  Deadline,
  ENFORCED_IMPORT_WAIT_MS,
  SET_LOCAL_FLOOR_MS,
  WRITE_PERSISTENCE_BUDGET_MS,
  WRITE_PREPARATION_BOUND_MS,
  monotonicClock,
  within,
} from "./deadline";
import type {
  EnforcedClassification,
  ProjectionValidation,
} from "./enforcedWrite";
import { runAttempt } from "./enforcedWrite";
import type { WriteAuditOutcome } from "./writeAudit";
import {
  evaluatedCounts,
  recordWriteAudit,
  validationFromSummary,
  writeAuditData,
  writeAuditRow,
} from "./writeAudit";
import { abortMessage, decideWrite } from "./writeDecision";

/**
 * Returns the file storage key an enforced HTML create stages its source
 * under: private to the actor and unique to the invocation.
 *
 * @param invocationId - the invocation.
 * @param actorId - the acting user.
 * @returns the key.
 */
export const stagedSourceKey = (invocationId: string, actorId: string) =>
  AttachmentHelper.getKey({
    id: invocationId,
    name: "source.html",
    userId: actorId,
  });

/** The bound, in milliseconds, of one deletion of a staged source. */
const STAGED_SOURCE_DELETE_BOUND_MS = 1000;

/**
 * Deletes a staged source, idempotently and within a bound; errors and
 * expiry are ignored, and a deletion that lands later changes nothing.
 *
 * @param key - the staged source's key.
 * @returns a promise that never rejects.
 */
export async function deleteStagedSource(key: string): Promise<void> {
  await within(
    Promise.resolve()
      .then(() => FileStorage.deleteFile(key))
      .catch(() => undefined),
    STAGED_SOURCE_DELETE_BOUND_MS,
    undefined
  );
}

const uuid = z.string().regex(UUID_PATTERN);

const epochMs = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const intentSchema = z
  .strictObject({
    requestId: uuid,
    invocationId: uuid,
    actorId: uuid,
    sourceIp: z.string().nullable(),
    documentId: uuid,
    expectedPolicyFingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    readable: z.boolean(),
    handlerEnteredAtEpochMs: epochMs,
    classifiedAtEpochMs: epochMs,
    deadlineAt: epochMs,
    authEnvelope: z.discriminatedUnion("credentialAuthType", [
      z.strictObject({ credentialAuthType: z.literal("api") }),
      z.strictObject({
        credentialAuthType: z.literal("oauth"),
        authenticatedClientId: z.string().min(1),
      }),
    ]),
    key: z.string().min(1),
    sourceMetadata: z.strictObject({
      fileName: z.string(),
      mimeType: z.literal("text/html"),
    }),
    title: z.string().optional(),
    icon: z.string().optional(),
    color: z.string().optional(),
    fullWidth: z.boolean().optional(),
    publish: z.boolean(),
    collectionId: uuid,
    parentDocumentId: z.string().optional(),
  })
  .refine(
    (intent) =>
      intent.key === stagedSourceKey(intent.invocationId, intent.actorId)
  );

/**
 * The credential-free trusted intent of an enforced HTML create (AD-7). Its
 * identity and attribution come only from the authenticated user and the
 * `/mcp`-filled `AuthInfo.extra`; the create inputs are those the baseline
 * passes to its import job, with the staged source in place of the content.
 */
export type EnforcedImportIntent = z.infer<typeof intentSchema>;

/**
 * Validates an enforced HTML create intent against its closed schema.
 *
 * @param value - the candidate intent.
 * @returns the intent.
 * @throws the schema error when it is not a valid intent.
 */
export function parseEnforcedImportIntent(
  value: unknown
): EnforcedImportIntent {
  return intentSchema.parse(value);
}

/** The closed result union of an enforced HTML job (AD-7). */
export type EnforcedImportResult =
  | { kind: "committed"; documentId: string; validation: WriteValidation }
  | { kind: "rejected"; validation: WriteValidation }
  | { kind: "conflict" }
  | { kind: "aborted"; row: 3 | 5; message: string };

/** A Finding exactly as the registry builds it. */
const findingSchema = z.custom<Finding>((value) => {
  try {
    const { code, location, detail } = value as Finding;
    return isDeepStrictEqual(createFinding(code, location, detail), value);
  } catch {
    return false;
  }
});

/** A System Failure exactly as the registry builds it. */
const systemFailureSchema = z.custom<SystemFailure>((value) => {
  try {
    const { code, location } = value as SystemFailure;
    return isDeepStrictEqual(createSystemFailure(code, location), value);
  } catch {
    return false;
  }
});

const validationSchema = z.strictObject({
  status: z.enum([
    "validated",
    "validated_with_warnings",
    "degraded_validation",
    "rejected",
  ]),
  policySchemaVersion: z.literal(1).optional(),
  policyFingerprint: z.string().optional(),
  errors: z.array(findingSchema),
  warnings: z.array(findingSchema),
  systemFailures: z.array(systemFailureSchema),
});

const resultSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("committed"),
    documentId: uuid,
    validation: validationSchema,
  }),
  z.strictObject({ kind: z.literal("rejected"), validation: validationSchema }),
  z.strictObject({ kind: z.literal("conflict") }),
  z.strictObject({
    kind: z.literal("aborted"),
    row: z.union([z.literal(3), z.literal(5)]),
    message: z.string().min(1),
  }),
]);

/**
 * Validates a job's return value against the closed result union and the
 * intent: a committed result names the pre-allocated document and does not
 * reject, a rejected one rejects, and a `validation` carries the request-time
 * policy identity exactly when the actor can read the collection.
 *
 * @param value - the job's return value.
 * @param intent - the job's intent.
 * @returns the result as returned; undefined when it is not a valid result.
 */
export function parseEnforcedImportResult(
  value: unknown,
  intent: EnforcedImportIntent
): EnforcedImportResult | undefined {
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success) {
    return undefined;
  }
  const result = parsed.data;
  if (result.kind === "committed" || result.kind === "rejected") {
    const { status, policySchemaVersion, policyFingerprint } =
      result.validation;
    const identityMatches = intent.readable
      ? policySchemaVersion === 1 &&
        policyFingerprint === intent.expectedPolicyFingerprint
      : policySchemaVersion === undefined && policyFingerprint === undefined;
    if (
      !identityMatches ||
      (result.kind === "committed"
        ? result.documentId !== intent.documentId || status === "rejected"
        : status !== "rejected")
    ) {
      return undefined;
    }
  }
  return value as EnforcedImportResult;
}

/**
 * Thrown by the worker when the outcome of an enforced HTML create cannot be
 * established, so that the requester sees no result (AD-20 row 7).
 */
export class UnestablishedImportError extends Error {
  name = "UnestablishedImportError";

  constructor() {
    super("The enforced import outcome could not be established");
  }
}

/** Thrown in P2 when the preparation bound expired. */
class PreparationExpiredError extends Error {
  name = "PreparationExpiredError";

  constructor() {
    super("The preparation bound expired");
  }
}

/**
 * Thrown in P2 when the staged source cannot be read; it carries no storage
 * detail, so the message is the fixed one.
 */
class MissingSourceError extends Error {
  name = "MissingSourceError";

  constructor() {
    super("The staged source cannot be read");
  }
}

/** Thrown in P3 when the pre-allocated document already exists. */
class PreallocatedDocumentExistsError extends Error {
  name = "PreallocatedDocumentExistsError";

  constructor() {
    super("The pre-allocated document already exists");
  }
}

/** The interval, in milliseconds, between the worker's summary reads. */
const SUMMARY_POLL_INTERVAL_MS = 100;

const EXPIRED = Symbol("expired");

/** A result that does not claim a commit. */
type NonCommittedResult = Exclude<EnforcedImportResult, { kind: "committed" }>;

/**
 * Resolves a found pre-allocated document through its committed summary:
 * reads it by invocation ID, in fresh short reads about every 100 ms, until
 * the probe bound. Only a `validated`, `validated_with_warnings`, or
 * `degraded_validation` summary counts.
 *
 * @param intent - the job's intent.
 * @returns the status-only committed result.
 * @throws UnestablishedImportError when no committed summary is read within
 *   the bound.
 */
export async function committedFromSummary(
  intent: EnforcedImportIntent
): Promise<Extract<EnforcedImportResult, { kind: "committed" }>> {
  const deadline = new Deadline(COMMIT_PROBE_BOUND_MS, monotonicClock);
  const identity = {
    readable: intent.readable,
    collectionId: intent.collectionId,
    policyFingerprint: intent.expectedPolicyFingerprint,
  };
  while (Math.floor(deadline.remainingMs()) >= SET_LOCAL_FLOOR_MS) {
    const validation = validationFromSummary(
      await readWriteSummary(intent.invocationId, deadline.remainingMs()),
      identity
    );
    if (validation) {
      return { kind: "committed", documentId: intent.documentId, validation };
    }
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.max(0, Math.min(SUMMARY_POLL_INTERVAL_MS, deadline.remainingMs()))
      )
    );
  }
  throw new UnestablishedImportError();
}

/**
 * Builds the AD-12 rejection of an AD-7 fingerprint mismatch through the
 * fail-closed decision: the request-time identity and the location's
 * `collectionId` only for a reader, no Findings, and one
 * `POLICY_CONFIGURATION_INVALID`.
 *
 * @param intent - the job's intent.
 * @returns the validation.
 * @throws WikiLintContractError when the decision is not `rejected`.
 */
function mismatchValidation(intent: EnforcedImportIntent): WriteValidation {
  const { readable, collectionId } = intent;
  const systemFailures = [
    createSystemFailure("POLICY_CONFIGURATION_INVALID", {
      kind: "scope",
      scopeKind: "collection",
      ...(readable && { collectionId }),
    }),
  ];
  const status = decideWrite({
    errors: [],
    warnings: [],
    systemFailures,
    runtimeFailureMode: "closed",
    withinLimits: false,
    halfDeadlineAtP5: false,
  });
  if (status !== "rejected") {
    throw new WikiLintContractError("A policy mismatch must reject the write");
  }
  return {
    status,
    ...(readable && {
      policySchemaVersion: 1 as const,
      policyFingerprint: intent.expectedPolicyFingerprint,
    }),
    errors: [],
    warnings: [],
    systemFailures,
  };
}

/**
 * Runs an enforced HTML create on the worker (AD-7). It looks up the
 * pre-allocated document first, then reloads the actor, re-authorizes the
 * destination, checks the collection, and compares the policy fingerprint,
 * and only then converts the staged source and runs the shared attempt. It
 * owns the decision, the commit, and the write summary, deletes the staged
 * source when it returns, and returns `aborted` by phase for every failure
 * of its own code.
 *
 * @param value - the job's intent.
 * @param dependencies.write - the audit Event writer.
 * @returns the closed result.
 * @throws UnestablishedImportError when the outcome cannot be established.
 */
export async function runEnforcedImport(
  value: unknown,
  dependencies: { write?: AuditEventWriter } = {}
): Promise<EnforcedImportResult> {
  const jobStartedAtEpochMs = Date.now();
  const jobStartedAt = monotonicClock();
  let intent: EnforcedImportIntent;
  try {
    intent = parseEnforcedImportIntent(value);
  } catch {
    return { kind: "aborted", row: 3, message: OPERATION_FAILED };
  }
  // The job's remainder until `deadlineAt`, and the preparation bound
  // measured from classification, so that queue wait is charged to it.
  // Each is capped at its code-owned bound when the clocks disagree.
  const job = new Deadline(
    Math.min(ENFORCED_IMPORT_WAIT_MS, intent.deadlineAt - jobStartedAtEpochMs),
    monotonicClock
  );
  const preparation = new Deadline(
    WRITE_PREPARATION_BOUND_MS -
      Math.max(0, jobStartedAtEpochMs - intent.classifiedAtEpochMs),
    monotonicClock
  );
  const { requestId, invocationId, documentId, collectionId } = intent;
  const target = { kind: "document", documentId } as const;
  let user: User | undefined;
  let validated: ProjectionValidation | undefined;
  let decided = false;
  let ownConflict: WriteValidation | undefined;
  let committedSummary: Promise<void> | undefined;

  /**
   * Records the attempt's summary. Its duration adds the queue wait to the
   * worker's monotonic time; the actor is reloaded for it when the attempt
   * ended before loading it.
   *
   * @param outcome - how the attempt ended.
   * @param committed - whether the document row exists.
   * @returns a promise that never rejects.
   */
  const summarize = async (
    outcome: WriteAuditOutcome,
    committed: boolean
  ): Promise<void> => {
    const durationMs = Math.max(
      0,
      Math.round(
        jobStartedAtEpochMs -
          intent.handlerEnteredAtEpochMs +
          (monotonicClock() - jobStartedAt)
      )
    );
    const actor =
      user ??
      (await within(
        User.findByPk(intent.actorId, { paranoid: false }).catch(() => null),
        AUDIT_WRITE_BOUND_MS,
        null
      ));
    await recordWriteAudit(
      () => {
        if (!actor) {
          throw new Error("The actor is unavailable");
        }
        return writeAuditRow({
          invocationId,
          actor,
          sourceIp: intent.sourceIp,
          collectionId,
          ...(committed && { documentId }),
          data: writeAuditData({
            requestId,
            operation: "create_document",
            outcome,
            durationMs,
            policyFingerprint: intent.expectedPolicyFingerprint,
            auth: intent.authEnvelope,
          }),
        });
      },
      { requestId, invocationId },
      dependencies.write
    );
  };

  /**
   * Builds the summary outcome of a decided validation.
   *
   * @param validation - the decided validation.
   * @param rules - the policy's rules.
   * @returns the summary outcome.
   */
  const decidedSummary = (
    validation: WriteValidation,
    rules: EnforcedClassification["entry"]["policy"]["rules"]
  ): WriteAuditOutcome => ({
    kind: "decided",
    validation,
    evaluated: validated
      ? evaluatedCounts(validated, rules)
      : { evaluatedDocumentCount: 0, evaluatedLinkCount: 0 },
  });

  /** Deletes the staged source, idempotently and within a bound. */
  const deleteSource = () => deleteStagedSource(intent.key);

  /**
   * Ends the attempt in a non-committed outcome. The pre-allocated document
   * is looked up again first: a found row converts the outcome through the
   * committed summary and writes no summary of its own.
   *
   * @param result - the outcome.
   * @param summary - the summary outcome; none for a conflict.
   * @returns the result the job returns.
   * @throws UnestablishedImportError when a found row has no committed
   *   summary.
   */
  const finish = async (
    result: NonCommittedResult,
    summary: WriteAuditOutcome | undefined
  ): Promise<EnforcedImportResult> => {
    if ((await probeCommit(target, COMMIT_PROBE_BOUND_MS)) === "present") {
      const found = await committedFromSummary(intent);
      await deleteSource();
      return found;
    }
    if (summary) {
      await summarize(summary, false);
    }
    await deleteSource();
    return result;
  };

  /**
   * Builds a row 3 or row 5 abort and its summary outcome.
   *
   * @param row - the row.
   * @param message - the AD-20 message.
   * @returns the arguments of `finish`.
   */
  const aborted = (
    row: 3 | 5,
    message: string
  ): [NonCommittedResult, WriteAuditOutcome] => [
    { kind: "aborted", row, message },
    { kind: "aborted", row },
  ];

  let failure: [NonCommittedResult, WriteAuditOutcome | undefined];
  try {
    // A row found before any work was done.
    const lookup = await probeCommit(target, COMMIT_PROBE_BOUND_MS);
    if (lookup === "present") {
      const found = await committedFromSummary(intent);
      await deleteSource();
      return found;
    }
    if (lookup === "unavailable") {
      return await finish(...aborted(3, OPERATION_FAILED));
    }

    // Reload the actor, re-authorize the destination, check the collection,
    // and compare the policy fingerprint, in this order.
    let authorized:
      | { actor: User; ctx: APIContext; classification: EnforcedClassification }
      | undefined;
    let pending: [NonCommittedResult, WriteAuditOutcome | undefined] = aborted(
      3,
      OPERATION_FAILED
    );
    try {
      const actor = await User.findByPk(intent.actorId, {
        rejectOnEmpty: true,
      });
      user = actor;
      const ctx = createContext({
        user: actor,
        authType: AuthenticationType.MCP,
        ip: intent.sourceIp ?? undefined,
      });
      const { collection } = await authorizeDocumentCreate(ctx, {
        collectionId,
        parentDocumentId: intent.parentDocumentId,
      });
      if (collection?.id !== collectionId) {
        pending = [{ kind: "conflict" }, undefined];
      } else {
        const entry = getPolicySet().entries.find(
          (item) => item.collectionId === collectionId
        );
        if (
          entry?.status !== "valid" ||
          entry.policy.activation !== "enforced" ||
          entry.policyFingerprint !== intent.expectedPolicyFingerprint
        ) {
          // Any other worker-time state is a mismatch, never fail-open.
          pending = [
            { kind: "rejected", validation: mismatchValidation(intent) },
            { kind: "policy_rejection" },
          ];
        } else {
          authorized = {
            actor,
            ctx,
            classification: Object.freeze({
              kind: "enforced" as const,
              entry,
              readable: intent.readable,
              documentId,
            }),
          };
        }
      }
    } catch (error) {
      pending = aborted(3, abortMessage(error));
    }
    if (!authorized) {
      return await finish(...pending);
    }

    const { actor, ctx, classification } = authorized;
    const { rules } = classification.entry.policy;
    /**
     * Runs one preparation step within the preparation bound.
     *
     * @param run - the step.
     * @returns the step's value.
     * @throws PreparationExpiredError when the bound expires first.
     */
    const prepareStep = async <T>(run: () => Promise<T> | T): Promise<T> => {
      if (preparation.expired()) {
        throw new PreparationExpiredError();
      }
      const result = await within(
        Promise.resolve().then(run),
        preparation.remainingMs(),
        EXPIRED
      );
      if (result === EXPIRED) {
        throw new PreparationExpiredError();
      }
      return result;
    };
    let prepared: PreparedMarkdownCreate;

    const outcome = await runAttempt(
      {
        ctx,
        classification,
        requestId,
        instanceOrigin: env.URL,
      },
      {
        prepare: async () => {
          const content = await prepareStep(() =>
            FileStorage.getFileBuffer(intent.key).catch(() => {
              throw new MissingSourceError();
            })
          );
          const imported = await prepareStep(() =>
            documentImporter({
              user: actor,
              fileName: intent.sourceMetadata.fileName,
              mimeType: intent.sourceMetadata.mimeType,
              content,
              ctx,
              media: refuseImportableMedia,
            })
          );
          prepared = await prepareStep(() =>
            prepareHtmlCreate(
              {
                title: intent.title,
                icon: intent.icon,
                color: intent.color,
                fullWidth: intent.fullWidth,
                publish: intent.publish,
                parentDocumentId: intent.parentDocumentId,
                sourceMetadata: intent.sourceMetadata,
              },
              imported
            )
          );
        },
        reauthorize: async () => {
          const found = await sequelize.query(
            "SELECT id FROM documents WHERE id = :documentId",
            {
              replacements: { documentId },
              transaction: ctx.state.transaction,
              type: QueryTypes.SELECT,
            }
          );
          if (found.length > 0) {
            throw new PreallocatedDocumentExistsError();
          }
          const { collection } = await authorizeDocumentCreate(ctx, {
            collectionId,
            parentDocumentId: intent.parentDocumentId,
          });
          return collection?.id;
        },
        project: () =>
          projectMarkdownCreate({
            prepared,
            documentId,
            collectionId,
            actor,
            template: null,
          }),
        persist: async (projection, validation) => {
          try {
            return await persistProjectedCreate(ctx, projection, null);
          } catch (error) {
            if (isPreallocatedIdConflict(error)) {
              ownConflict = validation;
            }
            throw error;
          }
        },
        probeTarget: () => target,
      },
      {
        invocationId,
        preparation,
        admitPersist: () => {
          decided = true;
          return (
            job.remainingMs() >=
            WRITE_PERSISTENCE_BUDGET_MS + AUDIT_WRITE_BOUND_MS
          );
        },
        callbacksAfterProbe: false,
        onValidated: (projectionValidation) => {
          validated = projectionValidation;
        },
        onCommitted: ({ validation }) => {
          committedSummary = summarize(decidedSummary(validation, rules), true);
        },
      }
    );

    switch (outcome.row) {
      case 6:
        await committedSummary;
        await deleteSource();
        return {
          kind: "committed",
          documentId,
          validation: outcome.validation,
        };
      case 7:
        throw new UnestablishedImportError();
      case 5:
        if (ownConflict) {
          await summarize(decidedSummary(ownConflict, rules), true);
          await deleteSource();
          return { kind: "committed", documentId, validation: ownConflict };
        }
        return await finish(...aborted(5, outcome.message));
      case 4:
        return await finish(
          { kind: "rejected", validation: outcome.validation },
          decidedSummary(outcome.validation, rules)
        );
      case 3:
        return await finish(...aborted(3, outcome.message));
      case 2:
        return await finish({ kind: "conflict" }, undefined);
      default: {
        const unhandled: never = outcome;
        return unhandled;
      }
    }
  } catch (error) {
    if (error instanceof UnestablishedImportError) {
      throw error;
    }
    failure = aborted(decided ? 5 : 3, abortMessage(error));
  }
  return finish(...failure);
}
