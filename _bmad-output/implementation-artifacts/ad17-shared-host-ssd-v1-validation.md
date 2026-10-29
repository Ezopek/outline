# AD-17 shared-host variant: validation and traceability

Status: source implementation and Method author checks complete; independent review and controller acceptance pending. This record does not accept a performance result or close a story, issue, or delivery gate.

## Method and authority

The actual installed BMAD 6.12.4 catalog, build instructions, review skill, customization and both requested lens instructions were inspected. The existing SPEC, final PRD measurement requirements, AD-17 and Story 3.3 supply the approved requirements. The frozen assignment authorizes a bounded environment amendment and explicitly excludes product replanning, a replacement canonical specification, status closure and independent reviewer selection. The installed review lenses `edge-case-hunter` and `verification-gap` were applied sequentially as a Method author check. The customization resolver could not use its default readonly cache, so the shipped defaults were read directly, as the skill documents; neither team nor personal review override exists. This is not independent review or final controller acceptance. There is no claimed standalone Method validation CLI.

The adoption and two-stage evidence contract were written before timing in `ad17-shared-host-ssd-v1.md`. Only AD-17 and Story 3.3 AC2 receive planning amendments. Other decisions, stories, completed evidence, runtime pins, dependencies, generator, constants, derivation, statistics and historical evidence are preserved.

## Runnable RED → GREEN evidence

Isolated validation uses Node 26.12.1 and PostgreSQL 14.2, a fresh reset/migrated synthetic database for each server request, and readonly source snapshots. Request receipts retain exact source SHA-256 values and full logs; receipt names below identify those artifacts without embedding private infrastructure details.

| Slice | RED evidence | GREEN evidence | Interpretation |
| --- | --- | --- | --- |
| Selection/capture | `01-selection-red`: 6 expected assertion failures, 26 legacy tests pass | `02-selection-green`: 32/32 pass | Strict default/explicit selection, shared capture, malformed/unknown selectors |
| Affinity/topology | `03-affinity-red`: 18 expected affinity assertion failures; topology parameterization defect discovered; corrected `04-topology-red`: 23 expected assertion failures, 93 pass | `05-affinity-green`: 116/116 pass | Actual app cpuset plus attributed PG cpuset/socket-core map; overlap, missing/malformed data, positive distinct sockets |
| Manifest/workload | `06-manifest-red`: two expected assertions plus a policy-identity fixture error; `07-manifest-red-retry`: two expected assertions plus a foreign-key cleanup error (neither fixture error counts as behavior RED); corrected `08-manifest-red-cleanup`: three expected assertion failures, 28 pass | `09-manifest-green`: 31/31 pass | Actual strict and shared manifests, serialized provenance/pending status and shared-only seed enforcement |
| Additional token boundaries | `10-provenance-boundary-red`: 120/120 pass, so this is a negative-control run, not RED | No implementation change needed | Trailing-newline evidence tokens/PG cpusets were already rejected; the suspected anchor issue was disproved |
| Method finding repair | `15-label-red`: one expected assertion failure, 30 pass; the serialized smoke label omitted pending controller evidence | `16-final-suite-green`: 191/191 pass across six files | A single shared-profile/pending-evidence prefix now applies to every shared label, independently of eligibility; strict labels are unchanged |

The topology parameterization defect initially passed a single row instead of the intended array into admission. Correcting the test exposed five additional real behavior failures before implementation. The manifest fixture initially chose a new seed in a process already serving an immutable policy set; cleanup then encountered a real foreign-key constraint. The corrected test deletes only its own events, collections, documents and teams in dependency order, then reuses its seed/policy identity. Neither test correction weakens the production policy guard or changes generator behavior. No recorded server receipt so far reports unexpected asynchronous errors. Logs include existing synthetic event warnings, Node localStorage experimental warnings and dependency sourcemap warnings; these are not asserted to be warning-free runs.

## Obligation traceability

| Adopted obligation | Implementation / verification |
| --- | --- |
| Absent/explicit strict compatible; false legacy attestation still ineligible | `referenceProfile.ts` selector and original attestation loop; unchanged original strict fixture/assertions plus explicit/default/false controls |
| Valid explicit shared selection; no silent fallback | Shared-only schema and legacy-false check; selector and metadata controls in `referenceProfile.test.ts` |
| Honest co-tenancy, attributed facts, local NVMe PGDATA | Strict metadata schema, `source: operator`, positive attestations and preflight reference; storage/type/provenance controls |
| App detected cpuset, actual attributed PG cpuset, distinct physical-core pairs | Bounded pair parser and topology consistency check; absent, malformed, duplicated, overlapping logical/physical pairs and multi-socket controls |
| Platform/build/exact runtime/PG/quota/memory/same-host/no artificial latency | Common legacy checks plus shared final runtime pins; common requirement mutation controls for shared |
| Fixture exclusivity/no heavy work and complete telemetry plan provenance | Required positive declarations, controller collector/window/reference/capture-plan/coverage schema; missing/false/type/provenance controls; final actual evidence remains external |
| Real manifest wiring, eligibility separate from budget/acceptance | Real harness smoke integration and serialization assertions; entrypoint forwards process environment through the existing `runBenchmark` path |
| Same seed/full workloads/held-pool requirement | Shared-only full seed guard and existing `runDeviations` requirements; smoke, partial/full and overridden held-pool controls |
| No budget/growth/derivation/semantics/history relaxation | Source preservation check and complete targeted benchmark suite; shared naming and two-stage acceptance documentation |

## Method author review

The complete candidate was staged as a unified diff, including all seven modified tracked files and all three new documents. No unrelated pre-existing untracked evidence was included as candidate work. Each lens saw that candidate; execution was sequential with no descendants.

The edge-case lens enumerated selection, JSON/schema/provenance, bounded cpuset token/range/cardinality, socket/core identity, common environment, shared-only legacy-attestation exception, full/smoke/seed/workload/held-pool and manifest branches, including the added test cleanup and call signatures. The second boundary pass found no unhandled admission path. The deletion pass confirmed strict requirements and labels remain established and no unrelated decision was retired. No separate claims file was supplied. Findings: `[]`.

The verification-gap lens searched the whole repository for the changed symbols and callers (`captureEnvironment`, `profileDeviations`, `runDeviations`, `runBenchmark`, `controllerWindowEvidence`), then read the profile tests, real harness tests, production entrypoint and optional retained-smoke entrypoint. It found one output-verification gap:

```json
{
  "lens": "verification-gap",
  "location": "server/wikiLint/benchmark/harness.ts:1558 (initial candidate)",
  "trigger_condition": "Eligible shared label can lose its variant name without the real smoke-path test failing.",
  "guard_snippet": "Apply one shared-profile and pending-evidence prefix independently of eligibility; assert it in real smoke serialization.",
  "potential_consequence": "A full shared run could be printed as an unqualified legacy reference.",
  "gap_shape": "regression-gap",
  "consumer": "server/wikiLint/benchmark/run.ts: main manifest serialization and stdout label",
  "evidence": "harness.test.ts observes shared smoke serialization; referenceProfile.test.ts proves eligibility separately, not eligible manifest labeling."
}
```

Triage: repaired in scope. The label prefix now uses one shared-profile branch for eligible, smoke and deviating runs; the existing strict label selection remains unchanged. The real serialized-output assertion reproduced the missing pending message before repair (`15-label-red`). Rechecking the repaired construction removes the duplicated eligible-only shared naming path. All other adopted obligations trace to the checks above or the explicitly external controller acceptance stage. Full production performance and actual telemetry continuity are outside this author test run, not claimed automated coverage.

No verification gaps found.

## Verification and limitations

The first complete targeted run (`11-complete-benchmark-suite`) passed 191/191 tests across all six allowed benchmark test files; `12-types`, `13-format` and `14-lint` passed (format CHECK only; lint zero warnings/errors). Final repeated gates after the Method repair also passed: `16-final-suite-green` (191/191, six files, no unexpected async errors), `17-final-types` (nonincremental type check, exit 0), `18-final-format` (CHECK only, all five entrypoint/profile/harness TypeScript files formatted), and `19-final-lint` (five files, zero warnings/errors). Receipts bind the executed source hashes; full logs were read. The original strict `referenceProfile.test.ts` bytes remain an exact prefix of the updated file, and all prior harness assertions are retained. A hash comparison of all 3,047 tracked baseline files found no changed bytes outside the source whitelist; runtime pins, historical evidence, fixture generator, constants, derivation, statistics and `run.ts` remain unchanged. Profile-document links resolve. HEAD and the unstaged index remain at the starting state. These preservation checks concern source/evidence bytes, not a claim that every operational artifact is approved.

External topology/storage/preflight and before/during/after telemetry verification cannot be proven by metadata shape checks. The controller must bind actual artifacts to the original manifest and reject missing or contradictory evidence. No full production benchmark, image build/publication, deployment, independent review or performance acceptance is performed by this author validation. No story or issue status is closed.
