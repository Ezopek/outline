---
title: 'DW-27: Delete the media blob when Attachment validation fails'
type: 'bugfix'
created: '2026-10-04'
baseline_revision: 33bf67d4caacb2539b9b08c1cbf7d38762b15b7f
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      LocalStorage.deleteFile hides unlink failures from MediaStager and logs the full path on failure.
    evidence: |-
      LocalStorage.ts catches unlink errors, logs the file path and error, then resolves. MediaStager's deleteLate therefore cannot report that failure by Attachment ID. This adapter behavior predates DW-27 and also affects existing staged-media cleanup and late-landing deletion.
    location: >-
      server/storage/files/LocalStorage.ts:92
    severity: medium
---

<intent-contract>

## Intent

**Problem:** In `MediaStager.stageOne` (`server/wikiLint/adapters/mediaStaging.ts:394-448`), `storeFromUrl` writes the blob at its final key and the key goes into `owned` (`:407`). When `Attachment.build(...).validate()` then refuses the row values (`:438-446`), the method returns `undefined` but keeps the key in `owned`. `runAttempt` calls `media.cleanup()` only for AD-20 rows 2-5 (`server/wikiLint/application/enforcedWrite.ts:463-465`), so on a committed row 6 the blob leaks with no owner (Epic 2 retro F-7b, DW-27).

**Approach:** In that catch branch, drop the key from `owned` and delete the blob at once through the existing bounded, reporting `deleteLate` path (`STAGED_MEDIA_CLEANUP_BOUND_MS`). Prove it at the stager surface and at the MCP `create_document` (HTML) surface, which reaches this branch with a `data:` image whose MIME type exceeds the Attachment `contentType` length.

## Boundaries & Constraints

**Always:**
- The source of a refused blob stays in the document, as the baseline importer keeps it; no handle, redirect, or Attachment row is produced for it.
- The deletion is bounded by `STAGED_MEDIA_CLEANUP_BOUND_MS` and never changes the attempt's outcome or timing. A rejected or unsettled deletion is reported once, by Attachment ID only, through the existing `reportFailure` warning.
- A later `cleanup()` does not delete the refused key again.
- Deletion is idempotent by key. A duplicate deletion in the narrow race where cleanup has already begun is accepted, as for late-landing blobs today.
- The fix lives in `MediaStager`, so the Markdown path and the HTML worker (`enforcedImport.ts:684`, `:705`) both get it.
- A modified `_bmad-output/implementation-artifacts/deferred-work.md` is the orchestrator's pending ledger transaction: do not stage, edit, revert, or commit it.

**Never:**
- Do not change requester source staging or `enforcedHtmlCreate.ts` (F-7a stays an accepted residual, retro decision 4).
- Do not change worker row 7 source retention (F-7c), the AD-20 row mapping, `runAttempt`'s cleanup condition, or `deadline.ts` constants.
- Do not await the deletion inside preparation, and do not log a source, key, name, or content.
- Do not change behavior when `storeFromUrl` returns `undefined` or rejects: that key stays owned and is deleted by cleanup on rows 2-5.
- Do not weaken existing assertions, create new test files or directories, or edit the deferred-work ledger or sprint board.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Refused blob, committed write (row 6) | Enforced HTML create with `data:image/${"x".repeat(260)};base64,...`; the blob is stored, validation refuses it | Response `validated`; the source stays in the text; no Attachment row; the refused blob no longer exists, although no cleanup ran | none |
| Refused blob, then rows 2-5 | The stager refused one blob and then `cleanup()` runs | `deleteFile` is called for the refused key once, before cleanup; cleanup deletes only the other owned keys | none |
| Refused blob's deletion fails | `deleteFile` rejects or does not settle within the bound | One `"Enforced write staged media cleanup failed"` warning with `attachmentIds: [id]` and the correlation IDs only | Reported; outcome unchanged |
| Store fails | `storeFromUrl` returns `undefined` or rejects | Unchanged: the key stays owned, and cleanup deletes it | none |

</intent-contract>

## Code Map

- `server/wikiLint/adapters/mediaStaging.ts:438-446` -- the validation catch: the only production change. `:407` puts the key into `owned`; `:415-423` is the settled hook that calls `deleteLate` once cleanup has begun; `:316-338` is `deleteLate` (reuse it as is; extend its doc comment to the refused-blob case); `:250-295` is `cleanup`/`deleteOwned`, which snapshots `owned` when it starts; `:382-393` is `stageOne`'s doc comment (it says a refused import "keeps the source" — add that its blob is deleted at once).
- `server/wikiLint/application/enforcedWrite.ts:450-466` -- `runAttempt` builds the stager with `FileStorage` and runs cleanup only for rows 2-5. Read-only.
- `server/wikiLint/application/deadline.ts:56` -- `STAGED_MEDIA_CLEANUP_BOUND_MS = 1000`. Read-only.
- `_bmad-output/planning-artifacts/architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md:114` -- AD-7: rows 2-5 delete staged blobs idempotently; row 7 never deletes them. Read-only.
- `server/wikiLint/adapters/mediaStaging.test.ts:234-254` -- the existing test "keeps a source whose import fails ... and still owns its key"; its third source is the refused blob, and its final assertion expects cleanup to delete it. `:63-79` is `fakeStorage`, `:143-148` is `settle`, and `:485-530` is the late-deletion report pattern to mirror.
- `server/tools/documents.enforcedMedia.test.ts:871-906` -- the enforced HTML create test "keeps a source whose import fails, as the baseline does, and commits", whose `data:image/${"x".repeat(260)}` image is the refused blob on row 6. `:207-215` is `recordKeys` and `:297-298` is `blobsExist`; `:814-827` shows `keys.splice(0)` before the baseline call. `vi.waitFor` is already used in sibling tool tests.
- `server/storage/files/LocalStorage.ts:92-99` -- `deleteFile` of a missing key logs and returns; S3 `DeleteObject` is idempotent. Read-only evidence for idempotency.

## Tasks & Acceptance

**Execution:**
- `server/wikiLint/adapters/mediaStaging.ts` -- in the validation catch, call `this.owned.delete(id)` and `this.deleteLate(id, key)` before returning `undefined`; update the `stageOne` and `deleteLate` doc comments. -- Closes F-7b without a new deletion path.
- `server/wikiLint/adapters/mediaStaging.test.ts` -- update the test at `:234` so that, after staging and `settle()`, `deleteFile` was called with only the refused key, and after `cleanup()` the calls are the refused key followed by the two failed-store keys; rename it to match. Add a test where the refused blob's deletion rejects: one warning with `attachmentIds: [id]` and the correlation IDs, and no source, key, name, or error text in the log. -- Stager-surface proof of matrix rows 2-4.
- `server/tools/documents.enforcedMedia.test.ts` -- in the test at `:871`, record the enforced create's staged keys with `recordKeys()` and `keys.splice(0)` before the baseline call, and assert with `vi.waitFor` that `blobsExist` of those keys is all `false`. Keep every existing assertion. -- MCP-surface proof of matrix row 1.

**Acceptance Criteria:**
- Given matrix row 1, when the enforced HTML `create_document` returns, then it is `validated`, keeps the source, creates no Attachment row, and none of its staged blobs exist.
- Given the pre-fix `mediaStaging.ts`, when the new and updated assertions run, then the row 1 MCP assertion and the stager assertions fail, which shows the tests detect F-7b.
- Given the targeted suites, when they run against the test database, then every test passes, and format, lint, and type-check report no new problems in the changed files.

## Spec Change Log

## Review Triage Log

### 2026-10-04 — Follow-up review pass
- verdicts: 11 findings — high 0, medium 2, low 7, false 2, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind Hunter: disowning a refused key before deletion succeeds leaves an orphan if deletion fails. — The failure path already reports by Attachment ID and the intent explicitly forbids cleanup from deleting that key again. Retrying needs additional state and changes the accepted failure mode; the compound failure is unlikely in everyday use.
  - `[medium]` `[defer]` Blind Hunter: LocalStorage resolves after an unlink failure, so the stager cannot issue its Attachment-ID warning. — Verified at `LocalStorage.ts:92-99`; this pre-existing adapter behavior also affects older cleanup paths. Deferred with the related logging issue as one root cause.
  - `[medium]` `[defer]` Blind Hunter: LocalStorage logs the full path on deletion failure, including the key and attachment name. — Verified at `LocalStorage.ts:97`; the same pre-existing catch logs on older deletion paths. Deferred with the swallowed failure.
  - `[low]` `[reject]` Blind Hunter: a cleanup-in-flight refusal can delete one key repeatedly and report more than once. — Carried: the prior review verified this narrow sibling-failure race; the intent accepts duplicate idempotent deletion, and a fix needs additional guards and race machinery.
  - `[low]` `[reject]` Blind Hunter: the MCP assertion might pass if the refused store stopped writing. — Carried: the prior review's red run failed `[false, false, true]` before the fix. Only a separate future storage regression would make the test vacuous.
  - `[low]` `[reject]` Blind Hunter: the blob may still exist at response time because deletion is detached. — Carried: the intent explicitly forbids awaiting deletion during preparation, and the prior review accepted eventual deletion plus a bounded warning.
  - `[low]` `[reject]` Edge Case Hunter: cleanup starting before a refused store settles can produce multiple warnings. — Carried: the same cleanup-in-flight race and verdict as above.
  - `[low]` `[reject]` Edge Case Hunter: the response may arrive before deletion settles. — Carried: the same non-awaited deletion and verdict as above.
  - `[low]` `[reject]` Intent Alignment Auditor: the literal response-time reading is stronger than the eventual check at the MCP surface. — Carried: the explicit no-await constraint resolves the timing reading; the MCP test waits for eventual absence after the response.
  - `[false]` `[reject]` Intent Alignment Auditor: deleting a refused blob might conflict with row 7 retention. — A refused blob never gets a handle or Attachment row; row 7 retains blobs that may be referenced by a commit of unknown outcome.
  - `[false]` `[reject]` Intent Alignment Auditor: stager tests use Markdown while the named outer surface is HTML MCP. — `documents.enforcedMedia.test.ts` exercises HTML `create_document` and its response, stored text, Attachment count, and eventual blob absence. The Markdown stager test covers the shared `stageOne` path and cleanup ordering.

### 2026-10-04 — Review pass
- verdicts: 16 findings — high 0, medium 0, low 9, false 7, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind Hunter: a refused blob whose store settles after cleanup began is deleted up to three times and can be reported twice, against "reported once". — Real, but grouped as "cleanup-in-flight race". `attempt` awaits `plan.prepare(media)` without a race (`enforcedWrite.ts:501`), so cleanup can begin during staging only when a sibling `stageOne` in the same chunk throws `MediaStagingRefusedError` first. All siblings read the same preparation remainder in one tick, so the refused store must land inside a window of microseconds and then fail validation. The fix is a new `!this.cleaning` guard plus a race test, so the low-finding rejection rule applies. The spec already accepts duplicate idempotent deletion in this race.
  - `[low]` `[reject]` Blind Hunter: no test or matrix row covers a refused blob that lands after cleanup has begun. — Same "cleanup-in-flight race" group; the race is negligible, and covering it needs new hold-and-race test machinery.
  - `[low]` `[reject]` Blind Hunter: the MCP test cannot show the refused blob was ever written, so it could pass vacuously if that source stopped being stored. — Today it is not vacuous: with `HEAD`'s `mediaStaging.ts` swapped in, it failed with `expected [ false, false, true ]`. It would only turn vacuous through a storage change, and this fork changes `v1.10.1` storage only through explicit, tested backports. Recording each store's result needs a new wrapper.
  - `[false]` `[reject]` Blind Hunter: AD-7's "row 7 never deletes them" contradicts the P2 deletion, and the class doc and `deleteLate` name are outdated. — AD-7's row 7 rule protects blobs that a COMMIT of unknown outcome may reference. A refused blob never becomes a handle, so no row can reference it. The retro decision record read AD-7 and classified F-7b as "a plain fix" (decision 4). The `MediaStager` class doc does not say P2 only writes. `deleteLate`'s doc comment now names the refused-blob use.
  - `[false]` `[reject]` Blind Hunter: no test shows that a row 7 attempt mixing refused and valid media keeps the valid blobs. — The new code deletes only the `key` local to the refused `stageOne` call; handles of valid blobs take the unchanged path. The existing row 7 retention tests (`documents.enforcedMedia.test.ts:708`, `:1046`) pass.
  - `[false]` `[reject]` Blind Hunter: AC2 (the tests fail without the fix) has no recorded verification. — Observed in this run: with `HEAD`'s `mediaStaging.ts` swapped in, the 4 new or updated tests failed (MCP `expected [ false, false, true ]`), and 44 passed. Recorded under Auto Run Result.
  - `[low]` `[reject]` Blind Hunter: reusing `reportFailure` means operators cannot tell a P2 refused-blob deletion failure from a failed cleanup. — The report carries `invocationId` and `attemptId`, which correlate with the write's audit summary and outcome, and the late-landing path already shares this message. The failure needs a refused blob and a failed storage delete together, which is rare. A distinguishing field adds a parameter.
  - `[low]` `[reject]` Edge Case Hunter: the duplicate `deleteFile` and up to three warnings when validation refuses after cleanup began; suggests a `!this.cleaning` guard. — Same "cleanup-in-flight race" group; rejected on the same evidence.
  - `[low]` `[reject]` Edge Case Hunter: the deletion is fire-and-forget, so the blob can still exist when `create_document` returns, or remain if the delete fails. — Real as stated, and grouped as "deletion not awaited". It is the spec's deliberate design ("Do not await the deletion inside preparation"): the blob is Outline-inaccessible, a failed delete is reported by Attachment ID, and awaiting could push later sources past the preparation bound. The only other fix is to reword this build's spec AC.
  - `[low]` `[patch]` Verification Gap: no assertion shows that staging returns before a slow or hanging refused-blob deletion, so a regression to awaiting it would go unnoticed. — Pre-verified gap. The step-03 subagent added `settles` per case and, in the "does not settle" case, `expect(warn).not.toHaveBeenCalled()` right after `stageMarkdown` resolves. It showed that the assertion fails when the catch awaits the bound. Re-run: 48/48 pass; format, lint, and `tsc` exit 0.
  - `[false]` `[reject]` Intent Alignment: the refused blob is now deleted even when the attempt ends on row 7 (reading R3), and no test covers that. — Not a defect: the intent directs deleting the blob in `mediaStaging.ts` when validation fails, and AD-7 row 7 retention applies to blobs that may be materialized. A refused blob can never be materialized (Design Notes; retro decision 4).
  - `[low]` `[reject]` Intent Alignment: the deletion is not awaited, so the write can return while the blob exists, and a failed delete leaves it with a report only. — Same "deletion not awaited" group; rejected on the same evidence.
  - `[low]` `[reject]` Intent Alignment: the cleanup-in-flight race can delete one key up to three times and report it twice. — Same "cleanup-in-flight race" group; rejected on the same evidence.
  - `[false]` `[reject]` Intent Alignment: Markdown row 6, `stageProsemirror` at the stager surface, and rows 2-5 with a refused blob at the MCP surface are not covered. — The changed lines are in `stageOne`, which both stage methods call with no path-specific branch. The HTML path is covered at the MCP surface, and `stageMarkdown` plus the rows 2-5 cleanup ordering are covered at the stager surface. Markdown MCP writes admit no over-long `data:` MIME type (`documents.enforcedMedia.test.ts:609`).
  - `[false]` `[reject]` Intent Alignment: the "delete a late-landing requester source" half of DW-27's title gets no code. — The bundle intent excludes it: F-7a stays an accepted residual by retro decision 4.
  - `[false]` `[reject]` Intent Alignment: the spec is untracked but not ignored, so the artifact-only receipt does not apply. — This is an observation, not a defect. The deliverables include tracked server code, so the receipt is not asserted.

## Design Notes

Deleting in P2 is consistent with AD-7: the refused blob never becomes a handle, so no Attachment row can ever materialize it, and the row 7 retention rule (which protects blobs a COMMIT of unknown outcome may reference) does not apply. `deleteLate` is fire-and-forget within its own 1-second bound, so the attempt's preparation bound and outcome are untouched, unlike an awaited deletion that could push a later source past the preparation bound.

```ts
} catch {
  this.owned.delete(id);
  this.deleteLate(id, key);
  return undefined;
}
```

## Verification

**Commands:**
- `scripts/test-db.sh ensure` -- expected: the test database is running and migrated.
- `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint/adapters/mediaStaging.test.ts server/tools/documents.enforcedMedia.test.ts` -- expected: every test passes.
- `corepack yarn tsc`, `node_modules/.bin/oxlint --type-aware` and `node_modules/.bin/oxfmt --check` on the changed files -- expected: exit 0.

## Auto Run Result

Status: done

**Summary:** The committed DW-27 change disowns and starts bounded deletion of a blob when Attachment validation refuses its row values. The refused source remains in the document; cleanup does not delete the same key again.

**Files changed:** `server/wikiLint/adapters/mediaStaging.ts` handles refused blobs; `server/wikiLint/adapters/mediaStaging.test.ts` checks deletion, cleanup ordering, warnings, and non-blocking behavior; `server/tools/documents.enforcedMedia.test.ts` checks committed HTML create and eventual blob absence; this spec records the follow-up review.

**Review findings:** 11 findings: 0 patched; 1 root cause deferred (2 medium findings about the pre-existing LocalStorage error catch); 7 low findings rejected for the previously reviewed retry, race, test-vacuity, and timing reasons; 2 false findings rejected because row 7 cannot reference a refused blob and the HTML MCP surface is tested.

**Follow-up review recommendation:** `false` (this pass patched high 0, medium 0, low 0).

**Verification:** `scripts/test-db.sh ensure` reported the test database ready. The targeted Vitest files passed 48/48. Formatting on the three changed source files, type-aware lint on those files, and `corepack yarn tsc` exited 0. The new LocalStorage finding was verified by reading its implementation and its call sites; no adapter code was changed in this pass.

**Residual risks:** LocalStorage's pre-existing deletion error catch hides unlink failures from the stager and logs the full path. The accepted cleanup-in-flight duplicate-deletion race and bounded, non-awaited deletion remain as described in the prior review. F-7a remains outside this change.
