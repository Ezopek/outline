---
title: 'Story 1.10: Accept the Complete Read-Only Lint and Repair Loop'
type: 'feature'
created: '2026-10-02'
status: 'done'
baseline_revision: '877dab7d9ab8abc792d5e679683a7291d98d6088'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      The fork README's visible-metadata example uses `- ` bullets, but the v1.10.1 serializer emits every bullet as `* `, so the example does not round-trip byte for byte.
    evidence: |-
      server/tools/README.md presents "- Status: Active" / "- Last verified: 2026-09-20" as the shape that survives the Markdown/ProseMirror round trip. Story 1.10's HTTP suite (server/routes/mcp/wikiLint.test.ts, "round trip") shows MCP create_document + fetch return "* Status: Active"; the fields stay valid and lint clean, but agents copying the example as patch findText would miss. The README is a companion of the binding SPEC, so the edit needs a deliberate contract update rather than an unattended story change.
    location: >-
      server/tools/README.md (Templates and visible metadata)
    severity: low
  - summary: >-
      The lint-repair-relint loop needs repair knowledge that Findings do not carry: a missing metadata field value or a missing configured global index is not identified by the AD-12 Finding.
    evidence: |-
      Story 1.10's acceptance loop (server/routes/mcp/wikiLint.test.ts, "repair loop") reaches a Clean Result only because the test agent is given the collection's documented conventions (field values, global index id); the Finding is fixed to {code, severity, message, location} with a generic registry message. This is the pre-existing DW-2/DW-3 gap (deferred-work ledger), now observed at the accepted MCP surface; settling it needs an architecture decision on readability-gated detail.
    location: >-
      server/wikiLint/core/registry.ts (issue messages); server/wikiLint/core/graphRules.ts (globalIndexLinks emit); Architecture Spine AD-12
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Stories 1.1–1.9 built, audited and tested the `lint_document` and `lint_wiki` handlers, but neither tool is registered on `/mcp`: discovery stays off until this story (`server/tools/wikiLint.ts:69,118`; the in-memory suite even pins the absence at `server/tools/wikiLint.test.ts:4113-4131`). No test drives the tools through the real endpoint, real token scopes, or the real master/worker policy loader. Epic 1 therefore cannot be accepted, and Epic 2 must not start until it is.

**Approach:**
- Register both tools with their D-9 gates, schemas and annotations in `server/tools/wikiLint.ts`, and call the registration from the one existing `createMcpServer`.
- Add one HTTP acceptance suite over `/mcp/` and `/api/events.list` that proves AC1–AC11 with real tokens, the real configuration loader and only the AD-18 seams.
- Record the AC12/AC13 provenance evidence (commands with verbatim output) in this spec's Auto Run Result.

## Boundaries & Constraints

**Always:**
- **D-9 registration:**
  - `lint_document` is registered iff `AuthenticationHelper.canAccess("documents.info", scopes)`.
  - `lint_wiki` is registered iff `canAccess` holds for each of `documents.list`, `collections.list`, `collections.documents`.
  - Input schemas are the existing `lintDocumentInputSchema` / `lintWikiInputSchema`.
  - Annotations are exactly `{ readOnlyHint: true, idempotentHint: true }`, as on baseline read tools (`server/tools/documents.ts:77-80`).
  - Titles and descriptions are generic: no UUID, hostname, URL, collection name or pilot term. They may describe lint, repair/re-lint, Warnings vs. Errors and operator escalation of `POLICY_CONFIGURATION_INVALID`.
  - Handlers are wrapped in `withTracing(name, …)` like the baseline tools, and call `lintDocumentTool(input, extra)` / `lintWikiTool(input, extra)` with production defaults.
- **Production diff = registration only.** The lint core, application and adapters, the result algebra, the audit path, the policy loader, every baseline tool, `server/tools/documents.ts`, and `shared/` stay unchanged.
- **Test surface:** the real `getTestServer()` endpoints `/mcp/` and `/api/events.list`, with real OAuth access tokens (`buildOAuthAuthentication`) and API keys (`buildApiKey`).
- **Policy configuration** reaches the server only through the real loader:
  - write the JSON to a temp file;
  - run `initializePolicyConfiguration(masterEnv)` with `masterEnv = { WIKI_LINT_CONFIG_PATH: file }`;
  - run `policySetFromEnvironment(masterEnv)`.
  - The worker getter `getPolicySet` is replaced (`vi.mock` with `importOriginal`) only so that this freshly loaded set is served. That models a process restart, the only way an operator changes policy (AD-19); it falls back to the actual getter when no set was loaded.
- **Fault injection** goes only through AD-18 seams:
  - snapshot-reader methods of `defaultLintDocumentReader` / `defaultLintWikiReader` (`vi.spyOn`);
  - the audit writer `insertAuditEvent`, wrapped through `vi.mock` with `importOriginal` and failing only when a test arms it;
  - the code-owned `lintWikiAdmission` slot, held by the test for the resource-limit fixture.
- **Generic data:** fixtures use factory UUIDs and `example.com` only.
- **Tests** are collocated with the route, in a new `server/routes/mcp/wikiLint.test.ts`, and are deterministic.

**Never:**
- No create/update enforcement. No change to `create_document`, `update_document` or `move_document`.
- No change to the AD-12 Finding shape or registry messages: DW-2 and DW-3 stay open.
- No second endpoint, server-instructions text, prompt, adapter, policy input or execution-control input.
- No merge, rebase or backport.
- No AD-17 performance work, D-9 constant derivation, Gate 1 decision, image publication or deployment step.
- No pilot identifiers in code, descriptions or fixtures.

## I/O & Edge-Case Matrix

All rows are observed over HTTP `/mcp/` (`tools/list` or `tools/call`).

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Full discovery | tokens `*` (API key, `scope: null`), `read`, `write`, `documents:read`+`collections:read` | `tools/list` = that token's baseline tools + `lint_document` + `lint_wiki` | none |
| Document-only discovery | `documents:read`; `/api/documents.info` | baseline tools + `lint_document` only | none |
| Wiki-only discovery | `/api/documents.list` + `/api/collections.list` + `/api/collections.documents` | baseline tools + `lint_wiki` only | none |
| No lint discovery | `create`; `collections:read`; `documents:create` | baseline tools only | none |
| Valid | conforming document/collection | `state: complete`, `clean: true`, no Errors | none |
| Invalid | Errors present | `complete`, `clean: false`, stable codes, AD-4 order | none |
| Warning-only | only a discouraged structure | `complete`, `clean: true`, `warnings` non-empty | none |
| Unconfigured | collection absent from the loaded config | `not_evaluated`, `reason: POLICY_NOT_CONFIGURED`, empty arrays | none |
| Invalid policy | readable sentinel collection | `failed`, one `POLICY_CONFIGURATION_INVALID`, invalid identity, no `reason` | none |
| Runtime failure | snapshot reader rejects `new Error(...)` | `failed`, `VALIDATION_RUNTIME_FAILED` | modeled result, no `isError` |
| Timeout | snapshot reader rejects `new DeadlineFloorError()` | `VALIDATION_TIMEOUT` on both tools | modeled result |
| Resource limit | test holds the `lintWikiAdmission` slot | `lint_wiki` `failed`, `VALIDATION_RESOURCE_LIMIT_EXCEEDED` | slot released afterwards |
| Inaccessible dependency | link to a document in a private collection, beside a link to a missing document | both `INTERNAL_LINK_TARGET_UNRESOLVED`, differing only in location; no target id, title or collection | none |
| Missing vs denied target | missing UUID vs unreadable document/collection | byte-identical `isError` authorization-denial results | `isError` |
| Lookup failure | `authorizeLintTarget` / `authorizeLintCollection` rejects `DeadlineFloorError` | `isError` with text `The operation could not be completed` | `isError` |
| Invalid input | `lint_document` with `{}` or `{ id: 1 }` | `result.isError: true`; JSON-RPC `error` absent | SDK behavior |
| Audit write fails | armed `insertAuditEvent` rejects | result bytes equal an unfailed run, no audit field; exactly one `Logger.warn("Wiki lint audit write failed", { requestId, invocationId, reason })` | functional result unchanged |

</intent-contract>

## Code Map

- `server/tools/wikiLint.ts`: the registration home (spine structural seed).
  - `lintDocumentInputSchema` `:35-41`, `lintWikiInputSchema` `:44-48`.
  - Handlers `lintDocumentTool` `:80` and `lintWikiTool` `:131`. Their comments at `:69` and `:118` ("The tool is not registered here") must change.
  - `OPERATION_FAILED` `:31`.
- `server/routes/mcp/index.ts`: `createMcpServer` `:102-152`, where tool groups are called at `:143-149`. A fresh server is built per request at `:174`.
  - `extra` carries `user`, `requestId`, `credentialAuthType` and the OAuth `authenticatedClientId` (`:199-208`).
  - `/mcp` returns 404 unless `TeamPreference.MCP` is on (default on).
- **Baseline registration pattern:**
  - `server/tools/documents.ts:69-117` (`list_documents`: `title`, `description`, `annotations`, `inputSchema`, `withTracing`).
  - `withTracing` is at `server/tools/util.ts:124-144`; `success` / `error` at `server/tools/util.ts:82-110`. `success` emits one text block per object.
- **Scope semantics:**
  - `shared/helpers/AuthenticationHelper.ts:16-30` (`methodToScope`: `list`, `info`, `documents` are read methods), `:83` (`*`), `:103-115` (route and namespaced scopes).
  - An API key with `scope: null` becomes `["*"]` (`server/middlewares/authentication.ts:266`).
  - Any valid scope passes the `/mcp` gate (`server/models/ApiKey.ts:177-181`, `server/models/oauth/OAuthAuthentication.ts:147-151`).
  - Factories accept arbitrary scope arrays: `server/test/factories.ts:60-70`, `:896-942`.
- **Expected baseline tools per scope:**
  - **The 19 tools.** `*` and `write` get all 19:
    - `create_attachment`, `list_users`;
    - `list_collections`, `create_collection`, `update_collection`, `delete_collection`;
    - `list_comments`, `create_comment`, `update_comment`, `delete_comment`;
    - `list_documents`, `list_collection_documents`, `create_document`, `move_document`, `update_document`, `delete_document`, `restore_document`;
    - `list_templates`, `fetch`.
  - `read`: `list_users`, `list_collections`, `list_comments`, `list_documents`, `list_collection_documents`, `list_templates`, `fetch`.
  - `documents:read` + `collections:read`: `list_documents`, `list_collections`, `list_collection_documents`, `fetch`.
  - `documents:read`: `list_documents`, `fetch`.
  - `/api/documents.info`: `fetch`.
  - The three `/api/…` scopes: `list_documents`, `list_collections`, `list_collection_documents`.
  - `create`: `create_attachment`, `create_collection`, `create_comment`, `create_document`.
  - `collections:read`: `list_collections`, `list_collection_documents`, `fetch`.
  - `documents:create`: `create_document`.
  - Verify these lists against the running server. If one differs, the gate code at `server/tools/*.ts` is authoritative, and the test pins what the code yields.
- **Policy loader** (`server/wikiLint/adapters/policyConfig.ts`):
  - `initializePolicyConfiguration(env)` `:65-117` reads `WIKI_LINT_CONFIG_PATH`, sets `env.WIKI_LINT_CONFIG_BASE64`, and calls `process.exit(1)` only on root defects.
  - `policySetFromEnvironment(env)` `:127-137`.
  - The cached `getPolicySet()` `:147-152` has no reset, by design (AD-19).
- **Policy schema v1:** `server/wikiLint/core/registry.ts:226-345` and `server/wikiLint/policy.example.json`.
  - Rule kinds: `required_sections`, `required_metadata_fields{metadataSection{heading, headingLevel}, fields}`, `metadata_field_formats{…, fields[{name, format: iso_date | one_of, values}]}`, `discouraged_markdown_structures{structures}`, `internal_links`, `parent_document_resolved`, `hierarchy_acyclic`, `published_documents_in_structure`, `parent_collection_consistent`, `global_index_links{surfaceDocumentId, globalIndexDocumentIds}`.
  - An entry with `rules: []` is a sentinel.
  - Metadata fields are root bullet items `Name: value` under the configured heading (`server/wikiLint/core/documentRules.ts:133-162`).
- **Result shape:** `server/wikiLint/core/contracts.ts`.
  - `CheckName` is `documents` | `hierarchy` | `global_index` (`:50`).
  - `TextLocation` is `{kind: "text", documentId, line, column, path?}` (`:52-60`).
  - Collection scope carries `completedChecks` (`:138`).
- **Seams:**
  - `defaultLintDocumentReader` `{ authorizeLintTarget, readDocumentSnapshot }` (`server/wikiLint/application/lintDocument.ts:54-57`).
  - `defaultLintWikiReader` `{ authorizeLintCollection, readWikiSnapshot }` (`server/wikiLint/application/lintWiki.ts:69-72`). A rejected `readWikiSnapshot` maps through `:370-397`.
  - `DeadlineFloorError` (`server/wikiLint/application/deadline.ts:20`).
  - `lintWikiAdmission.lease()` with `.acquire()` / `.release()` (`server/wikiLint/application/admission.ts`). An unadmitted call is a resource-limit `failed` (`lintWiki.ts:366-367`).
  - The audit default writer is `insertAuditEvent`, imported by `server/wikiLint/application/readAudit.ts:8,201`. A failure is logged at `readAudit.ts:214-218`.
- **Audit retrieval:** `POST /api/events.list` with `{ auditWikiLint: true }`, admin-only `auditWikiLint` (`server/policies/team.ts:54`; `server/routes/api/events/events.ts:42-46`).
  - Event names: `WIKI_LINT_AUDIT_EVENTS` (`server/wikiLint/adapters/auditEvents.ts:12-16`).
  - `AuditDataV1` fields: `outcome` (clean | findings | not_evaluated | incomplete | failed), `complete`, `counts{errors, warnings, systemFailures, byCode}`, … (`:21-51`).
  - The test-server call form is `server.post("/api/events.list", user, { body })` (precedent `server/tools/wikiLint.test.ts:3686`).
- **Round trip:**
  - MCP `create_document` stores `ProsemirrorHelper.toProsemirror(text)` (`server/commands/documentCreator.ts:206-242`).
  - Lint reads `toCanonicalMarkdown` (`server/wikiLint/adapters/canonicalSyntax.ts:31-43`), which is `toMarkdown(doc, { includeTitle: false })`.
  - MCP `fetch` returns the document Markdown as its second text block (`server/tools/fetch.ts:133-157`).
- **In-memory suite** (`server/tools/wikiLint.test.ts`, 4132 lines; it calls the handlers over an `InMemoryTransport`): reuse its patterns, not its exports.
  - `policySetFor` `:110`, `buildDocumentOnlyReader` `:263`.
  - Hierarchy fixtures `:2132-2168`: `buildDocument` does not add to the structure; `collection.addDocumentToStructure(doc)`; `Document.unscoped().update({ parentDocumentId }, { hooks: false })`.
  - Denial fixtures `:416-475`, sentinel cells `:486-560`, invalid input `:477-484`.
- **Tests that must change:**
  - `server/routes/mcp/audit.test.ts:19-31`: its `vi.mock("@server/tools/users")` registers `lint_document`. Once registration is real, the SDK throws `Tool lint_document is already registered`.
  - `server/tools/wikiLint.test.ts:4113-4131`: "does not register the lint tools yet".
- **Must stay green, unedited:**
  - `server/routes/mcp/index.test.ts`, `server/routes/mcp/requestTimeout.test.ts` (which mocks `userTools` with `slow_probe` only);
  - `server/tools/{documents,collections,comments,fetch,templates,attachments,util}.test.ts`;
  - `server/wikiLint/**`;
  - `shared/editor/nodes/urlSanitization.test.ts`.
- **Provenance:**
  - `git merge-base HEAD 4a5a616a21be800257dc11cef4263d0dd0412156` gives the base itself, and `4a5a616a…..HEAD` has no merges.
  - The upstream container-block patch-edit fix is `c17d2c52b3a9e26834b846d27ee9213ee3003c4c` (touching `server/models/helpers/DocumentHelper.tsx`, `server/commands/documentUpdater.test.ts`), and it is not an ancestor of HEAD.
  - The remotes are `origin` (fork) and `upstream`.

## Tasks & Acceptance

**Execution:**
- `server/tools/wikiLint.ts` -- add an exported `wikiLintTools(server: McpServer, scopes: string[])` with the D-9 gates, generic `title` and `description`, the existing input schemas, exact annotations, and `withTracing`-wrapped handlers. Update the two "not registered here" doc comments -- this is the single registration point the spine names.
- `server/routes/mcp/index.ts` -- import `wikiLintTools` and call `wikiLintTools(server, scopes)` beside the other tool groups -- one endpoint, one server, per-token filtering.
- `server/routes/mcp/audit.test.ts` -- remove the `vi.mock("@server/tools/users", …)` block and the imports it alone used. The attribution tests then hit the real registration unchanged -- this avoids duplicate registration.
- `server/tools/wikiLint.test.ts` -- delete the `POST /mcp/ tools/list` describe ("does not register the lint tools yet") and any import it leaves unused -- the new suite supersedes it with positive discovery.
- `server/routes/mcp/wikiLint.test.ts` (new) -- the HTTP acceptance suite:
  - **Harness:**
    - hoisted state `{ policySet?, auditFails }`;
    - the two `vi.mock` wrappers;
    - `restart(collections | null)`, which runs the real master loader over a temp file, then the worker decode, and serves the result;
    - token helpers for OAuth scopes and API keys;
    - `listTools(token)`, `callTool(token, name, args)`, which returns the parsed JSON-RPC response;
    - `lintResult(...)`, which asserts no JSON-RPC `error`, no `isError`, exactly one text block, and returns the parsed object.
    - `afterEach` resets the state, restores spies and releases any lease. `afterAll` removes the temp files.
  - **Registration and discovery:** the AC1 and AC2 tables.
  - **Results:** the I/O matrix rows on both applicable tools.
  - **Sentinel matrix:** each cell's HTTP first text is byte-equal to the handler's for the same actor and loaded set (`lint*Tool(input, { authInfo: { token: "", clientId: "", scopes: [], extra: { user } } }, { policySet, writeAudit: async () => {} })`). Explicit asserts cover state, codes, `reason` presence, and identity absence.
  - **Round trip:** AC5.
  - **Disclosure:** AC6.
  - **Repair loop and escalation:** AC7.
  - **Determinism:** AC8.
  - **Audit:** AC9 and AC10.
  - **Unconfigured and no enforcement:** AC11 and AC13.
- This spec's Auto Run Result -- record the AC12 and AC13 provenance commands with verbatim output, plus the test runs -- that is the reviewable evidence AC12 asks for.

**Acceptance Criteria:**
- **AC1:** Given a `*` token, when it calls `tools/list` on `/mcp/`, then `lint_document` and `lint_wiki` each carry the AD-12 input schema:
  - `lint_document` has the single required string `id`; `lint_wiki` has the single optional `collectionId`.
  - `annotations` strictly equal `{ readOnlyHint: true, idempotentHint: true }`, which is also `list_documents`'s value.
  - The title and description contain no UUID, `http(s)://`, or instance hostname.
  - Every lint result in the suite is the JSON object of one text block, without `isError`.
- **AC2:** Given each I/O-matrix discovery row, when its token lists tools through the one `/mcp/` endpoint, then the name set equals exactly the expected baseline tools plus the expected lint tools. The `/api/documents.info` token can call `lint_document`, and the three-route token can call `lint_wiki`, with no other input.
- **AC3:** Given the I/O-matrix result rows, when each applicable tool runs over HTTP, then each modeled result has:
  - the exact state algebra (`clean` iff `complete` and zero Errors; arrays always present);
  - registry codes with their fixed severities;
  - locations limited to the linted scope;
  - AD-4 order;
  - for a complete `lint_wiki`, `completedChecks` listing every enabled check, so no enabled rule is silently skipped.
- **AC4:** Given the sentinel matrix, when both tools run, then each HTTP result is byte-equal to the handler result for the same actor and loaded set. The matrix covers:
  - document, collection and default scope;
  - a readable sentinel, and an unreadable private one;
  - a document-only reader of a document in a sentinel collection and in a valid one.

  No result is clean or `not_evaluated` while a readable sentinel is in scope. `reason` appears only on `not_evaluated`. The document-only reader sees no `collectionId`, and an unreadable sentinel adds nothing to `lint_wiki`.
- **AC5:** Given canonical visible metadata (`## Document metadata` with `- Status: Active` and `- Last verified: 2026-09-20`) created through MCP `create_document`, when it is fetched and linted, then:
  - the fetched Markdown equals the input byte-for-byte, and the document is clean;
  - a variant with `Last verified: 2026-13-01` yields `METADATA_FIELD_FORMAT_INVALID` at the exact one-based line and column of the value;
  - re-saving the fetched Markdown via `update_document` `replace` leaves that location byte-identical;
  - a document carrying the same fields only as YAML front matter still yields `REQUIRED_METADATA_FIELD_MISSING`.
- **AC6:** Given these actors:
  - a collection member;
  - a document-only reader;
  - a reader denied a link target;
  - a same-team admin with collection `read` but no `readDocument` on a private collection;
  - a non-admin;
  - an admin of another team;

  when they lint and query `/api/events.list` `{ auditWikiLint: true }`, then no response contains a protected document's id or title, a collection identity, content or target state beyond the NFR-11 policy class.
  - The admin's `lint_wiki` on the private collection returns only the generic collection System Failure.
  - Non-admins get 403, and the other team's admin lists none of these summaries.
  - A read-only member who receives Errors still cannot `update_document` that document: `isError`, content unchanged.
  - Every Finding has exactly `code`, `severity`, `message` and `location`, located in the linted scope.
- **AC7:** Given a configured collection whose Errors cover document metadata, an unresolved internal link, a hierarchy defect (published document missing from the structure) and a missing global-index link, plus one discouraged-structure Warning, when the agent's write-scoped token runs a bounded loop (lint_wiki; repair each Error with `update_document` / `move_document` on documents in its batch; re-lint), then:
  - the loop ends within 3 rounds at `complete: true`, zero Errors, `clean: true`, with the Warning still listed;
  - no document outside the batch changed.

  Given a sentinel scope, the same loop makes no edit and escalates. After `restart` with a corrected entry, the unchanged scope re-lints clean.
- **AC8:** Given an unchanged state, policy and actor, when both tools run repeatedly, then the JSON-RPC `result` objects are byte-identical across:
  - an OAuth token and an API key of the same user (different clients);
  - different `User-Agent` headers and JSON-RPC ids;
  - a changed document title;
  - a changed user language;
  - touched `updatedAt` order.
- **AC9:** Given one invocation of each outcome class (clean, findings, not_evaluated, incomplete, failed), when each completes, then exactly one `wikiLint.document` / `wikiLint.wiki` summary per invocation is listed to a team admin through `/api/events.list`. Its `outcome`, `complete` and `counts` match the result. An `isError` call adds none.
- **AC10:** Given an armed audit-writer failure, when either tool completes, then the HTTP result equals an unfailed run, carries no audit or diagnostic field, and no summary row exists. The only diagnostic is one minimized `Logger.warn`.
- **AC11 and AC13:** Given `restart(null)`, when tools are discovered and run, then:
  - both tools are listed, and both return `not_evaluated` with `POLICY_NOT_CONFIGURED`;
  - MCP `create_document` and `update_document` responses into an unconfigured collection and into an `enforced` collection, with policy-violating text, keep the identical baseline key set, carry no `validation`, and persist the text.
- **AC12:** Given the final tree, when the evidence is reviewed, then the Auto Run Result shows:
  - the merge base equals `4a5a616a21be800257dc11cef4263d0dd0412156`, with zero merges;
  - `c17d2c52b3a9e26834b846d27ee9213ee3003c4c` is not an ancestor, and its files are unchanged from the base;
  - `git cherry` finds no upstream-equivalent commit, so there are no backports;
  - green runs of the discovery suite, the shared-core suites, the Story 1.9 sanitization suite, and the generic-data grep.

## Spec Change Log

## Review Triage Log

### 2026-10-02 — Review pass
- verdicts: 30 findings — high 0, medium 1, low 21, false 8, maybe-false 0
- findings:
  - `[low]` `[patch]` **Blind Hunter:** the `lint_document` description does not say that hierarchy and global-index checks run only in `lint_wiki`. An agent could "confirm" such a repair with `lint_document` and get a clean result. — Patched: the description now says these checks run only in `lint_wiki`, so their repairs are confirmed there.
  - `[low]` `[patch]` **Blind Hunter:** neither description says what to do with a not-clean result that has zero Errors (timeout, resource limit, runtime failure), and `lint_wiki` does not mention `not_evaluated`. — Patched: both descriptions now say other System Failures are not repaired by editing (lint again later). `lint_wiki` gained the not-evaluated sentence. Grouped with Edge Case Hunter rows 4 and 5.
  - `[low]` `[patch]` **Blind Hunter:** the AC13 enforced-collection test discards the loaded set, so it never shows the entry is valid or that the text violates it. — Patched: it asserts the `enforced` identity is `valid` and the sentinel `invalid`, and that `lint_document` reports Errors on the document written there.
  - `[low]` `[patch]` **Blind Hunter:** write compatibility is pinned only for unconfigured and `enforced` collections, only for `replace`, and not for `move_document`. — Patched: the same restart now also loads a `read_only` collection and a sentinel collection, and both write outcomes equal the baseline. Edit modes and `move_document` run unchanged baseline code (`git diff --stat 4a5a616a… -- server/tools/documents.ts server/commands` is empty), already pinned by `server/tools/documents.test.ts`.
  - `[low]` `[defer]` **Blind Hunter:** the `server/tools/README.md` metadata example uses `- ` bullets, which v1.10.1 serializes as `* `. — The README is a companion of the binding SPEC (contract text), so it is not edited in an unattended story run. Deferred.
  - `[low]` `[reject]` **Blind Hunter:** the Spec Change Log is empty while deviations reinterpret AC5 and AC6, and Code Map statements are stale (`buildDocument` and the structure; the rule-kind list). — Its fix is an edit of this build's spec. The deviations are recorded in the Auto Run Result.
  - `[false]` `[reject]` **Blind Hunter:** under AC6, the admin's `/api/events.list` shows the `documentId` of a document in a collection the admin cannot read. — By design: AD-14 stores safe document and collection IDs in existing Event columns, "independent of whether the actor can read the collection", and retrieval is admin-only (`auditWikiLint`). The listed rows carry no title, content, target or collection identity for document scope; the test asserts this.
  - `[low]` `[patch]` **Blind Hunter:** the admin's private-collection `lint_wiki` result is only partly asserted, so revealed counts would pass. — Patched: the whole result is compared with `toEqual`: `incomplete`, one generic System Failure, `evaluatedDocumentCount: 0`, `evaluatedLinkCount: 0`, `completedChecks: ["documents"]`, and the valid identity.
  - `[low]` `[patch]` **Blind Hunter:** audit-row minimization is not asserted over HTTP, and per-tool outcome coverage is partial. — Patched: each listed row's `data` key set must equal exactly the `AuditDataV1` keys. Per-tool outcome mapping is already pinned exactly by the in-memory suite (`server/tools/wikiLint.test.ts:3271`, `:3740`).
  - `[false]` `[reject]` **Blind Hunter:** URL-identifier and slug forms are never sent over HTTP. — HTTP passes arguments verbatim to the same production input schemas and handlers, and the in-memory suite registers those same schemas and pins the forms (`server/tools/wikiLint.test.ts:416-475`, `:732-1421`).
  - `[low]` `[patch]` **Blind Hunter:** scope gating is proven only through `tools/list`. — Patched: in every discovery row, each lint tool the token must not have is called and returns `isError` with no lint result.
  - `[low]` `[patch]` **Blind Hunter:** `rounds.length <= 3` can never fail. — Patched: `expect(rounds).toHaveLength(2)`.
  - `[low]` `[patch]` **Blind Hunter:** the front-matter case does not show that the fields survived the round trip. — Patched: the fetched Markdown is asserted to contain `Status: Active` and `Last verified: 2026-09-20`.
  - `[false]` `[reject]` **Blind Hunter:** most rule codes are never seen over HTTP, including `unsupported` vs `discouraged` severities. — Severity comes from the frozen registry in `createFinding` (`server/wikiLint/core/registry.ts:549-566`), whatever the surface. Registry and core tests pin every code, and `expectAlgebra` checks the registry severity of every Finding the suite observes.
  - `[low]` `[patch]` **Blind Hunter:** lookup-failure coverage injects only `DeadlineFloorError`. — Patched: the test also runs with a plain `new Error("raw detail")` and expects the fixed message.
  - `[low]` `[reject]` **Blind Hunter:** the AC12 generic-data evidence cannot be reproduced and covers too little. — Its fix is an edit of this build's spec. The final Auto Run Result records exact grep commands over a wider file set.
  - `[low]` `[reject]` **Edge Case Hunter:** `lint_wiki` called without an `arguments` object returns an input-validation `isError` instead of a default-scope lint. — This is baseline SDK 1.x behaviour (`validateToolInput` parses `undefined`), shared by every baseline tool whose arguments are all optional, and Stories 1.3 and 1.5 pin it. Clients send `arguments: {}`. A preprocess wrapper adds complexity beyond a direct correction.
  - `[false]` `[reject]` **Edge Case Hunter:** an empty `collectionId` silently widens to the default scope. — This is the Story 1.5 contract: `optionalString()`, where an empty string means omitted (`epics.md:515`).
  - `[low]` `[reject]` **Edge Case Hunter:** client cancellation is ignored, so the scan slot is held until the deadline. — This is pre-existing Story 1.7 behaviour, bounded by the 60 s deadline and the AD-16 no-queue admission; DW-4 already records that disconnects are not observed. The fix needs cancellation plumbing through application and adapters, more than a direct correction.
  - `[low]` `[patch]` **Edge Case Hunter:** no guidance for timeout, resource-limit or runtime System Failures. — Grouped with Blind Hunter row 2; same patch.
  - `[low]` `[patch]` **Edge Case Hunter:** the `lint_wiki` description omits `not_evaluated`. — Grouped with Blind Hunter row 2; same patch.
  - `[low]` `[reject]` **Edge Case Hunter (claim):** AC5 promises a byte-for-byte round trip of `- ` bullets, but `fetch` returns `* `. — The only fix is an edit of this build's spec. The code meets epic AC5:
    - canonical metadata (`* `, Outline's only serialized bullet marker) round-trips byte-identical, with exact and stable coordinates;
    - `- ` input lints clean;
    - changing the serializer is forbidden;
    - `update_document` tells agents to copy `findText` verbatim from fetched Markdown.

    Grouped with Intent Alignment row 4.
  - `[low]` `[reject]` **Edge Case Hunter (claim):** the `vi.mock` of `getPolicySet` is not an AD-18 seam, and the test holds the admission slot directly. — The replaced getter only bypasses the per-process cache; it serves bytes loaded through the real master loader and decoded by the real worker. Holding the slot uses the production admission object, exactly as a concurrent scan would. Stories 1.3–1.9 already inject `policySet` as a handler dependency. Avoiding it would need a process restart inside a test file. Grouped with Intent Alignment row 2.
  - `[false]` `[reject]` **Intent Alignment:** AC1 and AC2 are exercised in-process, not against a deployed `/mcp`. — Deployment is explicitly excluded by AC13 as a separate approval, and `getTestServer()` serves the production web service with the real `/mcp` route.
  - `[low]` `[reject]` **Intent Alignment:** a real restart, and the getter's cache-once behaviour, are not exercised. — Grouped with Edge Case Hunter row 7. The cache-once behaviour is covered by `server/wikiLint/adapters/policyConfig.test.ts:387-412`.
  - `[medium]` `[defer]` **Intent Alignment:** the AC7 agent repairs from documented conventions supplied by the test, because Findings do not identify the missing field value or global index, and escalation reaches no operator channel. — The repair-knowledge gap is real and pre-existing: AD-12 fixes the Finding shape (DW-2, DW-3). Deferred. Escalation needs no operator channel: AC7 requires that the agent escalates instead of repairing and that the scope is clean only after the operator's corrected restart, and both are shown.
  - `[low]` `[reject]` **Intent Alignment:** spec AC5 and the tests disagree. — Grouped with Edge Case Hunter row 6; rejected because the fix is a spec edit.
  - `[false]` `[reject]` **Intent Alignment:** the admin listing contains `documentId`. — Grouped with Blind Hunter row 7; this is AD-14 by design.
  - `[false]` `[reject]` **Intent Alignment:** AC8 uses one transport, so "MCP client" is only partly varied. — The handlers derive results only from the input and the authenticated actor. `extra` feeds only audit attribution. The test varies credential type and OAuth client, `User-Agent`, and JSON-RPC ids.
  - `[false]` `[reject]` **Intent Alignment:** the AC12 evidence is a pre-commit transcript, and no test asserts provenance. — A non-merge commit on top of HEAD cannot change the merge base, the merge count or the ancestry of `c17d2c52…`. The protected-file diffs were computed over the working tree that is committed. The spec's AC12 fixes the reviewed record as the evidence form.

## Design Notes

**Restart model.** Policy changes only by an operator restart (AD-19: no hot reload), and one vitest file cannot restart its process. `restart()` therefore runs the master loader on a real file, decodes the exported bytes as a worker does, and serves that set from the replaced getter. Everything downstream of `getPolicySet()` is production code.

**Byte-equivalence.** Results carry no correlation field, because runtime metadata is excluded (spine Consistency Conventions). The only request-correlation datum in a response is the JSON-RPC envelope `id`. The normalized response is therefore the JSON-RPC `result` object, and the audit `requestId` and `durationMs` stay in audit rows.

**Repair knowledge.** AD-12 fixes a Finding to `{code, severity, message, location}`. The test agent repairs from the code and location, plus the collection's documented conventions: the required field values and the global index to link. This is the knowledge a real agent gets from templates and the Wiki surface. The fixture has one missing item per kind, so no repair depends on telling apart byte-identical Findings. That gap stays open as DW-2 and DW-3.

**Golden loop fixture** (agent token `write`; collection policy `read_only`):
```
S surface   valid shape, lacks link to I          -> GLOBAL_INDEX_LINK_MISSING (S)
I index     valid                                  -> none
A           Last verified: 2026-13-01; blockquote  -> METADATA_FIELD_FORMAT_INVALID + DISCOURAGED (warning, kept)
B           [gone](/doc/missing-abcdefghij)        -> INTERNAL_LINK_TARGET_UNRESOLVED
D           published, not in structure            -> PUBLISHED_DOCUMENT_MISSING_FROM_STRUCTURE
repairs: patch A date; patch B link -> I; move_document D to collection root; append link to I on S
```

## Verification

**Commands:**
- Start the test PostgreSQL per memory `local-test-postgres` (reuse a migrated `pg14`/`pgd` if one is present).
- `TZ=UTC node_modules/.bin/vitest run --project server server/routes/mcp server/tools server/wikiLint` -- expected: all pass.
- `TZ=UTC node_modules/.bin/vitest run --project shared-node --project shared-jsdom shared/editor/nodes/urlSanitization.test.ts` -- expected: all pass.
- `corepack yarn tsc` -- expected: exit 0.
- `node_modules/.bin/oxlint --type-aware` and `node_modules/.bin/oxfmt --check` on the changed files -- expected: clean.
- **Temporary mutations**, each reverted afterwards -- expected: the suite fails for each:
  - swap the `lint_document` gate to `documents.list`;
  - drop one `lint_wiki` gate term;
  - change one annotation;
  - remove the `wikiLintTools` call.
- **Provenance:**
  - `git merge-base HEAD 4a5a616a21be800257dc11cef4263d0dd0412156` -- expected: `4a5a616a21be800257dc11cef4263d0dd0412156`.
  - `git rev-list --merges 4a5a616a21be800257dc11cef4263d0dd0412156..HEAD | wc -l` -- expected: `0`.
  - `git merge-base --is-ancestor c17d2c52b3a9e26834b846d27ee9213ee3003c4c HEAD` -- expected: exit 1.
  - `git diff --stat 4a5a616a21be800257dc11cef4263d0dd0412156 HEAD -- server/models/helpers/DocumentHelper.tsx server/commands/documentUpdater.test.ts server/tools/documents.ts server/commands/documentCreator.ts server/commands/documentUpdater.ts` -- expected: empty.
  - `git cherry upstream/main HEAD 4a5a616a21be800257dc11cef4263d0dd0412156 | grep -c '^-'` -- expected: `0`.
- `grep -rniE "laura|ezop" server/tools/wikiLint.ts server/routes/mcp/` -- expected: no matches.

## Auto Run Result

Status: done

**Summary.** `lint_document` and `lint_wiki` are discoverable on the one existing `/mcp` endpoint, filtered per token by their D-9 gates. One HTTP acceptance suite drives the complete read-only loop through `/mcp/` and `/api/events.list`: discovery, results, sentinels, the round trip, disclosure, lint → repair → re-lint, determinism, audit, and baseline write compatibility.
- **Credentials and configuration:** real OAuth access tokens and API keys, and the real master/worker policy loader.
- **Fault injection:** only through the snapshot-reader, audit-writer and admission seams.
- **Unchanged:** production code outside the registration.

**Files changed:**
- `server/tools/wikiLint.ts`: new `wikiLintTools(server, scopes)`.
  - `lint_document` is registered iff `canAccess("documents.info")`.
  - `lint_wiki` is registered iff `canAccess` holds for each of `documents.list`, `collections.list` and `collections.documents`.
  - Both use the existing input schemas, exact `{ readOnlyHint: true, idempotentHint: true }` annotations, generic titles and descriptions, and handlers wrapped in `withTracing`.
  - The two "not registered here" doc comments now name `wikiLintTools`.
- `server/routes/mcp/index.ts`: `createMcpServer` calls `wikiLintTools(server, scopes)`.
- `server/routes/mcp/audit.test.ts`: removed the `userTools` mock that registered `lint_document`. With the tool registered for real, the mock would have registered it twice.
- `server/tools/wikiLint.test.ts`: removed the "does not register the lint tools yet" test and the imports only it used.
- `server/routes/mcp/wikiLint.test.ts` (new): the HTTP acceptance suite, 43 tests covering AC1–AC11 and AC13.

**Deviations and interpretations:**
- **AC5 bullet markers.** v1.10.1 serializes every bullet as `* `, because `BulletList.toMarkdown` has no marker attribute. `- Status: Active` therefore comes back as `* Status: Active`.
  - The suite proves that `- ` input lints clean and converges to the canonical `* ` form.
  - The canonical form round-trips byte for byte, with exact and stable coordinates, which is epic AC5.
  - The spec AC5's literal byte equality for `- ` input does not hold. Changing the serializer is forbidden.
- **Code Map correction.** `buildDocument` does add a published document to the structure (`@AfterCreate`). The repair-loop fixture removes document D explicitly.
- **AC6.** Per AD-14, the admin-only audit listing carries safe `documentId`s whether or not the admin can read the collection. It carries no title, content or link target.

**Review findings breakdown** (one pass, 30 findings: high 0, medium 1, low 21, false 8):
- **Patches applied** (10 entries, all low):
  1. The `lint_document` description now says hierarchy and global-index checks run only in `lint_wiki`.
  2. Both descriptions gained guidance for other System Failures, and `lint_wiki` gained the not-evaluated sentence. This entry groups three findings.
  3. The AC13 enforced entry is asserted valid, and its written document is shown to violate it.
  4. The write-compatibility test now also covers `read_only` and sentinel collections.
  5. The admin's private-collection `lint_wiki` result is asserted whole, with zero counts.
  6. Each AC9 row's `AuditDataV1` key set must match exactly.
  7. Discovery also calls each undiscovered lint tool and expects `isError`.
  8. The repair loop must take exactly 2 rounds.
  9. The front-matter fields are shown to survive the round trip.
  10. The lookup failure also runs with a plain `Error`.
- **Deferred** (2 entries, in frontmatter `deferred`):
  - the README's `- ` metadata example (low);
  - Findings lack the repair knowledge that the loop needs (medium; pre-existing DW-2 and DW-3).
- **Rejected:**
  - **Fix is a spec edit** (low): stale Spec Change Log and Code Map; non-reproducible generic-data evidence; the AC5 marker claim (two findings).
  - **Baseline SDK behaviour, a direct fix would add complexity** (low): a call without `arguments`.
  - **Pre-existing and bounded** (low): cancellation ignored. DW-4 already records it.
  - **Getter replacement, which bypasses only the process cache** (low): the restart model (two findings).
  - **False:**
    - admin audit `documentId` (AD-14), two findings;
    - URL-identifier forms over HTTP (same schema and handler, pinned in memory);
    - rule codes over HTTP (registry-owned severities);
    - empty `collectionId` (Story 1.5 contract);
    - in-process instead of deployed (AC13 excludes deployment);
    - AC8 single transport (results depend only on input and actor);
    - pre-commit provenance (a non-merge commit cannot change it).

**Follow-up review recommendation: false.** This was not a follow-up pass. This pass patched 10 entries, all at verdict `low`: 0 high and 0 medium. Every patch is a test assertion or description text, and the full verification set ran again on the patched tree.

**Verification performed** on the final patched tree (baseline `877dab7d9ab8abc792d5e679683a7291d98d6088` plus this story's changes), against test PostgreSQL 14 at `127.0.0.1:5432/outline-test` with migrations current:

| Command | Result |
| --- | --- |
| `TZ=UTC node_modules/.bin/vitest run --project server server/routes/mcp server/tools server/wikiLint` | `Test Files  33 passed (33)`, `Tests  1059 passed (1059)` |
| `TZ=UTC node_modules/.bin/vitest run --project shared-node --project shared-jsdom shared/editor/nodes/urlSanitization.test.ts` (every Story 1.9 `toDOM` `href`/`src` path) | `Test Files  2 passed (2)`, `Tests  616 passed (616)` |
| `corepack yarn tsc` | exit 0 |
| `node_modules/.bin/oxlint --type-aware` on the five changed source and test files | exit 0 |
| `node_modules/.bin/oxfmt --check` on the same files | exit 0 |
| `grep -rniE "laura\|ezop" server/tools/wikiLint.ts server/tools/wikiLint.test.ts server/routes/mcp/ server/wikiLint/` | no matches (exit 1) |
| `grep -rnEi "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}" server/tools/wikiLint.ts server/routes/mcp/wikiLint.test.ts server/routes/mcp/index.ts` | no matches (exit 1) |
| `grep -rnE "https?://" server/tools/wikiLint.ts server/routes/mcp/wikiLint.test.ts` | no matches (exit 1) |

**Temporary mutations.** Each was scripted against `server/routes/mcp/wikiLint.test.ts`, then restored; `cmp` shows the files identical afterwards.

| Mutation | Tests failed |
| --- | --- |
| `lint_document` gate swapped to `documents.list` | 5 of 43 |
| `lint_wiki` without `collections.list` | 1 of 43 |
| `wikiLintTools` call removed | 35 of 43 |
| `lint_wiki` without `idempotentHint` (before the review patches) | 1 of 42 |

Before the review patches, the implementer also caught these mutations:
- `lint_wiki` without `documents.list` (2 failed);
- `lint_wiki` without `collections.documents` (1 failed);
- `lint_document` with `readOnlyHint: false` (1 failed).

**Provenance (AC12, AC13)**, verbatim. `upstream` was fetched, and `upstream/main` is `d410db1b24594d71b766212282804d79ca18e5c1`.

```
$ git merge-base HEAD 4a5a616a21be800257dc11cef4263d0dd0412156
4a5a616a21be800257dc11cef4263d0dd0412156
$ git rev-list --merges 4a5a616a21be800257dc11cef4263d0dd0412156..HEAD | wc -l
0
$ git merge-base --is-ancestor c17d2c52b3a9e26834b846d27ee9213ee3003c4c HEAD; echo $?
1
$ git diff --stat 4a5a616a21be800257dc11cef4263d0dd0412156 -- server/models/helpers/DocumentHelper.tsx server/commands/documentUpdater.test.ts server/tools/documents.ts server/commands/documentCreator.ts server/commands/documentUpdater.ts | wc -l
0
$ git cherry upstream/main HEAD 4a5a616a21be800257dc11cef4263d0dd0412156 | grep -c '^-'
0
$ git cherry upstream/main HEAD 4a5a616a21be800257dc11cef4263d0dd0412156 | wc -l
23
```

What the output shows:
- **Merge base:** exactly `4a5a616a…`, with no merge commit since.
- **Patch-edit fix:** the upstream container-block fix `c17d2c52…` is not an ancestor, and its files are unchanged from the base.
- **Enforcement:** the MCP write tool and its commands are unchanged, so no enforcement is integrated.
- **Backports:** none of the 23 fork commits has an upstream-equivalent patch.

The story commit is a non-merge commit and touches none of those files, so these facts hold for it too.

**Matrix test audit.** Every I/O-matrix row has a covering test in `server/routes/mcp/wikiLint.test.ts` that ran and passed:
- **Discovery rows:** "lists exactly the tools of a … token", 13 rows. Each row uses an OAuth token and an API key, and calls the undiscovered tools.
- **Valid, Invalid, Warning-only, Unconfigured, Invalid policy:** the matching `results` tests, each on both tools.
- **Runtime failure, Timeout:** "models … of the snapshot reader on both tools".
- **Resource limit:** a held `lintWikiAdmission` lease.
- **Inaccessible dependency, Missing vs denied, Invalid input:** the matching `results` tests.
- **Lookup failure:** run with `DeadlineFloorError` and with a plain `Error`.
- **Audit write fails:** the AC10 `it.each` on both tools.

**Operator actions:** none. No acceptance criterion requires an action outside the repository. AC13 keeps image publication, deployment, OD-2/OD-6/OD-7, rollouts and the Gate 1 decision as separate, unfinished approvals.

**Residual risks:**
- **AC5 marker deviation** (above). If `- ` markers must round-trip literally, the serializer needs a separately approved change.
- **Repair knowledge** (deferred; DW-2 and DW-3). A real agent needs the collection's documented conventions to repair missing metadata values or global-index links.
- **Restart model.** One test file cannot restart its process. Policy reaches the server through the real master loader and worker decode, then the replaced `getPolicySet`. The per-process cache is covered separately by `server/wikiLint/adapters/policyConfig.test.ts`.
- **Repair-loop patch edits** are single-line. The upstream container-block patch defect (`c17d2c52…`) stays excluded and untested here.
- **Cancellation.** A cancelled `lint_wiki` keeps the scan slot until it ends, within the 60 s deadline. This is pre-existing; DW-4 covers it.
