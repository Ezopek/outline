---
title: 'Story 1.5: Materialize an Authorized Wiki Scope from One Coherent Snapshot'
type: 'feature'
created: '2026-10-02'
status: 'done'
baseline_revision: 'c95430ac8ff6ca0a941f2ce6092298b30599696c'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** No `lint_wiki` path exists. Nothing resolves a collection-scoped or default Wiki scope under `can(actor, "read", collection)`. No adapter reads the actor-readable documents, links, hierarchy, and structure of that scope as one coherent point-in-time snapshot. Later stories (1.6 rules, 1.7 bounds, 1.10 exposure) therefore have nothing safe to evaluate.

**Approach:**
- Add an internal, unregistered `lint_wiki` handler. Its input is exactly `{ collectionId: optionalString() }`, and its deadline is a server-owned 60 s.
- An application shell, `lintWiki`, runs in this order:
  1. the pre-admission collection lookup;
  2. the not-evaluated and sentinel short-circuits;
  3. one snapshot;
  4. evaluation of the document units through the shared document unit;
  5. assembly of the AD-12 result.
- An adapter, `readWikiSnapshot`, opens one primary `REPEATABLE READ` transaction made read-only by `SET TRANSACTION READ ONLY`, and commits it before any evaluation. Inside it, the adapter:
  - enumerates the configured collections the actor can read;
  - selects the published documents the actor can read, in keyset batches of 100;
  - loads only the inputs of the checks that are required;
  - resolves link targets, parents, and global-index facts through membership-aware queries, in batches of 500.
- Graph checks (`hierarchy`, `global_index`) have no rules until Story 1.6. Until then, each required graph check fails closed: one `VALIDATION_RUNTIME_FAILED` at collection scope, and the check never completes.

## Boundaries & Constraints

**Always:**
- **Pre-admission lookup** (collection scope only). `authorizeLintCollection({ id, actor, deadline })` runs `readOnlyTransaction({})`, then `boundBatch`, then `Collection.findByPk(id, { userId: actor.id, transaction })`, then `can(actor, "read", collection)`. That `findByPk` is the baseline lookup: it accepts a UUID or a slug-prefixed urlId and uses the default scope, which excludes `documentStructure`.
  - It returns the lowercase `collection.id`, or null.
  - Null becomes `denied`, which the tool returns as `error(AuthorizationError())`.
  - Any throw becomes `failed`, which the tool returns with the fixed message `The operation could not be completed`.
  - From then on, the resolved `collection.id` keys the policy lookup, identity, scope, and snapshot. The input string is never used again.
- **Shell order:**
  1. the lookup;
  2. the short-circuits, none of which opens a snapshot:
     - no policy → `not_evaluated`;
     - a sentinel → a sentinel-only `failed` result;
     - default scope with an empty policy set → `not_evaluated`, and no database statement at all;
  3. the snapshot, where Story 1.7's admission will precede it (admission is not built here);
  4. if the deadline has expired → `VALIDATION_TIMEOUT`;
  5. evaluation.
- **Snapshot transaction:** exactly one `readOnlyTransaction({ isolationLevel: REPEATABLE_READ })`.
  - Before every query call (batch), `boundBatch` sends one `SET LOCAL` pair. The `separate` membership SELECTs a call adds follow that call, as in Story 1.4.
  - Batches run sequentially. No `Promise.all`.
  - The first batch reads the scope's collections with `Collection.scope(["defaultScope", { method: ["withMembership", actor.id] }]).findAll({ where: { id: ids, teamId: actor.teamId } })`. That one batch is the default-scope enumeration, the sentinel readability check, and the source of `graphAuthorized = !!row && can(actor, "readDocument", row)`.
- **Default scope:** a configured collection is in scope iff `can(actor, "read", row)` holds at snapshot time.
  - A valid entry becomes an evaluated collection.
  - A sentinel is listed in `sentinelCollectionIds`.
  - An unreadable collection contributes nothing anywhere.
- **Collection scope:** the pre-admission `read` fixes identity for the whole invocation. A snapshot-time row that is missing, or no longer readable, keeps the collection in scope with `graphAuthorized: false`. Its documents are then only those the membership-aware queries return.
- **Evaluated documents** are read with `Document.scope(["withoutContent", { method: ["withMembership", actor.id] }]).findAll` under these conditions:
  - `teamId` matches the actor's team, and `collectionId` is in the evaluated set;
  - the baseline default-scope filter holds: `publishedAt` is not null, `template` is false, and `sourceMetadata.trial` is null;
  - `archivedAt` is null, and the query stays paranoid;
  - rows are ordered `(collectionId, id)`, with `limit: 100` and keyset continuation after the last fetched row.

  A row is kept iff `can(actor, "read", row)` holds.
- **Required inputs only** (`requiredChecks(rules)`):
  - **`documents`:**
    - Each document batch gets its own bounded read, `Document.unscoped().findAll({ attributes: ["id", "content", "state"], where: { id: keptIds } })`.
    - Then, per document: `toCanonicalMarkdown`, then `parseCanonicalMarkdown`, then `extractInternalLinks` when `internal_links` is enabled.
    - After all document batches, every reference resolves through `linkLookupBatches` and the existing `resolveLinkTargets`.
  - **`hierarchy` or `global_index`, only for a `graphAuthorized` collection:**
    - one bounded `Collection.unscoped().findAll({ attributes: ["id", "documentStructure"], where: { id: authorizedIds } })`;
    - parent edges.
  - **`global_index`, only for a `graphAuthorized` collection:**
    - the surface's content, canonical syntax, and recognized links;
    - the readable configured global indexes.
- **ID resolution:** parent, surface, and global-index IDs resolve through `findReadableDocuments`, never against the evaluated set. `findReadableDocuments` is the query and filter that `resolveLinkTargets` already uses, moved out of it unchanged. IDs go in sorted unique batches of 500, each preceded by `boundBatch`.
- **Per-document failures:** any throw from serializing or parsing one document marks only that document `content: "unavailable"` (or `surface: null`). Database errors abort the snapshot.
- **Adapter result:** the adapter returns `{ ok: true, snapshot }`, or `{ ok: false, error, sentinelCollectionIds }` carrying the sentinels it had established before the failure. It never builds Findings, counts, completed checks, or results.
- **Snapshot failure:**
  - **Code:** `VALIDATION_TIMEOUT` for a `DeadlineFloorError`, an `isDatabaseTimeout` error, or an expired deadline, unless the error is a `CanonicalMarkdownError`; `VALIDATION_RUNTIME_FAILED` otherwise.
  - **Location:** the request's `scope { scopeKind }`, plus `collectionId` when collection-scoped.
  - **Content:** no Findings and zero counts.
  - **What survives:** a collection-scoped failure keeps that collection's valid identity. A default-scope failure keeps only the sentinels established before it, each with its failure, identity, and zero entry.

**Never:**
- **Out of scope:**
  - admission, resource limits, the stop margin, per-unit deadline checks, and the socket-timeout override (Story 1.7);
  - hierarchy and global-index rules (Story 1.6);
  - audit (Story 1.8);
  - registering `lint_wiki` on `/mcp` (Story 1.10).
- **Forbidden edits:**
  - no edits to `server/editor/**`, `shared/editor/**`, `server/routes/mcp/**`, or `sprint-status.yaml`;
  - no change in `lint_document` behavior.
- **Forbidden reads and effects:**
  - no `Document.text` and no `getCachedDocumentStructure`;
  - no Sequelize `readOnly` option, which selects the replica;
  - no network, storage, or audit work inside the transaction;
  - no `documentStructure` column in any statement, the enumeration included, except the authorized structure read.
- **Disclosure:** output never names or counts an inaccessible collection, document, or target. The snapshot holds no unreadable identity, except configured IDs taken from the policy itself.
- **Identifiers:** no pilot identifiers in code, tool descriptions, or fixtures.

## I/O & Edge-Case Matrix

`C` is the resolved collection. `cs(C)` is `scope { scopeKind: "collection", collectionId: C }`. "Zero entry" means zero counts and `completedChecks: []`.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Collection scope, valid, all units complete | readable `C` with document rules only | `complete`. Scope `{ kind: "collection", collectionId: C, counts, completedChecks: ["documents"] }` and `policies` `[valid]` | — |
| Denied or missing | a missing UUID, a private unreadable collection, another team's collection, or a deleted one | the same `isError` authorization result for every case; no snapshot | — |
| Lookup failure | remainder below the floor, expiry, or a query error in the lookup | `isError`, with the fixed message | — |
| Unconfigured | readable `C` without an entry | `not_evaluated`, zero collection scope, `policies: []`; no snapshot | — |
| Collection sentinel | readable `C` whose entry is invalid | `failed`: one `POLICY_CONFIGURATION_INVALID` at `cs(C)`, the invalid identity, a zero entry; no snapshot | — |
| Default, empty policy set | no entries | `not_evaluated`, `collections: []`; no database statement | — |
| Default, nothing readable | entries exist, none readable | `not_evaluated` after the enumeration batch | — |
| Default, mixed | readable valid `A`, readable sentinel `B`, unreadable `D` and `E` | entries and policies for `A` and `B` only. `incomplete` if any unit of `A` completed, otherwise `failed` | — |
| Snapshot failure | a floor refusal, expiry, or PG 57014/55P03 error; or any other error | `failed`, with `VALIDATION_TIMEOUT` or `VALIDATION_RUNTIME_FAILED` respectively, at the request scope; no Findings | sentinels established before it are kept |
| Enumeration failure | default scope; the first snapshot batch is refused or fails | `failed`, exactly one run-wide System Failure at `scope { scopeKind: "configured_collections" }`, `collections: []`, `policies: []`; no sentinel | — |
| `read` without `readDocument` | an admin, without membership, on a private `C` | included. Only documents readable through document membership are evaluated. Each required graph check gives `VALIDATION_RUNTIME_FAILED` at `cs(C)`. No `documentStructure` statement | — |
| No longer readable at snapshot time | `C` becomes unreadable after the lookup | identity kept; graph checks fail as above; documents readable through membership are still evaluated | — |
| Unavailable document | serializing or parsing one document throws | that unit gets `VALIDATION_RUNTIME_FAILED` at `scope { document, documentId, collectionId: C }` and is not counted. Later units run. `documents` is not listed | — |
| Rule-kind failure | `failedKinds` is non-empty | the unit's Findings are kept, plus one `VALIDATION_RUNTIME_FAILED` at that same document location; the unit is not counted | — |
| Vacuous documents check | no readable published document | one completed unit: counts 0, `completedChecks: ["documents"]` | — |
| Graph check, authorized | a hierarchy or global-index rule on a `graphAuthorized` `C` | `VALIDATION_RUNTIME_FAILED` at `cs(C)` per required check, not completed (fail-closed until Story 1.6) | — |

</intent-contract>

## Code Map

- `server/wikiLint/adapters/documentReader.ts`:
  - `:59` `isDatabaseTimeout`;
  - `:78` `readOnlyTransaction` and `:96` `boundBatch` (module-private; export both);
  - `:148` `authorizeLintTarget`, the pattern for the pre-admission lookup;
  - `:199` `resolveLinkTargets` (extract its query and filter into `findReadableDocuments`);
  - `:260` `readDocumentSnapshot`, the pattern for the snapshot.
- `server/wikiLint/adapters/canonicalSyntax.ts`:
  - `toCanonicalMarkdown`, which needs `content` or `state`;
  - `parseCanonicalMarkdown` and `CanonicalMarkdownError`.
- `server/wikiLint/core/internalLinks.ts` -- `:81` `extractInternalLinks(links, origin)` and `:109` `linkLookupBatches(references)`, which sorts, deduplicates, and chunks at 500. `LINK_LOOKUP_BATCH_SIZE`.
- `server/wikiLint/core/documentRules.ts`:
  - `documentSurfaceRules(rules)` gives exactly the `documents`-check kinds;
  - `evaluateDocumentRules({ documentId, syntax, rules, links })` returns `{ findings (with ordinals), failedKinds }`, and its findings carry no `sortCollectionId`.
- `server/wikiLint/core/registry.ts`:
  - `RULE_REGISTRY[kind].code`, and `getIssueDefinition(code).check`, which is `documents`, `hierarchy`, or `global_index`;
  - the `global_index_links` params `surfaceDocumentId` and `globalIndexDocumentIds`;
  - UUIDs in configuration are lowercase (`UUID_PATTERN`).
- `server/wikiLint/core/result.ts:321` -- `buildReadOnlyResult`:
  - It re-validates every issue's surfaces; `collection` and `configured_collections` scopes allow `document`, `wiki`, `all`, and `lint_wiki`.
  - Through `deriveResultState`, it throws when a unit is incomplete but no System Failure exists.
  - It sorts configured entries and policies.
- `server/wikiLint/core/contracts.ts` -- `EvaluatedScope`, `ConfiguredCollectionEntry`, `ResolvedLinks`, and `CheckName`. Add the WikiSnapshot types here.
- `server/wikiLint/application/lintDocument.ts`:
  - `:125` `policyIdentity`, which moves to `core/policySet.ts`;
  - `:266` the construction-failure classification to mirror;
  - `LintDocumentReader` and its dependency pattern.
- `server/wikiLint/application/deadline.ts` -- `Deadline`, `DeadlineFloorError`, and `SET_LOCAL_FLOOR_MS = 100`.
- `server/tools/wikiLint.ts` -- `lintDocumentTool`, the handler pattern, and `OPERATION_FAILED`. `server/tools/util.ts:63` -- `optionalString()`, which maps `""` to `undefined`; also `success`, `error`, and `getActorFromContext`.
- Baseline facts:
  - `Collection.findByPk` (`server/models/Collection.ts:662`):
    - uses `isUUID` → `where id`, which matches case-insensitively in PG; otherwise `SLUG_URL_REGEX` → `urlId`;
    - applies scopes `defaultScope` (excludes `documentStructure`) and `withMembership(userId)`.
  - `getCachedDocumentStructure` (`:778`) is Redis-cached and forbidden here.
  - Policies:
    - Collection `read` (`server/policies/collection.ts:34`) gives an admin every same-team collection.
    - `readDocument` (`:69`) requires membership on a private collection, even for an admin.
    - Document `read` (`server/policies/document.ts:21`) holds through a document membership, the creator's own draft, or collection `readDocument`. It needs the memberships, the collection with its memberships, `teamId`, `publishedAt`, and `createdById`, which the `withMembership` scope plus `withoutContent` supply.
  - Document scopes (`server/models/Document.ts:127-265`):
    - the default scope's filter is `publishedAt ≠ null`, `sourceMetadata.trial IS NULL`, and `template: false`; `.scope([...])` without `"defaultScope"` drops it;
    - `withoutContent` excludes `state`, `content`, and `text`;
    - `withMembership` includes the collection with its memberships, plus the user's memberships and its `separate` group memberships, which add statements.
  - Baseline `documents.list` (`server/routes/api/documents/documents.ts:431`) re-applies the template and trial filters too.
  - No Sequelize CLS: a query without `transaction` runs on another pooled connection, so a test can commit concurrently that way.
- Tests:
  - `server/wikiLint/adapters/documentReader.test.ts:61-90` -- `statementOf`, `recordStatements`, `optionsOf`, `fixedDeadline`, and `buildFixture`;
  - the expected sequence starts `START TRANSACTION;`, `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;`, `SET TRANSACTION READ ONLY`.
  - `server/tools/wikiLint.test.ts:60-226` -- `policySetFor`, `connect` (in-test `McpServer`), `lint`, `firstText`, and `buildDocumentOnlyReader`; `:1357` is the tools/list test.
  - `server/test/factories.ts` -- `buildCollection({ permission: null })` makes a private collection; `buildAdmin`, `buildDraftDocument`, and `buildDocument({ archivedAt, parentDocumentId, content })`.
  - `buildDocument` with an explicit `collectionId` does not add the document to `documentStructure`; call `collection.addDocumentToStructure`.
- DB tests: following memory `local-test-postgres`, resume the migrated scratch PG14 at `/tmp/claude-1000/-home-ezop-repos-outline/0d3dbaeb-fcf6-4dcb-aeb6-94a87bfe12a9/scratchpad/{pg14,pgd}` on `127.0.0.1:5432`.

## Tasks & Acceptance

**Execution:**
- `server/wikiLint/core/contracts.ts` -- add the snapshot types in Design Notes (`WikiParentEdge`, `WikiSnapshotDocument`, `WikiGlobalIndexInput`, `WikiCollectionGraph`, `WikiSnapshotCollection`, and `WikiSnapshot`), with readonly arrays. These types are the core's future input (AD-2).
- `server/wikiLint/core/registry.ts` -- `requiredChecks(rules): CheckName[]`: the checks of the enabled kinds, unique, in the order `documents`, `hierarchy`, `global_index`.
- `server/wikiLint/core/policySet.ts` -- move `policyIdentity(entry)` here from `lintDocument.ts`, exported unchanged, and import it in `lintDocument.ts`.
- `server/wikiLint/adapters/documentReader.ts`:
  - export `readOnlyTransaction` and `boundBatch`;
  - add `findReadableDocuments({ where, actor, transaction })`, the scope, `teamId`, and `can` filter now inline in `resolveLinkTargets`, which then calls it with no behavior change.
- `server/wikiLint/adapters/wikiReader.ts` (new):
  - `authorizeLintCollection`;
  - `WIKI_DOCUMENT_BATCH_SIZE = 100`;
  - `structureDocumentIds(structure)`: a defensive flatten of `NavigationNode[] | null` to sorted unique string IDs;
  - `WikiSnapshotRead`;
  - `readWikiSnapshot({ scope, entries, actor, deadline, instanceOrigin })`, where `scope` is `{ kind: "collection", collectionId } | { kind: "configured_collections" }`. Entries are `[validEntry]` for a collection scope, and all entries for the default scope.
- `server/wikiLint/application/lintWiki.ts` (new) -- `LINT_WIKI_DEADLINE_MS = 60000`, `LintWikiReader`, `defaultLintWikiReader`, `LintWikiDependencies` (the `lint_document` set plus the reader type), `LintWikiOutcome`, and `lintWiki({ collectionId?, actor, policySet, deadline, reader, instanceOrigin })`, following Boundaries and Design Notes.
- `server/tools/wikiLint.ts`:
  - `lintWikiInputSchema = { collectionId: optionalString().describe(…) }`, described generically: the collection's UUID or URL identifier (optionally slug-prefixed), or omit it for every readable configured collection;
  - `lintWikiTool(input, context, dependencies)`, mirroring `lintDocumentTool` with `LINT_WIKI_DEADLINE_MS`. It stays unregistered.
- Collocated tests:
  - `core/registry.test.ts` -- `requiredChecks`.
  - `adapters/wikiReader.test.ts` (new, DB):
    - the lookup;
    - enumeration and readability;
    - the document filter;
    - the statement sequence;
    - keyset and target batching;
    - required-input gating;
    - `graphAuthorized`;
    - parents, surface, and indexes;
    - the unavailable document;
    - failures carrying sentinels;
    - concurrent commits;
    - determinism.
  - `application/lintWiki.test.ts` (new) -- every matrix row through a fake reader, plus accounting, ordering, `sortCollectionId`, and the expired-after-snapshot case.
  - `server/tools/wikiLint.test.ts`:
    - `connect` also registers `lint_wiki`;
    - a `describe("lint_wiki")` block for the tool-level acceptance criteria;
    - tools/list asserts `lint_wiki` is absent.

**Acceptance Criteria:**
- **AC1, schema:**
  - Given the in-test server, when it lists tools, then the `lint_wiki` input schema has exactly one property, an optional string `collectionId`.
  - Given `collectionId: ""`, an omitted `collectionId`, or an extra argument, when `lint_wiki` runs, then the result is byte-equal to the default-scope call.
  - Given production `/mcp` `tools/list`, when it runs, then `lint_wiki` is absent.
- **AC2, lookup:**
  - Given `C` passed as an uppercase UUID, as its `urlId`, or as `slug-urlId`, when `lint_wiki` runs, then the scope, policies, and locations carry the lowercase `C`.
  - Given a missing UUID and a private unreadable collection, when `lint_wiki` runs, then both `isError` results are byte-identical.
  - Given `clock` with a remainder below the floor, when `lint_wiki` runs, then the result is `isError` with the fixed message, and no statement follows the lookup.
- **AC2 and AC3, readability:**
  - Given an admin without membership on a private collection with a hierarchy rule, when the default scope runs, then the collection's entry is present; `systemFailures` holds `VALIDATION_RUNTIME_FAILED` at `cs(C)`; and no statement contains `documentStructure`.
  - Given the same fixture with only document rules, when the default scope runs, then the result is `complete` and `clean` with zero counts.
  - Given a document membership added for the admin, when the default scope runs, then that document is evaluated (`evaluatedDocumentCount: 1`).
  - Given `C` made unreadable between the lookup and the snapshot, by wrapping the reader, when `lint_wiki` runs with a hierarchy rule, then the scope still carries `C`, and the graph check fails at `cs(C)`.
- **AC3, non-disclosure:** Given unreadable valid and sentinel collections next to readable ones, when the default scope runs, then no serialized result contains their IDs, and the entries, policies, and counts match a run without them.
- **AC4, document set:**
  - Given a collection with a published document, a draft, an archived document, a deleted document, a document of another collection, and one readable only through document membership, when the adapter reads it, then the snapshot holds exactly the published, readable ones.
  - Given a published document linking to the draft and to the archived document, with `internal_links` enabled, when `lint_wiki` runs, then it gets no link Finding.
- **AC6, gating:**
  - Given a policy with document rules only, when the snapshot runs, then no statement reads `documentStructure` and no parent lookup runs.
  - Given hierarchy rules only, when it runs, then no document content read runs (no statement selects a document's `content` or `state` column), and `documentStructure` is read once for the authorized collection.
  - Given any snapshot, when it runs, then no statement selects a document's `text` column, and no `INSERT`, `UPDATE`, or `DELETE` appears.
- **AC6, parent edges:** Given a `graphAuthorized` collection whose evaluated documents have a root, an evaluated parent, a readable parent in another collection, a deleted parent, and a parent in an unreadable collection, when the snapshot runs, then the edges are, respectively:
  - `none`;
  - `resolved`, with `sameCollection: true`;
  - `resolved`, with `sameCollection: false`;
  - `unresolved`;
  - `unresolved`.
- **AC6, global-index inputs:** Given a readable surface and one readable and one unreadable configured index, when the snapshot runs, then `globalIndex` holds:
  - the surface with its recognized links;
  - only the readable index with its `urlId`.
- **AC7 and AC8, statements:**
  - Given 101 readable published documents, when the snapshot runs, then:
    - the statements begin `START TRANSACTION;`, `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;`, `SET TRANSACTION READ ONLY`, all in one transaction;
    - each collections, documents, content, structure, and target SELECT is preceded by its `SET LOCAL` pair;
    - two documents SELECTs have `LIMIT 100`, the second continuing after the first batch's last `(collectionId, id)`;
    - `COMMIT` precedes the return.
  - Given 501 unique link keys across documents, when the snapshot runs, then two target SELECTs hold 500 and 1 keys.
- **AC10, inside the snapshot:** Given a content update and a new published document committed on another connection after the snapshot's first SELECT and before its first documents SELECT, when the snapshot completes, then it holds the old content and not the new document.
- **AC10, after the snapshot:** Given the same changes committed after `readWikiSnapshot` resolves but before evaluation, when `lint_wiki` completes, then its result equals the pre-change result, and the next call reflects the change.
- **AC13, determinism:** Given identical state, when `lint_wiki` and `readWikiSnapshot` each run twice, then the serialized results and snapshots are byte-equal, with `targets` serialized as sorted entries.

## Spec Change Log

## Review Triage Log

### 2026-10-02 — Review pass
- verdicts: 31 findings — high 0, medium 4, low 12, false 15, maybe-false 0
- findings:
  - `[medium]` `[patch]` **Blind Hunter:** keyset paging across collections is never tested. — Grouped with Verification Gap (keyset continuation). Patched: a two-collection test whose first page fills inside the lower-sorted collection, plus a partly unreadable full page whose last row is unreadable. Mutating the next-collection branch, the cursor, or the loop count now fails them.
  - `[low]` `[patch]` **Blind Hunter:** the parent, surface, and index lookups have no batching or bounding test. — Grouped with Verification Gap (lookup bound). Patched: the hierarchy-only test pins the exact statement sequence. A new case configures 501 global-index IDs and gets two lookup SELECTs of 500 and 1 sorted IDs, each after its `SET LOCAL` pair.
  - `[low]` `[patch]` **Blind Hunter:** the no-longer-readable path never asserts that no structure is read. — Patched: that adapter test now records statements and asserts none contains `documentStructure`.
  - `[low]` `[patch]` **Blind Hunter:** no test covers group-membership access, or a real trial-import row. — Patched: a private collection readable only through a group collection membership is enumerated and its document evaluated. A published trial-import document is excluded. Both passed with no adapter change.
  - `[false]` `[reject]` **Blind Hunter:** `requiredChecks` fails open when the registry has a gap. — Both registries are closed and code-owned. The new registry test maps every `RULE_REGISTRY` kind to its code's defined check, so no reachable kind yields an empty check list.
  - `[false]` `[reject]` **Blind Hunter:** a missing structure row is silently an empty structure. — The structure read runs in the same `REPEATABLE READ` transaction that already returned that collection's row in the first batch, so the row cannot be missing.
  - `[false]` `[reject]` **Blind Hunter:** `lint_wiki` has no explicit check for a missing actor. — The tool is unregistered. `/mcp` authenticates every request (`server/routes/mcp/index.ts:137`) before any handler runs, and `lint_document` uses the identical `getActorFromContext` pattern.
  - `[low]` `[reject]` **Blind Hunter:** the graph-check failures are identical duplicates. — AD-12, Story 1.6 AC12, and the spec require one generic `VALIDATION_RUNTIME_FAILED` per check, generic by design for non-disclosure. Changing the shape means editing the architecture and the spec.
  - `[low]` `[reject]` **Blind Hunter:** the shell ignores the graph inputs that the adapter still reads. — AC6 mandates loading those inputs when a graph check is required, and Story 1.6 consumes them. Until then, graph checks fail closed, as specified.
  - `[low]` `[reject]` **Blind Hunter:** grouping documents per collection costs O(collections × documents). — Negligible within the 5,000-document cap, and nobody would notice it. The fix restructures the assembly loop.
  - `[low]` `[reject]` **Blind Hunter:** the `state` column is loaded for every document. — The spec prescribes `["id", "content", "state"]`, mirroring `readDocumentSnapshot`. The cost is transient per batch of 100, and `content` is normally present. Changing it means editing the spec.
  - `[low]` `[patch]` **Blind Hunter:** the read-only guard misses an unqualified `"text"` selection. — Patched: `expectReadOnly` flags any quoted `"text"` identifier. No other table the snapshot reads has a `text` column.
  - `[false]` `[reject]` **Blind Hunter:** a partly visible collection is reported `complete` and `clean`. — AD-9 and AC3 specify this exact outcome: an actor with `read` but without `readDocument` may get `clean` over the documents it can read when only document rules are enabled.
  - `[false]` `[reject]` **Blind Hunter:** `canonicalContent` also catches link-extraction errors. — `extractInternalLinks` throws only for an unparsable origin. `env.URL` is validated by `@IsUrl` with a required protocol (`server/env.ts:231`), so the path is unreachable, and the outcome would stay fail-closed.
  - `[false]` `[reject]` **Edge Case Hunter:** a requested collection deleted after the lookup can be reported `complete` with zero documents. — AC2 and AD-16 specify that a requested collection no longer readable at snapshot time contributes only the documents its membership-aware queries return. Its graph checks fail.
  - `[false]` `[reject]` **Edge Case Hunter:** an archived collection is reported `complete` with zero documents. — AC4 and AD-9 put archived documents outside every `lint_wiki` unit, and AD-11 completes a required check vacuously. The zero counts show this.
  - `[false]` `[reject]` **Edge Case Hunter:** draft, archived, or template parents and indexes resolve. — AC4 requires parents and targets to resolve through the membership-aware queries rather than against the evaluated scope. AD-9 collapses only missing, deleted, and inaccessible ones, as Story 1.4 does for link targets.
  - `[false]` `[reject]` **Edge Case Hunter (claim):** extra parent lookups for a `global_index`-only policy, and document reads for graph-only unauthorized collections. — AC6 loads hierarchy and structure when either graph check is required, and loads the evaluated scope always. That matches the spec.
  - `[medium]` `[patch]` **Verification Gap:** an unreadable global-index surface is never tested. — Patched: a surface in a private, unreadable collection gives `surface: null`. No content SELECT carries its ID, and the serialized snapshot holds neither its ID nor its link keys. Dropping the readability filter now fails the test.
  - `[medium]` `[patch]` **Verification Gap:** keyset continuation is tested only on one fully readable collection. — Grouped with Blind Hunter (cross-collection keyset); patched by the same two tests.
  - `[medium]` `[patch]` **Verification Gap:** a default scope whose only readable collection is a sentinel is never tested. — Patched: the adapter returns `{ collections: [], sentinelCollectionIds: [sentinel], targets: Map{} }`. The shell returns `failed` with `POLICY_CONFIGURATION_INVALID`, the sentinel's zero entry, and its invalid identity.
  - `[low]` `[patch]` **Verification Gap:** nothing tests that `lintWikiTool` maps a thrown error to the fixed message. — Patched: a throwing clock gives `isError` with the fixed message.
  - `[low]` `[patch]` **Verification Gap:** the bound before the parent and global-index lookups is never asserted. — Grouped with Blind Hunter (lookup batching); patched by the same sequence assertions.
  - `[false]` `[reject]` **Intent Alignment (AC12):** there is no admission under contention. — The project convention assigns 1.5 AC12 to 1.7 AC7, and admission is Story 1.7's. The short-circuits without admission are implemented.
  - `[false]` `[reject]` **Intent Alignment (AC6 and AC1):** there is no structure-node limit, and no server-owned limits or concurrency. — The limits and admission are Story 1.7 (AC6, AC7). What this story's clause constrains is that no unauthorized structure is read, and that holds.
  - `[false]` `[reject]` **Intent Alignment (AC6):** the surface's link targets are not resolved. — The only targets the global-index proof uses are the configured indexes, and they resolve through `findReadableDocuments` with their `urlId`. Resolving the surface's other link keys feeds no rule.
  - `[false]` `[reject]` **Intent Alignment (AC8):** canonical syntax trees outlive their document. — AC7 requires commit before evaluation, so the evaluation input must be retained. The parser tokens and ProseMirror nodes stay per-document and transient.
  - `[false]` `[reject]` **Intent Alignment (AC7):** serialization and extraction run inside the transaction. — AC6 lists serialization and extracted links as snapshot inputs. Rule evaluation runs only after `COMMIT`, which the statement tests pin.
  - `[low]` `[reject]` **Intent Alignment:** the per-unit wrapper is re-implemented in `lintWiki` rather than shared with `lintDocument`. — The two surfaces locate and isolate failures differently (one result versus per-unit isolation), and both call the shared `evaluateDocumentRules`. No divergence is named; unifying them is a refactor.
  - `[false]` `[reject]` **Intent Alignment:** the `lint_document` code path changed. — The refactors (`toolResult`, the move of `policyIdentity`, and `findReadableDocuments` with `Op.and` over the same condition) preserve behavior. All Story 1.3 and 1.4 tests pass unchanged.
  - `[low]` `[patch]` **Intent Alignment (AC11):** no test drives a real snapshot failure through to a tool result. — Patched: a clock that passes the lookup but refuses the first snapshot batch gives `failed`, one `VALIDATION_TIMEOUT` at `cs(C)`, zero counts, and the valid identity.

## Design Notes

**Snapshot types** (core):

```ts
type WikiParentEdge =
  | { state: "none" }
  | { state: "unresolved" } // missing, deleted, or inaccessible
  | { state: "resolved"; documentId: string; sameCollection: boolean };
interface WikiSnapshotDocument {
  documentId: string;
  // null: `documents` not required; links null: `internal_links` not enabled
  content: { syntax: CanonicalSyntax; links: InternalLinkReference[] | null } | "unavailable" | null;
  parent: WikiParentEdge | null; // null unless the graph is authorized
}
interface WikiGlobalIndexInput {
  surface: { documentId: string; links: InternalLinkReference[] } | null; // null: unreadable or unavailable
  indexes: { documentId: string; urlId: string }[]; // readable configured indexes, sorted
}
type WikiCollectionGraph =
  | { authorized: false }
  | { authorized: true; structureDocumentIds: string[]; globalIndex: WikiGlobalIndexInput | null };
interface WikiSnapshotCollection { collectionId: string; documents: WikiSnapshotDocument[]; graph: WikiCollectionGraph | null }
interface WikiSnapshot { collections: WikiSnapshotCollection[]; sentinelCollectionIds: string[]; targets: ReadonlyMap<string, LinkTargetState> }
```

**Field rules:**
- Collections and documents are sorted with `compareUtf8`.
- `graph` is null when neither graph check is required.
- The `sameCollection` flag never exposes the parent's collection.
- Story 1.6 may extend these types; it must not loosen their disclosure rules.

**Accounting** (shell). For each evaluated collection, in sorted order, with `checks = requiredChecks(rules)`:
- **`documents` required:** one unit per document, in sorted order, or one vacuous completed unit when there are none.
  - A completed unit adds 1 to `evaluatedDocumentCount`.
  - It also adds its `links.length` to `evaluatedLinkCount`, but only when `internal_links` is enabled.
  - Findings get `sortCollectionId: C`.
  - `documents` enters `completedChecks` only when every unit of the collection completed.
- **Graph checks:** each required graph check is one unit that does not complete, with one `VALIDATION_RUNTIME_FAILED` at `cs(C)`. This holds whether `graph.authorized` is true or false. Story 1.6 replaces the `authorized: true` branch with its rules and keeps the `false` branch.
- **Sentinels:** each contributes one `POLICY_CONFIGURATION_INVALID` at its collection scope, its invalid identity, a zero entry, and no unit.
- **Result:** `requiredUnits` and `completedUnits` are summed and passed to `buildReadOnlyResult`, which derives `complete`, `incomplete`, or `failed`.

Every incomplete unit adds at least one System Failure, so `deriveResultState` never throws.

**Cross-story hooks:**
- Story 1.7 inserts admission between the short-circuits and `readWikiSnapshot`.
- Story 1.7 also adds limits inside the adapter, and deadline checks before each unit in the shell's loop.
- Neither gets a placeholder here.

## Verification

**Commands:**
- `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint server/tools/wikiLint.test.ts` -- expected: all pass on the migrated test Postgres.
- `TZ=UTC node_modules/.bin/vitest run --project server server/tools server/routes/mcp` -- expected: the baseline MCP tests are unaffected.
- `corepack yarn tsc` -- expected: exit 0.
- `node_modules/.bin/oxlint --type-aware server/wikiLint server/tools/wikiLint.ts server/tools/wikiLint.test.ts` -- expected: 0 errors.
- `node_modules/.bin/oxfmt --check server/wikiLint server/tools/wikiLint.ts server/tools/wikiLint.test.ts` -- expected: clean.
- `grep -rniE "laura|ezop" server/wikiLint server/tools/wikiLint*.ts` -- expected: no matches.
- `grep -n "Promise.all\|getCachedDocumentStructure" server/wikiLint/adapters/wikiReader.ts` -- expected: no matches.

## Auto Run Result

Status: done

**Summary.** Story 1.5 adds an internal `lint_wiki` path, still unregistered on `/mcp`. It lints a Wiki scope from one authorized, coherent point-in-time snapshot.
- **The tool:** the handler's input is exactly `{ collectionId: optionalString() }`, and its server-owned deadline is 60 s.
- **The shell:** `lintWiki` runs these steps in order.
  1. The pre-admission lookup, in a short bounded read-only transaction: the baseline `Collection.findByPk`, then `can(actor, "read", …)`. Denied and missing collections give the same authorization error; a lookup failure gives the fixed message.
  2. The not-evaluated and sentinel short-circuits, none of which opens a snapshot.
  3. One snapshot.
  4. A `VALIDATION_TIMEOUT` if the deadline expired.
  5. Evaluation of the document units through the shared `evaluateDocumentRules`, in AD-4 order, and AD-12 assembly.
- **Graph checks:** each required `hierarchy` or `global_index` check fails closed with `VALIDATION_RUNTIME_FAILED` at collection scope until Story 1.6 adds the rules.
- **The adapter:** `readWikiSnapshot` uses one primary `REPEATABLE READ` transaction made read-only by `SET TRANSACTION READ ONLY`. Each query call is preceded by a `SET LOCAL` pair. It reads:
  - the scope's collections, which serves as default-scope enumeration, the sentinel readability check, and the `readDocument`-based `graphAuthorized` decision;
  - the published, non-archived, non-template, non-trial documents the actor can read, in `(collectionId, id)` keyset batches of 100;
  - content, canonical syntax, and links, only when the `documents` check is required;
  - link targets, in batches of 500;
  - uncached `documentStructure`, parent edges, and global-index inputs, only for a collection where the actor holds `readDocument` and a graph check is required.

  An unserializable document becomes `unavailable`, an isolated unit failure. A failed snapshot keeps the sentinels it had already established. It commits before any evaluation.

**Files changed:**
- `server/wikiLint/core/contracts.ts` — the `WikiSnapshot` types: parent edges, documents, global-index inputs, collection graphs, and collections.
- `server/wikiLint/core/registry.ts` — `requiredChecks(rules)`.
- `server/wikiLint/core/policySet.ts` — `policyIdentity`, moved here from `lintDocument.ts`.
- `server/wikiLint/adapters/documentReader.ts` — exports `readOnlyTransaction` and `boundBatch`; extracts `findReadableDocuments` from `resolveLinkTargets`.
- `server/wikiLint/adapters/wikiReader.ts` (new) — `authorizeLintCollection`, `readWikiSnapshot`, `structureDocumentIds`, and `WIKI_DOCUMENT_BATCH_SIZE`.
- `server/wikiLint/application/lintWiki.ts` (new) — `lintWiki`, its reader seam, `LINT_WIKI_DEADLINE_MS`, and result assembly.
- `server/wikiLint/application/lintDocument.ts` — imports the moved `policyIdentity`.
- `server/tools/wikiLint.ts` — `lintWikiInputSchema`, `lintWikiTool`, and a `toolResult` helper shared with `lint_document`.
- Tests:
  - `core/registry.test.ts`;
  - `adapters/wikiReader.test.ts` (new, database, 30 tests);
  - `application/lintWiki.test.ts` (new, 30 tests);
  - `server/tools/wikiLint.test.ts` (a `lint_wiki` block, and `lint_wiki` asserted absent from `/mcp` tools/list).

**Review findings breakdown** (31 findings: high 0, medium 4, low 12, false 15, maybe-false 0):
- **Patches applied:** 7 entries (medium 3, low 4), all test-only; production code is unchanged.
  - medium:
    - keyset continuation across collections and over partly unreadable pages;
    - an unreadable global-index surface;
    - a sentinel-only default scope.
  - low:
    - the bounds and 500-ID batching of the parent and global-index lookups;
    - no structure read on the no-longer-readable path;
    - group-membership access and trial-import exclusion;
    - a stricter `"text"` read-only guard;
    - `lintWikiTool` mapping a throw to the fixed message;
    - a real snapshot failure carried through to the tool result.
- **Deferred:** none.
- **Rejected** (reasons in the Review Triage Log):
  - low:
    - identical per-check graph failures, which AD-12 and Story 1.6 AC12 require;
    - graph inputs loaded but not yet consumed, which AC6 requires;
    - O(collections × documents) grouping;
    - the `state` column loaded as the spec prescribes;
    - the per-unit wrapper not shared with `lint_document`.
  - false:
    - `requiredChecks` failing open;
    - a missing structure row;
    - a missing actor;
    - a partly visible collection reported clean (AD-9);
    - link-extraction errors caught;
    - a collection deleted after the lookup (AD-16);
    - an archived collection (AC4);
    - draft parents resolving (AC4);
    - extra lookups for one graph check (AC6);
    - admission (Story 1.7);
    - limits (Story 1.7);
    - surface target resolution;
    - transient ASTs;
    - serialization inside the transaction;
    - `lint_document` refactors.

**Follow-up review recommendation: false.** This first pass patched three `medium` entries and no `high` entry (patched: high 0, medium 3, low 4). Every patch was test-only. Mutating the adapter showed that each new test catches its gap:
- the cross-collection branch;
- the cursor and loop count taken from filtered rows;
- the missing lookup bound;
- the dropped surface-readability filter.

No unverified risk can be named for another review pass, so the recommendation is false.

**Verification performed** (final tree; test database PostgreSQL 14 at `127.0.0.1:5432/outline-test`, migrated):

| Command | Result |
| --- | --- |
| `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint server/tools/wikiLint.test.ts` | 16 files, 732/732 passed |
| `TZ=UTC node_modules/.bin/vitest run --project server server/tools server/routes/mcp` | 9 files, 158/158 passed |
| `corepack yarn tsc` | exit 0 |
| `node_modules/.bin/oxlint --type-aware` on the changed paths | exit 0 |
| `node_modules/.bin/oxfmt --check` on the changed paths | clean |
| `grep -rniE "laura\|ezop" server/wikiLint server/tools/wikiLint*.ts` | no matches |
| `grep -n "Promise.all\|getCachedDocumentStructure" server/wikiLint/adapters/wikiReader.ts` | no matches |

Matrix test audit: every one of the 16 I/O matrix rows has a covering test that ran and passed, and none is skipped.

**Residual risks:**
- **Unconsumed graph inputs.** Parent edges, structure IDs, and global-index inputs are loaded and tested at the adapter level, but no consumer uses them yet. Story 1.6 may need to extend their shape. Until it lands, every required graph check fails closed.
- **Graph-only collections:**
  - a `global_index`-only policy still loads parent edges, as the AC6 wording requires;
  - a collection without `readDocument` still selects its readable document IDs.
- **Content reads:**
  - `state` is read with `content` for every evaluated document;
  - a surface that is also an evaluated document is serialized twice.
- **Statement bounds:** as in Stories 1.3 and 1.4, the `separate` group-membership SELECTs that a query call adds run under that call's `SET LOCAL` bound, not their own.
- **Deferred to Story 1.7:** admission, resource limits, the stop margin, per-unit deadline checks, and the `/mcp` socket-timeout override. `lint_wiki` therefore has no single-scan guard yet, and it is not reachable from `/mcp` until Story 1.10.
