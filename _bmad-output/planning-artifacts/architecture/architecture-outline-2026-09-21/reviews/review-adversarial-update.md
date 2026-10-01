# Adversarial Divergence Review — 2026-09-30 Update Pass

**Spine reviewed:** `ARCHITECTURE-SPINE.md` (updated 2026-09-30; AD-1 through AD-20)
**Lens:** construct two units one level down that each obey every AD to the letter yet build incompatibly (clashing shared-data shapes, two owners of one entity, conflicting state-mutation paths).
**Scope:** concentrated on the 2026-09-30 changes (AD-5, AD-6, AD-8, AD-12, AD-14, AD-15, AD-18, new AD-20); the rest of the spine was also attacked. The "Pending PRD alignment" conflicts are not reported.
**Baseline facts verified in `/home/ezop/repos/outline`:** `server/tools/documents.ts`, `server/tools/util.ts` (`error()` drops error ids), `server/queues/tasks/DocumentImportTask.ts` (worker returns `{documentId} | {error: string}`), `server/commands/documentUpdater.ts` / `documentCreator.ts`, `server/models/Document.ts` (`publish`, `unpublishWithCtx`), `server/models/Event.ts` (`@AfterSave enqueue`, FKs), `server/routes/api/events/events.ts` (`actorId != null` filter), `plugins/webhooks/**`, `shared/utils/error.ts`.

## Verdict

**Not converged.** The sentinel state algebra (incomplete/failed/never clean) and the AD-14 aborted-summary field values are tight, but AD-20 fixes only the *names* of six rows, not the *phase order, the owner of each effect, or the result shape crossing the HTML-worker boundary*. One Critical, twelve High, twelve Medium, and three Low divergence pairs remain (the index lists them all); each has a minimal tightening below.

## Findings index

| ID | Sev | ADs | One line |
| --- | --- | --- | --- |
| A-1 | Critical | AD-7, 12, 14, 15, 20 | HTML worker to handler contract: result union, audit owner, readability owner, and commit-unknown are undefined. |
| A-2 | High | AD-7, 8, 20 | AD-20 rows are enumerations, not phases; total order of re-auth, collection-change, fingerprint, conversion is open. |
| A-3 | High | AD-8, 13, 20 | A DB error inside the single AD-8 transaction poisons it, so fail-open persist is unimplementable without a stated containment rule. |
| A-4 | High | AD-11, 13, 3 | Write-path evaluation contract missing (deadline, per-rule isolation, buffered-unit discard): an open collection can persist a document with a discoverable Error. |
| A-5 | High | AD-3, 7, 8, 11 | No rule-surface applicability: which codes run on writes versus `lint_wiki`. |
| A-6 | High | AD-8, 12, 20 | The "stable collection-conflict error identifier" has no name, no wire shape. |
| A-7 | High | AD-8, 20 | Lock set and edit placement: collection-change detection "up to commit" is unenforceable; patch outside versus inside the transaction changes concurrency outcomes. |
| B-1 | High | AD-5, 6 | Malformed-versus-lexical boundary, BOM, invalid UTF-8, span edges, escape-equivalent duplicate keys. |
| B-2 | High | AD-5, 6, 8 | Collection-key grammar: an uppercase UUID key silently disables enforcement in one reading. |
| C-1 | High | AD-12, 4 | Read-side "actor-readable" undefined for document-membership-only actors; `EvaluatedScope.document.collectionId` is mandatory. |
| C-2 | High | AD-4 | Sort keys "location-kind rank" and "structural path" comparison are undefined. |
| C-3 | High | AD-4, 7, 12 | Create-time Findings need a `documentId` that does not exist. |
| D-1 | High | AD-14, 15 | Audit Event row population and enqueue behavior unpinned (`actorId` makes rows invisible; `AfterSave` enqueue). |
| A-8 | Medium | AD-20, 12 | "Optional enrichment" and patch-mode envelope; where `validation` sits. |
| A-9 | Medium | AD-20 | "Protocol error with baseline content" has no referent for failures without a baseline analog. |
| A-10 | Medium | AD-20, 15 | Commit-indeterminate, client cancellation, and awaited-versus-fire-and-forget audit. |
| B-3 | Medium | AD-6 | Rule-parameter defaults inside `policyFingerprint`. |
| B-4 | Medium | AD-19, 6 | Startup reporting of sentinels versus NFR-16. |
| C-4 | Medium | AD-11, 12 | "Required unit", vacuous checks, unit order, partial counts. |
| C-5 | Medium | AD-3, 4, 12 | Locations of run-level System Failures; code and location of the global-index "generic safe System Failure". |
| C-6 | Medium | AD-4, 10 | Column unit and title inclusion in the coordinate system. |
| C-7 | Medium | AD-12, 13, 14 | `degraded_validation` "dominates Warnings"; `complete` for rejected writes; order of `scope.collections`. |
| D-2 | Medium | AD-14 | Read-summary mapping (`findings`), read policy fields, read pre-evaluation failure, `durationMs`. |
| D-3 | Medium | AD-14 | Which baseline mutation Events carry `validationCorrelationId`. |
| D-4 | Medium | AD-13, 16 | Client-controlled resource-limit failures are fail-open eligible; limit scope on writes undefined. |
| E-1 | Low | AD-3, 5 | `POLICY_SCHEMA_VERSION_UNSUPPORTED` cannot appear in any result. |
| E-2 | Low | AD-15 | `events.list` precedence when an actor holds both `audit` and `auditWikiLint`. |
| E-3 | Low | AD-12 | Identity omission leaves valid-versus-invalid classification undetectable for unreadable actors (accepted trade-off, state it). |

---

## A. AD-20 table, AD-8, AD-7: create versus update versus HTML worker

### A-1 (Critical) — HTML worker to handler contract

**Pair.**
- **Unit A (MCP `create_document` handler)** keeps the baseline call shape: `await DocumentImportTask.scheduleAndWait(...)`. The job returns `{documentId}` or `{error: string}`. On `error`, the handler throws (baseline `InvalidRequestError`), synthesizes `validation: rejected` for the fingerprint-mismatch string, and writes the `wikiLint.write_validation` summary itself after `scheduleAndWait` returns, because AD-15 says audit runs "after write commit, rejection rollback, or AD-20 abort rollback" and the handler is where the response is assembled.
- **Unit B (`DocumentImportTask.perform`)** implements AD-7 literally: it returns the "structured validation outcome with the document ID when persisted", returns `{validation}` for Error rejections, `{error}` for aborts, and persists the summary itself, because the worker owns the transaction and therefore the commit or rollback that AD-15 keys on.

Both comply. AD-7 defines a return shape only for the persisted case. AD-15 does not name the auditing process. AD-14 makes the write idempotent by Event ID but does not say which body wins.

**Consequences.**
- Two summaries with the same `Event.id` and possibly different `outcome`: `job.finished()` failing or the request being torn down makes the handler record `aborted_after_decision` while the worker committed and recorded `validated`. That is exactly the "committed write presenting as a failure" AD-20 says it prevents.
- Or zero summaries, if each assumes the other writes.
- `can(actor,"read",collection)` (the AD-12 identity-omission test) is computed at classification by A and in the worker with the reloaded actor by B. They differ if access changes between the two.
- `durationMs` starts at handler entry (includes queue wait) in A and at job start in B.
- The worker cannot return AD-12 `validation` for Error rejections in B's shape unless the queue payload type is shared; A and B pick different unions.

**Tighten (AD-7 + AD-20).**
1. Define `EnforcedImportResult = { kind: "committed", documentId, validation } | { kind: "rejected", validation } | { kind: "aborted", row: 3 | 5 }`.
2. The worker is the sole owner of evaluation, decision, and the summary for the HTML path. The handler never writes a summary for an HTML enforced create.
3. `readable` (the identity-omission boolean) is computed once at classification and travels in the trusted intent.
4. The intent carries `deadlineAt`. The worker refuses to enter the persist step after it, so a handler-side timeout can never coincide with a later commit.
5. `durationMs` is measured from classification to result assembly and includes queue wait.

### A-2 (High) — AD-20 rows are enumerations; the phase order is open

AD-20 says "the first failure that ends the attempt selects its row", but the spine never fixes the order of phases, and the row 3 and row 5 lists are closed enumerations.

**Pair 1 — row 2 versus row 3 (update, concurrent move).** The actor's document is moved by the UI from classified collection X to Y, where the actor has no access.
- Unit A: AD-8 re-fetch, then re-authorize. The authorization error is row 3, `aborted_before_decision` summary recorded.
- Unit B: re-fetch, then compare collections. The collection-conflict error is row 2, no summary, and the error reveals that a move happened.

Both are "detected at any point up to commit" and "re-authorization denial".

**Pair 2 — HTML worker: fingerprint mismatch versus conversion failure.** The config differs in the worker and the HTML is unconvertible.
- Unit A compares fingerprints first (AD-7: "before materialization"), so row 4: `rejected` plus `POLICY_CONFIGURATION_INVALID`, and the request-time identity is returned.
- Unit B converts first (AD-20: conversion is pre-decision), so row 3: protocol error, `aborted_before_decision`.

AD-12's "even if Findings were produced before the mismatch was detected" suggests the check may run after validation, which supports B. It also permits a third order: reload actor, re-authorize, compare, convert.

**Pair 3 — re-fetch target missing.** A parent, template, or document deleted between handler and transaction is not in row 3's list (re-authorization denial, actor-reload failure, lock or statement timeout). Unit A treats it as a denial (row 3). Unit B treats it as a "conflict other than row 2" (row 5, `aborted_after_decision`, although no decision was reached).

**Tighten (AD-20).** Replace the enumerations by phases and make rows 3 and 5 catch-alls by phase (Appendix A gives full text). Key clauses:
- Rows 3 and 5 are defined by *phase*, and the lists are illustrative.
- "Re-authorization precedes the collection comparison, so a denial never reveals a move."
- Worker order is: actor reload, destination re-authorization, collection-change check, fingerprint comparison, conversion, staging, transaction. Fingerprint comparison happens once, at the start.
- A missing re-fetch target is row 3.

### A-3 (High) — Fail-open persist after a DB error inside the AD-8 transaction

AD-8 mandates one primary-DB transaction that "reads required related state, validates, and persists". AD-13 makes `VALIDATION_RUNTIME_FAILED` and `VALIDATION_TIMEOUT` fail-open eligible. In PostgreSQL, any failed statement (statement timeout, deadlock, serialization failure, driver error) aborts the transaction; later statements fail with 25P02.

**Pair (open-mode collection, link-resolution query times out).**
- Unit A wraps each related-state read in a SAVEPOINT (nested Sequelize transaction). The failure becomes `VALIDATION_RUNTIME_FAILED`, decision `degraded_validation`, persist, commit, success.
- Unit B has no savepoints. The same failure is a `VALIDATION_RUNTIME_FAILED` System Failure by AD-12, decision "persist" by AD-13, and the persist statement then fails: row 5, protocol error, `aborted_after_decision`.

Both obey every AD text. The client sees success in one and `isError` in the other. Row 3 also lists "statement timeout at the AD-8 re-fetch" but not at "reads required related state", so the boundary between "re-fetch" and "related-state read" is undefined.

**Tighten (AD-8).** "Every related-state read that can produce a fail-open-eligible System Failure runs under its own SAVEPOINT so its failure leaves the transaction usable. A failure that invalidates the transaction (connection loss) is row 3 before the decision and row 5 after it. The AD-8 re-fetch phase is exactly the steps that load and lock mutation inputs; every later read is validation."

### A-4 (High) — Write-path evaluation contract: deadline, isolation, buffered-unit discard

AD-11 (deadline, atomic units, "an interrupted unit contributes nothing", isolation of independent units) is scoped to `lint_wiki` (`Binds: OD-3, lint_wiki`). AD-3 defines `VALIDATION_TIMEOUT` as "the server-owned validation deadline", and AD-13 makes it fail-open eligible, but no AD gives a write or `lint_document` deadline (value, start point, whether it covers lock wait).

**Pair (open-mode collection, projected document has a heading-level Error and a link-resolution rule that will fail).**
- Unit A reuses the AD-11 document unit for writes. The unit is buffered, so on timeout or runtime failure it "contributes nothing". The Error found by the earlier rule is discarded, and the result is one System Failure and no known Error. AD-13: `degraded_validation`, persist. The document with a discoverable Error is written.
- Unit B evaluates rule kinds independently, keeps the Error, and applies "Runtime System Failure plus known Error": `rejected`.

Same variation on ordering: Unit A stops at the first runtime failure (fail-fast); Unit B continues other rule kinds and finds the Error. Deadline: Unit A picks 5 s, Unit B relies on `statement_timeout`; a timeout fixture is undefined.

**Tighten (AD-11 or AD-13).** "For writes, all enabled document/link rules run as one unit whose Findings are retained on failure or timeout; a failure of one rule kind yields `VALIDATION_RUNTIME_FAILED` and never skips another rule kind. Only System Failure sources may be discarded, never Findings. A single code-owned write-validation deadline (name it, give a value or a derivation) starts at classification and covers row-lock wait and related-state reads."

### A-5 (High) — No rule-surface applicability

AD-3 lists 12 Error codes with a location class but no surface column. `lint_document`, `lint_wiki`, and writes are not mapped to codes. NFR-22 requires "one observable meaning across every surface", and NFR-24 says "each surface where it applies".

**Pair (create under an enforced collection).**
- Unit A runs on writes exactly the document/link unit (AD-11 first unit): required sections, metadata, structure, `INTERNAL_LINK_TARGET_UNRESOLVED`.
- Unit B also runs `PARENT_DOCUMENT_UNRESOLVED`, `PARENT_COLLECTION_MISMATCH`, `HIERARCHY_CYCLE`, `GLOBAL_INDEX_LINK_MISSING`, and `PUBLISHED_DOCUMENT_MISSING_FROM_STRUCTURE` against the "relationships" in the Projected Document (AD-7 lists `relationships` as part of the projection).

B rejects every create of a published document that has no structure node yet (`PUBLISHED_DOCUMENT_MISSING_FROM_STRUCTURE` is true before persistence) or that lacks a global-index link. A does not.

**Tighten (AD-3).** Add a `Surfaces` column (`document`, `wiki`, `write`) to the code table. Suggested minimal default: writes evaluate the AD-11 document/link unit plus `PARENT_DOCUMENT_UNRESOLVED`; hierarchy, structure, and global-index codes are `lint_wiki` only.

### A-6 (High) — The collection-conflict identifier has no name or wire shape

PRD FR-16 and AD-8/AD-20 require "a stable collection-conflict error identifier" on an `isError` result. Baseline errors carry `id` (e.g. `document_conflict` in `server/errors.ts`), but the MCP `error()` helper in `server/tools/util.ts` serializes only `errToString(err)`.

**Pair.**
- Unit A: `content:[{type:"text", text:"collection_conflict: ..."}]`.
- Unit B: `text: JSON.stringify({id:"document_collection_conflict", message})`.
- Unit C: MCP `structuredContent` or `_meta`.

All carry "a stable identifier"; no client can branch on it across builds.

**Tighten (AD-8/AD-12).** Name the value (`collection_conflict`) and fix its carriage, e.g. "`isError: true` with `content[0].text` equal to JSON `{ "error": { "id": "collection_conflict" } }` and no collection identifiers". Apply the same envelope to every AD-20 protocol error, with `id` absent or `"aborted"` for rows 3 and 5.

### A-7 (High) — Lock set and edit placement

**Pair 1 (locks).** AD-8 says one transaction "locks the update document row". Row 2 requires detecting a collection change "at any point up to commit".
- Create under parent P in enforced X. Unit A takes `FOR SHARE` on P during re-fetch, so a concurrent `documents.move(P -> Y)` blocks until commit and the child is consistent.
- Unit B reads P without a lock at READ COMMITTED. The move commits between B's check and commit; B commits a child validated under X into a parent now in Y.

Both obey AD-8 as written. The same applies to a draft publish (destination collection) and to the classified collection's policy key.

**Pair 2 (edit placement).** AD-8: "Slow conversion ... stays outside, but every assumption is revalidated inside" and "builds the authoritative projection from prepared data".
- Unit A applies the content-dependent edit (`append`, `prepend`, `patch` against stored content) inside the transaction after the row lock, on the re-fetched state.
- Unit B applies it outside on the pre-lock document and only checks `revisionCount` inside.

A concurrent edit is rebased (success) in A and aborts (row 5, conflict) in B. AD-20 lists "conflict other than row 2" without saying whether that conflict is possible.

**Tighten (AD-8).** "Lock set: the update document row (`FOR UPDATE`); for create or publish under a parent, the parent row (`FOR SHARE`). Content-dependent edits are applied inside the transaction, after locking, against the re-fetched state. Only input-only conversion (fragment Markdown to ProseMirror, HTML import, base64 staging) may run outside."

### A-8 (Medium) — "Optional enrichment" and the patch-mode envelope

AD-12/AD-20: "a failure assembling optional enrichments (breadcrumb, share URL, patch echo) omits them".
- The list in parentheses is closed or illustrative? Post-commit steps not in it (`pathToUrl`, `presentDocument`) are not classified.
- In patch mode the baseline builds `[presentDocument, breadcrumb, shareUrl]` in one `Promise.all`; `presentDocument` supplies both the `document` attribute object and the second Markdown block.
- Unit A wraps each item and drops only the failing one. Unit B wraps the group and drops all three, including `document`. Unit C returns the non-patch envelope.
- `validation` placement in patch mode is open: Unit A puts it beside `document` in content block 0; Unit B nests it inside `document`.

**Tighten (AD-12).** "Enrichments are exactly `breadcrumb`, `shareUrl`, and the second patch content block (Markdown echo); each is guarded independently. The `document` object and top-level `validation` in content block 0 are mandatory and are never omitted. `validation` is always a top-level key of the first content block's JSON object in every mode."

### A-9 (Medium) — "Protocol error with baseline content" has no referent

Rows 3 and 5 return "protocol error with baseline content". For failures with a baseline analog (patch target missing, model validation) it is `errToString`. For row-lock or statement timeout, actor-reload failure, persistence timeout, deadlock, and missing re-fetch target there is no baseline text (baseline MCP update has no transaction). Unit A returns the raw DB message; Unit B a fixed generic message. Only the second is safe in general.

**Tighten (AD-20).** "Failures without a baseline analog return a fixed generic message (`The operation could not be completed`), never driver text."

### A-10 (Medium) — Commit-indeterminate, cancellation, and awaited audit

- If COMMIT fails with connection loss or timeout, the outcome is unknown. Unit A reports row 5 and records `aborted_after_decision` although the write may have committed. AD-20 claims to prevent exactly this. No probe or gap declaration exists.
- MCP `notifications/cancelled` or client disconnect: Unit A checks `signal.aborted` before commit and rolls back; Unit B ignores it. Neither is a listed row.
- "Audit ... is initiated immediately after commit" — Unit A awaits the audit insert (bounded by nothing); Unit B fires and forgets. NFR-2 latency and the fixture "audit failure never changes the MCP result" behave differently (a hung audit DB stalls A's response).

**Tighten (AD-20, AD-15).** Declare commit-indeterminate an accepted evidence gap alongside crash-after-commit-before-audit, or require a probe by `validationCorrelationId`. State that cancellation is not honored after the persist decision. State "audit is awaited with a code-owned deadline; timeout is an audit failure".

---

## B. AD-5 / AD-6: sentinel byte-span rules

### B-1 (High) — Malformed versus lexical, span edges, escapes

AD-5 makes root "malformed JSON" fatal but a "lexical defect" inside an identifiable entry a sentinel, and defines lexical defects only by example (duplicate keys, lone surrogates, source number forms). AD-6 hashes "the exact UTF-8 bytes of its JSON value as written in the file (its AD-5 source byte span)".

**Pairs (each is a config where one unit gets a sentinel and another fatal or a different hash).**
1. **Grammar errors inside an entry** (trailing comma, comment, `NaN`, unbalanced brace): Unit A treats any RFC 8259 violation as "malformed root" (fatal). Unit B recovers inside an entry whose key was already identified and makes it a sentinel. Recovery must invent a span end. One byte in one entry either disables the deployment or does not. This is exactly what AD-5 "Prevents".
2. **BOM**: Unit A skips it (Node `readFile` keeps U+FEFF; a custom decoder may skip it); Unit B rejects it. Spans are the same either way, but startup differs.
3. **Invalid UTF-8 bytes inside an entry**: Unit A scans the `Buffer` and hashes raw bytes. Unit B decodes with `toString("utf8")` (U+FFFD substitution) and hashes `Buffer.from(slice)`. The `invalidFingerprint` differs, and B's "byte" offsets are wrong.
4. **Span edges**: does the span include whitespace between the colon and the value or between the value and the comma? Unit A token-tight; Unit B to the delimiter. CRLF versus LF inside a multi-line entry changes the hash (acceptable, but undocumented; git autocrlf changes fingerprints).
5. **Escape-equivalent duplicate keys** (`"activation"` and `"activation"`): Unit A compares raw source strings and sees no duplicate; Unit B compares after unescaping and gets a sentinel. AD-6 unescapes for sorting but AD-5 is silent on duplicate detection.

**Tighten (AD-5, AD-6).**
- "Malformed = any RFC 8259 grammar violation, a leading BOM, or bytes that are not well-formed UTF-8, anywhere: startup-fatal."
- "Lexical defects are exactly (a) a duplicate key after JSON unescaping in an object other than root or `collections`, (b) an unpaired surrogate escape in a key or string, (c) a number outside the integer profile."
- "The decoder operates on raw bytes."
- "The entry span runs from the first byte of the entry's value token to the last byte of the same token inclusive; the key, colon, comma, and surrounding whitespace are excluded; interior bytes (including CRLF and escapes) are hashed verbatim."

### B-2 (High) — Collection-key grammar

"`collections: Record<UUID, CollectionPolicy>`", "unidentifiable keys are startup-fatal", policy classification is "keyed on the post-operation collection's UUID as the baseline resolves it". The accepted UUID text form is not defined.

**Pair.** A key `"3F2504E0-4F89-11D3-9A0C-0305E82C3301"` (valid UUID, uppercase).
- Unit A: exact string match against `collection.id` (lowercase from PostgreSQL). The enforced policy never matches; the collection is silently treated as unconfigured. Enforcement is silently off.
- Unit B: lowercases on load. The policy applies.
- Unit C: treats non-canonical as unidentifiable, fatal.

`policySetFingerprint` sorts by "collection UUID" and includes it, so the fingerprint differs too.

**Tighten (AD-5).** "A collection key must match the lowercase canonical 8-4-4-4-12 form; any other key is unidentifiable (startup-fatal). Duplicate detection compares unescaped key strings."

### B-3 (Medium) — Defaults and `policyFingerprint`

AD-6 hashes `{schemaVersion, activation, runtimeFailureMode, rules}`. `runtimeFailureMode` default is materialized (explicit), but rule-parameter defaults from the AD-3 registry are not addressed. Unit A hashes as parsed (omitted parameter stays omitted); Unit B applies registry defaults first. Two semantically equal configs get different fingerprints in A. In B, a later build that changes a default silently changes behavior under an unchanged fingerprint.

**Tighten (AD-6).** "The fingerprint preimage is the registry-normalized form: all defaults materialized."

### B-4 (Medium) — Startup reporting of sentinels

AD-19: "Startup reports only config status, activation counts, and a `policySetFingerprint`". NFR-16 needs invalid configuration observable "before or at the first affected operation ... enough non-secret context to locate the configuration scope". AD-6 says a sentinel "exposes only that hash, stable code, and schema path". Unit A follows AD-19 literally (counts only); Unit B logs `collectionId`, `invalidFingerprint`, code, and path for each sentinel. Also: the schema-path format (JSON Pointer versus dotted versus segments) is undefined.

**Tighten (AD-19).** "Startup additionally logs, per sentinel, `collectionId`, `POLICY_CONFIGURATION_INVALID`, the JSON-Pointer path of the first defect, and `invalidFingerprint`; and an `invalidCount`."

---

## C. AD-12 result algebra, sentinels, AD-4 ordering

Checked and found closed: default-scope `incomplete` versus `failed` with a sentinel and any other unit; a scope of only sentinels is `failed`; `not_evaluated` only when no valid policy and no readable sentinel; sentinel completes no unit; AD-11 timeout combined with a sentinel adds `VALIDATION_TIMEOUT` and derives the same state (the sentinel is not a unit). The residual pairs are below.

### C-1 (High) — "Actor-readable" is undefined for document-membership-only actors

C-3 (read) says "an actor-readable invalid-policy sentinel" and "an unreadable sentinel contributes nothing". C-5 (write) uses `can(actor,"read",collection)` for identity omission. Baseline lets an actor read a single document by document membership without collection read. AD-12 read-side requires `EvaluatedScope.document.collectionId` and `PolicyIdentity.collectionId` to be "authorized IDs only".

**Pair (actor has document membership on D in enforced collection X; no read on X).**
- Unit A defines policy/sentinel visibility by `can(read, X)`. `lint_document(D)` is `not_evaluated`, even though D is readable and would be validated on write. If X were a sentinel: also `not_evaluated`, hiding the broken configuration that C-3 was meant to expose.
- Unit B (FR-4: "document the actor may read") evaluates D under X's policy, returns `complete`, and then must fill `scope.collectionId` and `policies[]`: it fills them (document presenters expose `collectionId`); Unit C omits them and violates the non-optional shape.

For `lint_wiki` default scope: do D's documents count in a collection the actor cannot read? Undefined.

**Tighten (AD-12).** "Policy and sentinel visibility test is `can(actor,'read',collection)`. `lint_document` evaluates under the document's collection policy whenever the actor can read the document; `collectionId` in `EvaluatedScope`, `policies`, and scope locations is present only when `can(actor,'read',collection)`, absent otherwise (field optional). A sentinel in an unreadable collection yields the generic System Failure without `collectionId` for a document reader. `lint_wiki` default scope contains only collections the actor can read." Also state the `lint_document` sentinel scope shape: `{kind:"document", documentId, evaluatedDocumentCount:0, evaluatedLinkCount:0}` (there is no `completedChecks` for that kind).

### C-2 (High) — AD-4 sort keys not fully specified

AD-4: "collection ID, document ID, line, column, structural path, location-kind rank, issue code, rule-local ordinal".

**Pairs.**
- **Location-kind rank**: values undefined. Unit A ranks `text < document < relationship < scope` (declaration order); Unit B alphabetically. Same document, both without line: `REQUIRED_METADATA_FIELD_MISSING` (document) versus `PARENT_DOCUMENT_UNRESOLVED` (relationship) sort differently, and differently again if rank is skipped and code decides.
- **Path comparison**: segments are "string/integer". Unit A compares segment-wise (integers numerically, strings bytewise, integer before string, shorter prefix first); Unit B compares `JSON.stringify(path)` bytewise (`[10]` < `[9]`).
- **Rule-local ordinal**: assigned by document traversal order in A, by rule enumeration order in B.

**Tighten (AD-4).** Name the rank (`text=0, document=1, relationship=2, scope=3`). Define path comparison as segment-wise, integers before strings, integers numerically, strings bytewise, shorter prefix first. Define the ordinal as the zero-based index of the emission in document order within one rule kind.

### C-3 (High) — Create-time Findings need a `documentId` that does not exist

AD-4 locations require `documentId` for `text`, `document`, and `relationship`. On `create_document` no document exists. `Document.build` assigns a UUIDv4 immediately (`@Default(DataType.UUIDV4)` in `server/models/base/IdModel.ts`).
- Unit A uses the built projection's `id` in all Finding locations and in the `Event.documentId` column. It is a would-be identifier that identifies nothing after rollback, and equals the persisted ID only if the create commits.
- Unit B uses `null`/omits `documentId`, breaking the AD-4 shape and sort key.
- Unit C uses the parent's ID.

`Event.documentId` has no DB-level FK (verified: `20180808061353-cleanup.js` adds it without `references`), so an invented ID inserts cleanly and pollutes audit queries.

**Tighten (AD-4/AD-7).** "For create, the projection's pre-generated document ID is used in locations and, on success, becomes the persisted ID; on rejection it appears in locations only and never in an Event column."

### C-4 (Medium) — "Required unit", vacuous checks, unit order, partial counts

AD-11: "every document ..., then each collection's hierarchy check, then its global-index check, all in AD-4 key order". AD-12: `completedChecks` is an "ordered subset"; `complete` = "every required unit ran"; "counts include completed AD-11 units only".
- **Vacuous checks**: a collection with zero documents (no document unit ran), or a policy with no global index or no hierarchy rules. Unit A lists `documents`, `hierarchy`, `global_index` as complete (vacuously); Unit B lists only checks that ran. `complete` differs.
- **Order**: Unit A runs all hierarchy checks, then all global-index checks; Unit B runs (hierarchy, global) per collection. "Longest fully completed prefix" after an injected deadline differs.
- **Partial documents**: timeout mid-collection: Unit A counts completed document units in `evaluatedDocumentCount` while omitting `documents` from `completedChecks`; Unit B counts only fully completed collections.

**Tighten (AD-11/AD-12).** "A check is required iff at least one enabled rule kind belongs to it; a required check with zero inputs completes vacuously and is listed. Units run: all document units in key order, then for each collection in key order hierarchy then global-index. Counts include completed document units even when `documents` is not yet listed."

### C-5 (Medium) — Locations of run-level System Failures

AD-3 gives `scope` as the location class for `VALIDATION_TIMEOUT`, `VALIDATION_RESOURCE_LIMIT_EXCEEDED`, `VALIDATION_RUNTIME_FAILED`, but AD-4/AD-12 fix `scopeKind`/`collectionId` only for the sentinel failure. Unit A locates a default-scope timeout at `scope{configured_collections}`; Unit B at `scope{collection, id-of-interrupted-collection}`. The sort order changes with it.

AD-9: "GLOBAL_INDEX_LINK_MISSING ... otherwise that check is incomplete with a generic safe System Failure." No code is named. Unit A: `VALIDATION_RUNTIME_FAILED`; Unit B: `POLICY_CONFIGURATION_INVALID`. This also makes `complete: false` permanent for an actor who cannot read the configured index document.

**Tighten (AD-12/AD-9).** Fix the mapping: run-level failures use `scope{scopeKind of the request}` with `collectionId` only for a collection-scoped request; a check-level failure uses `scope{collection, collectionId}`; the unprovable global-index check is `VALIDATION_RUNTIME_FAILED`.

### C-6 (Medium) — Column unit and title in the coordinate system

AD-4: "Line/column are one-based coordinates in canonical Outline Markdown." Undefined: the column unit (UTF-16 code unit, code point, byte); whether the title line is included. Baseline `DocumentHelper.toMarkdown` defaults to `includeTitle: true` (prepends `# title`), while `documentCreator` and stored `text` use `includeTitle: false`. Unit A lints with title so line 1 is the title; Unit B without, so lines shift by 2 between `lint_document` and write enforcement of the same content. Also `commonMark` default and signed URLs are unpinned.

**Tighten (AD-4/AD-10).** "Coordinates are over the exact string `toMarkdown(doc, { includeTitle: false })` (no `commonMark`, no signed URLs); columns count Unicode code points; `\n` is the only line terminator."

### C-7 (Medium) — `degraded_validation`, `complete` for rejected writes, order of `scope.collections`

- AD-13: "degraded_validation dominates Warnings and returns the triggering safe System Failure." Unit A: `warnings` still present. Unit B: `warnings: []`. Audit `counts.warnings` follows.
- AD-14 `complete` for write summaries is defined only for rejections caused by policy configuration (`false`) and aborts (`false`). Rejected-by-Errors: Unit A `true` (evaluation completed), Unit B `false` (write did not complete).
- `scope.collections` array order is fixed nowhere (AD-4 sorts only the three issue arrays; AD-12 sorts `policies`).

**Tighten.** "`degraded_validation` returns the Warnings found. Write-summary `complete` = validation ran to completion with no System Failure. `configured_collections.collections` is sorted by collection ID bytewise."

---

## D. AD-14 / AD-15 audit

### D-1 (High) — Audit Event row population and enqueue

AD-14 fixes `data` and says "Safe document/collection IDs use existing Event columns". Unpinned: `actorId`, `teamId`, `ip`, `authType`, `userId`, `modelId`, and whether the insert triggers the `@AfterSave enqueue` hook (`server/models/Event.ts`) that adds the Event to `globalEventQueue()`.
- Baseline `events.list` filters `actorId != null`. Unit A omits `actorId` (rows invisible to `auditWikiLint`); Unit B sets it.
- Unit A uses default `Event.create`: every audit row is enqueued, reaches every `"*"` processor (the webhooks plugin's `WebhookProcessor.applicableEvents = ["*"]`), and `DeliverWebhookTask` logs `did not handle wikiLint.*` for subscribed teams. Unit B suppresses hooks or inserts raw.
- `Event.authType` versus `data.credentialAuthType` and `ip` versus intent `sourceIp` are two owners of the same fact.

**Tighten (AD-14).** "Audit Events are created with hooks disabled (not enqueued). Columns: `teamId` = actor team, `actorId` = authenticated actor, `ip` = source IP, `authType` = the command context value, `userId`/`modelId` = null, `documentId`/`collectionId` per the scope rule."

### D-2 (Medium) — Read summaries

- `outcome` for reads: `clean | findings | not_evaluated | incomplete | failed`. `findings` is undefined. Unit A maps warnings-only complete results to `findings`; Unit B (matching AD-12 `clean = errors.length===0`) maps them to `clean`.
- AD-14 "Policy fields" defines presence only for `write_validation`. For `wikiLint.wiki` over `configured_collections` there is no single fingerprint; Unit A omits; Unit B puts `policySetFingerprint` into `policyFingerprint` (same `sha256:` format, different meaning).
- Read invocations that end in `isError` (invalid call, authorization denial): FR-19 says "every invocation". Unit A records nothing; Unit B records `failed` with the caller-supplied `documentId` in the Event column.
- `durationMs` start and stop are undefined for every operation (queue wait, transaction time).

**Tighten (AD-14).** Add a state to outcome table (`complete & clean -> clean`, `complete & !clean -> findings`, others one-to-one). Read summaries carry policy fields only when the scope is a single collection with a valid policy. Read `isError` results record no summary. `durationMs` = monotonic time from tool-handler entry to result assembly.

### D-3 (Medium) — `validationCorrelationId` placement

"Successful baseline mutation Event data carries only `validationCorrelationId`". One MCP write emits several Events in the transaction (`documents.create` plus `documents.publish`; update plus publish). Unit A stamps all of them via a context default; Unit B only the terminal one. Correlation queries and the "only" reading (replace versus add to existing `data`) also differ.

**Tighten (AD-14).** "Every Event created by the writer inside the enforced transaction carries `data: { validationCorrelationId }` merged with any existing baseline keys."

### D-4 (Medium) — Resource limits on writes

AD-13 makes `VALIDATION_RESOURCE_LIMIT_EXCEEDED` fail-open eligible. AD-16 caps (1 MiB per document, 100,000 link references) are content sizes an actor controls; AD-16 is scoped to snapshot construction and does not say whether it applies to writes. Unit A applies the caps to writes: in an `open` collection a client can force `degraded_validation` (unvalidated persist) by exceeding a cap. Unit B does not apply them.

**Tighten (AD-13/AD-16).** State whether caps apply to writes and that a content-size cap violation on a write is never fail-open eligible (or does not apply).

---

## E. Low

- **E-1.** `POLICY_SCHEMA_VERSION_UNSUPPORTED` is fatal at root and entries carry no version, so it cannot appear in any result. State "startup-log only".
- **E-2.** An actor holding `audit` and `auditWikiLint`: `events.list` returns union (A) or audit-only (B). Also, adding the names to shared `EventHelper.AUDIT_EVENTS` (client-shared, Zod enum) widens the full-`audit` view. Say which.
- **E-3.** When identity is omitted for an unreadable actor, a sentinel rejection and an AD-7 mismatch rejection are indistinguishable (same status, same code). Accepted by C-5; state it so no client infers meaning from field absence.

---

## Appendix A — Suggested AD-20 replacement (phase list)

An attempt passes these phases; the first failure selects the row by *phase*, not by cause. Named causes are illustrative.

| Phase | Content | Failure -> row |
| --- | --- | --- |
| P0 | Handler pre-write steps (authentication, input schema, lookup, handler authorization) | 1 |
| P1 | Classification (valid `enforced` / sentinel / other). Sentinel goes directly to P6 with a modeled rejection | none |
| P2 | Outside-transaction preparation: input-only conversion, HTML import, media staging. HTML worker order: reload actor, re-authorize destination, collection-change check, fingerprint comparison, then conversion | any failure 3 (fingerprint mismatch 4; collection change 2) |
| P3 | Transaction: re-fetch and lock mutation inputs, re-authorize (before comparing collection), compare post-operation collection | denial, missing target, lock/statement timeout, connection loss 3; collection differs 2 |
| P4 | Projection from locked state (content-dependent edits, template substitution, publish/unpublish state); baseline transformation checks | 3 |
| P5 | Evaluation: related-state reads under savepoints; any failure becomes a System Failure | matrix |
| P6 | AD-13 decision | `rejected` 4; else continue |
| P7 | Persistence: model validation, unpublish precondition, unchanged-update, DB error/timeout | 5 |
| P8 | Commit | success 6; COMMIT error 5 (indeterminate gap declared) |
| Post | Audit initiated (awaited under deadline), then optional enrichments | none (never changes the result) |

## Appendix B — Coverage

Concentration items and outcome: AD-20 rows for create/update/HTML worker (A-1, A-2, A-3, A-9, A-10); meaning of before/after AD-13 decision (A-2, A-3, A-4); optional enrichment (A-8); which failures are protocol errors with baseline content (A-9); sentinel byte spans, BOM, CRLF, whitespace, escapes (B-1, B-2); default-scope sentinel algebra and AD-4 ordering (closed except C-1, C-2, C-4, C-5, C-7); identity omission and classification detectability (C-1, E-3); AD-11 timeout with sentinels (closed except C-4, C-5); AD-14 aborted shapes (fields closed; residual C-7, D-2, A-1).
