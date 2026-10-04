---
title: 'DW-1: Pin the canonical block start-line invariant'
type: 'chore'
created: '2026-10-04'
baseline_revision: 3ddf6aad923302b0d785dc670dc673eefaaffac5
status: done
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** `blockPosition` in `server/wikiLint/adapters/canonicalSyntax.ts` throws `CanonicalMarkdownError` when a mapped block token starts on a whitespace-only line, failing every rule of the document. DW-1 asks whether any `toCanonicalMarkdown` output reaches that path; nothing pins the answer.

**Approach:** Planning settled it: no serializer output reaches the throw (see Design Notes). Keep the throw unchanged and add a collocated, deterministic fixture sweep to `canonicalSyntax.test.ts`. The sweep serializes every schema block node type, alone, paired and nested in every block container, plus the legacy notice shapes that production still loads (see Boundaries), then parses the canonical Markdown. It fails on any `CanonicalMarkdownError` and on any non-inline schema node type the schema-valid fixtures leave uncovered.

## Boundaries & Constraints

**Always:** Fixtures are ProseMirror JSON of two kinds. Schema-valid fixtures pass `Node.check()` against the server `schema`. Legacy notice fixtures are a `container_notice` whose content uses a block type that the notice content expression allowed before commit `3b43460a0` (2023-07-29, `block+`) and no longer allows (the current expression is `(list | blockquote | hr | paragraph | heading | attachment)+`, so the legacy-only types are `code_block`, `code_fence`, `math_block`, `embed`, `video`, `table`, `container_toggle` and a nested `container_notice`). Production loads stored content with `Node.fromJSON` and no `check()` (`DocumentHelper.toProsemirror`), so legacy notice content can still reach the serializer; legacy fixtures are built with `Node.fromJSON` and are not `check()`ed. Any other combination the schema rejects is skipped, and the sweep makes no claim that it is reachable. The sweep goes through the public `toCanonicalMarkdown` → `parseCanonicalMarkdown` surface. A failure message names the fixture and its Markdown. The test stays deterministic: no randomness and no LLM.

**Never:** Do not change `canonicalSyntax.ts`. The blank-line throw, the CR guard and every other `CanonicalMarkdownError` path stay unchanged. Do not change the serializer, the tokenizer or markdown-it rules. Do not create a new test file or directory. Do not edit the deferred-work ledger.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sweep passes | every schema-valid fixture | `parseCanonicalMarkdown(await toCanonicalMarkdown(doc))` returns without throwing | No error expected |
| Legacy notice shape | a `container_notice` holding a legacy-only block type, built with `Node.fromJSON` and not `check()`ed | `parseCanonicalMarkdown(await toCanonicalMarkdown(doc))` returns without throwing | test failure on a throw, naming the fixture and its Markdown |
| Blank-start regression | a future serializer/rule change maps a block to a whitespace-only line | sweep fails and lists the fixture name and Markdown | test failure, not a silent pass |
| New block type | a non-inline node type added to `schema` without a fixture | coverage assertion fails | test failure |

</intent-contract>

## Code Map

- `server/wikiLint/adapters/canonicalSyntax.ts:65-82` -- `blockPosition`: reads `lines[token.map[0]]` and throws on a whitespace-only or missing line. Read-only.
- `server/wikiLint/adapters/canonicalSyntax.ts:274-330` -- `parseCanonicalMarkdown`: calls `blockPosition` only for blocks outside table rows. Blocks below a `tr` take the row position, so cell-relative nested-parse maps are never read.
- `server/wikiLint/adapters/lintTokenizer.ts:221-224` -- tokenizer = server rules plus a read-only link observer. Read-only.
- `shared/editor/rules/alphaLists.ts:12-53` -- the only rule that rewrites `state.src`. It is line-preserving and fires only on lines that hold a letter marker, so blankness is unchanged. Read-only.
- `shared/editor/rules/math.ts:187` -- the only custom rule that sets `token.map`, to `[start, …]` on the `$$` line. `markdown-it-container` (notices `:::`, toggles `+++`) maps from the marker line. Read-only.
- `server/models/helpers/DocumentHelper.tsx:89-99` -- `toProsemirror`: loads stored content with `Node.fromJSON` and no `check()`, which is why legacy notice content can still be read. Read-only.
- `shared/editor/nodes/Notice.tsx:41` -- the current notice content expression; before `3b43460a0` it was `block+`. Read-only.
- `server/models/helpers/DocumentHelper.tsx:290-321` -- `toMarkdown`: serializes, replaces bare `\` lines with blank lines, then trims. Read-only.
- `server/wikiLint/adapters/canonicalSyntax.test.ts:1-50,431` -- existing imports, the `paragraph()` helper and the `serializer-produced regressions` describe. Add the sweep here. `schema` comes from `@server/editor`; `Node` comes from `prosemirror-model`.
- Schema block types (non-inline): doc, paragraph, code_block, code_fence, blockquote, embed, attachment, video, container_notice (restricted content), heading, hr, math_block, container_toggle (first child paragraph|heading), checkbox_list, checkbox_item, bullet_list, ordered_list (`order`, `listStyle`), list_item, table, tr, th, td.

## Tasks & Acceptance

**Execution:**
- `server/wikiLint/adapters/canonicalSyntax.test.ts` -- add a `describe` with one sweep `it`. Leaf fixtures must cover the serializer's distinctive shapes:
  - empty paragraph (`\`), whitespace-only paragraph, paragraph with `br`, image-only paragraph;
  - heading and empty heading;
  - code_fence with blank and whitespace-only content lines, empty code_fence, code_block;
  - math_block with blank lines, empty math_block;
  - hr, embed, attachment, video;
  - blockquote, empty blockquote, notice, empty notice, toggle, empty toggle;
  - bullet, ordered (`order` 9 for padded markers), alpha and checkbox lists, including empty items, nested lists, and items whose first child is a list;
  - table with empty cells.

  Containers: doc, blockquote, first and middle bullet item, ordered item, padded ordered item, alpha item, checkbox item, notice, toggle, table cell. Cases: each leaf alone and each ordered leaf pair in every container, plus every container nested in every container around each leaf. Skip schema-valid fixtures that fail `Node.fromJSON(schema, json).check()`. Add legacy notice fixtures: a `container_notice` holding each legacy-only leaf (a `code_block`, a `code_fence` with blank and whitespace-only content lines, a `math_block` with blank lines, an `embed`, a `video`, a `table` with empty cells, a `container_toggle`, a nested `container_notice`), alone and followed by a paragraph, and that notice nested in each container. Build these with `Node.fromJSON(schema, json)` without `check()`. Collect failures as `name + Markdown` and assert the failure list is `[]`. Assert that the non-inline node type names seen in valid fixtures equal the schema's non-inline node types. -- This settles DW-1 with evidence and pins the invariant.

**Acceptance Criteria:**
- Given the sweep runs, when every schema-valid fixture is serialized with `toCanonicalMarkdown` and parsed with `parseCanonicalMarkdown`, then no `CanonicalMarkdownError` is thrown.
- Given the server schema, when the sweep finishes, then every non-inline schema node type occurs in at least one valid fixture.
- Given the legacy notice fixtures, when each is built with `Node.fromJSON` without `check()`, serialized with `toCanonicalMarkdown` and parsed with `parseCanonicalMarkdown`, then no `CanonicalMarkdownError` is thrown, and an assertion shows that every legacy-only block type listed in Boundaries occurs in at least one legacy fixture.
- Given `canonicalSyntax.ts`, when the change is complete, then the file is byte-identical to its baseline, and the existing CR-guard and unmapped-block tests still pass.

## Spec Change Log

- 2026-10-04, operator decision on the escalated follow-up review (option A): the intent-contract boundary is widened from schema-valid fixtures only to schema-valid fixtures plus the legacy notice shapes production still loads. Reason: the review showed the premise "combinations the schema rejects cannot be stored" is false for notices, because `DocumentHelper.toProsemirror` uses `Node.fromJSON` without `check()` and notices allowed `block+` before commit `3b43460a0`; the review reported 846 such fixtures passing at that time. Changed: Intent (Approach), Boundaries (Always), the I/O matrix (new row), Code Map (two entries), Tasks (legacy fixtures) and Acceptance Criteria (one new criterion). Everything under Never is unchanged, so `canonicalSyntax.ts` stays untouched.

## Review Triage Log

### 2026-10-04 — Review pass
- verdicts: 23 findings — high 0, medium 0, low 19, false 4, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind Hunter: a leaf or container whose fixtures all fail `check()` drops out silently; coverage is asserted per node type only. — Real only after a future schema change; today every leaf and container yields valid fixtures. The guard adds sets and an assertion for a case developers are unlikely to meet.
  - `[low]` `[patch]` Blind Hunter: the skip premise "cannot be stored" is unchecked. — Verified: `DocumentHelper.toProsemirror` (`DocumentHelper.tsx:89-99`) uses `Node.fromJSON` without `check()`, and notices allowed `block+` before `3b43460a0` (2023-07-29). Patched the false code comment to "The sweep covers only content the current schema accepts." Widening the sweep to schema-rejected fixtures contradicts the frozen intent-contract boundary, so it is recorded as a residual risk instead.
  - `[low]` `[reject]` Blind Hunter: the sweep pins the invariant only through the current throw; 7 fixtures parse to zero blocks. — The intent keeps the throw and pins through it; replacing the throw is a deliberate change that must revisit the sweep. The vacuous fixtures are harmless because other fixtures cover the same shapes. A direct token-map walk adds logic for an unlikely case.
  - `[low]` `[patch]` Blind Hunter: no leaf has text containing `\n`, the soft-break shape. — Added leaves `paragraph with blank lines` (`"a\n\n \t\nb"`) and `heading starting with newlines` (`"\n \nH"`).
  - `[low]` `[patch]` Blind Hunter: no `outer(inner(leaf), next)` fixture; header cells hold only fixed paragraphs. — Added `wrap([...wrapInner([leaf]), paragraph("after")])`. The header-cell part does not reach `blockPosition`, because blocks below a row take the row position.
  - `[low]` `[reject]` Blind Hunter: Design Notes cite numbers from an uncommitted probe. — The fix is to edit this build's spec. The committed sweep's own counts are recorded under Auto Run Result.
  - `[low]` `[reject]` Blind Hunter: about 820 duplicate fixtures, because `doc` is also an inner container. — Only cosmetic (runtime and duplicate names on failure). Removing them adds a branch.
  - `[low]` `[reject]` Blind Hunter: the Verification mutation does not model a blank-line map, and the identity check is listed before it. — The fix is to edit this build's spec. In practice the identity check was rerun after the mutation was reverted (exit 0).
  - `[low]` `[reject]` Blind Hunter: Code Map line anchors are off (tokenizer at `lintTokenizer.ts:189`, `parseCanonicalMarkdown` at `canonicalSyntax.ts:252`). — Confirmed, but the fix is to edit this build's spec.
  - `[low]` `[reject]` Blind Hunter: a broad regression would print thousands of failures. — Matters only during a regression. Capping the output adds logic.
  - `[false]` `[reject]` Blind Hunter: the spec does not say how DW-1 is closed. — The invocation intent assigns ledger resolution to the orchestrator and forbids editing the ledger.
  - `[low]` `[reject]` Edge Case Hunter: a named leaf or container wrapper failing `check()` everywhere is dropped silently. — Same root cause and reasoning as the first Blind Hunter row.
  - `[low]` `[patch]` Edge Case Hunter: no leaf is ever a toggle title. — Added container `toggle title` with the blocks as the toggle's whole content; schema-rejected titles are skipped.
  - `[low]` `[patch]` Edge Case Hunter: upper-alpha, past-`z` alpha markers and checked checkbox items are not swept. — Added list kind `upper alpha` (`order: 26`, markers `Z.`, `AA.`); every second checkbox item is now checked.
  - `[low]` `[patch]` Edge Case Hunter: legacy notice content reaches the serializer but is never swept. — Grouped with the "cannot be stored" row: comment corrected; the coverage widening is blocked by the frozen contract and recorded as a residual risk.
  - `[low]` `[patch]` Verification Gap: the sweep skips the legacy notice shapes production still reads (846 fixtures, all passing via `fromJSON` today). — Grouped with the "cannot be stored" row; same action.
  - `[low]` `[patch]` Verification Gap: the "padded ordered item" container loses its padding to `trim()` at document level. — The container now places `paragraph("before")` ahead of the list, so ` 9.` survives.
  - `[false]` `[reject]` Verification Gap: table-cell fixtures never call `blockPosition`. — By design (`canonicalSyntax.ts` gives blocks below a row the row position); those fixtures still exercise the table, `tr` and serializer paths.
  - `[low]` `[patch]` Intent Alignment: the `check()` filter narrows inputs to schema-valid content (reading B1 vs B2). — Grouped with the "cannot be stored" row; same action.
  - `[false]` `[reject]` Intent Alignment: attribute and inline-content values are mostly single-valued. — The intent scopes the sweep to block node types; attribute values that change line structure (padding, alpha, empty content, newlines) are swept.
  - `[low]` `[reject]` Intent Alignment: the test observes no-throw rather than token maps, and the pin depends on the throw. — Same root cause and reasoning as the "pins only through the current throw" row.
  - `[low]` `[reject]` Intent Alignment: the "none exists" evidence partly lives in spec prose. — The fix is to edit this build's spec. The committed sweep is the evidence the intent requests.
  - `[false]` `[reject]` Intent Alignment: the intent's expectations live at the production readers, while the test exercises the unit pair. — The intent explicitly asks for a collocated sweep in `canonicalSyntax.test.ts`, and the readers call the same pair (`wikiReader.ts:193-200`, `documentReader.ts:334-335`).

### 2026-10-04 — Follow-up review pass
- verdicts: 10 findings — high 0, medium 0, low 9, false 1, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind Hunter: a named leaf or container can lose all valid fixtures while node-type coverage still passes. — Carried from the previous silent per-leaf drop row; the code still filters with `check()` and asserts node types, and the previously recorded low verdict and reject route stand.
  - `[low]` `[patch]` Blind Hunter: stored legacy notice shapes are excluded by `check()`. — Carried from the previous skip-premise row; its comment correction remains, and the schema-valid intent boundary still excludes legacy invalid content. No patch was applied in this pass.
  - `[low]` `[reject]` Blind Hunter: the test does not assert mapped tokens and empty fixtures may parse to zero blocks. — Carried from the previous throw-dependent pin row; the unchanged throw is the specified observable and other fixtures cover the shapes.
  - `[low]` `[reject]` Blind Hunter: the current spec lacks `## Auto Run Result` while its log cites it. — Verified before finalization; this pass writes a fresh result below. The proposed fix edits this build's spec, so the finding is rejected under the review rule.
  - `[low]` `[reject]` Blind Hunter: Code Map line anchors are inaccurate. — Carried from the previous Code Map row; correcting this build's spec is excluded by the review rule.
  - `[low]` `[reject]` Blind Hunter: the earlier mutation proves detection of broad mapped-token failure, not a blank-line mapping specifically. — Carried from the previous mutation-wording row; changing the verification plan edits this build's spec.
  - `[low]` `[reject]` Edge Case Hunter: a named leaf or wrapper could be filtered out entirely. — Carried from the previous silent per-leaf drop row; the code and low-risk assessment are unchanged.
  - `[low]` `[patch]` Verification Gap: legacy notice content can reach Wiki readers but is filtered out by this sweep. — Carried from the previous verification-gap row; the same `check()` filter remains. No patch was applied in this pass because widening fixtures needs an intent-boundary decision.
  - `[low]` `[patch]` Intent Alignment: the broad DW-1 question reaches production content outside the curated schema-valid fixtures. — Carried from the previous narrowed-input row; the explicit acceptance surface is the public serializer/parser pair for schema-valid fixtures. No patch was applied in this pass.
  - `[false]` `[reject]` Intent Alignment: the ledger diff breaches this story's no-ledger-edit boundary. — The ledger is owned and changed by the orchestrator; this run did not edit, reopen, rewrite, or stage its entries. Its bookkeeping is outside this story's reviewed change.

### 2026-10-04 — Review pass
- verdicts: 25 findings — high 0, medium 0, low 19, false 6, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind Hunter: the spec quotes the current notice content without `code_block | code_fence`, so those two are not legacy-only and their legacy fixtures and `arrayContaining` check prove nothing new. — Confirmed: `shared/editor/nodes/Notice.tsx:41-42` allows both since `eda023c90` (2023-08-01, an ancestor of the baseline). No coverage is lost, because schema-valid `notice(code …)` fixtures already sweep those shapes. The only fix is to edit this build's spec.
  - `[low]` `[patch]` Blind Hunter: `video` and `container_toggle` were added after `3b43460a0`, so the claim that notices could store them under `block+` is false. — Confirmed: `f4fd9dae5` (2023-09-28) and `e9ed1ba5d` (2026-01-27). Reworded the test's doc comment above `legacyNoticeTypes` so it makes no historical claim. The spec text is a spec edit and was not made.
  - `[low]` `[reject]` Blind Hunter: `legacyNoticeTypes` is hard-coded and nothing checks it against the schema. — Drift needs a future change to the notice content rule. The fix adds assertions, and an assertion that each legacy fixture fails the current `check()` would contradict the spec's listed code types.
  - `[low]` `[reject]` Blind Hunter: the test builds legacy fixtures through a `legacySchema` `check()`, while the spec says they are not `check()`ed. — Serialization passes the raw JSON to `toCanonicalMarkdown`, which uses unchecked `Node.fromJSON(schema, …)` as production does (`DocumentHelper.tsx:89-99`). The `legacySchema` check only implements the spec's "any other combination the schema rejects is skipped". The fix is to edit this build's spec.
  - `[low]` `[reject]` Blind Hunter: legacy coverage misses pairs, siblings after the notice and nesting inside the notice. — A throwaway probe (reverted, file restored byte-identical) retried every generated fixture that failed the current schema against `legacySchema`. It swept 1,224 more legacy shapes, including pairs, two-level nesting and trailing siblings, with 0 throws. A regression that hits only those shapes is unlikely, and the fix is a generator rework, not a direct correction.
  - `[false]` `[reject]` Blind Hunter: the diff edits the forbidden ledger and closes DW-1 before review. — The ledger hunk was staged before this session started, identical to `refs/attempt-preserve-dirty/20261004-001506-b478-3ddf6aad-0`, and the orchestrator writes it at `sweep-bundle-closed`. This run did not edit, stage or commit it.
  - `[low]` `[reject]` Blind Hunter: the Verification section still compares against `d68c67baa`, has no legacy step, and the Auto Run Result is missing. — `d68c67baa` is still the correct pre-DW-1 baseline for `canonicalSyntax.ts`, and the comparison passes, as does the one against `3ddf6aad9`. The mutation run named legacy fixtures, and the Auto Run Result is written below. Any remaining fix edits this build's spec.
  - `[false]` `[reject]` Blind Hunter: the spec does not say whether other historical block shapes need the same treatment. — In the history of `shared/editor/nodes` content expressions, notice (`3b43460a0`) is the only block container ever made stricter. `a70a67235` and `da1905455` widened list items and cells to `block+`, and `7421a9fbd` is inline. No other stored block shape is excluded.
  - `[false]` `[reject]` Blind Hunter: unquoted `baseline_revision` could parse as a number. — `3ddf6aad923302b0d785dc670dc673eefaaffac5` has many letters, so YAML reads it as a string. This was verified by parsing the frontmatter at finalization.
  - `[low]` `[reject]` Blind Hunter: the Code Map anchor `canonicalSyntax.test.ts:1-50,431` and its import note are out of date. — Confirmed, but the fix is to edit this build's spec.
  - `[low]` `[reject]` Edge Case Hunter: a legacy notice holding a nested notice or table around a leaf is not swept. — Same root cause as the narrower-coverage row. The probe swept `notice(notice(…))` and `notice(table cell(…))` with 0 throws.
  - `[low]` `[reject]` Edge Case Hunter: a legacy leaf after a sibling, or two legacy leaves together, is not swept. — Same root cause as the narrower-coverage row. The probe swept `notice(first, second)` pairs with 0 throws.
  - `[low]` `[reject]` Edge Case Hunter: a block after the legacy notice, or the notice two containers deep, is not swept. — Same root cause as the narrower-coverage row. The probe swept `outer(notice(…), after)` and `outer(inner(…))` with 0 throws.
  - `[low]` `[reject]` Edge Case Hunter: the spec misstates the current notice content (code types). — Same root cause as the first row. The only fix is a spec edit.
  - `[low]` `[patch]` Edge Case Hunter: the spec and test treat `video` and `container_toggle` as `block+`-era shapes. — Same root cause and fix as the second row: the test comment was reworded.
  - `[low]` `[reject]` Edge Case Hunter: the legacy fixtures are checked against `legacySchema`, and `toggle title(legacy notice(…))` is silently skipped. — Same root cause as the `legacySchema` row. Skipping that shape is the spec's "any other combination the schema rejects is skipped".
  - `[low]` `[reject]` Verification Gap (other): the spec and test comment use the wrong current notice expression, so the code-type legacy fixtures duplicate valid ones. — Same root cause as the first row. The reworded comment no longer makes any historical claim, and the spec edit is excluded.
  - `[low]` `[reject]` Verification Gap (other): the spec and test disagree on how legacy fixtures are built. — Same root cause as the `legacySchema` row.
  - `[low]` `[reject]` Intent Alignment: the invariant is observed only through the throw, never through `token.map`, and table cells are invisible. — carried: the earlier "observes no-throw rather than token maps" row. The code still pins through the unchanged throw, so the low verdict and reject route stand.
  - `[false]` `[reject]` Intent Alignment: production passes a `Document` or Yjs state, while the test passes JSON. — Every route ends in `Node.fromJSON(schema, …)` on ProseMirror JSON (`DocumentHelper.tsx:89-99`), so the same JSON gives the same serializer input.
  - `[false]` `[reject]` Intent Alignment: the production-reachable slice covers notices only. — Same evidence as the "other historical block shapes" row: notice is the only block container ever made stricter.
  - `[low]` `[patch]` Intent Alignment: the legacy-only type list does not match history (code types current; `video` and toggle are newer). — Same root causes as the first two rows: the test comment was reworded, and the spec parts are excluded spec edits.
  - `[low]` `[reject]` Intent Alignment: legacy fixtures are admitted through a `legacySchema` `check()` that also relaxes the outer notice wrapper. — Same root cause as the `legacySchema` row. Relaxing the outer notice admits only notice-in-notice, which is itself a legacy shape.
  - `[low]` `[reject]` Intent Alignment: legacy coverage is shallower, and `legacySeen` also counts children of the outer notice wrapper. — Same root cause as the narrower-coverage row and its probe. The leaves `notice` and `empty notice` sit directly in a legacy notice in `doc(legacy notice(notice))`, so the count holds without the wrapper.
  - `[false]` `[reject]` Intent Alignment: the diff changes the ledger. — Same refutation as the ledger row: the hunk is pre-existing orchestrator bookkeeping that this run did not touch.

### 2026-10-04 — Follow-up review pass
- verdicts: 17 findings — high 0, medium 0, low 17, false 0, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind Hunter: the contract omits `code_block` and `code_fence` from the current notice expression. — Carried: `Notice.tsx` allows both; correcting this build's spec is excluded by the review rule.
  - `[low]` `[reject]` Blind Hunter: `video` and `container_toggle` postdate the former `block+` notice rule. — Carried: the test comment makes no historical claim; correcting the contract would edit this build's spec.
  - `[low]` `[reject]` Blind Hunter: the test counts currently valid code blocks as legacy notice types. — Carried: schema-valid notice fixtures already exercise them, and the extra fixtures do not hide a failure; changing the list requires a contract correction.
  - `[low]` `[reject]` Blind Hunter: the `legacySchema.check()` filter differs from the contract's unchecked fixture wording. — Carried: serialization still passes raw JSON through unchecked `Node.fromJSON(schema, ...)`; the filter limits generated combinations to the former notice content rule.
  - `[low]` `[reject]` Blind Hunter: two legacy leaves or a preceding paragraph inside one notice are absent. — Carried: a prior throwaway probe exercised 1,224 additional legacy shapes without a throw; extending the generator is disproportionate for this low-risk adjacency gap.
  - `[low]` `[reject]` Blind Hunter: `legacySeen` does not assert every generated variant survives filtering. — The generator creates the promised variants, but a future schema change could filter one class silently; guarding each variant adds bookkeeping for speculative drift.
  - `[low]` `[reject]` Blind Hunter: the test does not directly assert token maps. — Carried: the specified observable is the existing `blockPosition` throw; the mutation check below proves the sweep fails when mapped blocks start on blank lines.
  - `[low]` `[reject]` Edge Case Hunter: a legacy leaf following another block in the same notice is not swept. — Carried with the adjacency gap and the 1,224-shape probe; an added generator branch is not justified by the observed behavior.
  - `[low]` `[reject]` Edge Case Hunter: a legacy leaf nested in a block container within a notice is not swept. — Carried with the narrower-coverage row; the prior probe exercised nested notice and table shapes without throws.
  - `[low]` `[reject]` Edge Case Hunter: a block after the legacy notice in its outer container is not swept. — Carried with the narrower-coverage row; the prior probe exercised trailing siblings without throws.
  - `[low]` `[reject]` Edge Case Hunter: `legacySchema.check()` may skip stored shapes. — Carried: it gates generated fixtures, while the production-like serializer call receives unchecked raw JSON; changing this boundary would require revising the contract.
  - `[low]` `[reject]` Edge Case Hunter: the contract calls currently valid code types legacy-only. — Carried: the current notice expression proves the wording inaccurate; the fix edits this build's spec.
  - `[low]` `[reject]` Edge Case Hunter: the contract treats newer video and toggle types as former `block+` shapes. — Carried: their creation history disproves that provenance; the test comment is already neutral and the remaining fix edits this build's spec.
  - `[low]` `[reject]` Verification Gap: the contract's current notice expression excludes code types that the schema allows. — Carried: the reviewer found no new test verification gap; this is the same contract wording error.
  - `[low]` `[reject]` Intent Alignment: legacy fixture selection uses `legacySchema.check()` despite the unchecked wording. — Carried: the selection mechanism differs, while the tested public serializer/parser path remains the specified one.
  - `[low]` `[reject]` Intent Alignment: the finite sweep cannot prove the invariant for every possible stored document or inspect token maps directly. — Carried: the intent asks for deterministic fixtures and the unchanged throw as the observable, and the targeted mutation makes that observable fail.
  - `[low]` `[reject]` Intent Alignment: the contract's historical classification differs from the current schema. — Carried: the same inaccurate code-type wording remains in the protected intent contract; correcting this build's spec is excluded by the review rule.

## Design Notes

Planning evidence: a throwaway probe serialized and parsed 40,149 schema-valid documents covering 37 leaf shapes × 11 containers (pairs, nesting, trailing siblings). It produced 339,466 syntax nodes and 0 throws. Mechanism: the markdown-it block tokenizer skips empty lines before invoking any rule. A raw whitespace-only line is empty in every list and blockquote context. Custom block rules map from their marker line. The core rules (`breaks`, `links`, `checkboxes`, `tables`, mentions) create tokens without maps, or nested-parse inside cells, where positions are taken from the row. A blank-start block is therefore unreachable from canonical Markdown, and the throw stays as a guard, not a degraded `null`.

## Verification

**Commands:**
- `scripts/test-db.sh ensure` -- expected: exit 0.
- `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint/adapters/canonicalSyntax.test.ts` -- expected: all pass; the sweep finishes in a few seconds.
- `corepack yarn tsc` -- expected: exit 0.
- `node_modules/.bin/oxlint --type-aware server/wikiLint/adapters/canonicalSyntax.test.ts` and `node_modules/.bin/oxfmt --check server/wikiLint/adapters/canonicalSyntax.test.ts` -- expected: clean.
- `git diff --exit-code d68c67baae16ae7f1b2bff4f69d5d4179d1fe776 -- server/wikiLint/adapters/canonicalSyntax.ts` -- expected: exit 0.
- Temporary mutation, reverted afterwards: make `blockPosition` throw for every mapped token at line index ≥ 1 -- expected: the sweep fails and names fixtures.

## Auto Run Result

Status: done

**Summary:** The committed DW-1 test sweeps schema-valid blocks and specified notice fixtures through `toCanonicalMarkdown` and `parseCanonicalMarkdown`. This follow-up review made no code changes. The sweep still finds no canonical output that triggers the blank-start guard, which remains unchanged.

**Files changed:**
- `server/wikiLint/adapters/canonicalSyntax.test.ts` — committed fixture sweep reviewed in this pass.
- `_bmad-output/implementation-artifacts/spec-dw-1-canonical-block-blank-line-position.md` — follow-up triage and verified result.

**Review findings:** 17 findings: high 0, medium 0, low 17, false 0, maybe-false 0. Patches applied: 0. Items deferred: 0. All 17 were rejected for the individual reasons recorded in the Follow-up review pass above: the current-schema and historical wording errors require editing this build's intent contract; the legacy fixture selection still tests unchecked raw JSON; the untested adjacency and per-variant coverage cases are low-risk extensions after the earlier 1,224-shape probe found no throw; and direct token-map assertions are outside the specified throw-based observable. Patched entries by verdict: high 0, medium 0, low 0. Follow-up review recommended: false.

**Verification:**
- `scripts/test-db.sh ensure`: exit 0; test database ready.
- `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint/adapters/canonicalSyntax.test.ts`: 58/58 passed, including after the temporary mutation was reverted.
- `corepack yarn tsc`, `oxlint --type-aware` and `oxfmt --check` on the test file: exit 0.
- `git diff --exit-code d68c67baae16ae7f1b2bff4f69d5d4179d1fe776 -- server/wikiLint/adapters/canonicalSyntax.ts`: exit 0 after the mutation was reverted.
- Temporary mutation: mapped tokens starting at line index ≥ 1 were given a whitespace-only source line. The focused sweep failed as expected with 32,586 failures and named legacy fixtures plus their Markdown. The mutation was reverted, the source identity check passed, and the full targeted test file passed again.

**Residual risks:** The intent contract still misquotes the current notice expression and attributes newer node types to the former `block+` era. Its enumerated fixture list remains implemented, including harmless extra code-type fixtures. The test pins the invariant through the existing `CanonicalMarkdownError` guard; replacing that guard would require revisiting the test.

**Run note:** The orchestrator-owned staged change to `deferred-work.md` was present before this pass and was neither edited nor committed here. No `sprint-status.yaml` change was made.
