---
title: 'Story 3.2: Close Layered Conformance and Source-Provenance Evidence'
type: 'feature'
status: 'ready-for-dev'
context: []
---

<frozen-after-approval reason="human-owned intent">

## Intent

**Problem:** The AD-18 layers are spread across collocated suites, and no retained run, requirement map, seam or layout proof, generic-data review or provenance record exists. Gate 1 claims are therefore still inferred from code structure.

**Approach:** Audit every AC 1 layer against the existing tests. Add only the fixtures that are missing, beside the code they cover, plus one layout and no-skip assertion. Run the pinned suite three times, and retain under `docs/wikilint-gate-1/` (P5) the commands, results, raw reports, coverage map, seam review, generic-data review and provenance.

## Boundaries & Constraints

**Always:**
- Preconditions DW-46 and DW-47 are `status: done 2026-10-24`, so they are met.
- The retained broad command is `corepack yarn test:wikilint` (server project, `--maxWorkers=2`), run 3 times. The test PostgreSQL was ensured by the coordinator, not the worker (P7). `conformance.md` records "run from the main worktree root at 2026-10-23T23:54:48Z, exit 0, output `test-db: outline-test ready on 127.0.0.1:5432`".
- Layers outside the paths of that command run as recorded supplementary commands: `shared/editor/nodes/urlSanitization.test.ts` and `shared/utils/urls.test.ts` (projects `shared-node`, `shared-jsdom`), and `server/index.test.ts` with `server/models/helpers/DocumentHelper.test.ts` (project `server`). These files are run, never edited.
- Each command is run plain, with no pipe, `tail` or `grep` (P9). Its exit status, console totals and raw-report path are recorded. Decision P8: Vitest writes each JSON report outside the repository, and its SHA-256 is recorded. The copy kept in `docs/wikilint-gate-1/raw/` is that report after `node_modules/.bin/oxfmt`, recorded as formatted. Evidence files are `.json` and `.md` only, and all of them pass `oxfmt --check`. No ignore entry or config change is added.
- `conformance.md` records the source commit of the retained runs. It states that the evidence lands in the coordinator's attempt commit that follows (P10).
- Every CAP-1–6, FR-1–23, NFR-6–27, SM-I1–I4, SM-I6–I7, SM-C1–C7, AD-1–20 and fixed D-9 item maps to a test, a fixture, a source review or an explicit `gap` with a reason and an owner. Failed or missing evidence is never marked `pass`.
- The three runs must have identical per-test names and statuses, with 0 skipped and 0 todo. Any difference is a new determinism failure (P12): it is recorded with a reproduction as a `gap`, never as a known flake.
- If a new fixture exposes a product defect, the fixture is not committed failing and the behaviour is not changed to make it pass. The defect is recorded as a `gap` with a reproduction.
- The seam review classifies every injected dependency into the seven AD-18 kinds. A dependency outside them is a `gap`. It is not refactored.
- The generic-data fix is in scope (P11). The UUID at `server/wikiLint/core/internalLinks.test.ts:15` becomes the placeholder `00000000-0000-4000-8000-1a2b3c4d5e6f`, as are any other non-placeholder IDs found in reusable scope. This happens before the retained runs, and the affected tests stay green.
- Provenance uses read-only Git only: `git merge-base HEAD 4a5a616a…`, the merge count since the base, `merge-base --is-ancestor` for `c17d2c52b3a9e26834b846d27ee9213ee3003c4c` (the container-block fix), and a diff of that fix's files against the base.

**Never:**
- Add `.skip`, `.only`, `.todo` or `skipIf`, change a severity, weaken a check, broaden authority, normalize fail-open or fork per client.
- Create a test directory, a parallel framework tree or an external service, or edit files outside the story scopes (`shared/`, `server/test/` and `package.json` among them).
- Fetch, write to Git, run `scripts/test-db.sh`, publish an image, deploy, mount a policy, or select OD-2 or OD-7 (P3, P4, P7).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Clean runs | DB ready, 3 runs | identical names and statuses, 0 skipped or todo | a difference is a determinism `gap` with a reproduction |
| DB unreachable | connection errors or a silent hang | not recorded as a conformance result | stop, report `blocked` (the worker cannot run `ensure`) |
| Missing layer | an AC 1 item with no fixture | a fixture is added beside the code it covers | outside the story scopes, it is a `gap` |
| Misplaced test | a test outside its covered directory, or a `__tests__`/`test`/`tests` directory | the layout assertion fails | — |
| Seam outside the seven kinds | an unclassifiable injected dependency | recorded as a `gap` | no refactor |
| Pilot identifier | a non-placeholder UUID, private name or URL in reusable scope | replaced with a placeholder, and the tests stay green | `_bmad-output/`, `AGENTS.md`, `CLAUDE.md` and `docs/wikilint-gate-1/` are excluded from the scope |
| Fix ancestry | `c17d2c52…` is an ancestor of HEAD, or its files differ from the base | the provenance check fails and is recorded | — |

</frozen-after-approval>

## Code Map

- `package.json:35` -- `test:wikilint` covers `server/{wikiLint,tools,queues,routes/mcp}` only. That is why the supplementary commands exist.
- `server/wikiLint/core/boundary.test.ts` -- the existing AD-1 forbidden-import check.
- `server/wikiLint/{core,application,adapters}/*.test.ts` -- most AD-18 layers. The real-PostgreSQL COMMIT and lock cases are in `application/enforcedWrite.concurrency.test.ts` and `adapters/documentReader.test.ts`. DW-47 serializes them through `server/test/databaseMutex.ts`, which is read only here.
- `server/tools/*.test.ts`, `server/routes/mcp/*.test.ts`, `server/queues/tasks/EnforcedDocumentImportTask.test.ts` -- the tool, discovery, socket-timeout, worker and compatibility layers.
- `server/wikiLint/core/internalLinks.test.ts:15` -- the non-placeholder UUID (P11). The earlier run checked that the placeholder value passes 94/94.
- Earlier run, reference only and not the base: `git show 1dc9bd670:server/wikiLint/layout.test.ts`, the lintDocument fixture "reads the snapshot only after authorization completes" (`a423d3abc..1dc9bd670`), and that run's `docs/wikilint-gate-1/{conformance,coverage,provenance}.md`. Its seam table lists `policySet`/`instanceOrigin`, `admit`/`admitPersist` and `onValidated`/`onCommitted`. Since the 2026-10-24 AD-18 amendment these are configuration values, admission control and attempt-phase callbacks, which are permitted kinds.
- `ARCHITECTURE-SPINE.md:300-304` (AD-18), `epics.md`, `prd.md`, `docs/wikilint-gate-1/evidence-index.md` -- the requirement inventory, and the Story 3.2 `gap` rows that this evidence closes. Story 3.4 re-assembles them. They are not edited here.

## Tasks & Acceptance

- [ ] `server/wikiLint/core/internalLinks.test.ts` -- replace the UUID with the placeholder. Make the same fix for any other generic-data hit in the story scopes -- AC 5.
- [ ] `server/wikiLint/layout.test.ts` -- assert there is no `__tests__`/`test`/`tests` directory under the suite roots. Assert each `*.test.ts` has a sibling source named by its first dotted segment, except an explicit allowlist (`core/boundary`, this file). Assert no Gate 1 test contains `.skip`, `.only`, `.todo`, `skipIf` or `runIf` -- AC 3, 4.
- [ ] collocated `*.test.ts` in the story scopes -- go through the AC 1 list item by item and add each missing fixture to the test file of the code it covers -- AC 1.
- [ ] `docs/wikilint-gate-1/conformance.md` -- record the toolchain (`node --version`, `corepack yarn --version`, PostgreSQL `server_version`, Vitest) and the P7 line. For each command (3× `corepack yarn test:wikilint --reporter=default --reporter=json --outputFile=<tmpdir>/test-wikilint-run-N.json`, the supplementary commands, and `corepack yarn build` as a local build only), record the exit status, totals, original SHA-256 and formatted raw path. Then the three-run comparison, the source commit (P10), an AC 1 layer → test-name table, the seven-kind seam inventory, and the generic-data review patterns, scope, exclusions and results -- AC 1, 3, 4, 5, 7.
- [ ] `docs/wikilint-gate-1/coverage.md` -- the requirement → evidence or `gap` map -- AC 2.
- [ ] `docs/wikilint-gate-1/provenance.md` -- the merge-base output, the merge count, the backport inventory (`none` unless one is found), proof that the fix is not an ancestor and that its files are unchanged, and a no-publication/deployment/rollout statement -- AC 6, 7.
- [ ] `docs/wikilint-gate-1/raw/*.json` -- the oxfmt-formatted reports, and nothing else -- AC 1.

**Acceptance:** AC 1–7 hold over the retained files. Every unmet item is a `gap`, never `pass`.

## Verification

**Commands:**
- `tsc`: `corepack yarn tsc`
- `oxlint`: `node_modules/.bin/oxlint --type-aware server shared`
- `oxfmt`: `node_modules/.bin/oxfmt --check {changed_files}`
- `vitest`: `corepack yarn test:wikilint`
- `vitest-index`: `node_modules/.bin/vitest run --project server server/index.test.ts`
