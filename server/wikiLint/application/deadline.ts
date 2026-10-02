/** A monotonic clock in milliseconds. */
export type MonotonicClock = () => number;

/** The default monotonic clock. */
export const monotonicClock: MonotonicClock = () => performance.now();

/**
 * The smallest remainder, in milliseconds, for which a database batch may
 * start. Provisional: Story 3.3 fixes it from benchmarks.
 */
export const SET_LOCAL_FLOOR_MS = 100;

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

  /**
   * Starts a deadline.
   *
   * @param budgetMs - the time budget in milliseconds.
   * @param clock - the monotonic clock; defaults to `performance.now`.
   */
  constructor(budgetMs: number, clock: MonotonicClock = monotonicClock) {
    this.clock = clock;
    this.expiresAt = clock() + budgetMs;
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
   * floored to an integer.
   *
   * @returns the timeout in whole milliseconds, never below the floor.
   * @throws DeadlineFloorError when the remainder is below the floor.
   */
  batchTimeoutMs(): number {
    const timeoutMs = Math.floor(this.remainingMs());
    if (!(timeoutMs >= SET_LOCAL_FLOOR_MS)) {
      throw new DeadlineFloorError();
    }
    return timeoutMs;
  }
}
