# Shared-host SSD reference profile v1

`shared-host-ssd-v1` is an explicitly selected AD-17 reference variant. It does not replace the default legacy `strict-dedicated-v1` dedicated/no-competing-host-traffic profile or reinterpret historical results. This document defines reproducibility and eligibility; it contains no benchmark results or final acceptance claim. The adopted authority is AD-17 in the Architecture Spine and Story 3.3 AC2; the narrow [decision record](../../_bmad-output/implementation-artifacts/ad17-shared-host-ssd-v1.md) explains preservation and validation scope.

## Fixed environment and workload

Use Linux x86-64, a production build with `NODE_ENV=production`, exactly Node 26.12.1 from the final Dockerfile runner and packageManager Yarn 4.11.0. The app has 2 quota-vCPU/4 GiB. PostgreSQL is exactly 14.2 on the same host with 2 quota-vCPU/4 GiB and PGDATA on actual local NVMe SSD, not default RAID or tmpfs. Retain evidence identifying the actual backing device and its PGDATA mount. Same-host, local-SSD and no-artificial-latency attestations remain required.

Pin each container to two logical CPU IDs representing two distinct physical cores. The app and PostgreSQL pairs must share neither logical CPUs nor physical `(socket, core)` identities. Shared SMT siblings and ordinary unrelated host services/traffic are allowed and disclosed; cpuset affinity is not exclusive allocation. The harness reads the app's effective cgroup cpuset (v2 or v1); an operator supplies PostgreSQL's actual effective cpuset and the four assigned logical CPUs' socket/core map with a preflight evidence reference. Capture container settings and host topology in that evidence. Do not infer exclusivity from affinity or claim the operator topology is kernel detection by the harness.

Only the benchmark client, including its designed concurrent writer, may target the disposable fixture. No other client may access it. During the finite benchmark window, run no build, backup, render, slicing, or other heavy job. Ordinary unrelated traffic remains disclosed. The controller verifies these operational declarations against the actual window evidence.

The seed is `wikilint-ad17-v1`. Keep both 3-collection/150-document and 10-collection/1,000-document profiles, size/link/hierarchy/rule/resolution classes, five warmups and 40 samples, nearest-rank p95, paired Markdown create/all update modes, HTML separately, concurrent writer, held pool at the full 60-second deadline, DW-4/5/6, all eleven budgets, growth/constant derivation and stop margins unchanged. Eligibility does not imply budgets pass. Timing never changes lint semantics or permits policy/budget relaxation.

## Selection and inputs

Run the existing production entrypoint through Yarn after provisioning a fresh migrated disposable database and obtaining the existing seed authorization. Keep the legacy operator inputs for PG CPU/memory, image digest and source commit and the same-host/local-SSD/no-artificial-latency attestations documented in the [benchmark README](../../server/wikiLint/benchmark/README.md).

Set `WIKILINT_BENCH_REFERENCE_PROFILE=shared-host-ssd-v1` and pass `WIKILINT_BENCH_SHARED_HOST_METADATA` as JSON. Keep `WIKILINT_BENCH_ATTEST_NO_COMPETING_TRAFFIC=no` (or absent): its captured boolean remains false. Setting it to `yes` contradicts this variant and is ineligible. The positive shared-profile declarations replace only that legacy admission condition for this explicitly selected variant. Strict runs still require all four original attestations, including `noCompetingTraffic=yes`.

The following is a hypothetical schema example, not an attestation about a real machine or an already captured window. Replace the CPU IDs, topology, unique window ID and evidence references with verified operator inputs. CPU sets support Linux comma/range notation and must name exactly two different CPUs each. The topology contains exactly the four assigned CPUs. IDs are nonnegative integers at most 1048575; the bounded CPU-set parser never expands an unbounded range.

```json
{
  "schemaVersion": 1,
  "source": "operator",
  "coTenancy": "shared-smt-ordinary-host-traffic",
  "preflightEvidenceRef": "evidence:preflight-001",
  "postgresCpuset": "4-5",
  "cpuTopology": [
    { "cpu": 2, "socket": 0, "core": 2 },
    { "cpu": 3, "socket": 0, "core": 3 },
    { "cpu": 4, "socket": 0, "core": 4 },
    { "cpu": 5, "socket": 0, "core": 5 }
  ],
  "storage": "local-nvme-ssd",
  "attestations": {
    "affinityPinned": "yes",
    "coTenancyDisclosed": "yes",
    "fixtureExclusive": "yes",
    "noHeavyWork": "yes",
    "pgdataOnLocalNvme": "yes"
  },
  "telemetry": {
    "collector": "controller",
    "windowId": "benchmark-001",
    "evidenceRef": "evidence:telemetry-001",
    "capture": "planned-before-during-after",
    "coverage": ["cpu", "io", "psi", "memory", "device", "network"]
  }
}
```

All fields are required; unknown keys, other literal values, malformed JSON and missing/empty provenance fail closed. `coverage` uses the exact ordered list above. Evidence references and window IDs are opaque 1–240 character tokens: start with an ASCII letter/digit and then use letters, digits, `.`, `_`, `:`, `/`, `#`, or `-`. They are never fetched or executed by the public validator. Retain the referenced artifacts durably outside the source tree as appropriate for the operator's evidence store; a syntactically valid token alone proves no evidence exists.

Absent selection defaults to strict. Empty, unknown, case-changed or whitespace-padded selectors are deviations, never a fallback to eligible strict. Shared metadata is validated only for the explicit shared selector; extra shared declarations cannot excuse any strict deviation. Invalid/missing variant inputs, wrong platform/runtime/PG/resources/storage/same-host facts, bad or overlapping affinity/topology, or absent fixture/heavy-work/provenance declarations disqualify shared runs. All legacy deviation records remain intact.

## Two stages of evidence

Before starting, the controller assigns a unique `windowId` and durable `evidenceRef`, captures preflight evidence and begins before-window telemetry. The metadata states a **plan**, using `capture: planned-before-during-after`; it must never pretend that future during/after capture has already completed. Telemetry must cover host CPU, I/O, PSI, memory, backing device and network, with timestamps before, throughout and after the finite run. The controller chooses and records the collection method/cadence and checks continuity; the harness neither scans the host nor launches a collector.

The harness validates detected environment facts plus metadata shape and consistency. Its original JSON manifest preserves selected `referenceProfile`, operator metadata, false legacy attestation, source/image/fixture identity and start/end timestamps. `gate1Eligible` means only that the full workload and selected profile have no harness-detectable deviations; all-budget PASS is a separate verdict. For every shared run `controllerWindowEvidence` remains `pending-external-verification`, including smoke and deviating runs. Invalid JSON is retained as null and produces a deviation; successfully parsed declarations remain visible even if rejected.

After completion, the controller must verify the actual artifacts and their provenance, bind the manifest's digest, source/image identity, window ID, timestamps and telemetry reference to those artifacts, and establish before/during/after coverage without gaps that undermine the claim. Verify affinity/topology/PGDATA facts, fixture isolation and no heavy work. Missing capture, unresolved provenance, contradictory operational evidence or rejected window evidence prevents final acceptance even if `gate1Eligible` and every budget pass. Keep that acceptance/rejection as a separate evidence record; never alter emitted JSON, turn a plan into a completed-capture claim, erase deviations or retroactively rewrite historical strict evidence.

A smoke run, reduced/partial workload or overridden held-pool run remains ineligible under the existing rules. Derivation remains the unchanged harness calculation; any shared-profile derived status is still subject to final controller evidence acceptance. There is no new acceptance automation or invented validation command. Independent source review, local image validation, a full production benchmark, publication and deployment remain separate gates.

Report shared results under their profile name. They are not the old same-hardware reference and must not be used for timing ratios against older strict runs on other hardware. The harness's dataset growth ratios compare the two sizes within the same run and remain required.
