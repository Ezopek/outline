# Issue 1 runtime security implementation record

Status: **IN_REVIEW / PENDING_CONTROLLER**. This bounded implementation record
supplements the accepted product requirements; it is not a canonical BMad spec
kernel, product replan, independent approval, or issue closure.

## Scope and rationale

The source base is `28915b2cf6b1a16a9dd71f932346c35415826c81`, on topic
`security/runtime-issue1-20261028`. [Issue 1](https://github.com/Ezopek/outline/issues/1)
requires a coherent security refresh of the Node 26 builder, runner, and engine
range. The approved correction selects `node:26.12.1` and `node:26.12.1-slim`
and sets only the Node 26 engine branch to `>=26.12.1 <27`.

The supplied official release evidence identifies 26.12.1 as the October 21,
2026 security release. The newer 26.13.0 release, dated October 28, is listed as
Lithium LTS, but the supplied registry checks returned no manifest for
`26.13.0`, `26.13.0-trixie`, or `26.13.0-slim`. The selected 26.12.1 pair has
verified Linux amd64 manifests and completed pulls. This is the latest
security-patched matching pair verified available in those checks, not a claim
that 26.12.1 is the latest Node release. See the
[backport note](../../docs/wikilint-gate-2/runtime-security-refresh.md) for sources
and build instructions.

## Acceptance criteria

| Criterion | Required observation |
| --- | --- |
| AC1 | Builder uses exactly `node:26.12.1 AS deps`; runner uses exactly `node:26.12.1-slim AS runner`. |
| AC2 | The shipped engine accepts 26.12.1 and later stable 26 patches; rejects older 26 versions, prereleases, and 27. |
| AC3 | Non-26 branches remain byte-equivalent: `>=20.12 <21 || 22 || 24 <24.17.0`; representative accepted and rejected boundaries retain behavior. |
| AC4 | Only the two FROM pins and Node 26 engine branch change in production configuration; dependencies, resolutions, lockfile, BASE_IMAGE argument, build stages, and runner behavior remain intact. |
| AC5 | A runnable configuration test fails on the old pins/range, then passes on the approved changes; records clearly separate author checks from pending release gates. |

## Preservation and exclusions

Keep the Debian full/slim variant pattern and the existing two-step
`Dockerfile.base` to `Dockerfile` build using `BASE_IMAGE`. Preserve all other
source and every historical Gate 1, dependency-backport, approval, provenance,
and benchmark artifact byte. Accepted deterministic linting requirements,
authentication, authorization, transaction boundaries, product semantics, and
collection policies remain unchanged. No dependencies, lockfile, authentication,
deployment configuration, or unrelated advisory debt may change. A compatibility
failure requiring such changes must return to the controller for disposition.

## Bounded Method and verification plan

The installed Method catalog identifies BMad 6.12.4 and the installed review
skill. Resolve central configuration and review customization using the installed
Python scripts with bytecode generation disabled. Use the explicitly requested
`edge-case-hunter` and `verification-gap` lenses sequentially as an author Method
check; this does not supply independent review.

Add `scripts/runtimeSecurity.test.cjs` using `node:test`, `node:assert`, and the
actual installed semver package. Read the shipped Dockerfiles and package engine
without application imports, database access, environment files, or services.
Run `node --test scripts/runtimeSecurity.test.cjs` before production edits and
retain assertion-failing RED output and input hashes; then apply the three
configuration edits and retain the exact GREEN run and hashes. Local execution
uses Node 24.22.1, distinct from the target Node 26.12.1 runtime.

The repository's format and lint scripts target application source directories;
this change adds no TypeScript or application code. Use syntax checking and diff
whitespace checks for this CommonJS/configuration slice. Application formatting,
type checking, full suites, image builds, and live-service checks are outside
this worker's gate and remain controller work.

## Pending controller gates

Fresh independent source review; actual builder/base/runner builds and runtime
provenance; immutable dependency compatibility; PostgreSQL 16 and Redis
qualification including S1–S6; advisory provenance and exploit-applicability
assessment; renewed performance/timing and Gate 1 evidence-impact assessment;
and explicit disposition of remaining risks are pending. Changing the runtime
invalidates use of prior timing qualification for the new candidate. No image,
whole-product gate, performance, release, publication, deployment, production
rollout, or issue-closure approval is claimed.
