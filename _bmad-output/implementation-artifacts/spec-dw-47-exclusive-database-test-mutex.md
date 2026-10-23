---
title: 'DW-47: Run the real-lock test exclusive of every other server database test'
type: 'bugfix'
created: '2026-10-24'
status: 'in-progress'
baseline_revision: '6b98faa896ba20298347a5039d85da2d5f0bce94'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<frozen-after-approval reason="human-owned intent">

## Intent

**Problem:** `documentReader.test.ts` "times out behind an exclusive lock held by another transaction" holds `LOCK TABLE documents IN ACCESS EXCLUSIVE MODE` for its two 400 ms reads on the test database that both `yarn test:wikilint` workers share. DW-46 stopped the lock from queueing, but while the granted lock is held, a test in the other worker that is inside an enforced write with an engineered short `lock_timeout` times out. With the lock test looping in a second process, `enforcedWrite.concurrency.test.ts > COMMIT outcomes > ends in row 6 with its callbacks when COMMIT lands but its reply outlives the timer` returned row 5 in 1 of 10 runs. Story 3.2 needs identical runs (DW-47).

**Approach:** A cross-worker mutex built on one PostgreSQL session-level advisory lock with a fixed key, held per test file. `server/test/setup.ts` opens one dedicated `pg` client that is not part of the Sequelize pool and takes the lock in shared mode at the top level, before the test file's own module code and hooks run. It releases the lock and closes the client in an `afterAll`, which Vitest runs after the file's own `afterAll` hooks. Vitest isolates each test file, so this happens once per file. Every database statement of a file, including those in its module code, `beforeAll` and `afterAll`, therefore runs under the shared hold. A test that must hold a table-level lock on a shared table wraps that section in an exported helper. The helper releases its file's shared hold, takes the lock in exclusive mode, runs the section, releases the exclusive lock and takes the shared hold again. PostgreSQL queues a later shared request behind a waiting exclusive one, so the helper waits until the other worker's current file ends, and the other worker's next file waits at its setup until the section ends; no other file's work is interrupted mid-way. The real-lock test uses the helper around its table lock and its two reads.

## Boundaries & Constraints

**Always:**
- The advisory lock key is one named constant, documented next to the helper.
- The dedicated client connects with the test database settings the server tests already use. It never comes from or reduces the Sequelize pool.
- The helper refuses to run, with a clear error, when called while its file does not hold the shared lock or while another helper section of the same file is active; the server project runs no `test.concurrent` tests, and the helper does not support them.
- The helper restores the shared hold in `finally`, including when the section throws or the exclusive acquisition fails. If the shared hold cannot be restored, the helper throws an error saying so, and the file's `afterAll` still closes the client.
- The real-lock test keeps its DW-46 behaviour (`NOWAIT` acquisition with bounded retry) and all its assertions, runs its table lock and both reads inside the helper, and has a timeout long enough to wait for the other worker's current file.
- One collocated test in `server/test/` proves the queue behaviour on the real test database with separate clients: while one client holds the lock shared and a second waits for it exclusive, a third client's shared request is not granted until the exclusive section ends. It also proves that a throwing section leaves the lock released and the shared hold restored.
- New helper code lives in the existing `server/test/` directory, beside `setup.ts`.

**Never:**
- Do not change production code, `deadline.ts` constants, Vitest configuration, `package.json`, `enforcedWrite.concurrency.test.ts` or any other test's assertions.
- Do not skip, `.only` or `.todo` a test, and do not create a new test directory.
- Do not take the exclusive lock anywhere except through the helper.
- Do not edit the deferred-work ledger, the sprint board or this spec.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Ordinary file | No exclusive section runs | The file takes the shared hold before its module code runs and releases it after its last `afterAll`; shared holds never wait on each other | none |
| Exclusive section | The real-lock test enters the helper while the other worker is mid-file | The helper waits until the other worker's current file ends; the other worker's next file waits at its setup until the section ends | the helper restores the shared hold in `finally` |
| Section throws | The section rejects | The exclusive lock is released, the shared hold is restored, and the error propagates | none |

</frozen-after-approval>

## Code Map

- `server/test/setup.ts` -- the server project's setup file (`vitest.config.ts`, project `server`); it already registers `beforeAll`, `afterEach`, `afterAll` and a `beforeEach`.
- `server/wikiLint/adapters/documentReader.test.ts` -- `describe("database timeouts")` and the DW-46 `lockDocumentsTable` helper and its tests.
- `.env.test` -- `DATABASE_URL` of the test database. Read-only.
- `server/wikiLint/application/enforcedWrite.concurrency.test.ts` -- the timing-engineered "COMMIT outcomes" tests that the held lock disturbed. Read-only.

## Tasks & Acceptance

**Execution:**
- `server/test/` -- add the advisory-lock mutex: the per-file client and shared hold, the exported exclusive helper, and its collocated queue-behaviour test.
- `server/wikiLint/adapters/documentReader.test.ts` -- run the real-lock test's table lock and reads inside the helper.

**Acceptance Criteria:**
- Given two Vitest processes on the shared test database, one looping the real-lock test and the other running the COMMIT-outcome tests, when the second runs repeatedly, then every COMMIT-outcome test passes in every run.
- Given the helper's section throws, when the test ends, then the exclusive lock is released and the shared hold is restored.
- Given a waiting exclusive request, when a third client requests the lock shared, then it is not granted until the exclusive section ends.
- Given the verify suites, when they run against the test database with `--maxWorkers=2`, then every test passes.

## Spec Change Log

## Review Triage Log
