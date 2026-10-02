---
title: 'Story 1.4: Validate Internal Links Without Disclosing Protected Targets'
type: 'feature'
created: '2026-10-02'
status: 'done'
baseline_revision: '13064d5410140c4fb3de66593859fe300665fea1'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** `lint_document` cannot evaluate the `internal_links` rule kind. Since Story 1.3, any policy that enables it fails the document unit with `VALIDATION_RUNTIME_FAILED`. No shared link-extraction function exists yet, and the position-producing component yields no link tokens. An agent therefore cannot learn which internal links are broken. That answer must come without revealing whether an inaccessible target exists.

**Approach:**
- Extend the Story 1.1 position-producing adapter so it also yields every link token in document order: the normalized `href`, plus the exact position of the first character of the link's source syntax, or `null` when that position cannot be proven.
- Add one pure core function that classifies those links into lookup keys (D-9 forms L1–L11) against an instance origin that the shell supplies.
- Resolve the unique keys inside the existing `REPEATABLE READ` snapshot, through the baseline's membership-aware `findByPk` scope plus `can(actor, "read", …)`, in batches of at most 500. The outcome collapses to `resolved | unresolved`.
- Run the `internal_links` kind inside the shared document unit, so `lint_document` can complete.

## Boundaries & Constraints

**Always:**
- Single extraction function: `extractInternalLinks` in `server/wikiLint/core/internalLinks.ts` is the only link classifier and form list. It reuses the baseline `isUUID` (`validator/lib/isUUID`) and `UrlHelper.SLUG_URL_REGEX` (`@shared/utils/UrlHelper`). The core boundary allowlist admits exactly these two specifiers; both modules are import-free or pure.
- The instance origin is evaluation input: production passes `env.URL`, which the tool reads. Tests pass the generic `https://wiki.example.test`.
- Classification follows AC2 of the story exactly. `isUUID` is tested before `SLUG_URL_REGEX`, UUID keys are lowercased, and urlId keys keep their case. A `/doc/` or `/d/` path is read from the parsed, dot-segment-normalized `pathname` without decoding.
- Missing, deleted, and inaccessible targets all become `"unresolved"` in the adapter, before anything reaches the core. A Finding carries only `code`, `severity`, `message`, and the source document's `text` location: no target ID, urlId, title, collection, or existence state.
- Positions are copied from the adapter, never recomputed by rules. A position that cannot be proven is `null`, never guessed (AD-4).
- Link positions come from a dedicated tokenizer built exactly as `@server/editor`'s `parser.tokenizer` is: `makeRules({ schema, plugins: [...extensionManager.rulePlugins, mentionRules] })`. The only addition is an observer plugin that records link start offsets and never changes tokens.
- Target resolution and every batch run inside the `readDocumentSnapshot` transaction (`REPEATABLE READ`, explicit `SET TRANSACTION READ ONLY`, primary pool). Before each batch, `boundBatch` issues the `SET LOCAL` timeouts. Batches run sequentially in sorted key order.
- `evaluatedLinkCount` is the number of recognized references in the completed unit when `internal_links` is enabled, and 0 otherwise.

**Never:**
- Out of scope:
  - registering or exposing tools (1.10);
  - `lint_wiki`, its 100,000-reference limit, and the global-index check (1.5–1.7) — they reuse `extractInternalLinks` later;
  - enforced writes (Epic 2);
  - audit (1.8);
  - anchor (`#fragment`) validation.
- No edits to `server/editor/**`, `shared/editor/**`, `server/routes/mcp/**`, or `sprint-status.yaml`. Never mutate the shared `parser` instance.
- No replica, cache, unscoped lookup, network request, or `Document.text` read. No database access from the core.
- Never look up a UUID-form reference as a urlId.

## I/O & Edge-Case Matrix

L1–L11 classification is pinned by AC2 of the story and by the core fixtures. `docScope` = `{ scopeKind: "document", documentId }`; "+cid" means `collectionId` is present only for a collection-readable actor.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| `internal_links` not enabled | structure kinds only | no extraction or target query; `evaluatedLinkCount: 0` | — |
| All targets resolve | readable UUID or urlId targets, including an uppercase UUID, a draft or archived target the actor can read, and a target readable only through document membership | `complete`, no link Finding, `evaluatedLinkCount` = recognized occurrences | — |
| Unresolved target | a missing UUID or urlId, a deleted target, or a target in a collection the actor cannot read | one `INTERNAL_LINK_TARGET_UNRESOLVED` (`error`) per occurrence at the `[` or `<` of its source; byte-identical shape for every cause | — |
| Unrecognized destination | L8–L11, the `]`-label mention, or the `@`-preceded link | no lookup, no Finding, not counted | — |
| Unresolved occurrence without a provable position | such as a link inside a notice inside a table cell | `failed`; other kinds' Findings kept; exactly one `VALIDATION_RUNTIME_FAILED` at `docScope` (+cid); counts 0 | — |
| Link batch refused or timed out | remainder below the floor before a link batch, a PG 57014 or 55P03 error, or expiry | `failed`, no Findings, zero counts, `VALIDATION_TIMEOUT` at `docScope` (never +cid) | — |
| Link batch query error | any other snapshot error | the same, with `VALIDATION_RUNTIME_FAILED` | — |

</intent-contract>

## Code Map

- `server/wikiLint/adapters/canonicalSyntax.ts:201` -- `parseCanonicalMarkdown`, the single position producer (block tree only). It uses `parser.tokenizer` and the original LF lines.
  - Its `inline` branch reads only heading text; link collection goes there.
  - `OpenBlock.row` marks blocks below a table row.
- `server/editor/index.ts:33-44` -- exports `extensionManager` and `schema`.
  - `parser = extensionManager.parser({ schema, plugins: [...rulePlugins, mentionRules] })`.
  - `ExtensionManager.parser` (`shared/editor/lib/ExtensionManager.ts:151`) calls `makeRules({ rules, schema, plugins })` from `shared/editor/lib/markdown/rules.ts`, with `linkify: false`.
- Probed token facts (`markdown-it` 14.3.0, Outline rules):
  - Core order: `alpha_lists_preprocess`, `normalize`, `block`, `alpha_lists_postprocess`, `inline`, `tables-pm`, `checkboxes`, `breaks`, `attachments`, `hardbreaks`, `mention`, `mention_type`, …
  - Inline chain starts with `text`; only `link` (`[`) and `autolink` (`<`) push `link_open`.
  - Positions of rewritten source:
    - `alpha_lists_preprocess` rewrites `^\s*[a-zA-Z]\.\s+` line prefixes in `state.src`, so lengths can change.
    - The core inline rule parses `tok.content` into the array `tok.children`, so the StateInline `state.tokens === tok.children`.
    - Table cell inline tokens have `map: null`. Their content is `cell.trim()` with each `\|` reduced to `|`. The `tr_open` token carries the row line.
  - Token rewrites after inline parsing:
    - `tables-pm` re-parses fenced cells through `md.parse(…, env)` with the same env.
    - `breaks` and `tables-pm` re-wrap children into new tokens with `map: null`.
    - `checkboxes` rewrites `content` after inline parsing.
  - Mentions:
    - `mention` turns `@` + link into a `mention` token, with no `link_open`.
    - A document mention serializes as `[label](/doc/<id>[#anchor])` with an unescaped label. The label `a]b` yields text, not a link.
    - Text `@` before a link mark serializes as `@[lbl](https://…)`, which parses as a mention.
  - Tables serialize with padded cells (`| a   | b   |\n|-----|-----|`).
- `server/wikiLint/core/boundary.test.ts:53` -- `isAllowedImport` (`zod` plus relative imports only); extend it with the two baseline helpers.
- `server/wikiLint/core/contracts.ts:180-212` -- `SyntaxPosition` and `CanonicalSyntax` (add `links`).
- `server/wikiLint/core/registry.ts` -- `INTERNAL_LINK_TARGET_UNRESOLVED` (text, `document` surface, `documents` check); `createFinding`; `RULE_REGISTRY.internal_links`.
- `server/wikiLint/core/documentRules.ts:325` -- `evaluateDocumentRules`, which throws for any non-structure kind; `textLocation` throws on a null position (the kind then fails, keeping its earlier Findings).
- `server/wikiLint/adapters/documentReader.ts:183` -- `readDocumentSnapshot`: the re-read and `toCanonicalMarkdown` in a `REPEATABLE READ` read-only transaction, plus the `boundBatch` and `readOnlyTransaction` helpers.
- `server/models/Document.ts:907` -- `findByPk`: scopes `withDrafts`, `withoutContent`, and `{ method: ["withMembership", userId, paranoid] }`; UUID keys go to `where: { id }`, slug keys to `urlId: match[1]`. `urlId` has only a non-unique index.
- `server/wikiLint/application/lintDocument.ts:281-327` -- the Story 1.3 `hasInternalLinks` fail branch, which this story replaces; also `LintDocumentReader`, `LintDocumentDependencies`, and the `documentScope` helper (link count fixed at 0).
- `server/tools/wikiLint.ts` -- `lintDocumentTool`, which resolves dependency defaults.
- Tests:
  - `server/wikiLint/application/lintDocument.test.ts` -- a fake reader returning a Markdown string;
  - `server/tools/wikiLint.test.ts` -- an in-test `McpServer`, `policySetFor`, `connect(user, policySet, dependencies)`, and factories;
  - `server/test/factories.ts` -- `buildDocument`, `buildCollection` (`permission: null` = private), `buildUser`, and `buildTeam`.
- DB tests: per memory `local-test-postgres`, a scratch PostgreSQL 14 at `127.0.0.1:5432/outline-test`, migrated.

## Tasks & Acceptance

**Execution:**
- `server/wikiLint/core/contracts.ts`:
  - Add `SyntaxLink { href: string; position: SyntaxPosition | null }`; `CanonicalSyntax.links: SyntaxLink[]` lists them in document order.
  - Add `InternalLinkReference { key: string; keyKind: "id" | "urlId"; position: SyntaxPosition | null }`, `LinkTargetState = "resolved" | "unresolved"`, and `ResolvedLinks { references: InternalLinkReference[]; targets: ReadonlyMap<string, LinkTargetState> }`.
- `server/wikiLint/core/internalLinks.ts` (new):
  - `extractInternalLinks(links, instanceOrigin)`. It parses the origin with `new URL` and throws `WikiLintContractError` if that fails; it never throws for a link.
  - `LINK_LOOKUP_BATCH_SIZE = 500`.
  - `linkLookupBatches(references)`: the unique `{ key, keyKind }` values, sorted bytewise and chunked at 500.
- `server/wikiLint/core/documentRules.ts`:
  - Accept `internal_links` alongside the structure kinds.
  - Add the optional input `links?: ResolvedLinks`.
  - The rule emits one Finding at `textLocation(ref.position)` per unresolved reference, in order. A key missing from `targets`, or absent `links`, throws `WikiLintContractError`, which fails the kind.
- `server/wikiLint/adapters/lintTokenizer.ts` (new):
  - The dedicated tokenizer plus the observer plugin (Design Notes).
  - It exports `tokenizeCanonicalMarkdown(markdown)` → `{ tokens, linkPosition(linkOpen, path) }`.
- `server/wikiLint/adapters/canonicalSyntax.ts`:
  - `parseCanonicalMarkdown` uses `tokenizeCanonicalMarkdown`.
  - For each direct `link_open` child of an inline token, it appends `{ href, position }` with the enclosing block's path. Image and mention children are skipped.
- `server/wikiLint/adapters/documentReader.ts`:
  - `readDocumentSnapshot({ documentId, collectionId, deadline, actor, instanceOrigin? })` → `DocumentSnapshot { syntax, links: ResolvedLinks | null }`. It parses inside the transaction. With `instanceOrigin`, it extracts and resolves the links before commit.
  - Export `resolveLinkTargets({ batches, actor, transaction, deadline })`. For each batch: `boundBatch`, then one `Document.scope(["withDrafts", "withoutContent", { method: ["withMembership", actor.id] }]).findAll` with `Op.or` over the non-empty `id` and `urlId` lists. A key is `resolved` iff a returned row with that `id` or `urlId` passes `can(actor, "read", row)`.
- `server/wikiLint/application/lintDocument.ts`:
  - `instanceOrigin` input and dependency; the reader seam gets the new signature.
  - Pass `instanceOrigin` only when `internal_links` is enabled.
  - Classify the snapshot error: `CanonicalMarkdownError` → `VALIDATION_RUNTIME_FAILED` first, then the Story 1.3 timeout rules.
  - Evaluate with `links`, remove the fail branch, and set `evaluatedLinkCount`.
- `server/tools/wikiLint.ts` -- `instanceOrigin: dependencies.instanceOrigin ?? env.URL`.
- `server/wikiLint/core/boundary.test.ts`:
  - Allow exactly `validator/lib/isUUID` and `@shared/utils/UrlHelper`.
  - Add reject cases for `validator`, `@shared/utils/urls`, and `@shared/utils/UrlHelper/x`.
  - Assert that `shared/utils/UrlHelper.ts` has no imports.
- Collocated tests:
  - `core/internalLinks.test.ts`:
    - the L1–L11 table over `SyntaxLink` inputs;
    - end-to-end canonical-Markdown fixtures through `parseCanonicalMarkdown`, including the `]`-label mention and the `@`-preceded link, both serialized by `toCanonicalMarkdown` from ProseMirror JSON;
    - batching (1,001 keys gives 3 sorted batches; duplicates collapse).
  - `core/documentRules.test.ts` -- the link rule: ordinals, a null position failing only its kind, and a missing target state.
  - `adapters/canonicalSyntax.test.ts`:
    - position fixtures (AC below);
    - parity: the lint tokenizer's token stream equals `parser.tokenizer.parse` (type, tag, map, content, markup, attrs except mention `id` and `modelId`, children) on a mixed corpus.
  - `adapters/documentReader.test.ts` (DB):
    - resolution states;
    - batch statement sequence;
    - the floor before a link batch.
  - `application/lintDocument.test.ts`:
    - the fake reader returns a `DocumentSnapshot`;
    - the matrix rows;
    - `Map` insertion order reversed gives byte-equal output.
  - `server/tools/wikiLint.test.ts` -- the multi-actor and integrated acceptance criteria.

**Acceptance Criteria:**
- Given the core fixture table with origin `https://wiki.example.test`, when `extractInternalLinks` runs, then:
  - L1–L7 yield exactly the listed key and kind, with uppercase UUIDs lowercased;
  - L8–L11, the `]`-label mention, and the `@`-preceded link yield nothing.
- Given canonical Markdown fixtures, when they are parsed, then each link's `{ line, column }` is pinned at its `[` or `<`, for a link:
  - in a paragraph after astral text (code-point column);
  - on a soft line or hard-break line;
  - in a heading with a closing `#`;
  - in a blockquote's second line;
  - in a list item and in a checkbox item;
  - in a notice;
  - in duplicate and escaped-pipe table cells;
  - in an autolink;
  - on an alpha-list line whose length changed.

  And a link inside a notice inside a table cell has `position: null`.
- Given a reader actor and a protected-target-blind actor linting the same source in a readable collection, when each calls the in-test `lint_document`, then:
  - both see the same `evaluatedLinkCount`;
  - the blind actor's Findings for the protected target, a missing UUID, and a deleted document all have the same code, severity, and message, at their source positions;
  - two sources differing only by a protected-target UUID versus a never-existing UUID give byte-identical results after document-ID substitution;
  - no serialized result contains the protected target's ID, urlId, title, or collection ID.
- Given one target referenced by UUID, by uppercase UUID, by slug-prefixed urlId, and twice repeated, when it is linted, then every occurrence is counted, an unresolved target reports each occurrence, and results are byte-equal across two runs.
- Given 501 unique unresolvable UUIDs, when the snapshot resolves them, then:
  - the `sequelize.query` spy shows two target SELECTs, each preceded by its `SET LOCAL` pair, holding 500 and 1 sorted keys, between `READ ONLY` and `COMMIT`;
  - no `INSERT`, `UPDATE`, or `DELETE` statement appears.
- Given a document whose urlId equals a linked UUID's last group, when it is linted, then the UUID reference is unresolved.
- Given a valid policy with structure kinds plus `internal_links`, when `lint_document` runs, then the result is `complete`, carrying the structure and link Findings in AD-4 order with `evaluatedDocumentCount: 1` (the Story 1.3 AC4/AC5 integrated fixture).

## Spec Change Log

## Review Triage Log

### 2026-10-02 — Review pass
- verdicts: 26 findings — high 0, medium 1, low 16, false 9, maybe-false 0
- findings:
  - `[low]` `[patch]` **Blind Hunter:** no resolution test covers a target that is readable only through a group. — Patched: the adapter resolution test adds a document readable through a document `GroupMembership` and one in a private collection readable through a collection group membership. Both resolve with no code change.
  - `[low]` `[patch]` **Blind Hunter:** `resolveLinkTargets` has no team predicate, so it loads other tenants' rows and their membership includes, only for `can()` to drop them. — Patched: `teamId: actor.teamId` is ANDed with the `Op.or`, as in baseline `Document.findByIds`. The result is unchanged, because `read` requires the same team. The 501-key test asserts the predicate in both SELECTs.
  - `[low]` `[patch]` **Blind Hunter:** the `resolveLinkTargets` docstring says "queried once", and the statement sequence when rows exist is untested. — Patched: the docstring now says one membership-aware `findAll` per batch, whose `separate` membership includes may add statements. The test part needs no new adapter test: those statements inherit the transaction, as Story 1.3 pinned, and the strengthened tool test shows the target SELECT inside the read-only snapshot.
  - `[low]` `[reject]` **Blind Hunter:** links that the baseline parse drops are never validated. Examples are a table-cell checkbox label (`tables-pm`) and a paragraph spliced out by `attachments`. — Real, but AC1 defines extraction over the link tokens of the baseline parse, as with the pinned `@` case. Such documents are rare, and recovering the links needs an extraction source other than the mandated one.
  - `[false]` `[reject]` **Blind Hunter:** the application link-batch failure tests duplicate the snapshot tests, and no database test times out a link SELECT. — AD-10 places target resolution inside snapshot construction, so a link-batch failure and a re-read failure are the same outcome by design, and a test has nothing to tell apart. Real 57014/55P03 errors reach the same `isDatabaseTimeout` catch that Story 1.3's lock test pins. The floor refusal of a link batch is tested against the database.
  - `[low]` `[patch]` **Blind Hunter:** AC10's non-ASCII case has no integration test. — Grouped with Intent Alignment AC10. Patched: a tool-level fixture asserts an unresolved link after `ż😀 ` (code, severity, code-point column 4, count), together with the L6, L9, L10, and L11 forms.
  - `[low]` `[reject]` **Blind Hunter:** tokenizer drift is guarded only by a fixed corpus. — Developers are unlikely to meet this: drift needs an edit to `server/editor/index.ts`, which the fork forbids outside a reviewed backport, and plugins added through extensions flow in automatically. Comparing rule chains would need a new export of the private tokenizer instance.
  - `[low]` `[patch]` **Blind Hunter:** the target map is keyed by the bare key while deduplication uses kind plus key, and the invariant is undocumented. — Patched: the `ResolvedLinks.targets` doc states the invariant. A lowercased UUID contains `-`, and a `SLUG_URL_REGEX` capture never does.
  - `[low]` `[reject]` **Blind Hunter:** plain text can become a link token through an unescaped `<url>` autolink or a reference definition. — Real, because the baseline `esc` escapes neither. The canonical parse then reads a link, which is the surface AC1 and AC2 define. Such text is rare, and suppressing it means departing from the baseline parse.
  - `[false]` `[reject]` **Blind Hunter:** `/doc/some-title-<uuid>` is looked up as a urlId. — AC2 mandates exactly this order: only a value that fails `isUUID` is matched against `SLUG_URL_REGEX`, and baseline `Document.findByPk` resolves the identical string the same way. The spec's "UUID-form reference" means a segment that passes `isUUID`.
  - `[low]` `[patch]` **Blind Hunter:** the "mutates nothing while resolving links" test passes vacuously if the spy captured nothing. — Patched: it now asserts a SELECT carrying the linked target's id, issued after `SET TRANSACTION READ ONLY` and before `COMMIT`.
  - `[false]` `[reject]` **Edge Case Hunter:** a team served on a custom domain or subdomain has its absolute links skipped. — AC1 mandates the configured instance origin, restating baseline `isInternalUrl`, which compares only against `env.URL` (`shared/utils/urls.ts:48-50`). Team URLs are outside the baseline rule.
  - `[medium]` `[patch]` **Edge Case Hunter:** position computation is quadratic. — Measured: 8,000 links on one 300 KB line took 8.6 s, against 17 ms for the base parse, blocking the event loop inside the snapshot transaction. Patched: a per-call memo of source newline and pipe offsets, segment starts, common suffixes, and surrogate-pair positions makes it linear. 8,000 links on one ~480 KB line now position in 69 ms in a new test, and every earlier position fixture is unchanged.
  - `[low]` `[reject]` **Edge Case Hunter:** a batch that returns rows runs the extra `separate` membership SELECTs, each with the full remainder. — Real, and the same as Story 1.3's rejected multi-statement row. It needs a database slow enough for consecutive statements to stall, the outcome stays fail-closed, and the fix needs per-statement hooks into Sequelize includes.
  - `[low]` `[reject]` **Edge Case Hunter:** an error from parsing or extraction other than `CanonicalMarkdownError` after expiry is classified `VALIDATION_TIMEOUT`. — Grouped with Intent Alignment behaviour change 1. Story 1.3 AC3 assigns expiry during construction to `VALIDATION_TIMEOUT`, and the case needs a parser bug or invalid origin that coincides with expiry. Separating serialization from parse failures adds an error class.
  - `[false]` `[reject]` **Intent Alignment (AC1):** only `lint_document` is wired, of four surfaces. — The other three surfaces belong to later stories (1.5, 1.6, 2.3). The project convention verifies a cross-story AC when the later story lands, and the single shared function exists.
  - `[low]` `[patch]` **Intent Alignment (AC2):** the L1–L11 table feeds raw hrefs instead of canonical Markdown. — Patched: every row also runs as serializer-escaped `[x](<href>)` through `parseCanonicalMarkdown` and `extractInternalLinks`, with the same classification and one link token each (43 cases).
  - `[false]` `[reject]` **Intent Alignment (AC3):** there is no 100,000-reference limit. — It governs `lint_wiki` (AD-16, Stories 1.5 and 1.7). The count it uses is the `extractInternalLinks` output.
  - `[false]` `[reject]` **Intent Alignment (AC4):** link resolution inside the enforced-write transaction is absent. — The AC assigns it to Story 2.3.
  - `[low]` `[patch]` **Intent Alignment (AC8):** the System Failure channel has no multi-actor fixture. — Patched: with the link in a notice in a table cell (null position), the blind actor gets byte-identical `failed` results for a protected and a never-existing target, and the reader gets `complete`. This diff adds no logging, so there is no diagnostics channel to exercise.
  - `[false]` `[reject]` **Intent Alignment (AC9):** database return order is never varied. — Output is built from references in document order by keyed lookup. Database row order only fills the `readableIds` and `readableUrlIds` Sets, whose iteration order is never read.
  - `[low]` `[patch]` **Intent Alignment (AC10):** the L6, L9, L10, L11, and non-ASCII cases have no end-to-end assertions. — Grouped with Blind Hunter AC10; patched by the same fixture.
  - `[false]` `[reject]` **Intent Alignment:** tests use an in-test MCP server rather than `/mcp`. — Story 1.3 AC1 keeps discovery disabled until Story 1.10. The production route is asserted not to list the tool.
  - `[low]` `[reject]` **Intent Alignment (behaviour change 1):** a `CanonicalMarkdownError` raised by serialization after expiry is now `VALIDATION_RUNTIME_FAILED`; under Story 1.3 it was `VALIDATION_TIMEOUT`. — Grouped with the Edge Case Hunter classification row. Only a contentless document coinciding with expiry hits it, and both codes are generic failed outcomes.
  - `[false]` `[reject]` **Intent Alignment (behaviour change 2):** a failed link batch discards the structure Findings. — AD-10 places target resolution in snapshot construction, and AD-11 makes a snapshot failure return no Findings. Rule kinds run only after commit, so no structure Finding exists yet.
  - `[low]` `[reject]` **Intent Alignment (behaviour change 3):** a broken link in a notice in a table cell gets no Finding of its own. — AD-4 forbids fabricating its position, so the kind fails closed with a System Failure rather than reporting clean. The case is rare, and exact positions for re-parsed cell content are far more than a direct correction.

## Design Notes

**Observer plugin.** The tokenizer's env carries a private `wikiLintLinkSources` record. The plugin adds four rules, none of which changes a token.

1. A core rule after `normalize` records the outer `StateCore` and the processed `state.src`. It records them only when unset, so the nested `tables-pm` parse cannot overwrite them.
2. A core rule before `inline` runs only for the outer state. For every inline token, it maps `tok.children` (the array) to its source:
   - `{ lines: map, content }` when `map` is set;
   - `{ cell: rowLine, start, content }` for a `map: null` cell, aligned left to right per row. From a cursor, `start = processedLine.indexOf(content.replaceAll("|", "\\|"), cursor)`. Once a cell fails to align, the rest of that row stays unaligned.
3. An inline rule before `text`, non-silent only, first attributes any `link_open` pushed since this `StateInline`'s previous call to that call's `state.pos`. It then records `{ pos, tokens.length }` for the next call. A window holding more than one `link_open` is left unattributed.
4. A `ruler2` rule before `balance_pairs` flushes the last window.

**Position.** The plugin turns a recorded offset into a processed line and offset:
- a `lines` source finds its content line with `processedLine.indexOf(segment)`;
- a `cell` source uses `start + offset + |-count before offset`.

The processed offset then maps to the original line: by identity when the two lines have equal length, and otherwise through their common suffix. The plugin verifies that the original character is `[` or `<`. Every failure yields `null`.

The first occurrence is exact because a segment holding the link's `[` or `<` cannot start in line prefixes or tails (indentation, `>`, list markers, `#`, `|`) by periodicity. Moving the cursor left to right covers duplicate cells.

**Resolution.** The resolution predicate is the one `authorizeLintTarget` applies to the lint target, so drafts, archived documents, and documents readable only through document membership resolve. A urlId key is resolved if any readable row matches, which keeps it deterministic.

**Cross-story.** The `lint_wiki` document unit (1.5), the global-index check (1.6), and enforced writes (2.3) must call `extractInternalLinks` and `resolveLinkTargets` (or the write-transaction equivalent). They must not add a parser.

## Verification

**Commands:**
- `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint server/tools/wikiLint.test.ts` -- expected: all pass (migrated test Postgres)
- `TZ=UTC node_modules/.bin/vitest run --project server server/tools server/routes/mcp` -- expected: baseline MCP tests unaffected
- `corepack yarn tsc` -- expected: exit 0
- `node_modules/.bin/oxlint --type-aware server/wikiLint server/tools/wikiLint.ts server/tools/wikiLint.test.ts` -- expected: 0 errors
- `node_modules/.bin/oxfmt --check server/wikiLint server/tools/wikiLint.ts server/tools/wikiLint.test.ts` -- expected: clean
- `grep -rniE "laura|ezop" server/wikiLint server/tools/wikiLint*.ts` -- expected: no matches

## Auto Run Result

Status: done

**Summary.** Story 1.4 makes `lint_document` evaluate the `internal_links` rule kind instead of failing the unit.
- The position-producing adapter now also yields every link token in document order, with its normalized `href`.
  - The position is the first character of the link's source syntax: the `[` or `<` that begins it.
  - When that position cannot be proven, it is `null`.
  - Positions come from a dedicated tokenizer, built exactly like the server parser's, plus a non-mutating observer plugin. Computing them is linear in the size of the document.
- One pure core function, `extractInternalLinks`, classifies those links into lookup keys for D-9 forms L1–L11, against an instance origin that the shell supplies.
  - It reuses the baseline `isUUID` and `UrlHelper.SLUG_URL_REGEX`.
  - Those two modules are now the only non-relative imports the core boundary allows, besides `zod`.
- The unique keys resolve inside the existing `REPEATABLE READ` read-only snapshot:
  - in sorted batches of at most 500, each bounded by `SET LOCAL`;
  - through the baseline membership-aware scope within the actor's team, followed by `can(actor, "read", …)`.

  The result collapses to `resolved` or `unresolved`.
- The rule emits one `INTERNAL_LINK_TARGET_UNRESOLVED` per unresolved occurrence, at its source position. `evaluatedLinkCount` counts recognized occurrences.

**Files changed:**
- `server/wikiLint/core/internalLinks.ts` (new) — `extractInternalLinks`, `LINK_LOOKUP_BATCH_SIZE`, and `linkLookupBatches`.
- `server/wikiLint/adapters/lintTokenizer.ts` (new) — the lint tokenizer, the link-start observer plugin, and linear position mapping (processed to original lines, code-point columns).
- `server/wikiLint/core/contracts.ts` — adds `SyntaxLink`, `CanonicalSyntax.links`, `InternalLinkReference`, `LinkTargetState`, and `ResolvedLinks`.
- `server/wikiLint/core/documentRules.ts` — the `internal_links` rule kind inside the shared document unit.
- `server/wikiLint/adapters/canonicalSyntax.ts` — collects link tokens with positions and block paths.
- `server/wikiLint/adapters/documentReader.ts` — parses, extracts, and resolves links inside the snapshot; adds `resolveLinkTargets`.
- `server/wikiLint/application/lintDocument.ts` — removes the Story 1.3 fail branch, passes the instance origin only when the kind is enabled, sets the link count, and classifies canonicalization errors.
- `server/tools/wikiLint.ts` — the instance origin defaults to `env.URL`.
- Collocated tests:
  - `core/internalLinks.test.ts` and `core/documentRules.test.ts`;
  - `core/boundary.test.ts`;
  - `adapters/canonicalSyntax.test.ts` (positions, tokenizer parity, 8,000-link linearity);
  - `adapters/documentReader.test.ts` (database: resolution states, group-only targets, 501-key batching, floor refusal);
  - `application/lintDocument.test.ts`;
  - `server/tools/wikiLint.test.ts` (end to end: multi-actor disclosure through Findings and System Failures, every form, ordering, determinism, no mutation).

**Review findings breakdown** (26 findings: high 0, medium 1, low 16, false 9, maybe-false 0):
- **Patches applied** (9 entries: medium 1, low 8):
  - Production changes:
    - linear link-position computation (medium);
    - the actor's team predicate in `resolveLinkTargets`;
    - the `resolveLinkTargets` docstring;
    - the documented key-disjointness invariant of `ResolvedLinks.targets`.
  - Test-only changes:
    - group-only readable targets;
    - a non-vacuous mutation test that proves the target SELECT ran;
    - AC10 end-to-end cases (non-ASCII, L6, L9, L10, L11);
    - an AC8 multi-actor fixture through the System Failure channel;
    - the L1–L11 table also run as serializer-escaped canonical Markdown.
- **Deferred:** none.
- **Rejected**, with reasons in the Review Triage Log:
  - low:
    - links the baseline parse drops (table-cell checkbox labels, `attachments` splicing);
    - tokenizer drift beyond the parity corpus;
    - plain text that the baseline parse reads as an autolink or reference link;
    - per-statement bounds of multi-statement batches;
    - classification of canonicalization-phase errors after expiry (two layers);
    - no Finding for a link without a provable position (fail-closed instead).
  - false:
    - duplicate link-batch failure tests;
    - a title-prefixed UUID looked up as a urlId (AC2 order);
    - team custom domains;
    - the other AC1 surfaces;
    - the AC3 limit;
    - AC4 write transactions;
    - AC9 database order;
    - the in-test MCP server;
    - Findings discarded on a link-batch failure.

**Follow-up review recommendation: false.** On this first pass, one `medium` and no `high` entry was patched (patched: high 0, medium 1, low 8).

**Verification performed** (final tree; test database PostgreSQL 14 at `127.0.0.1:5432/outline-test`, migrated):

| Command | Result |
| --- | --- |
| `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint server/tools/wikiLint.test.ts` | 14 files, 652/652 passed |
| `TZ=UTC node_modules/.bin/vitest run --project server server/tools server/routes/mcp` | 9 files, 141/141 passed |
| `corepack yarn tsc` | exit 0 |
| `node_modules/.bin/oxlint --type-aware` on the changed paths | exit 0 |
| `node_modules/.bin/oxfmt --check` on the changed paths | clean |
| `grep -rniE "laura\|ezop" server/wikiLint server/tools/wikiLint*.ts` | no matches |

Probes:
- Before the patch, 8,000 links on one 300 KB line took 8.6 s, against 17 ms for the base parse. After it, 8,000 links on one ~480 KB line take 69 ms.
- A prototype confirmed the observer approach: token parity with `parser.tokenizer`, and that the mention with a `]` label and the link after `@` serialize and parse as pinned.

Matrix test audit: every row of the I/O matrix has a covering test that ran and passed.

**Residual risks:**
- The baseline parse drops some links, which are therefore never validated:
  - links in table-cell checkbox labels;
  - links in a paragraph that the `attachments` rule splices out;
  - links written as `@`-preceded absolute URLs, which become mentions.
- Plain `<url>` text, or a reference definition, can become a link token and produce a Finding on text the editor shows as plain.
- An unresolved link inside a notice or toggle inside a table cell has no provable position. Its kind fails closed with `VALIDATION_RUNTIME_FAILED`, so the agent gets no repairable Finding for it.
- Per-statement `SET LOCAL` bounds let a link batch that returns rows exceed its remainder, up to about 3×, through the `separate` membership SELECTs (as in Story 1.3).
- Links are recognized against `env.URL` only. Team custom domains are not internal, which matches baseline `isInternalUrl`.
- `lint_document` stays unregistered on `/mcp` (Story 1.10). `lint_wiki`, the global-index check, and enforced writes must reuse `extractInternalLinks` and `resolveLinkTargets` (Stories 1.5, 1.6, and 2.3).
