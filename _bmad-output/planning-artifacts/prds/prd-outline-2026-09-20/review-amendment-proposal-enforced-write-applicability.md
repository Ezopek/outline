---
title: "Review: Proposed Contract Amendment for Enforced-Write Applicability and Invalid-Policy Identity"
status: final
created: 2026-09-25
updated: 2026-09-25
artifact: amendment-proposal-enforced-write-applicability.md
proposal_status: proposed
---

# Review: Proposed Contract Amendment for Enforced-Write Applicability and Invalid-Policy Identity

## Verdict

**The proposal passes review as an amendment proposal. The final round reported no material findings.**

The proposal resolves the two phase-blocking contradictions from `reconcile-applied-amendment.md`:

- **C-1**, `read_only` applicability.
- **C-2**, invalid-policy identity.

It does so with a bounded delta:

- **PRD:** three glossary terms, a usage note, and targeted clause edits.
- **Architecture Spine:** rule-text amendments to AD-7, AD-8, AD-12, and AD-14, plus an amendment record. Identifiers, `Binds` lines, and adopted status are preserved.
- **Companions:** one-line alignments in SPEC, `server/tools/README.md`, and `AGENTS.md`.

The proposal has not been applied. No approved source has been modified. Applying it requires separate, explicit operator authorization. Even after application, Gate 1 stays `not ready`, because residual contradictions C-3 through C-7 still need their own decisions.

## Review Scope

The proposal was reviewed against these sources:

- the final PRD and PRD addendum;
- `ARCHITECTURE-SPINE.md` (AD-1 through AD-19);
- `SPEC.md`, `server/tools/README.md`, `AGENTS.md`, and the `CLAUDE.md` symlink;
- the prior scope-transition amendment record and its reconciliation report;
- `epics.md`, which carries lower authority as planning; and
- the selected `v1.10.1^{}` baseline code for the MCP `create_document`, `update_document`, and publish authorization paths, and for collection lookup.

It was also checked against the operator's ten proposal constraints:

1. preservation of unrelated decisions;
2. exact baseline for unconfigured and `read_only` writes;
3. create/update-only enforcement;
4. `move_document` and `restore_document` excluded;
5. invalid-configuration writes fail closed;
6. modeled invalid-policy rejection without fabricated identity;
7. minimized audit;
8. AD identifiers preserved, with amended text identified;
9. no OD-2, OD-6, or OD-7 values;
10. separate gates.

## Reviewers and Rounds

Four independent reviewer lenses ran in parallel:

- adversarial;
- edge-case, with baseline-code verification;
- contract consistency, with a verbatim anchor check; and
- traceability.

A fifth, context-free adversarial reviewer joined from round 3 onward.

| Round | Material findings | Main repairs |
| --- | --- | --- |
| 1 | 11, overlapping across lenses | See round 1 below. |
| 2 | 3 | See round 2 below. |
| 3 | 1, reported independently by two reviewers | Post-commit protocol errors would have suppressed audit for committed writes. Scope was cut back: that case moved out of the delta into residual C-6, and the audit-column question moved into C-5. |
| 4 | 2 | See round 4 below. |
| 5 | 0 | Minor wording fixes only. |
| Final confirmation | 0 | One wording alignment: "re-check before commit". |

Round 1 repairs:

- the four-step baseline pre-write sequence that precedes an invalid-policy rejection;
- request-time classification;
- the AD-7 scope carve-out;
- the Invalid-Policy Collection definition, covering NFR-20, SM-I7, and Gate 3;
- companion alignment;
- the audit presence rule; and
- the pattern-based usage note.

Round 2 repairs:

- identity for AD-7 worker mismatch;
- classification keyed on the resolved collection UUID;
- the `CLAUDE.md` symlink handling;
- the `collectionId` readability rule; and
- two new residuals, C-4 (fingerprint computability) and C-5 (disclosure to actors without collection read access).

Round 4 repairs:

- The delta itself created the concurrent collection-change case, so the delta now owns it. That covers the B-2 conflict rule, a narrow FR-16 exception, and Decision 6.
- C-6 was completed with its missing failure cases.

## Final State of Findings

- **Adversarial:** no material findings. All prior findings are resolved or explicitly reported as residuals.
- **Edge-case:** no material findings. The patch-target, HTML import, model-validation, unchanged-update, slug, and parent-derived create paths were verified against baseline code.
- **Contract consistency:** no material findings. All replacement and insertion anchors match the current sources exactly once.
- **Traceability:** no material findings. Every change traces to C-1, C-2, the disclosed write-side conflict, or one of Decisions 1–6. The story replan list and blocker-note placement are complete against `epics.md`.
- **Fresh adversarial:** no material findings. It confirmed that owning the collection-change conflict is a direct consequence of request-time classification, and that it does not violate minimality or preservation.

Minor findings that were not adopted remain recorded in the proposal as explicit decisions or residuals. The addendum is not given its own cross-reference; the proposal instead records its binding in the memlog on application.

## Residual Contradictions Reported by the Proposal

| ID | Nature | Decision owner |
| --- | --- | --- |
| C-3 | Read-only treatment of Invalid-Policy Collections: `not_evaluated` versus System Failure, and the scope of default `lint_wiki` | Product |
| C-4 | Invalid entries without a computable `invalidFingerprint`, including lone surrogates and nested duplicate keys | Architecture |
| C-5 | Policy identity and audit identifiers for actors who can write but cannot read the collection. This includes a cross-team publish path that was found by static inspection but is not runtime-confirmed. | Security |
| C-6 | Enforced-path protocol failures after classification: after validation, after commit, during transformation, and at re-authorization | Architecture and product |
| C-7 | `scopeKind` for ordinary write-validation summaries | Architecture |

Each residual blocks Gate 1 `ready` until it is decided. None of the proposal's Part A, B, or C edits depends on how C-3, C-5, C-6, or C-7 is resolved. C-4's resolution must keep the assumption that every invalid entry has an `invalidFingerprint`, or else amend all three dependent rules together.

## Unchanged Boundaries

- No implementation, image publication, deployment, configuration, or rollout was performed or authorized.
- OD-2, OD-6, and OD-7 received no environment-specific values.
- The PRD, addendum, Architecture Spine, SPEC, README, `AGENTS.md`, and `epics.md` were not modified during proposal preparation or review.
