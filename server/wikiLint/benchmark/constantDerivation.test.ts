import { SET_LOCAL_FLOOR_MS } from "../application/deadline";
import {
  LINT_WIKI_DEADLINE_MS,
  LINT_WIKI_STOP_MARGIN_MS,
} from "../application/lintWiki";
import {
  WRITE_ELIGIBLE_LINK_REFERENCES,
  WRITE_ELIGIBLE_MARKDOWN_BYTES,
} from "../application/writeDecision";
import type { ConstantRecord, DerivationInput } from "./constantDerivation";
import { FLOOR_GUARD_MS, deriveConstants } from "./constantDerivation";

/** Samples whose every rule passes. */
const passing: DerivationInput = {
  referenceEligible: false,
  enforcedWrites: [
    {
      sampleId: "create-06",
      markdownBytes: 131072,
      linkReferences: 8,
      validated: true,
      timedOut: false,
    },
    {
      sampleId: "create-07",
      markdownBytes: 65536,
      linkReferences: 1000,
      validated: true,
      timedOut: false,
    },
    {
      sampleId: "create-08",
      markdownBytes: 999999,
      linkReferences: 5000,
      validated: true,
      timedOut: true,
    },
    {
      sampleId: "create-09",
      markdownBytes: 888888,
      linkReferences: 4000,
      validated: false,
      timedOut: false,
    },
  ],
  lintWikiRuns: [
    { sampleId: "wiki-1", complete: true, maxUnitMs: 12.2, assemblyMs: 3 },
    { sampleId: "wiki-2", complete: true, maxUnitMs: 30.5, assemblyMs: 1 },
    { sampleId: "wiki-3", complete: true, maxUnitMs: 4, assemblyMs: 9.1 },
  ],
  setLocalStatements: [
    { sampleId: "wiki-1", maxStatementMs: 41 },
    { sampleId: "create-06", maxStatementMs: 87 },
  ],
};

/**
 * Returns one constant's record.
 *
 * @param input - the samples.
 * @param name - the constant.
 * @returns the record.
 */
function recordOf(input: DerivationInput, name: ConstantRecord["name"]) {
  const record = deriveConstants(input).constants.find(
    (constant) => constant.name === name
  );
  if (!record) {
    throw new Error("Unknown constant");
  }
  return record;
}

describe("deriveConstants", () => {
  it("derives every candidate with its rule and source samples", () => {
    const { constants, gate1 } = deriveConstants(passing);
    expect(
      constants.map(
        ({ name, current, candidate, verdict, sourceSampleIds, status }) => ({
          name,
          current,
          candidate,
          verdict,
          sourceSampleIds,
          status,
        })
      )
    ).toEqual([
      {
        name: "WRITE_ELIGIBLE_MARKDOWN_BYTES",
        current: WRITE_ELIGIBLE_MARKDOWN_BYTES,
        // The timed-out and unvalidated samples never qualify.
        candidate: 131072,
        verdict: "pass",
        sourceSampleIds: ["create-06"],
        status: "provisional",
      },
      {
        name: "WRITE_ELIGIBLE_LINK_REFERENCES",
        current: WRITE_ELIGIBLE_LINK_REFERENCES,
        candidate: 1000,
        verdict: "pass",
        sourceSampleIds: ["create-07"],
        status: "provisional",
      },
      {
        name: "LINT_WIKI_STOP_MARGIN_MS",
        current: LINT_WIKI_STOP_MARGIN_MS,
        // ceil(30.5 + 9.1).
        candidate: 40,
        verdict: "pass",
        sourceSampleIds: ["wiki-2", "wiki-3"],
        status: "provisional",
      },
      {
        name: "SET_LOCAL_FLOOR_MS",
        current: SET_LOCAL_FLOOR_MS,
        candidate: 87,
        verdict: "pass",
        sourceSampleIds: ["create-06"],
        status: "provisional",
      },
    ]);
    for (const constant of constants) {
      expect(constant.rule).not.toBe("");
      expect(constant.reason).toBeNull();
    }
    // Provisional values never make Gate 1 ready.
    expect(gate1).toBe("not ready");
  });

  it("never defaults a constant without a qualifying sample", () => {
    const record = deriveConstants({
      referenceEligible: true,
      enforcedWrites: passing.enforcedWrites.map((sample) => ({
        ...sample,
        timedOut: true,
      })),
      lintWikiRuns: [],
      setLocalStatements: [],
    });
    for (const constant of record.constants) {
      expect(constant.candidate).toBeNull();
      expect(constant.verdict).toBe("fail");
      expect(constant.reason).toEqual(expect.any(String));
      expect(constant.sourceSampleIds).toEqual([]);
      expect(constant.currentSatisfiesRule).toBe(false);
      expect(constant.status).toBe("reference");
    }
    expect(record.gate1).toBe("not ready");
  });

  it("fails the stop margin while a measured run does not complete", () => {
    const record = recordOf(
      {
        ...passing,
        lintWikiRuns: [
          ...passing.lintWikiRuns,
          { sampleId: "wiki-4", complete: false, maxUnitMs: 1, assemblyMs: 1 },
        ],
      },
      "LINT_WIKI_STOP_MARGIN_MS"
    );
    expect(record.candidate).toBe(40);
    expect(record.verdict).toBe("fail");
    expect(record.reason).toBe("1 measured lint_wiki run(s) did not complete");
  });

  it("fails a stop margin at the lint_wiki deadline and passes one below it", () => {
    const run = (maxUnitMs: number) =>
      recordOf(
        {
          ...passing,
          lintWikiRuns: [
            { sampleId: "wiki-1", complete: true, maxUnitMs, assemblyMs: 0 },
          ],
        },
        "LINT_WIKI_STOP_MARGIN_MS"
      );
    expect(run(LINT_WIKI_DEADLINE_MS - 1).verdict).toBe("pass");
    expect(run(LINT_WIKI_DEADLINE_MS).verdict).toBe("fail");
  });

  it.each([
    [FLOOR_GUARD_MS - 1, "pass"],
    [FLOOR_GUARD_MS, "fail"],
    [9000 - 2000, "fail"],
    [9000, "fail"],
  ] as const)("judges a floor candidate of %i ms as %s", (ms, verdict) => {
    expect(FLOOR_GUARD_MS).toBe(7000);
    const record = recordOf(
      {
        ...passing,
        setLocalStatements: [{ sampleId: "s", maxStatementMs: ms }],
      },
      "SET_LOCAL_FLOOR_MS"
    );
    expect(record.candidate).toBe(ms);
    expect(record.verdict).toBe(verdict);
  });

  it("rounds the floor up and keeps it at least 1 ms", () => {
    const floorOf = (maxStatementMs: number) =>
      recordOf(
        { ...passing, setLocalStatements: [{ sampleId: "s", maxStatementMs }] },
        "SET_LOCAL_FLOOR_MS"
      ).candidate;
    expect(floorOf(0)).toBe(1);
    expect(floorOf(12.1)).toBe(13);
  });

  it("records whether each code-owned value already satisfies its rule", () => {
    const record = deriveConstants({
      ...passing,
      enforcedWrites: [
        {
          sampleId: "max",
          markdownBytes: WRITE_ELIGIBLE_MARKDOWN_BYTES,
          linkReferences: WRITE_ELIGIBLE_LINK_REFERENCES,
          validated: true,
          timedOut: false,
        },
      ],
    });
    expect(
      record.constants.map((constant) => constant.currentSatisfiesRule)
    ).toEqual([true, true, true, true]);
    // Still provisional: not a reference run.
    expect(record.gate1).toBe("not ready");
  });

  it("is ready only for a reference run whose every value passes as committed", () => {
    const committed: DerivationInput = {
      referenceEligible: true,
      enforcedWrites: [
        {
          sampleId: "max",
          markdownBytes: WRITE_ELIGIBLE_MARKDOWN_BYTES,
          linkReferences: WRITE_ELIGIBLE_LINK_REFERENCES,
          validated: true,
          timedOut: false,
        },
      ],
      lintWikiRuns: passing.lintWikiRuns,
      setLocalStatements: passing.setLocalStatements,
    };
    expect(deriveConstants(committed).gate1).toBe("ready");
    expect(
      deriveConstants({
        ...committed,
        setLocalStatements: [
          { sampleId: "s", maxStatementMs: SET_LOCAL_FLOOR_MS + 1 },
        ],
      }).gate1
    ).toBe("not ready");
  });
});
