---
title: 'DW-50: Start broad verification runs from a fresh test database'
type: 'bugfix'
created: '2026-10-25'
status: 'in-progress'
baseline_revision: '4d19bd3caa6f9ff9cfd81e671c81efa940e3cda5'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<frozen-after-approval reason="human-owned intent">

## Intent

**Problem:** `scripts/test-db.sh ensure` keeps one test database for good, and nothing ever deletes what the server tests write, while upstream CI migrates a fresh PostgreSQL for every run. On 2026-10-24 the database had grown to 1.27 GB (213,441 documents, 225,402 users). Two non-deterministic failures of `yarn test:wikilint` follow from that (DW-50, DW-54). The coordinator measured both on 2026-10-24 with a sampler of `pg_stat_activity`, `/proc/diskstats` and `/proc/pressure/io` every 500 ms:

- Aged database, 12 consecutive runs: 10 passed, 2 failed in `ErrorTimedOutFileOperationsTask.test.ts` (DW-54); 265–370 s per run, growing; autovacuum workers on `documents` and `collections` waited up to 4.8 s on `WALSync`, 4.7 s on `WALWrite` and 4.6 s on `DataFileRead`. `pg_test_fsync` on the same disk measured 2.8 ms per `fdatasync`.
- The same database set aside by `ALTER DATABASE … RENAME` and a fresh one migrated (8.7 s), 12 consecutive runs: 12 passed; 177–203 s per run; no backend of any kind waited longer than 1 s.

DW-50's 5-second client stall was not reproduced in either series; the inference is that it is the autovacuum WAL stall of the aged database reaching a client commit, and that a fresh database removes it.

**Approach:** Add a `reset` command to `scripts/test-db.sh` that drops and recreates the `.env.test` database on the server this script runs and migrates it, and make broad verification start from it.

## Boundaries & Constraints

**Always:**
- `scripts/test-db.sh reset` ends with the database named in `.env.test` freshly created and migrated, and prints the same ready line as `ensure`. When the server is not running, it installs and starts it as `ensure` does.
- `reset` drops a database only on the server whose data directory this script owns (`$data/postmaster.pid` present for the listening server). When something else listens on the port, it fails with a clear message and changes nothing.
- `reset` never terminates other sessions. When another session is connected to the database, it fails with a clear message that says so and leaves the database in place.
- `ensure`, `status` and `stop` keep their behaviour; the usage text and the header comment list `reset`.
- The coordinator, not the worker, updates `AGENTS.md` and `CLAUDE.md` (protected rules files) at finish: the "Running and verifying" bullet in each says that a broad verification run, and every run retained as evidence, starts from `scripts/test-db.sh reset`, and that `ensure` stays enough for targeted runs.
- The script keeps its existing conventions (`set -euo pipefail`, `die`, the bounded `listening` probe).

**Never:**
- Do not use `DROP DATABASE … WITH (FORCE)`, `pg_terminate_backend` or any other way of ending another session.
- Do not change PostgreSQL durability settings (`fsync`, `synchronous_commit`, `full_page_writes`); the measurements show they are not needed.
- Do not change Vitest configuration, `package.json`, server code or any test, including the upstream `ErrorTimedOutFileOperationsTask.test.ts`.
- Do not edit `AGENTS.md`, `CLAUDE.md`, the deferred-work ledger, the sprint board or this spec.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Own server running, no other session | `reset` | database dropped, created, migrated; ready line | none |
| Own server stopped | `reset` | server started as by `ensure`, then as above | none |
| Another session connected | `reset` while a client holds a connection | non-zero exit naming the open sessions as the cause; database unchanged | no session is terminated |
| Foreign server on the port | `reset` with no `$data/postmaster.pid` | non-zero exit; nothing dropped | none |

</frozen-after-approval>

## Code Map

- `scripts/test-db.sh` -- `ensure|status|stop`; add `reset`.
- `AGENTS.md:31`, `CLAUDE.md:31` -- the "DB-backed server tests" bullet; protected, updated by the coordinator at finish. Read-only for the worker.
- `.env.test` -- `DATABASE_URL` of the test database. Read-only.

## Tasks & Acceptance

**Execution:**
- `scripts/test-db.sh` -- add `reset` as described.

**Acceptance Criteria:**
- Given the script's own server with data in the test database, when `scripts/test-db.sh reset` runs with no other session connected, then it exits 0, prints the ready line, and the database holds only migration state.
- Given another session connected to the test database, when `reset` runs, then it exits non-zero with a message naming the open sessions, and that session and the database are untouched.
- Given a fresh database from `reset`, when the verify suites run, then every test passes.

## Spec Change Log

## Review Triage Log
