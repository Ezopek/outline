import { Deadline, DeadlineFloorError, SET_LOCAL_FLOOR_MS } from "./deadline";

/**
 * Builds a manually advanced clock.
 *
 * @param start - the initial reading.
 * @returns the clock and a function that sets its reading.
 */
function manualClock(start = 1000) {
  let now = start;
  return {
    clock: () => now,
    set: (value: number) => {
      now = value;
    },
  };
}

describe("Deadline", () => {
  it("measures the remainder on the injected clock", () => {
    const { clock, set } = manualClock(1000);
    const deadline = new Deadline(9000, clock);

    expect(deadline.remainingMs()).toBe(9000);
    set(4000.5);
    expect(deadline.remainingMs()).toBe(5999.5);
  });

  it("expires when no time remains", () => {
    const { clock, set } = manualClock(0);
    const deadline = new Deadline(500, clock);

    set(499.9);
    expect(deadline.expired()).toBe(false);
    set(500);
    expect(deadline.expired()).toBe(true);
    set(800);
    expect(deadline.expired()).toBe(true);
  });

  it("floors the batch timeout to an integer", () => {
    const { clock, set } = manualClock(0);
    const deadline = new Deadline(1234.9, clock);

    expect(deadline.batchTimeoutMs()).toBe(1234);
    set(1000.5);
    expect(deadline.batchTimeoutMs()).toBe(234);
  });

  it("allows a batch at exactly the floor", () => {
    const { clock } = manualClock(0);

    expect(new Deadline(SET_LOCAL_FLOOR_MS, clock).batchTimeoutMs()).toBe(
      SET_LOCAL_FLOOR_MS
    );
  });

  it("refuses a batch below the floor, never yielding zero or less", () => {
    const { clock, set } = manualClock(0);
    const deadline = new Deadline(SET_LOCAL_FLOOR_MS + 0.5, clock);

    set(0.6);
    expect(() => deadline.batchTimeoutMs()).toThrow(DeadlineFloorError);
    set(SET_LOCAL_FLOOR_MS);
    expect(() => deadline.batchTimeoutMs()).toThrow(DeadlineFloorError);
    set(10_000);
    expect(() => deadline.batchTimeoutMs()).toThrow(DeadlineFloorError);
  });

  it("uses the code-owned provisional floor", () => {
    expect(SET_LOCAL_FLOOR_MS).toBe(100);
  });

  it("defaults to performance.now", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(1000);
    const deadline = new Deadline(500);

    now.mockReturnValue(1300);
    expect(deadline.remainingMs()).toBe(200);
    now.mockReturnValue(1500);
    expect(deadline.expired()).toBe(true);
    now.mockRestore();
  });
});
