# Issue 1 runtime security validation record

Status: **IN_REVIEW / PENDING_CONTROLLER**. This is an author Method check of the
[bounded implementation record](spec-runtime-issue1-security.md), configuration,
test, and [backport note](../../docs/wikilint-gate-2/runtime-security-refresh.md).
It is not independent review, release approval, or issue closure.

## Executed configuration evidence

The assertion RED run preceded production changes: exit 1, four assertion-failing
tests on the old builder pin, runner pin, rejected target version, and admitted
old Node 26 version; one non-26 preservation test passed. The exact GREEN
invocation after the three production substitutions exited 0: five tests passed,
none failed or skipped. The test bytes were identical between those runs.

Both assertion runs used Node 24.22.1, the actual semver 7.8.5 package, and
`NODE_OPTIONS=--test-isolation=none node --test scripts/runtimeSecurity.test.cjs`.
The process-local flag exposes assertions in the author's constrained execution
environment. The initial default-isolation run reported only a failing file
envelope and is retained as a harness failure, not counted as RED. No persistent
configuration was changed. Raw output, exit codes, input hashes, and output hashes
are retained in the private execution evidence.

After the fix, the default-isolation command also exited 0, reporting one file
result rather than the five inner test results. This is separate harness evidence;
the retained nonisolated GREEN exposes the five actual passing assertion tests.
`node --check scripts/runtimeSecurity.test.cjs` and `git diff --check` exited 0.

## Installed Method and review scope

The installed catalog reports BMad 6.12.4. Central configuration and
`bmad-review` customization were resolved successfully with the installed
`resolve_config.py` and `resolve_customization.py` scripts using `python3 -B`.
There are no additional activation steps, persistent facts, review directives,
or completion hooks in the resolved review customization. The requested lenses
are `edge-case-hunter` and `verification-gap`; their installed instructions are
read and applied sequentially under the skill's documented fallback. The review
covers the complete bounded diff, including newly created files. This is an
author review; independent source review and controller acceptance remain pending.

## Sequential author review findings

The edge-case lens completed path enumeration, boundary recheck, deletion check,
and a subsequent claims check. It traced file/JSON failures, both Docker stage
sets, engine floor/upper-major/prerelease branches, preserved non-26 admission,
and the actual called APIs. It found no unhandled path or falsified claim in the
bounded diff. Its native findings array is `[]`.

The verification-gap lens traced configuration consumers, read the actual test,
searched the repository by engine, image, build-argument, and test references,
then read the package scripts, Vitest selectors, and CI invocations. It retained
one finding. The native combined findings are:

```json
[
  {
    "lens": "verification-gap",
    "location": "scripts/runtimeSecurity.test.cjs:1",
    "trigger_condition": "Routine Yarn/Vitest and CI test paths do not discover the standalone configuration regression suite.",
    "guard_snippet": "Run node --test scripts/runtimeSecurity.test.cjs explicitly as a controller qualification gate; automatic CI integration requires separate scope.",
    "potential_consequence": "A future image-pin or engine-floor regression can pass the existing routine test commands without executing these assertions.",
    "gap_shape": "broken-verification-gap",
    "consumer": "package.json:31-35 and .github/workflows/ci.yml:107,137",
    "evidence": "The actual configuration assertions are in scripts/runtimeSecurity.test.cjs:15-79. Package scripts use Vitest; vitest.config.ts:71,94,104,118 includes only server/plugins/app/shared TS/TSX tests. The CI lines invoke those Yarn suites, not this standalone command. Repository reference searches found the explicit new command in bounded records, not an existing automated test entry point."
  }
]
```

Disposition: **OPEN / PENDING_CONTROLLER**. The explicit command is documented
and has executed RED/GREEN evidence. Automatic integration would exceed the
approved production change of two pins and one engine branch, so it is not added
here. The controller must execute this configuration gate explicitly and decide
whether future automation needs separate scope. No production correctness defect
requiring a within-scope repair was reproduced. Author review outcome: **COMMENT**;
it is not independent source approval. There is no overlap to deduplicate between
the two lenses.

## Acceptance traceability and preservation

| Criterion | Author evidence | Remaining boundary |
| --- | --- | --- |
| AC1 | Both exact image/stage assertions pass against shipped Dockerfiles. | Actual built-image/runtime provenance pending. |
| AC2 | Real semver evaluates floor, later stable 26 probes, old 26, prereleases, and 27. | Node 26.12.1 application compatibility pending. |
| AC3 | Original non-26 branch text and accepted/rejected boundaries pass unchanged. | No other runtime branch is newly qualified. |
| AC4 | Comparison against the concrete base proves exactly three production substitutions. All 3,040 other initially tracked files match their starting hashes. | Final source and historical-evidence preservation remain independently observable controller checks. |
| AC5 | Four assertion failures precede production changes; identical test bytes then pass all five tests. Syntax and diff whitespace checks pass. | Standalone suite must be invoked explicitly; independent review and runtime gates pending. |

Coherence check: the implementation record, shipped pins/range, test expectations,
backport rationale, supplied release/availability evidence, and stated pending
gates agree. No historical record was rewritten to match the new runtime.
The source diff preserves the entire Dockerfiles except their approved FROM
pins and the entire package file except the approved Node 26 branch. The lockfile
SHA-256 remains
`8c62a80e9a0e4dd611b2aa7c08ab569ccbb64df831e01a4cf2343add69100549`.
The review corpus was stored with private execution evidence rather than a
system-temp location to honor the assignment's narrower output boundary.

## Pending controller evidence

Independent source review, real images and runtime provenance, immutable-install
compatibility, PostgreSQL 16 and Redis S1–S6 qualification, advisory applicability,
renewed timing/performance qualification, Gate 1 impact, and residual-risk
disposition remain pending. No previous candidate's qualification establishes
these gates for this runtime. No publication, deployment, or final acceptance is
authorized by this author record.
