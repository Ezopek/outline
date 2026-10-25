---
title: 'DW-59: Re-assemble the Gate 1 evidence index and decision record after the AD-17 reference run'
type: 'chore'
created: '2026-10-25'
status: 'done'
baseline_revision: 'f01702852bfe4dd54b20643fb5e43d6949825441'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-4-assemble-the-gate-1-evidence-index-and-decision-record.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-dw-51-reassemble-gate-1-evidence.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-dw-56-fix-ad17-constants-and-held-pool-verdict.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-dw-58-server-test-timeout-headroom.md'
warnings: []
deferred: []
---

<frozen-after-approval reason="human-owned intent">

## Intent

**Problem:** The Gate 1 index and record (re-assembled by DW-51) list 16 blocking rows: NFR-1–5, SM-I5, AD-17, the three D-9 constant rows and DW-4/DW-5 wait for the AD-17 reference run; DW-6 and SM-I2 are `contradictory`; G1-SM-I and G1-BLOCKING-DECISIONS follow. New retained evidence now exists:
- `docs/wikilint-gate-1/benchmark/reference-manifest.json` (sha256 `481eaf954b52fc57d1423f2d9a3d105fb7a994d3b54025b3f7880f12de6efe89`): an attested AD-17 reference run at source commit `e5e16ec2588982ca674540100ae24186d1fc1081`, local image `sha256:82a8ea725d99d88ee714cce9f639f75477220b0083e1dd9a9e682664c7511127`, `gate1Eligible: true`, no deviations, every budget `pass`, the DW-4, DW-5 and DW-6 records `pass`, and every constant `reference` and satisfying its rule (`derivation.gate1: ready`). Its attestation is `reference-attestation.txt`, and `reference-stack.sh` is the provisioning script that the coordinator ran.
- The D-9 constants are committed at those values and marked fixed by DW-56 (accepted commit `8f76ac9268fb30c9daf6a969b9fa1e18f1fe12ce`). The DW-6 criterion was amended on 2026-10-25 (epics, "Amendment (2026-10-25)", Story 3.3 criterion 9).
- `docs/wikilint-gate-1/raw/test-wikilint-nas-run-{1,2,3}.json` with `test-wikilint-nas-runs.txt`: three fresh-database `yarn test:wikilint` runs at `e1d81de21d30f199e424c512dbeddb9dd161f90c` on `ezopnas` (containers: PostgreSQL 14.2, Node 26.3.0), each 2291 passed and 1 skipped, identical per test. DW-50 is `done` (its resolution: the failures were 5000 ms timeouts with too little headroom; DW-58, accepted commit `9e96964d345b191539f0b7a95de5553fb4fabef1`, gave the server project a 20000 ms timeout). `raw/dw50-*.txt` keep the failing series before DW-58.

**Approach:** Update the Story 3.3 evidence files for the reference run, then re-assemble the index and the record under exactly the Story 3.4 rules from the evidence now retained, as DW-51 did.

## Boundaries & Constraints

**Always:**
- Story 3.4's frozen rules apply unchanged: one row per binding ID with its columns, the meaning of each result, the source-revision rule (the commit the evidence was produced at), the `accepted-gap` limits, the AC 2 decision rule with no waiver, residual owners from their sources or `not named in source`, and every item the epic says the record states.
- Operator decision (2026-10-25): the developer workstation under WSL2 (kernel `6.18.33.2-microsoft-standard-WSL2`) is accepted as the AD-17 reference host, and the operator attested local SSD and no competing traffic (`reference-attestation.txt`). The record states this decision and the runtime additions to the unmodified image that the attestation lists.
- `docs/wikilint-gate-1/benchmark/constants.md` and `dw-4-5-6.md` cite the reference manifest (its sample IDs, values and verdicts) instead of the smoke manifest, which stays as the earlier smoke evidence.
- SM-I2 rests on the three `ezopnas` runs and the DW-50 and DW-58 ledger entries; the Story 3.2 three-run comparison stays linked as earlier evidence of its own revision. Open deferred-work entries that bear on Gate 1 are recorded where they apply, with their ledger status.
- A row is `pass` only when its linked evidence is a retained run, review or record; a claim without retained raw output stays `unverified`.
- `decision-record.md` states the recomputed decision and lists every blocking row, or states that none remains; `gate1EvidenceIndex.test.ts` recomputes both from the index. A `ready` decision is Gate 1 implementation readiness only: the record keeps image publication (Gate 2), deployment and rollout as separate approval boundaries.

**Never:**
- Change functional code, a constant, a severity, a budget, or the outcome of any test other than the index test's own expectations for the re-assembled index.
- Claim SM-P1–7 pilot evidence or production success, invent OD values, or treat the local image digest as a publication.
- Re-run or edit the retained runs, raw reports or manifests.
- Push an image, change an environment, deploy, mount a policy, or enable a collection policy.
- Edit the deferred-work ledger, the sprint board, the epics file, the Architecture Spine or this spec.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| AD-17 rows | the reference manifest, its budgets and derivation | each row links the manifest at its source commit with the result that evidence supports | a missing item stays `gap` naming it |
| SM-I2 | three identical ezopnas runs, DW-50 and DW-58 `done` | the result the Story 3.4 rules give for those sources | sources that still disagree are `contradictory`, both linked |
| Recomputed decision | the final index | the record's decision and blocking rows equal the recomputed ones | the test fails otherwise |

</frozen-after-approval>

## Code Map

- `docs/wikilint-gate-1/evidence-index.md`, `decision-record.md` -- the index and record to re-assemble.
- `docs/wikilint-gate-1/benchmark/` -- `constants.md`, `dw-4-5-6.md` to update; `reference-manifest.json`, `reference-attestation.txt`, `reference-stack.sh`, `smoke-manifest.json` read-only.
- `docs/wikilint-gate-1/raw/` -- read-only retained runs.
- `server/wikiLint/benchmark/gate1EvidenceIndex.test.ts` -- recomputes completeness, the decision and the blocking rows.
- `_bmad-output/implementation-artifacts/deferred-work.md`, `_bmad-output/planning-artifacts/epics.md` -- read-only sources of statuses and the amended criterion.

## Tasks & Acceptance

**Execution:**
- `docs/wikilint-gate-1/benchmark/constants.md`, `dw-4-5-6.md` -- cite the reference run.
- `docs/wikilint-gate-1/evidence-index.md`, `decision-record.md` -- re-assemble under the Story 3.4 rules.
- `server/wikiLint/benchmark/gate1EvidenceIndex.test.ts` -- update only the expectations that encode the earlier state, keeping every completeness and decision check.

**Acceptance Criteria:**
- Given the re-assembled index, when `gate1EvidenceIndex.test.ts` runs, then every binding ID has exactly one row and the record's decision and blocking rows equal the recomputed ones.
- Given an AD-17, NFR-1–5, SM-I5, D-9 constant or DW-4/5/6 row, when it is read, then it links the reference manifest and no longer names the reference run as open.
- Given SM-I2, when it is read, then it links the three ezopnas runs and the DW-50 and DW-58 entries.

## Spec Change Log

## Review Triage Log

## Coordinator Result

- acceptance: `b327d742-0d82-4f7b-8f65-69156a477793`
- accepted commit: `0ef97699283866ed4914d06b2d3cd2466a591b84`
- review: `d8b67380-7b7e-4c69-a37f-d459e6150c5b`
- verification: tsc: pass, oxlint: pass, oxfmt: pass, vitest-index: pass
- decisions: none
