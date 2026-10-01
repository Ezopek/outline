# Review — epics.md follow-up to the 2026-10-02 spine amendment

- **Date:** 2026-10-02
- **Reviewer role:** independent reviewer; no file other than this review edited
- **Subject:** uncommitted `_bmad-output/planning-artifacts/epics.md` (36 edits, E1 to E36) against the uncommitted amended `ARCHITECTURE-SPINE.md` (Amendment Record row 2026-10-02)
- **Authority order applied:** PRD > addendum > spine > SPEC > epics
- **Repository state:** branch `feature/mcp-wiki-linting-v1.10.1`, ahead of `origin` by 4 and behind by 0 after `git fetch --prune`. `sprint-change-proposal-2026-10-02.md`, which the epics cite as the change record, exists but is untracked.

## Verdict

**Accept with fixes.** No edit contradicts the PRD. Every one of the 36 edits states its spine rule correctly. One amended spine rule, that the snapshot loads only the inputs of required checks (AD-11), is carried by no story. Story 1.5 AC6 still describes an unconditional input load, which a developer would build. Three medium gaps remain, plus low-severity wording and coverage items.

| Tier | Count |
| --- | --- |
| Critical | 0 |
| High | 1 |
| Medium | 3 |
| Low | 10 |
| Info | 2 |

## Findings

### H1 — Story 1.5 AC6 loads every snapshot input unconditionally (High)

- **Location:** Story 1.5 AC6 (`epics.md` lines 538–541). The same gap affects Story 1.7 AC2, which states only that document units exist when `documents` is required.
- **Problem:** The amendment added this text to AD-11: "Document units exist only when the `documents` check is required on that surface; otherwise `lint_wiki` runs and counts no document units and its snapshot loads only the inputs of required checks". AD-9 already limits the adapter to "rule-required fields".
  - AC6 says that scope, document content and state, canonical Markdown, authoritative hierarchy, extracted links, and target resolutions "are read" in the snapshot transaction, with no requiredness condition. Its only condition on `documentStructure` is `readDocument`.
  - A developer following AC6 would serialize every document's Markdown when only graph rules are enabled. They would read `documentStructure` when only document rules are enabled. The AD-16 Markdown and structure-node limits could then return `VALIDATION_RESOURCE_LIMIT_EXCEEDED`, making `failed` a run that the spine evaluates as `complete`.
  - No story AC states the rule.
- **Replacement for the AC6 Then line:**
  > **Then** the snapshot loads only the inputs of required checks (AD-9, AD-11): the evaluated scope always; authoritative document content and state, canonical Markdown serialization, extracted links, and authorized target resolutions only when the `documents` check is required, plus those of the configured surface documents when the `global_index` check is required; and authoritative hierarchy and structure only when the `hierarchy` or `global_index` check is required. Every input that is loaded is read from the primary database within one `REPEATABLE READ` transaction made read-only by an explicit `SET TRANSACTION READ ONLY`, not by Sequelize's `readOnly` option.
- **Fixture to add to Story 1.5 AC13 or Story 3.2 AC1:**
  > a policy with only document rules reads no `documentStructure`, and a policy with only hierarchy or global-index rules serializes no Markdown for documents other than configured surfaces, counts no document units, and is not failed by a limit on an input it did not load.

### M1 — Epic 2 does not carry per-surface requiredness for enforced writes (Medium)

- **Location:** Story 2.3 AC4 and AC5 (lines 1101–1109) and Story 2.2 AC5.
- **Problem:** The amended AD-11 adds: "Requiredness is per surface: on `lint_document` and enforced writes the only atomic unit is the document unit … `hierarchy` and `global_index` exist only on `lint_wiki`, and the AD-9 `readDocument` condition does not apply elsewhere … `lint_document` or an enforced write completes with zero counts and no Findings."
  - Edit E10 carried this rule into Story 1.3 only.
  - Story 2.3 AC5 says that every write "validates the full resulting title/body/state/relationships under the post-operation policy". A developer could read that as running the hierarchy rules, or the `readDocument` gate, on writes.
  - Nothing tells a developer what an enforced write does under a policy that enables only graph rules.
- **Replacement: append to the And-clause of Story 2.3 AC4:**
  > ; only enabled rule kinds whose AD-3 surfaces include the document surface run, hierarchy and global-index rule kinds never run on the write surface and never make it incomplete, the AD-9 `readDocument` condition does not apply, and when the `documents` check is not required validation completes with zero counts and no Findings, so the decision is `validated` (AD-11, AD-13).
- **Also change Story 2.3 AC5** from "title/body/state/relationships" to "title/body/state/relationships with every enabled `document`-surface rule".

### M2 — The AD-16 snapshot-time readability rule is carried by no story (Medium)

- **Location:** Story 1.5 AC2 and AC6, and Story 1.7 AC7.
- **Problem:** The amended AD-16 says: "The pre-admission `read` result fixes identity visibility for the whole invocation; … a collection no longer readable at snapshot time contributes only the documents its membership-aware queries return at snapshot time, its graph checks are unprovable exactly as under `graphAuthorized: false` (AD-9), and nothing else of it is disclosed."
  - No AC states this rule.
  - A developer could re-check `read` inside the snapshot and then drop the collection's identity, return a tool-execution error, or read its structure.
- **Replacement: append to Story 1.5 AC2:**
  > **And** the pre-admission `read` result fixes identity visibility for the whole invocation; a requested collection that is no longer readable at snapshot time contributes only the documents its membership-aware queries return at snapshot time, its required graph checks yield the criterion-3 generic `VALIDATION_RUNTIME_FAILED` exactly as under `graphAuthorized: false` (Story 1.6 criterion 12), and nothing else of it is disclosed (AD-16).
- **Fixture to add to Story 3.2 AC1:**
  > a scoped collection whose `read` is revoked between the pre-admission check and the snapshot.

### M3 — Story 3.2 AC1 does not pin the AD-18 timeout-prefix fixture (Medium)

- **Location:** Story 3.2 AC1, the clause "timeout prefix semantics with an unprovable check, a vacuous check, and a `graphAuthorized: false` check around the failing deadline check".
- **Problem:** AD-18 adds two distinct fixtures:
  - "`completedChecks` and prefix semantics under a timeout with an unprovable check earlier in unit order than a completed one"; and
  - "a vacuous check and a `graphAuthorized: false` check after the failing deadline check".

  The first fixture is the one that proves the removed "longest fully completed prefix" rule is gone, because a later completed unit must survive an earlier failed check. "Around" lets a single fixture with every special check after the deadline satisfy the AC without testing that case.
- **Replacement clause:**
  > `completedChecks` and prefix semantics under a timeout with an unprovable check earlier in unit order than a completed one, which is retained and counted; a vacuous check and a `graphAuthorized: false` check after the failing deadline check, neither listed nor reported;

### L1 — Story 1.3 AC9 sweeps authentication into the authorization-denial error (Low)

- **Location:** Story 1.3 AC9, from edit E12.
- **Problem:** The text says "an authentication or authorization denial … returns the same authorization-denial Tool-Execution Error". AD-11 unifies only a missing and a denied document or collection. Authentication runs at baseline P0 before the tool, and NFR-10 preserves that boundary.
- **Replacement:**
  > an authorization denial or a missing or inaccessible document returns the same authorization-denial Tool-Execution Error (`isError`), so missing and denied documents are indistinguishable, while an authentication failure keeps baseline behavior;

### L2 — "Failure" is broader than AD-11's "non-application failure" (Low)

- **Location:** Story 1.5 AC2 (E13: "its failure, expiry, or below-floor remainder"), Story 1.7 AC7 (E31: "a failure, expiry, or below-floor remainder"), and Story 1.10 AC3 (E33: "a failure of that lookup returns the fixed message").
- **Problem:** AD-11 applies the fixed message to "every non-application failure in these steps". Under AD-20, an Outline application error that carries a stable `id` keeps its own message. Story 1.3 AC9 already states this correctly.
- **Replacement in each place:**
  > expiry, a below-floor remainder, or another non-application failure of that lookup is a Tool-Execution Error with the fixed message `The operation could not be completed`

### L3 — Story 1.3 AC6 does not name expiry for the collection-readability check (Low)

- **Location:** Story 1.3 AC6, from edit E11.
- **Problem:** Under AD-11, expiry or a below-floor remainder in the collection-readability check follows AD-10: identity is treated as unreadable and evaluation continues. AC9 limits the tool-error case to the document lookup and `read` check, but AC6 says only "fails", so a developer might route a timeout to AC9.
- **Replacement:**
  > if the collection-readability check itself fails, including by expiry or a below-floor remainder, the collection is treated as unreadable for identity in the same way and evaluation continues under its policy (AD-10, AD-11).

### L4 — Story 1.7 AC3 does not say which code a stop-margin stop returns (Low)

- **Location:** Story 1.7 AC3 and AC4.
- **Problem:** The amended AD-3 lists "or `lint_wiki` stopped at its stop margin" as a `VALIDATION_TIMEOUT` case. AC3 says only that no new unit starts.
- **Replacement: append to AC3 Then:**
  > ; stopping at the margin is the `VALIDATION_TIMEOUT` of criterion 4 (AD-3)

### L5 — Story 1.8 does not name the new read-audit paths (Low)

- **Location:** Story 1.8 AC10.
- **Problem:** The AD-14 behavior is covered generically. However, no read-audit fixture names any of these paths:
  - the admission-rejection `failed` result, scoped or default;
  - the no-admission `not_evaluated` and sentinel results;
  - the pre-scope lookup failure, expiry, or below-floor remainder, which records no summary;
  - the `lint_document` collection-readability failure, which records a summary.
- **Replacement: append to AC10 When:**
  > , including an admission rejection for a scoped request (collection column and valid-policy fields present) and a default request (neither present), a `not_evaluated` result returned without admission, a pre-scope lookup failure, expiry, or below-floor remainder (no summary), and a `lint_document` whose collection-readability check fails (one summary whose data and columns do not depend on actor readability)

### L6 — Inventory summaries are stale or partial (Low)

- **AD-11 summary (E5):** "a vacuous check counts as completed" omits the exception. Add ", except a graph check of a collection marked `graphAuthorized: false`", plus "; pre-scope steps run in a short `SET LOCAL`-bounded read-only transaction, return one indistinguishable missing-or-denied error, and use the fixed message for non-application failures".
- **AD-10 summary (E4):** after "completes its lookup and authorization", add "and its collection-readability check, whose failure only withholds identity,".
- **AD-3, AD-12, and AD-18 summaries:** these were not updated, although the amendment changed all three decisions.
  - AD-3: add "`VALIDATION_TIMEOUT` is limited to snapshot construction, unit evaluation, write P5 after it began, and the `lint_wiki` stop margin".
  - AD-12: add "a collection whose readability cannot be established follows AD-10 and AD-11".
  - AD-18: add "AD-16 admission order, below-floor snapshot timeout on both read surfaces, graph checks without `readDocument`, pre-scope lookups, and timeout-prefix fixtures".

### L7 — Story 3.2 AC1 omits three AD-18 fixtures by name (Low)

- **Location:** Story 3.2 AC1.
- **Problem:** These AD-18 fixtures appear only as behavior in story ACs, not as named fixtures:
  - "a scoped `lint_wiki` whose collection lookup fails" (Story 1.5 AC2, Story 1.7 AC7);
  - "`lint_document` authorization completing before any snapshot batch" (Story 1.3 AC9);
  - "a same-team admin on a private collection without membership" (Story 1.5 AC3).
- **Fix:** add the three AD-18 phrases verbatim to the AC1 list.

### L8 — Story 3.3 AC7 derives the floor without the pre-scope transactions (Low)

- **Location:** Story 3.3 AC7.
- **Problem:** The `SET LOCAL` floor now also guards the AD-11 pre-scope short read-only transactions. The derivation names only "snapshot construction or an enforcement transaction". The list of fixtures to re-run also omits the below-floor cases.
- **Replacement:** change the derivation to "in a pre-scope lookup, snapshot construction, or an enforcement transaction". Add to the re-run list "a snapshot batch refused below the floor on both read surfaces, and a below-floor pre-scope lookup".

### L9 — Story 1.5 AC5 reuses the word "admission" (Low)

- **Location:** Story 1.5 AC5, When line: "scope admission runs".
- **Problem:** AD-16 admission is now the concurrency slot, and a scoped sentinel bypasses it. The wording invites routing sentinels through the slot.
- **Replacement:** "**When** scope selection runs".

### L10 — Story 1.7 AC7 cites the same criterion twice (Low)

- **Location:** Story 1.7 AC7, from edit E30.
- **Problem:** "(Story 1.5 criterion 2)" appears twice in the same sentence.
- **Fix:** delete the second occurrence.

### I1 — The epics read FR-12 the way the spine does (Info)

- **Location:** Story 1.5 AC5, from edit E15.
- **Observation:** A requested collection whose readability cannot be established becomes a tool-execution error. This follows the spine's reading that FR-12's generic runtime failure applies inside an established scope.
  - This is defensible and is recorded as non-blocking in Story 3.4 AC5. However, it rests on a PRD clarification that has not been made yet.
  - Story 3.4 AC5 names "owner Wiki operator", which the spine does not state. Confirm that owner when the clarification is authorized.

### I2 — The cited change record is untracked (Info)

- **Location:** `epics.md` frontmatter and Overview.
- **Observation:** Both cite `sprint-change-proposal-2026-10-02.md`, which is untracked. Commit it together with `epics.md`.

## Edit-by-edit verification (check 1)

| Edit | Location | Result |
| --- | --- | --- |
| E1, E2 | Frontmatter, Overview | Correct |
| E3 | AD-9 summary | Correct |
| E4 | AD-10 summary | Correct but partial (L6) |
| E5 | AD-11 summary | Under-states the vacuous exception (L6) |
| E6 | AD-16 summary | Correct |
| E7 | Epic 1 note | Correct |
| E8 | Story 1.3 AC2 re-read | Correct; references to criteria 9 and 10 resolve |
| E9 | Story 1.3 AC3 | Correct (AD-3, AD-10, AD-11 below-floor rule) |
| E10 | Story 1.3 AC5 | Correct (per-surface requiredness); write side missing (M1) |
| E11 | Story 1.3 AC6 | Correct; clarify expiry (L3) |
| E12 | Story 1.3 AC9 | Correct except "authentication" (L1) |
| E13 | Story 1.5 AC2 | Correct; "failure" is broad (L2) |
| E14 | Story 1.5 AC3 | Correct (AD-9) |
| E15 | Story 1.5 AC5 | Matches the spine; see I1 for the PRD reading |
| E16 | Story 1.5 AC6 | Correct for `readDocument`; requiredness missing (H1) |
| E17, E18 | Story 1.5 AC11 | Correct |
| E19 | Story 1.5 AC12 | Correct (AD-16 step 2 and the contention residual) |
| E20 to E25 | Story 1.6 AC1, 7, 8, 10, 11, 12 | Correct (AD-9, AD-11, AD-12) |
| E26 to E29 | Story 1.7 AC2, AC4 | Correct; "longest fully completed prefix" is gone |
| E30 | Story 1.7 AC7 | Correct; duplicate citation (L10) |
| E31 | Story 1.7 AC7 | "failure" is broad (L2) |
| E32 | Story 1.7 AC7 | Correct (AD-16 step 4) |
| E33 | Story 1.10 AC3 | "failure" is broad (L2) |
| E34 | Story 1.10 AC6 | Correct |
| E35 | Story 3.2 AC1 | Mostly correct; prefix fixture not pinned (M3), three phrases missing (L7) |
| E36 | Story 3.4 AC5 | Correct; owner not stated in the spine (I1) |

## Residual sweep (check 2)

These phrases no longer appear anywhere in `epics.md` for lint targets:

- "with baseline content". It now appears only in Story 2.3 AC8 for AD-20 row 5, where it is correct.
- "longest fully completed prefix".
- below-floor as `VALIDATION_RUNTIME_FAILED`.
- "Story 3.4 criterion 5".

Every cross-reference by criterion number resolves to the intended criterion: Story 1.3 criteria 9 and 10; Story 1.5 criteria 2, 5, 11, and 12; Story 1.6 criterion 12; Story 1.7 criteria 5 and 7; Story 2.5 criteria 3 and 5; Story 3.3 criterion 5.

Story 1.1 states no `VALIDATION_TIMEOUT` meaning of its own. Its AC2 binds the registry to the AD-3 rows, so it inherits the amended text and contradicts nothing.

Epic 2's below-floor and timeout rules match the amended AD-3 and AD-11:

- Story 2.3 AC3: row 3 in P3 and P4 and on entering P5; `VALIDATION_TIMEOUT` once P5 began; row 5 in P7.
- Story 2.1 AC7: the half-deadline rule.

The remaining contradictions are H1, M1, and M2.

## AD-18 coverage (check 3)

| AD-18 fixture added 2026-10-02 | Where it is covered |
| --- | --- |
| AD-16 admission order (denied or missing scoped collection while the slot is held; sentinel and unconfigured requests without admission; slot release) | Story 3.2 AC1; Story 1.7 AC7 |
| Below-floor snapshot batch returns `VALIDATION_TIMEOUT` on both read surfaces | Story 3.2 AC1; Story 1.3 AC3; Story 1.5 AC11 |
| Graph checks without `readDocument` (same-team admin, with and without a membership-readable document, memberships not preloaded) | Story 3.2 AC1 (admin not named, L7); Story 1.5 AC3; Story 1.6 AC12 |
| Prefix semantics with an unprovable check earlier than a completed one | Behavior in Story 1.7 AC4; fixture not pinned (M3) |
| Scoped `lint_wiki` whose collection lookup fails | Story 1.5 AC2; Story 1.7 AC7; not named in Story 3.2 (L7) |
| `lint_document` authorization before any snapshot batch | Story 1.3 AC9; not named in Story 3.2 (L7) |
| `lint_document` collection-readability failure, for a sentinel and a valid collection | Story 3.2 AC1; Story 1.3 AC6 and AC8 |
| Default-scope enumeration batch failing other than by the floor | Story 3.2 AC1; Story 1.5 AC5 and AC11 |
| Vacuous and `graphAuthorized: false` checks after the failing deadline check | Story 1.7 AC4; Story 3.2 AC1 says "around" (M3) |
| Stalled pre-scope lookup on both read surfaces; identical missing and denied errors | Story 3.2 AC1; Story 1.3 AC9; Story 1.5 AC2 |

Every added fixture has a story AC. Two are weakly pinned (M3), and three are missing as named items in Story 3.2 (L7).
