---
title: 'DW-15: Record decision-before-Story-X deferrals as named Story preconditions in epics.md'
type: 'chore'
created: '2026-10-04'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      The Story preconditions convention is prose only: nothing adds a Story X precondition when a decision-before-Story-X deferral is recorded, and nothing mechanically stops a run at an unmet precondition.
    evidence: |-
      The human decision for DW-15 excludes sprint-status and tooling changes. bmad-loop dispatches from sprint-status.yaml, where Stories 3.3 and 3.4 are plain backlog. Ledger entries are written by the orchestrator, and no step adds the matching Preconditions item to epics.md, so F-1 (epic-1-retro-2026-10-03.md) can recur for a future deferral unless the operator, owner of Epic 1 retrospective action item 5, adds it. A run obeys a block only if it reads the story text; the compiled epic context has "No story-level details" (compile-epic-context.md). This change's verification proves the text only, not that any consumer obeys it.
    location: >-
      _bmad-output/planning-artifacts/epics.md (Overview, Story preconditions)
    severity: medium
  - summary: >-
      Ledger work folded into Stories 3.3 and 3.4 (DW-20, DW-30) and their Gate 1 dispositions (DW-21, DW-25) do not appear in those stories' text.
    evidence: |-
      DW-20 ("Meter documentStructure before materializing it ...; fold into Story 3.3") and DW-30 (worker post-commit tail and cross-host clock-skew budget into Story 3.3 constant-derivation evidence) are open, and Story 3.3's criteria mention neither. DW-21 carries the decision "Keep open as a Gate 1 residual" but is missing from Story 3.4 criterion 5's residual list, and DW-25 ("Keep open for the Gate 1 review") appears nowhere in Story 3.4. These are not decision-before-Story-X deferrals, so the DW-15 convention does not record them. A run that builds Story 3.3 or 3.4 from the story text would still miss them, the same ledger-prose-only cause as F-1. Pre-existing.
    location: >-
      _bmad-output/planning-artifacts/epics.md (Stories 3.3 and 3.4)
    severity: medium
  - summary: >-
      DW-29's decided work, a pinned broad verification command for Epic 3 conformance evidence, does not reach Story 3.2's text, so Story 3.2 can run before the command exists.
    evidence: |-
      DW-29 is open and carries "decision: 2026-10-04 Pin --maxWorkers=2 — Add a package.json script ... and name it in CLAUDE.md and AGENTS.md 'Running and verifying' as the broad verification command for Epic 3 conformance evidence". Story 3.2 produces that conformance evidence, and `grep maxWorkers _bmad-output/planning-artifacts/epics.md` finds nothing. The decision is already recorded, so this is decided work, not a decision-before-Story-X deferral, and the DW-15 convention does not record it. It is the same ledger-prose-only cause as the Stories 3.3/3.4 item above. Pre-existing.
    location: >-
      _bmad-output/planning-artifacts/epics.md (Story 3.2)
    severity: medium
  - summary: >-
      bmad-loop's ledger `gate:` field would pause dispatch of Stories 3-3 and 3-4 until DW-39 closes, but DW-39 has no `gate:` line, and this bundle may not edit the ledger.
    evidence: |-
      The installed bmad-loop engine.py `_refuse_gated_story` raises the PAUSE_STORY_GATE pause instead of dispatching a story that an unlanded ledger entry gates. It re-reads the ledger on every pick, and `bmad-loop validate` refuses the same story at preflight. No entry in deferred-work.md has a `gate:` line today. The DW-15 intent forbids ledger edits in this session. Adding a gate on DW-39 for Stories 3.3 and 3.4 through the orchestrator's sanctioned path would give the Story preconditions convention a mechanical stop. The gate releases only on `status: done`, which is stricter than the convention's settled-decision test.
    location: >-
      _bmad-output/implementation-artifacts/deferred-work.md (DW-39)
    severity: medium
baseline_revision: 5c9e2d1d3dc27813c9c157ae9424eee06a1057bc
---

<intent-contract>

## Intent

**Problem:** Epic 1 retrospective action item 5 (DW-15, finding F-1) found that a deferral saying "needs a decision before Story X" lived only as ledger prose, so nothing stopped Story 1.10 from proceeding past it. `epics.md` has no convention that turns such a deferral into a blocker on the story it gates. On 2026-10-04 the human chose option 1, "Add a preconditions convention to epics.md": a short 'Story preconditions' convention in the header, plus the currently known preconditions (e.g. Story 3.4 on DW-4..DW-6). Planning-artifact edit only; no sprint-status or tooling change.

**Approach:** Add one dated **Story preconditions** paragraph to the `epics.md` Overview. Record the two currently known preconditions as **Preconditions:** blocks on Story 3.3 (DW-39) and Story 3.4 (DW-4, DW-5, DW-6, through the DW-39 decision).

## Boundaries & Constraints

**Always:**
- The convention states: a `deferred-work.md` entry that needs a decision before Story X starts is recorded on Story X as a named precondition, in a **Preconditions:** block between **Traceability:** and **Acceptance Criteria:**. Each item names the ledger entry ID(s) and the decision it needs. Story X does not start until each precondition's decision is recorded on its ledger entry and any change that decision makes to Story X is applied in `epics.md`. An implementation run that finds an unmet precondition stops instead of building the story. Cite "Epic 1 retrospective action item 5", following the precedent at `epics.md:930`.
- Story 3.3's precondition is DW-39. The operator decides between amending Story 3.3 to add the DW-4 and DW-5 measurements and a held-pool fixture re-run under the AD-17-fixed floor, and revisiting which evidence may close DW-6. Keep the ledger's wording.
- Story 3.4's precondition names DW-4, DW-5 and DW-6 and requires only the DW-39 decision on which evidence may close them. It must not require them to be closed. Criterion 8 already lets the Gate 1 record list an item as open, and a block on closure would contradict it (see Design Notes).
- Existing lines stay byte-identical. The diff only inserts lines: one paragraph after the "Amendment (2026-10-02)" paragraph, and two blocks, each followed by a blank line, directly before the `**Acceptance Criteria:**` line of Stories 3.3 and 3.4.

**Never:**
- Do not edit the deferred-work ledger, `sprint-status.yaml`, any retro, `.bmad-loop/`, tooling or scripts, the PRD, the addendum, the Architecture Spine, SPEC.md, or any other spec.
- Do not edit the `epics.md` frontmatter, any acceptance criterion, any Traceability block, or any other story. Do not create a sprint-change proposal.
- Do not record entries that need no pending decision before a specific story as preconditions: fold-in work (DW-20, DW-30), decided items (DW-21, DW-25, DW-29), and done entries (DW-11, DW-14).
- Do not decide DW-39, make DW-4..DW-6 phase-blocking, or change code or tests.

</intent-contract>

## Code Map

- `_bmad-output/planning-artifacts/epics.md:26-32` -- Overview, the header that receives the convention. Line 30 is the "Replan status (2026-10-01)" paragraph, line 32 the "Amendment (2026-10-02)" paragraph, and `## Requirements Inventory` follows at :34. Both existing paragraphs open with a bold dated label, and the new one follows that form.
- `_bmad-output/planning-artifacts/epics.md:1575-1589` -- Story 3.3 heading and Traceability block. `**Acceptance Criteria:**` is at :1589.
- `_bmad-output/planning-artifacts/epics.md:1636-1689` -- Story 3.4. `**Acceptance Criteria:**` is at :1650, and criterion 8 (:1686-1689, DW-14) is the last block in the file.
- `_bmad-output/planning-artifacts/epics.md:925-931` (read-only) -- precedent. Story 2.0's `Gates:` line encoded the earlier decision-before-Story-2.1 blocker and cites "(Epic 1 retrospective action item 1)".
- `_bmad-output/implementation-artifacts/deferred-work.md` (read-only) -- DW-4 and DW-5 are `open` and DW-6 is `done 2026-10-04`. DW-39 (`open`, medium) is the operator choice described above. Decisions appear as `decision:` lines on the entry, and some entries close with only a `resolution:` line (for example DW-11).
- `_bmad-output/implementation-artifacts/epic-1-retro-2026-10-03.md:53,153` (read-only) -- F-1's process cause and action item 5.
- `_bmad-output/implementation-artifacts/spec-dw-14-gate-1-read-only-rollout-precondition.md` (read-only) -- its Review Triage Log rejected a possible conflict between criterion 8 and a DW-15 precondition on Story 3.4 and left it to this bundle.
- `_bmad/render/bmad-build-auto/outline-79be7c63c4d5/6567fe73611d13464ab4/compile-epic-context.md` and `_bmad-output/implementation-artifacts/spec-2-7-record-correlated-and-failure-isolated-write-validation-audi.md:19,78` (read-only) -- the compiled epic context has "No story-level details", and story specs bind to the story's own `epics.md` lines. A run therefore reads the story section, and may never read the Overview.
- bmad-loop `engine.py` dev prompt (read-only, outside the repo) -- the park clause tells a run to build what it can and park at `awaiting-operator`, never `blocked`, when acceptance criteria need human actions. The convention names `blocked` for an unmet precondition so that the clause does not absorb the case.
- bmad-loop `deferredwork.py` `archive_closed` (read-only, outside the repo; run by `sweep --archive`) -- moves a closed entry's body verbatim to `deferred-work-archive.md` and leaves a live stub with `status: done <date>` and `archived:`, but without its `decision:` or `resolution:` lines. The ledger already holds keep-open decisions that settle nothing: DW-21 "Keep open as a Gate 1 residual" and DW-25 "Keep open for the Gate 1 review".
- No `.py` script in the repository parses `### Story`, `Acceptance Criteria`, or `Preconditions` (checked with grep), so the new block breaks no tooling.

## Tasks & Acceptance

**Execution:**
- `_bmad-output/planning-artifacts/epics.md` -- After line 32, add a blank line and the paragraph: **Story preconditions (2026-10-04).** When a `deferred-work.md` entry needs a decision before Story X, Story X records it as a named precondition in a **Preconditions:** block between its **Traceability:** and **Acceptance Criteria:** blocks. Each item names the ledger entry that holds the decision and the decision it needs, because ledger prose alone does not block a story (Epic 1 retrospective action item 5). A precondition is met when its entry carries a `decision:` line that settles the named decision, or reads `status: done`, and any change that decision makes to Story X is applied here; a `decision:` line that only keeps the entry open does not settle it. Story X does not start until each precondition is met: an implementation run that finds an unmet precondition halts as `blocked`, naming the entry, instead of building the story. On 2026-10-04, Stories 3.3 and 3.4 carry the known preconditions. -- applies the convention part of the DW-15 decision.
- `_bmad-output/planning-artifacts/epics.md` -- Before Story 3.3's `**Acceptance Criteria:**`, insert the label line "**Preconditions:** Do not start this story until each item's decision is settled on its ledger entry and applied here; otherwise halt as `blocked` (Overview, Story preconditions).", then the item "- DW-39 — the decision on how DW-4, DW-5, and DW-6 get the closing evidence that Story 3.4 criterion 8 asks of this story: amend this story to add the DW-4 and DW-5 measurements and a held-pool fixture re-run under the AD-17-fixed floor, or revisit which evidence may close DW-6.", then a blank line. -- records the precondition on Story 3.3, with the stop rule where a run reads it.
- `_bmad-output/planning-artifacts/epics.md` -- Before Story 3.4's `**Acceptance Criteria:**`, insert the same label line as Story 3.3, then the item "- DW-39 (closing evidence for DW-4, DW-5, DW-6) — the decision on which evidence may close DW-4, DW-5, and DW-6 (see Story 3.3); revisiting the evidence that may close DW-6 may amend criterion 8.", then a blank line. -- records the decision's example precondition. It leads with the entry that will hold the decision, and it does not contradict criterion 8.

**Acceptance Criteria:**
- Given the edited `epics.md`, when the Overview is read, then it contains one dated **Story preconditions** paragraph. The paragraph states where named preconditions live. It states when a precondition is met: a `decision:` line that settles the named decision (a keep-open line does not), or `status: done`, plus any change to Story X applied. It also states that Story X does not start until then, and that a run finding an unmet precondition halts as `blocked`. It cites Epic 1 retrospective action item 5 and names Stories 3.3 and 3.4.
- Given Stories 3.3 and 3.4, when each is read, then a **Preconditions:** block sits between Traceability and Acceptance Criteria, and its label line states the stop rule. Story 3.3's item leads with DW-39 and names both of its options. Story 3.4's item leads with DW-39, names DW-4, DW-5, and DW-6, and says that revisiting the DW-6 evidence may amend criterion 8. It requires only the DW-39 decision, not their closure. No other story has a **Preconditions:** block.
- Given the change set against the baseline, when it is diffed, then `epics.md` shows insertions only, and the only other changed path is this spec. `git diff --check` reports nothing.

## Spec Change Log

### 2026-10-04 — Review pass 1 loopback (review_loop_iteration 1)
- **Triggering findings:**
  - (A) The stop rule lived only in the Overview, while a run reads only the story section (Blind Hunter, Edge Case Hunter, Intent Alignment).
  - (B) Story 3.4's item named DW-4..DW-6 as its entries, while the decision lands on DW-39 (all three layers).
  - (C) "Recorded on its ledger entry" ignored entries closed by a `resolution:` line (Edge Case Hunter).
  - (D) "An operator decision before Story X starts" narrowed the decision's "a decision before Story X" (Blind Hunter).
  - (G) "Stops" did not name an outcome, so the loop's `awaiting-operator` park clause could absorb the case (Blind Hunter).
- **Amended:** Execution tasks 1-3, Acceptance Criteria 1-2, the last sentences of the Design Notes, the Story 3.3 Code Map line (:1588 corrected to :1589), and two read-only evidence rows in the Code Map.
- **Known-bad states avoided:**
  - A run that reads only Story 3.3 or 3.4 treats the block as context and builds past an undecided DW-39.
  - A literal reader of Story 3.4 waits for a decision line on DW-4..DW-6 that never comes.
  - A precondition whose entry is closed by a resolution never clears.
  - An agent builds the story and then parks at `awaiting-operator`.
- **KEEP:**
  - The Overview paragraph sits directly after the "Amendment (2026-10-02)" paragraph and opens with a bold dated label.
  - Blocks sit between Traceability and Acceptance Criteria, and the diff only inserts lines.
  - The Story 3.3 DW-39 item keeps the ledger's wording of both options.
  - Story 3.4 requires only the DW-39 decision, never closure of DW-4..DW-6.
  - The closing sentence names Stories 3.3 and 3.4.
  - No frontmatter, ledger, sprint-status or tooling edits.

### 2026-10-04 — Review pass 2 loopback (review_loop_iteration 2)
- **Triggering findings:**
  - (H) Any `decision:` line met a precondition, including a keep-open line like DW-21's or DW-25's, which settles nothing (Blind Hunter, Edge Case Hunter).
  - (I) A closed entry archived by `archive_closed` keeps `status: done` but loses its `decision:` and `resolution:` lines, so a met precondition read as unmet (Edge Case Hunter).
  - (J) Story 3.4's item gave a reason criterion 8 does not need ("so that criterion 8 can link ... or record each item as open"), and it hid that DW-39's second option may amend criterion 8 (Blind Hunter).
- **Amended:**
  - Execution task 1, which rewrites the met test as "a `decision:` line that settles the named decision, or `status: done`, plus the change applied; a keep-open line does not settle it".
  - The label line in tasks 2 and 3 ("recorded" became "settled").
  - Task 3's Story 3.4 item.
  - Acceptance Criteria 1-2.
  - One read-only evidence row in the Code Map.
- **Known-bad states avoided:**
  - Story 3.3 or 3.4 starts after a keep-open decision on DW-39.
  - A story halts after DW-39 is closed and archived.
  - A run building Story 3.4 believes criterion 8 never changes.
- **KEEP:**
  - Everything listed in the loopback 1 KEEP list.
  - The stop rule on each block's label line, with "halt as `blocked`" naming the entry.
  - Story 3.3's DW-39 item, unchanged.
  - Both items lead with DW-39.

## Review Triage Log

### 2026-10-04 — Review pass
- verdicts: 25 findings — high 0, medium 10, low 8, false 7, maybe-false 0
- findings:
  - `[medium]` `[bad_spec]` Blind Hunter: nothing in the loop checks the block, so "a run stops" has nothing behind it. — Partly confirmed. Story specs do read the story's own `epics.md` lines (`spec-2-7-*.md:19,78`), so the block reaches a run, but `compile-epic-context.md` omits story-level details and the stop rule lived only in the Overview. Entry A: the spec now puts the stop rule on each block's label line, and the residual lack of mechanical enforcement is deferred (entry E).
  - `[low]` `[bad_spec]` Blind Hunter: the convention does not say how a run stops, and the `awaiting-operator` park clause (`engine.py` "Never use the blocked status for this") could absorb it. — Confirmed, since the clause tells a run to build what it can and then park. Entry G: the convention and the label lines now say "halt as `blocked`".
  - `[medium]` `[bad_spec]` Blind Hunter: Story 3.4's item names DW-4..DW-6, but the decision lands on DW-39. DW-6 is already done, so a literal reading never clears or clears at once. — Confirmed against the convention's "recorded on its ledger entry". Entry B: the item now leads with DW-39 and names DW-4..DW-6 in parentheses.
  - `[false]` `[reject]` Blind Hunter: the precondition wording hides that DW-39's two options are lopsided. — Story 3.3's item states both options in the ledger's own wording, so the asymmetry is visible. The option set belongs to the open DW-39 entry and predates this change.
  - `[low]` `[bad_spec]` Blind Hunter: the trigger "an operator decision before Story X starts" is narrower than F-1's architecture-decision case. — Confirmed for "operator", which the DW-15 decision ("a decision before Story X") does not contain. "Starts" stays, because the intent contract fixes it and it fails closed. Entry D: "operator" is dropped.
  - `[medium]` `[defer]` Blind Hunter: folded work (DW-20, DW-30) and Gate 1 dispositions (DW-21, DW-25) never reach the text of Story 3.3 or 3.4. — Confirmed by reading those stories. These are not decision-before-Story-X deferrals and the gap predates this change. Deferred as entry F.
  - `[low]` `[reject]` Blind Hunter: no rule covers a met precondition, and the dated closing sentence goes stale. — The sentence is dated, so it does not claim to stay current. A met precondition is decided by the ledger line plus the story text, both of which a run can check. A marker rule would add new process beyond a direct correction.
  - `[medium]` `[defer]` Blind Hunter: no one is assigned to add future preconditions. — Confirmed. Ledger entries come from the orchestrator, and the human decision excludes tooling and sprint-status changes. Deferred as entry E.
  - `[low]` `[reject]` Blind Hunter: the verification commands do not cover the untracked spec, and an orchestrator ledger change would break the "only other changed path" criterion. — The fix would edit this build's spec checks. The review diff already includes the spec through `git diff --no-index`, and CLAUDE.md exempts the orchestrator's ledger change from the clean-tree gate.
  - `[false]` `[reject]` Blind Hunter: the Overview paragraph has no "change record" sentence, and the frontmatter is untouched. — No change-record document exists for this decision, and the paragraph traces to its origin through "Epic 1 retrospective action item 5". The DW-14 precedent also left the frontmatter alone.
  - `[low]` `[reject]` Blind Hunter: the Code Map anchor for Story 3.3 is off by one, and DW-39's `location` line range drifts. — The anchor fix only edits this spec (it was corrected while amending for entry A). The ledger location also names "(Story 3.3)", and the intent forbids ledger edits.
  - `[false]` `[reject]` Blind Hunter: the convention departs from the Story 2.0 `Gates:` precedent and creates a second way to record blockers. — That precedent covers a dependency between two stories, and only its citation form is reused. This convention covers ledger decisions.
  - `[medium]` `[bad_spec]` Edge Case Hunter: a run that reads only the Story 3.3 or 3.4 section treats the block as context. — Confirmed by the same evidence as the first Blind Hunter row. Entry A.
  - `[false]` `[reject]` Edge Case Hunter: with a DW-39 decision recorded but not applied, a run cannot tell met from unmet. — The convention requires both the decision and its application. A run compares the decision line with the story text, and an unapplied amendment correctly keeps the story blocked.
  - `[medium]` `[bad_spec]` Edge Case Hunter: a run checking DW-4..DW-6 for a decision line never unblocks Story 3.4. — Entry B.
  - `[low]` `[bad_spec]` Edge Case Hunter: an entry closed by a sweep with a `resolution:` line and no `decision:` line leaves the precondition undecidable. — Confirmed by the DW-11 precedent, which closed with only a resolution. Entry C: the convention now names both lines.
  - `[medium]` `[defer]` Edge Case Hunter: a review that defers a new decide-before-Story-X entry adds no Story X item, so F-1 recurs. — Entry E.
  - `[low]` `[reject]` Edge Case Hunter: a story whose spec already exists may resume past an unmet precondition. — No spec exists for Story 3.3 or 3.4, so the case is hypothetical, and the guard would add a new status rule.
  - `[low]` `[reject]` Edge Case Hunter: choosing DW-39 option 2 leaves DW-4 and DW-5 without evidence, so criterion 8 blocks rollout. — This comes from DW-39's own option set, and DW-39's reason names the DW-4/DW-5 gap for the operator. The block is criterion 8's intended fail-closed behavior, and the guard would redefine the operator's options.
  - `[false]` `[reject]` Intent Alignment: the diff reframes the "Story 3.4 on DW-4..DW-6" example as a gate on DW-39. — It deliberately follows the convention's decision subject. Gating Story 3.4 on DW-4..DW-6 closure would contradict criterion 8 (the DW-14 decision), and DW-14's review left that conflict to this bundle.
  - `[medium]` `[bad_spec]` Intent Alignment: Story 3.4 has no single "its ledger entry". — Entry B.
  - `[false]` `[reject]` Intent Alignment: the convention adds rules beyond the decision text. — The added rules (placement, do-not-start, applied, stop) spell out "precondition" and retro item 5's "so the loop cannot proceed past it". No harm is named.
  - `[medium]` `[bad_spec]` Intent Alignment: the run behavior is stated in `epics.md` text while dispatch reads the compiled context. — Entry A covers the story-surface part, and the mechanism part is entry E.
  - `[medium]` `[defer]` Intent Alignment: verification proves only the text, not that any consumer obeys it. — No test is possible without tooling, which the decision excludes. Entry E.
  - `[false]` `[reject]` Intent Alignment: the artifact-only receipt would not qualify. — This is correct and is no defect. This run asserts no receipt, because it changes a tracked planning file.

### 2026-10-04 — Review pass
- verdicts: 18 findings — high 0, medium 4, low 8, false 6, maybe-false 0
- findings:
  - `[low]` `[bad_spec]` Blind Hunter: the trigger is narrower than F-1's own case (acceptance-level and epic-level gates). — carried: the same narrowness claim as the pass-1 row. Loopback 1 dropped "operator", and "starts" is fixed by the intent contract and fails closed. "Before Story X" still reads onto a decision needed before Story X's acceptance or before an epic's first story. No further action.
  - `[medium]` `[defer]` Blind Hunter: DW-29's decided work (a pinned `--maxWorkers=2` command for Epic 3 conformance evidence) never reaches Story 3.2, so Story 3.2 can run before the command exists. — Confirmed: DW-29 is open with a recorded decision, and `epics.md` has no `maxWorkers`. This is decided work, not a decision-before-Story-X deferral, and it predates this change. A new `deferred` item records it.
  - `[low]` `[bad_spec]` Blind Hunter: Story 3.4's item gives a reason criterion 8 does not need, and it does not say that DW-39's second option may amend criterion 8. — Confirmed. Criterion 8 can already record an item as open, and "revisit which evidence may close DW-6" changes its "Story 3.3 evidence" requirement for DW-6. Entry J: the item now says that revisiting the DW-6 evidence may amend criterion 8.
  - `[medium]` `[bad_spec]` Blind Hunter: any `decision:` line meets a precondition, even one that only keeps the entry open. — Confirmed by DW-21 and DW-25, which carry keep-open decisions. Entry H: the decision must settle the named decision, and a keep-open line does not.
  - `[low]` `[reject]` Blind Hunter: deferred entry F is itself a decision-before-Story-X deferral that gets no precondition. — The fix would edit this build's own `deferred` item. The general recurrence risk (no step adds a precondition when an entry is harvested) is already deferred as entry E.
  - `[low]` `[reject]` Blind Hunter: no way to unblock a halted story is defined. — The operator records the decision, applies it, and re-drives the story through the loop's existing resume path (`bmad-loop-resolve`, or a fresh dispatch: step-01 opens a new spec slug when a non-draft spec exists). Unlikely to block in practice, and the fix adds process text.
  - `[low]` `[reject]` Blind Hunter: the verification grep does not prove placement. — The fix would edit this build's Verification section. Placement was checked against the diff hunks: Story 3.3's block follows its `AD: AD-11, AD-13, AD-16–AD-18` line, and Story 3.4's block follows its `AD: AD-1–AD-20 ...` line.
  - `[medium]` `[bad_spec]` Edge Case Hunter: a keep-open `decision:` line on DW-39 passes the literal check. — Entry H.
  - `[low]` `[reject]` Edge Case Hunter: a decision-before-Story-X deferral raised while Story X is in progress lets Story X finalize as done. — The convention gates the start. The F-1 deferral (DW-2) existed before Story 1.10 started, so the convention would have caught it. A finalization gate is a new rule, and a deferral born inside Story X's own run is rare (that run's review routes such a gap to intent_gap).
  - `[low]` `[bad_spec]` Edge Case Hunter: an entry archived by `archive_closed` keeps no `decision:` or `resolution:` line, so a met precondition reads as unmet. — Confirmed in bmad-loop `deferredwork.py` `archive_closed`: the stub keeps `status: done <date>` and `archived:` and moves the body to the archive file. Entry I: `status: done` now meets the precondition.
  - `[low]` `[reject]` Edge Case Hunter: several different `decision:` lines on one entry leave it unclear which governs. — Today's repeated lines are identical (for example DW-15). A precedence rule is added complexity for an unlikely case.
  - `[false]` `[reject]` Intent Alignment: the example's subject is DW-39, not DW-4..DW-6. — carried: same claim as the pass-1 row. Git also shows that the DW-15 decision (`1e7f2c30b`) predates DW-39 (`5c9e2d1d3`), which supports reading the "e.g." as illustrative.
  - `[false]` `[reject]` Intent Alignment: the Story 3.3 gate goes beyond the named example. — "Record the currently known preconditions" asks for all of them, and DW-39 is a pending operator decision whose first option amends Story 3.3.
  - `[false]` `[reject]` Intent Alignment: the convention's text specifies run behavior in an area the decision placed out of scope. — "No tooling change" excludes tooling files, and none changed. Stating what a reader does at a blocker is the meaning of retro item 5 ("so the loop cannot proceed past it").
  - `[medium]` `[defer]` Intent Alignment: verification proves only the text, not enforcement. — carried: the same claim as the pass-1 row, entry E. Not deferred again.
  - `[false]` `[reject]` Intent Alignment: five sentences may not be "short". — One paragraph plus a label line per block is short, and no harm is named.
  - `[false]` `[reject]` Intent Alignment: the known preconditions are recorded per story, not listed in the header. — The decision's own convention says "recorded as a named precondition on Story X", and the header names the carrying stories.
  - `[false]` `[reject]` Intent Alignment: the artifact-only receipt does not apply. — carried: same claim as the pass-1 row. No receipt is asserted.

### 2026-10-04 — Review pass
- verdicts: 23 findings — high 0, medium 5, low 13, false 5, maybe-false 0
- findings:
  - `[medium]` `[patch]` Blind Hunter: the story label lines leave out the met test that only the Overview defines (keep-open exclusion, `status: done`, naming the entry). — Confirmed: the label read "settled on its ledger entry and applied here". Entry L, patched: both label lines now read "until each item's entry carries a `decision:` line that settles it or reads `status: done`, and any change that decision makes to this story is applied here; otherwise halt as `blocked`, naming the entry".
  - `[false]` `[reject]` Blind Hunter: `status: done` alone clears a precondition that the operator never decided. — Closure is the orchestrator's settled disposition: either a recorded decision that a bundle applied, or a sweep's verified already-resolved finding. A done entry leaves nothing to decide, and an entry reopened through its undo tail reads `open` and is unmet again.
  - `[low]` `[patch]` Blind Hunter: in the met sentence, "that decision" has no referent in the `status: done` branch. — Confirmed. Entry M, patched: it now says "any change the settled decision makes", and an archived entry's lines are located in `deferred-work-archive.md`.
  - `[low]` `[reject]` Blind Hunter: under the "settles the named decision" test, option 2 of Story 3.3's item cannot settle the decision for DW-4 and DW-5. — carried: same claim as the pass-1 Edge Case Hunter row on DW-39 option 2. The item lists both options after the colon, so choosing either one settles it.
  - `[low]` `[patch]` Blind Hunter: the two items describe DW-39's decision in different words, so one ledger line can be judged two ways. — Confirmed: Story 3.4 restated the decision as "which evidence may close". Entry N, patched: Story 3.4's item now reads "the same decision as Story 3.3's precondition".
  - `[low]` `[reject]` Blind Hunter: the spec calls DW-21 and DW-25 "decided" although their keep-open lines settle nothing. — The fix would edit this build's spec. Both are residual work for Gate 1, not decisions needed before a story, and the gap that they never reach Story 3.4's text is already deferred (Stories 3.3/3.4 item).
  - `[low]` `[reject]` Blind Hunter: DW-39's `reason:` is truncated in the ledger. — Pre-existing harvest truncation of a closing provenance sentence. Both options and the gap description are intact, and the intent forbids ledger edits.
  - `[low]` `[reject]` Blind Hunter: neither block names who decides or how to unblock. — carried: same claim as the pass-2 Blind Hunter unblock row.
  - `[low]` `[reject]` Blind Hunter: "does not start" ignores stories that already have a spec. — carried: same claim as the pass-1 Edge Case Hunter existing-spec row.
  - `[low]` `[reject]` Blind Hunter: verification cannot see the untracked spec and does not check placement. — carried: same claim as the pass-1 and pass-2 verification rows.
  - `[low]` `[reject]` Blind Hunter: the Story 3.4 anchors in the Code Map are off by one. — The fix would edit this build's spec, and the implementation anchored on text, not line numbers.
  - `[medium]` `[patch]` Edge Case Hunter: with DW-39 archived, the label's "settled on its ledger entry" halts a story on a met precondition. — Entry L, patched as above: the label now accepts `status: done`.
  - `[medium]` `[patch]` Edge Case Hunter: the label's "applied here" makes a story that the chosen option does not change wait forever. — Entry L, patched: the label now requires only "any change that decision makes to this story".
  - `[low]` `[patch]` Edge Case Hunter: for an archived entry the decision text lives in the archive, so a run cannot check that it was applied. — Entry M, patched: the Overview now names `deferred-work-archive.md` as the place where an archived entry keeps its full lines (bmad-loop `ARCHIVE_REL`).
  - `[medium]` `[defer]` Edge Case Hunter: DW-39 has no `gate:` line, though bmad-loop's `_refuse_gated_story` pauses dispatch of a gated story until the entry closes. — Confirmed in the installed `engine.py`. Adding the field is a ledger edit, which the intent forbids, so it is deferred as an operator recommendation.
  - `[false]` `[reject]` Intent Alignment: the example's subject and the Story 3.3 gate differ from the intent's example. — carried: same claim as the pass-1 and pass-2 Intent Alignment rows.
  - `[false]` `[reject]` Intent Alignment: "currently known" is applied to the ledger at implementation time, not at decision time. — "Currently known" naturally means the time of recording. DW-39 replaced the example's pending issue after DW-14 was applied and DW-6 closed.
  - `[medium]` `[defer]` Intent Alignment: run-time behavior is claimed on a surface that nothing changes or exercises. — carried: entry E. Not deferred again.
  - `[low]` `[reject]` Intent Alignment: the verification checks neither placement nor obedience. — carried: same claim as the pass-2 placement row.
  - `[low]` `[reject]` Intent Alignment: "a `deferred-work.md` entry" misses deferrals still sitting in a spec's `deferred:` list. — A precondition must name a ledger ID, and the orchestrator harvests spec deferrals into the ledger when the story finalizes. The window is short, and covering it adds scope.
  - `[low]` `[bad_spec]` Intent Alignment: the convention gates a story's start, while F-1 gated its acceptance. — carried: same claim as the trigger-narrowness rows. Applied in loopback 1; no further action.
  - `[false]` `[reject]` Intent Alignment: the header paragraph may not be "short". — carried: same claim as the pass-2 row.
  - `[false]` `[reject]` Intent Alignment: the artifact-only receipt does not apply. — carried: same claim as earlier rows. No receipt is asserted.

### 2026-10-04 — Review pass
- verdicts: 13 findings — high 0, medium 8, low 2, false 3, maybe-false 0
- findings:
  - `[medium]` `[defer]` Blind Hunter: prose does not prevent dispatch of Stories 3.3 and 3.4. — Carried from the earlier prose-only enforcement finding. DW-40 and DW-43 already record the mechanical gap; the authorized decision excludes tooling and ledger edits.
  - `[medium]` `[defer]` Blind Hunter: future decision-before-story deferrals have no owner or step that adds the matching precondition. — Carried from the earlier recurrence finding and already recorded in DW-40.
  - `[false]` `[reject]` Blind Hunter: `status: done` alone can clear DW-39 without a decision. — Carried from pass 3. The cited sweep behavior has not shown a reachable close that leaves the named choice pending; closure is the orchestrator's disposition, and any resulting story change still has to be applied.
  - `[medium]` `[patch]` Blind Hunter: Story 3.4 referred only to Story 3.3 for the choice, so a reader of Story 3.4 alone could not identify it. — Confirmed. The Story 3.4 item now repeats DW-39's two options and retains the cross-reference and criterion 8 caveat.
  - `[low]` `[reject]` Blind Hunter: DW-39's second option alone leaves DW-4 and DW-5 without Story 3.3 measurements. — Carried from the earlier lopsided-option finding. The option set belongs to the pre-existing DW-39 decision, and Story 3.4 criterion 8 still fails closed if evidence is missing.
  - `[medium]` `[defer]` Blind Hunter: Story 3.3 still omits DW-20 and DW-30. — Carried from the earlier fold-in-work finding and recorded in DW-41; neither is a decision-before-story precondition.
  - `[medium]` `[defer]` Blind Hunter: Story 3.4 still omits DW-21 and DW-25. — Carried from the earlier Gate 1 residual finding and recorded in DW-41; neither is a decision-before-story precondition.
  - `[medium]` `[defer]` Blind Hunter: Story 3.2 still omits DW-29's pinned verification command. — Carried from pass 2 and recorded in DW-42; the decision predates this story.
  - `[medium]` `[defer]` Edge Case Hunter: a dispatcher can start a story without reading its precondition block. — Carried from the earlier prose-only enforcement finding; DW-40 and DW-43 record it.
  - `[false]` `[reject]` Edge Case Hunter: a ledger entry marked done can leave the named decision unsettled. — Carried from pass 3; the reviewer showed no reachable erroneous closure, and an unapplied story change remains unmet.
  - `[low]` `[reject]` Edge Case Hunter: Execution quotes in this build's spec predate the final wording. — Confirmed, but the suggested fix edits only this build's spec; the operative `epics.md` text and prior review log record the final wording.
  - `[medium]` `[defer]` Intent Alignment Auditor: no dispatch guard or behavioral test proves that a run obeys the prose. — Carried from the earlier surface-divergence finding and recorded in DW-40; tooling changes are excluded by the human decision.
  - `[false]` `[reject]` Intent Alignment Auditor: adding this implementation spec exceeds the planning-artifact boundary. — The contract forbids any *other* spec; this spec is the required build-auto artifact. The shipped product change is confined to `epics.md`.

## Design Notes

A precondition that required DW-4..DW-6 to be *closed* before Story 3.4 would contradict criterion 8, which lets the Gate 1 record list an item as open. DW-14's review flagged this risk and left it to this bundle. The convention's subject is a pending *decision*. The decision still pending for these items is DW-39: whether Story 3.3 is amended to produce their evidence, or the evidence that may close DW-6 is revisited. So both stories depend on DW-39. Story 3.3 depends on it directly, because one option amends that story. Story 3.4 depends on it through criterion 8. The convention stays in prose and adds no tooling, as the human decision requires. A run reads the story section itself, and the compiled epic context omits story-level details. Each block's label line therefore repeats the stop rule instead of relying on the Overview. Nothing mechanical enforces the rule, and the `deferred` list records that residual.

## Verification

**Commands:**
- `git diff --check` -- expected: no output.
- `git diff --numstat` -- expected: `epics.md` with 0 deletions; only this spec otherwise.
- `grep -n '^\*\*Preconditions:\*\*\|^\*\*Story preconditions' _bmad-output/planning-artifacts/epics.md` -- expected: exactly three hits (Overview, Story 3.3, Story 3.4).

## Auto Run Result

Status: done

**Summary:** The dated Story preconditions convention and the DW-39 blocks for Stories 3.3 and 3.4 are in `_bmad-output/planning-artifacts/epics.md`. This follow-up review made Story 3.4's item self-contained by spelling out both DW-39 options. No human decision on DW-39 was made.

**Files changed since baseline:** `epics.md` has eight inserted lines and no deleted baseline lines; this spec records planning, review, and the run result. No ledger or sprint-status entry was changed by this run.

**Review findings:** One medium patch was applied. Seven medium findings were carried as pre-existing or out-of-scope deferrals already recorded in DW-40 through DW-43. Two low findings were rejected: DW-39's pre-existing lopsided options still fail closed at criterion 8, and the other requested only edits to this build's spec. Three findings were false: two lacked a demonstrated erroneous `done` closure, and one misread the ban on *other* specs. The follow-up triage rows above give each finding's reason. The verification-gap reviewer found no gap.

**Follow-up review recommended:** false. This was a follow-up pass with one medium patch and no high patch.

**Verification performed:** `git diff --check` passed. Against baseline `5c9e2d1d3dc27813c9c157ae9424eee06a1057bc`, `git diff --numstat` showed `8 0` for `epics.md`; the grep found exactly three labels at lines 34, 1591 and 1655. The Story 3.4 item names both options and still requires only the DW-39 decision, not closure of DW-4 through DW-6. No code or test file changed, so format, lint, type-check, and Vitest do not apply.

**Residual risks:** The convention is prose only; DW-40 and DW-43 hold the mechanical enforcement gap. DW-41 and DW-42 hold separate ledger-to-story omissions. Stories 3.3 and 3.4 still require the operator's DW-39 decision before they start.
