# AD-17 shared-host reference adoption

Status: adopted environment amendment implemented; author validation is recorded in [the companion](ad17-shared-host-ssd-v1-validation.md). Independent source review and controller evidence acceptance remain pending. This record does not close Story 3.3 or accept a benchmark result.

## Authority and scope

The operator adopted `shared-host-ssd-v1` as an explicitly selected public reference variant alongside the legacy strict dedicated/no-competing-host-traffic profile. The binding amendment belongs in AD-17 and Story 3.3 AC2. Existing requirements and fixtures remain authoritative; this is not a replacement product specification.

Absent selection remains strict (`strict-dedicated-v1`). Unknown or malformed selection and incomplete shared-profile inputs fail closed. Strict attestations and historical manifests, results, constants, and evidence remain unchanged. A false legacy `noCompetingTraffic` still disqualifies strict runs; the shared variant records that false value and requires positive, attributed co-tenancy and finite-window evidence declarations instead.

## Environment and preservation

The shared variant uses Linux x86-64, a production build with the final Dockerfile Node 26.12.1 and packageManager Yarn 4.11.0, app 2 quota-vCPU/4 GiB, and same-host PostgreSQL 14.2 at 2 quota-vCPU/4 GiB on actual local NVMe SSD PGDATA. The app and database each use two different physical cores, with no physical-core overlap between their pairs. Effective app cgroup cpuset is detected; PostgreSQL cpuset, socket/core topology, storage, and their evidence provenance are operator-supplied. Affinity is not exclusive reservation. Shared SMT and ordinary unrelated services/host traffic are explicitly disclosed.

No other client may target the disposable fixture. No concurrent build, backup, render, slicing, or other heavy job is allowed during the finite window. The legacy same-host/local-SSD/no-artificial-latency requirements still apply. No timing-driven policy or budget relaxation is permitted. The seed, both datasets, size/link/hierarchy classes, five warmups/40 samples, nearest-rank p95, all paired Markdown writes, HTML, concurrent writer, held pool/full 60-second deadline, DW-4/5/6, eleven budgets, growth rules, constant derivation, stop margins, and lint semantics remain unchanged.

## Two-stage evidence contract, before timing

1. The harness validates the selected profile, detected app/runtime/database facts, and the structure and consistency of attributed operator metadata. Metadata includes a preflight evidence reference (affinity/topology/storage and attestations), a unique window ID, and a durable telemetry evidence reference declaring a controller capture plan covering CPU, I/O, PSI, memory, device, and network before/during/after. The manifest preserves these declarations, legacy attestation facts, start/end timestamps, source/image identity, and workload eligibility. A planned reference is not proof that capture completed.
2. After the run, the controller must verify the actual preflight evidence and telemetry, its provenance, coverage of the manifest's entire window, fixture isolation and absence of heavy work. It must bind the original manifest's identity and window ID to the retained evidence without rewriting the manifest or erasing deviations. Missing or rejected external evidence prevents final acceptance even when profile/workload eligibility and every budget pass. The public validator performs no host scan, network fetch, or arbitrary execution.

Shared-host results are named for this variant. They are not the old same-hardware reference, and no cross-hardware timing ratios are derived. Within-run dataset growth remains reported. Image publication, deployment, independent review, and full production benchmark acceptance remain separate controller gates.

## Implementation sequence

Use runnable RED → GREEN slices for selection/capture/admission, then manifest wiring. Retain strict positive/negative assertions. Validate the complete targeted benchmark suite, nonincremental types, scoped formatting/lint, then apply the installed BMAD edge-case and verification-gap lenses sequentially as an author check. Record actual receipts, findings, and limitations in the companion validation record.
