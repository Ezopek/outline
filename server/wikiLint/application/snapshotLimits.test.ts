import {
  SnapshotMeter,
  WIKI_SNAPSHOT_LIMITS,
  WikiResourceLimitError,
} from "./snapshotLimits";

/**
 * Starts a meter at the real limits.
 *
 * @returns the meter.
 */
const meter = () => new SnapshotMeter(WIKI_SNAPSHOT_LIMITS);

/** The limits metered as running counts, with their adders. */
const summed = [
  ["documents", (m: SnapshotMeter, n: number) => m.addDocuments(n), 5000],
  [
    "linkReferences",
    (m: SnapshotMeter, n: number) => m.addLinkReferences(n),
    100000,
  ],
  [
    "structureNodes",
    (m: SnapshotMeter, n: number) => m.addStructureNodes(n),
    10000,
  ],
  [
    "structureBytes",
    (m: SnapshotMeter, n: number) => m.addStructureBytes(n),
    4194304,
  ],
] as const;

describe("WIKI_SNAPSHOT_LIMITS", () => {
  it("holds the frozen AD-16 constants", () => {
    expect(WIKI_SNAPSHOT_LIMITS).toEqual({
      documents: 5000,
      documentMarkdownBytes: 1048576,
      totalMarkdownBytes: 67108864,
      linkReferences: 100000,
      structureNodes: 10000,
      structureBytes: 4194304,
    });
    expect(Object.isFrozen(WIKI_SNAPSHOT_LIMITS)).toBe(true);
  });
});

describe("SnapshotMeter", () => {
  it.each(summed)(
    "passes %s at the limit and throws above it",
    (_name, add, limit) => {
      expect(() => add(meter(), limit)).not.toThrow();
      expect(() => add(meter(), limit + 1)).toThrow(WikiResourceLimitError);
    }
  );

  it.each(summed)("accumulates %s across calls", (_name, add, limit) => {
    const accumulating = meter();
    add(accumulating, limit - 1);
    add(accumulating, 1);
    expect(() => add(accumulating, 1)).toThrow(WikiResourceLimitError);
  });

  it("passes one document of exactly 1 MiB and throws one byte above", () => {
    expect(() => meter().addMarkdown("a".repeat(1048576))).not.toThrow();
    expect(() => meter().addMarkdown("a".repeat(1048577))).toThrow(
      WikiResourceLimitError
    );
  });

  it("counts UTF-8 bytes, not characters", () => {
    // Each "ą" is two UTF-8 bytes and each "😀" four.
    expect(() => meter().addMarkdown("ą".repeat(524288))).not.toThrow();
    expect(() => meter().addMarkdown(`${"ą".repeat(524288)}a`)).toThrow(
      WikiResourceLimitError
    );
    expect(() => meter().addMarkdown("😀".repeat(262144))).not.toThrow();
    expect(() => meter().addMarkdown(`${"😀".repeat(262144)}a`)).toThrow(
      WikiResourceLimitError
    );
  });

  it("passes 64 MiB of total Markdown and throws one byte above", () => {
    const accumulating = meter();
    const page = "a".repeat(1048576);
    for (let index = 0; index < 64; index++) {
      accumulating.addMarkdown(page);
    }
    expect(() => accumulating.addMarkdown("a")).toThrow(WikiResourceLimitError);
  });

  it("throws a fixed message", () => {
    const error = new WikiResourceLimitError();

    expect(error.name).toBe("WikiResourceLimitError");
    expect(error.message).toBe("A snapshot resource limit was exceeded");
  });
});
