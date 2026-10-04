---
title: 'DW-7: Reconcile the README visible-metadata example and the SPEC with the canonical `* ` bullet marker'
type: 'chore'
created: '2026-10-04'
status: done
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      server/tools/README.md does not tell authors that their own `- ` bullets are stored and fetched as `* `, so a patch findText written from their input instead of the fetched Markdown still misses.
    evidence: |-
      Patch findText is an indexOf over serializeWithPositions output (DocumentHelper.tsx:668-683), and BulletList.toMarkdown always writes `* `. DW-7 fixes only the copied example; metadata an agent writes itself with `- ` behaves as before. Pre-existing, not caused by this change, and outside the 2026-10-04 decision, which covers the example and the SPEC record.
    location: >-
      server/tools/README.md:119-140
    severity: low
baseline_revision: e749cf9a33dbcd2e8e812bec1c3454b09b09f039
---

<intent-contract>

## Intent

**Problem:** `server/tools/README.md` (a binding companion of the SPEC) shows visible metadata as `- Status: Active` / `- Last verified: 2026-09-20` and calls it the shape that survives the Markdown/ProseMirror round trip. On `v1.10.1` the serializer emits every bullet as `* `, so the example comes back as `* Status: Active`; it still lints clean, but an agent that copies it as `update_document` `patch` `findText` misses. The SPEC does not yet record how Story 1.10 AC5 was interpreted.

**Approach:** Per the human decision of 2026-10-04 (option 1, "Apply README and SPEC reconciliation"), change every bullet of the README example to `* `, and add one Constraints bullet to the binding SPEC: canonical `* ` bullets round-trip byte-identically, while `- ` input lints clean and converges to `* ` (the Story 1.10 AC5 interpretation). No code change.

## Boundaries & Constraints

**Always:**
- The README example keeps its heading, field names, values and order. Only the three bullet markers change from `- ` to `* ` (`Authority: Repository` included, since a marker change inside one list starts a new list and breaks the round trip).
- The SPEC addition states only what the decision says and what the Story 1.10 HTTP suite proves. It is one bullet under `## Constraints`, in the SPEC's existing voice, with no workspace-specific values.
- Append one `(change)` line to the spec folder's `.memlog.md` that records this authorized amendment, matching its existing `(change)` entries.
- The work is already committed on the branch (README, SPEC, memlog). A modified `deferred-work.md` is the orchestrator's own pending ledger transaction, not this story's change. It does not fail the clean-tree gate: finalize the story without staging, editing, reverting or committing that file, and leave the orchestrator to commit it.

**Never:**
- Change code, tests, the serializer, `epics.md`, the PRD, its addendum, the Architecture Spine or `AGENTS.md`.
- Edit the done Story 1.10 spec or any other existing implementation-artifact spec.
- Edit the deferred-work ledger or `sprint-status.yaml`.
- Add claims the decision does not make, such as forbidding a future serializer change.

</intent-contract>

## Code Map

- `server/tools/README.md:119-139` -- "Templates and visible metadata". The example block is at `:129-135`; lines `:132-134` carry the `- ` markers.
- `_bmad-output/specs/spec-outline-mcp-wiki-linting/SPEC.md:49-60` -- `## Constraints`. The new bullet goes after the "Keep workspace-specific schemas…" bullet (`:57`), which already governs examples and generic documentation.
- `_bmad-output/specs/spec-outline-mcp-wiki-linting/.memlog.md` -- the last two lines are the existing `(change)` entries to match. Frontmatter `updated:` (`:3`) is bumped with each amendment (commit `6ac3b470d` moved it to `2026-09-30T16:24` with its `(change)` entries).
- `shared/editor/nodes/BulletList.ts:40-42` (read-only evidence) -- `toMarkdown` emits `(node.attrs.bullet || "*") + " "`, and the node schema (`:17-24`) declares no `bullet` attribute, so every plain bullet-list item serializes as `* `. `shared/editor/nodes/CheckboxList.ts:100-102` (read-only) emits checklist items with `- ` (`- [ ] …`), so a marker claim must be scoped to plain bullet lists.
- `.oxfmtrc.json`, `package.json` `format` / `format:check` (`oxfmt app server shared plugins`) (read-only) -- the declared formatter. It formats the fenced `markdown` block and rewrites `* ` bullets to `- `; a `<!-- prettier-ignore -->` line directly above the fence stops that. Prettier is not installed.
- `shared/editor/lib/markdown/serializer.ts:66-83` (read-only) -- `serialize` (fetch, lint) and `serializeWithPositions` (patch `findText`) share `renderContent`, so the fetched example is also the text `findText` matches.
- `server/routes/mcp/wikiLint.test.ts:1675-1706` (read-only evidence) -- "round trip": `- ` input fetches as the canonical `METADATA` (`:203`, `* ` bullets), `METADATA` fetches byte-identically, and both lint `complete`, `clean`, with no Errors or Warnings.
- `_bmad-output/implementation-artifacts/spec-1-10-accept-the-complete-read-only-lint-and-repair-loop.md:364-367` (read-only) -- the recorded AC5 deviation this change promotes into the SPEC.
- `_bmad-output/planning-artifacts/epics.md` Story 1.10 AC5 (read-only) -- "canonical visible metadata … remain valid and stable"; already consistent, no edit.

## Tasks & Acceptance

**Execution:**
- `server/tools/README.md` -- Replace `- Status: Active`, `- Last verified: 2026-09-20`, `- Authority: Repository` with the same lines using `* `. Between the blank line after "round trip, for example:" and the fence, insert exactly these two lines, in this order, so the directive sits directly above the fence:
  - `` <!-- Keep `* `: Outline emits plain bullet-list markers as `* `, and the formatter would rewrite them to `- `. --> ``
  - `<!-- prettier-ignore -->`

  -- The example then is the canonical form that round-trips byte for byte. Without the directive, `oxfmt` rewrites the fenced bullets back to `- ` and `yarn format:check` fails on the README; the first comment says why the directive must stay.
- `_bmad-output/specs/spec-outline-mcp-wiki-linting/SPEC.md` -- Add exactly this Constraints bullet after the "Keep workspace-specific schemas…" bullet:

  ```markdown
  - On the selected baseline, canonical visible metadata is one list of `* ` bullets with no blank lines between items, the form the Markdown serializer writes for it; it round-trips byte-identically with stable diagnostic coordinates. Equivalent `- ` input lints clean and converges to that canonical form instead of round-tripping byte for byte. This is the binding interpretation of Story 1.10 AC5 in `epics.md`.
  ```

  -- Records the decision in the binding contract. Every claim in it is one the decision makes or the "round trip" HTTP suite proves (`wikiLint.test.ts:1675-1740`: the single tight `* ` list `METADATA` fetches byte-identically, `- ` input fetches as `METADATA` and lints clean, and a re-save keeps the Finding location). It makes no claim about checklists, loose lists or several adjacent lists, which the suite does not cover (adjacent lists serialize with two blank lines between them, `serializer.ts:439-440`, and do not round-trip byte for byte). "Story 1.10 AC5" is the one in `epics.md`, not the done Story 1.10 spec's literal `- ` wording.
- `_bmad-output/specs/spec-outline-mcp-wiki-linting/.memlog.md` -- Append one `(change)` line naming DW-7 and the 2026-10-04 decision; it mentions the new SPEC Constraints bullet, the README `* ` example and its `<!-- prettier-ignore -->` directive. Set frontmatter `updated:` to the current local time on 2026-10-04 in the existing `YYYY-MM-DDTHH:MM` format. -- Provenance for the amendment, matching how earlier amendments updated the file.

**Acceptance Criteria:**
- Given the edited README, when its visible-metadata example is created through MCP `create_document` and fetched on `v1.10.1`, then the fetched Markdown equals the example byte for byte (the "round trip" suite proves this for the `* ` form).
- Given the edited SPEC, when a reader looks for how AC5 treats `- ` bullets, then one Constraints bullet states that `* ` is canonical and round-trips byte-identically, and that `- ` input lints clean and converges to `* `.
- Given the change set, when it is diffed against the baseline revision, then only `server/tools/README.md`, `SPEC.md`, `.memlog.md` and this spec file differ.

## Spec Change Log

### 2026-10-04 — Loopback 1 (review pass 1)
- **Triggering findings:** the prescribed SPEC bullet claimed the serializer "emits every bullet as `* `", which is false for checklists (`CheckboxList.ts:101` emits `- [ ]`); "canonical visible metadata uses `* ` bullets" read as if any `* ` list round-trips, but a loose or differently spaced list does not; "Story 1.10 AC5" did not say which document (`epics.md` or the done story spec, whose AC5 literally requires `- `); the bare `<!-- prettier-ignore -->` had no stated reason, so a maintainer could drop it and `yarn format` would silently revert DW-7; the memlog task did not ask for the frontmatter `updated:` bump earlier amendments made.
- **Amended:** Code Map (checklist serializer, `oxfmt` behaviour, shared `renderContent`, memlog `updated:`); the README, SPEC and memlog execution tasks (exact explanatory comment and directive order, exact SPEC bullet text, memlog `updated:` and directive mention); the manual check.
- **Known-bad state avoided:** a binding SPEC sentence that is false for checklists, ambiguous about "canonical" and about which AC5 it interprets; an unexplained formatter directive; a stale memlog timestamp.
- **KEEP:** all three README markers change to `* ` with heading, fields, values and order unchanged; the directive sits directly above the fence; the SPEC bullet stays one bullet placed right after the "Keep workspace-specific schemas…" bullet; one memlog `(change)` line in the style of the existing ones; no code, test, ledger or sprint-status change; the temporary README probe is run and then reverted.

### 2026-10-04 — Loopback 2 (review pass 2)
- **Triggering findings:** the prescribed README comment ("Outline serializes bullets as `* `") repeated the over-broad claim loopback 1 removed from the SPEC, since checklists serialize with `- `; the prescribed SPEC note "(checklist items keep `- [ ]`)" omitted checked items (`- [x]`, `CheckboxItem.ts:105`) and "keep" wrongly implied the input marker survives (`* [ ]` input is also written as `- [ ]`).
- **Amended:** the exact README comment text ("Outline emits plain bullet-list markers as `* `"); the exact SPEC bullet's checklist clause ("checklist items are emitted as `- [ ]` or `- [x]`") and its rationale line. An `oxfmt --check` of the new comment shape passes.
- **Known-bad state avoided:** README and SPEC wording that is false for checklists or implies checklist input markers are preserved.
- **KEEP:** everything listed under loopback 1's KEEP; the memlog `updated:` bump and the directive mention in the memlog line; the exact remaining SPEC bullet wording ("Canonical visible metadata is that serialized form…", "Story 1.10 AC5 in `epics.md`").

### 2026-10-04 — Loopback 3 (review pass 3)
- **Triggering findings:** the prescribed SPEC bullet broke this spec's own Always rule (state only what the decision says and what the Story 1.10 HTTP suite proves): its checklist clause rested on code reading alone, and "canonical visible metadata is that serialized form and round-trips byte-identically" is false for several adjacent lists, which serialize with two blank lines between them (`serializer.ts:439-440`) and come back as one loose list.
- **Amended:** the exact SPEC bullet text and its rationale line. The bullet now defines canonical metadata as one list of `* ` bullets with no blank lines between items, drops the checklist clause and the "every plain bullet-list marker" generalization, and keeps the round-trip, convergence and `epics.md` AC5 statements. This supersedes the SPEC wording from loopbacks 1 and 2; the README comment from loopback 2 stays.
- **Known-bad state avoided:** a binding SPEC sentence with claims the HTTP suite does not prove, one of them false for adjacent lists.
- **KEEP:** everything listed under the loopback 1 and 2 KEEP entries except the superseded SPEC wording; the README comment text "Outline emits plain bullet-list markers as `* `, and the formatter would rewrite them to `- `."; the memlog line restates the new SPEC wording, not the old one.

## Review Triage Log

### 2026-10-04 — Review pass
- verdicts: 19 findings — high 0, medium 0, low 13, false 6, maybe-false 0
- findings:
  - `[low]` `[bad_spec]` Blind Hunter: the SPEC bullet says the serializer emits every bullet as `* `, but checklists serialize as `- [ ]`. — Confirmed at `shared/editor/nodes/CheckboxList.ts:101`. The wording came verbatim from this spec's SPEC task; amended to "every plain bullet-list marker … (checklist items keep `- [ ]`)".
  - `[low]` `[reject]` Blind Hunter: no committed test pins the three-field README example (with `Authority`); the suite's `METADATA` has two fields. — Real, but the intent says "No code change", which excludes adding tests. The temporary README probe passed (create, fetch byte-identical, clean lint) and was reverted.
  - `[low]` `[bad_spec]` Blind Hunter: "Story 1.10 AC5" is ambiguous between `epics.md` and the done story spec, whose AC5 literally requires `- `. — Confirmed (`spec-1-10-…md:220` vs `epics.md` Story 1.10 AC5). Amended the SPEC task to name `epics.md`.
  - `[low]` `[defer]` Blind Hunter: the README does not explain that authors' own `- ` bullets come back as `* `, so their `patch` `findText` must use the fetched form. — Real but pre-existing: patch `findText` has always matched the serialized document (`DocumentHelper.tsx:668-683`), and this change only fixes the copied example. Moot this pass because of the loopback; re-triage next pass.
  - `[low]` `[bad_spec]` Blind Hunter: the `<!-- prettier-ignore -->` line is unexplained and easy to drop. — Confirmed: without it `oxfmt` rewrites the bullets to `- ` (checked on a scratch copy), and CI does not run `format:check`. Amended the README task to add one explanatory comment above the directive; an `oxfmt --check` of that shape passes.
  - `[low]` `[bad_spec]` Blind Hunter: `.memlog.md` `updated:` was not bumped. — Confirmed: commit `6ac3b470d` bumped it with its `(change)` entries. Amended the memlog task.
  - `[low]` `[reject]` Blind Hunter: DW-12 and retro action item 2 track the same decision and stay open. — Real (`deferred-work.md:98-106`, `sprint-status.yaml:87`), but the intent forbids editing the ledger and the orchestrator records resolution. Recorded as a handoff note in the Auto Run Result.
  - `[false]` `[reject]` Blind Hunter: "`- ` input lints clean" is unproven for enforced writes. — Read-only lint (`documentReader.ts:365`) and enforced validation (`enforcedWrite.ts:204`) both lint `toCanonicalMarkdown` of ProseMirror content, where the marker no longer exists, so both see the same `* ` text; a `findText` miss is a patch error, not a lint result.
  - `[low]` `[bad_spec]` Edge Case Hunter: "canonical" is undefined, so a loose or differently spaced `* ` list would be expected to round-trip but does not. — Confirmed: the serializer writes tight lists. Amended the SPEC task: "Canonical visible metadata is that serialized form".
  - `[low]` `[reject]` Edge Case Hunter: `+ ` markers and mixed markers in one list are not addressed. — Unlikely in practice for metadata, and covering them means adding claims the decision does not make, each needing new evidence.
  - `[low]` `[bad_spec]` Edge Case Hunter: the "every bullet" claim contradicts `CheckboxList.ts:101`. — Same root cause as the first Blind Hunter row; same amendment.
  - `[low]` `[bad_spec]` Edge Case Hunter: memlog `updated:` is older than its newest entry. — Same root cause as the Blind Hunter memlog row; same amendment.
  - `[false]` `[reject]` Intent Alignment: the diff changes the third (`Authority`) line beyond the two quoted lines. — Changing only two markers would split the list in two (a marker change starts a new CommonMark list), so the example would still not round-trip; the whole-example reading is the only one that meets the decision.
  - `[false]` `[reject]` Intent Alignment: the `<!-- prettier-ignore -->` line is not in the intent. — It is what keeps the decided example under the declared formatter (`oxfmt` reverts it otherwise), and it does not render.
  - `[false]` `[reject]` Intent Alignment: the SPEC bullet adds claims beyond the decision (convergence, stable coordinates, serializer premise). — Each is evidenced: convergence and byte identity by `wikiLint.test.ts:1690-1696`, coordinate stability by the same test's re-save case and `epics.md` Story 1.10 AC5; none extends the contract normatively.
  - `[low]` `[bad_spec]` Intent Alignment: the SPEC bullet does not say which AC5 it interprets. — Same root cause as the Blind Hunter AC5 row; same amendment.
  - `[low]` `[reject]` Intent Alignment: patch `findText` and the exact README text have no committed test. — Same as the Blind Hunter test row: the intent excludes code changes. `serialize` and `serializeWithPositions` share `renderContent` (`serializer.ts:66-83`), so the fetched text is what `findText` matches.
  - `[false]` `[reject]` Intent Alignment: `fetch` and patch matching use different serializer entry points, so identity is only inferred. — Both call `state.renderContent(content)` on a fresh `MarkdownSerializerState` (`serializer.ts:66-83`), and `findText` is an `indexOf` substring match.
  - `[false]` `[reject]` Intent Alignment: the artifact-only receipt conditions do not hold. — Not a defect: the change touches tracked files, and this run does not assert the receipt.

### 2026-10-04 — Review pass
- verdicts: 22 findings — high 0, medium 0, low 13, false 9, maybe-false 0
- findings:
  - `[low]` `[bad_spec]` Blind Hunter: the README comment "Outline serializes bullets as `* `" is over-broad; checklists serialize with `- `. — Confirmed (`README.md:129`, `CheckboxList.ts:101`); the text was prescribed verbatim by this spec. Loopback 2 amended the README task to "Outline emits plain bullet-list markers as `* `".
  - `[low]` `[bad_spec]` Blind Hunter: the SPEC checklist note omits `- [x]`, and "keep" implies the input marker survives. — Confirmed: `CheckboxItem.ts:105` writes `[x] `, and `* [ ]` input is also written as `- [ ]`. Loopback 2 amended the SPEC task to "checklist items are emitted as `- [ ]` or `- [x]`".
  - `[low]` `[defer]` Blind Hunter: the README still lacks the `findText` guidance behind DW-7, and the pass-1 defer was never recorded. — carried: same claim as the pass-1 Blind Hunter defer row, which was moot because of loopback 1 and never written. Recorded now in frontmatter `deferred` so it is tracked; it will not be deferred again.
  - `[false]` `[reject]` Blind Hunter: the triage log cites a handoff note in an `## Auto Run Result` section that does not exist. — That section is written at Finalize, after the last review pass; the DW-12 and retro item 2 handoff will be recorded there.
  - `[low]` `[reject]` Blind Hunter: the `git diff --stat` check cannot list the untracked spec file. — Real, but its fix edits this build's spec. `git status --short` shows the full set: the three documents plus this spec.
  - `[low]` `[reject]` Blind Hunter: the three-field README example has no lasting test evidence. — carried: same claim as the pass-1 Blind Hunter test row (the intent says "No code change"). The temporary README probe passed again in this loop.
  - `[false]` `[reject]` Blind Hunter: the SPEC does not point at the done Story 1.10 spec whose AC5 literally requires `- `. — No reader is misled: that spec's own Auto Run Result (`spec-1-10-…md:364-367`) records that literal `- ` byte equality does not hold and that the canonical form round-trips, the same rule the SPEC bullet now binds.
  - `[false]` `[reject]` Blind Hunter: the memlog line does not cite where the decision is recorded. — It names DW-7, a unique ledger id whose entry (`deferred-work.md:53-61`) carries the 2026-10-04 decision lines, so the provenance is findable.
  - `[low]` `[reject]` Blind Hunter: the verification runs bare `yarn vitest` instead of the declared `test:server` script. — Real, but its fix edits this build's spec; the targeted file passed either way.
  - `[low]` `[reject]` Blind Hunter: the Code Map cites `SPEC.md:49-60`, but `## Constraints` starts at line 48. — Real, but its fix edits this build's spec; off by one blank line.
  - `[false]` `[reject]` Blind Hunter: the README comment exceeds the 80-column width the rest of the README keeps. — The baseline README already has 15 lines over 80 columns (for example `:3` at 273 and `:84` at 120), and `oxfmt --check` passes.
  - `[low]` `[reject]` Edge Case Hunter: mixed markers in one list split into separate lists. — carried: same claim as the pass-1 Edge Case Hunter `+ `/mixed-markers row.
  - `[low]` `[bad_spec]` Edge Case Hunter: checked checklist items serialize as `- [x]`, not `- [ ]`. — Same root cause as the Blind Hunter checklist-note row; same amendment.
  - `[low]` `[defer]` Edge Case Hunter: an agent that writes its own `- ` metadata and patches with `- ` `findText` still misses. — carried: same claim as the pass-1 Blind Hunter defer row; recorded once, in frontmatter `deferred`.
  - `[low]` `[bad_spec]` Edge Case Hunter: the README comment claims every bullet serializes as `* `. — Same root cause as the Blind Hunter README-comment row; same amendment.
  - `[low]` `[reject]` Intent Alignment: the three-line README round trip rests on a reverted probe. — carried: same claim as the pass-1 Blind Hunter test row.
  - `[low]` `[reject]` Intent Alignment: no test runs the README text through `patch` `findText`. — carried: same claim as the pass-1 Intent Alignment `findText` row.
  - `[false]` `[reject]` Intent Alignment: `- ` input lints clean is tested only on read-only `lint_document`. — carried: same claim as the pass-1 Blind Hunter enforced-write row (`documentReader.ts:365` and `enforcedWrite.ts:204` lint the same canonical text).
  - `[false]` `[reject]` Intent Alignment: the SPEC bullet adds claims beyond the intent's two. — carried: same claim as the pass-1 Intent Alignment extra-claims row.
  - `[false]` `[reject]` Intent Alignment: the done Story 1.10 spec's literal AC5 is left as is. — Same refutation as the Blind Hunter Story 1.10 row: its deviation note states the same rule.
  - `[false]` `[reject]` Intent Alignment: the formatter directive and its comment are not in the intent. — carried: same claim as the pass-1 Intent Alignment directive row.
  - `[false]` `[reject]` Intent Alignment: the DW-12 handoff note is not in the diff. — Same refutation as the Blind Hunter Auto Run Result row: Finalize writes it.

### 2026-10-04 — Review pass
- verdicts: 23 findings — high 0, medium 0, low 16, false 7, maybe-false 0
- findings:
  - `[false]` `[reject]` Blind Hunter: the SPEC bullet cites `epics.md`, which is not a SPEC companion. — The bullet states the whole rule itself, so no reader needs `epics.md` to apply it; "Story 1.10 AC5" is the label the 2026-10-04 decision gives, and `CLAUDE.md` names `epics.md` as where stories and acceptance criteria live.
  - `[low]` `[bad_spec]` Blind Hunter: the SPEC bullet's checklist clause breaks this spec's Always rule, since the Story 1.10 HTTP suite has no checklist case. — Confirmed: the clause rests on `CheckboxList.ts:101` and `CheckboxItem.ts:105` only. Loopback 3 dropped it.
  - `[low]` `[defer]` Blind Hunter: the rendered README has no visible sentence saying Outline returns plain bullets as `* `, and no `findText` guidance. — carried: same claim as the frontmatter `deferred` item recorded in pass 2; not deferred again.
  - `[false]` `[reject]` Blind Hunter: the comment says "the formatter" instead of `oxfmt`, so the directive may be deleted as a Prettier leftover. — The comment on the line directly above the directive says why the `* ` markers must be kept and that the formatter would rewrite them, so the directive's purpose is not unexplained, which is what the deletion scenario assumes.
  - `[low]` `[reject]` Blind Hunter: `git diff --stat` and AC3 cannot list the untracked spec, and the bare `yarn vitest` command is not the declared script. — carried: same claims as the pass-2 Blind Hunter rows; their fix edits this build's spec.
  - `[low]` `[reject]` Blind Hunter: Code Map and `deferred.location` line references are off or describe the pre-edit README. — Real, but the fix edits this build's spec; the references describe `baseline_revision`.
  - `[low]` `[reject]` Blind Hunter: AC1 claims more than the committed tests prove, and the probe is not recorded. — carried: same claim as the pass-1 Blind Hunter test row (the intent says "No code change"). The Auto Run Result will record the probe and its result.
  - `[low]` `[reject]` Blind Hunter: nothing durable links this change to DW-12 or retro item 2, and the ledger has duplicated decision lines. — carried: same claim as the pass-1 Blind Hunter DW-12 row; the intent forbids ledger edits, and Finalize records the handoff.
  - `[low]` `[reject]` Blind Hunter: the "every bullet" wording survives in `wikiLint.test.ts:1687`, the DW-7 ledger title and the done Story 1.10 spec. — The test comment and the ledger are excluded by the intent ("No code change"; "Do NOT edit the deferred-work ledger"), and the Story 1.10 note at `:364` names `BulletList.toMarkdown`, so it is about plain bullet lists in context; all three predate this change.
  - `[low]` `[reject]` Blind Hunter: the triage-log headings carry no pass numbers, and a pass-1 row quotes wording loopback 2 replaced. — Real, but the fix edits this build's spec; the Spec Change Log numbers each loopback and records what it superseded.
  - `[low]` `[reject]` Edge Case Hunter: mixed markers inside one list split it into separate lists. — carried: same claim as the pass-1 Edge Case Hunter `+ `/mixed-markers row.
  - `[low]` `[reject]` Edge Case Hunter: `+ ` bullet input is not covered. — carried: same claim as the pass-1 Edge Case Hunter `+ `/mixed-markers row.
  - `[low]` `[bad_spec]` Edge Case Hunter: "canonical visible metadata is that serialized form and round-trips byte-identically" is false for adjacent lists. — Confirmed: `serializer.ts:439-440` closes a list followed by one of the same type with `flushClose(3)`, giving two blank lines that parse back as one loose list. Same root cause as the checklist-clause row: the prescribed SPEC text claims more than the HTTP suite proves. Loopback 3 narrowed "canonical" to one list of `* ` bullets with no blank lines between items.
  - `[low]` `[bad_spec]` Edge Case Hunter: the checklist clause rests on code, not on the HTTP suite. — Same root cause and amendment as the Blind Hunter checklist-clause row.
  - `[low]` `[reject]` Intent Alignment: the three-field README example is in no committed test. — carried: same claim as the pass-1 Blind Hunter test row.
  - `[false]` `[reject]` Intent Alignment: `- ` input lints clean is tested only on read-only `lint_document`. — carried: same claim as the pass-1 Blind Hunter enforced-write row.
  - `[low]` `[reject]` Intent Alignment: no test uses the README text as `findText`. — carried: same claim as the pass-1 Intent Alignment `findText` row.
  - `[false]` `[reject]` Intent Alignment: coordinates are checked only for the canonical `* ` form, not for converged `- ` input. — The SPEC bullet claims stable coordinates only for the canonical form, and says `- ` input lints clean and converges; it makes no coordinate claim about `- ` input.
  - `[low]` `[bad_spec]` Intent Alignment: the SPEC checklist clause comes from code reading, not tests. — Same root cause and amendment as the Blind Hunter checklist-clause row.
  - `[false]` `[reject]` Intent Alignment: the diff changes three README lines where the intent quotes two. — carried: same claim as the pass-1 Intent Alignment third-line row.
  - `[false]` `[reject]` Intent Alignment: the memlog line and the two README comment lines fall outside a strict reading of the intent. — The directive part is carried from the pass-1 Intent Alignment directive row. The memlog `(change)` line is how this spec folder records authorized SPEC amendments, so it is part of recording the decision in the SPEC.
  - `[low]` `[defer]` Intent Alignment: the README does not tell authors that their own `- ` bullets come back as `* `. — carried: same claim as the frontmatter `deferred` item recorded in pass 2; not deferred again.
  - `[false]` `[reject]` Intent Alignment: the artifact-only receipt does not apply. — carried: same claim as the pass-1 Intent Alignment receipt row.

### 2026-10-04 — Review pass
- verdicts: 24 findings — high 0, medium 0, low 15, false 9, maybe-false 0
- findings:
  - `[false]` `[reject]` Blind Hunter: the SPEC bullet claims byte identity for values the serializer escapes (`* Owner: a~b` comes back as `a\~b`). — The bullet defines canonical metadata as "the form the Markdown serializer writes for it", so the escaped text is the canonical form; `a~b` input is not canonical, and the escaped form is a fixed point of the round trip.
  - `[false]` `[reject]` Blind Hunter: "`- ` input lints clean" is proven only for read-only lint. — carried: same claim as the pass-1 Blind Hunter enforced-write row. It is also the decision's own wording, which this spec's Always rule admits.
  - `[low]` `[defer]` Blind Hunter: no visible README text explains `* ` or `findText`. — carried: same claim as the frontmatter `deferred` item; not deferred again.
  - `[false]` `[reject]` Blind Hunter: DW-12 and retro item 2 are not recorded, and the promised Auto Run Result is missing. — carried: same claim as the pass-2 Blind Hunter Auto Run Result row; Finalize writes the handoff below.
  - `[low]` `[reject]` Blind Hunter: the evidence for the three-field README example (probe body, command, output) is not recorded. — carried: same claim as the pass-1 Blind Hunter test row. The Auto Run Result now records the probe, its command and its result.
  - `[low]` `[reject]` Blind Hunter: the test comment at `wikiLint.test.ts:1687`, the done Story 1.10 AC5 and the duplicated ledger decision lines are rejected rather than deferred. — carried: same claims as the pass-3 Blind Hunter "every bullet" row and the pass-1 DW-12 row.
  - `[low]` `[reject]` Blind Hunter: the spec has no I/O & Edge-Case Matrix for escaped values, `+ ` bullets, loose lists and lists in tables. — Its fix edits this build's spec; none of these inputs is in the decision.
  - `[low]` `[reject]` Blind Hunter: internal line references are stale and the triage headings are unnumbered. — carried: same claims as the pass-3 Blind Hunter reference and heading rows.
  - `[low]` `[reject]` Blind Hunter: the verification commands are not the declared scripts, and `git diff --stat` cannot check AC3. — carried: same claims as the pass-2 Blind Hunter rows.
  - `[false]` `[reject]` Blind Hunter: the SPEC bullet cites `epics.md` rather than PRD `:168` and AD-4, and "stable diagnostic coordinates" is undefined in the SPEC. — The `epics.md` part is carried from the pass-3 Blind Hunter row. Coordinates are defined by AD-4 in the adopted Architecture Spine, and the SPEC states that AD details live only in that companion.
  - `[low]` `[patch]` Blind Hunter: the memlog line drops the SPEC bullet's "on the selected baseline" qualifier. — Confirmed. Patched: the line now reads "records that, on the selected baseline, canonical visible metadata is …".
  - `[low]` `[reject]` Edge Case Hunter: an author who copies the example and puts a `- ` list directly after it gets two lists that merge on the next save. — Unlikely: in a configured document the metadata section is followed by the next heading. A README rule against adjacent lists would be new guidance outside the decision, and the adjacency behaviour predates this change.
  - `[low]` `[reject]` Edge Case Hunter: the round trip fails when another bullet list directly follows the metadata list. — Real (`serializer.ts:439-440`) but unlikely for the same reason. The bullet's general claim is the decision's own wording ("canonical `* ` bullets round-trip byte-identically"), which this spec's Always rule admits, and each further condition chases a case the decision does not name.
  - `[low]` `[reject]` Edge Case Hunter: this spec's Intent still says the serializer emits every bullet as `* `. — Its fix edits this build's spec, inside the read-only intent contract.
  - `[low]` `[defer]` Intent Alignment: the rationale is an HTML comment, so rendered readers see no explanation. — carried: same claim as the frontmatter `deferred` item.
  - `[false]` `[reject]` Intent Alignment: the SPEC bullet adds claims beyond the intent's two. — carried: same claim as the pass-1 Intent Alignment extra-claims row.
  - `[false]` `[reject]` Intent Alignment: the done Story 1.10 spec still requires literal `- `. — carried: same claim as the pass-2 Blind Hunter Story 1.10 row.
  - `[low]` `[reject]` Intent Alignment: the three-field fixture is not durable. — carried: same claim as the pass-1 Blind Hunter test row.
  - `[false]` `[reject]` Intent Alignment: `- ` input lints clean only on read-only lint. — carried: same claim as the pass-1 Blind Hunter enforced-write row.
  - `[false]` `[reject]` Intent Alignment: coordinates are exercised only for the canonical form. — carried: same claim as the pass-3 Intent Alignment coordinates row.
  - `[low]` `[reject]` Intent Alignment: no test exercises the `patch` `findText` miss. — carried: same claim as the pass-1 Intent Alignment `findText` row.
  - `[low]` `[reject]` Intent Alignment: the formatter guard is checked only by a manual `oxfmt --check`, and CI does not run `format:check`. — Real, but an automated guard would be a CI or test change, which "No code change" excludes, and the CI scope predates this change.
  - `[low]` `[reject]` Intent Alignment: the test comment at `wikiLint.test.ts:1687` is broader than the new wording. — carried: same claim as the pass-3 Blind Hunter "every bullet" row.
  - `[false]` `[reject]` Intent Alignment: the artifact-only receipt does not apply. — carried: same claim as the pass-1 Intent Alignment receipt row.

### 2026-10-04 — Follow-up review pass
- verdicts: 14 findings — high 0, medium 0, low 9, false 5, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind Hunter: DW-12 remains open for the README and SPEC decision. — The ledger belongs to the orchestrator, and the operator expressly forbids this run from modifying, reopening, or rewriting its entries. Its status is not a defect in the documentation change.
  - `[low]` `[reject]` Blind Hunter: the retrospective action item remains open in `sprint-status.yaml`. — That board belongs to the orchestrator; its status is bookkeeping, not verification evidence or a change for this run to make.
  - `[false]` `[reject]` Blind Hunter: this story changed the ledger despite its Never boundary. — The staged diff includes a separate, pre-existing uncommitted orchestrator change to `deferred-work.md`; this run has made no ledger edit.
  - `[low]` `[reject]` Blind Hunter: the file-set AC and `git diff --stat` expectation omit the ledger. — The extra dirty file is orchestrator-owned and outside the story's reviewed documentation changes. Fixing this claim would edit this build's spec, which the review workflow rejects.
  - `[false]` `[reject]` Blind Hunter: the promised Auto Run Result is missing. — This is a follow-up run; Finalize writes the new result after triage and verification, so absence in the staged pre-review diff is not an implementation defect.
  - `[low]` `[reject]` Blind Hunter: the Intent says every bullet serializes as `* `. — Checklist items are a counterexample, but this wording is inside the immutable intent contract, and the binding SPEC bullet is scoped to one plain bullet list. A correction would edit this build's spec.
  - `[low]` `[defer]` Blind Hunter: rendered README text does not teach authors to use fetched Markdown for `patch` `findText`. — Carried from earlier passes and already recorded once in frontmatter `deferred`; the canonical example is fixed, while guidance for authors' own `- ` input is a pre-existing issue.
  - `[low]` `[reject]` Blind Hunter: no committed test pins the exact three-field example or patch matching. — Carried from earlier passes: the intent excludes code and test changes. A temporary three-field HTTP probe passed during this follow-up and was removed; the committed two-field test covers the canonical behavior.
  - `[low]` `[reject]` Edge Case Hunter: the Intent overstates `* ` serialization for checklists. — Carried from the Blind Hunter Intent wording row; a fix would edit this build's intent contract.
  - `[low]` `[reject]` Edge Case Hunter: the file-set AC omits `deferred-work.md`. — Carried from the Blind Hunter file-set row; the ledger change is orchestrator-owned.
  - `[low]` `[reject]` Edge Case Hunter: an adjacent bullet list may prevent whole-document byte identity. — Carried from review pass 4. The SPEC defines canonical metadata as one tight `* ` list in the selected baseline; adjacent-list behavior is outside this decision and predates the change.
  - `[false]` `[reject]` Intent Alignment: the documentation change edited the prohibited ledger. — The diff includes an independently dirty orchestrator file, but this run did not edit it; it is not part of the reviewed documentation commit.
  - `[false]` `[reject]` Intent Alignment: the spec artifact, README comments, and memlog timestamp diverge from the requested amendment. — The workflow requires its own spec artifact, the comments keep the decided `* ` example stable under the declared formatter, and the timestamp follows the memlog's amendment convention; none changes the requested rendered example or SPEC rule.
  - `[false]` `[reject]` Intent Alignment: narrower committed HTTP coverage means the README example is unverified. — The committed test covers two fields, but this follow-up ran the exact three-field example through `createDocument`, `fetchMarkdown`, and `lint_document`; it passed. No lasting test edit is allowed by the intent.

### 2026-10-04 — Review pass
- verdicts: 30 findings — high 0, medium 0, low 21, false 8, maybe-false 1
- findings:
  - `[low]` `[reject]` Blind Hunter: `baseline_revision` now points at `72e8f2ea6`, the commit holding the README, SPEC and memlog edits, so this pass's diff cannot show them; AC3, the Finalize file check and the Code Map line references no longer match. — Real: step-03 captures HEAD as the baseline, and the escalation resolution set the same value. Restoring the old baseline or rewriting AC3 and the Code Map edits this build's spec. The deliverable passed four review passes and a follow-up against `426c228e6`, and this run re-ran the round-trip test, the three-field probe and `oxfmt --check` on HEAD. `git diff --stat 426c228e6` still shows only the three documents plus this spec, outside the orchestrator's ledger. The Finalize check covers only this pass's reviewed-diff files, which is this spec alone.
  - `[low]` `[reject]` Blind Hunter: the deleted `## Auto Run Result` leaves earlier rows pointing at nothing and drops the DW-12 and retro-item handoff, the probe record and the residual risks. — Real before Finalize. Restoring the old section edits this build's spec. Finalize in this run writes a new Auto Run Result that carries the handoff, this run's probe and the residual risks again.
  - `[low]` `[reject]` Blind Hunter: a bullet was added inside `<intent-contract>` with no Spec Change Log entry, while the same follow-up pass calls the contract immutable. — Real: nothing in the spec says who added it. The operator's escalation resolution added it (journal `story-escalation-resolved`, 2026-10-04 05:30:18, baseline `72e8f2ea6`). The follow-up rows that call the contract immutable were written before that, when the review workflow's rule was the binding constraint. Adding a change-log entry edits this build's spec; the Auto Run Result records where the bullet came from.
  - `[false]` `[reject]` Blind Hunter: the bullet waives a gate it cannot waive, and since the ledger is already staged, a plain `git commit` would sweep it into the story commit. — The blocked follow-up escalation asked the operator to "explicitly decide how this clean-tree gate applies", and the bullet is that decision. This run commits only this spec, by pathspec (`git commit --only`), so the staged ledger stays out of the commit.
  - `[low]` `[reject]` Blind Hunter: AC3 and the Verification `git diff --stat` line still contradict the new bullet, and plain `git diff --stat` shows only unstaged changes. — carried: same claim as the follow-up Blind Hunter file-set row and the pass-2 `git diff --stat` row; the fix edits this build's spec.
  - `[low]` `[reject]` Blind Hunter: the follow-up rows claim a three-field probe passed without command, body or output. — Real in the file as it stands. That session's command and result are in its escalation record in the run journal (05:29:35). Rewriting those rows edits this build's spec. This run re-ran the probe, and the Auto Run Result records its body, command and output.
  - `[low]` `[reject]` Blind Hunter: the ledger already closes DW-7 while this story is back in review, and DW-12 stays open. — carried: same claim as the pass-1 Blind Hunter DW-12 row. The staged DW-7 close is the orchestrator's `sweep-bundle-closed` transaction, with a `resolution-undo` line for rollback, and the intent forbids ledger edits.
  - `[maybe-false]` `[reject]` Blind Hunter: neither the follow-up defer row nor the frontmatter item names DW-23, so a later harvest may record the item in the ledger twice. — Settling it needs the orchestrator's harvest dedup key. The journal's `spec-deferrals-harvested` event tracks `seen_again`/`deduped`, and the ledger row carries `origin: spec-deferred eb7b895ea0db`, which suggests dedup on the unchanged item. If true, the result would only be low (a duplicate open ledger row), and the fix edits this build's spec.
  - `[low]` `[reject]` Blind Hunter: the pass is headed "Follow-up", but the story came in as `ready-for-dev`, so Finalize uses first-pass rules, and nothing records who reopened it. — The heading belongs to the earlier session, which did enter through the `done` route; this pass is logged separately. Since nothing was patched, `followup_review_recommended` is `false` under either rule. The missing record of who reopened the story is real; the Auto Run Result records it, and any other fix edits this build's spec.
  - `[low]` `[reject]` Blind Hunter: the follow-up rows do not mark carried claims as `carried`, cite an unnumbered "pass 4", and put three claims under one verdict. — Real but cosmetic. Rewriting old triage rows edits this build's spec, and the pass-3 Blind Hunter heading-number row already rejected the unnumbered-pass point.
  - `[low]` `[reject]` Edge Case Hunter: with the baseline moved to `72e8f2ea6`, this pass leaves the README, SPEC and memlog unreviewed. — Same root cause as the first Blind Hunter baseline row; same reason.
  - `[false]` `[reject]` Edge Case Hunter: the ledger is staged, so a Finalize commit without a pathspec sweeps it into the story commit. — Same refutation as the Blind Hunter gate row: this run commits this spec by pathspec only.
  - `[low]` `[reject]` Edge Case Hunter: the exemption matches the ledger by name, not by content, so a forbidden story edit to it would pass unnoticed. — It did not happen here: the ledger in the index (`b901cb5fc…`) is the same blob as the orchestrator's pre-session snapshot `refs/attempt-preserve-dirty/20261004-001506-b478-72e8f2ea-0`, and the worktree has no unstaged change to it. A content guard adds complexity for an unlikely case and edits this build's spec.
  - `[low]` `[reject]` Edge Case Hunter: the diff edits the read-only `<intent-contract>`, and the follow-up rows that reject fixes as intent edits now contradict it. — Same root cause as the Blind Hunter intent-contract row; same reason.
  - `[low]` `[reject]` Edge Case Hunter: the removed Auto Run Result held the orchestrator handoff and residual risks. — Same root cause as the Blind Hunter Auto Run Result row; Finalize carries both again.
  - `[low]` `[reject]` Edge Case Hunter: triage rows point at handoff and probe records in the removed section. — Same root cause as the Blind Hunter Auto Run Result row. The HALT protocol and Finalize both write an Auto Run Result, so the records exist whatever status this run ends with.
  - `[low]` `[reject]` Edge Case Hunter: the probe record was removed, and the new rows claim a probe passed without recorded evidence. — Same root cause as the Blind Hunter probe-evidence row; same reason.
  - `[false]` `[reject]` Edge Case Hunter: the claim that the modified ledger does not fail the clean-tree gate quietly overrides Finalize item 2. — The override is not silent: it is the operator's recorded answer to the escalation that asked how the gate applies. Run `20261004-001506-b478` already finalized DW-1 under the same staged orchestrator ledger (its Run note).
  - `[low]` `[reject]` Edge Case Hunter: under the new baseline, AC3 and `git diff --stat` cannot list the README, SPEC and memlog. — Same root cause as the first Blind Hunter baseline row; same reason.
  - `[low]` `[reject]` Edge Case Hunter: the Intent's "serializer emits every bullet as `* `" is false for checklists. — carried: same claim as the follow-up Edge Case Hunter checklist row; the fix edits the intent contract.
  - `[low]` `[reject]` Intent Alignment: the diff holds none of the work the intent asks for, only spec bookkeeping. — Same root cause as the first Blind Hunter baseline row; the work is in `72e8f2ea6` and was re-verified in this run.
  - `[low]` `[reject]` Intent Alignment: the verification record went backwards; the earlier Auto Run Result was deleted and the follow-up probe is prose only. — Same root cause as the Blind Hunter Auto Run Result and probe-evidence rows; same reason.
  - `[low]` `[reject]` Intent Alignment: committed tests cover a two-field list, not the three-field README example. — carried: same claim as the pass-1 Blind Hunter test row.
  - `[low]` `[reject]` Intent Alignment: no test exercises `patch` `findText` against the example. — carried: same claim as the pass-1 Intent Alignment `findText` row.
  - `[false]` `[reject]` Intent Alignment: "`- ` lints clean" is shown only after storage, never on enforced-write validation of raw `- ` input. — carried: same claim as the pass-1 Blind Hunter enforced-write row.
  - `[false]` `[reject]` Intent Alignment: the SPEC wording goes beyond the decision's text. — carried: same claim as the pass-1 Intent Alignment extra-claims row.
  - `[false]` `[reject]` Intent Alignment: the README changes the third bullet and adds two HTML comments beyond the named lines. — carried: same claims as the pass-1 Intent Alignment third-line and directive rows.
  - `[low]` `[reject]` Intent Alignment: the diff edits the intent contract that its own triage treats as frozen. — Same root cause as the Blind Hunter intent-contract row; same reason.
  - `[false]` `[reject]` Intent Alignment: the staged ledger change sits outside the reviewed diff, and nothing shows who wrote it. — carried: same claim as the follow-up Intent Alignment ledger row. This run also checked that the staged blob equals the orchestrator's pre-session snapshot.
  - `[false]` `[reject]` Intent Alignment: the artifact-only receipt does not apply. — carried: same claim as the pass-1 Intent Alignment receipt row.

### 2026-10-04 — Review pass
- verdicts: 31 findings — high 0, medium 0, low 25, false 6, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind Hunter: nothing in the spec says why the `done` story went back to review, and the thread-limit fix lives only in host config, so the fault can recur. — Real: the operator's resolution (journal `story-escalation-resolved`, 2026-10-04 05:47:55, baseline `e749cf9a3`) reset the spec without a note, and `~/.codex/config.toml` gained `[agents] max_concurrent_threads_per_session = 8` at 05:47:51. Recording the reopen edits this build's spec; the Auto Run Result records it and the host-config dependency as a residual risk.
  - `[low]` `[reject]` Blind Hunter: deleting the Auto Run Result again leaves the unguarded `<!-- prettier-ignore -->` and the untested three-field example recorded nowhere durable. — Real until Finalize. The underlying risks are carried rejects (pass-4 formatter-guard row, pass-1 test row); this run's Auto Run Result records both again, and any other fix edits this build's spec.
  - `[low]` `[reject]` Blind Hunter: `baseline_revision` `e749cf9a3` postdates the deliverable, so AC3, the Verification `git diff --stat` line and the Code Map line references no longer match. — Real: step-03 captures HEAD, and the README, SPEC and memlog are in `72e8f2ea6`. The fix edits this build's spec. This run re-verified the deliverable on HEAD, and `git diff --stat 426c228e6` (ledger excluded) lists only the three documents plus this spec.
  - `[low]` `[reject]` Blind Hunter: the ledger marks DW-7 `done` while the story is back in review. — carried: same claim as the previous pass's Blind Hunter ledger-close row.
  - `[low]` `[reject]` Blind Hunter: the DW-7 `resolution` line names the sweep bundle, not the commit that holds the work. — Real but minor: `72e8f2ea6` carries "(DW-7)" in its subject, and the orchestrator's sweep commit will name the bundle. The intent forbids ledger edits ("the orchestrator records resolution").
  - `[low]` `[reject]` Blind Hunter: DW-12 still tracks the same decision and stays open. — carried: same claim as the pass-1 Blind Hunter DW-12 row.
  - `[low]` `[reject]` Blind Hunter: DW-23 does not say a README edit needs a human decision, and has no settle line. — Real: its reason lacks DW-7's "deliberate contract update" wording, so a sweep could route it as unattended work. The fix edits the ledger, which the intent forbids, or this build's spec; the Auto Run Result hands it to the orchestrator.
  - `[low]` `[reject]` Blind Hunter: DW-23's location (`README.md:119-140`) drifts from the section (`:119-141`), and its evidence omits the `server/models/helpers/` and `shared/editor/nodes/` path prefixes. — Real but cosmetic: both files resolve uniquely by name. The location part is carried from the pass-3 `deferred.location` row; the fix edits this build's spec or the ledger.
  - `[low]` `[reject]` Blind Hunter: the spec no longer names DW-23, so a later harvest may duplicate it. — The duplicate risk is false: the g1 `spec-deferrals-harvested` event reports `"dw_ids": [], "deduped": 1`. The missing back-reference is real until Finalize; the Auto Run Result names DW-23.
  - `[low]` `[reject]` Blind Hunter: the closed DW-7 entry keeps its duplicated `decision:` line. — carried: same claim as the pass-3 Blind Hunter duplicated-decision row.
  - `[low]` `[reject]` Edge Case Hunter: DW-12 and the sprint retro item stay open while DW-7 closes. — carried: same claim as the pass-1 Blind Hunter DW-12 row.
  - `[low]` `[reject]` Edge Case Hunter: the baseline moved past the deliverable commit, so this pass cannot review the README, SPEC or memlog. — Same root cause as the Blind Hunter baseline row; same reason.
  - `[low]` `[reject]` Edge Case Hunter: triage rows cite handoff, probe and residual-risk records in the removed Auto Run Result. — carried: same claim as the previous pass's Edge Case Hunter removed-section row.
  - `[low]` `[reject]` Edge Case Hunter: the removed section was the only record of the unguarded directive and the untested three-field example. — carried: same claim as the previous pass's Edge Case Hunter residual-risk row.
  - `[low]` `[reject]` Edge Case Hunter: AC3 fails as written against `e749cf9a3`. — Same root cause as the Blind Hunter baseline row; same reason.
  - `[low]` `[reject]` Edge Case Hunter: AC1 implies a committed test covers the three-field README example, but `METADATA` has two fields. — carried: same claim as the pass-1 Blind Hunter test row.
  - `[low]` `[reject]` Verification Gap (other): DW-12 stays open, and the spec lost its handoff note. — carried: same claim as the pass-1 Blind Hunter DW-12 row; the Auto Run Result carries the handoff again.
  - `[low]` `[reject]` Verification Gap (other): DW-7 and DW-12 each repeat their `decision:` line. — carried: same claim as the pass-3 Blind Hunter duplicated-decision row.
  - `[low]` `[reject]` Intent Alignment: the diff holds none of the README or SPEC work, and AC3 cannot be met against the current baseline. — Same root cause as the Blind Hunter baseline row; same reason.
  - `[false]` `[reject]` Intent Alignment: the staged ledger change conflicts with a strict reading of "Do NOT edit the ledger". — carried: same claim as the previous pass's Intent Alignment ledger row. The index blob `b901cb5fc…` still equals `refs/attempt-preserve-dirty/20261004-001506-b478-e749cf9a-0:_bmad-output/implementation-artifacts/deferred-work.md`.
  - `[false]` `[reject]` Intent Alignment: the README edit changes `Authority` and adds two comment lines beyond the two quoted lines. — carried: same claims as the pass-1 Intent Alignment third-line and directive rows.
  - `[false]` `[reject]` Intent Alignment: the SPEC bullet narrows "canonical" and adds a coordinate claim beyond the decision. — carried: same claim as the pass-1 Intent Alignment extra-claims row.
  - `[low]` `[reject]` Intent Alignment: no test exercises `patch` `findText`, the surface DW-7 names. — carried: same claim as the pass-1 Intent Alignment `findText` row. This run's temporary probe also covered it: `findText` `Status: Active` matched, `- Last verified: 2026-09-20` returned `isError: true`, and `* Last verified: 2026-09-20` matched.
  - `[low]` `[reject]` Intent Alignment: no committed test covers the three-field README example. — carried: same claim as the pass-1 Blind Hunter test row.
  - `[false]` `[reject]` Intent Alignment: "`- ` input lints clean" is untested on the enforced-write path. — carried: same claim as the pass-1 Blind Hunter enforced-write row.
  - `[low]` `[reject]` Intent Alignment: the README-level verification record lived in the deleted Auto Run Result. — carried: same claim as the previous pass's Intent Alignment verification-record row.
  - `[low]` `[reject]` Intent Alignment: CI runs no `format:check`, so only the directive keeps the formatter off the example. — carried: same claim as the pass-4 Intent Alignment formatter-guard row.
  - `[low]` `[defer]` Intent Alignment: the README does not tell authors that their own `- ` input comes back as `* `. — carried: same claim as the frontmatter `deferred` item (ledger DW-23); not deferred again.
  - `[low]` `[reject]` Intent Alignment: DW-12 records the same decision and stays open. — carried: same claim as the pass-1 Blind Hunter DW-12 row.
  - `[false]` `[reject]` Intent Alignment: the spec and ledger call `server/tools/README.md` a binding companion, but `CLAUDE.md` lists only the PRD, addendum and Architecture Spine. — `SPEC.md:5` lists `../../../server/tools/README.md` under `companions:`, and `SPEC.md:14` makes every companion part of the canonical contract; the `CLAUDE.md` parenthetical is not exhaustive.
  - `[false]` `[reject]` Intent Alignment: the artifact-only receipt does not apply. — carried: same claim as the pass-1 Intent Alignment receipt row.

### 2026-10-04 — Follow-up review pass
- verdicts: 14 findings — high 0, medium 0, low 12, false 2, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind Hunter: the baseline after the documentation commit makes AC3 and `git diff --stat` miss the deliverable. — carried: the previous review recorded this exact baseline problem; repairing AC3 edits this build's spec. The documentation was checked directly against `426c228e6351fff091ea8be80509c360888be059`.
  - `[low]` `[reject]` Blind Hunter: deleting the Auto Run Result removes the probe and handoff record. — carried: previous review recorded this temporary gap; Finalize below restores the current verification, handoff and risks.
  - `[false]` `[reject]` Blind Hunter: a done DW-7 ledger row conflicts with the temporary `in-review` story state. — The orchestrator owns ledger status; its `done` row is bookkeeping, and this follow-up review does not reopen it or use it as verification evidence.
  - `[low]` `[reject]` Blind Hunter: DW-12 and the sprint retro item still describe the documentation decision. — carried: the orchestrator owns both status fields. Their disposition is handed back below, without changing either file.
  - `[low]` `[reject]` Blind Hunter: DW-23 lacks a decision requirement for another README contract edit. — carried: previous review recorded the possible routing concern; changing an existing ledger row is forbidden to this run, and this review does not decide DW-23.
  - `[low]` `[reject]` Blind Hunter: the host thread-limit and re-open event are not a prerequisite outside old review prose. — carried: the earlier Auto Run Result documented the 2026-10-04 escalation resolution; the current result retains the dependency. Adding another prerequisite edits this build's spec.
  - `[low]` `[reject]` Edge Case Hunter: deleting the result loses the DW-12 and sprint-item handoff. — carried: same claim as the Blind Hunter result row; the current result below restores it.
  - `[low]` `[reject]` Edge Case Hunter: deleting the result loses probe evidence and residual risks. — carried: same claim as the Blind Hunter result row; the current result below restores them.
  - `[low]` `[reject]` Edge Case Hunter: the selected baseline cannot demonstrate the README, SPEC and memlog file-set AC. — carried: same claim as the Blind Hunter baseline row. The staged ledger belongs to the orchestrator and is not part of this story's reviewed change.
  - `[low]` `[reject]` Edge Case Hunter: the Intent says every bullet emits `* ` although checklists emit `- `. — carried: earlier passes verified the checklist exception; the sentence is inside this build's intent contract, while the binding SPEC rule is scoped to one plain bullet list.
  - `[low]` `[reject]` Verification Gap: AC3 cannot pass against `e749cf9a3`. — carried: same baseline claim. Direct comparison against the pre-deliverable revision verifies the three documentation files and this spec.
  - `[low]` `[reject]` Intent Alignment: the current diff contains no README, SPEC or memlog amendment. — carried: same baseline claim. Commit `72e8f2ea6b4e346823f3def86965342b5aa159c4` contains the amendment, which this run inspected and exercised.
  - `[false]` `[reject]` Intent Alignment: the ledger's presence in the diff means this story changed it. — The ledger transaction was staged before this run and is expressly orchestrator-owned; this run neither edited nor committed it.
  - `[low]` `[reject]` Intent Alignment: the diff has no durable test of the three-field example or `patch` `findText`. — carried: the intent excludes lasting test edits. This run's temporary HTTP probe exercised both and was removed after passing.

## Verification

**Commands:**
- `scripts/test-db.sh ensure && yarn vitest run server/routes/mcp/wikiLint.test.ts -t "round trip"` -- expected: the round-trip test passes, confirming the `* ` form is byte-identical and `- ` input lints clean.
- Temporary, uncommitted probe in the "round trip" block: create the exact edited README example through `createDocument` and assert `fetchMarkdown` returns it unchanged; run it, then revert the test file -- expected: the probe passes and `git diff` shows no test change afterwards.
- `corepack yarn oxfmt --check server/tools/README.md` -- expected: "All matched files use the correct format" (`format:check` covers `server/`; `_bmad-output/` is outside its scope). Prettier is not installed; `oxfmt` is the declared formatter.
- `git diff --stat` -- expected: only the three documentation files plus this spec.

**Manual checks (if no CLI):**
- The README example block holds exactly `## Document metadata`, a blank line, then three `* ` bullets in the original order; the explanatory comment and `<!-- prettier-ignore -->` sit directly above the fence, in that order.

## Auto Run Result

Status: done

**Summary.** The DW-7 documentation amendment was already committed in `72e8f2ea6b4e346823f3def86965342b5aa159c4`. The README example uses three canonical `* ` bullets, the binding SPEC records the Story 1.10 AC5 interpretation, and the memlog records the authorized amendment. This follow-up reviewed and verified that committed result; it made no new product change.

**Files changed.** This story spec records the follow-up review and verification. The deliverable files are `server/tools/README.md`, `_bmad-output/specs/spec-outline-mcp-wiki-linting/SPEC.md`, and that folder's `.memlog.md`, all committed in the revision above. No code or lasting test file changed.

**Review.** Four layers reported 14 findings: high 0, medium 0, low 12, false 2, maybe-false 0. Patches applied: none (high 0, medium 0, low 0). New deferred items: none; the existing frontmatter item remains unchanged. All 14 findings were rejected for the individual reasons in the immediately preceding Follow-up review pass log. `followup_review_recommended: false`; there is no patched high-severity entry or specific unverified change requiring another pass.

**Verification performed.** `git fetch --prune` succeeded; HEAD was 54 commits ahead of its upstream and 0 behind before finalization. `scripts/test-db.sh ensure` reported the test database ready. `corepack yarn vitest run server/routes/mcp/wikiLint.test.ts -t 'round trip'` passed (1 test). A temporary HTTP probe read the three-field fenced example from the README, created it through `createDocument` in a `read_only` collection, confirmed byte-identical `fetchMarkdown` and a clean `lint_document`, confirmed dashed `patch` `findText` fails and canonical `* ` `findText` succeeds; `corepack yarn vitest run server/routes/mcp/wikiLint.test.ts -t 'dw7 temporary README probe'` passed (1 test). The probe was removed. `corepack yarn oxfmt --check server/tools/README.md` passed. Manual inspection confirmed the three markers, comment, directive, SPEC Constraints bullet and memlog line. Comparing with `426c228e6351fff091ea8be80509c360888be059` identifies only the three documentation files and this spec outside the orchestrator-owned ledger transaction.

**Residual risks and handoff.** The three-field probe is temporary, as the intent excludes lasting test changes; the committed round-trip test covers the two-field canonical form. The formatter directive is not separately guarded by CI. The frontmatter deferred item covers authors' own dashed metadata and `patch` `findText`; its ledger disposition, any DW-12 or sprint retro bookkeeping, and the pending staged ledger transaction belong to the orchestrator. This run did not modify, stage, revert or commit the ledger or `sprint-status.yaml`. The 2026-10-04 operator resolution raised the local Codex child-thread limit for the workflow's four-reviewer pass; another host must provide enough reviewer slots. Laura Wiki's repository route still points to the relevant Outline sources; this documentation amendment requires no Wiki route change.
