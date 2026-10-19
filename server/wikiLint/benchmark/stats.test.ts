import { maximum, median, nearestRank, normalizedCosts, p95 } from "./stats";

describe("nearestRank", () => {
  it("takes the value at rank ceil(0.95 * N) in ascending order", () => {
    const forty = Array.from({ length: 40 }, (_, index) => 40 - index);
    // ceil(0.95 * 40) = 38.
    expect(p95(forty)).toBe(38);

    const twenty = Array.from({ length: 20 }, (_, index) => index + 1);
    // ceil(0.95 * 20) = 19.
    expect(p95(twenty)).toBe(19);

    const one = [7];
    expect(p95(one)).toBe(7);

    // ceil(0.95 * 3) = 3.
    expect(p95([3, 1, 2])).toBe(3);
  });

  it("takes the median at rank ceil(0.5 * N)", () => {
    expect(median([4, 1, 3, 2])).toBe(2);
    expect(median([5, 1, 3])).toBe(3);
  });

  it("returns the maximum", () => {
    expect(maximum([2, 9, 4])).toBe(9);
  });

  it("returns null without a finite value and ignores non-finite ones", () => {
    expect(p95([])).toBeNull();
    expect(nearestRank([Number.NaN, Infinity], 0.5)).toBeNull();
    expect(maximum([1, Number.NaN, 3])).toBe(3);
  });

  it("never reorders its input", () => {
    const values = [3, 1, 2];
    p95(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe("normalizedCosts", () => {
  it("normalizes runtime, queries, and RSS by documents and links", () => {
    expect(
      normalizedCosts({
        runtimeMs: 1500,
        queries: 300,
        peakRssBytes: 300_000_000,
        documents: 150,
        links: 1200,
      })
    ).toEqual({
      msPerDocument: 10,
      msPerLink: 1.25,
      queriesPerDocument: 2,
      queriesPerLink: 0.25,
      rssBytesPerDocument: 2_000_000,
    });
  });

  it("returns null for a cost over zero documents or links", () => {
    expect(
      normalizedCosts({
        runtimeMs: 10,
        queries: 3,
        peakRssBytes: 1,
        documents: 0,
        links: 0,
      })
    ).toEqual({
      msPerDocument: null,
      msPerLink: null,
      queriesPerDocument: null,
      queriesPerLink: null,
      rssBytesPerDocument: null,
    });
  });
});
