---
title: 'DW-14: Record in Story 3.4 that no read-only production rollout precedes Story 3.3 closing DW-4, DW-5 and DW-6'
type: 'chore'
created: '2026-10-04'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred:
  - summary: >-
      Story 3.3 has no acceptance criterion that produces the evidence Story 3.4 criterion 8 needs to close DW-4, DW-5 or DW-6.
    evidence: |-
      Story 3.3 criteria 3, 5 and 7 measure lint_wiki call latency, atomic-unit time, result-assembly time and single SET LOCAL statement durations. None measures how long synchronous evaluation blocks the event loop (DW-4), or the serialize/parse CPU time of a keyset batch between deadline checks (DW-5). Criterion 2 forbids competing traffic, and criterion 7's re-run list has no held-pool case, so no Story 3.3 evidence exercises pool-wait acquisition (DW-6). DW-6 was resolved in code by b732efe0f2c58494558327776719fcaa122f2350 after the DW-14 decision was recorded in 495d11015982b164311f1f97072d7a7cdd526c7b. So the Gate 1 record will list DW-6 as not closed by Story 3.3 evidence while the ledger marks it done. Two ways to settle this, and the operator has to choose: amend Story 3.3 to add the DW-4 and DW-5 measurements and a held-pool fixture re-run under the AD-17-fixed floor, or revisit which evidence may close DW-6. The gap predates this change. This change follows the "Amend Story 3.4 ACs now" decision and does not edit Story 3.3.
    location: >-
      _bmad-output/planning-artifacts/epics.md:1575-1634 (Story 3.3)
    severity: medium
baseline_revision: 99f7d8e61965768842571798ce104ed61b18628f
---

<intent-contract>

## Intent

**Problem:** Epic 1 retro action item 4 (DW-14) requires the Gate 1 plan to say that no read-only production rollout happens before Story 3.3 closes DW-4 (`lint_wiki` unit evaluation blocks the event loop), DW-5 (synchronous CPU work between deadline checks) and DW-6 (pool-wait connection acquisition). Story 3.4 in `epics.md` does not say this. On 2026-10-04 the human chose option 1, "Amend Story 3.4 ACs now": add an acceptance criterion so the Gate 1 decision record states that no read-only production rollout is authorized until Story 3.3 evidence closes DW-4, DW-5 and DW-6.

**Approach:** Append one acceptance criterion, numbered 8, to Story 3.4 in `_bmad-output/planning-artifacts/epics.md`, in the story's Given/When/Then/And format. Make no other change.

## Boundaries & Constraints

**Always:**
- The new criterion keeps the decision's wording: "no read-only production rollout is authorized until Story 3.3 evidence closes DW-4, DW-5, and DW-6". It names the three risks as the decision does (event-loop blocking, CPU between deadline checks, pool-wait acquisition) and cites "Epic 1 retrospective action item 4", following the precedent at `epics.md:930`.
- The record states this precondition whatever its Gate 1 decision is. For each item, it links the Story 3.3 evidence that closes it or records the item as open.
- Meeting the precondition does not authorize anything. Read-only rollout remains a separately approved Gate 4 decision, as criterion 6 already says.
- Criteria 1–7 stay byte-identical. The new criterion follows criterion 7 and uses the same three-space continuation indent and bold keywords.

**Never:**
- Do not edit the deferred-work ledger, `sprint-status.yaml`, either retro, the PRD, the addendum, the Architecture Spine, SPEC.md, its `.memlog.md`, or any other spec in implementation-artifacts.
- Do not edit Story 3.3, Story 3.4's traceability block, the epics frontmatter or the Overview. Do not create a sprint-change proposal or an amendment record.
- Do not make DW-4, DW-5 or DW-6 Gate 1 phase-blocking. Criterion 5 keeps the D-9 items as the only phase-blocking items.
- Do not drop DW-6 or make an exception for it, even though the code fix in `spec-dw-6-*` has already closed it in the ledger (see Design Notes).
- Do not change code or tests, and do not choose OD-2, OD-6 or OD-7 values.

</intent-contract>

## Code Map

- `_bmad-output/planning-artifacts/epics.md:1636-1685` -- Story 3.4 "Assemble the Gate 1 Evidence Index and Decision Record", the last story in the file. Criterion 7 (`:1682-1685`) ends the story and the file, which ends with a single newline. Criterion 6 (`:1677-1680`) already keeps Gate 4 read-only and enforced rollout separately approved, and the new criterion leans on it. Criterion 5 (`:1672-1675`) limits phase-blocking items to D-9.
- `_bmad-output/planning-artifacts/epics.md:1575-1634` (read-only) -- Story 3.3. Criteria 5 and 7 cover the measurements that DW-4 and DW-5 point to: unit and batch times, the stop margin, and the `SET LOCAL` floor.
- `_bmad-output/planning-artifacts/epics.md:930` (read-only) -- the precedent for citing "(Epic 1 retrospective action item 1)" in story text.
- `_bmad-output/implementation-artifacts/deferred-work.md:28-51,121-129` (read-only) -- DW-4 and DW-5 are `open`. DW-6 has been `done 2026-10-04` since the sweep commit `b732efe0f2c58494558327776719fcaa122f2350`. DW-14 carries the decision, which was recorded in `495d11015982b164311f1f97072d7a7cdd526c7b` before that sweep.
- `_bmad-output/implementation-artifacts/epic-1-retro-2026-10-03.md:152` (read-only) -- action item 4, the origin of DW-14.

## Tasks & Acceptance

**Execution:**
- `_bmad-output/planning-artifacts/epics.md` -- after Story 3.4 criterion 7, add one blank line, then criterion 8: **Given** the event-loop blocking, CPU work between deadline checks, and pool-wait acquisition risks that `deferred-work.md` records as DW-4, DW-5, and DW-6 (Epic 1 retrospective action item 4); **When** the Gate 1 decision record states its decision, `ready` or `not ready`; **Then** it states that no read-only production rollout is authorized until Story 3.3 evidence closes DW-4, DW-5, and DW-6, and for each item it links the Story 3.3 evidence that closes it or records the item as open; **And** closing them authorizes no rollout, because read-only rollout remains a separately approved Gate 4 decision (criterion 6). -- This applies the human decision on DW-14.

**Acceptance Criteria:**
- Given the edited `epics.md`, when Story 3.4 is read, then its last criterion is number 8. It states that no read-only production rollout is authorized until Story 3.3 evidence closes DW-4, DW-5, and DW-6, and it names the three risks and Epic 1 retrospective action item 4.
- Given the change set against the baseline, when it is diffed, then the only differences are the lines added after Story 3.4 criterion 7 in `epics.md` and this spec file. No existing line changed, and `git diff --check` reports nothing.

## Spec Change Log

## Review Triage Log

### 2026-10-04 — Review pass
- verdicts: 18 findings — high 0, medium 6, low 11, false 0, maybe-false 1
- findings:
  - `[medium]` `[defer]` Blind Hunter: Story 3.3 is never asked to produce DW-4 or DW-5 evidence (no event-loop block duration, no batch CPU time), so the record will mark them open. — Confirmed: Story 3.3 criteria 3, 5 and 7 (`epics.md:1601-1625`) do not measure either. The gap predates this change, and amending Story 3.3 goes beyond the "Amend Story 3.4 ACs now" decision. Deferred as one entry together with the other Story 3.3 evidence-gap rows.
  - `[low]` `[reject]` Blind Hunter: the criterion never defines what "closes" means (no bound, no command, revision or raw location). — The decision itself uses "closes" without a rule, and the ledger entries already describe what settles each item. A threshold would invent values the intent does not give. Read-only rollout still needs separate Gate 4 approval (criterion 6), and the fix adds new rules rather than correcting text.
  - `[medium]` `[defer]` Blind Hunter: DW-6 cannot be closed by Story 3.3 evidence as required (criterion 7 has no held-pool re-run), so the record will contradict the ledger's `done`. — Confirmed: DW-6 was resolved by `b732efe0f2c58494558327776719fcaa122f2350` after the decision (`495d11015982b164311f1f97072d7a7cdd526c7b`), and Story 3.3 has no held-pool case. The criterion keeps DW-6 because the decision names it explicitly (spec Never and Design Notes). Same root cause as the Story 3.3 evidence gap, so it shares that deferred entry, which asks the operator to amend Story 3.3 or revisit DW-6.
  - `[low]` `[reject]` Blind Hunter: the criterion does not say that open DW items leave the Gate 1 decision alone, and criterion 2 could force `not ready`. — Criterion 8 applies "whatever its decision, `ready` or `not ready`", and criterion 5 makes only the D-9 items phase-blocking. An item recorded as open is an accurate claim, not an unverified one. Misreading this is unlikely, and the fix adds a new rule.
  - `[low]` `[reject]` Blind Hunter: an item fixed after Story 3.3 can never meet "Story 3.3 evidence", and the criterion does not say which source governs at Gate 4. — The closure source is the decision's own wording. Story 3.3 is in backlog, so any fix that lands before it is measured by it. Gate 4 read-only rollout remains a separate human approval (criterion 6). Changing the source would override the decision.
  - `[maybe-false]` `[reject]` Blind Hunter: this conflicts with the pending DW-15 decision, which would record "Story 3.4 on DW-4..DW-6" as a precondition. — DW-15 is open and not yet applied, and its decision gives this only as an example ("e.g."). Whether a conflict exists depends on how DW-15 is worded when someone applies it, with criterion 8 already in place. If the conflict is real, the loop would pause Story 3.4 until a human decides, which fails closed and is low at most. Rejected; the DW-15 bundle settles it.
  - `[low]` `[reject]` Blind Hunter: the traceability block does not follow the `epics.md:930` precedent (a Gates-line citation), and tooling looks there. — The tooling claim is false: a grep of the repository's Python scripts finds no parser for `Gates:` or `Traceability`. The criterion carries the citation, and Story 3.4's Gates line already covers the separation from Gate 2 to Gate 4. Adding a cross-reference is new scope with no named harm.
  - `[low]` `[reject]` Blind Hunter: "read-only production rollout" maps to no Gate 4 step, and "policy validation" might already mount a policy. — The term is the decision's own wording, and criterion 6 uses the same "Gate 4 read-only/enforced rollout". Assigning meaning to individual Gate 4 steps would invent semantics that the OD-owned gates leave open.
  - `[medium]` `[defer]` Edge Case Hunter: DW-6 was closed by the sweep and not by Story 3.3, so the record must call it open, and criterion 2 might force `not ready`. — Same root cause and evidence as the Blind Hunter DW-6 row, so it shares that deferred entry. The criterion 2 part is addressed in the Blind Hunter Gate 1 row.
  - `[low]` `[reject]` Edge Case Hunter: if DW-4 or DW-5 is fixed in code after Story 3.3, the item stays open forever. — Same reasoning as the Blind Hunter row on post-Story 3.3 fixes: the closure source is the decision's wording, and Gate 4 still needs separate human approval.
  - `[medium]` `[defer]` Edge Case Hunter: no Story 3.3 criterion measures event-loop block duration or keyset-batch CPU time. — Confirmed, and it shares the Story 3.3 evidence-gap deferred entry.
  - `[low]` `[reject]` Edge Case Hunter: "closes" has no pass rule. — Same reasoning as the Blind Hunter "closes" row: a threshold would fabricate values.
  - `[low]` `[reject]` Edge Case Hunter: an item recorded as open has no owner, revisit gate or Gate 4 entry check. — The record itself states that no read-only production rollout is authorized, and that is the statement a Gate 4 approver reads. The retro already names the Operator as owner. `epics.md` has no Gate 4 story to carry a check. Unlikely to matter in practice, and the fix would add new process content.
  - `[medium]` `[defer]` Intent Alignment: Story 3.3 has no criterion that produces DW-specific evidence, so criterion 8 is enforced at the record surface and not at the evidence surface. — Confirmed, and it shares the Story 3.3 evidence-gap deferred entry.
  - `[medium]` `[defer]` Intent Alignment: "closes" means different things for DW-6 (ledger code fix versus Story 3.3 evidence). — Same root cause as the Blind Hunter DW-6 row, so it shares that deferred entry. The divergence is intentional and documented in Design Notes.
  - `[low]` `[reject]` Intent Alignment: rollout authorization is restated at Gate 1 and not enforced at a Gate 4 surface. — `epics.md` defines no Gate 4 story, and §Success measures says these stories never perform rollout. The criterion's And clause ties the precondition to the separately approved Gate 4 decision (criterion 6). There is no surface to edit within the decision.
  - `[low]` `[reject]` Intent Alignment: the link to Gate 1 `ready` is implicit. — Same reasoning as the Blind Hunter Gate 1 row.
  - `[low]` `[reject]` Intent Alignment: the traceability block is unchanged. — Same reasoning as the Blind Hunter traceability row.

### 2026-10-04 — Follow-up review pass
- verdicts: 8 findings — high 0, medium 6, low 1, false 1, maybe-false 0
- findings:
  - `[medium]` `[defer]` Blind Hunter: Story 3.3 omits event-loop blocking duration for DW-4. — Carried from the prior Blind Hunter evidence-gap row: Story 3.3 criteria 3, 5 and 7 still measure call and unit timing, not event-loop stalls. This predates the criterion 8 edit and remains in the existing spec `deferred` item.
  - `[medium]` `[defer]` Blind Hunter: Story 3.3 omits batch serialization and parsing CPU time for DW-5. — Carried from the same prior Blind Hunter evidence-gap row: criteria 3, 5 and 7 still do not measure CPU time between deadline checks. The existing spec `deferred` item records the gap.
  - `[medium]` `[defer]` Blind Hunter: DW-6 lacks held-pool Story 3.3 evidence despite its ledger closure. — Carried from the prior Blind Hunter DW-6 row: criterion 7 still has no held-pool rerun. The existing spec `deferred` item records the operator decision needed to reconcile the evidence source.
  - `[low]` `[reject]` Blind Hunter: an open item lacks its own owner and revisit condition. — Carried from the prior Edge Case Hunter owner/revisit row: retrospective action item 4 names the Operator, criterion 8 records the rollout block, and adding a new Gate 4 process requirement is outside the chosen criterion edit.
  - `[medium]` `[defer]` Edge Case Hunter: Story 3.3 completion can leave DW-4 and DW-5 open. — Carried from the prior Edge Case Hunter measurement row; the Story 3.3 criteria remain unchanged. The existing spec `deferred` item covers both measurements.
  - `[medium]` `[defer]` Edge Case Hunter: DW-6 can be recorded as open without held-pool Story 3.3 evidence. — Carried from the prior Edge Case Hunter DW-6 row; the existing spec `deferred` item records the discrepancy and decision needed.
  - `[false]` `[reject]` Intent Alignment: this follow-up creates a forbidden extra spec. — The diff is against the original baseline and includes this already existing, explicitly supplied spec; this pass did not create another spec. The contract excludes editing any *other* spec, and its acceptance check expressly allows this spec in the diff.
  - `[medium]` `[defer]` Intent Alignment: the plan requires evidence that Story 3.3 does not yet produce. — Carried from the prior Intent Alignment evidence-surface row: criterion 8 is on the Gate 1 record surface, while Story 3.3 lacks the DW-specific measurements. The existing spec `deferred` item covers that pre-existing gap.

## Design Notes

DW-6 was resolved in code after the decision was recorded. Commit `b732efe0f2c58494558327776719fcaa122f2350` bounds pool acquisition by the request deadline and adds held-pool fixtures. The decision still names DW-6 and asks for "Story 3.3 evidence", so the criterion keeps DW-6. This makes the condition stricter, not contradictory. Story 3.3 fixes the `SET LOCAL` floor that the DW-6 refusal uses, and its re-run dependent fixtures can supply that evidence. The criterion only requires the record to link the evidence, or to record the item as open. Choosing which evidence closes DW-6 belongs to Stories 3.3 and 3.4 and is outside this edit.

## Verification

**Commands:**
- `git diff --check` -- expected: no output.
- `git diff --stat` -- expected: only `_bmad-output/planning-artifacts/epics.md` (insertions only), plus this spec when it is tracked.
- `sed -n '1636,$p' _bmad-output/planning-artifacts/epics.md` -- expected: Story 3.4 criteria 1–8 in order, with criterion 8 as specified, last in the file, ending with a single newline.

## Auto Run Result

Status: done

**Summary:** Story 3.4 criterion 8 records the DW-14 precondition: no read-only production rollout is authorized until Story 3.3 evidence closes DW-4, DW-5 and DW-6. The Gate 1 record must link closing evidence or mark each item open; Gate 4 still requires separate approval. This follow-up pass made no change to that criterion.

**Files changed since the baseline:**
- `_bmad-output/planning-artifacts/epics.md` -- adds criterion 8 after Story 3.4 criterion 7.
- `_bmad-output/implementation-artifacts/spec-dw-14-gate-1-read-only-rollout-precondition.md` -- records the plan, two review passes and this result.

**Review findings:** This pass reported 8 findings: high 0, medium 6, low 1, false 1, maybe-false 0. Patched entries: high 0, medium 0, low 0. The six medium findings repeat the existing deferred Story 3.3 evidence gap, so no new deferred item was added. The low owner/revisit finding was rejected because the retrospective names the Operator and criterion 8 already states the rollout block; a new Gate 4 process rule is outside this edit. The extra-spec finding was rejected as false: the diff includes the supplied spec from the original baseline, and no other spec was created. The Review Triage Log records each verdict and reason. The verification-gap reviewer reported no findings.

**Follow-up review recommended:** false. This follow-up pass patched no high entry.

**Verification performed:** `git diff --check` against baseline `99f7d8e61965768842571798ce104ed61b18628f` passed with no output. `git diff --numstat` against that baseline showed five insertions and zero deletions in `epics.md`; this spec had 110 insertions and zero deletions before this result was added. Manual inspection of Story 3.4 showed criteria 1–8 in order, with criterion 8 last. A byte check found one criterion 8 and exactly one final newline. No code or test file changed, so code tests, type checks and formatting commands do not apply.

**Residual risks:** Story 3.3 does not yet require measurements for DW-4/DW-5 or a held-pool rerun for DW-6, while the criterion requires Story 3.3 evidence. The existing spec `deferred` item records the human decision needed to reconcile that evidence. Until it is settled and Gate 4 separately approves rollout, the criterion leaves read-only production rollout unauthorized.
