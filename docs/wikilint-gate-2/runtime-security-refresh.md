# Node 26 runtime security refresh

Status: **IN_REVIEW / PENDING_CONTROLLER**. This bounded source correction for
[Issue 1](https://github.com/Ezopek/outline/issues/1) replaces the Node 26.3.0
builder and runner with the matching security-patched 26.12.1 pair. Independent
source review and runtime qualification remain pending; this note grants no
release or rollout approval.

## Selected runtime

| Surface | Previous | Selected |
| --- | --- | --- |
| `Dockerfile.base` builder | `node:26.3.0` | `node:26.12.1` |
| `Dockerfile` runner | `node:26.3.0-slim` | `node:26.12.1-slim` |
| Node 26 engine branch | `26 <26.3.1` | `>=26.12.1 <27` |

The [official release index](https://nodejs.org/dist/index.json) supplied for this
change lists 26.13.0, dated October 28, 2026, as the latest Node 26 release and
Lithium LTS. The [26.12.1 release](https://nodejs.org/en/blog/release/v26.12.1),
dated October 21, is the preceding security release. Version 26.12.1 is therefore
not the latest Node release.

Although the [official Docker image catalog](https://github.com/docker-library/official-images/blob/master/library/node)
listed 26.13.0, registry manifest checks supplied for this change reported no
manifest for `node:26.13.0`, `node:26.13.0-trixie`, or `node:26.13.0-slim`.
Both `node:26.12.1` and `node:26.12.1-slim` had Linux amd64 manifests and completed
pulls. They are the latest security-patched matching pair verified available in
those checks. Availability is a point-in-time observation; recheck it before
future runtime changes. Preserve the existing Debian full/slim variant pattern.

The [October security announcement](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
documents runtime and bundled-dependency fixes, including DNS resolution, TLS
hostname verification, Brotli decoding, HTTP connection reuse, snapshot entropy,
ZIP handling, and filesystem permissions. Selecting the patched runtime addresses
the upstream runtime baseline. It does not prove that every advisory is reachable
or exploitable in this application, that every deployment is unaffected, or that
remaining operating-system and application-dependency advisories are resolved.
Those applicability and residual-risk decisions require separate evidence.

## Configuration regression check

With the repository's existing semver dependency installed, run from the repo:

```sh
node --test scripts/runtimeSecurity.test.cjs
```

The test reads the actual shipped Dockerfiles and package engine. It checks exact
pins and stage variants, the supported Node 26 floor and later stable versions,
rejection of older 26 versions and 27, and preservation of every non-26 engine
branch. Future-version probes test range semantics, not image availability.
It imports no application code and requires no credentials or database.
The existing Yarn/Vitest and CI suites do not discover this standalone `.cjs`
test; qualification must run the command explicitly.

Author RED/GREEN execution used Node 24.22.1 and semver 7.8.5. The isolated test
runner in that execution environment reported only a failed child-file envelope;
the assertion runs used the same command with a process-local isolation override:

```sh
NODE_OPTIONS=--test-isolation=none node --test scripts/runtimeSecurity.test.cjs
```

Before the production edits, four tests failed on the old pins and engine and one
passed. After the three edits, all five passed. This standalone configuration
check does not establish application compatibility with Node 24.22.1; its engine
admission remains unchanged and excludes that version. It also does not exercise
the new Node 26.12.1 application runtime.

## Build pattern and remaining qualification

The original build pattern remains intact. Build the dependency/build image,
then pass it to the application Dockerfile through the existing `BASE_IMAGE` arg:

```sh
docker build -f Dockerfile.base -t outline-base:runtime-security .
docker build -f Dockerfile --build-arg BASE_IMAGE=outline-base:runtime-security -t outline:runtime-security .
```

These are reproduction instructions, not executed build evidence. The runner's
user, paths, copied artifacts, storage permissions, health check, entry point, and
other behavior are preserved. Dependencies, resolutions, and the lockfile are
unchanged. Historical source approvals, provenance, Gate 1 records, and benchmark
artifacts are retained byte-for-byte; they describe their original candidates.

The new runtime invalidates reuse of old timing qualification for this candidate.
Fresh image builds, runtime and advisory provenance, immutable-install
compatibility, PostgreSQL 16 and Redis S1–S6 qualification, renewed performance
measurements, Gate 1 evidence-impact assessment, independent source review, and
controller disposition of remaining risks are pending. No image, full-suite,
performance, or whole-product gate is reported as passing here. Publication,
deployment, production rollout, final acceptance, and issue closure remain
separate decisions.
