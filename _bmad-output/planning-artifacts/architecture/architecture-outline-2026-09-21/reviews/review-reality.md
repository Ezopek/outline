# Reality and currency review

## Verdict

**PASS.** The revised spine is consistent with the checked-out `v1.10.1` fork and gives implementable seams for every committed decision reviewed here. No Critical or High reality/currency finding remains.

## Review scope and authority

- Reviewed `_bmad-output/planning-artifacts/architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md` against repository code at local planning head `dcbca1bf510807362ffc2ef7b4b9f33e93520e3e`.
- Refreshed `origin` and verified `HEAD...@{upstream}` is `0 0`. Existing unrelated dirty planning artifacts were not modified.
- The repository and selected baseline settle the named technologies and integration points; no web lookup was needed.
- This final recheck concentrated on the six seams changed after the previous review: authoritative document conversion, document keyset columns, credential attribution, duplicate-aware configuration decoding, HTML-worker intent, and media staging/materialization.

## Final recheck

### Authoritative document content and snapshot conversion — verified

AD-10 now snapshots authoritative `content/state`, applies baseline serialization to canonical Markdown, and explicitly excludes asynchronously refreshed `Document.text` as authority. This matches `server/models/Document.ts`, where `text` is deprecated, and `server/models/helpers/DocumentHelper.tsx`, where conversion prefers `content`, then collaborative `state`, and only then legacy Markdown. It also matches `server/commands/documentCollaborativeUpdater.ts`, which persists `content` and `state` without synchronously updating `text`.

The decision also places serialization, deterministic link extraction, and target resolution inside the same primary-DB `REPEATABLE READ` snapshot before commit. That closes the former stale-text defect and gives the subsequent pure-core evaluation one immutable point-in-time input.

### Document keyset — verified

AD-16 now orders batches by `(collectionId, id)`. `id` is the Document primary key, and `server/models/base/Model.ts` consumes caller-supplied order column names literally when constructing cursor predicates. The revised names therefore fit the actual model and batching helper.

### OAuth/API attribution — verified

AD-14 and AD-15 now constrain the source credential type to `oauth | api`, keep internal command mutation attribution as MCP, and attach a client identity only for OAuth. This matches `server/routes/mcp/index.ts`, whose externally usable authentication paths resolve to OAuth or API credentials, and `server/middlewares/authentication.ts`, whose JWT/session branch resolves to APP and is rejected by the route type constraint.

The OAuth attribution seam is concrete: `server/models/oauth/OAuthAuthentication.ts` loads the token-bound `oauthClient`, and `server/models/oauth/OAuthClient.ts` exposes its public `clientId`. Extending the private authentication result and MCP `AuthInfo.extra` does not require trusting client-supplied claims or changing the public credential surface.

### Duplicate-aware configuration decoding — verified as new implementation work

AD-5 requires duplicate-key rejection before object materialization, and AD-18 requires duplicate-key conformance cases. This correctly avoids native `JSON.parse`, which cannot detect a duplicate after materialization. The baseline has no suitable duplicate-aware policy loader to reuse, but a bounded code-owned decoder at the single startup configuration boundary is an implementable seam and introduces no external service or runtime policy API.

Tests should exercise duplicates at the root, collection-map, policy, rule, and nested-parameter levels; this is test detail, not a missing architecture decision.

### HTML worker intent — verified as a compatible extension

`server/queues/tasks/DocumentImportTask.ts` is shared by API and MCP callers, reloads the user, performs conversion outside the document transaction, then creates the document transactionally. AD-7 preserves baseline API mode and adds a server-only MCP-enforced intent carrying server-generated correlation data, actor/credential context, and expected policy fingerprint. It requires the worker to reload the actor, re-authorize the destination, verify policy identity, and return a structured validation outcome. Client input cannot select the mode.

That is a viable extension of the current task props/response union. It avoids changing direct API behavior while giving the worker enough trusted context to reject before document materialization.

### Media staging/materialization — verified as new protocol over existing primitives

Today `server/commands/documentImporter.ts` calls `ProsemirrorHelper.replaceImagesWithAttachments`, which reaches `server/commands/attachmentCreator.ts`; that command stores the blob and creates an Attachment row during conversion, before document persistence. The spine does not misdescribe this as already atomic. AD-7 explicitly replaces the enforced MCP path with a new `stage -> project -> validate -> materialize` protocol.

The protocol fits the baseline: reserve attachment UUIDs and private storage keys while staging; build projected redirect references from those IDs; then create the Attachment rows and document in one database transaction. Without an Attachment row, the staged object is not exposed through Outline's attachment redirect path. Ownership by `invocationId`, idempotent deletion, and the AD-18 stage/materialize/cleanup tests provide the required rejection path. Storage access must remain private during staging even if a deployment's normal attachment ACL differs; that is an implementation invariant already required by the phrase “remains Outline-inaccessible.”

## Previously verified baseline facts

- `v1.10.1^{}` resolves to source commit `4a5a616a21be800257dc11cef4263d0dd0412156`; the post-`v1.10.1` container-block patch-edit fix remains excluded from the first increment.
- The documented Node/Yarn/PostgreSQL reference and locked TypeScript, MCP SDK, Sequelize, Zod, and markdown-it versions match repository manifests and lock data.
- The baseline provides real seams for one `/mcp` server, Sequelize transactions and row locks, primary-DB reads, uncached collection structure, membership-aware authorization, Event persistence/retention, and the shared import worker.

## Gate recommendation

The reality/currency gate is satisfied. Implementation still must prove the new duplicate-aware decoder, worker intent, private staging lifecycle, projection parity, transaction rollback, attribution, and snapshot behavior through the AD-18 tests; those are implementation evidence obligations, not unresolved architecture contradictions.
