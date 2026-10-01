# Rubric Review — Spine update 2026-10-02

- **Target:** `ARCHITECTURE-SPINE.md` working-tree delta against `HEAD` (`d01f67066`), judged in the context of the whole spine.
- **Rationale read:** the last five `.memlog.md` entries (direction, Items 1 to 3, Item 4 housekeeping).
- **Cross-checked against:** `sprint-change-proposal-2026-10-01.md` (§4.5, §4.6, §5, Gate 1) and `epics.md` (Replan status, Epic 1 notes, AD inventory, Stories 1.3, 1.5, 1.6, 1.7, 3.2, 3.4). Baseline code: `server/policies/collection.ts`, `server/routes/api/collections/collections.ts`.
- **Repository state:** branch `feature/mcp-wiki-linting-v1.10.1`, 4 ahead and 0 behind `origin` after `git fetch --prune`. Only the spine and the memlog are modified.
- **Reviewer stance:** read-only rubric review. No spine edit was made.

## Verdict

**Approve with required fixes.** The three §4.6 decisions are well chosen and fix real divergence points:

- Item 1 gives one timeout code for the same slow-DB condition on read and write surfaces.
- Item 2 keeps structure reads within the baseline `collections.documents` exposure. I verified that `read` is true for any same-team admin (`collection.ts:34-47`) and that `readDocument` requires membership on a private collection (`collection.ts:67-85`, used at `collections.ts:179`).
- Item 3 makes the result kind independent of load.

The delta keeps AD IDs stable and does not contradict the brownfield code.

It does leave two literal contradictions with untouched text: AD-11 vacuous completion against AD-9 unprovability, and the AD-3 timeout definition against the AD-11 phase mapping. The handoff paragraph also names the wrong follow-up stories. The "Binds/Prevents unchanged" claim is literally true, but AD-9 and AD-16 should have been extended, as the 2026-09-30 precedent did for AD-8, AD-11, and AD-12.

| Severity | Count |
| --- | --- |
| Critical | 0 |
| High | 2 |
| Medium | 4 |
| Low | 7 |

## Critical

None.

## High

### H-1 — AD-11 vacuous completion contradicts the new AD-9 unprovability on the headline case (L169 vs L157)

**Problem.** AD-11 (L169, unchanged) says: "A check is required exactly when at least one enabled rule kind belongs to it; a required check with zero inputs completes vacuously and is listed in `completedChecks`." The new AD-9 text (L157) says that without `readDocument` "the adapter reads no structure or hierarchy input for that collection, and each required structure-derived check is unprovable and yields the generic `VALIDATION_RUNTIME_FAILED`".

For the exact §4.6 case, both rules apply literally and give opposite results. Take a same-team admin on a private collection with no readable documents:

- AD-11 gives zero inputs, so the check completes vacuously and the result can be `complete`/`clean`.
- AD-9 gives an unprovable check, so the result is `VALIDATION_RUNTIME_FAILED` and `incomplete`/`failed`.

The memlog Item 2 entry says the decision "Binds ... AD-11 (unit outcome)", but AD-11 was not amended, and the Amendment Record row (L432) does not list AD-11 for Item 2. The check runner (Story 1.6 AC8, `epics.md` L625-628, "a required check has zero inputs ... completes vacuously") and the adapter (Story 1.5) can therefore diverge.

**Fix.** Append to the AD-11 vacuous-completion sentence (L169):

> "... completes vacuously and is listed in `completedChecks`; a required check whose inputs the adapter cannot read under AD-9 (no `readDocument`, or an unprovable global-index fact) has unprovable inputs, not zero inputs, never completes vacuously, and yields the AD-9 `VALIDATION_RUNTIME_FAILED`."

Then add "AD-11 (vacuous completion excludes unprovable checks)" to the 2026-10-02 Amendment Record row.

### H-2 — Open PRD residuals paragraph names the wrong follow-up stories (L434)

**Problem.** L434 says: "Stories 1.3, 1.5, and 1.7 predate the 2026-10-02 amendments: the below-floor snapshot code, structure-derived checks without `readDocument`, and the admission order. They need a follow-up edit."

Checked against `epics.md`:

- **Story 1.7 needs no edit for these items.** AC7 (L691-695) already states the exact admission order. Memlog Item 3 says the decision "Ratifies ... Story 1.7 AC7". Story 1.7 contains no below-floor or `readDocument` text. The paragraph implies 1.7 trails the admission order, which is false.
- **Story 1.6 is missing.** It owns the hierarchy and global-index checks:
  - AC1 (L590-593) operates "on ... authoritative collection structure" with no `readDocument` gate.
  - AC8 (L625-628) is the vacuous rule from H-1.
  - The AC fixtures list lacks the admin-without-membership case.
- **Story 1.5 is listed correctly, but for two items.** AC3 (L520-522) pins the admin case as admitted and "clean only when every required check completes", which now needs the `VALIDATION_RUNTIME_FAILED`, no-structure-read assertion. AC11 (L561) says a below-floor remainder is `VALIDATION_RUNTIME_FAILED`.
- **Story 1.3 is listed correctly.** AC3 (L362-363) gives the below-floor `VALIDATION_RUNTIME_FAILED`.
- **Story 3.4 AC5 (L1601-1602) is missing.** It lists the three items as open architect items "none of which is decided". The Epic 1 implementation notes (L181) make the Architect's review of these items a precondition for Stories 1.3, 1.5, and 1.7. Both are now stale.
- **Story 3.2 is missing.** Its AD-18 layer list (L1469) lacks the new AD-18 fixtures.
- **The AD inventory is missing.** The AD-9, AD-10, AD-11, and AD-16 summaries (`epics.md` L105-125) predate the amendments.

**Fix.** Replace the two sentences in L434 with:

> "Several `epics.md` items predate the 2026-10-02 amendments and need a follow-up edit:
>
> - Stories 1.3 (AC3) and 1.5 (AC11): the below-floor snapshot code.
> - Stories 1.5 (AC3) and 1.6 (AC1, AC8, and the fixture list): structure-derived checks without `readDocument`.
> - Story 3.2: the new AD-18 fixtures.
> - Story 3.4 AC5 and the Epic 1 implementation notes: the three architect items are now decided.
> - The AD-9, AD-10, AD-11, and AD-16 inventory summaries.
>
> Story 1.7 AC7 already states the AD-16 admission order."

Update the memlog Item 4 entry, which repeats "Stories 1.3, 1.5 and 1.7", in the same way.

## Medium

### M-1 — AD-3 `VALIDATION_TIMEOUT` definition over-reaches the AD-11 phase mapping (L85)

**Problem.** The new text "or its remainder fell below the code-owned floor before a step that the floor guards (AD-11)" also covers write phases P3, P4, and P7. The floor guards those phases too, but AD-11 (L169) maps a below-floor remainder there to row 3 or row 5, never to `VALIDATION_TIMEOUT`. An implementer reading the registry, which is the closed code catalogue, could emit `VALIDATION_TIMEOUT` in P3. That would make it fail-open-eligible input to AD-13, which is exactly what memlog Item 1 option C was rejected to avoid. The pre-existing "validation deadline expired" wording had the same looseness for P3 and P4. The delta widens it.

**Fix.** Change the L85 meaning to:

> "The server-owned deadline expired during snapshot construction, unit evaluation, or write phase P5, or its remainder fell below the code-owned floor before a snapshot-construction batch or during P5 (AD-11); a below-floor remainder in P3, P4, or P7 is an AD-20 phase failure, not this code."

### M-2 — AD-16 lookup-failure clause conflicts with the AD-11 readability-unestablished clause (L287 vs L169)

**Problem.** AD-16 step 1 (L287): "A denied or missing collection, or a failure of that lookup, is a tool-execution error with no summary." AD-11 (L169, last sentence) says that for a sentinel, "if readability cannot be established, the run adds only the generic snapshot `VALIDATION_RUNTIME_FAILED`", which is a modeled result with a summary.

For a collection-scoped `lint_wiki` on a sentinel collection whose lookup fails, the two prescribe different result kinds and different audit behavior (AD-14). The tension already existed between Story 1.5 AC5 and Story 1.7 AC7. The spine now encodes both sides.

**Fix.** Qualify the AD-11 sentence:

> "... if readability cannot be established for a default-scope `lint_wiki` or a `lint_document`, the run adds only the generic snapshot `VALIDATION_RUNTIME_FAILED`; for a collection-scoped `lint_wiki`, a failed lookup or read check is the AD-16 step-1 tool-execution error."

### M-3 — The admission-rejection result is not closed (L289)

**Problem.** Step 3 says a rejected request is "`state: failed` with `VALIDATION_RESOURCE_LIMIT_EXCEEDED`, no Findings, and zero counts". It does not say that this is the only System Failure. Admission precedes "every sentinel readability check", so on a default-scope rejection, readability is *unchecked*. A literal reader of AD-11's "if readability cannot be established, the run adds ... `VALIDATION_RUNTIME_FAILED`" can add a second failure. Story 1.7 AC7 pins "no sentinel" and a single failure, but the spine, which binds Stories 1.5 and 1.7 alike, does not.

**Fix.** Append to step 3:

> "Its only System Failure is that one, located per AD-12 for the request's scope kind; no sentinel is reported, unchecked readability is not 'cannot be established' (AD-11), and a default-scope rejection has `collections: []` and empty `policies`."

### M-4 — Binds/Prevents of AD-9 and AD-16 should have been extended, and the Amendment Record claim follows from that (L155-156, L283-284, L432)

**Problem.** The row's claim "Identifiers, `Binds`, `Prevents`, and adopted status unchanged" is literally true. Each AD now decides something its header does not name:

- **AD-9.** It now binds structure-read authorization (`readDocument`) and prevents a structure read beyond the baseline `collections.documents` exposure and a clean result from structure checks the actor cannot prove. "hidden resource disclosure" covers only the first part.
- **AD-16.** "snapshot construction and per-process load control" does not name the ordering of admission against scoped authorization, the sentinel and unconfigured short-circuit, and enumeration. "concurrent scans exhausting a server process" does not name the newly prevented divergences: a load-dependent result kind for the same request, which memlog Item 3 names explicitly, and a leaked slot.

The spine has a precedent for extending these headers in the second 2026-09-30 row ("`Binds` and `Prevents` of AD-8, AD-11, and AD-12 were extended").

**Fix.**

- AD-9 Binds: `cross-document links, hierarchy integrity, global-index coverage, structure-read authorization.`
- AD-9 Prevents: `whole-workspace overfetch, cache/replica inconsistency, hidden resource disclosure, structure reads beyond the baseline collection-structure exposure, and a clean result from unprovable structure checks.`
- AD-16 Binds: `snapshot construction, per-process load control, and the lint_wiki admission order.`
- AD-16 Prevents: `N+1 queries, unbounded AST retention, concurrent scans exhausting a server process, a load-dependent result kind for the same request, and a leaked admission slot.`
- Amendment Record row: replace "Identifiers, `Binds`, `Prevents`, and adopted status unchanged" with "Identifiers and adopted status unchanged; `Binds` and `Prevents` of AD-9 and AD-16 extended."

Mirror the change in the memlog Items 1 to 3, which each say "Binds, Prevents ... unchanged" or imply it.

## Low

### L-1 — Frontmatter `status: draft` (L8)

The delta flips `final` to `draft` with no memlog event. `epics.md` and the SCP treat the spine as the adopted binding source. If this is the in-review state, flip it back to `final` and log "(event) spine finalized" before commit. Otherwise the authority order in the SCP and `epics.md` points at a draft.

### L-2 — The AD-9 Rule carries rationale (L157)

The clause "the predicate the baseline `collections.documents` route uses before exposing `documentStructure`" and the final sentence "With only document rules enabled, such an actor may therefore receive `clean` ... as the PRD's actor-readable scope defines" are rationale or residual, not rule. Keep the predicate and the effect. Move the residual to the memlog or to one short "Recorded residual:" clause.

Suggested tail:

> "... yields the generic `VALIDATION_RUNTIME_FAILED` located at the collection; documents readable through document membership are still evaluated (recorded residual: with only document rules, such a result can be clean)."

### L-3 — AD-16 step 2 rationale (L288)

", because it starts no scan" is rationale. Drop it, or keep it if the authors want the scan-only reading of "at most one concurrent `lint_wiki` scan" to stay visible. It is harmless.

### L-4 — The `readDocument` check needs a membership-loaded collection (L157, L292)

Baseline `readDocument` returns false unless the collection was loaded with the actor's memberships (`includesMembership`, as with `Collection.findByPk(id, { userId })` at `collections.ts:175-177`). An adapter that evaluates it on a collection loaded without the membership scope fails safe but falsely, reporting `VALIDATION_RUNTIME_FAILED` for real members.

Add to AD-9:

> "evaluated on the collection loaded with the actor's membership scope, as the baseline route does."

### L-5 — Markdown structure of the AD-16 nested list (L285-292)

The list renders correctly in CommonMark and GFM: the two-space indent matches the `- ` content offset, and the continuation paragraph stays in the item. The blank lines make the outer Binds/Prevents/Rule list loose, though, so AD-16 renders with paragraph spacing unlike every other AD. The spine's own precedent (AD-8, L142-147) places numbered steps outside the bullet list. Either:

- move the steps below the bullet list as a `**Admission order.**` paragraph followed by a top-level ordered list, matching AD-8; or
- accept the cosmetic difference.

### L-6 — Capability → Architecture Map (L401)

The `lint_wiki` row omits AD-12, although AD-16 now decides which AD-12 result kind a scoped request receives and AD-9 and AD-12 jointly set the `readDocument` failure location. Change "Governed by" to `AD-9, AD-10, AD-11, AD-12, AD-16`.

### L-7 — AD-18 fixture gaps (L304)

The new fixtures cover a denied or missing scoped collection, the sentinel and unconfigured short-circuit, slot release, below-floor on both read surfaces, and the admin case. Add:

- a scoped-lookup failure (tool-execution error, no summary);
- a default-scope admission rejection with a readable sentinel present, asserting a single System Failure and no sentinel (M-3); and
- the admin case with zero readable documents, asserting `VALIDATION_RUNTIME_FAILED` rather than vacuous completion (H-1).

## Checks that passed

- **AD IDs stable.** No AD was added, removed, renumbered, or re-statused. All remain `[ADOPTED]`.
- **Decisions match the memlog.**
  - Item 1 option A appears in AD-3, AD-10, AD-11, and AD-18.
  - Item 2 option B appears in AD-9, AD-12, and AD-18.
  - Item 3 option A appears in AD-16 and AD-18.
  - The rejected options are not present.
- **Brownfield ratified.** The `read` and `readDocument` divergence exists only for same-team admins on private collections. Non-admin and guest `read` equals `readDocument`, so the AD-18 admin fixture covers the full divergence. The `lint_wiki` token gating of SCP §4.5 (`collections.documents`) is consistent with requiring `readDocument` for structure.
- **AD-12 consistent.**
  - Identity and sentinel gating stay on `read`.
  - The new `readDocument` failure uses the existing check location `scope { collection, collectionId }`.
  - The closed algebra still holds: a structure check that failed means the result is not `complete`.
- **AD-14 consistent.**
  - Admission rejection is a modeled `failed` result with exactly one summary.
  - A scoped denial, missing collection, or lookup failure is `isError` with no summary, which matches "a read that ends in an `isError` result records no summary".
  - Policy fields follow the existing single-collection rule.
- **AD-3 Surfaces column.** `VALIDATION_TIMEOUT` `all` and `VALIDATION_RESOURCE_LIMIT_EXCEEDED` `lint_wiki` are unchanged and still correct. The `VALIDATION_RUNTIME_FAILED` meaning already covers "a check could not be proven under the actor's authorization".
- **AD-10 and AD-11 below-floor mapping.** The AD-10 inability clause and the AD-11 floor list now agree on both read surfaces. AD-13 fail-open eligibility is untouched, because read surfaces have no decision.
- **Deferred.** No D-row now lets two units diverge:
  - The D-9 tool contracts and link forms have single owning stories.
  - The floor is one named constant shared by read and write (Stories 1.3 and 2.3).
  - D-7 (cross-instance admission) stays consistent with per-process AD-16.
- **D-9 row accurate.**
  - Stories 1.3, 1.4, 1.5, and 1.10 fix the tool contracts and link forms (SCP §4.5; `epics.md` L102).
  - The SCP was approved on 2026-10-02 (SCP frontmatter and §Status).
  - The constants, margin, and floor are Story 3.3 evidence tasks (SCP §4.4; `epics.md` L102).
  - The sweeper and cap keep their revisit conditions.
- **Open PRD residuals, other content.** The statements that no PRD conflict is open, that Gate 1 is `not ready` until implementation evidence exists, and that RI-5 is still stale all match SCP §Gate 1 and Checklist 3.4.
- **Terseness.** Apart from L-2 and L-3, the delta records decisions, not rationale. The rationale lives in the memlog.
