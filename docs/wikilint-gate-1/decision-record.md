# Gate 1 decision record

This record states the Gate 1 implementation-readiness decision (Story 3.4, AC 2, 3 and 5–8). It is derived from [`evidence-index.md`](evidence-index.md). The collocated test [`gate1EvidenceIndex.test.ts`](../../server/wikiLint/benchmark/gate1EvidenceIndex.test.ts) recomputes the decision and the blocking rows from the index and fails if this record differs.

Story 3.4 assembled this record while Story 3.2 was `backlog`. It is re-assembled after Story 3.2 (DW-51) under the same rules, and is re-assembled again after the Story 3.3 reference run. Gate 1 readiness is separate from Gates 2–4: this record authorizes no image publication, deployment or rollout.

## Decision

Decision: `not ready`

Rule (AC 2): the decision is `ready` only when both hold: (a) every SM-I row and every phase-blocking row is `pass`, and (b) no row of the index is `fail`, `gap`, `unverified` or `contradictory`. Condition (a) is necessary but not sufficient. Any other state is `not ready`, and every blocking row is listed below. No waiver applies. An `accepted-gap` row does not block.

Condition (a) fails on SM-I2, SM-I5 and the three D-9 constant rows. Condition (b) fails on every row listed below.

### Blocking rows

- `NFR-1` — `gap`
- `NFR-2` — `gap`
- `NFR-3` — `gap`
- `NFR-4` — `gap`
- `NFR-5` — `gap`
- `SM-I2` — `contradictory`
- `SM-I5` — `gap`
- `G1-SM-I` — `gap`
- `G1-BLOCKING-DECISIONS` — `gap`
- `AD-17` — `gap`
- `D9-WRITE-ELIGIBILITY` — `gap`
- `D9-STOP-MARGIN` — `gap`
- `D9-SET-LOCAL-FLOOR` — `gap`
- `DW-4` — `gap`
- `DW-5` — `gap`
- `DW-6` — `contradictory`

What each blocker needs, as its source states it:

- NFR-1–NFR-5, SM-I5, AD-17 and the three D-9 constant rows wait for the AD-17 reference run of Story 3.3. Its only retained manifest is a smoke run, and every constant is provisional.
- SM-I2 is `contradictory`: the three retained runs are identical per test, but DW-50 (`status: open`) records one coordinator verify run of the same source that failed 8 tests with 5000 ms timeouts. The ledger says Gate 1 cannot rely on the determinism of the whole suite until that failure is reproduced.
- G1-SM-I follows from SM-I2 and SM-I5. G1-BLOCKING-DECISIONS follows from the three D-9 constant rows.
- DW-4, DW-5 and DW-6 wait for the Story 3.3 reference-profile evidence (AC 8 below).

## Baseline and source provenance (AC 3)

| Item                | Value                                                                                                                                                                                                                        | Index row         | Result | Source                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------ | --------------------------------------------------------------- |
| Exact baseline      | `v1.10.1^{}` / `4a5a616a21be800257dc11cef4263d0dd0412156` (tag object `9686f7264506a910ed87a4ad8704bafd361a3393`)                                                                                                            | G1-BASELINE       | `pass` | [provenance.md](provenance.md) check (a)                        |
| Merge-base          | `git merge-base HEAD upstream/main` printed `4a5a616a21be800257dc11cef4263d0dd0412156`; no merge brought in upstream history (check (c)); the container-block patch-edit fix `c17d2c52b3a9` is excluded (checks (d) and (e)) | S3.2-MERGE-BASE   | `pass` | [provenance.md](provenance.md) checks (a), (c), (d), (e)        |
| Backport inventory  | `none`, confirmed by patch equivalence (check (b), run by the coordinator: `157` = `157` at `2373739c7`, `159` = `159` at `35019faa4`)                                                                                       | S3.2-BACKPORTS    | `pass` | [provenance.md](provenance.md) check (b) and Backport inventory |
| Generic-data review | no hit remains in the reusable scope as integrated (the retained tree plus operator commit `1dc68a904`)                                                                                                                      | S3.2-GENERIC-DATA | `pass` | [conformance.md](conformance.md) Generic-data review            |

Story 3.2 is `done`, accepted at `55fbe63b8c9960b292deeecf646e4e10e572dd8c` ([Coordinator Result](../../_bmad-output/implementation-artifacts/spec-3-2-close-layered-conformance-and-source-provenance-evidence-r2.md)). This re-assembly re-ran none of its runs or checks.

## Startup and readiness fingerprint (Story 3.1)

Story 3.1 is `done` with accepted commit `58a3b2824222d8deb0f91222ebdf1940cb8e7415` ([Coordinator Result](../../_bmad-output/implementation-artifacts/spec-3-1-verify-safe-startup-and-readiness-policy-identity.md)). Its fingerprint and readiness tests, [`policySet.test.ts`](../../server/wikiLint/core/policySet.test.ts), [`policyConfig.test.ts`](../../server/wikiLint/adapters/policyConfig.test.ts) and [`healthCheck.test.ts`](../../server/wikiLint/adapters/healthCheck.test.ts), passed in runs 1–3 of `test:wikilint` retained by Story 3.2, and `server/index.test.ts` passed in V1–V3. The fingerprint result is therefore `pass` (index row AD-19).

## Conformance results

The Story 3.2 conformance evidence is retained in [`conformance.md`](conformance.md), with the requirement map in [`coverage.md`](coverage.md) and the reports under [`raw/`](raw/test-wikilint-run-1.json) (index row S3.2-CONFORMANCE, `pass`):

- Runs 1–3 of `corepack yarn test:wikilint` passed: 2279 passed and 1 expected skip (the Story 3.3 smoke helper) of 2280 each. S1–S3 (shared supplementary) passed 734 of 734 each, and V1–V3 (server supplementary) passed 76 of 76 each. Per command, the three runs have identical per-test names and statuses.
- Every AD-18 layer is traced to a test that a retained command ran (AC 1). Every listed ID has a coverage row (AC 2). The layout and no-skip assertion of `server/wikiLint/layout.test.ts` passed.
- AC 4: every injected dependency is one of the ten seam kinds of AD-18 as amended by the operator decision of 2026-10-24 ([Spine AD-18, Amendment Record row of 2026-10-24](../../_bmad-output/planning-artifacts/architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md)). The three seams the review had left outside the seven kinds are `schedule` (job scheduling), the `AttemptPlan` members (attempt-phase implementations) and `setTimingProbe` (the process timing probe). Index rows AD-18 and NFR-26 are `pass`.
- AC 7: under the operator decision of 2026-10-24, the coordinator ran `corepack yarn build` from the main worktree root at 2026-10-24T12:04:00Z on HEAD `5308b7edfeb13b1b4c645245301b7715c6466b62`. It exited `0` and ended with `Done!`. The earlier exit `1` in the story worktree came from a stray `node_modules/node_modules` symlink, which the coordinator removed before this run. The build was local only and published nothing.
- Every test row of the index whose linked test files passed in all three runs of their command is `pass`, linking the run reports.

## Open deferred-work entries bearing on Gate 1

Statuses are taken from [deferred-work.md](../../_bmad-output/implementation-artifacts/deferred-work.md).

| Entry | Ledger status     | Where it applies                                                                                                                                                                                                                                                                                                                                                                          |
| ----- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DW-4  | `open`            | index row DW-4 (`gap`); AC 8 below                                                                                                                                                                                                                                                                                                                                                        |
| DW-5  | `open`            | index row DW-5 (`gap`); AC 8 below                                                                                                                                                                                                                                                                                                                                                        |
| DW-6  | `done 2026-10-04` | index row DW-6 (`contradictory` with the Story 3.3 held-pool re-run); AC 8 below                                                                                                                                                                                                                                                                                                          |
| DW-13 | `open`            | index row FR-7 (`pass`). Its finding F-5, a collection revoked between lookup and snapshot, was accepted as contract behavior under AD-16 and the action item withdrawn ([epic-1-retro-2026-10-03.md](../../_bmad-output/implementation-artifacts/epic-1-retro-2026-10-03.md) F-5). The ledger still shows it open, so it is recorded here and is not an accepted residual of this record |
| DW-50 | `open`            | index row SM-I2 (`contradictory`). The failing verify run timed out in `server/queues/tasks/DocumentPublishedNotificationsTask.test.ts` and `server/wikiLint/adapters/auditEvents.test.ts`. The rows that link `auditEvents.test.ts` (FR-19, FR-21, NFR-14, NFR-17, AD-14) rest on the three retained runs, in which it passed                                                            |

## AD-17 benchmark manifest

The only retained manifest is the Story 3.3 smoke manifest [`benchmark/smoke-manifest.json`](benchmark/smoke-manifest.json): `gate1Eligible: false`, `derivation.gate1: not ready`, source commit `0fa7969ca377656f5bda32974e789181cec58500`, retained at the Story 3.3 accepted commit `647e7b0a72a373cebeaf07f7361cb8fa310fffea`. It is not Gate 1 evidence. Every constant in [`benchmark/constants.md`](benchmark/constants.md) is `provisional — open, not Gate 1 evidence`, so the three D-9 constant rows (D9-WRITE-ELIGIBILITY, D9-STOP-MARGIN, D9-SET-LOCAL-FLOOR) are `gap` and block. The AD-17 reference manifest is open (index row AD-17, `gap`). The Story 3.3 constants stay provisional; this record changes no value.

## Accepted evidence gaps (AC 3)

| Gap                                                                                   | Index row   | Result         | Accepting source                                                                                                               | Functional outcome |
| ------------------------------------------------------------------------------------- | ----------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| Crash after functional completion and before the audit write (D-6)                    | D-6         | `accepted-gap` | [Spine Deferred D-6](../../_bmad-output/planning-artifacts/architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md) | unchanged          |
| AD-20 row 7: an absent worker summary for a write whose outcome cannot be established | AD-20-ROW-7 | `accepted-gap` | [Spine AD-20 row 7](../../_bmad-output/planning-artifacts/architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md)  | unchanged          |

Recording these gaps changes no functional outcome, response or audit behavior.

## Conflict state and phase-blocking set (AC 5)

No PRD and spine conflict is open: C-1 to C-7 and RI-1 to RI-4 and RI-6 are closed by applied amendments. The three architect items of `sprint-change-proposal-2026-10-01.md` §4.6 were decided in the spine amendment of 2026-10-02 and are evidenced in Stories 1.3, 1.5, 1.6 and 1.7. The AD-18 amendment of 2026-10-24 (ten seam kinds) changed no identifier, binding or adopted status.

Only the D-9 items are phase-blocking:

- the tool input schemas, annotations and token-scope gating, and the L1–L11 link forms, each fixed by its story and proven by fixtures that passed in the retained runs (index rows D9-INPUT-SCHEMAS, D9-ANNOTATIONS, D9-TOKEN-SCOPE, D9-LINK-FORMS; each `pass`);
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
