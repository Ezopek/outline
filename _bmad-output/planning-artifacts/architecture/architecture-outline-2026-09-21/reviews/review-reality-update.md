# Reality and currency review, update pass (2026-09-30)

Lens: verify that every committed decision was reality-checked against the web, the existing project, or the current starter, rather than asserted from training data. Scope: (1) Stack table vs repo manifests and CI; (2) brownfield claims behind the 2026-09-30 changes; (3) technical claims about JSON, Postgres and Sequelize semantics.

Reviewed: `ARCHITECTURE-SPINE.md` (updated 2026-09-30) and `.memlog.md`, against working tree HEAD `f4770a4df357dd57f121effdb50148a03b7ab9f7`. `git diff 4a5a616a2... -- server shared app plugins package.json yarn.lock Dockerfile Dockerfile.base .github` shows only `server/tools/README.md` differs, so every code reference below is baseline `v1.10.1^{}` code. `git rev-parse 'v1.10.1^{}'` = `4a5a616a21be800257dc11cef4263d0dd0412156` and the tag object is `9686f7264506a910ed87a4ad8704bafd361a3393`; both match `CLAUDE.md` and the spine. `git merge-base HEAD 4a5a616a2` = the baseline. No repo file was modified except this review. I did not run `git fetch` because the task was read-only; currentness of `origin` is therefore unverified, and it does not matter for a fixed baseline.

## Verdict

PASS WITH FINDINGS. Every Stack row and every brownfield claim checked matches the baseline code; nothing is fabricated. No Critical or High finding. Five Medium findings concern currency and under-specified reality seams: the Node runner is pinned below two security releases, the AD-11 timeout precondition has no per-endpoint knob, the AD-8 lock/re-fetch order is ambiguous against a baseline lock that does not protect, the C-5 no-collection-read enumeration is incomplete, and the "startup-fatal" behavior is unspecified against a supervisor that respawns workers forever.

Severity scale: High = would make a committed decision unimplementable or unsafe as written; Medium = a real reality gap or stale fact an implementer would hit; Low = imprecision, terminology, or hardening note.

## Findings summary

| ID | Severity | Finding |
| --- | --- | --- |
| R-1 | Medium | Node `26.3.0` matches the baseline but predates two security releases (26.3.1 and 26.5.1, 4 High CVEs in total); `engines` excludes the patched releases; CI floats on `26.x`. |
| R-2 | Medium | AD-11 "/mcp transport timeout at least 65 s" has no per-endpoint knob. Only global `REQUEST_TIMEOUT` exists (default 10 s); raising it has side effects, and baseline `statement_timeout` is absent in the default all-in-one deployment. |
| R-3 | Medium | AD-8 lists re-fetch before lock; baseline `documentUpdater` applies the edit before the lock and its lock never refreshes the document. The rule must say lock, then read. |
| R-4 | Medium | C-5 enumeration (AD-12, AD-18) omits a third no-collection-read path (create under a document-membership parent); the publish gap is also not team-scoped. |
| R-5 | Medium | "Startup-fatal" (AD-5, AD-19) is not tied to a place. Baseline `throng` revives failed workers forever; the master-level `checkPendingMigrations` is the precedent. |
| R-6 | Low | markdown-it `14.3.0` has a medium advisory (GHSA-253c-mchw-3w2r, 2026-09-29), not exploitable on the server path as configured (`linkify: false`). |
| R-7 | Low | Memlog note "stock JSON.parse loses source form for -0" is wrong for `-0`; reviver `context.source` also recovers number and string source text. The custom decoder is still justified. |
| R-8 | Low | Sequelize `readOnly: true` does not make a Postgres read-only transaction (AD-10). |
| R-9 | Low | Committed write can still surface as a rejection: `afterCommit` hook failures reject a managed `sequelize.transaction()` after the DB commit. |
| R-10 | Low | Enrichment omission (AD-12, AD-20) conflicts with baseline response assembly; "protocol error" wording conflicts with MCP spec terminology; no baseline carrier for an error identifier. |
| R-11 | Low | New `wikiLint.*` Events are not inert: `@AfterSave` fans them into the global queue and wildcard webhook/websocket processors. |
| R-12 | Low | AD-16 1 MiB per-document cap is stricter than the baseline text limit (1,536,000 chars). |
| R-13 | Low | PostgreSQL `14.2` reference: matches CI pin, but 14.24 exists and PG 14 reaches end of life 2026-11-12. |
| R-14 | Low | AD-17 manifest omits process-topology settings that define "per process" (`SERVICES`, `WEB_CONCURRENCY`, `REQUEST_TIMEOUT`, pool size). |
| R-15 | Low | Sentinel step list (AD-8) separates lookup from authorization; baseline interleaves them. Memlog line 20 is stale versus AD-10. |

## A. Stack table

| Row | Spine value | Evidence in repo | Currency check (2026-09-30) | Status |
| --- | --- | --- | --- | --- |
| Outline baseline | `v1.10.1^{}` / `4a5a616a…` | `git rev-parse` output above; `package.json:391` `"version": "1.10.1"` | n/a (fork policy, D-8) | VERIFIED |
| Node.js production runner | `26.3.0` | `Dockerfile:9` `FROM node:26.3.0-slim AS runner`; `Dockerfile.base:2` `FROM node:26.3.0 AS deps` | Exists (Docker Hub `node:26.3.0-slim` active, pushed 2026-06-11). Newer: 26.3.1 (security, 2026-06-17), 26.5.1 (security, 2026-07-28), current 26.10.0 (2026-09-21). 26.x is the Current line, not LTS. | VERIFIED, STALE (R-1) |
| Yarn | `4.11.0` | `package.json:392` `"packageManager": "yarn@4.11.0"`; `.yarnrc.yml` uses `npmMinimalAgeGate` (a Yarn 4.10+ setting) | `@yarnpkg/cli-dist@4.11.0` exists on npm; latest is 4.18.1 | VERIFIED |
| TypeScript | `6.0.3` | `package.json:371` `"typescript": "^6.0.3"`; `yarn.lock:20064` resolves 6.0.3 (a second 5.9.3 entry serves `^5.0.4` consumers) | `typescript@6.0.3` exists, not deprecated; npm `latest` is 7.0.2. `tsconfig.json:5` `"strict": false` (matches `CLAUDE.md`). | VERIFIED |
| MCP TypeScript SDK | `1.29.0` | `package.json:86` `^1.25.3`; `yarn.lock:2840-2841` resolves 1.29.0 | `1.29.0` exists, not deprecated, 0 GitHub advisories; npm `latest` is 1.31.0 | VERIFIED |
| Sequelize | `6.37.8` | `package.json:248` `^6.37.8`; `yarn.lock:18504` | `6.37.8` is npm `latest` for v6, 0 advisories; v7 is still alpha | VERIFIED, CURRENT |
| Zod | `4.5.4` | `package.json:282,381` `^4.5.4` (dependency and resolution); `yarn.lock:21536` | `4.5.4` exists, 0 advisories; npm `latest` is 4.6.5 | VERIFIED |
| markdown-it | `14.3.0` | `package.json:177` `^14.3.0`; `yarn.lock:14480` | `14.3.0` exists; **GHSA-253c-mchw-3w2r** (medium, published 2026-09-29) fixed in 14.3.1; `v14-legacy` tag is 14.3.2; latest is 15.0.2 | VERIFIED, ADVISORY (R-6) |
| PostgreSQL perf reference | `14.2` | `.github/workflows/ci.yml:115` `image: postgres:14.2`; `docker-compose.yml:8` uses unpinned `postgres` | Tag exists (Docker Hub, 2022-05-12); latest 14.x is 14.24; end of life 2026-11-12 | VERIFIED, STALE (R-13) |

CI facts the spine cites but does not state: `.github/actions/install/action.yml` uses `node-version: 26.x` (floating, today 26.10.0); `.nvmrc` is `26`; `package.json:45` `engines.node` is `>=20.12 <21 || 22 || 24 <24.17.0 || 26 <26.3.1`. The sentence "Versions are verified from the selected repository commit's Dockerfile, package.json, yarn.lock, and CI configuration" is accurate about provenance but silent about currency (R-1, R-6, R-13).

## B. Brownfield claims

### B1. Claims behind the 2026-09-30 changes

| # | Claim | Evidence | Status |
| --- | --- | --- | --- |
| 1 | `authorizeDocumentPublish` (`documentCreator.ts:111-146`) for a parent-bearing collectionless draft checks only `createChildDocument` on the parent and never authorizes the destination collection. | `documentCreator.ts:124-133` loads `Collection.findByPk(collectionId, {userId})` with no `authorize`; `:135-140` calls `authorize(user, "createChildDocument", parentDocument, { collection })`. | VERIFIED |
| 2 | The policy ignores the `collection` option (`policies/document.ts:151`). | `policies/document.ts:151-157` is `allow(User, "createChildDocument", Document, (actor, document) => and(!document?.isDraft, can(actor, "update", document)))`; the callback takes two parameters. `cancan.ts:320` passes `options` but no policy under `server/policies/` reads it. | VERIFIED |
| 3 | `Collection.findByPk` with `userId` left-joins memberships (`required: false`) and filters by neither team nor read access. | `Collection.ts:154-199` (`withMembership`, `required: false`); `:662-710` queries `where: { id }` only; the default scope only excludes `documentStructure` (`:91-95`). | VERIFIED |
| 4 | Document-membership updates do not check collection read. | `policies/document.ts:86` (`update`: `can(read, document)` and `includesMembership(ReadWrite/Admin)` or collection `updateDocument`); `:21` (`read` is satisfied by document membership alone). The baseline itself documents this in the `getDocumentBreadcrumb` comment, `server/tools/util.ts:241-254`. | VERIFIED |
| 5 | MCP tools use catch-and-`error()`. | `create_document` (`documents.ts:499-501`), `move_document` (`:607-609`), `update_document` (`:763-765`), `restore_document` (`:881-883`) all `catch (message) { return error(message); }`; `error()` (`util.ts:104-112`) returns `{ isError: true, content: [text] }` with only `errToString(err)`. | VERIFIED |
| 6 | Response assembly and enrichments. | `create_document` builds breadcrumb after the transaction commits (`documents.ts:489-498`); `move_document` (`:596-606`) and `restore_document` (`:870-880`) likewise. `update_document` non-patch returns id/title/url plus breadcrumb (`:724-735`); patch returns two text blocks from one `Promise.all([presentDocument, getDocumentBreadcrumb, getPublicShareUrlForDocument])` (`:737-762`). Share URL appears only in the patch path. `getDocumentBreadcrumb` (`util.ts:255-286`) runs `Collection.findByPk` and `getCachedDocumentStructure` with no try/catch, so a throw after commit becomes an `isError` result today. | VERIFIED (see R-10) |
| 7 | Unchanged-update check via `revisionCount`. | `documents.ts:702-718`; `Document.ts:585` increments `revisionCount` in `@BeforeUpdate processUpdate`; the check runs after `documentUpdater` (handler level, after the writer). `documentUpdater.ts:134-160` saves only when `document.changed()`, `publish` or `done`. Sequelize 6.37.8 runs `beforeUpdate` hooks even on an unchanged instance, so "every save increments" holds; the check works by the absence of a save. Collaborative persistence also bumps the counter manually (`documentCollaborativeUpdater.ts:111`), so the pre-lock comparison is racy (R-3). | VERIFIED |
| 8 | Unpublish uses `detach: false`. | `documents.ts:692-694`; `Document.ts:1361` nulls `collectionId` only when `detach` is true, so the draft keeps its collection (matches AD-8 "existing `document.collectionId`"). The "unpublish precondition" is inside `unpublishWithCtx` (`:1327-1336`, throws "Cannot unpublish document with child documents"), i.e. inside the operation, as AD-8 says. | VERIFIED |
| 9 | MCP `AuthInfo`/OAuth client id propagation. | `routes/mcp/index.ts:172-177` sets `clientId: ""` and `extra: { user, scope, ip }` only. `authentication.ts:189` loads the token with `oauthClient` included (`OAuthAuthentication.ts:198-207`, `required: true`) but `validateAuthentication` returns only `{user, type, token, service, scope}` (`:306`). `OAuthClient.clientId` is the public id (`OAuthClient.ts:87`). Extending the private result is a small, real seam. The only outcomes of `validateAuthentication` are `OAUTH`, `API`, `APP`; `AuthenticationType.MCP` is accepted by the route filter (`index.ts:139`) but produced only by `buildAPIContext` (`util.ts:42`). So `oauth | api` is complete. `AuthInfo.extra` and a native `clientId` field both exist in SDK 1.29.0 (`dist/cjs/server/auth/types.d.ts`). | VERIFIED |
| 10 | `events.list` audit path and self-host. | `events.ts:40-46` gates audit on `authorize(user, "audit", user.team)`; `policies/team.ts:44-50` makes `audit` require `isCloudHosted()`, confirming the need for a new narrow capability (AD-15). `events.ts:34-35` requires `actorId != null`. Existing indexes: `name`, `actorId`, `[teamId, collectionId]`, `documentId`, `userId`, `createdAt`; no `(teamId, name, createdAt)`. Retention is a hard-coded 365 days (`CleanupOldEventsTask.ts:14`). | VERIFIED |

### B2. Memlog "direction" entries

| Memlog line | Claim | Status |
| --- | --- | --- |
| 12 | Markdown create runs `documentCreator` in a Sequelize transaction; HTML create converts in `DocumentImportTask` and persists in a worker transaction; MCP update calls `documentUpdater` without a transaction. | VERIFIED: `documents.ts:466-487`; `DocumentImportTask.ts:95-115`; `update_document` (`:676-766`) has no `sequelize.transaction`, and `buildAPIContext` sets no transaction (`util.ts:34-51`). |
| 13 | `applyMarkdownToDocument` implements replace/append/prepend/patch on the in-memory document; `documentUpdater` locks only when a transaction exists. | VERIFIED: `DocumentHelper.tsx:660-735`; `documentUpdater.ts:118`. |
| 14 | Base64/remote media preprocessing creates Attachment rows and storage objects before document persistence. | VERIFIED: `documentUpdater.ts:100-108` calls `TextHelper.replaceImagesWithAttachments` (`TextHelper.ts:67-129`) → `attachmentCreator` (`FileStorage.storeFromUrl/store` then `Attachment.createWithCtx`). On the MCP update path there is no transaction, so rows commit immediately. |
| 15 | Authorization is cancan policies plus membership-aware scopes. | VERIFIED: `includesMembership` `invariant`s preloaded memberships (`policies/document.ts:274-289`). |
| 16 | `documentStructure` is cached in Redis for ordinary reads; the authoritative JSONB column must be read for a coherent snapshot. | VERIFIED: `Collection.ts:772-792` (`getCachedDocumentStructure`, TTL 60 s at `:599`); column typed `NavigationNode[] | null` (`:268`); `withDocumentStructure` scope (`:147-152`). |
| 17 | `Event.schedule` is queue-only; `createFromContext` uses the caller transaction; audit retrieval filters `EventHelper.AUDIT_EVENTS`. | VERIFIED: `Event.ts:134-144`, `:168-190`; `events.ts:40-46`. `EventHelper` lives in `shared/utils/EventHelper.ts` (client-shared), not `server/`. |
| 18 | Baseline `AuthInfo.clientId` is an empty string. | VERIFIED: `routes/mcp/index.ts:175`. |
| 19 | Default `REQUEST_TIMEOUT` is 10 s. | VERIFIED: `env.ts:318-319`. Additional consequences in R-2. |
| 20 | Conversion uses the configured Markdown-It and ProseMirror parser/serializer; `toDOM` emitters use `sanitizeUrl`/`sanitizeImageSrc`; "`Document.text` is canonical Markdown and the source-coordinate basis". | First two VERIFIED: `rules.ts:20-25` (`html: false`, `linkify: false`); `Link.tsx`, `Video.tsx`, `Attachment.tsx`, `Embed.tsx`, `Mention.tsx` use `sanitizeUrl`; `Image.tsx`, `SimpleImage.tsx` use `sanitizeImageSrc` (`urls.ts:236-246`, which falls back to `sanitizeUrl`). Third is STALE relative to AD-10: `Document.ts:373-378` marks `text` deprecated and `DocumentUpdateTextTask.ts:16` refreshes it asynchronously. The spine is right; the memlog line is outdated (R-15). |

## C. Technical claims

### C1. JSON (AD-5, AD-6, memlog C-4). Tested on Node 24.16.0 / V8 13.6 (Node 26.3.0 ships V8 14.x)

| Claim | Result | Status |
| --- | --- | --- |
| Stock `JSON.parse` accepts lone surrogates. | `JSON.parse('"\\ud800"').isWellFormed()` is `false`. | VERIFIED |
| Keeps the last duplicate key, top level and nested. | `{"a":1,"a":2}` → `{a:2}`; nested `{c:{a:1,a:2,a:3}}` → `{c:{a:3}}`. A reviver sees only the final value. | VERIFIED |
| Loses source form for `1e2`. | `JSON.parse('1e2')` → `100` (integer). | VERIFIED |
| Loses source form for big integers. | `9007199254740993` → `9007199254740992`, not a safe integer. | VERIFIED |
| Loses source form for `-0`. | `Object.is(JSON.parse('-0'), -0)` is `true`; the value keeps its sign. | WRONG as stated (R-7) |
| "Stock JSON.parse reports none of them" (AD-5 rationale). | The reviver's third argument (`context.source`) returns source text for primitives: `-0`, `1e2`, `9007199254740993`, `"\ud800"`, `1.0` all came back verbatim. It does not report duplicates and gives no offsets or byte spans. | PARTLY WRONG (R-7) |
| Canonical string escaping (AD-6). | `JSON.stringify` uses `\b \t \n \f \r`, lowercase `\u00xx` for other C0 controls, and leaves U+007F, U+2028, U+2029 raw. This matches AD-6 exactly. | VERIFIED |
| Key order must be UTF-8 byte order, not the JS default (AD-4, AD-6). | Default `.sort()` gives `["a","é","𐀀","￿"]`; UTF-8 byte order gives `["a","é","￿","𐀀"]`. The spine is right to specify bytes. `.oxlintrc.json` already enforces `typescript/require-array-sort-compare`. | VERIFIED |
| Other decoder facts an implementer will hit. | `JSON.parse` rejects a leading BOM; a `"__proto__"` key becomes an own property under `JSON.parse` but would pollute if a custom decoder assigns with `obj[key] = v`. The byte-span definition in AD-6 needs a BOM/invalid-UTF-8 decision. | INFO |

### C2. PostgreSQL (AD-8, AD-10), PG 14 docs

| Claim | Evidence | Status |
| --- | --- | --- |
| `REPEATABLE READ` reads one snapshot taken at the first non-transaction-control statement. | PG14 docs, "Transaction Isolation": "a query in a repeatable read transaction sees a snapshot as of the start of the first non-transaction-control statement in the transaction". Outline's `SET LOCAL statement_timeout` wrapper (`database.ts:333-345`) is a `SET`, not a query, and Sequelize issues `START TRANSACTION; SET TRANSACTION ISOLATION LEVEL …` (`transaction.js:108-114`) before any query, which is allowed ("cannot be changed after the first query", PG14 `SET TRANSACTION`). | VERIFIED |
| A read-only `REPEATABLE READ` transaction cannot fail with a serialization error. | PG14 docs: "read-only transactions will never have serialization conflicts". AD-10 takes no row locks. | VERIFIED |
| Under `READ COMMITTED` (Outline's default; no isolation level is set in `database.ts`) `SELECT … FOR UPDATE` locks and returns the updated version of a row that changed while it waited. | PG14 docs: "in the case of SELECT FOR UPDATE and SELECT FOR SHARE, this means it is the updated version of the row that is locked and returned". So lock-then-read is sound; read-then-lock is not (R-3). | VERIFIED |
| `FOR UPDATE` on a join with a nullable side fails. | Not confirmed from the docs page I fetched. Repo convention avoids it with `lock: { level, of: Model }` (`documentCollaborativeUpdater.ts:46-49`, and many routes). | UNVERIFIABLE from source; convention noted |
| Row-lock wait bounded by `statement_timeout`. | `documentUpdater.ts:112-115` comment assumes it. True only where `statementTimeout` is defined (R-2). | PARTLY VERIFIED |

### C3. Sequelize 6.37.8 (read from the published tarball)

| Claim / usage | Evidence | Status |
| --- | --- | --- |
| Managed `sequelize.transaction(cb)` commits on resolve, rolls back on throw. | `sequelize.js:493-518`. | VERIFIED |
| `lock: transaction.LOCK.UPDATE` yields `FOR UPDATE`; repo already uses it on documents. | `documentUpdater.ts:121-128`; `documentCollaborativeUpdater.ts:44-52`. | VERIFIED |
| `readOnly: true` makes the transaction read-only. | `transaction.js:26-27,79-81`: only selects the `SELECT` (replica) connection pool; `startTransactionQuery` is plain `START TRANSACTION;` (`query-generator/transaction.js:13-18`); no `READ ONLY` anywhere in `lib`. Outline's `sequelize` instance configures no replication. | WRONG if assumed (R-8) |
| Post-commit behavior. | `transaction.js:44-56`: `afterCommit` hooks run in a `finally` after the DB commit; a rejecting hook makes `commit()` (and the managed `transaction()`, `sequelize.js:515`) reject although the data is durable. | VERIFIED (R-9) |

## D. Findings in detail

### R-1 (Medium) Node runner is verified but stale and below two security releases

Evidence: `Dockerfile:9` and `Dockerfile.base:2` pin `26.3.0`. `nodejs.org/dist/index.json` lists 26.3.1 (2026-06-17, security), 26.5.1 (2026-07-28, security) and 26.10.0 (2026-09-21). Release notes: 26.3.1 fixes 10 CVEs (2 High: CVE-2026-48618 TLS hostname identity check, CVE-2026-48933 WebCrypto crash); 26.5.1 fixes 10 CVEs (2 High: CVE-2026-56848 http2, CVE-2026-58043 permission model). `package.json:45` `engines.node` ends `26 <26.3.1`, which excludes every patched release, while CI floats on `26.x`. 26.x is the Current line (not LTS).

Impact: the spine states the runner as a bare version and never says it is a known-vulnerable pin. AD-17 says "baseline Node/Yarn" but the baseline is inconsistent (Docker 26.3.0 vs CI floating vs `engines`). A benchmark on 26.10.0 or 26.3.0 would both claim "baseline".

Recommendation: annotate the Stack row "pinned by baseline; later security releases exist; runner bump is a separate release-operator decision under D-3/D-8"; make the AD-17 manifest record the exact `node --version` used and require it to be the Dockerfile runner version.

### R-2 (Medium) AD-11 timeout precondition and the statement-timeout assumption

Evidence: the only HTTP timeout is `server.setTimeout(env.REQUEST_TIMEOUT)` (`main.ts:146`), a global socket-idle timeout with no `timeout` listener in the repo. Default 10 s (`env.ts:318-319`). No `/mcp`-specific setting exists (`routes/mcp/index.ts` sets none). Raising it also: (a) raises the Postgres `statement_timeout` for every transaction to `REQUEST_TIMEOUT - 500 ms` (`database.ts:54,70-82,333-345`); (b) changes per-image fetch timeouts, `min(REQUEST_TIMEOUT / images, 10000)` (`TextHelper.ts:78-80`). And `statementTimeout` is defined only when `isApiProcess && cluster.isWorker` (`database.ts:62-77`); `isApiProcess` is false when `worker` or `cron` is among `SERVICES`, and the default is `"collaboration,websockets,worker,web"` (`env.ts:349-357`). In the default all-in-one deployment there is no baseline statement timeout at all, so the comment in `documentUpdater.ts:112-115` ("already bounded by the transaction's statement_timeout") does not hold there.

Impact: AD-11's "at least 65 seconds" is really "set the global `REQUEST_TIMEOUT` to at least 65000", which changes unrelated behavior. AD-20 row 3 ("row-lock or statement timeout at the AD-8 re-fetch") and AD-11 ("each DB deadline capped by remaining time") need new, code-owned `lock_timeout`/`statement_timeout` (precedent: `documentCollaborativeUpdater.ts:35` `SET LOCAL lock_timeout = '15s'`), not the baseline's. A reverse proxy in front of the app (outside the repo) has its own read timeout; not verifiable here.

Recommendation: reword the deployment precondition as the global `REQUEST_TIMEOUT` plus proxy read timeout; state that the enforcement transaction sets its own `SET LOCAL lock_timeout/statement_timeout` from the remaining deadline.

### R-3 (Medium) AD-8 order: lock first, then read

Evidence: `documentUpdater.ts:100-108` applies the Markdown edit (`applyMarkdownToDocument`) to the in-memory `document` before the lock; the lock at `:118-132` selects only `attributes: ["id"]` and never refreshes `document`, so append/prepend/patch can overwrite a concurrent edit unless `lastRevision` is supplied. Collaborative persistence takes `FOR UPDATE OF documents` on the same row (`documentCollaborativeUpdater.ts:44-52`), so a shared lock would serialize the two writers. AD-8 reads "re-fetches and re-authorizes all mutation inputs, locks the update document row, builds the authoritative projection".

Impact: re-fetch before lock reproduces the baseline stale-read window that AD-8 says it prevents (Read Committed re-evaluates only rows returned by the locking statement itself; PG14 docs above). The unchanged-update check compares a pre-lock `revisionCount` to a post-save value and can be fooled by a concurrent collaborative save (`documentCollaborativeUpdater.ts:111` bumps the counter).

Recommendation: state "lock the target row (`FOR UPDATE OF documents`), then re-fetch and re-authorize, then project", and read `revisionCount` after the lock.

### R-4 (Medium) The no-collection-read enumeration is incomplete; the gap is broader than recorded

Evidence: AD-12 and AD-18 name two paths (document-membership updates; publication of a parent-bearing collectionless draft). A third exists: `create_document` with `parentDocumentId` (`documentCreator.ts:70-83`) looks up the parent's collection with `Collection.findByPk` (no authorization) and authorizes only `createChildDocument` on the parent (`update` → document membership is enough). The classified collection for that create is the parent's collection. Also, the publish path (`documents.ts:698-707`, `documentUpdater.ts:144-148`, `Document.ts:1249-1262`) publishes into whatever collection id is supplied: `Collection.findByPk` has no team filter, and `Document.publish` calls `addDocumentToStructure` on it. On a single-team self-host that means a collection the actor cannot access; in a multi-team database it could be another team's collection.

Impact: the C-5 rule ("enforcement layer makes this check") is general enough to cover it, but AD-18's test list would miss the create-under-membership-parent case, and the memlog description ("reported separately") understates the baseline gap. Because the spine does not fix the gap, an enforced policy can still validate and persist a write into a collection the actor cannot read or create in.

Recommendation: add the third path to the AD-12 sentence and the AD-18 fixture list; put the separate baseline-authorization report on the D-8 backport ledger.

### R-5 (Medium) "Startup-fatal" needs a location

Evidence: `throng@5.0.0` (`lib/throng.js`) revives any worker on `cluster` `disconnect` while running, with `lifetime: Infinity`; `server/index.ts:34-36` defines `master()`, which `throng` runs before forking (`:56-62`). A check that fails inside a worker (where `main.ts`/`env` live) produces a crash loop rather than a stop. The baseline precedent for a real stop is `checkPendingMigrations` in `master()` (`utils/startup.ts:75-97`, `process.exit(code)`). Both web and `worker` services would also need the config, because `DocumentImportTask` runs in a worker (`DocumentImportTask.ts`), and `/_health` (`main.ts:78-97`) currently only pings the DB and Redis (no place to report a fingerprint).

Recommendation: AD-5/AD-19 should say the config is validated in the master (or a forked check like migrations) and that every service process loads it; readiness fingerprint reporting needs an explicit extension of `/_health` or a new endpoint.

### R-6 (Low) markdown-it advisory

`GHSA-253c-mchw-3w2r` (medium, 2026-09-29): `linkify: true` has two quadratic paths (89 s for 273 KB in their PoC); patched in 14.3.1 (14.x) and 15.0.1. Server-side rules are `linkify: false` (`rules.ts:24`); `linkify: true` appears only in the client editor (`app/editor/index.tsx:482`). So the baseline server path, and any lint path that reuses `makeRules`, is not exposed. Add a note: any new `MarkdownIt` instance in `server/wikiLint` must keep `linkify: false`. A synchronous parse also cannot be preempted by the AD-11 deadline, which is checked only between units.

### R-7 (Low) JSON.parse claim is partly wrong

See C1. The conclusion (custom duplicate-aware decoder with source byte spans) stands because duplicates and byte spans are unavailable from stock parsing. The rationale text in memlog C-4 and AD-5 ("loses source form for -0", "stock `JSON.parse` reports none of them") should be narrowed: `-0` is detectable with `Object.is`, and the reviver `context.source` (V8 11.4+, present on the Node 26 runner) recovers number and string source text. Note that `engines` still admits Node 20.12, where the reviver form is absent; the runner is 26.3.0.

### R-8 (Low) `readOnly` in Sequelize v6

AD-10 says "read-only `REPEATABLE READ` transaction". With 6.37.8 the `readOnly` option only picks a replica pool; the read-only property needs an explicit `SET TRANSACTION READ ONLY` (or `SET LOCAL transaction_read_only = on`) before the first query. Isolation level via the option is fine. AD-10 also correctly forbids replicas (Consistency Conventions), so the option must not be relied on.

### R-9 (Low) Post-commit rejection

`Transaction.commit()` awaits `afterCommit` hooks after the database commit (`transaction.js:44-56`); the managed wrapper awaits `commit()` outside its try block (`sequelize.js:515`). A hook that rejects makes an already durable write look failed. Repo hooks mostly swallow errors today (`CacheHelper.setData` catches, `Event.enqueue` uses `void`), so exposure is low, but AD-20 rows 5/6 should say the committed/uncommitted discriminator is `transaction.finished === "commit"`, not "did `sequelize.transaction()` reject".

### R-10 (Low) Response assembly, terminology, error identifier

- Baseline patch mode builds the identity fields and the echo from one `presentDocument` call inside one `Promise.all` (`documents.ts:737-746`), and its success shape has no `success` key. AD-12's "patch preserves its final-Markdown block" and "a failure assembling patch echo omits it" are in tension, and omitting the echo while keeping identity fields needs the call split. The rejected shape `{ success: false, validation }` has no success-shape counterpart in patch mode.
- MCP spec 2025-11-25 (server/tools, "Error Handling") names `isError: true` results "Tool Execution Errors" and reserves "Protocol Errors" for JSON-RPC errors. AD-8/AD-12/AD-20 say "protocol error" for `isError` results. Baseline never uses JSON-RPC errors for tool failures. Rename to avoid an implementer throwing `McpError`.
- `error()` carries only a message string (`util.ts:104-112`); `errToId` exists (`shared/utils/error.ts:29-34`) but is unused there. The "stable collection-conflict error identifier" (AD-8) needs a defined carrier (text token or `structuredContent`).

### R-11 (Low) Event persistence is not inert

`Event.create` triggers `@AfterSave enqueue` → `globalEventQueue().add` after commit (`Event.ts:80-97`); `services/worker.ts:68-80` fans out to any processor whose `applicableEvents` includes the name or `"*"`. The webhook plugin's processor is `["*"]` (`plugins/webhooks/server/processors/WebhookProcessor.ts:7`); for a team with a wildcard subscription, `DeliverWebhookTask` reaches `assertUnreachable`, which only logs a warning (`DeliverWebhookTask.ts:78-80`). Also `events.list` validates `events` with `z.enum(EventHelper.AUDIT_EVENTS)` (`schema.ts:12`), and `EventHelper` is in shared code, so adding names touches client-visible code. Neither breaks the design; AD-14 should mention the fan-out so "no externally visible side effects" is checked for audit rows too.

### R-12 (Low) Per-document cap vs baseline limit

`DocumentValidation.maxLength` is `1500 * 1024` (1,536,000 characters, `shared/validations.ts:84-85`); AD-16 caps 1 MiB UTF-8. A baseline-valid document between the two (or with multibyte text) yields `VALIDATION_RESOURCE_LIMIT_EXCEEDED`, which in `closed` mode blocks a legal write. AD-17's largest fixture is 128 KiB, so the cap boundary is never exercised. Either derive the cap from the baseline limit or record the intentional mismatch.

### R-13 (Low) PostgreSQL reference

`postgres:14.2` matches CI and exists, but is from 2022; 14.24 is available and PG 14 reaches end of life on 2026-11-12 per multiple sources. The RR/row-lock semantics quoted above come from the PG 14 docs; I did not verify later majors. The manifest should record the operator's actual server version.

### R-14 (Low) AD-16/AD-17 "per process" depends on unrecorded settings

`WEB_CONCURRENCY` defaults to the host CPU count (`server/index.ts:18-30`, `throng` `count`), except it is forced to 1 when `collaboration` runs without `REDIS_COLLABORATION_URL`; `DATABASE_CONNECTION_POOL_MAX` defaults to 5 (`database.ts:57`), and an AD-10 snapshot holds a connection for the whole snapshot build. "One concurrent `lint_wiki` per server process" therefore means N per instance. AD-17's manifest lists CPU/kernel/container limits but not `SERVICES`, `WEB_CONCURRENCY`, `REQUEST_TIMEOUT`, or the pool size.

### R-15 (Low) Sentinel step order and a stale memlog line

AD-8 lists (3) lookup of document/parent/template, then (4) handler-level authorization. Baseline interleaves them: `authorizeDocumentCreate` looks up and authorizes the parent or collection first, then the template is looked up and authorized (`documents.ts:430-441`); update does lookup → `update` → `authorizeDocumentPublish`. "In baseline order" saves the text, but the numbered list suggests a separation that does not exist. Memlog line 20 (`Document.text` as coordinate basis) contradicts AD-10; the spine is right.

## E. Checked and clean

- Classification rule for creates: `create_document` passes `collectionId: collection?.id` from the authorization result to both writers (`documents.ts:461,477`), never the raw input. Update-with-publish of a draft that already has a collection ignores a differing raw `collectionId` in `Document.publish` (`Document.ts:1249-1251` only sets it when empty), so classifying by `document.collection` is sound.
- `Collection.documentStructure` is a JSONB column readable without the cache (`Collection.ts:147-152,268`).
- `findAllInBatches` (`models/base/Model.ts:407-477`) implements a real keyset cursor; it compares with `Op.eq` and `Op.gt`, so a `NULL` cursor column (draft `collectionId`) would drop rows. Not an issue for published-document scope, but do not include drafts in a keyset on `collectionId`.
- Forbidden-import check (AD-18) has a seam: `.oxlintrc.json:85` already uses `no-restricted-imports` in overrides.
- Node 26 no longer bundles Corepack; `Dockerfile.base:12-13` installs it with npm, and Yarn stays pinned by `packageManager`.
- `getDocumentBreadcrumb` already withholds collection names from actors without collection read (`util.ts:241-254`), a baseline precedent for C-5.

## Sources

- npm registry: `registry.npmjs.org/-/package/{typescript,@modelcontextprotocol/sdk,sequelize,zod,markdown-it,pg}/dist-tags` and per-version documents for the pinned versions
- Node release index: https://nodejs.org/dist/index.json; release notes https://nodejs.org/en/blog/release/v26.3.1 and https://nodejs.org/en/blog/release/v26.5.1; https://www.hkcert.org/security-bulletin/node-js-multiple-vulnerabilities_20260622
- Docker Hub: `library/node` tag `26.3.0-slim`; `library/postgres` tags `14.2`, `14.9`–`14.24`
- GitHub advisory API: https://github.com/advisories/GHSA-253c-mchw-3w2r; 0 results for the other pinned versions
- PostgreSQL 14 docs: https://www.postgresql.org/docs/14/transaction-iso.html, https://www.postgresql.org/docs/14/sql-set-transaction.html; EOL date: https://endoflife.ai/postgresql/14, https://www.herodevs.com/blog-posts/postgresql-eol-dates-every-versions-release-end-of-life-timeline
- MCP specification 2025-11-25, Tools, Error Handling: https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- Sequelize 6.37.8 source (published tarball): `lib/transaction.js`, `lib/sequelize.js`, `lib/model.js`, `lib/dialects/abstract/query-generator/transaction.js`; throng 5.0.0 `lib/throng.js`; MCP SDK 1.29.0 `dist/cjs/server/auth/types.d.ts`
- Empirical JSON checks: Node 24.16.0 (V8 13.6.233.17), scratch scripts in the session scratchpad
