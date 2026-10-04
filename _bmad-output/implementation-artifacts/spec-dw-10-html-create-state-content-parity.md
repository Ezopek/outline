---
title: 'DW-10: Lint parity between the imported state and the validated content of an enforced HTML create'
type: 'bugfix'
created: '2026-10-04'
status: done
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      Documents created by the baseline DocumentImportTask (REST imports, or imports made before a collection had a policy) keep a converter state that can hold structure their content lost, so lint_document and lint_wiki read the content and report clean until the first collaborative save rewrites the content from that state.
    evidence: |-
      DocumentImportTask.ts:97-120 still persists the converter `state` beside `content` parsed again from `text`. DocumentHelper.toProsemirror (DocumentHelper.tsx:86-104) prefers `content`, so the read-only lint tools never see the state. Class A in this spec's Design Notes shows a nested notice that is present in the state and absent from the content. This change fixes only the enforced MCP HTML create; the baseline split predates it.
    location: >-
      server/queues/tasks/DocumentImportTask.ts:97-120
    severity: medium
  - summary: >-
      A metadata one_of policy can validate a linked inline image value that loses its link when Y.js builds the editor state from content.
    evidence: |-
      The class B metadata fixture in documentProjection.test.ts shows that the linked image is present in validated content but loses its link in the derived Y.js document. metadataFieldFormats in documentRules.ts compares the field value to configured one_of values. This Y.js conversion also occurs for Markdown creates and predates DW-10; the accepted Decision explicitly retains that behavior.
    location: >-
      server/wikiLint/adapters/documentProjection.test.ts:1557; server/wikiLint/core/documentRules.ts:270-285
    severity: medium
baseline_revision: b732efe0f2c58494558327776719fcaa122f2350
---

<intent-contract>

## Intent

**Problem:** An enforced HTML create keeps the converter's Y.js `state`, but validation runs on `content`, which is the converter's Markdown parsed again (`prepareHtmlCreate`, `server/wikiLint/adapters/documentProjection.ts:173-188`). DW-10 asked whether the two can differ in lint-relevant structure. The planning sweep below shows they can, and in the unsafe direction. A nested notice survives in `state` but disappears from `content`. The editor then shows unsupported structures, disallowed headings and broken internal links that write validation never saw.

**Approach:** Add a collocated fixture sweep to `documentProjection.test.ts`. It runs HTML fixtures that cover the converter's nodes and marks through the real enforced preparation and projection, then compares the lint-relevant structure of `yDocToProsemirrorJSON(state)` with that of the validated `content`. The persistence change is the one recorded in **Decision**: `prepareHtmlCreate` returns `state: null`, so there is nothing left to diverge.

## Boundaries & Constraints

**Always:**
- Fixtures take the worker's own path: `documentImporter({ …, media: refuseImportableMedia })` → `prepareHtmlCreate` → `projectMarkdownCreate` (`enforcedImport.ts:658-707`).
- Lint-relevant structure is `parseCanonicalMarkdown(await toCanonicalMarkdown(json))`, the only structural input the document rules read (`enforcedWrite.ts:204-206`; `documentRules.ts` reads only `CanonicalSyntax` and resolved links). It is reduced to:
  - block kinds in pre-order, with `paragraph` dropped;
  - each heading's level and text;
  - each list item's `field` name and value;
  - link hrefs, in order.
- Positions and paragraph nodes are excluded. No rule emits at a paragraph, and a line shift does not change which Findings exist.
- Each failure names the fixture and both reduced structures.
- The sweep is deterministic and uses no LLM.

**Never:**
- Change `projectionWriter`, `documentImporter`, `DocumentConverter`, the serializer, the Y.js helpers, or the baseline `DocumentImportTask`. The only production change allowed is the one in **Decision**: `prepareHtmlCreate` returns `state: null`.
- Edit the deferred-work ledger.
- Create a new test file or directory.

**Decision (recorded 2026-10-04, option 1 of the escalated Open Decision):** An enforced HTML create derives `state` from the validated content. `prepareHtmlCreate` returns `state: null`, as Markdown creates do, so the editor shows exactly the structure that write validation evaluated. Structure that only the converter kept, such as a nested notice subtree, no longer reaches the editor; it was already missing from `text` and `content`. Class B (links on inline atoms) becomes the same accepted Y.js behavior that every Markdown create has. Options 2 (fail closed) and 3 (accept the residual risk) are rejected: option 2 adds a refusal surface that would also reject ordinary HTML with linked images, and option 3 leaves a demonstrated enforcement bypass.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Parity | Each node, mark and nesting fixture outside classes A-C | Reduced structures are equal | No error expected |
| Class A: nested notice | `<h2>Overview</h2><p>ok</p>` plus a notice inside a notice holding a table, an internal link and an `<h3>` | `state` is `null`; the persisted document is `content`, which holds only the heading and the paragraph, and it is the structure that was validated | No error expected |
| Class B: link on an inline atom | `<a href><img></a>`, a linked emoji, a linked inline math node, `<a>a<br>b</a>` | `state` is `null`; the links in `content` are the ones validated and persisted | No error expected |
| Class C: image inside a heading | `<h2>A<img>B</h2>` | `state` is `null`; the heading text is the one in `content` (`A  B`), which is the one validated and persisted | No error expected |
| Unconvertible | `a.attachment`, `.mention` (jsdom has no `innerText`) | `documentImporter` throws `RangeError` on both the baseline path and the enforced path, so nothing is persisted | Throw |

</intent-contract>

## Code Map

- `server/wikiLint/adapters/documentProjection.ts:173-188` -- `prepareHtmlCreate`. It sets `content` = `toProsemirror(imported.text)` and `state` = `copyState(imported.state)`. This is the split under study.
- `server/commands/documentImporter.ts:91-106` -- `text` (`:96`) and `state` (`:104`) come from the same `processedDoc`. Divergence arises only when `text` is parsed again.
- `server/converters/DocumentConverter.ts:106-131` -- `htmlToProsemirror`: jsdom followed by `ProsemirrorDOMParser.fromSchema(schema)`. Converter coverage is the server schema's `parseDOM` rules:
  - nodes: `p`, `h1`-`h4`, `blockquote`/`ul.listtype-quote`, `.code-block`/`code`, `hr`, `table`/`tr`/`td`/`th`, `ul`/`ol`/`li`, checkbox lists, notices (`div.notice-block`, `.ql-hint`, `.alert.theme-admonition`, `.confluence-information-macro`), `math-display`/`dl`, `math-inline`/`span`, toggles, `img`/`div.image`, `video`, `iframe`/`a.embed`, `a.attachment`, `.mention`, `strong.emoji`, `br`;
  - marks: link, strong, em, underline, strikethrough, highlight, inline code, placeholder, comment.
- `server/wikiLint/application/enforcedImport.ts:658-707` -- the worker's prepare and project path, which the sweep mirrors.
- `server/wikiLint/application/enforcedWrite.ts:164-206,490` -- `validateProjection` lints `projection.content` only.
- `server/wikiLint/adapters/projectionWriter.ts:66,131-133` -- persists `state` when it is non-null.
- `server/wikiLint/core/documentRules.ts:144,207,227` -- heading text is matched exactly. `server/wikiLint/core/registry.ts:230-245` -- `headingText` is trimmed, but internal runs of whitespace are allowed.
- `server/models/helpers/DocumentHelper.tsx:86-104` -- `toProsemirror` prefers `content` over `state`. `lint_document` therefore reads `content` until the first collaborative save rewrites it from `state`.
- `server/wikiLint/adapters/documentProjection.test.ts:142` (`decodeState`), `:1143-1263` ("HTML creates", `importBoth`) -- the reuse points for the sweep.
- `server/queues/tasks/DocumentImportTask.ts:97-120` -- the baseline persists the same `text`/`state` split. This is a baseline defect that the enforced path inherits.

## Tasks & Acceptance

**Execution:**
- `server/wikiLint/adapters/documentProjection.test.ts` -- Add the sweep to the "HTML creates" block: one `it.each` over named HTML fixtures, with the comparison and reduction from Boundaries. Classes A-C are covered by named fixtures, and the sweep also asserts that the prepared create carries `state: null`. -- DW-10's settlement artifact.
- `server/wikiLint/adapters/documentProjection.ts` -- `prepareHtmlCreate` returns `state: null` (and no longer copies `imported.state`). Update its doc comment and any caller or test that relied on a non-null `state`, without touching the Markdown path. -- Decision option 1.

**Acceptance Criteria:**
- Given every parity fixture, when it runs through the enforced preparation and projection, then the prepared create has `state: null` and the persisted document is the validated `content`.
- Given the class A nested-notice fixture under a policy that forbids notices, tables, blockquotes and `h3`, when it runs through an enforced HTML create, then no structure outside the validated `content` is persisted, so the create cannot commit as `validated` while the editor holds a forbidden structure.
- Given the class B and C fixtures, when they run through an enforced HTML create, then the outcome is `state: null` and the validated `content`, with no refusal.

## Spec Change Log

## Review Triage Log

### 2026-10-04 — Review pass
- verdicts: 22 findings — high 0, medium 3, low 18, false 1, maybe-false 0
- findings:
  - `[medium]` `[reject]` Blind Hunter: an enforced HTML create silently drops converter-only structure (class A's outer notice with its table, link and `h3`) and still commits as `validated`; it should warn or refuse. — Real, and it is what the intent's **Decision** chose: structure only the converter kept no longer reaches the editor, and option 2 (refusal) is rejected there. Recorded under residual risks.
  - `[low]` `[reject]` Blind Hunter: no test shows the editor-fidelity cost of option 1, such as highlight colours, which `Highlight.toMarkdown` (`shared/editor/marks/Highlight.ts:156`) writes as `==…==` without a colour. — Confirmed. The Decision accepts the fidelity cost ("choose option 2 if editor fidelity matters more"), the intent asks for no fidelity tests, and attribute fixtures would be new coverage rather than a direct correction. Recorded under residual risks.
  - `[low]` `[patch]` Blind Hunter: the sweep compares the discarded converter state with `content`, not the state the editor builds from the stored content, which is checked only for the nested notice. — Patched: every sweep fixture now derives the editor document from `stored.content` as `PersistenceExtension` does and requires its reduced structure to equal the validated content's; class B is exempt, with a comment, because the Decision accepts its Y.js link loss.
  - `[low]` `[reject]` Blind Hunter: AC 2 is not exercised through `runAttempt`/`validateProjection` with a configured policy, and the policy has no internal-link rule. — `state: null` does not depend on the input and is pinned on the worker path (`enforcedImport.test.ts:608`) and the MCP path (`documents.enforcedHtml.test.ts`). `validateProjection` already lints `projection.content` only (`enforcedWrite.ts:164-206`), and the class A content holds no links. A policy-configured worker test would be more than a direct correction.
  - `[low]` `[reject]` Blind Hunter: `PreparedMarkdownCreate.state`, the template guard in `projectMarkdownCreate` and their docs are now unreachable or stale, and the template test hand-builds a stateful prepared value. — Confirmed, but the intent's Never boundary forbids touching `projectionWriter` and allows a single production change. The guard stays valid as defence in depth, and the docs still describe what the type admits.
  - `[medium]` `[defer]` Blind Hunter: documents imported by the baseline `DocumentImportTask` (REST imports, pre-policy imports) keep a diverging state, so `lint_document`/`lint_wiki` read clean content while the editor shows the nested notice. — Confirmed and pre-existing: `DocumentImportTask.ts:97-120` still persists the split, and `DocumentHelper.toProsemirror` prefers `content`. Not caused by this change; deferred.
  - `[low]` `[patch]` Blind Hunter: "fails to convert %s on both paths" pins an upstream jsdom limitation with no context and does not assert that nothing is persisted. — Patched: a comment now names the cause, jsdom lacks the `innerText` that `Mention.tsx:141` and `Attachment.tsx:71` read. The persistence half is triaged in the Intent Alignment row below.
  - `[low]` `[reject]` Blind Hunter: about 52 committed fixtures are far fewer than the roughly 340 the Design Notes cite. — The safety property no longer depends on parity, since `state` is `null` for every input. The committed sweep covers every `parseDOM` rule and mark that the Approach asks for, and regenerating the 154 combinations is more than a direct correction.
  - `[low]` `[reject]` Blind Hunter: each sweep case builds its own user and collection and persists a document. — Each case takes about 35 ms, and five files run in about 13 s. Persisting each case is what pins `stored.state` per fixture, and restructuring is more than a direct correction.
  - `[false]` `[reject]` Blind Hunter: the `documents.enforcedHtml.test.ts` assertions would pass if the baseline also lost its state. — The baseline there is `DocumentImportTask`, and `importBoth` in `documentProjection.test.ts` already asserts `baseline.state` is not null for that same task, so a baseline that lost its state could not go unnoticed.
  - `[low]` `[reject]` Edge Case Hunter: the converter state passes the size check, but the state derived from content could exceed `maxStateLength`, so the first collaborative load fails. — Reachable only for a converter state within bytes of the 1.5 MB limit while the round trip grows it, and every enforced Markdown create already derives its state from content the same way. A guard would add a state computation to preparation, which is more than a direct correction.
  - `[medium]` `[reject]` Edge Case Hunter: classes A-C structure silently vanishes from the committed document. — Same root cause as the first Blind Hunter row: the Decision accepts it and rejects refusal.
  - `[low]` `[patch]` Edge Case Hunter: the policy test's `toEqual([])` passes vacuously when a rule throws into `failedKinds`. — Confirmed against `evaluateDocumentRules` (`documentRules.ts:391-424`). Patched: the `lint` helper now asserts `failedKinds` is empty.
  - `[low]` `[reject]` Edge Case Hunter: the template-refusal and state-persist branches are dead code with stale docs. — Same root cause as the Blind Hunter contract row: kept under the intent's Never boundary.
  - `[low]` `[reject]` Verification Gap (other): doc comments at `projectionWriter.ts:41` and `documentProjection.ts:87-88,267` still describe an imported state. — Same root cause as the Blind Hunter contract row.
  - `[low]` `[patch]` Intent Alignment: the sweep checks a value that is never stored, and the editor surface is checked for one fixture only. — Same root cause and fix as the third Blind Hunter row.
  - `[low]` `[reject]` Intent Alignment: on the editor surface, class B still diverges (a linked emoji or inline math loses its link, a linked `<br>` splits it in two, a metadata value from a linked image loses its link). — Confirmed when the exemption is removed; the linked image itself survives. The Decision accepts this as the Y.js behaviour every Markdown create has, and the editor holds fewer links than were validated, never new targets.
  - `[low]` `[reject]` Intent Alignment: the notice-in-blockquote fixture is pinned as divergent, and its mangled content (a phantom notice and checkbox item) now reaches the editor where the baseline showed the clean state. — Confirmed. The Design Notes list it as related to class A. A fix needs either a serializer change, which the Never boundary forbids, or a refusal, which the Decision rejects. The input is rare. Recorded under residual risks.
  - `[low]` `[reject]` Intent Alignment: the `validated` and no-refusal claims are inferred from `projection.content` rather than observed at the `runAttempt` result. — Same root cause as the fourth Blind Hunter row.
  - `[low]` `[reject]` Intent Alignment: "nothing is persisted" for unconvertible input is not asserted. — `documentImporter` throws before any preparation or persistence step, both in the worker (`enforcedImport.ts:658-707`) and in `DocumentImportTask`, so nothing can be persisted. A worker-level assertion would be more than a direct correction.
  - `[low]` `[patch]` Intent Alignment: the class A content "holds only the heading and the paragraph" is checked through a reduction that drops paragraphs. — Patched: the policy test now asserts that the top-level nodes of `stored.content` are exactly `heading` then `paragraph`, and it passed unchanged.
  - `[low]` `[reject]` Intent Alignment: the template-refusal test feeds in a hand-made state that `prepareHtmlCreate` can no longer produce. — Same root cause as the Blind Hunter contract row.

### 2026-10-04 — Follow-up review pass
- verdicts: 14 findings — high 0, medium 2, low 12, false 0, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind Hunter: the flattened reduction can equate a root heading with a nested heading. — `required_sections` and `section_order` use root headings, so the test has this blind spot. The intent prescribes the reduction and the persisted state is unconditionally null; changing the model exceeds a direct correction for an unlikely test-only case.
  - `[low]` `[patch]` Blind Hunter: omitting positions can change Finding locations despite the helper's stronger comment. — The helper comment now states that it compares rule inputs, not Finding source locations; the reduction remains as specified.
  - `[low]` `[patch]` Blind Hunter: class B editor reconstruction was skipped wholesale. — The linked-image fixture now requires full equality, and the other class B fixtures assert that the editor gains no link target outside validated content.
  - `[low]` `[reject]` Blind Hunter: the class A policy test does not run a configured worker attempt. — Carried: `state: null` is unconditional on the worker and MCP paths, while the test checks the stored content and policy result directly; another worker fixture is not a direct correction.
  - `[low]` `[reject]` Blind Hunter: the class A policy test omits internal-link target resolution. — Carried: the persisted content has no link, and its editor reconstruction has none; adding a resolver cannot change the demonstrated safety outcome.
  - `[medium]` `[reject]` Blind Hunter: converter-only HTML structure is silently lost. — Carried: the recorded Decision accepts this exact outcome and rejects refusal; it remains listed as a residual risk.
  - `[low]` `[reject]` Blind Hunter: lost highlight colour has no explicit fidelity test. — Carried: the Decision accepts Markdown round-trip fidelity loss, and an attribute test would expand scope without changing the safety property.
  - `[low]` `[reject]` Blind Hunter: importer size-checks converter state before discarding it. — `documentImporter` checked that state before DW-10 and the intent forbids changing it; an oversized import still fails on the baseline path. This is unlikely at the limit and changing the importer is outside this story.
  - `[low]` `[reject]` Blind Hunter: the editor-derived state might exceed `maxStateLength`. — Carried: the same edge already applies to Markdown creates, and a new preparation guard would exceed a direct correction.
  - `[low]` `[reject]` Edge Case Hunter: the flat reduction omits heading parentage. — Same verified blind spot as the first row; the intent fixes the reduction and production does not persist the compared converter state.
  - `[medium]` `[defer]` Edge Case Hunter: a linked-image metadata value can pass `one_of` and lose its link in the editor. — `metadataFieldFormats` checks the validated Markdown field, while Y.js drops the image's link; this predates DW-10 for Markdown creates and is captured in a new spec-frontmatter deferred item.
  - `[low]` `[reject]` Intent Alignment: no configured class A `runAttempt` outcome is asserted. — Carried: the adapter persistence and direct policy check cover the relevant content; the unconditional worker null-state behavior is covered separately.
  - `[low]` `[reject]` Intent Alignment: the unconvertible inputs lack a persisted-row assertion. — Carried: `documentImporter` throws before preparation or persistence on both paths.
  - `[low]` `[reject]` Intent Alignment: class B editor structure is not wholly equal to validated content. — Carried: the Decision explicitly accepts Y.js link loss on inline atoms; the new assertion checks for newly gained link targets.

## Design Notes

**Planning sweep (evidence).** Two throwaway Vitest probes each ran in the server project against the test database. They used the exact worker path and were deleted afterwards; the tree was verified clean. About 340 HTML fixtures were swept:
- 154 combinations of 11 containers and 14 leaves: root, `ul`/`ol`/checkbox item, a list item after a paragraph, blockquote, table cell, notice, toggle, a pair, and after a paragraph, each holding a heading, a metadata list, a link, a quote, code, `hr`, a table, a notice, display math, a toggle, an ordered list, a checkbox list, an image or an embed;
- about 185 targeted cases covering every `parseDOM` tag, every mark (including style-based marks and overlapping marks), Markdown-looking text, escapes, href edge cases, empty or adjacent blocks, and inline atoms in headings, metadata items and links.

Lint-relevant divergence classes:
- **A: a notice inside a notice (unsafe: `state` holds more).** The parser wraps the inner notice in a blockquote. The serialized `:::info\n> \n:::warning …` is parsed back as nothing, so `content` loses the whole outer notice subtree. One fixture used `<h2>Overview</h2><p>ok</p>` followed by notice(notice(table, link `/doc/missing-…`, `<h3>Hidden</h3>`)). The policy was `required_sections [Overview]@2`, `allowed_heading_levels [2]` and `unsupported_markdown_structures [notice, table, blockquote]`. `evaluateDocumentRules` returned 0 Findings on `content`, so the write commits as `validated`. On `state` it returned 8: `HEADING_LEVEL_NOT_ALLOWED` and 7 × `MARKDOWN_STRUCTURE_UNSUPPORTED`. Related: a notice inside a blockquote gains a phantom notice and a checkbox list in `content`.
- **B: a link mark on an inline atom (safe: `content` holds more).** Y.js conversion drops marks on `image`, `emoji` and `math_inline`. `<a>a<br>b</a>` splits into two link occurrences in `state`. This is a general Y.js property: a Markdown create's state, derived from `[![a](…)](/doc/…)`, loses the link too. A metadata value built from a linked image differs (`Spec=![a](…)` versus `Spec=[![a](…)](/doc/…)`).
- **C: an image inside a heading.** The round trip adds one space per inline image (`A B` in `state`, `A  B` in `content`). Exact-match section rules can therefore match one side and not the other.
- **Not lint-relevant (excluded by the reduction):** empty paragraphs added when an item or quote starts with `hr` or a notice; adjacent lists that merge with shifted lines; trailing empty paragraphs; escape-only and URL-encoding differences. Kinds, headings, fields and links are equal.

**Recommendation (adopted as the Decision):** option 1. It makes the enforced HTML create exactly as safe as the enforced Markdown create, adds no comparison logic or refusal surface, and stores one consistent document. Class B then becomes the same accepted Y.js behavior that every Markdown create has, and it errs on the safe side. Choose option 2 if editor fidelity of HTML imports matters more than avoiding refusals.

## Verification

**Commands:**
- `scripts/test-db.sh ensure` -- expected: the test database is ready.
- `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint/adapters/documentProjection.test.ts` -- expected: every test passes, including the sweep.
- `corepack yarn tsc`, `node_modules/.bin/oxlint --type-aware` and `node_modules/.bin/oxfmt --check` on the changed files -- expected: exit 0.

## Auto Run Result

Status: done

**Summary:** An enforced HTML create no longer persists the converter's Y.js state. `prepareHtmlCreate` returns `state: null`, as Markdown creates do, so the editor opens from the same `content` that write validation linted (the intent's Decision, option 1). A collocated sweep of 53 HTML fixtures settles DW-10: it runs each fixture through the worker's own conversion, preparation, projection and persistence. For each one it checks four things. `state` is `null` on the prepared value, the projection and the stored row. The stored `content` is the validated one. The converter state's lint-relevant structure equals the content's, except for the pinned classes A-C. The editor document derived from the stored content has the validated structure, except for class B, which the Decision accepts.

**Files changed:**
- `server/wikiLint/adapters/documentProjection.ts` -- `prepareHtmlCreate` returns `state: null`; its doc comment says why.
- `server/wikiLint/adapters/documentProjection.test.ts` -- the DW-10 sweep, the nested-notice policy test, the unconvertible-input test, and the HTML baseline-parity and template tests adjusted for a null state.
- `server/wikiLint/application/enforcedImport.test.ts` -- the worker outcome now expects `state` to be null.
- `server/tools/documents.enforcedHtml.test.ts` -- the MCP baseline comparisons now expect `state: null`.
- `_bmad-output/implementation-artifacts/spec-dw-10-html-create-state-content-parity.md` -- this spec: status, triage log, deferred entry and this result.

**Review findings:** 22 findings: high 0, medium 3, low 18, false 1, maybe-false 0.
- Patches applied: 4 entries, all `low`, all test-only:
  - an editor-surface check across the sweep;
  - an empty-`failedKinds` assertion;
  - the class A top-level node assertion;
  - the `RangeError` cause comment.
- Items deferred: 1 (`medium`): the baseline `DocumentImportTask` still persists a diverging state that the read-only lint tools do not see.
- Rejected, for the reasons recorded per row in the triage log:
  - converter-only structure loss and the fidelity cost, which the Decision accepts;
  - class B editor link loss, which the Decision accepts;
  - the notice-in-blockquote round trip, whose fix needs a serializer change or a refusal, both excluded;
  - the stale or unreachable state contract, kept by the Never boundary;
  - the worker-level `validated` and nothing-persisted assertions, already implied by existing coverage;
  - fixture breadth, per-case database cost and the `maxStateLength` edge, all low and needing more than a direct correction;
  - one `false` row about baseline-state pinning.

Patched entries by verdict: high 0, medium 0, low 4. Follow-up review recommended: false.

**Verification:**
- `scripts/test-db.sh ensure`: exit 0; test database ready.
- `TZ=UTC node_modules/.bin/vitest run --project server` on `documentProjection.test.ts`, `enforcedImport.test.ts`, `documents.enforcedHtml.test.ts`, `enforcedHtmlCreate.test.ts` and `projectionWriter.test.ts`: 5 files, 243/243 passed after the review patches.
  - Before the patches, the first three files passed 190/190 and the other two 53/53.
  - Every I/O matrix row has a covering test, confirmed with the verbose reporter and none skipped: parity fixtures, class A (sweep plus policy test), class B ×4 plus the metadata variant, class C, and unconvertible ×2.
- `corepack yarn tsc`: exit 0. `oxlint --type-aware` and `oxfmt --check` on the four changed source files: exit 0.
- The implementation session reports a mutation check: restoring `copyState(imported.state)` made 60 tests fail. It was reverted.

**Residual risks:**
- Deliberate behaviour change: an enforced HTML create now differs from the baseline import, which still persists the converter state.
  - Structure that only the converter kept, such as a nested notice subtree, is dropped without a warning, and the create still reports `validated`.
  - Attributes that the Markdown round trip loses, such as highlight colours, no longer reach the editor.
  - Class B links on inline atoms are lost or split in the editor, as for every Markdown create.
- A notice inside a blockquote round-trips into a phantom notice, blockquote and checkbox item. The converter state used to hide that serializer defect, and it is now what the editor shows.
- Nothing in production now produces a non-null `PreparedMarkdownCreate.state`. The template guard in `projectMarkdownCreate` and the state branch of `projectionWriter` remain as defence in depth. Their doc comments (`documentProjection.ts:87-88,267`, `projectionWriter.ts:41`) still describe an imported state.
- A converter state just under `maxStateLength` could produce a slightly larger state from content on the first collaborative load. The same exposure already applies to Markdown creates.
- The pinned "converter state differs" assertions for classes A-C will fail by design if the converter or serializer is fixed. Those fixtures then move to the parity set.
- The class B "linked image" fixture is exempt from the editor check by name, although its link survives there.

**Run note:**
- This session received the bundle intent rather than the spec path. Before this run, the spec at the intent's slug had been resolved from `blocked` to `ready-for-dev`, recording the Decision. It was the only untracked change, so the run resumed it at implementation rather than halting on it or creating a `-2` spec.
- The Decision came from the operator's coordinating session, acting under the operator's delegation, after the previous dev session's escalation. It was not recorded by the operator directly.
- The deferred-work ledger and sprint board were not edited.

### Follow-up review — 2026-10-04

**Summary:** Enforced HTML creates now persist `state: null`, so the editor derives its document from the validated `content`. The collocated 53-fixture sweep compares the discarded converter state, validated content, stored row and editor reconstruction. This follow-up review added a precise assertion for class B editor links and corrected the helper's position comment.

**Files changed since the baseline:**
- `server/wikiLint/adapters/documentProjection.ts` — `prepareHtmlCreate` drops the converter state.
- `server/wikiLint/adapters/documentProjection.test.ts` — HTML fixture sweep, persistence and policy checks, and the follow-up editor-link assertion.
- `server/wikiLint/application/enforcedImport.test.ts` — worker outcome expects a null state.
- `server/tools/documents.enforcedHtml.test.ts` — MCP outcomes expect a null state.
- `_bmad-output/implementation-artifacts/spec-dw-10-html-create-state-content-parity.md` — review triage, deferred evidence and this result.

**Follow-up review:** 14 findings: high 0, medium 2, low 12, false 0, maybe-false 0. Two `low` entries were patched and one `medium` pre-existing issue was deferred in this spec. Rejected findings and reasons:
- Flattened heading parentage: a test-only blind spot under the prescribed reduction; persisted state is always null.
- Configured class A worker outcome: stored content, direct policy evaluation and unconditional null-state worker behavior already establish the safety claim.
- Class A internal link resolution: no such link remains in stored content or editor state.
- Silent converter-only structure loss: the recorded Decision accepts it.
- Highlight-colour fidelity: the Decision accepts the Markdown round trip, and an attribute test adds no safety coverage.
- Importer converter-state size check: this baseline limit predates the change and the intent excludes importer edits.
- Editor-derived state size limit: the same edge already applies to Markdown creates; a guard would exceed a direct correction.
- Heading parentage, independently reported by Edge Case Hunter: same test-only blind spot as above.
- Missing configured class A `runAttempt` assertion, independently reported by Intent Alignment: the adapter and policy checks cover the relevant state, and the worker's null state is tested separately.
- Unconvertible persisted-row assertion: the importer throws before persistence on both paths.
- Class B editor inequality: the Decision accepts inline-atom link loss; the follow-up assertion excludes newly gained targets.

Patched entry counts: high 0, medium 0, low 2. Follow-up review recommended: false.

**Verification:** `scripts/test-db.sh ensure` exited 0. The five targeted server test files passed 243/243 tests. `corepack yarn tsc`, type-aware `oxlint` and `oxfmt --check` on the four changed TypeScript files all exited 0.

**Residual risks:** Converter-only structures and attributes can be lost without a warning on enforced HTML creates. The baseline `DocumentImportTask` still persists a divergent state. A `one_of` metadata value containing a linked inline image can pass validation and lose its link when Y.js derives the editor state; this predates DW-10 and is deferred above. Near-limit derived Y.js states may exceed the importer limit on first editor load, as on Markdown creates.
