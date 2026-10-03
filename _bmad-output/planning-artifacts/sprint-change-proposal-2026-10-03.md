---
title: "Sprint Change Proposal: Readability-Gated Finding Detail as the First Story of Epic 2"
status: approved-with-changes
created: 2026-10-03
approved: 2026-10-03
workflow: bmad-correct-course
mode: batch
target:
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/implementation-artifacts/sprint-status.yaml
binding_sources:
  - _bmad-output/planning-artifacts/prds/prd-outline-2026-09-20/prd.md
  - _bmad-output/planning-artifacts/prds/prd-outline-2026-09-20/addendum.md
  - _bmad-output/planning-artifacts/architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md
  - _bmad-output/specs/spec-outline-mcp-wiki-linting/SPEC.md
trigger:
  - _bmad-output/planning-artifacts/prds/prd-outline-2026-09-20/amendment-proposal-finding-detail.md (status applied, commit 2e50ee933)
  - _bmad-output/planning-artifacts/architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md (AD-12, Amendment Record 2026-10-03)
  - _bmad-output/implementation-artifacts/epic-1-retro-2026-10-03.md (F-1, F-5; action items 1, 3, 5)
  - _bmad-output/implementation-artifacts/deferred-work.md (DW-2, DW-3, DW-8; DW-7 for context)
---

# Sprint Change Proposal: Readability-Gated Finding Detail as the First Story of Epic 2

## Status and Authority

This proposal was produced in batch mode on 2026-10-03 for a coordinator acting for the operator. The operator then reviewed the verified result and approved it with the changes recorded in the Decision Record below. The analysis sections that follow are kept as written; where they disagree with the Decision Record, the Decision Record governs.

Two kinds of edit are kept apart:

1. **Applied in the working tree, uncommitted:** one new story, Story 2.0, inserted at the start of Epic 2 in `epics.md`, and its one key in `sprint-status.yaml` (§4.1). They are applied so that `bmad-loop` can plan the story. They are planning state only and authorize no implementation.
2. **Proposed, not applied:** the cross-document harmonization and the spine clarification for F-5 (§4.2 to §4.4). Each needs a separate operator authorization that names it.

The authority order is unchanged: PRD, then addendum, then `ARCHITECTURE-SPINE.md`, then `SPEC.md`, then repository contracts. This run did not modify the PRD, the addendum, the spine, `SPEC.md`, `server/tools/README.md`, any code, `_bmad/`, `.claude/`, or `.bmad-loop/`. Their SHA-256 hashes before and after are identical (see Verification). Implementation, image publication, deployment, and rollout remain separate approval boundaries.

## Decision Record (2026-10-03)

The operator approved the coordinator's recommendations after reviewing the verified result.

| Item | Decision |
| --- | --- |
| F-5 and Story 2.0 criterion 7 | **Withdrawn.** AD-16 already states that a collection no longer readable at snapshot time contributes only the documents its membership-aware queries return, so the current behavior follows the contract. Not adopted: S-1, S-2, E-1, E-2. Retrospective action item 3 is withdrawn; the retrospective carries the correction. |
| Story 2.0 criteria | Nine remain. Old criteria 8, 9 and 10 are now 7, 8 and 9. The Gates line no longer mentions a spine precondition. |
| Length limits (criterion 6) | Accepted: heading text at most 200 and field names at most 64 UTF-16 code units. |
| Convention-free loop limit | Accepted: format defects, and a missing field whose metadata section is absent and not required, remain repairable only with conventions. |
| Numbering and splitting | Story 2.0 and key `2-0-...` accepted. No pre-split. With criterion 7 gone the story is smaller. |
| H-1 to H-4, P-1 to P-7, C-1 | **Applied** to `prd.md` and `epics.md`. |
| C-2 | **Applied** to `SPEC.md` (line 55) on the operator's explicit approval. |
| O-1 | Not applied (optional, not requested). |

The `sprint-status.yaml` key is unchanged. Retro action item 3 stays `open` there because the tooling has no withdrawn status; it must not be implemented.

## 1. Issue Summary

**Trigger.** The AD-12 amendment of 2026-10-03 (`amendment-proposal-finding-detail.md`, applied in commit `2e50ee933`) gives `Finding` an optional `detail` on exactly three codes, present exactly when the actor can read the collection of the producing policy:

| Code | `detail` |
| --- | --- |
| `REQUIRED_SECTION_MISSING` | `{ kind: "section", heading, headingLevel }` |
| `REQUIRED_METADATA_FIELD_MISSING` | `{ kind: "metadata_field", field }` |
| `GLOBAL_INDEX_LINK_MISSING` | `{ kind: "global_index", documentId, urlId }` |

The amendment changed contract text only. No story implements it.

**Category.** New requirement from an operator decision (retrospective option A), plus one defect found by the retrospective (F-5).

**Problem statement.** Epic 1 was accepted with open items. Its retrospective records that the Story 1.10 repair loop reaches a Clean Result only because the test agent is given the collection's conventions out of band (F-1; DW-2, DW-3, DW-8), and that a collection-scoped `lint_wiki` can return a complete Clean Result for a collection revoked or deleted between the pre-admission lookup and the snapshot when its policy has only document rules (F-5). Action item 1 requires the Finding decision before Story 2.1 starts, because Epic 2 write rejections carry the same Finding shape. Action item 3 assigns F-5 to the dev loop. Action item 5 asks that a "decide before Story X" precondition be encoded where the loop cannot pass it.

**Evidence.**

| Evidence | Source |
| --- | --- |
| Findings of the three codes are byte-identical when several items are missing | DW-2, DW-3; `server/wikiLint/core/documentRules.ts` (`requiredSections`, `requiredMetadataFields` emit `{ kind: "document", documentId }` only); `server/wikiLint/core/graphRules.ts` (`globalIndexLinks`) |
| The golden loop's repair function receives `fields`, `globalIndexId`, and `collectionId` as conventions | `server/routes/mcp/wikiLint.test.ts`, "repair loop" (`Conventions`, `repair`) |
| The collection-scope snapshot skips the in-snapshot `read` check | `server/wikiLint/adapters/wikiReader.ts`, the `scope.kind === "configured_collections"` guard in `readWikiSnapshot`; `authorizeLintCollection` runs in an earlier transaction |
| Configured heading text and field names have no upper length bound | `server/wikiLint/core/registry.ts`, `trimmedString` (`min(1)`, trimmed), used by `headings`, `metadataSection.heading`, and `fieldName`; only the 64 KiB whole-file cap (AD-5) bounds them |
| Several criteria still say NFR-11 permits only the "policy class" | `prd.md` SM-I4, SM-P5; `epics.md` lines listed in §4.3 |

## Checklist Record

| Item | Status | Note |
| --- | --- | --- |
| 1.1 Triggering story | [x] | Story 1.10 (AC7 met literally, qualified); retrospective F-1 and F-5. |
| 1.2 Core problem | [x] | Operator-decided requirement change plus one defect; see Issue Summary. |
| 1.3 Evidence | [x] | Table above. |
| 2.1 Current epic | [x] | Epic 1 stays accepted; no Epic 1 story is reopened. |
| 2.2 Epic-level changes | [x] | Epic 2 gains Story 2.0 at its start. Epic goals unchanged. |
| 2.3 Remaining epics | [!] | Story 2.1 depends on Story 2.0. Stories 2.1 and 2.3 pass the `readable` flag into the shared engine (no criterion change needed beyond §4.4 C-1). Stories 3.2 and 3.4 wording in §4.3. |
| 2.4 Obsolete or new epics | [x] | None obsolete; no new epic. |
| 2.5 Order and priority | [x] | Story 2.0 runs first in Epic 2. |
| 3.1 PRD conflicts | [!] | NFR-11 reads awkwardly ("One exception ... A second"); SM-I4 and SM-P5 name only the policy class. Proposed in §4.2 and §4.3. |
| 3.2 Architecture conflicts | [!] | F-5's fix contradicts AD-11 and AD-16 as written (§2, Architecture). Spine clarification proposed in §4.4. |
| 3.3 UI/UX | [N/A] | No UI in this increment. |
| 3.4 Other artifacts | [!] | `SPEC.md` line 55 also names only the policy class (§4.4 C-2). `server/tools/README.md` unchanged (DW-7 stays with action item 2). |
| 4 Path forward | [x] | Direct Adjustment. |
| 5.1–5.5 Proposal components | [x] | This document. |
| 6.3 Operator approval | [!] | Not obtained. The operator was not reachable. |
| 6.4 sprint-status | [x] | One `backlog` key added (§4.1 A-2). |

## 2. Impact Analysis

### PRD

No requirement changes. NFR-11 already names the second exception (commit `2e50ee933`). Two wording issues remain and are proposed, not applied:

- NFR-11 says "One exception is accepted" and then "A second, narrower exception is accepted" (§4.2).
- SM-I4 and SM-P5 measure disclosure "other than" or "beyond" the policy class only, which under the conservative reading of NFR-11 would count a `detail` shown to a collection reader as a regression (§4.3).

MVP scope is unchanged.

### Epics

- **Epic 2:** Story 2.0 is added before Story 2.1 (applied, §4.1). Story 2.1 depends on it, as its Traceability "Gates" line states.
- **Epic 1:** no story reopened. Story 1.5 criterion 2 and Story 1.10 criterion 6 need wording changes once the proposals in §4.3 and §4.4 are approved; both stories stay `done`.
- **Epic 3:** Story 3.2 criterion 1 and Story 3.4 criterion 5 need wording changes (§4.3).

### Architecture

AD-12 already carries the `detail` rule. One conflict is new:

**F-5 contradicts AD-11 and AD-16 as written.** AD-16 says that "a collection no longer readable at snapshot time contributes only the documents its membership-aware queries return at snapshot time, its graph checks are unprovable exactly as under `graphAuthorized: false` (AD-9), and nothing else of it is disclosed", and AD-11 lets a required check with zero inputs complete vacuously, excepting only graph checks of a `graphAuthorized: false` collection. Under that text, a documents-only policy over a revoked collection with no membership-readable documents completes vacuously and is clean, which is exactly what the code does and what `wikiReader.test.ts` ("keeps a requested collection that is no longer readable") pins for the graph case. The retrospective's fix therefore needs a spine clarification first. §4.4 S-1 and S-2 propose one, and Story 2.0's Gates line says criterion 7 is implemented only after it is applied.

Two shapes were considered:

| Option | Behavior | Churn |
| --- | --- | --- |
| **(i) Recommended.** Treat the `documents` check like the graph checks | Membership-readable documents are still evaluated (AD-16 unchanged in that respect), the `documents` check gets one generic `VALIDATION_RUNTIME_FAILED` at `scope { scopeKind: "collection", collectionId }` and is never completed. A documents-only policy with no readable documents yields `state: failed` with exactly one System Failure | Two clauses (AD-11, AD-16); existing graph tests unchanged |
| (ii) Snapshot failure, as `lint_document` does under AD-10 | The whole run is the snapshot `VALIDATION_RUNTIME_FAILED`, with no Findings | Replaces the AD-16 sentence; Story 1.5 criterion 2 and the existing graph tests change |

Story 2.0 criterion 7 is written for option (i).

### Tests

- New fixtures: Finding constructors (closed `detail` shapes), core with `detailVisible` true and false, shell derivation on both read surfaces, a readable plus an unreadable global index, audit payload equality, schema length limits, the revoked and deleted collection with a documents-only policy, the convention-free golden loop, and the inverse document-only reader.
- The existing suites (HTTP acceptance, determinism, disclosure, audit, and the conventions-supplied repair loop) must keep passing. The only expected change in their outputs is the added `detail` for collection readers.
- **Limit of the convention-free loop.** Allowed metadata values are outside the amendment (its question 3). A missing field with a format rule, or the Story 1.10 fixture's `METADATA_FIELD_FORMAT_INVALID` defect, cannot be repaired from Findings alone. Story 2.0 criterion 8 therefore extends the golden fixture with missing fields that carry no format rule and leaves the format defect to the unchanged conventions-supplied loop. The `metadata_field` detail also does not name the metadata section, so the agent can add a missing field only when that section exists in the document (or is itself named by a `section` detail).

### Sprint tracking

`sprint-status.yaml` gains `2-0-name-the-missing-configured-item-to-collection-readers: backlog` as the first story under `epic-2` (applied). No status, comment, action item, or quoting changed. Action items 1 and 3 stay `open` until the story is done; this proposal sets no action-item status.

## 3. Recommended Approach

**Direct Adjustment.** Add one story at the start of Epic 2, keep every existing story number and criterion number, and harmonize the "policy class" wording separately.

- **Why Epic 2 and not a reopened Epic 1:** Epic 1 is accepted and its retrospective is done. The amendment recommends Epic 2's first story because write rejections need `detail`. The story changes read surfaces only. Write surfaces pick it up through the same core input in Stories 2.1 and 2.3.
- **Why bundle F-5:** the retrospective assigns it to the dev loop, it touches the same snapshot path the story already changes for `detailVisible`, and its regression test belongs to the same acceptance run.
- **Effort:** medium. Core and shell changes are small. Most of the cost is fixtures and the extended HTTP loop. Epic 1 stories all exceeded the per-story token cap (retrospective F-8), so this one may be flagged oversized. If it is, split it as `2-0a` (criteria 1 to 6 and 8 to 10) and `2-0b` (criterion 7); `bmad-loop` accepts that suffix form.
- **Risk:** low for disclosure, because `detail` reuses the existing `can(actor, "read", collection)` gate and the readable index set. Medium for F-5 until the spine clarification is decided.
- **Timeline:** one story ahead of Story 2.1.

### Numbering

The story is **Story 2.0**, key `2-0-name-the-missing-configured-item-to-collection-readers`.

- It does not renumber Stories 2.1 to 2.7, so the cross-story hand-offs in the `sprint-status.yaml` header (`2.1 AC10 -> 2.7`, `2.1 AC11 -> 2.3/2.5`, `2.3 AC2 -> 2.6`, `2.3 AC11 -> 2.7`, `2.4 AC3 -> 2.5`) and every "Story 2.x criterion n" reference stay valid.
- `0` sorts before `1` numerically. `bmad-loop` plans stories in file order, and the key is placed first under `epic-2`.
- `2-1a` was rejected: the plain ref `2-1` would match the whole `2-1` family, and the story would read as a split of Story 2.1, which it is not.
- The key is the one `bmad-sprint-planning` derives from the heading `### Story 2.0: Name the Missing Configured Item to Collection Readers`. A dry-run of `sprint_plan.py generate` on a scratch copy reports `in_sync: true` and no new entries.
- `bmad-loop run --dry-run --story 2-0` and `--story 2.0` both select it (Verification).

## 4. Detailed Changes

### 4.1 Applied edits

**A-1. `epics.md`, Story 2.0 inserted after the Epic 2 introduction and before `### Story 2.1`.** It adds 66 lines; no existing line changed. The full text is in `epics.md`. Summary of its ten criteria:

| # | Covers |
| --- | --- |
| 1 | Closed `Finding.detail` shapes on the three codes only; never on other codes or System Failures |
| 2 | Pure core receives one boolean `detailVisible`; item names come from the rule's own configuration and the snapshot's readable `indexes` |
| 3 | Shell derivation: `lint_document` from the existing readability result (`readable` yes; `unreadable`, `unestablished` no); `lint_wiki` from the in-snapshot `read`; write surfaces later through `readable` |
| 4 | A `global_index` detail names only an index the actor can read; an unprovable pair stays the generic `VALIDATION_RUNTIME_FAILED` |
| 5 | `detail` is not an AD-4 sort key; registry messages stay fixed; `AuditDataV1`, logs, metrics, descriptions, and System Failures never carry it |
| 6 | Upper length limits in the policy schema; an over-long entry becomes a collection-local sentinel |
| 7 | F-5: in-snapshot `read` re-check for a collection scope; documents-only regression fixtures (requires §4.4 S-1, S-2) |
| 8 | Story 1.10 golden loop re-run without conventions, extended to two missing items per kind, reaching a Clean Result |
| 9 | Inverse fixture: a document-only reader and an unestablished readability receive the same Findings without `detail` |
| 10 | Determinism and ordering unchanged; no enforcement integrated |

The Traceability "Gates" line records two preconditions, following retrospective action item 5: Story 2.1 starts only after Story 2.0 is done, and criterion 7 waits for the spine clarification.

**A-2. `sprint-status.yaml`.** One line inserted after `  epic-2: backlog`:

```text
  2-0-name-the-missing-configured-item-to-collection-readers: backlog
```

### 4.2 Proposed, not applied: NFR-11 coherence (a)

Both anchors occur exactly once in their file. The meaning for a reader of either document is unchanged: the first exception still covers only the policy class for a document-only actor, and the second still covers only the missing-item name for a collection reader.

**H-1. `prd.md`, NFR-11 (line 483).**

Old:

```text
One exception is accepted. An actor who may read or write a document but cannot read its collection may learn
```

New:

```text
Two exceptions are accepted. First, an actor who may read or write a document but cannot read its collection may learn
```

**H-2. `prd.md`, NFR-11 (line 483).**

Old:

```text
A second, narrower exception is accepted. A Finding for
```

New:

```text
Second, a Finding for
```

**H-3. `epics.md`, NFR-11 copy (line 74).**

Old:

```text
; the one accepted exception lets an actor who may read or write a document but cannot read its collection learn
```

New:

```text
. Two exceptions are accepted. First, an actor who may read or write a document but cannot read its collection may learn
```

**H-4. `epics.md`, NFR-11 copy (line 74).** Same old and new text as H-2.

Result in `epics.md`: "... governed by FR-21. Two exceptions are accepted. First, an actor who may read or write a document but cannot read its collection may learn that collection's policy class, never its identity, fingerprint, or policy content. Second, a Finding for a missing required section, ... may name the missing item to an actor who can read the collection, and only to that actor. ..."

### 4.3 Proposed, not applied: "policy class" references (b)

**Test applied to each occurrence:** the second exception reaches only an actor who can read the collection. A criterion whose subject is an actor without collection read stays correct. A criterion that measures disclosure across all actors, or that lists the accepted NFR-11 exceptions, needs the second exception named. One uniform phrase is used: "the policy class and the readability-gated missing-item names that NFR-11 permits".

| Location (line before A-1 / now) | Subject | Verdict |
| --- | --- | --- |
| `prd.md` 517, SM-I4 | Every unauthorized actor | Change (P-1) |
| `prd.md` 532, SM-P5 | Actors of different visibility | Change (P-2) |
| `epics.md` 136, SM-I summary | Copy of SM-I4 | Change (P-3) |
| `epics.md` 137, SM-P summary | Copy of SM-P5 | Change (P-4) |
| `epics.md` 383, Story 1.3 AC6 | Actor who can read the document but not its collection | **Correct as is.** That actor never receives `detail` |
| `epics.md` 877, Story 1.10 AC6 | Actors with different visibility, including a collection reader | Change (P-5). Story 1.10 stays `done`; Story 2.0 criteria 9 and 10 provide the new evidence |
| `epics.md` 1003 / 1069, Story 2.1 AC14 | Actors without collection read | **Correct as is.** Its omitted-field list needs `detail` (§4.4 C-1) |
| `epics.md` 1196 / 1262, Story 2.4 AC4 | Actor without collection read | **Correct as is** |
| `epics.md` 1479 / 1545, Story 3.2 AC1, first occurrence ("identity omission for actors without collection read") | Actors without collection read | **Correct as is** |
| `epics.md` 1479 / 1545, Story 3.2 AC1, second occurrence ("multi-actor disclosure") | All actors | Change (P-6) |
| `epics.md` 1612 / 1678, Story 3.4 AC5 | List of accepted exceptions and residuals | Change (P-7) |

Each anchor below occurs exactly once in its file (checked after A-1).

**P-1. `prd.md`, SM-I4.** Old: `other than the policy class that NFR-11 permits.` New: `other than the policy class and the readability-gated missing-item names that NFR-11 permits.`

**P-2. `prd.md`, SM-P5.** Old: `beyond the policy class that NFR-11 permits.` New: `beyond the policy class and the readability-gated missing-item names that NFR-11 permits.`

**P-3. `epics.md`, SM-I summary.** Old: `zero disclosure regressions beyond the policy class NFR-11 permits,` New: `zero disclosure regressions beyond the policy class and the readability-gated missing-item names NFR-11 permits,`

**P-4. `epics.md`, SM-P summary.** Old: `disclosure regression beyond the NFR-11 policy class,` New: `disclosure regression beyond the NFR-11 policy class and readability-gated missing-item names,`

**P-5. `epics.md`, Story 1.10 AC6.** Old: `or audit summaries beyond the policy class that NFR-11 permits` New: `or audit summaries beyond the policy class and the readability-gated missing-item names that NFR-11 permits`

**P-6. `epics.md`, Story 3.2 AC1.** Old:

```text
multi-actor disclosure, asserting zero disclosure beyond the NFR-11 policy class;
```

New:

```text
multi-actor disclosure, asserting zero disclosure beyond the NFR-11 policy class and readability-gated missing-item names, with Finding `detail` present for a collection reader and absent for a document-only reader and for an unestablished collection readability;
```

**P-7. `epics.md`, Story 3.4 AC5.** Old: `the NFR-11 policy-class and FR-22 exceptions,` New: `the two NFR-11 exceptions (policy class; readability-gated missing-item names) and the FR-22 exception, the residual that a document-only reader cannot tell repeated missing-item Findings apart,`

### 4.4 Proposed, not applied: consequential edits found during the analysis

**C-1. `epics.md`, Story 2.1 AC14 (line 1068 now).** The list of fields withheld from an actor without collection read should include the new field. Old: ``but no `policySchemaVersion`, `policyFingerprint`, `invalidFingerprint`, or `collectionId` `` New: ``but no `policySchemaVersion`, `policyFingerprint`, `invalidFingerprint`, `collectionId`, or Finding `detail` ``

**C-2. `SPEC.md`, line 55.** It has the same one-exception wording as SM-I4 and needs a separate SPEC authorization. Old: `beyond the policy class that PRD NFR-11 permits` New: `beyond the policy class and the readability-gated missing-item names that PRD NFR-11 permits`

**S-1. `ARCHITECTURE-SPINE.md`, AD-16 (line 292), for F-5, option (i).** Old:

```text
its graph checks are unprovable exactly as under `graphAuthorized: false` (AD-9), and nothing else of it is disclosed.
```

New:

```text
its graph checks are unprovable exactly as under `graphAuthorized: false` (AD-9), its `documents` check is unprovable in the same way (the shell adds one generic `VALIDATION_RUNTIME_FAILED` located `scope { scopeKind: "collection", collectionId }` and never completes the check, not even vacuously), and nothing else of it is disclosed.
```

**S-2. `ARCHITECTURE-SPINE.md`, AD-11 (line 169).** Old: ``except a graph check of a collection marked `graphAuthorized: false` (AD-9).`` New: ``except a graph check of a collection marked `graphAuthorized: false` (AD-9) and the `documents` check of a requested collection no longer readable at snapshot time (AD-16).``

**E-1. `epics.md`, Story 1.5 AC2 (line 522), following S-1.** Old:

```text
its required graph checks yield the generic `VALIDATION_RUNTIME_FAILED` exactly as under `graphAuthorized: false` (Story 1.6 criterion 12), and nothing else of it is disclosed (AD-16).
```

New:

```text
its required graph checks yield the generic `VALIDATION_RUNTIME_FAILED` exactly as under `graphAuthorized: false` (Story 1.6 criterion 12), its required `documents` check yields one such failure located `scope { scopeKind: "collection", collectionId }` and is never completed (Story 2.0 criterion 7), and nothing else of it is disclosed (AD-16).
```

**E-2. `epics.md`, AD-11 summary (line 121), following S-2.** Old: ``except a graph check of a collection marked `graphAuthorized: false`;`` New: ``except a graph check of a collection marked `graphAuthorized: false` or the `documents` check of a requested collection no longer readable at snapshot time;``

**O-1 (optional). `epics.md` Overview.** Add after the 2026-10-02 amendment paragraph: "**Amendment (2026-10-03).** Story 2.0 implements the readability-gated Finding `detail` of the AD-12 amendment of 2026-10-03 and retrospective finding F-5, and precedes Story 2.1. The change record is `sprint-change-proposal-2026-10-03.md`." The frontmatter keys `amended` and `amendmentRecord` hold one value each, so they are left as they are.

## 5. Implementation Handoff

**Scope classification: Moderate.** One story is added to the backlog, and a spine clarification is needed before one of its criteria can be implemented.

| Role | Responsibility |
| --- | --- |
| Operator | Approve or revise this proposal. Decide the open items below. Separately authorize, by name, H-1 to H-4, P-1 to P-7, C-1, C-2, S-1, S-2, E-1, E-2, and O-1, or any subset. Authorize implementation separately. |
| Architect (spine) | Apply S-1 and S-2 once authorized, with an Amendment Record row, before Story 2.0 criterion 7 is implemented. |
| Developer (`bmad-loop` / `bmad-build-auto`) | Implement Story 2.0 under separate authorization. Do not start Story 2.1 before Story 2.0 is `done`. `bmad-loop run --epic 2` plans 2.0 first, but `--story 2-1` would bypass that order; nothing in `sprint-status.yaml` enforces the dependency. |
| Operator (ledger) | When Story 2.0 criteria 7 and 8 pass (the convention-free loop and the inverse fixture), close DW-2, DW-3, and DW-8 and mark action item 1 `done` through the supported tooling. DW-7 and action item 2 stay separate. |

**Success criteria:** Story 2.0's ten criteria pass, including the convention-free loop reaching a Clean Result and the inverse fixture. No criterion number elsewhere changes. The existing Epic 1 suites pass with only the added `detail`. No enforcement, publication, deployment, or rollout is implied.

### Operator decisions requested

1. **Length limits (Story 2.0 criterion 6).** Proposed: configured heading text at most **200** UTF-16 code units (Zod `max`), metadata field names at most **64**. Rationale: both sit far above any practical section heading or field label, and they bound each `detail` to well under 1 KiB, where the 64 KiB file cap bounds only the total. An entry over a limit becomes a fail-closed sentinel under AD-5, so the values are a compatibility choice for future configurations.
2. **F-5 shape.** Option (i) (recommended, criterion 7 as written) or option (ii) (snapshot failure). Either needs a spine clarification; S-1 and S-2 implement option (i).
3. **Numbering.** Story 2.0 and key `2-0-…`, as justified in §3.
4. **Convention-free loop limit.** Accept that missing fields with a format rule, and format defects, remain repairable only with conventions until allowed values are decided (amendment question 3). The same goes for a missing field whose metadata section is absent and is not a required section.
5. **Splitting.** Whether to pre-split Story 2.0 into `2-0a` and `2-0b` (retrospective action item 6).

## Gate 1

`not ready`. Unchanged by this proposal.

## Verification

Run on 2026-10-03 at HEAD `2e50ee933`, 21 commits ahead of `origin/feature/mcp-wiki-linting-v1.10.1` and 0 behind after `git fetch --prune`.

SHA-256 of read-only sources, identical before and after this run:

| File | SHA-256 |
| --- | --- |
| `prds/prd-outline-2026-09-20/prd.md` | `d7f9d5459526576d1dcea9eed572133b37f74c08d4fac92e3282a218fc741ffe` |
| `prds/prd-outline-2026-09-20/addendum.md` | `5b8fd7e0f205aced13aa1aeeeea00cbaa796d963f9ebef8e9b5b6452ffaffa5c` |
| `architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md` | `31fc78ea208731cda11a0dc09d52f598c3025122fd99a9c788de2d976bfd5e1f` |
| `specs/spec-outline-mcp-wiki-linting/SPEC.md` | `70f7da8ae70f5135a3cb90ffa94f839128b68d2468ca5466b002fd2f928fe04f` |
| `server/tools/README.md` | `fa4cd8d5936d19a88f9b79f5b2857da52ceb138913327f6e3fdc76642a047fb2` |

Applied files:

| File | Before | After | Diff |
| --- | --- | --- | --- |
| `epics.md` | `90cae51c7d1fef3fc7872e7635b37f2e02645f24a277854e876453d23f01e902` | `54ce25dad4a08147beb29aaedbe939872b708063a6cfe6d177b16adde8584c00` | 66 insertions, 0 deletions |
| `sprint-status.yaml` | `42fc85206c1d6de814e149604b7f4da0e7a79985e8cd0eeff72d9f3d55d43afc` | `d666c6c311d57b445082af7a26c49a6533a0cd349c1d2b6b444b381e80165ba1` | 1 insertion, 0 deletions |

Checks:

- `bmad-loop run --dry-run --epic 2` lists eight stories, `2-0-name-the-missing-configured-item-to-collection-readers` first. `--story 2-0` and `--story 2.0` each select it, and `--story 2-1` still selects Story 2.1.
- `sprint_status.py detect-epic --epic 2` parses the file and lists the eight pending Epic 2 stories, 2.0 first.
- `sprint_plan.py generate --dry-run` on a scratch copy reports `in_sync: true`, 22 stories, no new entries.
- `bmad-loop validate` passes every check except `git.worktree-clean`, which fails because these edits are uncommitted by instruction. It reports `sprint-status OK: 22 stories, 12 actionable`.
- Every anchor in §4.2 to §4.4 occurs exactly once in its target file.
