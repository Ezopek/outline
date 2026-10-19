import fs from "node:fs";
import path from "node:path";
import type { Job } from "bull";
import { BaseTask } from "@server/queues/tasks/base/BaseTask";
import { runBenchmark } from "./harness";

/**
 * The retained smoke run of a host without a queue worker or Redis, such as a
 * developer machine: the in-process harness on both profiles at reduced
 * samples. It runs only when `WIKILINT_BENCH_SMOKE_OUT` names the manifest
 * file to write:
 *
 *   WIKILINT_BENCH_SMOKE_OUT=docs/wikilint-gate-1/benchmark/smoke-manifest.json \
 *     vitest run --project server server/wikiLint/benchmark/smokeRun.test.ts
 *
 * Its manifest is never Gate 1 evidence.
 */
const OUT = process.env.WIKILINT_BENCH_SMOKE_OUT;

describe.runIf(!!OUT)("retained smoke run", () => {
  it("writes a smoke manifest that is not Gate 1 evidence", async () => {
    vi.spyOn(BaseTask.prototype, "schedule").mockImplementation(function (
      this: BaseTask<object>,
      props: object
    ) {
      return Promise.resolve({ finished: () => this.perform(props) } as Job);
    });
    const manifest = await runBenchmark({
      smoke: true,
      seed: process.env.WIKILINT_BENCH_SEED || undefined,
      command: `WIKILINT_BENCH_SMOKE_OUT=${OUT} vitest run --project server server/wikiLint/benchmark/smokeRun.test.ts`,
      repoRoot: process.cwd(),
      entryPath: null,
    });
    fs.writeFileSync(
      path.resolve(OUT as string),
      `${JSON.stringify(manifest, null, 2)}\n`
    );

    expect(manifest.gate1Eligible).toBe(false);
    expect(manifest.derivation.gate1).toBe("not ready");
  }, 540000);
});
