---
title: 'DW-4: Yield to the event loop between lint_wiki units'
type: 'bugfix'
created: '2026-10-12'
baseline_revision: 'f60c3e6284853cda47a140d2d30e4c2778b9da00'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** `lintWiki` (`server/wikiLint/application/lintWiki.ts`, the loop over `units` after `wikiUnits(...)`) evaluates every unit synchronously: `evaluateDocumentRules` and `evaluateGraphCheck` run back to back with no `await` between units, so the process serves no other request until the evaluation phase ends and cannot observe a client disconnect meanwhile (DW-4, raised in the 2026-10-02 review pass of Story 1.7).

**Approach:** Yield to the event loop before every unit: `await new Promise<void>((resolve) => setImmediate(resolve))` as the first statement of the loop body, ahead of the stop-margin check, so the check reads the clock after the yield. Nothing else about the loop changes: the AD-11 order, the per-unit buffer, the stop margin, the finished-units rule and the one run-wide `VALIDATION_TIMEOUT`. No fan-out and no measurement (Story 3.3 measures). Two tests in `lintWiki.test.ts` show the interleaving and the post-yield margin check.

## Boundaries & Constraints

**Always:**
- One production change: the yield in the unit loop of `lintWiki`, plus one sentence in the JSDoc of `lintWiki` saying that the loop yields to the event loop before each unit.
- Yield with `setImmediate` (a macrotask, the idiom of the collocated tests), not `process.nextTick`, a resolved promise or a timer.
- Keep the stop-margin check as the first statement after the yield, so a remainder below `LINT_WIKI_STOP_MARGIN_MS` observed after the yield stops the run before the unit starts.
- Add the tests to `server/wikiLint/application/lintWiki.test.ts` inside `describe("collection scope")`, with the file's helpers (`fakeReader`, `run`, `resultOf`, `now`, `PAST_MARGIN`, `vi.mocked(evaluateDocumentRules)`) and its JSDoc and naming style.
- Every existing test of the file passes unchanged.

**Never:**
- Do not change `wikiUnits`, `LINT_WIKI_STOP_MARGIN_MS`, `LINT_WIKI_DEADLINE_MS`, `Deadline`, the reader adapters, the rule evaluators or the result builder.
- Do not evaluate units concurrently or reorder them.
- Do not yield inside `readWikiSnapshot` or the keyset loop (DW-5 is a separate item).
- Do not add a dependency, a new file or a new test directory.
- Do not edit the deferred-work ledger, the sprint board or this spec.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| interleaving | collection scope with three readable documents under structure rules only; the spied `evaluateDocumentRules` records one mark per unit and, during unit 1, schedules a `setImmediate` callback that records its own mark | the marks read unit 1, callback, unit 2, unit 3: the callback ran between the first and the second unit (on the baseline it runs after unit 3) | none |
| margin crossed while yielded | the same scope; the callback scheduled during unit 1 sets `now` to `PAST_MARGIN` | unit 1 is completed and kept; units 2 and 3 are never evaluated (`evaluateDocumentRules` called once); `completedUnits` 1 of `requiredUnits` 3; exactly one `VALIDATION_TIMEOUT` System Failure at the run location | the timeout is the only added issue |
| single unit | collection scope with one document | the result equals the baseline's; nothing observable changes | none |
| no units | an authorized collection whose policy requires no check | unchanged; the existing tests of that case pass | none |

</intent-contract>

## Code Map

- `server/wikiLint/application/lintWiki.ts` -- `lintWiki` (exported async function); after `const units = wikiUnits(...)` and the pending-count loop comes `for (const { collection, check, document } of units)`, whose body starts with `if (deadline.remainingMs() < LINT_WIKI_STOP_MARGIN_MS)`: the yield goes above that check. The JSDoc above `lintWiki` says "Units run in the AD-11 order, and none starts once less than `LINT_WIKI_STOP_MARGIN_MS` remains": add the yield sentence there.
- `server/wikiLint/application/lintWiki.test.ts` -- `vi.mock("../core/documentRules")` makes `evaluateDocumentRules` a spy whose implementation a test may replace with one that records a mark and then calls the actual implementation (see `crossMarginDuring`); `fakeReader`, `run`, `resultOf`, the fake clock `now` and `PAST_MARGIN` sit above `describe("collection scope")`, which holds the unit-loop tests, for example "completes when every unit completes" (a three-document shape) and "isolates an unavailable document". `resetRun` in `beforeEach` resets the spies and the clock.
- `server/wikiLint/application/readAudit.test.ts:699` and `server/wikiLint/adapters/documentReader.test.ts:1036` -- the collocated idiom `await new Promise((resolve) => setImmediate(resolve))`.

## Tasks & Acceptance

**Execution:**
- `server/wikiLint/application/lintWiki.ts` -- add the yield as the first statement of the unit loop body, keep the stop-margin check right after it, extend the JSDoc.
- `server/wikiLint/application/lintWiki.test.ts` -- add the `interleaving` and `margin crossed while yielded` tests to `describe("collection scope")`.

**Acceptance Criteria:**
- Given the interleaving row, when `lintWiki` runs, then the recorded marks are unit 1, callback, unit 2, unit 3.
- Given the margin row, when `lintWiki` runs, then the result has `completedUnits` 1 and `requiredUnits` 3, the issues of unit 1 (if any) and exactly one `VALIDATION_TIMEOUT` System Failure, and `evaluateDocumentRules` was called once.
- Given the baseline loop (no yield), when the two new tests run, then both fail (the callback's mark comes last; all three units are evaluated), so the tests detect DW-4.
- Given `corepack yarn tsc`, `node_modules/.bin/oxlint --type-aware server shared`, `node_modules/.bin/oxfmt --check` on the two changed files and `node_modules/.bin/vitest run --project server server/wikiLint/application/lintWiki.test.ts`, when they run, then every one passes.

## Coordinator Result

- acceptance: `3d92a040-d953-48f5-98a9-f1a49abe9d2a`
- accepted commit: `17b840d5f5b50a16fa5a735926fd064bb687c8e1`
- review: `09d4c0d0-4918-48c8-a5ea-77b4d91f8a89`
- verification: tsc: pass, oxlint: pass, oxfmt: pass, vitest: pass
- decisions: none
