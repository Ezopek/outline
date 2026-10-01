---
title: "Reconciliation: Applied Scope-Transition Amendment"
status: blocked
created: 2026-09-25
updated: 2026-09-25
source_prd: prd.md
---

# Reconciliation: Applied Scope-Transition Amendment

## Verdict

**BLOCKED.** The authorized scope-transition delta was applied exactly, but full companion and story reconciliation exposed two phase-blocking source-contract contradictions. Implementation cannot choose between the conflicting clauses, and Gate 1 cannot become `ready`, without separately authorized source amendments.

No implementation, image publication, deployment, configuration, or rollout authority follows from this report.

## C-1 — `read_only` Policy Versus Configured-Write Enforcement

The PRD glossary defines a Configured Collection as any collection with valid Policy Configuration. AD-5 makes `activation: read_only | enforced` part of every valid policy. FR-14 and FR-15 require validation for create/update whenever the Projected Document belongs to a Configured Collection, and FR-16 requires every configured create/update response to expose a Validation Status.

The applied Section 4.5 criterion, AD-8, AD-12, AD-18, and AD-19 instead require `read_only` writes to retain baseline behavior and response shape, with no Validation Status or configured-write validation audit.

These requirements cannot all be implemented simultaneously.

**Minimum product clarification required:** distinguish a valid Configured Collection from a collection whose policy activation is `enforced`; bind FR-14 through FR-17 and the configured-write portion of FR-20 to the latter, while keeping unconfigured and `read_only` writes on the baseline path. The clarification must also state whether an identifiable invalid-policy sentinel produces a modeled rejected Validation Status and a minimized validation-audit attempt.

## C-2 — Invalid-Policy Identity in Enforced-Write Responses

AD-6 permits an identifiable invalid entry to expose only `invalidFingerprint`, its stable failure code, and safe schema-path information. AD-12's exact enforced-write response contract requires `validation.policyFingerprint` and defines no invalid-policy identity variant, while AD-13 requires invalid configuration to return `rejected`. AD-14 makes `policyFingerprint` optional in audit summaries but defines no `invalidFingerprint` field.

An implementation cannot return the AD-12 response for invalid policy without either fabricating a valid `policyFingerprint`, omitting an exact required field, leaking raw invalid configuration, or inventing a response variant that the adopted architecture does not define.

**Minimum architecture clarification required:** define one explicit invalid-policy identity representation for modeled rejected write responses and its minimized audit treatment, consistent with AD-6 privacy and AD-14's closed payload. This would change adopted architecture text and therefore requires an explicit override of the current instruction to preserve AD-1 through AD-19 exactly.

## Reconciliation Results

- The applied FR-18 `move_document` and `restore_document` non-enforcement boundary otherwise agrees with CAP-5, the PRD addendum, SPEC, `server/tools/README.md`, AD-7, AD-8, AD-12, AD-14, AD-17, AD-18, and AD-19.
- The closed destination-selection inventory is represented in Story 2.1, and Story 3.4 keeps Gate 1 separate from later delivery and rollout approvals.
- Story 1.7 was repaired to require remaining-time bounds for every snapshot query and bounded stage and to prove release of the per-process `lint_wiki` admission slot on every terminal path.
- OD-2, OD-6, and OD-7 remain deferred to their assigned gates with no invented environment-specific values.
- No companion source was modified during reconciliation.

## Required Next Decision

The operator must decide whether to authorize preparation of a second, separately reviewed amendment proposal covering the minimum PRD and Architecture Spine clarifications above. Until then:

- the current amended PRD remains binding;
- AD-1 through AD-19 remain unchanged;
- the epics artifact remains incomplete at final validation; and
- Gate 1 remains `not ready`.
