---
title: 'DW-9: Log enforced writes that end in AD-20 rows 3, 5, or 7 for the operator'
type: 'feature'
created: '2026-10-04'
baseline_revision: 84f0ba0f313d445feeab7d865ca2414047b3813e
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      Enforced HTML create outcomes decided outside runAttempt (requester row 3 before queue.add, requester row 7, and the worker's pre-attempt and final-catch aborts) still leave no operator log.
    evidence: |-
      DW-9 logs only the rows that runAttempt's body returns. enforcedHtmlCreate.ts has no Logger call for its own row 3 before scheduling or for row 7 when the worker returns nothing, a queue.add error, or an unavailable requester probe. enforcedImport.ts returns aborted for an unparseable intent and for its final catch (aborted(decided ? 5 : 3, ...)) without logging. The worker can also turn a logged attempt row 3 or 5 into committed or unestablished after its repeated lookup, so the logged row can differ from the row the client sees. These gaps existed before DW-9; the bundle intent scopes the fix to enforcedWrite.ts.
    location: >-
      server/wikiLint/application/enforcedHtmlCreate.ts; server/wikiLint/application/enforcedImport.ts:420-423, :839-845
    severity: low
---

<intent-contract>

## Intent

**Problem:** An enforced write that ends in AD-20 row 3 (aborted before the decision), row 5 (aborted after it), or row 7 (COMMIT outcome unestablished) leaves no operator log. `attempt` in `server/wikiLint/application/enforcedWrite.ts` maps each failure through `abortMessage` and logs only post-commit callback failures (`:655-661`), so an operator has no trace correlated by `requestId` and `invocationId` (DW-9; Epic 1 retro F-6, write side).

**Approach:** Emit exactly one `Logger.warn` for each attempt that ends in row 3, 5, or 7, from inside `runAttempt`'s body (`attempt`). The log carries only `requestId`, `invocationId`, `row`, and the class name of the failure. The Markdown request path and the HTML import worker both get it, because both call `runAttempt`. Collocated tests assert the exact log arguments.

## Boundaries & Constraints

**Always:**
- Message: `"Enforced write ended without an established commit"`. Extra: exactly `{ requestId, invocationId, row }`, plus `errorClass` only when the failure is an `Error` instance. `requestId` is always present (it is `undefined` when the shell has none), as in the existing callback log. `errorClass` is `cause.constructor.name`.
- The failure is the value the outcome is derived from: the caught error for row 3 and the P7 row 5, `commit.error` for the COMMIT row 5 and row 7. A refused `admitPersist` gate has no failure, so it logs without `errorClass`.
- A row 3 or 5 logs after its rollback, if any, and a COMMIT row 5 or row 7 after `enforcement.discard()`. Each log comes before `runAttempt` returns its outcome.
- Every outcome, message, row mapping, cleanup, callback, summary, and response stays unchanged.
- A modified `_bmad-output/implementation-artifacts/deferred-work.md` is the orchestrator's pending ledger transaction: do not stage, edit, revert, or commit it.

**Never:**
- Do not log the error's message, stack, `cause`, or `parent`, or any content, title, text, document, collection, user, or attachment identifier.
- Do not log rows 2, 4, or 6. Leave the existing post-commit callback log as it is.
- Do not change `EnforcedWriteOutcome`, `abortMessage`, `writeAudit.ts`, `enforcedImport.ts`, `enforcedHtmlCreate.ts`, or `server/tools/`.
- Do not log an unexpected throw out of `attempt` (for example a failing rollback): it is not an AD-20 outcome.
- Do not weaken existing assertions, create new test files or directories, or edit the deferred-work ledger or sprint board.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected `Logger.warn` extra | Error Handling |
|----------|--------------|---------------------------|----------------|
| Row 3 in P2 | Markdown update cancelled before the transaction | `{ requestId: "test-request", invocationId, row: 3, errorClass: "WriteCancelledError" }` | Outcome `{ row: 3, message: OPERATION_FAILED }` unchanged |
| Row 3 after BEGIN | Markdown update of a deleted document (`EmptyResultError`, whose message holds the ID) | `{ ..., row: 3, errorClass: "EmptyResultError" }`; no document ID in the log | Unchanged |
| Row 5 in P7 | Markdown unpublish of a parent with a child (`InvalidRequestError`) | `{ ..., row: 5, errorClass: "BadRequestError" }`; no message text in the log | Unchanged baseline message |
| Row 5, refused gate | `runAttempt` with `admitPersist: () => false` | `{ requestId: "test", invocationId, row: 5 }` and no `errorClass` key | Unchanged |
| Row 3, non-application error | `runAttempt` whose `prepare` rejects `new Error("prepare failed")` | `{ requestId: "test", invocationId, row: 3, errorClass: "Error" }` | Unchanged |
| Row 5 at COMMIT | Deferred trigger raises at COMMIT; the probe finds no row | `{ ..., row: 5, errorClass: "DatabaseError" }` | Unchanged |
| Row 7 | COMMIT held past its timer; the probe finds no row | `{ ..., row: 7, errorClass: "CommitTimeoutError" }` | Unchanged |
| Rows 2, 4, 6 | Moved parent, rejected body, valid update | No call with the message | none |

</intent-contract>

## Code Map

- `server/wikiLint/application/enforcedWrite.ts:481-667` -- `attempt`, the only production change. Row sites: `:508-510` (P2 catch, row 3), `:583-586` (P3-P6 catch after rollback, row 3), `:591-597` (`admitPersist` refusal, row 5), `:614-617` (P7 catch, row 5), `:623-633` (probe not `present`: row 5 when `absent` and `isServerReported(commit.error)`, otherwise row 7). `:655-661` is the existing `Logger.warn` style to mirror. `requestId` and `invocationId` are already destructured at `:491-492`. `Logger` is already imported (`:3`).
- `server/wikiLint/application/enforcedWrite.ts:429-467` -- `runAttempt` doc comment; add one sentence saying that rows 3, 5, and 7 are logged with these fields only.
- `server/wikiLint/application/writeDecision.ts:119-125` -- `abortMessage(undefined)` returns `OPERATION_FAILED`, so a shared `aborted(row, cause)` helper keeps the refused-gate message. Read-only.
- `server/wikiLint/adapters/writeTransaction.ts:373-384` -- `commit()` always returns an `error` when it is not committed (`CommitTimeoutError` on timer expiry). Read-only.
- `server/wikiLint/application/enforcedImport.ts:684-787` -- the worker calls `runAttempt` with `requestId` and `admitPersist`. It turns an own-ID conflict row 5 into `committed` and throws on row 7. Read-only; see Design Notes.
- `server/wikiLint/application/enforcedWrite.test.ts` -- the `update`/`create` helpers pass `requestId: "test-request"` (`:251-332`). The row 3/5 summary's `id` is the `invocationId` (`summaries`, `:104-110`). `afterEach` restores the mocks and clears `summaries` (`:588`). There are existing scenarios to copy: deleted target (`:1458`), cancelled before the transaction (`:1629`), unpublishing a parent (`:1774`), and row 2 with a moved parent plus row 7 (`:2953-2990`). In `describe("attempt options")` (`:1924`), the local `attempt()` helper runs `runAttempt` with `requestId: "test"` and plan overrides; a refused gate is at `:2011` and a rejecting `prepare` at `:1988`.
- `server/wikiLint/application/enforcedWrite.concurrency.test.ts` -- the `create`/`update` helpers (`:142-215`) pass no `requestId`. `holdCommit(false)` with row 7 is at `:600-689`, and the server-reported COMMIT row 5 is at `:716`. `EnforcementTransaction.open(invocationId, ...)` exposes the invocation ID to a spy. `afterEach` restores the mocks (`:342`).
- `server/tools/documents.enforcedMedia.test.ts:768`, `server/tools/documents.enforcedAudit.test.ts:1112` -- existing `Logger.warn` spies filter by message, so a new message does not disturb them. Read-only evidence.

## Tasks & Acceptance

**Execution:**
- `server/wikiLint/application/enforcedWrite.ts` -- in `attempt`, add a local `aborted(row: 3 | 5, cause: unknown)`. It logs and returns `{ row, message: abortMessage(cause) }`. Route the four row 3/5 sites and the COMMIT row 5 through it, passing `undefined` for the refused gate. Log row 7 with `commit.error` before `return { row: 7 }`. Update the `runAttempt` doc comment. -- One log per row 3, 5, or 7 outcome, with exact fields.
- `server/wikiLint/application/enforcedWrite.test.ts` -- add `describe("operator log")` with an `it.each` over the three Markdown matrix rows. Each asserts that the calls filtered by the message `toStrictEqual` the single expected call, with `invocationId: summaries[0].id`. Add a test that rows 2, 4, and 6 produce no such call. In `describe("attempt options")`, add a test for the refused gate (no `errorClass` key) and the rejecting `prepare`. Use a given `invocationId`. -- Proof for matrix rows 1-5 and 8.
- `server/wikiLint/application/enforcedWrite.concurrency.test.ts` -- add `requestId: "test-request"` to the `create` and `update` helpers. In the `holdCommit(false)` row 7 test and the server-reported COMMIT row 5 test, spy on `Logger.warn` (silenced) and `EnforcementTransaction.open`, then assert the exact single call. Keep every existing assertion. -- Proof for matrix rows 6-7.

**Acceptance Criteria:**
- Given any matrix scenario, when the attempt ends, then the calls with the message `toStrictEqual` exactly the listed call, or none for rows 2, 4, and 6, and the outcome is the one the existing tests already expect.
- Given the pre-change `enforcedWrite.ts`, when the new assertions run, then every new log assertion except the rows 2/4/6 test fails.
- Given the enforced-write, worker, and MCP enforced-document suites, when they run against the test database, then every test passes, and the summaries and response shapes are unchanged.
- Given the changed files, when format, lint, and type-check run, then they report no new problems.

## Spec Change Log

## Review Triage Log

### 2026-10-04 — Review pass
- verdicts: 23 findings — high 0, medium 0, low 17, false 6, maybe-false 0
- findings:
  - `[low]` `[patch]` Blind Hunter: "keeps the outcome when logging throws" never checks that the throwing `Logger.warn` was called, so it passes on pre-change code. — Real. The spy is now kept, and the test asserts the call with `OPERATOR_LOG` and `objectContaining({ row: 3, errorClass: "EmptyResultError" })`. Without the log, it fails.
  - `[false]` `[reject]` Blind Hunter: the message string is copied, so "logs nothing" would pass vacuously if production were reworded. — Within each file, the negative test shares one `OPERATOR_LOG` constant with the positive tests. Rewording the production message makes all seven positive assertions fail first, so the vacuous pass cannot go unnoticed.
  - `[low]` `[patch]` Blind Hunter: the socket row 7 and probe-confirmed row 6 tests carry no log assertions, and `invocationIds()[0]` is taken without counting `open` calls. — Grouped with the Verification Gap probed-row-6 finding and patched there. The socket row 7 path reaches the same `warn(7, commit.error)` line as the tested hang. A missing `open` call would yield `invocationId: undefined`, which fails `toStrictEqual`.
  - `[low]` `[reject]` Blind Hunter: the row 7 log does not record whether the probe found no row or could not run. — The intent limits the fields to requestId, invocationId, the row, and the error class name. A `probe` field contradicts that.
  - `[low]` `[reject]` Blind Hunter: the log does not name the failure point (P2 or P3-P6, P7 or COMMIT, gate or a non-Error throw). — Same field limit set by the intent.
  - `[low]` `[reject]` Blind Hunter: worker logging is untested, and a worker row 5 own-ID conflict or a redelivery row 3 later reported as committed is still logged. — Real but rare: it needs redelivery or a concurrent-delivery race. The log truthfully describes that attempt, and Design Notes record it. Suppressing it needs a new `runAttempt` option or `enforcedImport.ts` changes. The worker's options (`admitPersist`, given `invocationId`) are tested through `runAttempt` directly.
  - `[low]` `[reject]` Blind Hunter: routine cancellations and gate refusals now raise the `logger.warning` metric. — The intent asks for one `Logger.warn` per row 3, 5, or 7 outcome, and cancellation is row 3.
  - `[low]` `[reject]` Blind Hunter: "no log on an unexpected throw (failing rollback)" and "log after rollback" have no tests. — `EnforcementTransaction.rollback()` catches every rejection (`writeTransaction.ts:359-363`), so a failing rollback cannot throw. The ordering is straight-line code, and a misorder would harm no one.
  - `[low]` `[reject]` Blind Hunter: the try/catch guard and its test go beyond the spec snippet. — The guard implements the Always rule "Every outcome ... stays unchanged" and follows the guarded-`Logger.warn` convention (`readAudit.ts:246-256`, `mediaStaging.ts:302-314`). The suggested fix is a spec edit.
  - `[low]` `[patch]` Blind Hunter: the doc comments overstate which failures have a class name. — Reworded: `warn`'s `@param cause` now says the class name is logged only for an `Error`, and `runAttempt` says "when the failure is an `Error`, its class name".
  - `[low]` `[reject]` Edge Case Hunter: the worker converts a logged row 3 or 5 into committed or unestablished after its repeated lookup. — Grouped with the worker-reinterpretation finding and rejected on the same evidence; the requester- and worker-side gaps are deferred.
  - `[low]` `[reject]` Edge Case Hunter: an `Error` whose `constructor` is shadowed or undefined makes the catch drop the whole warning. — Not reachable in practice: failures here come from Sequelize, pg, http-errors, and this module's own classes. A per-field guard adds complexity.
  - `[low]` `[patch]` Edge Case Hunter: the throwing-logger test never checks the mock was called. — Same root cause as the first finding; patched there.
  - `[low]` `[patch]` Edge Case Hunter: the red-phase claim is overstated because the throwing-logger test passed pre-change. — Same root cause; after the patch, the test fails against pre-change `enforcedWrite.ts` (re-run by the implementation subagent).
  - `[low]` `[patch]` Verification Gap: no test asserts that a probed row 6 emits no operator log. — Pre-verified gap. "ends in row 6 with its callbacks when COMMIT lands but its reply outlives the timer" now sets up `operatorLog()` and asserts `log.calls()` is `[]`.
  - `[low]` `[reject]` Intent Alignment (a): a worker own-ID conflict logs row 5 although the client sees committed. — Same worker-reinterpretation group; rejected on the same evidence. The intent places the log in `enforcedWrite.ts` (runAttempt), whose outcome is row 5.
  - `[false]` `[reject]` Intent Alignment (b): a worker row 7 followed by redelivery could log several times per invocationId. — Each delivery is a separate attempt and logs exactly once. That matches "one Logger.warn per such outcome".
  - `[low]` `[defer]` Intent Alignment (c): HTML requester row 3 before scheduling and requester row 7 are not logged. — Pre-existing, and outside the intent's `enforcedWrite.ts` scope. Deferred with (d).
  - `[low]` `[defer]` Intent Alignment (d): worker aborts outside `runAttempt` (intent parse, final catch) are not logged. — Pre-existing; deferred with (c) as one root cause, since logging lives only in `runAttempt`.
  - `[false]` `[reject]` Intent Alignment (e): a throw out of `attempt`, such as a failed rollback, reaches the client with no log. — `rollback()` swallows every rejection (`writeTransaction.ts:359-363`). The other steps after BEGIN sit inside caught blocks, and `probeCommit` returns `unavailable` rather than throwing.
  - `[false]` `[reject]` Intent Alignment (f): `constructor.name` versus `name`, errorClass omitted for non-Error causes, and row 7 tested only for the timeout. — The intent asks for the error class name, which is `constructor.name`. A refused gate has no error. Both row 7 probe results reach the same line.
  - `[false]` `[reject]` Intent Alignment (g): DW-19 does not exist yet, so `errorClass` is the first key of its kind. — An observation; it describes no bad outcome.
  - `[false]` `[reject]` Intent Alignment (h): summaries and responses are unchanged, and dropping the `OPERATION_FAILED` import is safe. — It confirms correctness; there is no defect.

### 2026-10-04 — Follow-up review pass
- verdicts: 9 findings — high 0, medium 0, low 9, false 0, maybe-false 0
- findings:
  - `[low]` `[defer]` Blind Hunter: HTML requester row 3 before scheduling has no operator log. — Carried from the prior HTML requester finding: this is decided outside `runAttempt` and is already recorded in `deferred`; no new ledger or spec deferred entry was made.
  - `[low]` `[defer]` Blind Hunter: HTML requester row 7 after its probe has no operator log. — Carried from the same prior requester finding; the requester can finish without an attempt, and the existing deferred item covers it.
  - `[low]` `[defer]` Blind Hunter: an invalid worker intent returns row 3 without an operator log. — Carried from the prior worker pre-attempt finding; it is decided before `runAttempt` and remains in the existing deferred item.
  - `[low]` `[defer]` Blind Hunter: the worker's final catch can return row 3 or 5 without an operator log. — Carried from the prior worker-abort finding; it is outside `runAttempt` and remains in the existing deferred item.
  - `[low]` `[reject]` Blind Hunter: an own-ID conflict can turn a logged attempt row 5 into a committed worker result. — Carried from the prior worker-reinterpretation finding: the warning describes that attempt, while the worker's later resolution is a separate result; changing its meaning would exceed this intent.
  - `[low]` `[reject]` Blind Hunter: a repeated worker lookup can change a logged row 3 or 5 into a committed or unestablished result. — Carried from the prior worker-reinterpretation finding for the same reason; this story specifies logging inside `attempt`.
  - `[low]` `[patch]` Blind Hunter: the socket row 7 test has no log assertion. — Carried from the prior socket-row-7 finding. The socket and timeout cases reach the same `warn(7, commit.error)` line; the prior pass patched the separate probed-row-6 gap. No second patch was made for this carried row.
  - `[low]` `[patch]` Verification Gap: the worker's row 5 test did not assert that the operator log retained the intent's `requestId` and `invocationId`. — Added an exact filtered `Logger.warn` assertion to the existing refused-persist test in `enforcedImport.test.ts`; it fails if the worker stops forwarding `requestId` to `runAttempt`.
  - `[low]` `[defer]` Intent Alignment: final HTML requester and worker outcomes can diverge from the logged attempt outcome. — Carried from the prior requester and worker findings. The intent explicitly places the warning inside `runAttempt`; the existing deferred item records outcomes decided outside it.

## Design Notes

The log sits in `attempt` because only that function holds the failure. `runAuditedAttempt` sees just the outcome, and adding a field to `EnforcedWriteOutcome` would change a shared type for a diagnostic. `constructor.name` is the literal class name: for Sequelize it gives `DatabaseError`, not the `name` value `SequelizeDatabaseError`. The message `"ended without an established commit"` is true for rows 3, 5, and 7 alike, while `"failed"` would be false for a row 7 COMMIT that did land.

The worker shares the log. A worker row 5 that `enforcedImport.ts` then reports as `committed` (an own pre-allocated-ID conflict) is still logged, because the attempt itself ended in row 5. A worker row 7 is logged once here before the worker throws. Its own pre-attempt aborts in `enforcedImport.ts` stay out of scope.

```ts
const warn = (row: 3 | 5 | 7, cause: unknown) =>
  Logger.warn("Enforced write ended without an established commit", {
    requestId,
    invocationId,
    row,
    ...(cause instanceof Error && { errorClass: cause.constructor.name }),
  });
const aborted = (row: 3 | 5, cause: unknown): EnforcedWriteOutcome => {
  warn(row, cause);
  return { row, message: abortMessage(cause) };
};
```

## Verification

**Commands:**
- `scripts/test-db.sh ensure` -- expected: the test database is running and migrated.
- `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint/application/enforcedWrite.test.ts server/wikiLint/application/enforcedWrite.concurrency.test.ts` -- expected: every test passes.
- `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint/application/enforcedImport.test.ts server/wikiLint/application/enforcedHtmlCreate.test.ts server/tools/documents.enforcement.test.ts server/tools/documents.enforcedAudit.test.ts server/tools/documents.enforcedMedia.test.ts server/tools/documents.enforcedHtml.test.ts server/tools/documents.responses.test.ts` -- expected: every test passes (regression for every `runAttempt` consumer).
- `corepack yarn tsc`, `node_modules/.bin/oxlint --type-aware` and `node_modules/.bin/oxfmt --check` on the changed files -- expected: exit 0.

## Auto Run Result

Status: done

**Summary:** `attempt` in `enforcedWrite.ts` emits one guarded `Logger.warn("Enforced write ended without an established commit", { requestId, invocationId, row, errorClass? })` when it ends in AD-20 row 3, 5, or 7. The extra contains only the listed fields. The outcome, cleanup, callbacks, summaries, and responses remain unchanged. This follow-up pass added worker-level proof that the HTML import passes its correlation IDs into that log.

**Files changed since the baseline:**
- `server/wikiLint/application/enforcedWrite.ts`: log rows 3, 5, and 7 from `attempt` after their cleanup, with a guard against logging failures.
- `server/wikiLint/application/enforcedWrite.test.ts`: assert exact Markdown and direct-attempt log calls, and absence for rows 2, 4, and 6.
- `server/wikiLint/application/enforcedWrite.concurrency.test.ts`: assert COMMIT row 5 and 7 logs and a probed row 6 without the log.
- `server/wikiLint/application/enforcedImport.test.ts`: assert that a refused persist in the HTML worker logs the intent's `requestId` and `invocationId` exactly once.
- This spec: record the follow-up review and verification.

**Review findings:** Nine findings: one new low-severity patch, five carried deferrals, two carried rejections, and one carried prior patch with no further change. The new patch is the worker correlation assertion. The carried deferrals concern requester or worker outcomes decided outside `runAttempt`; the existing `deferred` item already records them. The carried rejections concern worker reinterpretation after a logged attempt; the warning describes the attempt outcome required by the intent. The socket row 7 observation was carried from the prior pass because its path reaches the tested `warn(7, commit.error)` line. Each finding and its reason is recorded in the Follow-up review pass triage log.

**Follow-up review recommendation:** `false`; this follow-up pass patched high 0, medium 0, low 1. No unverified risk from the patch calls for another pass.

**Verification:** `scripts/test-db.sh ensure` reported the database ready. The two enforced-write suites passed 111/111 tests; the seven worker, HTML requester, and MCP regression suites passed 301/301, including the new worker assertion. `oxfmt --check` and `oxlint --type-aware` on all four changed TypeScript files, and `corepack yarn tsc`, exited 0.

**Residual risks:** Requester and worker outcomes decided outside `runAttempt` remain unlogged as recorded in `deferred`. A worker may reinterpret a logged attempt row after its repeated lookup; the log remains an attempt-level record.
