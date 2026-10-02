---
title: 'Story 1.2: Load and Identify Collection Policy Safely at Startup'
type: 'feature'
created: '2026-10-02'
status: 'done'
baseline_revision: '594ce76bd10c167d9bee5280d147b08ce375a279'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** No collection lint policy can be loaded. Later stories (1.3, 1.5, 1.7, Epic 2) need one immutable, fingerprinted policy set that each service's master validates once at startup and hands to its workers. A configuration defect must either stop startup with one stable code and a byte location, or fail closed for its one collection. It must never silently weaken validation.

**Approach:** Add three pieces:
- a pure, iterative, duplicate-aware raw-byte JSON decoder and AD-6 canonical JSON in `server/wikiLint/core/policyJson.ts`;
- a pure envelope and entry validator in `server/wikiLint/core/policySet.ts`, which builds the frozen policy set with fingerprints through an injected SHA-256 function;
- one shell adapter, `server/wikiLint/adapters/policyConfig.ts`. In the master it reads `WIKI_LINT_CONFIG_PATH` once, logs operator-only fields, and either exports the exact bytes (base64) to forked workers or exits. In workers it rebuilds the same set from those bytes and never touches the path.

`server/index.ts` `master()` calls it first. `server/main.ts` `start()` loads the worker set eagerly.

## Boundaries & Constraints

**Always:**
- Core files obey the existing boundary test: imports only relative core modules and `zod`; no `process`, `crypto`, `Date`, `console`, timers, or `Intl`. Hashing is injected as `(bytes: Uint8Array) => lowercaseHex`.
- Decoding, the tree walks, and plain-value conversion are iterative (explicit stacks). A 64 KiB file of nested brackets must not overflow the stack.
- The policy set is deep-frozen. It is built once per process: the master from the file, a worker from the inherited bytes. It has no setter, watcher, reload, or mutation export.
- Logs carry only codes, numeric byte offsets or `file`, counts, collection UUIDs, fingerprints, and JSON Pointers built from the schema vocabulary (Design Notes). They never carry file content, key text, values, or raw configuration.
- Fixtures and the example use synthetic UUIDs (`00000000-0000-4000-8000-00000000000N`), generic headings, and `read_only` activation only.
- Follow the baseline TS configuration, vitest globals, collocated tests, and the JSDoc style of `server/tools/util.ts`.

**Never:**
- Out of scope:
  - MCP tools and result assembly (1.3, 1.5, 1.10);
  - sentinel behavior in results (1.3, 1.5);
  - readiness and the health endpoint, including `WIKI_LINT_EXPECTED_CONFIG_FINGERPRINT` (3.1);
  - write enforcement (Epic 2);
  - any OD-2 value (pilot collections, rules, fail-open posture).
- No stock `JSON.parse` on configuration bytes. No `fs.watch` or hot reload. No admin or MCP policy API.
- A worker never reads `WIKI_LINT_CONFIG_PATH` or any file for policy.
- The JSON-Pointer path never enters a `PolicySet` entry or any result. It exists only in the master's startup diagnostics.
- No edits to `server/editor/**`, `shared/editor/**`, or `_bmad-output/implementation-artifacts/sprint-status.yaml`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Absent path | `WIKI_LINT_CONFIG_PATH` unset or `""` | Empty set with fingerprint `sha256:25d4e8ec86646fe465b938d352ab3973a46bef099e8ec712c5535c1a2609ecc2`. Info log has `configStatus: "absent"` and zero counts. Worker variable is set to `""` | none |
| Empty envelope file | `{ "schemaVersion": 1, "collections": {} }` | The same fingerprint as absent; `configStatus: "loaded"` | none |
| Unreadable or oversize | missing path, a directory, or 65,537 bytes (65,536 is accepted) | warn `{ code: "POLICY_CONFIGURATION_MALFORMED", location: "file" }`, then `process.exit(1)`; worker variable untouched | startup-fatal |
| Malformed input | BOM; ill-formed UTF-8; any RFC 8259 grammar violation; empty file | `MALFORMED` at the lowest malformed offset (Design Notes); EOF-type defects at the input length | startup-fatal |
| Unsupported version | no malformed input; a root `schemaVersion` member whose token is not exactly `1` (`2`, `"1"`, `1.0`, `1e0`) | `POLICY_SCHEMA_VERSION_UNSUPPORTED` at the lowest such value token, even when other root defects exist | startup-fatal |
| Root-schema defect | root not an object; missing member (at the root `{`); unknown or duplicate root key; `collections` not an object; duplicate (after unescaping) or non-canonical-UUID collection key | `MALFORMED` at the lowest offset among these defects | startup-fatal |
| Entry defect | an identified entry with an unknown field (`severity`, `code`, `pattern`), a nested duplicate key, an unpaired surrogate, an out-of-profile number (`1.0`, `1e0`, `-0`, `9007199254740992`), duplicate rule kinds, empty `rules`, a bad enum, or a non-object entry | That collection becomes an `invalid` sentinel with `invalidFingerprint` over its value bytes; other entries are unaffected; the info log lists `{ collectionId, code: "POLICY_CONFIGURATION_INVALID", path, invalidFingerprint }` | fail-closed sentinel |
| Valid entry | `runtimeFailureMode` omitted | `runtimeFailureMode: "closed"` is materialized; `policyFingerprint` equals that of the explicit `"closed"` form | none |
| Respawned worker | file rewritten after the master started | The worker's set and fingerprint equal the master's; the path is never opened | none |

</intent-contract>

## Code Map

- `server/index.ts:33-37` -- `master()` runs once in the throng master before `fork(count)`. Insert the adapter's master entry as its first statement. The file stays lean: master imports must not pull Sequelize or the editor.
- `node_modules/throng/lib/throng.js` (v5.0.0) -- Read-only. The master does `listen(); await master(); fork(count)`. A respawn after disconnect calls `cluster.fork()` with no env argument. Node then gives the child `{ ...process.env }` at fork time, so a value the master writes to `process.env` before forking reaches every worker and every respawn.
- `server/utils/startup.ts:21-65` -- `configureChildHeapLimit` already sets `process.env.NODE_OPTIONS` in the master for workers to inherit. This is the precedent for the bytes variable.
- `server/main.ts:39` -- worker `start(id, disconnect)`. Add one eager `getPolicySet()` call next to `PluginManager.loadPlugins()`.
- `server/utils/environment.ts` -- Read-only. At import it merges `.env` files into `process.env`, with `process.env` winning. The default export is a `_FILE`-resolving proxy, so read both variables from `process.env` directly. The master must always set the bytes variable (`""` when absent) so a `.env` value can never reach a worker.
- `server/env.ts:33-47` -- precedent: invalid configuration is logged at warn, then `process.exit(1)`. Do not add `WIKI_LINT_CONFIG_PATH` to `env.ts`; workers must not see a typed accessor for it.
- `server/logging/Logger.ts` -- `Logger.info("lifecycle", msg, extra)` and `Logger.warn(msg, extra)` keep `extra` as structured JSON fields in production. `Logger.error` drops `extra` from production logs, so do not use it here. `sanitize` truncates beyond depth 3, which a `sentinels: [{...}]` field fits. Winston writes synchronously; the fatal line is emitted before `process.exit(1)` (probed with stdout as a pipe and as a file).
- `server/wikiLint/core/registry.ts:226-424` -- `ruleConfigSchema` (strict discriminated union on `kind`) and its private `uuid` regex. Export that regex for collection keys rather than duplicating it.
- `server/wikiLint/core/ordering.ts:24` -- `compareUtf8`; reuse it for canonical key order, entry order, and pointer tie-breaks.
- `server/wikiLint/core/contracts.ts` -- `PolicyIdentity` (AD-12) and `WikiLintContractError` (fixed messages only).
- `server/wikiLint/core/boundary.test.ts` -- scans every non-test core file automatically; new core files must pass unchanged.
- Zod 4 facts, probed on this baseline:
  - an unknown or missing `kind` gives `invalid_union` at path `[..., "kind"]`;
  - strict-object extras give `unrecognized_keys` at the object path, with `keys`;
  - `.superRefine` on an array does not run when its elements already have issues;
  - an own `__proto__` key created with `Object.defineProperty` is reported as unrecognized.
- `.env.sample:38-40` -- `WEB_CONCURRENCY` block. Document `WIKI_LINT_CONFIG_PATH` after it.
- `Dockerfile:30` -- copies `server/` into the image, so an example under `server/wikiLint/` ships as the generic example (AD-19).
- `build.js` -- `corepack yarn build:server` compiles `server/` with SWC into the git-ignored `build/server/`, and `node build/server/index.js` is the production entry. `master()` runs synchronously up to its first `await`, so the policy load runs before the next-tick `env.ts` validation and before the migration-check child. A real-process run therefore observes the startup surface without a database.

## Tasks & Acceptance

**Execution:**
- `server/wikiLint/core/registry.ts` -- export the existing lowercase canonical UUID regex (for example `UUID_PATTERN`) and use it in `uuid`. Change nothing else. Rationale: one definition of "identifiable key".
- `server/wikiLint/core/policyJson.ts` -- add:
  - `decodeJson(bytes)` → `{ ok: true, root: JsonNode } | { ok: false, offset }`. A `JsonNode` is object (ordered `members` of `{ key, keyStart, value }`, keeping duplicates), array, string (unescaped JS string, which may hold lone surrogates), number (`raw` source text), or literal. Every node has `start` and an exclusive `end` byte offset;
  - `canonicalJson(value)` (AD-6);
  - `encodeUtf8(text)`.

  The decoder and every helper are iterative.
- `server/wikiLint/core/policySet.ts` -- add:
  - `POLICY_CONFIG_MAX_BYTES = 65536`;
  - the types `CollectionPolicy` (`activation`, `runtimeFailureMode`, `rules`), `PolicySetEntry` (valid: `collectionId`, `status`, `policySchemaVersion: 1`, `policyFingerprint`, `policy`; invalid: `collectionId`, `status`, `invalidFingerprint`), `PolicySet` (`policySetFingerprint`, `entries` sorted by `collectionId`), and `PolicySentinelDiagnostic`;
  - `buildPolicySet(bytes | null, sha256Hex)` → `{ ok: true, policySet, sentinels } | { ok: false, code, location: number | "file" }`.

  It implements the Design Notes algorithms: size check, decode, code selection, envelope, entries, fingerprints. Its output is deep-frozen.
- `server/wikiLint/adapters/policyConfig.ts` -- add:
  - `readPolicyConfigFile(path)`: a bounded read through `fs.openSync`/`readSync` of at most 65,537 bytes; null when unreadable or over the limit;
  - `initializePolicyConfiguration(env = process.env)`: the master entry. It loads, logs, and sets `env.WIKI_LINT_CONFIG_BASE64` to base64 of the exact bytes (`""` when absent), or warns `{ code, location }` and calls `process.exit(1)`. It returns the set for tests;
  - `policySetFromEnvironment(env)`: the worker path. It reads only `WIKI_LINT_CONFIG_BASE64`; undefined or `""` gives the empty set. If the bytes fail to load, it throws an error with a fixed message;
  - `getPolicySet()`: memoized over `process.env`.

  Use a SHA-256 hex function from `node:crypto`.
- `server/index.ts` -- call `initializePolicyConfiguration()` first in `master()`.
- `server/main.ts` -- call `getPolicySet()` eagerly in `start()`.
- `server/wikiLint/policy.example.json` -- a generic schema-v1 example: one synthetic collection, `activation: "read_only"`, no `runtimeFailureMode`, rules `required_sections`, `allowed_heading_levels`, and `internal_links` with generic headings.
- `.env.sample` -- a commented `WIKI_LINT_CONFIG_PATH=` entry. It states the variable is optional, read once at startup by each service's master, restart-only, limited to 64 KiB, and that the example lives at `server/wikiLint/policy.example.json`.
- Collocated tests: `core/policyJson.test.ts`, `core/policySet.test.ts` (inject `createHash` from `node:crypto`), and `adapters/policyConfig.test.ts` (temporary files under `os.tmpdir()`, spies on `Logger`, `process.exit`, and `fs`). Together they cover every I/O-matrix row and every criterion below, plus:
  - decoder offsets for each malformed class;
  - canonical escape and order goldens;
  - deep nesting of 32,768 levels both at the root and inside an entry, without a crash.

**Acceptance Criteria:**
- Given the built server and `WIKI_LINT_CONFIG_PATH` pointing at a malformed file, when `node build/server/index.js` starts, then:
  - its first policy log line is a warn carrying exactly `code` and a numeric `location`, with no file content;
  - the process exits with status 1 before any worker is forked.

  Given a valid file, when the server starts, then it logs the loaded line, including `policySetFingerprint`, before anything else touches the database.
- Given `WIKI_LINT_CONFIG_PATH` absent, when `initializePolicyConfiguration` runs, then it does not exit, the set has zero entries and the golden empty fingerprint, and that fingerprint equals the one from a file containing `{ "schemaVersion": 1, "collections": {} }`.
- Given any startup-fatal class, when `initializePolicyConfiguration` runs, then:
  - `Logger.warn` is called once with exactly `{ code, location }`, and `process.exit(1)` follows;
  - the worker variable is unchanged;
  - the serialized log arguments contain no key text, value, or file bytes (fixtures plant distinctive strings and assert their absence);
  - fixtures pin the precedence: grammar defect plus `schemaVersion: 2` → `MALFORMED`; `schemaVersion: 2` plus an earlier unknown key → `UNSUPPORTED` at the version value; several root defects → the lowest offset.
- Given a file with one valid, one invalid, and one valid entry, when it loads, then:
  - the valid entries carry normalized policies with `runtimeFailureMode` materialized;
  - the invalid entry carries only `invalidFingerprint` = `sha256:` over its exact value bytes;
  - the info log reports `configStatus`, `readOnlyCount`, `enforcedCount`, `invalidCount`, `policySetFingerprint`, and one `sentinels` item whose `path` is the first-defect JSON Pointer;
  - `policySetFingerprint` = `sha256:` of canonical `{ schemaVersion: 1, collections: [...] }` sorted by `collectionId`.
- Given the same valid entry written with LF and with CRLF line endings, reordered keys, escaped equivalent strings, or an omitted default, when loaded, then `policyFingerprint` and `policySetFingerprint` are identical. Given a multi-line invalid entry, converting LF to CRLF changes its `invalidFingerprint`.
- Given the master has set `WIKI_LINT_CONFIG_BASE64` from a file, when that file is then rewritten and `policySetFromEnvironment` runs on a copy of the master's env (a simulated respawn) that also carries a different `WIKI_LINT_CONFIG_PATH`, then the worker's set deep-equals the master's, and `fs` was never asked to open either path.
- Given a loaded set, when callers try to mutate entries, policies, or rules, or change `process.env` after the first `getPolicySet()`, then the assignments throw (frozen), and `getPolicySet()` returns the same object.
- Given `server/wikiLint/policy.example.json`, when it is loaded, then it is valid with zero sentinels, uses only synthetic UUIDs, and contains no `open` value. A grep finds no pilot identifiers.

## Spec Change Log

## Review Triage Log

### 2026-10-02 — Review pass
- verdicts: 26 findings — high 0, medium 6, low 10, false 10, maybe-false 0
- findings:
  - `[false]` `[reject]` **Blind Hunter:** a worker whose policy load fails is unhandled and respawns in a tight loop. — Unreachable. `server/main.ts` is imported only by the `server/index.ts` worker callback, and that worker rebuilds the set from bytes its master already loaded successfully with the same deterministic code. Node passes environment strings unchanged, so `policySetFromEnvironment` cannot fail there.
  - `[false]` `[reject]` **Blind Hunter:** a worker treats an unset `WIKI_LINT_CONFIG_BASE64` as "no policy", which fails open; malformed base64 goes unchecked. — In the only worker topology (the throng master in `server/index.ts`), `initializePolicyConfiguration` always sets the variable (`""` when absent) before `fork`, and encodes it itself. An unset variable needs a master that skipped the loader; the wiring test added in this pass now guards that regression. A worker-side check would guard a state no current path reaches.
  - `[low]` `[reject]` **Blind Hunter:** a FIFO path hangs the master in `openSync`. — The reviewer reproduced it with `mkfifo`. Rejected: an operator pointing `WIKI_LINT_CONFIG_PATH` at a FIFO or terminal is very unlikely (Docker and Kubernetes mount regular files), and the fix adds an `O_NONBLOCK` open plus an `fstat` guard.
  - `[low]` `[reject]` **Blind Hunter:** every sentinel goes into one unbounded log line, which Docker splits above 16 KiB (about 65 sentinels). — Real only with more than about 65 invalid collections in one 64 KiB file, which no pilot configuration approaches. The fix restructures the AC-specified log fields.
  - `[low]` `[reject]` **Blind Hunter:** nothing checks the pointer vocabulary against the registry. — Verified complete: every key in the `registry.ts:264-342` schemas and the entry schema is listed. A future omission only shortens a pointer, which is the designed safe degradation. The fix is new schema-walking test machinery.
  - `[low]` `[patch]` **Blind Hunter:** the public types do not show that the set is frozen, so a mutation compiles and then throws at runtime. — Patched: `CollectionPolicy` fields and `rules` are `readonly`, `policySetFingerprint` is `readonly`, and both `PolicySetEntry` variants are `Readonly<…>`. The two deliberate mutation tests cast through `unknown`.
  - `[false]` `[reject]` **Blind Hunter:** `canonicalJson` never detects cycles. — Its only callers pass Zod output parsed from decoded JSON trees and freshly built literal objects, so no reachable input is cyclic.
  - `[false]` `[reject]` **Blind Hunter:** `encodeUtf8` re-implements `TextEncoder`. — It is not a defect: it is correct, and tested against `Buffer` for 1- to 4-byte characters. The finding names an alternative implementation, not a bad outcome.
  - `[low]` `[patch]` **Blind Hunter:** test strings hold invisible characters (literal U+FEFF, decomposed and precomposed `é`). — Patched: replaced with `﻿`, `é`, and `é`. The two literal U+2028 characters the implementer found in `policyJson.test.ts` were also replaced with ` `, and a grep for U+2028/2029/FEFF/200B/00A0 now finds none.
  - `[medium]` `[patch]` **Blind Hunter:** no automated test covers the startup wiring. — Same root cause as the Verification Gap wiring row. Patched with `server/index.test.ts`.
  - `[low]` `[patch]` **Blind Hunter:** the operator docs omit what happens with a bad file. — Patched: `.env.sample` now states that an empty value means no policy, and that an unreadable or invalid file stops startup with a logged stable code and location. `server/tools/README.md` is left to its separately tracked RI-5 staleness.
  - `[low]` `[reject]` **Edge Case Hunter:** a FIFO, terminal, or `/dev/stdin` path hangs the master. — Same as the Blind Hunter FIFO row: unlikely, and the fix adds a guard.
  - `[low]` `[reject]` **Edge Case Hunter:** Zod skips the duplicate-kind and unique-list refinements when an element has a type error, so the sentinel path can name a later defect (`rules/2/levels/0` instead of `rules/1/kind`). — Real: the Code Map records that `superRefine` is skipped. The pointer still names a real defect and stays deterministic, so the operator fixes defects in sequence. It needs an entry with two defects where the earlier one is a refinement; rare. The fix needs Zod `when` options across the registry refinements or a parallel uniqueness check over decoded nodes.
  - `[low]` `[reject]` **Edge Case Hunter (claim):** the sentinel path is not always the first defect, as AC8 requires. — Same root cause as the refinement-skip row; rejected with it.
  - `[medium]` `[patch]` **Verification Gap:** the startup wiring in `server/index.ts` and `server/main.ts` is untested; deleting or moving the load passes every test. — Patched: `server/index.test.ts` captures `master` from a mocked `throng` and mocks `./utils/startup`. On a malformed file it asserts `exit(1)` with no `checkPendingMigrations` call. On a valid CRLF file it asserts that `WIKI_LINT_CONFIG_BASE64` equals the base64 of the exact bytes, and that the loaded log precedes `checkPendingMigrations`. Mutation-checked: moving the load after the migration check fails both tests.
  - `[medium]` `[patch]` **Verification Gap:** the pointer-truncation test never reaches the truncation branch. — Patched: added the row `{"PLANTED":{"x":1.5},"kind":"bogus"}`, which must give `/rules/0` with no `PLANTED` in the output. Mutation-checked: dropping the vocabulary filter fails it.
  - `[medium]` `[patch]` **Verification Gap:** nothing pins how `__proto__` keys are handled. — Patched: added an entry-level row (`/collections/<A>`) and a rule-level row (`/rules/0`). Mutation-checked: plain assignment instead of `defineValue` fails both.
  - `[low]` `[patch]` **Verification Gap:** the tie-break test passes without the bytewise sort. — Patched: a parameterless `required_metadata_fields` rule must give `/rules/0/fields`. Mutation-checked: removing `.sort(compareUtf8)` fails it.
  - `[medium]` `[patch]` **Verification Gap:** two UTF-8 well-formedness branches have no fixtures. — Patched: added `F0 80 80 80`, `E2 82 41`, and `F0 9F 98 41`, each located at the lead byte. Mutation-checked: setting F0's `low` to `0x80` fails one row, and limiting the continuation loop fails two.
  - `[medium]` `[patch]` **Intent Alignment:** the process-level criteria (AC1–AC3, one load per master) are exercised only through direct function calls; the real exit and log line rest on a manual run. — Same root cause as the Verification Gap wiring row, and patched with it. The manual built-server run was also performed (Verification below).
  - `[false]` `[reject]` **Intent Alignment:** respawn inheritance (AC7) is simulated, not exercised through `cluster.fork`. — The bad outcome does not happen. throng v5's `revive()` calls `cluster.fork()` with no env, and Node gives the child `{ ...process.env }` at fork time, which is the reassigned object that `environment.ts` installs and the master writes. The baseline's `configureChildHeapLimit` relies on the same path. The new wiring test pins the master's half.
  - `[false]` `[reject]` **Intent Alignment:** the loaded line is logged when the policy loads, not "when startup completes" (AC8). — It reports exactly what was loaded, and all AC8 fields are logged before startup completes. AC8 names the context, not a requirement that the line be the last startup event.
  - `[false]` `[reject]` **Intent Alignment:** AC8's "never in any result" and AC9's "no request path" rest on type separation and the absence of tools. — No lint result, MCP lint tool, or admin route exists yet. `PolicySetEntry` has no `path`, the set is deep-frozen, and no mutation export exists, which the tests pin.
  - `[false]` `[reject]` **Intent Alignment:** treating `""` as absent and the code-precedence order are interpretive choices. — Both are pinned by Design Notes with grounded rationale: `toOptionalString` and `.env.sample` for the first, AD-5's definition of malformed input for the second. Neither produces a bad outcome.
  - `[false]` `[reject]` **Intent Alignment:** a worker cannot tell an unset variable from "no bytes". — Same as the Blind Hunter unset-variable row: unreachable in the throng topology.
  - `[false]` `[reject]` **Intent Alignment:** the awaiting-operator reading of the intent. — No Story 1.2 criterion needs a human action outside the repo. AC10 keeps OD-2 deferred, and every criterion is met in the repo, so the status is `done`.

### 2026-10-02 — Review pass
- verdicts: 33 findings — high 0, medium 1, low 17, false 15, maybe-false 0
- findings:
  - `[low]` `[reject]` **Blind Hunter:** with `LOG_LEVEL=error`, the startup-fatal `Logger.warn` is filtered, so the master exits 1 with no code or location. — Real: winston honors `env.LOG_LEVEL`, which accepts `error`. Rejected: it needs an operator to lower logging below the `info` default on purpose, and the fix replaces the spec-pinned structured `Logger.warn` line with a second, unfiltered output channel.
  - `[low]` `[reject]` **Blind Hunter:** sentinels and the loaded counts are logged only at `info`, so `LOG_LEVEL=warn` hides a fail-closed collection. — Real, but it needs a deliberately raised log level, the collection still fails closed (validation is not weakened), and the fix adds a new warn line beside the AC-specified info line. Readiness exposure is Story 3.1's.
  - `[low]` `[patch]` **Blind Hunter:** `.env.sample` says "an unreadable or invalid file stops startup", which blurs startup-fatal defects with per-collection sentinels. — Patched: the comment now lists the startup-fatal classes (unreadable or oversized file, malformed JSON, unsupported `schemaVersion`, invalid root or collection key) and says a defective collection entry fails closed for that collection only and is listed in the startup log. The fatal log message is unchanged; its stable `code` already separates the classes.
  - `[low]` `[patch]` **Blind Hunter:** `WIKI_LINT_CONFIG_PATH_FILE` is silently ignored although the `.env.sample` header says any variable supports `_FILE`. — Verified: the adapter reads `process.env` directly and never goes through the `withFileSecrets` proxy (`server/utils/environment.ts:50`), so a `_FILE` value yields `configStatus: "absent"`. Patched: the `.env.sample` entry now states that the `_FILE` variant is not supported and the path must be set directly.
  - `[low]` `[reject]` **Blind Hunter:** `WIKI_LINT_CONFIG_BASE64` is undocumented and an operator value is silently overwritten. — Overwriting is the designed guard against `.env` values reaching workers (`policyConfig.ts:88`). An operator would have to invent an undocumented variable name to meet it, and the fix (warn on discard) adds a branch.
  - `[false]` `[reject]` **Blind Hunter:** the raw policy bytes reach the migration-check child and stay in every worker's environment (`/proc/<pid>/environ`, diagnostic reports). — No bad outcome: the same environments already carry `SECRET_KEY`, `UTILS_SECRET`, and `DATABASE_URL`, which are far more sensitive than non-secret collection UUIDs and rule parameters; the intent mandates environment transport, and its log constraint covers logs, which never carry the bytes.
  - `[low]` `[reject]` **Blind Hunter:** `readonly` typing is still shallow (sentinel diagnostics, the failure variant, rule parameters from `z.infer`). — Real, developer-only: a mutation compiles and then throws at runtime against the deep-frozen set. Rejected: the first test that builds a set through `buildPolicySet` surfaces it, and the fix needs a recursive readonly type over the registry's inferred rule union.
  - `[low]` `[reject]` **Blind Hunter:** no test covers the eager `getPolicySet()` in `server/main.ts` `start()`. — Real: the prior pass's wiring patch (`server/index.test.ts`) covers only `server/index.ts`, and deleting the `main.ts` line passes every test. Rejected: today nothing reads the worker set, so removal has no observable effect until Stories 1.3/1.5 consume `getPolicySet()`, and the fix needs mocks for the whole `main.ts` dependency graph (Koa, Sequelize, Redis, services).
  - `[false]` `[reject]` **Blind Hunter:** `getPolicySet()` cannot be reset, and its test depends on order. — Vitest isolates the module registry per test file, `getPolicySet` has exactly one caller in `policyConfig.test.ts`, and later stories can get fresh state with `vi.resetModules()` without any setter export.
  - `[low]` `[reject]` **Blind Hunter:** a bad lint file also stops services that never evaluate policy (collaboration-only, websockets, cron). — Real, and deliberate per Design Notes → Transport ("every master loads the file whatever its `SERVICES`"). It needs a split deployment sharing a malformed lint file, which already stops every policy-evaluating service that must be fixed anyway; the fix adds `SERVICES`-dependent branching.
  - `[low]` `[reject]` **Blind Hunter:** no operator-facing reference for the rule parameters ships; the example covers 3 of 13 kinds. — Real, but policy authoring is a rare, restart-only operator task (OD-2 is deferred to Gate 4), the shipped Zod registry is the generic schema, and sentinel pointers name the offending field. The fix is a new document, not a direct correction.
  - `[false]` `[reject]` **Blind Hunter:** an unexpected exception from `buildPolicySet` bypasses the stable-code contract. — The reviewer concedes no current input reaches it; the decoder and registry reject every profile violation before `canonicalJson` or `encodeUtf8` could throw. A loud failure on an unreachable state is correct behavior.
  - `[false]` `[reject]` **Blind Hunter:** relative paths and file permissions are undocumented. — A relative path resolves against the working directory like every other Outline path variable, and an unreadable file (permissions included) is already documented to stop startup with `location: "file"`.
  - `[low]` `[reject]` **Edge Case Hunter:** a FIFO or tty path blocks `fs.openSync` forever. — carried: same location and claim as the earlier FIFO rows, and `policyConfig.ts:25` still opens with plain `fs.openSync(path, "r")`.
  - `[false]` `[reject]` **Edge Case Hunter:** `canonicalJson` loops on a cyclic value. — carried: same claim as the earlier `canonicalJson` cycles row; its only callers still pass Zod output from decoded JSON trees and fresh literals.
  - `[low]` `[patch]` **Verification Gap:** the count fixture is symmetric (one `read_only`, one `enforced`), so a swapped classification passes. — Patched: `policyConfig.test.ts` adds a fourth entry `D` with a `read_only` policy and asserts `readOnlyCount: 2, enforcedCount: 1`. Mutation-checked: comparing against `"enforced"` fails it.
  - `[low]` `[patch]` **Verification Gap:** no fixture separates "lowest offset" from "first root defect found". — Patched: added the row `{"collections":{},"x":1}` → `malformed(0)`. Mutation-checked: `rootDefects[0]` instead of `lowest(rootDefects)` fails it.
  - `[low]` `[patch]` **Verification Gap:** sentinel ordering by `collectionId` is never tested with more than one sentinel. — Patched: a load with invalid `B` before invalid `A` must give sentinels `[A, B]`. Mutation-checked: removing the sort fails it.
  - `[medium]` `[patch]` **Verification Gap:** no test decodes a valid 3-byte UTF-8 character. — Patched: `policyJson.test.ts` decodes `U+0800 U+2013 U+D7FF U+FFFD` (one character per 3-byte lead range: E0, E1–EC, ED, EE–EF) with exact span and value, and `policySet.test.ts` loads a `required_sections` heading `Overview – Details` as valid with the decoded heading. Mutation-checked: removing the E1–EF lead branch and dropping the third byte's contribution each fail the decoder test.
  - `[low]` `[reject]` **Verification Gap (other):** `server/main.ts:43` `getPolicySet()` is not run by any test. — Same root cause as the Blind Hunter `main.ts` row; rejected with it.
  - `[false]` `[reject]` **Verification Gap (other):** an untracked `server/wikiLint/core/zzprobe.test.ts` appeared during review. — It is not part of the reviewed diff, and it no longer exists: `git status --short` after all layers reported shows no untracked files.
  - `[false]` `[reject]` **Intent Alignment:** stop-before-fork is tested only with `throng` mocked; the real process relies on a manual run. — No runtime defect: this pass rebuilt the server and ran `node build/server/index.js` with a malformed file (one warn line, `location` 175 = EOF, exit 1, no canary, no worker output), and throng v5's `await master(); fork(count)` ordering is pinned dependency behavior.
  - `[low]` `[reject]` **Intent Alignment:** the worker's eager load in `start()` has no test. — Same root cause as the Blind Hunter `main.ts` row; rejected with it.
  - `[false]` `[reject]` **Intent Alignment:** respawn inheritance is simulated, not exercised through `cluster.fork`. — carried: same claim as the earlier respawn row; throng `revive()` and the adapter are unchanged.
  - `[false]` `[reject]` **Intent Alignment:** the master has no once-guard, so a second `initializePolicyConfiguration` call re-reads the file. — throng calls `master()` exactly once per master process; the only repeated call is the test harness.
  - `[false]` `[reject]` **Intent Alignment:** workers inherit `WIKI_LINT_CONFIG_PATH`, so "never reads" rests on call sites. — The intent requires that a worker never reads it, and none does: `getPolicySet` → `policySetFromEnvironment` reads only `WIKI_LINT_CONFIG_BASE64`, and the respawn test spies prove no open.
  - `[false]` `[reject]` **Intent Alignment:** an unset or empty `WIKI_LINT_CONFIG_BASE64` silently gives a worker the empty set. — carried: same claim as the earlier unset-variable rows; the master still always sets the variable before forking.
  - `[false]` `[reject]` **Intent Alignment:** test inputs use `activation: "enforced"`, `runtimeFailureMode: "open"`, and an uppercase UUID, against "fixtures … `read_only` activation only". — The binding epic resolves the reading: Story 1.2 AC4 requires accepting `read_only | enforced` and `closed | open`, which a `read_only`-only corpus cannot verify, and AC3 requires rejecting non-lowercase keys. AC10 forbids pilot IDs and fail-open choices; these inputs bind only to synthetic UUIDs and select no OD-2 value. The shipped example is `read_only` and is asserted to contain no `"open"`.
  - `[false]` `[reject]` **Intent Alignment:** the nil UUID is accepted as a collection key. — Story 1.2 AC3 defines identifiable keys as "a lowercase canonical 8-4-4-4-12 hexadecimal UUID", which the nil UUID is (and RFC 9562 defines it as a valid UUID).
  - `[low]` `[reject]` **Intent Alignment:** a FIFO path blocks the read. — carried: same as the earlier FIFO rows.
  - `[low]` `[reject]` **Intent Alignment:** the sentinel path can name a later defect when Zod skips a refinement. — carried: same as the earlier refinement-skip row; the sentinel status and fingerprint are unaffected.
  - `[false]` `[reject]` **Intent Alignment:** workers compute sentinel paths and discard them. — The intent forbids the path entering a `PolicySet` entry or any result; `policySetFromEnvironment` returns only `result.policySet`, whose entries have no `path`.
  - `[false]` `[reject]` **Intent Alignment:** the raw bytes sit base64-encoded in child-process environments. — Same root cause as the Blind Hunter environment-transport row; the intent mandates that transport and no log carries the bytes.

## Design Notes

**Malformed offset.** Let `U` be the offset of the first byte that does not start a well-formed UTF-8 character (Unicode Table 3-7, maximal-subpart start). Examples:
- a stray `80` is located at itself;
- `C3 41`, `E0 80`, and `ED A0` are located at their lead byte;
- a truncated lead at the end of input is located at that lead.

Let `G` be the first byte at which `bytes[0..U)` stops being a prefix of some RFC 8259 text, with end of input located at `U`, or at the length when there is no `U`. Examples:
- `{"a":1` → 6;
- `[01]` → 2 (the `1`);
- `"\x"` → 2;
- the BOM → 0;
- an empty file → 0;
- a non-ASCII byte outside a string → that byte.

Report the lower of `G` and `U`. Whitespace is exactly space, tab, LF, and CR.

**Code selection.**
1. A `file` defect, oversize, or malformed input gives `MALFORMED`. These are the "decoding defects". Per AD-5, malformed input is grammar, BOM, or UTF-8. Duplicate keys are not decoding defects: RFC 8259 permits them.
2. Else, if the root is an object with any `schemaVersion` member whose number token is not exactly `1`, the code is `UNSUPPORTED`, located at the lowest such value.
3. Else, any root-schema defect gives `MALFORMED`, located at the lowest offset among them:
   - a duplicate key: each later occurrence's key;
   - an unknown key: that key;
   - a missing member: the enclosing `{`;
   - a non-object root or `collections`: that value;
   - an unidentifiable collection key (after unescaping, not matching the UUID regex): that key.

**Entries.** Each identified entry value is converted iteratively to a plain value. Objects use own properties defined by `defineProperty`, last occurrence wins, and numbers come from `Number(raw)`. The value is then parsed with:

```ts
z.strictObject({ activation: z.enum(["read_only","enforced"]),
  runtimeFailureMode: z.enum(["closed","open"]).default("closed"),
  rules: z.array(ruleConfigSchema).min(1)
    .superRefine(/* issue at [i, "kind"] for each later duplicate kind */) })
```

Decoder-level defects inside the value are also collected:
- duplicate keys;
- lone surrogates in keys or strings;
- numbers whose `raw` is not `-?(0|[1-9][0-9]*)`, is `-0`, or is outside `Number.isSafeInteger`.

Any defect makes the entry a sentinel.

The first defect is the one with the lowest offset; ties go to the bytewise-lower pointer. Offsets are assigned as follows:
- a Zod issue is located at its node's `start`;
- an unresolvable path (a missing member) is located at the start of the deepest resolved container;
- `unrecognized_keys` is located at the lowest `keyStart` of the named keys;
- decoder defects are located at the key (key defects) or at the value.

**Pointers.** Pointers are RFC 6901 and absolute: `/collections/<uuid>/…`. Segments are array indices or names from this fixed vocabulary:
- `activation`, `runtimeFailureMode`, `rules`, `kind`;
- `headingLevel`, `headings`, `levels`, `metadataSection`, `heading`;
- `fields`, `name`, `format`, `values`, `structures`;
- `surfaceDocumentId`, `globalIndexDocumentIds`.

Construction stops before the first non-vocabulary key. Key defects (unknown, duplicate, lone-surrogate key) point at the enclosing object. An incomplete vocabulary therefore only shortens a pointer; it never leaks key text.

**Fingerprints.**
- `canonicalJson`:
  - keys are sorted with `compareUtf8`; array order is kept;
  - strings are emitted with `JSON.stringify` after rejecting lone surrogates (ES2019 output equals the AD-6 shortest escapes with lowercase `\u00xx`);
  - numbers must be safe integers other than `-0`;
  - anything else throws `WikiLintContractError`.
- `policyFingerprint` = `sha256:` + hex(UTF-8(canonical `{ schemaVersion: 1, activation, runtimeFailureMode, rules }`)), where `rules` is Zod's parsed output.
- `invalidFingerprint` = `sha256:` + hex(`bytes[start, end)`) of the entry's value node.

**Empty path.** `WIKI_LINT_CONFIG_PATH=""` means absent. This matches `toOptionalString` in `server/env.ts`, and `.env.sample` documents variables as empty `VAR=` lines. Treating `""` as unreadable would make startup fail for anyone who copies the sample.

**Transport.** Base64 keeps the exact bytes, including CR and every other byte, intact through `process.env`. A 64 KiB file encodes to at most 87,384 characters, which is under Linux's 131,072-byte limit for a single environment string. Every master loads the file whatever its `SERVICES`. That is a superset of "each service that evaluates policy" and keeps one code path.

## Verification

**Commands:**
- `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint` -- expected: all wikiLint tests pass, including the unchanged boundary test
- `corepack yarn tsc` -- expected: exit 0
- `node_modules/.bin/oxlint --type-aware server/wikiLint server/index.ts server/main.ts` -- expected: 0 errors
- `node_modules/.bin/oxfmt --check server/wikiLint server/index.ts server/main.ts` -- expected: no formatting differences
- `grep -rniE "laura|ezop|watch\(" server/wikiLint .env.sample` -- expected: no matches
- `corepack yarn build:server`, then `WIKI_LINT_CONFIG_PATH=<tmp malformed file> timeout 60 node build/server/index.js; echo $?` -- expected: one warn JSON or console line with `code` and `location` and no file content; exit status 1
- the same run with `<tmp valid file>` (synthetic UUIDs) -- expected: an info line `Wiki lint policy configuration loaded` with counts and `policySetFingerprint`, printed before any migration or database output (a later failure from a missing database is irrelevant)


## Auto Run Result

Status: done

**Summary.** Story 1.2 adds startup loading and identification of collection lint policy: a pure, iterative, duplicate-aware raw-byte JSON decoder with AD-6 canonical JSON (`core/policyJson.ts`); a pure policy-set builder with startup-fatal code selection, fail-closed sentinels, fingerprints, and deep-frozen output (`core/policySet.ts`); and a shell adapter that loads the file once in each master, logs operator-only fields, and exports the exact bytes to workers through `WIKI_LINT_CONFIG_BASE64`, or warns `{ code, location }` and exits 1 (`adapters/policyConfig.ts`). This was a follow-up review pass on the `done` spec. It closed four regression gaps in the tests and corrected the operator documentation in `.env.sample`; no production source changed.

**Files changed in this pass:**
- `server/wikiLint/adapters/policyConfig.test.ts` — the count fixture gains a second `read_only` entry, so a swapped `read_only`/`enforced` classification fails.
- `server/wikiLint/core/policySet.test.ts` — a missing-member-before-unknown-key root row, a two-sentinel ordering test, and a 3-byte heading load test.
- `server/wikiLint/core/policyJson.test.ts` — decodes one valid 3-byte character from each lead range (E0, E1–EC, ED, EE–EF) with exact span and value.
- `.env.sample` — separates startup-fatal file defects from fail-closed collection entries, and states that the `_FILE` variant is not supported.
- This spec.

**Files of the story (from commit `87588620e8c068fbf574c1c519e830e971fc31ef`):** `server/wikiLint/core/registry.ts` (exports `UUID_PATTERN`), `server/wikiLint/core/policyJson.ts`, `server/wikiLint/core/policySet.ts`, `server/wikiLint/adapters/policyConfig.ts`, `server/index.ts` (loads the policy first in `master()`), `server/main.ts` (eager `getPolicySet()` in `start()`), `server/wikiLint/policy.example.json`, `.env.sample`, and the collocated tests plus `server/index.test.ts`.

**Review findings breakdown** (33 findings: high 0, medium 1, low 17, false 15, maybe-false 0):
- **Patches applied** (6 entries; medium 1, low 5, high 0):
  - medium: the 3-byte UTF-8 decode gap;
  - low: the symmetric count fixture; the lowest-offset root-defect fixture; sentinel ordering; the `.env.sample` failure-class wording; the undocumented `_FILE` exception.

  Every test patch was mutation-checked: each of five mutants (count comparison, `rootDefects[0]`, no sentinel sort, no E1–EF lead, dropped third byte) fails exactly one new or changed test, and the sources were restored byte-identical.
- **Deferred:** none.
- **Rejected,** with reasons in the Review Triage Log:
  - low: `LOG_LEVEL=error` hides the fatal warn (needs a deliberately lowered log level; the fix replaces the spec-pinned channel); sentinels only at `info` (deliberately raised log level; still fail-closed); the overwritten `WIKI_LINT_CONFIG_BASE64` (undocumented name; the fix adds a branch); shallow `readonly` types (runtime freeze throws in the first test; the fix needs a recursive type); the untested eager `getPolicySet()` in `main.ts`, reported by three layers (no observable effect until a consumer exists; the fix mocks the whole worker graph); non-policy services stop on a bad file (deliberate per Design Notes; the fix adds `SERVICES` branching); no operator rule-parameter reference (rare Gate-4 authoring task; the fix is a new document); carried FIFO hang (three rows) and refinement-skip pointer (one row);
  - false: environment transport of the bytes (two rows; the environment already holds far more sensitive secrets); `getPolicySet` reset (vitest isolates modules); unreachable exceptions; relative paths and permissions; the vanished reviewer probe file; the mocked-throng process surface (re-run on the real built server); master once-guard; workers inheriting the path variable; read_only-only fixtures (the epic AC3/AC4/AC10 settle the reading); the nil UUID (matches AC3's definition); worker-side path computation; carried `canonicalJson` cycles, simulated respawn, and unset worker variable.

**Follow-up review recommendation: false.** This was a follow-up pass, and it patched no `high` entry (patched: medium 1, low 5), so the work has converged.

**Verification performed** (final tree):
- `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint server/index.test.ts`: 10 files, 414/414 passed, including the unchanged boundary test.
- `corepack yarn tsc`: exit 0.
- `node_modules/.bin/oxlint --type-aware server/wikiLint server/index.ts server/main.ts server/index.test.ts`: exit 0.
- `node_modules/.bin/oxfmt --check` on the same paths: all 22 files correctly formatted.
- `grep -rniE "laura|ezop|watch\(" server/wikiLint .env.sample server/index.test.ts`: no matches. A grep for U+2028/2029/FEFF/200B/00A0 in the new test files: no matches.
- `corepack yarn build:server`, then `NODE_ENV=production timeout 60 node build/server/index.js`:
  - **Malformed file** (175 bytes, truncated, with planted canaries): one warn JSON line `{"code":"POLICY_CONFIGURATION_MALFORMED","location":175,…}` (EOF = file length), exit 1, no canary, no worker output.
  - **Valid CRLF file** (one `read_only` entry with the heading `Overview – Details`, one entry with empty `rules` and a planted key): an info line with `configStatus: "loaded"`, `readOnlyCount: 1`, `enforcedCount: 0`, `invalidCount: 1`, `policySetFingerprint`, and the sentinel path `/collections/…0002/rules`, with no canary. It came before the next-tick environment-validation exit, which is expected without a database.
- Mutation checks: the five listed above, each restored.

**Residual risks:**
- The eager `getPolicySet()` in `server/main.ts` is still covered by no test; it becomes observable once Stories 1.3/1.5 read the worker set.
- With `LOG_LEVEL=error`, a startup-fatal policy defect exits 1 without its `{ code, location }` line; with `LOG_LEVEL=warn`, sentinels are not logged.
- The sentinel pointer can name a later defect when Zod skips a refinement, and a FIFO or terminal `WIKI_LINT_CONFIG_PATH` hangs the master (both carried, rejected low).
- The real `cluster.fork`/respawn path is verified by reading the code and by the simulated respawn test; Story 3.1 AC5 owns the respawn evidence fixture.
- The git-ignored `build/` directory from the verification build remains in the working copy.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` carries the orchestrator's uncommitted change and was left untouched, as the invocation requires.
