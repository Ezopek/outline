---
title: "Review: Proposed PRD Amendment for Reachable Collection-Scope Transitions"
status: final
created: 2026-09-25
updated: 2026-09-25
artifact: amendment-proposal-scope-transition.md
application_reconciliation: blocked
---

# Review: Proposed PRD Amendment for Reachable Collection-Scope Transitions

## Verdict

**PASS as a reviewed amendment record.** The artifact is internally consistent, preserves the operator-supplied authority order and adopted AD-1 through AD-19 decisions, and defines the minimal source amendment that the operator separately authorized and applied.

The amended PRD is binding. Applying the amendment removed the source-contract blocker but did not pass Gate 1; implementation readiness still requires reconciled planning and passing evidence for every binding requirement.

Application reconciliation later found two phase-blocking source contradictions concerning `read_only` write applicability and invalid-policy response identity. See `reconcile-applied-amendment.md`; the proposal-review verdict remains valid, but the overall source set is not implementation-ready.

## Review Scope

The proposal was reviewed against:

- the final PRD and PRD addendum;
- `ARCHITECTURE-SPINE.md` and AD-1 through AD-19;
- `SPEC.md`, `server/tools/README.md`, and repository instructions;
- the selected baseline implementations of `create_document`, `update_document`, `move_document`, and `restore_document`; and
- the affected Epic 2 and Epic 3 planning statements.

The review used independent adversarial, edge-case, editorial-structure, and editorial-prose lenses. Technical reviewers were rerun after repairs.

## Material Repairs Applied

- Narrowed the amendment so FR-11 remains unchanged.
- Distinguished unconfigured, `read_only`, `enforced`, and identifiable invalid-policy states.
- Required an error-bearing collectionless-draft publication fixture that proves pre-persistence enforcement and unchanged draft state.
- Made the closed baseline destination-selection inventory part of the proposed normative delta.
- Added the collectionless-draft update path that remains at a `null` collection.
- Kept destinationless `create_document` behavior in non-gating baseline characterization because its implementation and tool description differ.
- Covered both `move_document` and `restore_document` as out-of-scope compatibility surfaces, including invalid-policy scopes, without treating them as CAP-5 evidence.
- Qualified `lint_wiki` drift detection by valid configured policy and actor-authorized Evaluated Scope.
- Limited invalid-configuration fail-closed language to affected hard-enforced create/update operations so it does not broaden enforcement.
- Separated proposal review acceptance from explicit authority to edit the approved PRD.
- Required preservation and traceability reconciliation against every companion after any authorized application.

## Final Recheck

- Final adversarial findings: none.
- Final edge-case findings: none.
- Editorial structure recommendations: applied where they improved decision-first flow without removing unique safeguards.
- Editorial prose findings: applied.
- At proposal-review time, the approved PRD and companions were unchanged. After separate operator authorization, only the exact reviewed delta was applied to the PRD; the addendum, Architecture Spine, SPEC, and `server/tools/README.md` remain unchanged pending reconciliation.
- OD-2, OD-6, and OD-7: no environment-specific values introduced.

## Application Record

On 2026-09-25, after accepting the reviewed proposal, the operator separately authorized applying its exact normative delta to the final PRD. No implementation, image publication, deployment, configuration, or rollout action was authorized by that decision.
