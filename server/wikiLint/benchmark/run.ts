import "../../scripts/bootstrap";
import fs from "node:fs";
import path from "node:path";
import type { Job } from "bull";
import Logger from "@server/logging/Logger";
import { BaseTask } from "@server/queues/tasks/base/BaseTask";
import { sequelize } from "@server/storage/database";
import type { ProfileName } from "./fixtureGenerator";
import { PROFILES } from "./fixtureGenerator";
import { runBenchmark } from "./harness";

/**
 * Runs the AD-17 benchmark from the production build and writes its
 * manifest:
 *
 *   node build/server/wikiLint/benchmark/run.js [--smoke] [--seed SEED]
 *     [--profiles wiki_150,wiki_1000] [--out FILE]
 *
 * `--smoke` runs reduced samples, and its manifest is never Gate 1 evidence.
 */
async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const valueOf = (flag: string) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const profiles = valueOf("--profiles")
    ?.split(",")
    .filter((name): name is ProfileName => name in PROFILES);
  const out = path.resolve(
    valueOf("--out") ??
      `wikilint-benchmark-manifest-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );

  // As in the server process (server/main.ts), an unhandled rejection is
  // logged rather than ending the process.
  process.on("unhandledRejection", (error: Error) => {
    Logger.error("Unhandled promise rejection", error, {
      stack: error.stack,
    });
  });

  // The harness runs in one process with no queue worker, so a scheduled
  // import task is performed in-process by its job handle.
  BaseTask.prototype.schedule = function (
    this: BaseTask<object>,
    props: object
  ) {
    return Promise.resolve({ finished: () => this.perform(props) } as Job);
  };

  const manifest = await runBenchmark({
    smoke: args.includes("--smoke"),
    seed: valueOf("--seed"),
    profiles: profiles?.length ? profiles : undefined,
    command: [
      path.basename(process.argv[0]),
      path.relative(process.cwd(), process.argv[1] ?? ""),
      ...args,
    ].join(" "),
    repoRoot: process.cwd(),
    entryPath: process.argv[1] ? path.resolve(process.argv[1]) : null,
  });
  fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(
    `${manifest.label}; gate1Eligible: ${manifest.gate1Eligible}; ${manifest.deviations.length} deviation(s); manifest: ${out}\n`
  );
  return 0;
}

void main()
  .catch((error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
    return 1;
  })
  .then(async (code) => {
    await sequelize.close().catch(() => undefined);
    process.exit(code);
  });
