---
title: 'DW-51: Re-assemble the Gate 1 evidence index and decision record after Story 3.2'
type: 'chore'
created: '2026-10-24'
status: 'in-progress'
baseline_revision: '5308b7edfeb13b1b4c645245301b7715c6466b62'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-4-assemble-the-gate-1-evidence-index-and-decision-record.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-2-close-layered-conformance-and-source-provenance-evidence-r2.md'
warnings: []
deferred: []
---

<frozen-after-approval reason="human-owned intent">

## Intent

**Problem:** `docs/wikilint-gate-1/evidence-index.md` and `decision-record.md` were assembled by Story 3.4 while Story 3.2 was `backlog`, so every Story 3.2 deliverable is a `gap` row and most test rows are `unverified`. Story 3.2 is now `done` with retained runs, a coverage map, a seam review, a generic-data review and provenance. Its own evidence still lists AC 4 (three seams outside the AD-18 kinds) and AC 7 (`corepack yarn build` exited 1 in the story worktree) as gaps, and both are now settled (DW-51).

**Approach:** Update the Story 3.2 evidence for the two settled items, then re-assemble the index and the record under exactly the Story 3.4 rules from the evidence now retained. The collocated `gate1EvidenceIndex.test.ts` keeps proving that the index is complete and that the decision follows the rule mechanically.

## Boundaries & Constraints

**Always:**
- Story 3.4's frozen rules apply unchanged: one row per binding ID with its columns, the meaning of each result, the source-revision rule, the `accepted-gap` limits, the AC 2 decision rule with no waiver, residual owners taken from their sources or `not named in source`, and every item the epic says the record states.
- Decision (AC 4 and AD-18, operator 2026-10-24): AD-18 now permits ten seam kinds (Architecture Spine, AD-18, Amendment Record row of 2026-10-24). The three dependencies that the Story 3.2 seam review left outside the seven kinds (`schedule`, the `AttemptPlan` members, `setTimingProbe`) are job scheduling, attempt-phase implementations and the process timing probe. `conformance.md` reclassifies those rows, and `coverage.md` turns AC 4 and the AD-18 seam part into evidence, citing the amendment. Any other part of those rows stays as recorded.
- Decision (AC 7, operator 2026-10-24): the coordinator ran `corepack yarn build` from the main worktree root at 2026-10-24T12:04:00Z on HEAD `5308b7edfeb13b1b4c645245301b7715c6466b62`; it exited `0` and ended with `Done!`. The earlier exit `1` in the story worktree came from a stray `node_modules/node_modules` symlink that a coordinator setup step had created in the main checkout; the coordinator removed it before this run. `conformance.md` records this run as run by the coordinator, and `coverage.md` turns AC 7 into evidence. The worker does not run the build.
- The retained runs, raw reports, provenance checks and generic-data review of Story 3.2 are not re-run and not edited, except the AC 4 and AC 7 rows and the seam rows named above.
- A row is `pass` only when its linked evidence is a retained run, review or record; a claim without retained raw output stays `unverified`. Open deferred-work entries that bear on Gate 1, including DW-50 (one unexplained database stall in a coordinator verify run) and DW-13, are recorded where they apply, with their status from the ledger.
- `decision-record.md` states the recomputed decision and lists every blocking row; the test recomputes both from the index.

**Never:**
- Change functional code, a constant, a severity, or the outcome of any test other than the index test's own expectations for the re-assembled index.
- Claim SM-P1–7 pilot evidence or production success, invent OD values, or mark Story 3.3's provisional constants as fixed.
- Push an image, change an environment, deploy, mount a policy, or enable a collection policy.
- Edit the deferred-work ledger, the sprint board, the epics file, the Architecture Spine or this spec.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Story 3.2 deliverable | the conformance run, coverage map, merge-base, backport inventory, generic-data review | each row links the Story 3.2 evidence file and its source revision, with the result that evidence supports | no evidence for an ID: `gap` naming the missing item |
| Retained test evidence | a requirement whose test passed in the three retained runs | `pass`, linking the run reports | a claim with no retained run stays `unverified` |
| Provisional constants | Story 3.3 constants still provisional | the three D-9 constant rows and AD-17 stay `gap` | listed as blocking |
| Recomputed decision | any row `fail`, `gap`, `unverified` or `contradictory`, or an SM-I or phase-blocking row not `pass` | `not ready`, every blocking row listed | the test fails if the record differs |

</frozen-after-approval>

## Code Map

- `docs/wikilint-gate-1/evidence-index.md`, `docs/wikilint-gate-1/decision-record.md` -- the Story 3.4 index and record to re-assemble.
- `docs/wikilint-gate-1/coverage.md`, `docs/wikilint-gate-1/conformance.md`, `docs/wikilint-gate-1/provenance.md`, `docs/wikilint-gate-1/raw/` -- the Story 3.2 evidence; only the AC 4, AC 7 and seam rows change.
- `server/wikiLint/benchmark/gate1EvidenceIndex.test.ts` -- recomputes completeness, the decision and the blocking rows.
- `_bmad-output/planning-artifacts/architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md` (AD-18 and its Amendment Record) -- read-only.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- read-only source of entry statuses.

## Tasks & Acceptance

**Execution:**
- `docs/wikilint-gate-1/conformance.md`, `coverage.md` -- apply the AC 4 and AC 7 decisions.
- `docs/wikilint-gate-1/evidence-index.md`, `decision-record.md` -- re-assemble from the retained evidence under the Story 3.4 rules.
- `server/wikiLint/benchmark/gate1EvidenceIndex.test.ts` -- update only the expectations that encode the old Story 3.2 `backlog` state, keeping every completeness and decision check.

**Acceptance Criteria:**
- Given the re-assembled index, when `gate1EvidenceIndex.test.ts` runs, then every binding ID has exactly one row and the record's decision and blocking rows equal the recomputed ones.
- Given a Story 3.2 deliverable, when its row is read, then it links the Story 3.2 evidence and no longer names Story 3.2 as a pending closing source.
- Given AC 4, AD-18 and AC 7, when their rows are read, then they cite the 2026-10-24 decisions above.

## Spec Change Log

## Review Triage Log
