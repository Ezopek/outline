---
title: 'DW-18: Backfill the Story 1.10 Spec Change Log with the AC5 and Code Map deviations (retro item 8)'
type: 'chore'
created: '2026-10-04'
status: 'done'
review_loop_iteration: 0
followup_pass: true
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      The `publishedIn` JSDoc in the in-memory lint suite still says the built document "is not added to the collection structure", the same false claim the Story 1.10 Code Map carried.
    evidence: |-
      server/tools/wikiLint.test.ts:2374 reads "@returns the document, which is not added to the collection structure". publishedIn calls buildDocument with a collectionId, so the document is published (server/test/factories.ts:412) and the @AfterCreate hook addDocumentToCollectionStructure adds it to the structure (server/models/Document.ts:520-539). DW-18 forbids code changes, so the comment stays as is; the Story 1.10 Spec Change Log entry records the corrected fact.
    location: >-
      server/tools/wikiLint.test.ts:2374
    severity: low
baseline_revision: '21a4ecafe3ec6e05dbcc0703d30049f6b1fca5e0'
---

<intent-contract>

## Intent

**Problem:** The done Story 1.10 spec has an empty `## Spec Change Log`, but the build deviated from its AC5 text and two of its Code Map statements are wrong. These facts live only in the Auto Run Result and in review rows that rejected the spec edit. Epic 1 retro F-3 and action item 8 flagged the gap, and DW-18 carries the operator decision of 2026-10-04: "Backfill Story 1.10 Spec Change Log".

**Approach:** Append two dated entries under the Story 1.10 `## Spec Change Log` heading, one for the AC5 bullet-marker interpretation and one for the stale Code Map statements. Each entry cites the Auto Run Result and the Review Triage Log rows that rejected the edit. Nothing else changes.

## Boundaries & Constraints

**Always:**
- Insert only between the `## Spec Change Log` heading and the `## Review Triage Log` heading of `spec-1-10-accept-the-complete-read-only-lint-and-repair-loop.md`. Every other byte of that file stays the same, including frontmatter, AC5, Code Map, Review Triage Log and Auto Run Result.
- Date each entry `2026-10-04`, the decision and backfill date, and name DW-18 as its origin.
- State only facts that the Story 1.10 Auto Run Result, its Review Triage Log, or code at the story commit `5fc8bb4989b24e390bea7aa4285c950ff06e1cf7` supports (Code Map below).
- Use "plain bullet list" wording for the serializer. The claim "every bullet" is false for checklists (DW-7 loopback 1).

**Never:**
- Edit `sprint-status.yaml`, the deferred-work ledger, the retro, `epics.md`, the binding SPEC or its companions, or any other spec.
- Change any code or test.
- Rewrite the Story 1.10 AC5 or Code Map text in place. The new entries supersede those statements without replacing them.
- Record the AC6 audit `documentId` note. Its review rows are `[false]` (AD-14 by design), so it is not a deviation, and the decision does not name it.

</intent-contract>

## Code Map

- `_bmad-output/implementation-artifacts/spec-1-10-accept-the-complete-read-only-lint-and-repair-loop.md`. This is the target file.
  - `:260` is the empty `## Spec Change Log`, and `:262` is `## Review Triage Log`.
  - AC5 is at `:220-224`.
  - The Code Map's stale statements are the rule-kind list at `:136`, and "`buildDocument` does not add to the structure" at `:159`.
  - The Review Triage Log rows to cite:
    - `:272`: Blind Hunter, "the Spec Change Log is empty … Code Map statements are stale", rejected because "its fix is an edit of this build's spec";
    - `:288-294`: Edge Case Hunter (claim) on AC5 `- ` vs `* `;
    - `:299`: Intent Alignment, "spec AC5 and the tests disagree".
  - In the Auto Run Result, "Deviations and interpretations" has **AC5 bullet markers** at `:364-367` and **Code Map correction** at `:368`. The rejected list is at `:387`.
    - **Code Map correction** covers only `buildDocument`.
    - Only Blind Hunter row 6 names the rule-kind list as stale, and the code shows what is missing.
  - Blind Hunter row 6 also says that "deviations reinterpret AC5 and AC6". The AC6 rows (Blind Hunter row 7, Intent Alignment row 5) are `[false]`, AD-14 by design.
- AC5 evidence (read-only), the "round trip" test in `server/routes/mcp/wikiLint.test.ts`, "keeps canonical visible metadata byte-identical and its Finding positions exact":
  - the clean documents:
    - `- ` input is fetched as `METADATA`, which is one tight list of `* ` bullets;
    - `METADATA` itself is fetched byte-identical;
    - both lint `complete`/`clean`, so neither has a Finding;
  - the invalid-date document:
    - a separate `INVALID_DATE` document (`METADATA` with `Last verified: 2026-13-01`, the same canonical form) is fetched byte-identical;
    - it yields `METADATA_FIELD_FORMAT_INVALID` at line 4, column 18;
    - its `replace` re-save keeps that location and the whole result byte-identical.
- `_bmad-output/specs/spec-outline-mcp-wiki-linting/SPEC.md:58` (read-only). DW-7 already binds the same AC5 interpretation here, so the entry should point to it.
- `buildDocument` evidence (read-only, unchanged between the baseline `877dab7d9ab8abc792d5e679683a7291d98d6088` and HEAD):
  - `server/test/factories.ts:412` defaults `publishedAt` to now unless `collectionId` is null. A `publishedAt` override wins, because `...overrides` is spread after it.
  - When `buildDocument` builds the collection itself (`collectionId` undefined), `:423-431` also calls `addDocumentToStructure`.
  - The repair-loop fixture passes `collectionId` (`buildCollectionOf`), so only the hook applies.
  - `server/models/Document.ts:520-539` holds the `@AfterCreate` hook `addDocumentToCollectionStructure`. It adds every published, unarchived document that has a collection.
  - The repair-loop test "repairs every Error of its batch within three rounds and keeps the Warning" calls `removeDocumentInStructure(orphan)` before `restart` and the first lint.
- Rule-kind evidence (read-only):
  - At the story commit, `ruleKinds` in `server/wikiLint/core/registry.ts` (`:346`, unchanged from the baseline) held 13 kinds.
  - It still holds the same 13 at HEAD `21a4ecafe3ec6e05dbcc0703d30049f6b1fca5e0` (`:367`). Stories 2.0 and 2.1 changed the file but added only Finding detail schemas, no rule kind.
  - The Code Map named 10 and left out `section_order`, `allowed_heading_levels` and `unsupported_markdown_structures`.
  - The registry is authoritative because that list was incomplete. Do not say later stories added kinds.

## Tasks & Acceptance

**Execution:**
- `_bmad-output/implementation-artifacts/spec-1-10-accept-the-complete-read-only-lint-and-repair-loop.md`: under `## Spec Change Log`, append two `### 2026-10-04 —` entries. Each has **Trigger**, **Recorded** and **Not amended** bullets, in the style of the sibling specs' change logs.
  - The AC5 entry covers:
    - plain bullet lists serialize as `* `;
    - canonical `* ` metadata round-trips byte-identical with stable coordinates;
    - `- ` input lints clean and converges;
    - the serializer is unchanged;
    - the literal `- ` byte equality does not hold;
    - pointers to the test and to `SPEC.md` `## Constraints`.
    - Keep the clean documents and the invalid-date document apart: the line 4, column 18 location belongs only to `INVALID_DATE`.
  - The Code Map entry covers both corrections with their evidence:
    - say which source supports which correction (Auto Run Result: `buildDocument` only; Blind Hunter row 6 and the registry: the rule-kind list);
    - state the 13 kinds as unchanged through HEAD.
  - Quote each cited Review Triage Log row verbatim, with no elision.
    - Where Blind Hunter row 6 mentions AC6, add one clause: its AC6 part is not a deviation (the AC6 rows are `[false]`, AD-14 by design) and stays out of this backfill.
    - Do not record the AC6 note itself.

**Acceptance Criteria:**
- Given the edited Story 1.10 spec, when `git diff` is read, then:
  - the only change is lines inserted between `## Spec Change Log` and `## Review Triage Log`;
  - those lines hold exactly two entries dated `2026-10-04`, and each names DW-18.
- Given the AC5 entry, when it is read, then:
  - it states the canonical `* ` round trip, `- ` lints clean, the serializer is unchanged, and literal `- ` equality does not hold;
  - it cites the Auto Run Result **AC5 bullet markers** note and the Edge Case Hunter and Intent Alignment AC5 rows.
- Given the Code Map entry, when it is read, then:
  - it corrects the `buildDocument` claim (`@AfterCreate`, D removed explicitly);
  - it names the three omitted rule kinds;
  - it cites the Auto Run Result **Code Map correction** note and the Blind Hunter stale-Code-Map row.
- Given the whole change set, when it is diffed against the baseline, then only the Story 1.10 spec and this spec differ.

## Spec Change Log

### 2026-10-04 — Review pass 1 loopback (review_loop_iteration 1)
- **Triggering findings:**
  - (A) The Code Map claimed "Later stories added kinds". That is false: `ruleKinds` holds the same 13 kinds at HEAD. Stories 2.0 and 2.1 added only Finding detail schemas. Found by Blind Hunter and Edge Case Hunter (medium).
  - (B) The cited Blind Hunter row 6 was quoted with "…", which dropped its AC6 clause and left the AC6 omission unexplained (Blind Hunter, Edge Case Hunter).
  - (C) The AC5 evidence ran the clean canonical document together with the `INVALID_DATE` document, so "its coordinates" pointed at a document without Findings (Blind Hunter).
  - (D) The `buildDocument` bullet said "sets `publishedAt` whenever a collection is set". It missed the override and the factory's own structure path (Blind Hunter, Edge Case Hunter, Intent Alignment).
  - (E) The Code Map entry did not say which source supports which correction. The Auto Run Result covers only `buildDocument` (Intent Alignment).
- **Amended:**
  - Code Map: Story 1.10 target bullet (source split, AC6 rows); AC5 evidence (clean vs invalid-date documents); `buildDocument` evidence (default, override, factory path, hook); rule-kind evidence (13 through HEAD, no "later stories added kinds").
  - Tasks: the invalid-date distinction; which source supports which correction; verbatim quoting with one AC6 clause.
- **Known-bad state avoided:**
  - a change-log entry that states a false fact;
  - a selectively quoted review row;
  - a location attributed to a clean document;
  - an imprecise factory account.
- **KEEP:**
  - placement only between `## Spec Change Log` and `## Review Triage Log`, with 0 lines removed;
  - two `### 2026-10-04 — DW-18 backfill: …` entries with **Trigger** / **Recorded** / **Not amended** bullets;
  - "plain bullet list" wording, with the `bullet_list` node having no marker attribute so `BulletList.toMarkdown` falls back to `*`, and no "every bullet";
  - review rows cited by reviewer and row number, not line number;
  - the pointer to the DW-7 `SPEC.md` `## Constraints` bullet;
  - `factories.ts:412`, `Document.ts:520-539`, `removeDocumentInStructure(orphan)` before `restart`, and both files unchanged from `877dab7d…` through `21a4ecafe…`;
  - the full commit identifiers;
  - **Not amended** bullets that leave AC5 and the Code Map text as written.

## Review Triage Log

### 2026-10-04 — Review pass
- verdicts: 27 findings — high 0, medium 2, low 18, false 7, maybe-false 0
- findings:
  - `[medium]` `[bad_spec]` **Blind Hunter:** "Later stories added kinds" is false; `ruleKinds` still holds 13 at HEAD. — Confirmed: `registry.ts:367` lists the same 13 keys as `5fc8bb49…:346`, and `1cac931a9`/`e46831d34` added only detail schemas. Group A. Amended the Code Map rule-kind evidence.
  - `[low]` `[reject]` **Blind Hunter:** the `^-[^-]` "no line removed" check misses removed bullet and blank lines. — True of the check, but no deliverable defect: `git diff --numstat` gave `26 0`. The fix is an edit of this build's spec.
  - `[low]` `[reject]` **Blind Hunter:** `git diff --name-only` cannot see untracked files, and the awk command has a placeholder. — `git status --short` showed exactly the Story 1.10 spec and this spec, so there is no deliverable defect. The fix is an edit of this build's spec.
  - `[low]` `[bad_spec]` **Blind Hunter:** the quoted Blind Hunter row 6 elides its AC6 clause, and the AC6 omission is unexplained. — Confirmed against `spec-1-10-…md:272`. Group B. Amended Tasks: quote verbatim, plus one AC6 clause.
  - `[low]` `[reject]` **Blind Hunter:** the sources the entry cites still say "every bullet" (`:14`, `:364`, `:289`, test comment), and checklists emit `- `. — Pre-existing, and not met in everyday use: metadata fields are plain bullets. Superseding them would add a checklist claim that DW-7 loopback 3 deliberately dropped because no HTTP test covers checklists. Group R.
  - `[false]` `[reject]` **Blind Hunter:** no pointer says the frontmatter README deferral is resolved. — Story frontmatter `deferred` records what was deferred at build time, not current status. Status lives in the ledger (DW-7 `done`), as for every other done spec.
  - `[low]` `[bad_spec]` **Blind Hunter:** the coordinates sentence attributes the line 4, column 18 location to the clean canonical document. — Confirmed: the location belongs to `INVALID_DATE`. Group C. Amended the Code Map AC5 evidence and Tasks.
  - `[false]` `[reject]` **Blind Hunter:** test pointers carry no revision, and the serializer claim has no `file:line`. — The cited test names exist at both `5fc8bb49…` and HEAD (the Intent Alignment spot check confirms this), and `BulletList.toMarkdown` is a greppable symbol, so a reader can resolve every pointer.
  - `[low]` `[bad_spec]` **Blind Hunter:** the `buildDocument` account is incomplete (the factory's own `addDocumentToStructure` at `:423-431`, and the `publishedAt` override). — Confirmed in `server/test/factories.ts:397-431`. Group D. Amended the Code Map `buildDocument` evidence.
  - `[low]` `[reject]` **Blind Hunter:** this spec claims the change-log style of sibling specs that no sibling uses. — The fix is an edit of this build's spec. A backfill amends nothing, so no `Amended`/`KEEP` applies.
  - `[medium]` `[bad_spec]` **Edge Case Hunter:** `spec-1-10-…md:285` says later stories added kinds; none did. — Group A; same evidence and amendment.
  - `[low]` `[reject]` **Edge Case Hunter:** the 26 inserted lines shift later line citations in the retro, the DW-7 spec and this Code Map. — The intent requires inserting at the Spec Change Log, so any compliant change shifts these lines. The cited documents are point-in-time records, and this Code Map is anchored to `baseline_revision`. Rewriting reviewed historical artifacts is more than a direct correction for a rarely met drift.
  - `[low]` `[reject]` **Edge Case Hunter:** the "every bullet" and "only serialized bullet marker" statements remain (`:14`, `:315`, `:390`). — Group R; same reason.
  - `[low]` `[bad_spec]` **Edge Case Hunter:** the AC6 deviation and the AC6 clause of the row are left out without a note. — Group B; same amendment.
  - `[low]` `[bad_spec]` **Edge Case Hunter:** a `publishedAt` override wins over the `factories.ts:412` default. — Confirmed: `...overrides` is spread at `:416`. Group D; same amendment.
  - `[low]` `[reject]` **Edge Case Hunter:** the `^-[^-]` check misses `-- `, `-` and `---` removals. — Same as the Blind Hunter check row: numstat `26 0`. The fix is an edit of this build's spec.
  - `[low]` `[reject]` **Edge Case Hunter:** the scope check would trip on the orchestrator's pending `deferred-work.md` change, and it ignores staged changes. — No such change is present (`git status --short`). `CLAUDE.md` already says that change does not fail a clean-tree gate. The fix is an edit of this build's spec.
  - `[low]` `[reject]` **Edge Case Hunter (claim):** this spec's Intent overstates "these facts live only in the Auto Run Result and review rows", since `SPEC.md:58` and the retro record them. — It is intent-contract text, so the fix is an edit of this build's spec. The deliverable points to the `SPEC.md` bullet, so nothing duplicates or contradicts it.
  - `[low]` `[reject]` **Edge Case Hunter (claim):** the Trigger/Recorded/Not amended labels differ from the template's labels. — Same as the Blind Hunter style row.
  - `[false]` `[reject]` **Intent Alignment:** the "supersedes" clauses move the entries toward a normative amendment. — The AC5 supersession restates what `SPEC.md:58` already binds, and the Code Map supersession replaces wrong facts with verified ones. No new rule is introduced.
  - `[false]` `[reject]` **Intent Alignment:** the Verification commands check structure only, not content. — Content acceptance is judged at review by design (step 3), and this pass checked every fact against code; the verification-gap layer found no gap.
  - `[low]` `[reject]` **Intent Alignment:** the entry cites the Auto Run Result note, which says "every bullet", while recording "plain bullet list". — Group R; same reason.
  - `[low]` `[bad_spec]` **Intent Alignment:** the rule-kind correction rests on Blind Hunter row 6 and the registry, not on the Auto Run Result, but the entry lists the sources together. — Confirmed: `:368` covers only `buildDocument`. Group E. Amended the Code Map target bullet and Tasks.
  - `[false]` `[reject]` **Intent Alignment:** the AC5 test evidence is not pinned to a revision. — Same as the Blind Hunter pointer row: the test name and its `[4, 18]` assertion exist at both revisions.
  - `[low]` `[bad_spec]` **Intent Alignment:** this spec's `buildDocument` bullet ("whenever a collection is set") disagrees with the deliverable ("unless `collectionId` is null"). — Group D; same amendment.
  - `[false]` `[reject]` **Intent Alignment:** the new untracked process spec is not mentioned by the intent. — The build workflow requires this spec as the run's record. It is not product scope.
  - `[false]` `[reject]` **Intent Alignment:** the intent texts disagree on whether `epic-1` is done. — The diff does not touch `sprint-status.yaml`, and `sprint-status.yaml:48` reads `epic-1: done`.

### 2026-10-04 — Review pass
- verdicts: 24 findings — high 0, medium 0, low 15, false 9, maybe-false 0
- findings:
  - `[low]` `[patch]` **Blind Hunter:** calling the AC6 part of Blind Hunter row 6 "not a deviation" contradicts the Auto Run Result, which lists **AC6** under "Deviations and interpretations". — Confirmed (`spec-1-10-…md` Auto Run Result). Group P1. Patched: the clause now rests on scope. The DW-18 decision names only AC5 and the Code Map, and the AC6 rows are `[false]`, AD-14 by design.
  - `[low]` `[reject]` **Blind Hunter:** the `buildDocument` correction does not explain why the in-memory hierarchy fixtures still work, since a stale collection instance overwrites the structure. — The explanation is the reviewer's inference about a fixture that already passes. The Code Map correction is accurate as stated, and few readers would hit the question. Adding an unverified mechanism goes beyond a direct correction.
  - `[low]` `[defer]` **Blind Hunter:** the `publishedIn` JSDoc at `server/tools/wikiLint.test.ts:2374` still says the document "is not added to the collection structure". — Confirmed. The issue predates this change, and DW-18 forbids code changes. Group D1, deferred in frontmatter.
  - `[low]` `[reject]` **Blind Hunter:** this spec says Stories 2.0 and 2.1 "added only Finding detail schemas". `1cac931a9` also added schema caps (`atMostUnits`, `headingText`, `fieldName` length). — Confirmed for "only". The true part is "added no rule kind", which `ruleKinds` lists confirm at both revisions. The deliverable makes only that claim. This row corrects the record; the fix would be an edit of this build's spec.
  - `[low]` `[reject]` **Blind Hunter:** the intent-contract fact-source rule (Auto Run Result, Review Triage Log, story-commit code) is narrower than the evidence the entries use (`SPEC.md:58`, HEAD registry, baseline and HEAD factory). — Every added fact was checked at the revision it names: Intent Alignment pass 2 spot checks, plus `git diff --stat` for factory and model. The Code Map and Tasks direct those pointers. The fix would be an edit of this build's spec.
  - `[low]` `[patch]` **Blind Hunter:** the AC5 supersession covers only the byte-equality clause, while AC5's Given also presents `- ` bullets as canonical. — Confirmed (`spec-1-10-…md` AC5). Group P2. Patched: the entry now supersedes AC5's `- ` example of canonical visible metadata and its byte-equality clause for `- ` input.
  - `[low]` `[patch]` **Blind Hunter:** the entry does not separate story AC5 from epic AC5. — Confirmed: the pass-1 rework dropped "met epic AC5". Group P3. Patched: the Trigger states that the build meets epic AC5 (`epics.md` Story 1.10 AC5, which has no `- ` example and no byte-equality clause) and deviates only from this spec's stricter restatement. The implementer's "requires only…" paraphrase left out epic AC5's front-matter clause, so it was tightened to that wording.
  - `[low]` `[reject]` **Blind Hunter:** the entry quietly narrows the cited note's "every bullet" wording, so both versions stand. — carried: same claim as the pass-1 Group R rows.
  - `[false]` `[reject]` **Blind Hunter:** DW-18, the DW-7 bullet and retro F-3 have no file paths, and the DW-7 README resolution is not linked. — DW ids resolve in `deferred-work.md` by the convention every sibling spec uses, the DW-18 entry's `source_spec` names the retro, and `SPEC.md` is cited by path. The README part is carried from the pass-1 `[false]` row.
  - `[low]` `[reject]` **Blind Hunter:** the Verification checks miss removed bullet and blank lines and untracked files, and the recorded `26 0` evidence refers to the iteration-0 draft. — carried for the checks (pass-1 rows). Each triage entry records its own pass. The final `40 0`, single hunk `@@ -261,0 +262,40 @@`, is recorded in the Auto Run Result.
  - `[false]` `[reject]` **Blind Hunter:** "the fix is an edit of this build's spec" does not apply because this spec is not frozen, and the sibling-style claim is false. — The reason is this build workflow's own triage rule for findings with no deliverable defect. The pass-1 `bad_spec` amendments answered deliverable defects. The style part is carried.
  - `[low]` `[reject]` **Blind Hunter:** the pass-1 fixes (verbatim quoting, invalid-date split, source split, 13 kinds through HEAD) have no acceptance criteria. — The deliverable meets each one: this pass checked quotes with `diff` and checked the facts. The fix would be an edit of this build's spec.
  - `[low]` `[patch]` **Edge Case Hunter (claim):** "AC6 part is not a deviation" contradicts the Auto Run Result. — Group P1; same patch.
  - `[low]` `[patch]` **Edge Case Hunter:** the "unchanged from `877dab7d…`" lead-in also covers the repair-loop test, which does not exist at the baseline. — Confirmed: `git log --diff-filter=A` shows `server/routes/mcp/wikiLint.test.ts` added in `5fc8bb49…`. Group P4. Patched: the range now covers only `factories.ts` and `Document.ts`, and the test is cited as added by the story commit.
  - `[low]` `[patch]` **Edge Case Hunter:** `:423-431` skips `addDocumentToStructure` when `publishedAt` is overridden to null. — Confirmed at `factories.ts:423`. Group P5. Patched: the condition now adds "and `publishedAt` is not overridden to null".
  - `[low]` `[defer]` **Edge Case Hunter:** the `publishedIn` JSDoc at `server/tools/wikiLint.test.ts:2374` still makes the false claim. — Group D1; same deferral.
  - `[false]` `[reject]` **Intent Alignment:** a new untracked process spec, not named by the intent. — carried (pass-1 row).
  - `[false]` `[reject]` **Intent Alignment:** the Verification commands check only structure. — carried (pass-1 row).
  - `[false]` `[reject]` **Intent Alignment:** the intent assumes the Auto Run Result records both Code Map statements, but it covers only `buildDocument`. — The diff now names each correction's source, so no divergence remains in the deliverable.
  - `[false]` `[reject]` **Intent Alignment:** "supersedes" versus "record". — carried (pass-1 row).
  - `[low]` `[patch]` **Intent Alignment:** "not a deviation" differs from the Auto Run Result's own heading. — Group P1; same patch.
  - `[false]` `[reject]` **Intent Alignment:** detail beyond the intent (line numbers, full hashes, factory path). — These are evidence anchors for the facts the intent asks to record. They add no scope, and Intent Alignment confirmed each one.
  - `[false]` `[reject]` **Intent Alignment:** the triage log cites numstat `26 0` from the earlier version. — Each triage entry records its own pass. The final evidence is in the Auto Run Result.
  - `[false]` `[reject]` **Intent Alignment:** the retro text says `backlog` while `sprint-status.yaml` says `done`. — carried (pass-1 row). The diff touches neither file.

### 2026-10-04 — Follow-up review pass
- verdicts: 16 findings — high 0, medium 0, low 15, false 1, maybe-false 0
- findings:
  - `[low]` `[reject]` **Blind Hunter:** the staged diff includes `deferred-work.md` despite this story's two-file scope. — The ledger has a separate pending orchestrator transaction. The operator explicitly reserved its status and resolution; this run neither edits nor commits it. Removing or accepting that transaction is outside this story's authority.
  - `[low]` `[reject]` **Blind Hunter:** Tasks still instruct the writer to call the AC6 part "not a deviation". — The instruction is stale against this spec's own pass-2 triage, but the delivered Story 1.10 entry uses the decision's scope instead. The remaining fix edits this build's spec, not the deliverable.
  - `[low]` `[reject]` **Blind Hunter:** `grep -c '^-[^-]'` misses some removed lines. — Carried from pass 1: this build's Verification text is weak, but the final baseline comparison reports `40 0` and a byte comparison confirms that only the intended section changed. Fixing the command edits this build's spec.
  - `[low]` `[reject]` **Blind Hunter:** `git diff --name-only` misses untracked or staged files. — Carried from pass 1: this build's Verification text is weak. `git status --short` and the staged review diff expose the files, and the ledger is the orchestrator's pending transaction. Fixing the command edits this build's spec.
  - `[low]` `[reject]` **Blind Hunter:** the Code Map's line pointers drift after insertion. — Carried from pass 1: the cited locations are anchored to `baseline_revision`; the intent itself requires insertion before the cited later sections. Rewriting this build's Code Map is outside the deliverable.
  - `[low]` `[reject]` **Blind Hunter:** this spec says Stories 2.0 and 2.1 added "only Finding detail schemas" although Story 2.0 also added schema limits. — Carried from pass 2: the overstatement is in this build's spec and its prior triage corrects it. The delivered entry says only that no rule kinds were added.
  - `[low]` `[reject]` **Blind Hunter:** the orchestrator's DW-44 evidence describes `publishedIn` as always producing a published document. — `server/test/factories.ts` spreads overrides after the default, so a null `publishedAt` or `collectionId` can defeat that claim. The operator expressly owns the ledger and forbids this run from rewriting its entries.
  - `[low]` `[reject]` **Blind Hunter:** this spec's change log omits the second review pass's five patches. — The pass-2 triage and the prior Auto Run Result record those patches. Adding process history would edit this build's spec, not the Story 1.10 deliverable.
  - `[low]` `[reject]` **Edge Case Hunter:** DW-44's publication claim fails when overrides set `publishedAt` or `collectionId` to null. — Same verified ledger issue as Blind Hunter's DW-44 finding; its ownership and the operator's explicit restriction exclude a patch in this run.
  - `[low]` `[patch]` **Edge Case Hunter:** the new entry said the hook adds every published, unarchived document with a collection to the structure. — `Collection.addDocumentToStructure` cannot place a child whose parent is absent from the tree. The sentence now describes only the repair-loop fixture's published document, which has no parent.
  - `[low]` `[reject]` **Edge Case Hunter:** the two-file acceptance condition conflicts with the pending ledger diff. — The ledger change is a separate orchestrator transaction, and the operator explicitly excludes it from this story's edits and commit. The acceptance text is this build's spec and is not a deliverable defect.
  - `[low]` `[reject]` **Edge Case Hunter:** the Intent source inventory omits `SPEC.md` and the registry. — Carried from pass 1: this is wording in the intent contract; the delivered entries point to those sources, and no source was concealed from review.
  - `[low]` `[reject]` **Intent Alignment:** the whole staged diff contains the process spec and an orchestrator ledger change, beyond the two-entry deliverable. — The process spec is required workflow bookkeeping and was committed in the earlier pass. The ledger change is owned by the orchestrator, not this run. The Story 1.10 file itself changes only in the requested section.
  - `[false]` `[reject]` **Intent Alignment:** structural verification commands alone cannot establish all historical facts. — Carried from pass 1: the commands are structural checks, while review checked the content against the cited story commit, baseline and source code. The verification-gap reviewer found no remaining gap.
  - `[low]` `[reject]` **Intent Alignment:** the entries cite HEAD and baseline evidence beyond the intent contract's narrow source sentence. — The same spec's Code Map and Tasks explicitly require comparison through HEAD, and the entry ties the historical claim to the story commit. Rewriting this build's source rule would edit this build's spec.
  - `[low]` `[patch]` **Intent Alignment:** the Code Map entry unnecessarily named the excluded AC6 audit `documentId` interpretation. — The parenthetical was removed. The verbatim historical review quote and the scope explanation remain, as required by the intent.

## Verification

**Commands:**
- `git diff --name-only` -- expected: only the Story 1.10 spec; this spec is untracked until commit.
- `git diff -U0 -- _bmad-output/implementation-artifacts/spec-1-10-accept-the-complete-read-only-lint-and-repair-loop.md | grep -c '^-[^-]'` -- expected: `0`, so no line was removed or changed.
- `awk '/^## Spec Change Log/{p=1;next} /^## Review Triage Log/{p=0} p' <story-1.10 spec> | grep -c '^### 2026-10-04 — '` -- expected: `2`.

## Auto Run Result

Status: done

**Summary.** Follow-up review of the DW-18 backfill confirmed the two dated Story 1.10 change-log entries. It narrowed one claim about collection structure insertion to the actual repair-loop fixture and removed an unnecessary AC6 parenthetical. No code or test changed.

**Files changed in this run:**
- `_bmad-output/implementation-artifacts/spec-1-10-accept-the-complete-read-only-lint-and-repair-loop.md`: two wording corrections inside the 40-line DW-18 insertion.
- `_bmad-output/implementation-artifacts/spec-dw-18-story-1-10-spec-change-log.md`: follow-up review triage and this result.

**Review findings.** Four layers reported 16 findings: high 0, medium 0, low 15, false 1, maybe-false 0. Two low entries were patched; no new item was deferred. Rejected findings and reasons:
- Blind Hunter's ledger-scope finding: the ledger diff is an orchestrator transaction, excluded by the operator from this run.
- Blind Hunter's stale AC6 task wording: the deliverable uses the correct scope rationale; the remaining fix edits this build's spec.
- Blind Hunter's weak removal grep: the baseline byte comparison and `40 0` numstat establish the actual insertion; fixing the command edits this build's spec.
- Blind Hunter's `git diff --name-only` limitation: the actual status and review diff expose the files; fixing the command edits this build's spec.
- Blind Hunter's drifting line pointers: they are baseline-anchored historical references; changing them edits this build's spec.
- Blind Hunter's "only Finding detail schemas" wording: the prior triage corrects it and the deliverable makes no such claim.
- Blind Hunter's DW-44 override issue: it is real, but that ledger entry is owned by the orchestrator and expressly excluded from this run.
- Blind Hunter's missing pass-2 change-log history: pass-2 triage and the previous result already recorded the patches; the change would edit this build's spec.
- Edge Case Hunter's DW-44 override issue: same verified, excluded ledger issue.
- Edge Case Hunter's two-file acceptance issue: the pending ledger transaction is outside this story's edits and commit.
- Edge Case Hunter's incomplete source inventory: the delivered entries cite `SPEC.md` and the registry; the remaining wording is in the intent contract.
- Intent Alignment's whole-diff scope issue: the process spec is required workflow bookkeeping, and the ledger change belongs to the orchestrator.
- Intent Alignment's structural-verification issue: the content was separately checked against source and history; the verification-gap layer found no gap.
- Intent Alignment's later-source issue: the spec itself requires HEAD comparison, and the historical claim is tied to the story commit.

**Follow-up review recommendation: false.** This was a follow-up pass. The two patches were low, with no high patch and no specific unverified risk needing another review pass.

**Verification performed.** `git fetch --prune` succeeded; HEAD is 87 commits ahead of its upstream and 0 behind. A baseline byte comparison confirmed that all text outside Story 1.10's `## Spec Change Log` stayed identical, the section has exactly two dated DW-18 entries, the AC6 parenthetical is absent, and the hook sentence is fixture-scoped. `git diff --numstat 21a4ecafe3ec6e05dbcc0703d30049f6b1fca5e0` reported `40 0` for the Story 1.10 spec. `git diff --check` passed. No runtime tests apply to these documentation-only corrections.

**Residual risks.** The existing `publishedIn` JSDoc remains inaccurate, as the previously deferred D1 item records. The orchestrator's pending DW-44 evidence also overstates default publication when null overrides are supplied; this run did not edit the ledger. Historical line-number citations after the inserted section shift by 40 lines.
