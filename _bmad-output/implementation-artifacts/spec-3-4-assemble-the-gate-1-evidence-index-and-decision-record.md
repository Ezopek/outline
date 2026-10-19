---
title: 'Story 3.4: Assemble the Gate 1 Evidence Index and Decision Record'
type: 'feature'
status: 'in-progress'
context: []
---

<frozen-after-approval reason="human-owned intent">

## Intent

**Problem:** Gate 1 evidence is spread across story specs, collocated tests and `docs/wikilint-gate-1/benchmark/`. No single index maps every binding requirement to inspectable evidence, and no record states the readiness decision apart from Gates 2–4.

**Approach:** Retain an English evidence index and a decision record under `docs/wikilint-gate-1/` (P5). A collocated test checks that the index is complete and that the stated decision follows the AC 2 rule mechanically.

## Boundaries & Constraints

**Always:**
- The index has one row per binding ID: CAP-1–6, FR-1–23, NFR-1–27, SM-I1–7, SM-C1–7, each Gate 1 condition (`epics.md:141`), AD-1–20, and each fixed D-9 item. Each row has the columns evidence kind, link, exact command, source revision, result (`pass` / `fail` / `gap` / `unverified` / `contradictory` / `accepted-gap`) and raw evidence location.
- The source revision is the commit the evidence was produced at: the accepted commit in a story spec's Coordinator Result, or the commit of a retained file. A claim with no retained raw output is `unverified`, never `pass`. A claim whose sources disagree is `contradictory`, and both sources are linked.
- `accepted-gap` is allowed only for a gap that the spine or the epic accepts by name: the D-6 crash-after-functional-completion-before-audit window, AD-20 row 7, and the AC 5 residuals. The row links the accepting source. It is never allowed on an SM-I or phase-blocking row.
- Decision (AC 2): the decision is `ready` only when both hold: (a) every SM-I row and every phase-blocking row is `pass`, and (b) no binding row anywhere in the index is `fail`, `gap`, `unverified` or `contradictory`. Condition (a) is necessary but not sufficient. Any other state is `not ready`, and every row that blocks is listed. No waiver.
- Every residual is listed with its owner and revisit condition, taken from the source that accepted it. If that source names none, the row says `not named in source`; no owner is invented.
- Every AC 5 residual, the phase-blocking set, the DW-4/5/6 rollout statement, the gate separation, OD-2/6/7 and the SM-P1–7 deferral are recorded as the epic states them.
- Decision (Story 3.2 is `backlog`, settled by AC 1 and AC 2): each Story 3.2 deliverable is an explicit `gap` row that names Story 3.2 as its closing source. These are the conformance run and coverage map, the merge-base, the backport inventory and the generic-data review. A test row with no retained run is `unverified`. The record is re-assembled after Story 3.2 and the Story 3.3 reference run. This story does not produce Story 3.2 evidence.

**Never:**
- Change functional code, a constant, or a test outcome. Story 3.3 constants stay provisional.
- Claim SM-P1–7 pilot evidence or production success. Invent OD values.
- Push an image, change an environment, deploy, mount a policy, or enable a collection policy (P4).
- Add a lint hook, validation field, configured-write audit or CAP-5 claim to `move_document` or `restore_document`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Provisional constants | `constants.md` all provisional | the three D-9 constant rows are `gap`; the decision is `not ready` | listed as blocking |
| DW-6 contradiction | ledger says DW-6 `done`, smoke held-pool re-run says `fail` | DW-6 is recorded open and `contradictory`, and both sources are linked | `not ready` |
| Other row not pass | every SM-I and phase-blocking row `pass`, but an FR, NFR, SM-C, AD or Gate 1 condition row is `fail`, `gap`, `unverified` or `contradictory` | `not ready`, with that row listed as blocking | the test fails if the record says `ready` |
| Accepted gap | the D-6 crash window or AD-20 row 7 marked `accepted-gap` with its source, all other rows `pass` | does not block the decision; functional outcomes unchanged | `accepted-gap` on an SM-I or phase-blocking row, or on an unnamed item, fails the test |
| DW-4/5 smoke only | `dw-4-5-6.md` smoke rows | each item open, with the smoke record linked as not Gate 1 evidence | — |
| ID without a row | an inventory ID is missing from the index | the test fails | — |
| `ready` with a non-pass blocking row | an edited index | the test fails | — |

</frozen-after-approval>

## Code Map

- `docs/wikilint-gate-1/benchmark/constants.md`, `dw-4-5-6.md`, `smoke-manifest.json` -- Story 3.3 evidence. Its constants are provisional and DW-4/5/6 are open; the DW-6 smoke run failed with `VALIDATION_RUNTIME_FAILED`.
- `server/wikiLint/benchmark/constantDerivation.ts:155,258` -- the existing `gate1` rule over the constants. Reuse its verdict for the D-9 constant rows.
- `deferred-work.md` DW-4/5 (open), DW-6 (`done 2026-10-04`, a contradiction), DW-14/39 (done).
- `ARCHITECTURE-SPINE.md` -- AD-17–20, the Deferred table (D-1/OD-2 and D-2/OD-6: Wiki operator before Gate 4; D-3/OD-7: release operator before Gate 2/3; D-6, D-8, D-9), the Amendment Record and the Open PRD residuals (C-1–7, RI-1–6).
- `epics.md:141` -- the Gate 1 conditions. `prd.md` -- the CAP/FR/NFR/SM IDs.
- `_bmad-output/implementation-artifacts/spec-*.md` -- Coordinator Result accepted commits (the source revisions).
- `package.json:35` -- `test:wikilint`, the broad command in `AGENTS.md`.
- `sprint-status.yaml:77` -- Story 3.2 (conformance and source provenance) is `backlog`, so its evidence is a `gap` here.

## Tasks & Acceptance

- [ ] `docs/wikilint-gate-1/evidence-index.md` -- one table row per binding ID with the columns from the Always rules. Link each D-9 tool-schema, annotation, token-scope and L1–L11 row to its Story 1.3/1.4/1.5/1.10 fixtures. Label the `move_document`/`restore_document` rows non-enforcement compatibility evidence. Link the destination-selection inventory to its selector and tool fixtures for every policy state, including the sentinel and identity-omission fixtures -- AC 1, 4.
- [ ] `docs/wikilint-gate-1/decision-record.md` -- the decision line (`ready`/`not ready`) and its blocking rows. Baseline `4a5a616a…`, the merge-base, the backport inventory and the generic-data review, each a Story 3.2 `gap`. The Story 3.1 fingerprint result, the conformance results, and a link to the AD-17 manifest. The crash-before-audit (D-6) and AD-20 row 7 gaps as `accepted-gap`, with functional outcomes unchanged. Conflict state and phase-blocking set. Residual table (AC 5). DW-4/5/6 with no read-only rollout until they close. Gates 2–4 unauthorized, OD-2/6/7 owners and revisit gates, SM-P1–7 deferred to Gate 4 -- AC 2, 3, 5–8.
- [ ] `server/wikiLint/benchmark/gate1EvidenceIndex.test.ts` -- parse both files. Assert that every inventory ID has one row with no empty column. Assert that `accepted-gap` appears only on the named accepted items, and never on an SM-I or phase-blocking row. Assert that the stated decision is `ready` exactly when every SM-I and phase-blocking row is `pass` and no row in the index is `fail`, `gap`, `unverified` or `contradictory`. Otherwise assert that it is `not ready` and lists every such row. Assert that the record names each AC 5 residual, DW-4/5/6, OD-2/6/7 and Gates 2–4 as unauthorized -- AC 1, 2, 5–8.

**Acceptance:** AC 1–8 hold over the retained files. The decision is whatever the rule yields; at `c163469b8` it is `not ready`.

## Verification

**Commands:**
- `tsc`: `corepack yarn tsc`
- `oxlint`: `node_modules/.bin/oxlint --type-aware server shared`
- `oxfmt`: `node_modules/.bin/oxfmt --check {changed_files}`
- `vitest`: `node_modules/.bin/vitest run --project server --maxWorkers=2 server/wikiLint server/index.test.ts server/routes/mcp server/tools`
