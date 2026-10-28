---
title: 'Gate 2 A1: MCP SDK 1.32.0, Zod 4.6.6 and bounded request input'
type: 'security'
created: '2026-10-25'
status: 'in-review'
baseline_revision: 'dd92d84d632841ea20b6ad7e9c85917c5b098955'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: []
deferred: []
---

<!-- _authored-by: operator-approved-manual; scope: wording clarification only; implementation and tests unchanged -->

<frozen-after-approval reason="human-owned intent">

## Intent

**Problem:** The fork ships `@modelcontextprotocol/sdk` 1.29.0 and `zod` 4.5.4. SDK 1.32.0 can refuse a tool call whose arguments hold too many array entries and object members before validating them, but only when `maxToolInputElements` is set; Zod 4.6.6 refuses an over-long bounded array before parsing its entries, but leaves arrays without a bound unchanged. `POST /oauth/register` validates a client-controlled body before its rate limiter, its dynamic-registration switch and its team checks, and `PUT /oauth/register/:clientId` validates before it authenticates. `list_comments.statusFilter` and three registration arrays have no upper bound.

**Approach:** Upgrade both packages to the exact approved versions, set a finite element budget derived from the supported tool schemas, give the unbounded arrays small finite caps, and run cheap admission and authentication checks before body validation, with executable tests for each.

## Boundaries & Constraints

**Always:**
- Pin `@modelcontextprotocol/sdk` to `1.32.0` and `zod` to `4.6.6`, both in `dependencies` and, for Zod, in `resolutions`.
- Keep `@hono/node-server` at the locked `1.19.17`; the SDK range allows it.
- Keep one `/mcp` endpoint, stateless transport, authentication before the SDK, error shapes, scopes, cookie/CSRF handling and the lint contract.
- Reject over-limit tool arguments and bounded registration arrays before their tool-schema or array-entry validation. A refused tool call must not execute its callback or cause tool-triggered document/domain persistence, media or audit effects. This does not promise zero database writes for the HTTP request: the existing authenticated-request `UserFlag.MCP` bookkeeping occurs before SDK validation and remains unchanged. Authentication/authorization boundaries and failed-write lint atomicity are not relaxed.

**Never:**
- Do not change authentication or authorization rules, parser byte limits, or any package outside the two approved ones and the lock entries they require.
- Do not edit `server/routes/api/**` except `contentType` in `server/routes/api/attachments/schema.ts` and `events` in `server/routes/api/integrations/schema.ts`; do not edit `server/types.ts`, `server/routes/api/groups/schema.ts`, other stages (A2: parser, rendering, transport; B: mail) or earlier gate evidence.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Tool arguments at the budget | 100 members | accepted | none |
| One over the budget | 101 members, nested or aggregate | JSON-RPC `-32602` "maximum of 100 elements" before the callback | no tool-triggered writes/effects or argument echo; existing auth bookkeeping unchanged |
| `statusFilter` | 2 statuses / 3 entries | accepted / `-32602` | none |
| Registration arrays | 10 / 11 entries | accepted / 400 `too_big` | no client row |
| Register, DCR off, unknown team or MCP off | invalid body | 404 | none |
| Register, limiter exhausted | invalid body | 429 | none |
| Update, bad or missing token | oversized body | 401, client and token unchanged | none |
| Update, valid token | oversized body | 400, client and token unchanged | none |

</frozen-after-approval>

## Code Map

- `server/routes/mcp/index.ts` -- `MCP_MAX_TOOL_INPUT_ELEMENTS` and `McpServer` options.
- `server/tools/comments.ts` -- `statusFilter` bound.
- `server/routes/oauth/schema.ts`, `server/routes/oauth/index.ts` -- registration caps and middleware order.
- `server/routes/oauth/index.admission.test.ts`, `server/routes/mcp/index.inputBounds.test.ts`, `server/tools/comments.test.ts` -- regression tests.
- `server/routes/api/attachments/schema.ts`, `server/routes/api/integrations/schema.ts` and the `schema.prefault.test.ts` beside each -- Zod 4.6.6 type compatibility.
- `docs/wikilint-gate-2/a1-sdk-zod-backport.md` -- sanitized backport record, rationale, residual gaps.

## Tasks & Acceptance

**Execution:**
- `package.json`, `yarn.lock` -- exact pins and the minimal lock delta.
- Production files above -- as described in the record.
- Tests -- written first and run to a recorded failure on the baseline source.

**Acceptance Criteria:**
- Given SDK 1.32.0 with the budget set, when a `tools/call` holds more members than the budget, then it fails before the tool callback without tool-triggered document/domain persistence, media or audit effects. Existing pre-SDK authenticated-request bookkeeping is unchanged. An otherwise valid and authorized call at the budget passes the argument-budget check.
- Given Zod 4.6.6, when a registration array holds more than its cap, then one `too_big` issue is reported.
- Given a request that admission would refuse, when its body is invalid, then the admission result is returned.
- Given the targeted suites, `yarn test:wikilint` on a fresh database, oxfmt, oxlint and `tsc --noEmit`, then they all pass, with no waived error.
- Given Zod 4.6.6, when `contentType` and `events` are parsed, then their output types contain no `undefined` and their defaults and issues are those of the previous form.

## Verification

Results are summarized in `docs/wikilint-gate-2/a1-sdk-zod-backport.md`. Independent OAuth/types and MCP/comments source-lane reviews have been completed. The initial dependency/records review requested the side-effect wording clarification recorded below. The wording amendment has its own focused independent-review gate; review receipts, not this record, establish its outcome. This is not a Gate 2 or release approval.

## Spec Change Log

- 2026-10-26, operator-approved manual wording clarification. Reconcile the tool-callback/domain-effect guarantee with the unchanged pre-SDK authenticated-request MCP-flag bookkeeping. The former blanket "no write" wording was imprecise, not evidence of a new runtime regression. No code, tests, dependencies, input limits, authentication rule, failed-write atomicity or earlier evidence changed. The manual attribution above applies only to this wording amendment; native standalone workflow validation remains unverified.

- 2026-10-25, initial implementation (historical state). `tsc --noEmit` reported five errors under Zod 4.6.6 and none under 4.5.4: `.optional().prefault(x)` is inferred as `T | undefined`, which broke four uses in `server/routes/api/attachments/attachments.ts` and one in `server/routes/api/integrations/integrations.ts`. That first artifact accepted a green `tsc` "except the Zod-caused errors". That exception was not an approved risk waiver and is not the acceptance criterion.
- 2026-10-26, compatibility repair 1. Amendment of the frozen boundary, authorized by the maintainers, for only the two fields above: drop the redundant `.optional()` before `.prefault(...)`, add the co-located `schema.prefault.test.ts` regressions, and restore the unwaived `tsc` criterion. Type assertions were written first and failed under `tsc`; `tsc --noEmit --incremental false` then passed. No other field, API or compiler setting changed. No native standalone validation workflow is installed in this repository, so none was run and that gate is unverified.
