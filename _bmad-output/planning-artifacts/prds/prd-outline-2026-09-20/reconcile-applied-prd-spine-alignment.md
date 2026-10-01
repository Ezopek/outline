---
title: "Reconciliation: Applied PRD–Spine Alignment Amendment"
status: reconciled-with-open-items
created: 2026-09-30
updated: 2026-09-30
source_prd: prd.md
amendment: amendment-proposal-prd-spine-alignment.md
supersedes_blockers: reconcile-applied-enforced-write-applicability.md
---

# Reconciliation: Applied PRD–Spine Alignment Amendment

## Verdict

**The reviewed delta (Parts A, B, C) was applied exactly.** Every former "Pending PRD alignment" item (C-3, C-5, C-6, and the addendum audit payload) is now consistent with the spine. No Critical or High finding was found. Two Medium findings remain. Both are the residuals the proposal already reported (RI-4 and RI-6). They now show up as tensions inside the PRD, and neither is an application defect.

Gate 1 remains `not ready`. The following are still open: RI-1 to RI-4, RI-6, D-9, and the epics replan. No implementation, image publication, deployment, configuration, or rollout authority follows from this report.

## Verbatim Verification

A script parsed every quoted block in Parts A to C of the proposal (73 blocks) and checked each one against the working-tree targets. It also counted each block's occurrences in `HEAD`.

| Check | Result |
| --- | --- |
| Part A With/Insert texts (29 `prd.md`, 1 `addendum.md`) | 30/30 present exactly once |
| Part A replaced texts | 22/22 gone. For A-22, A-23, and A-24 the old sentence survives only as the leading part of its With text, as the proposal intends (1 occurrence each, 0 standalone) |
| Insertion positions (A-2 ×2, A-9 ×2, A-10 ×2, A-13, A-17, A-18, A-19 ×2) | 11/11 immediately follow their anchor. The 5 anchors are unique. A-10 is the last FR-13 consequence, followed by `#### FR-23` |
| B-1 markers | 6/6 gone. No line begins `- **PRD alignment pending:**`, and "PRD alignment pending" occurs 0 times |
| B-2 | `**Pending PRD alignment.**` 0, "Lower-authority companions were not edited" 0. The Open PRD residuals paragraph appears once, verbatim, directly after the Amendment Record |
| B-3 | Row present once, verbatim, as the last row of the table, with its date cell set to `2026-09-30`. The two earlier rows are intact |
| C-a `SPEC.md` | 4/4 With texts present once; 4/4 old texts gone |
| C-b `server/tools/README.md` | Intro once, new JSON block once, and note once, all adjacent in that order. The file has one `json` fence, and the old keys (`"ok"`, `"line"`, `"path"`) occur 0 times |
| C-c `AGENTS.md` | New line once, inside the managed block; old line gone |
| Frontmatter `updated` | `prd.md` 2026-09-30; `addendum.md` 2026-09-30 (was 2026-09-21); spine `'2026-09-30'` |
| Changes outside the delta | Every added or removed sentence in `prd.md` (+81/−30 lines vs `HEAD`) and `addendum.md` traces to one of the three authorized proposals (scope-transition, enforced-write-applicability, and this one), with 0 unattributed. Word diffs of `SPEC.md`, `README.md`, and `AGENTS.md` show only proposal phrases. The PRD, addendum, and spine contain no triple blank lines |
| `CLAUDE.md` | `git ls-files -s` mode `120000`; `test -L` passes; `readlink` prints `AGENTS.md`; `git status --short CLAUDE.md` is empty |
| `AGENTS.md` stamp | `Verified 2026-09-20 … e5e3f7905` is unchanged. The `AGENTS.md` diff against `HEAD` touches only line 37 (prior amendment) and line 39 (C-c) |

Limitation: no snapshot of the spine from before application exists, because the earlier architecture update is also uncommitted. For that reason the spine was not byte-compared outside the delta. The checks that were run all pass. Each of AD-3, AD-8, AD-12, AD-14, AD-18, and AD-20 still reads Binds → Prevents → Rule with no residual marker text. The two earlier Amendment Record rows are unchanged. No stray whitespace artifacts were found.

## Reconciliation Findings

### Critical and High

None.

### Medium

1. **RI-4 is now a tension inside the PRD. It was disclosed and is not an application defect.** Section 4.4 criterion 2 now requires: "In `lint_document` this includes a readable document whose collection the actor cannot read, and that result carries no collection or policy identity." That result's System Failure still tells the actor that the unreadable collection's policy is invalid. NFR-11 still forbids "metadata that the current actor is not authorized to access", and SM-I4 and SM-P5 count distinguishing protected collection information as a failure. The enforced-write residuals of AD-12 have the same shape: the presence of `validation`, and `validationCorrelationId` on activity Events. Decision 2 and RI-4 anticipated all of this. An operator decision is needed: either an NFR-11 carve-out or an architecture change.
2. **RI-6 is now a tension inside the PRD. It was disclosed and is not an application defect.** FR-16 now says a committed HTML create returns the unestablished-outcome error when it "cannot recover the status that attempt recorded". Under AD-7 that happens when the committed audit summary is missing. This conflicts with FR-22: "Failure of the added lint or validation audit mechanism shall not alter the functional outcome." RI-6 does not cite one further text: the addendum bullet "Audit persistence failures must not change lint results, reject or roll back otherwise valid writes, or appear in the standard MCP response." The RI-6 decision should cover that bullet too.

### Low

1. **FR-13 general rule versus its exception.** Consequence 4 still says "Every write admitted through fail-open returns the unmistakable `degraded_validation` Validation Status". The new consequence 6 defines "admitted" as committed and says that a committed write "whose status it cannot recover" returns the Tool-Execution Error "instead of `degraded_validation`". The more specific clause governs. Separately, NFR-15's new carve-out names only "A write whose outcome the server cannot establish (FR-16)" and does not name the unrecoverable-status case. The spine treats that case as row 7, so the gap is wording only.
2. **FR-17 scope.** The FR-17 statement covers writes "whose Validation Status is `rejected`", yet it now carries an abort consequence, and aborts have no Validation Status. NFR-9 states the abort guarantee properly, so this is structural looseness only.
3. **Term drift.** The PRD glossary defines a Validation Attempt as starting "from its completed classification" and excludes the collection-change conflict. AD-20 says "a validation attempt runs from classification to its row", which includes row 2. Behavior is identical (row 2 records no summary), and the PRD glossary binds only PRD and addendum usage.
4. **UJ-2.** UJ-2 still says Warnings "remain visible to the agent". Decision 8 accepts this narrative yielding to the FR-16 recovered-status provision, so no edit is required.
5. **Residual from the proposal review.** A-6's actor-readable scope for an unreadable requested collection can literally read as "not evaluated". FR-4 and the new FR-19 `isError` consequence govern. D-9 owns the tool contracts.
6. **Cosmetic.** The three-item FR-16 list has a blank line only between items 2 and 3. This matches the proposal verbatim.
7. **Architecture memlog.** The list of author defaults that became operator decisions leaves out Decision 5's author-default halves (the unestablished and unrecoverable fail-open cases). "Unestablished outcome row 7" and "recovered HTML status" cover them in substance. The memlog is append-only, so no correction is required.

### Former Pending Items: Status

| Item | Now consistent with | Evidence |
| --- | --- | --- |
| C-3 read-side sentinel | AD-11, AD-12, AD-18 | FR-4, FR-7, FR-11, FR-12, Section 4.3 and 4.4 criteria, and the Evaluated Scope glossary entry now match the AD-12 closed algebra, including document-only readers and unreadable `lint_wiki` sentinels contributing nothing |
| C-5 identity condition and actor-independent audit | AD-12, AD-14, AD-15 | Classification fixture 1, FR-21 audited scope, NFR-11 audit sentence, addendum payload |
| C-6 attempt boundary and aborts | AD-3, AD-7, AD-8, AD-13, AD-14, AD-15, AD-20 | Glossary (Tool-Execution Error, Validation Attempt), FR-13 exclusions and "admitted", FR-16 three exceptions and recovered status, FR-17, FR-19 `isError`, FR-20 aborted and unestablished outcomes, NFR-9, NFR-15, SM-I6, Section 4.5 and 4.6 criteria |
| Addendum payload | AD-14 `AuditDataV1`, AD-15 | Actor and IP, `credentialAuthType`, `authenticatedClientId`, `runtimeFailOpenExercised`, System Failure counts, audited scope |

### Companions, Spine Paragraph, Memlogs

- **SPEC.md.** Adopts AD-1 to AD-20. The CAP-6 and fail-open wording match FR-13, FR-16, and FR-20. No new conflict was found.
- **README.** The example uses a Finding shape and `document` location that match AD-3, AD-4, and AD-12 (`REQUIRED_METADATA_FIELD_MISSING` is `document`-located), plus the `{ success: false, validation }` rejection envelope. The readability note matches AD-12.
- **AGENTS line.** Consistent with FR-11, FR-12, and NFR-20.
- **Open PRD residuals paragraph.** Accurate. RI-1 and RI-2 are cases where the PRD controls. RI-4 and RI-6 are stated in the amended PRD and still need an operator decision (see Medium 1 and 2). RI-3 awaits acceptance. The epics are stale: the Story 2.4 "Known binding contradictions" note (line 1071) and the `AD-1–AD-19` ranges (lines 1395 and 1401) confirm it. The RI-5 lines were verified: the README "Required tests" section lacks the AD-18 layers, the README says "missing, deleted, or inaccessible", and AGENTS says "Fork roadmap and acceptance criteria: `server/tools/README.md`", with its stamp dated 2026-09-20.
- **Memlogs.** The PRD entries (authorization, Part A, companions), the architecture entries (authorization, author defaults turned into decisions, markers, paragraph, row, authority note closed), and the SPEC entry (AD-20, CAP-6, fail-open constraint) are accurate. The frontmatter of all three reads `updated: 2026-09-30T07:53`.

## Remaining Open Items

| Item | Owner | Effect |
| --- | --- | --- |
| RI-1: FR-19 policy fields versus AD-14 read summaries (the PRD controls) | Operator | Blocks Gate 1 `ready` |
| RI-2: startup-fatal configuration classes versus FR-12, NFR-16, and Section 4.4 (the PRD controls) | Operator or architecture | Blocks Gate 1 `ready` |
| RI-3: writer `afterCommit` hooks after a failed COMMIT | Operator acceptance, or an architecture change | Blocks Gate 1 `ready` |
| RI-4: residual disclosures versus NFR-11, SM-I4, and SM-P5 (Medium 1) | Operator (security) | Blocks Gate 1 `ready` |
| RI-5: stale README and AGENTS lines | Lower-authority wording | Not a PRD conflict |
| RI-6: HTML status recovery versus FR-22 and the addendum's audit-isolation bullet (Medium 2) | Operator or architecture | Blocks Gate 1 `ready` |
| Epics replan (`bmad-correct-course`, as tabulated in the proposal) | Needs its own operator authorization | `epics.md` stays stale |
| D-9: tool contracts, link forms, write-eligibility constants, stop margin, `SET LOCAL` floor | Stories and AD-17 evidence | Required before Gate 1 |
| D-8 baseline authorization gap; option of a convert-only HTML worker | Operator | Outside this delta |

Gate 1: **`not ready`**.

## Recommendation

Mark `amendment-proposal-prd-spine-alignment.md` as `applied`. The delta is verbatim, correctly placed, and confined to the authorized targets. `CLAUDE.md` is intact and the stamp is unchanged. The medium findings are pre-disclosed residuals, not deviations from the delta. Record RI-4 and RI-6, including the addendum locus of RI-6, for operator decision. The Low items are optional wording for a later amendment. Nothing is committed.
