---
title: 'Story 2.3: Enforce Markdown Creates and Updates Atomically'
type: 'feature'
created: '2026-10-03'
status: 'done'
baseline_revision: '06dd33bf45d0c599c0e3a6da3c0dd509837de5d2'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      Enforced writes that end in AD-20 rows 3, 5, or 7 leave no operator log; only post-commit callback failures are logged.
    evidence: |-
      runAttempt maps every non-application failure to OPERATION_FAILED through abortMessage and logs nothing, and row 7 (a COMMIT whose outcome cannot be established, which the hang fixture shows can still land) is not logged either. An operator investigating a failed enforced write has no requestId/invocationId-correlated trace. This is the same gap as Epic 1 retrospective action item 9 (F-6: log unmodellable lint failures with invocationId and error class only), which the project deferred to Epic 3 hardening; Story 2.7 adds summaries for rows 3, 4, 5, and 6 but none for row 7.
    location: >-
      server/wikiLint/application/enforcedWrite.ts:369-497
    severity: medium
---

<intent-contract>

## Intent

**Problem:** A valid `enforced` MCP Markdown create or update still fails closed (the Story 2.1 interim). Nothing validates the Story 2.2 projection inside one locked transaction, decides it with `decideWrite`, persists exactly it, and establishes the commit. Binding acceptance is `_bmad-output/planning-artifacts/epics.md`, Story 2.3, ACs 1–15.

**Approach:** Add one application shell that runs AD-20 P2–P8 for an enforced Markdown write in one unmanaged primary-database transaction. It applies the AD-8 lock order and the AD-11 bounds, builds the Story 2.2 projection from locked state, validates it with the shared engine (link reads under savepoints), and applies the AD-13 decision. It persists through the baseline save/publish hooks and establishes the commit, probing when `commit()` rejects. Adapters own the Sequelize mechanics: `afterCommit` buffering, the commit timer, the fresh-connection probe, and `validationCorrelationId` on mutation Events. The MCP handlers map the attempt's AD-20 row to the result, and `/mcp` aborts a handler's signal when its client disconnects.

## Boundaries & Constraints

**Always:**
- Scope: only `create_document` without `format: "html"` and `update_document` classified `enforced` take the new path. An enforced HTML create keeps the interim `OPERATION_FAILED` until Story 2.5. The `baseline`, `sentinel`, and `failed` classes keep their Story 2.1 behavior byte for byte.
- Code-owned bounds, in `server/wikiLint/application/deadline.ts`:
  - `VALIDATION_DEADLINE_MS = 9000`, shared with `lint_document`;
  - `WRITE_PREPARATION_BOUND_MS = 30000`, measured from shell entry, which immediately follows classification;
  - `WRITE_PERSISTENCE_BUDGET_MS = 9000`, measured from P7 entry;
  - `COMMIT_PROBE_BOUND_MS = 2000`;
  - `POST_COMMIT_ASSEMBLY_BOUND_MS = 2000`.
  With `ENFORCED_PRE_WRITE_BOUND_MS` and `AUDIT_WRITE_BOUND_MS`, they sum to at most 55 000. The floor is the existing `SET_LOCAL_FLOOR_MS`.
- Phases, in order. Every phase boundary issues `SET LOCAL lock_timeout` and `statement_timeout` on the enforcement transaction, never inside a savepoint. The value is the floored remainder, and below the floor the step fails by phase:
  - **P2:** `prepareMarkdownCreate`/`prepareMarkdownUpdate`, then open the transaction (connection acquisition plus `BEGIN`) within the preparation remainder. Expiry or failure is row 3. A transaction that opens late is rolled back when it resolves.
  - **P3:** the validation deadline starts when the transaction opens.
    1. Lock the classified collection `FOR NO KEY UPDATE`.
    2. For an update, lock the document row `FOR NO KEY UPDATE`. A create locks no parent.
    3. Re-fetch and re-authorize with the same helper the handler's P0 used, now bound to the transaction. An update re-fetches with `includeState: true`.
    4. Compare the post-operation collection with the classified one. A difference is row 2. Any other failure, or the floor, is row 3.
  - **P4:** project from the re-fetched state. A failure, or the floor, is row 3.
  - **P5:** entering below the floor is row 3. `halfDeadlineAtP5` = the remainder at entry ≥ `VALIDATION_DEADLINE_MS / 2`. Then validate (see Design Notes).
  - **P6:** apply `decideWrite`, with `runtimeFailureMode` from the immutable entry and `withinLimits` from `withinWriteEligibility`. `rejected` rolls back as row 4.
  - **P7:** persist. Timeouts are the persistence remainder less `COMMIT_PROBE_BOUND_MS`, issued at entry and again before `commit()`. A failure, or the floor, is row 5.
  - **P8:** `commit()` runs under a wall-clock timer equal to the persistence remainder; its expiry is connection-level. On any rejection, one probe runs on a fresh connection, in a short transaction with `SET LOCAL statement_timeout`, bounded by `min(COMMIT_PROBE_BOUND_MS, persistence remainder)`, acquisition included. A bound below the floor, a timer expiry, or a probe error means the probe cannot run. The probe looks up:
    - for a create, the pre-allocated `documentId` (unscoped, `paranoid: false`);
    - otherwise, an Event with that `documentId`, the operation's name (`documents.publish` for `publish: true`, `documents.unpublish` for `publish: false`, else `documents.update`), and `createdAt` ≥ the wall-clock time taken before `BEGIN`, whose `data.validationCorrelationId` equals the attempt's `invocationId`.
    A found row is row 6. A missing row after a server-reported rejection is row 5. Otherwise the result is row 7. A rejection is server-reported only when its `parent` carries a string `severity` and a string `code`.
- A row 3 or row 5 message is `abortMessage(error)`. Cancellation, the unchanged-update check, floor refusals, and timers produce no stable-id error, so they yield `OPERATION_FAILED`.
- Persistence stores exactly the projection, with no re-application of the edit and no `documentUpdater` (its `FOR UPDATE` re-lock is what AD-8 downgrades):
  - **Create:** `documentCreator` with `id`, `title`, `content` (a clone of the projection's), `icon`, `color`, `fullWidth`, `parentDocumentId`, `publish: projection.published`, `collectionId`, `sourceMetadata`, and the re-fetched `template`.
  - **Unpublish:** `unpublishWithCtx(ctx, { detach: false })`.
  - **Other updates:** assign only what the input names, from the projection: `title`, `icon`, `color`, and `fullWidth`; with `text`, also `content`, `text`, and `state` (plus `changed("state", true)` when the projection has state). Then either `publish(ctx, { collectionId: projection.collectionId })`, setting `collectionId` first when it is null, or, when anything changed, set `lastModifiedById`/`updatedBy` and `saveWithCtx(ctx)`. Re-fetch, then compare `revisionCount` with the value read after the lock: equality is row 5.
- `afterCommit` buffering: every callback registered on the enforcement transaction, or on any child of it at any depth (directly or through `parent`), is buffered in registration order. Sequelize's own hook lists stay empty. A callback registered on a savepoint that rolled back, or under one, is dropped. Row 6 starts each surviving callback independently and waits for them within `POST_COMMIT_ASSEMBLY_BOUND_MS`. A throw, a rejection, or the bound's expiry is logged only as `Logger.warn` with `{ requestId, invocationId, reason }`. Every other row discards the buffer. `transaction.finished` is never read.
- Every Event row created inside the enforcement transaction (or a child of it) gets `data.validationCorrelationId = invocationId`, added to any existing keys, through one idempotently registered `Event` `beforeCreate` hook keyed by a `WeakMap` of enforcement transactions.
- `validation` = `{ status, policySchemaVersion?: 1, policyFingerprint?, errors, warnings, systemFailures }`, in this key order:
  - the identity fields appear only when `readable`;
  - Finding `detail` appears only when `readable`;
  - each System Failure is located at `{ kind: "scope", scopeKind: "collection", collectionId? }`, with `collectionId` only when `readable`;
  - each array is sorted by `sortIssues`, with `sortCollectionId` set to the classified collection.
- Results:
  - row 2: `isError` whose only text block is `{"error":{"id":"collection_conflict"}}`;
  - rows 3/5: `error(message)`;
  - row 4: `success({ success: false, validation })`;
  - row 6: the baseline success object for that mode, with `validation` appended as the last key of the first block. `breadcrumb`, `shareUrl`, and the patch second block are each guarded and omitted on failure, and an identity that cannot be assembled falls back to `{ success: true, id, validation }`;
  - row 7: `error(OPERATION_FAILED)`.
- Cancellation: `context.signal` is checked after P2, after `BEGIN`, at the P3/P4/P5 entries, before each link batch, and before P6. An abort there is row 3. After the decision, the signal is ignored. `/mcp` closes the request's transport when the response closes before it finished writing, which aborts the handler signals.

**Never:**
- Do not write `wikiLint.write_validation` summaries (Story 2.7), stage media (Story 2.6: the `UnstagedMediaError` P2 refusal stays), build the HTML worker (Story 2.5), or add the 2-second assembly bound and the response-compatibility fixtures (Story 2.4).
- Do not modify `documentCreator`, `documentUpdater`, `Document`, `Event`, `Model`, `DocumentHelper`, `ProsemirrorHelper`, `TextHelper`, `server/storage/database.ts`, or Sequelize. Do not call `documentUpdater` on the enforced path, take a `FOR UPDATE` document lock, or open Sequelize child transactions for the shell's own reads (use SQL `SAVEPOINT`/`RELEASE SAVEPOINT`/`ROLLBACK TO SAVEPOINT`).
- Do not change tool names, input schemas, descriptions, or the baseline branches. Add no enforcement to API/UI routes, `move_document`, or `restore_document`. Do not import the post-`v1.10.1` patch fix.
- Do not edit `sprint-status.yaml`, `deferred-work.md`, `epics.md`, `server/tools/README.md`, or the SPEC/PRD/spine. Do not add pilot identifiers.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid write | Each create (published, draft, template) and update (`replace`, `append`, `prepend`, `patch`, title-only, publish, unpublish) yielding a valid document | Row 6: persisted exactly the projection. `validated` (or `validated_with_warnings` with a discouraged structure), plus identity when `readable` | — |
| Hidden Error | `append`/`prepend`/`patch`/title-only with a valid-looking fragment, while unchanged content violates a rule | Row 4: `{ success: false, validation }` locating the Error in unchanged content. Document, revision, state, Events, Attachments, and structure unchanged | Modeled |
| Runtime failure | A contained link-batch read throws (closed; open within limits; open at limit+1 byte) | Rejected / `degraded_validation` persisted with the System Failure and Findings kept / rejected | Modeled |
| Late timeout | Open policy; the write is lock-queued past half the deadline, then times out in P5; versus no queueing | Rejected, versus `degraded_validation` persisted within the separate persistence budget | Modeled |
| Collection changed | The parent moved before P3, or the draft-publication target changed | Row 2 `collection_conflict`, no effect | `isError` |
| Before decision | P3 denial, deleted target, lock timeout; absent patch target; base64 image; cancellation; below the floor at P3/P4/P5 entry | Row 3, rolled back, `abortMessage` | `isError` |
| After decision | Unpublish with a child; no-change update; floor before commit | Row 5, rolled back (`Cannot unpublish document with child documents`, else `OPERATION_FAILED`) | `isError` |
| Commit | Resolves; server-reported rejection, row absent; socket error after a real commit, row present; socket loss before commit; hang | Row 6 with callbacks; row 5; row 6 with callbacks; row 7; row 7, with callbacks discarded even when the commit lands later | Per row |
| No document rules | Enforced policy with only hierarchy kinds | Row 6, `validated`, empty arrays | — |

</intent-contract>

## Code Map

- `server/tools/documents.ts:69-93,457-546,720-832` -- `nonBaselineWriteResult` (narrow its interim comment to HTML) and the two handlers. P0 for create is `authorizeDocumentCreate` plus the template lookup; P0 for update is `findByPk(includeState)` plus `authorize` and `authorizeDocumentPublish`. Extract each P0 into a function the shell reuses in P3 under the transaction. The baseline response assembly is at :533-542 and :787-828.
- `server/commands/documentUpdater.ts:117-160` -- read-only reference for the P7 tail (`publish && cId` / `changed` / save / re-fetch). Its `lock: transaction.LOCK.UPDATE` (:125) must not run on the enforced path.
- `server/commands/documentCreator.ts:148-275` -- the create writer: `content` wins over `text`/template (:206), `templateId` comes from `template`, and it re-fetches inside the transaction (:270).
- `server/models/Document.ts:1217,1319,556,629` -- `publish` (its collection lock is `NO_KEY_UPDATE`), `unpublishWithCtx` (throws `InvalidRequestError` with children and takes no event data), `processUpdate` (increments `revisionCount`), and `notifyCollaborationServer` (`afterCommit` on `transaction.parent || transaction`).
- `server/models/base/Model.ts:69-80,292-390` -- `saveWithCtx` → `insertEvent`. The Event name is `documents.<event.name ?? op>`, and `data` is `context.event.data`.
- `server/models/Event.ts:80-95` -- `AfterSave enqueue` registers `afterCommit` on `parent || transaction`. `createdAt` exists; `updatedAt: false`.
- `node_modules/sequelize/lib/transaction.js:18-53` -- the constructor pushes a child into `parent.savepoints`. `commit()` runs `_afterCommitHooks` in `finally`, even on failure, and sets `finished`. A child "commit" is a no-op that runs the child's hooks immediately.
- `server/storage/database.ts:57,167-181,333-380` -- pool max 5 (in tests), Sequelize retries `/deadlock/` queries, and `applyStatementTimeoutToTransactions` issues `SET LOCAL statement_timeout` in every `sequelize.transaction()`, savepoints included (hence the SQL savepoints). `/mcp` is not under `requestContextMiddleware`.
- `server/wikiLint/application/writeClassification.ts`, `writeDecision.ts:49,80,115`, `deadline.ts:11,74` -- `classifyWrite` (`entry`, `readable`, `documentId`), `withinWriteEligibility`, `decideWrite`, `abortMessage`, `SET_LOCAL_FLOOR_MS`, and `Deadline.batchTimeoutMs`.
- `server/wikiLint/adapters/documentProjection.ts:126-299` -- the P2/P4 functions, `ProjectedDocument`, and `UnstagedMediaError`. The update projection needs `includeState: true` (Story 2.2 residual).
- `server/wikiLint/adapters/documentReader.ts:59,96,215,248` -- `isDatabaseTimeout`, `boundBatch` (SET LOCAL from a `Deadline`), `findReadableDocuments`, and `resolveLinkTargets`. Give the latter an optional per-batch `read` wrapper.
- `server/wikiLint/application/lintDocument.ts:30,250-340` -- the read-surface pattern to mirror: `documentSurfaceRules`, `evaluateDocumentRules({ detailVisible })`, construction failures, and `deadline.expired()` before evaluation.
- `server/wikiLint/adapters/canonicalSyntax.ts:31`, `server/wikiLint/core/internalLinks.ts:81,109`, `server/wikiLint/core/ordering.ts:164`, `server/wikiLint/core/registry.ts:21,24,643,672` -- `toCanonicalMarkdown(content)`, `parseCanonicalMarkdown`, `extractInternalLinks`, `linkLookupBatches`, `sortIssues`, `COLLECTION_CONFLICT`, `OPERATION_FAILED`, `createFinding`, and `createSystemFailure`.
- `server/routes/mcp/index.ts:180-235` -- one stateless transport per request. The SDK aborts a handler's `extra.signal` on `transport.close()`. A stream cancel alone does not abort it.
- `server/tools/documents.enforcement.test.ts` -- existing fixtures to update:
  - :541 (enforced → `OPERATION_FAILED`);
  - :860 (draft publish fail-closed);
  - :895 (request-supplied values under enforced);
  - the helpers `configure`, `callWithoutEffect`, and `storedState`, and the `vi.mock` seams for `getPolicySet` and `monotonicClock`.
  `server/test/McpHelper.ts`'s `callMcpTool` and `TestServer.post` (node-fetch, accepts `signal`).

## Tasks & Acceptance

**Execution:**
- `server/wikiLint/application/deadline.ts` -- Add the five bound constants above, and an optional `reserveMs = 0` on `batchTimeoutMs` (floored remainder minus the reserve, floor-checked). `lintDocument.ts`: `LINT_DOCUMENT_DEADLINE_MS = VALIDATION_DEADLINE_MS`. -- AD-11 shared constants.
- `server/wikiLint/adapters/documentReader.ts` -- `resolveLinkTargets` gains `read?: <T>(run: () => Promise<T>) => Promise<T>`, which wraps only the per-batch `findReadableDocuments`. `boundBatch` stays outside it. -- Savepoint per read without duplicating the mapping.
- `server/wikiLint/adapters/writeTransaction.ts` (new) -- holds the transaction mechanics:
  - `EnforcementTransaction.open(invocationId)`, which records `startedAt`, installs the buffering on the transaction, and patches `savepoints.push` recursively to buffer children and mark rolled-back ones;
  - `setLocalTimeouts(ms)`, `lockCollection(id)`, `lockDocument(id)`, and `savepoint(run)`. `savepoint` throws `ContainedReadError(cause)` only after a successful `ROLLBACK TO SAVEPOINT`;
  - `rollback()`, which swallows errors;
  - `commit(timerMs)` → `{ committed: true } | { committed: false; error }`;
  - `runCallbacks(boundMs, onFailure)`;
  - the module-level `probeCommit(target, boundMs)` → `"present" | "absent" | "unavailable"`, `isServerReported(error)`, and the Event correlation hook.
  -- AD-8/AD-20 mechanics.
- `server/wikiLint/adapters/projectionWriter.ts` (new) -- `persistProjectedCreate(ctx, projection, template)` and `persistProjectedUpdate(ctx, { document, projection, input })`, as in Always; both return the in-transaction re-fetch. -- P7 through the baseline hooks.
- `server/wikiLint/application/enforcedWrite.ts` (new) -- this module holds:
  - `EnforcedWriteOutcome` (`{row:2}|{row:3|5,message}|{row:4,validation}|{row:6,document,validation}|{row:7}`);
  - `validateProjection(...)`, exported for unit tests;
  - `writeValidation(...)`;
  - `enforceMarkdownCreate` and `enforceMarkdownUpdate`, which share one internal attempt runner. Their inputs are `ctx`, the `enforced` classification, the mapped Story 2.2 input, the reauthorize callback, `signal`, `requestId`, and `instanceOrigin`.
  -- AC1–AC13.
- `server/tools/documents.ts` -- Extract the P0 helpers. Route `enforced` Markdown writes to the shell, and map rows to results as in Always. -- AC1, AC5–AC13.
- `server/routes/mcp/index.ts` -- After `server.connect(transport)`: `ctx.res.on("close", () => { if (!ctx.res.writableFinished) void transport.close(); })`, with a two-line comment. -- AC12 disconnect.
- `server/wikiLint/application/deadline.test.ts` and `server/wikiLint/adapters/documentReader.test.ts` -- cover `reserveMs` and the `read` wrapper.
- `server/wikiLint/adapters/writeTransaction.test.ts` (new, DB) -- cover:
  - buffering: direct, child, grandchild, `child.parent.afterCommit`, a rolled-back savepoint, and Sequelize's `_afterCommitHooks` staying empty;
  - registration order, isolation of a throwing, rejecting, or hanging callback, and the bound;
  - discard after a rejected commit;
  - SQL-savepoint containment, and an unusable transaction that is not contained;
  - each probe outcome, including `unavailable` below the floor and on a stalled acquisition;
  - `isServerReported` on a real `SELECT 1/0` error versus a plain or socket error;
  - correlation on Events created by `saveWithCtx`/`publish`/`unpublishWithCtx`/`documentCreator` inside the transaction, and none outside it.
- `server/wikiLint/adapters/projectionWriter.test.ts` (new, DB) -- persisted title/content/text/decoded state/publication/structure equal the projection for create (template, draft) and for every update mode. No `FOR UPDATE` statement is issued.
- `server/wikiLint/application/enforcedWrite.test.ts` (new) -- `validateProjection` units with a fake resolver:
  - a missing target state → `VALIDATION_RUNTIME_FAILED` with the other kinds' Findings kept;
  - `DeadlineFloorError` and a contained timeout → `VALIDATION_TIMEOUT`;
  - an expired deadline → TIMEOUT with no Findings;
  - a non-contained error propagates;
  - no document rules → empty;
  - `detail` and `collectionId` gating, and measures.
  DB-backed shell fixtures for the rows the I/O matrix lists. Phase floors are driven through the mocked clock by a `sequelize.query` spy that advances it after the n-th `SET LOCAL lock_timeout`. There is also the bounds-sum check.
- `server/wikiLint/application/enforcedWrite.concurrency.test.ts` (new, DB) -- the AC14 real-PostgreSQL fixtures below. A `sequelize.query` spy can hold a chosen statement until the test releases it.
- `server/tools/documents.enforcement.test.ts` -- update the :541, :860, and :895 fixtures to the new rows, normalizing the pre-allocated `documentId` in compared rejections. Add an effect check that allows the transaction but no INSERT/UPDATE/DELETE before a row-4 decision, and unchanged stored rows. Add MCP-level fixtures for the I/O-matrix rows, AC13, AC15, the API-route boundary, the HTML interim, and `includeState` (an `append` to a document with Y.js state persists the appended content in the decoded state).

**Acceptance Criteria:**
- Given an enforced write that ends in row 2, 3, 4, 5, or 7, when its stored state is compared with the state before the call, then no document, revision, `state`, collection-structure, Attachment, or Event change remains. The `globalEventQueue` and collaboration-notify callbacks never ran. A row-4 attempt issued no INSERT, UPDATE, or DELETE.
- Given the SQL of an enforced update, when it is recorded, then:
  - the collection `FOR NO KEY UPDATE` precedes the document `FOR NO KEY UPDATE`;
  - no `FOR UPDATE` row lock and no parent lock on a create appear;
  - every `SET LOCAL` value is an integer ≥ `SET_LOCAL_FLOOR_MS`, and none falls between a `SAVEPOINT` and its `RELEASE`/`ROLLBACK TO`.
  Advancing the clock below the floor at the P4 or P5 entry yields row 3, after P5 began yields `VALIDATION_TIMEOUT`, and before `commit()` yields row 5.
- Given real PostgreSQL, when each runs, then:
  - an enforced MCP update of a parent, held mid-transaction while a baseline API child create under it starts, lets both commit with no deadlock;
  - a baseline document-first transaction (document `FOR UPDATE`, then the collection) that deadlocks with a blocked enforced update ends the enforced write in row 3 with no effect, and the baseline commits;
  - a `commit()` that hangs ends in row 7;
  - a real server-reported COMMIT error (a temporary deferred constraint trigger keyed to the fixture's document) ends in row 5;
  - a socket destroyed before COMMIT ends in row 7;
  - a socket error after a real COMMIT, with the row present, ends in row 6;
  - a parent moved out of band between the re-fetch and the commit of a create is not prevented, and a later `lint_wiki` with `parent_collection_consistent` reports `PARENT_COLLECTION_MISMATCH`.
- Given two actors, one able to read a linked target and one not, and a missing, a deleted, and an inaccessible target, when each creates and runs every update mode, then the second actor's responses differ only in the expected `INTERNAL_LINK_TARGET_UNRESOLVED` Findings at text locations. No response contains a target's ID, URL identifier, or title.
- Given an abort of the handler signal before the decision, or a client disconnect (`TestServer.post` with an aborted `signal`) while the write is held before P6, when the attempt ends, then nothing persisted. Given the same disconnect held in P7, the write commits.
- Given `documents.create`/`documents.update` API calls into an enforced collection with invalid content, when they run, then they succeed as baseline with no `validation`.

## Spec Change Log

## Review Triage Log

### 2026-10-03 — Review pass

- verdicts: 36 findings — high 0, medium 7, low 17, false 12, maybe-false 0
- findings:
  - `[medium]` `[defer]` blind: rows 3, 5, and 7 are never logged; `requestId` is used only by the callback warning — Real. It is the same policy gap as Epic 1 retrospective item 9 (F-6), which the project deferred to Epic 3 hardening. Recorded in `deferred`.
  - `[low]` `[reject]` blind: row 7 returns the same `OPERATION_FAILED` as a rolled-back row 3/5, so a retried create can duplicate a landed commit — The intent requires exactly this result: 2.3 AC9 and AD-20 row 7 give the fixed generic message with no claim about persistence, and record the unestablished commit as a residual. A distinct message or handle would contradict the binding contract.
  - `[low]` `[reject]` blind: `guarded` drops enrichment errors without logging — AD-12 and Story 2.4 AC2 specify that a failed enrichment is omitted. The post-commit assembly boundary, including any diagnostics, is Story 2.4's intent. Adding a logging surface is more than a direct correction, for an unlikely path.
  - `[low]` `[patch]` blind: the row-6 fallbacks and the handler's row-7 mapping are untested — Grouped with the exhaustiveness row: an explicit `case 7` plus a `never` check now pins the row-7 mapping statically. The enrichment-omission and identity-fallback fixtures belong to Story 2.4 AC2, which the intent assigns to that story.
  - `[medium]` `[patch]` blind: the update commit probe (Event name, `startedAt`, `invocationId`) is never exercised on its present path — Fixed: the "socket error after a real COMMIT" fixture in `enforcedWrite.concurrency.test.ts` now covers create, title-only, draft publication, and unpublish. Each ends in row 6 with the callbacks run, which is reachable only if the update probe finds the correlated Event.
  - `[medium]` `[patch]` blind: the shell tests re-implement the handler's P0, the copies drift (the concurrency `update` omits the publication `collectionId`), and the handler's transaction binding is unpinned — Grouped with the verification-gap re-fetch row: an MCP `update_document` collection-conflict fixture now runs the real `authorizeUpdateInput` under the lock. The drifted publication branch of the concurrency copy is never called with `publish: true`.
  - `[low]` `[patch]` blind: the `/mcp` close hook misses a disconnect before it is attached, and `void transport.close()` can leave a rejection unhandled — Fixed: `.catch(() => undefined)` on the close. The early-window part is rejected with the edge-case row below.
  - `[false]` `[reject]` blind: `readable` is not re-checked under the lock — AD-8/AD-12 and Story 2.1 AC2 require `readable` to be computed once in P1 and passed through. A P3 re-check would contradict the contract, so the classification-time flag is the specified source of identity visibility.
  - `[low]` `[reject]` blind: the post-commit callback warning omits the error and the document — The intent requires a minimized correlated diagnostic (AD-20, AC10), and the spec fixes its shape to `{ requestId, invocationId, reason }`. Widening it is beyond a direct correction, for an unlikely path.
  - `[low]` `[reject]` blind: the commit probe keeps waiting for a pool connection after its timer fires — Real but reachable only on row 7 under pool exhaustion. The fix adds an expiry flag and an extra branch, which is more than a direct correction for a rare path. The stale lookup still rolls back and is bounded by the pool's acquire timeout.
  - `[low]` `[reject]` blind: the bound tests never run with the production timeout wrapper or Sequelize child savepoints — No writer on these paths opens a child transaction: the membership copies use `create(..., { transaction, hooks: false })`. The shell's own reads use SQL savepoints, which the matcher covers. The production-wrapper residual is recorded under Residual risks.
  - `[false]` `[reject]` blind: `batchTimeoutMs(reserveMs)` does not validate the reserve — Every caller passes the integer constant `COMMIT_PROBE_BOUND_MS`, so neither a negative nor a fractional reserve can reach it.
  - `[low]` `[patch]` blind: row 7 reaches its result only through `default`, with no exhaustiveness check — Fixed: `enforcedWriteResult` has an explicit `case 7`, and `default` is a `never` assignment, so a new row fails `tsc`.
  - `[false]` `[reject]` edge: the commit timer uses the whole persistence remainder, so a timer expiry leaves no probe time — AC9 and AD-11 set the `commit()` timer equal to the remaining persistence budget and the probe's timer to that remainder bounded at 2 s. They list "a probe that cannot run" as row 7. The Design Notes record this arithmetic, which keeps the 55 s sum.
  - `[low]` `[reject]` edge: consecutive statements in P3 or P7 can each wait up to the remainder set once per phase — Real. AC3 and AD-11 issue `SET LOCAL` per phase boundary and per batch, which the shell does, and the attempt still ends by phase (row 3 at P4 or P5 entry, row 5 before commit). An overrun needs two long lock waits in one P3. Re-issuing per statement would re-index every clock-driven phase fixture, which is more than a direct correction.
  - `[low]` `[reject]` edge: a backward wall-clock step between `startedAt` and the Event's `createdAt` would make the probe miss a committed update — It needs a clock step plus a commit rejection. AC9 explicitly requires the `createdAt` since-start predicate, so dropping it would contradict the intent.
  - `[low]` `[reject]` edge: a client that disconnects before the close listener is attached is not observed — Real but the window is milliseconds (auth, `user.save`, server creation). A transport closed before `handleRequest` does not abort later handlers, so the fix would have to skip processing a disconnected request. That changes the baseline for unconfigured writes, or else needs new surface in the auth info.
  - `[false]` `[reject]` edge: a child registers through `transaction.parent.afterCommit` and then rolls back, so a root-owned enqueue survives — No writer on the enforced paths creates a child transaction (membership copies use `create(..., { hooks: false })`), so this is unreachable. AC10 drops only callbacks registered on a rolled-back savepoint, which is also Sequelize's baseline semantics for `parent || transaction` registrations.
  - `[low]` `[reject]` edge: post-commit enrichment queries have no time bound — The 2 s total assembly bound is Story 2.4 AC2, which the intent assigns to that story. Only the buffered callbacks are bounded here, as AC10 requires.
  - `[false]` `[reject]` edge: `readable` is not re-checked under the lock — Same refutation as the blind row: the contract fixes `readable` at P1.
  - `[low]` `[reject]` edge (claim): the spec's first AC lists row 7 among rows with no remaining change, yet a row-7 commit can land — The code follows AD-20 row 7 (no claim about persistence), and the hang fixture shows the landing with no callbacks run. The fix would edit this spec's acceptance wording, which this workflow rejects.
  - `[false]` `[reject]` edge (claim): a timer-rejected commit is never probed — Same refutation as the first edge row: AC9's commit timer equals the remaining budget, so the probe cannot run, which is specified as row 7.
  - `[medium]` `[patch]` verification-gap: the update probe's present path is unexercised through the shell — Grouped with the blind probe row; same fixture added.
  - `[low]` `[patch]` verification-gap: expiry of the P2 preparation bound is untested at the shell — Fixed: an `enforcedWrite.test.ts` fixture advances the clock by `WRITE_PREPARATION_BOUND_MS` between the preparation deadline and opening. It expects `{ row: 3, message: OPERATION_FAILED }`, no `sequelize.transaction` call, and no effect.
  - `[medium]` `[patch]` verification-gap: the handler's P3 re-fetch for `update_document` is verified only through test-local P0 copies — Fixed: `documents.enforcement.test.ts` moves the target out of band when the collection `FOR NO KEY UPDATE` statement runs, and asserts `{"error":{"id":"collection_conflict"}}` with no `globalEventQueue` call and no stored change.
  - `[medium]` `[patch]` verification-gap: the handler's field mapping (`icon`, `color`, `fullWidth`, `sourceFileName`, `parentDocumentId`) is unverified — Fixed: `VALID_WRITES` gains a display-field create, a `sourceFileName` create, a parent-derived create, and a display-field-only update. Their stored `icon`/`color`/`fullWidth`/`sourceMetadata`/`parentDocumentId` are compared with the baseline result.
  - `[low]` `[reject]` verification-gap: the guarded enrichments and the identity fallback have no tests — The intent assigns these response-compatibility fixtures to Story 2.4 AC2. Filed disposition `defer`; rejected as owned by the later story.
  - `[false]` `[reject]` intent: no `wikiLint.write_validation` summary (R1 AC8, AC11) — The project's cross-story convention assigns behavior delivered by a later story to it: `2.3 AC11 -> 2.7`, and Story 2.7 AC1/AC9 deliver one summary per AD-20 row, both aborted outcomes included. The correlation that AC9's probe needs is implemented here.
  - `[false]` `[reject]` intent: the re-lock is bypassed rather than downgraded — The observable AD-8 requirement holds: the document lock is `FOR NO KEY UPDATE` and no `FOR UPDATE` occurs, which the SQL recorder and the mutation run (re-adding `FOR UPDATE` fails the suites) prove. Bypassing `documentUpdater` also satisfies 2.2 AC6 (no re-applied edit).
  - `[medium]` `[patch]` intent: many guarantees are tested at the shell surface through a test-local P0 — Grouped with the verification-gap re-fetch row: the handler's own `authorizeUpdateInput` re-fetch is now pinned at the MCP surface. The shell fixtures exercise the same production shell the handler calls.
  - `[low]` `[patch]` intent: row 7, the row-6 fallback, guarded omission, and the warning shape are not exercised — Grouped with the exhaustiveness row: the row-7 mapping is now explicit and type-checked. The fallback and omission fixtures are Story 2.4 AC2's, and the warning reasons are covered at adapter level (`runCallbacks` tests).
  - `[false]` `[reject]` intent: the AC14 fixtures run at shell level with a hand-written document-first writer and injected COMMIT error shapes — Every fixture runs on the real test PostgreSQL. The hand-written writer takes exactly the lock order of `documentUpdater` plus `updateCollectionStructure` (document `FOR UPDATE`, then the collection). The server-reported error is real (deferred constraint trigger) and the socket loss is a real destroyed stream; only "row present after a socket error" injects the error after a real COMMIT, which PostgreSQL cannot produce on demand.
  - `[false]` `[reject]` intent: no test sends `notifications/cancelled` — The stateless `/mcp` creates one server per request, so a cancellation notification from another request can never reach a running handler. The reachable channels, an aborted signal (shell) and an HTTP disconnect (MCP), are both tested.
  - `[false]` `[reject]` intent: at the MCP level, the stored result is compared with the baseline, not with the projection — Layered evidence: `projectionWriter.test.ts` compares stored rows with the projection, and Story 2.2 proved projection-baseline parity.
  - `[low]` `[reject]` intent: the 2 s post-commit bound covers only the callbacks — Grouped with the edge enrichment-bound row: the intent assigns the assembly bound to Story 2.4 AC2.
  - `[false]` `[reject]` intent: an unpublish or title-only update of a document with an invalid body is rejected — Descriptive. It is required by AC5 (every operation validates the full resulting document), not a defect.

### 2026-10-03 — Follow-up review pass

- verdicts: 20 findings — high 0, medium 3, low 16, false 1, maybe-false 0
- findings:
  - `[low]` `[reject]` blind: row-7 no-effect acceptance conflicts with a late COMMIT — Carried: the prior pass documented that the late commit can land and that this workflow rejects a spec-only edit.
  - `[medium]` `[patch]` blind: a policy with no document rules can pass after the P5 deadline — `validateProjection` now checks expiration before the empty-rule return; a targeted test proves `VALIDATION_TIMEOUT`.
  - `[low]` `[patch]` blind: canonicalization failure after expiry was labeled runtime failure — The catch now gives timeout precedence; a targeted test covers the expired error path. Grouped with the deadline patch.
  - `[low]` `[reject]` blind: multiple P3 statements can exceed a phase budget — Carried: the prior pass verified the per-phase SQL bounds required by AC3; per-statement rebounding adds machinery for an unusual pair of long waits.
  - `[low]` `[reject]` blind: a stalled rollback can delay a row-3/5 response — `rollback()` awaits Sequelize and has no timer, but a persistent transport stall is exceptional; connection destruction and bounded rollback need state handling beyond a direct correction.
  - `[low]` `[reject]` blind: an early client disconnect can precede the close listener — Carried: the prior pass documented the small pre-listener window and the broader handler change required to close it.
  - `[low]` `[reject]` blind: post-commit response enrichment is unbounded — Carried: Story 2.4 owns the total assembly bound; Story 2.3 bounds the callbacks.
  - `[low]` `[reject]` blind: a rejected `globalEventQueue().add` is not logged by callback buffering — The pre-existing `Event.enqueue` callback returns `void`, so its promise cannot be observed by `runCallbacks`; changing `Event` is excluded by this story's intent, and callback rejection reporting works for callbacks that return promises.
  - `[low]` `[reject]` blind: an expired commit probe keeps its pool waiter alive — Carried: the prior pass verified this rare pool-exhaustion path and rejected extra cancellation state.
  - `[low]` `[reject]` blind: row 7 lacks an MCP fixture — Carried: the prior pass added an explicit `case 7` and exhaustive outcome check; the fixture would duplicate the shell's row-7 tests.
  - `[low]` `[reject]` blind: the MCP valid-write matrix omits some stored fields and effects — The projection writer checks stored projection fields, Story 2.2 established projection parity, and MCP tests compare mapped fields; a second full state/effect matrix adds little coverage.
  - `[low]` `[reject]` blind: P3 permission loss and template deletion lack separate MCP fixtures — P3 calls the same authorization helpers as P0 under the transaction, and the MCP collection-conflict fixture exercises the transaction-bound re-fetch; two more race fixtures are disproportionate to this residual risk.
  - `[medium]` `[patch]` edge: the no-rule path returns clean after deadline expiry — Same root and fix as the blind no-rule finding; the timeout test exercises this path.
  - `[medium]` `[patch]` edge: synchronous rule evaluation can cross the deadline — `validateProjection` now checks again after evaluation and discards Findings on expiry; a targeted test advances the clock at that boundary. Grouped with the deadline patch.
  - `[low]` `[reject]` edge: rollback can stall indefinitely — Same verified exceptional rollback path as the blind finding; a timer alone would leave uncertain connection and lock ownership.
  - `[low]` `[reject]` edge (claim): row 7 may land despite the no-effect acceptance wording — Carried: the implementation and prior pass already record late-COMMIT ambiguity; a spec-only edit is rejected by this workflow.
  - `[low]` `[reject]` verification-gap: response identity values are not compared with stored values — The gap is real, but response compatibility fixtures are assigned to Story 2.4 in the invocation intent; the successful path uses the committed document.
  - `[low]` `[reject]` verification-gap: guarded identity fallback has no failure-path fixture — Carried: the prior pass assigned these response fixtures to Story 2.4 AC2.
  - `[false]` `[reject]` intent: P6 has no separate `SET LOCAL` — P6 performs only in-memory issue partition and decision; no SQL runs there, and P7 sets its own bound before persistence.
  - `[low]` `[reject]` intent: `POST_COMMIT_ASSEMBLY_BOUND_MS` could imply a full response bound — Carried: the intent explicitly limits Story 2.3's timer to callbacks and assigns response assembly to Story 2.4.

## Design Notes

**Why not `documentUpdater`.** It re-applies the edit (forbidden by 2.2 AC6), and its `FOR UPDATE` re-lock conflicts with a concurrent child insert's `KEY SHARE` on the parent. That child then waits on the collection lock the enforced write holds, so the two deadlock. P7 therefore replays only the updater's tail on the locked instance. The create path keeps `documentCreator`: given `content`, it neither parses nor substitutes. Its `text = toMarkdown(content)` is the serializer that produced `projection.text`, and the projection-writer test asserts equality.

**SQL savepoints.** `sequelize.transaction({ transaction })` would issue the baseline `SET LOCAL statement_timeout` inside the savepoint, overriding the AD-11 value, and would add a child transaction whose hooks need buffering. A raw `SAVEPOINT` keeps the timeout and the hook lists under the shell's control.

**Validation (P5).**

```ts
if (!rules.length) return { items: [] };                    // validated
md = await toCanonicalMarkdown(content); bytes = byteLength(md);
syntax = parse(md); refs = extractInternalLinks(syntax.links, origin);  // throw → RUNTIME_FAILED, no rules
try targets = await resolve(linkLookupBatches(refs))        // only when internal_links is enabled
catch Floor → TIMEOUT; Contained → isDatabaseTimeout ? TIMEOUT : RUNTIME_FAILED; else rethrow (row 3)
if (deadline.expired()) → TIMEOUT, no evaluation
evaluate(rules minus internal_links when resolution failed, detailVisible: readable)
codes = {resolution code?, RUNTIME_FAILED if failedKinds}   // one per code
```

**Unchanged update → `OPERATION_FAILED`.** AD-20 defines "baseline content" as the message of an Outline application error with a stable `id`. The baseline's no-change result is a plain handler string, not such an error, so row 5 carries the fixed message.

**Probe arithmetic.** The commit timer is the whole persistence remainder, and the probe gets `min(2000, remainder)`. A hung commit therefore leaves no probe time and ends in row 7. The pre-commit statement timeout (remainder − 2000) normally makes the server fail first, which leaves the probe its 2 s. The 55 s sum holds.

## Verification

**Commands:**
- `scripts/test-db.sh ensure` -- expected: exit 0. A non-zero exit blocks the story before any DB-backed suite runs.
- `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint server/tools/documents.test.ts server/tools/documents.enforcement.test.ts server/tools/wikiLint.test.ts server/routes/mcp` -- expected: all pass.
- `corepack yarn tsc` -- expected: exit 0.
- `node_modules/.bin/oxlint --type-aware` and `node_modules/.bin/oxfmt --check` on the changed files -- expected: clean.
- `git diff 4a5a616a21be800257dc11cef4263d0dd0412156 -- server/models server/commands shared/utils server/editor server/storage` -- expected: empty.
- Temporary mutations, each reverted afterwards -- expected: a suite fails for each:
  - lock the document `FOR UPDATE` in P7;
  - run the buffered callbacks after a rejected commit;
  - drop the `readable` gate on the identity;
  - re-fetch without `includeState`;
  - skip the unchanged-update check;
  - ignore the signal before P6.

## Auto Run Result

Status: done

**Summary.** Story 2.3's enforced Markdown create and update path remains implemented through the atomic P2–P8 transaction, commit probe, buffered post-commit callbacks, and MCP row mapping. This follow-up review closed a validation-deadline gap: expiration now takes precedence before an empty-rule return, after canonicalization failure, and after synchronous rule evaluation. Expired validation returns `VALIDATION_TIMEOUT` without Findings.

**Files changed in this pass.**
- `server/wikiLint/application/enforcedWrite.ts` — deadline checks and timeout precedence in `validateProjection`.
- `server/wikiLint/application/enforcedWrite.test.ts` — three targeted deadline regressions.
- This spec — follow-up triage, verified result, and terminal status.

**Review.** 20 finding rows: high 0, medium 3, low 16, false 1, maybe-false 0. Four rows formed one medium deadline-fix entry. No new item was deferred. The 16 rejected rows and each reason are recorded individually in the 2026-10-03 follow-up `Review Triage Log`: prior resolved or out-of-scope findings were carried; exceptional rollback and queue behavior require broader state handling; extra MCP fixtures duplicate layered coverage or belong to Story 2.4; P6 issues no SQL. Patched entries by verdict: high 0, medium 1, low 0. Follow-up review recommended: false.

**Verification (2026-10-03).** `scripts/test-db.sh ensure` exited 0; the targeted `enforcedWrite.test.ts` suite passed 57 tests; the specified server scope passed 35 files and 1423 tests; `corepack yarn tsc`, targeted type-aware `oxlint`, targeted `oxfmt --check`, `git diff --check`, and the protected-baseline diff over `server/models`, `server/commands`, `shared/utils`, `server/editor`, and `server/storage` all exited 0. The six temporary mutation checks are recorded in the prior pass and were not repeated after this narrow deadline patch.

**Residual risks.** A late row-7 COMMIT can still land after an inconclusive result and will not run buffered callbacks. Rollback has no wall-clock timer, and pre-listener disconnects are not observed. Response assembly bounds and compatibility fixtures remain with Story 2.4; audit summaries, media staging, and the HTML worker remain with their assigned stories. The existing deferred operator-log gap remains in this spec's `deferred` field; the orchestrator-owned ledger and sprint board were not edited.
