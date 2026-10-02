---
title: 'Story 1.6: Detect Authorized Hierarchy and Global-Index Defects'
type: 'feature'
created: '2026-10-02'
status: 'done'
baseline_revision: 'b900f0fe0e73d7c6736f53ade61cf6570f9b4733'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      Repeated GLOBAL_INDEX_LINK_MISSING Findings are byte-identical, so an agent cannot tell which configured global index to link, or which collection policy required it when several collections in the default scope share one surface.
    evidence: |-
      The AD-12 Finding is fixed to { code, severity, message, location }. The registry message is generic, and the relationship location names only the surface document. Every missing index of one surface, and every collection policy that shares that surface and index, therefore yields an identical Error that differs only in sort position. The configured index IDs are server-side configuration, which the agent never sees. This is the same root cause as DW-2: identifying the missing item needs an architecture decision before the Story 1.10 lint-repair-relint acceptance. Raised by the Blind Hunter and the Edge Case Hunter in the 2026-10-02 review pass.
    location: >-
      server/wikiLint/core/graphRules.ts:182 (globalIndexLinks emit); Architecture Spine AD-12
    severity: medium
---

<intent-contract>

## Intent

**Problem:** `lint_wiki` (Story 1.5, still unregistered) loads the authorized graph inputs (parent edges, `structureDocumentIds`, global-index inputs), but nothing evaluates them: every required `hierarchy` or `global_index` check fails closed with `VALIDATION_RUNTIME_FAILED`. An agent therefore gets no hierarchy or global-index Findings to repair, and a graph-checked collection can never be `complete`.

**Approach:**
- Add pure rules in the core for the four hierarchy kinds and `global_index_links`. They evaluate only the immutable `WikiSnapshot` the adapter already builds.
- Replace the shell's fail-closed graph branch with an explicit AD-11 unit list:
  1. every document unit in AD-4 key order;
  2. then, per collection in key order, its hierarchy check followed by its global-index check.
- The shell keeps turning each graph check of a `graphAuthorized: false` collection into one generic System Failure, and never invokes the rules for it.

## Boundaries & Constraints

**Always:**
- **Rule semantics:** every rule runs over one collection's authorized graph.
  - `parent_document_resolved` → `PARENT_DOCUMENT_UNRESOLVED`. It fires for each evaluated document whose parent edge is `unresolved`.
  - `parent_collection_consistent` → `PARENT_COLLECTION_MISMATCH`. It fires for each edge that is `resolved` with `sameCollection: false`. Such a parent is never also reported as unresolved.
  - `published_documents_in_structure` → `PUBLISHED_DOCUMENT_MISSING_FROM_STRUCTURE`. It fires for each evaluated document absent from `structureDocumentIds`.
  - `hierarchy_acyclic` → `HIERARCHY_CYCLE`. It fires exactly once for each evaluated document on a cycle. A cycle is formed only by resolved `sameCollection: true` edges between evaluated documents of that collection, including a self-parent.
    - A tail that leads into a cycle is not reported.
    - A walk stops at a parent that is not evaluated (a draft, archived, or template document).
  - `global_index_links` → `GLOBAL_INDEX_LINK_MISSING`. For each configured index, taken in bytewise-sorted order, consider the pair (surface, index). A pair is provable only when the surface is non-null and the index appears in `globalIndex.indexes`. A provable pair whose surface has no direct link to the index emits one Finding.
    - The surface's direct links are exactly `surface.links`, the output of the Story 1.4 extraction function.
    - A link matches an index when `keyKind: "id"` and `key === documentId`, or when `keyKind: "urlId"` and `key === urlId`, compared exactly and case-sensitively.
    - Transitive links never count.
- **Locations:**
  - Hierarchy codes use `relationship { documentId: <source>, relationshipKind }`, with `parent` for the parent and cycle codes and `collection_structure` for the structure code.
  - `GLOBAL_INDEX_LINK_MISSING` uses `relationship { documentId: <surface>, relationshipKind: "global_index" }`.
  - Every Finding of a graph check carries `sortCollectionId` = the evaluated collection.
- **Ordinals:** a rule-local ordinal per (rule kind, location document), counted from 0 in emission order. Hierarchy kinds emit at most one Finding per document, so the ordinal is always 0. Global-index Findings are numbered in sorted-index order.
- **Isolation:** each enabled kind of a check runs in isolation. If a kind throws (for example on a contract violation such as a `parent: null` edge or a null `globalIndex`), or a global-index pair is unprovable, the check is incomplete. Findings already emitted are kept, and later kinds still run.
- **Shell:** for an incomplete check, add exactly one `VALIDATION_RUNTIME_FAILED` at `cs(C)` and do not count the check as completed. A completed check, including a vacuous one with zero documents, counts one completed unit and is listed in `completedChecks` in canonical order.
- **`graphAuthorized: false`** (or a graph that is not authorized): each required graph check gets one `VALIDATION_RUNTIME_FAILED` at `cs(C)`, never completes, and never invokes the core.
- **Unit order** follows AD-11: all document units come first, then for each collection its hierarchy check and then its global-index check. A collection's vacuous `documents` unit sits where its first document unit would sort. Every unit keeps its position in this order, including a vacuous check and a `graphAuthorized: false` check.
- **Counts:** `evaluatedDocumentCount` and `evaluatedLinkCount` come from completed document units only, exactly as in Story 1.5.

**Never:**
- **Out of scope:**
  - deadline checks between units, admission, limits, and the stop margin (Story 1.7);
  - audit (Story 1.8);
  - registering `lint_wiki` on `/mcp` (Story 1.10).
- **Forbidden edits:**
  - no edits to `server/editor/**`, `shared/editor/**`, `server/routes/mcp/**`, or `sprint-status.yaml`;
  - no change in `lint_document` behavior;
  - no adapter change that loosens a Story 1.5 disclosure or read rule.
- **No semantic judgment:** no check of placement, category, authority, language, relevance, or usefulness, and no LLM, classifier, fuzzy matching, or inferred global indexes.
- **No cross-collection traversal:** cycle detection never follows a cross-collection edge or uses another collection's graph.
- **Disclosure:** output never names an unreadable parent, index, surface, or collection, and never tells which proving fact was missing.
- **Identifiers:** no pilot identifiers in code, descriptions, or fixtures.

## I/O & Edge-Case Matrix

`C` is an evaluated collection with `graph.authorized: true` unless stated. `cs(C)` is `scope { scopeKind: "collection", collectionId: C }`. `rel(d, k)` is `relationship { documentId: d, relationshipKind: k }`.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid hierarchy | root and child both in structure; the child's parent is the root | no Finding; `hierarchy` completed | — |
| Dangling parent | the parent was deleted, or sits in an unreadable collection | `PARENT_DOCUMENT_UNRESOLVED` at `rel(child, parent)`; both cases byte-identical apart from the IDs; no parent ID in the output | — |
| Cross-collection parent | the parent is readable in another collection | `PARENT_COLLECTION_MISMATCH` at `rel(child, parent)`; no unresolved Finding | — |
| Non-evaluated parent | the parent is a draft or archived document in `C` | no Finding | — |
| Cycle | A→B→A, a self-parent S→S, and a tail T→A | one `HIERARCHY_CYCLE` each for A, B, and S, with ordinal 0; none for T | — |
| Missing from structure | a published document absent from `documentStructure` | `PUBLISHED_DOCUMENT_MISSING_FROM_STRUCTURE` at `rel(d, collection_structure)` | — |
| Excluded documents | a draft or an archived document missing from structure, or a document of an unreadable collection | no Finding | — |
| Vacuous hierarchy | `C` has no evaluated documents | `complete`, `completedChecks: ["hierarchy"]` | — |
| Global index, all linked | the surface links each index in a recognized form (L2, L5, L6, L7) | no Finding; `global_index` completed | — |
| Global index, missing links | the surface reaches indexes only through unrecognized forms (L8–L10), or only transitively | one `GLOBAL_INDEX_LINK_MISSING` per unlinked index at `rel(surface, global_index)`, with ordinals 0..n−1 | — |
| Partially provable | one configured index unreadable, the others readable | Findings for the readable pairs only, plus one `VALIDATION_RUNTIME_FAILED` at `cs(C)`; `global_index` not completed; the unreadable index ID absent from the output | — |
| Surface unprovable | the surface is unreadable or unavailable | no `GLOBAL_INDEX_LINK_MISSING`; one `VALIDATION_RUNTIME_FAILED` at `cs(C)` | — |
| Rule kind throws | an authorized graph with a document whose `parent` is null, plus another enabled hierarchy kind | the other kind's Findings are kept; one `VALIDATION_RUNTIME_FAILED` at `cs(C)`; `hierarchy` not completed | — |
| No `readDocument` | the admin case of Story 1.5, with a document readable through membership and a defective hierarchy | the document unit is evaluated; no hierarchy Finding; one `VALIDATION_RUNTIME_FAILED` per required graph check; no `documentStructure` statement; graph rules not invoked | — |

</intent-contract>

## Code Map

- `server/wikiLint/core/contracts.ts`:
  - `:259` `WikiParentEdge`, `:265` `WikiSnapshotDocument`, `:284` `WikiGlobalIndexInput`, `:299` `WikiCollectionGraph`, `:310` `WikiSnapshotCollection`, and `:322` `WikiSnapshot`, already final for this story;
  - `IssueItem` (`sortCollectionId` and `ordinal`), `CheckName`, and `RelationshipLocation`.
- `server/wikiLint/core/registry.ts`:
  - `:103-147` the five graph codes, each with its fixed `relationshipKind` and its `check`;
  - `:324-344` the graph rule schemas (`global_index_links { surfaceDocumentId, globalIndexDocumentIds }`, lowercase UUIDs, unique, at least one);
  - `RULE_REGISTRY`, `getIssueDefinition`, `createFinding` (it throws on a mismatched `relationshipKind`), and `requiredChecks`.
- `server/wikiLint/core/documentRules.ts:351-405` -- the pattern to mirror: `documentSurfaceRules`, and `evaluateDocumentRules` with its per-kind `emit`/ordinal and `try/catch` isolation.
- `server/wikiLint/core/ordering.ts:24` `compareUtf8`. `sortKey` uses `sortCollectionId` for relationship locations, which carry no `collectionId`.
- `server/wikiLint/core/result.ts:321` `buildReadOnlyResult`:
  - it re-validates issues (collection and configured scopes allow `wiki` codes);
  - `completedChecks` must be in canonical order;
  - `deriveResultState` throws when an incomplete unit has no System Failure.
- `server/wikiLint/core/boundary.test.ts` -- the forbidden-import check. A new core file may import only `./contracts`, `./registry`, and `./ordering`.
- `server/wikiLint/application/lintWiki.ts`:
  - `:323-409` the evaluation loop to restructure;
  - `:389-401` the fail-closed graph branch to replace;
  - `:127-133` the JSDoc that says graph checks fail closed.
- `server/wikiLint/adapters/wikiReader.ts:351-490` -- builds `parent` edges, `structureDocumentIds`, and `globalIndex`:
  - the surface is non-null only when it is readable and serializable;
  - `indexes` holds only the readable configured indexes, sorted, each with its `urlId`.

  No change is expected.
- `server/wikiLint/adapters/documentReader.ts:195` `findReadableDocuments` -- the `withDrafts` scope is paranoid, so drafts, archived documents, and templates resolve and deleted documents do not.
- Baseline fact: `documents.parentDocumentId` has an FK to `documents` (`server/migrations/20170827182423-improve-references.js`). A "missing" parent row cannot be built in a DB fixture, so the deleted and inaccessible fixtures stand in for it. The adapter already collapses all three to `unresolved`, as Story 1.5's adapter tests show.
- Tests:
  - `server/wikiLint/application/lintWiki.test.ts`:
    - `:28-34` mocks `documentRules` as a spy, the pattern for spying on the new core module;
    - `:36-112` the fixture policies (`HIERARCHY`, `ALL_CHECKS`);
    - `:436-486` the fail-closed tests to rewrite.
  - `server/tools/wikiLint.test.ts`:
    - `:1375-1457` the `lint_wiki` block: `hierarchyPolicy`, `mixedPolicy`, `wikiResult`, `recordSql`, and `buildAdminFixture`;
    - `:1510` the lowercase-ID test, which expects the `incomplete` fail-closed result and must now expect `complete`;
    - `:674` `sourceText(hrefs)` and `:1195` `paragraphOf`/`linkedText`, defined inside other `describe` blocks; hoist or redefine them for the L-form surface;
    - an L6 mention is a `mention` node with `attrs.modelId`, serialized as `[label](/doc/<id>#anchor)` (`:1216-1258`);
    - pass `instanceOrigin: ORIGIN` to `connect` for absolute forms.
  - `server/test/factories.ts:376` -- `buildDocument` adds a document to the structure only when it creates the collection itself. With an explicit `collectionId`, call `collection.addDocumentToStructure(doc)`. Set cycles and parents with `Document.unscoped().update({ parentDocumentId }, { where: { id }, hooks: false })`, as `wikiReader.test.ts:991` does.
  - `server/wikiLint/core/internalLinks.test.ts:35-78` -- the L1–L11 href forms.
- DB tests: follow memory `local-test-postgres` (resume a migrated scratch PG14 on `127.0.0.1:5432`, or recreate it).

## Tasks & Acceptance

**Execution:**
- `server/wikiLint/core/graphRules.ts` (new) -- `evaluateGraphCheck({ check: "hierarchy" | "global_index", documents, graph, rules })`. `graph` is the authorized variant of `WikiCollectionGraph`, and `rules` is the full policy rule list. It returns `{ findings: IssueItem<Finding>[]; complete: boolean }`.
  - It selects the enabled kinds whose registry check equals `check`.
  - It implements the Boundaries semantics, with per-kind isolation and ordinals.
  - The cycle detection is iterative (no recursion) and linear over a functional graph.
  - Why: AD-1 and AD-2 require one pure, deterministic graph evaluator.
- `server/wikiLint/core/graphRules.test.ts` (new) -- pure fixtures for every Boundaries rule and matrix row:
  - multiple codes on one document;
  - disjoint cycles;
  - a self-parent;
  - a tail into a cycle;
  - a walk stopping at a non-evaluated parent;
  - a cross-collection edge not followed;
  - an exact-case `urlId` mismatch counting as missing;
  - id and urlId matches;
  - ordinals;
  - throw isolation;
  - disabled kinds emitting nothing;
  - byte-equal repeated evaluation;
  - an editorially odd but valid hierarchy (deep chain, a non-evaluated parent) giving no Finding.
- `server/wikiLint/application/lintWiki.ts`:
  - export `wikiUnits(snapshot, checksOf)`, which returns the AD-11 unit list (see Design Notes);
  - restructure the evaluation loop to iterate it, with per-collection accounting;
  - give graph units the shell semantics in Boundaries;
  - update the JSDoc.
  - Why: AD-11 fixes the unit order, and Story 1.7 will put its deadline check before each listed unit.
- `server/wikiLint/application/lintWiki.test.ts`:
  - spy on `evaluateGraphCheck` the same way `documentRules` is spied on;
  - replace the fail-closed tests;
  - cover:
    - `wikiUnits` order across two collections (each with documents, a vacuous documents unit, both graph checks, and a `graphAuthorized: false` collection);
    - authorized Findings carrying `sortCollectionId`;
    - `completedChecks: ["documents", "hierarchy", "global_index"]`;
    - a partially provable check (`incomplete`, Findings kept);
    - a vacuous hierarchy check;
    - a `graphAuthorized: false` hierarchy-only collection with no documents (`failed`, not vacuous, `evaluateGraphCheck` not called);
    - a throwing rule kind.
- `server/tools/wikiLint.test.ts`:
  - update the `:1510` expectations;
  - add a `describe("hierarchy and global index")` inside `lint_wiki` with DB fixtures for the integration acceptance criteria below.

**Acceptance Criteria:**
- **AC2–AC5 and AC9, hierarchy:** Given one readable collection `C` with a hierarchy policy enabling all four hierarchy kinds and holding these documents:
  - a valid root and child, both in the structure;
  - a child of a soft-deleted parent;
  - a child of a parent in a private collection the actor cannot read;
  - a child of a readable parent in another collection;
  - a child of a draft parent in `C`;
  - a cycle A↔B;
  - a published document missing from the structure;
  - a draft and an archived document missing from the structure.

  Every other published document of `C` is added to the structure.

  When `lint_wiki { collectionId: C }` runs, then:
  - the result is `state: "complete"`, `clean: false`, with `completedChecks: ["hierarchy"]`;
  - `errors` equals exactly the expected Findings in AD-4 order: two `PARENT_DOCUMENT_UNRESOLVED`, one `PARENT_COLLECTION_MISMATCH`, two `HIERARCHY_CYCLE`, and one `PUBLISHED_DOCUMENT_MISSING_FROM_STRUCTURE`, each with its fixed severity and `relationship` location;
  - the serialized result contains neither the private parent's ID nor the private collection's ID;
  - a second call is byte-equal.
- **AC6, global index:** Given a surface whose recognized links (L2 slug-`urlId`, L5 absolute, L6 mention, L7 `/d/`) reach four indexes, three more indexes reached only through L8, L9, and L10 forms, and one index reached only through another document that links to it, when `lint_wiki` runs with `global_index_links` over all eight, then:
  - the result is `complete`;
  - it holds exactly four `GLOBAL_INDEX_LINK_MISSING` Findings at `rel(surface, global_index)`;
  - `completedChecks` includes `"global_index"`.
- **AC7, unprovable:**
  - Given the same policy plus one configured index in an unreadable private collection, when `lint_wiki` runs, then:
    - the four Findings are still emitted;
    - `systemFailures` is exactly one `VALIDATION_RUNTIME_FAILED` at `cs(C)`;
    - `global_index` is absent from `completedChecks`;
    - `clean` is false;
    - the unreadable index ID is absent from the output.
  - Given an unreadable surface instead, when it runs, then there is no `GLOBAL_INDEX_LINK_MISSING` and exactly one such System Failure.
- **AC8, vacuous:** Given a readable collection with no published documents and a hierarchy-only policy, when `lint_wiki` runs, then the result is `complete` and `clean`, with `completedChecks: ["hierarchy"]` and zero counts.
- **AC1 and AC12, no `readDocument`:** Given an admin without membership on a private collection, a document there readable through `UserMembership` but missing from the structure, and a policy with a structure rule plus `published_documents_in_structure` and `global_index_links`, when the default scope runs, then:
  - `evaluatedDocumentCount` is 1, with `completedChecks: ["documents"]`;
  - `errors` holds no graph code;
  - `systemFailures` is exactly two `VALIDATION_RUNTIME_FAILED` at `cs(C)`;
  - no statement contains `documentStructure`.
- **AC10, accounting:** Given one collection with clean documents and all three checks passing, when `lint_wiki` runs, then the result is `complete`, `clean`, with `completedChecks: ["documents", "hierarchy", "global_index"]`, counts from the document units only, and its single valid policy identity.

## Spec Change Log

## Review Triage Log

### 2026-10-02 — Review pass
- verdicts: 25 findings — high 0, medium 2, low 8, false 15, maybe-false 0
- findings:
  - `[false]` `[reject]` **Blind Hunter:** `evaluateGraphCheck` folds a thrown kind and an unprovable pair into one boolean. — AD-11 and AD-12 make both outcomes the same generic `VALIDATION_RUNTIME_FAILED` at `cs(C)`, and the shell needs only completion. `evaluateDocumentRules`' `failedKinds` is likewise consumed only as `length > 0` (`lintWiki.ts`). No consumer needs the distinction.
  - `[false]` `[reject]` **Blind Hunter:** no guard against repeated or foreign kinds in `evaluateGraphCheck`. — `policySet.ts:102-111` rejects duplicate kinds, so no policy that reaches the core repeats one. Taking the full rule list and skipping other checks' kinds is the specified input contract.
  - `[low]` `[reject]` **Blind Hunter:** link matching is quadratic (indexes × surface links). — Configured index lists are short; even 10 indexes × 1,000 surface links is 10k comparisons, far inside NFR-3. No user would notice it, and the fix restructures the matching rather than correcting a line.
  - `[false]` `[reject]` **Blind Hunter:** `wikiUnits` trusts sorted input. — The adapter sorts both collections and documents with `compareUtf8` (`wikiReader.ts:220`, `:473`), and `contracts.ts` documents that order, so no unsorted snapshot reaches `wikiUnits`.
  - `[false]` `[reject]` **Blind Hunter:** a null `graph` on a required graph check is treated like `authorized: false`. — The adapter sets `graph` null only when no graph check is required (`wikiReader.ts:479`), so a required check never sees null. The branch still fails closed.
  - `[low]` `[patch]` **Blind Hunter:** the AD-11 order test maps graph calls to `check` only and cannot catch a collection-order swap. — Patched: each graph call now maps to `[check, documentIds]`. The test asserts the exact sequence `ALL_CHECKS` hierarchy, then global index, then `ALL_CHECKS_2` hierarchy, then global index.
  - `[low]` `[reject]` **Blind Hunter:** the fixtures put every document at the structure root while children carry parents. — The rule checks only structure membership, so nesting changes no outcome. Nested flattening is covered by the `structureDocumentIds` tests (`wikiReader.test.ts:423`, `:435`). Re-nesting would need fixture reloads for no change in behavior.
  - `[low]` `[patch]` **Blind Hunter:** the hierarchy integration test never asserts that the deleted parent's ID is absent. — Grouped with Intent Alignment (AC2). Patched: the output is asserted free of the deleted, protected, and shared parents' IDs and of the private collection's ID.
  - `[low]` `[patch]` **Blind Hunter:** no archived-parent case end to end. — Patched: `ofArchived`, a child of an archived parent in `C` (the parent stays out of the structure), is in the structure. It gets no Finding, and the exact `errors` list is unchanged.
  - `[false]` `[reject]` **Blind Hunter:** the admin test cannot catch a surface or index read for an unauthorized graph. — It asserts what AD-9 and AC12 require: no `documentStructure` statement, two generic failures, and the membership document evaluated. Surface and index lookups go through membership-aware readable queries, which AD-9 does not prohibit. That rules never run for such a graph is proven at the shell (`evaluateGraphCheck` is not called).
  - `[low]` `[reject]` **Blind Hunter:** the expected order uses a home-made comparator that ignores the AD-4 tie-breakers. — It is correct for this fixture, which has one Finding per document. Any fixture change that adds a tie must rewrite the expectation anyway.
  - `[medium]` `[defer]` **Blind Hunter:** indistinguishable `GLOBAL_INDEX_LINK_MISSING` Findings are not tracked. — Grouped with Edge Case Hunter (shared surface). The root cause is the AD-12 Finding shape and the fixed registry message, the same as DW-2. Fixing it needs an architecture decision, not a story patch. Deferred in frontmatter.
  - `[false]` `[reject]` **Blind Hunter:** JSDoc is missing on `Emit` and three rule functions. — The sibling `documentRules.ts` rule functions (`:198` `requiredSections`, `:214` `sectionOrder`, `:279` `markdownStructures`) and its `Emit` type carry no JSDoc either, so the new file matches the surrounding style.
  - `[false]` `[reject]` **Edge Case Hunter:** a surface also listed as a global index must link to itself. — FR-9 and AC6 require a direct link to every explicitly configured index, without exception, and the registry accepts this configuration (`wikiReader.test.ts:1125` uses it). Skipping the pair would silently ignore a configured requirement.
  - `[medium]` `[defer]` **Edge Case Hunter:** two default-scope policies sharing one surface and one unlinked index give identical Errors. — Grouped with Blind Hunter (indistinguishable Findings). Same root cause, the AD-12 shape with no requirement identity; deferred.
  - `[false]` `[reject]` **Intent Alignment (surface):** no production `/mcp` surface delivers the story yet. — Story 1.6's ACs (`epics.md:593-653`) contain no exposure requirement. Registration and discovery are Story 1.10's, per the epic.
  - `[false]` `[reject]` **Intent Alignment (AC1):** the core's input side relies on Story 1.5's adapter tests. — The adapter is unchanged. Its non-disclosure tests (`wikiReader.test.ts:976`, `:1083`) ran and passed in this verification.
  - `[low]` `[patch]` **Intent Alignment (AC2):** the deleted parent's ID is not asserted absent. — Grouped with Blind Hunter (deleted parent ID); patched as above.
  - `[false]` `[reject]` **Intent Alignment (AC3):** the cycle variants and ordinals are covered only in core tests. — The shell passes snapshot documents unchanged into the same `evaluateGraphCheck` those tests exercise. Ordinals are never serialized and are observable only through order, which the core tests cover.
  - `[false]` `[reject]` **Intent Alignment (AC6):** not every variant of each link form is covered. — Story 1.4's fixtures fix the forms (`internalLinks.test.ts:35-78`), and each recognized and unrecognized class has an end-to-end instance here.
  - `[false]` `[reject]` **Intent Alignment (AC7):** `incomplete` with Findings kept is shown only in shell tests. — AC7 allows "incomplete or failed". `failed` is observed end to end, and `incomplete` with retained Findings at the shell.
  - `[false]` `[reject]` **Intent Alignment (AC8):** "never vacuous without `readDocument`" is checked only in shell tests. — The Story 1.5 integration test "fails its graph checks without reading its structure" (`wikiLint.test.ts:1728`) is exactly that case: a hierarchy-only `graphAuthorized: false` collection with zero evaluated documents returns `failed`.
  - `[false]` `[reject]` **Intent Alignment (AC9):** the no-LLM guarantee is structural only. — The rules are pure deterministic functions, and `boundary.test.ts` forbids every import that is not on the allow-list, now including `graphRules.ts`.
  - `[low]` `[patch]` **Intent Alignment (AC12):** parents inside a collection without `readDocument` resolving by document readability are not exercised. — Patched: `ofShared`'s parent is in the private collection and readable through a `UserMembership`. It gives exactly one `PARENT_COLLECTION_MISMATCH`, not an unresolved Finding, and neither that parent's ID nor the private collection's ID appears in the output.
  - `[false]` `[reject]` **Intent Alignment (R3):** the bookkeeping status is not visible yet. — It is written at finalization. No Story 1.6 AC needs a human action outside the repo, so the status is `done`, not `awaiting-operator`.

## Design Notes

**Unit list** (application layer):

```ts
interface WikiUnit { collection: WikiSnapshotCollection; check: CheckName; document?: WikiSnapshotDocument }
// pass 1: for each collection (sorted) whose checks include "documents":
//   documents.length === 0 ? one { check: "documents" } : one unit per document (sorted)
// pass 2: for each collection (sorted): its "hierarchy", then its "global_index" unit, if required
```

**Per-collection scope of the graph.** AD-9 grants the graph checks per collection, through `readDocument`. A cycle walk that followed a cross-collection edge would therefore read another collection's graph, which may be unauthorized or out of scope. It would also make one collection's Findings depend on the request scope. Cross-collection edges are instead reported by `PARENT_COLLECTION_MISMATCH` (FR-8: "structurally inconsistent cross-collection parent relationships").

**Repeated messages.** Several `GLOBAL_INDEX_LINK_MISSING` Findings on one surface are byte-identical apart from their order, the same limitation as DW-2. This story does not change the AD-12 Finding shape.

## Verification

**Commands:**
- `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint server/tools/wikiLint.test.ts` -- expected: all pass on the migrated test Postgres.
- `TZ=UTC node_modules/.bin/vitest run --project server server/tools server/routes/mcp` -- expected: the baseline MCP tests are unaffected.
- `corepack yarn tsc` -- expected: exit 0.
- `node_modules/.bin/oxlint --type-aware server/wikiLint server/tools/wikiLint.ts server/tools/wikiLint.test.ts` -- expected: 0 errors.
- `node_modules/.bin/oxfmt --check server/wikiLint server/tools/wikiLint.ts server/tools/wikiLint.test.ts` -- expected: clean.
- `grep -rniE "laura|ezop" server/wikiLint server/tools/wikiLint*.ts` -- expected: no matches.

## Auto Run Result

Status: done

**Summary.** `lint_wiki`, still unregistered on `/mcp`, now evaluates the `hierarchy` and `global_index` checks over each collection's authorized graph. Before this, they failed closed.
- **The core:** the new `evaluateGraphCheck` implements five rule kinds as pure, deterministic rules:
  - `PARENT_DOCUMENT_UNRESOLVED` and `PARENT_COLLECTION_MISMATCH`, which are mutually exclusive per edge;
  - `HIERARCHY_CYCLE`, reported once per document on a same-collection cycle; tails are never reported, and a walk stops at a non-evaluated parent and never crosses collections;
  - `PUBLISHED_DOCUMENT_MISSING_FROM_STRUCTURE`;
  - `GLOBAL_INDEX_LINK_MISSING`, matching the surface's own Story 1.4 links by exact `id` or `urlId`.

  Each kind runs in isolation. A throwing kind or an unprovable global-index pair makes the check incomplete, and the Findings already emitted are kept.
- **The shell:** it iterates the AD-11 unit list `wikiUnits`, which puts every document unit first and then each collection's hierarchy check followed by its global-index check. Graph Findings carry `sortCollectionId`. An incomplete check adds one generic `VALIDATION_RUNTIME_FAILED` at `cs(C)`. A graph without `readDocument` is never evaluated and fails generically, so it never completes vacuously. `completedChecks` and counts reflect only completed units.

**Files changed:**
- `server/wikiLint/core/graphRules.ts` (new) — `evaluateGraphCheck` and the five graph rule kinds.
- `server/wikiLint/core/graphRules.test.ts` (new) — pure fixtures for every rule, every matrix row, isolation, ordinals, and determinism.
- `server/wikiLint/core/boundary.test.ts` — lists `graphRules.ts` among the core files.
- `server/wikiLint/application/lintWiki.ts` — `wikiUnits`, the per-collection accounting loop, and graph-unit semantics in place of the fail-closed branch.
- `server/wikiLint/application/lintWiki.test.ts` — `evaluateGraphCheck` spied on. It tests every authorized and unauthorized graph outcome, plus the AD-11 unit and evaluation order across collections.
- `server/tools/wikiLint.test.ts`:
  - `paragraphOf` and `linkedText` hoisted to module scope;
  - the lowercase-ID test updated to `complete`;
  - a new DB-backed `hierarchy and global index` block.

**Review findings breakdown** (25 findings: high 0, medium 2, low 8, false 15, maybe-false 0):
- **Patches applied:** 4 entries (all low), all test-only; production code is unchanged.
  - the AD-11 order test asserts the per-collection graph-call sequence;
  - the deleted parent's ID is asserted absent from the output;
  - an archived-parent case is added;
  - a parent readable through document membership inside a collection without `readDocument` is shown to give `PARENT_COLLECTION_MISMATCH`.
- **Deferred:** 1 entry (medium), raised by the Blind Hunter and the Edge Case Hunter. Repeated `GLOBAL_INDEX_LINK_MISSING` Findings are byte-identical: an agent cannot tell which configured index is missing, or which policy required it when collections share a surface. This is the same AD-12 root cause as DW-2.
- **Rejected:**
  - low:
    - quadratic link matching (negligible at configured sizes);
    - root-level fixture structures (membership-only rule; flattening is unit-tested);
    - the home-made expected-order comparator (correct for one Finding per document).
  - false:
    - one completion boolean (generic failure by design);
    - no repeated-kind guard (the policy set rejects duplicates);
    - unsorted `wikiUnits` input (the adapter sorts);
    - a null required graph (unreachable);
    - the admin test's surface and index reads (not prohibited; rules not invoked);
    - missing JSDoc (matches `documentRules.ts`);
    - a surface that is also an index (FR-9 literal);
    - no `/mcp` exposure (Story 1.10);
    - AC1 input relying on the adapter tests;
    - AC3 core-only cycle variants;
    - AC6 form variants;
    - AC7 `failed` versus `incomplete`;
    - AC8 (an existing 1.5 integration test covers it);
    - AC9 is structural;
    - R3 status timing.

**Follow-up review recommendation: false.** This was a first pass, and the patched entries were high 0, medium 0, low 4. Every patch was test-only, and no unverified risk remains for another pass to examine.

**Verification performed** (final tree; test database PostgreSQL 14 at `127.0.0.1:5432/outline-test`, migrated):

| Command | Result |
| --- | --- |
| `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint server/tools/wikiLint.test.ts` | 17 files, 766/766 passed |
| `TZ=UTC node_modules/.bin/vitest run --project server server/tools server/routes/mcp` | 9 files, 165/165 passed |
| `corepack yarn tsc` | exit 0 |
| `node_modules/.bin/oxlint --type-aware` on the changed paths | exit 0 |
| `node_modules/.bin/oxfmt --check` on the changed paths | clean |
| `grep -rniE "laura\|ezop" server/wikiLint server/tools/wikiLint*.ts` | no matches |

Matrix test audit: each of the 14 I/O matrix rows has at least one covering test that ran and passed in the runs above; none is skipped or filtered.

**Residual risks:**
- **Indistinguishable Findings:** repeated `GLOBAL_INDEX_LINK_MISSING` Findings cannot be told apart. This is deferred with DW-2, and it must be decided before the Story 1.10 repair-loop acceptance.
- **Unit order not yet observable:** AD-11 unit order is pinned only at the shell, through `wikiUnits` and the evaluator call order. It becomes externally observable once Story 1.7 adds a deadline check before each unit.
- **Unchanged adapter residuals from Story 1.5:**
  - a `global_index`-only policy still loads parent edges;
  - a surface that is also an evaluated document is serialized twice.
- **Story 1.7 bounds:** `lint_wiki` still has no admission, limits, or per-unit deadline checks.
