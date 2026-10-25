import { randomUUID } from "node:crypto";
import type { Job } from "bull";
import { BaseTask } from "@server/queues/tasks/base/BaseTask";
import {
  MAX_LINK_REFERENCES_PER_DOCUMENT,
  WRITE_MODES,
} from "./fixtureGenerator";
import type { CaseRecord, Manifest } from "./harness";
import {
  HELD_POOL_TOLERANCE_MS,
  evaluateBudgets,
  heldPoolVerdict,
  runBenchmark,
} from "./harness";

/** The test-scale deadline of the held-pool re-run. */
const HELD_POOL_DEADLINE_MS = 3000;

const SAMPLING = { warmups: 1, samples: 2 };

let manifest: Manifest;

beforeAll(async () => {
  // As in every server test, a scheduled import task is performed by its job
  // handle; the shared setup installs this only before each test.
  vi.spyOn(BaseTask.prototype, "schedule").mockImplementation(function (
    this: BaseTask<object>,
    props: object
  ) {
    return Promise.resolve({ finished: () => this.perform(props) } as Job);
  });
  manifest = await runBenchmark({
    // A fresh seed per run, since the test database is kept between runs.
    seed: `harness-test-${randomUUID()}`,
    smoke: true,
    sampling: SAMPLING,
    profiles: ["wiki_150"],
    heldPool: { deadlineMs: HELD_POOL_DEADLINE_MS },
    command: "vitest run server/wikiLint/benchmark/harness.test.ts",
    repoRoot: process.cwd(),
    entryPath: null,
  });
}, 120000);

/**
 * Returns one case of the manifest.
 *
 * @param id - the case ID.
 * @returns the case.
 */
function caseOf(id: string): CaseRecord {
  const found = manifest.cases.find((record) => record.id === id);
  if (!found) {
    throw new Error(`Missing case ${id}`);
  }
  return found;
}

describe("runBenchmark (smoke, wiki_150)", () => {
  it("records every criterion 8 field", () => {
    expect(manifest.manifestVersion).toBe(1);
    expect(manifest).toHaveProperty("sourceCommit");
    expect(manifest.imageDigest).toEqual({
      value: null,
      note: expect.stringContaining("not Gate 2 publication"),
    });
    expect(manifest.fixture).toMatchObject({
      generator: "server/wikiLint/benchmark/fixtureGenerator.ts",
      seed: expect.stringMatching(/^harness-test-/),
      datasetHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      maxLinkReferencesPerDocument: MAX_LINK_REFERENCES_PER_DOCUMENT,
    });
    expect(manifest.fixture).toHaveProperty("generatorCommit");
    expect(manifest.policySetFingerprint).toEqual(expect.any(String));
    expect(manifest.policySetFingerprint).not.toBe("");

    const { environment } = manifest;
    expect(environment.nodeVersion).toBe(process.version);
    expect(environment).toHaveProperty("yarnVersion");
    expect(environment.postgres.serverVersion).toMatch(/^\d+\.\d+/);
    expect(environment.postgres.settings).toHaveProperty("max_connections");
    expect(environment.postgres.settings).toHaveProperty("server_version");
    expect(environment.kernel).toEqual(expect.any(String));
    expect(environment.cgroup).toHaveProperty("cpus");
    expect(environment.cgroup).toHaveProperty("memoryBytes");
    expect(Object.keys(environment.topology).sort()).toEqual([
      "REQUEST_TIMEOUT",
      "SERVICES",
      "WEB_CONCURRENCY",
      "connectionPoolMax",
      "connectionPoolMin",
    ]);
    expect(environment.topology.connectionPoolMax).toEqual(expect.any(Number));
    expect(manifest.command).toContain("harness.test.ts");
    expect(manifest.sampling).toMatchObject({
      warmups: SAMPLING.warmups,
      samples: SAMPLING.samples,
      coldRuns: 1,
      full: { warmups: 5, samples: 40 },
    });
  });

  it("is never Gate 1 evidence and lists its deviations", () => {
    expect(manifest.smoke).toBe(true);
    expect(manifest.gate1Eligible).toBe(false);
    expect(manifest.label).toContain("not Gate 1 evidence");
    expect(manifest.deviations.length).toBeGreaterThan(0);
    for (const deviation of manifest.deviations) {
      expect(deviation).toEqual({
        item: expect.any(String),
        expected: expect.any(String),
        actual: expect.any(String),
      });
    }
  });

  it("retains every raw timing, RSS, and query sample", () => {
    const perCase = SAMPLING.warmups + SAMPLING.samples;
    expect(caseOf("lint_document").samples).toHaveLength(perCase);
    expect(caseOf("lint_wiki:wiki_150").samples).toHaveLength(perCase);
    for (const mode of WRITE_MODES) {
      expect(caseOf(`write:${mode}`).samples).toHaveLength(2 * perCase);
    }
    expect(caseOf("html").samples).toHaveLength(2 * perCase);
    for (const record of manifest.cases) {
      expect(record.samples.filter((sample) => sample.cold)).toHaveLength(
        record.kind === "write" || record.kind === "html" ? 2 : 1
      );
      for (const sample of record.samples) {
        expect(sample.durationMs).toBeGreaterThan(0);
        expect(sample.rssBytes).toBeGreaterThan(0);
        expect(sample.peakRssBytes).toBeGreaterThanOrEqual(sample.rssBytes);
        expect(sample.queryDurationsMs).toHaveLength(sample.queries);
        expect(sample.queries).toBeGreaterThan(0);
      }
    }
  });

  it("measures complete lint runs with no System Failure in the timed datasets", () => {
    for (const id of ["lint_document", "lint_wiki:wiki_150"]) {
      for (const sample of caseOf(id).samples) {
        expect(sample.lint).toMatchObject({
          ok: true,
          state: "complete",
          systemFailureCodes: [],
        });
      }
    }
    const wiki = caseOf("lint_wiki:wiki_150");
    expect(wiki).toMatchObject({ documents: 150, profile: "wiki_150" });
    for (const sample of wiki.samples) {
      expect(sample.unitCount).toBeGreaterThan(0);
      expect(sample.unitMaxMs).toEqual(expect.any(Number));
      expect(sample.assemblyMs).toEqual(expect.any(Number));
      expect(sample.batchMaxMs).toEqual(expect.any(Number));
      expect(sample.eventLoopMaxMs).toEqual(expect.any(Number));
      expect(sample.setLocalMaxStatementMs).toEqual(expect.any(Number));
    }
  });

  it("pairs every write mode and validates the enforced samples at both maxima", () => {
    for (const mode of WRITE_MODES) {
      const record = caseOf(`write:${mode}`);
      for (const sample of record.samples) {
        expect(sample.write?.ok).toBe(true);
        if (sample.write?.side === "enforced") {
          expect(sample.write.validationStatus).toMatch(/^validated/);
          expect(sample.write.systemFailureCodes).toEqual([]);
          expect(sample.write.markdownBytes).toBeGreaterThan(0);
        } else {
          expect(sample.write?.validationStatus).toBeNull();
        }
      }
      expect(record.summary.overheadsMs).toHaveLength(SAMPLING.samples);
    }
    for (const mode of ["create", "replace"]) {
      const maxima = caseOf(`write:${mode}`).samples.filter(
        (sample) => sample.write?.side === "enforced" && sample.write.label
      );
      expect(new Set(maxima.map((sample) => sample.write?.label))).toEqual(
        new Set(["max_links", "max_markdown"])
      );
      expect(maxima).toHaveLength(2);
      expect(
        maxima.find((sample) => sample.write?.label === "max_links")?.write
          ?.linkReferences
      ).toBe(MAX_LINK_REFERENCES_PER_DOCUMENT);
    }
  });

  it("records each budget's measured value and verdict", () => {
    expect(manifest.budgets.map((budget) => budget.id).sort()).toEqual(
      [
        "lint_document.p95",
        "lint_document.semantics",
        "lint_wiki.wiki_150.complete",
        "lint_wiki.wiki_150.p95",
        ...WRITE_MODES.map((mode) => `write.${mode}.overhead_p95`),
      ].sort()
    );
    for (const budget of manifest.budgets) {
      expect(budget).toEqual({
        id: expect.any(String),
        criterion: expect.stringMatching(/^AC [456]$/),
        description: expect.any(String),
        limit: expect.any(Number),
        measured: expect.any(Number),
        unit: expect.stringMatching(/^(ms|runs)$/),
        verdict: expect.stringMatching(/^(pass|fail)$/),
        sourceCaseId: expect.any(String),
        sourceSampleIds: expect.any(Array),
      });
    }
  });

  it("records a run that is not complete as a failure, leaving the result as it is", () => {
    const wiki = caseOf("lint_wiki:wiki_150");
    const [first, ...rest] = wiki.samples;
    const incomplete: CaseRecord = {
      ...wiki,
      samples: [
        first,
        ...rest.map((sample, index) =>
          index === 0 && sample.lint
            ? {
                ...sample,
                lint: {
                  ...sample.lint,
                  state: "incomplete" as const,
                  complete: false,
                  systemFailureCodes: ["VALIDATION_TIMEOUT" as const],
                },
              }
            : sample
        ),
      ],
    };
    const before = JSON.stringify(incomplete);
    const verdict = evaluateBudgets([incomplete]).find(
      (budget) => budget.id === "lint_wiki.wiki_150.complete"
    );
    expect(verdict).toMatchObject({
      measured: 1,
      verdict: "fail",
      sourceSampleIds: [rest[0].id],
    });
    expect(JSON.stringify(incomplete)).toBe(before);
    expect(
      manifest.budgets.find(
        (budget) => budget.id === "lint_wiki.wiki_150.complete"
      )
    ).toMatchObject({ measured: 0, verdict: "pass" });
  });

  it("ends the held-pool re-run as VALIDATION_TIMEOUT within the deadline and tags it DW-6", () => {
    expect(manifest.heldPool).toMatchObject({
      profile: "wiki_150",
      deadlineMs: HELD_POOL_DEADLINE_MS,
      outcome: "result",
      state: "failed",
      systemFailureCodes: ["VALIDATION_TIMEOUT"],
      poolAfterRelease: { using: 0, waiting: 0 },
    });
    expect(manifest.heldPool.heldConnections).toBe(manifest.heldPool.poolMax);
    expect(manifest.heldPool.elapsedMs).toBeLessThan(
      HELD_POOL_DEADLINE_MS + HELD_POOL_TOLERANCE_MS
    );
    expect(manifest.dw.map((record) => record.entry)).toEqual([
      "DW-4",
      "DW-5",
      "DW-6",
    ]);
    const dw6 = manifest.dw.find((record) => record.entry === "DW-6");
    expect(dw6).toMatchObject({
      verdict: "pass",
      status: expect.stringContaining("open"),
    });
    for (const record of manifest.dw.slice(0, 2)) {
      expect(record).toMatchObject({
        measuredMs: expect.any(Number),
        comparedWith: { name: "LINT_WIKI_STOP_MARGIN_MS" },
        verdict: expect.stringMatching(/^(pass|fail)$/),
      });
    }
  });

  it("records the concurrent writer apart from the timed samples", () => {
    expect(manifest.concurrentWriter).toMatchObject({
      profile: "wiki_150",
      lintWiki: { state: "complete" },
    });
    expect(manifest.concurrentWriter.writes).toBeGreaterThan(0);
    expect(manifest.concurrentWriter.writesSucceeded).toBe(
      manifest.concurrentWriter.writes
    );
  });

  it("derives every constant as provisional, so Gate 1 is not ready", () => {
    expect(manifest.derivation.gate1).toBe("not ready");
    expect(manifest.derivation.constants.map(({ name }) => name)).toEqual([
      "WRITE_ELIGIBLE_MARKDOWN_BYTES",
      "WRITE_ELIGIBLE_LINK_REFERENCES",
      "LINT_WIKI_STOP_MARGIN_MS",
      "SET_LOCAL_FLOOR_MS",
    ]);
    for (const constant of manifest.derivation.constants) {
      expect(constant.status).toBe("provisional");
      expect(constant.sourceSampleIds.length).toBeGreaterThan(0);
    }
  });
});

describe("heldPoolVerdict", () => {
  const DEADLINE_MS = 60000;

  /**
   * Returns a held-pool record of the 2026-10-25 reference run's shape.
   *
   * @param overrides - the fields to replace.
   * @returns the record.
   */
  function heldPool(overrides: Record<string, unknown> = {}) {
    return {
      profile: "wiki_1000",
      deadlineMs: DEADLINE_MS,
      elapsedMs: 30004,
      outcome: "result",
      state: "failed",
      systemFailureCodes: ["VALIDATION_RUNTIME_FAILED"],
      poolAfterRelease: { using: 0, waiting: 0 },
      ...overrides,
    };
  }

  it.each(["VALIDATION_TIMEOUT", "VALIDATION_RUNTIME_FAILED"])(
    "passes a run that ended as %s within the bound with the pool idle",
    (code) => {
      expect(heldPoolVerdict(heldPool({ systemFailureCodes: [code] }))).toBe(
        "pass"
      );
      expect(
        heldPoolVerdict(
          heldPool({
            systemFailureCodes: [code],
            elapsedMs: DEADLINE_MS + HELD_POOL_TOLERANCE_MS,
          })
        )
      ).toBe("pass");
    }
  );

  it.each([
    ["an overrun", { elapsedMs: DEADLINE_MS + HELD_POOL_TOLERANCE_MS + 1 }],
    ["no elapsed time", { elapsedMs: undefined }],
    [
      "another code",
      { systemFailureCodes: ["VALIDATION_RESOURCE_LIMIT_EXCEEDED"] },
    ],
    ["no System Failure", { systemFailureCodes: [] }],
    [
      "more than one System Failure",
      {
        systemFailureCodes: ["VALIDATION_TIMEOUT", "VALIDATION_RUNTIME_FAILED"],
      },
    ],
    ["another state", { state: "incomplete" }],
    [
      "a connection left in use",
      { poolAfterRelease: { using: 1, waiting: 0 } },
    ],
    [
      "an acquisition left waiting",
      { poolAfterRelease: { using: 0, waiting: 1 } },
    ],
    ["no pool usage after release", { poolAfterRelease: undefined }],
  ])("fails %s", (_name, overrides) => {
    expect(heldPoolVerdict(heldPool(overrides))).toBe("fail");
  });
});
