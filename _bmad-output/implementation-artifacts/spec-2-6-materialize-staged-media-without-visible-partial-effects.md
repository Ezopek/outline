---
title: 'Story 2.6: Materialize Staged Media Without Visible Partial Effects'
type: 'feature'
created: '2026-10-04'
baseline_revision: '7c762ca4ec0e385e4d335a4a7b1249ce15b7a77a'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Enforced writes still refuse importable media. An enforced Markdown `update_document` whose text holds a `data:` image the baseline would import, and an enforced HTML `create_document` with external or `data:` media, both end in AD-20 row 3 through `UnstagedMediaError` (`server/wikiLint/adapters/documentProjection.ts:106`). The baseline importers cannot be reused: `attachmentCreator` writes the blob and commits the Attachment row and its `attachments.create` Event before validation, and for HTML outside any transaction (`DocumentImportTask.ts:91-100`). Binding acceptance is `_bmad-output/planning-artifacts/epics.md`, Story 2.6, ACs 1–7. This story also owns the integrated fixture of 2.3 AC2 (media staging within the preparation bound).

**Approach:**
- A per-attempt media stager (new adapter) selects and rewrites media exactly as the baseline importer of that path does. It writes each blob with `FileStorage.storeFromUrl` at its final key under a pre-allocated Attachment ID, and it creates no row. It runs only in P2.
- The staged handles travel in the prepared value and the `ProjectedDocument`. Validation runs on the rewritten content. In P7, `Attachment.createWithCtx` inserts the rows inside the enforcement transaction, before the document write.
- `runAttempt` owns the stager. It creates it, seals it before `BEGIN`, and runs a bounded, idempotent cleanup on rows 2–5 only.

## Boundaries & Constraints

**Always:**

- **What is staged (baseline parity).**
  - **Markdown update.** The stager acts exactly when `documentUpdater` would import, that is when `input.publish !== false && input.text !== undefined`.
    - It selects the images of `parseImages(text)` whose `src` parses as a URL, is not `isInternalUrl`, and starts with `data:` (`TextHelper` `base64Only`). The name is `image.alt ?? "image"`.
    - After all staging, it rewrites in `parseImages` order with `text.replace(new RegExp(escapeRegExp(src), "g"), redirectUrl)` for each staged source.
  - **HTML create (worker).** The `documentImporter` `media` prop becomes the stager's ProseMirror step. It mirrors `ProsemirrorHelper.replaceImagesWithAttachments` exactly:
    - the sources are images, then videos (`src`, named `alt ?? node.type.name`), then `data:` link hrefs (named `textContent || "file"`);
    - it skips an invalid URL or an internal one;
    - it rewrites the image and video `src` and the link-mark `href` with the same `transformFragment` walk.
  - **Markdown creates and templates** stage nothing, because `documentCreator` imports nothing. A `data:` image stays inline, as in the baseline.
  - **Batching.** Each distinct source is staged once per attempt, under the first occurrence's name. Staging runs in chunks of 10 at a time. The per-source fetch timeout is the baseline's `Math.floor(Math.min(env.REQUEST_TIMEOUT / count, 10000))`, capped by the preparation remainder. `count` is the baseline's source count: all ProseMirror `sources`, or `parseImages(text).length`.
- **Staging one source.**
  - The stager pre-allocates `id = randomUUID()`, `key = AttachmentHelper.getKey({ id, name, userId: actor.id })`, and `acl = AttachmentHelper.presetToAcl(AttachmentPreset.DocumentAttachment)`.
  - It records the key as owned before any storage call. It then calls `storage.storeFromUrl(src, key, acl, { timeout })`, raced against the preparation remainder.
  - It makes a handle `{ id, key, acl, size: contentLength, contentType }` only when the result is defined and `Attachment.build({ ...handle, teamId, userId }).validate()` passes, with no database I/O. Otherwise (undefined, a rejection, or invalid row values) the source keeps its original `src` or `href`, as after a failed baseline import. The redirect URL is `Attachment.getRedirectUrl(id)`. The stager never logs a source, key, name, or content.
  - **Refusal.** The stager refuses a new source with a thrown error once the preparation bound has expired, once it is sealed, or once cleanup has begun. A storage call that outlives the bound throws the same way. Both end in row 3 with the fixed message.
  - A store that settles after cleanup began deletes its own key (bounded, errors ignored).
- **Shell lifecycle (`runAttempt`).**
  - One stager per call, built from `invocationId`, a fresh `attemptId`, the actor, the attempt's `preparation` deadline, and `requestId`. It is passed as `plan.prepare(media)`.
  - It is sealed when `prepare` resolves, before `EnforcementTransaction.open`. No storage call runs from the transaction's opening to its end.
  - Once the transaction has ended, rows 2, 3, 4, and 5 run `cleanup()`. That includes the worker's own pre-allocated-ID unique violation, which is row 5 inside `runAttempt`. Rows 6 and 7 never delete, and neither does an unexpected throw.
  - `cleanup()` is idempotent and deletes only this stager's keys, concurrently. It waits at most `STAGED_MEDIA_CLEANUP_BOUND_MS`, which is 1000 and new in `deadline.ts`.
  - A rejected or unsettled deletion yields exactly one `Logger.warn("Enforced write staged media cleanup failed", { requestId, invocationId, attemptId, attachmentIds })`. It carries no key, name, URL, content, or error text, and it never changes the outcome.
- **Projection.**
  - `PreparedMarkdownCreate`, `PreparedMarkdownUpdate`, and `ProjectedDocument` gain `attachments: readonly StagedAttachment[]`, deep-frozen, and `[]` when nothing was staged.
  - `prepareMarkdownCreate` sets `[]`. `prepareHtmlCreate(input, imported, attachments)` and `prepareMarkdownUpdate(input, attachments)` receive the stager's handles. The update's `text` is the rewritten text.
  - The projections copy the handles unchanged. Validation and its measures therefore run on content that references the staged redirect URLs, which is the content that persists.
- **Materialization.** `materializeAttachments(ctx, attachments)` in `projectionWriter.ts` runs in P7, before the document write. For each handle in order, it calls `Attachment.createWithCtx(ctx, { id, key, acl, size, contentType, teamId: actor.teamId, userId: actor.id })`, with the same values and Event as `attachmentCreator` and no storage call.
  - `persistProjectedCreate` calls it, and so does `persistProjectedUpdate` in its non-unpublish branch.
  - The `attachments.create` Events get `validationCorrelationId` through the existing hook, and their `afterCommit` callbacks stay buffered.
- Remove `UnstagedMediaError`, `refuseImportableMedia`, and the update refusal. Their tests become staging tests.

**Never:**
- Do not modify `server/models`, `server/storage`, `server/commands`, `server/presenters`, `shared/utils`, `server/editor`, `server/routes`, `plugins`, `DocumentImportTask`, or any tool schema or description.
- Do not stage on the sentinel, unconfigured, `read_only`, fingerprint-mismatch, or pre-classification paths. Do not change any baseline path.
- Do not run storage I/O inside the enforcement transaction, insert an Attachment row before P7, or delete on row 6 or 7. Never delete a key another attempt staged, and add no sweeper (D-9).
- Do not change Story 2.5's source ownership, summaries, or row mapping beyond the media seam. Do not write Markdown-path summaries (Story 2.7). Do not import `c17d2c52b`.
- Do not edit `sprint-status.yaml`, `deferred-work.md`, `epics.md`, `server/tools/README.md`, or the SPEC, PRD, or spine. Add no pilot identifiers.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Committed update | Enforced reader; `update_document` with a valid body and `![pixel](data:image/png;base64,…)` | Success with `validation`. The stored text references `/api/attachments.redirect?id=<A>` and holds no `data:`. Exactly one Attachment row `A`, with key `uploads/<actor>/<A>/pixel` and the baseline ACL, size, and type. The blob exists, and `attachments.redirect` returns 302 to a team member. The `attachments.create` and `documents.update` Events carry `validationCorrelationId`. All of it equals the baseline `documentUpdater` result of the same input, modulo IDs | — |
| Committed HTML create | Enforced; a `data:` image, a `data:` link, and an external image (msw 200 PNG) | Committed. Three rows referenced by the content, equal to the baseline import modulo IDs. The source is deleted | — |
| Failed single import | External image 404 (msw); a `data:` URL over the upload size; a `data:` MIME over 255 characters | That source keeps its URL, as in the baseline, and gets no row. The write commits | — |
| Rejected | Media plus a body without the required section | Modeled rejection. No document, Attachment row, or Event. Every staged key is deleted, and `attachments.redirect` returns 404 for each pre-allocated ID | Row 4 |
| Projection failure | `patch` with an absent `findText` and a `data:` image | Baseline message. The blob is deleted, no row | Row 3 |
| Preparation expiry | The second store outlives the bound | `OPERATION_FAILED`. No enforcement transaction. The first blob is deleted, and so is the late blob once it lands. Later sources are refused | Row 3 |
| Collection change | HTML create with staged media whose parent moves inside P3 | `collection_conflict`. Blobs deleted | Row 2 |
| Materialization or persist failure | `INSERT INTO "attachments"` fails in P7; the worker's persist gate refuses | Rollback, blobs deleted | Row 5 |
| COMMIT outcomes | Server-reported error with the probe absent; a socket error with no COMMIT landed; a socket error after a real COMMIT | Row 5 with blobs deleted. Row 7 with blobs kept and no visible row. Committed with the rows and blobs kept | Rows 5, 7, 6 |
| Cleanup failure | `deleteFile` rejects or hangs on a rejected write | Same agent result. One minimized warn listing only the attachment IDs. The blob remains, and `attachments.redirect` and `files.get?key=` return 404 | Diagnostic |
| Worker replay | A committed job redelivered | Lookup-first `committed`. No `store` or `storeFromUrl` call. One document, one Attachment-row set, one Event set | — |
| Worker retry | The first attempt crashed after staging (no cleanup), or aborted; a second run with the same intent | One committed row set, the second attempt's. The first attempt's blobs are inaccessible after a crash and deleted after an abort | — |
| Concurrent attempts | Two runs of one media intent | One document and the winner's rows. The loser's keys are deleted, and the winner's are kept | — |
| Unchanged scopes | Unconfigured and `read_only`: an HTML create with a `data:` image and a Markdown update with a `data:` image; a sentinel; a worker fingerprint mismatch | The baseline path runs (`attachmentCreator` called, results equal to unconfigured). The sentinel and the mismatch make no `store` or `storeFromUrl` call and create no Attachment row | Baseline |
| Markdown create | Enforced create with a `data:` image | Stored inline, no staging, equal to the baseline | — |

</intent-contract>

## Code Map

- `_bmad-output/planning-artifacts/epics.md:1355-1404` -- binding ACs.
- `_bmad-output/planning-artifacts/architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md` -- AD-7 media protocol `:113`, AD-20 rows `:312-343`, D-9 sweeper `:419`.
- `server/wikiLint/application/enforcedWrite.ts`:
  - `AttemptPlan.prepare` `:349`;
  - `runAttempt` `:424-597`: P2 `prepare` and open `:439-449`; the row returns `:476`, `:524`, `:528`, `:535`, and `:555`; P8 `:559-576`;
  - `enforceMarkdownCreate` `:615-651`, `enforceMarkdownUpdate` `:669-717` (prepare `:684-686`).
- `server/wikiLint/application/enforcedImport.ts`:
  - the `deleteStagedSource` bounded-delete pattern `:80-98`;
  - the worker `prepare` `:654-684`, with `media: refuseImportableMedia` at `:667` and `prepareHtmlCreate` at `:670-683`;
  - own-conflict `persist` `:711-720`, the row mapping `:743-774`, and `finish` `:518-532`, all unchanged.
- `server/wikiLint/adapters/documentProjection.ts`:
  - `ProjectedDocument` `:21-37`, `PreparedMarkdownCreate` and `PreparedMarkdownUpdate` `:90-99`;
  - `UnstagedMediaError` `:106`, `deepFreeze` `:121`;
  - `prepareMarkdownCreate` `:151`, `prepareHtmlCreate` `:175`, `refuseImportableMedia` `:202`, `prepareMarkdownUpdate` `:238`;
  - `projectMarkdownCreate` `:269`, `projectMarkdownUpdate` `:332`.
- `server/wikiLint/adapters/projectionWriter.ts` -- `persistProjectedCreate` `:48-69`, `persistProjectedUpdate` `:87-162`.
- `server/wikiLint/adapters/writeTransaction.ts` -- the correlation hook `:124-140`, `EnforcementTransaction.open` `:180`, `rollback` `:353`, `commit` `:373`.
- `server/wikiLint/application/deadline.ts` -- the constants and `within`; add the cleanup bound.
- Baseline references, read-only:
  - `server/models/helpers/ProsemirrorHelper.tsx:1205-1337` (selection, order, chunking, timeout, `transformFragment`);
  - `server/models/helpers/TextHelper.ts:68-130` (`es-toolkit/compat` `chunk`, `escapeRegExp`);
  - `server/utils/parseImages.ts` (unique by `src`);
  - `server/commands/attachmentCreator.ts` (the row values);
  - `server/storage/files/BaseStorage.ts:196-305` (`storeFromUrl` swallows failures and returns undefined);
  - `server/models/helpers/AttachmentHelper.ts:26-37,77`;
  - `server/models/Attachment.ts:233-243` (`getRedirectUrl`) and `:44-63` (row validators);
  - `server/models/base/Model.ts:222-238` (`createWithCtx` emits `attachments.create`);
  - `server/commands/documentUpdater.ts:103-111`, `server/commands/documentImporter.ts:87-93`.
- Access surfaces: `server/routes/api/attachments/attachments.ts:304-343` (`redirect` needs the row) and `plugins/storage/server/api/files.ts:100-126` (`files.get` without a row or signature returns 404). In tests, storage is `local` under `/tmp` (`.env.test:46`), HTTP goes through msw (`server/test/msw.ts`), and `server.post("/api/attachments.redirect", user, { body: { id }, redirect: "manual" })` follows `attachments.test.ts:566`.
- Tests that assert the refusal and change: `documentProjection.test.ts:1051-1072`, `:1180`, `:1684`, `:1692-1760`; `writeDecision.test.ts:12,335`; `enforcedWrite.test.ts:1433-1448`; `enforcedImport.test.ts:891-935`; `documents.enforcedHtml.test.ts:697-715`; `documents.enforcement.test.ts:1955-1964`. Helpers to reuse: `callWithoutEffect` and `storedState` (`documents.enforcement.test.ts:207-300`), `interceptQueries`, `stagedIntent`, and `expectCommitted` (`enforcedImport.test.ts:311-360`), the `state.clock` seam (`enforcedWrite.test.ts:1450`), and the parity helpers (`documentProjection.test.ts`, "HTML creates").

## Tasks & Acceptance

**Execution:**
- `server/wikiLint/application/deadline.ts` -- Add `STAGED_MEDIA_CLEANUP_BOUND_MS = 1000`, with documentation. -- AC4, AD-11.
- `server/wikiLint/adapters/mediaStaging.ts` (new) -- Add `StagedAttachment` and `MediaStager` with `stageMarkdown(text)`, `stageProsemirror(doc)`, `attachments`, `seal()`, and `cleanup()`, plus its refusal error. It takes an optional `storage` seam (`storeFromUrl`, `deleteFile`), defaulting to `FileStorage`. -- AC1, AC2, AC4, AC5.
- `server/wikiLint/adapters/documentProjection.ts` -- Add the `attachments` field and parameters, and remove the refusal code. -- AC2.
- `server/wikiLint/adapters/projectionWriter.ts` -- Add `materializeAttachments` and call it from both persist functions. -- AC3.
- `server/wikiLint/application/enforcedWrite.ts` -- Add the stager lifecycle to `runAttempt` and `prepare(media)`. `enforceMarkdownUpdate` stages and passes the handles. -- AC1, AC3, AC4, AC6.
- `server/wikiLint/application/enforcedImport.ts` -- Pass `media: (doc) => media.stageProsemirror(doc)` and `prepareHtmlCreate(…, media.attachments)`. -- AC1, AC5, AC6.
- Tests, all collocated:
  - `mediaStaging.test.ts` (new) covers selection, dedupe, keys, the ACL, names, timeouts, both rewrites against the real baseline helpers (IDs normalized), the failed-import cases, refusal after the bound, after the seal, and during cleanup, late-landing deletion, idempotent cleanup, and the minimized diagnostic.
  - `projectionWriter.test.ts` and `documentProjection.test.ts` cover materialization rows and Events, frozen attachments, and HTML and update parity with media.
  - `enforcedWrite.test.ts` covers cleanup per row, none on 6 or 7, the seal, and the 2.3 AC2 preparation-expiry fixture.
  - `enforcedImport.test.ts` covers the worker matrix rows: replay, retry, crash residue, concurrency, and own conflict.
  - `server/tools/documents.enforcedMedia.test.ts` (new, MCP-level) is the AC7 failure-injection suite for both paths, asserting through responses, rows, Events, storage, and the `attachments.redirect` and `files.get` surfaces.
  - The replaced refusal tests are updated, and the sentinel and mismatch paths assert no `store` or `storeFromUrl` call.
  - AC5's source-ownership clauses stay covered by the Story 2.5 suites: requester row 3 in `enforcedHtmlCreate.test.ts`, and terminal and lookup-first deletion and missing input in `enforcedImport.test.ts`. Keep them passing unchanged.

**Acceptance Criteria:**
- Given any enforced attempt, when the transaction's opening, its end (commit or rollback), and every `FileStorage` call are recorded in order, then no storage call falls between the opening and the end.
- Given a committing media write, when COMMIT is intercepted before it is sent, then a fresh-connection read sees no Attachment row and no document, and the event queue has not been called. After the response, all of them exist.
- Given the AD-11 bounds, when they are summed, then `ENFORCED_PRE_WRITE_BOUND_MS + WRITE_PREPARATION_BOUND_MS + VALIDATION_DEADLINE_MS + WRITE_PERSISTENCE_BUDGET_MS + STAGED_MEDIA_CLEANUP_BOUND_MS + AUDIT_WRITE_BOUND_MS <= 55000`. The worker's post-persistence tail, `STAGED_MEDIA_CLEANUP_BOUND_MS + COMMIT_PROBE_BOUND_MS + max(COMMIT_PROBE_BOUND_MS, AUDIT_WRITE_BOUND_MS)` plus the 1-second staged-source delete bound, is at most `AUDIT_WRITE_BOUND_MS + ENFORCED_IMPORT_GRACE_MS`.
- Given the protected paths, when `git diff 7c762ca4ec0e385e4d335a4a7b1249ce15b7a77a` (the `baseline_revision`) is read for `server/models server/storage server/commands server/presenters shared/utils server/editor server/routes plugins server/queues`, then it is empty.
- Given the same paths, when `git diff 4a5a616a21be800257dc11cef4263d0dd0412156` is read for `server/models server/storage server/presenters shared/utils server/editor server/queues/tasks/DocumentImportTask.ts`, then it is empty, and for `server/commands` it shows only the existing `documentImporter.ts` `media` prop.
- Given the existing suites, when they run, then every fixture passes unchanged except the listed refusal tests, which now assert staging.

## Spec Change Log

## Review Triage Log

### 2026-10-04 — Review pass

- verdicts: 38 findings — high 0, medium 1, low 29, false 8, maybe-false 0
- findings:
  - `[low]` `[patch]` blind: a preparation remainder under 1 ms makes the fetch `timeout` 0, which `@server/utils/fetch` treats as no timeout (`if (timeout && …)`), so the abandoned fetch runs unbounded — Fixed: the cap is `Math.max(1, Math.floor(remainingMs))`, leaving the baseline `timeoutMs` unchanged. A unit case with a remainder under 1 ms asserts `timeout: 1`.
  - `[low]` `[reject]` blind: refused or cancelled stores are never aborted, and the stager ignores the handler signal — The outcome is unchanged: row 3 and cleanup, within the 30 s preparation bound. The baseline aborts nothing either. The fix adds a signal parameter and guards, and cancellation during staging is uncommon.
  - `[low]` `[reject]` blind: `FileStorage.storeFromUrl` and `LocalStorage.deleteFile` log URLs, keys, or paths, so "never logs" does not hold end to end — The stager logs none of these. The lines come from `server/storage`, which this story may not modify, and the baseline importers trigger the same storage logs. Avoiding the delete of never-written keys would change the ownership semantics, which is more than a direct correction.
  - `[low]` `[reject]` blind: the cleanup diagnostic never fires on local storage, because `LocalStorage.deleteFile` swallows unlink errors — Real unlink failures (EACCES, EBUSY) are rare on local disks, and S3 rejections are reported. Detecting them would need an extra existence check per key.
  - `[low]` `[patch]` blind: a late-landing deletion that rejects or expires leaves an orphan with no diagnostic, against AC4's diagnostic clause — Fixed: `deleteLate(id, key)` reports through the same minimized warning with `attachmentIds: [id]`, through a shared `reportFailure`. A unit case covers a late delete that rejects.
  - `[low]` `[reject]` blind: blobs kept on purpose (row 7, an unexpected throw, the row-6 probe case) get no operator record — The AC requires a diagnostic only for a cleanup failure. These are accepted residuals with no sweeper (D-9), and every added log is a new branch on rare paths.
  - `[low]` `[reject]` blind: the HTML row-6 residual (`commit()` rejected, row found) could be avoided by probing the attempt's own Attachment ID — It is rare: a rejected commit together with a concurrent winner. The fix adds probe logic and a new branch. The residual is recorded.
  - `[low]` `[reject]` blind: a blob whose row values fail validation survives a committed write — This is the recorded residual, and the same orphan the baseline leaves. It needs adversarial input, such as a `data:` MIME over 255 characters. The fix needs another bounded storage call in P2 with its own failure reporting.
  - `[false]` `[reject]` blind: staged handles are never reconciled with the final content, so a round trip can drop a video and leave an unreferenced row — Refuted for the cited case: `Video.toMarkdown` writes `[title wxh](src)` and `parseMarkdown` reads it back (`shared/editor/nodes/Video.ts:189-208`). Any other dropped source would also leave a row in the baseline, which creates its rows during conversion.
  - `[low]` `[reject]` blind: the default `attachments = []` lets a future caller forget the handles — Developer-only, and both callers pass the handles explicitly. Removing the default means mechanical edits at many test call sites.
  - `[low]` `[patch]` blind: the parity helpers discard `attachments` with `void` — Fixed: `expectParity`, the HTML parity helper, and `expectStored` now assert `attachments` is `[]`. All three are used only on media-free projections.
  - `[false]` `[reject]` blind: the Markdown storage-order test treats any `COMMIT;` or `ROLLBACK;` as the end, so a stray end could hide storage calls — Refuted: the test also pins the tail after the end (`[]` committed, `["storage"]` rejected). A stray earlier end would push the hidden calls and the real end into that tail, and the test would fail.
  - `[low]` `[patch]` blind: the cleanup-bound test checks only a lower time bound — Fixed: it also asserts the elapsed time stays below the bound plus 1000 ms.
  - `[low]` `[patch]` blind: preparation expiry during media staging is untested on the HTML worker path — Fixed: a worker test with 11 sources and the second store held. It asserts `aborted` row 3 with `OPERATION_FAILED`, no enforcement transaction, only 10 stores (the eleventh refused), every key deleted, and the late blob deleted once it lands.
  - `[low]` `[reject]` blind: the bound test hard-codes the private 1000 ms source-delete bound, and `deleteLate` duplicates `deleteStagedSource` — Developer-only. Fixing it means exporting a constant and refactoring the shared delete, which is more than a direct correction.
  - `[low]` `[reject]` blind: materialization is serial and uncapped, so many handles could overrun the persistence budget — Overrunning needs each insert to approach the statement timeout. The check after persist then ends the attempt in row 5, a correct outcome. Per-insert deadline checks would be new guards.
  - `[low]` `[reject]` blind: test helpers are copied across five files — Developer-only and matches the existing per-file helper pattern. Consolidating them is a refactor.
  - `[low]` `[patch]` edge: a timeout of 0 from a remainder under 1 ms (grouped with the first blind row) — Same fix. When the baseline's own formula yields 0 (more sources than `REQUEST_TIMEOUT` ms), it stays 0, as in the baseline.
  - `[low]` `[reject]` edge: an invalid-row blob is never deleted on rows 6 and 7 (grouped with the invalid-row blind row) — Same reason as that row.
  - `[low]` `[patch]` edge: a late delete that rejects leaves no diagnostic (grouped with the late-delete blind row) — Same fix.
  - `[low]` `[reject]` edge: in Markdown, a staged `data:` source that is a prefix of another is replaced first and breaks the longer one — This needs one image's base64 payload to be a byte prefix of another's in the same update, and the baseline's global replacement has the same hazard. The spec fixes the `parseImages` order.
  - `[low]` `[reject]` edge: P7 inserts have no per-insert deadline check (grouped with the serial-materialization blind row) — Same reason.
  - `[low]` `[reject]` edge: a handler abort during P2 keeps staging (grouped with the abort blind row) — Same reason.
  - `[low]` `[reject]` edge: the real storage layer logs the URL and key (grouped with the logging blind row) — Same reason.
  - `[low]` `[patch]` edge: `recorded()` in `projectionWriter.test.ts` re-spies without restoring, so its second measurement accumulates the first step's calls — Fixed: it restores its spies in a `finally`. The accumulated calls did not change any current assertion.
  - `[low]` `[reject]` edge (claim): dedupe never retries a later-chunk duplicate after its first import fails, unlike the baseline — This needs a transient failure of a source repeated across chunks in HTML. The spec's design decision is one staging per distinct source, and a retry would add logic.
  - `[low]` `[reject]` edge (claim): the shared parity helpers were edited, so "every fixture passes unchanged" is not literal — The fixtures' data and assertions are unchanged. The helpers now assert the new field (see the parity row). The fix would edit this build's spec.
  - `[medium]` `[patch]` verification-gap: no test combines `text` with `publish` on an enforced update, so the `publish !== false` staging guard is unpinned — Fixed: two cases in "staged media". An unpublish with a `data:` image commits with no store, no row, and the text unchanged. A draft publish stages it, stores the redirect URL, and leaves one row.
  - `[low]` `[patch]` verification-gap: no test checks the diagnostic's correlation values as `runAttempt` wires them — Fixed: the HTML cleanup-failure test asserts the warning's `requestId` and `invocationId` equal the intent's.
  - `[false]` `[reject]` intent: AC1 staging is tracked in memory, not storage-visible — AD-7 binds "tracked under `invocationId`" and blobs "written at its final storage key", so an invocation-scoped key is excluded. The per-attempt stager is the tracking.
  - `[false]` `[reject]` intent: no rule observes attachment relationships (AC2) — No registered rule kind reads attachments (AD-3 closed registry; `markdownStructureSchema` has no image). The projection carries the handles, and validation and measures run on the content that references them.
  - `[low]` `[reject]` intent: AC3 pre-commit visibility is asserted only at the application layer, and pre-commit Event rows are not asserted separately — The fresh-connection reads, which see neither the row nor the document, are the external-visibility surface. The Events are inserted in the same READ COMMITTED transaction. The MCP suite asserts no Events after rollback.
  - `[false]` `[reject]` intent: AC5 is left to the Story 2.5 suites — Those suites ran and passed in the broad run, and the spec assigns AC5's source clauses to them. The new stager-refusal clause is tested on both paths.
  - `[false]` `[reject]` intent: AC6 has no new test for summary supersession — The retry test after an aborted first attempt goes through `expectCommitted`, which asserts exactly one summary with a committed outcome, so the aborted summary was replaced. `runEnforcedImport` is the redelivery entry point.
  - `[low]` `[reject]` intent: part of AC7 (staging expiry, acknowledgement, retry, concurrency) is covered below the MCP surface — Acknowledgement and redelivery are only reachable at the worker entry, since real Bull is unavailable here. Preparation expiry needs a clock seam on either surface.
  - `[low]` `[reject]` intent: "Outline-inaccessible" is checked only on local storage, not S3 — The S3 SDK is mocked in tests, and the staged ACL is the baseline `presetToAcl(DocumentAttachment)`, so the exposure equals the baseline's.
  - `[false]` `[reject]` intent: baseline-parity carve-outs (dropped HTML state, dedupe, inline Markdown-create images) — The dropped state is the earlier DW-10 decision and dedupe is a spec decision. The inline image in a Markdown create is exact baseline behavior.
  - `[false]` `[reject]` intent: nothing is committed and no `operator_actions` exist — No AC needs a human action outside the repo, and the commit happens at finalization.

### 2026-10-04 — Follow-up review pass

- verdicts: 18 findings — high 0, medium 0, low 13, false 5, maybe-false 0
- findings:
  - `[false]` `[reject]` blind: `sprint-status.yaml` records `done` — The orchestrator owns this already-dirty file and explicitly forbade this run from changing or reverting it; its row is not story verification.
  - `[low]` `[reject]` blind: multiple late failed deletions can produce multiple warnings — Each late deletion is a separate failed cleanup operation. Suppressing later warnings would hide their Attachment IDs; the timing is rare and the fix adds state.
  - `[false]` `[reject]` blind: deleting after a late store resolves `undefined` can report a nonexistent blob — `storeFromUrl` may have written a blob before returning `undefined`; the pre-allocated key remains owned and must be deleted.
  - `[low]` `[reject]` blind: asynchronous Attachment validation can extend P2 past its deadline — Model validation has no external I/O here, and `EnforcementTransaction.open` refuses an expired preparation bound. Another race adds complexity for an adversarial timing case.
  - `[low]` `[reject]` blind: the baseline per-source formula can yield a zero fetch timeout — Carried: this is the baseline formula for a source count exceeding `REQUEST_TIMEOUT`; the stager's preparation race still refuses and cleans a late landing.
  - `[low]` `[reject]` blind: handler cancellation does not interrupt an in-flight download — Carried: row 3 and bounded cleanup remain the outcome; adding signal plumbing is more than a direct correction.
  - `[low]` `[reject]` blind: local storage swallows unlink errors, hiding the correlated warning — Carried: real local unlink failures are rare and detecting them requires a separate existence check.
  - `[low]` `[reject]` blind: underlying storage may log keys or URLs — Carried: the logs come from the protected `server/storage` implementation, and the baseline importer does the same.
  - `[low]` `[patch]` blind: failure on the first Attachment insert does not prove rollback of an earlier insert — Added a second-insert failure case to the MCP suite; it verifies zero rows, Events, documents and blobs after rollback.
  - `[low]` `[reject]` blind: no different-team viewer in the media access fixture — The story does not change either access route, and the staged row absence plus the existing private ACL and route checks preserve that boundary. Adding a new fixture is wider than this direct follow-up.
  - `[false]` `[reject]` blind: concurrency may be sequential — The test records six staged keys; a later lookup-first replay after a completed commit would stage none, so both attempts passed staging before the winner's commit was visible.
  - `[low]` `[reject]` blind: crash residue is staged through Markdown in a worker test — Both paths use the same stager key ownership and no-row storage behavior; the next run exercises the actual three-source HTML worker path. An additional ProseMirror crash fixture would duplicate that coverage.
  - `[low]` `[reject]` edge: invalid Attachment values leave a blob after a successful write — Carried: the exact residual and its baseline-parity rationale are recorded above; it is Outline-inaccessible and needs another bounded storage deletion in P2.
  - `[low]` `[reject]` edge: an initial and late failed deletion can each warn — Same independent-deletion rationale as the second blind row; a single attempt-wide warning would omit later failed IDs.
  - `[false]` `[reject]` edge: deduplicated HTML sources contradict exact baseline row-count parity — The intent explicitly stages each distinct source once; the baseline duplicate race may make an orphan row, which the design notes already identify as the sole exception.
  - `[low]` `[reject]` verification-gap: an invalid-row blob is not asserted in the failed-import test — Carried: this is the recorded, Outline-inaccessible invalid-row residual, not an untested success criterion.
  - `[false]` `[reject]` intent: the diff contains an orchestrator `sprint-status.yaml` edit — The file was already dirty at entry and is outside this run's write scope; its bookkeeping is not evidence of completion or a story defect.
  - `[low]` `[reject]` intent: some lifecycle cases are tested below the MCP surface — Carried: worker acknowledgement and replay enter through `runEnforcedImport`, while the MCP suite covers the externally observable response and access surfaces.

## Design Notes

**Why the stager is per attempt and lives in `runAttempt`.** Rows exist only inside `runAttempt`, and a worker redelivery is a new `runAttempt` call. Ownership then needs no shared registry. A converted worker attempt (rows 2–5 followed by a found row) has already deleted its own blobs, while the committing attempt's blobs stay referenced.

**Dedupe.** `parseImages` already returns unique sources. In the ProseMirror path, the baseline's "skip already processed" check races inside a chunk, so it can import a duplicate twice and leave an unreferenced row. The stager stages each source once, which keeps the content and the row set deterministic. The only difference from the baseline is that a racy duplicate produces no orphan row.

**P2 row validation.** The baseline catches a failing `createWithCtx` (for example a `data:` MIME longer than 255 characters) and keeps the `src`. Validating the row values in P2 reproduces that, instead of turning a baseline success into a row-5 failure.

```ts
const media = new MediaStager({ invocationId, attemptId: randomUUID(), actor, preparation, requestId });
const outcome = await attempt(shell, plan, media, options); // existing body; prepare(media); media.seal() before open
if (outcome.row >= 2 && outcome.row <= 5) await media.cleanup();
return outcome;
```

**Residuals.** Some blobs stay Outline-inaccessible with no sweeper (D-9):
- blobs after a process crash, a row 7, or a cleanup failure;
- a store that failed after it wrote;
- a blob whose row values were invalid, on a committed write;
- the blobs of an HTML worker attempt whose `commit()` rejected while the probe found a row. That is row 6, and the row may be another attempt's.

## Verification

**Commands:**
- `scripts/test-db.sh ensure` -- expected: exit 0.
- `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint/adapters/mediaStaging.test.ts server/tools/documents.enforcedMedia.test.ts server/wikiLint/application/enforcedImport.test.ts server/wikiLint/application/enforcedWrite.test.ts server/wikiLint/adapters/projectionWriter.test.ts server/wikiLint/adapters/documentProjection.test.ts` -- expected: all pass.
- `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint server/tools server/routes/mcp server/routes/api/documents/documents.test.ts server/routes/api/attachments server/commands/documentImporter.test.ts server/queues` -- expected: all pass.
- `corepack yarn tsc`, plus `node_modules/.bin/oxlint --type-aware` and `node_modules/.bin/oxfmt --check` on the changed files -- expected: clean.
- The two protected-path `git diff` commands of the Acceptance Criteria -- expected: empty from `baseline_revision`; from `4a5a616…`, only the `media` prop. `git log 4a5a616a21be800257dc11cef4263d0dd0412156..HEAD --oneline | grep -i c17d2c52b` -- expected: empty.
- Temporary mutations, each reverted -- expected: a suite fails for each: skip cleanup on row 4; clean up on row 7; stage after the seal; materialize before validation; omit the late-landing delete.

## Auto Run Result

Status: done

**Summary.** Enforced Markdown updates and HTML creates stage importable media before the enforcement transaction. Validation sees rewritten content; P7 inserts Attachment rows and Events in the transaction. Rows 2–5 delete the attempt's staged keys within the cleanup bound, while rows 6–7 retain them. This follow-up added a second-insert failure fixture that proves rollback removes a preceding Attachment row and Event.

**Files changed since `baseline_revision`.** `server/wikiLint/adapters/mediaStaging.ts` owns staging and cleanup; `documentProjection.ts` carries frozen handles; `projectionWriter.ts` materializes rows; `application/enforcedWrite.ts` and `enforcedImport.ts` wire the lifecycle; `application/deadline.ts` defines the cleanup bound. Their collocated tests, the MCP media suite, and the converted refusal tests verify the behavior. This pass changed only `server/tools/documents.enforcedMedia.test.ts` and this spec.

**Follow-up review.** 18 findings: high 0, medium 0, low 13, false 5. One low entry was patched, none deferred. The 17 rejected findings and each reason are recorded, one per row, in the 2026-10-04 follow-up `Review Triage Log`. `followup_review_recommended: false`: a follow-up pass requires a patched high entry to recommend another pass, and there was none.

**Verification (2026-10-04).** `scripts/test-db.sh ensure` exited 0. The affected MCP media file passed 25/25 tests; the six targeted files passed 338/338; the broad server scope passed 2457/2457 across 91 files. `corepack yarn tsc`, type-aware `oxlint` and `oxfmt --check` on all 15 changed TypeScript files, and `git diff --check` passed. The protected-path diff from `baseline_revision` is empty; from the v1.10.1 source commit, only the existing `server/commands/documentImporter.ts` media prop appears. The previous pass's five temporary mutation checks remain applicable because this pass changed only one test and this spec.

**Residual risks.** The recorded residuals in `Design Notes` remain: crashes, row 7, cleanup failures, and invalid Attachment values can leave Outline-inaccessible blobs; an HTML row-6 probe can retain the attempt's blobs when it finds another winner. The local storage driver can swallow unlink failures and log keys or URLs; S3 access behavior is not exercised end to end. The orchestrator-owned `sprint-status.yaml` was already dirty on entry and was neither modified nor reverted by this run.
