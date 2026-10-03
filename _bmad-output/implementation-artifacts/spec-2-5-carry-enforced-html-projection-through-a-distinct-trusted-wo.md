---
title: 'Story 2.5: Carry Enforced HTML Projection Through a Distinct Trusted Worker Task'
type: 'feature'
created: '2026-10-03'
baseline_revision: 'e0b16b9ac2b5ce8c4ebbc900aa00d8cde27ee33d'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      An enforced HTML create persists the imported Y.js state, built before the Markdown round trip, while validation runs on the content re-parsed from that Markdown, so editor-visible state could hold structure the lint never evaluated.
    evidence: |-
      The baseline DocumentImportTask persists the same text/state split, and the projection parity tests prove the enforced path matches it (documentProjection.test.ts "HTML creates"). Unverified: whether any DocumentConverter output loses lint-relevant structure (headings, metadata lines, links, discouraged structures) in serializer.serialize -> toProsemirror. Settle it with a fixture sweep across the converter's node and mark coverage that compares yDocToProsemirrorJSON(state) with the validated content. If lint-relevant divergence exists, an architecture decision is needed between failing closed and deriving state from the validated content (the latter departs from exact baseline semantics).
    location: >-
      server/wikiLint/adapters/documentProjection.ts (prepareHtmlCreate)
    severity: medium (unverified)
---

<intent-contract>

## Intent

**Problem:** An MCP `create_document` with `format: "html"` into a collection with a valid `enforced` policy still ends in the interim `OPERATION_FAILED` (`server/tools/documents.ts:107-109`). HTML conversion must run off the request process. Nothing yet carries a classified write through a worker without trusting client claims, materializing against stale policy or authorization, or reporting a committed write as a failure. Binding acceptance is `_bmad-output/planning-artifacts/epics.md`, Story 2.5, ACs 1–11. This story also owns the AD-7 fingerprint-mismatch fixtures (cross-story map 2.4 AC3 → 2.5) and the worker `collection_conflict` (2.1 AC11 → 2.5).

**Approach:**
- The handler stages the HTML in file storage and builds a credential-free trusted intent. It then schedules a new `EnforcedDocumentImportTask`, which shares the baseline conversion code.
- The worker first looks up the pre-allocated document. It then re-checks the actor, the destination, the collection, and the policy fingerprint, and converts the HTML with media refused (Story 2.6 stages media).
- The worker then reuses the Story 2.3 attempt (`runAttempt`) through a few optional hooks. It owns the decision, the commit, and the `wikiLint.write_validation` summary. A committed summary may replace an aborted or rejected one.
- The requester waits until `deadlineAt` and probes the pre-allocated ID before it reports any non-committed outcome. It maps the closed result union onto the existing AD-20 rows and response shapes.

## Boundaries & Constraints

**Always:**

- **Selection.**
  - Only the `create_document` handler selects the enforced task, and only for `classification.kind === "enforced" && input.format === "html"`.
  - The baseline `DocumentImportTask`, the `documents.import` route, and their props stay byte-identical. Unconfigured and `read_only` HTML creates still call `DocumentImportTask.scheduleAndWait` with the exact baseline props.
  - A sentinel or `failed` classification schedules no job.
  - Nothing reclassifies a scheduled baseline job.
  - `nonBaselineWriteResult` loses its interim HTML branch; enforced writes never reach it.
- **Intent** (`EnforcedImportIntent`, validated by a strict zod schema on both sides). It carries exactly:
  - `requestId`, `invocationId`, `actorId`, `sourceIp` (`string | null`), and the pre-allocated `documentId`;
  - `expectedPolicyFingerprint` (the classified `entry.policyFingerprint`) and the classification-time `readable` flag;
  - `handlerEnteredAtEpochMs`, `classifiedAtEpochMs`, and `deadlineAt` (all epoch milliseconds);
  - `authEnvelope`, either `{ credentialAuthType: "api" }` or `{ credentialAuthType: "oauth", authenticatedClientId }`;
  - `key` (the staged source) and `sourceMetadata: { fileName: input.sourceFileName ?? "document.html", mimeType: "text/html" }`;
  - optional `title`, `icon`, `color`, and `fullWidth`; `publish` (`input.publish !== false`); the classified `collectionId`; and optional `parentDocumentId` (raw, as the baseline passes it).
  - It never carries a token, secret, cookie, authorization header, template ID, or any value read from tool arguments other than these create inputs. Identity and attribution come only from the authenticated user and the `/mcp`-filled `AuthInfo.extra` (`requestId`, `ip`, `credentialAuthType`, `authenticatedClientId`).
  - A `templateId` is authorized in P0 as today and is not applied.
  - The handler takes `handlerEnteredAtEpochMs = Date.now()` at entry, beside `enteredAt`. The requester takes `classifiedAtEpochMs = Date.now()` immediately after `classifyWrite` returns. `deadlineAt = classifiedAtEpochMs + ENFORCED_IMPORT_WAIT_MS`, where the wait is 30 000 + 9 000 + 9 000 + 3 000 + a 5 000 grace (`ENFORCED_IMPORT_GRACE_MS`), so 56 000 ms.
- **Requester** (`enforceHtmlCreate`):
  - It allocates `invocationId = randomUUID()` and stages `input.text ?? ""` with `FileStorage.store` (`contentType: "text/html"`, `acl: "private"`). The key is `AttachmentHelper.getKey({ id: invocationId, name: "source.html", userId: actor.id })`.
  - Staging runs within the 30-second preparation bound measured from classification.
  - **Requester row 3.** These end the attempt before `schedule`: invalid attribution, a staging failure or expiry, and cancellation (`signal.aborted`) before `schedule`. In each case the requester deletes its key (idempotently, errors ignored) and writes the one requester summary (`aborted_before_decision`). It returns row 3 with `abortMessage(error)`.
  - It calls the injected `schedule(intent)` and waits for `job.finished()`, raced against the remainder until `deadlineAt` (a monotonic `Deadline` started at classification) and the abort signal.
  - A `schedule` rejection, a `finished()` rejection, expiry, abort, or a value that fails `parseEnforcedImportResult` is *no result*. A `committed` result whose `documentId` differs from the intent's also fails the parse.
  - **Committed.** A `committed` result is row 6.
  - **Probe.** Every other outcome first probes once, with one SQL read under the 2-second probe bound, acquisition included. That read returns the pre-allocated document joined with the summary whose Event ID is `invocationId`.
    - A found row with a committed summary becomes row 6, through the reconstruction below.
    - A found row without one becomes row 7.
    - Absent or unavailable: `rejected` becomes row 4, `conflict` row 2, `aborted` row 3 or 5 with its `message`, and no result row 7.
  - The requester writes no summary except for requester row 3, and leaves the staged source on row 7.
- **Response.**
  - Rows 2, 3, 4, 5, and 7 use the existing `enforcedWriteResult` shapes.
  - Row 6 starts the 2-second assembly `Deadline` when the outcome is known. It loads `Document.findByPk(documentId, { userId, rejectOnEmpty: true })` as a guarded step bounded by that deadline, then delegates to the existing non-patch row-6 assembly.
  - A document that cannot be loaded yields exactly `{ success: true, id, validation }`, never `isError`.
- **Worker order** (`runEnforcedImport(intent)`). At job start it builds:
  - `job = new Deadline(intent.deadlineAt - Date.now())`;
  - `preparation = new Deadline(WRITE_PREPARATION_BOUND_MS - (Date.now() - intent.classifiedAtEpochMs))`, so queue wait is charged to preparation.

  Then it runs these steps in order:
  1. Parse the intent. An invalid intent returns `aborted` row 3 with `OPERATION_FAILED`, with no summary and no deletion.
  2. Look up the pre-allocated document with `probeCommit({ kind: "document", documentId }, COMMIT_PROBE_BOUND_MS)`.
     - `present` resolves through `committedFromSummary`, with no re-authorization, fingerprint comparison, or storage read.
     - `unavailable` ends in `aborted` row 3.
  3. Reload the actor with `User.findByPk(actorId, { rejectOnEmpty: true })`. Build `ctx = createContext({ user, authType: AuthenticationType.MCP, ip: sourceIp ?? undefined })`, which is the baseline job's context.
  4. Re-authorize the destination with `authorizeDocumentCreate(ctx, { collectionId, parentDocumentId })`.
  5. A resolved `collection?.id` other than the classified one returns `conflict`.
  6. Compare fingerprints. The worker's `getPolicySet()` entry for the collection must be valid, with `policyFingerprint === expectedPolicyFingerprint`. Any other state (`read_only`, absent, invalid, or another fingerprint) returns the mismatch `rejected`, never fail-open.
  7. Run `runAttempt` (below).
  - A failure in steps 2–6 is `aborted` row 3 with `abortMessage`.
- **Mismatch validation.** It is built through `decideWrite` with `runtimeFailureMode: "closed"`, as `rejectInvalidPolicyWrite` does:
  - `status: "rejected"`, plus `policySchemaVersion: 1` and the expected fingerprint only when `readable`;
  - `errors: []`, `warnings: []`;
  - exactly one `POLICY_CONFIGURATION_INVALID` at `scope { scopeKind: "collection", collectionId? }`, where `collectionId` is present only when `readable`.
- **Attempt reuse.** `runAttempt`, `AttemptPlan`, and `ShellInput` in `enforcedWrite.ts` are exported. `runAttempt` gains an optional third argument, `AttemptOptions`, and the Markdown behavior and tests stay unchanged when it is omitted. The options:
  - `invocationId` (default `randomUUID()`);
  - `preparation: Deadline` (default `new Deadline(WRITE_PREPARATION_BOUND_MS)` at shell entry);
  - `admitPersist?: () => boolean`, checked after a persist decision and before the persistence deadline starts; `false` rolls back and returns `{ row: 5, message: OPERATION_FAILED }`;
  - `callbacksAfterProbe` (default `true`; `false` discards the buffer when only the probe established the commit);
  - `onValidated?(validated: ProjectionValidation)`, right after P5;
  - `onCommitted?({ document, validation })`, once the commit is established and before the callbacks start.

  Hook calls are wrapped so that a throwing hook changes nothing. `prepare` may return a promise, which is awaited. `persist(projection, validation)` receives the decided validation.
- **Worker plan:**
  - `prepare`:
    - reads `FileStorage.getFileBuffer(key)`; a missing input is row 3;
    - runs `documentImporter({ user, fileName, mimeType, content, ctx, media: refuseImportableMedia })`;
    - calls `prepareHtmlCreate`.
    - Each step is raced against `preparation` with `within`, and expiry throws.
  - `reauthorize`:
    - first runs `SELECT id FROM documents WHERE id = :documentId` on the enforcement transaction; a found row throws, which ends in row 3 and is converted below;
    - then re-runs `authorizeDocumentCreate` on the bound context and returns `collection?.id`.
  - `project` is `projectMarkdownCreate({ prepared, documentId, collectionId, actor: user, template: null })`.
  - `persist` is `persistProjectedCreate(ctx, projection, null)`. A `UniqueConstraintError` on the documents primary key records the attempt's own validation and rethrows.
  - `probeTarget` is the document.
  - `admitPersist` is `job.remainingMs() >= WRITE_PERSISTENCE_BUDGET_MS + AUDIT_WRITE_BOUND_MS`, and `callbacksAfterProbe` is `false`.
- **Worker mapping:**
  - Row 6 returns `{ kind: "committed", documentId, validation }` after its summary write settles.
  - A recorded unique violation returns `committed` with the attempt's own validation and writes its committed summary.
  - Rows 2, 3, 4, and 5, and every pre-attempt non-committed outcome, repeat the document lookup before anything else. A found row converts the outcome to `committedFromSummary`, and the converted attempt writes no summary. Otherwise the worker writes the summary (none for `conflict`) and returns `conflict`, `rejected`, or `aborted { row, message }`.
  - Row 7, and a `committedFromSummary` that cannot establish an outcome, throw `UnestablishedImportError`, which has a fixed message.
  - Every other exception of the worker's own code is caught and returns `aborted` by phase.
  - `EnforcedDocumentImportTask` has `attempts: 1`.
- **`committedFromSummary`:**
  - In the worker it polls the summary by `invocationId` (fresh short reads, about every 100 ms) up to the 2-second probe bound. In the requester it uses the probe's single read.
  - Only a summary whose `outcome` is `validated`, `validated_with_warnings`, or `degraded_validation` counts.
  - It returns `status = outcome`, `errors: []`, and `warnings: []`.
  - `systemFailures` has one `createSystemFailure(code, location)` per `counts.byCode` key whose count is positive and whose registry class is a result System Failure, sorted with `sortIssues`.
  - The identity is `policySchemaVersion: 1` plus the classified fingerprint only when `readable`, and the location carries `collectionId` only when `readable`.
- **Summaries** (`wikiLint.write_validation`, Event ID = `invocationId`):
  - Row: `teamId` and `actorId` of the actor, `ip = sourceIp`, `collectionId` = the classified collection, and `documentId` only when the document row exists (committed outcomes).
  - Data: closed `AuditDataV1` with `operation: "create_document"` and `scopeKind: "collection"`. `policySchemaVersion: 1` and the request-time fingerprint are always present (the policy is valid). `credentialAuthType` comes from the envelope, plus `authenticatedClientId` for OAuth.
  - `complete` is true only for `validated`, `validated_with_warnings`, and a `rejected` with no System Failure that is not a mismatch.
  - Evaluated counts are `1` and the link count (when `internal_links` is enabled) only when the document unit completed, that is, with document-surface rules and no System Failure. They are 0 otherwise.
  - Counts and `byCode` are tallied over all three arrays, with keys in bytewise order. `runtimeFailOpenExercised` is `status === "degraded_validation"`.
  - A mismatch records `outcome: rejected`, `complete: false`, zero evaluated counts, and only `{ systemFailures: 1, byCode: { POLICY_CONFIGURATION_INVALID: 1 } }`. An abort records zero counts and an empty `byCode`.
  - `durationMs`: the worker uses `(jobStartedAtEpochMs - handlerEnteredAtEpochMs) + (monotonic now - monotonic job start)`, rounded and at least 0. The requester uses monotonic time since handler entry.
  - The summary write is initiated immediately after an established commit (through `onCommitted`), or after rollback. It is awaited with `AUDIT_WRITE_BOUND_MS`, never changes the outcome, and logs only `{ requestId, invocationId, reason }` on failure.
  - `insertAuditEvent` becomes `INSERT … ON CONFLICT ("id") DO UPDATE SET data, documentId, collectionId = EXCLUDED…`. The update applies only when the names match, the stored `outcome` is `aborted_before_decision`, `aborted_after_decision`, or `rejected`, and the incoming one is committed. `createdAt` is kept, and read summaries behave exactly as before.
- **Source ownership.**
  - The worker deletes `key` (idempotently, errors ignored) whenever it returns a terminal outcome, after its repeated lookup.
  - A thrown (row 7) attempt and an invalid intent leave it.
  - Nothing calls the baseline task's own delete.
- **Media interim.** `documentImporter` gains one optional `media?: (doc: Node) => Promise<Node> | Node` prop. Without it the baseline `ProsemirrorHelper.replaceImagesWithAttachments(ctx, doc, user)` runs, unchanged.
  - `refuseImportableMedia` throws `UnstagedMediaError` (row 3, `OPERATION_FAILED`) for any image or video `src`, or `data:` link `href`, that parses as a URL and is not `isInternalUrl`. That is exactly the set the baseline would import.
  - It never fetches, creates an Attachment, or writes storage.
- **Logs.** For the task named `EnforcedDocumentImportTask`, the worker task-start log line, the `addTags` tracer tag, the task-failure log, and the `queue.ts` final-failure log carry only the job ID and the task name. The redaction is decided by name before the registration check, so an unregistered task is redacted too. Every other task logs exactly as before.

**Never:**
- Do not stage, materialize, or clean up media (Story 2.6). Do not write Markdown-path summaries or change `auditWikiLint` and the Event access rules (Story 2.7).
- Do not modify `DocumentImportTask`, `documentCreator`, `documentUpdater`, `server/models`, `server/presenters`, `shared/utils`, `server/editor`, `server/storage`, `server/tools/util.ts`, or the `documents.import` route. In `server/commands`, change only the optional `media` prop of `documentImporter`.
- Do not change tool names, input schemas, descriptions, annotations, or `/mcp` routing. Do not let any tool argument select the task or reach `actorId`, `documentId`, `invocationId`, `readable`, `expectedPolicyFingerprint`, or the deadlines.
- Do not log, tag, or persist intent props, HTML, titles, Findings, messages, or locations outside the closed shapes above. Do not import the post-`v1.10.1` patch-edit fix (`c17d2c52b`).
- Do not edit `sprint-status.yaml`, `deferred-work.md`, `epics.md`, `server/tools/README.md`, or the SPEC, PRD, or spine. Add no pilot identifiers.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Committed, text-only | Reader, enforced collection; `<h1>T</h1><h2>Overview</h2><p>ok</p>`; also a warning-only body | Baseline HTML create keys, then `validation` (`validated` / `validated_with_warnings`). One document equal to the baseline import of the same HTML (content, decoded `state`, title, icon, `sourceMetadata`). One mutation-Event set carrying `validationCorrelationId`. One committed summary with `documentId`. Source deleted | — |
| Rejected | `<p>Text without the required section</p>` | `{ success: false, validation }`, byte-equal to the Markdown create rejection of the same body after normalizing the allocated ID. No document, mutation Event, or Attachment. Summary `rejected`, `complete: true`, `evaluatedDocumentCount: 1` | Modeled |
| Worker-time denial | Membership removed between classification and the worker | `isError` with the authorization message. Summary `aborted_before_decision`. No document | `isError` |
| Fingerprint mismatch | Worker set: `read_only`, absent, invalid, or another valid fingerprint. Reader, and a non-reader creating under a document-membership parent | Reader: mismatch validation with the request-time fingerprint and `collectionId`. Non-reader: status, empty Findings, and one `POLICY_CONFIGURATION_INVALID` with no `collectionId`, no identity. Policy-configuration summary with the request-time fingerprint | Modeled |
| Collection change | Parent moved to another collection before the worker (P2), or inside P3 | `isError` `{ "error": { "id": "collection_conflict" } }`, no `validation`, no summary | `isError` |
| Projection failure | HTML over the import state limit; an external `<img src="https://…">` or a `data:` image | Import-size message, or `OPERATION_FAILED`. Summary `aborted_before_decision`. No Attachment row, no fetch, no storage write other than the source | `isError` |
| Persist refused | `deadlineAt` remainder below 12 s at P7; a P7 writer failure | Row 5 message rule, summary `aborted_after_decision`, no document | `isError` |
| Requester row 3 | `FileStorage.store` rejects or exceeds preparation; cancelled before `schedule` | `isError` with `abortMessage`. Requester summary `aborted_before_decision`. Key deleted. `schedule` not called | `isError` |
| No result | `schedule` rejects; `finished()` rejects ("Task … is not registered"); malformed or mismatched result; `deadlineAt` reached; abort during the wait | One probe. Absent: `isError` `OPERATION_FAILED`, no `validation`, no requester summary, source left | `isError` |
| Probe finds a row | Job commits, then the requester gets `aborted` or no result | Committed summary present: row 6 with the summary's status, empty Findings, and rebuilt System Failures. Absent or non-committed summary: row 7 | — |
| Lookup-first | Redelivered job: row plus committed summary; row plus `aborted_*` summary or none | Committed status-only, with no authorization, policy, or storage call. Otherwise the worker throws after about 2 s (requester row 7) | Throw |
| Concurrent attempts | Two `runEnforcedImport` with one intent at once (real PostgreSQL) | One document, one Event set, one activity set. Both `committed` (one own, one status-only or own-conflict) | — |
| Own unique violation | Row with the pre-allocated ID inserted after the after-lock lookup | `committed` with the attempt's own validation (not row 5), committed summary | — |
| COMMIT outcomes | Socket error after a real COMMIT; socket destroyed before COMMIT | Present: `committed`, buffered callbacks discarded (no enqueue, no notify). Unestablished: worker throws, requester row 7 | Throw |
| Preparation charged to queue | `classifiedAtEpochMs` 31 s ago | `aborted` row 3, no enforcement transaction opened | — |
| Summary replacement | Stored aborted then committed; rejected then committed; committed then aborted | First two replaced (`createdAt` kept, `documentId` set); third unchanged. `durationMs` ≥ queue wait | — |
| Job logs | Enforced job start, failure, unregistered name, queue final failure, with marker strings in every prop | No marker in any log argument or tag; only job ID and task name. `DocumentImportTask` logs unchanged | — |
| Unchanged scopes | Unconfigured, `read_only`, absent; sentinel | Baseline HTML create: `DocumentImportTask` with exact props, results equal to unconfigured, no `validation`, no `wikiLint.*` Event. Sentinel: modeled rejection, no job of either task | Baseline |

</intent-contract>

## Code Map

- `_bmad-output/planning-artifacts/epics.md:1284-1353` -- binding ACs. `_bmad-output/planning-artifacts/architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md` sections:
  - `:110-124`, AD-7 and the HTML worker;
  - `:130-151`, AD-8;
  - `:169`, the AD-11 sums;
  - `:189-204`, the AD-12 mismatch;
  - `:223-273`, the AD-14 summaries and the Event upsert;
  - `:312-343`, AD-20 and rows 1–7.
- `server/tools/documents.ts`:
  - `:94-110` -- `nonBaselineWriteResult`; drop the interim HTML branch;
  - `:153-252` -- `enforcedWriteResult`; reuse it for rows 2–7 and non-patch row 6, and extract its `optional` helper;
  - `:701-815` -- the `create_document` handler: classification at `:713`, the Markdown branch at `:719-750`, and the baseline HTML job at `:757-777`, which stays.
- `server/wikiLint/application/enforcedWrite.ts`:
  - `:332-362` -- `ShellInput` and `AttemptPlan`;
  - `:372-526` -- `runAttempt`: `invocationId` at `:380`, preparation at `:381`, `prepare` at `:386`, P3 at `:413-422`, P5 at `:431-452`, the decision at `:455-471`, P7 at `:475-491`, P8 at `:494-508`, and callbacks at `:510-521`;
  - `:312-329` -- `writeValidation`.
- `server/wikiLint/adapters/writeTransaction.ts`:
  - `:435-480` -- `probeCommit`, reused for worker lookups;
  - `:345` -- `discard`;
  - `:394-421` -- `runCallbacks`;
  - add the requester probe and the summary read here, in the same short-transaction pattern.
- `server/wikiLint/adapters/documentProjection.ts`:
  - `:67-75` -- `PreparedMarkdownCreate` gains `state: Buffer | null`;
  - `:126-142` -- `prepareMarkdownCreate` sets `null`;
  - `:175-220` -- `projectMarkdownCreate`: `:203` becomes `copyState(prepared.state)`;
  - `:81` -- `UnstagedMediaError`;
  - add `prepareHtmlCreate` and `refuseImportableMedia`.
- `server/wikiLint/adapters/projectionWriter.ts:32-52` -- `persistProjectedCreate`; pass `state` when non-null. Markdown is unchanged.
- `server/commands/documentImporter.ts:13-19,48-90` -- Props and the `replaceImagesWithAttachments` call at `:87`; add the `media` prop only. `server/models/helpers/ProsemirrorHelper.tsx:1205-1290` is the baseline media selection, read-only. `shared/utils/ProsemirrorHelper.ts:359,388` has `getImages` and `getVideos`.
- `server/queues/tasks/DocumentImportTask.ts` -- baseline reference for title/icon precedence and context; read-only. Tasks register by file name (`server/queues/tasks/index.ts`). Tests perform a scheduled task lazily via `job.finished()` (`server/test/setup.ts`, the `BaseTask.prototype.schedule` spy).
- `server/services/worker.ts:175,183,196` and `server/queues/queue.ts:63` -- the four log/tag sites.
- `server/wikiLint/adapters/auditEvents.ts`:
  - `:21-51` -- `AuditDataV1`; widen `operation` to the write operations and `outcome` to the write outcomes;
  - `:90-120` -- `insertAuditEvent`; `ON CONFLICT DO NOTHING` at `:102` becomes the conditional upsert.
- `server/wikiLint/application/readAudit.ts`:
  - `:17` -- narrow `ReadOperation` to `lint_document | lint_wiki`;
  - `:191-248` -- the bounded, never-rejecting audit wait to share.
- `server/wikiLint/application/writeClassification.ts:62-140` -- `classifyWrite` (create pre-allocates `documentId`) and `rejectInvalidPolicyWrite`, the mismatch pattern. `writeDecision.ts` has `decideWrite` and `abortMessage`. `deadline.ts` holds the constants; add the import wait and grace here.
- `server/wikiLint/core/registry.ts:224,672` -- `getIssueDefinition` (class `system_failure`, not `startup_diagnostics_only`) and `createSystemFailure`. `core/ordering.ts:24,164` has `compareUtf8` and `sortIssues`. `core/documentRules` has `documentSurfaceRules`.
- `server/routes/mcp/index.ts:205-218` -- what `AuthInfo.extra` carries. `server/context.ts:9` -- `createContext`.
- `server/commands/documentCreator.ts:58-92` -- `authorizeDocumentCreate`. `server/models/helpers/AttachmentHelper.ts:26` -- `getKey`.
- Test patterns:
  - `server/tools/documents.enforcement.test.ts`:
    - the policy-set and clock seams at `:41-63`, and `configure` at `:120`;
    - `callWithoutEffect` and `storedState` at `:200-300`;
    - the destination matrix at `:596`; its HTML branch at `:627` moves to the worker result;
    - the baseline-job-not-reclassified fixture at `:1259`;
    - the non-reader paths at `:868-1018`.
  - `server/wikiLint/application/enforcedWrite.concurrency.test.ts`: the COMMIT fixtures at `:544-700`, including a socket error after a real COMMIT, and `interceptQueries`.
  - `server/wikiLint/application/enforcedWrite.test.ts:293-430` -- the query interceptor, `withoutEffect`, and `manualClock`.
  - `server/wikiLint/adapters/documentProjection.test.ts` -- the parity helper.

## Tasks & Acceptance

**Execution:**
- `server/wikiLint/application/deadline.ts` -- Add `ENFORCED_IMPORT_GRACE_MS = 5000` and `ENFORCED_IMPORT_WAIT_MS` (the sum, 56 000), with docs. -- AC7.
- `server/wikiLint/application/enforcedWrite.ts` -- Export `runAttempt`, `AttemptPlan`, `ShellInput`, and the new `AttemptOptions`, implemented as in Always. Markdown callers pass no options. -- AC4, AC7, AC8.
- `server/wikiLint/adapters/documentProjection.ts` -- Add `state` to the prepared create, `HtmlCreateInput`, `prepareHtmlCreate(input, imported)`, and `refuseImportableMedia`.
  - `prepareHtmlCreate` maps: `title: input.title ?? imported.title`, `icon: input.icon ?? imported.icon`, `content` = `toProsemirror(imported.text)` when `text` is truthy, else `null`, and a private `state` copy.
  - `projectMarkdownCreate` throws `WikiLintContractError` for `state` together with a template.
  - -- AC1, AC10.
- `server/wikiLint/adapters/projectionWriter.ts` -- Pass `state` to `documentCreator`. Add `isPreallocatedIdConflict(error)`, a `UniqueConstraintError` on the documents primary key. -- AC8.
- `server/commands/documentImporter.ts` -- Add the optional `media` prop and nothing else. -- AC1.
- `server/wikiLint/adapters/writeTransaction.ts` -- Add `probeImport(documentId, invocationId, boundMs)`, one statement whose result is `absent | { present, summary } | unavailable`. Add `readWriteSummary(invocationId, boundMs)`. Both are bounded like `probeCommit`. -- AC3, AC5.
- `server/wikiLint/adapters/auditEvents.ts`, `server/wikiLint/application/readAudit.ts` -- Widen the type, add the conditional upsert, narrow `ReadOperation`, and share the bounded wait. -- AC9.
- `server/wikiLint/application/writeAudit.ts` (new) -- `writeAuditData`, `evaluatedCounts(validated, rules)`, `recordWriteAudit(row, correlation, write?)`, and the pure `validationFromSummary(summary, { readable, collectionId, policyFingerprint })`, which returns `undefined` unless the summary is committed. -- AC5, AC9.
- `server/wikiLint/application/enforcedImport.ts` (new) -- The intent and result types and zod schemas (`parseEnforcedImportIntent`, `parseEnforcedImportResult(value, intent)`), `UnestablishedImportError`, `committedFromSummary`, and `runEnforcedImport(intent, { write? })`. -- AC2, AC4–AC9.
- `server/wikiLint/application/enforcedHtmlCreate.ts` (new) -- `enforceHtmlCreate({ ctx, classification, input, extra, enteredAt, enteredAtEpochMs, signal, schedule, write? })`. It returns the existing rows, with row 6 as `{ row: 6; documentId; validation; assembly }`. -- AC2, AC3, AC5, AC7.
- `server/queues/tasks/EnforcedDocumentImportTask.ts` (new) -- `perform(intent)` returns `runEnforcedImport(intent)`, with options `{ attempts: 1, priority: TaskPriority.Normal }`. -- AC1, AC6.
- `server/queues/redaction.ts` (new), `server/services/worker.ts`, `server/queues/queue.ts` -- Name-based `loggableTaskProps(name, props, jobId)` and `loggableJobData(data, jobId)`, used at the four sites. -- AC2.
- `server/tools/documents.ts` -- Add the enforced HTML branch (schedule via `new EnforcedDocumentImportTask().schedule(intent)`), the HTML row-6 assembly, and the epoch entry time. Remove the interim. -- AC1, AC3, AC5.
- Tests (all collocated):
  - `server/wikiLint/application/enforcedImport.test.ts` and `enforcedHtmlCreate.test.ts` (new, DB) cover the worker and requester rows of the matrix plus the AC11 list. They also cover unit checks of both schemas: exact intent keys, no token or authorization value in the serialized intent, and malformed results.
  - `server/tools/documents.enforcedHtml.test.ts` (new, DB, MCP-level) covers the AC10 fixtures, the 2.4 AC3 non-reader mismatch, selection, and unchanged scopes. Client arguments that imitate the intent (`actorId`, `documentId`, `readable`, `expectedPolicyFingerprint`, `deadlineAt`, `intent`) change nothing in the scheduled intent.
  - In `server/tools/documents.enforcement.test.ts`, the `:627` branch asserts the modeled rejection, no document or mutation Event, one `rejected` summary, and the deleted source.
  - `documentProjection.test.ts` covers HTML parity with the baseline import and the media predicate.
  - `auditEvents.test.ts` and `writeAudit.test.ts` (new) cover the upsert matrix, each summary form, and failure isolation.
  - `server/services/worker.test.ts` (new) mocks `@server/queues` (capturing `process` handlers), HealthMonitor, and i18n, then drives `init()`'s task handler. `server/queues/queue.test.ts` (new) captures the `failed` listener through the `bull` mock's `on`.
  - `enforcedWrite.test.ts` covers each `AttemptOptions` hook.
  - The bounds sum: `ENFORCED_PRE_WRITE_BOUND_MS + ENFORCED_IMPORT_WAIT_MS + COMMIT_PROBE_BOUND_MS + POST_COMMIT_ASSEMBLY_BOUND_MS <= 62000`.

**Acceptance Criteria:**
- Given an enforced HTML create, when the job is scheduled, then the intent equals the trusted fields above, contains no credential, and none of its values can be supplied or selected by tool arguments.
- Given the code-owned HTML bounds, when they are summed with the requester tail of one 2-second probe and 2-second assembly, then the total is at most 62 seconds, and a requester whose wait expired answers within the probe and assembly bounds, plus scheduling slack.
- Given the registrations and baseline code, when `git diff 4a5a616a21be800257dc11cef4263d0dd0412156` is read for `server/queues/tasks/DocumentImportTask.ts`, `server/routes/api/documents`, `server/commands/documentCreator.ts`, and the tool schemas, then it is empty. `documentImporter.ts` shows only the optional `media` prop.
- Given the existing suites, when they run, then every enforcement, projection, response, shell, audit, and route fixture passes unchanged, apart from the `:627` HTML branch that this story replaces.

## Spec Change Log

## Review Triage Log

### 2026-10-03 — Review pass

- verdicts: 30 findings — high 0, medium 10, low 14, false 4, maybe-false 2
- findings:
  - `[medium]` `[patch]` blind: staged-source deletes are awaited with no bound on the requester's row-3 path and before every worker terminal return — Verified: `S3Storage` builds its client without a request timeout (`server/storage/files/S3Storage.ts:376`), so `deleteFile` can hang. Fixed: `deleteStagedSource(key)` (`enforcedImport.ts`) waits at most a private 1 s, ignoring errors. The worker and the requester's row 3 both use it.
  - `[low]` `[reject]` blind: row-7 staged sources are never cleaned up, and the `uploads/{userId}` key prefix defeats lifecycle rules — The leftover blob is real, but the contract requires it: AD-7 and epics 2.6 AC5/AC7 say "row 7 leaves it", and the sweeper is the recorded D-9 item. The key layout mirrors the baseline `documents.import` staging.
  - `[low]` `[patch]` blind: the lookup-first committed path never deletes the source — Fixed together with the edge and intent rows below. The path deletes, bounded, after `committedFromSummary` resolves. It still makes no storage read, authorization call, or policy read, and the redelivery test asserts both. The spec's Always rule ("whenever it returns a terminal outcome") settles this; the matrix's "storage call" meant the AC4 storage read.
  - `[low]` `[patch]` blind: requester/worker clock skew can stretch `job` and `preparation` past their code-owned bounds — Fixed: `job` is `Math.min(ENFORCED_IMPORT_WAIT_MS, deadlineAt − jobStart)`, and the queue wait is clamped at ≥ 0, so `preparation` never exceeds 30 s. A clock ahead of the requester's still shortens the bounds; that is inherent in AD-7's epoch fields.
  - `[maybe-false]` `[defer]` blind: the imported Y.js `state` is persisted unvalidated while lint runs on `content` re-parsed from Markdown — The baseline persists the same split (`DocumentImportTask` passes `text` and `state`), and the parity tests prove the projection matches it. Undecided: whether any converter output loses lint-relevant structure in the Markdown round trip. Settle it with a fixture sweep comparing `yDocToProsemirrorJSON(state)` against `content`. Deferred as medium (unverified).
  - `[false]` `[reject]` blind: the summary upsert does not check team, actor, or requestId, so a reused `invocationId` could overwrite another team's row — Refuted: the requester generates `invocationId` with `randomUUID()` per invocation, and no client argument can supply it (`documents.enforcedHtml.test.ts`, "ignores client arguments that imitate the intent"). No path lets two invocations share an Event ID.
  - `[low]` `[patch]` blind: a soft-deleted actor gets no summary, because the fallback reload is paranoid — Verified: `User` extends `ParanoidModel`. Fixed: the reload uses `paranoid: false`. A new test proves the row-3 `aborted_before_decision` summary, and it failed with the option removed.
  - `[medium]` `[patch]` blind: redaction keys on a literal that nothing ties to the scheduled job name — Grouped with the verification-gap redaction row. Fixed: `worker.test.ts` and `queue.test.ts` use `EnforcedDocumentImportTask.name`. The new `EnforcedDocumentImportTask.test.ts` asserts that both redaction helpers redact that name.
  - `[false]` `[reject]` blind: `parseEnforcedImportResult` does not check that the status agrees with the Findings — Refuted as a reachable defect: the worker's validation comes only from `decideWrite`, through `runAttempt` or `mismatchValidation`. No shown path produces an inconsistent pair. The parser's job is shape and identity, which skew or garbage would fail.
  - `[low]` `[reject]` blind: a summary-rebuilt validation looks like a real one (status with empty Findings) — AC5 and AD-7 mandate exactly this status-only shape ("returns `errors` and `warnings` empty", one System Failure per counted code). A marker would break the closed AD-12 `validation` shape.
  - `[medium]` `[patch]` blind: requester tests miss the unavailable-probe mapping, and the cancelled half of the intent test swallows its outcome — Grouped with the verification-gap unavailable-probe row. Fixed: with the `LEFT JOIN` probe rejected, `rejected`, `conflict`, and `aborted` map to rows 4, 2, and 3. The cancelled call now asserts `{ row: 3, message: OPERATION_FAILED }`.
  - `[false]` `[reject]` blind: the summary Event name is two unrelated strings, so reads can drift from the writer — Refuted: any drift fails the integration tests that read summaries `writeAuditRow` wrote, namely the requester probe tests and the worker found-row tests.
  - `[low]` `[reject]` edge: a staging write that expires and lands after the requester's delete leaves the HTML in storage — Real but rare: storage must complete a write after its 30 s bound. The blob stays Outline-inaccessible, and the spec's Residuals record it. The fix adds a second bounded wait, more than a direct correction.
  - `[low]` `[reject]` edge: a `schedule` rejection leaves the source and writes no summary — AD-7 and AC3 make a `queue.add` error row 7 with no requester summary, and "row 7 leaves it".
  - `[low]` `[patch]` edge: the lookup-first path does not delete the source — Same fix as the blind lookup-first row.
  - `[low]` `[reject]` edge: row 7 (`UnestablishedImportError`) leaves the staged HTML — AD-7 mandates "row 7 leaves it"; a commit may have landed, and nothing establishes ownership.
  - `[medium]` `[patch]` edge: a slow worker delete delays a decided result past `deadlineAt` — Same fix as the blind unbounded-delete row (1 s bound, which the 5 s grace absorbs).
  - `[medium]` `[patch]` edge: a hanging requester row-3 delete leaves the response unbounded — Same fix as the blind unbounded-delete row.
  - `[low]` `[reject]` edge: the persist gate does not reserve the repeated-lookup probe, so a late row 5 can surface as row 7 — Real only when P7 and P8 nearly exhaust the 9 s budget and then fail. The gate formula is AD-7's binding rule (persistence budget plus audit bound). The outcome is a claim-free row 7, which AD-20 permits. Fixing it means re-deriving the AD-7 budget arithmetic, not making a direct correction.
  - `[low]` `[patch]` edge: worker clock skew — Same fix as the blind clock-skew row.
  - `[maybe-false]` `[defer]` edge: converted HTML that does not round-trip leaves editor `state` holding content the lint never saw — Grouped with the blind state row and deferred with it.
  - `[medium]` `[patch]` verification-gap: explicit `title`, `color`, `fullWidth`, `publish: false`, and `sourceFileName` are never checked end to end — Fixed: a new MCP parity case sends all of them on the enforced and the baseline call, and the stored fields match.
  - `[medium]` `[patch]` verification-gap: no non-reader commit or rejection, and no `readable: false` probe rebuild, is tested — Fixed: there are now non-reader commit and rejection cases. Neither response has `policySchemaVersion`, `policyFingerprint`, `collectionId`, `detail`, or the collection ID. A `readable: false` requester-probe case was added.
  - `[medium]` `[patch]` verification-gap: the unavailable-probe branches are never exercised — Fixed with the blind requester-test row. A forced-unavailable lookup-first case also ends in `aborted` row 3 with no `EnforcementTransaction.open`.
  - `[low]` `[patch]` verification-gap: deletion is unverified on the converted commit and the own-conflict commit — Fixed: both tests assert that the staged key is gone.
  - `[medium]` `[patch]` verification-gap: `attempts: 1` is never asserted — Fixed: `EnforcedDocumentImportTask.test.ts` asserts the options `{ attempts: 1, priority: TaskPriority.Normal }` and that the real registry maps the class name to the class.
  - `[medium]` `[patch]` verification-gap: redaction tests pin the literal rather than the emitted name — Same fix as the blind redaction row.
  - `[low]` `[patch]` intent: the trusted intent and the result never cross a serialization or registry boundary in tests — Verified: the registry builders emit no `undefined`-valued keys (`server/wikiLint/core/registry.ts:504-566,643-660`), so a JSON round trip keeps `isDeepStrictEqual` parsing valid. Fixed by adding round-trip tests for the intent and for committed and rejected results with a `path` text location and a `detail` Finding, plus the real-registry lookup above. Real Bull/Redis cannot run in this test environment.
  - `[false]` `[reject]` intent: Bull persists intent props in Redis despite the spec's "do not … persist intent props" — Refuted: the intent is AD-7's mandated job payload, and the queue removes it on completion or failure (`removeOnComplete`/`removeOnFail` in `server/queues/queue.ts`). The spec's prohibition covers logs, tags, and records outside the closed shapes.
  - `[low]` `[patch]` intent: lookup-first source deletion diverges from the source-ownership rule — Same fix as the blind lookup-first row.

## Design Notes

**Why the worker reuses `runAttempt`.** The worker must apply the same AD-8 lock order, the same `SET LOCAL` and floor rules, the same decision, and the same commit probe as the Markdown path (AC7, AC10). A parallel orchestrator would drift. The five options are the only HTML differences. An after-lock lookup that finds a row deliberately throws into row 3. The mapping's repeated lookup then converts the outcome, so no new outcome type reaches `enforcedWriteResult`.

**Worker shape:**

```ts
if (probe === "present") return resolveFound();           // no authz, policy, storage
user = reload(); collection = authorize(); if (≠) return finish(conflict);
if (!sameFingerprint) return finish(rejected(mismatch));
outcome = await runAttempt(shell, plan, { invocationId, preparation, admitPersist,
  callbacksAfterProbe: false, onValidated, onCommitted: startCommittedSummary });
// finish(x): if x is non-committed and lookup finds the row → committedFromSummary (no summary);
//            else write summary (not for conflict), delete source, return x
```

**Why 2.5 writes the HTML summaries.** ACs 3, 4, 5, and 9 make the worker the owner of the HTML summary and require committed-over-aborted replacement. Status-only reconstruction cannot be verified without stored summaries. This story therefore adds the summary builder, the bounded writer, and the conditional upsert, and uses them only on the HTML path. Story 2.7 reuses them for the Markdown rows and adds the audit-surface and failure-matrix work.

**Media.** Story 2.6 owns staging. Until then, enforced HTML with importable media fails in P2, as Markdown base64 images already do (`UnstagedMediaError`). The `media` prop is the seam where 2.6 will add staging.

**Residuals.** A staging write that expires and lands after the requester's delete leaves an inaccessible blob. An older worker image without the new task neither runs nor redacts it, so a rollout drains workers first (AD-19). The crash-after-commit-before-summary and row-7 evidence gaps stay explicit.

## Verification

**Commands:**
- `scripts/test-db.sh ensure` -- expected: exit 0. A non-zero exit blocks before any DB suite runs.
- `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint/application/enforcedImport.test.ts server/wikiLint/application/enforcedHtmlCreate.test.ts server/tools/documents.enforcedHtml.test.ts server/services/worker.test.ts server/queues/queue.test.ts server/wikiLint/application/writeAudit.test.ts` -- expected: all pass.
- `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint server/tools server/routes/mcp server/routes/api/documents/documents.test.ts server/commands/documentImporter.test.ts server/queues` -- expected: all pass.
- `corepack yarn tsc` -- expected: exit 0.
- `node_modules/.bin/oxlint --type-aware` and `node_modules/.bin/oxfmt --check` on the changed files -- expected: clean.
- `git diff 4a5a616a21be800257dc11cef4263d0dd0412156 -- server/models server/presenters shared/utils server/editor server/storage server/tools/util.ts server/commands/documentCreator.ts server/commands/documentUpdater.ts server/queues/tasks/DocumentImportTask.ts server/routes/api/documents` -- expected: empty.
- `git log --oneline 4a5a616a21be800257dc11cef4263d0dd0412156..HEAD | grep -i c17d2c52b; grep -rn "registerPrompt" server --include=*.ts | grep -v test` -- expected: no output.
- Temporary mutations, each reverted afterwards -- expected: a suite fails for each:
  - skip the repeated lookup;
  - skip the lookup-first;
  - let the persist gate always admit;
  - keep callbacks after a probe-established HTML commit;
  - let the upsert replace a committed summary;
  - log the raw props at task start.

## Auto Run Result

Status: done

**Summary.** An MCP `create_document` with `format: "html"` into a collection with a valid `enforced` policy no longer fails with the interim `OPERATION_FAILED`.
- **Requester.** It stages the HTML under an invocation-scoped private key and builds a strict, credential-free trusted intent. It then schedules the new `EnforcedDocumentImportTask` (`attempts: 1`), which shares the baseline conversion code through an optional `media` prop on `documentImporter`. It waits until `deadlineAt` and probes the pre-allocated document once before any non-committed report. A committed row is rebuilt from its summary, status only. Each outcome is mapped onto the existing AD-20 rows and response shapes.
- **Worker.** It looks up the pre-allocated document first. It then reloads the actor, re-authorizes the destination, and checks the collection (`conflict`) and the policy fingerprint; a mismatch is the AD-12 rejection, never fail-open. After that it converts the HTML, with importable media refused until Story 2.6, and reuses the Story 2.3 `runAttempt` through new `AttemptOptions`.
- **Worker ownership.** The worker owns the decision, the commit, and the `wikiLint.write_validation` summary. A committed summary replaces an aborted or rejected one, never the reverse. It deletes the staged source when it returns a terminal outcome, with the deletion bounded.
- **Logs.** The task's props are redacted by name at the worker start, tag, and failure sites and at the queue final-failure site.

**Files changed since `baseline_revision`.**
- `server/tools/documents.ts` — enforced HTML branch, HTML row-6 assembly, the shared `optional` helper, the handler's epoch entry time; the interim is removed.
- `server/wikiLint/application/enforcedHtmlCreate.ts` (new) — requester: staging, intent, bounded wait, single probe, row mapping, requester row-3 summary.
- `server/wikiLint/application/enforcedImport.ts` (new) — intent and result schemas, worker orchestration, `committedFromSummary`, bounded `deleteStagedSource`, `UnestablishedImportError`.
- `server/wikiLint/application/writeAudit.ts` (new) — `AuditDataV1` write summaries, evaluated counts, the bounded writer, status-only reconstruction.
- `server/wikiLint/application/enforcedWrite.ts` — exported `runAttempt` with `AttemptOptions` (invocation ID, preparation, persist gate, probe-callback discard, validated and committed hooks); async `prepare`; `persist` receives the validation.
- `server/wikiLint/application/readAudit.ts` — shared bounded `awaitAuditWrite`; `ReadOperation` narrowed.
- `server/wikiLint/application/deadline.ts` — `ENFORCED_IMPORT_GRACE_MS`, `ENFORCED_IMPORT_WAIT_MS`.
- `server/wikiLint/adapters/auditEvents.ts` — widened `AuditDataV1`; conditional committed-over-aborted upsert.
- `server/wikiLint/adapters/writeTransaction.ts` — `boundedRead`, `probeImport` (one document+summary read), `readWriteSummary`.
- `server/wikiLint/adapters/documentProjection.ts` — prepared `state`, `prepareHtmlCreate`, `refuseImportableMedia`, a template+state contract guard.
- `server/wikiLint/adapters/projectionWriter.ts` — persists an imported `state`; `isPreallocatedIdConflict`.
- `server/commands/documentImporter.ts` — the optional `media` prop only.
- `server/queues/tasks/EnforcedDocumentImportTask.ts` (new), `server/queues/redaction.ts` (new), `server/services/worker.ts`, `server/queues/queue.ts` — the distinct task and name-based log/tag redaction.
- Tests:
  - new: `enforcedImport.test.ts`, `enforcedHtmlCreate.test.ts`, `writeAudit.test.ts`, `server/tools/documents.enforcedHtml.test.ts`, `server/services/worker.test.ts`, `server/queues/queue.test.ts`, `server/queues/tasks/EnforcedDocumentImportTask.test.ts`;
  - extended: `enforcedWrite.test.ts`, `documentProjection.test.ts`, `auditEvents.test.ts`;
  - updated: the `documents.enforcement.test.ts` HTML branch.
- This spec.

**Review.**
- 30 findings: high 0, medium 10, low 14, false 4, maybe-false 2.
- **Patched**, 11 entries:
  - medium (6): the unbounded staged-source deletes; redaction tied to the emitted task name; unavailable-probe mapping and the cancelled-intent assertion; explicit-attribute parity; non-reader commit, rejection, and probe; `attempts: 1` with real-registry selection;
  - low (5): lookup-first source deletion; clock-skew caps; the paranoid-free actor reload for summaries; deletion asserted on the converted and own-conflict commits; JSON round-trip parsing of the intent and results.
- **Deferred**, 1: imported `state` versus re-parsed `content` divergence, medium, unverified.
- **Rejected**, 10:
  - row-7 orphaned sources, three rows: AD-7 and 2.6 AC5/AC7 mandate "row 7 leaves it", and the sweeper is D-9;
  - the upsert team/actor check: `invocationId` is server-generated and never client-supplied;
  - parser status/Findings consistency: no reachable producer of an inconsistent pair;
  - the status-only shape: mandated by AC5 and AD-12;
  - the duplicated Event-name string: drift fails the integration tests;
  - the late staging write after the requester's delete: rare, inaccessible, recorded residual;
  - the persist gate not reserving the probe: the AD-7 formula is binding, and a row 7 is permitted;
  - Bull persisting the intent in Redis: the mandated payload, removed on completion or failure.

**Follow-up review recommended: true.** Six medium entries were patched (first pass). The code added in this pass was not seen by an independent reviewer. That code is the 1 s `deleteStagedSource` bound, whose late deletion is never retried, so a slow storage backend can leave a staged source, and the clock-skew caps on the worker's `job` and `preparation` deadlines.

**Verification (2026-10-03).**
- `scripts/test-db.sh ensure` exited 0.
- Targeted suites (7 files): 137/137 passed. The broader scope (`server/wikiLint`, `server/tools`, `server/routes/mcp`, `server/routes/api/documents/documents.test.ts`, `server/commands/documentImporter.test.ts`, `server/queues`, `server/services/worker.test.ts`): 89 files, 2275/2275 passed.
- `corepack yarn tsc`, targeted type-aware `oxlint`, targeted `oxfmt --check`, and `git diff --check` all exited 0.
- The protected-path diff from `4a5a616a21be800257dc11cef4263d0dd0412156` is empty. There is no `c17d2c52b` and no `registerPrompt`.
- All six spec mutations made a suite fail, both before and after the patches, and each was reverted. The tree was confirmed identical afterwards.
- The matrix audit maps every I/O row to a passing test.

**Residual risks.**
- Real Bull/Redis cannot run here, so the job boundary is proven in-process plus by JSON round-trip parsing.
- A worker image without the task neither runs nor redacts it, so a rollout drains workers first (AD-19).
- Row-7 and late-delete sources remain Outline-inaccessible blobs until a D-9 sweeper exists.
- The crash-after-commit-before-summary gap stays explicit.
- `admitPersist` admits when its hook throws, though the shipped gate cannot throw.
- The orchestrator-owned `sprint-status.yaml` and `deferred-work.md` were not edited.
