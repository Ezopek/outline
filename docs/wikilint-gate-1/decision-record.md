# Gate 1 decision record

This record states the Gate 1 implementation-readiness decision (Story 3.4, AC 2, 3 and 5–8). It is derived from [`evidence-index.md`](evidence-index.md). The collocated test [`gate1EvidenceIndex.test.ts`](../../server/wikiLint/benchmark/gate1EvidenceIndex.test.ts) recomputes the decision and the blocking rows from the index and fails if this record differs.

The record is re-assembled after Story 3.2 and the Story 3.3 reference run. Gate 1 readiness is separate from Gates 2–4: this record authorizes no image publication, deployment or rollout.

## Decision

Decision: `not ready`

Rule (AC 2): the decision is `ready` only when both hold: (a) every SM-I row and every phase-blocking row is `pass`, and (b) no row of the index is `fail`, `gap`, `unverified` or `contradictory`. Condition (a) is necessary but not sufficient. Any other state is `not ready`, and every blocking row is listed below. No waiver applies. An `accepted-gap` row does not block.

### Blocking rows

- `CAP-1` — `unverified`
- `CAP-2` — `unverified`
- `CAP-3` — `unverified`
- `CAP-4` — `unverified`
- `CAP-5` — `unverified`
- `CAP-6` — `unverified`
- `FR-1` — `unverified`
- `FR-2` — `unverified`
- `FR-3` — `unverified`
- `FR-4` — `unverified`
- `FR-5` — `unverified`
- `FR-6` — `unverified`
- `FR-7` — `unverified`
- `FR-8` — `unverified`
- `FR-9` — `unverified`
- `FR-10` — `unverified`
- `FR-11` — `unverified`
- `FR-12` — `unverified`
- `FR-13` — `unverified`
- `FR-14` — `unverified`
- `FR-15` — `unverified`
- `FR-16` — `unverified`
- `FR-17` — `unverified`
- `FR-18` — `unverified`
- `FR-19` — `unverified`
- `FR-20` — `unverified`
- `FR-21` — `unverified`
- `FR-22` — `unverified`
- `FR-23` — `unverified`
- `NFR-1` — `gap`
- `NFR-2` — `gap`
- `NFR-3` — `gap`
- `NFR-4` — `gap`
- `NFR-5` — `gap`
- `NFR-6` — `unverified`
- `NFR-7` — `unverified`
- `NFR-8` — `unverified`
- `NFR-9` — `unverified`
- `NFR-10` — `unverified`
- `NFR-11` — `unverified`
- `NFR-12` — `unverified`
- `NFR-13` — `unverified`
- `NFR-14` — `unverified`
- `NFR-15` — `unverified`
- `NFR-16` — `unverified`
- `NFR-17` — `unverified`
- `NFR-18` — `gap`
- `NFR-19` — `unverified`
- `NFR-20` — `unverified`
- `NFR-21` — `gap`
- `NFR-22` — `unverified`
- `NFR-23` — `unverified`
- `NFR-24` — `unverified`
- `NFR-25` — `gap`
- `NFR-26` — `gap`
- `NFR-27` — `unverified`
- `SM-I1` — `gap`
- `SM-I2` — `gap`
- `SM-I3` — `unverified`
- `SM-I4` — `unverified`
- `SM-I5` — `gap`
- `SM-I6` — `unverified`
- `SM-I7` — `gap`
- `SM-C1` — `unverified`
- `SM-C2` — `unverified`
- `SM-C3` — `unverified`
- `SM-C4` — `unverified`
- `SM-C5` — `unverified`
- `SM-C6` — `unverified`
- `SM-C7` — `unverified`
- `G1-BASELINE` — `gap`
- `G1-SM-I` — `gap`
- `G1-BLOCKING-DECISIONS` — `gap`
- `G1-GENERIC-ARTIFACTS` — `gap`
- `G1-BACKPORTS` — `gap`
- `AD-1` — `unverified`
- `AD-2` — `unverified`
- `AD-3` — `unverified`
- `AD-4` — `unverified`
- `AD-5` — `unverified`
- `AD-6` — `unverified`
- `AD-7` — `unverified`
- `AD-8` — `unverified`
- `AD-9` — `unverified`
- `AD-10` — `unverified`
- `AD-11` — `unverified`
- `AD-12` — `unverified`
- `AD-13` — `unverified`
- `AD-14` — `unverified`
- `AD-15` — `unverified`
- `AD-16` — `unverified`
- `AD-17` — `gap`
- `AD-18` — `gap`
- `AD-19` — `unverified`
- `AD-20` — `unverified`
- `D9-INPUT-SCHEMAS` — `unverified`
- `D9-ANNOTATIONS` — `unverified`
- `D9-TOKEN-SCOPE` — `unverified`
- `D9-LINK-FORMS` — `unverified`
- `D9-WRITE-ELIGIBILITY` — `gap`
- `D9-STOP-MARGIN` — `gap`
- `D9-SET-LOCAL-FLOOR` — `gap`
- `DS-1` — `unverified`
- `DS-2` — `unverified`
- `DS-3` — `unverified`
- `DS-4` — `unverified`
- `DS-5` — `unverified`
- `DS-6` — `unverified`
- `MR-MOVE` — `unverified`
- `MR-RESTORE` — `unverified`
- `S3.2-CONFORMANCE` — `gap`
- `S3.2-MERGE-BASE` — `gap`
- `S3.2-BACKPORTS` — `gap`
- `S3.2-GENERIC-DATA` — `gap`
- `DW-4` — `gap`
- `DW-5` — `gap`
- `DW-6` — `contradictory`

## Baseline and source provenance (AC 3)

| Item                | Value                                                                                                             | Index row         | Result | Closing source |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------- | ------ | -------------- |
| Exact baseline      | `v1.10.1^{}` / `4a5a616a21be800257dc11cef4263d0dd0412156` (tag object `9686f7264506a910ed87a4ad8704bafd361a3393`) | G1-BASELINE       | `gap`  | Story 3.2      |
| Merge-base          | not retained                                                                                                      | S3.2-MERGE-BASE   | `gap`  | Story 3.2      |
| Backport inventory  | not retained                                                                                                      | S3.2-BACKPORTS    | `gap`  | Story 3.2      |
| Generic-data review | not retained                                                                                                      | S3.2-GENERIC-DATA | `gap`  | Story 3.2      |

Story 3.2 is `backlog`. This story produces no Story 3.2 evidence.

## Startup and readiness fingerprint (Story 3.1)

Story 3.1 is `done` with accepted commit `58a3b2824222d8deb0f91222ebdf1940cb8e7415` ([Coordinator Result](../../_bmad-output/implementation-artifacts/spec-3-1-verify-safe-startup-and-readiness-policy-identity.md)). Its Coordinator Result reports `vitest: pass`, but no raw run output is retained. The fingerprint result is therefore `unverified` (index row AD-19), covered by [`policySet.test.ts`](../../server/wikiLint/core/policySet.test.ts), [`policyConfig.test.ts`](../../server/wikiLint/adapters/policyConfig.test.ts) and [`healthCheck.test.ts`](../../server/wikiLint/adapters/healthCheck.test.ts).

## Conformance results

No conformance run is retained. The AD-18 layered suite and the requirement coverage map are Story 3.2 deliverables (index row S3.2-CONFORMANCE, `gap`, closing source Story 3.2). Every row backed only by collocated tests is `unverified`.

## AD-17 benchmark manifest

The only retained manifest is the Story 3.3 smoke manifest [`benchmark/smoke-manifest.json`](benchmark/smoke-manifest.json): `gate1Eligible: false`, `derivation.gate1: not ready`, source commit `0fa7969ca377656f5bda32974e789181cec58500`, retained at the Story 3.3 accepted commit `647e7b0a72a373cebeaf07f7361cb8fa310fffea`. It is not Gate 1 evidence. Every constant in [`benchmark/constants.md`](benchmark/constants.md) is `provisional — open, not Gate 1 evidence`, so the three D-9 constant rows (D9-WRITE-ELIGIBILITY, D9-STOP-MARGIN, D9-SET-LOCAL-FLOOR) are `gap` and block. The AD-17 reference manifest is open (index row AD-17, `gap`). The Story 3.3 constants stay provisional; this story changes no value.

## Accepted evidence gaps (AC 3)

| Gap                                                                                   | Index row   | Result         | Accepting source                                                                                                               | Functional outcome |
| ------------------------------------------------------------------------------------- | ----------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| Crash after functional completion and before the audit write (D-6)                    | D-6         | `accepted-gap` | [Spine Deferred D-6](../../_bmad-output/planning-artifacts/architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md) | unchanged          |
| AD-20 row 7: an absent worker summary for a write whose outcome cannot be established | AD-20-ROW-7 | `accepted-gap` | [Spine AD-20 row 7](../../_bmad-output/planning-artifacts/architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md)  | unchanged          |

Recording these gaps changes no functional outcome, response or audit behavior.

## Conflict state and phase-blocking set (AC 5)

No PRD and spine conflict is open: C-1 to C-7 and RI-1 to RI-4 and RI-6 are closed by applied amendments. The three architect items of `sprint-change-proposal-2026-10-01.md` §4.6 were decided in the spine amendment of 2026-10-02 and are evidenced in Stories 1.3, 1.5, 1.6 and 1.7.

Only the D-9 items are phase-blocking:

- the tool input schemas, annotations and token-scope gating, and the L1–L11 link forms, each fixed by its story and proven by fixtures (index rows D9-INPUT-SCHEMAS, D9-ANNOTATIONS, D9-TOKEN-SCOPE, D9-LINK-FORMS; each `unverified`);
- the write-eligibility constants, the stop margin and the `SET LOCAL` floor, each fixed from AD-17 evidence in Story 3.3 (index rows D9-WRITE-ELIGIBILITY, D9-STOP-MARGIN, D9-SET-LOCAL-FLOOR; each `gap`).

## Residuals and non-blocking items (AC 5)

Owner and revisit condition are taken from the accepting source. Where that source names none, the cell says `not named in source`.

| ID                         | Residual                                                                                                                                               | Result       | Owner                                  | Revisit condition                                                                           | Accepting source                                                                                                                                                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ | -------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RI-3a                      | Lost post-commit processing for a commit the attempt cannot establish                                                                                  | accepted-gap | not named in source                    | not named in source                                                                         | [amendment-proposal-residuals-ri1-ri3.md](../../_bmad-output/planning-artifacts/prds/prd-outline-2026-09-20/amendment-proposal-residuals-ri1-ri3.md) (accepted by operator authorization); [epics.md Story 3.4 AC 5](../../_bmad-output/planning-artifacts/epics.md)                   |
| NFR-11-POLICY-CLASS        | NFR-11 exception: the policy class                                                                                                                     | accepted-gap | not named in source                    | not named in source                                                                         | [prd.md NFR-11](../../_bmad-output/planning-artifacts/prds/prd-outline-2026-09-20/prd.md); [epics.md Story 3.4 AC 5](../../_bmad-output/planning-artifacts/epics.md)                                                                                                                   |
| NFR-11-MISSING-ITEM-NAMES  | NFR-11 exception: readability-gated missing-item names                                                                                                 | accepted-gap | not named in source                    | not named in source                                                                         | [prd.md NFR-11](../../_bmad-output/planning-artifacts/prds/prd-outline-2026-09-20/prd.md); [epics.md Story 3.4 AC 5](../../_bmad-output/planning-artifacts/epics.md)                                                                                                                   |
| FR-22-EXCEPTION            | The FR-22 exception                                                                                                                                    | accepted-gap | not named in source                    | not named in source                                                                         | [prd.md FR-22](../../_bmad-output/planning-artifacts/prds/prd-outline-2026-09-20/prd.md); [epics.md Story 3.4 AC 5](../../_bmad-output/planning-artifacts/epics.md)                                                                                                                    |
| DOC-ONLY-REPEATED-FINDINGS | A document-only reader cannot tell repeated missing-item Findings apart                                                                                | accepted-gap | not named in source                    | not named in source                                                                         | [epics.md Story 3.4 AC 5](../../_bmad-output/planning-artifacts/epics.md)                                                                                                                                                                                                              |
| RI-5                       | Stale `server/tools/README.md` and `AGENTS.md` lines; lower-authority wording                                                                          | accepted-gap | a separately authorized companion edit | not named in source                                                                         | [epics.md Story 3.4 AC 5](../../_bmad-output/planning-artifacts/epics.md); [reconcile-applied-prd-spine-alignment.md](../../_bmad-output/planning-artifacts/prds/prd-outline-2026-09-20/reconcile-applied-prd-spine-alignment.md)                                                      |
| D9-ORPHAN-SWEEPER          | The D-9 sweeping of staged blobs orphaned by a process crash                                                                                           | accepted-gap | not named in source                    | only if pilot evidence shows accumulation                                                   | [Spine Deferred D-9](../../_bmad-output/planning-artifacts/architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md)                                                                                                                                                         |
| D9-MIB-CAP                 | The D-9 AD-16 1 MiB cap against the baseline 1,536,000-character limit                                                                                 | accepted-gap | not named in source                    | only if pilot evidence shows a legal document blocked from a complete `lint_wiki`           | [Spine Deferred D-9](../../_bmad-output/planning-artifacts/architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md)                                                                                                                                                         |
| D-8-AUTH-GAPS              | The D-8 baseline authorization gaps that skip collection read or team checks on publication and creation paths, reported separately and not fixed here | accepted-gap | Operator                               | each change requires separate approval, diff and baseline-specific tests                    | [Spine Deferred D-8](../../_bmad-output/planning-artifacts/architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md); [reconcile-applied-prd-spine-alignment.md](../../_bmad-output/planning-artifacts/prds/prd-outline-2026-09-20/reconcile-applied-prd-spine-alignment.md) |
| HTML-CONVERT-ONLY          | The operator option of a convert-only HTML worker                                                                                                      | accepted-gap | Operator                               | not named in source                                                                         | [reconcile-applied-prd-spine-alignment.md](../../_bmad-output/planning-artifacts/prds/prd-outline-2026-09-20/reconcile-applied-prd-spine-alignment.md); [epics.md Story 3.4 AC 5](../../_bmad-output/planning-artifacts/epics.md)                                                      |
| FR-12-CLARIFICATION        | The FR-12 clarification recommended by the spine amendment of 2026-10-02; non-blocking                                                                 | accepted-gap | Wiki operator                          | a one-sentence PRD clarification under separate authorization; does not block               | [Spine Open PRD residuals](../../_bmad-output/planning-artifacts/architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md); [epics.md Story 3.4 AC 5](../../_bmad-output/planning-artifacts/epics.md)                                                                        |
| READ-WITHOUT-READDOCUMENT  | An actor with `read` but without `readDocument` may receive a clean result over the documents it can read when only document rules are enabled         | accepted-gap | not named in source                    | not named in source                                                                         | [epics.md Story 3.4 AC 5](../../_bmad-output/planning-artifacts/epics.md)                                                                                                                                                                                                              |
| DEFAULT-SCOPE-CONTENTION   | A default-scope request whose readable scope holds no configured collection returns the admission-rejection `failed` result under contention           | accepted-gap | not named in source                    | not named in source                                                                         | [Spine Open PRD residuals](../../_bmad-output/planning-artifacts/architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md); [epics.md Story 3.4 AC 5](../../_bmad-output/planning-artifacts/epics.md)                                                                        |
| D-6                        | Durable outbox eliminating the post-commit audit crash window; the crash-before-audit gap                                                              | accepted-gap | not named in source                    | only if pilot evidence gaps are unacceptable without weakening functional failure isolation | [Spine Deferred D-6](../../_bmad-output/planning-artifacts/architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md)                                                                                                                                                         |
| AD-20-ROW-7                | An absent worker summary under AD-20 row 7 is a recorded evidence gap                                                                                  | accepted-gap | not named in source                    | not named in source                                                                         | [Spine AD-20 row 7](../../_bmad-output/planning-artifacts/architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md)                                                                                                                                                          |

## DW-4, DW-5 and DW-6 (AC 8)

No read-only production rollout is authorized until Story 3.3 evidence closes DW-4, DW-5 and DW-6. Closing them authorizes no rollout either, because read-only rollout remains a separately approved Gate 4 decision.

| Item | Ledger                                                                                                      | Story 3.3 evidence                                                                                                                    | State                 |
| ---- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| DW-4 | [deferred-work.md](../../_bmad-output/implementation-artifacts/deferred-work.md): `status: open`            | [dw-4-5-6.md](benchmark/dw-4-5-6.md) smoke record, not Gate 1 evidence                                                                | open                  |
| DW-5 | [deferred-work.md](../../_bmad-output/implementation-artifacts/deferred-work.md): `status: open`            | [dw-4-5-6.md](benchmark/dw-4-5-6.md) smoke record, not Gate 1 evidence                                                                | open                  |
| DW-6 | [deferred-work.md](../../_bmad-output/implementation-artifacts/deferred-work.md): `status: done 2026-10-04` | [dw-4-5-6.md](benchmark/dw-4-5-6.md) held-pool re-run: **fail**, `VALIDATION_RUNTIME_FAILED` after 30004 ms, not `VALIDATION_TIMEOUT` | open, `contradictory` |

DW-4 also has a code change (`spec-dw-4-yield-between-lint-units.md`, accepted commit `17b840d5f5b50a16fa5a735926fd064bb687c8e1`). A code change is not closing evidence; the reference-profile re-run of Story 3.3 criterion 9 is.

## Gate separation (AC 6)

| Gate   | Scope                          | Status       |
| ------ | ------------------------------ | ------------ |
| Gate 2 | Image publication              | unauthorized |
| Gate 3 | Deployment                     | unauthorized |
| Gate 4 | Read-only and enforced rollout | unauthorized |

Each later gate is a separate approval, whether Gate 1 evidence is complete or not. No image is pushed, no environment is changed, no deployment is performed, no pilot policy is mounted and no collection policy is enabled.

## Deferred operational decisions (AC 7)

| OD   | Deferred decision                                                                                           | Owner and revisit gate                            | Value        |
| ---- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------ |
| OD-2 | Actual pilot collections, rules and parameters, identifiers, templates, and fail-open posture (D-1)         | Wiki operator before Gate 4                       | not selected |
| OD-6 | Two supported pilot clients and the restricted Logical Change Batch evidence procedure (D-2)                | Wiki operator before Gate 4                       | not selected |
| OD-7 | Registry, image naming, target environment, change window, backup and restore, and rollback procedure (D-3) | Release operator before Gate 2 or 3 as applicable | not selected |

Source: [Spine Deferred](../../_bmad-output/planning-artifacts/architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md). No environment-specific value is invented.

## Pilot metrics

SM-P1–SM-P7 are deferred to Gate 4. This record claims no pilot evidence and no production success.
