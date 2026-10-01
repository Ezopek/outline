# Adversarial Divergence Review, Third Pass (2026-09-30)

**Spine reviewed:** `ARCHITECTURE-SPINE.md` (AD-1 through AD-20, `updated: 2026-09-30`, including the round-2 author changes recorded in the memlog entries "Second-round gate fixes" and "Additions not directly decided")
**Lens:** construct two units one level down that each obey every AD to the letter yet still build incompatibly: clashing shared-data shapes, two owners of one entity, conflicting state-mutation paths.
**Scope:** (1) status of the six round-2 High findings (N-1, N-2, N-3, N-4, consistency H-1, H-2); (2) new divergence pairs introduced by the round-2 text; (3) severity and minimal tightening for each.
**Not reported (known and accepted):** the "Pending PRD alignment" conflicts; D-9 items; creates and publications taking no parent lock with the residual window; the baseline authorization gap; the operator decisions (9 s validation, 3 s audit, 65 s `/mcp` override, actor-independent audit, required expected fingerprint). Round-2 Medium and Low items are not repeated unless the new text made them worse.
**Read-only:** this file is the only write.

**Evidence base.** The spine, the memlog, the round-1 and round-2 reports, and the baseline code at `HEAD` (`f4770a4df`; `git fetch --prune` succeeded: 1 ahead, 0 behind `origin/feature/mcp-wiki-linting-v1.10.1`): `server/commands/documentUpdater.ts`, `documentCreator.ts`, `documentMover.ts`, `server/models/Document.ts` (`publish`, `unpublishWithCtx`, `updateCollectionStructure`), `server/models/base/Model.ts` (`saveWithCtx`, `insertEvent`), `server/models/Event.ts`, `server/tools/documents.ts` and `util.ts`, `server/queues/queue.ts`, `server/queues/tasks/DocumentImportTask.ts`, `server/services/worker.ts`, `server/storage/database.ts`, `server/main.ts`, `server/index.ts`, `server/routes/mcp/index.ts`, `server/routes/api/events/events.ts`, `server/presenters/event.ts`, `server/logging/Logger.ts`. `node_modules` is absent; Sequelize 6.37.8 was read from the tarball already extracted in this session's scratchpad (`lib/transaction.js`, `lib/dialects/postgres/query.js`). Not re-verified locally, and marked where used: Bull's default `lockDuration`/`stalledInterval`/`maxStalledCount` behaviour, PostgreSQL's rollback of `SET LOCAL` values at `ROLLBACK TO SAVEPOINT`, and the Linux per-variable environment size limit.

## Verdict

The round-2 repairs hold where they were aimed: the commit test, the deadline start, the worker result union, and the `lint_wiki` document set are all materially better. Four of the six Highs are closed, two are partially closed, none is open. The new text introduces one High divergence pair, in the HTML worker's concurrent and redelivered attempts (summary, result, and blob ownership are still first-writer-wins rather than truth-preserving), and eight Medium pairs, clustered around three things: how the deadline is enforced inside the write transaction (R3-3, R3-4, R3-5), how a COMMIT error is classified (R3-2), and lock order (R3-6). The Markdown reject and commit paths are close to a safe substrate; the HTML path and the fail-open path are not yet.

Counts: Critical 0, High 1, Medium 8, Low 5.

## 1. Round-2 High findings

| ID | Round-2 sev | Status | Reason against the current text |
| --- | --- | --- | --- |
| N-1 | High | **CLOSED** | AD-20 "Commit detection" replaces the `finished` test: an unmanaged transaction, no read of `transaction.finished`, a fresh-connection probe on any `commit()` rejection (create: the pre-allocated `documentId`; update, publish, unpublish: the writer Event carrying `validationCorrelationId`), row present is 6 including a failing `afterCommit` hook, absent after a server-reported error is 5, absent after a connection-level error or an unrunnable probe is 7. The residual afterCommit-fires-after-failed-COMMIT behaviour (`transaction.js:39-56`, verified) is recorded as accepted. The no-writer-Event case is not reachable: the unchanged-update check is P7 (before COMMIT, row 5), so a no-op never reaches P8; `unpublish` of a draft is denied by policy (`document.isDraft` returns false at `policies/document.ts:253-272`, and again at P3 re-authorization); every persisting `documentUpdater` branch goes through `saveWithCtx`/`Document.publish` and therefore `insertEvent` (`Model.ts:292-360`). What remains is narrower and new: the criterion for "server-reported versus connection-level" is missing and the obvious one (Sequelize error class) is wrong (R3-2), and the probe mechanics are unspecified (R3-13). Implementation note only: `unpublishWithCtx` (`Document.ts:1319`) has no `data` parameter, so correlation injection changes its signature. |
| N-2 | High | **PARTIALLY CLOSED** | Closed: preparation (P2) is no longer charged to the validation deadline and has its own 30 s bound; the deadline starts when the transaction opens; `SET LOCAL` is never 0 or negative and fails by phase below a floor; P7/P8 have a separate 9 s budget so a fail-open `VALIDATION_TIMEOUT` can persist; `deadlineAt` is defined as the requester's wait bound plus 5 s, in epoch milliseconds. Still open: the re-issue rule is per phase boundary and per snapshot batch, but a write's P5 runs several statements under savepoints, so the 9 s bound is not cumulative or enforced there (R3-3); no invariant composes the code-owned bounds with the unbounded pieces against the 65 s override (R3-4); and P3/P4 consumption (client-controlled) still decides fail-open admission at the P5 boundary (R3-5). |
| N-3 | High | **PARTIALLY CLOSED** | Closed: `conflict` variant (row 2), `aborted{row, message}`, the catch-everything-else-throws rule (only crash, stall, queue failure, unestablished COMMIT reach the requester as no result), lookup-first idempotence with status-only reconstruction, `deadlineAt` semantics, wall-clock stamps. Still open: two live attempts for one `documentId` have no truthful single outcome (R3-1, High); "baseline text ... never driver text" contradicts itself (R3-9); "definitively did not enqueue" is undefined (R3-10); the reconstructed `validation` shape is under-specified (R3-11). |
| N-4 | High | **CLOSED** | AD-9 now states the set once (readable, published, not archived, not deleted; drafts and archived outside every `lint_wiki` unit; `lint_document` evaluates any readable non-deleted document) and fixes the parent and target resolution universe (membership-aware queries, cross-collection parent is `PARENT_COLLECTION_MISMATCH`). The same set feeds `PUBLISHED_DOCUMENT_MISSING_FROM_STRUCTURE`, `evaluatedDocumentCount`, the AD-16 limits, and the keyset (published documents always carry a `collectionId`). No pair found. |
| H-1 (consistency) | High | **CLOSED** | `deadlineAt` is now defined (sum of the phase bounds plus 5 s grace, epoch milliseconds, converted to a local monotonic remainder at job start) and no longer collides with the validation deadline: the validation deadline starts at the worker's transaction and persistence has its own budget, so a fail-open timeout can persist on the HTML path. The refusal to enter persist after `deadlineAt` selects a row by the default rule (5, after the decision), consistent with the requester having already reported 7 and the worker's summary standing. Recorded in the memlog as an author default. The queue wait that is not a term of the sum is folded into R3-4. |
| H-2 (consistency) | High | **CLOSED** | `EnforcedImportResult` carries `{ kind: "conflict" }` for row 2, mapped by the requester to `collection_conflict` with no summary. |

Counts: 4 CLOSED, 2 PARTIALLY CLOSED, 0 OPEN.

## 2. New findings index

| ID | Sev | ADs | One line |
| --- | --- | --- | --- |
| R3-1 | High | AD-7, AD-14, AD-20, AD-18 | Two live or redelivered HTML attempts for one `documentId`: first-writer-wins summary, lock-dropped result, and blob cleanup can make a committed write read as aborted; lookup-first and "loser returns committed" instruct different things. |
| R3-2 | Medium | AD-20 (P8, rows 5/7) | "Server-reported versus connection-level COMMIT error" has no criterion, and Sequelize wraps connection loss as `DatabaseError`, so the obvious criterion books a possibly committed write as row 5. |
| R3-3 | Medium | AD-11, AD-8, AD-16, AD-20 (P5) | A write's P5 has many statements and savepoints but one `SET LOCAL` and no in-phase deadline check; `SET LOCAL` inside a rolled-back savepoint reverts; write link resolution has no batch size. |
| R3-4 | Medium | AD-11, AD-7, AD-20 | No composition invariant: P0/P1, queue wait, the COMMIT probe, and post-commit response assembly are unbounded terms against the 65 s override; the P2 clock origin is undefined on the HTML path. |
| R3-5 | Medium | AD-11, AD-13, AD-16 | Client-controlled cost (P3/P4 CPU, link volume) decides `VALIDATION_TIMEOUT`, which is fail-open eligible, so an actor can choose to skip linting in any `open` collection. |
| R3-6 | Medium | AD-8 | Collection-first lock order is stated for publish and unpublish only; the baseline BeforeSave hook takes the same collection lock for any title, icon, or color change after the document lock, so it deadlocks with `move_document` and with enforced publish/unpublish. |
| R3-7 | Medium | AD-11, AD-12, AD-3, AD-4 | "One System Failure per (unit, code)" cannot be expressed: a document-unit failure is located at collection scope with no document, so N failures are indistinguishable and dedupe-prone; `failed` may carry Findings. |
| R3-8 | Medium | AD-7, AD-19 | The enforced import reuses the baseline task name; a worker without the implementation silently runs the baseline import and persists unvalidated. |
| R3-9 | Medium | AD-7, AD-20 | "Message is baseline text ... never driver text" contradicts baseline behaviour (`errToString` is driver text for DB errors) and differs between the Markdown and HTML paths. |
| R3-10 | Low | AD-7, AD-14 | A requester summary after an ambiguous `queue.add` failure wins the Event ID over the ghost job's real outcome. |
| R3-11 | Low | AD-7, AD-12, AD-13 | Status-only reconstruction leaves `systemFailures` and the readability gate unspecified and yields shape-inconsistent `validation` objects. |
| R3-12 | Low | AD-7, Conventions (Logging) | The intent (actor, IP, title, file name) is still logged and traced at three sites in `worker.ts` that the failure-handler fix does not cover. |
| R3-13 | Low | AD-20, AD-14 | The probe's query key is an unindexed JSONB filter on the busiest table, its bound and transaction semantics are unspecified, and the key is presented to every activity-feed reader. |
| R3-14 | Low | AD-20, AD-5/6, AD-7 | Residuals: cancellation before the decision has no row; "explicit empty file" versus malformed; the environment-variable transport has a size limit; work abandoned at the P2 bound keeps staging. |

## 3. Detailed findings

### R3-1 (High). Concurrent or redelivered HTML attempts have no single truth for result, summary, and blobs

**ADs:** AD-7 (lookup-first step; "inserts its summary if absent, so a losing concurrent attempt for the same `documentId` returns `committed` without a second summary"; `EnforcedImportResult`), AD-14 (`INSERT ... ON CONFLICT DO NOTHING` on the Event ID, "at most one" summary), AD-20 (rows 3 to 7, staged-blob cleanup by row), AD-18 ("two concurrent attempts for one `documentId`").

**Baseline facts.** `DocumentImportTask` declares `attempts: 1` (`DocumentImportTask.ts:137-142`), so redelivery here means a stalled-job re-run, not a retry. Queues are created with only `defaultJobOptions` (`queue.ts:20-43`), so Bull's lock and stall defaults apply (30 s lock and stall interval by Bull's documentation; not re-verified locally). A job whose lock lapses while its first attempt is still alive, for example under the synchronous DOM parse that `create_document` moves to a worker precisely because it blocks the event loop, is handed to a second attempt. AD-11 allows P2 to run for up to 30 s, the same order. Bull discards the completion of an attempt that lost its lock; the audit insert has no such guard.

**Pair (attempt 1 alive, attempt 2 redelivered, same `invocationId` and `documentId`).**
- *Aborted attempt writes first.* Attempt 2 fails on a transient error after its decision and inserts `aborted_after_decision`. Attempt 1 commits and inserts `validated`; `ON CONFLICT DO NOTHING` drops it. The document exists, the audit says aborted, and the requester receives attempt 2's `aborted` (attempt 1's completion was discarded by Bull), so the agent retries and creates a duplicate. This is AD-20's own "a committed write presenting as a failure". Lookup-first does not help because attempt 2 looked before attempt 1 committed.
- *Loser hits the unique violation.* AD-7 gives two instructions for a found row. Step 0: reconstruct from "the audit summary recorded for `invocationId`", and throw (row 7) if none exists. Concurrency sentence: return `committed` and insert "its summary if absent". Unit A applies step 0 to the loser: the winner's audit insert runs in its own transaction after commit, so it has typically not landed when the loser's INSERT unblocks, the loser throws, and the requester may report row 7 for a committed write. Unit B applies the second sentence: the loser returns its own full `validation` and inserts its own summary first, so the response arrays and the audit outcome can disagree with the winner's.
- *Blobs.* Pre-allocated Attachment IDs are allocated per attempt (the intent carries only `documentId`), but cleanup is stated per `invocationId` ("delete the invocation's staged blobs"). Unit A leaves the loser's blobs behind; Unit B, tracking by invocation, deletes the winner's committed blobs.

**Tighten (AD-7, AD-14, AD-20).**
1. Distinguish the two found-row cases: step 0 (row found before the attempt did any work) reconstructs from the summary; a unique violation after the attempt's own decision rolls back, returns `committed` with the attempt's own `validation`, and inserts its own summary if absent.
2. Give the summary insert precedence: a summary from an attempt that committed, or that observed the committed row, replaces an `aborted_*` or `rejected` summary for the same Event ID (`ON CONFLICT DO UPDATE ... WHERE` outcome is aborted or rejected); the reverse never happens.
3. Before returning or summarizing any non-committed outcome (rows 3, 4, 5), the attempt repeats the found-row lookup; a found row converts it to the committed path.
4. Blob tracking and cleanup are per attempt, not per `invocationId`.
5. Either state that two live attempts stay unserialized and the residual race (an aborted summary written before a still-live attempt commits) is accepted, or serialize with a per-invocation guard (a Redis `SET NX` with a heartbeat renewal, taken before the lookup). The AD-18 fixture must name which.

### R3-2 (Medium). COMMIT error classification has no criterion, and Sequelize hides connection loss

**ADs:** AD-20 "Commit detection" and P8 ("row absent after a server-reported COMMIT error is row 5; row absent after a connection-level error, or a probe that cannot run, is row 7").

**Baseline fact (verified).** `lib/dialects/postgres/query.js:54-59` marks `ECONNRESET`, "SSL SYSCALL error: EOF detected", and "Query read timeout" connections invalid and then `throw this.formatError(error, ...)`. `formatError` (`:232-296`) maps only recognised SQLSTATEs to specific classes; the default branch returns `DatabaseError`. So a socket reset or "Connection terminated unexpectedly" mid-COMMIT surfaces as `DatabaseError`, the same class as a server-reported failure, and only its `parent` differs (no server `severity`, a Node `code` such as `ECONNRESET`). `Transaction.commit()` then destroys the connection (`forceCleanup`, `transaction.js:127-132`), so the backend may still be finishing the COMMIT when the probe runs.

**Pair.**
- Unit A classifies by Sequelize class (`ConnectionError` versus anything else): a connection drop mid-COMMIT is "server-reported"; the probe races the in-flight COMMIT, finds no row, and returns row 5 (`aborted_after_decision`, "rollback", tool-execution error) for a write that lands milliseconds later.
- Unit B classifies by whether the rejection carries a server ErrorResponse (`severity`, SQLSTATE) and returns row 7.
Both obey "server-reported ... connection-level" as written.

**Tighten (AD-20).** "A rejection is server-reported only when it is produced from a PostgreSQL ErrorResponse (its `parent` carries the server `severity` and SQLSTATE `code`). Every other rejection, including socket errors, termination, client-side timeouts, and pool errors, is connection-level whatever Sequelize's error class. Sequelize wraps both as `DatabaseError`." AD-18: keep the three probe outcomes and add one fixture per error shape.

### R3-3 (Medium). The write path's P5 has no cumulative deadline enforcement

**ADs:** AD-11 ("`SET LOCAL lock_timeout` and `statement_timeout` from the monotonic remainder at each phase boundary of an enforcement transaction and before each batch of snapshot construction"; "Deadlines are checked between units"), AD-8 (each fail-open-eligible related-state read runs under its own savepoint), AD-16 (batches of 500 unique link targets "govern `lint_wiki` snapshot construction and admission only; `lint_document` and write validation add no size cap"), AD-20 P5.

**Pair.** A write has exactly one unit (the document), so the "between units" check never fires inside it. P5 issues link-target resolution and parent reads, each under a savepoint.
- Unit A issues `SET LOCAL` once at P5 entry (a phase boundary). Every statement in P5 then gets the entry remainder, up to 9 s each, and nothing compares the monotonic clock between statements, so P5 can run a multiple of 9 s and finish as a late `validated`, not `VALIDATION_TIMEOUT`. With a document of tens of thousands of link targets under a slow database this passes the 65 s override with the transaction still open.
- Unit B re-issues before every statement or batch and checks the remainder each time.
- Savepoints add a third variant: PostgreSQL restores GUC values at `ROLLBACK TO SAVEPOINT` for settings changed after the savepoint (documented under `SET`; not re-run here). A `SET LOCAL` issued inside the savepoint that then fails reverts to the earlier, larger value, so the next statement runs with a stale bound.
- Batching: AD-16 exempts writes, so Unit A resolves all targets in one `IN` list. Beyond 65,535 bind parameters that statement fails outright, which is a client-controlled `VALIDATION_RUNTIME_FAILED` (see R3-5); Unit B chunks.

**Tighten (AD-11).** "Write-path related-state reads run in batches of at most 500 unique targets. The shell issues `SET LOCAL` outside the savepoint, immediately before each batch or statement, and checks the monotonic remainder before each; an expired remainder inside P5 yields `VALIDATION_TIMEOUT` for the unit."

### R3-4 (Medium). No composition invariant against the 65 s override; the P2 clock origin is undefined

**ADs:** AD-11 (30 s preparation, 9 s validation, 9 s persistence, 3 s audit, 65 s override), AD-7 (`deadlineAt` = classification + AD-11 bounds + 5 s), AD-20 (P0/P1 unbounded, P2b, probe "within a code-owned bound"), AD-12 (response assembly "cannot raise").

**Arithmetic on paper.** Markdown write: 30 + 9 + 9 + 3 = 51 s plus the probe; HTML requester wait: 56 s; `lint_wiki`: 60 + 3 = 63 s against "at least 65". These pass. The terms not in any sum are:
- P0/P1 (lookups, the `readable` computation): plain queries outside a transaction, so the baseline per-transaction `statement_timeout` (`database.ts`, `applyStatementTimeoutToTransactions`) does not apply; the pool acquire timeout is 30 s.
- The COMMIT probe bound (a number the spine never gives).
- Post-commit response assembly: `getDocumentBreadcrumb`, the share-URL lookup, and the presenter run outside any transaction. "Cannot raise into the error path" covers errors, not stalls.
- HTML queue wait: it is in no phase bound.

**Pair.** Unit A bounds none of them: under database stress the handler passes 65 s after the commit and the audit, Node destroys the socket (`server.setTimeout` override notwithstanding), and the agent gets a transport abort for a committed write, the exact "transport aborts without a result" that AD-11 `Prevents`. Unit B bounds them and the write returns.
- *Clock origin.* Unit A measures the worker's 30 s P2 from job start (queue wait invisible to it, then the persist step is refused after `deadlineAt` because queue wait ate the sum). Unit B anchors P2 to classification, so queue wait is charged to P2. The results differ at the boundary.

**Tighten (AD-11, AD-7).** State the invariant "for every surface, the sum of code-owned bounds, including the probe and response assembly, plus the 5 s grace, is at most 60 s"; give the probe a bound (for example 2 s) and post-commit assembly a bound (for example 2 s per enrichment, omitted on expiry); bound P0/P1 or state that they precede the clock; and state that the 30 s P2 bound is measured from classification on both paths (the worker converts the epoch start), so queue wait is charged to P2.

### R3-5 (Medium). Client-controlled cost decides fail-open admission

**ADs:** AD-11 ("row 3 in P3 and P4, `VALIDATION_TIMEOUT` in P5"; the validation deadline starts at transaction open and therefore covers P3 and P4), AD-13 (`VALIDATION_TIMEOUT` and `VALIDATION_RUNTIME_FAILED` are fail-open eligible; the carve-out for a client-controlled limit names only `VALIDATION_RESOURCE_LIMIT_EXCEEDED`), AD-16 (writes have no size cap beyond the baseline limit).

**Pair.** P4 (content-dependent `append`/`prepend`/`patch` on a document up to the baseline limit of 1,536,000 characters, template expansion) is synchronous CPU that the shell cannot preempt and that the client controls. It is charged to the same 9 s.
- Unit A checks the remainder at the phase boundary, finds it below the floor at P5 entry, and records `VALIDATION_TIMEOUT` with no rule evaluated. In an `open` collection AD-13 then yields `degraded_validation` and persists unvalidated content.
- Unit B attributes the shortfall to P4 (the step that consumed the time) and returns row 3.
Each obeys "fails the step by phase when the remainder is below a floor" and the boundary between P4 and P5 is unstated. The same holds inside P5: content shaped to be slow (very many links; see R3-3 on the bind limit) times out the link rule, and `open` mode persists it. An actor who can write to an `open` collection can therefore elect to skip linting by shaping content, which is the outcome AD-13's client-controlled-limit sentence exists to prevent for the resource limit.

**Tighten (AD-11, AD-13).** (1) "A remainder below the floor on entering P5 is row 3; `VALIDATION_TIMEOUT` requires that P5 began." (2) "In an `open` collection, `VALIDATION_TIMEOUT` and `VALIDATION_RUNTIME_FAILED` are fail-open eligible only when the projected document is within the AD-16 per-document Markdown and link-reference limits; beyond them the write is rejected as a fail-closed System Failure." (AD-16's `lint_wiki`-only scope statement can stay; this uses the numbers only for eligibility.)

### R3-6 (Medium). The collection-first lock order covers publish and unpublish only

**ADs:** AD-8 ("locks the update document row (`FOR UPDATE` ...); a publication or unpublication takes the classified collection's `NO_KEY_UPDATE` lock first, matching the baseline mover's order, so the two cannot deadlock").

**Baseline facts (verified).**
- `Document.updateCollectionStructure` (`Document.ts:487-518`, `@BeforeSave`) takes `Collection ... lock: NO_KEY_UPDATE` for any save that changes `title`, `icon`, or `color` of a published, non-archived document.
- `documentMover` locks the source and destination collections first (`documentMover.ts:45-60`), then updates descendant rows in bulk (`:115-150`) and the moved document last; it never locks the document row first.
- The baseline MCP `update_document` runs `documentUpdater` without a transaction, so it holds no lock across those statements; the fork's enforced transaction is what introduces the document-then-collection order.

**Pair.** Unit A implements AD-8 literally: the collection lock is taken first only when the request publishes or unpublishes. An enforced title, icon, or color update of a published document (or of any descendant of a document being moved) holds the document row and then requests the collection lock in the hook. Cycles: against `move_document` (holds the collection, waits for the descendant or document row); against an enforced unpublish or publish of the same document (collection then document). PostgreSQL aborts one side; the victim can be the baseline mover, which must "keep baseline behavior in every policy state". The Sequelize `retry: { match: [/deadlock/i] }` in `database.ts` cannot recover a transaction that is already aborted. Unit B takes the collection lock first for every enforced update of a document with a classified collection. AD-8's "cannot deadlock" is true only for Unit B.

**Tighten (AD-8).** "An enforced update, publication, or unpublication of a document with a classified collection takes that collection's `NO_KEY_UPDATE` lock before the document row lock, whatever fields it changes." This serializes enforced updates within a collection for the P3 to P8 span; if that cost is refused, record the doc-then-collection order as an accepted residual and map a deadlock to rows 3 or 5.

### R3-7 (Medium). "One System Failure per (unit, code)" has no location that names the unit

**ADs:** AD-11 (document-unit rule on every surface), AD-12 ("a failure of one check is located `scope { scopeKind: "collection", collectionId }`"), AD-3 (Location `scope` for `VALIDATION_RUNTIME_FAILED`/`VALIDATION_TIMEOUT`), AD-4 (`scope` carries only `scopeKind` and `collectionId?`), AD-14 (`counts.byCode`).

**Pair.** In `lint_wiki`, three documents each lose the same rule kind to `VALIDATION_RUNTIME_FAILED`. Under the text, three System Failures result, all located `scope{collection, collectionId}` with identical messages. Unit A emits three byte-identical entries (`byCode: 3`). Unit B, whose serializer or sort step dedupes on (code, location) as the natural key, emits one. `systemFailures.length`, the audit counts, and `state` inputs differ, and neither result tells the agent which document to retry. A second oddity from the same rule: a `lint_document` with one failed rule kind and retained Errors is `failed` (the only unit is not "completed"), so a `failed` result may carry Findings, while a snapshot failure carries none.

**Tighten (AD-4, AD-11, AD-12).** Either extend the scope location so a document-unit failure names its document (`scope { scopeKind: "document", documentId, collectionId? }`, sorted by document ID), or change the cardinality to one per (collection, check, code) and drop "(unit, code)". State in AD-12 that `failed` may carry retained Findings and that clients must not drop `errors` on `failed`.

### R3-8 (Medium). The enforced import shares the baseline task name

**ADs:** AD-7 ("The shared HTML import job gains a server-only caller intent; baseline API mode remains unchanged"), AD-19 (rollout gates), AD-11/AD-13 (fail-closed default).

**Baseline fact.** `BaseTask.schedule` enqueues `{ name: this.constructor.name, props }` (`BaseTask.ts:19-27`); the worker resolves `tasks[name]` and throws for an unregistered name (`worker.ts:171-181`).

**Pair.** Unit A adds the intent as extra props on `DocumentImportTask`. A worker that lacks the implementation (a lagging worker image, a mixed-version window during an image change while a policy is `enforced`) runs the baseline import, ignores `expectedPolicyFingerprint`, `documentId`, and `readable`, and persists an unvalidated document in an enforced collection; the requester, expecting an `EnforcedImportResult`, gets `{ documentId }` or `{ error }` and has no defined mapping. Unit B registers a distinct task class: an older worker fails the job ("Task ... is not registered"), the requester reports row 7, and nothing is persisted. AD-19 covers mixed policy fingerprints but not mixed code between the web and worker services.

**Tighten (AD-7).** "The enforced import is a distinct registered task (its own class and name) that shares the conversion code; `DocumentImportTask` is unchanged. The requester treats a result without the `EnforcedImportResult` shape as row 7."

### R3-9 (Medium). "Baseline text ... never driver text" contradicts baseline behaviour

**ADs:** AD-7 ("`message` is baseline text or the fixed generic message, never driver text"), AD-20 ("Timing and messages": only failures "without a baseline analog" get the fixed message; rows 3 and 5 say "baseline content"), Conventions/CLAUDE.md (preserve information-disclosure boundaries).

**Baseline facts.** `error(err)` in `server/tools/util.ts:105-112` returns `errToString(err)`, which is `err.message`; the baseline `DocumentImportTask.perform` returns `{ error: errToString(err) }` for any exception (`:128-129`). For a database error that message is the driver text (a constraint name, for example). So "baseline text" is driver text for exactly the "database error" the P7 row lists, while AD-7 forbids it.

**Pair.** Unit A passes `errToString` through on both paths (baseline parity). Unit B whitelists Outline application errors (`ValidationError`, `InvalidRequestError`, authorization) and answers everything else with the fixed message. The Markdown path and the HTML path can then differ for the same failure, and Unit A widens nothing beyond the baseline while Unit B narrows it. Create, update, and worker are the divergence AD-20 `Prevents`.

**Tighten (AD-20, AD-7).** Define "baseline content" as the message of an Outline application error (one that carries a stable `id`), and answer every other failure (driver, Redis, storage, unknown) on every path with the fixed message. Apply the same definition to `aborted.message`.

### R3-10 (Low). A requester summary after an ambiguous enqueue failure defeats the worker's row

**ADs:** AD-7 ("The requester writes a summary only for an outcome it determines itself before scheduling the job, and a failed `queue.add` is row 7 unless the call definitively did not enqueue"), AD-14 (`ON CONFLICT DO NOTHING`).

**Pair.** "Definitively" is undefined. Unit A treats a rejected `queue.add` promise as definitive and writes `aborted_before_decision`; the Redis write may have landed, the ghost job commits, and its `validated` summary loses to the requester's row on the shared Event ID. Unit B treats every `queue.add` error as ambiguous (row 7, no summary).

**Tighten (AD-7).** "Only a failure before `queue.add` is called is requester-determined (row 3). Any error from `queue.add` itself is row 7 with no requester summary."

### R3-11 (Low). Status-only reconstruction is under-specified against AD-12

**ADs:** AD-7 (reconstructed from the summary "as status and policy identity with empty `errors` and `warnings`"), AD-12 (`validation` shape, readability gate), AD-13 (`degraded_validation` "still returns ... the triggering safe System Failure").

**Pair.** `systemFailures` is not mentioned. Unit A returns it empty, yielding `degraded_validation` with no System Failure; Unit B rebuilds one entry per `counts.byCode` code with the generic message and the collection scope location. `validated_with_warnings` with empty `warnings` is accepted as a limitation, but nothing tells clients that `status` is authoritative. The AD-12 rule "exactly one policy identity when the actor can read" applies to a reconstructed object by its letter, but AD-7's "policy identity" wording invites copying the actor-independent audit fields (present whether or not the actor can read the collection) without applying `readable`.

**Tighten (AD-7, AD-12).** "On a reconstructed result, `errors` and `warnings` are empty, `systemFailures` is rebuilt from `counts.byCode` (one entry per counted code, fixed message, collection scope location), the policy identity follows the intent's `readable` flag, and `status` is authoritative."

### R3-12 (Low). The failure-handler fix covers one of four logging sites

**ADs:** AD-7 ("the queue's failure handler logs only the job ID and task name for an enforced job"), AD-18 ("the absence of content in job-failure logs"), Conventions/Logging.

**Baseline facts.** `worker.ts:175` sends `props` to the tracer (`addTags({ props })`); `:183` logs `props` at every task start (`Logger.info("worker", "... running", props)`); `:196` logs `props` on failure. `queue.ts:63` logs `data: job?.data` on the final failure. `Logger.sanitize` redacts only `accessToken`, `refreshToken`, `token`, `password`, `content`, and only in production (`Logger.ts:205-211`), so `attributes.title`, `sourceMetadata.fileName`, `actorId`, `sourceIp`, and the staged key reach logs and the tracing vendor. Unit A implements the letter (the `failed` handler) and passes the AD-18 test; Unit B redacts all four. **Tighten:** state that an enforced job's props appear in no log line or tracer tag beyond job ID and task name, at every site, and extend the AD-18 fixture from "job-failure logs" to "worker start, failure, tracer tags, and queue failure".

### R3-13 (Low). Probe mechanics are unspecified

**ADs:** AD-20 "Commit detection", AD-14 (`validationCorrelationId`).

- The update probe reads "the writer's mutation Event carrying `validationCorrelationId`". `events.data` is JSONB with no index on it (`Event.ts:61`; `migrations/*events*`: indexes on `documentId`, `name`, `actorId`, `createdAt`, `teamId+collectionId`, `userId`). Unit A filters `data->>'validationCorrelationId'` and scans the largest table in the schema, times out, and books row 7 for every failed COMMIT; Unit B keys on `documentId` plus `name` plus `createdAt >= transaction start` and filters the payload. Name the query and require `paranoid: false` for the create probe (a soft-deleted row is still committed).
- "Within a code-owned bound" is a client timer unless the probe runs in a short transaction with `SET LOCAL statement_timeout`; the statement otherwise keeps running on a pooled connection.
- `Event.data` "will be visible to the client" (`Event.ts:58-61`) and `presentEvent` returns it to every `events.list` caller (`presenters/event.ts`), so `validationCorrelationId` on ordinary `documents.update` events tells any reader of the activity feed that the write was enforced. This is the same class as the accepted `state` residual, but it reaches readers who cannot call the lint tools; record it in the AD-12 residual sentence.

### R3-14 (Low). Residuals

- *Cancellation before the decision.* AD-20 honors MCP cancellation and disconnect before the persist decision but assigns no row. Unit A treats it as the row 3 catch-all with an `aborted_before_decision` summary; Unit B rolls back silently. Add "cancellation before the decision is row 3".
- *Empty file.* AD-6 says an absent path "has the `policySetFingerprint` of the empty set, which an explicit empty file also produces". A zero-byte file is malformed under AD-5 and blocks startup; Unit A treats it as the empty set (typical of an unset ConfigMap mount). Say "a file containing `{ "schemaVersion": 1, "collections": {} }`".
- *Environment transport.* AD-5 allows an inherited environment variable "or" cluster IPC. Linux limits one environment string to 128 KiB (`MAX_ARG_STRLEN`; not tested here), so a large policy file base64-encoded fails at `fork` under one choice and not the other. Prefer IPC or state a maximum file size.
- *Abandoned preparation.* AD-11's 30 s P2 bound cannot cancel baseline conversion or fetch code; the shell can only stop waiting. Work that continues after the bound can stage a blob after the row 3 cleanup ran, which the D-9 sweeper (crash orphans) does not describe. State that the stager refuses new blobs after its phase bound or after cleanup has begun.

## 4. Attacked and found closed (no finding)

- **Probe for update with no writer Event.** A no-op update is a P7 row 5 before COMMIT; draft unpublish is denied by policy and re-authorization; every persisting branch of `documentUpdater` creates an Event through `saveWithCtx` (including `publish` on an already published document, which saves with `name: "publish"`), so the "row present" probe has a row to find whenever a commit succeeded.
- **Lock order versus re-fetch when the collection is only known after the re-fetch.** The classified collection is known before the lock (classification precedes P3). If the document moved in between, the collection lock is on the stale collection, and the re-fetch after the document lock detects the change as row 2. A concurrent move of an ancestor blocks on the locked row and is seen after the wait under `READ COMMITTED`. No pair beyond R3-6.
- **Deadline sums on paper.** Markdown write 51 s, HTML requester wait 56 s, `lint_wiki` 63 s, all under 65 s; the failures are the unbounded terms (R3-4), not the bounded ones.
- **Lookup-first versus re-authorization.** Safe: the `documentId` is server-generated and never client-supplied, so a found row can only be the same invocation's own commit; the requester rebuilds the response through an actor-scoped load.
- **`lint_wiki` document set versus hierarchy and counts.** One set feeds `PUBLISHED_DOCUMENT_MISSING_FROM_STRUCTURE`, `evaluatedDocumentCount`, the AD-16 limits, and the keyset; parents and targets resolve through membership-aware queries (archived and draft targets resolve because AD-2 collapses only missing, deleted, and inaccessible ones).
- **Sentinel algebra with the document-unit rule.** A sentinel completes no unit; a partial-failure unit is not completed; `incomplete` versus `failed` follows from AD-12. Consistent (the location gap is R3-7).
- **Master hand-off of policy bytes.** `throng` runs `master()` once and forks workers that inherit the environment (`server/index.ts:34-62`); `printEnv` prints no environment (`utils/startup.ts:102-125`); respawned workers see the master's value. Consistent apart from R3-14.
- **`events.list` intersection.** The baseline already intersects names with the audit set and ignores others (`events.ts:41-49`); a new constant matches that shape.

## 5. Verified versus assumed

Verified in this run: baseline code paths cited above; Sequelize 6.37.8 `commit()` (`finished` set in `finally`, hooks run, connection destroyed), the postgres `run()` and `formatError` error mapping; the `applyStatementTimeoutToTransactions` wrapper covers unmanaged transactions; `git fetch --prune` current. Not re-verified: Bull defaults for lock and stall handling, PostgreSQL's GUC restoration at `ROLLBACK TO SAVEPOINT`, and the Linux environment string limit; each is marked where relied on, and each affects only the strength of R3-1 (concurrency window), R3-3 (savepoint variant), and R3-14 (transport).
