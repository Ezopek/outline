---
title: 'Story 2.1: Classify Enforced Writes and Decide from Post-Operation Policy'
type: 'feature'
created: '2026-10-03'
status: 'done'
baseline_revision: '1cac931a969c20506f719586f40c9f6f24e9ebdd'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** MCP `create_document` and `update_document` ignore collection policy. Nothing classifies a write by its post-operation collection, rejects writes into invalid-policy collections, or owns the AD-13 allow/reject matrix. Stories 2.2–2.7 need one fixed P1 classification and one central decision function to build on. Binding acceptance is `_bmad-output/planning-artifacts/epics.md`, Story 2.1, ACs 1–16.

**Approach:** Classify each MCP create/update once, after the unchanged baseline P0 steps, from the immutable startup policy set, keyed on the baseline-resolved post-operation collection. Add a pure AD-13 decision function with two provisional write-eligibility constants. Implement the complete invalid-policy sentinel path as a modeled, effect-free rejection. Keep unconfigured and `read_only` writes on the exact baseline path. A valid `enforced` write fails closed with no effect until Stories 2.2/2.3/2.5 add projection, transaction, and validation.

## Boundaries & Constraints

**Always:**
- Classification keys (AD-8), taken after P0 and never from the raw `collectionId` input:
  - create (Markdown and HTML): `collection?.id` returned by `authorizeDocumentCreate`, after the template lookup and its `authorize`;
  - update without `publish`, and unpublish (`publish: false`): `document.collectionId`;
  - `publish: true`: the `id` of the collection `authorizeDocumentPublish` returns.
- The classes are: a valid entry with `activation: "enforced"` → `enforced`; an invalid entry → `sentinel`; a valid `read_only` entry, no entry, or a `null`/`undefined` key → `baseline`. The classification is computed once per request, frozen, and never recomputed. `documentCreator`, `documentUpdater`, `DocumentImportTask`, `move_document`, and `restore_document` stay untouched.
- A `baseline` write runs the exact current code path: same writer inputs, same order, no extra query, no timing check, and no new response field.
- For `enforced` and `sentinel`, P1 does three things:
  - computes `readable = can(actor, "read", collection)` once, from a fresh `Collection.findByPk(id, { userId })`;
  - for a create, pre-allocates a lowercase v4 `documentId` with `randomUUID()`;
  - checks the elapsed time since handler entry against `ENFORCED_PRE_WRITE_BOUND_MS = 2000`. Handler entry is a `monotonicClock()` reading taken at the handler's first statement.
  Any P1 failure is AD-20 row 1: an `isError` result with exactly `The operation could not be completed`, no `validation`, and no effect. P1 failures include a policy-set load failure, the readability lookup, and the bound being exceeded.
- `sentinel` result: decided through `decideWrite` and returned as a normal (non-`isError`) result whose first and only text block is `{ "success": false, "validation": { "status": "rejected", "invalidFingerprint"?, "errors": [], "warnings": [], "systemFailures": [<POLICY_CONFIGURATION_INVALID>] } }`. The keys appear in that order. `invalidFingerprint` and the location's `collectionId` are present only when `readable`. The System Failure is built by `createSystemFailure` and located `{ kind: "scope", scopeKind: "collection", collectionId? }`.
- `enforced` (interim): an `isError` result with exactly `The operation could not be completed`. It persists nothing and has no `validation`. It never falls back to the baseline writer or import job.
- `decideWrite` is pure, branches only on issue codes and its explicit inputs, and implements AD-13 exactly (see Design Notes).

**Never:**
- Do not build projection, transaction, locks, re-fetch, `collection_conflict` emission, validation runs, valid-policy response assembly, the HTML enforced worker task, media staging, or write-audit summaries. Those belong to Stories 2.2–2.7.
- Do not change tool names, input schemas, descriptions, registration, UI/API routes, or lower-level writers.
- Do not accept any MCP argument, client metadata, or document prose as a policy, activation, or fail-open input.
- Do not edit `sprint-status.yaml`, `deferred-work.md`, `server/tools/README.md`, `epics.md`, or the SPEC/PRD/spine.
- Do not put environment-specific identifiers in code or fixtures.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unconfigured / `read_only` | Any create/update/unpublish, including a policy-violating body | Byte-identical baseline response keys and persisted state; no `validation` | Baseline errors unchanged |
| Sentinel, collection reader | Markdown or HTML create, template create, `patch` with absent `findText`, update with no changed field, update with a base64 image, unpublish, draft publication | Modeled rejection with `invalidFingerprint` and `collectionId`. No transaction, job, mutating SQL, Event, Attachment, or document change | None (not `isError`) |
| Sentinel, actor without collection read | Document-membership update; publication of a parent-bearing collectionless draft; create under a parent reachable by document membership | Same rejection without `invalidFingerprint` and without location `collectionId` | None |
| Sentinel, P0 fails | Missing document, or an actor denied by the baseline `authorize` | Exact baseline error | Baseline |
| Valid `enforced` (interim) | Any in-scope create/update/publish/unpublish | `isError` `The operation could not be completed`; prior state unchanged | Fixed message |
| `collectionId` input cannot steer | Collected doc in A updated or published with `collectionId: B`; parent in A with `collectionId: B`; collectionless draft updated (no publish) with `collectionId` of a sentinel | Classified by A; draft stays `null` → baseline | Per class |
| P0+P1 over 2 s | Mocked clock advances 2001 ms; enforced or sentinel target | `isError` fixed message, no effect; an unconfigured target under the same clock succeeds as baseline | Row 1 |

</intent-contract>

## Code Map

- `server/tools/documents.ts:424-503` -- `create_document`. P0 is `authorizeDocumentCreate` (:430) plus the template lookup and `authorize` (:437-441). Classify after them. The baseline branches are the HTML job (:447) and the Markdown transaction (:466). They must stay byte-identical.
- `server/tools/documents.ts:676-767` -- `update_document`. P0 is `Document.findByPk` (:681), `authorize` for `unpublish` (:690) or `update` (:696), and `authorizeDocumentPublish` (:699). Restructure so all of P0 runs, then classification, then the unchanged writers: unpublish (:692), `documentUpdater` (:704), and the unchanged-update check (:714). Read `revisionCount` before the writer, as now.
- `server/commands/documentCreator.ts:60-96` -- `authorizeDocumentCreate`. It returns the parent's collection on the parent path, the looked-up collection on the direct path, and `{}` for a team draft. At :111-146, `authorizeDocumentPublish` returns `document.collection`, or the collection looked up from the input for a collectionless draft. Read-only.
- `server/commands/documentUpdater.ts:73,144-148` and `server/models/Document.ts:1249` -- `publish` keeps an existing `collectionId`, so the input cannot move a collected document (AC12 evidence). Read-only.
- `server/wikiLint/adapters/policyConfig.ts:147` -- `getPolicySet()`, the worker's immutable set. It can throw on unloadable bytes, which is a P1 failure.
- `server/wikiLint/core/policySet.ts:25-38` -- `PolicySetEntry` (`status`, `collectionId`, `policy` / `invalidFingerprint`) and `PolicySet.entries`. Look entries up the way `server/wikiLint/application/lintDocument.ts:199-201` does.
- `server/wikiLint/core/contracts.ts:111-141` -- `SystemFailure` and `PolicyIdentity`. Add `ValidationStatus` and `WriteValidation` here.
- `server/wikiLint/core/registry.ts:21` -- `COLLECTION_CONFLICT` (unused here). `createSystemFailure` is at :669. `POLICY_CONFIGURATION_INVALID` has surfaces `all`, and `normalizeLocation` (:540) accepts a collection scope without `collectionId`.
- `server/tools/wikiLint.ts:40` -- module-local `OPERATION_FAILED`. Move it to an exported constant in `registry.ts` and import it in both tools.
- `server/wikiLint/application/deadline.ts:1-5` -- `MonotonicClock` and `monotonicClock`. These are the sanctioned clock seam (AD-18).
- `server/wikiLint/adapters/documentReader.ts:119-135` -- `readCollectionReadability`, the read-side analog. It is tri-state and transaction-bound, so do not reuse it. Add the write variant beside it.
- `server/wikiLint/application/snapshotLimits.ts:11-24` -- the AD-16 caps (1 MiB, 100,000 links). The write-eligibility constants must be separately named and must not reuse these.
- `server/routes/mcp/wikiLint.test.ts:2842-2959` -- an Epic 1 test that asserts baseline writes in sentinel and enforced collections. This story deliberately changes that behavior. Reusable patterns:
  - the `vi.mock` of `policyConfig.getPolicySet` (:67-74);
  - `policySetFor` (`server/tools/wikiLint.test.ts:104`);
  - `recordSql`/`mutationsOf` (`server/tools/wikiLint.test.ts:121,1479`);
  - `callMcpTool`/`buildOAuthUser` (`server/test/McpHelper.ts:15,99`);
  - `vi.spyOn(Collection, "findByPk").mockRejectedValue(...)` for P1 failure;
  - `vi.spyOn(sequelize, "transaction")` and `vi.spyOn(DocumentImportTask, "scheduleAndWait")` for no-transaction and no-job proofs.

## Tasks & Acceptance

**Execution:**
- `server/wikiLint/core/contracts.ts` -- add `ValidationStatus = "validated" | "validated_with_warnings" | "degraded_validation" | "rejected"`. Add `WriteValidation { status; policySchemaVersion?: 1; policyFingerprint?; invalidFingerprint?; errors: Finding[]; warnings: Finding[]; systemFailures: SystemFailure[] }`, with JSDoc saying identity fields appear only for a reader of the classified collection -- AD-12 shape.
- `server/wikiLint/core/registry.ts`, `server/tools/wikiLint.ts` -- export `OPERATION_FAILED = "The operation could not be completed"` beside `COLLECTION_CONFLICT`, and import it in `wikiLint.ts` instead of the local constant -- one AD-20 fixed message.
- `server/wikiLint/application/writeDecision.ts` (new) -- this module holds:
  - the provisional named constants `WRITE_ELIGIBLE_MARKDOWN_BYTES = 262144` and `WRITE_ELIGIBLE_LINK_REFERENCES = 1000`, documented as fixed by Story 3.3 from AD-17 maxima and distinct from the AD-16 caps;
  - `withinWriteEligibility({ markdownBytes, linkReferences })`, which is true only when both are finite non-negative integers at or below their constants, so a missing measure counts as beyond;
  - `decideWrite(input)`, as described in Design Notes.
  -- AC4–AC9.
- `server/wikiLint/application/writeDecision.test.ts` (new) -- cover:
  - every AD-13 row in both modes;
  - `degraded_validation` with Warnings still returned to the caller, because the arrays are untouched;
  - `POLICY_CONFIGURATION_INVALID` alone, and mixed with an eligible failure, rejected in `open`;
  - `VALIDATION_RESOURCE_LIMIT_EXCEEDED` eligible regardless of limits;
  - `RUNTIME_FAILED`/`TIMEOUT` at each limit (within), at limit+1 (beyond), and with each measure missing (`undefined`, `null`, `NaN`);
  - `TIMEOUT` with `halfDeadlineAtP5: false`;
  - an altered System Failure `message` that leaves the decision unchanged.
  -- AC4–AC8.
- `server/wikiLint/adapters/documentReader.ts` -- add `canReadCollection(actor, collectionId): Promise<boolean>` = `can(actor, "read", await Collection.findByPk(collectionId, { userId: actor.id }))`. It lets errors propagate -- the `readable` source.
- `server/wikiLint/application/writeClassification.ts` (new) -- this module holds:
  - `ENFORCED_PRE_WRITE_BOUND_MS = 2000`;
  - the frozen `WriteClassification` union: `{ kind: "baseline" }`, `{ kind: "enforced"; entry; readable; documentId? }`, `{ kind: "sentinel"; entry; readable; documentId? }`, and `{ kind: "failed" }`;
  - `classifyWrite({ collectionId, actor, create, enteredAt, policySet?, clock? })`, which defaults to `getPolicySet()` and `monotonicClock`, catches every P1 failure as `failed`, and skips the read and the bound check for `baseline`;
  - `rejectInvalidPolicyWrite(sentinel)`, which returns `{ success: false, validation }` through `decideWrite` (`runtimeFailureMode: "closed"`, `withinLimits: false`, `halfDeadlineAtP5: false`) and throws `WikiLintContractError` if the status is not `rejected`.
  -- AC1–AC3, AC10.
- `server/wikiLint/application/writeClassification.test.ts` (new) -- cover against the DB:
  - each class;
  - `read_only` → baseline, with no `Collection.findByPk` call (spy);
  - `readable` true for a member and false for a document-only reader;
  - a create gets a UUID `documentId` and an update gets none;
  - a frozen result;
  - a rejected `findByPk`, a throwing policy set, and a clock past 2000 ms are each `failed`, while exactly 2000 ms is not;
  - the sentinel rejection's exact JSON, with and without `readable`.
  -- AC1, AC2, AC10, AC14.
- `server/tools/documents.ts` -- capture `enteredAt` first in both handlers and classify after P0 using the keys above:
  - `failed` → `error(OPERATION_FAILED)`;
  - `sentinel` → `success(rejectInvalidPolicyWrite(...))`;
  - `enforced` → `error(OPERATION_FAILED)`, with a two-line comment naming the interim fail-closed and Stories 2.2/2.3/2.5;
  - `baseline` → the existing code, unchanged.
  -- AC1–AC3, AC10, AC12.
- `server/tools/documents.enforcement.test.ts` (new; mocks `getPolicySet` and `monotonicClock` through `vi.mock` with `importOriginal`) -- add the tool-level fixtures from the I/O matrix and the ACs below. Use one table over the six AC12 paths × {absent, `read_only`, `enforced`, sentinel}. Snapshot `Document`, `Event`, and `Attachment` rows plus the target's `collectionId`/`publishedAt`/`revisionCount`/`text` before and after every rejected or failed call -- AC1–AC3, AC10, AC12–AC16.
- `server/routes/mcp/wikiLint.test.ts:2842` -- narrow the Epic 1 test to the unconfigured and `read_only` collections, rename it accordingly, and keep its `lint_document` violation assertion on the `read_only` collection with the former enforced rules under `read_only`. The new suite owns the sentinel and enforced write behavior -- AC3.

**Acceptance Criteria:**
- Given an in-scope create/update/publish/unpublish into an unconfigured or `read_only` collection, including an HTML create, when it runs through `/mcp/`, then its response keys and persisted state equal those of the same call with no configuration. This holds when the policy set is swapped to make the destination a sentinel inside a `DocumentImportTask.scheduleAndWait` spy before calling through: the baseline job is not reclassified. `documents.create` and `documents.update` API routes into a sentinel collection still succeed as baseline.
- Given a sentinel destination on each AC10 path, when the tool runs, then the result is the modeled rejection, `sequelize.transaction` and `DocumentImportTask.scheduleAndWait` are not called, no INSERT/UPDATE/DELETE is issued, and no row or document field changes. With P0 failing instead, the result equals baseline.
- Given the three AC14 actor fixtures with a sentinel destination they cannot read, when they write, then `validation` carries `status`, empty `errors`/`warnings`, and the one System Failure without `invalidFingerprint`, `policyFingerprint`, `policySchemaVersion`, or `collectionId`. A collection reader's identical call carries both.
- Given an authorized collectionless draft published into a valid `enforced` destination, when `update_document` runs, then the draft's `collectionId`, `publishedAt`, and revision are unchanged and no mutation Event is written. The validation rejection and its audit land with Stories 2.3 and 2.7.
- Given extra arguments (`activation`, `runtimeFailureMode: "open"`, `policy`) or body text that imitates policy front matter, when a write targets a sentinel, enforced, or `read_only` collection, then the outcome equals the call without them.
- Given authorized `move_document` and `restore_document` (with `collectionId`) between every ordered pair of {`enforced`, unconfigured, `read_only`, sentinel} with content invalid under the enforced rules, when each runs, then the responses equal the unconfigured→unconfigured baseline keys and carry no `validation`. These fixtures are labeled compatibility evidence. A subsequent `lint_wiki` reports the moved document's Errors only for the enforced (and `read_only`) destination, `not_evaluated` for unconfigured, and `POLICY_CONFIGURATION_INVALID` for the sentinel.

## Spec Change Log

## Review Triage Log

### 2026-10-03 — Review pass

- verdicts: 28 findings — high 0, medium 0, low 14, false 14, maybe-false 0
- findings:
  - `[low]` `[patch]` blind: `nonBaselineWriteResult` routes `failed` through the return whose comment names only the interim enforced fail-closed — Fixed: `failed` now has its own branch returning `error(OPERATION_FAILED)`. The comment and the final return cover only `enforced`.
  - `[low]` `[reject]` blind: the bare `catch` blocks in `classifyWrite` and `nonBaselineWriteResult` drop the cause, and nothing logs P1 failures — True, but it matches the existing `lint_document`/`lint_wiki` handlers, which return the same fixed message without a log. A P1 failure needs an unloadable master-validated policy set, a failed collection lookup, or a 2 s overrun. A new log line would add operator-diagnostic surface bound by the AD logging rules, which is more than a direct correction.
  - `[false]` `[reject]` blind: the 2 s bound is checked only after the readability lookup and is not a timer — AD-11 and AC2 define it as "elapsed handler time at classification is checked against 2 seconds", not as preemption. Baseline P0 lookups are equally unbounded. An overrun is still detected and ends as row 1 (unit test "fails P1 only once P0 and P1 exceed the 2-second bound"). Reusing `Deadline` is a style preference with no named harm.
  - `[low]` `[reject]` blind: `WriteValidation` uses flat optional identity fields, so the type allows both fingerprints at once — The only producer, `rejectInvalidPolicyWrite`, is pinned to exact JSON by unit and tool tests. A per-kind union adds typing complexity for a misuse with no current caller. Story 2.4, which owns valid-identity assembly, can tighten the type together with its producer.
  - `[false]` `[reject]` blind: `decideWrite` trusts which array an issue is in, so a misfiled Error would pass as a Warning — No caller can misfile one. The only caller passes empty Finding arrays, and Findings are built by `createFinding` with registry-fixed severities, which the result builders split by that severity (`result.ts` `buildReadOnlyResult`). AC5's protection concerns collection configuration, which has no input here.
  - `[low]` `[patch]` blind: `callWithoutEffect` cannot see an Event enqueued through `Event.schedule`, and the `storedState` JSDoc overclaims — Fixed: `Event.schedule` is spied and asserted not called. The JSDoc now names the tables it snapshots and says the mutating-SQL check covers the others.
  - `[low]` `[patch]` blind: the P0-failure test never reaches the template lookup or `authorizeDocumentPublish` — Fixed together with the verification-gap finding of the same root cause: the test adds an unreadable-`templateId` create and a publication that `authorizeDocumentPublish` refuses, each compared unconfigured against sentinel. A mutation that classifies before the template lookup now fails the test.
  - `[low]` `[patch]` blind: the move/restore compatibility test ignores mutation Events — Fixed: each ordered pair's Event names for the moved or restored document must equal the non-empty `absent->absent` list.
  - `[low]` `[reject]` blind: the `WikiLintContractError` path of `rejectInvalidPolicyWrite` and its tool-level `catch` are untested — `decideWrite` returns `rejected` for `POLICY_CONFIGURATION_INVALID` deterministically, so the path is unreachable defensive code. Exercising it needs module mocking of `writeDecision`, which is more than a direct correction.
  - `[low]` `[reject]` blind: nothing warns an operator that an `enforced` entry fails every MCP write until Stories 2.2/2.3/2.5 — AD-19 keeps any `enforced` rollout unauthorized (Gates 2–4), so no deployment meets the interim branch. A startup diagnostic would be new operator surface, beyond a direct correction.
  - `[false]` `[reject]` blind: publishing a collected document whose collection is soft-deleted keys on a null association and fails open — The state is unreachable. `Collection.deleteDocuments` (`server/models/Collection.ts:431-451`) soft-deletes every non-archived document in the same transaction. An archived document fails P0's `authorize(user, "update")` (`isActive`). The paranoid `Document.findByPk` therefore never yields an active document with a null `collection`.
  - `[false]` `[reject]` edge: a concurrent `move_document` between classification and the writer lets a baseline-classified update land in a now-enforced collection — This is specified behavior. AD-8 says a write that is not an enforced write at request time is not reclassified. The collection-change re-check binds only writes classified under a valid `enforced` policy, which Story 2.3 implements.
  - `[false]` `[reject]` edge: a slow readability lookup, or a P0 already past budget, holds the request beyond 2 s — Same refutation as the blind bound finding. The bound is an elapsed check at classification, and the overrun still ends as row 1 with no effect. The extra lookup when P0 is already over budget changes no outcome.
  - `[low]` `[patch]` edge: the request-supplied-values test sends its enforced and sentinel rejections through bare `callMcpTool`, without the no-effect snapshot the Tasks require — Fixed: those calls now go through `callWithoutEffect` and keep their equality assertions. The `read_only` calls are unchanged.
  - `[low]` `[patch]` verification-gap: the counting clock in the bound tests cannot detect where `enteredAt` is taken — Fixed: a new test advances the served clock by 2001 ms only inside a call-through `Document.findByPk` spy, for an `update_document` into a sentinel collection, and expects the fixed-message failure with no effect. A mutation that takes `enteredAt` after the P0 lookup now fails exactly this test (re-run on our side).
  - `[low]` `[patch]` verification-gap: the P0-failure test misses the template read and the publish authorization — Fixed by the same patch as the blind P0-failure finding (shared root cause).
  - `[false]` `[reject]` intent: AC4–AC8 are exercised only by the pure function, and no enforced write reaches `decideWrite` — AC4 names the pure decision function as its surface ("When its validation classification is supplied to the pure decision function"). Story 2.3 AC4 and AC6 apply it to enforced writes.
  - `[low]` `[reject]` intent: AC13 returns the interim `isError`, and its fixture would pass with a clean body — True, the validation rejection and its audit are not shown here. The intent's own story partition delivers them later: Story 2.3 AC4, AC5 (publish variant) and AC7 for the rejection, and Story 2.7 for the audit. Under the sprint-status cross-story convention those stories own the integrated fixture. This story proves the classification and that nothing changes. Recorded as a residual risk, because AC13 is not in the convention's known-case list.
  - `[low]` `[reject]` intent: the tool-level enforced 2 s fixture cannot tell the bound from the interim fail-closed — By design, both outcomes are the same fixed-message failure until Story 2.3. The `classifyWrite` unit test separates enforced at 2000 ms from `failed` at 2001 ms, and the sentinel tool fixtures prove the bound at the handler. A discriminating enforced tool fixture is possible only once 2.3 replaces the interim branch.
  - `[false]` `[reject]` intent: the pre-allocated `documentId` is unused — Story 2.2 AC1 consumes it ("a create's projection uses the pre-allocated document ID from Story 2.1"). AC2 requires only its allocation at P1.
  - `[false]` `[reject]` intent: a policy-set load failure blocks writes into a collection without a policy entry — When the set cannot load, whether the collection has an entry is unknowable, so no baseline analog exists, and AD-20 P1 prescribes the fixed message. A `null` post-operation collection still returns `baseline` without loading the set.
  - `[false]` `[reject]` intent: AC14 is exercised only through the sentinel, so the valid-identity absence checks cannot fail — In this story every `validation` object comes from the sentinel path, and its gating is proven for all three non-reader paths. Valid-policy `validation` objects first exist in Stories 2.3/2.4 (2.4 AC1, AC4).
  - `[false]` `[reject]` intent: the tests assert no summary INSERT, the opposite of AC10/AC13's attempted summary — `2.1 AC10 -> 2.7` is a named cross-story case in the sprint-status conventions. Recorded as a residual: Story 2.7 must relax `callWithoutEffect` to allow exactly its audit insert.
  - `[false]` `[reject]` intent: AC11 `collection_conflict` is neither implemented nor tested — `2.1 AC11 -> 2.3/2.5` is a named cross-story case. No re-fetch or worker re-authorization exists yet.
  - `[false]` `[reject]` intent: AC9 is met only by the decision allowlist — In this story no authorization, input, configuration, or write-step failure can reach `decideWrite`, whose only caller passes fixed inputs. The allowlist rejects every non-runtime code in both modes (unit tests). Lock, staging, and commit failures do not exist before Stories 2.3/2.5/2.6.
  - `[false]` `[reject]` intent: failing valid `enforced` writes closed, instead of keeping the Epic 1 baseline, sits uneasily with "no policy or rollout activation" — Keeping the baseline would persist unvalidated Enforced Writes, against FR-11/FR-14/FR-15 ("validated before persistence") and the story's "validation cannot be bypassed". A modeled runtime failure would misplace a P4 gap as an AD-13 row. "No rollout activation" refers to AD-19 deployments, which this change does not touch, and no authorized deployment carries an `enforced` entry.
  - `[low]` `[reject]` intent: AC1's "client metadata" is not exercised by a fixture — `classifyWrite` receives only the baseline-resolved collection, the actor, the create flag, and the entry time, so no metadata path exists. A fixture would need a custom JSON-RPC request with `_meta`, beyond a direct correction, for a defect with no code path.
  - `[false]` `[reject]` intent: there are no fixtures for a failing unpublish precondition, the import-size limit, or model validation — AC10 names its fixtures (HTML create, template, absent patch target, unchanged update, embedded images, unpublish, every destination path), and all are present. The other checks are listed as not run, and the no-transaction, no-mutating-SQL, and no-`Event.schedule` assertions prove the path returns before any writer.

### 2026-10-03 — Follow-up review pass

- verdicts: 12 findings — high 0, medium 0, low 12, false 0, maybe-false 0
- findings:
  - `[low]` `[patch]` blind: the P0 template case used a nonexistent UUID, so it did not exercise authorization of an existing inaccessible template — Replaced it with a private template and an actor who can create in the public destination but cannot read that template; both baseline and sentinel outcomes remain equal.
  - `[low]` `[reject]` blind: no MCP fixture creates a collectionless draft — The create handler passes the resolved `undefined` collection key to the shared classifier, whose nullish baseline behavior is tested directly. Another database fixture adds little protection for this unchanged baseline path.
  - `[low]` `[reject]` blind: baseline outcome comparison checks selected stored fields and response keys rather than every value — The MCP branch invokes the unchanged writer with the unchanged inputs. Dynamic response identifiers and URLs differ across fixture calls; extending normalization to all values would add test machinery without an observed behavior difference.
  - `[low]` `[reject]` blind: no MCP assertion counts collection reads on the baseline path — The shared classifier unit test spies on `Collection.findByPk` and proves zero calls for `read_only`, unconfigured, and null destinations; the handlers call it once after P0. A second spy at the MCP layer would repeat that proof.
  - `[low]` `[reject]` blind: the `read_only` extra-argument comparison checks response keys only — The input schema drops these unknown policy-like arguments and the baseline branch has no reader for them. A full-state comparator would duplicate the existing branch and schema evidence.
  - `[low]` `[reject]` blind: the `read_only` policy-prose fixture does not assert its saved body — The fixture sends prose as document text through the unchanged baseline writer, and the destination matrix already checks persisted text. An additional text assertion would mirror that code path.
  - `[low]` `[reject]` blind: policy-set load failure has no MCP-level fixture — `classifyWrite` tests the failure and the handler routes its `failed` result through the same fixed-message branch exercised by the MCP deadline fixture. Simulating startup load failure at the MCP boundary would require another global-module seam with no uncovered branch.
  - `[low]` `[reject]` blind: collection-read failure has no MCP-level fixture — Its `failed` result uses the same fixed-message handler branch as the deadline fixture; the classifier test covers the failed read. An additional database fixture would repeat the result mapping.
  - `[low]` `[reject]` blind: move/restore evidence omits response values and Event payloads — Those tools and their writer code are untouched by this story. Existing checks cover the response shape, nonempty Event names, destination state, and subsequent lint state; a payload normalizer would enlarge compatibility tests without a demonstrated regression.
  - `[low]` `[patch]` blind: post-move `lint_wiki` accepted any document Error as drift evidence — The check now requires `REQUIRED_SECTION_MISSING` for each moved document in an enforced or `read_only` destination.
  - `[low]` `[reject]` intent: MCP tests mock the startup policy getter, so they do not prove real configuration loading — Config loading is covered at the policy adapter boundary; this story changes the document tools' response to the immutable set, which the MCP fixtures exercise. A startup-config end-to-end test would add a separate environment harness.
  - `[low]` `[reject]` intent: the baseline response/state proof is narrower than byte-identical output — Same evidence and limitation as the blind baseline-comparison finding. The implementation preserves the original writer branch and inputs after the classifier returns `baseline`.

## Design Notes

**Interim fail-closed for valid `enforced`.** Projection (2.2), the AD-8 transaction and validation (2.3), and the HTML worker (2.5) do not exist yet. Falling back to the baseline writer would be exactly the bypass this story exists to prevent. Fabricating a `VALIDATION_RUNTIME_FAILED` modeled rejection would misplace a P4-phase gap as an AD-13 runtime failure. AD-20's catch-all puts any unplaced failure before the decision at row 3, which is a fixed-message `isError` with no `validation`. Story 1.3 followed the same precedent: it failed closed until Story 1.4. Under the sprint-status cross-story convention, later stories own these integrated fixtures:
- AC10 summary → 2.7;
- AC11 → 2.3/2.5;
- AC13 rejection and audit → 2.3/2.7;
- AC14 valid-identity omission → 2.4, while 2.1 proves it through the sentinel;
- AC9 lock/staging/commit row mapping → 2.3/2.5/2.6.
This story proves that the decision function has no input through which those failures could fail open.

**`decideWrite`.**

```ts
if (errors.length > 0) return "rejected";
if (systemFailures.length === 0) return warnings.length ? "validated_with_warnings" : "validated";
if (runtimeFailureMode !== "open") return "rejected";
const eligible = (code) =>
  code === "VALIDATION_RESOURCE_LIMIT_EXCEEDED" ||
  (code === "VALIDATION_RUNTIME_FAILED" && withinLimits) ||
  (code === "VALIDATION_TIMEOUT" && withinLimits && halfDeadlineAtP5);
return systemFailures.every((f) => eligible(f.code)) ? "degraded_validation" : "rejected";
```

## Verification

**Commands:**
- Start the test PostgreSQL per memory `local-test-postgres` -- expected: `pg_isready -h 127.0.0.1 -p 5432` accepts connections.
- `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint server/tools/documents.test.ts server/tools/documents.enforcement.test.ts server/tools/wikiLint.test.ts server/routes/mcp` -- expected: all pass.
- `corepack yarn tsc` -- expected: exit 0.
- `node_modules/.bin/oxlint --type-aware` and `node_modules/.bin/oxfmt --check` on the changed files -- expected: clean.
- Temporary mutations, each reverted afterwards -- expected: the suites fail for each:
  - classify on `input.collectionId`;
  - drop the `readable` gate on `invalidFingerprint`;
  - send `enforced` to the baseline branch;
  - make a missing measure count as within limits.

## Auto Run Result

Status: done

**Summary.** Follow-up review of the committed Story 2.1 implementation found no production-code defect. MCP writes classify by the resolved post-operation collection; baseline writes retain their writer path, invalid-policy destinations receive the modeled rejection, and valid enforced destinations fail closed pending the later stories. The pure AD-13 decision remains covered by its unit tests.

**Files changed in this pass.** `server/tools/documents.enforcement.test.ts` now tests authorization of an existing private template after the destination's P0 authorization, and requires `REQUIRED_SECTION_MISSING` when `lint_wiki` reports moved content. This spec records the follow-up triage and verification. No deferred-work ledger entry or sprint board was edited in this pass.

**Review.** Twelve low findings: two direct test patches, ten rejected with individual reasons in the follow-up triage log. No item was deferred. Patched entries by verdict: high 0, medium 0, low 2. Follow-up review recommendation: `false`; neither patch changed production behavior.

**Verification.** PostgreSQL 14 in the existing scratch cluster was resumed after the first Vitest attempt timed out while connecting to `127.0.0.1:5432`. Then `TZ=UTC node_modules/.bin/vitest run --project server server/tools/documents.enforcement.test.ts` passed 53/53 tests; the full specified Vitest command passed 30 files and 1204/1204 tests. `corepack yarn tsc`, `oxlint --type-aware` on the changed test, and `oxfmt --check` on the changed test exited 0. The prior pass's five mutation checks remain recorded in the committed review result; this pass made no production-code change.

**Residual risks.** Valid enforced writes still fail closed until Stories 2.2/2.3/2.5. The provisional eligibility constants await Story 3.3. The follow-up review added no new deferred work.
