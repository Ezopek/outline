import { randomUUID } from "node:crypto";
import type { ProsemirrorData } from "@shared/types";
import Logger from "@server/logging/Logger";
import type { Document, Template } from "@server/models";
import type { APIContext } from "@server/types";
import {
  parseCanonicalMarkdown,
  toCanonicalMarkdown,
} from "../adapters/canonicalSyntax";
import type {
  MarkdownCreateInput,
  MarkdownUpdateInput,
  PreparedMarkdownCreate,
  PreparedMarkdownUpdate,
  ProjectedDocument,
} from "../adapters/documentProjection";
import {
  prepareMarkdownCreate,
  prepareMarkdownUpdate,
  projectMarkdownCreate,
  projectMarkdownUpdate,
} from "../adapters/documentProjection";
import {
  isDatabaseTimeout,
  resolveLinkTargets,
} from "../adapters/documentReader";
import { MediaStager } from "../adapters/mediaStaging";
import {
  persistProjectedCreate,
  persistProjectedUpdate,
} from "../adapters/projectionWriter";
import type { ProbeTarget } from "../adapters/writeTransaction";
import {
  ContainedReadError,
  EnforcementTransaction,
  isServerReported,
  probeCommit,
} from "../adapters/writeTransaction";
import type {
  CanonicalSyntax,
  Finding,
  InternalLinkReference,
  IssueItem,
  LinkTargetState,
  ResolvedLinks,
  ScopeLocation,
  SystemFailure,
  SystemFailureCode,
  ValidationStatus,
  WriteValidation,
} from "../core/contracts";
import { WikiLintContractError } from "../core/contracts";
import {
  documentSurfaceRules,
  evaluateDocumentRules,
} from "../core/documentRules";
import type { LinkLookupKey } from "../core/internalLinks";
import { extractInternalLinks, linkLookupBatches } from "../core/internalLinks";
import { sortIssues } from "../core/ordering";
import type { RuleConfig } from "../core/registry";
import { createSystemFailure } from "../core/registry";
import {
  COMMIT_PROBE_BOUND_MS,
  Deadline,
  DeadlineFloorError,
  POST_COMMIT_ASSEMBLY_BOUND_MS,
  VALIDATION_DEADLINE_MS,
  WRITE_PERSISTENCE_BUDGET_MS,
  WRITE_PREPARATION_BOUND_MS,
  monotonicClock,
} from "./deadline";
import type { RequestAuditInput, WriteAuditOutcome } from "./writeAudit";
import { evaluatedCounts, recordRequestWriteAudit } from "./writeAudit";
import type { WriteClassification } from "./writeClassification";
import {
  abortMessage,
  decideWrite,
  withinWriteEligibility,
} from "./writeDecision";

/** A write classified under a valid `enforced` policy. */
export type EnforcedClassification = Extract<
  WriteClassification,
  { kind: "enforced" }
>;

/**
 * The AD-20 row an enforced Markdown write ends in: 2 conflict, 3 aborted
 * before the decision, 4 rejected, 5 aborted after the decision, 6
 * committed, or 7 unestablished. A committed write carries its AD-11
 * post-commit assembly deadline, started once the commit was established
 * and any awaited summary write had settled or expired; the callback wait
 * has already used part of it, and the response enrichments get only what
 * remains.
 */
export type EnforcedWriteOutcome =
  | { row: 2 }
  | { row: 3 | 5; message: string }
  | { row: 4; validation: WriteValidation }
  | {
      row: 6;
      document: Document;
      validation: WriteValidation;
      assembly: Deadline;
    }
  | { row: 7 };

/** The measures of a projected document that the decision reads. */
export interface ProjectionMeasures {
  markdownBytes?: number;
  linkReferences?: number;
}

/** The P5 validation of a projection, before the decision. */
export interface ProjectionValidation {
  /** The Findings and System Failures, keyed to the classified collection. */
  items: IssueItem[];
  measures: ProjectionMeasures;
}

/** Resolves internal-link lookup batches for the acting user. */
export type LinkResolver = (
  batches: readonly (readonly LinkLookupKey[])[]
) => Promise<ReadonlyMap<string, LinkTargetState>>;

/** Thrown at a cancellation check when the handler's signal was aborted. */
class WriteCancelledError extends Error {
  name = "WriteCancelledError";

  constructor() {
    super("The write was cancelled");
  }
}

/**
 * Throws when the handler's signal was aborted.
 *
 * @param signal - the signal, if any.
 * @throws WriteCancelledError when it was aborted.
 */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new WriteCancelledError();
  }
}

/**
 * Validates a projection in P5 with the enabled document-surface rules of
 * the classified policy. A failure to build the canonical syntax or a
 * contained related-state read becomes a System Failure located at the
 * classified collection, and every Finding already produced is kept; a
 * failure that is not contained propagates (AD-20 row 3).
 *
 * @param input.documentId - the projected document.
 * @param input.content - its canonical ProseMirror JSON.
 * @param input.rules - the policy's rules; only document-surface rules run.
 * @param input.collectionId - the classified collection.
 * @param input.readable - whether the actor can read it.
 * @param input.instanceOrigin - the origin internal links are recognized
 *   against.
 * @param input.deadline - the validation deadline.
 * @param input.resolve - resolves link batches; called only when
 *   `internal_links` is enabled.
 * @returns the issues and the measures.
 * @throws the resolver's error when it is neither a floor refusal nor a
 *   contained read.
 */
export async function validateProjection(input: {
  documentId: string;
  content: ProsemirrorData;
  rules: readonly RuleConfig[];
  collectionId: string;
  readable: boolean;
  instanceOrigin: string;
  deadline: Deadline;
  resolve: LinkResolver;
}): Promise<ProjectionValidation> {
  const { documentId, content, collectionId, readable, deadline } = input;
  const rules = documentSurfaceRules(input.rules);
  const location: ScopeLocation = {
    kind: "scope",
    scopeKind: "collection",
    ...(readable && { collectionId }),
  };
  /**
   * Builds one System Failure per distinct code.
   *
   * @param codes - the codes, in order.
   * @returns the items.
   */
  const failures = (codes: readonly SystemFailureCode[]): IssueItem[] =>
    [...new Set(codes)].map((code) => ({
      issue: createSystemFailure(code, location),
      sortCollectionId: collectionId,
    }));

  const measures: ProjectionMeasures = {};
  if (deadline.expired()) {
    return { items: failures(["VALIDATION_TIMEOUT"]), measures };
  }
  if (rules.length === 0) {
    return { items: [], measures };
  }

  let syntax: CanonicalSyntax;
  let references: InternalLinkReference[];
  try {
    const markdown = await toCanonicalMarkdown(content);
    measures.markdownBytes = Buffer.byteLength(markdown, "utf8");
    syntax = parseCanonicalMarkdown(markdown);
    references = extractInternalLinks(syntax.links, input.instanceOrigin);
    measures.linkReferences = references.length;
  } catch {
    return {
      items: failures([
        deadline.expired() ? "VALIDATION_TIMEOUT" : "VALIDATION_RUNTIME_FAILED",
      ]),
      measures,
    };
  }

  const codes: SystemFailureCode[] = [];
  const hasInternalLinks = rules.some((rule) => rule.kind === "internal_links");
  let links: ResolvedLinks | undefined;
  if (hasInternalLinks) {
    try {
      links = {
        references,
        targets: await input.resolve(linkLookupBatches(references)),
      };
    } catch (error) {
      if (error instanceof DeadlineFloorError) {
        codes.push("VALIDATION_TIMEOUT");
      } else if (error instanceof ContainedReadError) {
        codes.push(
          isDatabaseTimeout(error.cause)
            ? "VALIDATION_TIMEOUT"
            : "VALIDATION_RUNTIME_FAILED"
        );
      } else {
        throw error;
      }
    }
  }
  if (deadline.expired()) {
    return { items: failures(["VALIDATION_TIMEOUT"]), measures };
  }

  const { findings, failedKinds } = evaluateDocumentRules({
    documentId,
    syntax,
    rules:
      hasInternalLinks && !links
        ? rules.filter((rule) => rule.kind !== "internal_links")
        : rules,
    links,
    detailVisible: readable,
  });
  if (deadline.expired()) {
    return { items: failures(["VALIDATION_TIMEOUT"]), measures };
  }
  if (failedKinds.length > 0) {
    codes.push("VALIDATION_RUNTIME_FAILED");
  }
  return {
    items: [
      ...findings.map((item) => ({ ...item, sortCollectionId: collectionId })),
      ...failures(codes),
    ],
    measures,
  };
}

/** The sorted issues of a validation. */
interface WriteIssues {
  errors: Finding[];
  warnings: Finding[];
  systemFailures: SystemFailure[];
}

/**
 * Partitions issue items by class and sorts each class.
 *
 * @param items - the items.
 * @returns the sorted Errors, Warnings, and System Failures.
 */
function partitionIssues(items: readonly IssueItem[]): WriteIssues {
  const findings = items.filter(
    (item): item is IssueItem<Finding> => "severity" in item.issue
  );
  return {
    errors: sortIssues(
      findings.filter((item) => item.issue.severity === "error")
    ),
    warnings: sortIssues(
      findings.filter((item) => item.issue.severity === "warning")
    ),
    systemFailures: sortIssues(
      items.filter(
        (item): item is IssueItem<SystemFailure> => !("severity" in item.issue)
      )
    ),
  };
}

/**
 * Builds the AD-12 `validation` object of an enforced write. The valid
 * policy identity appears only for a reader of the classified collection.
 *
 * @param input.status - the decision.
 * @param input.entry - the classified policy entry.
 * @param input.readable - whether the actor can read the collection.
 * @param input.issues - the sorted issues.
 * @returns the object, in its fixed key order.
 */
export function writeValidation(input: {
  status: ValidationStatus;
  entry: EnforcedClassification["entry"];
  readable: boolean;
  issues: WriteIssues;
}): WriteValidation {
  const { status, entry, readable, issues } = input;
  return {
    status,
    ...(readable && {
      policySchemaVersion: entry.policySchemaVersion,
      policyFingerprint: entry.policyFingerprint,
    }),
    errors: issues.errors,
    warnings: issues.warnings,
    systemFailures: issues.systemFailures,
  };
}

/** The inputs every enforced write attempt shares. */
export interface ShellInput {
  /** The handler's API context; the shell binds it to its transaction. */
  ctx: APIContext;
  classification: EnforcedClassification;
  /** The handler's cancellation signal. */
  signal?: AbortSignal;
  /** The request ID, for operator diagnostics. */
  requestId?: string;
  /** The origin internal links are recognized against. */
  instanceOrigin: string;
}

/** The write-specific steps of one attempt. */
export interface AttemptPlan {
  /** The document to lock after the collection; none for a create. */
  lockDocumentId?: string;
  /**
   * P2: preparation outside the transaction; a promise is awaited.
   *
   * @param media - the attempt's media stager, sealed once this resolves.
   */
  prepare(media: MediaStager): void | Promise<void>;
  /**
   * P3: re-fetches and re-authorizes under the transaction.
   *
   * @returns the post-operation collection.
   */
  reauthorize(): Promise<string | null | undefined>;
  /** P4: projects from the re-fetched state. */
  project(): Promise<ProjectedDocument>;
  /**
   * P7: persists the projection; returns the in-transaction re-fetch.
   *
   * @param projection - the validated projection.
   * @param validation - the decided validation.
   */
  persist(
    projection: ProjectedDocument,
    validation: WriteValidation
  ): Promise<Document>;
  /** P8: what the commit probe looks up. */
  probeTarget(since: Date, invocationId: string): ProbeTarget;
}

/**
 * The optional differences of an attempt that does not run in the request,
 * such as the enforced HTML import worker. Omitted, an attempt behaves as an
 * enforced Markdown write does.
 */
export interface AttemptOptions {
  /** The attempt's correlation ID; defaults to a fresh UUID. */
  invocationId?: string;
  /** The preparation bound; defaults to one started at shell entry. */
  preparation?: Deadline;
  /**
   * Checked after a persist decision, before the persistence deadline
   * starts; `false` rolls back and ends in row 5.
   */
  admitPersist?: () => boolean;
  /**
   * Whether the buffered callbacks run when only the commit probe
   * established the commit; defaults to true.
   */
  callbacksAfterProbe?: boolean;
  /** Called with the P5 validation, right after P5. */
  onValidated?: (validated: ProjectionValidation) => void;
  /**
   * Called once the commit is established, before the callbacks start. A
   * returned promise is awaited, a rejection ignored, before the post-commit
   * assembly deadline starts. `probed` is true when `commit()` rejected and
   * only the commit probe established the commit, by finding the row.
   */
  onCommitted?: (committed: {
    document: Document;
    validation: WriteValidation;
    probed: boolean;
  }) => void | Promise<void>;
}

/**
 * Runs a hook of an attempt; a throwing hook changes nothing.
 *
 * @param hook - the hook.
 * @returns the hook's value, or undefined when it threw.
 */
function runHook<T>(hook: () => T): T | undefined {
  try {
    return hook();
  } catch {
    return undefined;
  }
}

/**
 * Runs one AD-20 P2 to P8 attempt of an enforced write in one unmanaged
 * transaction, bounded by AD-11. The attempt owns one media stager: the plan
 * stages through it in P2, it is sealed before `BEGIN`, and an attempt that
 * ends in row 2, 3, 4, or 5 deletes the blobs it staged once its transaction
 * has ended. Rows 6 and 7, and an unexpected throw, delete nothing. An
 * attempt that ends in row 3, 5, or 7 logs one operator warning with only its
 * request ID, invocation ID, row, and, when the failure is an `Error`, its
 * class name.
 *
 * @param shell - the shared inputs.
 * @param plan - the write-specific steps.
 * @param options - the optional differences; see `AttemptOptions`.
 * @returns the row the attempt ended in.
 */
export async function runAttempt(
  shell: ShellInput,
  plan: AttemptPlan,
  options: AttemptOptions = {}
): Promise<EnforcedWriteOutcome> {
  const invocationId = options.invocationId ?? randomUUID();
  const preparation =
    options.preparation ??
    new Deadline(WRITE_PREPARATION_BOUND_MS, monotonicClock);
  const media = new MediaStager({
    invocationId,
    attemptId: randomUUID(),
    actor: shell.ctx.state.auth.user,
    preparation,
    requestId: shell.requestId,
  });
  const outcome = await attempt(shell, plan, {
    options,
    invocationId,
    preparation,
    media,
  });
  if (outcome.row >= 2 && outcome.row <= 5) {
    await media.cleanup();
  }
  return outcome;
}

/**
 * The body of `runAttempt`: P2 to P8, with the attempt's resolved
 * correlation ID, preparation bound, and media stager.
 *
 * @param shell - the shared inputs.
 * @param plan - the write-specific steps.
 * @param attemptState.options - the optional differences.
 * @param attemptState.invocationId - the correlation ID.
 * @param attemptState.preparation - the preparation bound.
 * @param attemptState.media - the media stager.
 * @returns the row the attempt ended in.
 */
async function attempt(
  shell: ShellInput,
  plan: AttemptPlan,
  attemptState: {
    options: AttemptOptions;
    invocationId: string;
    preparation: Deadline;
    media: MediaStager;
  }
): Promise<EnforcedWriteOutcome> {
  const { ctx, classification, signal, requestId, instanceOrigin } = shell;
  const { options, invocationId, preparation, media } = attemptState;
  const { entry, readable } = classification;
  const { collectionId } = entry;
  const actor = ctx.state.auth.user;
  /**
   * Logs a row 3, 5, or 7 for the operator with the correlation, the row,
   * and the failure's class name only; a logging failure is ignored.
   *
   * @param row - the row.
   * @param cause - the failure; its class name is logged only for an `Error`.
   */
  const warn = (row: 3 | 5 | 7, cause: unknown) => {
    try {
      Logger.warn("Enforced write ended without an established commit", {
        requestId,
        invocationId,
        row,
        ...(cause instanceof Error && { errorClass: cause.constructor.name }),
      });
    } catch {
      // The diagnostic never changes the outcome.
    }
  };
  /**
   * Ends the attempt in row 3 or 5 with the AD-20 message of its failure,
   * and logs it.
   *
   * @param row - the row.
   * @param cause - the failure, or undefined when there is none.
   * @returns the outcome.
   */
  const aborted = (row: 3 | 5, cause: unknown): EnforcedWriteOutcome => {
    warn(row, cause);
    return { row, message: abortMessage(cause) };
  };

  // P2: preparation, then the transaction, within the bound. The stager is
  // sealed before the transaction opens, so no staging runs inside it.
  let enforcement: EnforcementTransaction;
  try {
    await plan.prepare(media);
    media.seal();
    throwIfAborted(signal);
    enforcement = await EnforcementTransaction.open(
      invocationId,
      preparation.remainingMs()
    );
  } catch (error) {
    return aborted(3, error);
  }
  const { transaction } = enforcement;
  const validationDeadline = new Deadline(
    VALIDATION_DEADLINE_MS,
    monotonicClock
  );
  const unbound = {
    state: ctx.state.transaction,
    context: ctx.context.transaction,
  };
  ctx.state.transaction = transaction;
  ctx.context.transaction = transaction;

  try {
    let projection: ProjectedDocument;
    let validation: WriteValidation;
    try {
      throwIfAborted(signal);

      // P3: lock, re-fetch, re-authorize, and compare the collection.
      await enforcement.setLocalTimeouts(validationDeadline.batchTimeoutMs());
      await enforcement.lockCollection(collectionId);
      if (plan.lockDocumentId !== undefined) {
        await enforcement.lockDocument(plan.lockDocumentId);
      }
      if ((await plan.reauthorize()) !== collectionId) {
        await enforcement.rollback();
        return { row: 2 };
      }

      // P4: project from the locked state.
      throwIfAborted(signal);
      await enforcement.setLocalTimeouts(validationDeadline.batchTimeoutMs());
      projection = await plan.project();

      // P5: validate.
      throwIfAborted(signal);
      const remainingAtP5 = validationDeadline.remainingMs();
      await enforcement.setLocalTimeouts(Math.floor(remainingAtP5));
      const validated = await validateProjection({
        documentId: projection.documentId,
        content: projection.content,
        rules: entry.policy.rules,
        collectionId,
        readable,
        instanceOrigin,
        deadline: validationDeadline,
        resolve: (batches) =>
          resolveLinkTargets({
            batches,
            actor,
            transaction,
            deadline: validationDeadline,
            read: (run) => {
              throwIfAborted(signal);
              return enforcement.savepoint(run);
            },
          }),
      });
      if (options.onValidated) {
        runHook(() => options.onValidated!(validated));
      }

      // P6: decide; the signal is ignored from here on.
      throwIfAborted(signal);
      const issues = partitionIssues(validated.items);
      const status = decideWrite({
        ...issues,
        runtimeFailureMode: entry.policy.runtimeFailureMode,
        withinLimits: withinWriteEligibility(validated.measures),
        halfDeadlineAtP5: remainingAtP5 >= VALIDATION_DEADLINE_MS / 2,
      });
      validation = writeValidation({ status, entry, readable, issues });
    } catch (error) {
      await enforcement.rollback();
      return aborted(3, error);
    }
    if (validation.status === "rejected") {
      await enforcement.rollback();
      return { row: 4, validation };
    }
    if (
      options.admitPersist &&
      runHook(() => options.admitPersist!()) === false
    ) {
      await enforcement.rollback();
      return aborted(5, undefined);
    }

    // P7: persist exactly the projection, within the persistence budget less
    // the probe reserve.
    const persistence = new Deadline(
      WRITE_PERSISTENCE_BUDGET_MS,
      monotonicClock
    );
    let document: Document;
    try {
      await enforcement.setLocalTimeouts(
        persistence.batchTimeoutMs(COMMIT_PROBE_BOUND_MS)
      );
      document = await plan.persist(projection, validation);
      await enforcement.setLocalTimeouts(
        persistence.batchTimeoutMs(COMMIT_PROBE_BOUND_MS)
      );
    } catch (error) {
      await enforcement.rollback();
      return aborted(5, error);
    }

    // P8: establish the commit. COMMIT's timer leaves the probe reserve.
    const commit = await enforcement.commit(
      Math.floor(persistence.remainingMs()) - COMMIT_PROBE_BOUND_MS
    );
    if (!commit.committed) {
      const probe = await probeCommit(
        plan.probeTarget(enforcement.startedAt, invocationId),
        COMMIT_PROBE_BOUND_MS
      );
      if (probe !== "present") {
        enforcement.discard();
        if (probe === "absent" && isServerReported(commit.error)) {
          return aborted(5, commit.error);
        }
        warn(7, commit.error);
        return { row: 7 };
      }
      if (options.callbacksAfterProbe === false) {
        enforcement.discard();
      }
    }
    // A summary write the hook returns settles or expires first; the
    // callback wait and the response enrichments then share one deadline.
    if (options.onCommitted) {
      await Promise.resolve(
        runHook(() =>
          options.onCommitted!({
            document,
            validation,
            probed: !commit.committed,
          })
        )
      ).catch(() => undefined);
    }
    const assembly = new Deadline(
      POST_COMMIT_ASSEMBLY_BOUND_MS,
      monotonicClock
    );
    await enforcement.runCallbacks(assembly.remainingMs(), (reason) =>
      Logger.warn("Enforced write post-commit callback failed", {
        requestId,
        invocationId,
        reason,
      })
    );
    return { row: 6, document, validation, assembly };
  } finally {
    ctx.state.transaction = unbound.state;
    ctx.context.transaction = unbound.context;
  }
}

/**
 * Runs one attempt of an enforced Markdown write and records its one
 * request-path summary (AD-14, AD-20). A row 6 summary is written once the
 * commit is established and awaited before the post-commit assembly
 * deadline starts; a row 3, 4, or 5 summary once the rollback and the
 * staged media cleanup have ended. Rows 2 and 7 record nothing. The summary
 * runs in its own transaction and never changes the row. A crash between the
 * commit and the summary, and a row 7 whose COMMIT did land, leave no
 * summary; both are recorded evidence gaps (AD-15), and the summary never
 * joins the mutation transaction.
 *
 * @param args - the shared inputs and the request's audit inputs.
 * @param target.operation - the write operation.
 * @param target.documentId - the updated document, or the pre-allocated ID
 *   of a create, which is recorded only once its row exists.
 * @param plan - the write-specific steps.
 * @returns the row the write ended in.
 */
async function runAuditedAttempt(
  args: ShellInput & { audit: RequestAuditInput },
  target: {
    operation: "create_document" | "update_document";
    documentId?: string;
  },
  plan: AttemptPlan
): Promise<EnforcedWriteOutcome> {
  const { ctx, classification, audit } = args;
  const { entry } = classification;
  const { operation, documentId } = target;
  const invocationId = randomUUID();
  let validated: ProjectionValidation | undefined;

  /**
   * Records the attempt's summary.
   *
   * @param outcome - how the attempt ended.
   * @param committed - whether the written document row exists.
   * @returns a promise that never rejects.
   */
  const record = (outcome: WriteAuditOutcome, committed: boolean) =>
    recordRequestWriteAudit({
      ...audit,
      invocationId,
      actor: ctx.state.auth.user,
      operation,
      collectionId: entry.collectionId,
      documentId:
        committed || operation === "update_document" ? documentId : undefined,
      policyFingerprint: entry.policyFingerprint,
      outcome,
    });

  /**
   * Builds the summary outcome of a decided validation.
   *
   * @param validation - the decided validation.
   * @returns the summary outcome.
   */
  const decided = (validation: WriteValidation): WriteAuditOutcome => ({
    kind: "decided",
    validation,
    evaluated: validated
      ? evaluatedCounts(validated, entry.policy.rules)
      : { evaluatedDocumentCount: 0, evaluatedLinkCount: 0 },
  });

  const outcome = await runAttempt(args, plan, {
    invocationId,
    onValidated: (projectionValidation) => {
      validated = projectionValidation;
    },
    onCommitted: ({ validation }) => record(decided(validation), true),
  });
  if (outcome.row === 3 || outcome.row === 5) {
    await record({ kind: "aborted", row: outcome.row }, false);
  } else if (outcome.row === 4) {
    await record(decided(outcome.validation), false);
  }
  return outcome;
}

/**
 * Enforces an MCP Markdown create classified under a valid `enforced`
 * policy (AD-20 P2 to P8), and records its summary.
 *
 * @param args.ctx - the handler's API context.
 * @param args.classification - the enforced classification, with the
 *   pre-allocated document ID.
 * @param args.input - the create arguments, as the handler maps them.
 * @param args.reauthorize - the handler's P0 re-run under the transaction:
 *   the post-operation collection and the template.
 * @param args.audit - the request's audit inputs.
 * @param args.signal - the handler's cancellation signal.
 * @param args.requestId - the request ID, for diagnostics.
 * @param args.instanceOrigin - the origin internal links are recognized
 *   against.
 * @returns the row the write ended in.
 */
export function enforceMarkdownCreate(
  args: ShellInput & {
    audit: RequestAuditInput;
    input: MarkdownCreateInput;
    reauthorize: () => Promise<{
      collectionId: string | null | undefined;
      template?: Template | null;
    }>;
  }
): Promise<EnforcedWriteOutcome> {
  const { ctx, classification, input, reauthorize } = args;
  const { documentId } = classification;
  let prepared: PreparedMarkdownCreate;
  let template: Template | null | undefined;
  const target = { operation: "create_document" as const, documentId };
  return runAuditedAttempt(args, target, {
    prepare: () => {
      if (documentId === undefined) {
        throw new WikiLintContractError("A create needs a pre-allocated ID");
      }
      prepared = prepareMarkdownCreate(input);
    },
    reauthorize: async () => {
      const reauthorized = await reauthorize();
      template = reauthorized.template;
      return reauthorized.collectionId;
    },
    project: () =>
      projectMarkdownCreate({
        prepared,
        documentId: documentId!,
        collectionId: classification.entry.collectionId,
        actor: ctx.state.auth.user,
        template,
      }),
    persist: (projection) => persistProjectedCreate(ctx, projection, template),
    probeTarget: () => ({ kind: "document", documentId: documentId! }),
  });
}

/**
 * Enforces an MCP Markdown update classified under a valid `enforced`
 * policy (AD-20 P2 to P8), and records its summary.
 *
 * @param args.ctx - the handler's API context.
 * @param args.classification - the enforced classification.
 * @param args.documentId - the document P0 resolved.
 * @param args.input - the update arguments, as the handler maps them.
 * @param args.reauthorize - the handler's P0 re-run under the transaction:
 *   the document, loaded with its state, and the post-operation collection.
 * @param args.audit - the request's audit inputs.
 * @param args.signal - the handler's cancellation signal.
 * @param args.requestId - the request ID, for diagnostics.
 * @param args.instanceOrigin - the origin internal links are recognized
 *   against.
 * @returns the row the write ended in.
 */
export function enforceMarkdownUpdate(
  args: ShellInput & {
    audit: RequestAuditInput;
    documentId: string;
    input: MarkdownUpdateInput;
    reauthorize: () => Promise<{
      document: Document;
      collectionId: string | null | undefined;
    }>;
  }
): Promise<EnforcedWriteOutcome> {
  const { ctx, classification, documentId, input, reauthorize } = args;
  let prepared: PreparedMarkdownUpdate;
  let document: Document;
  const target = { operation: "update_document" as const, documentId };
  return runAuditedAttempt(args, target, {
    lockDocumentId: documentId,
    prepare: async (media) => {
      // Stages exactly when `documentUpdater` would import.
      const staged =
        input.publish !== false && input.text !== undefined
          ? { ...input, text: await media.stageMarkdown(input.text) }
          : input;
      prepared = prepareMarkdownUpdate(staged, media.attachments);
    },
    reauthorize: async () => {
      const reauthorized = await reauthorize();
      document = reauthorized.document;
      return reauthorized.collectionId;
    },
    project: () =>
      projectMarkdownUpdate({
        prepared,
        document,
        collectionId: classification.entry.collectionId,
      }),
    persist: (projection) =>
      persistProjectedUpdate(ctx, {
        document,
        projection,
        input: prepared.input,
      }),
    probeTarget: (since, invocationId) => ({
      kind: "event",
      documentId,
      name:
        input.publish === true
          ? "documents.publish"
          : input.publish === false
            ? "documents.unpublish"
            : "documents.update",
      since,
      invocationId,
    }),
  });
}
