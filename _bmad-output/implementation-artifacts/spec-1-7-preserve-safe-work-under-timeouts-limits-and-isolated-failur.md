---
title: 'Story 1.7: Preserve Safe Work Under Timeouts, Limits, and Isolated Failures'
type: 'feature'
created: '2026-10-02'
status: 'done'
baseline_revision: 'feef13d0994776d5e6d17b542acd41899f491136'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      lint_wiki's unit-evaluation loop runs every unit synchronously with no await, so the whole evaluation phase blocks the worker's event loop.
    evidence: |-
      `lintWiki` iterates `wikiUnits(...)` and calls the synchronous `evaluateDocumentRules` and `evaluateGraphCheck` with no yield between units. No other request on that process is served until evaluation ends, and a client disconnect cannot be observed meanwhile. The loop has been synchronous since Story 1.5/1.6, and Story 1.7 only added a synchronous clock read per unit, so this is pre-existing. How long the block lasts at the 150- and 1,000-document profiles is unmeasured. Story 3.3 (AD-17) would settle it by measuring the evaluation duration and the maximum unit time; yielding between units (not fan-out) is the candidate fix. Raised by the Blind Hunter in the 2026-10-02 review pass.
    location: >-
      server/wikiLint/application/lintWiki.ts (unit loop over wikiUnits)
    severity: medium
  - summary: >-
      Synchronous CPU work between deadline checks (serializing and parsing up to 100 documents per keyset batch, surface serialization, one graph unit) can carry a lint_wiki run past its 60 s deadline and past the 65 s /mcp socket timeout.
    evidence: |-
      `boundBatch` checks the floor only before each database batch, and the shell checks the stop margin only before each unit. A batch whose serialization and parsing take seconds, or a long graph unit started just above the margin, is never preempted (AD-11). Whether any measured batch or unit exceeds the roughly 5 s gap between the 60 s deadline and the 65 s socket timeout is unverified. Story 3.3 would settle it by measuring the maximum batch CPU time and the maximum unit time on the AD-17 fixtures and sizing `SET_LOCAL_FLOOR_MS` and `LINT_WIKI_STOP_MARGIN_MS` to cover them. Raised by the Blind Hunter in the 2026-10-02 review pass.
    location: >-
      server/wikiLint/adapters/wikiReader.ts (keyset loop, canonicalContent); server/wikiLint/application/lintWiki.ts (stop margin)
    severity: medium (unverified)
  - summary: >-
      Connection acquisition for the lint_wiki snapshot transaction (and the scoped lookup transaction) is not charged to the request deadline, so a pool wait of up to 30 s can overrun the 63 s bound while the run holds the admission slot.
    evidence: |-
      `readOnlyTransaction` calls `sequelize.transaction`, which waits for a pool connection up to `pool.acquire = 30000` (`server/storage/database.ts:169`) before the first `boundBatch` checks the remainder. AD-11 requires connection acquisition to be charged to the phase it serves. This has been pre-existing since Story 1.5, which introduced `readOnlyTransaction`. Settle it by bounding acquisition by `deadline.remainingMs()`, or by checking the floor before opening the transaction, with a fixture that holds the pool. Raised by the Edge Case Hunter in the 2026-10-02 review pass.
    location: >-
      server/wikiLint/adapters/documentReader.ts:78 (readOnlyTransaction)
    severity: medium
---

<intent-contract>

## Intent

**Problem:** `lint_wiki` (still unregistered) runs every unit with no deadline check between units, has no stop margin, no AD-16 resource limits, and no per-process admission. The `/mcp` socket also inherits the global 10 s `REQUEST_TIMEOUT`, so a long scan is cut before its 60 s deadline. As a result, a slow or oversized scan either loses all its safe work or exhausts the process.

**Approach:**
- **Units:** check the deadline against a provisional code-owned stop margin before each AD-11 unit. On a stop, keep the finished units and add one run-wide `VALIDATION_TIMEOUT`.
- **Limits:** meter the snapshot against the five AD-16 limits and fail with `VALIDATION_RESOURCE_LIMIT_EXCEEDED`.
- **Admission:** admit one scan per process, at the AD-16 point, and release the slot in the tool handler's `finally`.
- **Socket:** raise the socket timeout for `/mcp` requests to 65 s.

## Boundaries & Constraints

**Always:**
- **Bounds:**
  - `LINT_WIKI_DEADLINE_MS` stays 60 000 and is never client-configurable.
  - New `LINT_WIKI_STOP_MARGIN_MS = 2000`, provisional until Story 3.3.
  - New `AUDIT_WRITE_BOUND_MS = 3000`, the AD-15 audit bound that Story 1.8 applies.
  - The sum of the `lint_wiki` bounds (deadline + audit) is at most 63 000 ms, under `MCP_REQUEST_TIMEOUT_MS = 65000`.
- **Socket:** the `/mcp` app's first middleware calls `ctx.req.setTimeout(MCP_REQUEST_TIMEOUT_MS)`. `env.REQUEST_TIMEOUT` and `server.setTimeout` in `server/main.ts` stay untouched, and there is no input override.
- **Unit loop** (`lintWiki`):
  - **Deadline check:** before each unit of `wikiUnits(...)`, if `deadline.remainingMs() < LINT_WIKI_STOP_MARGIN_MS`, stop. No further unit starts.
  - **Buffering:** each unit buffers its items and appends them only once it finishes. A synchronous unit is never preempted.
  - **On a stop:**
    - add one `VALIDATION_TIMEOUT` at the run location: `cs(C)` for a collection request, `scope { scopeKind: "configured_collections" }` for the default scope;
    - keep every finished unit's items, including those of a finished unit that failed;
    - unreached units add nothing, including no `graphAuthorized: false` failure.
  - The existing post-snapshot `deadline.expired()` check (a construction timeout, collections not listed) stays as it is.
- **Accounting:**
  - `requiredUnits` = `units.length`; `completedUnits` counts only fully completed units.
  - A check is listed in `completedChecks` iff every unit of it for that collection completed: all document units (or the vacuous unit), or the single graph unit.
  - Document and link counts come from completed document units, even when `documents` is not listed.
  - State comes from `buildReadOnlyResult`: `failed` with zero completed units, otherwise `incomplete`.
- **Limits:** code-owned, frozen, and never read from policy or MCP input:

  | Limit | Value | Measured as |
  | --- | --- | --- |
  | `documents` | 5000 | evaluated documents, counted after the `can(actor, "read")` filter |
  | `documentMarkdownBytes` | 1 048 576 | UTF-8 bytes of one canonical Markdown string |
  | `totalMarkdownBytes` | 67 108 864 | all serialized Markdown together |
  | `linkReferences` | 100 000 | extracted references |
  | `structureNodes` | 10 000 | object nodes, at any depth, of each `documentStructure` read |

  - **Metering:** one meter instance per snapshot. Every serialization counts, including global-index surfaces; a surface that is also an evaluated document counts twice, because it is held twice. The meter throws `WikiResourceLimitError` as soon as a sum exceeds its limit.
  - **When the meter throws:**
    - before reading the batch's content, once the document count passes its limit;
    - after serializing, and before parsing the Markdown;
    - after extracting the links;
    - after reading the structure.
  - **No swallowing:** `canonicalContent` must not turn a limit error into `"unavailable"`.
- **Limit result:**
  - The shell maps `WikiResourceLimitError` to `VALIDATION_RESOURCE_LIMIT_EXCEEDED` first, ahead of the timeout rule.
  - It reuses the run-wide snapshot-failure result: `failed`, no Findings, zero counts.
  - Readable sentinels established before the failure are kept.
- **Admission:**
  - The application module `ScanAdmission` exports one process singleton, `lintWikiAdmission`, and `lease()` returns `{ acquire(): boolean; release(): void }`. `release` is idempotent and does nothing when the lease never acquired.
  - There is no queue.
- **Admission order:**
  - `lintWiki` gets a required `admit: () => boolean`. It calls it once, after the scoped lookup and authorization, and after the sentinel, unconfigured, and empty-set returns, but before `readWikiSnapshot`.
  - The tool handler creates the lease and releases it in a `finally` around `lintWiki` and `toolResult`. Story 1.8 inserts the audit write before that release.
- **Rejection:**
  - The result is `failed` with exactly one `VALIDATION_RESOURCE_LIMIT_EXCEEDED`, no Findings, and zero counts.
  - A scoped request returns `scope { kind: "collection", collectionId, 0, 0, completedChecks: [] }`, the failure at `cs(C)`, and `policies: [identity]`.
  - A default request returns `{ kind: "configured_collections", collections: [] }`, the failure at `scope { scopeKind: "configured_collections" }`, and `policies: []`.

**Never:**
- **Out of scope:**
  - the audit write and Event (Story 1.8);
  - registering the tools on `/mcp` (Story 1.10);
  - fixing the stop margin or the floor (Story 3.3);
  - proxy and CDN timeouts (OD-7 evidence).
- **Behavior:** no change to `lint_document`, `documentReader.ts` behavior, write paths, or Story 1.5 disclosure.
- **Limits and admission:** no limit in `lint_document`; no cross-instance coordination, no wait queue, and no `Promise.all` fan-out.
- **Findings:** duration never becomes a Finding or changes severity.
- **Identifiers:** no pilot identifiers; no edits to `sprint-status.yaml`.

## I/O & Edge-Case Matrix

`C` is a valid collection and `S` a readable sentinel. "Stop before u_k" means the remainder falls below the margin while u_(k−1) runs.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Stop mid-documents | C: D1 (Error), D2, D3 + hierarchy; stop before D3 | D1 and D2 kept; `VALIDATION_TIMEOUT` at `cs(C)`; `incomplete`; counts 2; `completedChecks: []` | — |
| Stop before the first unit | the remainder is below the margin after the snapshot | `failed`; only the timeout; zero counts; C listed with zero counts | — |
| Stop after a failed unit | D1 unavailable, D2 finished, stop before hierarchy | D1's runtime failure, D2's Findings, and the timeout; `incomplete`; `completedChecks: []` | — |
| Unreached graph checks | a `graphAuthorized: false` hierarchy unit, or a vacuous one, after the stop | no failure for it; not listed | — |
| Documents done, graph cut | all documents finish; stop before `global_index` | `["documents", "hierarchy"]` listed when the hierarchy finished | — |
| Default scope + S + timeout | S readable; stop mid-run | S's `POLICY_CONFIGURATION_INVALID`, its identity, and its zero entry, plus the run-wide timeout | — |
| Resource limit | the meter throws during construction (any limit) | `failed`, `VALIDATION_RESOURCE_LIMIT_EXCEEDED` at run scope, no Findings, zero counts; S kept in the default scope | — |
| Admission busy, scoped | another scan holds the slot | the scoped rejection result; reader snapshot never called | — |
| Admission busy, default | another scan holds the slot | the default rejection result, with no sentinel | — |
| No admission needed | denied/missing scoped; scoped sentinel; scoped unconfigured; empty set | Story 1.5 outcomes even while the slot is held; `admit` not called | denial and failure stay as `isError` |
| Terminal paths | success, timeout, snapshot failure, limit, cancellation (`ClientClosedRequestError`), thrown error | the slot is released; the next call is admitted | a thrown error gives `isError` with the fixed message |

</intent-contract>

## Code Map

- `server/wikiLint/application/lintWiki.ts`:
  - `:39` `LINT_WIKI_DEADLINE_MS`.
  - `:192` `lintWiki`: the scoped lookup and policy returns are at `:225-271`, and the read call and failure mapping at `:273-369`. The code choice at `:314-321` gains the resource-limit branch first.
  - `:374-493` the accounting and unit loop, to restructure. Replace `failedChecks` with per-check pending counts.
  - `:495-507` builds `completedChecks`.
- `server/wikiLint/application/deadline.ts` -- `Deadline.remainingMs/expired`, `SET_LOCAL_FLOOR_MS`. Add `AUDIT_WRITE_BOUND_MS` here.
- `server/wikiLint/adapters/wikiReader.ts`:
  - `:144-163` `canonicalContent`: split it so the serialize and parse steps are each caught separately and the meter runs between them, outside the `try`.
  - `:272-336` the keyset loop: meter `kept.length` before `readContents`.
  - `:364-371` the structure rows: meter the node count.
  - `:410-424` surface serialization: it uses the same `canonicalContent`.
  - `:500-506` the catch that already carries the sentinels.
- `server/wikiLint/adapters/documentReader.ts:59` `isDatabaseTimeout`; unchanged.
- `server/tools/wikiLint.ts:105-124` `lintWikiTool`: add the lease, `admit: lease.acquire`, and the `finally` release.
- `server/routes/mcp/index.ts:30-62` the app and its first middleware. Add the timeout middleware above the 401 wrapper, and export `MCP_REQUEST_TIMEOUT_MS`.
- Baseline facts:
  - `server/main.ts:150` calls `server.setTimeout(env.REQUEST_TIMEOUT)`, default 10 000 (`server/env.ts:318`).
  - Node then destroys an idle socket at that limit, and resets it on the next keep-alive request.
  - `server/storage/database.ts:207-213` makes queries throw `ClientClosedRequestError` (`server/errors.ts:263`) once the socket is destroyed.
  - `web.ts:91` mounts `/mcp` with `mount("/mcp", mcp)`.
- `server/wikiLint/core/registry.ts:190-203` -- both codes exist. `VALIDATION_RESOURCE_LIMIT_EXCEEDED` is the `lint_wiki` surface, allowed in collection and configured scopes (`result.ts:86-93`).
- `server/wikiLint/core/result.ts:104` `deriveResultState`: it throws when the counts are impossible.
- Tests:
  - `application/lintWiki.test.ts`:
    - `:36-49` the rule spies;
    - `:283-334` `clock`/`now`, `fakeReader`, and `run`, where `admit` must be added;
    - `:1113-1246` the snapshot-failure block.
  - `adapters/wikiReader.test.ts`:
    - `:112-185` `fixedDeadline`, `recordStatements`, and `BOUND`;
    - `:573` the keyset-batch test, the model for an advancing-clock test.
  - `tools/wikiLint.test.ts`:
    - `:100` `connect`, which takes `wikiReader` and `clock`;
    - `:1375` the `lint_wiki` block, with `buildAdminFixture` and `recordSql`.
  - `routes/mcp/index.test.ts` with `server/test/McpHelper.ts`: `buildOAuthUser`, `mcpHeaders`, and `mcpRequest`.
- DB tests: see memory `local-test-postgres`.

## Tasks & Acceptance

**Execution:**
- `server/wikiLint/application/snapshotLimits.ts` (new) -- holds the following, all pure:
  - frozen `WIKI_SNAPSHOT_LIMITS`, with a JSDoc that records the D-9 note on the 1 MiB cap against the baseline 1 536 000-character limit;
  - `WikiResourceLimitError`, with a fixed message;
  - `SnapshotMeter(limits)`, with `addDocuments(n)`, `addMarkdown(text)`, `addLinkReferences(n)`, and `addStructureNodes(n)`.
  - Why: AD-16 makes these limits code-owned.
- `server/wikiLint/application/snapshotLimits.test.ts` (new) -- each limit at the real constants: exactly the limit passes and the limit plus one throws. Also multibyte UTF-8 byte counting, and accumulation across calls.
- `server/wikiLint/application/admission.ts` (new) and `admission.test.ts` (new) -- `ScanAdmission` and `lintWikiAdmission`, with tests that a second lease is refused while one is held, that release is idempotent, and that releasing an unacquired lease does not free another's slot.
- `server/wikiLint/application/deadline.ts` -- add `AUDIT_WRITE_BOUND_MS`.
- `server/wikiLint/adapters/wikiReader.ts`:
  - add `structureNodeCount(structure)`, which counts the object nodes the flattening walk visits;
  - wire one `new SnapshotMeter(WIKI_SNAPSHOT_LIMITS)` at the sites listed in Boundaries.
- `server/wikiLint/adapters/wikiReader.test.ts` -- an advancing-clock test (each clock reading +7 ms). Every snapshot SELECT is preceded by `SET LOCAL lock_timeout`/`statement_timeout` = floor(the remainder at that batch), never more than the remainder, and strictly decreasing. Add `structureNodeCount` cases.
- `server/wikiLint/adapters/wikiReader.limits.test.ts` (new) -- uses `vi.mock("../application/snapshotLimits")` with small limits. Each of the five limits gives `{ ok: false, error: WikiResourceLimitError }`. In the default scope, the readable sentinels established before the failure are kept. A limit error inside serialization is not reported as `"unavailable"`.
- `server/wikiLint/application/lintWiki.ts` -- the stop margin, the unit loop, accounting, the `admit` input, the rejection results, the resource-limit mapping, and JSDoc.
- `server/wikiLint/application/lintWiki.test.ts`:
  - pass `admit` through `run`;
  - cover every matrix row through the shell, advancing `now` inside a spied `evaluateDocumentRules` or `evaluateGraphCheck` call;
  - the admission order: `admit` not called for denied, sentinel, unconfigured, or empty-set requests, and called before `readWikiSnapshot`;
  - the resource-limit result, alone and with a sentinel;
  - the floor, the expiry, and the snapshot failure, each combined with a sentinel;
  - a repeated run that is `toStrictEqual`.
- `server/tools/wikiLint.ts` -- the lease, `acquire`, and the `finally` release.
- `server/tools/wikiLint.test.ts`, inside `lint_wiki`:
  - admission fixtures with an injected `wikiReader` whose `readWikiSnapshot` awaits a deferred promise:
    - while the slot is held, a scoped request and a default request get their exact rejection results;
    - a denied scoped request still gets the denial;
    - the sentinel, unconfigured, and empty-set requests are unaffected;
  - for each terminal path in the matrix, the next call is admitted;
  - a DB fixture: a collection whose `documentStructure` holds 10 001 nodes, under a hierarchy policy, gives the scoped limit result at the real constants; in the default scope with a readable sentinel, the sentinel is kept.
- `server/routes/mcp/index.ts` -- export `MCP_REQUEST_TIMEOUT_MS = 65000` and add the first-middleware socket override.
- `server/routes/mcp/requestTimeout.test.ts` (new):
  - the setup:
    - mock `@server/tools/users` to register a `slow_probe` tool that resolves after `env.REQUEST_TIMEOUT + 1000` ms;
    - serve `mount("/mcp", mcp)` plus a slow non-`/mcp` control route from `http.createServer`, with `server.setTimeout(env.REQUEST_TIMEOUT)`;
  - the assertions, run concurrently:
    - the `/mcp` `tools/call` returns 200 with the tool result after more than 10 s;
    - the control request's socket is destroyed;
    - `env.REQUEST_TIMEOUT` is unchanged;
    - `LINT_WIKI_DEADLINE_MS + AUDIT_WRITE_BOUND_MS <= 63000 < MCP_REQUEST_TIMEOUT_MS`.

**Acceptance Criteria:**
- **AC1, socket:** Given the real `/mcp` app served with `server.setTimeout(env.REQUEST_TIMEOUT)`, when a `tools/call` to a tool that takes `REQUEST_TIMEOUT + 1000` ms is sent, then:
  - it returns 200 with the tool result;
  - a non-`/mcp` request of the same duration on that server has its socket destroyed.
- **AC1, deadline propagation:** Given an advancing injected clock, when `readWikiSnapshot` runs, then every snapshot SELECT is preceded by a `SET LOCAL` pair whose value is no more than the remainder at that batch, and the values strictly decrease.
- **AC2–AC4 and AC9, timeout at the tool:** Given an injected `wikiReader` returning C with three document units (D1 defective) and a hierarchy unit, and an injected clock that crosses the stop margin after the second document unit (for example, a reading counter), when `lintWikiTool` runs for C, then:
  - the first content block is the "Stop mid-documents" result of the matrix;
  - `isError` is absent.
- **AC6 and AC8, limit at the real constants:** Given a readable C with a hierarchy policy whose `documentStructure` holds 10 001 nodes in the database, when `lint_wiki { collectionId: C }` runs, then:
  - the result is `failed`, with exactly one `VALIDATION_RESOURCE_LIMIT_EXCEEDED` at `cs(C)`;
  - errors and warnings are empty, with zero counts, `completedChecks: []`, and C's valid identity;
  - in the default scope, a readable sentinel S also keeps its failure, identity, and zero entry.
- **AC7, admission at the tool:** Given one `lint_wiki` call held inside its snapshot read, when a second scoped call and a second default call run, then:
  - each returns its exact rejection result;
  - a denied scoped call still returns the authorization-denial `isError`;
  - once the first call finishes, a third call is admitted.
- **AC11, determinism:** Given the timeout, stop-margin, resource-limit, isolated-failure, snapshot-failure, and concurrent-admission fixtures, when the suites run twice, then:
  - state, completeness, retained Findings, System Failure codes and locations, counts, `completedChecks`, and order are identical;
  - no skipped check appears as complete or clean.
- **AC10, state algebra:** Given any Warning, Error, and System Failure mix, when the state is derived, then:
  - Warnings never affect `clean`;
  - Errors prevent `clean`;
  - any System Failure makes the result `incomplete` or `failed`.

## Spec Change Log

## Review Triage Log

### 2026-10-02 — Review pass
- verdicts: 32 findings — high 0, medium 5, low 15, false 11, maybe-false 1
- findings:
  - `[medium]` `[patch]` **Blind Hunter:** the fixed 65 s override lowers a larger operator-set `REQUEST_TIMEOUT` and adds a timeout when it is 0 (disabled). — `env.REQUEST_TIMEOUT` is environment-configurable (`server/env.ts:318`), so an operator at 120 s would see every MCP tool cut at 65 s. Grouped with Edge Case Hunter (`REQUEST_TIMEOUT` > 65 s). Patched: the middleware now calls `ctx.req.setTimeout(env.REQUEST_TIMEOUT === 0 ? 0 : Math.max(env.REQUEST_TIMEOUT, MCP_REQUEST_TIMEOUT_MS))`, so it raises and never lowers, as Approach says. A new spy test asserts 120000 and 0 are kept.
  - `[low]` `[reject]` **Blind Hunter:** the socket timeout is never restored, so a later request on a reused socket keeps 65 s. — With Node's default `keepAliveTimeout` (Outline sets none), `resetSocketTimeout` restores `server.timeout` on the next keep-alive request. Only HTTP pipelining, or a zero `keepAliveTimeout`, keeps 65 s, and the effect is a longer idle allowance, not a failure. Restoring it in a `finally` could cut a still-streaming SSE response, so the fix is more than a direct correction. "Leaves it unchanged" refers to the global setting, which is indeed unchanged.
  - `[low]` `[reject]` **Blind Hunter:** the 65 s timeout also covers unauthenticated and non-lint requests. — Real, but exploiting it needs a deliberately slow anonymous client, and Node's `headersTimeout` and `requestTimeout` still bound such a client. The intent contract fixes the override as the app's first middleware ("for its own requests", AD-11), so moving it behind `auth()` would contradict the frozen spec. Grouped with Edge Case Hunter (unauthenticated requests).
  - `[low]` `[reject]` **Blind Hunter:** no operator record of which limit tripped, or of how often admission or the margin fires. — No AC requires it. The Story 1.8 audit adds `counts.byCode` per invocation, and Story 3.3 derives the margin and floor from benchmarks, not production logs. The fix would add a discriminator and logging, more than a direct correction, for a rarely reached path.
  - `[false]` `[reject]` **Blind Hunter:** a busy slot and a real limit excess return the same result. — Story 1.7 AC7 and AD-16 step 3 pin exactly this rejection: `failed` with `VALIDATION_RESOURCE_LIMIT_EXCEEDED` as the only System Failure. The identical shape is the contract, not a defect.
  - `[low]` `[reject]` **Blind Hunter:** one actor can monopolise the single per-process slot. — AD-16 fixes one slot per process with no queue and no cross-instance coordination. Each scan is bounded by its 60 s deadline, and the baseline rate limiter applies. Per-actor fairness would be new design, not a correction.
  - `[medium]` `[defer]` **Blind Hunter:** the unit loop never yields to the event loop. — True: the loop and both rule evaluators are synchronous. This has been pre-existing since Stories 1.5 and 1.6; Story 1.7 only added a per-unit clock read. How long the block lasts is unmeasured. Deferred to Story 3.3 measurements (frontmatter `deferred`).
  - `[maybe-false]` `[defer]` **Blind Hunter:** CPU stages between deadline checks can carry a run past 60 s and the 65 s socket. — Whether any batch or unit exceeds the about 5 s gap is unmeasured. The floor and margin are provisional by AD-11 and AD-17 until Story 3.3. The serialize-and-parse-per-batch structure has been pre-existing since Story 1.5. Deferred as medium (unverified); Story 3.3's maximum batch and unit times settle it.
  - `[low]` `[reject]` **Blind Hunter:** the deadline-propagation test filters `SELECT group_permissions`, and `statement_timeout` is per statement, so one batch can take more than the remainder. — The membership SELECTs belong to the same bounded batch; AD-11 bounds snapshot construction "before each batch", which `boundBatch` has done since Story 1.5. A cumulative overrun needs two consecutive statements that each nearly time out, so it is pathological. A per-statement bound would need Sequelize include hooks, not a correction. Grouped with Intent Alignment (c).
  - `[low]` `[patch]` **Blind Hunter:** the stop-margin boundary (`<` versus `<=`) is untested, and the tool-level test counts clock readings. — Patched: a boundary `it.each` checks that exactly `LINT_WIKI_STOP_MARGIN_MS` left still runs the next unit, and one millisecond less does not. The fragility half is not real: a moved stop point changes the expected result, so the tool test fails loudly rather than silently.
  - `[false]` `[reject]` **Blind Hunter:** the bounds test compares a constant with a constant. — `LINT_WIKI_DEADLINE_MS + AUDIT_WRITE_BOUND_MS <= 63000` and `63000 < MCP_REQUEST_TIMEOUT_MS` together prove the chain AC1 requires: the sum is at most 63 s, under the socket timeout. No bad outcome follows from the literal.
  - `[low]` `[patch]` **Blind Hunter:** the `documents` limit JSDoc says "Evaluated documents" but counts every readable published snapshot document, including those of collections with no `documents` check. — The measure is the intended AD-16 memory bound, but the wording could be confused with `evaluatedDocumentCount`. Patched: the JSDoc now says it counts the readable published documents in the snapshot, across all its collections, after the `read` filter.
  - `[low]` `[patch]` **Blind Hunter:** the AC11 scenario labelled "Isolated rule failure" uses unavailable content. — Grouped with Intent Alignment (g). Patched: the scenario now returns `failedKinds: ["allowed_heading_levels"]`, and the unavailable-content case is kept as its own, accurately labelled scenario.
  - `[low]` `[reject]` **Blind Hunter:** the structure is walked twice and metered only after both walks. — The structure is already in memory once the row loads, and a second linear walk is negligible beside that. An early-stopping single walk would restructure two functions without changing any outcome.
  - `[medium]` `[patch]` **Edge Case Hunter:** a `REQUEST_TIMEOUT` above 65 000 ms is lowered to 65 s on `/mcp`. — Grouped with Blind Hunter (fixed 65 s override); patched as above.
  - `[low]` `[reject]` **Edge Case Hunter:** a pipelined non-`/mcp` request on the same keep-alive socket inherits 65 s. — Grouped with Blind Hunter (socket timeout not restored). Pipelining is rare in practice, the effect is only a longer idle allowance, and restoring the timeout risks cutting a still-streaming SSE response.
  - `[low]` `[reject]` **Edge Case Hunter:** unauthenticated, rate-limited, GET, and non-lint `/mcp` requests get 65 s. — Grouped with Blind Hunter (unauthenticated requests); rejected for the same reason.
  - `[low]` `[reject]` **Edge Case Hunter:** a client disconnect or MCP cancel does not stop the scan, because `/mcp` has no `requestContext`. — Confirmed: `requestContextMiddleware` is mounted only on `/api` (`server/routes/api/index.ts:61`). The orphaned scan still ends within its 60 s deadline and releases the slot in the handler's `finally`, so the slot is released after a cancellation, only later. Early abort would need signal plumbing through the shell and adapter, not a correction.
  - `[medium]` `[defer]` **Edge Case Hunter:** pool acquisition for the snapshot transaction is not charged to the deadline. — `pool.acquire` is 30 000 ms (`server/storage/database.ts:169`), and `readOnlyTransaction` acquires a connection before the first `boundBatch`. This has been pre-existing since Story 1.5. Deferred (frontmatter `deferred`).
  - `[low]` `[reject]` **Edge Case Hunter:** a remainder of exactly 0 versus a remainder below the margin after the snapshot gives different scope and policy shapes. — Both are valid AD-12 results, with the same state, code, and location. The split is the spec's deliberate choice: post-snapshot expiry is a construction timeout (AD-10), and a below-margin stop is the AD-11 unit-loop timeout. Changing it means editing the frozen spec.
  - `[false]` `[reject]` **Edge Case Hunter:** a lease can re-acquire after release. — No path calls `acquire` after `release`. The lease is local to one `lintWikiTool` call, `lintWiki` calls `admit` at most once, and `release` runs only in the handler's `finally` after `lintWiki` has returned.
  - `[false]` `[reject]` **Edge Case Hunter (claim):** no test proves a stop-margin or expiry run releases the slot. — Release sits in `finally { lease.release() }`, which every return path from `lintWiki` passes, whatever the outcome kind. Also, the tool test that follows the stop-margin tool test expects a 10 000-node structure to complete, which an admission rejection would fail.
  - `[medium]` `[patch]` **Verification Gap:** no test proves the `documents` limit counts only rows that pass `can(actor, "read")`. — Pre-verified by the layer: with all fixture rows readable, metering `batch.length` would go unnoticed and could disclose unreadable documents through the limit outcome. Patched: a new case "counts only the documents that pass the read filter", in which an admin reads a private collection with one membership-readable and two unreadable documents. It returns `{ ok: true }` at `limits.documents = 1` and fails at 0. Changing the code to `batch.length` was confirmed to fail it.
  - `[false]` `[reject]` **Intent Alignment (a):** no test runs `lint_wiki` over HTTP `/mcp`. — The epic gives tool registration and discovery to Story 1.10 ("discovery stays off until Story 1.10"). The 1.7 tests exercise the production handler `lintWikiTool`.
  - `[false]` `[reject]` **Intent Alignment (b):** the socket test builds its own server. — It reproduces production exactly: `server.setTimeout(env.REQUEST_TIMEOUT)` from `server/main.ts:150` and `mount("/mcp", mcp)` from `server/services/web.ts:91`. Socket reuse is covered by the rejected keep-alive row above.
  - `[low]` `[reject]` **Intent Alignment (c):** the AC1 propagation test leaves out the membership statements, and the audit stage is unbounded. — Grouped with Blind Hunter (per-statement `statement_timeout`), rejected the same way. The pre-admission lookup's bounded batch is covered by the Story 1.5 test "authorizes in one bounded read-only transaction". The audit stage belongs to Story 1.8.
  - `[false]` `[reject]` **Intent Alignment (d):** the AC7 audit clauses are absent. — The epic places the audit write and its admission-rejection columns in Story 1.8 (its AC10 lists "an admission rejection for a scoped request … and a default request"). The release hook sits where 1.8 inserts the audit write.
  - `[false]` `[reject]` **Intent Alignment (e):** the terminal paths are injected outcomes. — Each injected outcome reaches the same handler code as its natural source, and release does not depend on the outcome kind (`finally`).
  - `[false]` `[reject]` **Intent Alignment (f):** only the structure-node limit is tested at a real constant against the database. — `snapshotLimits.test.ts` pins all five frozen real constants at limit and limit+1, and `wikiReader.limits.test.ts` proves each wiring site. `lint_document` (`documentReader.ts`) is untouched and never constructs a meter.
  - `[low]` `[patch]` **Intent Alignment (g):** AC11 determinism repeats only shell-level scenarios, and its "rule failure" scenario was unavailable content. — Grouped with Blind Hunter (rule-failure scenario); patched as above. The suites themselves were also run repeatedly in verification: twice by the implementer and again after the patch.
  - `[false]` `[reject]` **Intent Alignment (h):** AC10 has no new test, and nothing asserts that duration never becomes a Finding. — The state algebra is `deriveResultState` and `buildReadOnlyResult`, which `result.test.ts` covers (Story 1.1) and this diff leaves untouched. No code path computes a duration value into an issue.
  - `[false]` `[reject]` **Intent Alignment (i):** should the status be `awaiting-operator`? — No. "Proxy and CDN read timeouts remain OD-7 evidence" means deferred: `epics.md:104` keeps OD-7 deferred to Gates 2 and 3, and the spine gives it to the release operator. No acceptance criterion of this story needs a human action outside the repo.

## Design Notes

**The loop** (sketch):

```ts
const units = wikiUnits(snapshot, checksOf);
let stopped = false;
for (const unit of units) {
  if (deadline.remainingMs() < LINT_WIKI_STOP_MARGIN_MS) { stopped = true; break; }
  const buffer: IssueItem[] = []; /* evaluate into buffer */ items.push(...buffer);
  if (completed) { completedUnits++; account.pending.set(check, account.pending.get(check)! - 1); }
}
if (stopped) items.push({ issue: createSystemFailure("VALIDATION_TIMEOUT", runLocation) });
// buildReadOnlyResult({ requiredUnits: units.length, completedUnits, ... })
```

**Counting what is held.** The limits guard memory. A surface is serialized and parsed separately from its evaluated copy, so counting both copies keeps the meter honest. Documents are counted after the read filter, so the limit outcome never depends on rows the actor cannot read.

**Admission across Stories 1.7 and 1.8.** The slot must outlive `lintWiki`, because the audit write (Story 1.8) needs the result while still holding the slot. A lease created by the tool and acquired by `lintWiki` keeps AD-16's order inside the shell, while the release stays at the handler's terminal `finally`.

## Verification

**Commands:**
- `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint server/tools/wikiLint.test.ts server/routes/mcp` -- expected: all pass on the migrated test Postgres.
- `TZ=UTC node_modules/.bin/vitest run --project server server/tools` -- expected: the baseline MCP tests are unaffected.
- `corepack yarn tsc` -- expected: exit 0.
- `node_modules/.bin/oxlint --type-aware server/wikiLint server/tools/wikiLint.ts server/tools/wikiLint.test.ts server/routes/mcp` -- expected: 0 errors.
- `node_modules/.bin/oxfmt --check server/wikiLint server/tools/wikiLint.ts server/tools/wikiLint.test.ts server/routes/mcp` -- expected: clean.
- `grep -rniE "laura|ezop" server/wikiLint server/tools/wikiLint*.ts server/routes/mcp` -- expected: no matches.

## Auto Run Result

Status: done

**Summary.** `lint_wiki`, still unregistered on `/mcp`, now keeps its safe work under the AD-11 and AD-16 bounds.
- **Stop margin:**
  - A code-owned, provisional `LINT_WIKI_STOP_MARGIN_MS` (2 s) is checked before every AD-11 unit.
  - On a stop, every finished unit is kept, failed ones included; each unit buffers its issues until it finishes. One run-wide `VALIDATION_TIMEOUT` is added, and the result is `failed` or `incomplete`.
  - `completedChecks` lists a check only when all of its units completed. Counts come from completed document units only.
- **Resource limits:**
  - A per-snapshot `SnapshotMeter` enforces the five frozen AD-16 limits: 5,000 documents counted after the read filter, 1 MiB per Markdown string, 64 MiB of total Markdown, 100,000 link references, and 10,000 structure nodes.
  - An excess fails the run with `VALIDATION_RESOURCE_LIMIT_EXCEEDED`, no Findings, and zero counts, while keeping readable sentinels.
- **Admission:**
  - A per-process `lintWikiAdmission` slot is acquired after the scoped lookup and authorization and after the sentinel, unconfigured, and empty-set returns, but before the snapshot.
  - A busy slot returns the pinned AD-16 rejection.
  - The tool handler releases the slot in `finally`, which is where Story 1.8 will insert the audit write.
- **Socket timeout:** the `/mcp` app raises the request socket timeout to at least 65 s. It never lowers a larger `REQUEST_TIMEOUT`, keeps a disabled one, and leaves the global setting unchanged.

**Files changed:**
- `server/wikiLint/application/snapshotLimits.ts` (new) — frozen AD-16 limits, with the D-9 note; `WikiResourceLimitError`; and `SnapshotMeter`.
- `server/wikiLint/application/snapshotLimits.test.ts` (new) — each limit at its real constant (at the limit and one above), UTF-8 byte counting, and accumulation.
- `server/wikiLint/application/admission.ts` (new) — `ScanAdmission` leases and the process singleton `lintWikiAdmission`.
- `server/wikiLint/application/admission.test.ts` (new) — exclusivity, idempotent release, and an unacquired release.
- `server/wikiLint/application/deadline.ts` — `AUDIT_WRITE_BOUND_MS = 3000`, the AD-15 bound that Story 1.8 applies.
- `server/wikiLint/application/lintWiki.ts`:
  - the stop margin, the per-unit deadline check, buffering, and pending-count accounting;
  - the `admit` input and the shared run-wide failure builder;
  - limit mapping ahead of the timeout rule.
- `server/wikiLint/application/lintWiki.test.ts` — every matrix row, the margin boundary, the admission order and rejections, limits and sentinel combinations, and repeated-run determinism.
- `server/wikiLint/adapters/wikiReader.ts`:
  - meter wiring at all four sites, with `canonicalContent` split so a limit error is never reported as `"unavailable"`;
  - `structureNodeCount`.
- `server/wikiLint/adapters/wikiReader.test.ts` — the advancing-clock `SET LOCAL` propagation test and `structureNodeCount` cases.
- `server/wikiLint/adapters/wikiReader.limits.test.ts` (new) — the wiring of each limit under mocked small limits, the read-filter counting, a surface counted twice, and sentinel retention.
- `server/tools/wikiLint.ts` — the admission lease, with release in `finally`.
- `server/tools/wikiLint.test.ts` — the following tool-level tests:
  - a stop-margin timeout;
  - the DB structure-node limit at the real constant (10,000 nodes completes, 10,001 fails), with the sentinel kept;
  - concurrent admission;
  - slot release on six terminal paths.
- `server/routes/mcp/index.ts` — `MCP_REQUEST_TIMEOUT_MS` and the raise-only socket-timeout middleware.
- `server/routes/mcp/requestTimeout.test.ts` (new) — a real-server fixture: an `/mcp` call taking more than 10 s returns 200, while a control request is cut at `REQUEST_TIMEOUT`. Also the raise-only cases and the bound arithmetic.

**Review findings breakdown** (32 findings: high 0, medium 5, low 15, false 11, maybe-false 1):
- **Patches applied:** 5 entries.
  - **Medium:**
    - the `/mcp` override now only raises the timeout (Blind Hunter and Edge Case Hunter);
    - a read-filter counting test for the `documents` limit (Verification Gap).
  - **Low:**
    - a stop-margin boundary test;
    - an accurate JSDoc for the `documents` limit;
    - a real rule-failure scenario in the determinism set (Blind Hunter and Intent Alignment).
- **Deferred:** 3 entries, all pre-existing since Story 1.5 or 1.6, in frontmatter `deferred`:
  - the synchronous unit loop blocks the event loop (medium);
  - CPU stages between deadline checks may overrun the socket timeout (medium, unverified; Story 3.3);
  - pool acquisition is not charged to the deadline (medium).
- **Rejected:**
  - Low:
    - socket timeout not restored, or a pipelined request inheriting 65 s: rare, the effect is only a longer idle allowance, and a fix risks cutting SSE;
    - unauthenticated requests get 65 s (two rows): bounded by Node's header and request timeouts, and the spec fixes the first-middleware placement;
    - no operator record of which limit tripped: not required, Story 1.8 adds `byCode`;
    - no per-actor fairness for the slot: AD-16 design;
    - per-statement `statement_timeout` for membership SELECTs (two rows): AD-11 bounds per batch, and an overrun is pathological;
    - the structure walked twice: negligible cost;
    - cancellation not stopping the scan: still bounded by the 60 s deadline and released in `finally`;
    - different shapes at a 0 remainder and a below-margin remainder: both valid AD-12 results, as the spec chose.
  - False:
    - a busy slot and a limit excess look the same: AC7 pins it;
    - the bounds test compares constants: it proves the AC1 chain;
    - a lease can re-acquire: unreachable;
    - no release proof for the stop-margin path: `finally` covers every path;
    - Intent Alignment (a), (b), (d), (e), (f), (h), (i): registration is Story 1.10, audit is Story 1.8, the fixture mirrors production, all five constants are pinned, Story 1.1 covers the algebra, and OD-7 is deferred evidence, not an owed operator action.

**Follow-up review recommendation: false.** This was a first pass, and the patched entries were high 0, medium 2, low 3. Two medium entries were patched, but no specific unverified risk remains:
- one of them is test-only, and changing the code to meter `batch.length` was shown to fail the new test;
- the other is a one-expression production change, verified by a spy test for `REQUEST_TIMEOUT` values of 120000 and 0 and by the real-socket test above 10 s.

**Verification performed** (final tree; test database PostgreSQL 14 at `127.0.0.1:5432/outline-test`, migrated):

| Command | Result |
| --- | --- |
| `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint server/tools/wikiLint.test.ts server/routes/mcp` | 22 files, 855/855 passed |
| `TZ=UTC node_modules/.bin/vitest run --project server server/tools` | 8 files, 151/151 passed |
| `corepack yarn tsc` | exit 0 |
| `node_modules/.bin/oxlint --type-aware` on the changed paths | exit 0, no diagnostics |
| `node_modules/.bin/oxfmt --check` on the changed paths | clean |
| `grep -rniE "laura\|ezop" server/wikiLint server/tools/wikiLint*.ts server/routes/mcp` | no matches |

Matrix test audit: each of the 11 I/O matrix rows has at least one covering test, in `lintWiki.test.ts` (stop margin, resource limit, admission, and snapshot-failure-with-sentinel blocks) and `tools/wikiLint.test.ts` (bounds and admission). Each covering test ran and passed in the runs above; none is skipped or filtered. With the socket override temporarily removed, the `/mcp` test failed; with it restored, it passed.

**Residual risks:**
- **Provisional constants:** `LINT_WIKI_STOP_MARGIN_MS` (2 s) and `SET_LOCAL_FLOOR_MS` stay provisional until Story 3.3. The deferred CPU-overrun and event-loop items depend on those measurements.
- **Audit release:** the admission slot is released in the handler's `finally`. Story 1.8 must insert the bounded audit write before that release to meet "released once the audit write settles".
- **OD-7:** proxy and CDN read timeouts of at least 65 s remain deployment evidence (OD-7, Gates 2 and 3). Nothing in the repo can enforce them.
- **Slow fixture:** `requestTimeout.test.ts` really waits about 11 s.
- **Shared slot in tests:** the admission tests use the real process singleton, which relies on Vitest giving each test file its own module instance.
