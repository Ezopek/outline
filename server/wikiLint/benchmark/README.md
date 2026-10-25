# Wiki lint AD-17 benchmark

The reproducible performance, growth and constant-derivation benchmark of Story 3.3. It has four parts:

- `fixtureGenerator.ts`: the seeded datasets. It generates the 3-collection/150-document and 10-collection/1,000-document `lint_wiki` profiles, the stratified `lint_document` profile and the paired write fixtures. The same seed gives the same bytes and `datasetHash`.
- `referenceProfile.ts`: captures the environment and lists every deviation from the AD-17 reference profile.
- `harness.ts` with `run.ts`: seeds the database and installs the benchmark policy through `initializePolicyConfiguration`. It runs every case through the registered MCP tools over an in-memory transport and writes the manifest.
- `constantDerivation.ts`: derives the AD-13 write-eligibility constants, the AD-11 stop margin and the `SET LOCAL` floor from the retained samples, and checks each rule.

A run is Gate 1 evidence only when `gate1Eligible` is `true`: a full run with no deviation. A smoke run, or a run on any other host, is never Gate 1 evidence. Its constants stay `provisional`, and Gate 1 stays `not ready`.

## Reference profile

| Item              | Reference                                                         | How the harness establishes it                                                                                                                                                        |
| ----------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform          | Linux x86-64                                                      | detected: `process.platform`, `process.arch`                                                                                                                                          |
| App limits        | two dedicated vCPU, 4 GiB                                         | detected: cgroup v2 `cpu.max`/`memory.max` (v1 fallback)                                                                                                                              |
| Node              | exactly the Dockerfile `runner` version                           | detected: `node --version` against `Dockerfile`                                                                                                                                       |
| Yarn              | the `package.json` `packageManager` version                       | detected: the Yarn user agent, so start the run through `yarn`                                                                                                                        |
| Build             | production build, `NODE_ENV=production`                           | detected: `NODE_ENV` and an entry script under `build/`                                                                                                                               |
| PostgreSQL        | `server_version` 14.2                                             | detected: `SHOW server_version`                                                                                                                                                       |
| PostgreSQL limits | two dedicated vCPU, 4 GiB, local SSD                              | operator inputs `WIKILINT_BENCH_POSTGRES_CPUS`, `WIKILINT_BENCH_POSTGRES_MEMORY_BYTES`                                                                                                |
| Identity          | local, unpublished image digest; source commit                    | operator inputs `WIKILINT_BENCH_IMAGE_DIGEST` (`sha256:…`), `WIKILINT_BENCH_SOURCE_COMMIT` (40 hex)                                                                                   |
| Attestations      | same host, local SSD, no artificial latency, no competing traffic | `WIKILINT_BENCH_ATTEST_SAME_HOST`, `WIKILINT_BENCH_ATTEST_LOCAL_SSD`, `WIKILINT_BENCH_ATTEST_NO_ARTIFICIAL_LATENCY`, `WIKILINT_BENCH_ATTEST_NO_COMPETING_TRAFFIC`, each exactly `yes` |

A missing item counts as a deviation, never as a pass. The image digest identifies the benchmarked build only. It is not a Gate 2 publication.

## Provisioning

1. Build the image locally from the commit under test, and do not publish it. Record its digest.
2. Start PostgreSQL 14.2 in its own container on the same host, on local SSD, with `--cpus=2 --cpuset-cpus=<two dedicated cores> --memory=4g`. Migrate a fresh database.
3. Start the app container on two other dedicated cores, with `--cpus=2 --cpuset-cpus=<two other cores> --memory=4g`, `NODE_ENV=production`, the usual Outline environment (`DATABASE_URL`, `REDIS_URL`, `SECRET_KEY`, `UTILS_SECRET`, `URL`), the operator inputs and the attestations. Set `WIKILINT_BENCH_ALLOW_SEED=yes` to confirm that `DATABASE_URL` is the fresh benchmark database: `run.js` seeds fixture teams and users into it. Without the variable, or when the database already holds any team, `run.js` seeds nothing and exits non-zero with a message that names the variable or the existing teams. Leave `SERVICES`, `WEB_CONCURRENCY`, `REQUEST_TIMEOUT` and `DATABASE_CONNECTION_POOL_MAX` at the values under test. The manifest records them.
4. Run nothing else against either container while the benchmark runs.

## Command

From the checkout root inside the app container:

```sh
WIKILINT_BENCH_ALLOW_SEED=yes yarn node build/server/wikiLint/benchmark/run.js --out /evidence/manifest.json
```

Options:

- `--smoke`: reduced samples (one warmup, three samples). It forces `gate1Eligible: false`.
- `--seed SEED`: the fixture seed. The default is `wikilint-ad17-v1`. A seed's IDs are fixed, so each seed can be seeded once per database.
- `--profiles wiki_150,wiki_1000`: the `lint_wiki` profiles to measure. The default is both. A full run that measures anything other than exactly both records a deviation, so it is not Gate 1 evidence, and each unmeasured profile's budgets fail.

The harness runs in one process with no queue worker, so a scheduled import task runs in-process. A full run uses 5 warmups and 40 samples per case. The cold run is each case's first warmup. p95 is the nearest-rank sample at `ceil(0.95 * N)`. The concurrent writer, the HTML imports and the held-pool re-run (DW-6, at the full 60-second deadline) run apart from the timed samples. A budget breach is recorded with its measured value and `fail`, and the run continues. Timing never changes a lint result.

On a host without Redis or a queue worker, such as a developer machine, the retained smoke run uses the test harness instead:

```sh
WIKILINT_BENCH_SMOKE_OUT=docs/wikilint-gate-1/benchmark/smoke-manifest.json \
WIKILINT_BENCH_SEED=wikilint-ad17-smoke-3 \
  vitest run --project server server/wikiLint/benchmark/smokeRun.test.ts
```

## Manifest

The manifest records the label, `smoke`, `gate1Eligible`, the deviations, the command, the source commit, the image digest and the fixture (generator, commit, seed, dataset hash, per-document link maximum). It also records the policy set fingerprint, the environment (Node, Yarn, PostgreSQL version and settings, CPU, kernel, cgroup limits, process topology, pool size), the sampling and the constants in force. Every case keeps its raw samples: duration, RSS, peak RSS, every statement duration, the longest statement under `SET LOCAL`, event-loop maximum, unit and result-assembly times, batch serialize-and-parse maximum, and the lint or write outcome. The manifest also records each AD-17 budget's verdict, the growth ratios, the concurrent writer, the held-pool re-run, the DW-4/5/6 records and the constant derivation.

Statement durations and counts come from Sequelize per-query benchmark logging. A statement counts as under `SET LOCAL` when its transaction issued one before it. The AD-15 audit transaction is excluded. Unit, result-assembly and per-batch serialize-and-parse times come from the no-op-by-default timing probe (`application/timingProbe.ts`).
