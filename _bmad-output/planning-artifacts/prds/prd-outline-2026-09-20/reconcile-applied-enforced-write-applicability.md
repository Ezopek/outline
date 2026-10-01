---
title: "Reconciliation: Applied Enforced-Write Applicability Amendment"
status: reconciled-with-open-items
created: 2026-09-30
updated: 2026-09-30
source_prd: prd.md
amendment: amendment-proposal-enforced-write-applicability.md
supersedes_blockers: reconcile-applied-amendment.md
---

# Reconciliation: Applied Enforced-Write Applicability Amendment

## Verdict

**The reviewed delta was applied exactly, and C-1 and C-2 no longer block the sources.** Gate 1 remains `not ready`: C-3 through C-7 are unresolved, and the epics still carry the superseded C-1/C-2 blocker notes.

No implementation, image publication, deployment, configuration, or rollout authority follows from this report.

## Applied Scope

| Artifact | Change |
| --- | --- |
| `prd.md` | Three glossary terms and the configured-write usage note; amended Validation Status, UJ-2, FR-11, the CAP-4 write criterion, the Section 4.5 description, FR-14 through FR-17, and FR-20; two new Section 4.5 acceptance bullets. `updated` set to 2026-09-30. |
| `ARCHITECTURE-SPINE.md` | Rule text of AD-7, AD-8, AD-12, and AD-14 amended; Amendment Record appended, dated 2026-09-30. Identifiers, `Binds`, `Prevents`, and `[ADOPTED]` markers unchanged. `updated` set to 2026-09-30. |
| `SPEC.md` | CAP-5 and CAP-6 intents; the validation constraint; "Errors block Enforced Writes (PRD term)". |
| `server/tools/README.md` | Enforcement-scope paragraph, error-blocking sentence, configuration-error sentence, compatibility-test bullet. |
| `AGENTS.md` | One managed-block line. `CLAUDE.md` remains a symlink, git mode `120000`. |
| `addendum.md` | Unchanged, as specified. |

## Verification Performed

- A script compared every "With:" and "Insert" block of the proposal's delta against the target files. 29 blocks appear verbatim. Five "replace" intros of the form "In FR-x, replace:" were misread as new blocks; their old text is confirmed absent. The Amendment Record differs from the proposal only by the filled-in date. The one old-text anchor still present is the AD-14 sentence that the delta deliberately retains.
- `git ls-files -s CLAUDE.md` reports mode `120000`.
- The `AGENTS.md` diff is one line; the verification stamp is unchanged.
- Residual "configured … write" phrases in the PRD (Error and Warning glossary entries, FR-13), the addendum, and the Spine (`Binds` line of AD-8, the closing sentence of AD-12) are bound by the glossary usage note and the AD-8 sentence "In this spine, 'enforced write' … mean a PRD Enforced Write".
- The PRD phrase "Read-only requests outside Configured Collections return policy-not-configured/not-evaluated" is intentionally untouched pending C-3.

## Findings

1. **No new source-level contradiction was found** among the PRD, addendum, Architecture Spine, SPEC, README, and `AGENTS.md`.
2. **README illustrative JSON.** The example response in `server/tools/README.md` (`ok`, `errors`, `documentId`, `line`, `path`) predates AD-12 and is not normative. It was not edited. It does not use the `validation` object, so it neither shows nor contradicts the new identity fields.
3. **`AGENTS.md` stamp.** The managed block still says "Verified 2026-09-20 …". The block's content changed by one line without re-verification, as the proposal required. A later `bmad-project-context` refresh will restamp it.
4. **Epics are stale.** `epics.md` still records the C-1/C-2 contradictions as blockers (Story 2.4 "Known binding contradictions" note near line 1071; Story 3.4 criterion 5 near line 1419) and lacks the new classification, identity, and conflict criteria. The replan in the proposal's application plan (step 4) was not part of the authorization and has not been done.
5. **Verbatim wording quirk.** The AD-8 sentence reads `In this spine, "enforced write", and "configured MCP create/update" in \`Binds\` lines, mean …`, including a comma the proposal contains. It was applied exactly.
6. **Working tree.** Nothing is committed. `prd.md` and `.memlog.md` now hold both the earlier scope-transition application and this amendment in one uncommitted diff.

## Still Open

| Item | Owner | Effect |
| --- | --- | --- |
| C-3 read-only treatment of Invalid-Policy Collections | Product | Blocks Gate 1 `ready` |
| C-4 invalid entries without a computable `invalidFingerprint` | Architecture | Blocks Gate 1 `ready` |
| C-5 policy identity for actors without collection read access | Security | Blocks Gate 1 `ready` |
| C-6 post-classification protocol failures on the enforced path | Architecture and product | Blocks Gate 1 `ready` |
| C-7 `scopeKind` for ordinary write-validation summaries | Architecture | Blocks Gate 1 `ready` |
| Epics replan and final validation (`step-04-final-validation`) | Operator authorization needed | Epics remain incomplete |

Until those decisions are made:

- the amended PRD and the amended AD-7, AD-8, AD-12, and AD-14 are binding;
- AD-1 through AD-6, AD-9 through AD-11, AD-13, and AD-15 through AD-19 remain exactly as adopted; and
- Gate 1 remains `not ready`.
