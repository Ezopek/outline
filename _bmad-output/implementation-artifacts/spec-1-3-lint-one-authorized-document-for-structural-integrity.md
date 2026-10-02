---
title: 'Story 1.3: Lint One Authorized Document for Structural Integrity'
type: 'feature'
created: '2026-10-02'
status: 'done'
baseline_revision: 'e7b2cc4a0012fa0714ccaf9e8ff690af8235f3f3'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The core (1.1) and the startup policy set (1.2) exist, but nothing lints a stored document. Agents need one internal `lint_document` orchestration: it authorizes the target, reads one point-in-time snapshot of it under a server-owned deadline, and evaluates it under its collection policy. Every non-clean path must stay modeled: unconfigured, invalid policy, snapshot failure, timeout, and rule failure. Denials must stay indistinguishable from missing documents.

**Approach:** Add four pieces:
- a monotonic `Deadline` with a code-owned `SET LOCAL` floor;
- a DB adapter with two steps: the pre-snapshot authorization (a short read-only transaction) and the snapshot (one `REPEATABLE READ`, explicitly read-only transaction that re-reads the row and serializes canonical Markdown);
- an application shell `lintDocument`, which classifies the policy, gates identity on collection readability, evaluates the document unit, and builds the AD-12 result;
- `server/tools/wikiLint.ts`, which exports the D-9 input schema and a tool handler that maps outcomes to MCP results.

Registration on `/mcp` stays with Story 1.10.

## Boundaries & Constraints

**Always:**
- Use the deadline `LINT_DOCUMENT_DEADLINE_MS = 9000`, created at tool-handler entry on an injectable monotonic clock (default `performance.now`).
- Use the floor `SET_LOCAL_FLOOR_MS = 100`. It is provisional until Story 3.3.
- Before every DB batch, issue `SET LOCAL lock_timeout` and `statement_timeout`, both set to the floored integer remainder. A remainder below the floor refuses the batch, so no 0 or negative value is ever sent.
- Every transaction starts with `SET TRANSACTION READ ONLY`. Never use Sequelize `readOnly` (it selects the replica pool); use the primary `sequelize` only.
- Identity is gated only on `can(actor, "read", collection)`, evaluated as a tri-state (Design Notes). When that check does not hold, `collectionId` is absent from the scope, every location, and `policies`.
- Evaluate the document-surface rule kinds (derived from the registry) as one unit. Hierarchy and global-index kinds never run here.
- Results come only from `buildReadOnlyResult`. The modeled result is the JSON of the first text block, with no `isError`.
- Generic fixtures: synthetic headings and fields. Collection IDs come from factories, never pilot IDs.

**Never:**
- Out of scope:
  - registering `lint_document` on `/mcp`, gating, annotations, title, or discovery (1.10);
  - link extraction or resolution, and counting links (1.4);
  - `lint_wiki` (1.5–1.7);
  - audit Events, `requestId`, or `invocationId` (1.8);
  - write enforcement (Epic 2).
- Never read `Document.text`, `documentStructure`, or a replica, and never mutate state.
- No raw error message, configuration, or JSON-Pointer path in any result or error text.
- No edits to `server/routes/mcp/**`, `server/editor/**`, `shared/editor/**`, or `sprint-status.yaml`.

## I/O & Edge-Case Matrix

R = collection readability (`readable` / `unreadable` / `unestablished`). "+cid" means `collectionId` is present only when R is `readable`. `docScope` = `{ scopeKind: "document", documentId }`.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Missing, denied, or unresolvable `id` | unknown UUID, unmatched slug, another team, or a private doc without access | identical `isError` text `Authorization error` | no result |
| Pre-snapshot infrastructure failure | lookup or `read` check throws, stalls past its timeout, or starts below the floor | `isError` text `The operation could not be completed` | no result |
| Bad input | `{}` or `{ id: 1 }` | SDK 1.29.0 `isError` result (not a JSON-RPC error) | — |
| Null collection or no entry | draft without collection, or an unconfigured collection | `not_evaluated`, `reason`, zero-count scope (+cid), `policies: []` | — |
| Sentinel, R = readable | invalid entry | `failed`; one `POLICY_CONFIGURATION_INVALID` at `{ scopeKind: "collection", collectionId }`; invalid identity; zero-count scope with cid | no snapshot |
| Sentinel, R = unreadable | document-only reader | `failed`; `POLICY_CONFIGURATION_INVALID` at `docScope`; no cid; `policies: []` | no snapshot |
| Sentinel, R = unestablished | readability check failed | `failed`; `VALIDATION_RUNTIME_FAILED` at `docScope`; no cid; `policies: []` | no snapshot |
| Valid, no document-surface kind | only hierarchy or global-index kinds | `complete`, `clean`, zero counts, identity (+cid) | no snapshot |
| Valid, all kinds ran | structure kinds only | `complete`; Findings; `evaluatedDocumentCount: 1`, `evaluatedLinkCount: 0`; identity (+cid) | — |
| A kind failed | `internal_links` enabled, or a structure kind in `failedKinds` | `failed`; Findings kept; exactly one `VALIDATION_RUNTIME_FAILED` at `docScope` (+cid); counts 0 | — |
| Snapshot floor or expiry | remainder below the floor before the batch, a PG timeout, or the deadline expired by the end of construction | `failed`; no Findings; zero counts; `VALIDATION_TIMEOUT` at `docScope` (never cid); identity (+cid) | — |
| Snapshot or canonicalization failure | row deleted, or moved since the pre-snapshot steps; query error; CR in Markdown | the same, with `VALIDATION_RUNTIME_FAILED` | — |
| Unmodellable failure | an unexpected throw anywhere else | `isError` with the fixed message | — |

</intent-contract>

## Code Map

- `server/wikiLint/core/result.ts:316` -- `buildReadOnlyResult({ requiredUnits, completedUnits, items, scope, policies } | { notEvaluated: true, … })`. It derives the state, sorts, and re-validates surfaces: a `document` scope accepts `document` and `all` codes only.
- `server/wikiLint/core/registry.ts` -- `createSystemFailure(code, ScopeLocation)`, `getIssueDefinition(code).surfaces`, `RULE_REGISTRY[kind].code`, and `RuleConfig`.
  - Document-surface kinds = the 7 structure kinds plus `internal_links`.
- `server/wikiLint/core/documentRules.ts:325` -- `evaluateDocumentRules({ documentId, syntax, rules })` → `{ findings, failedKinds }`. It throws on any non-structure kind, so pass structure kinds only.
- `server/wikiLint/adapters/canonicalSyntax.ts` -- `toCanonicalMarkdown(Document)` uses `content`, else `state`. It throws `CanonicalMarkdownError` when both are null and never reads `text`. `parseCanonicalMarkdown(md)` throws on CR.
- `server/wikiLint/adapters/policyConfig.ts:145` -- `getPolicySet()` (memoized, worker-safe). `PolicySetEntry` is valid `{ collectionId, status, policySchemaVersion, policyFingerprint, policy }` or invalid `{ collectionId, status, invalidFingerprint }`.
  - Build the AD-12 identity without `policy`.
- `server/models/Document.ts:907` -- `findByPk(id, { userId, includeContent:false, includeViews:false, transaction })`. It resolves a UUID or a `SLUG_URL_REGEX` urlId, and returns null for any other string, even with `rejectOnEmpty`.
  - It uses `withDrafts` (no default scope), so drafts and archived documents resolve. Paranoid lookups exclude deleted documents.
  - Membership includes, including a `separate: true` group query, inherit `transaction`.
- `server/models/Document.ts:125` -- the default scope filters `publishedAt != null`, so the snapshot re-read must use `Document.unscoped()` with `paranoid: false` and explicit attributes `id, collectionId, deletedAt, content, state`.
  - `sequelize-strict-attributes` throws on access to an unloaded attribute.
- `server/models/Collection.ts:662` -- `findByPk(id, { userId, transaction })` loads membership for `can(actor, "read", collection)` (`server/policies/collection.ts:34`: admin, member, or non-private).
- `server/policies/document.ts:21` -- `read` = same team AND (document membership OR own draft OR collection `readDocument`).
- `server/storage/database.ts` -- the primary `sequelize`.
  - `isQueryCanceledError` (57014) is exported; add 55P03 `lock_not_available` locally.
  - In API worker processes `sequelize.transaction` is wrapped to issue a baseline `SET LOCAL statement_timeout` first (`applyStatementTimeoutToTransactions`); later `SET LOCAL`s override it.
  - Sequelize Postgres: `START TRANSACTION`, then `SET TRANSACTION ISOLATION LEVEL …`. Model finders and `COMMIT` go through `sequelize.query(sql, { transaction })`, so a `vi.spyOn(sequelize, "query")` captures the full statement sequence.
- `server/errors.ts:32` -- `AuthorizationError()`, message `Authorization error`.
- `server/tools/util.ts` -- `success(data)`, `error(err)`, `getActorFromContext(ctx)` (user at `authInfo.extra.user`). `server/routes/mcp/index.ts:162` shows the production `authInfo` shape.
- `node_modules/@modelcontextprotocol/sdk` 1.29.0:
  - `McpServer` validates input and turns a validation failure or a handler throw into `{ isError: true }` with the raw message, so the handler must catch everything itself;
  - `InMemoryTransport.createLinkedPair()`'s `send(msg, { authInfo })` forwards `authInfo`;
  - `Client` from `client/index.js`.
- `server/test/factories.ts` (`buildUser`, `buildAdmin`, `buildCollection`, `buildDocument`, `buildTeam`), `server/test/McpHelper.ts` (`buildOAuthUser`, `mcpRequest`, `mcpHeaders`, `parseMcpResponse`), `server/test/support.ts` (`getTestServer`).
- `.env.test` -- the DB tests need Postgres at `127.0.0.1:5432/outline-test`, migrated with `NODE_ENV=test yarn sequelize db:migrate`. Redis is mocked.

## Tasks & Acceptance

**Execution:**
- `server/wikiLint/application/deadline.ts` -- add:
  - `MonotonicClock = () => number` and its default;
  - `SET_LOCAL_FLOOR_MS = 100`, marked provisional;
  - `DeadlineFloorError`;
  - `class Deadline(budgetMs, clock?)` with `remainingMs()`, `expired()` (`≤ 0`), and `batchTimeoutMs()`, which returns the floored remainder or throws `DeadlineFloorError` below the floor.
- `server/wikiLint/core/documentRules.ts` -- export `documentSurfaceRules(rules)`: the rules whose registry code's surface is `document`, in configured order.
- `server/wikiLint/adapters/documentReader.ts` -- add the private helpers `readOnlyTransaction(options, run)` (managed, `SET TRANSACTION READ ONLY` first) and `boundBatch(transaction, deadline)` (the two `SET LOCAL`s), plus:
  - `authorizeLintTarget({ id, actor, deadline })` → `LintTarget | null`, where `LintTarget = { documentId, collectionId: string | null, collectionReadability }`:
    - null for missing or denied;
    - the readability step is caught as a whole and yields `unestablished`;
    - `collectionId` null gives `unreadable`;
    - lookup errors propagate.
  - `readDocumentSnapshot({ documentId, collectionId, deadline })` → canonical Markdown. It runs in a `REPEATABLE READ` read-only transaction with one bounded re-read batch. A missing or deleted row, or a different `collectionId`, throws a fixed-message error.
  - `isDatabaseTimeout(error)`: 57014 or 55P03.
- `server/wikiLint/application/lintDocument.ts` -- add:
  - `LINT_DOCUMENT_DEADLINE_MS = 9000`;
  - the `LintDocumentReader` seam (default: the adapter);
  - `LintDocumentDependencies { policySet?, clock?, reader? }`;
  - `lintDocument({ id, actor, policySet, deadline, reader })` → `{ kind: "result", result } | { kind: "denied" } | { kind: "failed" }`, implementing the I/O matrix and Design Notes.
- `server/tools/wikiLint.ts` -- export `lintDocumentInputSchema` (`{ id: z.string().describe(generic text naming a UUID or a URL identifier optionally prefixed by a title slug) }`) and `lintDocumentTool(input, context, dependencies = {})`.
  - The handler creates the deadline first, catches every throw, and maps the outcomes: `result` → `success(result)`, `denied` → `error(AuthorizationError())`, `failed` → an `isError` text `The operation could not be completed`.
  - It does not register the tool.
- Collocated tests:
  - `application/deadline.test.ts` -- floor, expiry, and flooring.
  - `core/documentRules.test.ts` -- the selector.
  - `application/lintDocument.test.ts` -- a fake reader and fixed clock; every matrix row at the application level, including a `vi.mock`ed `evaluateDocumentRules` reporting two failed kinds → one System Failure.
  - `adapters/documentReader.test.ts` (DB) -- statement sequences through a `sequelize.query` spy: isolation, `READ ONLY` first, `SET LOCAL` values equal to the injected remainder, `COMMIT`, and no `readOnly` option. Also:
    - drafts and archived documents;
    - content wins over a stale `text`;
    - a re-read after soft delete or move throws;
    - a `LOCK TABLE documents IN ACCESS EXCLUSIVE MODE` held by another transaction makes the snapshot reject with `isDatabaseTimeout` (400 ms budget), and the pre-snapshot lookup reject.
  - `server/tools/wikiLint.test.ts` (DB, end-to-end) -- an in-test `McpServer` with `lintDocumentInputSchema` over an `InMemoryTransport` whose client `send` injects `authInfo.extra.user`, with a per-test policy set built by `buildPolicySet` over the factory collection IDs (`createHash` sha256). It covers the acceptance criteria below, and a TestServer `/mcp` `tools/list` with Read/Write/Create scopes that lists no `lint_document`.

**Acceptance Criteria:**
- Given the in-test server, when `tools/list` runs, then `lint_document`'s `inputSchema` has exactly the property `id` (type string, generic description) and `required: ["id"]`. Given extra arguments (`policy`, `activation`, `collectionId`, `deadlineMs`), when it is called, then the first text block is byte-identical to the call with `{ id }` alone.
- Given a draft (with a collection) and an archived document in a valid read-only collection, when linted, then each is evaluated.
- Given a document whose `content` has the required section but whose `text` column does not, when linted, then no `REQUIRED_SECTION_MISSING` is emitted.
- Given a missing UUID, an unmatched slug, another team's document, and a private-collection document the actor cannot read, when linted, then the four responses are byte-identical `isError` results. Given `{ id: 1 }`, then the response is an `isError` result and not a JSON-RPC error.
- Given a document-only reader of a valid-policy collection, when linted, then Findings are returned, the serialized result contains no collection UUID, and `policies` is `[]`.
- Given `Collection.findByPk` made to reject, when the collection is valid, then evaluation completes without `collectionId`; when it is a sentinel, then the result is the generic `VALIDATION_RUNTIME_FAILED` at document scope.
- Given any lint call, when the `sequelize.query` spy is inspected, then:
  - it shows no `INSERT`, `UPDATE`, or `DELETE`;
  - the document's `updatedAt` and `revisionCount` and the Event count are unchanged.
- Given identical inputs, when linted twice, then the outputs are byte-equal.

## Spec Change Log

## Review Triage Log

### 2026-10-02 — Review pass
- verdicts: 38 findings — high 0, medium 1, low 19, false 18, maybe-false 0
- findings:
  - `[false]` `[reject]` **Blind Hunter:** `boundBatch` can raise the API worker's baseline `statement_timeout` when `REQUEST_TIMEOUT` is below about 9.5 s, so queries outlive the HTTP socket. — AD-11 mandates the code-owned 9 s deadline and its `SET LOCAL`s precisely because the baseline value "is fixed per process and absent in all-in-one deployments". The tool is unregistered until Story 1.10, which comes after Story 1.7's `/mcp` socket override of at least 65 s, so the socket cannot cut a 9 s lint.
  - `[low]` `[reject]` **Blind Hunter:** one `SET LOCAL` pair covers a batch of several statements (the document SELECT plus `separate: true` group queries), so the pre-snapshot step can overrun the remainder up to about 3×. — Real (the timeouts are per statement), but it needs a database slow enough for several consecutive statements to each stall near the full remainder. The outcome stays fail-closed (fixed message or `VALIDATION_TIMEOUT` at the next floor check). The fix needs per-statement hooks inside Sequelize's include machinery.
  - `[low]` `[reject]` **Blind Hunter:** pool connection acquisition (`acquire: 30000`) is not bounded by the deadline. — Real under pool saturation, and every baseline MCP tool shares the exposure. Classification stays correct (`VALIDATION_TIMEOUT` via `deadline.expired()`, or the fixed message), and the fix needs racing acquisition against the remainder, which is more than a direct correction.
  - `[low]` `[reject]` **Blind Hunter:** bare `catch` blocks swallow every failure with no operator log. — Real diagnosability gap. The spec forbids raw error content in outputs, and a safe minimized diagnostic (error class and phase only, per the spine's logging convention) is a new design, not a direct correction. Recorded as a residual risk.
  - `[low]` `[reject]` **Blind Hunter:** a `DocumentSnapshotError` found after expiry is reported as `VALIDATION_TIMEOUT` rather than AC2's `VALIDATION_RUNTIME_FAILED`. — With `statement_timeout` set to the remainder, the re-read can only return after expiry in a sub-millisecond window. AC3 literally assigns expiry during construction to `VALIDATION_TIMEOUT`, and the Design Notes fix that precedence.
  - `[false]` `[reject]` **Blind Hunter:** `documentSurfaceRules` filters on `surfaces === "document"`, so a future `"all"` rule code would be dropped. — No rule code has any surface other than `document` or `wiki`. The closed registry is pinned by the literal 19-row deep-equal in `registry.test.ts`, so the drift needs a registry change that already breaks that test.
  - `[low]` `[patch]` **Blind Hunter:** no test fails the collection-readability step with a real Postgres error that aborts the pre-snapshot transaction. — Probed first: a `pg_sleep` cancelled by `statement_timeout` inside the step yields `unestablished` with the document target intact, and the later `COMMIT` on the aborted transaction resolves (Postgres answers `ROLLBACK`). Patched: an adapter test pins exactly that.
  - `[false]` `[reject]` **Blind Hunter:** in API workers the wrapper's `SET LOCAL statement_timeout` precedes `SET TRANSACTION READ ONLY`, so the read-only guarantee is unverified in production. — Probed on PostgreSQL 14: after `START`, `ISOLATION LEVEL REPEATABLE READ`, and `SET LOCAL statement_timeout = 9500`, the `SET TRANSACTION READ ONLY` is accepted, `transaction_read_only` is `on`, a later `SET LOCAL` overrides to `1234ms`, and a write fails with "read-only transaction". Only the spec's word "first" is inexact.
  - `[low]` `[reject]` **Blind Hunter:** "mutates nothing" covers one path, and its regex misses `WITH`, `MERGE`, `TRUNCATE`, and `FOR UPDATE`. — Every path issues only statements inside the two transactions whose complete statement sequences, including `READ ONLY`, the adapter tests pin, and Postgres rejects any write there. Widening the test to every path would only repeat that structural guarantee.
  - `[low]` `[patch]` **Blind Hunter:** nothing asserts that the collection SELECT never reads `documentStructure`. — Patched: the statement-sequence test asserts the collection SELECT contains no `"documentStructure"`.
  - `[low]` `[patch]` **Blind Hunter:** the identical-denial test omits a trashed document and a non-UUID, non-slug string. — Verified correct behavior (paranoid `findByPk` gives null; an unmatched string returns null without a query). Patched: both join the compared identifiers, and all six responses are byte-identical `Authorization error` results.
  - `[low]` `[patch]` **Blind Hunter:** no application test shows that a failed snapshot hides identity for `unreadable` or `unestablished` readers. — The code is correct (`zeroScope` and `policies` derive from the visible collection). Patched: an `it.each` over both readabilities asserts no `collectionId`, `policies: []`, and no collection UUID in the serialized result.
  - `[low]` `[reject]` **Blind Hunter:** a below-floor batch is refused only after a transaction was opened (wasted `START`, `READ ONLY`, `ROLLBACK`). — Real but negligible: a few round trips when the deadline is already nearly gone. The fix adds a pre-check branch.
  - `[low]` `[reject]` **Blind Hunter:** the snapshot also loads `state` when `content` is present. — Real extra bytes. Performance is evidenced in Epic 3 (AD-17), the baseline's `stateIfContentEmpty` alias is module-private (`Document.ts:94`), and the fix needs an export or a duplicated literal.
  - `[low]` `[reject]` **Blind Hunter:** authorization and the snapshot are separate transactions, and the snapshot does not re-check `read`. — This is AD-10's defined sequence: the pre-snapshot steps complete first, and the snapshot re-reads only collection and deletion state. The revocation window is tiny, and the Findings carry only codes and positions. Re-checking inside the snapshot changes the architecture-defined ordering.
  - `[low]` `[reject]` **Edge Case Hunter:** a multi-statement batch shares one per-statement timeout. — Same root cause as the Blind Hunter multi-statement row; rejected with it.
  - `[false]` `[reject]` **Edge Case Hunter:** `REQUEST_TIMEOUT` below about 9.5 s is overridden by the 9000 ms batch timeout. — Same as the first Blind Hunter row: AD-11 mandates it, and the tool is unreachable before the `/mcp` socket override.
  - `[low]` `[reject]` **Edge Case Hunter:** a saturated pool waits up to the 30 s acquire timeout. — Same root cause as the Blind Hunter pool row; rejected with it.
  - `[low]` `[reject]` **Edge Case Hunter:** read access revoked between authorization and snapshot. — Same root cause as the Blind Hunter revocation row; rejected with it.
  - `[false]` `[reject]` **Edge Case Hunter:** an absent `authInfo` user yields a `TypeError` and the fixed message instead of an authorization error. — Unreachable: the `/mcp` route's `auth()` middleware rejects unauthenticated requests with 401 before any tool runs (`server/routes/mcp/index.ts:142`), which is the baseline behavior AC9 keeps.
  - `[false]` `[reject]` **Edge Case Hunter:** evaluation finishing after the deadline is still reported complete. — AD-11: deadlines are checked between units and a synchronous parse is not preempted; a finished unit is retained.
  - `[false]` `[reject]` **Edge Case Hunter:** a sentinel whose readability failed by timeout reports `VALIDATION_RUNTIME_FAILED`, not `VALIDATION_TIMEOUT`. — AC8 and AD-11 mandate exactly the generic `VALIDATION_RUNTIME_FAILED` at document scope when readability cannot be established.
  - `[low]` `[reject]` **Edge Case Hunter:** errors are discarded unlogged. — Same root cause as the Blind Hunter logging row; rejected with it.
  - `[false]` `[reject]` **Edge Case Hunter:** a non-finite budget or clock reading breaks `Deadline`. — Unreachable: the only budget is the constant 9000, the clock is `performance.now` or a test injection, and `batchTimeoutMs` already refuses NaN through `!(timeoutMs >= floor)`.
  - `[false]` `[reject]` **Edge Case Hunter (claim):** a floor refusal or database timeout during authorization becomes an unmodeled `isError`. — AC9 mandates exactly that: expiry, a below-floor remainder, or another non-application failure of the lookup or `read` check is a Tool-Execution Error with the fixed message.
  - `[false]` `[reject]` **Edge Case Hunter (claim):** `READ ONLY` is not first in API workers. — Same as the Blind Hunter production-wrapper row; the Postgres probe shows the guarantee holds.
  - `[medium]` `[patch]` **Verification Gap:** nothing pins the 9000 ms deadline at the tool surface. — Pre-verified gap. Patched: `connect` forwards dependencies, and a tool-level test with clock `() => 0` asserts that the first `SET LOCAL lock_timeout` and `statement_timeout` sent are `= 9000`.
  - `[low]` `[patch]` **Verification Gap:** the default-clock test cannot tell `performance.now` from `Date.now`. — Pre-verified gap. Patched: `vi.spyOn(performance, "now")` drives a default-clock `Deadline` (1000, then 1300 gives `remainingMs()` 200, and 1500 gives `expired()`).
  - `[false]` `[reject]` **Verification Gap (other):** the 9000 ms budget can raise a lower per-process baseline. — Same as the first Blind Hunter row.
  - `[false]` `[reject]` **Intent Alignment:** `internal_links` fails the unit instead of running. — The epic makes the Story 1.4 link function serve Story 1.3, and AC5 forbids `complete` until link rules run, so the fail-closed System Failure is the only reading available before Story 1.4, whose AC1 wires `lint_document` to it.
  - `[false]` `[reject]` **Intent Alignment:** the title is not loaded although AC4 says "complete stored title and body". — No registered rule reads the title, and AD-4 coordinates use `includeTitle: false`, so no output can differ.
  - `[false]` `[reject]` **Intent Alignment:** an authentication failure inside the handler yields the fixed message. — Same as the Edge Case Hunter absent-user row: authentication fails at the route with the baseline 401.
  - `[false]` `[reject]` **Intent Alignment:** MCP behavior is exercised through an in-test server, not `/mcp`. — AC1 keeps `/mcp` discovery disabled until Story 1.10, and the in-test server runs the same SDK 1.29.0 code path. The production route is asserted to list no `lint_document`.
  - `[false]` `[reject]` **Intent Alignment:** the production statement order is unverified. — Same as the Blind Hunter production-wrapper row.
  - `[low]` `[patch]` **Intent Alignment:** a real database timeout in the collection-readability step is untested. — Same root cause as the Blind Hunter real-abort row; patched with it.
  - `[low]` `[reject]` **Intent Alignment:** precedence between AC2 and AC3 for a change found after expiry. — Same root cause as the Blind Hunter precedence row; rejected with it.
  - `[false]` `[reject]` **Intent Alignment:** "documents check not required" is tested only at the application level. — The application test asserts the exact result and that no snapshot is read; the tool layer only serializes the result, so no outcome differs at the tool surface.
  - `[false]` `[reject]` **Intent Alignment:** the operator bookkeeping and the `awaiting-operator` reading. — No Story 1.3 criterion needs a human action outside the repo: the SDK fixture shows `isError`, so AC9's escalation does not arise, and the floor and Gate 1 evidence belong to Epic 3. The status is `done`.

## Design Notes

**Readability tri-state.** `readable` means `can(actor, "read", collection)` holds. `unreadable` means it does not (including no collection). `unestablished` means the floor refused the step, or the lookup or the check threw.

Identity is shown only for `readable`. `unreadable` and `unestablished` both hide identity, and the evaluation continues under the policy. The two states differ only for a sentinel (AD-10, AD-12): `POLICY_CONFIGURATION_INVALID` for `unreadable`, `VALIDATION_RUNTIME_FAILED` for `unestablished`.

Collection readability is its own floor-guarded `Collection.findByPk` batch, not the include preloaded with the document. This gives AC6's failure modes (expiry, floor, error) a real step whose failure cannot touch the document outcome.

**Statement sequences** (each `SET LOCAL` pair uses one value `n` = the floored remainder):
- pre-snapshot: `START`, `READ ONLY`, `SET LOCAL ×2`, document `SELECT`s, `SET LOCAL ×2`, collection `SELECT`, `COMMIT`;
- snapshot: `START`, `ISOLATION LEVEL REPEATABLE READ`, `READ ONLY`, `SET LOCAL ×2`, document `SELECT`, `COMMIT`.

Serialization runs inside the snapshot callback and does no I/O. Parsing runs after commit.

**Timeout classification.** Only on a snapshot failure: `DeadlineFloorError`, `isDatabaseTimeout`, or `deadline.expired()` gives `VALIDATION_TIMEOUT`, and anything else gives `VALIDATION_RUNTIME_FAILED`. After a successful snapshot, an expired deadline is also `VALIDATION_TIMEOUT` ("expired during construction"). A canonical parse failure is always `VALIDATION_RUNTIME_FAILED`. Rule evaluation is synchronous and is not preempted.

**Unit.** Let `rules = documentSurfaceRules(policy.rules)`. Empty `rules` means `requiredUnits: 0`. Otherwise:
- structure kinds go to `evaluateDocumentRules`;
- `internal_links` cannot yet run successfully: the shared link function arrives in Story 1.4, which replaces this branch. Its presence therefore fails the unit (AC5 forbids `complete` without it), and its own Findings are none.

The unit completes iff there are no `failedKinds` and no `internal_links`. Failed means one System Failure, `completedUnits: 0`, and `evaluatedDocumentCount: 0`. `evaluatedLinkCount` is always 0 until 1.4.

**Title.** No registered rule reads the title, and positions index `includeTitle: false`. The title is therefore not loaded.

## Verification

**Commands:**
- `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint server/tools/wikiLint.test.ts` -- expected: all pass, including the unchanged boundary test (needs the migrated test Postgres)
- `TZ=UTC node_modules/.bin/vitest run --project server server/tools server/routes/mcp` -- expected: baseline MCP tests unaffected
- `corepack yarn tsc` -- expected: exit 0
- `node_modules/.bin/oxlint --type-aware server/wikiLint server/tools/wikiLint.ts server/tools/wikiLint.test.ts` -- expected: 0 errors
- `node_modules/.bin/oxfmt --check server/wikiLint server/tools/wikiLint.ts server/tools/wikiLint.test.ts` -- expected: clean
- `grep -rniE "laura|ezop" server/wikiLint server/tools/wikiLint*.ts` -- expected: no matches

## Auto Run Result

Status: done

**Summary.** Story 1.3 adds the internal single-document lint orchestration:
- A monotonic `Deadline` with a provisional, code-owned `SET LOCAL` floor of 100 ms.
- A primary-database adapter in two steps:
  - the pre-snapshot authorization, a short read-only transaction holding the document lookup, the `read` check, and a separate collection-readability batch;
  - the snapshot, a `REPEATABLE READ` transaction made read-only by an explicit `SET TRANSACTION READ ONLY`, which re-reads the row's collection and deletion state and serializes canonical Markdown from `content` or `state`.

  Every batch is preceded by `SET LOCAL lock_timeout` and `statement_timeout` from the floored remainder.
- The `lintDocument` application shell. It classifies the policy (not configured, sentinel, valid), gates identity on a three-state collection readability, and evaluates the document-surface rule kinds as one unit. It builds every AD-12 result through the Story 1.1 builder.
- `server/tools/wikiLint.ts`, which exports the D-9 input schema and a handler. The handler starts the 9 s deadline at entry and maps outcomes to the modeled result, the identical `Authorization error`, or the fixed message.

The tool is not registered on `/mcp`; discovery stays with Story 1.10. Until Story 1.4 supplies the shared link function, an enabled `internal_links` kind fails the unit with one `VALIDATION_RUNTIME_FAILED`, so the result is never falsely `complete`.

**Files changed:**
- `server/wikiLint/application/deadline.ts` (new) — `Deadline`, `MonotonicClock`, `SET_LOCAL_FLOOR_MS`, `DeadlineFloorError`.
- `server/wikiLint/adapters/documentReader.ts` (new) — `authorizeLintTarget`, `readDocumentSnapshot`, `isDatabaseTimeout`, plus the read-only transaction and batch-bound helpers.
- `server/wikiLint/application/lintDocument.ts` (new) — `LINT_DOCUMENT_DEADLINE_MS`, the reader seam and dependencies, and `lintDocument`.
- `server/tools/wikiLint.ts` (new) — `lintDocumentInputSchema` and `lintDocumentTool`.
- `server/wikiLint/core/documentRules.ts` — `documentSurfaceRules`, derived from the registry.
- Collocated tests:
  - `application/deadline.test.ts` and `application/lintDocument.test.ts` (fake reader, fixed clock);
  - `adapters/documentReader.test.ts` (Postgres: statement sequences, drafts and archived documents, `content` over a stale `text`, re-read changes, lock-based timeouts, a real aborted readability step);
  - `server/tools/wikiLint.test.ts` (Postgres, end to end through an in-test `McpServer` over `InMemoryTransport`, plus a `/mcp` `tools/list` check);
  - `core/documentRules.test.ts` (the selector).

**Review findings breakdown** (38 findings: high 0, medium 1, low 19, false 18, maybe-false 0):
- **Patches applied** (6 entries: medium 1, low 5; all test-only, no production change):
  - medium: the 9000 ms deadline is now pinned at the tool surface through the first `SET LOCAL` values;
  - low:
    - the default clock is proven to be `performance.now`;
    - a real Postgres abort in the readability step yields `unestablished` (Blind Hunter and Intent Alignment);
    - the collection SELECT never reads `documentStructure`;
    - a trashed document and a non-slug string join the identical-denial set;
    - identity is hidden on snapshot failure for `unreadable` and `unestablished` readers.
- **Deferred:** none.
- **Rejected,** with reasons in the Review Triage Log:
  - low:
    - per-statement timeouts in multi-statement batches (two layers);
    - unbounded pool acquisition (two layers);
    - no operator logging in the `catch` blocks (two layers);
    - AC2/AC3 precedence after expiry (two layers);
    - mutation-test breadth;
    - the floor refused only after the transaction opens;
    - `state` loaded beside `content`;
    - the revocation window between the two transactions (two layers);
  - false:
    - `REQUEST_TIMEOUT` override (three layers);
    - the `documentSurfaceRules` equality;
    - production wrapper order (three layers, disproved by a Postgres probe);
    - an absent actor (two layers);
    - completion after the deadline;
    - the generic sentinel failure under timeout;
    - a non-finite deadline;
    - the fixed message for pre-snapshot timeouts;
    - the link-rule deferral;
    - the title;
    - the in-test MCP surface;
    - application-only "documents not required";
    - operator bookkeeping.

**Follow-up review recommendation: false.** First pass: one `medium` and no `high` entry were patched (patched: high 0, medium 1, low 5), and every patch is test-only.

**Verification performed** (final tree; the test database is Postgres 14.24 at `127.0.0.1:5432/outline-test`, migrated with `NODE_ENV=test corepack yarn sequelize db:migrate`):
- `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint server/tools/wikiLint.test.ts`: 13 files, 491/491 passed, including the unchanged boundary test.
- `TZ=UTC node_modules/.bin/vitest run --project server server/tools server/routes/mcp`: 9 files, 130/130 passed.
- `corepack yarn tsc`: exit 0.
- `node_modules/.bin/oxlint --type-aware` on the changed paths: exit 0.
- `node_modules/.bin/oxfmt --check` on the changed paths: exit 0, 27 files correctly formatted.
- `grep -rniE "laura|ezop" server/wikiLint server/tools/wikiLint*.ts`: no matches.
- Probes:
  - On Postgres, `SET TRANSACTION READ ONLY` after the API worker's baseline `SET LOCAL` is accepted and enforced, and a later `SET LOCAL` overrides the baseline.
  - `COMMIT` of a transaction aborted in the readability step resolves.
  - The production sources were unchanged by the review patches (compared chunk by chunk).
- Matrix test audit: every I/O-matrix row has a covering test that ran and passed.

**Residual risks:**
- Every policy that enables `internal_links`, including `server/wikiLint/policy.example.json`, returns `failed` until Story 1.4.
- No operator diagnostic is logged when a lint fails with the fixed message or a runtime System Failure.
- Per-statement `SET LOCAL` bounds let a multi-statement batch run up to about 3× its remainder. Pool acquisition is bounded only by the baseline 30 s acquire timeout.
- A permission revoked between the pre-snapshot transaction and the snapshot is not re-checked (AD-10 sequence).
- The lock-based adapter test holds `ACCESS EXCLUSIVE` on `documents` in the shared test database for under a second.
- The statement-sequence tests pin the baseline's membership-include query count.
- This environment had no Postgres. A scratch PostgreSQL 14 (conda-forge, session scratchpad) served the DB tests; CI uses `postgres:14.2`.
