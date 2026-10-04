---
title: 'DW-26: Reserve the commit-probe bound out of the COMMIT timer'
type: 'bugfix'
created: '2026-10-04'
baseline_revision: a5d069c3236d22f3bc15c018c519d7f567346211
status: done
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** In P8 of `runAttempt` (`server/wikiLint/application/enforcedWrite.ts:620-627`), `enforcement.commit(Math.floor(persistence.remainingMs()))` gives COMMIT the whole remaining persistence budget. The probe bound is `Math.min(COMMIT_PROBE_BOUND_MS, Math.floor(persistence.remainingMs()))`. After a COMMIT timeout that bound is about 0, so `boundedRead` refuses it below `SET_LOCAL_FLOOR_MS` and returns `unavailable`. Every COMMIT timeout therefore ends in row 7 without a usable probe (Epic 2 retro F-6). Amendment D3 (`78f9c101f`; AD-11 at `ARCHITECTURE-SPINE.md:169`; Story 2.3 AC9) requires COMMIT's wall-clock timer to equal the remaining persistence budget less the 2-second `COMMIT_PROBE_BOUND_MS` reserve. The probe keeps its own full 2-second bound.

**Approach:** Set the COMMIT timer to `Math.floor(persistence.remainingMs()) - COMMIT_PROBE_BOUND_MS`, and give the probe `COMMIT_PROBE_BOUND_MS`. Add DB-backed tests in the existing "COMMIT outcomes" describe. They show that a COMMIT that outlives its timer is probed under nearly the full bound, and that the probe result picks the AD-20 row. A timeout is a connection-level rejection, so an absent row is row 7, never row 5, and a present row is row 6.

## Boundaries & Constraints

**Always:**
- The fix stays in the shared `runAttempt` body, so the Markdown path (Story 2.3) and the HTML worker (Story 2.5, `enforcedImport.ts:684`) both get it.
- The P7 statement timeouts keep using `persistence.batchTimeoutMs(COMMIT_PROBE_BOUND_MS)`.
- The COMMIT timer is computed without throwing. `within` clamps a non-positive timer to 0.
- `CommitTimeoutError` stays connection-level.
- The new tests follow the file's conventions: `state.clock` offset, `interceptQueries`, and `commitFixture`.
- The work is already committed on the branch. A modified `deferred-work.md` is the orchestrator's own pending ledger transaction, not this bundle's change; it does not fail the clean-tree gate. Finalize without staging, editing, reverting or committing it.

**Never:**
- Do not use `persistence.batchTimeoutMs(...)` for the COMMIT timer. A `DeadlineFloorError` thrown at P8 would escape the attempt.
- Do not change `deadline.ts` constants, `EnforcementTransaction`, `probeCommit`, `boundedRead`, `enforcedImport.ts`, or the AD-20 row mapping.
- Do not weaken existing assertions.
- Do not create new test files or directories.
- Do not edit the deferred-work ledger or the sprint board.

## I/O & Edge-Case Matrix

All rows assume a persistence remainder of about 2300 ms at P7 entry, so the COMMIT timer is about 300 ms.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| COMMIT never sent before its timer | COMMIT held before it reaches the database | The probe runs on a fresh connection with `SET LOCAL statement_timeout` above `COMMIT_PROBE_BOUND_MS - SET_LOCAL_FLOOR_MS` and finds no row. The outcome is `{ row: 7 }`, the document is absent, and the callbacks never run, even after the held COMMIT lands | A timeout is connection-level, so not row 5 |
| COMMIT landed, reply late | COMMIT reaches the database; its reply is held past the timer | The probe runs with the same near-full statement timeout and finds the pre-allocated document. The outcome is row 6, the document exists, and the buffered callbacks ran (Markdown path) | The held reply is released after the assertions |
| COMMIT resolves in time | No hold | Row 6 as before; no probe | none |

</intent-contract>

## Code Map

- `server/wikiLint/application/enforcedWrite.ts:619-627` -- P8, the only production change: the timer argument of `enforcement.commit` and the bound argument of `probeCommit`. The comment at `:599-600` already says P7 runs "less the probe reserve".
- `server/wikiLint/application/deadline.ts:31-40` -- `WRITE_PERSISTENCE_BUDGET_MS` (9000, which includes the probe) and `COMMIT_PROBE_BOUND_MS` (2000). `:11` is `SET_LOCAL_FLOOR_MS` (100). `:155-161` is `batchTimeoutMs`, which throws below the floor, so it is not used for the timer. Read-only.
- `server/wikiLint/adapters/writeTransaction.ts:373-383` -- `commit(timerMs)`, which wraps `within` and resolves `CommitTimeoutError` on expiry. `:435-461` is `boundedRead`: it builds a `Deadline(boundMs)` and issues `SET LOCAL statement_timeout = ${deadline.batchTimeoutMs()}` on a fresh transaction. `:474-505` is `probeCommit`; a create probes with the exact SQL `SELECT id FROM documents WHERE id = :id`. Read-only.
- `server/wikiLint/application/enforcedWrite.concurrency.test.ts:554-622` -- `describe("COMMIT outcomes")`, `commitFixture`, and the existing test "ends in row 7 when COMMIT hangs past its timer". That test offsets the clock after the 4th `SET LOCAL lock_timeout` (P7 entry). Under the old code its row 7 came from the probe that could not run. Under the fix it comes from a probe that finds no row. `:225-242` is `interceptQueries` (handlers `(sql, options, next)`; `options.transaction` identifies the connection). `:42-53` is the clock mock. `:31-35` imports from `./deadline`.
- `server/wikiLint/application/enforcedImport.ts:684` -- the worker calls `runAttempt` and inherits the fix. Read-only.

## Tasks & Acceptance

**Execution:**
- `server/wikiLint/application/enforcedWrite.ts` -- in P8, pass `Math.floor(persistence.remainingMs()) - COMMIT_PROBE_BOUND_MS` to `enforcement.commit` and `COMMIT_PROBE_BOUND_MS` to `probeCommit`. Add a one-line comment saying COMMIT's timer leaves the probe reserve. -- This implements D3 / DW-26.
- `server/wikiLint/application/enforcedWrite.concurrency.test.ts` -- in "COMMIT outcomes", add a helper that does three things: it applies the existing P7 clock offset; it holds `COMMIT;` either before `next()` (not landed) or after it (landed) until released; and it records the `SET LOCAL statement_timeout` value of the transaction that later sends the probe SELECT. Move the existing hang test onto the helper, keeping all its assertions, and add the probe-timeout assertion. Add the landed/late-reply row 6 test, releasing the hold in `finally`. Import `COMMIT_PROBE_BOUND_MS` and `SET_LOCAL_FLOOR_MS`. -- These are the surface-anchored proofs of I/O rows 1 and 2.

**Acceptance Criteria:**
- Given I/O row 1 or 2, when `enforceMarkdownCreate` runs, then it returns the listed outcome, and the probe's recorded statement timeout is greater than `COMMIT_PROBE_BOUND_MS - SET_LOCAL_FLOOR_MS` and at most `COMMIT_PROBE_BOUND_MS`.
- Given the baseline code (timer equal to the whole remainder), when the I/O row 1 and 2 tests run, then they fail: row 1 records no probe and row 2 returns row 7. This shows the tests detect F-6.
- Given the targeted suites, when they run against the test database, then every test passes.

## Spec Change Log

## Review Triage Log

### 2026-10-04 — Review pass
- verdicts: 20 findings — high 0, medium 3, low 11, false 4, maybe-false 2
- findings:
  - `[medium]` `[patch]` Blind Hunter: nothing asserts the COMMIT timer; a timer of the whole remainder or of remainder − 2×reserve keeps both new tests green. — Grouped with the Verification Gap finding below. The fix applied: `holdCommit` records when the P7 offset is applied and when the probe SELECT is sent. Both hold tests now assert that the persistence remainder at probe start lies within `COMMIT_PROBE_BOUND_MS ± SET_LOCAL_FLOOR_MS`. Re-run: reverting only the timer line now fails both tests (remainder about −4 and −1 ms). The subagent also showed that a timer clamped to 0 fails both (about 2460 ms). I/O row 3 "no probe" is already covered by `probed: false` in `enforcedWrite.test.ts:2074-2078`.
  - `[low]` `[reject]` Blind Hunter: COMMIT's timer has no floor, so after a slow final P7 `SET LOCAL` pair a healthy COMMIT may get a 0–100 ms timer. — Grouped as "no floor on the P8 timer". This needs at least 100 ms between the last P7 floor check and COMMIT while the remainder is already within about 100 ms of the reserve, which is rare. The resulting rows are contract-legal: row 6 through the probe, or row 7 with no claim. The fix would be a new guard branch, so the low-finding rejection rule applies.
  - `[low]` `[reject]` Blind Hunter: removing the `Math.min` cap lets P7+P8 run past `WRITE_PERSISTENCE_BUDGET_MS`. — Same "no floor on the P8 timer" group. On a normal timeout the overrun is only the timer-firing latency (ms). A material overrun (≤ 2 s) needs the timer to be clamped (above). D3 itself says "the probe keeps its own 2-second bound", so putting the cap back would depart from the contract.
  - `[low]` `[patch]` Blind Hunter: the hard-coded `2300` offset is not derived from constants and leaves about 200 ms for persist. — The fix applied: one `remainderMs = COMMIT_PROBE_BOUND_MS + 500` drives both the offset and the remainder assertion, which gives about 400 ms of margin. The JSDoc now says COMMIT's timer is about 500 ms.
  - `[maybe-false]` `[reject]` Blind Hunter: the probe-timeout lower bound uses `SET_LOCAL_FLOOR_MS` as its tolerance and may flake; the upper bound "can't fail". — It would only flake if connection acquisition plus `BEGIN` took ≥ 100 ms, which never happened in 4 local runs. CI timing would settle it, and a flake would only be low, so it is rejected. The "can't fail" part is false: the upper bound fails for any probe bound above the constant. The tolerance matches the existing `enforcedImport.test.ts:1771` pattern.
  - `[low]` `[reject]` Blind Hunter: the row 6 test does not wait for the held COMMIT to settle, and does not show that a late reply changes nothing. — The claimed connection leak is false: release only resolves the in-memory interceptor promise, and Sequelize cleans up within microtasks. A late reply can run nothing, because `runCallbacks` drains the buffer before release and `track()` keeps Sequelize's own hook list empty. Covering it would add wait-and-assert machinery for an unlikely case.
  - `[low]` `[patch]` Blind Hunter: the row 7 test name claims the probe found no row, but `unavailable` also gives row 7. — The fix applied: `holdCommit` keeps the probe SELECT's result, and the row 7 test asserts `probeRows()` equals `[]`.
  - `[false]` `[reject]` Blind Hunter: only Markdown creates are covered (updates and the HTML worker are not). — The changed lines (timer and probe bound) are path-independent and contain no plan-specific branch. The path-specific inputs (`probeTarget`, `callbacksAfterProbe`) are unchanged and already covered: the update probes by the socket-error row 6 tests at `enforcedWrite.concurrency.test.ts:772-778`, and the worker probes in `enforcedImport.test.ts`. The intent asks for one test.
  - `[low]` `[reject]` Edge Case Hunter: a timer below the floor or ≤ 0 sends COMMIT under a 0 ms timer, and the probe races it. — Same "no floor on the P8 timer" group; rejected on the same evidence.
  - `[maybe-false]` `[reject]` Edge Case Hunter: the probe-timeout assertion may flake if acquisition takes ≥ 100 ms on a loaded CI. — Same claim as the Blind Hunter tolerance row. It would be low if true, so it is rejected.
  - `[low]` `[patch]` Edge Case Hunter: the 2300 offset may flake when persist plus `SET LOCAL` take more than about 200 ms. — Grouped with the Blind Hunter offset row. The margin is now about 400 ms through `COMMIT_PROBE_BOUND_MS + 500`.
  - `[low]` `[reject]` Edge Case Hunter: the removed `Math.min` lets P7+P8 overrun by up to 2000 ms. — Same "no floor on the P8 timer" group; rejected on the same evidence.
  - `[medium]` `[patch]` Verification Gap: the COMMIT timer's probe reserve is untested; reverting only line 621 kept 232/232 green. — This pre-verified gap is grouped with the first Blind Hunter row. The fix applied is the remainder-at-probe assertion; re-run with only line 621 reverted: both hold tests fail.
  - `[low]` `[reject]` Verification Gap (other): the P8 timer can be zero or negative, so in a narrow case the probe overruns the budget. — Same "no floor on the P8 timer" group; the reviewer itself notes that the spec accepts the clamp.
  - `[medium]` `[patch]` Intent Alignment: the tests check the probe bound, not the COMMIT timer that the intent targets. — Grouped with the Verification Gap row; the same fix was applied.
  - `[low]` `[reject]` Intent Alignment: the fixed probe bound departs from the intent's wording and from the `deadline.ts` "includes the commit probe" docs. — Same "no floor on the P8 timer" group. The amended AD-11/D3 text says "the probe keeps its own 2-second bound". The `deadline.ts` docs still hold for the budget as written, since the reserve sits inside it.
  - `[false]` `[reject]` Intent Alignment: the intent says row 5 or 7, and a server-side COMMIT `statement_timeout` → row 5 path is untested. — A wall-clock timer expiry is connection-level (AD-20 / Story 2.3 AC9), so its absent-row outcome is row 7. That satisfies "row 5 or row 7 as AD-20 specifies". The narrowed server-timeout window comes from AC9 setting the timer and the `commit()` statement timeout from the same reserve; it is not an implementation defect.
  - `[low]` `[reject]` Intent Alignment: a short or negative timer (A1 vs A2) is not exercised. — Same "no floor on the P8 timer" group; rejected on the same evidence.
  - `[false]` `[reject]` Intent Alignment: the HTML worker and the update paths are not tested. — Same refutation as the Blind Hunter path-coverage row.
  - `[false]` `[reject]` Intent Alignment: the artifact-only receipt does not apply. — This is an observation, not a defect. The deliverables include tracked server code, so the receipt is not asserted.

### 2026-10-04 — Follow-up review pass
- verdicts: 13 findings — high 0, medium 0, low 4, false 7, maybe-false 2
- findings:
  - `[maybe-false]` `[reject]` Blind Hunter: the 100 ms probe-start tolerance may flake under loaded CI. — Carried: the same tolerance claim was rejected in the first pass; four local runs and this pass's targeted suites passed, and a CI delay of at least 100 ms remains unverified. It would be low if observed.
  - `[low]` `[patch]` Blind Hunter: the late-reply row 6 test records probe rows without asserting them. — Added an assertion that the probe returned the pre-allocated document ID; the COMMIT outcomes tests and all four targeted suites pass.
  - `[low]` `[reject]` Blind Hunter: the late COMMIT reply is released without a settle-and-callback assertion. — Carried: the first pass rejected this unlikely callback risk; `runCallbacks` drains the buffer before release, and `track()` keeps Sequelize's hook list empty.
  - `[low]` `[reject]` Blind Hunter: the scenario matrix says 2300 ms and 300 ms while the test uses the reserve plus 500 ms. — The mismatch is real, but its only correction edits this build's spec, which this review workflow rejects as a patch finding; the test helper and assertions use the constants consistently.
  - `[false]` `[reject]` Blind Hunter: this build edits the deferred-work ledger despite its boundary. — The ledger change was already present, uncommitted, before this run and belongs to the orchestrator. This run did not edit or stage it.
  - `[false]` `[reject]` Blind Hunter: DW-26's ledger status conflicts with the temporary `in-review` spec status. — The ledger row is orchestrator bookkeeping, and `in-review` is this review pass's temporary status; neither is verification evidence or a defect to repair.
  - `[low]` `[reject]` Edge Case Hunter: a depleted P7 reserve can make the P8 timer zero and let the probe overrun the persistence budget. — Carried: the first pass rejected this rare, contract-legal outcome because a guard would add a new branch; `within` clamps the timer, and the probe keeps D3's full bound.
  - `[maybe-false]` `[reject]` Edge Case Hunter: probe connection acquisition beyond 100 ms can make the timeout assertions flaky. — Carried: this is the first pass's tolerance claim. No such delay was observed; it would be low if it occurs.
  - `[false]` `[reject]` Intent Alignment: the test does not capture the COMMIT timer argument directly. — It checks the remaining budget when the probe starts, and both tests fail when only the timer line is reverted; the claimed verification gap does not remain.
  - `[false]` `[reject]` Intent Alignment: the test does not explicitly assert a different probe connection. — `probeCommit` calls `boundedRead`, which opens a new Sequelize transaction; the held pre-COMMIT case also cannot complete a same-connection probe. No changed code removed that boundary.
  - `[false]` `[reject]` Intent Alignment: new tests do not call the HTML worker. — Carried: `enforcedImport` calls the changed shared `runAttempt`, and the worker probe paths already have tests. This diff changes no worker-specific branch.
  - `[false]` `[reject]` Intent Alignment: the diff includes a deferred-work ledger edit. — The edit is the orchestrator's pre-existing working-tree change, not an edit made or committed by this build; the user explicitly owns its status outside this review.
  - `[false]` `[reject]` Intent Alignment: adding the spec artifact diverges from the requested code and test surfaces. — The invoked build-auto workflow uses the spec as its required hand-back artifact; the implementation and tests remain on the requested surfaces.

### 2026-10-04 — Review pass
- verdicts: 23 findings — high 0, medium 0, low 10, false 13, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind Hunter: the re-drive baseline `a5d069c32` already contains `f74e992b7` and `d14b2c08e`, so this pass's diff has no code; AC2's "baseline code" and the Verification line's "two changed files" now read against the wrong range. — Real: this pass's diff holds only the spec and the ledger. The code was reviewed in the two logged passes above, and this run re-verified it at HEAD (202/202, matrix audit, and a temporary revert to `821b3c3f5` that failed both hold tests). The only fix is to edit this build's spec, so it is rejected.
  - `[false]` `[reject]` Blind Hunter: Finalize step 1 commits every reviewed-diff file, so it would commit the ledger the new bullet forbids. — `AGENTS.md:51` (via `CLAUDE.md`) outranks the workflow and carves the orchestrator's ledger out of both the commit and the clean-tree gate. Finalization commits only this spec by path, so neither the commit nor a dirty-tree HALT happens.
  - `[false]` `[reject]` Blind Hunter: the ledger is already staged, so a plain `git add`/`git commit` would put it into the story commit. — Finalization runs `git commit --only` with this spec's path, which leaves the staged ledger in the index and out of the commit.
  - `[false]` `[reject]` Blind Hunter: deleting `## Auto Run Result` loses the only record of the earlier verification and residual risks. — That section is committed at `a5d069c32` (line 114 of the spec there), and this pass's Auto Run Result below restates the verification and carries the residual risks forward.
  - `[low]` `[reject]` Blind Hunter: the resume left no Spec Change Log entry for the status reset, baseline move and new intent-contract bullet. — Real gap in the spec's own trail; the resolution is recorded in the run journal (`story-escalation-resolved`) and commit `a5d069c32`. The only fix edits this build's spec.
  - `[low]` `[reject]` Blind Hunter: the I/O matrix still says about 2300 ms and a 300 ms timer while the test leaves the reserve plus 500 ms. — Carried: the follow-up pass rejected this because its only fix edits this build's spec; `enforcedWrite.concurrency.test.ts:606` still uses `COMMIT_PROBE_BOUND_MS + 500`.
  - `[low]` `[reject]` Blind Hunter: the ledger closes DW-26 but `sprint-status.yaml` keeps `epic-2-retro-item-13-…` at `status: open`. — Real (`sprint-status.yaml:166-171`). The intent assigns resolution recording to the orchestrator, and the board is synced by hand (`2be325614`), so it is out of scope for this build.
  - `[low]` `[reject]` Blind Hunter: the new intent-contract bullet restates the `AGENTS.md:51` rule in different words and can go stale. — The duplication is real, but the only fix edits this build's spec (or agent-context files).
  - `[low]` `[reject]` Blind Hunter: the ledger resolution names neither the fix commits nor the spec, and says `done` while the spec is in review. — The ledger format and timing belong to the orchestrator's transaction, which the intent excludes from this build; the commits carry `(DW-26)` in their subjects, and the `resolution-undo` line covers a reversal.
  - `[low]` `[reject]` Edge Case Hunter: recapturing `baseline_revision` at HEAD drops `enforcedWrite.ts` and its test from this pass's diff. — Same root cause and evidence as the first Blind Hunter row; the fix edits this build's spec.
  - `[false]` `[reject]` Edge Case Hunter: Finalize must commit every reviewed-diff file and the ledger is in the diff, so finalization breaks the bullet or HALTs dirty. — Same refutation as the second Blind Hunter row: the project rule carves the ledger out, and finalization commits only the spec.
  - `[false]` `[reject]` Edge Case Hunter: the ledger is staged, so a plain commit would include it. — Same refutation as the third Blind Hunter row: the commit is made with `--only` and this spec's path.
  - `[low]` `[reject]` Edge Case Hunter: the clean-tree exemption would also hide a forbidden ledger edit made by the build itself. — Did not happen here: the ledger's index and working-tree blob `3d7b278e4` equal the pre-run snapshot `refs/attempt-preserve-dirty/20261004-131900-aa0c-a5d069c3-0`. A hash-recording guard adds new workflow state for an unlikely case.
  - `[false]` `[reject]` Edge Case Hunter: at baseline `a5d069c32` the fix is already present, so AC2's claim that the tests fail on the baseline code looks falsified. — AC2 defines its "baseline code" in the same sentence as the code whose timer equals the whole remainder. This run checked it against `821b3c3f5`'s `enforcedWrite.ts`: row 1 failed with `expected NaN to be greater than 1900` and row 2 returned row 7.
  - `[false]` `[reject]` Verification Gap (other): the staged ledger would enter the story commit under a plain `git commit`. — Same refutation as the third Blind Hunter row.
  - `[false]` `[reject]` Intent Alignment: the diff touches only BMAD files, not the code and test surfaces the intent targets. — The intent's P8 change and tests are committed in `f74e992b7` and `d14b2c08e`, before this re-drive's baseline, and were re-verified at HEAD in this run.
  - `[low]` `[reject]` Intent Alignment: moving `baseline_revision` past the implementation commits leaves it outside the diff's range. — Same root cause and evidence as the first Blind Hunter row.
  - `[false]` `[reject]` Intent Alignment: the ledger hunk contradicts "Do NOT edit the deferred-work ledger". — Carried: the edit is the orchestrator's pre-existing change; this run's ledger blob equals the pre-run snapshot.
  - `[false]` `[reject]` Intent Alignment: no timeout ends in row 5, and the server-side COMMIT `statement_timeout` path is untested. — Carried: a wall-clock timer expiry is connection-level (AD-20, Story 2.3 AC9), so its absent-row outcome is row 7.
  - `[false]` `[reject]` Intent Alignment: the late-reply row 6 test goes beyond the literal "row 5 or row 7". — AD-20 maps a present row after a rejected COMMIT to row 6; the intent's "as AD-20 specifies" includes that outcome, and the row 7 test covers the absent case.
  - `[false]` `[reject]` Intent Alignment: update, publish, unpublish and the HTML worker are not covered by the new tests. — Carried: the changed lines are path-independent, and those probe paths already have tests.
  - `[low]` `[reject]` Intent Alignment: the I/O matrix assumes about 2300 ms while the test leaves the reserve plus 500 ms. — Carried: same as the matrix row above.
  - `[false]` `[reject]` Intent Alignment: "full probe bound" is checked as a range, not equality. — `boundedRead` derives `statement_timeout` from a `Deadline(boundMs)` after connection acquisition, so an exact 2000 ms is not observable; the range (above `COMMIT_PROBE_BOUND_MS - SET_LOCAL_FLOOR_MS`, at most `COMMIT_PROBE_BOUND_MS`) is the AC as written.

### 2026-10-04 — Follow-up review pass
- verdicts: 7 findings — high 0, medium 0, low 6, false 1, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind Hunter: this pass removes the prior Auto Run Result without a replacement in the staged diff. — The removal is real at review time; the Finalize step writes this pass's result below. Its fix edits this build's spec, so it is rejected as a review repair.
  - `[low]` `[reject]` Blind Hunter: the baseline excludes the two implementation commits, leaving no code or test change in this pass's diff. — Carried: `f74e992b7` and `d14b2c08e` precede `a5d069c32`; the earlier passes reviewed those commits and this pass verifies the committed code. Changing the baseline edits this build's spec.
  - `[low]` `[reject]` Blind Hunter: the I/O matrix says about 2300 ms and a 300 ms timer, while the test uses the reserve plus 500 ms. — Carried: the helper uses `COMMIT_PROBE_BOUND_MS + 500` consistently; correcting the prose edits this build's spec.
  - `[low]` `[reject]` Blind Hunter: the DW-26 ledger entry is done while the linked sprint row remains open. — Carried: the two records currently differ, but both are orchestrator-owned bookkeeping. The operator explicitly forbids changing either here, and neither proves verification.
  - `[low]` `[reject]` Blind Hunter: the Spec Change Log does not record the re-drive's baseline, status and intent-contract changes. — Carried: the gap is real, but the repair edits this build's spec; the run journal and commit `a5d069c32` provide the provenance.
  - `[low]` `[reject]` Intent Alignment: this diff shows documentation rather than the runtime change and DB-backed tests required by the feature reading. — Carried: the runtime change and tests are committed in `f74e992b7` and `d14b2c08e`, before this pass's baseline; the follow-up reading matches this pass. Changing the review range edits this build's spec.
  - `[false]` `[reject]` Intent Alignment: the ledger hunk in this diff means this build edited an orchestrator-owned entry. — The ledger change was staged before this run, and this run neither edited nor staged it. The diff alone does not identify its author; the working-tree evidence and the explicit ownership rule do.

## Auto Run Result

Status: done

- **Summary:** Follow-up review of the already committed DW-26 fix found no new implementation defect. The shared `runAttempt` reserves `COMMIT_PROBE_BOUND_MS` from COMMIT's timer, then gives the probe its full bound. The absent-row and landed-but-late COMMIT cases are covered by DB-backed tests.
- **Files changed in this pass:** this spec only, for the follow-up triage and result. The implementation and tests remain in `f74e992b7` and `d14b2c08e`: `server/wikiLint/application/enforcedWrite.ts` changes the P8 timer and probe bound; `server/wikiLint/application/enforcedWrite.concurrency.test.ts` covers both timeout outcomes. The orchestrator-owned ledger and sprint board were not edited or staged by this run.
- **Review findings:** 7 total: high 0, medium 0, low 6, false 1, maybe-false 0. Patched entries: high 0, medium 0, low 0. Deferred entries: 0. All findings were rejected for the reasons recorded in the triage log above: the missing result is supplied by this Finalize step; the moved baseline and the intent auditor's documentation-only observation describe a follow-up diff after the implementation commits; the matrix timing prose and empty Spec Change Log require edits to this build's spec; the board and ledger statuses are orchestrator bookkeeping; and the ledger hunk predates this run rather than showing a build edit.
- **Follow-up review recommendation:** `false`; this pass applied no patches.
- **Verification:** `scripts/test-db.sh ensure` reported `outline-test ready`. The four targeted Vitest files passed 202/202 tests. `corepack yarn tsc`, targeted `oxlint --type-aware`, targeted `oxfmt --check`, and `git diff --check` exited 0. `git fetch --prune` succeeded; HEAD was 78 commits ahead of and 0 behind its upstream before this spec finalization.
- **Residual risks:** The pre-existing 100 ms tolerance in the probe-start assertions could be sensitive to a heavily loaded CI. The I/O matrix's illustrative timing differs from the test helper's 500 ms timer. A slow final P7 `SET LOCAL` pair can leave a 0 ms COMMIT timer; the resulting outcome remains within the documented contract. The branch's unpushed commits are a portability gap for a fresh clone.

## Verification

**Commands:**
- `scripts/test-db.sh ensure` -- expected: test PostgreSQL ready
- `TZ=UTC corepack yarn vitest run server/wikiLint/application/enforcedWrite.concurrency.test.ts server/wikiLint/application/enforcedWrite.test.ts server/wikiLint/application/enforcedImport.test.ts server/wikiLint/adapters/writeTransaction.test.ts` -- expected: all pass
- `corepack yarn tsc`, `node_modules/.bin/oxlint --type-aware` and `node_modules/.bin/oxfmt --check` on the two changed files -- expected: exit 0
