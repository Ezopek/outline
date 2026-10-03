import type { CreateOptions, Transaction } from "sequelize";
import { QueryTypes } from "sequelize";
import { Event } from "@server/models";
import { sequelize } from "@server/storage/database";
import {
  Deadline,
  DeadlineFloorError,
  SET_LOCAL_FLOOR_MS,
  monotonicClock,
} from "../application/deadline";

/** A Sequelize transaction with the internals the buffering relies on. */
type TrackedTransaction = Transaction & {
  savepoints: Transaction[];
  parent?: Transaction;
};

/** A callback registered with `afterCommit`, and where it was registered. */
interface BufferedCallback {
  run: (transaction: Transaction) => unknown;
  owner: Transaction;
}

/** The outcome of `EnforcementTransaction.commit`. */
export type CommitResult =
  | { committed: true }
  | { committed: false; error: unknown };

/** Why a buffered post-commit callback is reported. */
export type CallbackFailure = "callback_failed" | "bound_expired";

/** What a commit probe looks up. */
export type ProbeTarget =
  | { kind: "document"; documentId: string }
  | {
      kind: "event";
      documentId: string;
      name: string;
      /** The wall-clock time taken before the enforcement `BEGIN`. */
      since: Date;
      invocationId: string;
    };

/** The outcome of a commit probe. */
export type ProbeOutcome = "present" | "absent" | "unavailable";

/**
 * Thrown by `EnforcementTransaction.savepoint` when a read failed and its
 * savepoint was rolled back, so the transaction is still usable.
 */
export class ContainedReadError extends Error {
  name = "ContainedReadError";

  /** The failure of the read. */
  readonly cause: unknown;

  constructor(cause: unknown) {
    super("A contained read failed");
    this.cause = cause;
  }
}

/** Thrown when the enforcement transaction does not open within its bound. */
export class TransactionOpenTimeoutError extends Error {
  name = "TransactionOpenTimeoutError";

  constructor() {
    super("The enforcement transaction did not open in time");
  }
}

/** The rejection of a `commit()` whose wall-clock timer expired. */
export class CommitTimeoutError extends Error {
  name = "CommitTimeoutError";

  constructor() {
    super("The commit did not complete in time");
  }
}

/** The attempt correlation ID of each enforcement transaction. */
const correlations = new WeakMap<Transaction, string>();

let correlationHookInstalled = false;

/**
 * Returns the parent of a child transaction.
 *
 * @param transaction - the transaction.
 * @returns its parent, or undefined for a root transaction.
 */
const parentOf = (transaction: Transaction) =>
  (transaction as TrackedTransaction).parent;

/**
 * Returns the attempt correlation ID of a transaction: its own, or that of the
 * nearest enforcement ancestor.
 *
 * @param transaction - the transaction, if any.
 * @returns the invocation ID, or undefined outside every enforcement
 *   transaction.
 */
function correlationOf(
  transaction: Transaction | null | undefined
): string | undefined {
  for (
    let current: Transaction | undefined = transaction ?? undefined;
    current;
    current = parentOf(current)
  ) {
    const invocationId = correlations.get(current);
    if (invocationId !== undefined) {
      return invocationId;
    }
  }
  return undefined;
}

/**
 * Registers, once per process, the `Event` `beforeCreate` hook that adds
 * `data.validationCorrelationId` to every Event created inside an enforcement
 * transaction or any child of it, keeping the existing keys.
 */
export function installCorrelationHook(): void {
  if (correlationHookInstalled) {
    return;
  }
  Event.addHook(
    "beforeCreate",
    "wikiLintValidationCorrelation",
    (event: Event, options: CreateOptions) => {
      const invocationId = correlationOf(options.transaction);
      if (invocationId !== undefined) {
        event.data = { ...event.data, validationCorrelationId: invocationId };
      }
    }
  );
  correlationHookInstalled = true;
}

/**
 * Settles a promise or a timer, whichever is first.
 *
 * @param promise - the promise.
 * @param timeoutMs - the timer, in milliseconds.
 * @param onTimeout - the value on expiry.
 * @returns the promise's value, or `onTimeout` on expiry.
 */
async function within<T, U>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: U
): Promise<T | U> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<U>((resolve) => {
        timer = setTimeout(() => resolve(onTimeout), Math.max(0, timeoutMs));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The one unmanaged primary-database transaction of an enforced write (AD-8,
 * AD-20). It buffers every `afterCommit` callback registered on it or on any
 * child of it, tags the Events created inside it with the attempt's
 * correlation ID, and runs the shell's own reads under SQL savepoints. It
 * never reads `transaction.finished`.
 */
export class EnforcementTransaction {
  /** The Sequelize transaction, for the writers and the shell's reads. */
  readonly transaction: Transaction;

  /** The wall-clock time taken before `BEGIN`. */
  readonly startedAt: Date;

  private readonly buffer: BufferedCallback[] = [];

  private readonly rolledBack = new WeakSet<Transaction>();

  private ended = false;

  private savepointCount = 0;

  private constructor(transaction: Transaction, startedAt: Date) {
    this.transaction = transaction;
    this.startedAt = startedAt;
  }

  /**
   * Opens the transaction, connection acquisition and `BEGIN` included,
   * within a bound. A transaction that opens after the bound expired is
   * rolled back when it resolves.
   *
   * @param invocationId - the attempt's correlation ID.
   * @param boundMs - the remaining preparation time, in milliseconds.
   * @returns the open transaction.
   * @throws TransactionOpenTimeoutError when the bound expires first.
   * @throws the error of a failed acquisition or `BEGIN`.
   */
  static async open(
    invocationId: string,
    boundMs: number
  ): Promise<EnforcementTransaction> {
    if (!(boundMs > 0)) {
      throw new TransactionOpenTimeoutError();
    }
    installCorrelationHook();
    const startedAt = new Date();
    const opening = sequelize.transaction();
    const opened = await within(opening, boundMs, null);
    if (opened === null) {
      opening.then(
        (late) => late.rollback().catch(() => undefined),
        () => undefined
      );
      throw new TransactionOpenTimeoutError();
    }
    const enforcement = new EnforcementTransaction(opened, startedAt);
    correlations.set(opened, invocationId);
    enforcement.track(opened);
    return enforcement;
  }

  /**
   * Buffers the `afterCommit` callbacks of a transaction and, through its
   * `savepoints` list, of every child created under it, at any depth.
   *
   * @param transaction - the enforcement transaction or a child of it.
   */
  private track(transaction: Transaction): void {
    transaction.afterCommit = (run) => {
      if (typeof run !== "function") {
        throw new Error('"fn" must be a function');
      }
      this.buffer.push({
        run: run as BufferedCallback["run"],
        owner: transaction,
      });
    };
    const { savepoints } = transaction as TrackedTransaction;
    Object.defineProperty(savepoints, "push", {
      configurable: true,
      value: (...children: Transaction[]) => {
        for (const child of children) {
          this.track(child);
          const rollback = child.rollback.bind(child);
          child.rollback = () => {
            this.rolledBack.add(child);
            return rollback();
          };
        }
        return Array.prototype.push.apply(savepoints, children);
      },
    });
  }

  /**
   * Whether a callback's transaction is, or is under, a rolled-back child.
   *
   * @param owner - the transaction the callback was registered on.
   * @returns whether the callback is dropped.
   */
  private dropped(owner: Transaction): boolean {
    for (
      let current: Transaction | undefined = owner;
      current && current !== this.transaction;
      current = parentOf(current)
    ) {
      if (this.rolledBack.has(current)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Runs a statement in the transaction.
   *
   * @param sql - the statement.
   * @returns the query result.
   */
  private query(sql: string) {
    return sequelize.query(sql, { transaction: this.transaction });
  }

  /**
   * Bounds the next statements of the transaction, outside any savepoint.
   *
   * @param timeoutMs - the `lock_timeout` and `statement_timeout`, in whole
   *   milliseconds.
   * @throws DeadlineFloorError when the value is not an integer at or above
   *   the floor; no statement is sent.
   */
  async setLocalTimeouts(timeoutMs: number): Promise<void> {
    if (!Number.isInteger(timeoutMs) || timeoutMs < SET_LOCAL_FLOOR_MS) {
      throw new DeadlineFloorError();
    }
    await this.query(`SET LOCAL lock_timeout = ${timeoutMs}`);
    await this.query(`SET LOCAL statement_timeout = ${timeoutMs}`);
  }

  /**
   * Locks a collection row `FOR NO KEY UPDATE`.
   *
   * @param collectionId - the collection.
   */
  async lockCollection(collectionId: string): Promise<void> {
    await sequelize.query(
      "SELECT id FROM collections WHERE id = :id FOR NO KEY UPDATE",
      {
        replacements: { id: collectionId },
        transaction: this.transaction,
        type: QueryTypes.SELECT,
      }
    );
  }

  /**
   * Locks a document row `FOR NO KEY UPDATE`.
   *
   * @param documentId - the document.
   */
  async lockDocument(documentId: string): Promise<void> {
    await sequelize.query(
      "SELECT id FROM documents WHERE id = :id FOR NO KEY UPDATE",
      {
        replacements: { id: documentId },
        transaction: this.transaction,
        type: QueryTypes.SELECT,
      }
    );
  }

  /**
   * Runs a read under its own SQL savepoint. A failed read whose savepoint
   * rolls back is contained; any other failure propagates as is.
   *
   * @param run - the read.
   * @returns the read's result.
   * @throws ContainedReadError, only after a successful `ROLLBACK TO
   *   SAVEPOINT`.
   * @throws the read's own error when the savepoint cannot be rolled back,
   *   or the error of the `SAVEPOINT` or `RELEASE SAVEPOINT` statement.
   */
  async savepoint<T>(run: () => Promise<T>): Promise<T> {
    this.savepointCount++;
    const name = `wiki_lint_read_${this.savepointCount}`;
    await this.query(`SAVEPOINT ${name}`);
    let result: T;
    try {
      result = await run();
    } catch (error) {
      try {
        await this.query(`ROLLBACK TO SAVEPOINT ${name}`);
      } catch {
        throw error;
      }
      throw new ContainedReadError(error);
    }
    await this.query(`RELEASE SAVEPOINT ${name}`);
    return result;
  }

  /** Discards every buffered callback. */
  discard(): void {
    this.buffer.length = 0;
  }

  /**
   * Rolls the transaction back and discards the buffer. Errors are swallowed;
   * Sequelize destroys a connection whose rollback fails.
   */
  async rollback(): Promise<void> {
    this.discard();
    if (this.ended) {
      return;
    }
    this.ended = true;
    try {
      await this.transaction.rollback();
    } catch {
      // The connection is destroyed; nothing of the attempt can commit.
    }
  }

  /**
   * Commits under a wall-clock timer. Expiry counts as a connection-level
   * rejection; a commit that lands afterwards changes nothing here.
   *
   * @param timerMs - the timer, in milliseconds.
   * @returns whether `commit()` resolved within the timer, or its rejection.
   */
  async commit(timerMs: number): Promise<CommitResult> {
    this.ended = true;
    const commit = this.transaction.commit().then(
      (): CommitResult => ({ committed: true }),
      (error: unknown): CommitResult => ({ committed: false, error })
    );
    return within(commit, timerMs, {
      committed: false,
      error: new CommitTimeoutError(),
    } as CommitResult);
  }

  /**
   * Starts each surviving buffered callback independently, in registration
   * order, and waits for them within a bound. Callbacks registered on a
   * rolled-back child, or under one, are dropped. A failure never affects the
   * other callbacks and is only reported.
   *
   * @param boundMs - the bound, in milliseconds.
   * @param onFailure - reports a failed callback or the bound's expiry.
   */
  async runCallbacks(
    boundMs: number,
    onFailure: (reason: CallbackFailure) => void
  ): Promise<void> {
    const report = (reason: CallbackFailure) => {
      try {
        onFailure(reason);
      } catch {
        // Reporting never affects the outcome.
      }
    };
    const callbacks = this.buffer.filter(({ owner }) => !this.dropped(owner));
    this.discard();
    const settled = callbacks.map(({ run, owner }) =>
      (async () => run(owner))().then(
        () => undefined,
        () => report("callback_failed")
      )
    );
    const finished = await within(
      Promise.all(settled).then(() => true),
      boundMs,
      false
    );
    if (!finished) {
      report("bound_expired");
    }
  }
}

/**
 * Looks up, on a fresh connection in a short transaction, whether the row an
 * attempt wrote exists: the pre-allocated document of a create, or the
 * attempt's mutation Event. The whole probe, acquisition included, runs
 * within the bound.
 *
 * @param target - what to look up.
 * @param boundMs - the bound, in milliseconds.
 * @returns `present` or `absent`; `unavailable` when the bound is below the
 *   floor, expires, or the probe fails.
 */
export async function probeCommit(
  target: ProbeTarget,
  boundMs: number
): Promise<ProbeOutcome> {
  if (!(Math.floor(boundMs) >= SET_LOCAL_FLOOR_MS)) {
    return "unavailable";
  }
  const deadline = new Deadline(boundMs, monotonicClock);
  const lookup = async (): Promise<ProbeOutcome> => {
    const transaction = await sequelize.transaction();
    try {
      await sequelize.query(
        `SET LOCAL statement_timeout = ${deadline.batchTimeoutMs()}`,
        { transaction }
      );
      const rows =
        target.kind === "document"
          ? await sequelize.query("SELECT id FROM documents WHERE id = :id", {
              replacements: { id: target.documentId },
              transaction,
              type: QueryTypes.SELECT,
            })
          : await sequelize.query(
              `SELECT id FROM events WHERE "documentId" = :documentId AND name = :name AND "createdAt" >= :since AND data->>'validationCorrelationId' = :invocationId LIMIT 1`,
              {
                replacements: {
                  documentId: target.documentId,
                  name: target.name,
                  since: target.since,
                  invocationId: target.invocationId,
                },
                transaction,
                type: QueryTypes.SELECT,
              }
            );
      return rows.length > 0 ? "present" : "absent";
    } finally {
      await transaction.rollback().catch(() => undefined);
    }
  };
  return within(
    lookup().catch((): ProbeOutcome => "unavailable"),
    boundMs,
    "unavailable" as ProbeOutcome
  );
}

/**
 * Whether a rejection was reported by the database server: its `parent`
 * carries the server's string `severity` and SQLSTATE `code`.
 *
 * @param error - the rejection.
 * @returns whether the server reported it.
 */
export function isServerReported(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("parent" in error)) {
    return false;
  }
  const { parent } = error as { parent: unknown };
  return (
    typeof parent === "object" &&
    parent !== null &&
    typeof (parent as { severity?: unknown }).severity === "string" &&
    typeof (parent as { code?: unknown }).code === "string"
  );
}
