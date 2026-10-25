---
title: 'DW-61: Close the verified Epic 3 retrospective gaps (A-2, A-3, A-4, A-7, A-10)'
type: 'chore'
created: '2026-10-25'
status: 'ready-for-dev'
baseline_revision: '8972e230c85b0098a5e1e9ec718950c230e22351'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-retro-2026-10-25.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-3-produce-reproducible-performance-growth-and-constant-derivat.md'
warnings: []
deferred: []
---

<frozen-after-approval reason="human-owned intent">

## Intent

**Problem:** The Epic 3 retrospective (`epic-3-retro-2026-10-25.md`) found five verified gaps, none in the runtime lint path:
- **A-2:** the four D-9 constants' doc comments cite the run at source commit `7631d00b0`. The retained Gate 1 manifest is the run at `e5e16ec2588982ca674540100ae24186d1fc1081` (`docs/wikilint-gate-1/benchmark/reference-manifest.json`).
- **A-3:** `gate1EvidenceIndex.test.ts` never compares the manifest's `constantsInForce` with the constants in code. It also has no case for SM-I2 turning `contradictory`, or for an AD-17-dependent row staying `gap` when a manifest budget is not `pass` or is missing (CL-5, DW-60).
- **A-4:** a full (non-smoke) run that measures fewer than every profile in `PROFILES`, or overrides the held-pool profile or deadline, is still `gate1Eligible: true`, and a required profile's budget is then simply absent (CL-4).
- **A-7:** `run.ts`, which the production image contains, seeds fixture teams and users into whatever `DATABASE_URL` it has. The only guard is a seed that is already present (CL-3).
- **A-10:** no test exercises the `/_health` route that `server/main.ts` registers with the worker's policy readiness (CL-7).

**Approach:** Close each gap with the smallest change and a collocated test.

## Boundaries & Constraints

**Always:**
- **A-2:** each of the four doc comments (`writeDecision.ts` two, `deadline.ts`, `lintWiki.ts`) says the value was fixed by the Story 3.3 criterion 7 rule and is confirmed by the retained Gate 1 reference run (source commit `e5e16ec25`, `docs/wikilint-gate-1/benchmark/reference-manifest.json`).
- **A-3:** the index test asserts that the reference manifest's `constantsInForce` equals the imported `WRITE_ELIGIBLE_MARKDOWN_BYTES`, `WRITE_ELIGIBLE_LINK_REFERENCES`, `LINT_WIKI_STOP_MARGIN_MS`, `SET_LOCAL_FLOOR_MS`, `LINT_WIKI_DEADLINE_MS` and `VALIDATION_DEADLINE_MS`. It also covers, with constructed inputs to the test's own recomputation, an SM-I2 row whose sources disagree (`contradictory`) and an AD-17-dependent row whose manifest budget fails or is missing (`gap`).
- **A-4:** a non-smoke run whose measured profiles are not exactly every profile in `PROFILES`, or that overrides the held-pool profile or deadline, records a deviation, so it is not `gate1Eligible`. A required profile that was not measured yields a failing budget, not an absent one. Collocated tests cover both. The smoke behaviour and every existing budget, sample count and tolerance are unchanged.
- **A-7:** `run.ts` refuses to seed unless `WIKILINT_BENCH_ALLOW_SEED=yes`, and refuses when the database already holds any team. It exits non-zero with a message that names the variable or the existing teams. The guard lives in the CLI entry, not in `runBenchmark`, so the DB-backed harness tests keep running on the shared test database. `server/wikiLint/benchmark/README.md` documents the variable in Provisioning and in the command.
- **A-10:** a test proves that the route registered at `/_health` answers 503 with the fingerprint header when readiness is false, and 200 `OK` when it is true, with the database and Redis checks injected. If that needs it, the registration moves into one exported function in `server/wikiLint/adapters/healthCheck.ts` that `server/main.ts` calls, with no change in behaviour.

**Never:**
- Change any lint, enforcement, deadline or readiness behaviour, any constant value, budget, sample count or tolerance, or the policy-readiness semantics.
- Change the retained evidence under `docs/wikilint-gate-1/` (including `benchmark/reference-stack.sh`), the deferred-work ledger, the sprint board, the epics file, the Architecture Spine or this spec.
- Add a new test file or directory unless it is collocated with new code.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Partial full run | `--profiles wiki_150`, not smoke | a deviation, `gate1Eligible: false`, failing `lint_wiki.wiki_1000.max` budget | none |
| Constants drift | a constant differs from the manifest's `constantsInForce` | the index test fails | none |
| Seeding without opt-in | `run.ts` without `WIKILINT_BENCH_ALLOW_SEED=yes`, or with teams present | non-zero exit, nothing seeded | message names the cause |
| Health route | readiness false / true | 503 with the fingerprint header / 200 `OK` | none |

</frozen-after-approval>

## Code Map

- `server/wikiLint/application/writeDecision.ts`, `deadline.ts`, `lintWiki.ts` -- the constants' doc comments.
- `server/wikiLint/benchmark/gate1EvidenceIndex.test.ts` -- the index recomputation.
- `server/wikiLint/benchmark/harness.ts` (`runBenchmark`, `evaluateBudgets`, held pool), `referenceProfile.ts` (deviations, `isGate1Eligible`), `run.ts`, `README.md`, and their tests.
- `server/main.ts:87-94`, `server/wikiLint/adapters/healthCheck.ts` and its test -- the `/_health` route.

## Tasks & Acceptance

**Execution:**
- The five items above, each with its tests.

**Acceptance Criteria:**
- Given each matrix row, when its test runs, then the stated behaviour holds.
- Given the verify suites, when they run against a fresh test database, then every test passes.

## Spec Change Log

## Review Triage Log
