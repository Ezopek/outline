---
title: 'DW-24/DW-31: HTML worker commit-detection rules (unavailable lookup is row 7; equality-gated probe row 6)'
type: 'bugfix'
created: '2026-10-04'
status: 'done'
baseline_revision: '533b5ebfa0305bfee6f38ba2018da20820d0981d'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/planning-artifacts/prds/prd-outline-2026-09-20/amendment-proposal-unavailable-probe-rule.md'
warnings: ['multiple-goals', 'oversized']
deferred:
  - summary: >-
      The spine's 2026-10-04 Amendment Record row still describes D2 as a match on a "recorded intent/source fingerprint", contradicting AD-7 and the amendment's resolved D2 (title and text equality).
    evidence: |-
      ARCHITECTURE-SPINE.md:434 says "the worker may report its own `validation` as row 6 after its commit-detection probe finds a row whose fingerprint equals its recorded intent/source fingerprint (AD-7)". AD-7 at :118 and amendment-proposal-unavailable-probe-rule.md D2 / Open Point 1 instead require the found row's title and `text` to equal the validated projection's. The implementation follows AD-7. The stale record row predates this change (commit 78f9c101f).
    location: >-
      _bmad-output/planning-artifacts/architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md:434
    severity: low
  - summary: >-
      The preallocated-ID conflict path can attribute a concurrent delivery's different row to this attempt without comparing its content.
    evidence: |-
      This path predates DW-24/DW-31: enforcedImport.ts captures ownConflict on isPreallocatedIdConflict during persist and case 5 returns this attempt's validation and writes its summary. If another delivery inserted a different row after the in-transaction absence check, the conflict branch does not compare title and text. D2 applies only to probe-established row 6, so this is separate work.
    location: >-
      server/wikiLint/application/enforcedImport.ts:805
    severity: medium
---

<intent-contract>

## Intent

**Problem:** The enforced HTML create maps a commit-detection lookup that cannot run to a failure. The worker's first lookup and the lookup in `finish()` treat `unavailable` as "absent", and the requester's probe falls through to rows 4, 2, or 3, so a possibly committed write can reach the client as a failure (retro F-1, DW-24). After its own rejected `commit()`, the worker also reports its own validation as row 6 whenever the probe finds the row, even when the row holds another delivery's projection (retro F-3, DW-31).

**Approach:** Implement amendment decisions D1 and D2, as applied to spine AD-7 and Story 2.5 AC3, AC4, AC6, and AC8 in `78f9c101f`. D1: an unavailable first lookup, `finish()` lookup, or requester probe is row 7. The worker throws `UnestablishedImportError`, writes no summary, and keeps the staged source. D2: a probe-established row 6 returns the worker's own validation only when the found row's `title` and `text` equal the validated projection's. Otherwise it resolves through `committedFromSummary` and writes no summary.

## Boundaries & Constraints

**Always:**
- Row 7 in the worker means throwing `UnestablishedImportError`. A D1 row 7 makes no committed or failed claim, writes no summary, and does not delete the staged source.
- D2 compares the found row with the projection this attempt persisted (`ProjectedDocument.title`/`.text`), read on a fresh connection under `COMMIT_PROBE_BOUND_MS` with the existing `boundedRead` helper. A read that cannot run, or finds no row, does not establish equality, so the attempt falls back to `committedFromSummary`.
- On a D2 mismatch, the attempt writes no summary of its own. It still discards its buffered callbacks (unchanged `callbacksAfterProbe: false`).
- The Markdown path (`enforceMarkdownCreate`/`enforceMarkdownUpdate`) keeps its behavior. It may ignore any new hook field.
- Tests stay collocated with the code they cover.

**Never:**
- D3 (the COMMIT timer reserve, `enforcedWrite.ts` `enforcement.commit(...)` bound): separate open work.
- No change to the in-transaction after-lock lookup (`reauthorize`). A failure there stays row 3 (AD-8).
- No cleanup owner for an orphaned retained source (an accepted residual).
- No edits to `deferred-work.md`, `sprint-status.yaml`, the spine, `epics.md`, or the PRD. The contract text is already applied.
- No upstream merge or rebase, no LLM, no semantic classification.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First lookup unavailable | worker's first `SELECT id FROM documents WHERE id = :id` fails | `runEnforcedImport` rejects with `UnestablishedImportError`; no transaction opened; no summary; source exists | row 7 (D1) |
| `finish()` lookup unavailable | attempt ends in row 2/3/4/5 (e.g. INVALID_HTML → row 4); the repeated lookup fails | rejects with `UnestablishedImportError`; no summary; source exists; no document | row 7 (D1) |
| Requester probe unavailable | worker result `rejected`/`conflict`/`aborted`; `probeImport` fails | outcome `{ row: 7 }`; no requester summary | row 7 (D1) |
| D2 equal | own COMMIT reached the server, then connection error; probe finds own row (WARNING_HTML) | `committed` with this attempt's own validation (non-empty `warnings`); own summary written; source deleted | row 6 |
| D2 unequal | as above, but before the probe the found row's `text` (or `title`) differs, and a committed summary with distinct `byCode` exists | `committed` built by `committedFromSummary` (status-only: `warnings: []`, System Failures from `byCode`); the attempt writes no summary; source deleted | row 6 via routine |
| D2 unequal, no committed summary | as above with no stored summary | rejects with `UnestablishedImportError` after the probe bound; source exists | row 7 |

</intent-contract>

## Code Map

- `server/wikiLint/application/enforcedImport.ts` -- the worker. First lookup at `:550-559` (`unavailable` → `finish(aborted 3)` today). `finish()` at `:517-531` checks only `=== "present"`. `persist` hook at `:711-720` (captures `ownConflict`; capture the projection the same way). `onCommitted` at `:737-739` writes the committed summary. `case 6` at `:744-751`. `committedFromSummary` at `:316-341`. The catch at `:775-780` rethrows `UnestablishedImportError`.
- `server/wikiLint/application/enforcedWrite.ts` -- `runAttempt` P8 at `:615-654`. When `commit.committed` is false and the probe finds the row, it discards callbacks for the worker and then calls `onCommitted({ document, validation })` (`:638-642`). `AttemptOptions.onCommitted` type at `:402-410`. The Markdown hook use at `:732` ignores extra fields.
- `server/wikiLint/adapters/writeTransaction.ts` -- `boundedRead` (`:425-461`, fresh connection, statement timeout, `unavailable` fallback), `probeCommit` (`:474-505`), `probeImport`, `readWriteSummary`. Add the title/text read next to them.
- `server/wikiLint/application/enforcedHtmlCreate.ts` -- requester probe at `:309-339`. `unavailable` falls through to `switch (result?.kind)`.
- `server/wikiLint/adapters/documentProjection.ts:19-41` -- `ProjectedDocument.title`, and `.text`, "the deprecated Markdown column, exactly as the writer sets it".
- `server/wikiLint/application/enforcedImport.test.ts` -- `:1155-1183` pins row 3 for an unavailable first lookup (rewrite to row 7). The "COMMIT outcomes" describe (`:1512-1604`) has `interceptQueries`, `destroySocket`, `socketError`, and `commitFixture` to reuse for D2. `expectCommitted`, `summaries`, `storeSummary`, `storedDocument`, and `WARNING_HTML`/`INVALID_HTML` are at the top of the file.
- `server/wikiLint/application/enforcedHtmlCreate.test.ts:673-730` -- "maps a %s result to its row when the probe is unavailable" pins rows 4/2/3 (rewrite to row 7).
- `server/wikiLint/application/enforcedWrite.test.ts:2046-2080` -- asserts the exact `onCommitted` payload (update it if the payload gains a field).

## Tasks & Acceptance

**Execution:**
- `server/wikiLint/adapters/writeTransaction.ts` -- add a bounded fresh-connection read of a document's `title` and `text` through `boundedRead`. It returns `undefined` when the row is absent or the read is unavailable. -- D2 needs the found row's content without a new connection pattern.
- `server/wikiLint/adapters/writeTransaction.test.ts` -- cover the new read: a stored row returns its title and text; an absent row, or a bound below `SET_LOCAL_FLOOR_MS`, returns `undefined`. -- Pins the adapter's contract.
- `server/wikiLint/application/enforcedWrite.ts` -- add `probed: boolean` to the `onCommitted` payload: true when only the commit probe established the commit (`!commit.committed`). Document it. -- This is the worker's only signal that the row was probe-found.
- `server/wikiLint/application/enforcedImport.ts` -- D1: throw `UnestablishedImportError` when the first lookup or `finish()`'s lookup is `unavailable`, before any summary or deletion. D2: capture the persisted projection. In `onCommitted`, when `probed`, read the found row and, unless its title and text equal the projection's, mark the attempt and skip its summary. In `case 6`, a marked attempt returns `committedFromSummary(intent)`, deleting the source only once that resolves (a throw keeps it, per the matrix). Update the doc comments of `finish` and `runEnforcedImport`. -- Spine AD-7 HTML worker paragraphs.
- `server/wikiLint/application/enforcedHtmlCreate.ts` -- return `{ row: 7 }` when `probeImport` is `unavailable`. Update the doc comment. -- Story 2.5 AC3.
- `server/wikiLint/application/enforcedImport.test.ts` -- rewrite the `:1155` test to expect `UnestablishedImportError`, no summary, a retained source, and no transaction. Add: an unavailable `finish()` lookup (only the second documents lookup fails) → row 7, no summary, source retained, no document. Add the D2 equal case (own validation with warnings, own summary). Add the D2 unequal case (row text or title changed before the probe, plus a stored committed summary → status-only result with no own summary written; the `write` spy is not called). Add the D2 unequal case with no summary → `UnestablishedImportError`. -- The I/O matrix.
- `server/wikiLint/application/enforcedHtmlCreate.test.ts` -- rewrite the unavailable-probe test so all three result kinds report `{ row: 7 }`. -- D1 requester.
- `server/wikiLint/application/enforcedWrite.test.ts` -- update the exact `onCommitted` payload expectation (`probed: false`). Add a `probed: true` assertion where an existing probe-found Markdown fixture makes it cheap. -- Keeps the hook contract pinned.

**Acceptance Criteria:**
- Given any HTML worker commit-detection lookup that cannot run (first or before a non-committed outcome), when the worker runs, then the job throws (the requester sees no result), no `wikiLint.write_validation` Event exists for the invocation, and the staged source still exists.
- Given a requester whose single probe cannot run, when the worker result is `rejected`, `conflict`, or `aborted`, then the outcome is row 7 and the requester writes no summary.
- Given a probe-established commit, when the found row's title and text equal the persisted projection's, then the result is the attempt's own validation (Findings preserved); otherwise the result is `committedFromSummary`'s (or row 7), and this attempt wrote no summary.
- Given the Markdown path and the HTML worker paths whose COMMIT resolved, when the targeted suites run, then their behavior is unchanged.

## Spec Change Log

## Review Triage Log

### 2026-10-04 — Review pass
- verdicts: 28 findings — high 0, medium 3, low 13, false 12, maybe-false 0
- findings:
  - `[low]` `[reject]` (blind) The row-7 throws log no reason, and the retained source has no locator. — A rare operator-diagnostics gap. `UnestablishedImportError` already carried no reason before this change. The fix adds logging that must stay within AC2's no-props log rule, which is more than a direct correction.
  - `[medium]` `[patch]` (blind) No worker test covers the D2 fallback when the content read cannot run. — Grouped with the verification-gap finding. Added "resolves through the committed summary, writing none, when the probe-found row's content read fails" (rejects `CONTENT_READ`; status-only result, `write` not called, one summary, source deleted). The implementer confirmed it fails when an unavailable read is treated as equal.
  - `[low]` `[reject]` (blind) The `readDocumentContent` tests skip the read-failure and stall cases. — Failure and expiry handling lives in the shared `boundedRead`, which `probeCommit`'s tests pin. The new worker test also drives a rejected content read. Adding more adapter tests is test bloat for an unlikely regression.
  - `[false]` `[reject]` (blind) The second D1 test does not prove row 4, and the other `finish()` callers are untested. — The throw sits inside `finish()` whatever the caller. Any regression of that branch fails this test (`lookups === 2`). The outer catch's `return finish(...)` needs no handling for the throw to propagate.
  - `[low]` `[reject]` (blind) The D2 read has no time budget. The summary can land after `deadlineAt`, and the requester then reports row 7. — This needs a commit rejection, a probe that finds the row, and admission near the 12 s floor all at once. The outcome is the contract's safe row 7. Capping the read would push it below the floor and produce the same row 7, and widening the `admitPersist` reserve would contradict AD-7. The post-commit tail is already tracked as F-8 (Story 3.3), and Design Notes records the extra read.
  - `[low]` `[patch]` (blind) The `probedOther` comment says "differs", but the flag is also set when the read fails. — Reworded to "was not confirmed as this attempt's own: its title and text were not shown equal…".
  - `[false]` `[reject]` (blind) The `probed` doc says "by finding the row", which is wrong for Markdown updates that probe an Event. — `probeCommit`'s own doc calls both targets "the row an attempt wrote", and an Event is a row.
  - `[false]` `[reject]` (blind) `breakAfterCommit` duplicates an older test's inline interceptor. — No named harm: the older test is correct on its own, and a refactor would only widen the diff.
  - `[low]` `[patch]` (blind) The magic `1500` lower bound in the new no-summary D2 test would also pass for a much shorter polling window. — Now `COMMIT_PROBE_BOUND_MS - 2 * SET_LOCAL_FLOOR_MS` (1800 ms). The pre-existing `1500` in "found rows" is outside this diff and left as is.
  - `[low]` `[reject]` (blind) A redelivery with identical content counts another delivery's row as this attempt's own. — The intent's D2 rule explicitly allows own validation when title and text are equal. This is decided behaviour, not a defect.
  - `[low]` `[defer]` (blind) The spine Amendment Record row (`ARCHITECTURE-SPINE.md:434`) still describes D2 as a fingerprint match. — Confirmed stale. It predates this change (78f9c101f), and the binding rule at `:118` matches the code. Recorded in `deferred`.
  - `[low]` `[reject]` (edge) A probe-found commit admitted with only 12 s left: the 2 s content read can push the summary past `deadlineAt`. — Same root cause as the blind time-budget finding; rejected on the same grounds.
  - `[low]` `[reject]` (edge) A concurrent media-free redelivery with identical title and text is treated as this attempt's own. — Same as the blind redelivery finding: D2's equality rule defines this outcome. The suggested `createdAt` comparison contradicts D2's title/text rule.
  - `[low]` `[reject]` (edge) If the content read fails on the attempt's own row, the result is row 7 and no summary is written. — This is the contract's row 7, and AC5 / Story 2.7 AC1 accept the evidence gap. Writing a summary when ownership is unconfirmed would reopen F-3. Rare, and the fix adds a branch.
  - `[low]` `[reject]` (edge) The own row is edited or deleted between the probe and the content read. — The window is milliseconds on a just-created document whose callbacks were discarded. The suggested comparison on immutable columns contradicts D2.
  - `[low]` `[reject]` (edge) The staged source is never deleted after `UnestablishedImportError` (`attempts: 1`, no `onFailed`). — The intent's D1 requires keeping the source and names the orphan as an accepted residual with no cleanup owner.
  - `[medium]` `[patch]` (verification-gap) D2 has no test for a content read that cannot run or finds no row. — Grouped with the blind test-gap finding; the same test was added.
  - `[false]` `[reject]` (intent) No D1 worker test runs a throw through the requester, the task, or the handler. — A worker throw reaches the requester as a `finished()` rejection. The existing "no result" requester tests pin that path, and the throw itself is tested directly.
  - `[false]` `[reject]` (intent) Only the row-4 route of the `finish()` lookup is tested. — Same as the blind second-D1-test finding: the branch does not depend on the caller.
  - `[false]` `[reject]` (intent) The requester's "cannot be bounded" (expiry) case is untested. — The requester branches on the value `unavailable`, which both failure and expiry produce through the shared `boundedRead`, whose stall case `probeCommit`'s test pins.
  - `[false]` `[reject]` (intent) The D2 signal sits on the shared hook, and the Markdown path only pins the payload. — No bad outcome: the Markdown path ignores `probed`, and its tests pass with the payload pinned both ways.
  - `[false]` `[reject]` (intent) "Validated projection" is read as `ProjectedDocument.title`/`.text`. — This matches the contract: `.text` is the stored Markdown column, exactly as the writer sets it.
  - `[false]` `[reject]` (intent) The unequal test changes the attempt's own row instead of inserting a real second delivery. — The code under test cannot tell the two apart: both present a found row whose title or text differ.
  - `[medium]` `[patch]` (intent) A failing D2 read is untested. — Grouped with the blind and verification-gap test-gap findings; the same test was added.
  - `[low]` `[reject]` (intent) The timing budget is not checked against `deadlineAt` or AC7. — Same root cause as the blind time-budget finding; rejected on the same grounds.
  - `[false]` `[reject]` (intent) The diff touches `enforcedWrite.ts` and `writeTransaction.ts` beyond the two files the intent names. — The intent does not limit file scope, and both are the minimal supporting seams.
  - `[false]` `[reject]` (intent) The bundle spec is staged but not in the reviewed diff. — Deliberate: the spec is the edge-case layer's claims file and is kept out of the diff.
  - `[false]` `[reject]` (intent) The change is not artifact-only. — Correct, and nothing claims otherwise: no artifact-only receipt is asserted.

### 2026-10-04 — Follow-up review pass
- verdicts: 8 findings — high 0, medium 1, low 3, false 4, maybe-false 0
- findings:
  - `[medium]` `[defer]` (blind) The preallocated-ID conflict path returns this attempt's validation without comparing a competing row. — Verified at `enforcedImport.ts:805-810`; the same path exists at the baseline revision. D2 expressly addresses probe-established row 6, while this is the earlier persist-conflict row 5. Recorded in `deferred`.
  - `[low]` `[reject]` (blind) A rejected `onCommitted` comparison could leave `probedOther` false and return the attempt's validation. — `runAttempt` swallows hook rejection, but the new read's query, acquisition, absence, and expiry failures all become `undefined` through `boundedRead` and then set `probedOther`. No ordinary throwing path was demonstrated; adding a second state guard for an unexpected helper failure is more than a direct correction.
  - `[false]` `[reject]` (blind) Separate existence and content transactions can attribute a row using a different snapshot. — D2 defines ownership by the title and text read after the existence probe; a missing row fails closed. A row with identical content from another delivery is accepted by the explicit D2 equality rule, regardless of transaction snapshots.
  - `[false]` `[reject]` (blind) The tests need two competing deliveries to cover the unequal-content collision. — Carried: the existing unequal-content tests make the probe see the same differing title or text a competing delivery would expose; the preallocated-ID conflict is a separate, pre-existing row-5 path.
  - `[false]` `[reject]` (blind) A row disappearing between probe and content read has no test. — Carried: `readDocumentContent` returns `undefined` for absence, and the worker's failing-read test drives the same `undefined` fallback through `committedFromSummary`.
  - `[low]` `[reject]` (blind) The new content read needs its own stalled-acquisition test. — Carried: it uses the same `boundedRead` helper whose stalled-acquisition bound is pinned by `probeCommit`; adding another adapter test would duplicate that deadline path.
  - `[low]` `[reject]` (edge) A sibling delivery with identical title and text can receive this attempt's validation. — Carried: the prior pass verified this exact behavior against D2, which explicitly accepts title/text equality as the ownership condition.
  - `[false]` `[reject]` (intent) The client-facing problem statement might require success rather than an MCP error for uncertain commits. — The intent's precise D1 contract requires worker row 7 and requester `{ row: 7 }`; `enforcedHtmlResult` maps that row through the existing MCP error path. The change implements the stated outer outcome without claiming a failed commit.

## Design Notes

The worker learns of a probe-found row only through the hook payload. `runAttempt` still runs `onCommitted` and returns row 6, because the commit is established either way. Only the worker decides whose row it is. The equality read runs inside the awaited `onCommitted`, before the summary would start, so a mismatched attempt never writes a summary that `committedFromSummary` could then read back as its own:

```ts
onCommitted: async ({ validation, probed }) => {
  if (probed && !(await sameAsPersisted())) { probedOther = true; return; }
  committedSummary = summarize(decidedSummary(validation, rules), true);
},
```

The extra read lengthens only the rare probe-found tail, by up to `COMMIT_PROBE_BOUND_MS`. The existing post-commit tail overrun is tracked as F-8 (Story 3.3).

To test the unequal case, reuse the "socket error after a real COMMIT" interceptor. After the real `COMMIT;` resolves, change the stored row (`UPDATE documents SET text = ...` on a fresh query outside the destroyed transaction) and store a committed summary, then destroy the socket and throw.

## Verification

**Commands:**
- `scripts/test-db.sh ensure` -- expected: the test database is ready.
- `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint/application/enforcedImport.test.ts server/wikiLint/application/enforcedHtmlCreate.test.ts server/wikiLint/application/enforcedWrite.test.ts server/wikiLint/adapters/writeTransaction.test.ts` -- expected: every test passes.
- `corepack yarn tsc`, `node_modules/.bin/oxlint --type-aware` and `node_modules/.bin/oxfmt --check` on the changed files -- expected: exit 0.

## Auto Run Result

Status: done

**Summary:** The committed DW-24/DW-31 change implements D1 row 7 for unavailable worker and requester commit-detection lookups, and D2 title/text equality before a probe-established row 6 uses this attempt's validation. This follow-up pass made no code change.

**Files changed since `533b5ebfa0305bfee6f38ba2018da20820d0981d`:**
- `server/wikiLint/adapters/writeTransaction.ts` and `server/wikiLint/adapters/writeTransaction.test.ts` — bounded fresh-connection content read and its adapter checks.
- `server/wikiLint/application/enforcedWrite.ts` and `server/wikiLint/application/enforcedWrite.test.ts` — `probed` hook signal and payload checks.
- `server/wikiLint/application/enforcedImport.ts` and `server/wikiLint/application/enforcedImport.test.ts` — D1/D2 worker behavior and regression cases.
- `server/wikiLint/application/enforcedHtmlCreate.ts` and `server/wikiLint/application/enforcedHtmlCreate.test.ts` — requester row 7 mapping and cases.
- This spec — follow-up triage, one additional deferred risk, and this result.

**Follow-up review:** 8 findings: 0 patches, 1 medium deferred, 3 low rejected, and 4 false rejected. Each rejection and its reason is recorded in the Follow-up review pass triage rows above. Patched counts: high 0, medium 0, low 0. `followup_review_recommended: false`.

**Verification:** `scripts/test-db.sh ensure` reported `outline-test ready`; the four targeted Vitest files passed (219 tests); `corepack yarn tsc`, `oxlint --type-aware`, and `oxfmt --check` on the eight changed TypeScript files exited 0.

**Residual risks:** The pre-existing row-5 preallocated-ID conflict can misattribute a different delivery's row (recorded in `deferred`). The spine Amendment Record still has its previously noted stale D2 wording. The accepted D2 identical-content ambiguity, retained-source orphan, and post-commit tail bound remain as described in Design Notes and the prior result.
