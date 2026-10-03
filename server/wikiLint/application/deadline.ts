/** A monotonic clock in milliseconds. */
export type MonotonicClock = () => number;

/** The default monotonic clock. */
export const monotonicClock: MonotonicClock = () => performance.now();

/**
 * The smallest remainder, in milliseconds, for which a database batch may
 * start. Provisional: Story 3.3 fixes it from benchmarks.
 */
export const SET_LOCAL_FLOOR_MS = 100;

/** The AD-15 bound, in milliseconds, of one lint audit write. */
export const AUDIT_WRITE_BOUND_MS = 3000;

/**
 * The AD-11 validation deadline, in milliseconds: an enforced write's P3 to
 * P5, from the opening of its transaction, and the whole of `lint_document`.
 */
export const VALIDATION_DEADLINE_MS = 9000;

/**
 * The AD-11 bound, in milliseconds, of an enforced write's P2 preparation and
 * the opening of its transaction, measured from shell entry, which
 * immediately follows classification.
 */
export const WRITE_PREPARATION_BOUND_MS = 30000;

/**
 * The AD-11 persistence budget, in milliseconds, of an enforced write's P7
 * and P8, measured from P7 entry. It includes the commit probe.
 */
export const WRITE_PERSISTENCE_BUDGET_MS = 9000;

/**
 * The AD-11 bound, in milliseconds, of the probe that follows a rejected
 * commit, connection acquisition included. Reserved within the persistence
 * budget.
 */
export const COMMIT_PROBE_BOUND_MS = 2000;

/**
 * The AD-11 bound, in milliseconds, of the whole post-commit assembly of an
 * enforced write, measured from the established commit: the wait for its
 * buffered callbacks plus its response enrichments, in total.
 */
export const POST_COMMIT_ASSEMBLY_BOUND_MS = 2000;

/**
 * The fixed AD-7 grace, in milliseconds, that an enforced HTML create's
 * `deadlineAt` adds to the worker's code-owned bounds.
 */
export const ENFORCED_IMPORT_GRACE_MS = 5000;

/**
 * The AD-7 wait, in milliseconds, of an enforced HTML create from
 * classification to `deadlineAt`: the preparation bound, the validation
 * deadline, the persistence budget, the audit bound, and the grace. The
 * requester waits no longer for the job's result.
 */
export const ENFORCED_IMPORT_WAIT_MS =
  WRITE_PREPARATION_BOUND_MS +
  VALIDATION_DEADLINE_MS +
  WRITE_PERSISTENCE_BUDGET_MS +
  AUDIT_WRITE_BOUND_MS +
  ENFORCED_IMPORT_GRACE_MS;

/**
 * Settles a promise or a timer, whichever is first.
 *
 * @param promise - the promise.
 * @param timeoutMs - the timer, in milliseconds.
 * @param onTimeout - the value on expiry.
 * @returns the promise's value, or `onTimeout` on expiry.
 */
export async function within<T, U>(
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
 * Thrown when the remaining time is below the floor, so a database batch is
 * refused before any statement is sent.
 */
export class DeadlineFloorError extends Error {
  name = "DeadlineFloorError";

  constructor() {
    super("The remaining time is below the database batch floor");
  }
}

/** A server-owned deadline measured on a monotonic clock. */
export class Deadline {
  private readonly clock: MonotonicClock;

  private readonly expiresAt: number;

  /** The clock reading at which the deadline started. */
  readonly startedAt: number;

  /**
   * Starts a deadline.
   *
   * @param budgetMs - the time budget in milliseconds.
   * @param clock - the monotonic clock; defaults to `performance.now`.
   */
  constructor(budgetMs: number, clock: MonotonicClock = monotonicClock) {
    this.clock = clock;
    this.startedAt = clock();
    this.expiresAt = this.startedAt + budgetMs;
  }

  /**
   * Returns the remaining time.
   *
   * @returns the remaining milliseconds; zero or negative once expired.
   */
  remainingMs(): number {
    return this.expiresAt - this.clock();
  }

  /**
   * Checks whether the deadline has passed.
   *
   * @returns whether no time remains.
   */
  expired(): boolean {
    return this.remainingMs() <= 0;
  }

  /**
   * Returns the timeout for the next database batch: the remaining time
   * floored to an integer, less a reserve.
   *
   * @param reserveMs - the time kept back for a later step, in whole
   *   milliseconds; defaults to none.
   * @returns the timeout in whole milliseconds, never below the floor.
   * @throws DeadlineFloorError when the remainder less the reserve is below
   *   the floor.
   */
  batchTimeoutMs(reserveMs = 0): number {
    const timeoutMs = Math.floor(this.remainingMs()) - reserveMs;
    if (!(timeoutMs >= SET_LOCAL_FLOOR_MS)) {
      throw new DeadlineFloorError();
    }
    return timeoutMs;
  }
}
