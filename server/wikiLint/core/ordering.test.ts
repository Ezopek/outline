import type { IssueItem } from "./contracts";
import { compareUtf8, comparePath, sortIssues } from "./ordering";
import { createFinding, createSystemFailure } from "./registry";

/**
 * Returns deterministic permutations of a list using a fixed-seed generator.
 *
 * @param list - the list to permute.
 * @param count - the number of permutations.
 * @returns the permutations.
 */
function permutations<T>(list: readonly T[], count: number): T[][] {
  let seed = 0x2f6b1d3a;
  const next = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, () => {
    const copy = [...list];
    for (let index = copy.length - 1; index > 0; index--) {
      const swap = Math.floor(next() * (index + 1));
      [copy[index], copy[swap]] = [copy[swap], copy[index]];
    }
    return copy;
  });
}

const d1 = "00000000-0000-4000-8000-000000000001";
const d2 = "00000000-0000-4000-8000-000000000002";
const d0 = "00000000-0000-4000-8000-000000000000";
const c1 = "00000000-0000-4000-8000-0000000000c1";
const c2 = "00000000-0000-4000-8000-0000000000c2";
const c3 = "00000000-0000-4000-8000-0000000000c3";

const text = (
  documentId: string,
  line: number,
  column: number,
  path?: (number | string)[]
) =>
  path === undefined
    ? { kind: "text" as const, documentId, line, column }
    : { kind: "text" as const, documentId, line, column, path };

/** Items listed in their expected AD-4 order. */
const expected: IssueItem[] = [
  {
    issue: createFinding("HEADING_LEVEL_NOT_ALLOWED", text(d1, 1, 1, [0])),
    sortCollectionId: c1,
    ordinal: 0,
  },
  {
    issue: createFinding("HEADING_LEVEL_NOT_ALLOWED", text(d1, 1, 1, [0, 0])),
    sortCollectionId: c1,
    ordinal: 1,
  },
  {
    issue: createFinding("HEADING_LEVEL_NOT_ALLOWED", text(d1, 1, 1, [0, "a"])),
    sortCollectionId: c1,
    ordinal: 2,
  },
  {
    issue: createFinding("HEADING_LEVEL_NOT_ALLOWED", text(d1, 1, 1, [1])),
    sortCollectionId: c1,
    ordinal: 3,
  },
  {
    issue: createFinding("HEADING_LEVEL_NOT_ALLOWED", text(d1, 1, 1)),
    sortCollectionId: c1,
    ordinal: 4,
  },
  {
    issue: createFinding("HEADING_LEVEL_NOT_ALLOWED", text(d1, 1, 2, [0])),
    sortCollectionId: c1,
    ordinal: 5,
  },
  {
    issue: createFinding("MARKDOWN_STRUCTURE_UNSUPPORTED", text(d1, 2, 1, [2])),
    sortCollectionId: c1,
    // Code precedes ordinal: this sorts first despite the higher ordinal.
    ordinal: 5,
  },
  {
    issue: createFinding("SECTION_ORDER_INVALID", text(d1, 2, 1, [2])),
    sortCollectionId: c1,
    ordinal: 0,
  },
  {
    issue: createFinding("SECTION_ORDER_INVALID", text(d1, 2, 1, [2])),
    sortCollectionId: c1,
    ordinal: 1,
  },
  {
    issue: createFinding("SECTION_ORDER_INVALID", text(d1, 2, 1, [2])),
    sortCollectionId: c1,
  },
  {
    issue: createFinding("SECTION_ORDER_INVALID", text(d1, 10, 1, [3])),
    sortCollectionId: c1,
    ordinal: 2,
  },
  // Location-kind rank precedes code: R... < P... < PO... by rank.
  {
    issue: createFinding("REQUIRED_SECTION_MISSING", {
      kind: "document",
      documentId: d1,
    }),
    sortCollectionId: c1,
    ordinal: 0,
  },
  {
    issue: createFinding("PARENT_DOCUMENT_UNRESOLVED", {
      kind: "relationship",
      documentId: d1,
      relationshipKind: "parent",
    }),
    sortCollectionId: c1,
  },
  {
    issue: createSystemFailure("POLICY_CONFIGURATION_INVALID", {
      kind: "scope",
      scopeKind: "document",
      documentId: d1,
    }),
    sortCollectionId: c1,
  },
  {
    issue: createFinding("HEADING_LEVEL_NOT_ALLOWED", text(d2, 1, 1, [0])),
    sortCollectionId: c1,
    ordinal: 0,
  },
  // A scope location carrying its own collection sorts with that collection.
  {
    issue: createSystemFailure("VALIDATION_RUNTIME_FAILED", {
      kind: "scope",
      scopeKind: "collection",
      collectionId: c1,
    }),
  },
  {
    issue: createFinding("HEADING_LEVEL_NOT_ALLOWED", text(d0, 1, 1, [0])),
    sortCollectionId: c2,
    ordinal: 0,
  },
  // Code-point order, not UTF-16 order.
  {
    issue: createFinding("REQUIRED_SECTION_MISSING", {
      kind: "document",
      documentId: "｡",
    }),
    sortCollectionId: c3,
    ordinal: 0,
  },
  {
    issue: createFinding("REQUIRED_SECTION_MISSING", {
      kind: "document",
      documentId: "\u{1F600}",
    }),
    sortCollectionId: c3,
    ordinal: 0,
  },
  // Absent collection keys sort last.
  {
    issue: createFinding("REQUIRED_SECTION_MISSING", {
      kind: "document",
      documentId: d0,
    }),
    ordinal: 0,
  },
  {
    issue: createSystemFailure("VALIDATION_TIMEOUT", {
      kind: "scope",
      scopeKind: "configured_collections",
    }),
  },
];

describe("compareUtf8", () => {
  it("orders by code point, not UTF-16 code unit", () => {
    const halfwidthStop = "｡";
    const grinningFace = "\u{1F600}";

    // UTF-16 code-unit order puts the surrogate pair first.
    expect(grinningFace < halfwidthStop).toBe(true);
    expect(compareUtf8(halfwidthStop, grinningFace)).toBeLessThan(0);
    expect(compareUtf8(grinningFace, halfwidthStop)).toBeGreaterThan(0);
  });

  it("orders bytewise rather than by locale", () => {
    expect(compareUtf8("Z", "a")).toBeLessThan(0);
    expect(compareUtf8("f", "é")).toBeLessThan(0);
    expect(compareUtf8("\u{1F600}", "\u{1F601}")).toBeLessThan(0);
  });

  it("places a shorter prefix first and equal strings together", () => {
    expect(compareUtf8("ab", "abc")).toBeLessThan(0);
    expect(compareUtf8("abc", "ab")).toBeGreaterThan(0);
    expect(compareUtf8("ab", "ab")).toBe(0);
  });
});

describe("comparePath", () => {
  it("places integer segments before string segments", () => {
    expect(comparePath([9], ["0"])).toBeLessThan(0);
    expect(comparePath(["0"], [9])).toBeGreaterThan(0);
  });

  it("compares integers numerically and strings bytewise", () => {
    expect(comparePath([2], [10])).toBeLessThan(0);
    expect(comparePath(["10"], ["2"])).toBeLessThan(0);
    expect(comparePath(["｡"], ["\u{1F600}"])).toBeLessThan(0);
  });

  it("places a shorter prefix first", () => {
    expect(comparePath([1], [1, 0])).toBeLessThan(0);
    expect(comparePath([1, 0], [1])).toBeGreaterThan(0);
    expect(comparePath([1, 0], [1, 0])).toBe(0);
  });
});

describe("sortIssues", () => {
  const expectedJson = JSON.stringify(expected.map((item) => item.issue));

  it("produces byte-identical output for every input order", () => {
    for (const order of permutations(expected, 50)) {
      expect(JSON.stringify(sortIssues(order))).toBe(expectedJson);
    }
  });

  it("ignores messages and titles", () => {
    const relabeled = expected.map((item, index) => ({
      ...item,
      title: `Title ${expected.length - index}`,
      issue: { ...item.issue, message: String(expected.length - index) },
    }));
    for (const order of permutations(relabeled, 10)) {
      expect(
        sortIssues(order).map(({ message: _message, ...issue }) => issue)
      ).toEqual(
        expected.map(({ issue: { message: _message, ...issue } }) => issue)
      );
    }
  });

  it("never orders by detail", () => {
    const named = (heading: string) =>
      createFinding(
        "REQUIRED_SECTION_MISSING",
        { kind: "document", documentId: d1 },
        { kind: "section", heading, headingLevel: 2 }
      );
    const zeta = named("Zeta");
    const alpha = named("Alpha");

    // The ordinal decides, although Alpha was emitted first.
    expect(
      sortIssues([
        { issue: alpha, ordinal: 1 },
        { issue: zeta, ordinal: 0 },
      ])
    ).toEqual([zeta, alpha]);
    // Without ordinals, emission order decides: Zeta was emitted first.
    expect(sortIssues([{ issue: zeta }, { issue: alpha }])).toEqual([
      zeta,
      alpha,
    ]);
  });

  it("breaks full ties by emission order", () => {
    const first = createSystemFailure("VALIDATION_RUNTIME_FAILED", {
      kind: "scope",
      scopeKind: "collection",
    });
    const second = createSystemFailure("VALIDATION_RUNTIME_FAILED", {
      kind: "scope",
      scopeKind: "configured_collections",
    });

    expect(sortIssues([{ issue: first }, { issue: second }])).toEqual([
      first,
      second,
    ]);
    expect(sortIssues([{ issue: second }, { issue: first }])).toEqual([
      second,
      first,
    ]);
  });
});
