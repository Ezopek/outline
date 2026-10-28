# Gate 2 backport A1: MCP SDK 1.32.0, Zod 4.6.6 and bounded request input

<!-- _authored-by: operator-approved-manual; scope: wording/evidence clarification only; implementation and tests unchanged -->

This records one local, unpublished security backport onto the wiki-lint fork. It is a candidate-source change for the maintainers to review. It is **not** a Gate 2 approval, a publication, or a deployment, and it does not claim that the image is free of advisories. The operator-approved scope is stage A1 of a larger remediation; stages A2 (parser, rendering, transport packages) and B (mail packages) are separate changes and are not in this one.

Base: `dd92d84d632841ea20b6ad7e9c85917c5b098955` (`v1.10.1` plus the wiki-lint fork). `upstream/main` was neither merged nor rebased.

## What changed

| Area | Change |
|---|---|
| `package.json`, `yarn.lock` | `@modelcontextprotocol/sdk` `^1.25.3` → `1.32.0` (lock `1.29.0` → `1.32.0`); `zod` `^4.5.4` → `4.6.6` in `dependencies` **and** in `resolutions` (lock `4.5.4` → `4.6.6`). Both are exact pins, because `^4.6.6` resolves to `4.6.7` today. |
| `server/routes/mcp/index.ts` | `McpServer` now receives `maxToolInputElements: MCP_MAX_TOOL_INPUT_ELEMENTS` (100). The SDK leaves this check off when the option is omitted. |
| `server/tools/comments.ts` | `list_comments.statusFilter` is capped at the number of distinct statuses (2). |
| `server/routes/oauth/schema.ts` | `grant_types`, `response_types` and `contacts` of dynamic client registration are capped at 10 entries. `redirect_uris` already had a cap (20). |
| `server/routes/oauth/index.ts` | `POST /oauth/register` now runs the rate limiter, the `OAUTH_DISABLE_DCR` check, the team lookup and the team MCP preference check **before** body validation. `PUT /oauth/register/:clientId` now authenticates the registration access token **before** body validation. |
| `server/routes/api/attachments/schema.ts`, `server/routes/api/integrations/schema.ts` | Zod 4.6.6 type compatibility only: `contentType` and `events` drop a redundant `.optional()` before `.prefault(...)`; see [Zod 4.6.6 type compatibility](#zod-466-type-compatibility). |
| Tests | `server/routes/oauth/index.admission.test.ts` and `server/routes/mcp/index.inputBounds.test.ts` (new); `server/tools/comments.test.ts` (extended); `schema.prefault.test.ts` beside each of the two schemas above (new). |

### Transitive lock changes

The lock changes are the two direct entries above, the SDK's own entry (new version, checksum, and its `@hono/node-server` descriptor), and the SDK edge in the workspace entry. Nothing else moved.

SDK 1.32.0 declares `@hono/node-server` as `^1.19.9 || ^2.0.5`. A plain re-resolve picks `2.1.5`, a new major version of the Node HTTP adapter that serves `/mcp`. That bump was **not** taken: the existing `1.19.17` satisfies the SDK's range, is the version the earlier evidence ran against, and changing an HTTP adapter's major version is not needed for either advisory in this stage. The lock keeps `1.19.17` under the SDK's new descriptor. A maintainer who prefers `2.x` can run `yarn up @hono/node-server` as its own change. `hono` itself stays `4.13.0` and its advisories remain open in this stage.

## Why these limits

### Tool input elements: 100

The SDK counts every array entry and object member at any depth in the arguments of one `tools/call`, before it validates them against the tool's schema. Byte limits (`koa-body` allows 1 MiB of JSON on `/mcp`) and result pagination do not bound this: a request inside the byte limit can still hold tens of thousands of members.

The number comes from the supported tools, not from an advisory example. The 21 tools have only scalar fields except `statusFilter`. The widest tool takes 11 fields, and the longest legal collection is `statusFilter` with 2 entries, so the largest legitimate argument set counts 13. `index.inputBounds.test.ts` reads `tools/list` and fails if the limit drops under twice the widest tool plus the longest collection, or exceeds 1000. These checks cover current top-level property counts and the known status collection; future nested or additional collections still require explicit budget qualification. 100 leaves about eight times the current need.

Document text, titles and similar strings are strings, so they are not counted: the suite creates a document of about 480 000 characters through the same endpoint.

A batch is bounded by the SDK itself at 100 messages (`MAX_BATCH_SIZE`), and the budget applies to every call in it, so one HTTP request cannot count more than about 100 × 100 elements across its tool calls.

### `statusFilter`: 2

The statuses are a set (`resolved`, `unresolved`). A list longer than the number of statuses can only repeat one. This **intentionally rejects** such lists. `["resolved", "resolved"]` is still accepted; `["resolved", "resolved", "unresolved"]` is not. No client is known to send repeats.

### Registration metadata: 10

`grant_types` has two valid values and `response_types` one. The cap of 10 lets a client that repeats a value pass while refusing a list of any real size. `contacts` entries are only logged, never stored; 10 is generous for a contact list. These caps are new rejections of bodies that were previously accepted; the earlier handler ignored the extra entries.

### Why the Zod upgrade matters

Zod 4.6.6 checks `.max()` on an array **before** it parses the entries. Before, the bound ran after the walk, so it bounded nothing. The upgrade alone changes nothing for arrays **without** an upper bound; that is why the missing caps above were added. Measured in a disposable container (200 000 invalid entries, hard memory limit):

| | Zod 4.5.4 | Zod 4.6.6 |
|---|---|---|
| bounded array (`RegisterSchema.grant_types`) | 200 001 issues, 575 ms | 1 issue, 2 ms |
| array without a bound | 200 000 issues, 200 ms | 200 000 issues, 348 ms |

The new schema tests fail on 4.5.4 (7 failures) and pass on 4.6.6.

## Admission order

`/oauth/register` is reachable without credentials. Before this change a malformed body was validated, with every issue constructed, before the rate limiter, the DCR switch, the team lookup or the MCP preference were consulted. Now those run first, so a request that would be refused anyway never pays for validation. Consequences:

- A body that is both invalid and refused for another reason now gets the other reason: 404 when DCR is disabled, the team is unknown or MCP is off, and 429 when rate limited. Previously it got 400. The 404 and 429 responses reveal no more than a well-formed request already received.
- Invalid bodies now consume rate-limit points. The limit is five per hour per address, as before; a client that mistypes now uses the points the mistake costs.
- The team lookup is one query and happens once, as before; the handler reuses the result.

`PUT /oauth/register/:clientId` previously validated the body before it checked the registration access token. The token check now runs first, inside the existing transaction, so an unauthenticated caller gets 401 for any body. A refused update still changes nothing and does not rotate the token. `GET` and `DELETE` are unchanged. The `/oauth` cookie/CSRF middleware, the supported OAuth flows and the scopes granted are untouched.

MCP already authenticated before the SDK ran and still does: missing or invalid credentials return 401 and a token without `comments.list` does not see `list_comments`, whatever the arguments are.

## Not covered

These are open, not fixed by A1:

- **Unrelated unbounded schemas.** Other `/api` schemas have arrays without a cap (users, teams, and others). Zod 4.6.6 does not help them. `/api` allows 5 MiB of JSON. They were not changed.
- **Parser byte limits** are unchanged: `/mcp` and `/oauth` use `koa-body`'s defaults (1 MiB JSON, 56 KiB form, 56 KiB text). They are byte limits, not element budgets.
- **Generic protocol parsing in the SDK.** Before the element budget runs, the SDK parses the JSON-RPC envelope; `tools/call` `arguments` is parsed as an open record, linear in the number of members and without per-entry issues. Other methods (`initialize`, `resources/read`, `_meta`) are not counted by `maxToolInputElements`. This is a bounded linear cost under the 1 MiB parser limit, not an element budget.
- **Existing authenticated-request bookkeeping.** Before SDK validation, an admitted authenticated MCP request sets `UserFlag.MCP` and calls `user.save({ hooks: false })`. This can persist the flag even when tool arguments are refused. It is unchanged request bookkeeping, outside the tool-callback side-effect guarantee, not a newly permitted write. The refusal tests use a `Comment.findAll` spy as a callback-path probe and assert unchanged `Document`/`Event` counts for a refused write tool; they do not assert zero database writes by the whole HTTP request. Authentication/authorization boundaries and failed-write lint atomicity remain unchanged.
- **Other SDK and Hono advisories** in the earlier triage (client redirects, bearer helper audience, `hono`, `body-parser`, `proxy-addr`) have no identified call path in this server and are not addressed here. `taskStore` is still not used.
- **Rate limiter deployment.** The route limiter is skipped when `RATE_LIMITER_ENABLED` is false and fails open if its store errors. Ingress limits were not examined.
- **Tests, not production.** The hardware measurements above are from disposable containers. Nothing here was run against a real service.

## Zod 4.6.6 type compatibility

Zod 4.6.6 infers the output of `.optional().prefault(x)` as `T | undefined`. Zod 4.5.4 inferred `T`. `tsc --noEmit` therefore failed at five consumers, with no other errors on 4.6.6:

- `server/routes/api/attachments/attachments.ts` (4 errors, `contentType`),
- `server/routes/api/integrations/integrations.ts` (1 error, `events`).

The two schemas now read `z.string().prefault("application/octet-stream")` and `z.array(z.string()).prefault([])`. A default replaces `undefined` on the inner schema either way, so the redundant `.optional()` only widened the inferred type. Runtime behaviour is unchanged. The `schema.prefault.test.ts` file beside each schema asserts that the output type has no `undefined`, that a missing or `undefined` value takes the default, that the array default is not shared between parses, and that a table of valid and invalid inputs (`null`, wrong types, empty values) gives the same data or the same issues as the previous form. The type assertions failed under `tsc` before the change. No cast, non-null assertion or compiler setting was used. `server/routes/api/groups/schema.ts` (`disableMentions`) has the same pattern without a type error today and is unchanged.

## Impact on earlier evidence

The Gate 1 evidence and the Gate 2 hand-off bind the baseline source and `yarn.lock` (`2aa4fee1…17c7`). This candidate changes the lock (`ca6667a8…b1ff`) and the runtime dependencies of `/mcp`, so those PASS records do not certify these bytes. Re-running the conformance, benchmark and provenance steps against the final candidate, and the Gate 2 dependency review, is still required. Nothing in the historical records was edited.

## Verification

Run in a disposable container on the pinned Node `26.3.0` image, with a private PostgreSQL 14 (freshly dropped, recreated and migrated before each broad run) on a Docker network created with `--internal`. A positive control reached the database; negative controls to a public address and a public name failed. That shows no route to those two targets, not that every host address is unreachable. The test environment file is a synthetic one mounted read-only over `.env.test`. Redis is the repository's existing mock. Dependencies were fetched in a separate container with registry access and no credentials.

| Check | Result |
|---|---|
| New tests on the unchanged source | failed as expected: 14 of 17 OAuth tests, 7 of 14 MCP tests; the `schema.prefault` type assertions failed under `tsc` |
| Attachments, integrations and groups tests plus the new `schema.prefault` tests | 5 files, 103 tests pass |
| OAuth, MCP, comments and layout tests | 7 files, 136 tests pass |
| `yarn test:wikilint` on a fresh database | 100 files passed, 1 skipped (the existing benchmark gate); 2333 tests passed, 1 skipped; exit 0 |
| `oxfmt --check`, `oxlint --type-aware` on the changed files | pass |
| `yarn install --immutable` | pass |
| `tsc --noEmit --incremental false` | pass, no errors |
| Process-level errors | the new tests assert no `unhandledRejection` or `uncaughtException`; none was logged in the runs |

The full server suite and the app and shared projects, the build and the image provenance were not run for this stage. Nothing here is committed.

### Controller qualification and review boundary

Separately from the author runs above, the controller repeated the pinned Node `26.3.0` full-source type check, formatting/lint, 290 targeted tests, and the fresh-database wiki-lint suite (2333 tests passed, 1 skipped). The controller used a loopback-only shared Node/PostgreSQL namespace and a synthetic `.env.test` overlay. Counts overlap and are not summed as unique coverage. A full lock-stanza comparison verified that unrelated stanza bytes were unchanged, and an offline `yarn install --immutable --immutable-cache` completed successfully with the existing script policy preserved. These are controller-executed checks, not a claim that an independent model read the entire lockfile or qualified an image.

Independent OAuth/types and MCP/comments source-lane reviews were completed. The initial dependency/records review requested alignment of the broad side-effect wording with the existing pre-SDK user-flag save. The operator-approved manual wording amendment changes only the two records, not code, tests or dependencies. Its focused independent-review outcome is tracked separately; neither this paragraph nor the earlier source reviews approve native workflow validation, publication, deployment or Gate 2 as a whole.
