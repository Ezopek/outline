---
title: "Sprint Change Proposal: Replan epics.md Against the Final Contracts"
status: approved
created: 2026-10-01
approved: 2026-10-02
workflow: bmad-correct-course
mode: batch (fast path, launch-grade rigor)
target: _bmad-output/planning-artifacts/epics.md
binding_sources:
  - _bmad-output/planning-artifacts/prds/prd-outline-2026-09-20/prd.md
  - _bmad-output/planning-artifacts/prds/prd-outline-2026-09-20/addendum.md
  - _bmad-output/planning-artifacts/architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md
  - _bmad-output/specs/spec-outline-mcp-wiki-linting/SPEC.md
replan_inputs:
  - _bmad-output/planning-artifacts/prds/prd-outline-2026-09-20/amendment-proposal-prd-spine-alignment.md (Epics Stories to Replan)
  - _bmad-output/planning-artifacts/prds/prd-outline-2026-09-20/amendment-proposal-residuals-ri4-ri6.md (Effect)
  - _bmad-output/planning-artifacts/prds/prd-outline-2026-09-20/amendment-proposal-residuals-ri1-ri3.md (Effect)
---

# Sprint Change Proposal: Replan `epics.md` Against the Final Contracts

## Status and Authority

The operator asked for this replan directly: replan `epics.md` against the final contracts, keep the three-epic, 21-story structure unless a change is clearly required, fix the D-9 items the spine assigns to stories, and keep the AD-17-derived constants as explicit evidence tasks. The replan is applied to `epics.md` in the working tree and is not committed. This proposal records the change. The operator approved it on 2026-10-02, including the Section 4.5 contract choices.

The authority order is unchanged: the PRD, then its addendum, then `ARCHITECTURE-SPINE.md`, then `SPEC.md`, then the repository contracts. The binding sources are read-only here. Their SHA-256 hashes before and after this run are identical (see Verification). Operator decisions recorded in the PRD and architecture memlogs are inputs and are not reopened. No implementation, image publication, deployment, configuration, or rollout is authorized or performed.

## 1. Issue Summary

**Trigger.** No story has been implemented, and no `sprint-status.yaml` or implementation artifact exists. The trigger is a contract change rather than an implementation discovery. Between 2026-09-30 and 2026-10-01, four applied amendments changed the binding sources:

- the enforced-write applicability amendment (C-1, C-2);
- the spine update that adopted AD-20 and decided C-3 to C-7;
- the PRD and spine alignment amendment; and
- the RI-4/RI-6 and RI-1 to RI-3 residual amendments.

`epics.md` predates them. Both the spine's Open PRD residuals paragraph and the RI-1 to RI-3 amendment state that Gate 1 stays `not ready` "until the epics are replanned and the D-9 items are fixed".

**Category.** Requirement change from stakeholder decisions: operator decisions applied to higher-authority sources.

**Problem statement.** `epics.md` had four kinds of defect:

- It carried a superseded blocker: the Story 2.4 "Known binding contradictions" note and the C-1/C-2 phase-blocking criterion in Story 3.4.
- It lacked AD-20 and every rule the 2026-09-30 and 2026-10-01 amendments added or changed, so several criteria contradicted the final contracts.
- It left the D-9 tool contracts and link forms unfixed.
- It did not treat the AD-17-derived constants as evidence tasks.

**Evidence.**

| Evidence | Location before replan |
| --- | --- |
| Superseded C-1/C-2 blocker | Story 2.4 closing note; Story 3.4 AC5 |
| No AD-20; AD inventory and ranges stop at AD-19 | Requirements Inventory; Epic 3; Stories 3.2 and 3.4 |
| `invalidFingerprint` over canonical values (contradicts AD-6 source bytes) | Story 1.2 AC6 |
| Any duplicate key blocks startup (contradicts AD-5 nested duplicates as sentinels) | Story 1.2 AC2 |
| Default `lint_wiki` drops readable sentinels; unconfigured state returned for sentinel-only scope (contradicts AD-12, FR-7) | Story 1.5 AC3, AC10 |
| Write audit covers four outcomes; no `aborted_*`, `scopeKind: collection`, or no-summary rows (contradicts AD-14, AD-20, FR-20) | Story 2.7 AC1, AC2, AC5, AC8 |
| Response identity unconditional; patch block mandatory (contradicts AD-12, FR-16) | Story 2.4 AC1, AC2, AC3 |
| Limit excess retains completed units (contradicts AD-11 "limit excess returns no Findings and `state: failed`") | Story 1.7 AC6 |
| "Protocol" terminology for tool-execution errors (contradicts the spine's Consistency Conventions and the PRD's Tool-Execution Error) | Stories 1.3, 1.10, 2.1, 2.3, 2.4 |
| D-9 tool contracts and link forms unfixed | Stories 1.3, 1.4, 1.5, 1.10 |

## Checklist Record

| Item | Status | Note |
| --- | --- | --- |
| 1.1 Triggering story | [N/A] | No story was implemented. The trigger is the applied contract amendments. |
| 1.2 Core problem | [x] | Requirement change; see Issue Summary. |
| 1.3 Evidence | [x] | See the evidence table. |
| 2.1 Current epic | [x] | All three epics can still be completed as planned. Their criteria needed amendment. |
| 2.2 Epic-level changes | [x] | Goal and implementation-note wording only. No epic was added, removed, or redefined. |
| 2.3 Remaining epics | [x] | Every story was reviewed. Each change is listed in Section 4. |
| 2.4 Obsolete or new epics | [x] | None. Every new rule fits an existing story. |
| 2.5 Order and priority | [x] | Unchanged: read-only first (Epic 1), then enforcement (Epic 2), then readiness (Epic 3). |
| 3.1 PRD conflicts | [x] | None. The PRD is final and binding. The replan conforms to it. |
| 3.2 Architecture conflicts | [x] | None. The replan conforms to AD-1 to AD-20, and the D-9 items are fixed as the spine assigns them. Three non-blocking review items go to the architect (§4.6). |
| 3.3 UI/UX | [N/A] | No UI in this increment. |
| 3.4 Other artifacts | [!] | RI-5 (stale `server/tools/README.md` and `AGENTS.md` lines) stays open. It is outside this run's authority. It is recorded as non-blocking in Story 3.4. |
| 4 Path forward | [x] | Direct Adjustment (Section 3). |
| 5.1–5.5 Proposal components | [x] | This document. |
| 6.1–6.2 Review | [x] | Four independent review rounds. Round 4 found no material finding (see Review Record). |
| 6.3 User approval | [x] | Approved by the operator on 2026-10-02. |
| 6.4 `sprint-status.yaml` | [N/A] | The file does not exist. Generating it is a later `bmad-sprint-planning` step. |
| 6.5 Handoff | [x] | Section 5. |

## 2. Impact Analysis

### Epic Impact

| Epic | Impact |
| --- | --- |
| Epic 1 | The goal adds invalid-policy escalation. The implementation notes add sentinels, startup-fatal diagnostics, and the D-9 tool contracts and link forms. Every story is affected except Story 1.9. |
| Epic 2 | The goal now uses the PRD terms Enforced Collection, Invalid-Policy Collection, and Validation Attempt, and covers aborted attempts. The implementation notes add classification, AD-20, the COMMIT probe, callback buffering, the distinct HTML task, and per-attempt media. All seven stories are affected. |
| Epic 3 | Primary requirements extend to AD-20. The implementation notes add the D-9 derivations. All four stories are affected. |

The structure stays at three epics and 21 stories: 10, 7, and 4. Story order and the dependency chain are unchanged. No story was added, removed, merged, or renumbered. Three story titles were widened to match their new scope:

- 2.1: "Classify Enforced Writes and Decide from Post-Operation Policy";
- 2.5: "...Through a Distinct Trusted Worker Task"; and
- 3.3: "...Performance, Growth, and Constant-Derivation Evidence".

### Artifact Conflicts

- **PRD, addendum, spine, SPEC, README, AGENTS:** not edited. The epics now conform to them.
- **RI-5:** stays open. The README "Required tests" omits the AD-18 layers. The README link wording implies three reports where AD-2 collapses them into one. The AGENTS stamp and acceptance-criteria pointer are stale. These are lower-authority wording gaps and do not block Gate 1. Fixing them needs a separately authorized companion edit.
- **Memlogs:** not edited. This proposal and the `epics.md` frontmatter (`replanned`, `replanInputs`, `changeRecord`) record the replan.

### Technical Impact

None. No code, test, migration, image, configuration, or deployment exists or changes. A sprint-planning run later generates `sprint-status.yaml` from the replanned epics.

## 3. Recommended Approach

**Direct Adjustment.** Every change is an amendment to existing story criteria within the approved structure. No rollback is needed, because nothing is implemented, and the MVP scope is unchanged.

- **Effort:** documentation only. The cost is the review rounds recorded below.
- **Risk:** low for scope, and medium for story size. Stories 2.1, 2.3, and 2.5 now carry dense criteria. AD-8, AD-20, and AD-7 put most of the reviewer findings in these areas. Splitting them would break the requested structure, so the density is accepted. The create-story step may break these stories into tasks.
- **Timeline:** no effect on the delivery order. Gate 1 stays `not ready` until implementation evidence exists.

Alternatives considered:

- **Patch only the conflicting criteria.** Rejected. The companion review (`review-reconcile-companions.md`) advised against piecemeal patching, and the AD summaries and coverage map were stale everywhere.
- **Regenerate with `bmad-create-epics-and-stories`.** Rejected. It would discard the reviewed structure and criteria that are still valid.

## 4. Detailed Change Proposals

The full pre-replan text is `git show HEAD:_bmad-output/planning-artifacts/epics.md`. The applied text is the working-tree `epics.md`. Below, each change is summarized as old to new with its driver. "Spine" means a rule that already binds. "Alignment", "RI-4/6", and "RI-1/3" mean the three applied amendment proposals.

### 4.1 Document-level changes

| Section | Old → New | Driver |
| --- | --- | --- |
| Frontmatter, Overview | No replan record → `replanInputs`, `replanned`, `changeRecord`, and a Replan status paragraph (no open PRD and spine conflict; D-9 placement; Gate 1 `not ready`) | operator request |
| FR summaries | Pre-amendment FR-1, FR-4, FR-7, FR-11 to FR-17, FR-19 to FR-22 → current PRD wording (System Failure states, sentinels, actor-readable scope, three FR-16 exceptions, admitted-means-committed with the unestablished-commit carve-out, aborts, RI-1 policy fields, sentinel audit fields, actor-independent write audit, FR-22 exception) | alignment, RI-1/3, RI-4/6 |
| NFR summaries | NFR-9, NFR-11, NFR-15, NFR-27 → abort atomicity, NFR-11 policy-class exception, evidence gap, FR-22 exception | alignment, RI-4/6, RI-1/3 |
| CAP lines | CAP-4, CAP-5, CAP-6 → SPEC wording (Enforced Collections; per-invocation and per-attempt summaries; FR-22 exception) | SPEC |
| Additional requirements | No D-9 or D-4 to D-8 bullets → D-9 placement bullet; D-4 to D-8 exclusion bullet | spine Deferred |
| AD inventory | AD-1 to AD-19 summaries from 2026-09-21 → refreshed AD-1 to AD-19 summaries and a new AD-20 | spine Amendment Record |
| SM and Gate lines | No exceptions → SM-I4 and SM-P5 policy class; SM-I6 per lint invocation that returns a result and per established Validation Attempt; SM-I6 and SM-C7 FR-22 exception; Gate 1 includes the fixed D-9 items | alignment (A-25), RI-4/6, spine |
| FR Coverage Map | Old applicability → sentinel, link-function, classification, exception, and audit coverage per epic | alignment |
| Epic List | Old goals and notes → updated Epic 1, 2, and 3 goals, notes, and Epic 3 AD range | alignment, spine |

### 4.2 Epic 1 stories

| Story | Old → New | Driver |
| --- | --- | --- |
| 1.1 | Generic AD-12 types and AD-3 codes → exact `Finding`, `SystemFailure`, `PolicyIdentity` union, `EvaluatedScope`, and `reason` field; registry surfaces and check membership; startup-only `POLICY_CONFIGURATION_MALFORMED` and `POLICY_SCHEMA_VERSION_UNSUPPORTED`; `collection_conflict`; full AD-4 sort (rank, path comparison, server-derived collection key); `failed` may carry Findings; one position-producing component over `toMarkdown(document, { includeTitle: false })` with `linkify: false` | spine (AD-3, AD-4, AD-11, AD-12), RI-1/3 |
| 1.2 | Canonical `invalidFingerprint`; any duplicate fails startup; readiness gating → source-byte `invalidFingerprint`; custom raw-byte decoder with byte spans; root-level versus nested defects; lowercase canonical keys; 64 KiB; startup-fatal code and byte-position diagnostic; master-distributed bytes and respawn; per-sentinel operator logs; empty-set fingerprint; readiness gating moved to Story 3.1 | spine (C-4, AD-5, AD-6, AD-19), RI-1/3 (RI-2) |
| 1.3 | Not evaluated for any document "outside every Configured Collection"; sentinel without location; "protocol error" → **D-9 input schema**; drafts and archived included; `SET TRANSACTION READ ONLY`; 9 s deadline; AD-10 snapshot-failure codes with the floor provisional; one System Failure per (unit, code); identity gated by collection read; not evaluated only for `null` or no-entry collections, with `reason`; sentinel at `scope { collection }`, the generic document-scope failure for document-only readers, and the readability-unestablished case, all `failed`; Tool-Execution Errors for denials, with the SDK input-schema result asserted as `isError` and escalated if it is a JSON-RPC error | alignment (C-3, C-6), spine |
| 1.4 | Generic "supported UUID or URL-identifier links" → **D-9 one shared link-extraction function, also used by the global-index check, with recognized forms L1 to L11 fixed by fixtures**: WHATWG parse against the instance origin with the baseline `hostname` and `port` comparison, `isUUID` before `SLUG_URL_REGEX`, lowercased UUID keys, `/d/` recognized, `]`-label and `@`-prefixed fixtures; `evaluatedLinkCount` counts references; 500-key batches; enforcement-transaction resolution for writes | spine (AD-1, AD-3, D-9) |
| 1.5 | Default scope "Configured Collections only"; no sentinel criterion → **D-9 input schema**; `read` authorization and the resolved `collection.id` as the policy key; an admin-without-membership fixture; readable sentinels in scoped and default scope; new sentinel criterion (zero-count entry, no completed unit, no snapshot, never clean, unreadable contributes nothing, readability-unestablished case); `lint_wiki` document set; `SET TRANSACTION READ ONLY`; `SET LOCAL` per batch with the floor; sentinels retained on snapshot failure; not evaluated only without a valid policy or sentinel | alignment (C-3), spine (AD-9, AD-11, AD-12) |
| 1.6 | Parent unresolved "within its authorized scope" → resolved for the actor; a readable cross-collection parent is `PARENT_COLLECTION_MISMATCH`; drafts and archived excluded; check-failure location; global-index direct links through the Story 1.4 function, with L-form fixtures; new vacuous-completion criterion | spine (AD-3, AD-9, AD-11) |
| 1.7 | Limit excess keeps completed units; no stop margin; transport timeout as a precondition → `/mcp` socket-timeout override without changing `REQUEST_TIMEOUT`, with a 10 s fixture; 63 s sum; **stop margin as a provisional code-owned constant fixed in 3.3**; unit buffering and partial-unit Findings; failure locations; limit excess is `failed` with no Findings (corrected to AD-11); admission after the scoped collection's authorization and before enumeration and the snapshot, with pinned rejection results; new criterion retaining readable sentinels on timeout, snapshot failure, and limit excess; 1 MiB cap recorded as D-9; `completedChecks` listing rule | spine (AD-11, AD-16, D-9) |
| 1.8 | Summary for every invocation; policy fields unconditional → no summary for Tool-Execution Errors; outcome mapping; RI-1 policy-field rule; `durationMs`; Event row population; 3 s bound with `SET LOCAL`; enqueue suppression with IP normalization kept; new constant outside `AUDIT_EVENTS` and `ACTIVITY_EVENTS`; name intersection; `"*"` webhook non-delivery; concurrent migration | alignment (A-18), RI-1/3 (RI-1), spine (AD-14, AD-15) |
| 1.9 | Unchanged | — |
| 1.10 | Discovery without contracts; protocol terminology → **D-9 registration: the `documents.info` gate for `lint_document`; the `documents.list`, `collections.list`, and `collections.documents` gate for `lint_wiki`; annotations `{ readOnlyHint: true, idempotentHint: true }`; the result as the first content block**; expected discovery outcome per token scope; sentinel-matrix criterion; a configuration System Failure is an escalation outside the repair loop; NFR-11 policy class; D-9 derivations left to Epic 3 | spine (D-9, AD-18), alignment (C-3) |

### 4.3 Epic 2 stories

| Story | Old → New | Driver |
| --- | --- | --- |
| 2.1 | Lookup "uses the Projected Document's post-operation collection"; no sentinel path detail; no identity rule; "protocol behavior" → request-time classification keyed on the baseline-resolved collection; `readable` flag; pre-allocated document ID; the 2 s P0/P1 check and its row 1 outcome; classification failure (row 1, fixed message); decision inputs (within-limits flag, half-deadline flag); fail-open eligibility; **write-eligibility constants as provisional code-owned constants fixed in 3.3**; full sentinel path with the PRD fixtures; `collection_conflict` rule and ordering; identity-omission fixtures | spine (AD-8, AD-11, AD-12, AD-13, AD-20), alignment (C-5, C-6), prior amendment |
| 2.2 | Projection for every configured write; "existing input/conflict behavior"; possible re-projection → valid-enforced classification only; pre-allocated ID; content-dependent edits inside the transaction (P4); collection compared in P3; projection built once in P4 and persisted unchanged; projection failure → row 3 with `aborted_before_decision` | alignment (C-6), spine, prior amendment |
| 2.3 | Generic transaction; invalid configuration in the decision criterion; "upstream/protocol semantics" → P2 30 s bound; collection-first lock order and `FOR NO KEY UPDATE`; P3 rows; validation-deadline and persistence-budget remainders; floor rules; 55 s sum; savepointed related-state reads; P7 row 5; **COMMIT probe** with timer semantics; **RI-3 callback buffering and RI-3a**; cancellation; audit timing; real-PostgreSQL concurrency fixtures; link validation on writes (FR-6); the sentinel handled in 2.1 | alignment (C-6), RI-1/3 (RI-3), spine (AD-8, AD-11, AD-20) |
| 2.4 | Identity unconditional; patch block mandatory; "Known binding contradictions" note → identity only when readable; optional post-commit enrichments and the `{ success: true, id, validation }` fallback; mismatch and sentinel response shapes; collection-scope System Failure locations; degraded only on an established commit; Tool-Execution Error shapes for rows 2, 3, 5, 7; **note deleted** | alignment (C-5, C-6), prior amendment |
| 2.5 | Trusted worker intent with fields and a generic outcome → distinct registered task; the full intent field list, including the baseline create inputs; `templateId` ignored on the HTML path as in the baseline; requester rules (wait until `deadlineAt` except on cancellation, single probe read in a 2 s bound, `queue.add`, staged source); worker order (lookup-first, re-authorize, collection change, fingerprint); `committedFromSummary`; result union; `deadlineAt` arithmetic and 62 s sum; floor rules in the worker transaction; persist serialization and the unique-violation path; summary replacement; FR-22 exception; log restriction; full AD-18 worker fixture list; no job for sentinels | spine (AD-7, AD-11, AD-20), alignment, RI-4/6 (RI-6) |
| 2.6 | HTML media only; "deterministic later reclamation"; "never converts a rejection into success" → every enforced write with importable media, including Markdown base64 images; per-attempt final-key staging and pre-allocated Attachment IDs; row-specific cleanup ownership; requester-staged source ownership; stager refusal; retry and replay commit at most one object set, and a committed outcome supersedes an earlier rejected or aborted summary; **no sweeper (D-9 item)** | spine (AD-7, AD-14) |
| 2.7 | Four outcomes; "safe scope"; audit after commit or rejection → six outcomes; rows 1, 2, 7 record no request-path summary; `scopeKind: collection` and actor-independent columns; policy-field presence; policy-configuration and aborted payloads; `complete` semantics; correlation on every writer Event; timing before response assembly; `ON CONFLICT` replacement; FR-22 exception; write-side measures calculable by the operator; one fixture per AD-20 row | alignment (C-5, C-6), spine (C-7), RI-4/6 |

### 4.4 Epic 3 stories

| Story | Old → New | Driver |
| --- | --- | --- |
| 3.1 | Expected fingerprint optional; generic readiness exposure → the health-endpoint extension reports only readiness and the fingerprint; a supplied expected value is always compared; it is required for any valid `enforced` entry or sentinel; empty-set fingerprint; blue/green or drain-and-replace via OD-7; startup-fatal and per-sentinel diagnostic fixtures; respawn | spine (AD-19), RI-1/3 (RI-2) |
| 3.2 | Old AD-18 layer list; AD-17 to AD-19 → complete AD-18 layer list (sentinel matrix, identity omission under NFR-11, AD-20 rows, COMMIT probe, callbacks, worker, `/mcp` timeout, discovery per token scope, L1 to L11); coverage includes AD-1 to AD-20 and the D-9 contracts | spine (AD-18), RI-1/3, RI-4/6 |
| 3.3 | No constant derivation → **D-9 evidence task: write-eligibility constants, stop margin, and `SET LOCAL` floor fixed by recorded rules over retained samples, committed, dependent fixtures re-run, and Gate 1 blocked while any is provisional or fails its rule**; measured `lint_wiki` runs must complete; generator maximum link count; write samples at both maxima; exact `node --version`; topology settings in the manifest | spine (AD-11, AD-13, AD-17, D-9) |
| 3.4 | C-1/C-2 phase-blocking criterion; AD-1 to AD-19 → AD-1 to AD-20 index; the D-9 items as the only phase-blocking planning items; accepted residuals and non-blocking items with owners (RI-3a, the NFR-11 and FR-22 exceptions, RI-5, the D-9 sweeper and cap, the D-8 gaps, the convert-only worker option); row 7 evidence gap | alignment, RI-4/6, RI-1/3 |

### 4.5 Contract choices fixed in stories (D-9), open to operator veto

The spine assigns these choices to the stories ("Tool contracts and link-form fixtures are fixed by stories before Gate 1"). Each one rests on baseline `v1.10.1` code:

- `server/tools/documents.ts` and `server/tools/fetch.ts` for registration, annotations, and `canAccess` gating;
- `shared/helpers/AuthenticationHelper.ts` for the scope semantics;
- `shared/utils/parseDocumentSlug.ts`, `shared/utils/urls.ts`, `UrlHelper.SLUG_URL_REGEX`, `Document.findByPk`, and `Collection.findByPk` for identifier forms;
- `app/routes/authenticated.tsx` for the `/d/` redirect route; and
- `shared/editor/nodes/Mention.tsx` for document mentions, which serialize to `/doc/<id>`.

| Contract | Fixed value | Basis and alternatives |
| --- | --- | --- |
| `lint_document` input | Exactly `{ id: string }`, required, with the forms `Document.findByPk` resolves; no execution-control field; an undeclared argument has no effect | Mirrors `update_document`. Full-URL input as in `fetch` was not adopted, to keep one form. |
| `lint_wiki` input | Exactly `{ collectionId?: string }` via `optionalString()`, where `""` means omitted and therefore default scope; policy, identity, and scope use the resolved `collection.id` | Baseline convention for optional IDs. `Collection.findByPk` also accepts uppercase UUIDs and URL identifiers, so the configuration key must come from the resolved row. |
| Annotations | `{ readOnlyHint: true, idempotentHint: true }`, as on the baseline read tools | The audit summary is not treated as an environment change, as with `list_documents`, which records search queries. |
| Gating | `lint_document`: `canAccess("documents.info")`. `lint_wiki`: `canAccess("documents.list")`, `canAccess("collections.list")`, and `canAccess("collections.documents")` | Least authority. `lint_wiki` exposes collection-structure facts, and its default scope enumerates readable collections. Expected outcomes per scope set are listed in Story 1.10. |
| Output | The AD-12 object as the JSON of the first text content block, without `isError` | Matches the AD-12 write convention and the baseline `success()` helper. |
| Invalid input | Baseline SDK behavior, which a fixture asserts is an `isError` result against SDK `1.29.0`; denials and missing targets are Tool-Execution Errors | AD-12 reserves `isError` for invalid calls. Baseline tests accept either shape for schema failures, so a JSON-RPC error would be escalated to the architect as blocking rather than accepted. |
| Link forms | L1 to L7 recognized (including the `/d/` redirect path); L8 to L11 not recognized (table in Story 1.4). The WHATWG URL parse runs against the instance origin and compares `hostname` and `port` strings, ignoring scheme and userinfo as the baseline does. `isUUID` is tested before `SLUG_URL_REGEX`, and UUID keys are lowercased. | Narrowings of the baseline helpers, chosen to avoid false `INTERNAL_LINK_TARGET_UNRESOLVED` Errors: another host or port, or a trailing-dot hostname, which the baseline strips (L8); a protocol-relative, `/\`, or relative path (L9), although `isInternalUrl` treats any leading `/` as internal; and a share path or other first segment (L10), although `parseDocumentSlug` accepts `doc` at any segment and ignores the host. The instance origin is passed into the core (AD-1). `SLUG_URL_REGEX` also matches a UUID's last group, hence the precedence. |
| `evaluatedLinkCount` | Counts recognized references, not unique targets | Consistent with AD-16's "internal-link references" and AD-17's links per document. |
| D-9 derivations (Story 3.3) | Each eligibility constant equals the largest measured value among retained enforced-write samples that completed without `VALIDATION_TIMEOUT`. The stop margin is ≥ the largest unit time plus result-assembly time, while every measured `lint_wiki` run still completes. The floor is ≥ the largest single-statement time under `SET LOCAL` and below the smallest budget it guards. Each value is recorded with its rule and re-tested. | These rules make AD-13 "sized from measured maxima" and AD-11 "chosen from the measured maximum unit time" checkable without choosing any number. The floor rule is a story-level reading of "fixed from AD-17 evidence". |

### 4.6 Other choices and observations

- **Readiness gating moved from Story 1.2 to Story 3.1.** This removes the double ownership. Story 1.2 keeps the loader, sentinels, fingerprints, and startup logs.
- **Story 2.6 widened to Markdown base64 images.** `documentUpdater` imports base64 images as attachments, and AD-7 applies the media protocol to every enforced write.
- **Story 1.7 limit-excess semantics corrected to AD-11.** A limit excess is detected at admission or snapshot construction and returns `failed` with no Findings.
- **Below-floor snapshot stop follows AD-10 literally** (Stories 1.3 and 1.5). AD-10 returns `VALIDATION_TIMEOUT` only when the deadline expired during construction and `VALIDATION_RUNTIME_FAILED` for every other inability to establish the snapshot. A below-floor remainder before expiry is therefore `VALIDATION_RUNTIME_FAILED`, while AD-11 maps the same condition in write phase P5 to `VALIDATION_TIMEOUT`. The stories do not change a code's meaning (NFR-23). Harmonizing the two surfaces is an architecture decision, reported under Handoff.
- **Admission order pinned** (Story 1.7). A collection-scoped request first completes its top-level lookup and `read` authorization, so a denial stays a Tool-Execution Error. A sentinel or unconfigured requested collection returns without admission. Admission then precedes default-scope enumeration, sentinel readability checks, and the snapshot. The rejection results are pinned for both scope kinds. The spine does not order these steps, and AD-16's "at most one concurrent `lint_wiki` per server process" is read as governing scans, which a sentinel or unconfigured scoped request never starts.
- **Benchmark datasets exclude System-Failure classes** (Story 3.3). AD-17's "every rule/resolution class" is read as every rule class and every link-resolution class. The benchmark actor and policy produce no System Failure, so every measured run can be `complete` as NFR-3 and NFR-4 require. Story 3.2 keeps the System-Failure classes in its conformance fixtures.
- **HTML requester wait narrowed.** The requester stops early only on cancellation or disconnect (Story 2.5). The AD-20 text allows stopping "at any time", and AD-7 bounds the wait by `deadlineAt`.
- **Observation, not a contradiction: an admin can read a private collection without membership.** `can(actor, "read", collection)` is true, but `readDocument` is false, so the admin can read none of its documents. Under AD-9 and AD-12, the collection is still admitted with zero evaluated documents. Story 1.5 pins this with a fixture, and the result is clean only under the AD-12 algebra. Revisiting this needs an architecture decision, so it is reported here rather than changed in a story.

## 5. Implementation Handoff

**Scope classification: Moderate.** This is a backlog reorganization within the approved structure. No PRD or architecture change is needed.

| Role | Responsibility |
| --- | --- |
| Operator (Wiki operator) | Approve or revise this proposal and the Section 4.5 contract choices. Separately authorize implementation when ready. |
| Product Owner / Scrum (`bmad-sprint-planning`) | Generate `sprint-status.yaml` from the replanned epics after approval. Order stays Epic 1, then Epic 2, then Epic 3. |
| Developer (`bmad-build` / `bmad-agent-dev`) | Implement stories only under separate authorization. Treat the D-9 constants as provisional until Story 3.3 fixes them. |
| Architect | Review the three §4.6 items: whether to harmonize the below-floor snapshot code with write phase P5, the admin-without-membership admission, and the `lint_wiki` admission order. Story 3.4 records them with the Architect as owner, to be revisited before Stories 1.3, 1.5, and 1.7 are implemented. None blocks the replan, because the stories follow the current spine text or fill a gap the spine leaves open. Raise any contradiction found later as blocking rather than resolving it in a story. |

**Success criteria for the handoff:**

- every story traces to the final contracts;
- coverage validation passes;
- no superseded blocker remains;
- Gate 1 is assessed only from implementation evidence in Story 3.4; and
- no release stage is implied.

## Review Record

The reviewers worked independently in fresh contexts and were read-only. Each round used three lenses:

- **A:** contract consistency with the spine (AD-1 to AD-20);
- **B:** PRD fidelity and replan completeness against the three replan inputs; and
- **C:** adversarial review, covering edge cases, testability, and baseline `v1.10.1` code reality (`AuthenticationHelper`, `urls.ts`, `parseDocumentSlug`, `SLUG_URL_REGEX`, `Mention.toMarkdown`, `Document.findByPk`, `Collection.findByPk`, policies, and the `/mcp` tools).

"Material" means Critical, High, or Medium.

| Round | A | B | C | Disposition |
| --- | --- | --- | --- | --- |
| 1 | 2 High, 5 Medium, 6 Low | 4 Medium, 6 Low | 1 High, 10 Medium, 7 Low | All fixed, except one recorded as an observation (the admin-without-membership admission). |
| 2 (confirmation) | 13/13 resolved; 1 new Medium, 3 Low | 9/10 resolved (1 deferred to this record); 1 new Medium, 1 Low | 15/18 resolved, rest partial or deferred; 3 new Medium, 5 Low | All fixed. |
| 3 (confirmation) | All resolved; 0 material, 3 Low | All resolved; 0 material, 1 Low | All resolved; 1 new Medium, 3 Low | All fixed. |
| 4 (confirmation) | All resolved; 0 material, 1 Low | All resolved; 0 material, 1 Low | All resolved; 0 material, 1 Low | Lows applied; no material finding remains. |

**Round 1 material findings and fixes:**

- Story 2.5: the intent list was closed but omitted the baseline create inputs (A1, C M-8). Fixed: full field list.
- Story 2.6 AC6: idempotency text contradicted summary replacement and per-attempt blobs (A2, C M-9). Fixed.
- Story 2.3 AC3: the P7 remainder should come from the persistence budget (A3). Fixed.
- Story 1.7: unit buffering dropped Findings from partial units (A4). Fixed.
- Below-floor snapshot code (A5). Settled in round 2.
- Story 3.1: health endpoint exposure (A6). Fixed.
- The global-index check did not use the shared link function (A7, B L4). Fixed.
- Proposal evidence sections were forward references (B M1, C L-7). Completed here.
- SM-I6 qualifiers (B M2). Fixed.
- Sentinel retention on run-wide failures (B M3, C M-5). Fixed: Story 1.5 AC11 and Story 1.7 AC8.
- FR-13 and FR-16 summaries (B M4). Fixed.
- D-9 constants had no pass/fail rule (C H-1). Fixed: recorded rules.
- UUID precedence and case (C M-1). Fixed.
- `/d/` route and narrowings (C M-2). Fixed: L7.
- "Readable collection" (C M-3). Recorded as an observation and pinned by fixture.
- Policy key from the resolved row (C M-4). Fixed.
- Requester early stop and tail bound (C M-6, M-7). Fixed.
- P0/P1 bound outcome (C M-10). Fixed.

**Round 2 material findings and fixes:**

- Admission order: a collection-scoped denial must stay a Tool-Execution Error (A N1, C N-1). Fixed: Story 1.7 AC7.
- The below-floor code changed AD-10's code meaning in a story (B N1). Fixed: the stories follow AD-10 literally, and harmonization goes to the architect.
- The stop margin had no upper bound (C N-2). Fixed: measured runs must complete.
- The eligibility constants allowed 0 (C N-3). Fixed: each equals the measured maximum.

The Low findings were applied: link-origin comparison, the `@`-prefixed fixture, the SDK `isError` escalation, the single-statement floor measure, the handoff row, outcome-reporting wording, partial-unit Findings, and collection-scoped fixtures.

**Round 3 material finding and fixes:**

- Story 3.3 AC1 and AC5 could not both hold, because a dataset covering System-Failure classes can never be `complete` (C R3-1; also raised as Low by A and B). Fixed: the timed datasets exclude System-Failure classes, and Story 3.2 keeps them.
- Low findings applied:
  - the architect items in Story 3.4 AC5 (A R1);
  - the admission-as-scan reading (A R2);
  - the rejected scoped-run location, audit column, and lookup failure (C L3-1);
  - the admission order on the architect list (C L3-2);
  - the Gate 1 wording pending approval (C L3-3); and
  - "rule" instead of "inequality" (B).

**Round 4 Low findings applied:**

- the parent-resolution classes added to the Story 3.3 AC1 datasets (A);
- the remaining "inequality" wording in §4.5 (B); and
- a precondition in the Epic 1 implementation notes that the architect review the Story 3.4 items before Stories 1.3, 1.5, and 1.7 are implemented (C).

Round 4 left no Critical, High, or Medium finding in any lens, so the review stopped there.

## Coverage Validation

Validation was run on the final `epics.md` by script (ID coverage over each story's Traceability block, with ranges expanded) and by reviewer B (semantic coverage).

| Set | Covered by at least one story | Result |
| --- | --- | --- |
| CAP-1 to CAP-6 | 6/6 | pass |
| FR-1 to FR-23 | 23/23 | pass |
| NFR-1 to NFR-27 | 27/27 | pass |
| SM-I1 to SM-I7, SM-P1 to SM-P7, SM-C1 to SM-C7 | 21/21 (SM-P as Gate 4 support only, no pilot claim) | pass |
| Gate 1 to Gate 4 | 4/4 (Gates 2 to 4 as prerequisites and non-authorization only) | pass |
| AD-1 to AD-20 | 20/20 | pass |
| Structure | 3 epics; 21 stories (10/7/4); every story's criteria numbered consecutively | pass |
| Superseded text | 0 occurrences of "Known binding contradictions", "C-1/C-2", "AD-1–AD-19", "AD-17–AD-19", "PRD alignment pending", or "protocol `isError`". The single "protocol error" is "never a JSON-RPC protocol error". | pass |
| Replan inputs | Every row of the alignment table and every Effect bullet of RI-4/6 and RI-1/3 is addressed (reviewer B, rounds 1 and 2) | pass |
| PRD capability criteria (Sections 4.1 to 4.6, including the destination table, Invalid-Policy fixtures, classification and abort fixtures, and audit scenarios) | Each is mapped to at least one story criterion (reviewer B) | pass |

## Verification

SHA-256 hashes of the binding and protected sources were taken before any edit and re-checked after the last edit. All are unchanged:

| File | SHA-256 |
| --- | --- |
| `prds/prd-outline-2026-09-20/prd.md` | `0a5dc66c26f6adbda75b257ddd00e9b34f7f4e9c4d9e098ba57d8c368946db02` |
| `prds/prd-outline-2026-09-20/addendum.md` | `5b8fd7e0f205aced13aa1aeeeea00cbaa796d963f9ebef8e9b5b6452ffaffa5c` |
| `architecture/.../ARCHITECTURE-SPINE.md` | `20bca06773e37beab8359954605f9cca3c937634e4f3913709b67df4f0b95eb0` |
| `specs/.../SPEC.md` | `70f7da8ae70f5135a3cb90ffa94f839128b68d2468ca5466b002fd2f928fe04f` |
| `server/tools/README.md` | `bc5a64a0de7557fd10874cadc58db20c9ee734e219e892ee335b751d9cbe6a18` |
| `AGENTS.md` | `7a7bd4bce4f3377820b2ad80034a1e0aafd0b496a46afc68a3a77c5d6b28e0e8` |

`git status` shows only `epics.md` modified and this proposal added. Nothing is committed.

## Gate 1

`not ready`. No implementation evidence exists: SM-I1 to SM-I7 cannot pass before implementation, and the Story 3.3 D-9 constants are evidence tasks. With the operator's approval on 2026-10-02, the planning blockers named in the spine are cleared: no PRD and spine conflict is open, and the D-9 tool contracts and link forms are fixed in stories. Gates 2 to 4 are unaffected and not authorized.
