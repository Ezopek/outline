---
title: "Proposed PRD Amendment: Reachable Collection-Scope Transitions"
status: applied
created: 2026-09-25
updated: 2026-09-25
source_prd: prd.md
applied: 2026-09-25
reconciliation_status: blocked
---

# Proposed PRD Amendment: Reachable Collection-Scope Transitions

## Decision Record

The operator made two separate decisions:

1. The reviewed document was accepted as a suitable amendment candidate without authorizing source changes.
2. On 2026-09-25, the operator explicitly authorized applying the exact normative delta below to `prd.md`.

The adopted decision realigns one unreachable capability acceptance criterion with collection transitions actually supported by the selected baseline's in-scope `create_document` and `update_document` contracts. Post-operation policy selection, the create/update-only enforcement boundary, and every adopted architecture decision remain unchanged.

## Status, Authority, and Current Gate Effect

This document is retained as the applied amendment record. The exact normative delta was incorporated into `prd.md` on 2026-09-25 under explicit operator authority. The amended PRD is binding; this record does not independently modify, supersede, reinterpret, or waive any other approved source. The former source-contract blocker is removed, but Gate 1 remains `not ready` until every required implementation-readiness result is supported by passing evidence.

The binding authority order remains:

1. The final PRD controls product scope and acceptance.
2. The PRD addendum controls its binding technical inputs.
3. `ARCHITECTURE-SPINE.md` controls implementation consistency.
4. `SPEC.md` remains the lean feature kernel and capability map.
5. `server/tools/README.md` and repository instructions remain binding repository contracts.

This is the operator-supplied governing order for this amendment. Any contradiction among these sources blocks progress and requires explicit reconciliation. No lower-authority source may silently reinterpret a higher-authority source.

## Verified Gap

The selected baseline supports a tool-level transition into configured scope through `update_document`, but no in-scope `create_document` or `update_document` operation can move an existing document out of configured scope. A pure selector fixture can verify the decision function, and out-of-scope mutation fixtures can verify baseline non-interference, but neither is end-to-end Projected Document enforcement evidence for the missing transition.

The approved contract creates the gap through these combined requirements:

- **FR-11** requires policy applicability for `create_document` and `update_document` to be determined by the Projected Document's post-operation collection. It also preserves the general rule that a supported write leaving configured scope is not blocked by the former collection's content policy.
- The **MCP Write Enforcement capability acceptance criteria** require scope-transition fixtures for both entering and leaving configured scope.
- **FR-14**, **FR-15**, and **FR-18** limit initial hard enforcement to `create_document` and `update_document`.
- **SM-I1** and **Gate 1** require every capability acceptance criterion to pass; an unavailable fixture cannot be silently waived or replaced with weaker evidence.

The selected baseline provides these relevant behaviors:

- `create_document` can resolve its destination directly from `collectionId` or indirectly from `parentDocumentId`, but it cannot relocate an existing document.
- `update_document.collectionId` is used only to publish an existing collectionless draft. It cannot replace the collection of an existing collected document.
- `update_document` unpublishes with `detach: false`, so unpublishing retains the collection.
- The separate built-in `move_document` and `restore_document` tools can change an existing document's collection, but neither tool is covered by the FR-18 enforcement boundary or the adopted Projected Document, validation-response, validation-audit, and performance contracts.

The entry fixture does not depend on a public `create_document` contract for creating collectionless drafts. It may seed an authorized collectionless draft through the test fixture and exercise the public `update_document` publish path. The existing `create_document` description and its implementation behavior for `publish: false` without a destination must be characterized separately; this amendment does not widen that input contract.

## Proposed Normative Delta

FR-11 and its consequence bullets remain unchanged. The amendment adds one FR-18 consequence, replaces the identified Section 4.5 capability acceptance criterion, and adds the closed baseline destination-selection inventory that defines its required evidence.

### 1. Add one FR-18 consequence bullet

Add:

> Built-in `move_document` and `restore_document` remain outside the initial configured-write validation-status and configured-write validation-audit contracts. Compatibility fixtures characterize their unchanged baseline behavior for collection-changing cases but do not count as CAP-5 Projected Document enforcement evidence.

### 2. Replace the unreachable scope-transition acceptance criterion

Replace:

> Scope-transition fixtures prove that entering a Configured Collection activates enforcement before persistence and leaving configured scope is not blocked by the former collection's content policy.

With:

> Collection-applicability fixtures prove that policy selection uses the Projected Document's post-operation collection for every destination-selection path reachable through the selected baseline's in-scope `create_document` and `update_document` contracts. Tool-level fixtures distinguish among the following conditions: an absent policy or null collection, a valid policy with `read_only` activation, a valid policy with `enforced` activation, and an invalid-policy sentinel. An existing collectionless draft with a stable known Error is rejected before publication into an `enforced` destination, leaving its collection and publication state unchanged and producing the required minimized rejection audit. Unconfigured and `read_only` destinations preserve baseline write behavior and response shape and add no configured-write validation audit; an invalid-policy destination fails closed. Separately labeled compatibility fixtures exercise `move_document` and `restore_document` collection changes among `enforced`, unconfigured, `read_only`, and identifiable invalid-policy scopes in every direction permitted by baseline authorization, while preserving baseline authorization, persistence, response, and mutation-event behavior and adding no validation field or configured-write validation-audit summary. These compatibility fixtures provide neither Projected Document enforcement evidence nor CAP-5 enforcement evidence. Resulting out-of-band drift remains detectable by `lint_wiki` only when the destination has a valid configured policy and lies within the actor-authorized Evaluated Scope; unconfigured and invalid-policy destinations retain their approved not-evaluated or System Failure behavior.

### 3. Add the closed baseline destination-selection inventory

Add the following table immediately after the replacement criterion. The table is part of the amended acceptance contract and does not add a new tool capability.

| In-scope operation path | Post-operation collection source | Required evidence |
| --- | --- | --- |
| `create_document` with `collectionId` | Explicit destination collection | Unconfigured, `read_only`, `enforced`, and invalid-policy outcomes select only the resolved destination policy. |
| `create_document` with `parentDocumentId` | Authorized parent collection | The parent-derived destination follows the same four policy cases without trusting a conflicting request value. |
| `update_document` on an existing collected document | Existing collection | Policy selection uses the retained collection for every edit mode, title-only update, publication state, and update with unchanged policy-relevant content; `collectionId` cannot move the document. |
| `update_document` on an existing collectionless draft without publication | `null` | Baseline response behavior is preserved, no validation field or configured-write validation audit is added, and `collectionId` without `publish: true` neither moves nor attaches the draft. |
| `update_document` publishing an existing collectionless draft | Authorized `collectionId` destination | A stable known Error proves `enforced` pre-persistence rejection; clean and Warning cases remain governed by the existing acceptance criteria. |
| `update_document` unpublishing an existing collected document | Existing collection because `detach: false` | Policy selection uses the retained collection; the operation is not treated as leave-scope. |
| `move_document` collection change | Destination chosen by the baseline move contract | Compatibility across `enforced`, unconfigured, `read_only`, and identifiable invalid-policy scopes only: no lint enforcement, validation field, or configured-write validation audit is added. |
| `restore_document` collection change | Explicit or original collection under the baseline restore contract | Compatibility across `enforced`, unconfigured, `read_only`, and identifiable invalid-policy scopes only: no lint enforcement, validation field, or configured-write validation audit is added. |

For all policy-bearing in-scope rows, fixtures separately cover an absent-policy state, a valid `read_only` state, a valid `enforced` state, and an identifiable invalid-policy sentinel state. Authorization failures retain existing protocol behavior and never become lint Findings or admit writes on a fail-open basis.

## Non-Gating Baseline Characterization

The implementation permits some authorized callers to invoke `create_document` with `publish: false` and no destination, while the current tool description says a collection or parent is required. This proposal does not resolve that pre-existing description mismatch and does not count the path as amendment acceptance evidence. Implementation planning may characterize its baseline authorization, response, and `null`-collection behavior, but treating it as a supported public contract requires separate reconciliation.

## Impact and Unchanged Boundaries

| Contract area | Impact |
| --- | --- |
| CAP-4 | Unchanged. Configured, unconfigured, invalid-policy, and runtime-failure behavior remains explicit. |
| CAP-5 | Unchanged in scope. Evidence is aligned with destination-selection paths reachable through create/update. |
| FR-11 | Unchanged. The general post-operation policy guarantee is preserved. |
| FR-14–FR-17 | Unchanged. Full projection, response status, and atomic rejection requirements remain binding. |
| FR-18 | Enforcement remains limited to create/update; compatibility evidence for collection-changing move/restore paths is explicitly non-enforcement evidence. |
| FR-19 | Unchanged. Read-only lint audit behavior is unaffected. |
| FR-20 | Unchanged. Configured-write validation audit remains limited to configured create/update validation attempts. |
| NFR-20, NFR-24 | Unchanged. Create/update compatibility and applicable-surface rule evidence remain required. |
| SM-I1 | Applying the amendment removes the unreachable-evidence blocker; all remaining capability evidence is still required. |
| SM-I3, SM-I7 | Unchanged. Their independently attainable write-safety and compatibility evidence obligations remain required. |
| Gate 1 | The source-contract blocker can be removed only after explicit amendment application and replanning; the amendment itself does not pass Gate 1. |
| Gate 2–Gate 4 | Unchanged and unauthorized by this proposal. |
| AD-1–AD-19 | Unchanged. No adopted architecture decision is reopened. |
| OD-2, OD-6, OD-7 | Unchanged and deferred to their assigned gates; no environment-specific value is supplied. |

All other binding requirements and safeguards remain unchanged, including:

- the exact `v1.10.1^{}` source baseline at `4a5a616a21be800257dc11cef4263d0dd0412156`, without merge or rebase onto `upstream/main` and without the post-`v1.10.1` container-block patch-edit fix;
- one standard `/mcp` endpoint, deterministic validation without an LLM or semantic classification, and one shared rule engine;
- read-only linting and its audit evidence before write enforcement;
- complete Projected Document validation for create and every supported update mode;
- Errors block writes, Warnings do not block them, invalid configuration always fails closed for affected hard-enforced `create_document` and `update_document` operations, and runtime failure follows the approved per-collection decision matrix; invalid configuration does not expand lint enforcement to `move_document` or `restore_document`;
- upstream-compatible unconfigured and `read_only` writes, non-disclosure, atomic rejected writes, audit-failure isolation, generic reusable artifacts, and separate delivery and rollout gates; and
- all unaffected CAP, FR, NFR, SM, Gate, OD, and AD requirements in the approved source set.

## Considered Alternatives

### Extend lint enforcement to `move_document` or `restore_document` — Rejected

This would expand the approved product surface and require coordinated changes to FR-11, FR-16 through FR-18, FR-20, CAP-5, CAP-6, affected NFRs and success metrics, the rollout boundary, and the applicable adopted architecture decisions. FR-19 would change only if this alternative also changed read-only lint auditing. This alternative conflicts with the requirement to preserve AD-1 through AD-19 and the initial create/update-only enforcement boundary.

### Add move-out semantics to `update_document` — Rejected

This would invent a new tool contract rather than implement the selected baseline's semantics. It would widen authorization, projection, transaction, compatibility, and test obligations and would no longer be a minimal contract correction.

### Treat selector and out-of-scope compatibility fixtures as equivalent evidence — Rejected

This would combine unit-level and compatibility evidence into a nonexistent end-to-end Projected Document write. It would not satisfy SM-I1 or Gate 1 and would silently reinterpret the approved acceptance criterion.

### Leave the approved contract unchanged — Valid but Blocking

Implementation stories may remain accurate and implementation work may proceed only with Gate 1 recorded as unconditionally `not ready`. The required leave-scope Projected Document fixture remains impossible on the selected baseline.

## Effect on Implementation Planning After Application

Application authority permitted only the controlled PRD edits above, not implementation or rollout. After those edits:

1. Story 2.1 would replace its phase-blocking gap with criteria covering the closed destination-selection inventory, an error-bearing draft-to-enforced entry, compatibility for unconfigured and `read_only` destinations, invalid-policy behavior, and supplemental move/restore non-interference.
2. Story 3.4 would remove the unconditional source-gap `not ready` condition while retaining the rule that any missing or failed evidence makes Gate 1 `not ready`.
3. The complete requirements and story traceability checks would be rerun against the amended PRD.
4. The amended PRD would be reconciled against the PRD addendum, `ARCHITECTURE-SPINE.md`, `SPEC.md`, `server/tools/README.md`, and repository instructions. The preservation and traceability result would be recorded; any new contradiction would block planning rather than trigger a silent companion edit.
5. `SPEC.md`, the addendum, and `ARCHITECTURE-SPINE.md` would remain unchanged unless a separately authorized reconciliation established that a source amendment was required.
6. Gate 1 would still require all implementation, security, audit, compatibility, and performance evidence before it could pass.
