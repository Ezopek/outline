---
title: 'Story 3.3: Produce Reproducible Performance, Growth, and Constant-Derivation Evidence'
type: 'feature'
status: 'ready-for-dev'
context: []
---

<frozen-after-approval reason="human-owned intent">

## Intent

**Problem:** Four values are still provisional: the AD-13 write-eligibility constants, the AD-11 stop margin and the `SET LOCAL` floor. No reproducible fixture, harness or manifest exists to fix them, to measure the Gate 1 budgets, or to supply the DW-4/5/6 evidence that Story 3.4 criterion 8 needs.

**Approach:** Ship four pieces: a deterministic seeded fixture generator, a benchmark harness that checks its environment against the reference profile, a manifest, and a rule checker that derives the constants. Run them once on this host as a smoke run labelled not Gate 1 evidence. The constants stay provisional and are recorded as open (P7).

## Boundaries & Constraints

**Always:**
- The generator uses a seeded PRNG only. The same seed gives the same bytes and dataset hash. Profiles follow AC 1 exactly. Each profile gets its own team, benchmark actor and policy. Write pairs use one dedicated unconfigured (baseline) collection and one dedicated enforced collection outside the profile scopes.
- Sampling follows AC 3: 5 warmups, 40 samples, p95 = sample at rank `ceil(0.95*N)` in ascending order, one cold run. Every raw timing, RSS and query sample is retained.
- The harness runs in-process on the built modules. Writes go through the registered MCP tools over an in-memory transport. The harness detects each AC 2 profile item: cgroup CPU/memory, `node --version` against the Dockerfile `runner` tag, `NODE_ENV=production` from `build/`, PostgreSQL `server_version`. PostgreSQL limits, image digest and source commit come from the operator. Any item missing or deviating sets `gate1Eligible: false` and lists the reason.
- Per-statement durations and query counts come from Sequelize per-query benchmark logging in the harness. Statements are attributed to `SET LOCAL` by their transaction. Unit, result-assembly and per-batch serialize/parse timings come from a no-op-by-default timing probe. The probe never reads or changes a result.
- Concurrent-writer latency, the held-pool re-run and HTML/import timings run apart from the timed samples.

**Never:**
- Change a constant's value in this story, or label a smoke or non-reference run Gate 1 evidence.
- Let timing become a Finding, change severity, skip checks or narrow scope. A true timeout stays a System Failure.
- Put System-Failure classes in timed datasets (Story 3.2 covers them).
- Select OD-2/OD-7, publish an image, or deploy.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Same seed twice | default seed | identical dataset hash | — |
| Non-reference host | this WSL host | manifest complete, `gate1Eligible: false`, reasons listed | never silently qualified |
| Derivation | manifest samples | candidate value, rule, source sample ids, `pass`/`fail` per constant; status `provisional` | a failing rule is recorded, not adjusted |
| Floor check | candidate floor ≥ 9000 or ≥ 9000 − 2000 | `fail` | — |
| Held pool | every pool connection held | `VALIDATION_TIMEOUT` within 60 s, recorded for DW-6 | — |
| Probe set vs unset | same fixture | byte-identical lint result | — |

</frozen-after-approval>

## Code Map

- `server/wikiLint/application/writeDecision.ts:17,25` -- `WRITE_ELIGIBLE_MARKDOWN_BYTES` 262144 and `WRITE_ELIGIBLE_LINK_REFERENCES` 1000, both provisional.
- `server/wikiLint/application/lintWiki.ts:47` -- `LINT_WIKI_STOP_MARGIN_MS` 2000 and the unit loop (DW-4).
- `server/wikiLint/application/deadline.ts:11` -- `SET_LOCAL_FLOOR_MS` 100, plus the validation deadline and the persistence budget and probe reserve it guards.
- `server/wikiLint/adapters/wikiReader.ts` -- the keyset batch loop (DW-5). `documentReader.ts:126` `boundBatch`, `writeTransaction.ts:278,448` -- the `SET LOCAL` sites.
- The dependent fixtures already use the named constants (`writeDecision`, `enforcedWrite*`, `lintWiki`, `deadline`, `writeTransaction`, `enforcedImport`, `server/tools/wikiLint` tests), so a later fix re-runs them unchanged.
- `build.js` -- swc compiles every non-test `server/**/*.ts`, so `server/wikiLint/benchmark/run.ts` builds to `build/server/wikiLint/benchmark/run.js`.
- `Dockerfile:9` -- `node:26.3.0-slim` runner. `package.json` -- `yarn@4.11.0`. `server/storage/database.ts:57` -- pool size.

## Tasks & Acceptance

- [ ] `server/wikiLint/application/timingProbe.ts` (+ test) -- a module-level probe with no-op default (`setTimingProbe`, `span(kind, ms)`). `lintWiki.ts` and `wikiReader.ts` call it per unit, for result assembly, and per batch serialize/parse. Test that the result is identical with and without the probe -- AC 7, 9, 10.
- [ ] `server/wikiLint/benchmark/fixtureGenerator.ts` (+ test) -- seeded datasets per AC 1. Export `MAX_LINK_REFERENCES_PER_DOCUMENT` and `datasetHash`. In memory, test both profiles' counts, size quantiles, depth, average links, class coverage and hash stability. Test that the benchmark policy has no invalid entry -- AC 1.
- [ ] `server/wikiLint/benchmark/stats.ts` (+ test) -- nearest-rank p95 and normalized costs -- AC 3, 5.
- [ ] `server/wikiLint/benchmark/referenceProfile.ts` (+ test) -- environment capture and the deviation list -- AC 2, 8.
- [ ] `server/wikiLint/benchmark/constantDerivation.ts` (+ test) -- candidate values and rule checks per AC 7. The record says `provisional` unless reference-eligible. Gate 1 is `ready` only when all four values pass and are not provisional. Test each rule boundary -- AC 7.
- [ ] `server/wikiLint/benchmark/harness.ts`, `run.ts` -- seed the DB. Run AC 3–6 cases, the concurrent writer, HTML import, the event-loop maximum (`monitorEventLoopDelay`) and the batch CPU maximum, each compared with the stop margin and tagged DW-4/DW-5. Run the held-pool case tagged DW-6. Write the AC 8 manifest. `--smoke` runs reduced samples and forces `gate1Eligible: false` -- AC 2–9.
- [ ] `server/wikiLint/benchmark/harness.test.ts` -- a DB-backed smoke on the 150 profile at reduced samples: manifest shape, every AC 8 field, `gate1Eligible: false`, all `lint_wiki` runs `complete`.
- [ ] `server/wikiLint/benchmark/README.md` -- the reference-profile provisioning (container limits, env inputs) and the command.
- [ ] `docs/wikilint-gate-1/benchmark/` -- the retained smoke manifest. Add `constants.md` stating each constant, its rule, its smoke candidate, and `provisional — open, not Gate 1 evidence`. Add a DW-4/5/6 record marked open for Story 3.4.

**Acceptance:** AC 1–10 hold as delivered capability. The reference-profile measurements and constant fixing are recorded as open (P7).

## Verification

**Commands:**
- `tsc`: `corepack yarn tsc`
- `oxlint`: `node_modules/.bin/oxlint --type-aware server shared`
- `oxfmt`: `node_modules/.bin/oxfmt --check {changed_files}`
- `vitest`: `node_modules/.bin/vitest run --project server --maxWorkers=2 server/wikiLint server/index.test.ts server/routes/mcp server/tools`
