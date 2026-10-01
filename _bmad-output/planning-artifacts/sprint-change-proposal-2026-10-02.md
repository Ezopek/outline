---
title: "Sprint Change Proposal: Align epics.md with the 2026-10-02 Spine Amendment"
status: approved
created: 2026-10-02
approved: 2026-10-02
workflow: bmad-correct-course
mode: batch
target: _bmad-output/planning-artifacts/epics.md
binding_sources:
  - _bmad-output/planning-artifacts/prds/prd-outline-2026-09-20/prd.md
  - _bmad-output/planning-artifacts/prds/prd-outline-2026-09-20/addendum.md
  - _bmad-output/planning-artifacts/architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md
  - _bmad-output/specs/spec-outline-mcp-wiki-linting/SPEC.md
trigger:
  - _bmad-output/planning-artifacts/architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md (Amendment Record, 2026-10-02)
  - _bmad-output/planning-artifacts/architecture/architecture-outline-2026-09-21/.memlog.md (entries from the 2026-10-02 update run)
---

# Sprint Change Proposal: Align `epics.md` with the 2026-10-02 Spine Amendment

## Status and Authority

The operator asked for this follow-up directly after the spine update of 2026-10-02, chose batch mode, and approved this proposal on 2026-10-02. The edits are applied to `epics.md` in the working tree and are not committed. The operator wants them committed together with the spine amendment.

The authority order is unchanged: the PRD, then its addendum, then `ARCHITECTURE-SPINE.md`, then `SPEC.md`, then the repository contracts. The PRD, addendum, and SPEC are read-only here; their SHA-256 hashes before and after this run are identical (see Verification). The spine is the trigger and is not edited by this proposal. No implementation, image publication, deployment, configuration, or rollout is authorized or performed.

## 1. Issue Summary

**Trigger.** `sprint-change-proposal-2026-10-01.md` §4.6 and §5 handed three items to the architect: the below-floor snapshot code on the read surfaces versus write phase P5, the admission of a collection that an admin can read without membership, and the `lint_wiki` admission order. The spine update of 2026-10-02 decided them with the operator and, through three reviewer rounds, tightened the surrounding rules:

- a snapshot batch refused below the `SET LOCAL` floor is `VALIDATION_TIMEOUT` on `lint_wiki` and `lint_document` (AD-3, AD-10, AD-11);
- collection-graph checks (hierarchy and global-index) require `can(actor, "readDocument", collection)`; without it the snapshot marks the collection `graphAuthorized: false`, reads no `documentStructure`, and the shell emits a generic `VALIDATION_RUNTIME_FAILED` per required check (AD-9, AD-11, AD-12);
- the `lint_wiki` admission order, rejection shapes, and slot release are fixed (AD-16);
- FR-12 is read as applying inside an established scope, so a scoped lookup failure is a Tool-Execution Error; missing and denied targets return the same error, and non-application lookup failures return the fixed message (AD-10, AD-11, AD-16);
- `lint_document` completes lookup and authorization before the first snapshot batch, keeps evaluating when the collection-readability check fails, and re-reads the document's collection and deletion state in the snapshot (AD-10, AD-11);
- per-surface requiredness, unit positions, vacuous completion, and the timeout prefix are defined (AD-11); and
- global-index Findings are emitted for provable pairs while unprovable pairs add one System Failure (AD-9).

**Category.** Requirement change from stakeholder decisions: operator decisions applied to a higher-authority source.

**Problem statement.** After the amendment, several story criteria contradicted the spine, and Story 3.4 still recorded the three items as undecided. The reconcile review of the amendment (`reviews/review-reconcile-2026-10-02.md`) and two confirmation reviews identified the affected criteria.

**Evidence.**

| Evidence | Location before this change |
| --- | --- |
| Below-floor snapshot batch mapped to `VALIDATION_RUNTIME_FAILED` | Story 1.3 AC3; Story 1.5 AC11 |
| `documentStructure` read for every evaluated collection | Story 1.5 AC6; Story 1.6 AC1 |
| Admin-without-membership fixture implies graph checks can complete | Story 1.5 AC3 |
| Missing and denied targets return "baseline content"; lookup failures keep baseline behavior | Story 1.3 AC9; Story 1.5 AC2; Story 1.7 AC7; Story 1.10 AC3 |
| Sentinel readability failure always adds a modeled `VALIDATION_RUNTIME_FAILED` | Story 1.5 AC5 |
| "Longest fully completed prefix"; no unit positions for vacuous checks | Story 1.7 AC2, AC4; Story 1.6 AC8, AC10 |
| `lint_document` completeness tied to every enabled rule, including graph rules | Story 1.3 AC5 |
| Global-index check suppresses all Findings when one fact is unprovable | Story 1.6 AC7 |
| Three architect items recorded as open | Story 3.4 AC5; Epic 1 implementation notes |
| AD-18 fixture list missing the new fixtures | Story 3.2 AC1 |
| AD-9, AD-10, AD-11, AD-16 summaries predate the amendment | Requirements Inventory |

## Checklist Record

| Item | Status | Note |
| --- | --- | --- |
| 1.1 Triggering story | [N/A] | No story was implemented. The trigger is the spine amendment. |
| 1.2 Core problem | [x] | Requirement change; see Issue Summary. |
| 1.3 Evidence | [x] | See the evidence table and the 2026-10-02 reviews. |
| 2.1 Current epic | [x] | Epic 1 can be completed as planned with amended criteria. |
| 2.2 Epic-level changes | [x] | Epic 1 implementation note only. No epic added, removed, or redefined. |
| 2.3 Remaining epics | [x] | Epic 2 changes in Story 2.3 only (per-surface requiredness); the write-path codes are unchanged. Epic 3 changes in Stories 3.2, 3.3, and 3.4. |
| 2.4 Obsolete or new epics | [x] | None. Story 1.6 gains criterion 12; no new story. |
| 2.5 Order and priority | [x] | Unchanged: Epic 1, then Epic 2, then Epic 3. |
| 3.1 PRD conflicts | [x] | None open. FR-12 is read as applying inside an established scope; a one-sentence PRD clarification is recommended and non-blocking (spine Open PRD residuals). |
| 3.2 Architecture conflicts | [x] | None. The edits follow the amended spine. |
| 3.3 UI/UX | [N/A] | No UI in this increment. |
| 3.4 Other artifacts | [!] | RI-5 (stale `server/tools/README.md` and `AGENTS.md` lines) stays open and outside this run's authority. SPEC is not made stale. |
| 4 Path forward | [x] | Direct Adjustment. |
| 5.1–5.5 Proposal components | [x] | This document. |

## 2. Impact Analysis

### Epic Impact

- **Epic 1:** Stories 1.3, 1.5, 1.6, 1.7, and 1.10 amended; the implementation note no longer defers to an architect review.
- **Epic 2:** Story 2.3 AC4 and AC5 state per-surface requiredness: graph checks never run on writes, and the `readDocument` condition does not apply. The write-path floor mapping (rows 3 and 5, `VALIDATION_TIMEOUT` once P5 began) is unchanged.
- **Epic 3:** Story 3.2 AC1 lists the new AD-18 fixtures; Story 3.4 AC5 records the items as decided and lists the new residuals.

### Artifact Conflicts

None with the PRD, addendum, SPEC, or spine. RI-5 remains open as before.

### Technical Impact

None yet; no code exists. Story implementers gain one snapshot field (`graphAuthorized`), a shell-emitted failure for graph checks, a bounded pre-scope transaction on both read surfaces, and the uniform denial error.

## 3. Recommended Approach

**Direct Adjustment.** Amend the affected criteria in place and append one criterion to Story 1.6 and amend Story 2.3 for per-surface requiredness, keeping every existing criterion number so cross-references stay valid. Effort is low; risk is low because every change restates an adopted spine rule. Timeline impact is none.

## 4. Detailed Change Proposals

Every edit is listed in full, with its old and new text, in the Appendix, in the order applied; E41 to E47 refine text that E12, E13, E30, E31, and E33 introduced. Summary:

| ID | Location | Change |
| --- | --- | --- |
| E1, E2 | Frontmatter, Overview | Amendment date and record; amendment paragraph after the replan status. |
| E3–E6 | Requirements Inventory | AD-9, AD-10, AD-11, AD-16 summaries follow the amendment. |
| E7 | Epic 1 implementation notes | The three items are decided and carried by Stories 1.3, 1.5, 1.6, and 1.7. |
| E8–E12 | Story 1.3 AC2, AC3, AC5, AC6, AC9 | Snapshot re-read; below-floor `VALIDATION_TIMEOUT`; per-surface requiredness; readability-check failure; bounded pre-snapshot steps and uniform denial. |
| E13–E19 | Story 1.5 AC2, AC3, AC5, AC6, AC11, AC12 | Uniform denial and fixed message; admin fixtures; sentinel readability per surface; `readDocument`-gated structure reads; below-floor code; empty policy set. |
| E20–E25 | Story 1.6 AC1, AC7, AC8, AC10, AC11, new AC12 | Graph checks gated on `readDocument`; global-index pair rule; vacuous completion; unit positions; fixtures; shell-emitted failure. |
| E26–E32 | Story 1.7 AC2, AC4, AC7 | Document-unit existence and unit positions; timeout prefix; uniform denial, empty policy set, fixed message, slot release after audit. |
| E33, E34 | Story 1.10 AC3, AC6 | Uniform denial; admin-without-`readDocument` actor in the disclosure fixtures. |
| E35 | Story 3.2 AC1 | New AD-18 fixtures. |
| E36 | Story 3.4 AC5 | Items decided; FR-12 clarification and two residuals listed. |
| E37, E40, E41, E58 | Story 1.5 AC2, AC5, AC6 | Snapshot loads only required-check inputs; identity fixed by the pre-admission `read`; non-application failure wording; "scope selection". |
| E38, E39 | Story 2.3 AC4, AC5 | Per-surface requiredness on the write surface. |
| E42, E43 | Story 1.3 AC6, AC9 | Authentication failures keep baseline behavior; readability-check expiry continues evaluation. |
| E44–E46 | Story 1.7 AC3, AC7 | Stop-margin stop is `VALIDATION_TIMEOUT`; duplicate citation removed; non-application failure wording. |
| E47 | Story 1.10 AC3 | Non-application failure wording. |
| E48 | Story 1.8 AC10 | Read-audit fixtures for the new paths. |
| E49–E54 | Requirements Inventory | AD-3, AD-10, AD-11, AD-12, AD-18 summaries completed. |
| E55 | Story 3.2 AC1 | Timeout-prefix, lookup-failure, admin, revoked-`read`, and required-input fixtures. |
| E56, E57 | Story 3.3 AC7 | Floor derivation covers pre-scope lookups; re-run list adds the below-floor cases. |

## 5. Implementation Handoff

**Scope classification: Minor.** Criteria are restated within the approved structure; no backlog reorganization.

| Role | Responsibility |
| --- | --- |
| Operator (Wiki operator) | Approve or revise this proposal. Optionally authorize the one-sentence FR-12 clarification as a separate PRD amendment. Separately authorize implementation when ready. |
| Product Owner / Scrum (`bmad-sprint-planning`) | Generate `sprint-status.yaml` from the amended epics when implementation is authorized. |
| Developer (`bmad-build` / `bmad-agent-dev`) | Implement stories only under separate authorization; treat the D-9 constants as provisional until Story 3.3 fixes them. |

**Success criteria:** every amended criterion traces to the amended spine; no criterion still records the three items as open; criterion numbers are unchanged; Gate 1 is assessed only from implementation evidence in Story 3.4; no release stage is implied.

## Gate 1

`not ready`. No implementation evidence exists. No PRD and spine conflict is open, and no planning blocker remains.

## Review Record

An independent reviewer checked the first 36 edits against the amended spine and the PRD (`architecture/architecture-outline-2026-09-21/reviews/review-epics-2026-10-02.md`): 0 Critical, 1 High, 3 Medium, 10 Low, 2 Info. None of the 36 edits contradicted the PRD or misstated its spine rule. The findings were amended spine rules that no story yet carried, plus wording and coverage gaps. All High, Medium, and Low findings are applied as E37 to E58. Info items: the change record must be committed with `epics.md`; Story 3.4 names the Wiki operator as owner of the FR-12 clarification, which the spine leaves unowned. The applied fixes were not re-reviewed.

The reviewer's sweep found no remaining "longest fully completed prefix", below-floor `VALIDATION_RUNTIME_FAILED` on the read side, or "Story 3.4 criterion 5" deferral, and every criterion-number cross-reference resolves to the intended criterion.

## Verification

SHA-256 of the read-only binding sources, identical before and after this run:

| File | SHA-256 |
| --- | --- |
| `prds/prd-outline-2026-09-20/prd.md` | `0a5dc66c26f6adbda75b257ddd00e9b34f7f4e9c4d9e098ba57d8c368946db02` |
| `prds/prd-outline-2026-09-20/addendum.md` | `5b8fd7e0f205aced13aa1aeeeea00cbaa796d963f9ebef8e9b5b6452ffaffa5c` |
| `specs/spec-outline-mcp-wiki-linting/SPEC.md` | `70f7da8ae70f5135a3cb90ffa94f839128b68d2468ca5466b002fd2f928fe04f` |

`epics.md`: `7c42a7ca88ef33e547e6644d4275c3cf8f6a4e358cae13df1ba8ea304349a010` before, `22c19c54d721b8653bf48828f8b8f24d03c5bb62a8881777621f441e31d817d0` after (55 insertions, 45 deletions). Every edit was applied by exact-match replacement that required exactly one occurrence of its old text.

## Appendix: Edits Applied

### E1 — Frontmatter

**Old:**

```text
replanned: 2026-10-01
changeRecord: _bmad-output/planning-artifacts/sprint-change-proposal-2026-10-01.md

```

**New:**

```text
replanned: 2026-10-01
changeRecord: _bmad-output/planning-artifacts/sprint-change-proposal-2026-10-01.md
amended: 2026-10-02
amendmentRecord: _bmad-output/planning-artifacts/sprint-change-proposal-2026-10-02.md

```

### E2 — Overview, after Replan status

**Old:**

```text
(none)
```

**New:**

```text
**Amendment (2026-10-02).** Stories 1.3, 1.5, 1.6, 1.7, 1.10, 3.2, and 3.4, the AD-9, AD-10, AD-11, and AD-16 summaries, and the Epic 1 implementation note follow the spine amendment of 2026-10-02, which decided the three architect items of `sprint-change-proposal-2026-10-01.md` §4.6: a snapshot batch refused below the `SET LOCAL` floor is `VALIDATION_TIMEOUT` on every read surface; collection-graph checks require `can(actor, "readDocument", collection)`; and the `lint_wiki` admission order is fixed. The change record is `sprint-change-proposal-2026-10-02.md`.
```

### E3 — Requirements Inventory, AD-9 summary

**Old:**

```text
a global-index Error requires every proving fact to be authorized and resolved.
```

**New:**

```text
a global-index Error requires every proving fact to be authorized and resolved, and only provable surface/index pairs yield Findings; collection-graph checks (hierarchy and global-index) also require `can(actor, "readDocument", collection)` and otherwise yield the generic `VALIDATION_RUNTIME_FAILED` without reading that collection's structure.
```

### E4 — Requirements Inventory, AD-10 summary

**Old:**

```text
and returns `VALIDATION_RUNTIME_FAILED` or `VALIDATION_TIMEOUT` with `complete: false` when the snapshot cannot be established.
```

**New:**

```text
and returns `VALIDATION_RUNTIME_FAILED`, or `VALIDATION_TIMEOUT` when the deadline expired or a batch was refused below the `SET LOCAL` floor, with `complete: false` when the snapshot cannot be established; `lint_document` completes its lookup and authorization before the first batch and re-reads the document's collection and deletion state inside the snapshot.
```

### E5 — Requirements Inventory, AD-11 summary

**Old:**

```text
ordered atomic units with prefix and vacuous-check semantics,
```

**New:**

```text
ordered atomic units with prefix semantics (finished units keep their Findings, including units that carry a System Failure) and vacuous-check semantics (a vacuous check counts as completed; graph checks exist only on `lint_wiki`),
```

### E6 — Requirements Inventory, AD-16 summary

**Old:**

```text
one concurrent `lint_wiki` per process,
```

**New:**

```text
one concurrent `lint_wiki` scan per process admitted in a fixed order (scoped lookup and `read` first; sentinel, unconfigured, and empty-policy-set requests without admission; admission before enumeration and the snapshot),
```

### E7 — Epic 1 implementation notes

**Old:**

```text
Before Stories 1.3, 1.5, and 1.7 are implemented, the Architect reviews the three items recorded in Story 3.4 criterion 5; the stories follow the current spine text unless the spine is amended.
```

**New:**

```text
The three architect items recorded by the 2026-10-01 replan were decided in the spine amendment of 2026-10-02 and are carried by Stories 1.3, 1.5, 1.6, and 1.7.
```

### E8 — Story 1.3 AC2

**Old:**

```text
and the transaction commits before rule evaluation.
```

**New:**

```text
and the transaction commits before rule evaluation; the snapshot re-reads the document's collection and deletion state, and if either changed since the pre-snapshot steps of criterion 9, the result is the snapshot `VALIDATION_RUNTIME_FAILED` of criterion 10.
```

### E9 — Story 1.3 AC3

**Old:**

```text
**Then** snapshot construction fails as AD-10 requires: `VALIDATION_TIMEOUT` when the deadline expired during construction, and `VALIDATION_RUNTIME_FAILED` for every other failure to establish the snapshot, including a below-floor remainder before the deadline expires
```

**New:**

```text
**Then** snapshot construction fails as AD-10 requires: `VALIDATION_TIMEOUT` when the deadline expired during construction or a snapshot batch was refused because the remainder was below the code-owned `SET LOCAL` floor (AD-11), and `VALIDATION_RUNTIME_FAILED` for every other failure to establish the snapshot
```

### E10 — Story 1.3 AC5

**Old:**

```text
until every rule enabled by that policy, including link rules, has run successfully.
```

**New:**

```text
until every enabled rule kind whose AD-3 surfaces include the document surface, including link rules, has run successfully; hierarchy and global-index rule kinds never run on this surface and do not make it incomplete, and when the `documents` check is not required the result completes with zero counts and no Findings (AD-11).
```

### E11 — Story 1.3 AC6

**Old:**

```text
and the actor learns nothing beyond the policy class NFR-11 permits.
```

**New:**

```text
and the actor learns nothing beyond the policy class NFR-11 permits; if the collection-readability check itself fails, the collection is treated as unreadable for identity in the same way and evaluation continues under its policy (AD-10).
```

### E12 — Story 1.3 AC9

**Old:**

```text
**Then** an authentication or authorization denial or a missing or inaccessible document returns a Tool-Execution Error (`isError`) with baseline content,
```

**New:**

```text
**Then** an authentication or authorization denial or a missing or inaccessible document returns the same authorization-denial Tool-Execution Error (`isError`), so missing and denied documents are indistinguishable; the document lookup, `read` check, and collection-readability check complete in a short read-only transaction bounded by `SET LOCAL` timeouts from the deadline remainder before the first snapshot batch, and expiry, a below-floor remainder, or another non-application failure of the document lookup or `read` check is a Tool-Execution Error with the fixed message `The operation could not be completed`;
```

### E13 — Story 1.5 AC2

**Old:**

```text
**And** a denied or missing collection returns a Tool-Execution Error with baseline content without exposing its identity through validation output,
```

**New:**

```text
**And** a denied or missing collection returns the same authorization-denial Tool-Execution Error, so the two are indistinguishable; the lookup runs in a short read-only transaction bounded by `SET LOCAL` timeouts from the deadline remainder, and its failure, expiry, or below-floor remainder is a Tool-Execution Error with the fixed message `The operation could not be completed`; neither records a summary or exposes the collection's identity through validation output,
```

### E14 — Story 1.5 AC3

**Old:**

```text
a fixture pins the case of an admin who can read a private collection without membership: the collection is admitted with only the documents the actor can read, so its counts may be zero, and it is clean only when every required check completes under the AD-12 algebra.
```

**New:**

```text
a fixture pins the case of an admin who can read a private collection without membership (`read` without `readDocument`): the collection is included with only the documents the actor can read, so its counts may be zero; no `documentStructure` is read for it; each required hierarchy or global-index check yields the generic `VALIDATION_RUNTIME_FAILED` located `scope { scopeKind: "collection", collectionId }` (Story 1.6 criterion 12); and the result can be clean only when no hierarchy or global-index rule is enabled (AD-9). A second fixture adds a document readable through document membership and proves it is evaluated.
```

### E15 — Story 1.5 AC5

**Old:**

```text
, and when the collection's readability cannot be established the run adds only the generic snapshot `VALIDATION_RUNTIME_FAILED`
```

**New:**

```text
; when the readability of a requested collection cannot be established, the request is the Tool-Execution Error of criterion 2, and in default scope readability is established in the first, floor-guarded snapshot batch, so a failure there is the snapshot failure of criterion 11 and no sentinel whose readability was not established is returned
```

### E16 — Story 1.5 AC6

**Old:**

```text
**And** uncached `Collection.documentStructure` is used as hierarchy authority, and asynchronously refreshed `Document.text` is never snapshot authority.
```

**New:**

```text
**And** uncached `Collection.documentStructure` is used as hierarchy authority only for a collection where `can(actor, "readDocument", collection)` holds, checked with memberships loaded inside the snapshot transaction; for any other evaluated collection the adapter reads no `documentStructure`, not even a size or existence probe, and marks the collection `graphAuthorized: false`, distinct from an empty graph (AD-9); default-scope enumeration and sentinel readability checks are the first floor-guarded batches; only structures the adapter may read count toward the structure-node limit; and asynchronously refreshed `Document.text` is never snapshot authority.
```

### E17 — Story 1.5 AC11

**Old:**

```text
or `VALIDATION_TIMEOUT` when the AD-11 deadline expired during construction (a below-floor remainder before expiry is `VALIDATION_RUNTIME_FAILED`), located
```

**New:**

```text
or `VALIDATION_TIMEOUT` when the AD-11 deadline expired during construction or a construction batch was refused because the remainder was below the AD-11 floor, located
```

### E18 — Story 1.5 AC11

**Old:**

```text
every readable invalid-policy sentinel's `POLICY_CONFIGURATION_INVALID` and invalid `PolicyIdentity` from criterion 5 are still returned
```

**New:**

```text
the `POLICY_CONFIGURATION_INVALID` and invalid `PolicyIdentity` of every sentinel established as actor-readable (criterion 5) are still returned
```

### E19 — Story 1.5 AC12

**Old:**

```text
without scanning the collection
```

**New:**

```text
without scanning the collection; a default request when the startup policy set is empty returns it without admission, while otherwise admission precedes enumeration (Story 1.7 criterion 7), so under contention such a request returns the admission-rejection `failed` result instead
```

### E20 — Story 1.6 AC1

**Old:**

```text
**Then** they operate only on actor-authorized graph nodes, edges, publication state, collection identity, and authoritative collection structure
```

**New:**

```text
**Then** they run only for a collection where `can(actor, "readDocument", collection)` holds (criterion 12), and operate only on actor-authorized graph nodes, edges, publication state, collection identity, and authoritative collection structure
```

### E21 — Story 1.6 AC7

**Old:**

```text
**Then** no `GLOBAL_INDEX_LINK_MISSING` Finding is emitted
   **And** the check reports the generic `VALIDATION_RUNTIME_FAILED` located `scope { scopeKind: "collection", collectionId }`, making the overall result incomplete and non-clean without naming the unresolved fact.
```

**New:**

```text
**Then** no `GLOBAL_INDEX_LINK_MISSING` Finding is emitted for that surface/index pair, while Findings for every pair whose facts are all authorized and resolved are still emitted
   **And** the check reports one generic `VALIDATION_RUNTIME_FAILED` located `scope { scopeKind: "collection", collectionId }` and is not counted as completed, making the overall result incomplete or failed and non-clean without naming the unresolved fact.
```

### E22 — Story 1.6 AC8

**Old:**

```text
**Then** it completes vacuously and is listed in `completedChecks`
```

**New:**

```text
**Then** it completes vacuously, counts as a completed atomic unit, and is listed in `completedChecks`, except a check of a collection marked `graphAuthorized: false` (criterion 12), which never completes vacuously
```

### E23 — Story 1.6 AC10

**Old:**

```text
**And** each collection's hierarchy check precedes its global-index check after all document units, as required by AD-11.
```

**New:**

```text
**And** each collection's hierarchy check precedes its global-index check after all document units, as required by AD-11, and every unit, including a vacuous check and a `graphAuthorized: false` check, keeps its position in that order.
```

### E24 — Story 1.6 AC11

**Old:**

```text
inaccessible proving facts, and vacuous required checks
```

**New:**

```text
inaccessible proving facts, partially provable global-index checks, vacuous required checks, and collections without `readDocument`
```

### E25 — Story 1.6 new AC12

**Old:**

```text
**And** exact stable codes, fixed severities, safe locations, completeness, and deterministic ordering are asserted.

### Story 1.7
```

**New:**

```text
**And** exact stable codes, fixed severities, safe locations, completeness, and deterministic ordering are asserted.

12. **Given** an evaluated collection the actor can `read` but not `readDocument`, so the snapshot marks it `graphAuthorized: false`
    **When** its required hierarchy or global-index check is scheduled
    **Then** the application shell, not a rule, emits one generic `VALIDATION_RUNTIME_FAILED` located `scope { scopeKind: "collection", collectionId }` for each such check without invoking its rules, even when their inputs are readable through document membership, and the check is not completed
    **And** no hierarchy or global-index Finding is emitted for that collection, its documents readable through document membership are still evaluated as document units, and parents and link targets inside it still resolve by document readability (AD-9, AD-11, AD-12).

### Story 1.7
```

### E26 — Story 1.7 AC2

**Old:**

```text
**Then** atomic units are ordered as every document with all enabled document/link rules, followed by
```

**New:**

```text
**Then** atomic units are ordered as every document with all enabled document/link rules (document units exist only when the `documents` check is required), followed by
```

### E27 — Story 1.7 AC2

**Old:**

```text
**And** each unit buffers its findings until it finishes,
```

**New:**

```text
**And** every unit, including a vacuous check and a check of a collection marked `graphAuthorized: false`, occupies its position and is preceded by the deadline check, a `documents` check with zero document units sitting where that collection's first document unit would sort; each unit buffers its findings until it finishes,
```

### E28 — Story 1.7 AC4

**Old:**

```text
**Then** it retains the longest fully completed prefix, adds
```

**New:**

```text
**Then** it retains every unit that finished before the failing deadline check, in unit order, including finished units that carry a System Failure, which keep their Findings but are not counted as completed, adds
```

### E29 — Story 1.7 AC4

**Old:**

```text
carrying the Findings of every finished unit and the counts of completed units only.
```

**New:**

```text
carrying the Findings of every finished unit and the counts of completed units only; a check not reached before the failing deadline check is neither listed nor reported, and a `graphAuthorized: false` check not reached adds no System Failure.
```

### E30 — Story 1.7 AC7

**Old:**

```text
so a denied or missing collection stays a Tool-Execution Error, and a requested collection that is a sentinel or has no policy returns its Story 1.5 result without admission;
```

**New:**

```text
so a denied or missing collection stays the same authorization-denial Tool-Execution Error (Story 1.5 criterion 2), a requested collection that is a sentinel or has no policy returns its Story 1.5 result without admission, and a default request with an empty startup policy set returns `not_evaluated` without admission;
```

### E31 — Story 1.7 AC7

**Old:**

```text
**And** a failure of the pre-admission lookup itself keeps the baseline Tool-Execution Error behavior and records no summary,
```

**New:**

```text
**And** a failure, expiry, or below-floor remainder of the pre-admission lookup is a Tool-Execution Error with the fixed message `The operation could not be completed` and records no summary,
```

### E32 — Story 1.7 AC7

**Old:**

```text
prove the admission slot is released after success,
```

**New:**

```text
prove the admission slot is released, once the audit write settles or its bound expires, after success,
```

### E33 — Story 1.10 AC3

**Old:**

```text
**And** denial or absence of the requested top-level document/collection remains a Tool-Execution Error (`isError`) and invalid tool input
```

**New:**

```text
**And** denial or absence of the requested top-level document/collection remains one indistinguishable authorization-denial Tool-Execution Error (`isError`), a failure of that lookup returns the fixed message, and invalid tool input
```

### E34 — Story 1.10 AC6

**Old:**

```text
**Given** actors with different document, collection, link-target, and audit visibility

```

**New:**

```text
**Given** actors with different document, collection, link-target, and audit visibility, including a same-team admin with collection `read` but without `readDocument`

```

### E35 — Story 3.2 AC1

**Old:**

```text
the AD-16 limits and admission;
```

**New:**

```text
the AD-16 limits, admission, and admission order (a denied or missing scoped collection while the slot is held, identical errors for a missing and a denied target, a stalled pre-scope lookup on both read surfaces, sentinel, unconfigured, and empty-policy-set requests without admission, and slot release on every terminal path); a snapshot batch refused below the floor returning `VALIDATION_TIMEOUT` on both `lint_wiki` and `lint_document`; collection-graph checks for an actor with collection `read` but without `readDocument`, with and without a document readable through document membership and with memberships not preloaded, proving that no structure is read and no graph rule runs; timeout prefix semantics with an unprovable check, a vacuous check, and a `graphAuthorized: false` check around the failing deadline check; a `lint_document` whose collection-readability check fails, for a sentinel and for a valid collection; a default-scope enumeration batch that fails other than by the floor;
```

### E36 — Story 3.4 AC5

**Old:**

```text
and three architect review items owned by the Architect and revisited before Stories 1.3, 1.5, and 1.7 are implemented (the below-floor snapshot code on the read surface versus write phase P5, the admission of a collection that an admin can read without membership, and the `lint_wiki` admission order), none of which is decided or implemented here.
```

**New:**

```text
and the FR-12 clarification recommended by the spine amendment of 2026-10-02 (owner Wiki operator, non-blocking), the residual that an actor with `read` but without `readDocument` may receive a clean result over the documents it can read when only document rules are enabled, and the residual that a default-scope request whose readable scope holds no configured collection returns the admission-rejection `failed` result under contention; the three architect items of `sprint-change-proposal-2026-10-01.md` §4.6 were decided in that amendment and are evidenced in Stories 1.3, 1.5, 1.6, and 1.7.
```

### E37 — Story 1.5 AC6

**Old:**

```text
**Then** scope, authoritative document content/state, canonical Markdown serialization, authoritative hierarchy, extracted links, and authorized target resolutions are read from the primary database within one `REPEATABLE READ` transaction made read-only by an explicit `SET TRANSACTION READ ONLY`, not by Sequelize's `readOnly` option
```

**New:**

```text
**Then** the snapshot loads only the inputs of required checks (AD-9, AD-11): the evaluated scope always; authoritative document content and state, canonical Markdown serialization, extracted links, and authorized target resolutions only when the `documents` check is required, plus those of the configured surface documents when the `global_index` check is required; and authoritative hierarchy and structure only when the `hierarchy` or `global_index` check is required. Every input that is loaded is read from the primary database within one `REPEATABLE READ` transaction made read-only by an explicit `SET TRANSACTION READ ONLY`, not by Sequelize's `readOnly` option
```

### E38 — Story 2.3 AC4

**Old:**

```text
and every Finding already produced is retained, including under an `open` runtime failure.
```

**New:**

```text
and every Finding already produced is retained, including under an `open` runtime failure; only enabled rule kinds whose AD-3 surfaces include the document surface run, hierarchy and global-index rule kinds never run on the write surface and never make it incomplete, the AD-9 `readDocument` condition does not apply, and when the `documents` check is not required validation completes with zero counts and no Findings, so the decision is `validated` (AD-11, AD-13).
```

### E39 — Story 2.3 AC5

**Old:**

```text
validates the full resulting title/body/state/relationships under the post-operation policy
```

**New:**

```text
validates the full resulting title/body/state/relationships with every enabled `document`-surface rule under the post-operation policy
```

### E40 — Story 1.5 AC2

**Old:**

```text
and fixtures cover uppercase-UUID and URL-identifier inputs.
```

**New:**

```text
and fixtures cover uppercase-UUID and URL-identifier inputs.
   **And** the pre-admission `read` result fixes identity visibility for the whole invocation; a requested collection that is no longer readable at snapshot time contributes only the documents its membership-aware queries return at snapshot time, its required graph checks yield the generic `VALIDATION_RUNTIME_FAILED` exactly as under `graphAuthorized: false` (Story 1.6 criterion 12), and nothing else of it is disclosed (AD-16).
```

### E41 — Story 1.5 AC2

**Old:**

```text
and its failure, expiry, or below-floor remainder is a Tool-Execution Error with
```

**New:**

```text
and expiry, a below-floor remainder, or another non-application failure of it is a Tool-Execution Error with
```

### E42 — Story 1.3 AC9

**Old:**

```text
**Then** an authentication or authorization denial or a missing or inaccessible document returns the same authorization-denial Tool-Execution Error (`isError`), so missing and denied documents are indistinguishable;
```

**New:**

```text
**Then** an authorization denial or a missing or inaccessible document returns the same authorization-denial Tool-Execution Error (`isError`), so missing and denied documents are indistinguishable, while an authentication failure keeps baseline behavior;
```

### E43 — Story 1.3 AC6

**Old:**

```text
if the collection-readability check itself fails, the collection is treated as unreadable for identity in the same way and evaluation continues under its policy (AD-10).
```

**New:**

```text
if the collection-readability check itself fails, including by expiry or a below-floor remainder, the collection is treated as unreadable for identity in the same way and evaluation continues under its policy (AD-10, AD-11).
```

### E44 — Story 1.7 AC3

**Old:**

```text
while a synchronous parse is never preempted

```

**New:**

```text
while a synchronous parse is never preempted; stopping at the margin is the `VALIDATION_TIMEOUT` of criterion 4 (AD-3)

```

### E45 — Story 1.7 AC7

**Old:**

```text
stays the same authorization-denial Tool-Execution Error (Story 1.5 criterion 2),
```

**New:**

```text
stays the same authorization-denial Tool-Execution Error,
```

### E46 — Story 1.7 AC7

**Old:**

```text
**And** a failure, expiry, or below-floor remainder of the pre-admission lookup is
```

**New:**

```text
**And** expiry, a below-floor remainder, or another non-application failure of the pre-admission lookup is
```

### E47 — Story 1.10 AC3

**Old:**

```text
a failure of that lookup returns the fixed message,
```

**New:**

```text
expiry, a below-floor remainder, or another non-application failure of that lookup returns the fixed message,
```

### E48 — Story 1.8 AC10

**Old:**

```text
**When** the suite evaluates every read-only outcome class, each Tool-Execution Error case, and each access role

```

**New:**

```text
**When** the suite evaluates every read-only outcome class, each Tool-Execution Error case, and each access role, including an admission rejection for a scoped request (collection column and valid-policy fields present) and a default request (neither present), a `not_evaluated` result returned without admission, a pre-scope lookup failure, expiry, or below-floor remainder (no summary), and a `lint_document` whose collection-readability check fails (one summary whose data and columns do not depend on actor readability)

```

### E49 — Requirements Inventory, AD-3 summary

**Old:**

```text
with recognized forms fixed by fixtures (D-9).
```

**New:**

```text
with recognized forms fixed by fixtures (D-9); `VALIDATION_TIMEOUT` is limited to snapshot construction, unit evaluation, write P5 after it began, and the `lint_wiki` stop margin.
```

### E50 — Requirements Inventory, AD-10 summary

**Old:**

```text
`lint_document` completes its lookup and authorization before the first batch
```

**New:**

```text
`lint_document` completes its lookup, authorization, and collection-readability check, whose failure only withholds identity, before the first batch
```

### E51 — Requirements Inventory, AD-11 summary

**Old:**

```text
(a vacuous check counts as completed; graph checks exist only on `lint_wiki`),
```

**New:**

```text
(a vacuous check counts as completed, except a graph check of a collection marked `graphAuthorized: false`; graph checks exist only on `lint_wiki`),
```

### E52 — Requirements Inventory, AD-11 summary

**Old:**

```text
every surface's bound sum is at most 63 seconds.
```

**New:**

```text
every surface's bound sum is at most 63 seconds; pre-scope steps run in a short `SET LOCAL`-bounded read-only transaction, return one indistinguishable missing-or-denied error, and use the fixed message for non-application failures.
```

### E53 — Requirements Inventory, AD-12 summary

**Old:**

```text
unmodellable failures, including the AD-20 tool-execution errors.
```

**New:**

```text
unmodellable failures, including the AD-20 tool-execution errors; a collection whose readability cannot be established follows AD-10 and AD-11.
```

### E54 — Requirements Inventory, AD-18 summary

**Old:**

```text
plus exact baseline/backport proof.
```

**New:**

```text
plus exact baseline/backport proof, including the AD-16 admission order, the below-floor snapshot timeout on both read surfaces, graph checks without `readDocument`, pre-scope lookups, and timeout-prefix fixtures.
```

### E55 — Story 3.2 AC1

**Old:**

```text
timeout prefix semantics with an unprovable check, a vacuous check, and a `graphAuthorized: false` check around the failing deadline check;
```

**New:**

```text
`completedChecks` and prefix semantics under a timeout with an unprovable check earlier in unit order than a completed one, which is retained and counted; a vacuous check and a `graphAuthorized: false` check after the failing deadline check, neither listed nor reported; a scoped `lint_wiki` whose collection lookup fails; `lint_document` authorization completing before any snapshot batch; a same-team admin on a private collection without membership; a scoped collection whose `read` is revoked between the pre-admission check and the snapshot; a policy with only document rules reading no `documentStructure`, and a policy with only hierarchy or global-index rules serializing no Markdown for documents other than configured surfaces, counting no document units, and not failed by a limit on an input it did not load;
```

### E56 — Story 3.3 AC7

**Old:**

```text
issued under `SET LOCAL` in snapshot construction or an enforcement transaction,
```

**New:**

```text
issued under `SET LOCAL` in a pre-scope lookup, snapshot construction, or an enforcement transaction,
```

### E57 — Story 3.3 AC7

**Old:**

```text
and stop-margin and prefix semantics under a timeout)
```

**New:**

```text
stop-margin and prefix semantics under a timeout, a snapshot batch refused below the floor on both read surfaces, and a below-floor pre-scope lookup)
```

### E58 — Story 1.5 AC5

**Old:**

```text
**When** scope admission runs
```

**New:**

```text
**When** scope selection runs
```
