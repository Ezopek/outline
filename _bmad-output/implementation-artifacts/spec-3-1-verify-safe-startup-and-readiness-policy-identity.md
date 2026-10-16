---
title: 'Story 3.1: Verify Safe Startup and Readiness Policy Identity'
type: 'feature'
status: 'ready-for-dev'
context: []
---

<frozen-after-approval reason="human-owned intent">

## Intent

**Problem:** Story 1.2 loads and fingerprints the policy set at startup, but nothing gates readiness on it. An instance with enforced or invalid policy becomes ready without an operator-confirmed fingerprint, and `/_health` cannot show which policy set an instance serves, so mixed-policy instances can join one rollout.

**Approach:** Add a pure AD-19 readiness rule that compares `WIKI_LINT_EXPECTED_CONFIG_FINGERPRINT` with the startup `policySetFingerprint`. Extend the baseline `/_health` endpoint so it reports only readiness and the fingerprint. Close the AC 5 evidence with collocated fixtures.

## Boundaries & Constraints

**Always:**
- Readiness comes from two inputs fixed at worker startup: the worker's policy set and its inherited `WIKI_LINT_EXPECTED_CONFIG_FINGERPRINT`. An empty value counts as absent, as `WIKI_LINT_CONFIG_PATH` already does. The result is computed once.
- When a value is supplied, readiness requires an exact string match for every policy set. When it is absent, readiness is false if any entry is valid and `enforced`, or is an invalid sentinel. Otherwise it is true.
- `/_health` sets the response header `X-Wiki-Lint-Policy-Set-Fingerprint` on every response. When policy readiness is false, it returns status 503 with no `OK` body, before the DB and Redis checks. When ready, the baseline behaviour (`OK` / 500) is unchanged, so the Dockerfile `HEALTHCHECK` keeps working.
- The policy set, its enforcement, and its fail-closed behaviour are identical whether readiness is true or false.
- The new variable is documented generically in `.env.sample`.

**Never:**
- Expose counts, config status, IDs, rules, parameters, JSON-Pointer paths, or sentinel detail through `/_health`.
- Add hot reload, file watchers, an admin API, or cross-instance coordination.
- Change Story 1.2 log fields or startup-fatal behaviour.
- Ship pilot policy or private identifiers.
- Select an OD-2 or OD-7 value, or publish, deploy, mount, or roll out anything.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No config | path unset, expected unset | empty-set fingerprint header, 200 `OK`, no enforcement | — |
| Read-only only | valid `read_only` entries, expected unset | ready, 200 `OK` | — |
| Enforced, no expected | a valid `enforced` entry, expected unset/empty | 503, header present | policy unchanged |
| Sentinel, no expected | an invalid entry, expected unset | 503 | sentinel still fails closed |
| Match | expected = fingerprint | ready | — |
| Mismatch | expected ≠ fingerprint (any set, incl. empty) | 503 | policy unchanged |
| Two instances | same expected, different sets | only the matching instance is ready | — |
| DB/Redis down, policy ready | — | baseline 500, header present | baseline logging |

</frozen-after-approval>

## Code Map

- `server/wikiLint/core/policySet.ts` -- `PolicySet` / `PolicySetEntry` types (`status`, `policy.activation`). The pure readiness rule belongs here, under the core import boundary.
- `server/wikiLint/adapters/policyConfig.ts` -- master load and operator log (Story 1.2), the base64 export to workers, and memoised `getPolicySet()`.
- `server/main.ts:42,82` -- worker `start()` loads the set; the baseline `/_health` route.
- `server/index.ts:35` -- `master()` loads the policy before forking. throng respawns inherit the master's exported bytes.
- `server/wikiLint/adapters/policyConfig.test.ts` -- already covers each startup-fatal code and location without content, decoding-over-schema precedence ("a grammar violation with an unsupported version"), per-sentinel log fields, and a worker rebuilding the master's set after the file changes.
- `server/wikiLint/policy.example.json`, `.env.sample:42` -- generic example and configuration docs.
- `Dockerfile:49` -- `HEALTHCHECK` greps `OK`, which is why the body stays compatible.

## Tasks & Acceptance

- [ ] `server/wikiLint/core/policySet.ts` -- add `isPolicySetReady(policySet, expectedFingerprint: string | undefined): boolean` as in the matrix -- one pure, deterministic rule.
- [ ] `server/wikiLint/core/policySet.test.ts` -- cover every matrix row of the rule, including a mismatch on the empty set and two different sets against one expected value -- AC 3, 4.
- [ ] `server/wikiLint/adapters/policyConfig.ts` -- add a memoised `getPolicyReadiness(): { ready; policySetFingerprint }` that reads `getPolicySet()` and the env once. Add `applyPolicyReadiness(ctx)`, which sets the header and, when not ready, sets status 503 and returns false -- keeps the route logic testable inside the pipeline's Vitest scope.
- [ ] `server/main.ts` -- call `getPolicyReadiness()` in `start()` next to `getPolicySet()`. In `/_health`, return early when `applyPolicyReadiness(ctx)` is false.
- [ ] `server/wikiLint/adapters/policyConfig.test.ts` -- prove readiness with and without the expected fingerprint. With a fake ctx, prove the response carries only the status, the header and no body detail, and that no planted ID, path or rule text appears. Prove that the absent config and `policy.example.json` are ready without an expected value. Prove that readiness false leaves `getPolicySet()` unchanged. Extend the respawn fixture to assert that the fingerprints are equal -- AC 1, 2, 5, 6.
- [ ] `.env.sample` -- document `WIKI_LINT_EXPECTED_CONFIG_FINGERPRINT`: when it is required, that a mismatch makes `/_health` 503, and that policy changes and disabling enforcement need a read-only mount change and a restart, separate from image rollback -- AC 6.

**Acceptance:** AC 1–7 of the epic entry hold. The new tests, together with the existing Story 1.2 fixtures, are the Gate 1 evidence. There is no OD-2 or OD-7 selection and no deployment action.

## Verification

**Commands:**
- `tsc`: `corepack yarn tsc`
- `oxlint`: `node_modules/.bin/oxlint --type-aware server shared`
- `oxfmt`: `node_modules/.bin/oxfmt --check {changed_files}`
- `vitest`: `node_modules/.bin/vitest run --project server --maxWorkers=2 server/wikiLint server/index.test.ts server/routes/mcp server/tools`
