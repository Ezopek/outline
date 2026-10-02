---
title: 'Story 1.1: Establish the Deterministic Result Contract and Closed Rule Registry'
type: 'feature'
created: '2026-10-02'
status: 'done'
baseline_revision: 'd1b38db2da3d560452dce5d628ab0f7aa5fd4540'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      parseCanonicalMarkdown throws when a block token starts on a blank line, failing every rule of the document instead of only rules that need that position.
    evidence: |-
      server/wikiLint/adapters/canonicalSyntax.ts blockPosition throws CanonicalMarkdownError for a whitespace-only start line, while unmapped blocks degrade to position null. No canonical (serializer-produced) input reaching this path has been found. Settle it by finding a toCanonicalMarkdown output whose block token map starts on a blank line; if one exists, return position null instead of throwing.
    location: >-
      server/wikiLint/adapters/canonicalSyntax.ts:74
    severity: medium (unverified)
  - summary: >-
      Repeated missing-item Findings (REQUIRED_SECTION_MISSING, REQUIRED_METADATA_FIELD_MISSING) are byte-identical, so an agent cannot tell which configured section or field to add.
    evidence: |-
      AD-12 fixes Finding to { code, severity, message, location } with a document location; the registry message is fixed and generic for non-disclosure (NFR-11, policy class only for document-only readers); the rule-local ordinal is not part of the output. Identifying the missing item needs an architecture decision (for example readability-gated detail) before the Story 1.10 lint-repair-relint acceptance.
    location: >-
      server/wikiLint/core/registry.ts (issue messages); Architecture Spine AD-12
    severity: medium
---

<intent-contract>

## Intent

**Problem:** No shared lint core exists. Every later Epic 1 and Epic 2 surface needs one deterministic contract — result algebra, closed issue and rule-kind registry, ordering, and safe positions — or surfaces will drift in codes, severities, locations, and clean-state meaning.

**Approach:** Add a pure `server/wikiLint/core` (contracts, closed issue registry, closed rule-kind registry with strict parameter schemas, AD-4 ordering, AD-12 result builder, the seven document-structure rule evaluators) and one adapter, `server/wikiLint/adapters/canonicalSyntax.ts`, which serializes canonical Markdown and parses it with Outline's own parser. It is the only producer of line/column/path. Everything is proven by collocated tests, including a forbidden-import check.

## Boundaries & Constraints

**Always:**
- Non-test core files import only relative modules inside `server/wikiLint/core/` and `zod`. They do not use `process`, `Date`, `performance`, timers, `fetch`, `console`, `require`, `globalThis`, or `Math.random`.
- Codes, severities, messages, location kinds, surfaces, and checks come only from the registry. Constructors reject any mismatch. Each code has one fixed, generic message: no IDs, content, configuration values, or AD references. Message wording is not part of the stable contract.
- Line, column, and path come only from the adapter. Rules copy positions and never compute them.
- String comparison is bytewise UTF-8 (equivalently, code-point order), never locale or UTF-16 order. Result objects are built in a fixed key order, so `JSON.stringify` is byte-stable.
- Fixtures are generic: synthetic UUIDs such as `00000000-0000-4000-8000-000000000001`, plus generic headings and field names.
- Follow the baseline TypeScript configuration (not strict), vitest globals, and the JSDoc style of `server/tools/util.ts`.

**Never:**
- Out of scope here:
  - MCP tool registration, DB/snapshot/auth code, and `lint_document` orchestration (1.3, 1.10).
  - Config file decoding, canonical JSON, fingerprints, and `WIKI_LINT_CONFIG_PATH` (1.2).
  - Link extraction or `internal_links` evaluation (1.4).
  - Hierarchy and global-index evaluators (1.6).
  - Audit (1.8).
- No regex, code, severity, or custom code in configuration.
- No Unicode normalization.
- No reads of `Document.text`.
- No edits to `server/editor/**`, `shared/editor/**`, or `_bmad-output/implementation-artifacts/sprint-status.yaml`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Complete, warning-only | required=completed=1, no SF, warnings only | `state: complete`, `complete: true`, `clean: true`, warnings kept | none |
| Complete with Errors | required=completed, no SF, ≥1 Error | `state: complete`, `clean: false` | none |
| Incomplete | completed≥1, SF≥1 | `state: incomplete`, `complete`/`clean` false | none |
| Failed, retained Findings | completed=0, SF≥1, Findings present | `state: failed`, Findings kept in `errors`/`warnings` | none |
| Not evaluated | `notEvaluated` with empty items and policies | `state: not_evaluated`, `complete`/`clean` false, `reason: "POLICY_NOT_CONFIGURED"`; `reason` absent in every other state | non-empty items or policies → throw |
| Impossible algebra | no SF but completed < required | — | throw invariant error |
| Bad SF code | startup-only, Finding-class, or unknown code passed to SF constructor | — | throw |
| Surface violation | `VALIDATION_RESOURCE_LIMIT_EXCEEDED` or a `wiki`-surface code in a `document`-kind scope | — | throw |
| Location mismatch | e.g. `REQUIRED_SECTION_MISSING` with a `text` location, `HIERARCHY_CYCLE` with `relationshipKind: global_index`, `scope{scopeKind:"document"}` without `documentId` | — | throw |
| Bad rule config | unknown `kind`; extra key (`severity`, `code`, `pattern`, `regex`, `fn`); duplicate list item; level outside 1–6; non-canonical UUID; untrimmed or empty string | — | schema rejects (`safeParse` fails) |
| CR in Markdown | canonical string containing U+000D | — | adapter throws a typed `CanonicalMarkdownError`; no positions fabricated |

</intent-contract>

## Code Map

- `server/editor/index.ts` -- exports `parser`. `parser.tokenizer` is Outline's markdown-it instance (`makeRules`: `linkify: false`, `html: false`, plus extension rule plugins and mention rules). Read-only. It transitively imports `PluginManager` → `@server/env`/`Logger`, so the **core must not import it**; the adapter may.
- `shared/editor/lib/markdown/rules.ts` -- `makeRules`, with `linkify: false` as the default. Reference only.
- `server/models/helpers/DocumentHelper.tsx:290` -- `static async toMarkdown(Document | Revision | Collection | ProsemirrorData, { includeTitle, signedUrls, teamId, commonMark })`. The canonical form passes `{ includeTitle: false }` and nothing else.
- Token facts, probed on this baseline:
  - Block tokens carry `map` = [start0, end0).
  - Opening and closing types can differ: the checkbox rule renames `ordered_list_open` to `checkbox_list_open` but leaves `ordered_list_close`. Build the tree by `nesting` (+1 / 0 / −1) only.
  - `shared/editor/rules/checkboxes.ts` **mis-types lists** (baseline defect, not to be patched there):
    - Its `CHECKBOX_REGEX` is unanchored, so a bullet item whose text merely contains `[x] ` becomes a `checkbox_item`, and its inline `content` is rewritten to the text after the marker.
    - For every item after the first in a checkbox list, its backward search retypes the nearest *earlier* list at the same level as `checkbox_list`, with its items as `checkbox_item`.
    - Probed results:
      - `* Owner: Alice\n\n- [ ] one\n- [ ] two` → the first list is `checkbox_list`;
      - `* Status: [x] done\n* Owner: Bob` → a `checkbox_list` whose first item's content is `done`.
  - The links rule (`shared/editor/rules/links.ts`) replaces a whole paragraph containing an attachment link with a map-less `attachment`/`video` token.
  - Table rows (`tr_open`) carry a document `map`. Every token inside a cell has either `map: null` or a map relative to the cell's own sub-parse (probed: a cell `fence` reports `[0,3]`). Such maps are not document lines and must never be used.
  - Table cells hold blocks: TableCell/TableHeader content is `block+`. `renderTable` (`shared/editor/lib/markdown/serializer.ts:465`) flattens cell blocks (fences, notices, blockquotes) onto the row line with `<br>`, and the tables rule rebuilds them as nested tokens.
  - Serializer output:
    - bullet lists use `* `;
    - checkbox lists use `- [ ] ` / `- [x] `;
    - headings are ATX and code is fenced;
    - `esc()` escapes `` ` * \ ~ `` everywhere, `[` only before a later `](`, and a leading `: # - * +` or `N.`.
  - Containers are `container_notice_open` and `container_toggle_open`.
  - Leaf blocks are `fence`, `code_block`, `hr`, and `math_block`.
  - Headings are `heading_open` with tags `h1`–`h6`; setext headings use markup `=`/`-`.
  - An inline token's `content` is the raw source slice (escapes kept and trimmed with JS `trim`); its `text` children hold unescaped text.
  - markdown-it normalizes `\r` to `\n`, which would shift lines, hence the CR guard.
- `vitest.config.ts` -- the `server` project includes `server/**/*.test.ts`. Pure tests run without Postgres (verified).
- `node_modules/typescript` -- the TS compiler API, for the AST import scan in the boundary test.
- `_bmad-output/planning-artifacts/architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md` -- normative source: lines 58–89 (AD-3 table), 90–95 (AD-4), 171–205 (AD-12).
- `server/tools/util.ts`, `server/tools/util.test.ts` -- style reference.

## Tasks & Acceptance

**Execution:**
- `server/wikiLint/core/contracts.ts` -- Define the exact AD-4/AD-12 types and the `CanonicalSyntax` input types (node kind, position, level, text, field, children). These are the shared vocabulary for every surface.
- `server/wikiLint/core/registry.ts` -- Add:
  - the issue registry, with exactly the AD-3 rows (class, code, location kind + `relationshipKind`, surfaces, check, message);
  - `POLICY_NOT_CONFIGURED` and `COLLECTION_CONFLICT = "collection_conflict"`;
  - the 13-kind rule registry from Design Notes: Zod strict schemas, plus `ruleConfigSchema` as a discriminated union on `kind`. Deep-freeze both registries at runtime (`as const` alone is type-only);
  - `createFinding(code, location)` and `createSystemFailure(code, location)` with validation.

  Rationale: AD-3, FR-23.
- `server/wikiLint/core/ordering.ts` -- Add `compareUtf8`, `comparePath`, and `sortIssues(items)`. Items carry the issue, an optional server-derived `sortCollectionId`, and an optional `ordinal`. Use the AD-4 keys, absent-last ordering, and a stable emission-order tie-break.
- `server/wikiLint/core/result.ts` -- Add:
  - `deriveResultState`;
  - `buildReadOnlyResult`, which validates surface, codes, and locations; sorts issues, `policies`, and `configured_collections.collections`; validates that `completedChecks` is an ordered subset; and emits keys in the order `state, complete, clean, errors, warnings, systemFailures, scope, policies, reason?`.

  A `not_evaluated` input must also have a zero-count scope: zero counts, empty `completedChecks`, and empty `collections`.
- `server/wikiLint/core/documentRules.ts` -- Add the seven structure evaluators and `evaluateDocumentRules({ documentId, syntax, rules })`, returning `{ findings, failedKinds }`:
  - evaluators emit through a callback, so Findings emitted before a throw are kept;
  - each kind runs in isolation;
  - rule-local ordinals are zero-based per kind;
  - passing a non-structure kind throws.
- `server/wikiLint/adapters/canonicalSyntax.ts` -- Add `toCanonicalMarkdown(document | ProsemirrorData)`, which calls `DocumentHelper.toMarkdown(x, { includeTitle: false })`, and `parseCanonicalMarkdown(markdown): CanonicalSyntax`, which uses `parser.tokenizer` and is the single position producer. It must apply the list-classification, field, and table rules in Design Notes.
- Collocated tests, one per module:
  - `core/registry.test.ts` -- include a literal deep-equal of the kind→code map.
  - `core/ordering.test.ts`.
  - `core/result.test.ts` -- include:
    - acceptance of `wiki`/`lint_wiki` codes in **both** the `collection` and `configured_collections` scopes;
    - the `not_evaluated` zero-count rejection;
    - failed-result fixtures with zero counts.
  - `core/documentRules.test.ts` -- Markdown fixtures → adapter → core, with a valid and an invalid case per rule. Include a metadata section ended by a *higher*-level root heading.
  - `core/boundary.test.ts` -- the scan covers every non-test `.ts` file under `core/` recursively. Relative imports that stay inside `core/` (including subdirectories) are allowed. Also forbid:
    - the globals `global`, `Intl`, `crypto`, `eval`, `Function`, `module`, and `exports`;
    - any `localeCompare` or `toLocale*` member call.
  - `adapters/canonicalSyntax.test.ts` -- include:
    - a `Document` with `content: null` and a non-null Y.js `state`, plus a throwing `text` getter;
    - a later single-line paragraph that never becomes or overrides an item's field;
    - the serializer-produced regression fixtures named in the acceptance criteria below.

  These cover the I/O matrix and the acceptance criteria below.

**Acceptance Criteria:**
- Given the core contracts, when fixture results are serialized, then `Finding`, `SystemFailure`, `PolicyIdentity`, each `EvaluatedScope` variant, and the result contain exactly the AD-12 keys, and the `reason` key is present only for `not_evaluated`.
- Given the registry, when it is enumerated, then:
  - it deep-equals a literal table of the 19 AD-3 rows (13 Finding codes and 6 System Failure codes), with the four hierarchy codes in check `hierarchy`, `GLOBAL_INDEX_LINK_MISSING` in check `global_index`, every other rule code in check `documents`, and System Failure codes in no check;
  - each of the 13 rule kinds maps to exactly one Finding code;
  - `POLICY_NOT_CONFIGURED` is not a registry code.
- Given the same issues in shuffled orders (fixed-seed permutations), when `sortIssues` and `buildReadOnlyResult` run, then each array is byte-identical. Fixtures prove:
  - code-point order, not UTF-16 order (`"｡"` < `"\u{1F600}"`);
  - integer path segments before string segments, and a shorter prefix first;
  - location-kind rank;
  - absent values last;
  - the server-derived collection key for locations that carry no `collectionId`;
  - that titles and messages do not affect order.
- Given canonical Markdown with BMP non-ASCII and astral characters (`ż`, `😀`) before a metadata value on the same line, when `metadata_field_formats` fails, then the column counts code points, not UTF-16 units or bytes. Given a heading nested in a list or blockquote, the path identifies it. Given any `document`-location finding, it has no line, column, or relationship.
- Given `parser.tokenizer`, when it is inspected, then `options.linkify === false`. Given a ProseMirror document, `parseCanonicalMarkdown(await toCanonicalMarkdown(doc))` positions index into that exact string.
- Given synthetic core sources importing each forbidden category, when the boundary checker runs, then it reports each violation. The categories are `@server/models`, `sequelize`, `@server/policies`, `@server/env`, `@shared/env`, `@server/queues/...`, an Event model, `@server/storage/redis` (cache), `@server/logging/Logger`, `Date.now()`, `node:http` or `@server/utils/fetch`, and `node:fs` or `@server/storage/files`. Given the real `server/wikiLint/core/**/*.ts` files, it reports none.
- Given a ProseMirror document whose root holds a metadata bullet list, then a checkbox list with at least two items, and a bullet item whose text contains `[x] `, when it is serialized with `toCanonicalMarkdown` and parsed, then:
  - the metadata list is a `bullet_list` whose fields are read in full;
  - the checkbox list stays a `checkbox_list`;
  - `required_metadata_fields` emits nothing for fields that are present.
- Given a ProseMirror table whose body cell holds a code fence and a notice, when it is serialized with `toCanonicalMarkdown` and parsed, then:
  - those blocks are nodes inside the table, positioned on their row's line, with paths through row, cell, and block;
  - `unsupported_markdown_structures` naming `code_block` and `notice` reports each one.

## Spec Change Log

### 2026-10-02 — Review loop 1 (bad_spec)

- **Triggering findings:**
  - **Edge Case Hunter, checkbox retyping (high).** Outline's checkbox rule retypes a metadata bullet list as `checkbox_list` in two cases: when any later checklist with at least two items appears at the same level, and when an item merely contains `[x] `. It also rewrites the item's inline `content`. The spec's field definition, "`list_item` of a `bullet_list`" read from inline content, therefore produced false `REQUIRED_METADATA_FIELD_MISSING` Errors on ordinary documents. Reproduced on serializer output.
  - **Edge Case Hunter, table cells (high).** The spec made `table` a leaf. Table cells hold blocks, which the serializer flattens with `<br>` and the parser rebuilds as nested `fence` and `container_notice` tokens with cell-relative maps. Configured unsupported or discouraged structures inside tables were therefore never reported, a false clean. Reproduced.
- **Amended:**
  - **Code Map:** added the checkbox-rule, links-rule, table-map, and serializer facts.
  - **Design Notes (Positions):**
    - unmapped blocks get `position: null`;
    - tables are no longer leaves, and nested nodes take their row's position;
    - added the source-prefix definition;
    - added list classification from source checkbox markers;
    - fields are read from source text, not inline `content`;
    - field parts use JS `trim()` whitespace;
    - Story 1.4 extends this adapter to yield positioned link tokens.
  - **Design Notes (Rule-kind catalog):** field names must not contain `:`.
  - **Tasks:**
    - deep-freeze both registries;
    - `not_evaluated` inputs require a zero-count scope;
    - the boundary scan is recursive and forbids `global`, `Intl`, `crypto`, `eval`, `Function`, `module`, `exports`, `localeCompare`, and `toLocale*`;
    - added the tests the review layers found missing.
  - **Acceptance Criteria:** corrected the AD-3 row count to 19, and added two serializer-produced regression criteria (checkbox retyping, table-cell structures).
- **Known-bad state avoided:**
  - false Errors for present metadata whenever a document also holds a checklist;
  - Findings silently missed inside tables;
  - a boundary check that misses `global.process`, `Intl`, and locale comparison;
  - mutable registries;
  - contradictory `not_evaluated` scopes.
- **KEEP:** the previous attempt passed 185 tests, `tsc`, `oxlint`, and `oxfmt`. Its unaffected parts must survive. A reference copy of every `server/wikiLint/**` file it produced is at `/tmp/claude-1000/-home-ezop-repos-outline/ee2c874b-48e7-41af-90fd-3337ec5427af/scratchpad/story-1-1-attempt-1-wikiLint.patch`. Apply it from the repo root with `git apply`; it creates only `server/wikiLint/**`. If the file is unavailable, re-derive from this spec. Keep:
  - **the module split and public names:**
    - `contracts.ts`: types, `kind` as the location discriminator, `WikiLintContractError`;
    - `registry.ts`: `ISSUE_REGISTRY` rows and messages, `RULE_REGISTRY`, `ruleConfigSchema`, `createFinding`/`createSystemFailure` with location normalization;
    - `ordering.ts`: `compareUtf8`, `comparePath`, `sortIssues`;
    - `result.ts`: `deriveResultState`, and `buildReadOnlyResult` with strict Zod re-validation and a fixed key order;
    - `documentRules.ts`: emit-callback isolation, per-kind ordinals, the seven evaluators, arithmetic `isIsoDate`;
  - **the TypeScript-AST allowlist boundary checker** and its synthetic-violation table;
  - **from the adapter:** the CR guard, the `Document.text` guard, nesting-based tree building, and `position: null` for unmapped blocks;
  - **every existing test,** except where this amendment changes the expected behavior. For example, `1. first\n\n- [ ] one\n- [ ] two` must now yield `ordered_list`, then `checkbox_list`.

## Review Triage Log

### 2026-10-02 — Review pass
- verdicts: 47 findings — high 2, medium 6, low 27, false 11, maybe-false 1
- findings:
  - `[false]` `[reject]` **Blind Hunter:** the adapter yields no link tokens that Story 1.4 needs. — Nothing breaks: this adapter is the single position component, and Story 1.4 extends it. That extension point is now noted in Design Notes.
  - `[low]` `[reject]` **Blind Hunter:** a nested block's column points at its container marker. — This is the spec-defined line-indent column, and `path` disambiguates the node. Skipping ancestor markers would mean re-deriving markdown-it indentation.
  - `[medium]` `[patch]` **Blind Hunter:** the boundary checker misses `global.process`, `Intl`, `localeCompare`, `crypto`, `eval`, and `Function`. — Moot under bad_spec; the fix is folded into the amended Tasks (`core/boundary.test.ts`).
  - `[low]` `[patch]` **Blind Hunter:** the boundary scan is top-level only and blocks core subdirectories. — Moot; folded in as a recursive scan with relative imports allowed inside `core/`.
  - `[low]` `[patch]` **Blind Hunter:** the builder does not tie scope counts to the algebra; a `not_evaluated` result accepts non-zero counts, and the failed fixture has count 1. — Moot; folded into the `result.ts` and `result.test.ts` Tasks.
  - `[low]` `[reject]` **Blind Hunter:** the builder lacks identity and disclosure cross-checks. — These guard against hypothetical shell bugs. Identity visibility is decided by the shells in 1.3 and 1.5, and the fix only adds guards.
  - `[false]` `[reject]` **Blind Hunter:** the sort key ignores `scopeKind`, so distinct issues tie. — AD-4 mandates the emission-order tie-break. Rule-local ordinals and per-(unit, code) uniqueness leave no reachable tie between distinct issues.
  - `[low]` `[reject]` **Blind Hunter:** `ordinal` and `sortCollectionId` are not validated. — The only producer, the evaluator, assigns integer ordinals; NaN is never passed. The fix would be guards only.
  - `[low]` `[reject]` **Blind Hunter:** `compareUtf8` misorders lone surrogates. — This needs invalid UTF-16, which IDs, codes, and paths never contain, and Story 1.2 rejects unpaired surrogates. The fix adds a surrogate branch.
  - `[low]` `[reject]` **Blind Hunter:** the spec says 20 AD-3 rows instead of 19. — The fix is a spec edit; the code and the 19-row literal deep-equal are right. The typo was corrected while amending.
  - `[low]` `[reject]` **Blind Hunter:** the `ReadOnlyResult` type does not encode the closed algebra. — The builder enforces it at runtime, and no criterion needs a type-level union.
  - `[maybe-false]` `[defer]` **Blind Hunter:** the adapter throws for a blank-start block, or for field content not found on its line, which fails the whole unit. — Moot under bad_spec this pass. Field reading is redesigned from source text. What would settle it: a canonical-Markdown input whose block token starts on a blank line. If true, medium.
  - `[false]` `[reject]` **Blind Hunter:** a CR in stored content permanently fails linting. — The spec's I/O matrix mandates the fail-closed throw. No path to a CR in stored ProseMirror text was shown: markdown-it and ProseMirror paste both normalize CR.
  - `[low]` `[reject]` **Blind Hunter:** fields parsed from raw source break on inline markup (`**Owner:**`, code spans, links). — The spec defines a plain-text field syntax that templates produce. Supporting markup needs inline source mapping.
  - `[low]` `[patch]` **Blind Hunter:** inconsistent trimming (NBSP) between the schema, headings, and fields. — Moot; folded into Design Notes (JS `trim()` for field parts).
  - `[low]` `[patch]` **Blind Hunter:** `RULE_REGISTRY` can be mutated at runtime. — Moot; folded in (deep-freeze both registries).
  - `[false]` `[reject]` **Blind Hunter:** conflicting rules are neither validated nor deferred. — An overlapping configuration yields well-defined, deterministic Findings, and AD-3 and AD-5 do not forbid overlap.
  - `[high]` `[bad_spec]` **Edge Case Hunter:** the checkbox rule retypes the metadata list, so fields are lost. — Reproduced (`* Owner: Alice` followed by a two-item checklist; `* Status: [x] done`). Amended Design Notes with list classification and source-text fields, plus a regression criterion.
  - `[low]` `[reject]` **Edge Case Hunter:** an attachment link in a field value makes the field vanish. — This needs a hand-made inline link to an attachment URL in a metadata value, and Outline's own parser drops that paragraph's text. Rare.
  - `[high]` `[bad_spec]` **Edge Case Hunter:** structures in table cells are never reported. — Reproduced: cell `fence` and `container_notice` tokens are rebuilt with cell-relative maps. Amended Design Notes (tables are not leaves; row positions) plus a regression criterion.
  - `[low]` `[reject]` **Edge Case Hunter:** a column sits on the container marker line. — Same as the Blind Hunter column finding: spec-defined column, with `path` disambiguating.
  - `[low]` `[reject]` **Edge Case Hunter:** a field name or value with markup, an emoji, or a mention. — Same as the Blind Hunter raw-source finding: spec-defined plain-text fields.
  - `[low]` `[patch]` **Edge Case Hunter:** NBSP around the colon. — Same root cause as the Blind Hunter trimming finding; folded in (JS `trim()` and JS-whitespace skip).
  - `[low]` `[reject]` **Edge Case Hunter:** heading text excludes emoji, mention, and math children. — Spec-defined (`text` and `code_inline` only) and deterministic. Operators configure plain headings, and the fix would add branches.
  - `[low]` `[patch]` **Edge Case Hunter:** the schema accepts a field name containing `:`. — Moot; folded into the rule-kind catalog (names must not contain `:`).
  - `[low]` `[reject]` **Edge Case Hunter:** an invalid `PolicyIdentity` can appear without a `POLICY_CONFIGURATION_INVALID` failure. — This guards a hypothetical shell bug; sentinel assembly belongs to the shells in 1.3 and 1.5. Guard only.
  - `[low]` `[patch]` **Edge Case Hunter:** a `not_evaluated` result with non-zero counts. — Same as the Blind Hunter counts finding; folded in.
  - `[low]` `[reject]` **Edge Case Hunter:** NaN or negative ordinals. — Same as the Blind Hunter sort-metadata finding: no producer passes them.
  - `[low]` `[reject]` **Edge Case Hunter:** a document-scope result with another document's issue. — Same as the Blind Hunter cross-check finding: a hypothetical caller bug, guard only.
  - `[low]` `[reject]` **Edge Case Hunter:** an empty `documentId` passed to `evaluateDocumentRules`. — `createFinding` already rejects empty identifiers. Caller bug only.
  - `[medium]` `[patch]` **Edge Case Hunter:** boundary checker bypasses. — Same as the Blind Hunter bypass finding; folded in.
  - `[low]` `[reject]` **Edge Case Hunter:** the spec says 20 rows, the registry has 19. — Same as the Blind Hunter row-count finding: a spec edit, now corrected while amending.
  - `[medium]` `[patch]` **Verification Gap:** no test of `toCanonicalMarkdown` with a document that has only `state`. — Moot; folded into the adapter test Task.
  - `[medium]` `[patch]` **Verification Gap:** no test that a collection-scope result accepts `wiki` and `lint_wiki` codes. — Moot; folded into the `result.test.ts` Task.
  - `[medium]` `[patch]` **Verification Gap:** the kind-to-code mapping is tested only as a set. — Moot; folded in (literal deep-equal).
  - `[medium]` `[patch]` **Verification Gap:** no test of the metadata section ending at a higher-level heading. — Moot; folded into the `documentRules.test.ts` Task.
  - `[low]` `[patch]` **Verification Gap:** no test that a field must come from the item's first paragraph. — Moot; folded into the adapter test Task.
  - `[false]` `[reject]` **Intent Alignment:** run bookkeeping is not finalized in the diff. — The workflow finalizes after review by design.
  - `[false]` `[reject]` **Intent Alignment:** the MCP tool surface is not exercised. — Story 1.1's criteria are core contracts; tool registration belongs to Stories 1.3 and 1.10.
  - `[low]` `[patch]` **Intent Alignment:** rule fixtures are hand-written rather than serializer output. — The adapter round-trip already proved code-point columns on serializer output. Moot; the new regression criteria require serializer-produced fixtures.
  - `[false]` `[reject]` **Intent Alignment:** the `sortCollectionId` derivation is not exercised. — AD-4 makes it server-derived input from the shell; the core consumes it.
  - `[false]` `[reject]` **Intent Alignment:** the configuration check works on object literals only. — Byte decoding is Story 1.2.
  - `[false]` `[reject]` **Intent Alignment:** message meaning is not compared, and `VALIDATION_RESOURCE_LIMIT_EXCEEDED` is limited only by scope kind. — FR-2 makes wording non-contractual. The phase restriction belongs to the 1.5 and 1.7 shells; the core enforces the scope-kind part.
  - `[low]` `[patch]` **Intent Alignment:** the boundary scan misses subdirectories. — Same as the Blind Hunter scan-scope finding; folded in.
  - `[false]` `[reject]` **Intent Alignment:** "clients must not drop Findings" is not exercised. — That is client behavior and cannot be tested in the core; failed results do retain Findings.
  - `[low]` `[reject]` **Intent Alignment:** the type allows `reason` in any state. — Same as the Blind Hunter algebra-type finding: the builder enforces it at runtime.
  - `[false]` `[reject]` **Intent Alignment:** AC-8 is checked by grep, not by a test. — The spec's Verification section defines the grep, and it passed with no matches.

### 2026-10-02 — Review pass
- verdicts: 42 findings — high 0, medium 7, low 23, false 11, maybe-false 1
- findings:
  - `[low]` `[reject]` **Blind Hunter:** a bullet item whose text *starts* with `[x] `/`[ ] ` keeps its list a `checkbox_list`, so the list's fields are lost. — The serializer leaves this unescaped, but Outline's own Markdown round trip turns such an item and its list into a checklist too (AD-18 round-trip principle), and the editor's input rules turn typed `[ ] ` into checkboxes. Rare, and the fix would change the spec's classification rule.
  - `[low]` `[reject]` **Blind Hunter:** a heading used as a toggle summary never counts as a section. — The spec deliberately defines a section as a root-level heading, and this is deterministic. An operator whose template uses toggle headings would see it at once. Section scoping inside toggles adds complexity. Recorded as a residual risk.
  - `[low]` `[reject]` **Blind Hunter:** an empty value satisfies a required field. — AD-3 defines the code as "field is absent". A label with an empty value is present, as the test pins. A `metadata_field_formats` rule rejects empty values.
  - `[medium]` `[defer]` **Blind Hunter:** repeated missing-section and missing-field Findings are byte-identical, so the agent cannot tell what to add. — AD-12 fixes the Finding keys, and NFR-11 non-disclosure keeps messages generic. This needs an architecture decision before the Story 1.10 repair-loop acceptance, so it is deferred.
  - `[low]` `[patch]` **Blind Hunter:** a `failed` result can carry non-zero counts or completed checks. — carried: same claim as the pass-1 counts-vs-algebra row. The code still checks counts only for `not_evaluated`. Not patched again.
  - `[false]` `[reject]` **Blind Hunter:** an empty evaluation can be `complete` and `clean`. — AD-11 mandates a zero-count `complete` result when no check is required, and choosing `not_evaluated` is the shell's decision under AD-12.
  - `[low]` `[reject]` **Blind Hunter:** more ways around the boundary check (`Math` aliasing or destructuring, `import.meta`, `__dirname`, `WeakRef`). — These are deliberate evasions rather than accidental dependencies on AC-7's forbidden categories; `process.env` and the other real paths are already caught. Detecting aliasing needs more than a direct correction.
  - `[low]` `[reject]` **Blind Hunter:** nothing forbids `.normalize()` or a `.sort()` without a comparator. — Every sort key in the core is an ASCII ID or code, where UTF-16 and UTF-8 order agree, and nothing calls `normalize`. A new check would be a guard only.
  - `[maybe-false]` `[defer]` **Blind Hunter:** the blank-line block throw is tracked nowhere and fails the whole document. — carried: same claim as the pass-1 blank-start row, and `canonicalSyntax.ts:74` still throws. Its pass-1 defer was moot under bad_spec and never reached frontmatter, so it is recorded in `deferred` now, once.
  - `[low]` `[reject]` **Blind Hunter:** the spec's KEEP note names an ephemeral scratchpad path that contains the home-directory name. — The fix would edit the append-only Spec Change Log. A committed artifact already holds such a path (`review-adversarial-update.md`). Auto Run Result notes the path is ephemeral.
  - `[low]` `[reject]` **Blind Hunter:** the portability check is a two-word grep. — Every UUID literal under `server/wikiLint` matches the synthetic `00000000-0000-4000-8000-…` pattern (verified by grep). A new scanning test is more than a direct correction.
  - `[low]` `[patch]` **Blind Hunter:** `epic-1-context.md` states NFR-4 as a p95 target. — Fixed: NFR-3 is now p95 ≤ 10 s at 150 documents, and NFR-4 is a hard limit of completing within 60 s at 1,000. Staleness detection uses the workflow's mtime rule by design.
  - `[low]` `[reject]` **Edge Case Hunter:** an invalid `PolicyIdentity` with no failure can come out `complete` and `clean`. — carried from pass 1 (low, reject: guards against a hypothetical shell bug).
  - `[false]` `[reject]` **Edge Case Hunter:** an evaluated result with `policies: []` can be complete. — AD-12 requires empty `policies` for a document-only reader while evaluation runs and completes, so this is a legitimate state.
  - `[low]` `[reject]` **Edge Case Hunter:** a foreign `documentId` in a document-scope result. — carried from pass 1 (low, reject).
  - `[low]` `[reject]` **Edge Case Hunter:** a policy outside the scope's collections. — carried from the pass-1 identity cross-check row (low, reject).
  - `[low]` `[patch]` **Edge Case Hunter:** a document-scope count above 1, or a `complete` result with empty checks. — carried: same counts-vs-algebra claim as pass 1. Not patched again. Empty checks are legitimate when no check is required (AD-11).
  - `[false]` `[reject]` **Edge Case Hunter:** a tie on `scopeKind` makes output follow input order. — carried from pass 1 (false: AD-4's emission-order tie-break).
  - `[false]` `[reject]` **Edge Case Hunter:** a `scope{scopeKind:"collection"}` location without `collectionId` is accepted. — AD-12 explicitly omits `collectionId` from collection-scope locations for actors without collection read.
  - `[low]` `[reject]` **Edge Case Hunter:** heading text ignores emoji, mention, and math children. — carried from pass 1 (low, reject).
  - `[low]` `[reject]` **Edge Case Hunter:** a metadata item starting with a checkbox marker keeps the list a checklist. — Same as the first Blind Hunter row: consistent with Outline's own round trip, and rare.
  - `[low]` `[reject]` **Edge Case Hunter:** fields written with inline marks. — carried from pass 1 (low, reject: plain-text field syntax).
  - `[low]` `[reject]` **Edge Case Hunter:** `toCanonicalMarkdown` lets untyped errors escape for malformed content or state. — No caller exists yet. AD-10 makes every snapshot-construction failure the generic runtime failure, which Story 1.3 maps from any error.
  - `[low]` `[reject]` **Edge Case Hunter:** with two matching metadata sections, the later one is ignored. — The spec defines the first match, now pinned by a test. Duplicate metadata sections are unusual, and the rule is deterministic.
  - `[low]` `[reject]` **Edge Case Hunter:** `Math` aliasing and `import.meta` slip past the boundary check. — Same as the Blind Hunter evasion row: deliberate evasion, not an AC-7 category.
  - `[false]` `[reject]` **Edge Case Hunter (claim):** shuffled inputs differ through a `scopeKind` tie. — carried from pass 1 (false). AC-4 itself breaks ties by emission order.
  - `[low]` `[reject]` **Edge Case Hunter (claim):** the Zod schemas behind the frozen registry stay mutable. — Exploiting this means deliberately tampering with Zod internals in-process. Freezing the schemas would break Zod's lazy initialization. The registry and its entries are frozen.
  - `[medium]` `[patch]` **Verification Gap:** `clean` is never asserted for a non-complete result with zero Errors. — Added a failed document-scope result built from a `VALIDATION_TIMEOUT` and a warning, asserting `clean: false`; mutation-checked.
  - `[medium]` `[patch]` **Verification Gap:** the forwarding of `sortCollectionId` through the result builder is unverified. — Added a fixture where collection order and document order disagree; mutation-checked.
  - `[medium]` `[patch]` **Verification Gap:** that `section_order` counts only root-level headings is unpinned. — Added a nested-heading case that must pass.
  - `[medium]` `[patch]` **Verification Gap:** metadata-section selection (level, first match) is unpinned. — Added a wrong-level case and a duplicate-section case; mutation-checked.
  - `[medium]` `[patch]` **Verification Gap:** several list constraints in the rule config are unpinned. — Added seven rejection rows (empty or duplicate lists, an untrimmed `one_of` value).
  - `[medium]` `[patch]` **Verification Gap:** `includeTitle: false` is never exercised with a real `Document`. — Added a `Document.build` case asserting no title line and equality with the ProseMirror-data output; mutation-checked.
  - `[false]` `[reject]` **Intent Alignment:** the diff is an uncommitted mid-workflow snapshot. — carried from pass 1 (false).
  - `[false]` `[reject]` **Intent Alignment:** the MCP runtime surface is unreachable. — carried from pass 1 (false).
  - `[low]` `[reject]` **Intent Alignment:** the TS interfaces allow `reason` in any state. — carried from pass 1 (low, reject).
  - `[false]` `[reject]` **Intent Alignment:** meaning exists only as `message`, and the resource-limit phase is restricted only by scope kind. — carried from pass 1 (false).
  - `[false]` `[reject]` **Intent Alignment:** the configuration check runs on JS literals only. — carried from pass 1 (false).
  - `[false]` `[reject]` **Intent Alignment:** `sortCollectionId` is caller input. — carried from pass 1 (false).
  - `[false]` `[reject]` **Intent Alignment:** "clients must not drop Findings" is untestable here. — carried from pass 1 (false).
  - `[low]` `[patch]` **Intent Alignment:** per-rule fixtures are hand-written Markdown. — carried from pass 1 (low). Its fold-in, the two serializer-produced regression criteria, is implemented. Not patched again.
  - `[low]` `[reject]` **Intent Alignment:** AC-8 relies on a grep that skips `_bmad-output`, which holds a scratchpad path with the username. — Same as the Blind Hunter scratchpad-path row: append-only change log, AC-8 covers code artifacts, and precedent exists.

### 2026-10-02 — Review pass
- verdicts: 35 findings — high 0, medium 3, low 24, false 8, maybe-false 0
- findings:
  - `[low]` `[patch]` **Blind Hunter:** scope counts and `completedChecks` are not tied to the algebra (a `failed` result with counts and checks, a document scope with count 42 or `incomplete`). — carried: same counts-vs-algebra claim as the pass-1 and pass-2 rows; `result.ts` still checks counts only for `not_evaluated`. Not patched again.
  - `[low]` `[reject]` **Blind Hunter:** an invalid `PolicyIdentity` without its System Failure yields a complete, clean result. — carried from pass 1 and pass 2 (low, reject: guards a hypothetical shell bug; sentinel assembly is pinned by the Story 1.3 and 1.5 criteria).
  - `[low]` `[reject]` **Blind Hunter:** config strings accept LF and CR, so such a rule can never be satisfied. — Verified: `"Sum\nmary"` parses, and heading text and single-line field parts never contain LF. Rejected: an operator must put a line break into a JSON heading string, the resulting Error is deterministic and visible at once, and the fix adds a schema constraint beyond the spec's "non-empty and trimmed".
  - `[low]` `[reject]` **Blind Hunter:** heading text drops emoji and mention children, so a decorated heading matches a plain one. — carried from pass 1 and pass 2 (low, reject: spec-defined `text` and `code_inline` only).
  - `[low]` `[reject]` **Blind Hunter:** `SOURCE_PREFIX` ignores Outline's alpha-list markers, so a checklist first in an alpha item becomes `bullet_list`. — Verified: `alphaLists` rewrites a line-start `a. `, and the spec-defined prefix does not strip it. Only a single-item checklist that is the first block of an alpha item is affected (later items sit on their own lines and keep the marker), and no Story 1.1 rule reads nested list kinds because fields are root-level only. Rejected: rare, and the fix changes the spec-defined source-prefix regex.
  - `[low]` `[reject]` **Blind Hunter:** no exported selector for document-structure rule kinds. — No caller exists yet, and `evaluateDocumentRules` throws on a non-structure kind, so a mis-filtering shell fails loudly. The fix adds public surface that Stories 1.3 and 1.4 can add when they need it.
  - `[low]` `[reject]` **Blind Hunter:** the bare `catch {}` discards the error class. — AD-10 maps every evaluation failure to the generic `VALIDATION_RUNTIME_FAILED`, so no consumer reads the class, and the core cannot log. Diagnostics only; the fix adds return-shape surface.
  - `[low]` `[reject]` **Blind Hunter:** nothing ties the structure enum to the node-kind map. — All seven closed values are mapped (`documentRules.ts:45-54`) and exercised by the structure tests. A new value needs a spec amendment, and compile-time exhaustiveness needs restructuring the map.
  - `[low]` `[patch]` **Blind Hunter:** the boundary scan reads only `.ts` files. — Verified at `boundary.test.ts:236`. Patched: the real-file scan now takes every non-test `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, and `.cjs` file; the filter was checked against sample names.
  - `[false]` `[reject]` **Blind Hunter:** `epic-1-context.md` drops sentinel obligations, omits DW-1/DW-2, mixes up `state` and `complete`, and misdescribes the operator routing. — Every listed sentinel obligation is in the story criteria later stories plan from (`epics.md:392`, `:536`, `:567`); line 28's `complete`, `clean` name the boolean keys; line 34 paraphrases `epics.md:883` ("escalated to the Wiki operator rather than repaired by the agent") and states the code is returned; deferred items live in the ledger, not in compiled planning context.
  - `[low]` `[reject]` **Edge Case Hunter:** a checklist inside an alpha-list item is re-typed `bullet_list`. — Same root cause as the Blind Hunter alpha-list row; rejected with it.
  - `[low]` `[reject]` **Edge Case Hunter:** an invalid `PolicyIdentity` without `POLICY_CONFIGURATION_INVALID` comes out complete and clean. — carried from pass 1 and pass 2 (low, reject).
  - `[false]` `[reject]` **Edge Case Hunter:** an evaluation with zero required units is complete and clean. — carried from pass 2 (false: AD-11 mandates a zero-count `complete` result when no check is required).
  - `[low]` `[reject]` **Edge Case Hunter:** a document-scope result accepts other documents' issues and foreign policies. — carried from pass 1 and pass 2 (low, reject: identity cross-checks guard a hypothetical shell bug).
  - `[false]` `[reject]` **Edge Case Hunter:** scope failures differing only in `scopeKind` keep emission order. — carried from pass 1 and pass 2 (false: AD-4's emission-order tie-break).
  - `[false]` `[reject]` **Edge Case Hunter:** a `scope{scopeKind:"collection"}` location without `collectionId` is accepted. — carried from pass 2 (false: AD-12 omits `collectionId` for actors without collection read).
  - `[low]` `[reject]` **Edge Case Hunter:** an invalid `documentId` turns the contract violation into `failedKinds`. — carried from pass 1 (low, reject: caller bug only).
  - `[low]` `[reject]` **Edge Case Hunter:** rules not parsed by `ruleConfigSchema` reach the evaluators and pass silently. — The parameter is typed `RuleConfig`, and the Story 1.2 loader, its only producer, parses through `ruleConfigSchema`. The fix guards a hypothetical caller bug.
  - `[low]` `[reject]` **Edge Case Hunter:** malformed ordinals and `sortCollectionId` values are accepted. — carried from pass 1 (low, reject).
  - `[low]` `[reject]` **Edge Case Hunter:** non-`doc` ProseMirror data escapes as `RangeError`. — carried from pass 2 (low, reject: untyped errors for malformed input; AD-10 maps any snapshot-construction error).
  - `[low]` `[reject]` **Edge Case Hunter:** `import.meta`, `__dirname`, `navigator`, and aliased `Math` slip past the boundary check. — carried from pass 2 (low, reject: deliberate evasion, not an AC-7 category).
  - `[low]` `[patch]` **Edge Case Hunter:** `.tsx`, `.mts`, `.cts`, and `.js` core files skip the boundary scan. — Same root cause as the Blind Hunter scan-extension row; patched with it.
  - `[false]` `[reject]` **Edge Case Hunter (claim):** shuffled inputs differ through a `scopeKind` tie. — carried from pass 2 (false).
  - `[low]` `[reject]` **Edge Case Hunter (claim):** the Zod schemas behind the frozen registry stay mutable. — carried from pass 2 (low, reject).
  - `[low]` `[patch]` **Edge Case Hunter (claim):** `discouraged_markdown_structures` has no valid case. — Verified: its fixtures all produce Findings, against the spec's "a valid and an invalid case per rule". Patched: added a zero-finding case with every structure configured.
  - `[medium]` `[patch]` **Verification Gap:** heading-text trimming is unpinned. — Added a serializer-produced fixture with a trailing and a leading `emoji` node, asserting the trimmed `text` and no `REQUIRED_SECTION_MISSING`; mutation-checked (removing `.trim()` fails it).
  - `[medium]` `[patch]` **Verification Gap:** the AD-4 rule that code sorts before ordinal is unpinned. — The `MARKDOWN_STRUCTURE_UNSUPPORTED` fixture item now carries ordinal 5; mutation-checked (swapping the comparator lines fails two tests).
  - `[medium]` `[patch]` **Verification Gap:** no test rejects extra keys inside `iso_date` and `one_of` entries. — Added two rejection rows; mutation-checked (`z.object` fails both).
  - `[false]` `[reject]` **Intent Alignment:** surfaces are enforced only by the result's scope kind. — carried from the pass-1 and pass-2 Intent rows (false: the phase restriction belongs to the 1.5 and 1.7 shells; the spec requires `wiki` and `lint_wiki` codes in both collection scopes).
  - `[low]` `[reject]` **Intent Alignment:** `completedChecks` is not cross-checked against the Findings' registry checks. — Verified: a `HIERARCHY_CYCLE` Finding builds with `completedChecks: ["documents"]`. Only the Story 1.5 and 1.6 shells assemble checks; the fix guards a hypothetical shell bug.
  - `[low]` `[reject]` **Intent Alignment:** `createFinding` accepts any line, column, and path. — True, but the adapter is the only position producer and `textLocation` copies it. Proving provenance needs branded types, more than a direct correction.
  - `[low]` `[patch]` **Intent Alignment:** the adapter departs from Outline's reading, and fixtures are hand-written Markdown. — carried from pass 1 and pass 2 (hand-written fixtures; the serializer-produced regression criteria are implemented). Not patched again. The departures are the pass-1 Design Notes amendment.
  - `[false]` `[reject]` **Intent Alignment:** the CR guard exists only in `parseCanonicalMarkdown`. — Every lint path parses `toCanonicalMarkdown` output through `parseCanonicalMarkdown`, so a CR in serializer output throws `CanonicalMarkdownError` as the matrix requires.
  - `[low]` `[patch]` **Intent Alignment:** evaluated `failed` results accept non-zero counts and completed checks. — carried: same counts-vs-algebra claim as pass 1 and pass 2. Not patched again.
  - `[false]` `[reject]` **Intent Alignment:** the working tree edits `sprint-status.yaml`, which the intent forbids. — Not part of the reviewed change: commit `95750eaf2` does not touch it, and the uncommitted edit is the orchestrator's bookkeeping.

## Design Notes

**Rule-kind catalog.** Each kind maps 1:1 to its AD-3 code, so severity derives from that code. A config entry is flat and strict: `{ "kind": ..., ...params }`.

String values are non-empty and trimmed (`s.trim() === s`). Lists are non-empty with unique entries. `level` is an integer from 1 to 6. A UUID is lowercase 8-4-4-4-12 hex. Metadata field names (`fields[]`, `fields[].name`) must not contain `:`.

| kind | code | params |
|---|---|---|
| `required_sections` | REQUIRED_SECTION_MISSING | `headingLevel`, `headings[]` |
| `section_order` | SECTION_ORDER_INVALID | `headingLevel`, `headings[]` (≥2) |
| `allowed_heading_levels` | HEADING_LEVEL_NOT_ALLOWED | `levels[]` |
| `required_metadata_fields` | REQUIRED_METADATA_FIELD_MISSING | `metadataSection{heading,headingLevel}`, `fields[]` |
| `metadata_field_formats` | METADATA_FIELD_FORMAT_INVALID | `metadataSection`, `fields[]` of `{name, format:"iso_date"}` or `{name, format:"one_of", values[]}` (unique names) |
| `unsupported_markdown_structures` | MARKDOWN_STRUCTURE_UNSUPPORTED | `structures[]` |
| `discouraged_markdown_structures` | DISCOURAGED_MARKDOWN_STRUCTURE | `structures[]` |
| `internal_links` | INTERNAL_LINK_TARGET_UNRESOLVED | none (evaluator in 1.4) |
| `parent_document_resolved` / `hierarchy_acyclic` / `published_documents_in_structure` / `parent_collection_consistent` | the four hierarchy codes | none (evaluators in 1.6) |
| `global_index_links` | GLOBAL_INDEX_LINK_MISSING | `surfaceDocumentId`, `globalIndexDocumentIds[]` (evaluator in 1.6) |

`structures` take the closed values below:

| Value | Tokens |
|---|---|
| `blockquote` | `blockquote_open` |
| `code_block` | `fence`, `code_block` |
| `horizontal_rule` | `hr` |
| `table` | `table_open` |
| `notice` | `container_notice_open` |
| `math_block` | `math_block` |
| `toggle_block` | `container_toggle_open` |

Inline structures are excluded because markdown-it inline tokens carry no positions.

**Positions.** The adapter computes every position as follows:

- **Lines:** split the exact string on `\n`; a block's `line` is `map[0] + 1`.
- **Block column:** the 1-based code-point column of the first non-space/tab character on that line.
- **Unmapped blocks:** a block the parser maps to nothing (e.g. `attachment`) gets `position: null`. A rule that needs such a position fails its kind; it is never fabricated.
- **Path:** zero-based child indices through the block tree. `inline` tokens are excluded.
- **Tables:** a table is *not* a leaf.
  - Its children are rows, row children are cells, and cell children are the cell's blocks.
  - The `table` node and each row (`tr`) use their own document `map`.
  - Every node inside a cell takes the line and column of its enclosing row, because its own map is null or cell-relative. That map is never read.
  - Inside tables, node kinds are taken from the parser as-is (no list reclassification), and no fields are read.
- **Source prefix:** for a source line, this is the longest prefix matching `^(?:[ \t]*(?:>[ \t]?|[-+*][ \t]+|[0-9]{1,9}[.)][ \t]+))*`: indentation plus blockquote and list markers. The *source text* of an item's first paragraph is its single line with that prefix removed and then JS-trimmed (columns are still computed against the raw line).
- **List classification (outside tables):** the parser's checkbox rule mis-types lists (Code Map), so the adapter corrects it from source.
  - A list the parser typed `checkbox_list` stays `checkbox_list` only if at least one direct item's first-paragraph source text starts with a checkbox marker (`/^\[(?:x|X|_|-|\s)\]\s/`).
  - Otherwise it becomes `bullet_list` (tag `ul`) or `ordered_list` (tag `ol`), and its items become `list_item`.
- **Heading text:** the concatenation of its `text` and `code_inline` children, trimmed. Matching is exact and case-sensitive.
- **Fields:** a field is a `list_item` of a `bullet_list` whose first child is a single-line paragraph whose source text contains `:`.
  - Fields are read from the **source text**, never from the inline token's `content`, which Outline's rules may rewrite.
  - The name is the part before the first `:`; the value is the part after it.
  - Both have backslash escapes of ASCII punctuation removed and are trimmed with JS `trim()`. This is the same whitespace definition the config schema uses.
  - `valuePosition` is the code-point column of the first source character after the colon and any following JS whitespace. For an empty value, it is the column just past the trimmed source text.
  - A paragraph that Outline's rules replaced (no paragraph child) yields no field.
- **Link tokens:** Story 1.4 extends this same adapter to yield positioned link tokens. No other component may compute positions.

**Semantics.**

- **Sections:** a section is a *root-level* heading. Required sections and required fields that are missing are emitted in configured order, at `document` locations.
- **`section_order`:** walk the matching headings with a running maximum rank. Any heading whose rank is below that maximum is out of order, located at the heading.
- **`allowed_heading_levels` and structure rules:** these check nodes at any depth, in pre-order.
- **Metadata scope:** the first root heading matching `metadataSection`, through the next root heading at that level or higher. Only fields of root-level bullet lists inside that scope count.
- **`iso_date`:** `^[0-9]{4}-[0-9]{2}-[0-9]{2}$` and a valid Gregorian date, checked arithmetically with no `Date`.
- **`one_of`:** an exact match against `values`.

**Why the adapter hosts positions.** AD-2 has the core receive "canonical syntax with safe locations". Outline's parser lives behind `@server/editor`, which transitively loads env and logging and is therefore barred from the core.

## Verification

**Commands:**
- `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint` -- expected: all wikiLint tests pass
- `corepack yarn tsc` -- expected: exit 0
- `node_modules/.bin/oxlint --type-aware server/wikiLint` -- expected: 0 errors
- `node_modules/.bin/oxfmt --check server/wikiLint` -- expected: no formatting differences
- `grep -rniE "laura|ezop" server/wikiLint` -- expected: no matches

## Auto Run Result

Status: done

**Summary.** This is a follow-up review pass over the Story 1.1 change committed as `95750eaf24d7b30866aef52595b8268424370346`. That change adds the pure, deterministic Wiki-lint core and its single position-producing adapter:

- the AD-4 and AD-12 contracts;
- the closed issue registry of the 19 AD-3 rows and the frozen 13-kind rule registry with strict Zod parameter schemas;
- AD-4 ordering in code-point order;
- the result algebra, derived and validated by `buildReadOnlyResult`;
- the seven document-structure evaluators, each kind isolated, with rule-local ordinals;
- the canonical Markdown adapter, which serializes with `includeTitle: false`, parses with Outline's `linkify: false` parser, corrects the checkbox rule's list mis-typing from source, descends into table cells, and reads metadata fields from source text;
- an AST allowlist test that enforces the core's import boundary.

This pass found no defect in production code. It closed five test gaps.

**Files changed in this pass** (tests only):
- `server/wikiLint/adapters/canonicalSyntax.test.ts` — serializer-produced headings with leading and trailing emoji pin heading-text trimming.
- `server/wikiLint/core/ordering.test.ts` — one fixture ordinal raised so the suite pins code-before-ordinal.
- `server/wikiLint/core/registry.test.ts` — two rows reject extra keys inside `iso_date` and `one_of` entries.
- `server/wikiLint/core/documentRules.test.ts` — a valid, zero-finding case for `discouraged_markdown_structures`.
- `server/wikiLint/core/boundary.test.ts` — the real-file scan covers every non-test script extension, not only `.ts`.
- This spec.

The files from the original change are unchanged: `contracts.ts`, `registry.ts`, `ordering.ts`, `result.ts`, `documentRules.ts`, `canonicalSyntax.ts`, their collocated tests, and `epic-1-context.md`.

**Review findings breakdown** (35 findings; medium 3, low 24, false 8):
- **Patches applied:** 3 medium entries (the three verification gaps) and 2 low entries (the boundary-scan extensions, from two layers; the missing discouraged-structure valid case). Each medium patch was mutation-checked.
- **Carried patch rows, not patched again:** the counts-vs-algebra claim (two layers) and the hand-written fixture claim.
- **Deferred:** none. The two existing `deferred` items are unchanged.
- **Rejected**, with reasons in the Review Triage Log:
  - newly verified low findings: LF in config strings; the alpha-list checklist re-typing (two layers; rare, no rule reads nested list kinds, and the fix changes a spec-defined regex); no exported structure-kind selector; the bare `catch`; the structure enum-to-map tie; unvalidated rules reaching the evaluators; uncross-checked `completedChecks`; unproven position provenance;
  - false: the `epic-1-context.md` wording claims; the CR guard placement; the `sprint-status.yaml` edit, which is orchestrator bookkeeping outside the reviewed change;
  - carried from passes 1 and 2 with their original verdicts: invalid-identity sentinels (two layers), heading text without emoji, zero-unit `complete`, foreign issues in a document scope, the `scopeKind` tie (two rows), collection scope without `collectionId`, invalid `documentId`, sort-key validation, untyped `toCanonicalMarkdown` errors, boundary evasions, mutable Zod internals, and surface enforcement by scope kind.

**Follow-up review recommendation: false.** This is a follow-up pass, and it patched no `high` entry. Patched counts: high 0, medium 3, low 2. Every patch is test-only.

**Verification performed** (final tree):
- `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint`: 6 files, 242/242 passed.
- `corepack yarn tsc`: exit 0.
- `node_modules/.bin/oxlint --type-aware server/wikiLint`: exit 0, no diagnostics.
- `node_modules/.bin/oxfmt --check server/wikiLint`: all 12 files correctly formatted.
- `grep -rniE "laura|ezop" server/wikiLint`: no matches.
- Mutation checks, each restored afterwards: removing the heading `.trim()` fails the new emoji test; swapping the code and ordinal comparator lines fails two ordering tests; loosening the field-format schemas to `z.object` fails both new rows.

**Residual risks:**
- The two open `deferred` items: the blank-line block throw (DW-1), and indistinguishable missing-item Findings (DW-2), which need an AD-12 decision before the Story 1.10 repair-loop acceptance.
- The builder still does not tie scope counts and `completedChecks` to `failed` or document scopes. This has been logged as a carried low patch since pass 1 and was never applied, so Stories 1.3 and 1.5 must assemble those values correctly themselves.
- The spec-defined source prefix does not recognize alpha-list markers. A single-item checklist that opens an alpha-list item is re-typed `bullet_list`. No current rule reads that kind.
