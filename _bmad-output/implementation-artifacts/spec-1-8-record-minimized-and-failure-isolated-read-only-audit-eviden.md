---
title: 'Story 1.8: Record Minimized and Failure-Isolated Read-Only Audit Evidence'
type: 'feature'
created: '2026-10-02'
status: 'done'
baseline_revision: '03f49ed1b95d8fa7654ca918c5dddf558eefba62'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** `lint_document` and `lint_wiki` (still unregistered on `/mcp`) leave no durable evidence. There is no server-owned request or invocation identity, credential type and OAuth client identity never reach MCP tool handlers, and operators have no admin-only way to retrieve lint summaries on a self-hosted instance. The baseline `audit` ability is cloud-only (`server/policies/team.ts:44-50`).

**Approach:**
- After each invocation that returns a lint result, write one idempotent, minimized `AuditDataV1` Event (`wikiLint.document` / `wikiLint.wiki`).
- The write runs in an independent transaction, bounded at 3 s, and its failure never changes the result.
- Propagate attribution from the `/mcp` route through `AuthInfo.extra`.
- Expose the summaries through a new admin-only `events.list` flag, `auditWikiLint`.
- Add the `events(teamId, name, createdAt)` index through a concurrent migration.

## Boundaries & Constraints

**Always:**
- **Identity:**
  - The `/mcp` route generates `requestId = randomUUID()` once per HTTP request, into `AuthInfo.extra.requestId`.
  - Each tool handler generates `invocationId = randomUUID()` per call. It is the Event `id`.
- **When a summary is written:** only when the shell outcome is `kind: "result"`. `denied`, `failed`, and SDK input-validation errors write nothing.
- **Event row:**
  - `name` is `wikiLint.document` or `wikiLint.wiki`.
  - `teamId` = `actor.teamId`, `actorId` = `actor.id`, and `ip` = `normalizeIp(extra.ip)`.
  - `authType` = `"mcp"`, the value the tool command context uses.
  - `userId` and `modelId` are NULL; `changes` is NULL; `createdAt` = `NOW()`.
- **Event columns:**
  - `documentId` = `result.scope.documentId` for a document scope only.
  - `collectionId` = `result.scope.collectionId` for a collection scope only.
  - A default scope sets neither column.
  - A document scope never sets `collectionId`: the document alone identifies the audited scope (FR-21 "only when necessary"), and this keeps the columns independent of collection readability.
- **`data`** is exactly AD-14 `AuditDataV1`; no other key is allowed.
  - `schemaVersion: 1` and `requestId`.
  - `operation`: `lint_document` or `lint_wiki`.
  - `outcome`:
    - `complete` with zero Errors gives `clean`;
    - `complete` with Errors gives `findings`;
    - `not_evaluated`, `incomplete`, and `failed` map one to one.
  - `complete`: `result.complete`.
  - `durationMs`: `Math.max(0, Math.round(clock() - enteredAt))`, where `enteredAt` is the first clock reading in the handler and the second reading is taken when the audit write is initiated.
  - `scopeKind`: `result.scope.kind`.
  - `evaluatedDocumentCount` and `evaluatedLinkCount`: taken from the scope, and summed over `collections` for `configured_collections`.
  - `counts`: `{ errors, warnings, systemFailures, byCode }`. `byCode` counts every code across all three arrays, with keys inserted in bytewise order.
  - `runtimeFailOpenExercised: false` and `credentialAuthType: "oauth" | "api"`.
  - `authenticatedClientId`: only when `credentialAuthType` is `"oauth"` and `extra.authenticatedClientId` is a non-empty string.
- **Policy fields:** `policySchemaVersion: 1` and `policyFingerprint` appear only for a single collection or document under a valid policy. Otherwise both are omitted, and no `invalidFingerprint` or policy array is written.
  - Document scope: the shell's new `auditPolicy`, which is set whenever the document's collection policy is valid, whether or not the actor can read that collection.
  - Collection scope: `result.policies[0]` when its status is `valid`. A collection-scoped `lint_wiki` result is always actor-readable, because the pre-admission check enforces it.
- **Attribution:**
  - `credentialAuthType` and `authenticatedClientId` come only from `AuthInfo.extra`, which the route fills from the private authentication result: `type`, plus the new `clientId` = `authentication.oauthClient.clientId`, set for OAuth only.
  - `AuthInfo.clientId`, `User-Agent`, `_meta`, MCP client claims, and tool arguments are never read.
  - Missing or invalid `requestId` or `credentialAuthType` is an audit failure.
- **Write:**
  - An independent `sequelize.transaction` runs `SET LOCAL statement_timeout = 3000`, then `INSERT INTO events … ON CONFLICT (id) DO NOTHING` with bind parameters.
  - The raw insert never runs the model's `AfterSave` hook, so nothing is enqueued to `globalEventQueue`; IP normalization is called explicitly.
- **Bound:** the tool awaits the write raced against an `AUDIT_WRITE_BOUND_MS` timer, and clears the timer on settle. The losing write promise gets a no-op `.catch`, so a late rejection is never unhandled.
- **Failure:**
  - Expiry or any thrown error, including attribution and clock errors, is an audit failure.
  - On failure: one `Logger.warn("Wiki lint audit write failed", { requestId, invocationId, reason })`, with `reason` either `"timeout"` or `"error"`, and no error object, message, or SQL.
  - The audit step never rejects, and the tool result is byte-identical either way.
- **Admission:** `lint_wiki` awaits the audit inside the `try`, before `finally { lease.release() }`, so the slot is released only once the write settles or its bound expires.
- **Retrieval:**
  - `allow(User, "auditWikiLint", Team, isTeamAdmin)`, with no cloud check.
  - `events.list` accepts `auditWikiLint: boolean` (default false). When it is true, it authorizes `auditWikiLint` and sets `where.name` to `WIKI_LINT_AUDIT_EVENTS` intersected with `events` when given, else all three. It takes precedence over `auditLog`, and presents with admin detail.
  - The `events` schema also accepts the three names, so they intersect without error.
- **Name constant:** `WIKI_LINT_AUDIT_EVENTS = ["wikiLint.document", "wikiLint.wiki", "wikiLint.write_validation"]` is a new constant in the wikiLint adapter. It is never added to `EventHelper.AUDIT_EVENTS`, `ACTIVITY_EVENTS`, or the `Event` type union.
- **Migration:** `queryInterface.addIndex("events", ["teamId", "name", "createdAt"], { concurrently: true })`. The down migration uses `removeIndex` with the same options, following the `20260903145856-add-document-createdbyid-index.js` precedent.

**Never:**
- Write-validation summaries, `aborted_*`, the `DO UPDATE` overwrite clause, or `validationCorrelationId`: those belong to Epic 2.
- Registering the tools on `/mcp`, which is Story 1.10.
- A second audit subsystem, a dashboard, or new retention.
- Widening the lint transaction, or closing the crash-after-completion-before-audit gap, which stays an explicit documented gap.
- Any audit state in a tool result.
- Changing the baseline `audit` ability, `AUDIT_EVENTS`, or `ACTIVITY_EVENTS`.
- Changing lint outcomes.
- Pilot identifiers, or edits to `sprint-status.yaml`.

## I/O & Edge-Case Matrix

V = valid policy; `pol` = `policySchemaVersion` and `policyFingerprint`.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Clean document | `lint_document` D in V, 0 issues | one `wikiLint.document` row: outcome `clean`, `complete: true`, `documentId` D, `collectionId` NULL, `pol` present | — |
| Findings | D with Errors and Warnings | `findings`; error, warning, and `byCode` counts match the result | — |
| Unconfigured | D's collection has no policy, or D has no collection | `not_evaluated`, no `pol` | — |
| Sentinel | D's collection is invalid | `failed`, `byCode {POLICY_CONFIGURATION_INVALID:1}`, no `pol` | — |
| Collection unreadable | D readable only by document membership, in a V collection | `data` and columns equal those of a collection reader, except `requestId`, `durationMs`, `actorId`, and `ip` | — |
| Readability check fails | the reader returns `collectionReadability: "unestablished"` | one summary, `pol` present, `collectionId` NULL | — |
| `lint_wiki` incomplete | stop-margin timeout, C in V | `wikiLint.wiki`, `incomplete`, `collectionId` C, `pol` | — |
| Admission rejected | slot held; scoped C, then default | scoped: `failed`, `collectionId` C, `pol`. Default: `configured_collections`, no columns, no `pol` | — |
| Not evaluated, no admission | scoped unconfigured C; default with an empty set | one summary each; `admit` not called | — |
| Tool-execution errors | invalid input; denied or missing target; lookup throw; `DeadlineFloorError` or expiry in the lookup | `isError`, zero Events | — |
| Audit fails | writer rejects, or never settles | result byte-identical to an audited run; one `Logger.warn` with only `requestId`, `invocationId`, and `reason` | never rejects |
| Audit pending | `lint_wiki` audit write blocked | a concurrent scoped `lint_wiki` gets the admission rejection; after it settles, the next call is admitted | — |
| Retry | the same `invocationId` is inserted twice | one row; first data kept | `ON CONFLICT DO NOTHING` |

</intent-contract>

## Code Map

- **Tool handlers:** `server/tools/wikiLint.ts:72-130`.
  - `lintDocumentTool` and `lintWikiTool` gain `invocationId`, `enteredAt`, and the audit call.
  - Keep every clock read inside `try`: the test at `wikiLint.test.ts:610-628` passes a throwing clock and expects `isError`.
- **Shells:**
  - `server/wikiLint/application/lintDocument.ts:66-69` -- `LintDocumentOutcome`, which `lintWiki.ts:83` aliases.
  - `lintDocument.ts:181-186` computes `entry` regardless of readability.
  - Valid-policy result returns: `:221-233` (zero rules), `:242-252` (`constructionFailure` via `failedResult` at `:128-141`), `:281-297` (`failedKinds`), and `:299-313` (success). These gain `auditPolicy: policyIdentity(entry)`.
  - `lintWiki.ts` needs no change: its collection result always carries `[identity]` (`:339-350`, `:405-411`).
- **Dependencies:** `LintDocumentDependencies` (`lintDocument.ts:57-63`) gains `writeAudit?`, and `LintWikiDependencies` (`lintWiki.ts:73-78`) inherits it.
- **Attribution at the route:** `server/routes/mcp/index.ts:164` destructures `ctx.state.auth`, and `:192-197` builds `AuthInfo`, currently `extra: { user, scope, ip }` with `clientId: ""`.
- **Private authentication result:** `server/middlewares/authentication.ts`.
  - `:157-166` -- the return type.
  - `:194-221` -- the OAuth branch. `findByAccessToken` already eager-loads `oauthClient` (`server/models/oauth/OAuthAuthentication.ts:188-210`), whose public `clientId` is at `OAuthClient.ts:86-87`.
  - `:60-74` -- copies the result to `ctx.state.auth`.
- **`Authentication` type:** `server/types.ts:54-65`.
- **Event model:** `server/models/Event.ts`.
  - `data` is JSONB.
  - `authType` is a STRING in the database.
  - `@BeforeCreate cleanupIp` (`:75-78`) calls `normalizeIp` (`server/utils/ip.ts:14`).
  - `@AfterSave enqueue` (`:80-95`) has no skip flag, so a raw SQL insert avoids it.
  - `documentId` has no FK; `collectionId`, `actorId`, and `teamId` have NO ACTION FKs.
- **Raw `ON CONFLICT` precedent:** `server/commands/subscriptionCreator.ts:40-44`.
- **`events.list`:** `server/routes/api/events/events.ts`.
  - `:23-33` -- the input.
  - `:40-49` -- the `audit` and activity name choice.
  - `:62-64` -- the non-admin gate.
  - `:99` -- `presentEvent(event, auditLog)`.
- **Schema:** `server/routes/api/events/schema.ts:8-27`.
- **Policy:** `server/policies/team.ts:44-50`, where `audit` is cloud-only. `isTeamAdmin` is in `server/policies/utils.ts:76`.
- **Constants:** `AUDIT_WRITE_BOUND_MS` is at `server/wikiLint/application/deadline.ts:14`, and `monotonicClock` at `:5`.
- **Logger:** `server/logging/Logger.ts:116` `warn(message, extra)`. The precedent is `server/wikiLint/adapters/policyConfig.ts:81`.
- **Queue:** `globalEventQueue` (`server/queues/index.ts:5`) is the only path to `"*"` processors, through `WebhookProcessor` (`server/services/worker.ts:53-78`).
- **Migrations:** the latest is `server/migrations/20260903145856-add-document-createdbyid-index.js`. The runners do not wrap migrations in a transaction.
- **Tests:**
  - `server/tools/wikiLint.test.ts`:
    - `:120-161` `connect`, which injects `authInfo.extra: { user }`; this needs `requestId` and `credentialAuthType`;
    - `:630-662` and `:2027-2062` -- the "mutates nothing" tests, which assert an unchanged Event count and no INSERT;
    - `:2660` -- "bounds and admission".
  - `server/routes/mcp/requestTimeout.test.ts:27-39` -- `vi.mock("@server/tools/users")`, the tool-registration pattern for a real `/mcp` call.
  - `server/test/McpHelper.ts` -- `buildOAuthUser`, `mcpHeaders`, `mcpRequest`, `parseMcpResponse`.
  - `server/test/factories.ts` -- `buildApiKey` at `:60` (plain key in `.value`), `buildOAuthAuthentication` at `:896`, and `buildWebhookSubscription` at `:704`.
  - `server/routes/api/events/events.test.ts` -- the events tests. `server/test/setup.ts:73` sets a cloud `env.URL` for each test.
- **Database tests:** see memory `local-test-postgres`.

## Tasks & Acceptance

**Execution:**
- `server/wikiLint/adapters/auditEvents.ts` (new) -- holds:
  - `WIKI_LINT_AUDIT_EVENTS`;
  - the AD-14 `AuditDataV1` type (read fields);
  - `AuditEventRow` (`id`, `name`, `teamId`, `actorId`, `ip`, optional `documentId` and `collectionId`, `data`);
  - `insertAuditEvent(row, statementTimeoutMs)`, as Boundaries describes. Its JSDoc records that the crash-after-completion-before-audit gap is accepted (AD-15, D-6).
- `server/wikiLint/application/readAudit.ts` (new) -- holds:
  - the pure `readAuditData(...)` mapping;
  - `recordReadAudit({ operation, outcome, actor, extra, invocationId, enteredAt, clock }, write = insertAuditEvent)`. It builds the row and data, applies the bound, and emits the diagnostic, and it never rejects.
- `server/wikiLint/application/lintDocument.ts` -- add `auditPolicy?` (the valid `PolicyIdentity`) to the result variant, and set it on every valid-policy return. `writeAudit?` joins the dependencies.
- `server/tools/wikiLint.ts` -- `invocationId`, `enteredAt`, and `recordReadAudit` for `kind: "result"`, ahead of `toolResult`. For `lint_wiki`, this sits before the lease release.
- `server/types.ts` and `server/middlewares/authentication.ts` -- `clientId?: string` (the public `OAuthClient.clientId`), set only on the OAuth branch and copied into `ctx.state.auth`.
- `server/routes/mcp/index.ts` -- adds `requestId`, `credentialAuthType: type`, and, when `type` is OAuth and `clientId` is set, `authenticatedClientId` to `AuthInfo.extra`.
- `server/policies/team.ts` -- the `auditWikiLint` ability.
- `server/routes/api/events/schema.ts` and `events.ts` -- the `auditWikiLint` flag and branch, the three names accepted in `events`, and admin presentation.
- `server/migrations/20261002120000-add-events-team-name-created-at-index.js` (new) -- the concurrent index, with a down migration.
- `server/wikiLint/application/readAudit.test.ts` (new) -- covers, with no database:
  - each mapping rule: the five outcomes, three scope kinds, policy presence (document readable and unreadable, collection valid, sentinel, unconfigured, default), `byCode` and sums, the integer `durationMs`, and the exact key sets;
  - the OAuth and API client rules;
  - the columns for each scope;
  - writer rejection, attribution gaps, and a throwing clock, each giving the diagnostic and no throw;
  - the fake-timer expiry at 3000 ms giving `reason: "timeout"`, and a late writer rejection that is not unhandled.
- `server/wikiLint/adapters/auditEvents.test.ts` (new, with the database) -- covers:
  - the exact row (with `::ffff:127.0.0.1` normalized to `127.0.0.1`);
  - a duplicate id keeping one row and the first `data`;
  - `SET LOCAL statement_timeout = 3000` before the INSERT, on the same transaction;
  - no `globalEventQueue().add`;
  - the `events ("teamId", name, "createdAt")` index present in `pg_indexes`.
- `server/tools/wikiLint.test.ts`:
  - the harness `extra` gains `requestId` and `credentialAuthType: "api"`;
  - the "mutates nothing" tests now expect exactly one new `wikiLint.*` Event and no other INSERT, UPDATE, or DELETE;
  - a new `audit summary` block covers each matrix row, plus the access roles admin, member, viewer, and document-membership-only reader;
  - a `"*"` webhook subscription is present and no `wikiLint.*` add reaches `globalEventQueue`.
- `server/routes/mcp/audit.test.ts` (new) -- mocks `@server/tools/users` to register `lint_document` → `lintDocumentTool`. Over real `/mcp` HTTP, with OAuth and with an API key, it covers the attribution ACs below.
- `server/routes/api/events/events.test.ts` -- covers the retrieval AC below.

**Acceptance Criteria:**
- **AC1 and AC5, OAuth:** Given an OAuth access token whose `OAuthClient.clientId` is K, when `lint_document` is called over `/mcp` with `User-Agent: spoof`, `params._meta: { clientId: "spoof" }`, and an extra `clientId: "spoof"` argument, then the one `wikiLint.document` Event has:
  - `data.credentialAuthType` `"oauth"` and `data.authenticatedClientId` K;
  - `id` ≠ the JSON-RPC id;
  - a UUID `data.requestId`, which differs between two HTTP requests;
  - `authType` `"mcp"`.
- **AC1 and AC5, API key:** with an API key instead, the Event has `credentialAuthType: "api"` and no `authenticatedClientId`.
- **AC6, retrieval:** Given wikiLint, audit, and activity Events in two teams, when `events.list` is called:
  - with `auditWikiLint: true` by a same-team admin, it returns only that team's three-name Events, on a non-cloud `env.URL` too;
  - with `events: ["wikiLint.document", "documents.publish"]`, it returns only `wikiLint.document` with 200;
  - a member gets 403, with and without `documentId`;
  - `auditLog` and activity listings never contain `wikiLint.*`;
  - `auditLog` stays 403 on a non-cloud URL.
- **AC7, migration:** Given the migrated test database, when the migration is undone and reapplied, then both succeed, and the `(teamId, name, createdAt)` index exists after reapply.
- **AC2–AC4 and AC8–AC10, the matrix:** Given each I/O matrix row run through `lintDocumentTool` or `lintWikiTool` on the database, then the Event count, columns, and `data` exactly match the row (`toStrictEqual`, with `expect.any` only for `requestId` and `durationMs`), and the tool result equals the result of the same run without audit.

## Spec Change Log

## Review Triage Log

### 2026-10-02 — Review pass
- verdicts: 35 findings — high 0, medium 3, low 18, false 14, maybe-false 0
- findings:
  - `[low]` `[patch]` **Blind Hunter:** the `byCode` JSDoc promises bytewise key order, but `events.data` is JSONB, which reorders keys shorter-first. — Grouped with Edge Case Hunter (`byCode` order). No reader depends on the key order of a JSON object, but the contract comment misled. Patched: the JSDoc now says keys are inserted in bytewise order and JSONB storage does not preserve key order.
  - `[false]` `[reject]` **Blind Hunter:** a sentinel document's summary changes with collection readability (`VALIDATION_RUNTIME_FAILED` against `POLICY_CONFIGURATION_INVALID`). — A readable actor and an unreadable actor both record `POLICY_CONFIGURATION_INVALID` (`lintDocument.ts` invalid branch), and the summary counts codes, not locations. Only an `unestablished` result, which means the readability check itself failed, records the generic runtime failure that AD-11 mandates for that case. That is a system failure the result truthfully reports, not a dependence on whether the actor can read.
  - `[low]` `[reject]` **Blind Hunter:** writes that time out keep running, and nothing caps how many are in flight, so a database slowdown adds pool pressure. — Grouped with Edge Case Hunter (lease released while the insert is in flight). Real, but each lint call adds at most one background transaction beside its own lint transactions. The `/mcp` rate limiter bounds the call rate, and it takes a database stall longer than 3 s. AD-16 step 4 releases the slot when the bound expires. A fix needs an in-flight limiter or abort plumbing, which is new state, not a direct correction.
  - `[low]` `[patch]` **Blind Hunter:** the `timeout` diagnostic can be wrong, because the write may still commit afterwards. — Grouped with Edge Case Hunter (late commit; the 3 s claim). Patched: the JSDoc of `recordReadAudit` and `insertAuditEvent` now states that expiry stops the wait, not the transaction, so `timeout` means the outcome is unknown and the summary may still be stored later. The log message and reasons are unchanged.
  - `[false]` `[reject]` **Blind Hunter:** `insertAuditEvent` does not validate `statementTimeoutMs`, so a value in [0, 1) turns the timeout off. — The only caller passes the constant `AUDIT_WRITE_BOUND_MS` (3000). No reachable input yields 0, and NaN would fail loudly in SQL.
  - `[false]` `[reject]` **Blind Hunter:** nothing enforces the closed `AuditDataV1` key set at write time. — The only producer is `readAuditData`, which builds an object literal of exactly the AD-14 keys, and the `readAudit.test.ts` key-set tests use `toStrictEqual`. No path writes an extra key.
  - `[low]` `[patch]` **Blind Hunter:** `auditWikiLint` silently overrides `auditLog`, and no test covers the combination. — The precedence is spec-mandated (Boundaries, "Retrieval"), so the override itself is intended. The missing test is real. Grouped with Verification Gap (precedence untested); patched as below.
  - `[low]` `[patch]` **Blind Hunter:** the retrieval tests use factory rows; they lack a `collectionId` filter case, the `name` and `actorId` filters, and viewer/guest 403s. — Grouped with Intent Alignment (no lint → `events.list` test). The filter and role cases run the same `where.name` assignment and `isTeamAdmin` authorization that the existing member, `documentId`, and audit/activity tests already cover. Patched: a test now runs `lint_document` through the harness and retrieves its summary (`id`, name, and the stored `AuditDataV1` `data`) through `events.list` with `auditWikiLint` as a same-team admin.
  - `[low]` `[patch]` **Blind Hunter:** the role test omits the guest role that AC10's "each access role" names. — Patched: a same-team guest with a read `UserMembership` on the document is added to "records each access role as its own actor", with its summary expected like the others.
  - `[low]` `[reject]` **Blind Hunter:** an interrupted `CREATE INDEX CONCURRENTLY` leaves an INVALID index, and re-running `up` then fails. — This is the behaviour of every baseline concurrent migration, which the spec says to follow (`20260903145856`). Recovery is a standard operator `DROP INDEX`, it is rare, and a fix adds naming and drop branches.
  - `[low]` `[reject]` **Blind Hunter:** `requestId` is not written to request logs or response headers, so an Event cannot be traced to HTTP or Sentry logs. — No AC asks for it. The diagnostics of AC9 already carry `requestId` and `invocationId`. A response header or a log field would add public surface for a need nobody meets until the tools are registered.
  - `[false]` `[reject]` **Blind Hunter:** attribution tests are missing: no `clientId` middleware test, no `lint_wiki` over `/mcp`, no JSON-RPC batch. — `audit.test.ts` proves the outcome over real `/mcp`: OAuth records the bound `OAuthClient.clientId`, and an API key records none. `lint_wiki` reads the same `AuthInfo.extra` through the same `recordReadAudit`. A batch shares one per-request `AuthInfo` by construction, while each handler call draws its own `invocationId`.
  - `[low]` `[reject]` **Blind Hunter:** operators have no README documentation of `auditWikiLint`, the names, the crash gap, or retention. — The tools stay unregistered until Story 1.10, so no operator meets this yet. The crash gap is explicit in the `insertAuditEvent` JSDoc and AD-15, and CLAUDE.md forbids incidental notes. Grouped with Intent Alignment (crash gap not in the README).
  - `[low]` `[reject]` **Blind Hunter:** the "never settles" test installs fake timers inside the writer, so it relies on the writer being called before `setTimeout`. — If that order changed, the real 3 s timer would still expire and the test would still pass, only more slowly. Faking timers before the call would fake Sequelize's timers during the database-backed lint, so the fix is not a direct correction.
  - `[low]` `[patch]` **Edge Case Hunter:** the bound expires and the write still commits, so a timeout diagnostic sits beside a stored row. — Grouped with Blind Hunter (`timeout` diagnostic can be wrong); patched by the JSDoc above. Rollback on abort was not adopted: it adds signal plumbing.
  - `[low]` `[reject]` **Edge Case Hunter:** `finally` releases the lease at bound expiry while the insert is in flight. — Grouped with Blind Hunter (writes that time out keep running). AD-16 step 4 releases the slot "after the audit write settles or its bound expires".
  - `[false]` `[reject]` **Edge Case Hunter:** a clock returning -Infinity, or a reading below `enteredAt`, stores `durationMs` 0. — `performance.now()` is monotonic and finite, so neither input is reachable. The clamp `Math.max(0, Math.round(...))` is what the spec mandates.
  - `[false]` `[reject]` **Edge Case Hunter:** `statementTimeoutMs` below 1, or NaN, disables or breaks the timeout. — Same as the Blind Hunter row: the only caller passes the constant 3000.
  - `[low]` `[patch]` **Edge Case Hunter:** JSONB reorders `byCode` keys. — Grouped with Blind Hunter (`byCode` JSDoc); patched as above.
  - `[low]` `[reject]` **Edge Case Hunter:** "holds the scan slot" could flake if the concurrent `lint_wiki` lookup takes more than the real 3000 ms. — The concurrent call reaches `admit` after one scoped lookup that takes milliseconds. Fake timers would interfere with the database-backed run, so the fix is not a direct correction for a practically unreachable delay.
  - `[low]` `[patch]` **Edge Case Hunter (claim):** "bounded at 3 s" bounds only the caller's wait; the transaction can outlive it. — Grouped with Blind Hunter (`timeout` diagnostic); the implementation matches AD-15 ("awaited with a 3-second bound"), and the JSDoc now states the transaction can outlive the wait.
  - `[medium]` `[patch]` **Verification Gap:** the audit policy fields on `lint_document`'s valid-policy non-success returns (zero document rules, construction failure, failed rule kinds) were never asserted. — Patched: a new `it.each` "records the policy of %s" asserts the full stored row with the policy fields for a `DeadlineFloorError` snapshot, a policy with only wiki-level rules, and a failed rule kind. Removing `auditPolicy` from those returns was confirmed to fail all three cases.
  - `[medium]` `[patch]` **Verification Gap:** `durationMs` is asserted only as `expect.any(Number)` at the handler level. — Patched: a `lint_document` test with an injected clock that reads 5000 first and 5012 after asserts `durationMs` exactly 12.
  - `[medium]` `[patch]` **Verification Gap:** the precedence of `auditWikiLint` over `auditLog` has no test. — Grouped with Blind Hunter (override untested). Patched: an `it.each` over the cloud and self-hosted URLs sends both flags and expects 200 with exactly the team's summary IDs.
  - `[false]` `[reject]` **Intent Alignment (reading B):** the story should end `awaiting-operator`. — No AC needs a human action outside the repo. The migration was applied and round-tripped on the test database, and deployment is a separate approval boundary (CLAUDE.md, Gate 3).
  - `[false]` `[reject]` **Intent Alignment:** the harness rows assert `ip: null`, so the source IP is checked only elsewhere. — AC4's source IP is verified at the outer surface: `audit.test.ts` asserts `127.0.0.1` over real `/mcp`, and the adapter test asserts normalization. The harness supplies no IP by design.
  - `[false]` `[reject]` **Intent Alignment:** a client resending `tools/call` is not deduplicated. — AC1 makes the invocation identity server-owned. A client resend is a new invocation with its own identity, and AD-14 allows one summary per invocation. Retries of the same identity are covered at the adapter and the tool.
  - `[low]` `[patch]` **Intent Alignment:** no test retrieves a lint-produced summary through `events.list`. — Grouped with Blind Hunter (retrieval tests); patched with the lint → `events.list` test above.
  - `[false]` `[reject]` **Intent Alignment:** `"*"` non-delivery is inferred from a queue spy. — `globalEventQueue` is the only ingress to the webhook and websocket processors (`server/services/worker.ts:53-78`). The raw insert never runs the `AfterSave` enqueue, and the spy proves no add.
  - `[false]` `[reject]` **Intent Alignment:** AC9 isolation is tested only through a direct `lintDocumentTool` call; `lint_wiki` only through unit tests. — Both handlers await the same never-rejecting `recordReadAudit`, whose failure paths are unit-tested. The `lint_wiki` await is exercised by "holds the scan slot until a pending audit write settles". `/mcp` only serializes the identical `CallToolResult`.
  - `[low]` `[reject]` **Intent Alignment:** `lint_wiki` summaries are produced only by the collection owner. — Attribution never depends on role (`actor.id`, `actor.teamId`), and role only changes scope readability, which Story 1.5 covers. Another role loop adds test time and no new path.
  - `[false]` `[reject]` **Intent Alignment:** the migration round trip is not evidenced. — `db:migrate`, `db:migrate:undo` and `db:migrate` were run on the test database in verification, before and after the patch, each exiting 0. `auditEvents.test.ts` asserts the index.
  - `[false]` `[reject]` **Intent Alignment:** `DO NOTHING` differs from AD-14's `DO UPDATE` clause. — The AD-14 overwrite fires only for an incoming write-validation outcome, which no read outcome is, so the behaviour of read summaries is identical. The clause belongs to Epic 2, as the spec says.
  - `[low]` `[reject]` **Intent Alignment:** the crash gap is not in the fork README. — Grouped with Blind Hunter (no operator docs); rejected for the same reason.
  - `[false]` `[reject]` **Intent Alignment:** production changes are live before Story 1.10 (extra `AuthInfo.extra` fields, `ctx.state.auth.clientId`, `auditWikiLint`). — No harm follows from any of them. Baseline tools ignore the extra fields, `clientId` is an optional field that nothing presents, and `auditWikiLint` lists only the three names to a same-team admin.

## Design Notes

**Why `auditPolicy` exists only on `lint_document`.** AD-14 makes audit data actor-independent, but `result.policies` is empty when the actor cannot read the document's collection (AD-12). The shell already holds the `entry` before it gates on readability, so it reports the valid identity beside the result, never inside it. `lint_wiki` collection scopes are pre-authorized, so the identity in the result already carries the policy.

**Bounded write** (sketch):

```ts
const write = insert(row, AUDIT_WRITE_BOUND_MS);
write.catch(() => undefined);
let timer: NodeJS.Timeout | undefined;
const expiry = new Promise<"timeout">((r) => { timer = setTimeout(() => r("timeout"), AUDIT_WRITE_BOUND_MS); });
try { if ((await Promise.race([write.then(() => "ok" as const), expiry])) === "timeout") warn("timeout"); }
catch { warn("error"); } finally { clearTimeout(timer); }
```

## Verification

**Commands:**
- `NODE_ENV=test corepack yarn sequelize db:migrate`, then `db:migrate:undo`, then `db:migrate` -- expected: each exits 0.
- `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint server/tools/wikiLint.test.ts server/routes/mcp server/routes/api/events server/middlewares` -- expected: all pass.
- `TZ=UTC node_modules/.bin/vitest run --project server server/tools server/policies` -- expected: the baseline is unaffected.
- `corepack yarn tsc` -- expected: exit 0.
- `node_modules/.bin/oxlint --type-aware` and `node_modules/.bin/oxfmt --check` on the changed paths -- expected: clean.
- `grep -rniE "laura|ezop" server/wikiLint server/tools/wikiLint*.ts server/routes/mcp server/routes/api/events server/migrations/20261002120000-*` -- expected: no matches.

## Auto Run Result

Status: done

**Summary.** Every `lint_document` and `lint_wiki` invocation that returns a lint result now leaves one durable, minimized summary. The tools themselves are still unregistered on `/mcp` until Story 1.10.
- **Summary Event:**
  - **Contents:** one idempotent `AuditDataV1` Event, `wikiLint.document` or `wikiLint.wiki`.
  - **Identity:** the Event `id` is a server-owned `invocationId`, generated per handler call. `data.requestId` is a server-owned UUID, generated once per `/mcp` HTTP request.
  - **How it is written:**
    - It runs after the result is complete, in an independent transaction: `SET LOCAL statement_timeout = 3000`, then a raw `INSERT … ON CONFLICT ("id") DO NOTHING`.
    - The caller's wait is raced against the 3 s bound. On any failure, it logs one minimized `Logger.warn` that carries only `requestId`, `invocationId`, and `reason`.
    - The step never rejects, and the tool result is byte-identical either way.
    - The raw insert never reaches the global Event queue, so no `"*"` webhook or websocket receives the Event. The IP is still normalized as the model would.
  - **Admission:** `lint_wiki` releases its scan slot only after the write settles or the bound expires.
- **Columns and policy fields:**
  - A document scope sets only `documentId`, a collection scope only `collectionId`, and the default scope neither.
  - The policy fields are present only for a single scope under a valid policy. For `lint_document` they come from a new `auditPolicy`, which sits beside the result, so the summary does not depend on whether the actor can read the collection.
- **Attribution:** the private authentication result now carries the public `OAuthClient.clientId` for OAuth. The `/mcp` route passes `requestId`, `credentialAuthType` (`oauth` or `api`), and, for OAuth only, `authenticatedClientId` through `AuthInfo.extra`. `User-Agent`, `_meta`, client claims, and tool arguments are never read.
- **Retrieval:**
  - The new `events.list` flag `auditWikiLint` lists only the three wikiLint names. It is backed by the new `auditWikiLint` Team ability (same-team admin, available self-hosted too), takes precedence over `auditLog`, and intersects the `events` filter with the three names without error.
  - The names live in a new `WIKI_LINT_AUDIT_EVENTS` constant, outside `AUDIT_EVENTS` and `ACTIVITY_EVENTS`.
- **Migration:** a concurrent migration adds the `events("teamId", name, "createdAt")` index, with a down migration.

**Files changed:**
- `server/wikiLint/adapters/auditEvents.ts` (new) — `WIKI_LINT_AUDIT_EVENTS`, `AuditDataV1`, `AuditEventRow`, and `insertAuditEvent`, the bounded, idempotent raw insert. Its JSDoc records the crash-after-completion-before-audit gap (AD-15, D-6) and that the transaction can outlive the caller's wait.
- `server/wikiLint/adapters/auditEvents.test.ts` (new) — the exact row with a normalized IP, duplicate-ID idempotency, `SET LOCAL` before the INSERT on the same transaction, no queue add, and the index's presence.
- `server/wikiLint/application/readAudit.ts` (new) — the pure `readAuditData` mapping and `recordReadAudit`, which handles the row, the bound, and the diagnostic, and never rejects.
- `server/wikiLint/application/readAudit.test.ts` (new) — the mapping rules, the exact key sets, client rules, columns per scope, attribution and clock failures, fake-timer expiry, and absorption of a late rejection.
- `server/wikiLint/application/lintDocument.ts` — `auditPolicy` on every valid-policy result return, and the `writeAudit` dependency.
- `server/wikiLint/application/deadline.ts` and `deadline.test.ts` — `Deadline.startedAt`, the handler's single first clock reading, used as `enteredAt`.
- `server/tools/wikiLint.ts` — the handlers generate `invocationId` and audit `kind: "result"` outcomes; `lint_wiki` does so before the lease release.
- `server/tools/wikiLint.test.ts`:
  - the harness supplies attribution;
  - the "mutates nothing" tests now expect exactly the one audit insert;
  - a new `audit summary` block covers every I/O matrix row, the policy fields on non-success returns, exact `durationMs`, lint → `events.list` retrieval, the roles admin, member, viewer, guest, and document-only reader, the `"*"` queue check, and a pending audit holding the slot.
- `server/types.ts` and `server/middlewares/authentication.ts` — `clientId`, set only for OAuth.
- `server/routes/mcp/index.ts` — `requestId`, `credentialAuthType`, and `authenticatedClientId` in `AuthInfo.extra`.
- `server/routes/mcp/audit.test.ts` (new) — AC1 and AC5 over real `/mcp` HTTP with OAuth and an API key, with spoofed `User-Agent`, `_meta`, and arguments ignored.
- `server/policies/team.ts` — the `auditWikiLint` ability.
- `server/routes/api/events/schema.ts` and `events.ts` — the `auditWikiLint` flag and branch, the three names accepted in `events`, and admin presentation.
- `server/routes/api/events/events.test.ts` — AC6 retrieval, cross-team isolation, member 403, the audit and activity exclusion, self-hosted `auditLog` 403, and the precedence over `auditLog`.
- `server/migrations/20261002120000-add-events-team-name-created-at-index.js` (new) — the concurrent index, with a down migration.

**Review findings breakdown** (35 findings: high 0, medium 3, low 18, false 14, maybe-false 0):
- **Patches applied:** 7 entries, all comment-only or test-only; no production logic changed in the patch round.
  - **Medium (Verification Gap):**
    - the policy fields on `lint_document`'s valid-policy non-success returns, confirmed by mutation;
    - an exact handler-level `durationMs`;
    - the precedence of `auditWikiLint` over `auditLog` (with Blind Hunter).
  - **Low:**
    - the `byCode` JSDoc on JSONB key order (Blind Hunter and Edge Case Hunter);
    - the JSDoc on timeout semantics, where the transaction may outlive the wait (Blind Hunter and Edge Case Hunter twice);
    - an end-to-end lint → `events.list` retrieval test (Blind Hunter and Intent Alignment);
    - the guest role in the role test (Blind Hunter).
- **Deferred:** none.
- **Rejected:**
  - Low:
    - background writes after expiry and the lease release at expiry: bounded by the rate limiter, AD-16 step 4 releases at expiry, and the fix adds new state;
    - recovery for an INVALID index: follows the baseline migration precedent, and recovery is a standard operator `DROP INDEX`;
    - `requestId` in HTTP logs or headers: not required, and adds public surface;
    - operator README and the crash gap in the README (two rows): no operator can reach the tools before Story 1.10, and incidental notes are forbidden;
    - fake-timer ordering in the "never settles" test: if the order broke, the test still passes, only more slowly;
    - possible flake of the "holds the scan slot" test: requires a lookup slower than 3 s;
    - `lint_wiki` role loop: attribution is role-independent.
  - False:
    - a sentinel's summary depends on readability: readable and unreadable actors record the same code; `unestablished` is a failed check;
    - `statementTimeoutMs` validation (two rows): the only input is the constant 3000;
    - closed key set at write time: only literal construction exists;
    - more attribution tests: proven over real `/mcp`;
    - `durationMs` from a -Infinity clock: unreachable with a monotonic clock;
    - Intent Alignment readings or surfaces: the awaiting-operator reading, harness `ip`, client-resend dedup, queue spy versus webhook delivery, AC9 surface, migration evidence, `DO NOTHING` versus `DO UPDATE`, and live changes before Story 1.10 — each refuted in the triage log.

**Follow-up review recommendation: false.** This was a first pass, and the patched entries were high 0, medium 3, low 4. Three medium entries were patched, but no specific unverified risk remains:
- all seven patches are comments or tests;
- the policy-field tests were shown to fail when `auditPolicy` is removed;
- the `durationMs` and precedence tests make exact assertions that ran and passed on the final tree.

**Verification performed** (final tree; test database PostgreSQL 14 at `127.0.0.1:5432/outline-test`):

| Command | Result |
| --- | --- |
| `NODE_ENV=test corepack yarn sequelize db:migrate` → `db:migrate:undo` → `db:migrate` | each exit 0, before and after the patch round; the index exists after reapply |
| `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint server/tools/wikiLint.test.ts server/routes/mcp server/routes/api/events server/middlewares` | 30 files, 1003/1003 passed |
| `TZ=UTC node_modules/.bin/vitest run --project server server/tools server/policies` | 14 files, 268/268 passed |
| `corepack yarn tsc` | exit 0 |
| `node_modules/.bin/oxlint --type-aware` on the changed paths | exit 0 |
| `node_modules/.bin/oxfmt --check` on the changed paths | all files formatted |
| `grep -rniE "laura\|ezop"` on the changed paths | no matches |

Matrix test audit: each of the 13 I/O matrix rows has a covering test in `server/tools/wikiLint.test.ts` (`audit summary`) or `server/wikiLint/adapters/auditEvents.test.ts` (retry). Each ran and passed in the runs above, and none is skipped or filtered. The readability-failure row runs the real `unestablished` path, because `readCollectionReadability` catches the injected `Collection.findByPk` rejection.

**Residual risks:**
- **Crash gap:** a crash after completion but before the audit write leaves no summary. AD-15 and D-6 accept this, and it is documented in the `insertAuditEvent` JSDoc.
- **Timed-out writes:** a write that timed out may still commit after its `timeout` diagnostic. No in-flight cap exists, so a database stall longer than 3 s lets abandoned audit transactions queue on the pool (rejected as low).
- **Write outcomes:** `ON CONFLICT DO NOTHING` covers read outcomes only. Epic 2 must add the AD-14 `DO UPDATE` overwrite clause for write-validation outcomes.
- **Not reachable yet:** the summaries are only reachable through production `/mcp` once Story 1.10 registers the tools. Until then, operator retrieval through `auditWikiLint` has nothing real to list.
- **Concurrent index on a large table:** the concurrent build on a large production `events` table takes time, and if interrupted it leaves an INVALID index to drop. This is the same as the baseline precedent, and rollout is a separate approval boundary.
