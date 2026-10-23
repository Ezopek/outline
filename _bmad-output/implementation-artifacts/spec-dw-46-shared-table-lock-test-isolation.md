---
title: 'DW-46: Keep the lock-timeout test from queueing other workers behind a table lock'
type: 'bugfix'
created: '2026-10-24'
status: 'ready-for-dev'
baseline_revision: 'cf2412fb2e912a87b7cb735ba716ba786fc18e61'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<frozen-after-approval reason="human-owned intent">

## Intent

**Problem:** `documentReader.test.ts` "times out behind an exclusive lock held by another transaction" (`server/wikiLint/adapters/documentReader.test.ts:933-960`) sends `LOCK TABLE documents IN ACCESS EXCLUSIVE MODE` on the test database that both `yarn test:wikilint` workers share. When the statement arrives while the other worker holds an open transaction on `documents`, it waits in PostgreSQL's lock queue behind that transaction, and every later read of `documents` from any connection waits behind it. `enforcedWrite.concurrency.test.ts` "COMMIT outcomes" holds the enforcement transaction open for about 2.5 s on purpose, so its COMMIT probe (`SELECT id FROM documents WHERE id = :id`, bounded by `COMMIT_PROBE_BOUND_MS`) waits past its bound and returns `unavailable`. The test "ends in row 7 when COMMIT hangs past its timer and the probe finds no row" then fails at `:713` with `expected undefined to deeply equal []`. This made Story 3.2's three retained runs non-identical (DW-46).

**Approach:** Acquire the lock without ever waiting in the queue: send `LOCK TABLE documents IN ACCESS EXCLUSIVE MODE NOWAIT` and, when it fails with `lock_not_available`, retry from a fresh transaction until it is granted or a bounded retry budget runs out. Hold the lock only for the two reads the test makes, as today. The test's proof is unchanged: both reads fail with a database timeout behind a lock held by another transaction.

## Boundaries & Constraints

**Always:**
- The test keeps proving, against the real PostgreSQL, that `readDocumentSnapshot` and `authorizeLintTarget` each reject with an error for which `isDatabaseTimeout` is true while another transaction holds the lock, and keeps its existing assertions.
- Only an error whose PostgreSQL code is `55P03` (`lock_not_available`) is retried. Any other error from the lock statement or from a rollback fails the test at once.
- A failed `NOWAIT` attempt rolls back its transaction before the next attempt, and the holder transaction is rolled back in `finally` as today.
- Once granted, the lock is held only for the two reads, each under its existing 400 ms `Deadline`, and released right after them. A read of `documents` from another worker that arrives in that window waits at most about 800 ms plus overhead, which stays well inside `COMMIT_PROBE_BOUND_MS` (2000 ms). This residual is accepted; the defect was the unbounded queue wait behind another worker's open transaction, not the bounded hold.
- The retry budget is bounded. If it runs out, the test fails with an error that says the lock could not be acquired; it never passes without having held the lock.
- The change stays in `server/wikiLint/adapters/documentReader.test.ts`, following the file's conventions.

**Never:**
- Do not change production code, `deadline.ts` constants, `COMMIT_PROBE_BOUND_MS`, Vitest configuration, `package.json` or `enforcedWrite.concurrency.test.ts`.
- Do not skip, `.only`, `.todo` or weaken an assertion; do not move the test to a new file or directory.
- Do not edit the deferred-work ledger, the sprint board or this spec.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Table free | No other transaction holds a lock on `documents` | The first `NOWAIT` attempt is granted; both reads time out as database timeouts | none |
| Table busy | Another worker holds an open transaction on `documents` | The `NOWAIT` attempt fails at once with `lock_not_available`; the test retries after a short pause and never sits in the lock queue | the failed attempt's transaction is rolled back |
| Never granted | The table stays busy for the whole retry budget | The test fails, naming the lock acquisition | no read is attempted |

</frozen-after-approval>

## Code Map

- `server/wikiLint/adapters/documentReader.test.ts:933-960` -- `describe("database timeouts")`, the only test that changes. `:962-965` is the pure `isDatabaseTimeout` test, unchanged.
- `server/wikiLint/adapters/documentReader.ts:16-17,55-66,131` -- `lock_not_available` (`55P03`), `isDatabaseTimeout`, and the reader's `SET LOCAL lock_timeout`. Read-only.
- `server/wikiLint/application/enforcedWrite.concurrency.test.ts:629-713` -- `holdCommit` and the row 7 test that the queued lock broke. Read-only.
- `server/wikiLint/adapters/writeTransaction.ts:435-505` -- `boundedRead` and `probeCommit`. Read-only.

## Tasks & Acceptance

**Execution:**
- `server/wikiLint/adapters/documentReader.test.ts` -- acquire the holder's lock with `NOWAIT` in a bounded retry loop as described, then run the two reads under it as today.

**Acceptance Criteria:**
- Given the table is free, when the lock-timeout test runs, then both reads reject with errors for which `isDatabaseTimeout` is true, as before.
- Given another connection holds an open transaction on `documents`, when the lock-timeout test starts, then its lock statement never waits in the lock queue: it fails with `lock_not_available` and is retried.
- Given `documentReader.test.ts` and `enforcedWrite.concurrency.test.ts`, when each runs against the test database, then every test passes.

## Spec Change Log

## Review Triage Log
