---
title: "Contract Amendment: Unavailable Commit-Detection Lookup, Worker Probe Row 6, and Commit Timer Reserve"
status: applied
created: 2026-10-04
updated: 2026-10-04
source_prd: prd.md
source_architecture: ../../architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md
source_retrospective: ../../../implementation-artifacts/epic-2-retro-2026-10-04.md
resolves:
  - epic-2-retro-F-1
  - epic-2-retro-F-3
  - epic-2-retro-F-6
  - epic-2-retro-F-7c
---

# Contract Amendment: Unavailable Commit-Detection Lookup, Worker Probe Row 6, and Commit Timer Reserve

## Status and Authority

Applied. The authority order is unchanged: PRD, then addendum, then `ARCHITECTURE-SPINE.md`, then `SPEC.md`, then repository contracts. This amendment changes the spine and `epics.md` only. The PRD, addendum, `SPEC.md`, the NFRs, and the Finding contract are unchanged.

### Decision Record

- **Decided by:** the coordinator, under the operator's delegated authority, on 2026-10-04.
- **Veto:** the operator may veto any of D1, D2, or D3. A veto reverts the matching edits listed below and reopens the matching retrospective finding.
- **Scope of the decision:** contract text only. Implementation and tests are separate open work (Epic 2 retrospective action items 1, 3, and 8).

## Problem

The Epic 2 retrospective (`epic-2-retro-2026-10-04.md`) found three gaps in the binding contract.

1. **F-1 / F-7c.** The enforced HTML create path maps a lookup that cannot run, made to detect a possibly committed write, to a failure outcome. The worker returns `aborted` row 3 from its first lookup, and its lookup before a non-committed outcome treats `unavailable` as absent. The requester falls through to row 4, 2, or 3. A possibly committed write can therefore reach the client as a failure. The contract never defined this branch: Story 2.5 AC3, AC4, and AC6, spine AD-7 (HTML import worker paragraphs), and the AD-20 row-7 definition listed only a crash, stall, queue failure, or a COMMIT whose outcome cannot be established. AD-20's stated purpose is to prevent "a committed write presenting as a failure (except row 7)".
2. **F-3.** Spine AD-7 said the worker resolves every found row through `committedFromSummary`, with only the unique-violation exception. The worker reports its own validation as row 6 when its commit-detection probe finds the row.
3. **F-6.** AD-11 gave `commit()` a wall-clock timer equal to the whole remaining persistence budget, so a commit timeout left the probe no usable bound.

## Decisions

### D1. Unavailable commit-detection lookup is row 7

A lookup whose purpose is to establish whether a write committed, and which cannot run or cannot be bounded, means the outcome cannot be established. The result is AD-20 row 7. This covers the HTML worker's first lookup, the lookup it repeats before returning or summarizing a non-committed outcome, the requester's probe, and the existing AD-20 commit-detection probe. Consequences:

- The worker reports no committed or failed claim (it throws, so the requester obtains no result).
- That attempt writes no summary, so no committed summary is written by it.
- The staged source is retained, because row 7 never deletes staged sources or blobs (AD-7).
- **Accepted residual.** A retained source that no later attempt consumes is orphaned. This amendment introduces no cleanup owner for it.

The lookup the worker makes inside its transaction after acquiring the AD-8 collection lock is not covered. A failure there leaves the transaction unusable, which is row 3 by AD-8, and the lookup repeated before that row 3 is returned is covered.

### D2. Worker row 6 after its own commit-detection probe

When the AD-20 commit-detection probe that follows the attempt's own rejected `commit()` finds the pre-allocated `documentId`, the worker may report its own `validation` as row 6 when the found row's title and `text` equal the title and `text` of this attempt's exact validated projection. Otherwise it resolves the row through `committedFromSummary`. The unique-violation exception is unchanged.

### D3. Commit timer leaves the probe reserve

In AD-11, `commit()` runs under a wall-clock timer equal to the remaining persistence budget less the 2-second commit-probe reserve (`COMMIT_PROBE_BOUND_MS`), so a commit timeout still leaves the probe its full bound. The probe keeps its own 2-second bound. The rest of AD-11 is unchanged.

## Rationale

- D1 makes the HTML path match the rule AD-20 already applies to the commit-detection probe ("a probe that cannot run, is row 7"). Reporting a failure instead could lead a client to retry and create a duplicate document. Retaining the source follows AD-7's row-7 rule. A redelivery may still need the source.
- D2 records the as-built behavior and bounds it. The equality condition prevents a second delivery's validation from describing a projection other than the persisted one (F-3).
- D3 removes a mechanism where a commit timeout made the probe refuse its bound below the `SET LOCAL` floor and so turned every commit timeout into row 7 (F-6).

## Changes Applied

| File | Location | Change |
| --- | --- | --- |
| `ARCHITECTURE-SPINE.md` | AD-7 Rule, line 114 | Row 7 leaving the requester-staged source now names the orphaned retained source as an accepted residual with no cleanup owner (D1). |
| `ARCHITECTURE-SPINE.md` | AD-7 HTML import worker, line 118 | Second exception to "every found row resolves through `committedFromSummary`": the equality-gated own-validation row 6 after the commit-detection probe (D2). |
| `ARCHITECTURE-SPINE.md` | AD-7 HTML import worker, line 120 | New sentence for an unavailable first or pre-outcome lookup (D1); the row-7 cause list gains "or commit-detection lookup". |
| `ARCHITECTURE-SPINE.md` | AD-7 HTML import worker, line 122 | Requester probe that cannot run or cannot be bounded is row 7 (D1). |
| `ARCHITECTURE-SPINE.md` | AD-11 Rule, line 169 | `commit()` timer is the remaining budget less the probe reserve; probe keeps its own bound (D3). |
| `ARCHITECTURE-SPINE.md` | AD-20 row-7 definition, line 343 | Cause list gains a commit-detection lookup that cannot run or cannot be bounded (D1). |
| `ARCHITECTURE-SPINE.md` | Amendment Record, line 434 | New row for this amendment. |
| `epics.md` | Story 2.3 AC9, line 1189 | Commit timer restatement aligned with D3. |
| `epics.md` | Story 2.5 AC3, line 1313 | Requester probe that cannot run or cannot be bounded is row 7 (D1). |
| `epics.md` | Story 2.5 AC4, line 1319 | New `And` clause for an unavailable first or pre-outcome lookup (D1). |
| `epics.md` | Story 2.5 AC6, line 1329 | Row-7 cause list gains "or commit-detection lookup" (D1). |
| `epics.md` | Story 2.5 AC8, line 1339 | New `And` clause encoding D2. |
| `epics.md` | Story 2.6 AC5, line 1395 | Orphaned retained source named as an accepted residual (D1). |

No AC was renumbered. Line numbers are those after the edits.

### Checked and left unchanged

- **AD-20 Commit detection (spine line 318).** It already states "row absent after a connection-level error, or a probe that cannot run, is row 7".
- **Story 2.3 AC9 second clause (`epics.md` line 1191).** It already states the same rule.
- **Story 2.3 AC3 (`epics.md` line 1160).** Statement timeouts were already set from the budget less the probe reserve.
- **Story 2.5 AC5 and Story 2.7 AC1.** Row 7 with an absent worker summary remains a recorded evidence gap.
- **Story 2.6 AC4.** Row 7 never deletes staged blobs.
- **PRD FR-16 exception 2, FR-20, FR-22, the addendum, and `SPEC.md`.** FR-16 already covers "an outcome the server cannot establish" with no persistence claim. FR-20 already says the request records no summary of its own. D1's row 7 is an FR-16 unestablished outcome, not a new FR-22 audit exception, so no PRD text required a change.

## Open Points

1. **D2 fingerprint (resolved by the coordinator, 2026-10-04).** The first draft named a fingerprint that neither the contract nor the code defines. The condition is now an equality that can be implemented and tested: the found row's title and `text` equal the title and `text` of this attempt's exact validated projection. If it does not hold, the worker resolves through `committedFromSummary`.
2. **AD-20 callback discard (spine line 318, Story 2.5 AC8).** Decided to leave as is: an attempt whose `commit()` rejected discards its buffered `afterCommit` callbacks, including after a D2 row 6, because the outcome of that commit was itself uncertain. The consequence is that a webhook or event for such a write may not be emitted. The operator may veto.
3. **Evidence lists (resolved).** AD-18 now names fixtures for an unavailable HTML-worker lookup (first and repeated), an unavailable requester probe, the D2 own row 6 and its mismatch fallback, and a COMMIT timeout that leaves the probe its bound. Story 2.5 AC11 is satisfied by that AD-18 list.
