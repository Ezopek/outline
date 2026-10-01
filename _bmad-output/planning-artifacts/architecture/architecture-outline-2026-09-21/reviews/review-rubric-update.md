# Rubric-walker review, update pass (2026-09-30)

**Artifact:** `ARCHITECTURE-SPINE.md` (updated 2026-09-30)
**Lens:** good-spine checklist, weighted toward AD-5, AD-6, AD-8, AD-12, AD-14, AD-15, AD-18 and new AD-20
**Reviewer scope:** read-only; no project file other than this one was edited.

## Verdict

**Conditional pass, not clean.** No Critical finding. The 2026-09-30 changes are largely coherent and enforceable for the Markdown create/update and read-only paths, and the stack and most brownfield claims verify against the repository. Two High findings remain: the HTML-worker path is not covered by AD-20's boundary, and AD-11's transport-timeout precondition has no baseline mechanism and no verification. There are also fourteen Medium divergence holes, most of them outside the text changed on 2026-09-30.

Findings that the spine's "Pending PRD alignment" paragraph already records as accepted PRD conflicts (FR-4, FR-7, FR-11, CAP-4 read half, FR-16 exception, FR-20 content, Section 4.5 identity wording) are not repeated here.

## Method and evidence base

- Read the spine, the memlog (authority on decisions), the PRD, the PRD addendum, and the SPEC. Read the repo policy in `CLAUDE.md`.
- Checked baseline claims against code at the fork baseline: `server/tools/documents.ts`, `server/tools/util.ts`, `server/commands/documentCreator.ts`, `server/commands/documentUpdater.ts`, `server/models/Document.ts` (`publish`, `unpublishWithCtx`), `server/models/Event.ts`, `server/routes/api/events/*`, `server/routes/mcp/index.ts`, `server/middlewares/authentication.ts`, `server/queues/tasks/DocumentImportTask.ts`, `server/queues/queue.ts`, `server/services/worker.ts`, `plugins/webhooks/*`, `server/storage/database.ts`, `server/main.ts`, `server/env.ts`, `shared/helpers/AuthenticationHelper.ts`, `shared/utils/EventHelper.ts`.
- Ran Node checks confirming the AD-5 premise: stock `JSON.parse` accepts a lone-surrogate escape, keeps the last duplicate key, and loses `-0`, `1e2` and large-integer source forms. A strict `TextDecoder` (fatal) rejects invalid UTF-8.
- Repo state: `git fetch --prune` succeeded. Local HEAD is 1 ahead of `origin/feature/mcp-wiki-linting-v1.10.1` and 0 behind, so the local state is current. Dirty planning files were not touched.

## Rubric scorecard

| Checklist item | Result | Note |
| --- | --- | --- |
| Fixes the real divergence points, misses none | **Partial** | Result algebra, fingerprints, sentinel and classification are well fixed. Gaps: HTML-worker outcome ownership (H-1), timeout mechanism (H-2), several client-visible contracts (M-2, M-3, M-4, M-5, M-6, M-7, M-11). |
| Every AD Rule is enforceable and prevents its stated divergence | **Partial** | AD-11, AD-19 ("may"), AD-20 (HTML path, unknown outcomes) and AD-3/AD-12 (`POLICY_NOT_CONFIGURED`) do not fully prevent what their Prevents lines claim. |
| Nothing under Deferred can make two units diverge | **Pass** | D-1 to D-8 are operator, environment, or future-scope items. One dependency to record: D-3/OD-7 must own the end-to-end 65 s transport timeout (H-2). |
| Named tech verified-current | **Pass** | Lockfile, Dockerfile, `package.json` and CI match the Stack table. Caveats are in L-8. |
| Ratifies rather than contradicts the brownfield codebase | **Mostly** | Gaps: global `REQUEST_TIMEOUT` (H-2), `Event.enqueue` fan-out and `events.list` contract (M-10), text-only baseline `error()` (M-6), scope-filtered tool registration (M-7), queue failure logging (L-6). |
| Covers the SPEC's capabilities | **Pass with traceability gap** | CAP-1 to CAP-6 are all mapped. SPEC still lists AD-1 to AD-19 only (L-1). |
| Every dimension the altitude owns is decided, deferred, or open | **Mostly** | Operations/environment: timeout, config-health observability, mixed-fingerprint prevention, migration and orphan cleanup are thin or silent (H-2, M-1, M-8, L-7). Infra/provider strategy is decided ("no framework or external service"). |

## Findings

### Critical

None.

### High

**H-1. The HTML-worker path leaves the AD-20 boundary undefined: no audit owner, unknowable rollback, redelivery, disclosure-filter placement**
- **Location:** AD-20 rows 3, 5, 6 and the sentence "initiated immediately after commit and before response assembly"; AD-7 (worker intent and response); AD-14 (idempotent ID); AD-15.
- **Problem:** Baseline facts:
  - `DocumentImportTask.perform` commits in the worker, folds every error into `{ error: string }`, and has no job timeout.
  - The web handler waits with `scheduleAndWait` → `job.finished()` (`server/tools/documents.ts:447`).
  - Bull redelivers stalled jobs, and `server/queues/queue.ts` only counts the `stalled` event.

  AD-20 reads as one process doing commit, then audit, then response assembly. On the HTML path, commit and response live in different processes. Four consequences:
  1. **No owner for the summary.** The Event ID is the deterministic `invocationId`, so the first writer wins. A requester-side "job failed, stalled, or wait interrupted" can persist `aborted_after_decision` while the worker committed (or will commit) and writes `validated`, or the reverse. Wrong or duplicated evidence is then permanent.
  2. **Rollback cannot be known by the requester.** Rows 3 and 5 assert "Rollback" plus a protocol error. When the failure is a lost job result, a stall, or a COMMIT-time error, the write may have committed. That is the "committed write presenting as a failure" that AD-20's Prevents line claims to rule out. There is no "outcome unknown" row.
  3. **Redelivery.** AD-7 makes staged blobs idempotent by `invocationId`. It does not make materialization idempotent, so a redelivered job can create a second document.
  4. **Disclosure filter.** The worker returns "the structured validation outcome" (AD-7). AD-12 says "the enforcement layer" applies the collection-read check, and does not say where. The HTML path can diverge from create/update.
- **Fix:**
  - State that the process that commits, or determines the rejection, writes the summary. The requester writes a summary only for outcomes it determines itself, and never on a lost job result.
  - Add an explicit "outcome unknown" row: requester loses the job result, so it returns a protocol error with no `aborted_*` claim and evidence comes only from the worker. Before failing, the requester checks by `invocationId` whether a committed document exists.
  - Make worker materialization idempotent by `invocationId`.
  - Route all three write paths through one shell function, for example `presentValidation(actor, classifiedCollection, outcome)`, applied in the handler.
  - Extend AD-18 with fixtures: worker crash after commit, redelivered job, requester wait interrupted.

**H-2. AD-11's "/mcp transport timeout is at least 65 seconds" has no baseline mechanism and no verification**
- **Location:** AD-11 Rule; AD-19 (readiness); Deferred D-3.
- **Problem:** The baseline has no per-route timeout.
  - `server.setTimeout(env.REQUEST_TIMEOUT)` is server-wide (`server/main.ts:146`), default 10 s (`server/env.ts:318`).
  - The same value derives `statement_timeout = REQUEST_TIMEOUT - 500 ms`, applied with `SET LOCAL` to every transaction in API-only processes (`server/storage/database.ts:79`, `applyStatementTimeoutToTransactions`).

  So the precondition can only be met by raising the global variable, which also lifts the socket and statement timeout of the whole app, or by new per-route code. AD-11 chooses neither and nothing checks the result. The default deployment aborts `lint_wiki` at about 10 s with no result, which is the exact failure AD-11 says it prevents. NFR-3 (p95 ≤ 10 s at 150 documents) sits at the default ceiling. AD-11's "each DB deadline is capped by remaining time" also collides with the baseline wrapper's fixed `SET LOCAL statement_timeout`, so the snapshot transaction needs an explicit override. Reverse-proxy and CDN read timeouts are also "transport", and D-3 does not list them.
- **Fix:** Decide the mechanism in AD-11: either a `/mcp`-only socket-timeout override with the shell setting statement timeout per transaction, or a startup-checked requirement. For example, if any Configured Collection exists and `REQUEST_TIMEOUT < 65000`, startup fails or readiness is false with a stable diagnostic. Add "every hop's idle/read timeout ≥ 65 s" to the OD-7 evidence list and add an AD-18 test.

### Medium

**M-1. No deadline is defined for `lint_document` or enforced-write validation, and audit latency is not isolated**
- **Location:** AD-11 (`Binds` covers `lint_wiki` only); AD-3 (`VALIDATION_TIMEOUT`); AD-13; AD-15; AD-20.
- **Problem:**
  - Only `lint_wiki` has a deadline (60 s). `VALIDATION_TIMEOUT` is fail-open eligible for writes, so its numeric value decides whether a slow write is admitted (`open`) or rejected (`closed`). Different values give different outcomes for the same input.
  - It is also unspecified how that deadline interacts with the baseline ~9.5 s default statement timeout, and where the line falls between `VALIDATION_TIMEOUT` and AD-20's statement-timeout rows.
  - AD-15 isolates audit failure but not audit latency. Audit runs on the request path ("before response assembly"). If it is awaited without a bound, a hung Event insert delays or drops the response. If it is not awaited, "exactly one retrievable summary" tests race, and `durationMs` and NFR-2 overhead accounting are ambiguous.
- **Fix:** Add a code-owned deadline table for `lint_document` and enforced-write validation (value, monotonic clock, start point, which phases count). State that audit is awaited with its own bounded timeout, whether it is inside or outside `durationMs` and the NFR-2 window, and that a timeout counts as an audit failure (diagnostic only).

**M-2. `POLICY_NOT_CONFIGURED` has no carrier in the closed result algebra**
- **Location:** AD-3 closing sentence; AD-12.
- **Problem:** AD-3 defines "a stable `not_evaluated` reason". AD-12's read-result shape is closed and has no `reason` field. Neither `Finding` nor `SystemFailure` can carry it. The code is unobservable to clients, and implementers will invent a field or drop it. FR-1 wants policy-not-configured to be explicit.
- **Fix:** Add `reason: "POLICY_NOT_CONFIGURED"` (present only when `state = not_evaluated`) to the AD-12 read result and, if wanted, to AD-14. Otherwise delete the code and say `not_evaluated` alone means it. Add an AD-18 fixture.

**M-3. Read-only `lint_document` for a document readable without collection read is unresolved (the read-side mirror of C-5)**
- **Location:** AD-12 (`EvaluatedScope` document variant, `PolicyIdentity`, "an unreadable sentinel contributes nothing"); C-3/C-5.
- **Problem:**
  - `EvaluatedScope { kind: "document", documentId, collectionId, … }` and `PolicyIdentity.collectionId` require a collection ID. AD-12 also says these contain authorized IDs only.
  - `lint_document` is entered through document readability (FR-4), and Outline allows document-level membership without collection read (the same paths C-5 cites). The 2026-09-30 rule was applied to enforced-write `validation` only.
  - Result: the collection ID and identity either leak or contradict the "authorized IDs only" statement.
  - Worse, "an unreadable sentinel contributes nothing" makes such an actor see `not_evaluated` for a document in a sentinel collection. That is a broken configuration reading as unconfigured, the exact outcome C-3 forbids. The same actor's enforced write returns `POLICY_CONFIGURATION_INVALID` under C-5. The two sides are asymmetric.
- **Fix:** Define `lint_document` for a document-only actor. Make `collectionId` optional in the document scope and leave `policies` empty. Still return the sentinel System Failure, located `scope { scopeKind: "collection" }` without `collectionId`. Decide readability on the document's collection with `can(actor, "read", collection)`. Add the case to the AD-18 sentinel matrix.

**M-4. A rejected create has no document ID for Finding locations or Event columns**
- **Location:** AD-4 (`text`, `document`, `relationship` locations require `documentId`); AD-14 ("Event columns follow … safe document and collection IDs"); AD-12.
- **Problem:** A rejected `create_document` never has a row, but FR-14 requires Findings with locations and AD-4 requires `documentId`. Implementers will fabricate, null, or omit it differently. `Event.documentId` is a foreign key to `documents` (`server/models/Event.ts`), so an ID for a non-persisted document would break the audit insert.
- **Fix:** Pre-allocate the document UUID at classification (`documentCreator` already accepts `id`). Use it in locations and as the persisted ID on success. State in AD-14 that `Event.documentId` is null unless the document row exists.

**M-5. AD-4's coordinate system is underdetermined**
- **Location:** AD-4; Stack (markdown-it); AD-2 ("canonical syntax with safe locations").
- **Problem:** Not decided:
  - the unit of `column` (UTF-16 code unit, code point, or byte);
  - line-ending normalization;
  - the segment vocabulary and grammar of `path`, which is also a sort key;
  - the component that produces "canonical syntax with safe locations".

  markdown-it is in the Stack table but no AD references it, and it gives block-level line maps with no column offsets. Baseline link extraction (`ProsemirrorHelper.parseDocumentIds`) works on ProseMirror nodes with no source positions. CAP-1's byte-equivalent output for non-ASCII wiki text depends on these choices. For rejected writes the coordinates also refer to canonical text the agent never received.
- **Fix:** Fix the column unit and LF-normalized canonical text. Give the `path` grammar (for example `["heading", 2]`). Name the one position-producing component and forbid rule-local recomputation. Add non-ASCII fixtures to AD-18.

**M-6. The collection-conflict identifier and result transport are undefined**
- **Location:** AD-8 Collection change ("stable collection-conflict error identifier"); AD-12; AD-3/OD-1.
- **Problem:**
  - Baseline `error()` (`server/tools/util.ts`) returns only `{ content: [text], isError: true }`.
  - FR-16 makes the stable identifier a client contract. AD-3's registry, which OD-1 makes the catalog of exact names, has no entry for it, and no AD names the string or says where it travels.
  - AD-12 defines JSON shapes but not whether they travel as JSON text blocks (baseline `success()`) or MCP `structuredContent`.
  - The AD-18 row-2 fixture cannot be written.
- **Fix:** Add a "protocol error identifiers" entry to AD-3 (name plus carrier, for example a first text block `{"error":{"code":…}}`). State one transport for all lint and validation payloads.

**M-7. Lint tool contracts are unspecified: input schemas, annotations, scope gating**
- **Location:** Structural Seed (`tools/wikiLint.ts`); AD-2; AD-12; AD-15.
- **Problem:**
  - Nothing fixes input names (`id` vs `documentId`, and whether `urlId` is accepted) or annotations. `readOnlyHint` would be false in substance because every call persists an Event.
  - Nothing fixes the OAuth/API-key scope that gates registration. The baseline registers tools per scope (`AuthenticationHelper.canAccess(...)` in `server/tools/documents.ts`), and `methodToScope` defaults unknown methods to `Scope.Write`. A lint tool tied to an unmapped name could silently need write scope and vanish for read-only tokens, breaking NFR-19 discovery and UJ-1.
- **Fix:** Add a "tool contract" paragraph: inputs, annotation values, scope mapping (for example the `documents.info`/`documents.list` read gate), and use of `withTracing`. Add an AD-18 discovery test per scope.

**M-8. Configuration health is not observable as NFR-16 requires, and rollout consistency is only "may"**
- **Location:** AD-6 ("exposes only that hash, stable code, and schema path"); AD-19; AD-5.
- **Problem:**
  - **(a)** AD-6 promises a stable code and schema path for an invalid entry, but no channel carries them. AD-12's invalid `PolicyIdentity` has only `collectionId` and `invalidFingerprint`. AD-19 startup reports "only config status, activation counts, and a policySetFingerprint". NFR-16 needs enough non-secret context to locate the scope. Today an operator cannot learn which entry is invalid or why without running a lint as an admin actor.
  - **(b)** AD-19 says readiness "may" require `WIKI_LINT_EXPECTED_CONFIG_FINGERPRINT`. A "may" does not prevent "mixed-policy instances serving one rollout". There is also no defined channel through which an instance "reports" its fingerprint.
  - **(c)** Topology is unstated. Outline runs web, worker, cron and collaboration through `SERVICES`. The HTML worker (AD-7) compares its own loaded fingerprint, so it must load, validate and report identically. The startup-fatal behavior per service is unspecified.
- **Fix:**
  - Define a per-service startup diagnostic record: status, counts, `policySetFingerprint`, and for each sentinel its `collectionId`, stable code, schema path and `invalidFingerprint`, as operator-only log fields.
  - Make the expected fingerprint mandatory whenever any collection is `enforced`, with mismatch as startup failure.
  - State that every service evaluating policy loads independently under the same rules.

**M-9. Configuration key form and non-resolving keys**
- **Location:** AD-5 (`Record<UUID, CollectionPolicy>`); AD-6 ordering; AD-8 classification.
- **Problem:** The key validator is not specified. Classification compares against the UUID "as the baseline resolves it" (lowercase canonical from Postgres). An uppercase, braced, or hyphenless key is either rejected as unidentifiable (startup-fatal) or accepted and never matches, so enforcement is silently off. Case-variants of one collection also escape byte-based duplicate detection. A well-formed but mistyped UUID is silently unconfigured, with no diagnostic.
- **Fix:** Require lowercase canonical 8-4-4-4-12 hex, any version, otherwise unidentifiable. Detect duplicates case-insensitively. Emit an informational startup diagnostic for keys that do not resolve to an existing collection.

**M-10. Event bus fan-out and the `events.list` contract are undecided**
- **Location:** AD-14 ("reuse Event"); AD-15 (`auditWikiLint`).
- **Problem:**
  - **Fan-out.** Every saved Event is auto-enqueued on `globalEventQueue` (`Event.enqueue`, `@AfterSave`). `WebhookProcessor` has `applicableEvents: ["*"]` and matches `"*"` subscriptions. `DeliverWebhookTask` falls to `assertUnreachable`, which only logs a warning. The worker logs each event including `data`. The spine is silent, so one unit may add suppression and another handlers.
  - **`events.list`.** `EventsListSchema` validates `events` against two `z.enum` lists, and `where.name` is `ACTIVITY_EVENTS` or `AUDIT_EVENTS`. "Add `auditWikiLint` to `events.list`" does not say:
    - the request shape;
    - the default name set;
    - that the names stay out of `ACTIVITY_EVENTS`;
    - whether the names enter `AUDIT_EVENTS`.

    If they entered `ACTIVITY_EVENTS`, any member with collection read could list `write_validation` summaries, which carry actor-independent fingerprints. That contradicts AD-12's identity rule.
- **Fix:** Decide explicit non-delivery for `wikiLint.*` (skip the enqueue, or make every processor ignore them). State the names are excluded from `ACTIVITY_EVENTS`. Define the request/response contract. Add AD-18 tests: a `"*"` webhook receives nothing, and a non-admin cannot list.

**M-11. Audit-summary semantics for the read-only surfaces are incomplete**
- **Location:** AD-14 (`AuditDataV1`, Policy fields, Scope).
- **Problem:**
  - **(a)** `policySchemaVersion` and `policyFingerprint` presence is defined only for `write_validation`. For `wikiLint.wiki` with `configured_collections` there are many policies and one field. For a sentinel collection in a read-only lint there is no `invalidFingerprint` field.
  - **(b)** The read-only `outcome` mapping is not defined. For a complete result with warnings only, is it `clean` or `findings`? The glossary says clean means zero Errors, and SM-P2 is computed from the audit surface.
  - **(c)** Reads that fail before scope authorization (denial, invalid input, inaccessible document) have no `outcome`. FR-19 says every invocation attempts a summary, while writes have explicit "none" rows (AD-20 rows 1 and 2). The asymmetry makes "exactly one summary per invocation" untestable.
- **Fix:** Define per-surface policy-field rules. For example, omit them for `configured_collections`, or add a separately named subset fingerprint. Add an outcome mapping (`findings` iff complete and errors > 0). Add a read-side rule for pre-authorization failures.

**M-12. AD-20 rows are enumerations with no default; several failure classes are unplaced; post-commit enrichment shape undefined**
- **Location:** AD-20 table; AD-12 last paragraph.
- **Problem:**
  - **(a)** Row 3 lists specific pre-decision failures. Unlisted: media staging failure (the AD-7 stage step), a generic DB or connection error at the re-fetch, and an unexpected exception while building the projection. Mapping these to `VALIDATION_RUNTIME_FAILED` (fail-open eligible, so it could admit an unvalidated write) rather than `aborted_before_decision` is left to implementers. Row 5 likewise omits materialization failure (Attachment commit or storage transfer) and COMMIT errors.
  - **(b)** In patch mode, `document` metadata and the echo come from one `presentDocument` call (`server/tools/documents.ts`, around lines 735-750). Breadcrumb and share URL are separate calls. If the presenter fails, no `document` block remains, and the minimal committed-success shape per tool is not defined. Baseline `catch (message) → error(message)` wraps everything, so the handler must be restructured so post-commit code cannot throw into the error path.
- **Fix:** Add a default rule. For example: any failure not otherwise placed goes to row 3 before the decision and row 5 after it. `VALIDATION_*` System Failures apply only to failures inside rule evaluation or the authorized-data reads made for validation. Name staging, materialization and commit errors. Define the minimal success shape for create, update and patch, and require a post-commit try/catch boundary.

**M-13. AD-8's lock scope and isolation cannot deliver "detected at any point up to commit"**
- **Location:** AD-8 Rule and Collection change; AD-20 row 2.
- **Problem:** The rule locks only "the update document row". Creates (parent-derived collection), draft publication targets, and related state are re-fetched without locks under the default READ COMMITTED isolation. The spine states no isolation level. A collection can change after the re-fetch and before commit, so the guarantee cannot hold. "Prevents TOCTOU between projection and save" is overbroad for those paths. For updates the row lock does stabilize `document.collectionId`. For creates, policy validity is unaffected because the row stores the classified collection. The row-2 claim and its AD-18 fixture still need a precise window.
- **Fix:** State the isolation level and the lock set (document row `FOR UPDATE` for updates; parent row or collection row shared locks for parent-derived create and publish). Or restate row 2 as "detected at the AD-8 re-fetch or the AD-7 worker re-authorization" and record the residual window.

**M-14. Internal-link recognition is undefined**
- **Location:** AD-2/AD-3 (`INTERNAL_LINK_TARGET_UNRESOLVED`); AD-10 ("deterministic batched link extraction").
- **Problem:** What counts as a "visible internal link" is not defined: host match against `env.URL`, `/doc/<slug>-<urlId>`, UUID paths, mention nodes, relative links, collection links, and links inside code spans or images. The baseline has several notions: `isInternalUrl`, `isDocumentUrl` and `parseDocumentSlug` in `shared/utils`, and `ProsemirrorHelper.parseDocumentIds` used by `BacklinksProcessor`. The choice changes Findings, and a material meaning change requires a new code.
- **Fix:** Bind extraction to one named baseline helper set, or list the exact forms. Require the same function for `lint_document`, `lint_wiki` and writes.

### Low

**L-1. SPEC and `binds` traceability.**
- `SPEC.md` (Constraints and Success signal) lists AD-1 to AD-19 only, and the "Pending PRD alignment" paragraph does not mention the SPEC. AD-20 is the newest and most cross-cutting decision.
- Frontmatter `binds` says PRD NFR-1 to NFR-23, but the PRD defines NFR-1 to NFR-27. NFR-24 (rule verification), NFR-25 (environment independence), NFR-26 (baseline conformance) and NFR-27 (observation failure isolation, implemented by AD-15/AD-18) are missing.
- Fix: record SPEC alignment for AD-20 and extend `binds`.

**L-2. `POLICY_SCHEMA_VERSION_UNSUPPORTED` is described as having a non-root occurrence that cannot exist.** AD-3 says "root-level occurrence is startup-fatal", which implies a non-root case. Entries carry no `schemaVersion`, and AD-12's `policySchemaVersion` is the constant 1. The code is never returned in a result. Fix: mark it startup-diagnostic-only or define the other case.

**L-3. Fingerprint edge definitions (AD-5/AD-6).**
- Define the byte span as first to last byte of the value token, excluding surrounding whitespace.
- Require strict UTF-8 without a BOM, and fail startup otherwise. Multi-line entries hashed as raw bytes change `invalidFingerprint` under CRLF conversion, while `policyFingerprint` stays stable.
- Only `runtimeFailureMode` has its default normalized before hashing. The registry must forbid rule-parameter defaults or normalize them, so equivalent policies share a fingerprint.

**L-4. Over-claim in AD-20's Prevents line.** "A fail-open write with no durable trace" is not fully prevented given AD-15's accepted audit-failure and crash windows and D-6. Qualify it "under normal audit operation". Also state which of a write's several baseline mutation Events (`documents.create`, `documents.publish`, `documents.update`; `revisions.create` is emitted asynchronously) carries `validationCorrelationId`.

**L-5. AD-9's "generic safe System Failure" is unnamed.** The closed set has only `VALIDATION_RUNTIME_FAILED`, whose meaning is "unexpected … operation failed". Name it or add a code for "could not be proven under the actor's authorization".

**L-6. Sentinel and global-failure interplay, and job logging.**
- **Sentinel.** AD-12 says a sentinel contributes exactly one System Failure. AD-10/AD-11 say a global snapshot failure "may return no findings". State whether sentinel failures (which need no snapshot) are still returned, and how they sort relative to a timeout. The `lint_document` scope variant has no `completedChecks`, so "zero-count scope entry with empty `completedChecks`" applies to the collection variants only.
- **Logging.** `queue.on("failed")` in `server/queues/queue.ts` logs `data: job?.data` on the final attempt. The HTML job carries the full `content`, and AD-7 adds actor, IP and fingerprint fields, against the spine's own Logging convention and NFR-17. Fix: stage content through the task's existing `key` mode for the enforced intent, or redact for this task. Add a log-content test.

**L-7. Operations tail.**
- The `events(teamId, name, createdAt)` migration should follow the baseline precedent (`concurrently: true`, see `server/migrations/20260903145856-…`). State that it is additive, so AD-19's separate image rollback stays safe.
- Staged blobs orphaned by a process crash have no sweeper. Define a key prefix plus a lifecycle or cleanup task, or accept the residual explicitly.
- Rule-to-surface applicability is implicit. The spine should say the hierarchy and global-index codes are `lint_wiki`-only and the document and link codes run on all surfaces (AD-1's Prevents line).

**L-8. Currency caveats (the Stack table itself verifies).**
- Verified against repo: Node `26.3.0` (Dockerfile, Dockerfile.base), Yarn `4.11.0` (`packageManager`), TypeScript `6.0.3`, MCP SDK `1.29.0`, Zod `4.5.4`, markdown-it `14.3.0`, Sequelize `6.37.8` (`yarn.lock`), PostgreSQL `14.2` (CI image).
- PostgreSQL 14.2 is a 2022 minor, and PostgreSQL 14 reaches community EOL in November 2026. The target database is unknown until OD-7, so the AD-17 manifest should record the actual server minor, and OD-7 should confirm the target major.
- To my knowledge Node 26 is the Current line, pinned by the baseline, until its scheduled October LTS promotion.
- AD-17 does not define the timing boundary: client round trip through `/mcp` versus handler duration, and whether the audit write is inside the timed window.

## Scorecard for the AD text changed on 2026-09-30

| AD | Assessment |
| --- | --- |
| AD-5 | Sound. The custom decoder, source spans, and fatal versus sentinel split are consistent and testable (AD-18 now covers them). Gaps: key form (M-9), encoding and span edges (L-3), config-health observability (M-8). |
| AD-6 | Sound. `invalidFingerprint` over source bytes is computable for every defect and `policySetFingerprint` members are well-formed. Edge definitions (L-3). |
| AD-8 | Coherent. Classification keys, the Collection-change rule, and the sentinel pre-write list match baseline handler order (`create_document`, `update_document`, `authorizeDocumentCreate/Publish`). Gap: lock scope and isolation (M-13). |
| AD-12 | The sentinel read algebra and the identity-disclosure rule are internally consistent for writes. Gaps: `reason` carrier (M-2), document-only actors on the read side (M-3), rejected-create IDs (M-4), transport and error identifiers (M-6). |
| AD-14 | `aborted_*` outcomes, the `scopeKind: collection` rule and the sentinel omissions are clear. Gaps: read-side policy fields, outcome mapping, pre-authorization reads (M-11); Event fan-out (M-10). |
| AD-15 | Timing text now covers `AD-20` rollbacks. Gaps: audit latency bound (M-1), `events.list` contract (M-10), HTML-path owner (H-1). |
| AD-18 | New coverage is proportionate and matches the changed rules. Add the fixtures named in H-1, H-2, M-2, M-3, M-9, M-10 and the non-ASCII location cases. |
| AD-20 | Good structure for the Markdown create/update paths and the "first failure selects the row" rule. Not yet closed for the HTML worker or for unknown outcomes (H-1), no default rule (M-12). |

## Verified with no finding

- The sentinel classification keys (`document.collectionId`; collection from `authorizeDocumentCreate`; collection from `authorizeDocumentPublish`) match baseline behavior. `Document.publish` ignores `collectionId` when the document already has one, and `documentUpdater`'s `cId = collectionId || document.collectionId` does not move a collected document.
- The AD-8 sentinel exclusions match the baseline call order. The "no changes" check, the unpublish-with-children check, the patch-target check, and the image, import-size and model checks all run inside or after the writer.
- Baseline `MCP AuthInfo.clientId` is the empty string (`server/routes/mcp/index.ts:175`). Only `oauth` and `api` credentials reach `/mcp`. `OAuthAuthentication` binds a client, so AD-15's attribution seam exists.
- `documentUpdater` takes its row lock only when a transaction exists, and MCP `update_document` opens none, so AD-8's added transaction is a real change.
- `Event.createFromContext` defaults to the caller's transaction, so AD-15's independent transaction requires an explicit choice. `events.list` already requires `actorId != null`.
- `getDocumentBreadcrumb` already gates on `can(user, "read", collection)`, which supports C-5's readability rule as an existing pattern.
- Stock `JSON.parse` behavior claimed in AD-5 and the memlog (C-4) is correct.
