---
title: 'Story 2.7: Record Correlated and Failure-Isolated Write-Validation Audit Evidence'
type: 'feature'
created: '2026-10-04'
baseline_revision: '69cee7443a760a20016d81bafbdec9018e8b89d0'
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

**Problem:** Only the enforced HTML create records `wikiLint.write_validation` summaries. The worker writes them, and the requester writes one for its own pre-schedule row 3 (Story 2.5). An enforced Markdown create or update records none in rows 3, 4, 5, or 6, and neither does an invalid-policy sentinel rejection on any path, Markdown or HTML. `writeAuditData` also always emits the policy fields, so it cannot express a sentinel summary. Binding acceptance is `_bmad-output/planning-artifacts/epics.md`, Story 2.7, ACs 1–9. This story also owns the integrated fixtures of Story 2.1 AC10 and Story 2.3 AC11.

**Approach:**
- Add one request-path summary recorder in `writeAudit.ts`.
- The enforced Markdown shell initiates the summary after an established commit and awaits it before the post-commit assembly deadline starts. After a rejection or abort, it records the summary once the rollback (and staged-media cleanup) has ended.
- The MCP handler records the sentinel rejection's summary, without policy fields.
- The audit writer, the HTML worker, and the `auditWikiLint` surface stay as they are. New fixtures prove the whole AD-20 matrix, correlation, minimization, actor independence, authorization, replacement, and failure isolation.

## Boundaries & Constraints

**Always:**

- **Rows and outcomes (AD-14, AD-20).** Each established request-path attempt persists exactly one summary through `recordWriteAudit` → `insertAuditEvent`. Its Event `id` is the attempt's `invocationId`.
  - Row 3 records `aborted_before_decision` and row 5 records `aborted_after_decision`. Both have `complete: false`, zero evaluated counts, zero `counts` with `byCode: {}`, `runtimeFailOpenExercised: false`, and the valid-policy fields.
  - Row 4 records the decided `rejected`. Its `complete` is true only for an Error-only rejection, and its evaluated counts come from `evaluatedCounts`.
  - Row 6 records `validated`, `validated_with_warnings`, or `degraded_validation` through `writeAuditData`, unchanged.
  - Rows 1 (baseline, unconfigured, `read_only`, null collection, and `classification.kind === "failed"`), 2, and 7 record nothing on the request path. The HTML worker's own summaries (Story 2.5) are unchanged.
- **Sentinel.** An invalid-policy sentinel on `create_document` (Markdown or HTML) or on `update_document` records `{ kind: "policy_rejection" }` under a fresh `randomUUID()` invocation ID. It omits both `policySchemaVersion` and `policyFingerprint`, and it persists no `invalidFingerprint`. The handler records it only when `rejectInvalidPolicyWrite` returned the modeled rejection, before returning that rejection. Its only transaction is the independent audit insert (Story 2.1 AC10).
- **Row columns.**
  - `collectionId` is always the classified collection (`entry.collectionId`).
  - `documentId` is the target of every update summary, since P0 loaded that row. On a create it is the pre-allocated ID, and only in row 6.
  - `ip` is `extra.ip` when it is a string, otherwise null.
  - The data and columns never depend on `readable`.
- **Attribution.** Attribution comes only from `/mcp` `AuthInfo.extra`:
  - `requestId` must match `UUID_PATTERN`;
  - the credential envelope comes from `authEnvelopeOf`, moved unchanged from `enforcedHtmlCreate.ts` into `writeAudit.ts` and exported.
  - An invalid `requestId` or credential envelope is an audit failure, thrown inside the row builder so that `awaitAuditWrite` logs it.
  - `durationMs` is `Math.max(0, Math.round(monotonicClock() - enteredAt))`, read when the summary write is initiated. `enteredAt` is the handler's first `monotonicClock()` reading.
- **Timing (AD-11, AD-15).**
  - Row 6: the summary is initiated in `onCommitted`, after the commit is established and before the callbacks start. `runAttempt` awaits the promise that `onCommitted` returns, ignoring a rejection, and only then starts the `POST_COMMIT_ASSEMBLY_BOUND_MS` deadline that the callback wait and the enrichments share.
  - Rows 3, 4, and 5: the summary is recorded after `runAttempt` returns, once the rollback and the media cleanup have ended.
  - The insert always runs in `insertAuditEvent`'s own transaction, never in the enforcement transaction.
- **Failure isolation (FR-22).** No audit result reaches the MCP response or changes the row. The only diagnostic is the existing `Logger.warn("Wiki lint audit write failed", { requestId, invocationId, reason })`.

**Never:**
- Do not change `insertAuditEvent`, the `events.list` route, `server/policies`, Event retention, the HTML worker's summary logic or result union, `validationFromSummary`, or the correlation hook.
- Do not modify `server/models`, `server/storage`, `server/commands`, `server/presenters`, `shared/utils`, `server/editor`, `server/routes`, `plugins`, `server/queues`, or `server/migrations`.
- Do not change a tool schema or description, or the response of any row. Do not widen the mutation transaction, and do not write a summary inside it.
- Do not log a body, heading, field, target, key, fingerprint, or error text. Do not add DW-9 abort logging.
- Do not edit `sprint-status.yaml`, `deferred-work.md`, `epics.md`, `server/tools/README.md`, or the SPEC, PRD, or spine. Add no pilot identifiers.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Committed create | Enforced `REQUIRED`; valid body | Response unchanged. One summary: `outcome: validated`, `complete: true`, `evaluatedDocumentCount: 1`, both policy fields, `documentId` = new doc. Its `id` equals the `documents.create` Event's `data.validationCorrelationId` | — |
| Warnings / degraded | `DISCOURAGED` quote; `open` policy with a failing savepoint read | `validated_with_warnings` with the warning in `byCode`; `degraded_validation` with `complete: false`, `runtimeFailOpenExercised: true`, evaluated 0 | Row 6 |
| Error rejection | Body without Overview: a create, and an update | `rejected`, `complete: true`, evaluated 1, `REQUIRED_SECTION_MISSING: 1`. A create has no `documentId`; an update has the target's | Row 4 |
| Fail-closed rejection | Closed policy with `internal_links` and a failing savepoint read | `rejected`, `complete: false`, `VALIDATION_RUNTIME_FAILED: 1` | Row 4 |
| Sentinel | Markdown create, HTML create, and update into a sentinel collection | Same modeled rejection. The summary is `rejected`, `complete: false`, evaluated 0, `systemFailures: 1`, `byCode: { POLICY_CONFIGURATION_INVALID: 1 }`, with no policy fields | Row 4 |
| Aborts | Absent patch `findText`; unchanged update; unpublish of a parent | Same `isError` result. `aborted_before_decision` or `aborted_after_decision` with zero counts and both policy fields; `documentId` = target | Rows 3, 5 |
| No summary | Unconfigured, `read_only`, P1 bound exceeded, parent moved (`collection_conflict`), COMMIT socket destroyed | Same result as today, and no `wikiLint.write_validation` row | Rows 1, 2, 7 |
| Audit failure | The summary INSERT rejects; or it is held past 3 s | Response identical to the healthy run, after normalizing the allocated IDs, breadcrumb included. One warn with exactly `requestId`, `invocationId`, `reason` (`error` or `timeout`) | Diagnostic |
| Non-reader | A document-membership editor and a collection member make the same rejected update | Equal `data` except `requestId` and `durationMs`. Equal `collectionId`/`documentId` columns, with policy fields in both | — |

</intent-contract>

## Code Map

- `_bmad-output/planning-artifacts/epics.md:1406-1465` -- binding ACs. The spine `ARCHITECTURE-SPINE.md` gives AD-14 at `:223-273` (Event rows, policy fields, sentinel, aborts), AD-15 at `:275-279`, the AD-11 totals at `:169` ("a Markdown write 55" = 2+30+9+9+3+2, so the audit precedes assembly), and the AD-20 table at `:312-343`. PRD FR-20–FR-22 are at `prds/prd-outline-2026-09-20/prd.md:407-442`.
- `server/wikiLint/application/writeAudit.ts`:
  - `WriteAuditOutcome` `:40-47`;
  - `evaluatedCounts` `:70`;
  - `writeAuditData` `:102-187` (policy fields always at `:176-177`; make them optional);
  - `writeAuditRow` `:200`, `recordWriteAudit` `:234`.
  - It already imports `type ProjectionValidation` from `./enforcedWrite`. Keep that import type-only, so no runtime cycle forms when `enforcedWrite.ts` imports functions from here.
- `server/wikiLint/application/readAudit.ts:234` `awaitAuditWrite` -- the bounded wait and the single minimized warn. Reuse it through `recordWriteAudit`.
- `server/wikiLint/application/enforcedHtmlCreate.ts:106-118` `authEnvelopeOf` (move it). `:212-244` is the requester's row-3 summary, behavior unchanged.
- `server/wikiLint/application/enforcedWrite.ts`:
  - `AttemptOptions.onCommitted` `:399-403`;
  - `runAttempt` `:432-458`;
  - P8, then the assembly deadline, `onCommitted`, and `runCallbacks` at `:610-644`. Today the deadline starts before `onCommitted`; move it after the awaited hook;
  - `enforceMarkdownCreate` `:667-703` and `enforceMarkdownUpdate` `:721-774`.
- `server/wikiLint/application/enforcedImport.ts:440-483,734-739` -- the worker's `summarize` and `onCommitted` (returns `undefined`; it must stay unchanged in behavior).
- `server/wikiLint/application/deadline.ts:42-47` -- `POST_COMMIT_ASSEMBLY_BOUND_MS` doc ("measured from the established commit") becomes "from the established commit, once any awaited summary write has settled or expired".
- `server/wikiLint/application/writeClassification.ts:108` `rejectInvalidPolicyWrite`, unchanged.
- `server/tools/documents.ts`:
  - `nonBaselineWriteResult` `:98-109`, `requestIdOf` `:117`;
  - create handler `enteredAt` `:743`, Markdown enforcement `:761-792`, sentinel or failed `:817-819`;
  - update handler `enteredAt` `:1055`, enforcement `:1069-1094`, sentinel or failed `:1095-1097`.
  - `/mcp` fills `extra` at `server/routes/mcp/index.ts:205-218`.
- Unchanged infrastructure:
  - `server/wikiLint/adapters/auditEvents.ts:110-143` (insert with `ON CONFLICT` replacement and no enqueue);
  - `writeTransaction.ts:125-138` (correlation hook), `:394-421` (`runCallbacks`);
  - `server/routes/api/events/events.ts:42-46` (`auditWikiLint`), `server/policies/team.ts:54`, `server/presenters/event.ts` (`data` is presented).
- Tests that change because rows 3, 4, and 5 and the sentinel now write a summary:
  - `server/tools/documents.enforcement.test.ts`: `storedState` `:217` and `callWithoutEffect` `:265-304` (23 call sites, among them the sentinel paths, the enforced rejections, row 3 `:1941-1994`, and row 5 `:1996-2055`);
  - `server/tools/documents.enforcedMedia.test.ts:625-651` (an `Event.count` equality);
  - the helpers `create` `:216` and `update` `:260` in `server/wikiLint/application/enforcedWrite.test.ts`;
  - `server/wikiLint/application/enforcedWrite.concurrency.test.ts:144,174`.
- Already covered, keep passing:
  - the AD-7 mismatch summary (`enforcedImport.test.ts:841-899`);
  - the HTML worker's row 3, 4, 5, and 6 summaries, and the worker's own row-7 summary (the Story 2.5 suites);
  - adapter replacement (`auditEvents.test.ts:152-254`).
- Patterns to reuse:
  - `failSavepointReads`, `atEnforcementCommit`, and `interceptQueries` (`documents.responses.test.ts:319-390`);
  - the non-reader fixture (`documents.enforcement.test.ts:914-937`);
  - the parent-move conflict (`:1810-1872`) and the socket-destroyed COMMIT (`documents.responses.test.ts:927-966`);
  - `storeSummary`, `summaries`, `stagedIntent`, and `expectCommitted` (`enforcedImport.test.ts:244-436`);
  - the `events.list` calls (`server/routes/api/events/events.test.ts:493-665`).

## Tasks & Acceptance

**Execution:**
- `server/wikiLint/application/writeAudit.ts`:
  - `writeAuditData` takes `policyFingerprint?: string` and emits `policySchemaVersion: 1` and the fingerprint only when one is given.
  - Move and export `authEnvelopeOf`.
  - Add `RequestAuditInput { extra; enteredAt; write? }` and `recordRequestWriteAudit(input & { invocationId, actor, operation, collectionId, documentId?, policyFingerprint?, outcome })`, which applies the attribution and duration rules above and returns `recordWriteAudit`'s promise.
  - Covers AC1–AC3 and AC7.
- `server/wikiLint/application/enforcedHtmlCreate.ts` -- Import `authEnvelopeOf` from `./writeAudit`. No other change.
- `server/wikiLint/application/enforcedWrite.ts`:
  - `onCommitted` may return `void | Promise<void>`. `runAttempt` runs `await Promise.resolve(runHook(...)).catch(() => undefined)`, then creates the assembly deadline.
  - Add a private `runAuditedAttempt(args, { operation, documentId }, plan)`, sketched in the Design Notes.
  - `enforceMarkdownCreate` and `enforceMarkdownUpdate` take a required `audit: RequestAuditInput` and run through it. The create passes `classification.documentId` and the update its `documentId`.
  - Covers AC1, AC4–AC6.
- `server/wikiLint/application/deadline.ts` -- Update the assembly-bound documentation.
- `server/tools/documents.ts`:
  - Both enforced Markdown calls pass `audit: { extra: context.authInfo?.extra, enteredAt }`.
  - `nonBaselineWriteResult` becomes async. It takes `{ actor, operation, documentId?, extra, enteredAt }` and records the sentinel summary. The create passes no `documentId`; the update passes `document.id`.
  - The `failed` branch is unchanged.
- Tests, all collocated:
  - `writeAudit.test.ts`: the sentinel data without policy fields; `recordRequestWriteAudit` attribution, `ip`, `documentId`, duration, and the invalid-`requestId` and invalid-envelope audit failures.
  - `enforcedWrite.test.ts`: the `create`/`update` helpers pass `audit` with a valid `extra` and an in-memory recorder `write`. New cases cover:
    - the exact row per AD-20 row 3, 4, 5, and 6, and none for 2 and 7;
    - `documentId` per create and update;
    - `requestId` equal to `extra.requestId`;
    - the row-6 order: enforcement COMMIT, then the summary write, then `assembly.startedAt` (a writer delayed 50 ms);
    - a rejecting `onCommitted` promise leaves row 6 unchanged.
  - `enforcedWrite.concurrency.test.ts`: pass a no-op `write`.
  - `enforcedImport.test.ts`: three worker replacement cases with `storeSummary` seeded under the intent's `invocationId`. A seeded `aborted_before_decision` and a seeded `rejected` are each replaced by a committed run, with `createdAt` kept. A seeded `validated` is unchanged after a run that aborts in row 3 with the source missing.
  - `documents.enforcement.test.ts` and `documents.enforcedMedia.test.ts`:
    - `storedState` and the Event counts exclude `wikiLint.write_validation`;
    - `callWithoutEffect` takes the expected summary outcome (or none) and allows exactly one `INSERT INTO events` with one more transaction when a summary is expected;
    - each call site and the row-5 and media no-effect tests assert that summary.
  - `server/tools/documents.enforcedAudit.test.ts` (new, MCP level) covers every matrix row and the ACs below.

**Acceptance Criteria:**
- Given a row-6 Markdown write, when its SQL and `globalEventQueue().add` are recorded in order, then the enforcement `COMMIT;` precedes the summary `INSERT INTO events`, which runs in another transaction after its own `SET LOCAL statement_timeout = 3000`. The first enqueue follows the summary insert. Every `documents.*` Event of the write has `data.validationCorrelationId` equal to the summary `id`, with its baseline keys kept.
- Given a row-3, row-4, or row-5 write, when its summary INSERT is intercepted, then a fresh-connection read at that moment finds no Event whose `validationCorrelationId` is that ID, and the update target's `revisionCount` is unchanged.
- Given the whole matrix, when `globalEventQueue().add` is spied, then no call carries a `wikiLint.*` name. Every stored summary's `data` has only `AuditDataV1` keys and contains no body text, heading, Finding message, link target ID, or `invalidFingerprint`.
- Given summaries written through MCP by members of team A, including an HTML create, when an admin of team A calls `events.list` with `auditWikiLint: true`, then they can compute from the response alone:
  - counts per `operation`, `outcome`, and `complete`;
  - error, warning, and System Failure totals and `byCode` totals;
  - aborted and degraded counts;
  - `durationMs` values.
- Given those summaries, when a member uses `auditWikiLint`, then the call fails with 403. When the member lists activity by `documentId`, and when an admin of team B uses `auditWikiLint`, then no summary appears. A write rejected for a link to an unreadable document records the same `byCode` as a link to a missing one, and neither target ID appears.
- Given `git diff 69cee7443a760a20016d81bafbdec9018e8b89d0` for the protected paths in **Never**, when it is read, then it is empty.
- Given the existing suites, when they run, then every fixture passes. The only changes are the listed helpers and the assertions of the new summaries.

## Spec Change Log

## Review Triage Log

### 2026-10-04 — Follow-up review pass

- verdicts: 13 findings — high 0, medium 0, low 11, false 2, maybe-false 0
- findings:
  - `[low]` `[reject]` blind: an unbounded `onCommitted` promise could hang `runAttempt` after commit — carried: the Markdown hook returns `recordRequestWriteAudit`, whose `awaitAuditWrite` settles within 3 s; the worker hook returns `undefined`. No reachable caller supplies an unbounded promise.
  - `[low]` `[reject]` blind: `enteredAt = Infinity` becomes `durationMs: 0` — the handler reads `enteredAt` from the monotonic clock, and no ordinary request supplies Infinity. Extra input guards for a faulty or mocked clock add complexity without a reachable production defect.
  - `[low]` `[reject]` blind: optional `policyFingerprint` allows the wrong policy-field shape — carried: the only caller without a fingerprint is the sentinel, while every valid-policy path supplies one; the shape is also asserted by the request and worker fixtures. The optional signature is prescribed by the spec.
  - `[low]` `[patch]` blind: the assembly-bound comment still says it is measured from commit — corrected `deadline.ts` to say the deadline starts after the awaited post-commit summary settles or expires.
  - `[low]` `[patch]` blind: the timeout test's upper bound included unbounded pre-audit work — measured its elapsed time from the summary INSERT interception instead of the MCP call's start.
  - `[low]` `[patch]` blind: `summariesOf` sorts only by `createdAt`, so equal timestamps could swap the two actors — the actor-independence test now finds each summary by its `actorId`.
  - `[low]` `[reject]` blind: the MCP test checks a UUID-shaped `requestId` without equating it to the route's value — carried: `/mcp` generates the ID and the application test pins that the summary copies `extra.requestId` verbatim. Capturing the route's private value would require another test seam.
  - `[low]` `[reject]` blind: the MCP matcher accepts any OAuth `authenticatedClientId` string — the test fixture creates its credential through the existing OAuth factory, and the application test pins extraction from the credential envelope. An exact end-to-end assertion would require additional credential lookup and does not exercise a distinct request-path branch.
  - `[low]` `[patch]` blind: the sentinel MCP test omitted actor attribution — added `actorId: user.id` for Markdown create, HTML create, and update.
  - `[low]` `[reject]` blind: audit-failure injection covers updates but not the sentinel handler — carried: every request-path summary awaits the same bounded, never-rejecting `recordRequestWriteAudit`, whose error and timeout behavior is separately tested. A sentinel-specific injection adds no new failure branch.
  - `[low]` `[reject]` edge: a never-settling `onCommitted` promise could block callbacks and the response — carried: same location and claim as the first blind finding; the two actual hooks have bounded or synchronous return values.
  - `[false]` `[reject]` intent: fixtures do not exhaust every production policy and failure combination — the intent requires the AD-20 rows and listed scenarios, not their Cartesian product; the MCP and application fixtures exercise those surfaces.
  - `[false]` `[reject]` intent: the operator test validates duration values rather than aggregating them — the acceptance asks for `durationMs` values, which the `events.list` response exposes and the test checks as nonnegative integers.

### 2026-10-04 — Review pass

- verdicts: 27 findings — high 0, medium 0, low 21, false 6, maybe-false 0
- findings:
  - `[low]` `[patch]` blind: no test covers a commit that only the probe established, and the adjacent row-7 media test never asserts that no summary exists — Fixed: the probe-established test in `documents.enforcedMedia.test.ts` now asserts exactly one `validated` summary with the target's `documentId`. The row-7 test asserts that the team has no write summary.
  - `[low]` `[patch]` blind: the open-policy rejection of an ineligible size records a summary, but nothing asserts it — Fixed: the row-4 branch of "fails open under an open policy at $bytes bytes" asserts `outcome: "rejected"` and `runtimeFailOpenExercised: false`.
  - `[low]` `[patch]` blind: "records a row 3, 4, or 5 summary only after the rollback and the media cleanup" runs only the row-4 and row-5 cases — Fixed: added the row-3 case, a `patch` with an absent `findText` and a data image. It asserts `["rollback", "cleanup", "summary"]`.
  - `[low]` `[reject]` blind: the AC5 MCP test exercises only `update_document` — A create uses the same `runAuditedAttempt` branch. That branch records only after `runAttempt` returns, and the unit test pins the rollback → cleanup → summary order. Adding create cases would mean restructuring the parameterized test, and the create adds no distinct branch.
  - `[low]` `[reject]` blind: the MCP audit-failure injection covers updates only: no create, no sentinel, no row 3 or row 5 — Every request-path call awaits the same `recordRequestWriteAudit`. Its never-rejecting, bounded contract is unit-tested for a rejected write, a builder that throws, and the timeout. Widening the MCP matrix adds no new branch.
  - `[low]` `[patch]` blind: the timeout case never checks the end state, and it has no upper bound on elapsed time — Fixed: it now asserts `elapsed < AUDIT_WRITE_BOUND_MS + POST_COMMIT_ASSEMBLY_BOUND_MS`. After the release it waits for the one stored `validated` summary, and then asserts there is exactly one warning.
  - `[low]` `[reject]` blind: `runAttempt` awaits the promise `onCommitted` returns with no bound of its own — It cannot be reached. The Markdown hook returns `recordWriteAudit`'s promise, which `awaitAuditWrite` resolves within 3 s even when the row builder throws. The worker's hook returns `undefined`. Bounding it again would add a guard for a caller that does not exist.
  - `[low]` `[reject]` blind: nothing stops a later rewrite of the worker's `onCommitted` into an expression arrow, which would make its callbacks wait for the summary — This is a hypothetical future edit, and the outcome would be only a later callback start, not a wrong row. Pinning the concurrency order would need a new timing fixture.
  - `[low]` `[reject]` blind: an optional `policyFingerprint` loses the compile-time link between a policy-configuration rejection and its policy fields — The only caller without a fingerprint is the sentinel. Every other path passes a string, and the MCP and worker fixtures assert the policy fields on each path. Restructuring the input goes against the spec's prescribed signature.
  - `[false]` `[reject]` blind: no negative test for the sentinel branch that throws — The branch cannot be reached. `decideWrite`, given one System Failure and `runtimeFailureMode: "closed"`, always returns `rejected`, and the `writeDecision` tests pin that.
  - `[low]` `[reject]` blind: the operator MCP test omits the AD-7 mismatch — `presentEvent` returns the stored `data` unchanged. The mismatch summary's policy fields and counts are asserted at `enforcedImport.test.ts:841-899`. Producing a mismatch over MCP would mean changing the served policy between the request and the worker.
  - `[low]` `[patch]` blind: row 1 never covers a null post-operation collection — Fixed: a collectionless draft create and an update of a collectionless draft, under an enforced configuration, succeed without `validation` and record no summary.
  - `[low]` `[reject]` blind: the concurrency suite discards its summaries — Each attempt draws a fresh `randomUUID()` invocation ID, and the unit test asserts that two summaries have distinct IDs. The audit insert takes an ordinary pool connection. A concurrent audit fixture would add complexity without a new branch.
  - `[low]` `[reject]` blind: the shell carries an unvalidated `requestId` for diagnostics beside the validated one in `audit.extra` — That diagnostic field predates this story (Story 2.3). `/mcp` always sets `extra.requestId = randomUUID()`, so the two cannot diverge on a real request. Consolidating them would change `ShellInput`.
  - `[low]` `[patch]` blind: `callWithoutEffect` builds the expected summary `documentId` from `args.id` — Fixed: it uses `targetId`.
  - `[low]` `[reject]` edge: `runAttempt` has no bound of its own on an `onCommitted` that never settles — Grouped with the matching blind row, and rejected for the same reason: no reachable hook can hang.
  - `[false]` `[reject]` edge (claim): a summary recorded "once the cleanup has ended" can be written while a deletion is still pending — The summary makes no claim that any blob was deleted. The bounded cleanup and its residual (a hung delete leaves an Outline-inaccessible blob and a correlated warning) are Story 2.6 behavior, and this story does not change them.
  - `[low]` `[patch]` verification-gap: `durationMs` is never pinned to the handler's first clock reading on the Markdown and sentinel paths — Fixed: a new MCP test, "the summary duration", serves 5000 at handler entry and 5012 afterwards. It asserts `durationMs === 12` for an enforced create, an enforced update, and a sentinel create.
  - `[low]` `[patch]` verification-gap (other): the row-3 case is missing from the rollback/cleanup order test — Grouped with the matching blind row, and fixed by the same added case.
  - `[false]` `[reject]` intent: on the process surface, the spec is still untracked and `in-review`, with no `operator_actions` — Finalization happens after this triage. No AC needs a human action outside the repo, so `awaiting-operator` does not apply.
  - `[false]` `[reject]` intent: the epic's "every attempt" reaches past the diff's Markdown and sentinel scope, to the HTML worker — Story 2.5's code already meets AC1, AC2, and AC6 on the worker and requester. Its summary is initiated in `onCommitted` and awaited before the job returns, ahead of the requester's response assembly. Its suites pass unchanged, and this diff adds worker-level replacement cases.
  - `[low]` `[reject]` intent: real-database ordering evidence covers only one committed create and the rows 3–5 of updates — The separate transaction and its statement timeout belong to the unchanged `insertAuditEvent`, which the adapter tests cover. The unit tests pin the order for every row, so the remaining cases share code.
  - `[low]` `[reject]` intent: AC7 injection runs at MCP level for `update_document` only — Grouped with the matching blind row, and rejected for the same reason.
  - `[false]` `[reject]` intent: Story 2.1 AC10's "opens no transaction" conflicts with the sentinel's audit transaction — AC10 itself requires that "one write-validation summary is attempted". The independent audit insert is that attempt, not a write-path transaction, and the spec's Boundaries settle this.
  - `[low]` `[patch]` intent: the crash-after-commit-before-audit gap is not explicit in the write path — Fixed: the `runAuditedAttempt` doc now records both evidence gaps, AD-15 included, and states that the summary never joins the mutation transaction.
  - `[false]` `[reject]` intent: AC8 "existing retention" is not exercised — This story does not touch the retention code, and Event retention is unchanged.
  - `[low]` `[reject]` intent: AC1's server-generated `requestId` is checked for equality only at application level — `/mcp` generates the value, and that code is unchanged. The unit test asserts that the summary copies `extra.requestId` verbatim, and the MCP tests assert its UUID shape. Pinning the route's value would need a new seam.

## Design Notes

**Why the audit precedes the assembly deadline.** AD-11 totals a Markdown write at 55 s: 2 + 30 + 9 + 9 + 3 (audit) + 2 (assembly). An audit write that hangs for 3 s must not use up the enrichment budget, because AC7 requires an unchanged result. The worker's `onCommitted` returns `undefined`, so its summary still runs alongside its callbacks, as it does today.

```ts
const outcome = await runAttempt(args, plan, {
  invocationId,
  onValidated: (v) => { validated = v; },
  onCommitted: ({ validation }) => record(decided(validation), true), // awaited before assembly
});
if (outcome.row === 3 || outcome.row === 5) await record({ kind: "aborted", row: outcome.row }, false);
else if (outcome.row === 4) await record(decided(outcome.validation), false);
return outcome;
```

**Update `documentId`.** An update's row exists by construction: P0 loaded it, and documents are soft-deleted. Only a permanent deletion racing between P0 and the summary could leave the column pointing at no row, and that column has no foreign key. The crash-after-commit-before-audit gap and the row-7 gap stay recorded evidence gaps (AD-15), not reasons to widen the transaction.

## Verification

**Commands:**
- `scripts/test-db.sh ensure` -- expected: exit 0.
- `TZ=UTC node_modules/.bin/vitest run --project server server/tools/documents.enforcedAudit.test.ts server/wikiLint/application/writeAudit.test.ts server/wikiLint/application/enforcedWrite.test.ts server/wikiLint/application/enforcedImport.test.ts server/tools/documents.enforcement.test.ts server/tools/documents.enforcedMedia.test.ts` -- expected: all pass.
- `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint server/tools server/routes/mcp server/routes/api/events server/routes/api/documents/documents.test.ts` -- expected: all pass.
- `corepack yarn tsc`, plus `node_modules/.bin/oxlint --type-aware` and `node_modules/.bin/oxfmt --check` on the changed files -- expected: clean.
- Temporary mutations, each reverted -- expected: a suite fails for each:
  - skip the row-4 summary;
  - start the assembly deadline before the awaited hook;
  - emit the policy fields for a sentinel;
  - set `documentId` on a rejected create.

## Auto Run Result

Status: done

**Summary.** The implemented Story 2.7 records one correlated `wikiLint.write_validation` summary for each established enforced Markdown create or update and each invalid-policy sentinel rejection. Its independent, bounded audit write leaves the MCP result unchanged on failure. Committed Markdown summaries settle before the post-commit assembly deadline; aborted and rejected attempts record after rollback and staged-media cleanup. The HTML worker and operator audit route retain their existing behavior.

**Files changed since `baseline_revision`.**
- `server/wikiLint/application/writeAudit.ts` — shared request-path recorder, attribution, and sentinel data without policy fields.
- `server/wikiLint/application/enforcedWrite.ts` — Markdown row summaries and awaited committed summary before assembly.
- `server/wikiLint/application/enforcedHtmlCreate.ts` — import of the moved credential-envelope helper.
- `server/wikiLint/application/deadline.ts` — accurate assembly-bound documentation.
- `server/tools/documents.ts` — handler audit inputs and sentinel summary recording.
- `server/tools/documents.enforcedAudit.test.ts` — MCP-level row, correlation, isolation, authorization, minimization, actor, and operator-surface evidence.
- `server/wikiLint/application/writeAudit.test.ts`, `enforcedWrite.test.ts`, `enforcedWrite.concurrency.test.ts`, and `enforcedImport.test.ts` — recorder, shell, concurrency, and worker replacement cases.
- `server/tools/documents.enforcement.test.ts`, `documents.enforcedMedia.test.ts`, and `documents.enforcedHtml.test.ts` — existing tool fixtures adapted to the new summaries.
- This spec — review triage and verified hand-back.

**Follow-up review.** This pass found 13 items: high 0, medium 0, low 11, false 2, maybe-false 0. Four low items were patched: the assembly-bound comment, timeout measurement, deterministic actor comparison, and sentinel actor assertion. No item was deferred. Seven low items were rejected: the unbounded-hook claim appeared twice but neither actual hook can hang; an infinite handler clock is not reachable in ordinary requests; optional policy fields match the prescribed sentinel shape; the application test pins the server request ID copy; the OAuth fixture and unit test cover credential attribution; and sentinel audit failure shares the tested bounded recorder. Two intent observations were rejected because the ACs require the listed rows and duration values, not an exhaustive configuration product or duration aggregate. The individual verdicts and reasons are in this pass's Review Triage Log. Patched entries by verdict: high 0, medium 0, low 4. `followup_review_recommended: false`; no specific unverified risk calls for another automatic review.

**Verification (2026-10-04).** `scripts/test-db.sh ensure` exited 0. After the patches, the six targeted files passed 342/342 tests. The broad server scope first hit PostgreSQL's client limit and was stopped; repeating that same scope with `--maxWorkers 2` passed 2257/2257 tests across 51 files. `corepack yarn tsc`, type-aware `oxlint`, `oxfmt --check`, `git diff --check`, and the protected-path diff were clean. The four mutation checks from the first review pass remain recorded in the prior committed run; this follow-up changed only a test and a comment, so they were not rerun.

**Residual risks.** The accepted AD-15 evidence gaps remain: a crash between commit and summary, or a row 7 whose COMMIT landed, can leave no summary. A slow audit can delay post-commit callbacks by up to 3 s. The update `documentId` has no foreign key if a permanent deletion races the summary. The orchestrator-owned `sprint-status.yaml` was neither modified nor reverted in this run.
