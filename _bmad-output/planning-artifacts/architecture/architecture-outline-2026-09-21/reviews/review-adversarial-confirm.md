# Adversarial Divergence Review, Confirmation Pass (2026-09-30)

**Spine reviewed:** `ARCHITECTURE-SPINE.md` (AD-1 through AD-20, `updated: 2026-09-30`)
**Lens:** construct two units one level down that each obey every AD to the letter yet still build incompatibly: clashing shared-data shapes, two owners of one entity, conflicting state-mutation paths.
**Scope:** (1) status of the 15 first-round Critical and High findings; (2) new divergence pairs introduced by the fixes or missed before; (3) severity and the minimal tightening for each.
**Not reported (known and accepted):** the "Pending PRD alignment" conflicts; the D-9 items (tool contracts, exact link forms, orphan sweeper, AD-16 cap versus the baseline document limit); creates and publications taking no parent lock, with the documented residual window; the baseline authorization gap reported separately.
**Read-only:** no file other than this one was written.

**Evidence base.** The spine, the memlog, the three first-round reports, and the baseline code at `HEAD` (only `server/tools/README.md` differs from `v1.10.1^{}` in code paths): `server/queues/tasks/DocumentImportTask.ts`, `server/queues/queue.ts`, `server/queues/tasks/base/BaseTask.ts`, `server/tools/documents.ts`, `server/commands/documentUpdater.ts`, `server/commands/documentCreator.ts`, `server/models/Document.ts` (`publish`), `server/models/Event.ts`, `server/routes/api/events/events.ts`, `shared/utils/EventHelper.ts`, `server/routes/mcp/index.ts`, `server/index.ts`, `server/main.ts`, `server/storage/database.ts`, `server/logging/Logger.ts`. `node_modules` is not installed in the checkout, so Sequelize 6.37.8 (the lockfile version) was read from the tarball already extracted in the session scratchpad (`.../scratchpad/seq/package/lib/{transaction,sequelize}.js`). Repo currentness: `git status` shows the branch one commit ahead of `origin/feature/mcp-wiki-linting-v1.10.1`; `git fetch` was not run because the task is read-only, so upstream currentness is unverified (irrelevant for a fixed baseline).

## Verdict

The first-round structure is largely repaired: 13 of the 15 Critical/High findings are closed, none is open, and the two that remain partial are one defect seen twice (the HTML worker boundary, A-1 and H-1). The fixes themselves introduced or exposed four new High divergence pairs, all in the same neighbourhood: how AD-20 decides that a commit happened (N-1), how the new deadlines are actually enforced and how they interact with fail-open (N-2), whether the `EnforcedImportResult` union can carry the outcomes AD-8 and AD-20 require (N-3), and which documents `lint_wiki` evaluates (N-4). Six Medium and eight Low pairs follow. The spine is not yet a safe build substrate for the HTML path and for the fail-open write path; the Markdown reject/commit paths are close.

## 1. First-round Critical and High findings

| ID | Sev | Status | Reason against the current text |
| --- | --- | --- | --- |
| A-1 | Critical | **PARTIALLY CLOSED** | The two-owner hole is closed: the worker is the sole owner of evaluation, decision, commit, and summary; the requester writes only pre-scheduling outcomes; `readable` travels in the intent; row 7 covers a lost result. Still open inside the same contract: the result union has no variant for AD-8's `collection_conflict` (row 2) or for a worker-side unknown COMMIT (row 7), and `aborted` carries no message although rows 3 and 5 promise "baseline content"; "job failure" (row 7) overlaps the row 3/5 catch-all; redelivery has no store for "the validation recorded for `invocationId`" and no defined position for the found-row check; `deadlineAt` has no defined value or clock and defeats fail-open on this path (N-2, N-3). |
| A-2 | High | CLOSED | The P0..P8 table selects rows by phase. Re-authorization precedes the collection comparison (P3, worker order), the worker compares the fingerprint before converting (AD-7), a missing re-fetch target is P3 row 3. Small cell/text contradictions remain (N-8) but none reopens the three original pairs. |
| A-3 | High | CLOSED | AD-8 requires a savepoint for every related-state read that can yield a fail-open-eligible System Failure; a transaction-invalidating failure is row 3 before the decision and row 5 after. |
| A-4 | High | CLOSED (writes) | AD-11 now defines a code-owned 9 s validation deadline, one write unit, Findings retained, no rule kind skipped. The same question on the read surfaces is open (N-5); the deadline's enforcement is open (N-2). |
| A-5 | High | CLOSED | The `Surfaces` column fixes which codes run on writes (`document` only) and on `lint_wiki` (`wiki`). |
| A-6 | High | CLOSED | AD-8 names `collection_conflict` and its carrier (`isError`, first text block `{ "error": { "id": "collection_conflict" } }`, no collection). The HTML worker cannot yet carry it back (N-3a), which is a worker-contract gap, not an identifier gap. |
| A-7 | High | CLOSED | Lock, then read; content-dependent edits inside the transaction; the parent-lock window is a documented residual. The stated invariant holds for updates by Postgres row-lock semantics: any UPDATE of the locked row (a move, a collaborative save) waits for the transaction. Lock order is a residual (N-18). |
| B-1 | High | CLOSED | Malformed (any RFC 8259 violation, BOM, invalid UTF-8) is startup-fatal; lexical defects inside an identifiable entry are sentinels; duplicates compared after unescaping; span edges and interior bytes defined. No new pair found. |
| B-2 | High | CLOSED | Lowercase canonical 8-4-4-4-12 keys only; anything else is unidentifiable and fatal. |
| C-1 | High | CLOSED | Read-side visibility is `can(actor, "read", collection)`; document readers are evaluated under the document's collection policy; identifiers are omitted, not invented. Two Low residuals: N-15. |
| C-2 | High | CLOSED | Rank (`text` 0, `document` 1, `relationship` 2, `scope` 3), path comparison, and the ordinal are defined; absent-last makes the order total for scope-located failures. |
| C-3 | High | CLOSED | The pre-allocated `documentCreator` id is the projection id, the `documentId` of every location, and is in no Event column unless the row commits. |
| D-1 | High | CLOSED | Event columns are pinned (`teamId`, `actorId`, `ip`, `authType`, null `userId`/`modelId`), the rows are not enqueued, and the names are excluded from `ACTIVITY_EVENTS`. The mechanism is left open (N-17, Low). |
| H-1 | High | **PARTIALLY CLOSED** | Same defect as A-1; see above. |
| H-2 | High | CLOSED | The decision is a `/mcp`-scoped socket-timeout override plus code-owned `SET LOCAL` timeouts, with an AD-18 test and OD-7 evidence for proxies. Whether the deadlines are then actually enforced is N-2. |

**Counts: 13 CLOSED, 2 PARTIALLY CLOSED (A-1, H-1), 0 OPEN.**

## 2. New findings index

| ID | Sev | ADs | One line |
| --- | --- | --- | --- |
| N-1 | High | AD-20 (P8, rows 5/6/7), AD-15, AD-8 | The stated commit test `transaction.finished === "commit"` is true after a failed COMMIT in Sequelize 6.37.8; rows 5, 6, and 7 cannot be told apart. |
| N-2 | High | AD-11, AD-13, AD-7, AD-20 | The 9 s and 60 s deadlines are not enforceable as written: P2 is charged to the deadline, per-statement caps are not cumulative, `SET LOCAL ... = 0` disables the bound, a fail-open timeout has no persistence budget, and `deadlineAt` is undefined. |
| N-3 | High | AD-7, AD-8, AD-14, AD-20 | `EnforcedImportResult` cannot carry row 2 or a worker-side row 7, has no message carrier, and redelivery/duplicate attempts have no defined behaviour or store. |
| N-4 | High | AD-9, AD-10, AD-16, AD-3 | The document set of `lint_wiki` (drafts, archived) is defined nowhere; snapshot builder and hierarchy rules will disagree. |
| N-5 | Medium | AD-11, AD-12 | Rule-kind failure inside a document unit on `lint_document` and `lint_wiki`: retain or discard Findings, unit completed or not, one System Failure per document or per check. |
| N-6 | Medium | AD-5, AD-19 | "Loaded once at startup" is per worker process; a throng respawn re-reads the file, so one instance can serve two policy sets. |
| N-7 | Medium | AD-19, AD-6 | "Any collection has `activation: enforced`" is undefined for sentinels; an absent config has no defined fingerprint value. |
| N-8 | Medium | AD-20, AD-8 | Phase-table cells contradict the body text (P5 connection loss, P1 failure), and `revisionCount` for the unchanged-update check is sampled at an unstated point. |
| N-9 | Medium | AD-7, AD-8, AD-20 | The staged-blob key scheme, the materialize mechanics (copy inside the transaction versus in place), and the cleanup owner after rows 5 and 7 are undefined. |
| N-10 | Medium | AD-7, AD-14, Conventions | Monotonic-clock values (`deadlineAt`, `durationMs`) cross a process boundary. |
| N-11 | Low | AD-4, AD-12 | Location of runtime System Failures on the write surface (`scope{document}` versus `scope{collection}`). |
| N-12 | Low | AD-15 | `events.list` behaviour for an `auditWikiLint`-only caller requesting other names; whether the names enter shared `AUDIT_EVENTS`. |
| N-13 | Low | AD-7 | "The queue's failure logging emits neither content nor actor fields" is false against baseline `queue.ts`. |
| N-14 | Low | AD-11 | "A global snapshot failure **may** return no findings" leaves `failed` versus `incomplete` to the implementer. |
| N-15 | Low | AD-12 | `state` reveals whether an unreadable collection is configured; the unreadable-sentinel location is ambiguous. |
| N-16 | Low | AD-3, AD-9 | `PARENT_DOCUMENT_UNRESOLVED` "in scope": a parent that is readable but outside the configured scope. |
| N-17 | Low | AD-14, AD-15 | Audit insert mechanism: the 3 s bound does not cancel the statement; `hooks: false` skips `cleanupIp`; idempotence mechanism unstated. |
| N-18 | Low | AD-8, AD-20 | Lock order for an enforced update with publish (document row, then collection row) is the reverse of `documentMover` (collection rows, then document rows); deadlocks are possible and unplaced by name. |

---

## 3. Detailed findings

### N-1 (High). AD-20's commit test cannot separate "COMMIT succeeded" from "COMMIT failed"

**ADs:** AD-20 rule paragraph ("A commit is established when the transaction has issued COMMIT successfully (`transaction.finished === "commit"`); a failing `afterCommit` hook after that point is row 6"), P8, rows 5, 6, 7; AD-15 (audit after commit); AD-8 ("success is returned only after commit").

**Baseline fact.** Sequelize 6.37.8 `Transaction.commit()` (`lib/transaction.js:39-56`):

```text
try   { await commitTransaction(); this.cleanup(); }
catch (e) { console.warn("...undetermined state"); await this.forceCleanup(); throw e; }
finally { this.finished = "commit"; for (const hook of this._afterCommitHooks) await hook(...); }
```

The managed `sequelize.transaction(cb)` awaits `commit()` outside its try (`lib/sequelize.js:515`). Consequences: `finished === "commit"` is set after a failed COMMIT; `afterCommit` hooks run after a failed COMMIT (baseline `Event.enqueue` registers `globalEventQueue().add(model)` as an `afterCommit` hook, `Event.ts:80-95`, so the writer's mutation Events are enqueued for a write that did not commit); a throwing hook replaces the COMMIT error. Sequelize itself labels every COMMIT failure "undetermined".

**Pair.**
- Unit A follows the AD-20 text: after `sequelize.transaction()` rejects it tests `finished === "commit"`, which is true for a failed COMMIT. Row 6: success with `validation`, summary `validated`, for a write that may not exist. This is the "unpersisted write counted as validation success" that AD-20 says it prevents.
- Unit B treats any rejection after a successful callback as a COMMIT error: row 5, `aborted_after_decision`. Wrong for the failing-`afterCommit`-hook fixture that AD-18 itself requires (the row is durable).
- Unit C follows Sequelize's own warning and treats every COMMIT rejection as row 7.

All three satisfy the text; the P8 cell "COMMIT error 5, or 7 when its outcome cannot be established" gives no criterion.

**Tighten (AD-20).** Replace the parenthetical with: "The shell never reads `transaction.finished`. It runs the write in an unmanaged transaction and, on any rejection of `commit()`, probes on a fresh connection within a code-owned bound: for a create, the pre-allocated `documentId`; for update, publish, and unpublish, the in-transaction writer Event carrying `validationCorrelationId`. Row present is row 6 (including a failing `afterCommit` hook); row absent after a server-reported COMMIT error is row 5; absent after a connection-level error, or a probe that cannot run, is row 7." Add an AD-18 fixture for each of the three probe outcomes, and record the enqueue-on-failed-COMMIT behaviour of writer `afterCommit` hooks as an accepted residual or guard it.

### N-2 (High). The deadline model is not enforceable as written, and it defeats or bypasses fail-open

**ADs:** AD-11 (9 s validation deadline "started at classification", covering row-lock wait and related-state reads; `SET LOCAL lock_timeout`/`statement_timeout` "from the remaining deadline"; "deadlines are checked between units"), AD-13 (`VALIDATION_TIMEOUT` is fail-open eligible), AD-7 (`deadlineAt`, "does not enter the persist step after `deadlineAt`"), AD-20 P2/P7.

**Baseline facts.** PostgreSQL treats `statement_timeout = 0` and `lock_timeout = 0` as "disabled" and rejects negative values. `SET LOCAL` values are per statement and per lock wait, not cumulative. Baseline remote-image fetches inside P2 may take up to 10 s each (`TextHelper.ts:80`, `min(REQUEST_TIMEOUT / images, 10000)`).

**Pairs.**
1. *P2 is charged to the deadline.* The deadline starts at classification, and P2 (media staging, HTML import) runs before the transaction. With a 10 s image fetch the remaining budget is negative at P3.
   - Unit A: `SET LOCAL ... = remaining` errors on the negative value: row 3.
   - Unit B clamps to 0: `lock_timeout` and `statement_timeout` are now disabled, so the transaction is unbounded.
   - Unit C opens the transaction and finds the deadline expired at P5: `VALIDATION_TIMEOUT` with zero rules evaluated; in an `open` collection that is `degraded_validation` and an unvalidated persist. A client that names a slow image host controls that outcome. This is the timing analogue of AD-13's rule that a client-controlled limit is not fail-open eligible.
2. *Per-statement caps.* Unit A issues one `SET LOCAL` at transaction start (each later statement may run up to the start-time remainder, so the total is unbounded by 9 s or 60 s). Unit B re-issues it before every statement. Only B keeps the "hard deadline". The same applies to `lint_wiki` snapshot construction (50+ batches inside the REPEATABLE READ transaction): AD-11 checks the deadline "before each unit", and snapshot batches are not units, so a run can exceed the 65 s socket override, which is the transport abort AD-11 exists to prevent.
3. *No persistence budget.* After a 9 s `VALIDATION_TIMEOUT`, Unit A derives the persist timeouts from the remaining deadline (zero or negative): every fail-open timeout write ends in row 5, so AD-13's `degraded_validation` for `VALIDATION_TIMEOUT` is unreachable. Unit B gives P7/P8 their own budget.
4. *`deadlineAt` on the HTML path.* AD-7 never says what it is. Unit A sets it to classification plus 9 s: any queue wait plus conversion above 9 s aborts, and a fail-open `VALIDATION_TIMEOUT` can never persist on the HTML path although it does on the Markdown path. Unit B sets it to the requester's wait bound. The requester's wait (`job.finished()`, `DocumentImportTask.ts:54`) has no bound in the baseline, so the A-1 goal "a handler-side timeout can never coincide with a later commit" is not established by any AD.

**Tighten (AD-11, AD-7).**
- "P2 preparation is not charged to the validation deadline; it has its own code-owned bound. The 9 s validation deadline starts when the AD-8 transaction opens (P3); for the HTML worker, when the worker opens its transaction. If the operator keeps 'started at classification', then expiry before P5 begins is row 3 and never `VALIDATION_TIMEOUT`."
- "Before every statement in a lint or enforcement transaction, and before every snapshot batch, the shell re-issues `SET LOCAL lock_timeout` and `statement_timeout` from the monotonic remainder. A remainder below a code-owned floor fails the step by phase (row 3 in P3/P4, `VALIDATION_TIMEOUT` in P5, row 5 in P7). The shell never issues 0."
- "P7 and P8 have a separate code-owned persistence budget, independent of the validation deadline."
- "`deadlineAt` is the requester's wait bound (classification plus the P2 bound, the 9 s validation deadline, the persistence budget, and the 3 s audit bound, plus a fixed grace). The requester's wait uses the same bound. The worker starts its own 9 s validation deadline at P3."

### N-3 (High). The HTML-worker contract cannot carry the outcomes AD-8 and AD-20 require

**ADs:** AD-7 (worker paragraph, `EnforcedImportResult`), AD-8 (collection change), AD-14, AD-20 rows 2, 3, 5, 6, 7.

**Pairs.**
- *(a) Missing variants.* The union is `committed | rejected | aborted{row: 3 | 5}`. AD-7 has the worker perform the collection-change check, and AD-8 says the write then fails with `collection_conflict` (row 2, no summary, no `validation`). No variant carries row 2. Unit A adds a `conflict` variant; Unit B lets the worker throw, so the requester reports row 7 with the generic message and the agent never sees the stable identifier that FR-16 makes a client contract. Same for a worker-side COMMIT whose outcome is unknown (row 7): `aborted.row` excludes 7, so the worker must throw, which the text never says.
- *(b) No message carrier.* Rows 3 and 5 promise "baseline content or the fixed generic message". `aborted{row}` carries neither. Unit A adds `message`; Unit B always answers with the generic string, so an unconvertible-HTML or import-size error loses its baseline text (baseline `perform` returns `{ error: errToString(err) }`, `DocumentImportTask.ts:129`).
- *(c) Catch-all versus "job failure".* Row 3/5 says any unplaced failure is row 3 before the decision and row 5 after; row 7 says "job failure" is the requester's row 7. Unit A catches every exception in `perform` and returns `aborted` (baseline `perform` already does), writing an `aborted_*` summary; Unit B lets exceptions escape as job failures, writes no summary, and the requester reports row 7. Different results and different evidence for the same exception.
- *(d) Redelivery and duplicate attempts.*
  - "A redelivered job that finds that row returns it as `committed` with the validation recorded for `invocationId`": no such record exists. `AuditDataV1` holds counts only, and AD-14 forbids messages and locations, so `validation.errors[]/warnings[]` cannot be reconstructed. Unit A re-runs the pure core on the committed document (may differ from the original if link targets changed); Unit B rebuilds a `validation` with empty arrays from the audit outcome; Unit C stores the object in Redis (lost on the crash that caused the redelivery).
  - The position of the found-row check is unstated. Baseline `perform` deletes the staged HTML key in `finally` (`DocumentImportTask.ts:132`); a redelivery whose first attempt finished `finally` but lost its result reaches `getFileBuffer(key)` and fails, or fails re-authorization for an actor demoted since, and returns `aborted` for a write that committed.
  - A stall false positive gives two concurrent attempts on the same `documentId` and `invocationId`. The loser hits a unique violation, is a "persistence error" (row 5), and writes `aborted_after_decision` under the same Event ID; the audit insert is first-writer-wins, so the audit can say `aborted_after_decision` for a committed write.
- *(e) Pre-scheduling boundary.* "The requester writes a summary only for an outcome it determines itself before scheduling the job." A failed `queue.add` is ambiguous (the job may exist server-side). Unit A writes `aborted_before_decision`; the ghost job then commits and its `validated` summary loses the race for the Event ID.
- *(f) Cancellation.* AD-20 says cancellation is honored before the persist decision. On the HTML path the requester stops waiting (row 7) but the job continues and may commit inside `deadlineAt`. Consistent with "no claim about persistence", but it is a second cancellation semantics that should be stated.

**Tighten (AD-7).**
- Result union: `committed{documentId, validation} | rejected{validation} | conflict{} | aborted{row: 3 | 5, message}`. `conflict` is row 2 (the requester emits the AD-8 identifier, no summary). `message` is baseline text or the fixed generic message, never driver text.
- "The worker catches every exception raised by its own code and returns `aborted` by phase. Only a process crash, stall, queue failure, or a COMMIT whose outcome cannot be established (the worker throws) reaches the requester as no result, which is row 7."
- "Step 0 of the worker is a lookup of the pre-allocated `documentId`: if the row exists, return `committed` before any re-authorization, fingerprint comparison, or key read. `validation` for that result is the audit outcome of `invocationId` if one exists, else a re-run of the pure core on the committed document. A unique violation on the pre-allocated id is treated as 'found', never as a persistence failure. A losing concurrent attempt returns `committed` and writes its summary insert-if-absent."
- "A failed `queue.add` is row 7 unless the call definitively did not enqueue."

### N-4 (High). The document set evaluated by `lint_wiki` is defined nowhere

**ADs:** AD-9 ("actor-readable configured scope"), AD-10, AD-16 (keyset `(collectionId, id)`), AD-3 (`PUBLISHED_DOCUMENT_MISSING_FROM_STRUCTURE`), AD-12 (`evaluatedDocumentCount`). PRD FR-8 speaks of published documents; neither the PRD nor the README nor the SPEC says whether drafts or archived documents are in scope.

**Pair.**
- Unit A (snapshot builder) selects `deletedAt IS NULL` documents of the collection, including drafts and archived ones. The hierarchy story, written to FR-8, treats every snapshot node as published: archived documents (removed from `documentStructure` at archive time) raise `PUBLISHED_DOCUMENT_MISSING_FROM_STRUCTURE`, and drafts are evaluated by the document unit.
- Unit B selects published, non-archived, non-deleted documents only. Counts, Findings, and the "clean" claim differ, and a draft validated at write time (writes evaluate drafts) is invisible to the clean-state proof that closes a batch (SM-P2). The keyset over `collectionId` also depends on the answer: baseline `findAllInBatches` compares with `Op.eq` and `Op.gt`, and drafts may carry a null `collectionId`.

**Tighten (AD-9).** State the set once: "`lint_wiki` evaluates the documents of an evaluated collection that the actor can read and that are published, not archived, and not deleted; drafts and archived documents are outside every `lint_wiki` unit. `lint_document` evaluates any readable, non-deleted document." (The default is a proposal; any single stated rule closes the pair.)

### N-5 (Medium). Rule-kind failure inside a document unit on the read surfaces

**ADs:** AD-11, AD-12. The write rule ("all enabled document and link rules run as one unit; a failure of one rule kind yields its System Failure and never skips another; Findings already produced are retained") is scoped "on a write". For `lint_document` and the `lint_wiki` document unit, AD-11 says only "one buffered unit ... an interrupted unit contributes nothing".

**Pair (one rule kind raises in document D).**
- Unit A applies the write rule: the other kinds' Findings are kept, the failed kind yields one System Failure, the unit counts as completed.
- Unit B treats the buffered unit as failed: Findings discarded, unit not counted, `lint_document` is `failed` where A is `incomplete` or `complete=false` with Errors.
- Cardinality differs too: one System Failure per failed document (A) or one per (collection, check) (B), so `systemFailures.length` and audit `counts.byCode` differ. The location `scope{collection}` carries no document, so the array cannot tell the entries apart.
- NFR-8 ("a rule failure shall not silently suppress other required checks") favours A; the buffered wording favours B. The same input is then `complete: false` with and without visible Errors, and the agent's repair loop depends on it.

**Tighten (AD-11).** "The write rule applies to every document unit on every surface: Findings are retained, the failed kind yields one System Failure per (unit, code), a unit that ran with a partial failure is not counted as completed, and `state` is `incomplete` when any other unit completed and `failed` otherwise."

### N-6 (Medium). "Loaded once at startup" is per worker process

**ADs:** AD-5 ("validation runs in the master process before workers fork, and every service that evaluates policy loads the file independently"), AD-6, AD-19.

**Baseline fact.** `server/index.ts:56-62`: `throng` runs `master()` once (only migration check and env printing), then forks workers that each `import("./main")`; throng revives an exited worker for the life of the master. Nothing in the spine says the master hands its result to the workers.

**Pair.**
- Unit A: the master validates, the workers each re-read `WIKI_LINT_CONFIG_PATH`. A mounted ConfigMap updated after the first start, then one worker crash and respawn, gives one instance two policy sets, or a respawned worker that finds a now-malformed file (startup-fatal) and enters a crash loop. `/_health` (answered by whichever worker gets the request) reports a fingerprint that varies per request.
- Unit B: the master reads the bytes once and passes them to every worker through the environment or IPC.

The first violates the AD-6/AD-19 purpose ("mixed-policy instances").

**Tighten (AD-5).** "The master reads the file once, validates it, computes the policy set and `policySetFingerprint`, and passes the exact bytes (or the derived set) to every forked worker through an inherited environment variable or cluster IPC. A worker never reads `WIKI_LINT_CONFIG_PATH`, including after a respawn. Each service's master does this for its own workers."

### N-7 (Medium). AD-19's trigger for the expected fingerprint

**ADs:** AD-19 ("required whenever any collection has `activation: enforced`"), AD-6, AD-5.

- A sentinel's `activation` is unknowable (the entry is invalid). Unit A counts only valid enforced entries: an instance whose only enforced collection is a sentinel is ready without the variable while its siblings, holding a valid file, reject differently. Unit B counts sentinels: readiness false without the variable.
- An absent `WIKI_LINT_CONFIG_PATH` has no defined `policySetFingerprint`. Unit A reports `null`; Unit B reports the hash of `{ schemaVersion: 1, collections: [] }`, which an explicit empty-collections file also produces. Rollout comparison between an absent-path instance and an empty-file instance then differs.

**Tighten (AD-19).** "The variable is required when any entry is valid and enforced or is a sentinel. An absent path reports the fingerprint of the empty set."

### N-8 (Medium). Phase-table cells versus body text

- *(a) P5.* The P5 cell says a related-state failure "becomes a System Failure" (selection: AD-13 matrix). AD-8 says a transaction-invalidating failure (connection loss) is row 3 before the decision. An implementer reading only the table makes a connection loss a `VALIDATION_RUNTIME_FAILED`, an `open` decision to persist, and then row 5 at P7; AD-8 gives row 3 and `aborted_before_decision`. Tighten the cell: "contained (savepoint-recoverable) failure only; a failure that leaves the transaction unusable is row 3."
- *(b) P1.* The P1 cell says "none". A failure while computing `readable` (a `can(read)` policy check that loads memberships) or while pre-allocating is before classification completes: row 1 (baseline behaviour, raw text, no summary) or the row 3 catch-all (generic message, `aborted_before_decision`). Say which.
- *(c) `revisionCount`.* The unchanged-update check (P7, row 5) compares a pre-write `revisionCount` with the post-save value (`documents.ts:702-714`). Unit A keeps the baseline sample taken at P0, so a concurrent collaborative save between P0 and the lock (`documentCollaborativeUpdater` bumps the counter) makes a no-op write look changed. Unit B samples after the lock. Tighten: "sample `revisionCount` inside the transaction, after the lock."

### N-9 (Medium). Media protocol details are open

**ADs:** AD-7 ("stage -> project -> validate -> materialize"; blobs owned by `invocationId`, "transfers ownership only when its Attachment row commits", otherwise "deleted idempotently in cleanup"), AD-8, AD-20.

- *Key scheme and materialize.* Unit A writes the blob straight to the final `uploads/<user>/<attachmentId>/<name>` key with a pre-allocated Attachment id; materialize is only the row insert. Unit B stages under an `invocationId` prefix and materialize copies the blob to the final key, which is storage I/O inside the transaction that holds the row lock and runs under the 9 s deadline, contradicting AD-8's "only ... media staging run outside". The stager and the materializer are separate seams (AD-18) and will disagree.
- *Cleanup owner.* Rows 3 and 4 clean up in the shell or the worker. Row 5 is the same. Row 7 (unknown COMMIT, lost worker result) cannot delete safely, and D-9 defers only the crash sweeper; the spine does not say that row 7 leaves the staged blobs in place.

**Tighten (AD-7).** Fix the key scheme (pre-allocated Attachment ids with the final key, invisible until the row commits), forbid storage I/O inside the enforced transaction, and state "row 7 never deletes staged blobs".

### N-10 (Medium). Monotonic values cross a process boundary

**ADs:** Consistency Conventions ("deadlines use a monotonic clock"), AD-7 (`deadlineAt` in the intent), AD-14 (`durationMs` "from tool-handler entry ... including any queue wait").

A monotonic clock is process-local. Unit A puts `Date.now()`-based epoch milliseconds in `deadlineAt` and in a start stamp, and subtracts across hosts (subject to skew). Unit B puts a `performance.now()` value or a remaining-milliseconds budget and converts at job start. The worker's summary `durationMs` for an HTML create then differs by queue wait and skew between the two. **Tighten:** "`deadlineAt` is wall-clock epoch milliseconds; the worker converts it to a local monotonic remainder at job start; the intent also carries `handlerEnteredAtEpochMs`, and the worker's `durationMs` is its local monotonic elapsed plus the queue wait computed from those two stamps."

### Low findings

- **N-11. Write-surface location of runtime System Failures.** AD-12 fixes the location of run-level failures as "the request's scope kind" and check-level failures as `scope{collection, collectionId}`; the two rejection kinds are `scope{collection}`. A runtime `VALIDATION_TIMEOUT` or `VALIDATION_RUNTIME_FAILED` on a write is unlocated: `scope{document}` (the request names a document) or `scope{collection, collectionId?}` (AD-14 makes every write summary `scopeKind: collection`). Sort position and client branching differ. Tighten: "On the write surface every System Failure is located `scope{collection, collectionId?}` for the classified collection."
- **N-12. `events.list` for an `auditWikiLint`-only caller.** Baseline uses `intersection(EventHelper.AUDIT_EVENTS, events)` (`events.ts:40-46`) and silently ignores a `name` outside the set. Unit A rejects a request naming other audit events with an authorization error; Unit B returns the intersection (empty). Also whether the three names join the shared, client-visible `AUDIT_EVENTS` (and the Zod enum) or a new constant. Tighten: state "the requested names are intersected with the three; no error", and "the three names live in a new constant, not in `AUDIT_EVENTS`". (The full `audit` policy requires cloud hosting, so the both-capabilities branch is unreachable on this fork.)
- **N-13. Queue failure logging claim.** AD-7: "document content is passed by staged reference so the queue's failure logging emits neither content nor actor fields." Baseline `queue.ts:63` logs `data: job?.data` on the final failed attempt, and `Logger.sanitize` redacts only `accessToken`, `refreshToken`, `token`, `password`, `content`, and only in production (`Logger.ts:205-211`). `actorId`, `sourceIp`, the attributes (title), and the file name are logged. Either redact the intent in the `failed` handler, or change the sentence to what is actually true.
- **N-14. Snapshot failure "may return no findings".** AD-11's "a global snapshot failure may return no findings" permits Unit A (`failed`, empty arrays) and Unit B (evaluate the fully snapshotted collections, `incomplete`). Since evaluation happens only after the snapshot commits, state "a snapshot failure or limit excess returns no Findings and `state: failed`" (or define the partial case).
- **N-15. Read-side disclosure residuals.** (i) `lint_document` by a document-only actor returns `complete` for a configured collection and `not_evaluated` for an unconfigured one, so `state` discloses whether the unreadable collection is configured (any activation); the write-side residual note names only "the presence of `validation`". (ii) The unreadable-sentinel failure is "generic ... without `collectionId`", but its `scopeKind` is `collection` (sentinel rule) or `document` (run-level rule for a document request). Add both to the AD-12 residual sentence and fix the scope kind.
- **N-16. `PARENT_DOCUMENT_UNRESOLVED` "in scope".** A parent that the actor can read but that lies outside the configured scope: Unit A resolves it through membership-aware queries (AD-9) and reports `PARENT_COLLECTION_MISMATCH`; Unit B resolves against the snapshot only and reports `PARENT_DOCUMENT_UNRESOLVED`. State the resolution universe.
- **N-17. Audit insert mechanism.** (i) The 3 s bound is an application timer; the insert statement keeps running and holds a pool connection unless the independent audit transaction sets its own `SET LOCAL statement_timeout`. (ii) `Event.create(..., { hooks: false })` also skips `@BeforeCreate cleanupIp` (`Event.ts:75`), so `ip` is stored unnormalized; a different suppression mechanism keeps normalization. (iii) "Idempotent" is `findOrCreate` (nested transaction, `AfterSave` fires unless suppressed) or `INSERT ... ON CONFLICT DO NOTHING`. Name one mechanism.
- **N-18. Lock order.** An enforced update with `publish: true` locks the document row (AD-8) and then, inside `Document.publish`, the destination collection row with `NO_KEY_UPDATE` (`Document.ts:1257`). Baseline `documentMover` locks the source and destination collection rows first (`documentMover.ts:44-58`) and then updates the document and its children. The two orders can deadlock; Postgres aborts one side. AD-20 already lists "deadlock" among the failures answered with the fixed message, so the row is placed by phase (3 in P3/P4, 5 in P7), but the spine does not say that a publishing update takes the collection lock first. Minimal tightening: "an enforced update with publish takes the destination collection lock (`NO_KEY_UPDATE`) before the document lock, matching the baseline mover order", or accept the deadlock explicitly.

---

## 4. Who writes the summary on each path

| Path and outcome | Row | Summary initiated by | Result carrier | Ambiguity |
| --- | --- | --- | --- | --- |
| Any path, failure before classification | 1 | none | baseline | P1 failure while computing `readable` (N-8b) |
| Sentinel (Markdown or HTML) | P1 to P6, row 4 | requester shell (`rejected`) | modeled `rejected` | none |
| Markdown, collection differs | 2 | none | `collection_conflict` | none |
| Markdown, before decision | 3 | shell (`aborted_before_decision`) | `isError` | none |
| Markdown, AD-13 reject | 4 | shell (`rejected`) | modeled | none |
| Markdown, persist failure or definite COMMIT failure | 5 | shell (`aborted_after_decision`) | `isError` | COMMIT test (N-1) |
| Markdown, committed | 6 | shell, before response assembly | success | COMMIT test (N-1) |
| Markdown, COMMIT unknown | 7 | none | `isError`, generic | COMMIT test (N-1) |
| HTML, failure before scheduling | 1 or 3 | requester (row 3) or none | `isError` | ghost job (N-3e) |
| HTML worker, collection differs | 2 | none | **no union variant** | N-3a |
| HTML worker, before decision | 3 | worker | `aborted{3}` **without message** | N-3b, N-3c |
| HTML worker, mismatch or AD-13 reject | 4 | worker (`rejected`) | `rejected` | none |
| HTML worker, persist failure | 5 | worker | `aborted{5}` **without message** | N-3b, duplicate attempts N-3d |
| HTML worker, committed | 6 | worker | `committed` | none |
| HTML worker, COMMIT unknown | 7 | none | **no variant; worker must throw** | N-3a |
| HTML, crash, stall, lost result | 7 | none by requester | `isError`, generic | none |
| HTML, redelivery finds the row | 6 | worker, insert-if-absent | `committed` with **unstorable `validation`** | N-3d |

## 5. Attacked and found closed

- Sentinel state algebra: `incomplete` versus `failed` versus `not_evaluated` with a sentinel, with a timeout added, with a vacuous check completing, with an unreadable sentinel. Sentinel completes no unit; consistent.
- AD-4 total order for scope-located failures: absent-last plus rank plus code; ties among scope failures are stable by sequential emission.
- AD-5/AD-6: malformed versus lexical boundary, BOM, invalid UTF-8, entry span edges and CRLF, escape-equivalent duplicates, unpaired surrogate as escape (sentinel) versus raw bytes (malformed, fatal), lowercase canonical keys, `policySetFingerprint` array ordering.
- AD-8 lock-then-read for updates; row 2 versus row 3 order (re-authorize before comparing) in P3 and in the worker order.
- AD-3 `Surfaces` versus the write unit versus the AD-13 eligibility list; `VALIDATION_RESOURCE_LIMIT_EXCEEDED` has no write source.
- AD-14 aborted-attempt and policy-configuration-rejection field values versus AD-12 identity rules; read outcome mapping versus the AD-12 state algebra.
- Savepoints (AD-8) versus Findings retention (AD-11) versus the AD-13 matrix for a contained P5 failure.
- Unpublish: the state change is projected in P4 and the precondition is a P7 row 5; the table is unambiguous once N-8 is applied.
- Baseline `create_document` passes `collectionId: collection?.id` (the classified collection) to the HTML job, so the worker's collection comparison has its operand; state that this existing field is the classified id.
