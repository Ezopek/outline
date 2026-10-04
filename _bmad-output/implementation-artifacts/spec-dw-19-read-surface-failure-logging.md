---
title: 'DW-19: Log unmodellable lint_document and lint_wiki failures for the operator'
type: 'feature'
created: '2026-10-04'
baseline_revision: 6c9aecb2ccfa83a1e1eac62d0b55f217a73b2814
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** A `lint_document` or `lint_wiki` call that fails without a lint result returns the fixed `OPERATION_FAILED` tool-execution error and leaves no operator trace. This happens when the pre-snapshot lookup throws (`{ kind: "failed" }` at `lintDocument.ts:186-188` and `lintWiki.ts:251-253`) or when the tool shell catches a throw (`server/tools/wikiLint.ts:118-120`, `:171-173`), for example a `WikiLintContractError` or a failing clock. The shells generate an `invocationId` (`:90`, `:142`) but never log it (DW-19; Epic 1 retro F-6, read side).

**Approach:** The `failed` outcome carries its `cause`. The two tool handlers send every unmodellable failure through one helper. The helper emits exactly one guarded `Logger.warn` with only `requestId`, `invocationId`, and the error class name, then returns the unchanged `error(OPERATION_FAILED)`. Collocated tests assert the exact log call, and that the call holds nothing else.

## Boundaries & Constraints

**Always:**
- Message: `"lint_document failed without a lint result"` or `"lint_wiki failed without a lint result"`. Extra: exactly `{ requestId, invocationId }`, plus `errorClass` (`cause.constructor.name`) only when the cause is an `Error` instance.
- `requestId` is always present. It is the `AuthInfo.extra.requestId` string when that matches `UUID_PATTERN` (`server/wikiLint/core/registry.ts:250`), as `recordReadAudit` validates it (`readAudit.ts:206-210`), and `undefined` otherwise.
- `invocationId` is the handler's own `randomUUID()`. Generate it before the `try`, so the catch can log it.
- Log exactly once for each call that ends in `error(OPERATION_FAILED)`. A throwing `Logger.warn` is swallowed, and the tool result stays the fixed message.
- `{ kind: "failed" }` becomes `{ kind: "failed"; cause: unknown }`. Both producers pass the caught value unchanged. The cause reaches only the log helper.
- Every tool result, audit summary, admission lease release, and modelled outcome stays unchanged.
- A modified `_bmad-output/implementation-artifacts/deferred-work.md` is the orchestrator's pending ledger transaction. Do not stage, edit, revert, or commit it.

**Never:**
- Do not log the error's message, stack, `cause`, `parent`, or any other property. Do not log input, content, titles, or document, collection, user, team, or policy identifiers.
- Do not log modelled outcomes. That covers a lint result of any state, including System Failures such as `VALIDATION_RUNTIME_FAILED` from a snapshot failure (`lintWiki.ts:379-403`, `lintDocument.ts:286-296`), and the `denied` / missing-target authorization error.
- Do not add a logger to `server/wikiLint/core/` (the Spine forbids it). Do not change `readAudit.ts`, the enforced write path (DW-9 covers it), `server/tools/documents.ts`, the MCP tool descriptions, or the input schemas.
- Do not weaken existing assertions, create new test files or directories, or edit the deferred-work ledger or sprint board.

## I/O & Edge-Case Matrix

Calls go directly to `lintDocumentTool` / `lintWikiTool` with a context like the one `/mcp` fills: `extra: { user, requestId: randomUUID(), credentialAuthType: "api" }`. `ctxId` is that `requestId`; `uuid` is a v4 UUID that differs from `ctxId`.

| Scenario | Input / State | Expected `Logger.warn` calls with the message | Tool result |
|----------|--------------|---------------------------|----------------|
| Document lookup throws | injected `authorizeLintTarget` rejects a test `Error` subclass whose message holds a marker | `[["lint_document failed without a lint result", { requestId: ctxId, invocationId: uuid, errorClass }]]`, where `errorClass` is the subclass's `constructor.name`; no marker | `OPERATION_FAILED`, `isError: true` |
| Shell catch (document) | `clock` throws a test `Error` subclass | one call, `errorClass` = that subclass name | `OPERATION_FAILED` |
| Non-Error cause | injected `authorizeLintTarget` rejects a plain string | one call `{ requestId: ctxId, invocationId: uuid }`, no `errorClass` key | `OPERATION_FAILED` |
| Collection lookup throws | injected `authorizeLintCollection` rejects a test `Error` subclass | `[["lint_wiki failed without a lint result", { requestId: ctxId, invocationId: uuid, errorClass }]]`, with the subclass's `constructor.name` | `OPERATION_FAILED` |
| Contract violation | `lint_wiki` snapshot returns a collection outside the policy set | one `lint_wiki` call with `errorClass: "WikiLintContractError"` | `OPERATION_FAILED` |
| Invalid or absent request ID | `extra.requestId` is a non-UUID string, or missing | one call with `requestId: undefined` | `OPERATION_FAILED` |
| Logger throws | `Logger.warn` throws on a failing call | the spy was called once with the message | `OPERATION_FAILED` |
| Two failing calls | the same failure twice | two different `invocationId` values | `OPERATION_FAILED` twice |
| Real `/mcp` request | route test: `authorizeLintTarget` and `authorizeLintCollection` on the default readers reject `DeadlineFloorError` or `Error` | one call per tool, in call order, with `requestId` and `invocationId` matching `UUID_PATTERN` and `errorClass` = the class name | `OPERATION_FAILED` |
| Modelled outcomes | denied target on both tools; `lint_wiki` snapshot read throws (`VALIDATION_RUNTIME_FAILED` result); a clean result | no call with either message | unchanged |

</intent-contract>

## Code Map

- `server/tools/wikiLint.ts:56-72` -- `toolResult`; its `default` branch maps `failed` to `error(OPERATION_FAILED)`. Route that branch through the helper (for example as a callback parameter), so one helper produces both fixed-message paths.
- `server/tools/wikiLint.ts:84-121`, `:135-176` -- the handlers. Move `const invocationId = randomUUID()` above `try`. Each catch returns the helper's result. In `lintWikiTool`, `lease` and `finally { lease.release() }` stay as they are. Update the doc comments: an unmodellable failure is logged with only the correlation and error class.
- `server/tools/wikiLint.ts:30-31` -- imports; add `Logger` (`@server/logging/Logger`), `UUID_PATTERN` beside `OPERATION_FAILED`, and `type ReadOperation` from `readAudit`.
- `server/wikiLint/application/enforcedWrite.ts:500-517` -- the guarded `warn` from DW-9 to mirror: `try { Logger.warn(...) } catch {}`, and `...(cause instanceof Error && { errorClass: cause.constructor.name })`. Read-only.
- `server/wikiLint/application/readAudit.ts:206-210`, `:246-256` -- requestId validation and the audit-failure log on the same surface; keep the field naming consistent with them. Read-only.
- `server/wikiLint/application/lintDocument.ts:70-83`, `:184-188` -- the `LintDocumentOutcome` union and the `catch` that returns `failed`. `LintWikiOutcome` aliases it (`lintWiki.ts:83`), and `readAudit.ts:23-26` extracts only `result`.
- `server/wikiLint/application/lintWiki.ts:245-253` -- the `catch` that returns `failed`.
- `server/routes/mcp/wikiLint.test.ts:1356-1392` -- the end-to-end `/mcp` test "returns the fixed failure message when the target lookup fails with %s"; it spies the default readers and calls both tools through the real route with an OAuth token. `UUID_PATTERN` is imported (`:53`), and `afterEach` restores mocks (`:691-695`). `:2781-2808` asserts the full `Logger.warn` call list for an audit failure on a lint result; a modelled result must keep that list unchanged.
- `server/wikiLint/application/lintDocument.test.ts:328-333`, `lintWiki.test.ts:521-530` -- the only `{ kind: "failed" }` assertions; `fakeReader` throws the given instance (`lintDocument.test.ts:171-199`, `lintWiki.test.ts:312-329`).
- `server/tools/wikiLint.test.ts` -- these pieces exist already: `policySetFor` (`:109`) and `structurePolicy` (`:86`), `contextOf` inside `describe("audit summary")` (`:3516-3523`), and the contract-violation snapshot (`:3299-3311`). The existing unmodellable tests are at `:784` and `:1846`, and the UUID v4 regex at `:4513-4515`. `afterEach` restores mocks (`:372-375`), and the audit-failure filter-by-message pattern is at `:4466-4468`. The "with Finding detail" test (`:4278+`) scans every Logger call for detail values; it stays green because the new log holds none.

## Tasks & Acceptance

**Execution:**
- `server/wikiLint/application/lintDocument.ts` -- widen `failed` to `{ kind: "failed"; cause: unknown }`, documenting that the cause is for the operator log only. Return `{ kind: "failed", cause }` from the lookup catch.
- `server/wikiLint/application/lintWiki.ts` -- return `{ kind: "failed", cause }` from the collection-lookup catch.
- `server/tools/wikiLint.ts` -- add the guarded log helper. It takes the operation, context, `invocationId`, and cause, and returns `error(OPERATION_FAILED)`. Wire it into `toolResult`'s `failed` branch and both catches as the Code Map describes, and update the doc comments.
- `server/wikiLint/application/lintDocument.test.ts`, `server/wikiLint/application/lintWiki.test.ts` -- change the two `failed` assertions to `toStrictEqual({ kind: "failed", cause: <the thrown instance> })`.
- `server/tools/wikiLint.test.ts` -- add a top-level `describe("operator log")` covering every matrix row. Filter `Logger.warn` calls by the two messages, and assert them with `toStrictEqual` against the full `[message, extra]` list. Silence the spy with `mockImplementation(() => undefined)` unless the row needs it to throw. Reuse the existing helpers. Hoisting `contextOf` to module scope is acceptable.
- `server/routes/mcp/wikiLint.test.ts` -- in the test at `:1356-1392`, spy `Logger.warn` (silenced). After the loop, assert that the calls filtered by the two messages `toStrictEqual` the matrix row "Real `/mcp` request". Keep every existing assertion.

**Acceptance Criteria:**
- Given any matrix row, when the handler returns, then the filtered `Logger.warn` calls `toStrictEqual` the listed calls (or none), and the tool result equals the listed one.
- Given the pre-change `server/tools/wikiLint.ts`, when the new log assertions run, then every one fails except the modelled-outcome row.
- Given the lint tool, lint application, read-audit, and MCP route suites, when they run against the test database, then every test passes, including the existing fixed-message, audit, and Finding-detail tests.
- Given the changed files, when format, lint, and type-check run, then they report no new problems.

## Spec Change Log

## Review Triage Log

### 2026-10-04 — Review pass
- verdicts: 19 findings — high 0, medium 0, low 13, false 6, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind Hunter: nothing ties the logged `requestId`/`invocationId` to a user report, because a failed call writes no audit row and the span carries no `invocationId`. — Where Datadog is configured, `logInjection: true` (`server/logging/tracer.ts:51`) attaches the `withTracing` span to the line, and that span is tagged with tool, user, and team. Any other correlation would need a new identifier surface beyond the three fields the intent allows, which is more than a direct correction.
  - `[low]` `[reject]` Blind Hunter: the log does not say where the failure happened (lookup or shell catch). — The intent says the log carries "only invocationId/requestId and the error class name", so a `stage` field contradicts it. DW-9 rejected a failure-point field on the same basis.
  - `[low]` `[reject]` Blind Hunter: `errorClass` is not validated. An own `constructor` property, an anonymous class (`""`), or a throwing getter could log odd data or drop the line. — Not reachable in practice: the causes come from Sequelize, pg, http-errors, the deadline module, and `WikiLintContractError`. A per-field guard adds branches, and DW-9's accepted helper uses the same pattern. Grouped with the two Edge Case Hunter `constructor.name` findings.
  - `[low]` `[patch]` Blind Hunter: the application tests' `toStrictEqual({ kind: "failed", cause })` uses Vitest error equality, so a new error of the same class would pass. — Patched: both tests now also assert `outcome.cause` with `toBe` against the thrown instance.
  - `[false]` `[reject]` Blind Hunter: the leak checks spy only `Logger.warn`, and the route test never checks that "raw detail" is absent. — The helper is the only Logger call the change adds. Every assertion `toStrictEqual`s the full `[message, extra]` list, whose values are the context `requestId`, UUID matchers, and a class name, so the message text and identifiers are proven absent.
  - `[low]` `[reject]` Blind Hunter: no test runs a real default-reader failure through the log, and existing fixed-message tests now print an unsilenced warn line. — The logged class is whatever reaches the shell, through the generic `constructor.name`. The route test drives the production `/mcp` wiring with the default readers. The console line is harmless noise, and silencing it would mean editing several pre-existing tests the intent does not touch.
  - `[low]` `[patch]` Blind Hunter: the `lint_document` snapshot failure, a modelled outcome the spec's Never rule names, has no no-log test; the non-Error and uppercase-UUID variants are untested. — Patched the first part: "logs nothing for a modeled outcome" now also runs a `lintDocumentTool` whose `readDocumentSnapshot` throws, and asserts a non-`isError` `VALIDATION_RUNTIME_FAILED` result and no log. The other variants take the same shared-helper branch already covered, so they were not added.
  - `[low]` `[reject]` Blind Hunter: the `requestId` UUID check is duplicated from `readAudit.ts:206-210`. — The two copies diverge only for a non-UUID `requestId`, which `/mcp` never produces (`randomUUID()`, `server/routes/mcp/index.ts:213`). A shared helper means an exported function plus a `readAudit.ts` refactor, more than a direct correction.
  - `[false]` `[reject]` Blind Hunter: the route test would pass if `requestId` were logged in both fields. — The unit tests reject that regression: the two lookup tests assert `invocationId` differs from `requestId`, and "fresh invocation ID" asserts three distinct values.
  - `[low]` `[reject]` Edge Case Hunter: `randomUUID()` now runs before the `try`, so a throw there escapes unlogged. — Node's `randomUUID` throws only on an OpenSSL entropy failure. The spec generates the ID before the `try` so the catch can log it, and guarding it needs a mutable binding. Grouped with the Intent Alignment throws-outside-the-handler finding.
  - `[low]` `[reject]` Edge Case Hunter: reading `cause.constructor` or `.name` can throw, which skips the whole warn. — Grouped with the Blind Hunter `errorClass` finding and rejected on the same evidence.
  - `[low]` `[reject]` Edge Case Hunter: an anonymous Error class logs `errorClass: ""`. — Grouped with the Blind Hunter `errorClass` finding and rejected on the same evidence.
  - `[false]` `[reject]` Edge Case Hunter: if `success(outcome.result)` throws after the audit, one `invocationId` has both an audit row and a failure log. — `success` stringifies a result that `buildReadOnlyResult` builds from strings, numbers, booleans, and arrays, so no BigInt or cycle can reach it. Even then, both records would be true, and auditing before the return is pre-existing.
  - `[low]` `[patch]` Edge Case Hunter: the logger-throws test maps calls to messages and never checks the extra. — Patched: it now `toStrictEqual`s the filtered calls against the full `[message, extra]` list for both tools, each with its own context `requestId`.
  - `[low]` `[reject]` Intent Alignment (A2): throws outside the handler's `try` (`withTracing`'s pre-handler code, the hoisted `randomUUID`) reach the SDK unlogged. — Not reachable in practice: `withTracing` reads a property and tags a span, and is shared tool code outside the named shells. Grouped with the Edge Case Hunter `randomUUID` finding.
  - `[low]` `[reject]` Intent Alignment (A3): raw snapshot-time errors collapsed into `VALIDATION_RUNTIME_FAILED` are not logged, although F-6 cited `lintWiki.ts:379-381`. — The intent limits the log to "unmodellable failure that maps to the fixed message or a tool-execution error". These are modelled lint results, counted in the audit `byCode`, so the intent excludes them. The missing `lint_document` negative test is the separate Blind Hunter finding, patched there.
  - `[false]` `[reject]` Intent Alignment (B2): the application files named as shells get no Logger call. — Every `failed` they produce reaches the tool shell's helper with its cause and is logged exactly once. The application files hold no correlation IDs, and the lookup tests on both tools prove the log.
  - `[false]` `[reject]` Intent Alignment (C): UUID validation, the explicit `requestId: undefined`, no `errorClass` for a non-Error, and the operation in the message are unstated choices. — Each is recorded in the spec's Always rules and Design Notes. None adds a field beyond the intent's three, so it describes no bad outcome.
  - `[false]` `[reject]` Intent Alignment (D): the tests stop at `Logger.warn`, spy only `warn`, and the route test covers only the lookup path. — The helper is the single Logger call site. The route test proves the production wiring of `requestId` and the class name, and the direct-call tests prove every other path reaches the same helper. DW-9 and `readAudit` use the same boundary.

### 2026-10-04 — Follow-up review pass
- verdicts: 12 findings — high 0, medium 0, low 5, false 7, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind Hunter: an overridden `Error.constructor.name` can suppress the warning or expose text. — Carried: the previous review found this unreachable for the dependency errors that reach these handlers; the guarded helper also preserves the fixed tool result if property access throws. A defensive extraction adds complexity without a demonstrated everyday failure.
  - `[low]` `[reject]` Blind Hunter: `randomUUID()` outside the handler `try` can escape without a fixed result. — Carried: the previous review found only an OpenSSL entropy failure could trigger it, and the intent requires the ID before `try` for catch logging; an additional guard is disproportionate to this path.
  - `[false]` `[reject]` Blind Hunter: the `default` branch could silently log a future modelled outcome. — The current `LintDocumentOutcome` union has only `result`, `denied`, and `failed`; a new variant without `cause` makes `outcome.cause` fail TypeScript checking. No current modelled outcome reaches the branch.
  - `[false]` `[reject]` Blind Hunter: filtering warnings lets a second failure warning pass. — `failedWithoutResult` is the only call site for these failure messages, and each handler reaches it once per failed call. The filter intentionally leaves other warning types outside this contract.
  - `[false]` `[reject]` Blind Hunter: the modelled-outcome test could miss an unrelated warning. — The contract forbids these two failure warnings for modelled outcomes; `readAudit.ts` may legitimately warn about an audit write failure. The test asserts the specified warning absence, and the application path never invokes `failedWithoutResult` for a modelled result.
  - `[false]` `[reject]` Blind Hunter: repeated `lint_wiki` failures could reuse an invocation ID without test coverage. — `lintWikiTool` calls `randomUUID()` for every invocation through the same pattern as `lintDocumentTool`; the stated reuse cannot occur through this code path, and the test already proves the per-call invariant for the shared pattern.
  - `[false]` `[reject]` Blind Hunter: a contract violation may retain the scan admission lease. — `lintWikiTool` releases the lease in `finally` on every return or throw, including `WikiLintContractError`; `admission.test.ts` independently covers release behavior.
  - `[false]` `[reject]` Blind Hunter: the route test cannot prove the logged request ID came from that request. — `server/routes/mcp/index.ts` creates `requestId: randomUUID()` in private `AuthInfo.extra`, passes that context to the handler, and the helper reads that exact field; direct-handler tests assert exact equality for known context IDs.
  - `[low]` `[reject]` Blind Hunter: the spec's `## Verification` lists expected rather than observed outcomes. — Its section defines commands, while `## Auto Run Result` records the actual outcomes for this pass. The requested fix edits this build's spec, so no implementation patch is warranted.
  - `[low]` `[reject]` Edge Case Hunter: a throwing `constructor` or `name` getter suppresses the warning. — Carried: this is the same constructor-name claim as the first finding and prior review, with no reachable dependency cause shown; the fixed result survives the guarded logger block.
  - `[low]` `[reject]` Edge Case Hunter: `randomUUID()` before `try` can escape the shell. — Carried: this is the same entropy-failure claim as the second finding and prior review; the intent specifies generation before `try`.
  - `[false]` `[reject]` Intent Alignment Auditor: an operator-visible trace may require more than a `Logger.warn` call, while the tests spy at that boundary. — Carried: the intent's explicit acceptance surface is the exact `Logger.warn` call and the route test exercises real `/mcp` handler wiring; delivery beyond the logger is outside that stated behavior.

## Design Notes

The log sits in the tool shell, which alone holds `invocationId` and the request context. The core may not import a logger, and the application functions see neither identifier. Carrying `cause` on `failed` is the narrowest way to get the lookup error to the shell. Adding a logging callback to `lintDocument` and `lintWiki` would widen their inputs for a diagnostic.

A naked `lintWikiAdmission.lease()`, `randomUUID()`, or `lease.release()` cannot throw, and the helper swallows a logger failure. So every unmodellable failure ends in the fixed-message tool-execution error, and nothing escapes to the SDK. "The fixed message or a tool-execution error" is therefore one path here.

The message names the tool as a constant, as the retro's suggested guard did ("the operation"). The extra fields stay exactly the three that the decision allows. `requestId` uses the read-audit validation, so the two read-surface logs agree on which value they show. Modelled System Failures are already counted in the audit summary (`byCode`), so the read surface has an operator trace for them.

```ts
try {
  const candidate = context.authInfo?.extra?.requestId;
  Logger.warn(`${operation} failed without a lint result`, {
    requestId: typeof candidate === "string" && UUID_PATTERN.test(candidate) ? candidate : undefined,
    invocationId,
    ...(cause instanceof Error && { errorClass: cause.constructor.name }),
  });
} catch {
  // The diagnostic never changes the tool result.
}
return error(OPERATION_FAILED);
```

## Verification

**Commands:**
- `scripts/test-db.sh ensure` -- expected: the test database is running and migrated.
- `TZ=UTC node_modules/.bin/vitest run --project server server/tools/wikiLint.test.ts server/wikiLint/application/lintDocument.test.ts server/wikiLint/application/lintWiki.test.ts server/wikiLint/application/readAudit.test.ts` -- expected: every test passes.
- `TZ=UTC node_modules/.bin/vitest run --project server --maxWorkers=2 server/routes/mcp` -- expected: every test passes (regression for tool registration).
- `corepack yarn tsc`, `node_modules/.bin/oxlint --type-aware` and `node_modules/.bin/oxfmt --check` on the changed files -- expected: exit 0.

## Auto Run Result

Status: done

**Summary:** `lint_document` and `lint_wiki` emit one guarded warning for each unmodellable failure that returns `OPERATION_FAILED`. The warning contains the tool name, validated request ID, invocation ID, and an Error class name when present. The application lookup failures carry their cause to the tool shell. Modelled outcomes, audit summaries, admission, and tool results retain their prior behavior.

**Files changed since the baseline:**
- `server/tools/wikiLint.ts`: central failure warning helper and handler wiring.
- `server/wikiLint/application/lintDocument.ts`, `lintWiki.ts`: preserve lookup failure causes.
- `server/tools/wikiLint.test.ts`: operator warning and no-warning cases.
- `server/routes/mcp/wikiLint.test.ts`: route-level warning checks.
- `server/wikiLint/application/lintDocument.test.ts`, `lintWiki.test.ts`: require the original failure cause.
- This spec: follow-up review verdicts and verified run result.

**Follow-up review:** 12 findings; high 0, medium 0, low 5, false 7, maybe-false 0. Patches applied: 0. Deferred items: 0. All were rejected, with individual reasons in the Review Triage Log. Patched counts by verdict: high 0, medium 0, low 0. `followup_review_recommended: false`.

**Verification on 2026-10-04:**
- `scripts/test-db.sh ensure`: exit 0; test database ready.
- Targeted lint tool, application, and read-audit Vitest suites with `--maxWorkers=2`: 4 files, 251 tests passed.
- MCP route Vitest suites with `--maxWorkers=2`: 4 files, 74 tests passed.
- `corepack yarn tsc`: exit 0.
- `oxlint --type-aware` and `oxfmt --check` on the seven changed TypeScript files: exit 0.

**Residual risks:** `errorClass` uses `constructor.name`; a minifying build could shorten names. Snapshot-time errors modelled as `VALIDATION_RUNTIME_FAILED` remain represented in the audit summary rather than this warning. Failed-call correlation with a user report relies on the configured log tracing path.
