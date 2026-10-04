---
title: 'DW-6: Charge lint read-transaction connection acquisition to the request deadline'
type: 'bugfix'
created: '2026-10-04'
baseline_revision: 5b1e77b0680a835986178358988c72800ce83956
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** `readOnlyTransaction` (`server/wikiLint/adapters/documentReader.ts:78`) opens a managed `sequelize.transaction`, which waits for a pool connection for up to `pool.acquire = 30000` ms (`server/storage/database.ts:169`). Only then does the first `boundBatch` check the remainder. So the `lint_wiki` snapshot and collection lookup, and the `lint_document` lookup and snapshot, can all overrun their deadline and the 63 s bound. AD-11 requires connection acquisition to be charged to the phase it serves.

**Approach:** `readOnlyTransaction` receives the request deadline. Before it opens anything, it refuses a remainder below the floor (`DeadlineFloorError`, no connection requested). Otherwise it opens the transaction, connection acquisition and `BEGIN` included, under a timer equal to the floored remainder. When the timer expires it throws `DeadlineFloorError`, and it rolls back any transaction that opens late, which releases that connection. The existing mapping then gives `VALIDATION_TIMEOUT` for snapshots and the fixed tool-execution error for lookups, with no application-layer change.

## Boundaries & Constraints

**Always:** The bound is `deadline.batchTimeoutMs()`, read immediately before opening. A refusal below `SET_LOCAL_FLOOR_MS` sends no statement and requests no connection. A transaction that opens after the timer is rolled back as soon as it resolves, and any rollback error is swallowed. An opening that rejects after the timer is also swallowed, so no connection stays held and no rejection goes unhandled. The managed-transaction semantics stay the same:
- `SET TRANSACTION READ ONLY` is the first statement.
- If the work fails, the transaction rolls back, any rollback error is swallowed, and the original error is rethrown.
- On success, the transaction commits before it returns. A commit failure propagates.

Every existing `boundBatch` stays, so the time spent acquiring is also charged to the remainder of the next batch. All four callers pass their request deadline. In existing tests whose clocks count readings, shift the indices by the one new reading per transaction, so each test still refuses the batch it targeted.

**Never:** Do not change the error mapping in `lintWiki.ts` or `lintDocument.ts`. Do not change `Deadline`, `SET_LOCAL_FLOOR_MS`, the pool configuration, `EnforcementTransaction`, or the enforced-write paths. Do not use Sequelize's `readOnly` option. Do not reclassify the pool's own `ConnectionAcquireTimeoutError` when it arrives before the deadline. Do not weaken any existing assertion. Do not create new test files or directories. Do not edit the deferred-work ledger.

## I/O & Edge-Case Matrix

Rows 1–4 hold every pool connection, with a remainder above the floor (about 1000 ms) when the lint transaction opens.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| `lint_wiki` default-scope snapshot | pool held | `state: failed`, one `VALIDATION_TIMEOUT` located `scope { scopeKind: "configured_collections" }`, returned within the remainder + 2000 ms | When the holders are released, the late transaction is rolled back and the pool returns to 0 in use and 0 waiting |
| `lint_wiki` collection lookup | pool held | `isError` with the fixed `OPERATION_FAILED` text, within the same bound | as above |
| `lint_document` lookup | pool held | `isError` `OPERATION_FAILED`, within the same bound | as above |
| `lint_document` snapshot | lookup succeeds, then the pool is held | `state: failed`, `VALIDATION_TIMEOUT` located `scope { scopeKind: "document", documentId }`, within the same bound | as above |
| Below the floor at the lookup | remainder < 100 ms when the lookup opens | `isError` `OPERATION_FAILED`; no `START TRANSACTION` is sent | none |
| Free pool | ordinary remainder | Results unchanged | none |

</intent-contract>

## Code Map

- `server/wikiLint/adapters/documentReader.ts:69-86` -- `readOnlyTransaction`, the only production change. Its callers are `authorizeLintTarget` (`:168-201`) and `readDocumentSnapshot` (`:309-351`). `boundBatch` (`:96-107`) is unchanged.
- `server/wikiLint/adapters/wikiReader.ts:80-94` (`authorizeLintCollection`) and `:257-270` (`readWikiSnapshot`) -- the other two callers.
- `server/wikiLint/application/deadline.ts:76-92` -- `within`, which this change reuses. `:98-104` defines `DeadlineFloorError`, and `:155-161` defines `batchTimeoutMs`, which reads the clock once. Read-only.
- `server/wikiLint/adapters/writeTransaction.ts:170-202` -- `EnforcementTransaction.open`, the pattern to mirror: `within` plus a late rollback. Read-only.
- `server/wikiLint/application/lintWiki.ts:243-253` and `lintDocument.ts:184-188` -- a lookup throw becomes `{ kind: "failed" }`. `lintWiki.ts:384-398` and `lintDocument.ts:278-296` map `DeadlineFloorError` to `VALIDATION_TIMEOUT`. `server/tools/wikiLint.ts:63-72` maps `failed` to `OPERATION_FAILED`. All read-only.
- `server/storage/database.ts:165-170` -- the pool (`acquire: 30000`, `max` default 5). `:333-380` -- `applyStatementTimeoutToTransactions` supports the unmanaged form. Read-only.
- `node_modules/sequelize/lib/transaction.js` -- a failed commit or rollback destroys its connection, and a rollback after `finished` throws, which this change swallows.
- `server/wikiLint/adapters/writeTransaction.test.ts:127-148` -- `holdPool` and `releasePool`, the fixture pattern to copy. The pool counters are `sequelize.connectionManager.pool.using` and `.waiting` (sequelize-pool).
- `server/tools/wikiLint.test.ts:128-180` -- `connect` takes `clock`, `reader`, `wikiReader` and `writeAudit`. `:1479` -- `recordSql`, scoped to `describe("lint_wiki")`. `:1640-1662` -- the lookup-refused test. Clocks that count readings are at `:1647`, `:1709`, `:3990` and `documentReader.test.ts:828`; run the suites to find any others.

## Tasks & Acceptance

**Execution:**
- `server/wikiLint/adapters/documentReader.ts` -- make `readOnlyTransaction` async and add `deadline: Deadline` to its options. It refuses a remainder below the floor, opens without a callback under `within`, rolls back a late transaction, runs with the managed semantics, and has updated JSDoc. Pass `deadline` from `authorizeLintTarget` and `readDocumentSnapshot`. -- This is the DW-6 fix.
- `server/wikiLint/adapters/wikiReader.ts` -- pass `deadline` in `authorizeLintCollection` and `readWikiSnapshot`. -- The remaining call sites.
- `server/tools/wikiLint.test.ts` -- add four helpers: a `holdPool`/`releasePool` fixture, a pool-usage accessor, and a clock whose readings after the first sit a chosen remainder before the deadline and advance in real time. Use them for I/O rows 1–4 under the existing `lint_document` and `lint_wiki` describes. Pass a no-op `writeAudit` and release the holders in `finally`. For rows 2–4, wrap the default reader so that it holds the pool after the lookup. Extend the lookup-refused test to assert that no `START TRANSACTION` is sent. -- These are the surface-anchored proofs.
- `server/wikiLint/**/*.test.ts`, `server/tools/wikiLint.test.ts` -- in reading-count clocks that now fail, shift the indices only. -- One extra reading per transaction is expected.

**Acceptance Criteria:**
- Given any I/O row 1–4, when the tool is called through the MCP client, then it returns the listed outcome within the remainder + 2000 ms, which is far below the 30000 ms pool acquire timeout.
- Given rows 1–4, when the holders are released afterwards, then the pool reaches 0 connections in use and 0 waiting.
- Given the targeted suites, when they run against the test database, then every test passes, and the only edits to existing tests are the reading-index shifts and the added `START TRANSACTION` assertion.

## Spec Change Log

## Review Triage Log

### 2026-10-04 — Review pass
- verdicts: 27 findings — high 0, medium 6, low 14, false 7, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind Hunter: the Design Notes snippet calls `sequelize.transaction` before `deadline.batchTimeoutMs()`. — Only the spec text is affected: `readOnlyTransaction` reads the bound first (`documentReader.ts`), so no connection is requested on a refusal. The fix is a spec edit, which this review must reject.
  - `[low]` `[reject]` Blind Hunter: Tasks say "for rows 2–4, wrap the default reader", but rows 2–3 are the lookups. — The code is correct: rows 1–3 hold the pool before the call, and only row 4 wraps `authorizeLintTarget`. The fix is a spec edit.
  - `[low]` `[patch]` Blind Hunter: the AC "only index shifts" is untrue for `wikiReader.test.ts` "carries no sentinel…", the `lateClock` JSDoc is stale, and the Code Map lists `:3990`. — Patched the stale `lateClock` JSDoc: it now says the lookup is refused before its transaction opens. The AC and Code Map parts are rejected because their fix is a spec edit. The test change itself is needed: a fixed 99 ms deadline now stops at the opening, so the test was moved to a counting clock to keep refusing the enumeration batch it is named for.
  - `[false]` `[reject]` Blind Hunter: the "requests no connection" guarantee is pinned only by the `lint_wiki` lookup test. — All four callers share `readOnlyTransaction`. The Verification Gap layer confirmed that moving `batchTimeoutMs()` after `sequelize.transaction` fails that test's new `START TRANSACTION` assertion, so the shared ordering is pinned.
  - `[low]` `[reject]` Blind Hunter: no test still covers a first-batch refusal after a successful opening for the two lookups and `readDocumentSnapshot`. — `boundBatch` is shared, and the lock-timeout test catches a missing first bound. A first-batch refusal after opening stays covered by `wikiReader.test.ts` "carries no sentinel…" and the tool test "times out when the first snapshot batch is refused". Regressing it is unlikely, and the fix would only add tests.
  - `[medium]` `[patch]` Blind Hunter: the held-pool tests never observe an abandoned acquisition, and rows 2–3 cannot tell the deadline path from other failures. — The claim that the late rollback is never proven is false: removing the rollback leaves `using: 1`. The observation gap is real. Each held-pool test now asserts `poolUsage()` is `{ using: holders.length, waiting: 1 }` before release (grouped with the Edge Case Hunter's row-4 finding).
  - `[medium]` `[patch]` Blind Hunter: the branches of the hand-written transaction lifecycle are untested. — Added adapter tests to `documentReader.test.ts`: an opening that fails before its bound keeps its error, and a late opening's rejection and a failed late rollback are both absorbed (grouped with Verification Gap findings 2–3). The commit-failure and rollback-error-swallow parts get no separate test because their regression risk is negligible on a read-only transaction.
  - `[low]` `[reject]` Blind Hunter: `holdPool` leaks holders on a partial failure, and the helpers duplicate `writeTransaction.test.ts`. — This happens only when a test is already failing on an occupied pool. The fix needs cleanup branches or a move to a shared module, and is unlikely to matter in everyday use.
  - `[false]` `[reject]` Blind Hunter: the asserted bound leaves out the audit write (remainder + 3 s with the real writer). — The audit is a separately bounded AD-15 phase (3 s, `within`) that sits outside the lint deadline. AD-11's 63 s sum already includes it. The AC measures the lint deadline only, with a stubbed writer.
  - `[low]` `[reject]` Blind Hunter: an abandoned acquisition stays queued for up to 30 s, so the pool load is not bounded. — The waiter costs one `BEGIN`/`ROLLBACK` round trip. That is less than the baseline, where the same waiter ran the full transaction, and it matches `EnforcementTransaction.open`. sequelize-pool cannot cancel an acquire, so a fix would need new admission state. Recorded under residual risks.
  - `[low]` `[reject]` Edge Case Hunter: abandoned openings pile up as waiters that take freed connections first. — Same root cause and reasoning as the previous row. The proposed `abandonedOpenings` guard would add state and change admission behavior, which the intent does not ask for.
  - `[low]` `[reject]` Edge Case Hunter: `holdPool` partial failure, and rows 1–3 call it outside `try`. — Same as the Blind Hunter `holdPool` row: it only occurs in an already-failing test.
  - `[low]` `[patch]` Edge Case Hunter: in row 4, a slow lookup plus `holdPool` could exhaust the remainder, so the test passes through a floor refusal before opening instead of the timed acquisition. — Patched through the `poolUsage()` `{ using, waiting: 1 }` assertion, which fails unless an acquisition was queued and abandoned.
  - `[low]` `[reject]` Edge Case Hunter (claim): the `wikiReader.test.ts:1397` rewrite contradicts the AC's "only index shifts". — The test change is correct (see the Blind Hunter AC row). Only the spec text differs, and the fix is a spec edit.
  - `[low]` `[reject]` Edge Case Hunter (claim): the Tasks "rows 2–4" wording misdescribes the tests. — Same as the Blind Hunter Tasks row: the fix is a spec edit.
  - `[false]` `[reject]` Edge Case Hunter (claim): production responses on an exhausted pool exceed the remainder + 2000 ms bound. — Same refutation as the Blind Hunter audit row: the extra time is the separately bounded audit phase, inside the 63 s sum.
  - `[medium]` `[patch]` Verification Gap: an opening timer shorter than the remainder (`Math.min(boundMs, 100)`) passes every suite. — Each of the four held-pool tests now also asserts that the elapsed time is at least `HELD_POOL_REMAINDER_MS - 100`. The implementer confirmed that the shortened-timer mutation now fails all four.
  - `[medium]` `[patch]` Verification Gap: no test shows that an opening which fails before its bound keeps its error class. — Added the `readOnlyTransaction` test "keeps the error of an opening that fails before its bound". The `within(opening.catch(() => null), …)` mutation now fails it.
  - `[medium]` `[patch]` Verification Gap: the handlers that swallow a late opening's rejection and a failed late rollback are never exercised. — Added "absorbs the rejection and the failed rollback of a late opening", which asserts that a `process` `unhandledRejection` listener is never called. Dropping both handlers now fails it.
  - `[low]` `[patch]` Verification Gap (other): the `lateClock` JSDoc at `server/tools/wikiLint.test.ts:~4216` is stale. — Corrected the comment, grouped with the Blind Hunter JSDoc row.
  - `[medium]` `[patch]` Intent Alignment: no adapter-level test for `readOnlyTransaction`, so its branches are covered only indirectly or not at all. — Covered by the two new adapter tests in `documentReader.test.ts`, grouped with Verification Gap finding 2.
  - `[low]` `[reject]` Intent Alignment: the abandoned wait outlives the request for up to 30 s (L1 rather than L2). — Same root cause as the pool-pressure rows. The intent asks for no leaked held connection, and that is pinned: the pool returns to 0/0.
  - `[false]` `[reject]` Intent Alignment: refusal before opening is asserted only for the `lint_wiki` lookup. — Same refutation as the Blind Hunter row: the shared helper's ordering is pinned.
  - `[false]` `[reject]` Intent Alignment: the collection-scoped `lint_wiki` snapshot on a held pool is untested. — Both scopes reach the same `readOnlyTransaction` call in `readWikiSnapshot`, and the default-scope test exercises it. The collection scope only adds the lookup, which row 2 covers.
  - `[false]` `[reject]` Intent Alignment: the literal 60 s / 9 s deadlines and the 63 s ceiling are not measured directly. — The ceiling follows from acquisition being bounded by the remainder, which `remainderClock` exercises at both surfaces' deadlines. Nothing else can overrun.
  - `[false]` `[reject]` Intent Alignment: `batchTimeoutMs()` is used instead of `remainingMs()`, and expiry is reported as `DeadlineFloorError`. — `batchTimeoutMs()` is the floored `remainingMs()` with the floor refusal the intent asks for. When the timer fires, the remainder is about 0 ms, below the floor, so the error's statement holds and the existing `VALIDATION_TIMEOUT` mapping applies.
  - `[low]` `[reject]` Intent Alignment: one existing test goes beyond index shifts. — Same as the Blind Hunter AC row: the test change is correct, and only the spec text differs.

### 2026-10-04 — Follow-up review pass
- verdicts: 20 findings — high 0, medium 3, low 14, false 3, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind Hunter: `SET TRANSACTION READ ONLY` can run after the opening bound expires. — The code confirms this, but the same setup statement preceded the first bounded batch before DW-6. A separate bound and cancellation path for this short statement adds complexity outside the acquisition change; this unlikely stall is not worth that fix here.
  - `[low]` `[reject]` Blind Hunter: `commit()` has no request-deadline timer. — Commit also followed the managed callback without a request timer before DW-6. Bounding an in-flight commit would need transaction-outcome handling, beyond a direct correction to acquisition.
  - `[low]` `[reject]` Blind Hunter: a late rollback may stall and keep its connection in use. — The late handler does await rollback, and a stalled database rollback cannot be made to release its connection by a local timer. This needs broader connection-failure handling for an unlikely failure mode.
  - `[false]` `[reject]` Blind Hunter: the pool's own early `ConnectionAcquireTimeoutError` lacks meaningful classification coverage. — `within` propagates an opening rejection unchanged; the adapter test asserts error identity, while application tests classify an ordinary pre-expiry error as `VALIDATION_RUNTIME_FAILED`. `isDatabaseTimeout` does not classify this Sequelize pool error.
  - `[medium]` `[patch]` Blind Hunter: manual commit and work-failure rollback guarantees lacked direct tests. — Added two adapter tests: commit rejection propagates, and a rollback rejection does not replace the work error. This groups the two verification-gap findings below.
  - `[low]` `[reject]` Blind Hunter: `holdPool()` can leak earlier holders if a later acquire fails. — Carried from the first review: this affects an already-failing test fixture and a fix adds cleanup branches or a shared helper.
  - `[low]` `[reject]` Blind Hunter: the Design Notes example requests a connection before reading the bound. — Carried from the first review: production reads `batchTimeoutMs()` first; correcting the example edits this build's spec.
  - `[low]` `[reject]` Blind Hunter: the spec calls `SET TRANSACTION READ ONLY` the first statement, while API workers may set a local timeout first. — `applyStatementTimeoutToTransactions` confirms this conditional ordering. The code still sets read-only before any lint work; the correction is to the spec's wording.
  - `[low]` `[reject]` Blind Hunter: Tasks misstate which held-pool rows wrap the reader. — Carried from the first review: rows 1–3 hold the pool before invocation; only row 4 wraps the reader. The correction edits this build's spec.
  - `[low]` `[reject]` Blind Hunter: the AC claims only index shifts in existing tests. — Carried from the first review: the counting-clock change preserves the enumeration-refusal target, and the correction edits this build's spec.
  - `[low]` `[reject]` Blind Hunter: Code Map line ranges are stale. — The change moved code, but the named functions still locate it. Updating line numbers edits this build's spec and would not change behavior.
  - `[low]` `[reject]` Edge Case Hunter: read-only setup can stall after opening. — Same cause as the first Blind Hunter finding; the existing first-batch bound does not cover that setup statement, and a separate cancellation path is not a small acquisition fix.
  - `[low]` `[reject]` Edge Case Hunter: a partially acquired held pool can disrupt later tests. — Carried from the first review's `holdPool` finding: it occurs only when the fixture is already failing.
  - `[low]` `[reject]` Edge Case Hunter: rows 2–3 do not use the reader wrapper described in Tasks. — Carried from the first review: this is a spec-text mismatch, not a test-behavior defect.
  - `[low]` `[reject]` Edge Case Hunter: the counting-clock test exceeds the AC's listed edit types. — Carried from the first review: it is needed to keep testing the intended enumeration batch; only the spec text differs.
  - `[medium]` `[patch]` Verification Gap: a failed commit could be swallowed without a test failing. — Added `propagates a failed commit` in `documentReader.test.ts`; it asserts error identity and that rollback is not called.
  - `[medium]` `[patch]` Verification Gap: a failed rollback could mask the work error without a test failing. — Added `preserves the work error when rollback fails` in `documentReader.test.ts`; it asserts error identity and that commit is not called.
  - `[false]` `[reject]` Intent Alignment: the implementation changes the callback-managed Sequelize API. — The intent explicitly requires opening without a callback and preserving its observable managed semantics; the diff does both.
  - `[false]` `[reject]` Intent Alignment: injected clocks and audit writers miss the MCP acceptance surface. — The tests invoke the MCP client against a real saturated pool and assert its responses and elapsed time; the intent does not require an unmodified external service or a literal 63-second test.
  - `[low]` `[reject]` Intent Alignment: an existing fixed-deadline test became a counting-clock test beyond the AC wording. — Carried from the first review: the change preserves that test's enumeration-refusal target, and the proposed correction is only to this build's spec.

## Design Notes

Why `DeadlineFloorError` on expiry: the timer equals the floored remainder, so when it fires the remainder is about 0 ms, below the floor. The first batch would be refused before any statement is sent, which is what the error states. Reusing it keeps one mapping for every surface. The managed form cannot separate acquisition from the work, so the transaction opens without a callback, as `EnforcementTransaction.open` does:

```ts
const opening = sequelize.transaction({ isolationLevel });
const transaction = await within(opening, deadline.batchTimeoutMs(), null);
if (transaction === null) {
  opening.then((late) => late.rollback().catch(() => undefined), () => undefined);
  throw new DeadlineFloorError();
}
```

## Verification

**Commands:**
- `scripts/test-db.sh ensure` -- expected: the database is ready.
- `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint/adapters/documentReader.test.ts server/wikiLint/adapters/wikiReader.test.ts server/wikiLint/adapters/wikiReader.limits.test.ts server/wikiLint/application/lintWiki.test.ts server/wikiLint/application/lintDocument.test.ts server/wikiLint/application/readAudit.test.ts server/tools/wikiLint.test.ts` -- expected: all pass.
- `corepack yarn tsc` -- expected: exit 0.
- `node_modules/.bin/oxlint --type-aware` and `node_modules/.bin/oxfmt --check` on the changed files -- expected: clean.

## Auto Run Result

Status: done

**Summary:** The DW-6 implementation bounds read-transaction opening, including pool acquisition and `BEGIN`, by the remaining lint request deadline. All four read callers supply that deadline. A below-floor remainder refuses an opening, and a transaction that opens after timeout is rolled back. Existing tool error mappings remain unchanged.

**Files changed since the baseline:**
- `server/wikiLint/adapters/documentReader.ts` — bounds read-transaction opening and preserves rollback and commit behavior.
- `server/wikiLint/adapters/wikiReader.ts` — passes the deadline from both wiki read callers.
- `server/tools/wikiLint.test.ts` — proves the four held-pool MCP outcomes and below-floor refusal.
- `server/wikiLint/adapters/wikiReader.test.ts` — retargets clock-based refusals after the new deadline reading.
- `server/wikiLint/adapters/documentReader.test.ts` — covers opening failures, late cleanup, commit failure, and rollback-error precedence.
- This spec — records implementation, review triage, and verified result.

**Follow-up review:** 20 findings: high 0, medium 3, low 14, false 3. Two medium patch entries added tests for commit rejection and rollback-error precedence. No items were deferred. The 17 rejected findings and their individual reasons are recorded in the follow-up Review Triage Log: three unbounded post-opening operations require broader handling for rare stalls; one early pool-error classification concern is covered by error propagation and application mapping; `holdPool` partial failure occurs only in an already-failing fixture; four spec wording or pointer issues require spec-only edits; repeated claims about the reader wrapper and counting-clock test were already resolved in the first review; the literal callback-API and unmodified-service readings are not required by the intent. Patched entries by verdict: high 0, medium 2, low 0. This was a follow-up pass, so `followup_review_recommended: false`.

**Verification performed:** `scripts/test-db.sh ensure` reported the test database ready. The targeted Vitest command above passed 7 files and 315/315 tests after the two added tests. `corepack yarn tsc`, type-aware `oxlint`, and `oxfmt --check` passed on the five changed source and test files.

**Residual risks:** A late acquisition remains queued until the pool grants or times out, then its transaction is rolled back. A stalled setup statement, commit, or rollback may outlast the request deadline; these operations were not newly bounded by DW-6. The held-pool tests use real time and may be sensitive to heavy host load. The pool's own early `ConnectionAcquireTimeoutError` remains a runtime failure as required.
