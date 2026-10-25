---
title: 'DW-58: Give the server test project a 20-second test timeout'
type: 'bugfix'
created: '2026-10-25'
status: 'in-progress'
baseline_revision: 'e5e16ec2588982ca674540100ae24186d1fc1081'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<frozen-after-approval reason="human-owned intent">

## Intent

**Problem:** The `server` Vitest project runs under Vitest's default 5000 ms test timeout. In a passing reset-first `yarn test:wikilint` run on the developer host (2026-10-25), 15 tests already take 1.5–11 s, most of them because they wait on purpose for a 2-second bound (the COMMIT probe, response assembly, enrichment deadlines) or read 100+ documents (`wikiReader.test.ts` keyset tests, 2.1–2.8 s). Their headroom is two to three seconds, so the suite is not deterministic across hosts (DW-50, SM-I2):
- On the developer host, one reset-first run of three timed out 8 tests in `documents.enforcement.test.ts` and `documents.responses.test.ts` while VS Code Server installed extensions on the same WSL host; 26 other fresh-database runs passed.
- On `ezopnas` (containers, PostgreSQL 14.2, Node 26.3.0, 8 CPU), three of three fresh-database runs failed: 9–11 tests in `wikiReader.test.ts` (three keyset tests timed out at 5000 ms, and later tests in the file recorded statements of the timed-out ones still running) and, in one run, two in the upstream `GroupMentionedInCommentNotificationsTask.test.ts`; the runs took 428–534 s against about 200 s.
The original DW-50 failure also timed out upstream fixture writes (`buildUser`, `buildRow`) at 5000 ms.

**Approach:** Set `testTimeout: 20000` on the `server` project in `vitest.config.ts` (operator decision 2026-10-25), with a short comment naming the reason.

## Boundaries & Constraints

**Always:**
- The change is one `testTimeout: 20000` entry in the `server` project's `test` block of `vitest.config.ts`, with a one- or two-line comment in the file's style: the server tests include deliberate 2-second waits and DB-heavy fixtures, and 5 s left too little headroom on slower or busy hosts (DW-50, DW-58).
- Explicit per-test timeouts that are already larger stay as they are.

**Never:**
- Do not change any other project's timeout, `hookTimeout`, `teardownTimeout`, the pool, `maxWorkers`, `fileParallelism` or any other Vitest setting.
- Do not change any test, any assertion or any production code; do not skip or retry tests.
- Do not edit `package.json`, the deferred-work ledger, the sprint board or this spec.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Slow host | a server test that needs 6 s | it passes instead of timing out | none |
| Hanging test | a server test that never settles | it still fails, at 20 s | none |
| Other projects | `app`, `shared-*` tests | default timeout unchanged | none |

</frozen-after-approval>

## Code Map

- `vitest.config.ts` -- the `server` project (`name: "server"`), its `test` block.

## Tasks & Acceptance

**Execution:**
- `vitest.config.ts` -- add the timeout and its comment.

**Acceptance Criteria:**
- Given the config, when the server project runs, then its test timeout is 20000 ms and every other project keeps the default.
- Given the verify suites, when they run against a fresh test database, then every test passes.

## Spec Change Log

## Review Triage Log
