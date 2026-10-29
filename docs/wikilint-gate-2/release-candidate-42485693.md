# Release candidate 42485693 (2026-10-29)

The latest locally built and qualified candidate is source `42485693aa9bdddfeac31011f01137257167f515`. The retained postcommit checks, image smoke and full `shared-host-ssd-v1` performance measurement are complete within their stated scopes. Security disposition is **OPEN**. This record grants no whole-candidate Gate 1 acceptance, native feature closure, publication, deployment, policy activation or risk waiver.

The intended delivery remains a deployed, working fork with usable assistant MCP integrity tools. A documentation change, local image, published image or healthy server alone does not satisfy that outcome.

## Artifact and evidence identity

| Item | Exact identity |
| --- | --- |
| Built source | `42485693aa9bdddfeac31011f01137257167f515` |
| Runtime parent | `c2bcfa1070c20871360c90760aa8fc42f1bd514d` |
| Selected upstream baseline | `v1.10.1^{}` = `4a5a616a21be800257dc11cef4263d0dd0412156` |
| Final local runner image ID | `sha256:c33b509b2d811b8145e159413127cf592db21f04ae5239f4862d757366bf4a45` |
| Image source-export manifest SHA-256 | `f04b7f4e2c455b0805d6a3a6a5b12e923a619fea9ce41e94f2ef2ff64c9d11fe` |
| Current `yarn.lock` SHA-256 | `8c62a80e9a0e4dd611b2aa7c08ab569ccbb64df831e01a4cf2343add69100549` |
| Raw full benchmark manifest SHA-256 | `5c652dedfc14b165279858fb7e6d5f2a90306361b584fe3d541af139a936dc4c` (1,004,982 bytes) |
| Registry digest | Absent; the local image ID is not a registry digest |

The [allowlisted derived qualification summary](qualification-42485693.json) contains the retained receipt hashes and selected results. Original build, test, smoke, advisory, telemetry and raw benchmark receipts remain in the private evidence store. This summary is not a replacement raw manifest or a new execution of any command. A future commit containing these release records must be identified separately from the built source above.

The retained source review returned `APPROVE` for the source candidate preceding these documentation edits. It does not independently approve this documentation candidate. Final documentation review, evidence acceptance and native feature closure belong to the parent controller.

## Retained build and postcommit checks

Both Docker stages used the repository's original base/runner build pattern from the exact committed source export. The pins are `node:26.12.1` and `node:26.12.1-slim`; the package-manager pin is Yarn 4.11.0. Observed build limits were 2 CPU, 8 GiB and no additional swap. The current dependency graph is not the old upstream-lock parity claim in the historical handoff.

The retained postcommit qualification used a separate exact-commit archive and dependency/install state. It records:

| Check group | Retained result |
| --- | --- |
| Benchmark/profile tests | 191 passed |
| Targeted tests | 387 passed |
| Audit control | 2 passed |
| Fresh-database Wiki lint suite | 2,431 passed, 1 expected skip |
| Shared editor suite | 1,201 passed, 9 baseline skips |
| Title tests | 3 passed |
| Full nonincremental type check | Passed |
| Scoped formatting | Passed |
| Lint | Passed, 0 errors and 178 warnings |
| Offline immutable install | Passed |
| Full formatting | **Failed on 6 unchanged baseline files**, separately classified; not fully green |

These counts describe the retained runs only. They do not establish three normalized identical conformance repetitions at this source. No runtime test, build or benchmark was rerun for this prose reconciliation.

The final local image passed all seven S1–S6 checks (S4 has two cases): no-policy startup/migrations/health, read-only example readiness, wrong expected fingerprint, unconfirmed and confirmed enforcement readiness, malformed-policy exit, and packaged artifacts. The smoke used disposable PostgreSQL 16 and Redis. Negative network controls passed; task-owned resources were removed and protected peers were unchanged. Startup/readiness and packaging checks do not prove target UI/API compatibility, assistant connectivity or actual write blocking.

## Current performance evidence

The operator adopted [the `shared-host-ssd-v1` profile](../wikilint-gate-1/shared-host-ssd-v1.md) through AD-17 and Story 3.3 AC2. This is a full production-build run on Linux x86-64, Node 26.12.1/Yarn 4.11.0, with app and same-host PostgreSQL 14.2 each at 2 quota-vCPU/4 GiB, separate nonoverlapping physical-core pairs, and PostgreSQL data on local NVMe SSD. Shared SMT and ordinary host traffic are disclosed; affinity is not exclusive reservation. Fixture access was exclusive and the external window verification covered the no-heavy-work requirement.

The unchanged fixture uses seed `wikilint-ad17-v1`, 3 collections/150 documents and 10 collections/1,000 documents, five warmups and 40 measured samples per case, with paired baseline/enforced controls where required. Nine cases contain 675 sample records. Percentiles use nearest rank; the cold run is the first warmup. All 11 budgets pass:

| Measurement | Observed | Budget |
| --- | --- | --- |
| `lint_document` p95 | 31.324 ms | 1,000 ms |
| `lint_document` semantic departures | 0 | 0 |
| 150-document `lint_wiki` incomplete/timeout runs | 0 | 0 |
| 150-document `lint_wiki` p95 | 242.350 ms | 10,000 ms |
| 1,000-document `lint_wiki` incomplete/timeout runs | 0 | 0 |
| 1,000-document `lint_wiki` maximum (including retained cold run) | 1,845.073 ms | 60,000 ms |
| Create validation overhead p95 | 32.372 ms | 500 ms |
| Replace validation overhead p95 | 37.341 ms | 500 ms |
| Append validation overhead p95 | 34.087 ms | 500 ms |
| Prepend validation overhead p95 | 35.976 ms | 500 ms |
| Patch validation overhead p95 | 31.435 ms | 500 ms |

All three DW checks pass: DW-4 event-loop block 127.599 ms and DW-5 batch serialize/parse 116.857 ms are below the fixed 2,000 ms stop margin. DW-6's held-pool negative control ended after 30,003.909 ms, within the 61,000 ms bound, as `state: failed` with exactly `VALIDATION_RUNTIME_FAILED`; afterward the pool had zero connections in use or waiting. This expected negative control is separate from the successful timed wiki cases.

All four existing constants satisfy their rules without a value change: write eligibility 131,072 Markdown bytes and 1,000 link references, stop margin 2,000 ms, and `SET LOCAL` floor 100 ms. Within-run normalized growth ratios (1,000-document cost per unit divided by 150-document cost per unit) are 0.972 for time/document and time/link, 0.412 for queries/document, and 0.171 for RSS bytes/document. No cross-hardware timing ratio is claimed.

The parent independently recomputed the budgets and verified source/image/fixture identity, counts, DW checks, constants and actual external measurement-window evidence. Its verification is separate and bound to the raw manifest hash above: 85 telemetry records, 69 within the manifest window, maximum capture gap 2.1278879642486572 seconds, all 25 protected peers unchanged, and task-owned resources absent.

The raw manifest remains byte-for-byte unchanged with `controllerWindowEvidence: pending-external-verification`. Its `gate1Eligible: true`, empty deviations and `derivation.gate1: ready` describe harness/profile or derivation results, not whole Gate 1 acceptance. The separate parent receipt supplies external verification without editing the manifest. The default `strict-dedicated-v1` profile, historical [reference manifest](../wikilint-gate-1/benchmark/reference-manifest.json) and earlier failed preparation records remain intact. Preparation failures before the performance entrypoint are not failed budgets or passing benchmark runs.

## Gate 1 integration and remaining literal criteria

The append-only [decision addendum](../wikilint-gate-1/decision-record.md#candidate-42485693-addendum-2026-10-29) and [evidence-index addendum](../wikilint-gate-1/evidence-index.md#candidate-42485693-addendum-2026-10-29) preserve historical structural conformance and source-specific results. The historical `ready` decision applies to its linked revisions, not automatically to this source or its different dependency/runtime graph.

The supplied candidate-bound evidence establishes the local qualification above, but does not establish a complete new Story 3.4 decision. In particular:

- The historical SM-I2 proof and validator use three retained runs with identical normalized per-test names and statuses. Current passing totals do not supply that candidate-bound comparison. No repeat count or normalized trace is inferred.
- A complete current requirement-by-requirement inventory with exact command, source, result and raw location, including the selected-baseline/merge-base and explicit backport inventory, generic-data review, all SM-I and phase-blocking rows, and retained accepted residuals, has not been reassembled and accepted for this candidate. Historical rows remain inspectable at their original scope.
- The documentation candidate still requires fresh independent review and parent acceptance. Author Method checks are self-checks and cannot close either this native feature or the earlier implementation features.

These are evidence/acceptance gaps, not instructions to repeat unchanged runtime suites or the already verified benchmark. The parent must disposition them against the literal [Story 3.4 criteria](../../_bmad-output/planning-artifacts/epics.md#story-34-assemble-the-gate-1-evidence-index-and-decision-record) and [delivery gates](../../_bmad-output/planning-artifacts/prds/prd-outline-2026-09-20/prd.md#11-delivery-and-approval-gates).

## Security disposition remains open

The final-image rematch covers 1,606 package/version tuples: 79 advisory records and 98 package-version/advisory pairs, with 2 critical, 25 high, 36 moderate and 16 low records. These counts are different units, not 79 demonstrated exploitable vulnerabilities and not a clearance. Debian coverage is 91 binary packages/66 source packages, with 184 repeated open/unknown binary rows representing 88 source/advisory pairs; no installed-before-fixed row was found. Open/unknown rows remain unresolved.

The retained corrected inventory comparison establishes graph and OS component-revision equality with the preceding runtime stage; initial raw comparison flags remain preserved and are superseded for that comparison only. This is not parity with the historical upstream lockfile. Patch contents, optional/peer declarations, floating assets and native-addon coverage limits remain. Security synthesis and any bounded residual-risk acceptance remain parent/operator owned; this record does not waive them or treat every advisory as a proven release blocker.

## Publication, deployment and usable integrity tools

The settled registry/access choice is a **private GitHub Container Registry package under the fork owner**. A portable tag proposal is `ghcr.io/<fork-owner>/outline-wikilint:1.10.1-wikilint.42485693`; the exact private proposal is retained separately. This is a proposal, not a pushed tag. Before publication, the parent must settle candidate acceptance and security disposition, record the applicable rollback identifier and explicit artifact-specific operator approval. Only an actual approved push can supply the immutable registry digest and its source association. Do not substitute the local image ID or a later records commit.

**Gate 3 requires separate deployment approval for that exact published digest.** Verify applicable backup, restore and rollback evidence before changing the target; review migration/configuration impact and rollback treatment. Initial deployment is without `WIKI_LINT_CONFIG_PATH`, with health-gated routing. Verify the running digest, migrations, health, real UI/API/auth compatibility, existing MCP tools, audit visibility and unchanged unconfigured-collection behavior.

The actual assistant client must reach the fork's built-in `/mcp` endpoint, discover and exercise `lint_document` and `lint_wiki`. A REST-only wrapper, a direct shell probe or health 200 is insufficient. Deployment with policy inactive is staging toward delivery, not active integrity protection.

**Gate 4 requires separately approved server-side policy and pilot scope.** Validate the policy, enable meaningful read-only linting, repair authorized Errors to a complete zero-Error `lint_wiki` result, then collect the agreed pilot evidence for at least 7 days, 10 declared Logical Change Batches and 2 supported MCP clients. Review the evidence before a separate enforcement approval and post-enable/disable/rollback verification. Read-only tools do not prove write blocking. MCP create/update guards retain priority; new UI/REST enforcement and semantic classification remain out of scope.
