# Reconciliation Review: 2026-10-02 Spine Amendment Against PRD, Addendum, SPEC, Epics, and Sprint Change Proposal

**Reviewer:** independent, fresh context. Read-only on the project except for this file.
**Inputs read:** the uncommitted diff of `ARCHITECTURE-SPINE.md` (434 lines, `updated: '2026-10-02'`) and the last five `.memlog.md` entries; `prd.md` (status final, updated 2026-10-01); `addendum.md`; `SPEC.md`; `epics.md` (HEAD `d01f67066`, replanned 2026-10-01); and `sprint-change-proposal-2026-10-01.md` §4.5, §4.6, §5, and Gate 1.
**Baseline spot check:** `server/policies/collection.ts:34` (`read` is true for any same-team admin) and `:66-80` (`readDocument` requires membership on a private collection or for a guest), and `server/routes/api/collections/collections.ts:179` (`authorize(user, "readDocument", collection)` before `documentStructure`). The memlog's factual basis for decision 2 holds on the checked-out tree, whose merge base is `4a5a616a2`.
**Repository state:** branch `feature/mcp-wiki-linting-v1.10.1`, 4 ahead of and 0 behind `origin` after `git fetch --prune`. Only the spine and `.memlog.md` are modified.
**Authority order applied:** PRD > addendum > spine > SPEC. A contradiction with the PRD or addendum is blocking. Nothing was resolved or edited.

## Verdict

**Blocked on one narrow item.** Decisions 1 and 2 contradict no PRD or addendum text. Decision 3, the AD-16 admission order, literally contradicts the FR-12 "readability cannot be established" clause in one sub-case: a collection-scoped `lint_wiki` naming an invalid-policy collection whose lookup fails (C-1). The fix is one clause or one operator ruling. One further PRD tension is not a contradiction: under contention, a default-scope request that would be `not_evaluated` returns `failed` (M-1).

`SPEC.md` has no statement that the amendment makes stale. `epics.md` is stale in nine acceptance criteria across Stories 1.3, 1.5, 1.6, 3.2, and 3.4. Story 1.7 is not one of them. The spine's D-9 row describes §4.5 accurately. The Open PRD residuals paragraph describes §4.6 and §5 accurately, but it names the wrong set of stories that need a follow-up edit (M-4).

Severity scale:

- **Critical:** contradicts PRD or addendum text, so it blocks.
- **High:** a downstream acceptance criterion directly contradicts the amended spine.
- **Medium:** a seam, an inaccuracy, or a governance gap that needs a decision.
- **Low:** wording, terminology, or an omission that does not change behavior.

## (a) PRD and addendum consistency per decision

| Decision | PRD/addendum clauses checked | Result |
| --- | --- | --- |
| 1. Below-floor snapshot batch → `VALIDATION_TIMEOUT` (spine L85, L163, L169) | §5.1 L458 ("an actual timeout, interruption, or incomplete evaluation is a System Failure"); FR-1 L98-100; FR-10 L206-214; NFR-23 L505; OD-1 L675; FR-19 L397-404; FR-13 and AD-13 eligibility (writes only) | **No contradiction.** The PRD names no code for this condition, and both codes are non-clean System Failures. Widening the AD-3 meaning is not a material change under NFR-23 because AD-11 already used `VALIDATION_TIMEOUT` for a below-floor remainder in write phase P5 before this amendment. The AD-3 row now states that existing meaning (see L-2). Read surfaces have no fail-open, so AD-13 eligibility is untouched. |
| 2. Structure-derived checks require `readDocument` (spine L157, L175) | FR-7 L182-185 (clean applies only to the reported authorized scope); FR-8 L189; FR-9 L198-204; FR-10 CAP L221; FR-11 L236 (actor-readable scope); NFR-6 L475; NFR-10 L482; NFR-11 L483; SM-P2 L529; SM-C1 L538 | **No contradiction.** The decision aligns the spine with NFR-10, because the baseline exposes `documentStructure` only under `readDocument`. A generic System Failure prevents a false clean (FR-1, NFR-6). AD-3 already defines `VALIDATION_RUNTIME_FAILED` to include "a check could not be proven under the actor's authorization", so no new meaning is introduced. A clean result over documents readable through membership, with only document rules enabled, matches FR-7 and FR-11. Medium consequences are listed under M-3 and M-5. |
| 3. `lint_wiki` admission order (spine L285-292) | FR-7 L182; FR-11 L236; FR-12 L248; FR-12/FR-23 CAP L278; FR-19 L397-404; AD-11 L169 (last sentence) | **One contradiction (C-1)** and **one tension (M-1)**. Steps 1 (denial or missing collection is a Tool-Execution Error with no summary) and 2 (a sentinel or unconfigured scoped collection returns without admission) agree with FR-7, FR-12, and FR-19. |

## Critical

### C-1. A failed lookup of a scoped collection is a Tool-Execution Error, but PRD FR-12 requires a generic runtime System Failure

- **Spine L287:** "A denied or missing collection, **or a failure of that lookup**, is a tool-execution error with no summary."
- **PRD FR-12 L248:** "A read-only operation whose actor-readable scope (FR-11) contains an Invalid-Policy Collection reports it as this System Failure, **or as a generic runtime System Failure when the collection's readability cannot be established**, and never as not evaluated."
  - FR-11 L236 defines the `lint_wiki` actor-readable scope as "the requested collection when the actor can read it".
  - The source author default, `amendment-proposal-prd-spine-alignment.md` L498, says without restriction: "When a sentinel collection's readability cannot be established, the read result carries a generic runtime System Failure."
- **Conflict:** suppose a scoped `lint_wiki` names a collection that is an identifiable invalid-policy sentinel, and its lookup or `can(read)` check fails, so readability cannot be established. The PRD then requires a modeled generic System Failure, which under FR-19 also gets an audit summary. The spine instead returns `isError` with no summary.
- **Internal spine tension:** the last sentence of AD-11 (L169) keeps the modeled path: "if readability cannot be established, the run adds only the generic snapshot `VALIDATION_RUNTIME_FAILED`". The scoped case now falls under AD-16 step 1 instead.
- **Why the spine chose this:** the memlog says the order prevents "echoing an unconfirmed collectionId in a modeled result". AD-12 L175 also requires `collectionId` in `EvaluatedScope { kind: "collection" }`, so the current algebra cannot model this case without the echo.
- **Counter-reading:** FR-12's clause could apply only after the top-level target is resolved. Under that reading, the PRD's purpose (never `not_evaluated`, never clean, no disclosure) is still met by `isError`. However, the PRD text does not state that narrowing, and the PRD controls.
- **Scope:** narrow. It needs an infrastructure failure on the collection lookup of a scoped request whose target is in fact a sentinel. Story 1.7 AC7 (`epics.md` L694) already pinned the same behavior, and the sprint change proposal did not flag it.
- **Fix, one of:**
  - **(a) Operator ruling, recorded as a PRD clarification.** FR-12's readability-unestablished clause applies once the requested top-level target is resolved. A failure of the top-level lookup itself is a Tool-Execution Error under FR-19. This is the cheapest fix and keeps the spine as it is.
  - **(b) Spine change.** In AD-16 step 1, only denial or absence is `isError`. A lookup failure returns `state: failed` with the generic `VALIDATION_RUNTIME_FAILED` located `scope { scopeKind: "collection" }` without `collectionId`. This also requires AD-12 to make `collectionId` optional in a collection `EvaluatedScope` for this case, and it records a summary.

  Either way, the Open PRD residuals sentence "No PRD conflict remains open" (L434) stays inaccurate until this is settled.

## High: epics acceptance criteria that contradict the amended spine

Each item quotes the current AC and gives replacement wording.

### H-1. Story 1.3 AC3 (`epics.md` L361-364): below-floor code

> **Then** snapshot construction fails as AD-10 requires: `VALIDATION_TIMEOUT` when the deadline expired during construction, and `VALIDATION_RUNTIME_FAILED` for every other failure to establish the snapshot, including a below-floor remainder before the deadline expires

**Replace with:** "**Then** snapshot construction fails as AD-10 requires: `VALIDATION_TIMEOUT` when the deadline expired during construction or a snapshot batch was refused because the remainder was below the code-owned `SET LOCAL` floor (AD-11), and `VALIDATION_RUNTIME_FAILED` for every other failure to establish the snapshot". Keep the "**And** the floor is one named code-owned constant…" line.

### H-2. Story 1.5 AC11 (`epics.md` L559-562): below-floor code

> …and `VALIDATION_RUNTIME_FAILED`, or `VALIDATION_TIMEOUT` when the AD-11 deadline expired during construction (a below-floor remainder before expiry is `VALIDATION_RUNTIME_FAILED`), located…

**Replace the parenthetical clause with:** "…or `VALIDATION_TIMEOUT` when the AD-11 deadline expired during construction or a construction batch was refused because the remainder was below the AD-11 floor, located…". AC8 (L547) refers to criterion 11 and is correct once AC11 is fixed.

### H-3. Story 1.5 AC6 (`epics.md` L534-537): unconditional structure read

> **Then** scope, authoritative document content/state, canonical Markdown serialization, authoritative hierarchy, extracted links, and authorized target resolutions are read… **And** uncached `Collection.documentStructure` is used as hierarchy authority…

This contradicts AD-9 L157, "Without it the adapter reads no structure or hierarchy input for that collection". **Replace the And clause with:** "**And** uncached `Collection.documentStructure` is used as hierarchy authority only for a collection where `can(actor, "readDocument", collection)` holds; for any other evaluated collection the adapter reads no structure or hierarchy input, and its required hierarchy and global-index checks yield the generic `VALIDATION_RUNTIME_FAILED` located `scope { scopeKind: "collection", collectionId }` (AD-9), while asynchronously refreshed `Document.text` is never snapshot authority."

### H-4. Story 1.5 AC3 (`epics.md` L519-522): admin-without-membership fixture

> …a fixture pins the case of an admin who can read a private collection without membership: the collection is admitted with only the documents the actor can read, so its counts may be zero, and it is clean only when every required check completes under the AD-12 algebra.

This is not strictly false, but it implies the hierarchy and global-index checks can complete for this actor, and "admitted" collides with the AD-16 slot. **Replace with:** "…a fixture pins the case of an admin who can read a private collection without membership (`read` without `readDocument`): the collection is included with only the documents the actor can read, so its counts may be zero; no `documentStructure` or hierarchy input is read for it; each required hierarchy or global-index check yields the generic `VALIDATION_RUNTIME_FAILED` at `scope { scopeKind: "collection", collectionId }`; and the result can be clean only when no structure-derived rule is enabled (AD-9). A second fixture adds a document readable through document membership and proves it is evaluated."

### H-5. Story 1.6 AC1 (`epics.md` L590-593), plus a missing criterion

> **Then** they operate only on actor-authorized graph nodes, edges, publication state, collection identity, and authoritative collection structure

There is no `readDocument` gate. Without it, an implementation that follows 1.6 could run `PUBLISHED_DOCUMENT_MISSING_FROM_STRUCTURE` against an empty structure and emit a false Error, which is exactly what AD-9 prevents.

- **Replace the Then clause with:** "**Then** they run only for a collection where `can(actor, "readDocument", collection)` holds, and operate only on actor-authorized graph nodes, edges, publication state, collection identity, and authoritative collection structure".
- **Add a criterion after AC7:** "**Given** an evaluated collection the actor can `read` but not `readDocument` **When** its required hierarchy or global-index check is scheduled **Then** no structure or hierarchy input is read and no hierarchy or global-index Finding is emitted for it **And** each required check yields one generic `VALIDATION_RUNTIME_FAILED` located `scope { scopeKind: "collection", collectionId }`, so the result is incomplete or failed and non-clean (AD-9, AD-12)."
- **Extend AC11's fixture list** with "collections without `readDocument`".

### H-6. Story 3.4 AC5 (`epics.md` L1599-1602): the three items recorded as open

> …and three architect review items owned by the Architect and revisited before Stories 1.3, 1.5, and 1.7 are implemented (the below-floor snapshot code on the read surface versus write phase P5, the admission of a collection that an admin can read without membership, and the `lint_wiki` admission order), none of which is decided or implemented here.

**Replace that clause with:** "…and the three architect items of `sprint-change-proposal-2026-10-01.md` §4.6, decided in the spine amendment of 2026-10-02 (a below-floor snapshot batch is `VALIDATION_TIMEOUT` on every read surface; structure-derived checks require `readDocument`; the AD-16 admission order) and implemented and evidenced in Stories 1.3, 1.5, 1.6, and 1.7, with the recorded residual that an actor with `read` but without `readDocument` may receive a clean result over the documents it can read when only document rules are enabled."

### H-7. Story 3.2 AC1 (`epics.md` L1467-1470): incomplete AD-18 enumeration

The AC claims "it executes every AD-18 layer:" and then gives a closed list, which now omits three AD-18 fixtures (spine L304). **Replace** "the AD-16 limits and admission;" **with:** "the AD-16 limits, admission, and admission order (a denied or missing scoped collection while the slot is held, sentinel and unconfigured scoped requests without admission, and slot release on every terminal path); a snapshot batch refused below the floor returning `VALIDATION_TIMEOUT` on both `lint_wiki` and `lint_document`; structure-derived checks for an actor with collection `read` but without `readDocument`, with and without a document readable through document membership, proving that no structure is read;".

## Medium

### M-1. Default-scope `not_evaluated` becomes load-dependent (FR-11 tension; Story 1.5 AC12)

- **Spine L289:** "Admission then precedes default-scope enumeration".
- **The tension:** a default-scope request whose actor-readable scope holds no valid policy or sentinel returns `state: failed` with `VALIDATION_RESOURCE_LIMIT_EXCEEDED` whenever another scan holds the slot. PRD FR-11 (L236) and FR-1 (L101) say such a request returns `not_evaluated`.
- **Why this is not a contradiction:** FR-1 L100 and §5.1 L458 allow a resource System Failure to make any read result `failed`, and the outcome is non-clean and non-disclosing.
- **Remaining gaps:**
  - The memlog claims the order "prevents a load-dependent denial contract", but it creates a load-dependent `not_evaluated`/`failed` split.
  - Story 1.5 AC12 (`epics.md` L564-567) still says the default request "returns the explicit not-evaluated state … without scanning", unconditionally.
- **Fix options:**
  - When the startup policy set is empty, which is an actor-independent fact, return `not_evaluated` without admission.
  - Otherwise, amend AC12 to: "…or, for a default request, after admission (Story 1.7 AC7), a default request whose actor-readable collections include none…".
  - Either way, record the reading against FR-11 in the residuals paragraph.

### M-2. Spine frontmatter changed from `final` to `draft`, and the change is not recorded

- **Spine L8:** `status: draft`, previously `final`.
- **What is missing:** the Amendment Record row (L432) says "adopted status unchanged" and does not mention the frontmatter.
- **Why it matters:** `SPEC.md` L50 and L58, `epics.md` L26, and the sprint change proposal L12 treat the spine as the adopted binding contract. While the frontmatter says `draft`, it is ambiguous whether the 2026-10-02 rules bind.
- **Fix:** restore `final` when the operator accepts the amendment, or record the draft state and its exit condition.

### M-3. The `global_index` check is gated on `readDocument`, but it is not structure-derived

- **What AD-9 does (L157):** it groups hierarchy and global-index as "structure-derived checks".
- **Why global-index is different:** AD-3 L79 and FR-9 define the global-index check over the configured surface document's direct links and the configured index identifiers. Both resolve through membership-aware document queries, not `documentStructure`.
- **Consequence:** an actor who can read the surface and index documents through document membership could prove the check, yet gets a permanent System Failure.
- **PRD position:** this does not contradict the PRD (it is conservative and never a false clean). It is an unexplained reduction of evaluable checks that SM-C1 (L538) asks implementers to avoid.
- **Fix, one of:**
  - Gate only `hierarchy` on `readDocument`.
  - State the real rationale for gating global-index, for example uniform collection-level gating, or a surface document reachable only through structure.
  - Rename the term to "collection-level checks" in AD-9, AD-12 L175, and AD-18 L304.

### M-4. Open PRD residuals paragraph: the story list is inaccurate

- **Spine L434:** "Stories 1.3, 1.5, and 1.7 predate the 2026-10-02 amendments… They need a follow-up edit."
- **This matches §5** (L221), which names 1.3, 1.5, and 1.7 as the stories to revisit.
- **Story 1.7 does not need an edit:**
  - AC7 (L691-695) already states exactly the AD-16 order. The memlog says decision 3 "ratifies … Story 1.7 AC7".
  - No 1.7 AC states the below-floor code or the structure gate.
- **The stories that do need edits are 1.3, 1.5, 1.6, 3.2, and 3.4** (H-1 to H-7).
- **The paragraph omits three of them:**
  - Story 3.4 AC5, which §4.6/§5 says "records them with the Architect as owner".
  - Story 1.6, which owns the hierarchy and global-index checks.
  - Story 3.2, which owns the AD-18 enumeration.
- **"No PRD conflict remains open"** is inaccurate until C-1 is settled.
- **Suggested text:** "Stories 1.3, 1.5, 1.6, 3.2, and 3.4 predate the 2026-10-02 amendments (the below-floor snapshot code, structure-derived checks without `readDocument`, and the record of the three §4.6 items); Story 1.7 AC7 already states the admission order."

### M-5. A deterministic permission condition is reported as a generic runtime failure

- **Effect:** for an actor with `read` but without `readDocument`, every run with hierarchy or global-index rules is `incomplete` or `failed` with `VALIDATION_RUNTIME_FAILED`, a code agents read as possibly transient.
- **PRD position:** this is by design for non-disclosure, and the PRD allows it.
- **Remaining risks:**
  - UJ-1's re-lint loop (L54) and SM-P2 (L529) cannot close for such an actor.
  - Story 1.10 AC7 (L870-873) is satisfiable only with an actor that has `readDocument`.
- **Fix:**
  - Record a pilot prerequisite under OD-2 and OD-6: the pilot agent's actor holds membership on every private pilot collection.
  - Make the Story 1.10 AC7 actor explicit: "an authorized agent with `readDocument` on the collection".
  - Add the residual to the Story 3.4 AC5 list (see H-6 wording).

## Low

- **L-1. Two senses of "admission".** AD-9 L157 says "Collection admission and identity stay on `can(actor, "read", collection)`", while AD-16 L285-292 uses "admission" for the per-process scan slot. Story 1.5 AC3 ("admitted") and AC5 ("When scope admission runs", L530) inherit the collision. Suggest "Collection inclusion" in AD-9 and "When the scope is assembled" in Story 1.5 AC5.
- **L-2. Memlog justification for NFR-23.** The decision-1 memlog entry says "NFR-23 unaffected: code not shipped, defined before Gate 1." OD-1 (PRD L675) says "later material semantic changes require new codes", which can be read as "after OD-1 approval", so "not shipped" is the weaker argument. The stronger one, and the correct one, is that AD-11 already mapped a below-floor P5 remainder to `VALIDATION_TIMEOUT`, so the AD-3 row only states an existing meaning. Suggest recording that basis.
- **L-3. Memlog and Amendment Record differ on what decision 2 binds.** The memlog lists AD-2 and AD-11 for decision 2. Neither has a rule-text change, and the Amendment Record (L432) correctly omits them. No action is needed beyond awareness.
- **L-4. Stale epics AD inventory summaries.** `epics.md` L115 (AD-9) has no `readDocument` gate. L122 (AD-16) says "one concurrent `lint_wiki` per process" with no order. These are not ACs, but builders read them. Refresh both in the follow-up edit.
- **L-5. Story 1.10 coverage gaps, not contradictions.**
  - AC6 (L865-868), the multi-actor disclosure fixtures, should name the `read`-without-`readDocument` actor.
  - AC3 (L850-853) lists "timeout" fixtures. A below-floor snapshot case would make decision 1 visible at the tool level.
  - Story 1.10 AC1 gates `lint_wiki` on token scope `collections.documents`, which matches the per-collection `readDocument` predicate decision 2 adopts. They are consistent, with no change needed.
- **L-6. `lint_document` and the structure gate.** `lint_document` runs no `wiki`-surface check (AD-3 L64), so decision 2 does not reach it. A sentence in AD-9 saying so would close a question builders will ask.

## (b) SPEC.md staleness

No SPEC statement is made stale by the three decisions.

- SPEC L58 adopts AD-1 to AD-20 unchanged, and the amendment changes no identifier.
- CAP-3 (L32-34) still holds for an actor authorized to complete the checks; see M-5 for the pilot actor.
- The only coupling is governance: SPEC L50 and L58 call the spine "adopted", while its frontmatter now says `draft` (M-2).

## (c) Affected `epics.md` acceptance criteria

**Contradict the amended spine, so replacement is required:**

| Story | AC | Decision | Item |
| --- | --- | --- | --- |
| 1.3 | AC3 | 1 | H-1 |
| 1.5 | AC3 | 2 | H-4 |
| 1.5 | AC6 | 2 | H-3 |
| 1.5 | AC11 | 1 | H-2 |
| 1.5 | AC12 | 3 | M-1, conditional on the operator's reading |
| 1.6 | AC1, plus a new AC | 2 | H-5 |
| 3.2 | AC1 | 1, 2, 3 (AD-18) | H-7 |
| 3.4 | AC5 | 1, 2, 3 | H-6 |

**Consistent, so no change is needed:**

- Story 1.7 AC7 already matches AD-16.
- Story 1.7 AC1-AC6 and AC8-AC11, Story 1.1 (by reference to AD-3), and Stories 2.3 and 2.5 (write floor) are consistent.
- Story 1.10 has no contradiction, only the L-5 and M-5 gaps.

## (d) D-9 row and Open PRD residuals against the sprint change proposal

| Spine claim | Proposal source | Assessment |
| --- | --- | --- |
| D-9 (L421): tool contracts and link forms fixed in Stories 1.3, 1.4, 1.5, and 1.10 (§4.5, approved 2026-10-02) | §4.5 L189-199; frontmatter `approved: 2026-10-02`; L24 "including the Section 4.5 contract choices" | **Accurate.** `lint_document` input is in 1.3 AC1, `lint_wiki` input in 1.5 AC1, gating, annotations, and output in 1.10 AC1, invalid input in 1.3 AC9, and link forms and `evaluatedLinkCount` in 1.4. |
| D-9: constants, margin, and floor remain AD-17 evidence tasks in Story 3.3 | §4.4 L176; §4.5 L199 | **Accurate.** |
| D-9: sweeper and cap revisit only on pilot evidence | §4.2 L153 (1.7, cap), §4.3 L167 (2.6, no sweeper); Story 3.4 AC5 | **Accurate.** |
| Residuals (L434): `epics.md` replanned against final contracts, D-9 tool contracts and link forms fixed | §1, §4.1 L133, Gate 1 L331 | **Accurate.** |
| Residuals: three items (below-floor code, structure checks without `readDocument`, admission order) | §4.6 L206, L207, L210; §5 L221 | **Accurate as a description of the items.** Decision 2 (option B) answers §4.6 L210's "revisiting this needs an architecture decision". |
| Residuals: "Stories 1.3, 1.5, and 1.7 … need a follow-up edit" | §5 L221 names 1.3, 1.5, 1.7 | **Matches §5 but is wrong on substance** (M-4): 1.7 needs no edit, and 1.6, 3.2, and 3.4 do. |
| Residuals: "Gate 1 stays `not ready` until implementation evidence exists" | Gate 1 L331 | **Accurate.** |
| Residuals: "No PRD conflict remains open" | Gate 1 L331 | **Was accurate for the proposal. Not accurate for the amended spine until C-1 is settled.** |
| Amendment Record (L432): "adopted status unchanged" | n/a | **Accurate for the `[ADOPTED]` tags, but silent on the frontmatter `final`→`draft` change** (M-2). |

## Recommended order

1. **Operator:** rule on C-1, either a PRD clarification (a) or a spine change (b).
2. **Operator:** rule on M-1, either an empty-policy-set short-circuit or the amended Story 1.5 AC12.
3. **Architect:**
   - Settle M-3 (global-index gating).
   - Correct the residuals paragraph (M-4).
   - Restore `status: final` or record the draft state (M-2).
4. **Follow-up `epics.md` edit:** H-1 to H-7, L-4, and L-5, in one change recorded in the sprint change log.
