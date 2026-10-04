---
title: 'DW-28: Test worker row 2/4/5 conversions and HTML-with-media failure rows and summaries'
type: 'chore'
created: '2026-10-04'
baseline_revision: 086b7f82ea41c31b483a58b07783915f2a536b5b
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      The worker's found-row conversion is still untested on the finish() routes outside runAttempt's own row arms: the pre-attempt conflict and worker-time fingerprint mismatch (`finish(...pending)`) and the outer catch (`finish(...failure)`, row 5 once `decided`).
    evidence: |-
      `server/wikiLint/application/enforcedImport.ts:656` (`finish(...pending)` for the reauthorization conflict at :623-624 and the mismatch rejection at :633-638) and `:832` (`finish(...failure)`, `aborted(decided ? 5 : 3, ...)`). No test makes the pre-allocated row appear before either call: the row 3 test and the DW-28 row 2/4/5 tests reach `finish` only through `switch (outcome.row)` at :789-825. Replacing those calls with a direct `return` of the non-committed outcome keeps every test green. Spine :120 requires the lookup before every non-committed outcome (rows 2, 3, 4, 5). DW-28's intent counts coverage per row (it called row 3 covered by one route), so this is the pre-existing remainder of the same gap class, raised by the Blind Hunter, Edge Case Hunter and Intent Alignment layers.
    location: >-
      server/wikiLint/application/enforcedImport.ts:656, server/wikiLint/application/enforcedImport.ts:832
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Epic 2 retro F-12 found two verification gaps. (a) The HTML worker's `finish` converts a non-committed outcome to `committedFromSummary` when the pre-allocated row appears mid-attempt, but only row 3 is tested (`enforcedImport.test.ts:1360-1400`); rows 2, 4 and 5 are not. (b) The HTML-with-media failure tables assert only `result.kind` (`enforcedImport.test.ts:2033-2107`, "deletes every staged blob on $name") or `isError` / `expectRejected` (`documents.enforcedMedia.test.ts:908-982`, "leaves no effect and deletes every staged blob on $name"). Neither checks the AD-20 row or the stored write-validation summary.

**Approach:** Tests only. (a) Add one parametrized test in "found rows". The row appears, with a committed summary, right after the attempt's after-lock lookup finds nothing. The attempt then ends in row 2, 4 or 5, and the worker returns the stored summary's status without writing its own. (b) In both cited tables, add each case's expected AD-20 row and summary outcome, and assert them.

## Boundaries & Constraints

**Always:**
- Follow each file's idioms: `interceptQueries`, `AFTER_LOCK_LOOKUP`, `storeSummary` / `summaryData` / `summaries` (worker file); `recordIntents`, `summariesOf` (MCP file). The row appears in another collection, as in the existing found-row tests, so it never waits on the AD-8 collection lock.
- The row 2/4/5 test proves the attempt really ended in that row. It checks the settled result of the attempt, captured through a pass-through `vi.fn` wrapper of `runAttempt`; the file already wraps `attachmentCreator` this way. A conversion reached through a different row (say, row 3) must fail the test.
- Keep every existing assertion of the two tables.
- A modified `deferred-work.md` belongs to the orchestrator's pending ledger transaction, not to this bundle. It does not fail the clean-tree gate. Never stage, edit, revert or commit it.

**Never:**
- No production change (`server/wikiLint/**` non-test files, `server/tools/documents.ts`, queue code).
- Do not create new test files or directories. Do not edit the ledger or the sprint board.
- Do not widen (b) beyond the two cited tables. Sibling tests whose subject is something else stay as they are: storage-call order, cleanup logging, mismatch staging, the row 7 blob retention, and the parent-move `collection_conflict` response.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Row 2 converted | Parent of the create moves to another collection after the after-lock lookup; the row and a `validated` summary appear then | Attempt settles `{ row: 2 }`; result is `committed` with `status: "validated"` and empty arrays; `write` never called; the one stored summary still equals `summaryData(intent, { outcome: "validated" })`; source deleted | none |
| Row 4 converted | `INVALID_HTML`; row and summary appear after the after-lock lookup | Attempt settles `{ row: 4 }`; same committed result and summary checks | none |
| Row 5 converted | `deadlineAt` about 11 s ahead (the persist gate refuses); row and summary appear after the after-lock lookup | Attempt settles `{ row: 5 }`; same committed result and summary checks | none |
| Worker media failure | The four existing cases | Parent moved: `{ kind: "conflict" }`, no summary. Missing section: `rejected` with `REQUIRED_SECTION_MISSING`, summary `rejected`. Failed Attachment insert and refused persist gate: `{ kind: "aborted", row: 5, message: OPERATION_FAILED }`, summary `aborted_after_decision`. Every summary has `documentId` null | Existing blob/row checks unchanged |
| MCP media failure | The four existing cases | Job result: `rejected` (row 4) for the rejection; `{ kind: "aborted", row: 5, message: OPERATION_FAILED }` for both failed materializations and the server-reported COMMIT error. `summariesOf` is exactly one summary, `{ outcome: "rejected" \| "aborted_after_decision", documentId: null }` | Existing response checks unchanged |

</intent-contract>

## Code Map

- `server/wikiLint/application/enforcedImport.ts:552-570` -- `finish`: a `present` lookup returns `committedFromSummary` and skips `summarize`. `:805-820` routes outcome rows 5, 4, 3 and 2 into it; `:684` is the `runAttempt` call. Read-only.
- `server/wikiLint/application/enforcedWrite.ts:529-596` -- P3 `reauthorize` (row 2 at `:535-538`), the P6 rejection (row 4 at `:587-590`), and the refused `admitPersist` (row 5 at `:591-597`). Read-only.
- `server/wikiLint/application/enforcedImport.test.ts:75-86` -- `vi.mock` pass-through pattern (`deadline`, `attachmentCreator`). `:34-52` -- imports. `:329-373` -- `summaryData`, `storeSummary`. `:289-300` -- `summaries`. `:386-406` -- `interceptQueries`, `AFTER_LOCK_LOOKUP`. `:939-971` -- the P3 parent move. `:1089-1111` -- the persist gate (`deadlineAt: Date.now() + 11000`). `:1360-1400` -- the row 3 conversion test the new test sits next to. `:2033-2107` -- table (b).
- `server/tools/documents.enforcedMedia.test.ts:179-199` -- `recordIntents`; the job runs `this.perform(props)`, so a spy on `EnforcedDocumentImportTask.prototype.perform` observes the job result. `:524-534` -- `summariesOf`. `:631-688` -- the Markdown-update table already asserting `summary`, the pattern to mirror. `:908-982` -- table (b).
- `_bmad-output/planning-artifacts/architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md:120` (found-row conversion writes no summary) and the AD-20 row table (`:335-343`). Read-only evidence for the expected rows and summary outcomes.

## Tasks & Acceptance

**Execution:**
- `server/wikiLint/application/enforcedImport.test.ts` -- wrap `runAttempt` in a pass-through `vi.fn` via `vi.mock("@server/wikiLint/application/enforcedWrite", …)` and import it. In "found rows", add an `it.each` over rows 2, 4 and 5 implementing matrix rows 1-3, clearing the wrapper first. In "staged media", replace each case's `kind` with its expected result and summary outcome, and assert both. -- Closes F-12 (a) and the worker half of (b).
- `server/tools/documents.enforcedMedia.test.ts` -- add each case's expected job result and summary outcome to the HTML-create table. Spy on `EnforcedDocumentImportTask.prototype.perform`, and assert the settled job result and `summariesOf(user.teamId)`. -- Closes the MCP half of F-12 (b).

**Acceptance Criteria:**
- Given the new row 2/4/5 tests, when `finish`'s found-row branch is replaced by its non-committed path (for example, the `present` branch removed), then all three fail.
- Given the strengthened tables, when a case's worker row or summary outcome differs from the matrix, then that case fails.
- Given the test database, when both changed files run, then every test passes. Formatting, lint and type-check of the changed files are also clean.

## Spec Change Log

## Review Triage Log

### 2026-10-04 — Review pass
- verdicts: 16 findings — high 0, medium 3, low 3, false 10, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind Hunter: the row 2/4/5 test's `summary.data` equality can never fail, because `insertAuditEvent` never replaces a stored `validated` summary (`auditEvents.ts:122-126`); the Design Note's overwrite reasoning is wrong. — Real: the `write` spy (`expect(write).not.toHaveBeenCalled()`) is the actual no-own-summary guard. The equality check itself is mandated by the intent-contract matrix ("the one stored summary still equals `summaryData(...)`"), so deleting it would depart from the contract, and correcting the note edits this build's spec.
  - `[false]` `[reject]` Blind Hunter: both tables reduce the summary to `{ outcome, documentId }`, so a rejected summary with wrong counts, `complete`, `requestId` or auth fields would pass. — The suite catches that regression: the same `decidedSummary` → `summarize` path is asserted field by field at `enforcedImport.test.ts:787-799` (rejected counts by code) and `:713-729` (full data), and aborted fields at `:835-841`. Media does not change summary assembly; the AD-20 summary column is `outcome`.
  - `[low]` `[reject]` Blind Hunter: the MCP table's `summariesOf(user.teamId)` is not keyed to the invocation ID, and `const [intent] = intents` is not length-checked. — The ID gap is real but needs a regression that writes the worker summary under another Event ID; the fixture makes a fresh team per test, and `writeAuditRow` keys on `invocationId`. Closing it means changing the shared `summariesOf` helper. The length part is false: the new `perform.mock.settledResults` match is a one-element array, so exactly one job ran, and the destructuring predates this diff.
  - `[false]` `[reject]` Blind Hunter: the worker media table infers the row from the result; `{ kind: "aborted", row: 5 }` can come from the `case 5` arm or the outer catch. — The AD-20 row of a worker job is its contract result: `conflict` is row 2, `rejected` is row 4, and `aborted` carries its row (spine :122). Both paths that produce `row: 5` are AD-20 row 5, so asserting the result asserts the row; the `runAttempt` wrapper is needed only where the result (`committed`) hides the row.
  - `[medium]` `[defer]` Blind Hunter: the conversion through `finish(...failure)` (`enforcedImport.ts:832`) is untested. — Verified; grouped with the Edge Case Hunter and Intent Alignment rows below as one pre-existing gap (finish routes outside the attempt's row arms). The intent counts coverage per row, so it is deferred to the frontmatter `deferred` list.
  - `[false]` `[reject]` Blind Hunter: the Acceptance Criteria are mutation claims, but Verification runs no mutation. — The evidence exists: this run removed `finish`'s `present` branch, and the row 2, 4, 5 and existing row 3 tests all failed; the production file was restored with no diff (Auto Run Result). Adding a mutation step would edit this build's spec.
  - `[low]` `[reject]` Blind Hunter: `deadlineAt: Date.now() + 11000` now appears three times instead of being derived from `WRITE_PERSISTENCE_BUDGET_MS + AUDIT_WRITE_BOUND_MS`. — Real duplication, but two copies predate this diff. A changed constant makes those cases commit, so they fail loudly rather than pass wrongly. A coherent fix would rewrite the pre-existing tests too.
  - `[medium]` `[defer]` Edge Case Hunter: no test covers a found row converted through the pre-attempt `finish(...pending)` (`enforcedImport.ts:656`) or the outer-catch `finish(...failure)` (`:832`). — Verified: routing either call around `finish` keeps every test green. Same root cause as the Blind Hunter row above; deferred as one entry.
  - `[medium]` `[defer]` Intent Alignment: only the attempt's own row 2/4/5 outcomes are covered, not the other `finish()` routes (reading A2). — Same deferred entry. The intent judges coverage per row ("Today only row 3 is covered" refers to one route), which this diff meets for rows 2, 4 and 5.
  - `[false]` `[reject]` Intent Alignment: the row "appears" as a fabricated document in another collection plus a seeded summary. — This is the existing found-row idiom (`enforcedImport.test.ts:1370-1410`, `:2091-2121`). `finish` reads only the pre-allocated ID and the summary, and another collection avoids waiting on the AD-8 lock.
  - `[false]` `[reject]` Intent Alignment: the worker media table asserts the row through the result type and leaves the `runAttempt` wrapper unused. — Same refutation as the Blind Hunter row on inferred rows: the job result is the AD-20 row.
  - `[false]` `[reject]` Intent Alignment: the MCP table asserts the row through the job result, below the MCP response surface. — The response assertions are kept exactly (`expectToolError`, `expectRejected`). Rows 3, 5 and 7 share one response by contract, and the AD-20 table defines a row by its response and its summary outcome, which the table now asserts together.
  - `[false]` `[reject]` Intent Alignment: the stored summary is checked as outcome and `documentId` only; rejected counts are unchecked. — Same refutation as the Blind Hunter row on summary depth.
  - `[false]` `[reject]` Intent Alignment: under the broad reading, sibling HTML-with-media tests still assert no summary. — The intent paraphrases retro F-12(b), whose referents are the two cited ranges. Each sibling's row and summary pair is asserted elsewhere. Mismatch: `:900-915`. Preparation-expiry row 3: `:1092-1093`. Row 5: `:1144-1145` and the strengthened table. P3 conflict: the strengthened table. Row 7 has no summary: `:1886`. Rejected media: both strengthened tables.
  - `[false]` `[reject]` Intent Alignment: the intent's `:1323` line reference is stale. — It is a reference in the intent, not a defect in the diff; the auditor notes it affects nothing.
  - `[false]` `[reject]` Intent Alignment: the artifact-only receipt does not apply. — An observation, not a defect: the diff changes tracked test files, so the receipt is not asserted.

### 2026-10-04 — Follow-up review pass
- verdicts: 13 findings — high 0, medium 6, low 2, false 5, maybe-false 0
- findings:
  - `[medium]` `[defer]` Blind Hunter: the pre-attempt `finish(...pending)` found-row conversion is untested. — Carried from the prior Blind Hunter and Edge Case Hunter rows: `enforcedImport.ts:656` still reaches `finish` outside `runAttempt`; the existing frontmatter deferred item records this route.
  - `[medium]` `[defer]` Blind Hunter: the outer-catch `finish(...failure)` found-row conversion is untested. — Carried from the prior Blind Hunter and Edge Case Hunter rows: `enforcedImport.ts:832` still reaches `finish` outside the outcome switch; the same deferred item records this route.
  - `[false]` `[reject]` Blind Hunter: late found-row conversion needs a missing or noncommitted summary case. — The intent specifies a committed summary for these three new scenarios; existing found-row tests at `enforcedImport.test.ts:1345-1365` and `:1847-1881` cover absent or noncommitted summaries and retained source on a failed resolution.
  - `[low]` `[reject]` Blind Hunter: the MCP media summary is counted by team, not tied to the invocation ID. — Carried from the prior Blind Hunter row: a fresh team is created per table case, the job spy shows one settled run, and closing the ID-specific gap requires changing the shared `summariesOf` helper.
  - `[medium]` `[patch]` Blind Hunter: the worker media conflict case's `toMatchObject` accepts an unexpected `validation` field. — AD-20 row 2 explicitly has no validation. Added a conflict-only `not.toHaveProperty("validation")` assertion in the cited table; targeted tests, type-check, lint and format pass.
  - `[false]` `[reject]` Blind Hunter: the converted attempt may alter the found document without detection. — Rows 2, 4 and 5 in `runAttempt` exit before persistence, and `finish` only probes, reads the summary and deletes the staged source; no reachable write to the found document was shown.
  - `[medium]` `[defer]` Edge Case Hunter: pre-attempt reauthorization can reach `finish(...pending)` without a found-row conversion test. — Carried from the prior Edge Case Hunter row and covered by the existing deferred item; the code path remains at `enforcedImport.ts:656`.
  - `[medium]` `[defer]` Edge Case Hunter: the outer catch can reach `finish(...failure)` without a found-row conversion test. — Carried from the prior Edge Case Hunter row and covered by the existing deferred item; the code path remains at `enforcedImport.ts:832`.
  - `[low]` `[reject]` Edge Case Hunter: a summary under a different invocation ID could satisfy the MCP team's summary assertion. — Carried from the prior Blind Hunter row; the fresh-team fixture limits exposure, and the fix would change a shared helper.
  - `[medium]` `[defer]` Intent Alignment: the broader reading of `finish` includes routes outside `runAttempt`'s outcome switch. — Carried from the prior Intent Alignment row; the same two pre-existing routes are in the deferred item.
  - `[false]` `[reject]` Intent Alignment: the tables infer AD-20 rows from worker results instead of reading a separate row record. — Carried from the prior Intent Alignment row: the AD-7 worker result defines `conflict` as row 2, `rejected` as row 4, and `aborted.row` as row 5; the returned job result is the contract surface.
  - `[false]` `[reject]` Intent Alignment: the media tables inspect only summary outcome and document ID. — Carried from the prior Intent Alignment row: the AD-20 summary column is outcome, and the shared summary assembly fields are asserted at `enforcedImport.test.ts:713-729`, `:787-799` and `:835-841`.
  - `[false]` `[reject]` Intent Alignment: the MCP table observes the job through a `perform` spy. — Carried from the prior Intent Alignment row: the existing public response assertions remain, while several AD-20 rows share that response and require the job result to distinguish them.

## Design Notes

The row-2 parent exists only in that case. The after-lock handler runs `next()` first, then the case's step, then the row-and-summary insert. A row that appeared before the lookup would make the attempt row 3; that is the existing test. The seeded summary uses `credentialAuthType: "api"`, while the worker would write `"oauth"`. So comparing it with `summaryData(...)` shows that the worker overwrote nothing.

## Verification

**Commands:**
- `scripts/test-db.sh ensure` -- expected: database ready.
- `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint/application/enforcedImport.test.ts server/tools/documents.enforcedMedia.test.ts` -- expected: every test passes.
- `corepack yarn tsc`, `node_modules/.bin/oxlint --type-aware` and `node_modules/.bin/oxfmt --check` on the changed files -- expected: exit 0.

## Auto Run Result

Status: done

**Summary:** The DW-28 tests cover found-row conversion after attempt rows 2, 4 and 5, and assert the AD-20 result and stored summary outcomes in the two HTML-with-media failure tables. This follow-up review added one assertion that a row-2 conflict does not expose `validation`.

**Files changed:**
- `server/wikiLint/application/enforcedImport.test.ts` — pass-through `runAttempt` spy, row 2/4/5 conversion cases, worker media result and summary checks, and the conflict-only no-validation assertion.
- `server/tools/documents.enforcedMedia.test.ts` — job result and stored summary checks in the HTML-create media failure table.
- `_bmad-output/implementation-artifacts/spec-dw-28-html-worker-conversion-tests.md` — follow-up triage and verified result.

**Review findings:** 13 findings across four layers; Verification Gap reported none. One medium patch was applied. No new deferred entry was added; five medium findings repeat the two routes already recorded in the existing deferred item. Rejected findings: the absent or noncommitted summary scenario is outside the stated committed-summary cases and is already tested elsewhere; the wrong-invocation summary concern was previously graded low because its fix changes a shared helper and each case uses a fresh team; the claimed found-document mutation has no write path in these outcomes; the AD-20 row inference follows the worker result contract; the summary field depth is covered by existing shared-assembly tests; and the MCP job spy supplements preserved public response checks.

**Follow-up review recommended:** false. This pass patched high 0, medium 1, low 0; a follow-up pass requires a patched high finding.

**Verification:** `scripts/test-db.sh ensure` reported `outline-test ready`. The two-file Vitest run passed 101/101 after the patch. `corepack yarn tsc`, type-aware `oxlint`, `oxfmt --check` on both changed test files, and `git diff --check` all exited 0.

**Residual risks:** The existing deferred item covers found-row conversion through pre-attempt `finish(...pending)` and outer-catch `finish(...failure)`. The row-5 tests use an approximately 11-second deadline, like existing persist-gate tests, and will need adjustment if the configured persistence and audit budgets change.
