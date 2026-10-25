---
title: 'DW-56: Fix the AD-17 constants and the held-pool verdict from the 2026-10-25 reference run'
type: 'chore'
created: '2026-10-25'
status: 'in-progress'
baseline_revision: '7631d00b04530ac3fe2f7ad68d0b9597f9d24a9e'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-3-produce-reproducible-performance-growth-and-constant-derivat.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-dw-6-lint-snapshot-pool-acquire-deadline.md'
warnings: []
deferred: []
---

<frozen-after-approval reason="human-owned intent">

## Intent

**Problem:** The AD-17 reference run of 2026-10-25 (`gate1Eligible: true`, 0 deviations; source commit `7631d00b04530ac3fe2f7ad68d0b9597f9d24a9e`, local image `sha256:483c60d2f8267afa55c0a74d1d48b543e034c0185db0f7171744f2aca8e49820`, manifest sha256 `58b625942f72bfc333e82671bd388b5776a0f3056ef6da45f3f174aa4b1e0b64`) leaves two items that keep Gate 1 `not ready`:

- The four D-9 constants are still marked provisional. Its derivation (Story 3.3 criterion 7) gives `WRITE_ELIGIBLE_MARKDOWN_BYTES` candidate 131072 (samples `create-06:enforced`, `replace-06:enforced`) against the committed 262144, so that constant fails its rule; `WRITE_ELIGIBLE_LINK_REFERENCES` 1000 (candidate 1000), `LINT_WIKI_STOP_MARGIN_MS` 2000 (candidate 4) and `SET_LOCAL_FLOOR_MS` 100 (candidate 23, guard 7000) satisfy theirs.
- The DW-6 held-pool record is `fail`: with every pool connection held, the 1,000-document `lint_wiki` ended after 30,004 ms as the run-wide `VALIDATION_RUNTIME_FAILED` of the pool's own 30-second acquisition timeout, inside the 60-second deadline, while the harness verdict accepts only `VALIDATION_TIMEOUT`. DW-6's spec forbids reclassifying that error or changing the pool configuration, so the operator amended Story 3.3 criterion 9 on 2026-10-25 (epics, "Amendment (2026-10-25)").

**Approach:** Commit the constants at the values the rule gives and mark them fixed; change the DW-6 verdict to the amended criterion.

## Boundaries & Constraints

**Always:**
- `WRITE_ELIGIBLE_MARKDOWN_BYTES` becomes 131072. `WRITE_ELIGIBLE_LINK_REFERENCES`, `LINT_WIKI_STOP_MARGIN_MS` and `SET_LOCAL_FLOOR_MS` keep their values. The doc comment of each of the four replaces "Provisional: Story 3.3 fixes it …" with one sentence saying it is fixed by the Story 3.3 criterion 7 rule from the AD-17 reference run of 2026-10-25 (source commit `7631d00b0`).
- Every test that pins one of these values or builds a document at or just above an eligibility limit keeps doing so for the new value, so the limit and the value just above it are still both exercised (criterion 7's dependent fixtures). Test names that call these constants provisional say fixed instead; no assertion is weakened.
- The DW-6 record's verdict is `pass` exactly when the elapsed time is at most the deadline plus `HELD_POOL_TOLERANCE_MS`, the result is `state: failed` with exactly one System Failure, whose code is `VALIDATION_TIMEOUT` or `VALIDATION_RUNTIME_FAILED`, and, after the holders release their connections, the pool reports 0 in use and 0 waiting; the record keeps the pool usage it observed after release. Its `measure` text states the amended criterion.
- Collocated unit tests cover the DW-6 verdict: pass for each of the two codes within the bound, and fail for an overrun, another code, more than one System Failure, and a connection left in use or waiting. The existing DB-backed held-pool harness test keeps passing.
- `constantDerivation.ts` is unchanged in behaviour: it already reports each constant as `reference` from an eligible run and checks the committed value against its rule.

**Never:**
- Do not change the pool configuration, `readOnlyTransaction`, `Deadline`, the error mapping of `lintWiki.ts` or `lintDocument.ts`, or the AD-16 snapshot caps (including `snapshotLimits.test.ts`).
- Do not change any constant value other than `WRITE_ELIGIBLE_MARKDOWN_BYTES`, or any budget, sample count or tolerance of the harness.
- Do not edit `docs/wikilint-gate-1/`, the epics file, the Architecture Spine, the deferred-work ledger, the sprint board or this spec.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Enforced write at the limit | projected Markdown of exactly 131072 bytes in an `open` collection, runtime failure | fail-open eligible | none |
| Just above | 131073 bytes | treated as beyond the limits; the System Failure rejects the write | none |
| Held pool, pool timeout first | 30,004 ms, one `VALIDATION_RUNTIME_FAILED`, pool 0/0 after release | DW-6 `pass` | none |
| Held pool, overrun or leak | elapsed above deadline + tolerance, or a connection in use or waiting after release | DW-6 `fail` | none |

</frozen-after-approval>

## Code Map

- `server/wikiLint/application/writeDecision.ts:11-25` -- the two write-eligibility constants.
- `server/wikiLint/application/deadline.ts:9` -- `SET_LOCAL_FLOOR_MS`; `server/wikiLint/application/lintWiki.ts:46` -- `LINT_WIKI_STOP_MARGIN_MS`.
- `server/wikiLint/application/writeDecision.test.ts:294`, `deadline.test.ts:105`, `enforcedWrite.test.ts` -- tests that pin the constants or build documents at the limits.
- `server/wikiLint/benchmark/harness.ts:1587-1666` (`dwRecords`) and the held-pool runner; `harness.test.ts` -- the DW-6 verdict and its test.
- `server/wikiLint/benchmark/constantDerivation.ts` -- read-only.

## Tasks & Acceptance

**Execution:**
- `server/wikiLint/application/` -- the constant value and the four doc comments; the dependent tests.
- `server/wikiLint/benchmark/harness.ts`, `harness.test.ts` -- the DW-6 verdict, the pool usage after release, and its unit tests.

**Acceptance Criteria:**
- Given the committed constants, when `deriveConstants` runs over the 2026-10-25 manifest's samples, then every constant satisfies its rule.
- Given a held-pool record that ended inside the bound as either accepted code with the pool idle after release, when the DW-6 record is built, then its verdict is `pass`; given an overrun, another code or a leaked connection, then `fail`.
- Given the verify suites, when they run against a fresh test database, then every test passes.

## Spec Change Log

## Review Triage Log
