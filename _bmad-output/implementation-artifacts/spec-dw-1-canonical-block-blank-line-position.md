---
title: 'DW-1: Pin the canonical block start-line invariant'
type: 'chore'
created: '2026-10-04'
baseline_revision: 'd68c67baae16ae7f1b2bff4f69d5d4179d1fe776'
status: 'blocked'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** `blockPosition` in `server/wikiLint/adapters/canonicalSyntax.ts` throws `CanonicalMarkdownError` when a mapped block token starts on a whitespace-only line, failing every rule of the document. DW-1 asks whether any `toCanonicalMarkdown` output reaches that path; nothing pins the answer.

**Approach:** Planning settled it: no serializer output reaches the throw (see Design Notes). Keep the throw unchanged and add a collocated, deterministic fixture sweep to `canonicalSyntax.test.ts`. The sweep serializes every schema block node type, alone, paired and nested in every block container, then parses the canonical Markdown. It fails on any `CanonicalMarkdownError` and on any non-inline schema node type the fixtures leave uncovered.

## Boundaries & Constraints

**Always:** Fixtures are ProseMirror JSON that passes `Node.check()` against the server `schema`; combinations the schema rejects are skipped, because they cannot be stored. The sweep goes through the public `toCanonicalMarkdown` → `parseCanonicalMarkdown` surface. A failure message names the fixture and its Markdown. The test stays deterministic: no randomness and no LLM.

**Never:** Do not change `canonicalSyntax.ts`. The blank-line throw, the CR guard and every other `CanonicalMarkdownError` path stay unchanged. Do not change the serializer, the tokenizer or markdown-it rules. Do not create a new test file or directory. Do not edit the deferred-work ledger.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sweep passes | every schema-valid fixture | `parseCanonicalMarkdown(await toCanonicalMarkdown(doc))` returns without throwing | No error expected |
| Blank-start regression | a future serializer/rule change maps a block to a whitespace-only line | sweep fails and lists the fixture name and Markdown | test failure, not a silent pass |
| New block type | a non-inline node type added to `schema` without a fixture | coverage assertion fails | test failure |

</intent-contract>

## Code Map

- `server/wikiLint/adapters/canonicalSyntax.ts:65-82` -- `blockPosition`: reads `lines[token.map[0]]` and throws on a whitespace-only or missing line. Read-only.
- `server/wikiLint/adapters/canonicalSyntax.ts:274-330` -- `parseCanonicalMarkdown`: calls `blockPosition` only for blocks outside table rows. Blocks below a `tr` take the row position, so cell-relative nested-parse maps are never read.
- `server/wikiLint/adapters/lintTokenizer.ts:221-224` -- tokenizer = server rules plus a read-only link observer. Read-only.
- `shared/editor/rules/alphaLists.ts:12-53` -- the only rule that rewrites `state.src`. It is line-preserving and fires only on lines that hold a letter marker, so blankness is unchanged. Read-only.
- `shared/editor/rules/math.ts:187` -- the only custom rule that sets `token.map`, to `[start, …]` on the `$$` line. `markdown-it-container` (notices `:::`, toggles `+++`) maps from the marker line. Read-only.
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

  Containers: doc, blockquote, first and middle bullet item, ordered item, padded ordered item, alpha item, checkbox item, notice, toggle, table cell. Cases: each leaf alone and each ordered leaf pair in every container, plus every container nested in every container around each leaf. Skip fixtures that fail `Node.fromJSON(schema, json).check()`. Collect failures as `name + Markdown` and assert the failure list is `[]`. Assert that the non-inline node type names seen in valid fixtures equal the schema's non-inline node types. -- This settles DW-1 with evidence and pins the invariant.

**Acceptance Criteria:**
- Given the sweep runs, when every schema-valid fixture is serialized with `toCanonicalMarkdown` and parsed with `parseCanonicalMarkdown`, then no `CanonicalMarkdownError` is thrown.
- Given the server schema, when the sweep finishes, then every non-inline schema node type occurs in at least one valid fixture.
- Given `canonicalSyntax.ts`, when the change is complete, then the file is byte-identical to its baseline, and the existing CR-guard and unmapped-block tests still pass.

## Spec Change Log

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

Status: blocked

**Summary:** The follow-up review found no new code changes to make under the schema-valid intent contract. The collocated sweep remains the implementation of DW-1; `canonicalSyntax.ts` is unchanged from the baseline.

**Files changed in this pass:** `_bmad-output/implementation-artifacts/spec-dw-1-canonical-block-blank-line-position.md` — follow-up triage and verification result. The previously committed implementation is in `server/wikiLint/adapters/canonicalSyntax.test.ts`. The orchestrator-owned ledger change was not edited or staged by this run.

**Review findings:** 10 findings: 9 low and 1 false. No patch was applied in this pass; no new deferred item was added. Eight findings carry earlier verdicts and routes, the missing-result issue is addressed by this finalization but rejected under the review rule, and the ledger finding is false because that file is orchestrator-owned. Patched entries by verdict in this pass: high 0, medium 0, low 0. Follow-up review recommended: false.

**Verification:** `scripts/test-db.sh ensure` exited 0. Targeted Vitest passed 58/58 tests. `corepack yarn tsc`, type-aware `oxlint`, `oxfmt --check`, and the baseline comparison for `canonicalSyntax.ts` all exited 0. The prior pass's temporary mutation was not repeated because the implementation code did not change in this pass.

**Residual risk:** The sweep excludes stored legacy notice content that fails the current schema's `Node.check()`. Extending coverage requires a decision to widen the intent contract. The pin also depends on the existing `blockPosition` throw continuing to report blank-start mappings.

**Blocking condition:** The workflow requires a clean working tree after committing reviewed files. The deferred-work ledger has a pre-existing orchestrator-owned modification that this run is forbidden to change or commit, so that gate cannot pass here.
