---
title: 'Story 2.4: Preserve Exact MCP Write Responses and Baseline Compatibility'
type: 'feature'
created: '2026-10-03'
baseline_revision: 'e97f82440da671647e919fd24fea30e47c3d6191'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Story 2.3 maps every AD-20 row of an enforced Markdown write to an MCP result, but its row-6 assembly has no total time bound: each enrichment is guarded, yet the assembly can still wait indefinitely or raise into the handler's `isError` path. Response compatibility is also unproven at the MCP surface for committed `validated_with_warnings` and `degraded_validation` results, for actors without collection read, for row 7, and for determinism across clients. Binding acceptance is `_bmad-output/planning-artifacts/epics.md`, Story 2.4, ACs 1–9.

**Approach:** Charge the buffered-callback wait and the response enrichments of a committed write to one AD-11 post-commit assembly deadline of 2 seconds. Move row-6 assembly behind a boundary that never throws: enrichments run in parallel, each guarded and raced against that deadline, and any other failure falls back to `{ success: true, id, validation }`. Then add one collocated MCP-level response-compatibility suite for the evidence the existing fixtures lack.

## Boundaries & Constraints

**Always:**
- One post-commit deadline per committed attempt. `runAttempt` starts `new Deadline(POST_COMMIT_ASSEMBLY_BOUND_MS, monotonicClock)` once the commit is established, immediately before the callback wait. It passes `remainingMs()` to `runCallbacks` and returns the deadline on row 6 as `assembly`. The handler gives the enrichments only what remains, so callbacks plus enrichments take at most 2 s in total.
- Row-6 assembly in `server/tools/documents.ts`:
  - The optional enrichments are exactly `breadcrumb`, `shareUrl` (patch only), and the patch second block. They start together. Each runs as `guarded(step)` raced against `assembly.remainingMs()` with the shared `within` helper. None starts when the deadline has already expired. An expired or failed enrichment is omitted.
  - Non-patch identity is the synchronous `pathToUrl(user.team, { id, title, url })` of the committed document. Patch identity is `pathToUrl(user.team, attributes)`, where `attributes` is the guarded `presentDocument(..., { includeData: false, includeText: true, includeUpdatedAt: true })` result without `text`.
  - When the identity cannot be assembled (presentation failed or expired, or `pathToUrl` throws), the first block is exactly `{ success: true, id, validation }`. A patch echo that was presented is still returned as the second block.
  - A present patch echo keeps baseline semantics: `typeof text === "string" ? text : ""`.
  - Key order is the baseline order with `validation` last. The whole row-6 path sits inside a `try`/`catch` that returns the fallback, so it can never become a Tool-Execution Error.
- Rows 2, 3, 4, 5, and 7, the sentinel, the `failed` class, and the baseline branches keep their current results byte for byte.
- `within` moves unchanged from `server/wikiLint/adapters/writeTransaction.ts` to `server/wikiLint/application/deadline.ts` as an export. `writeTransaction.ts` imports it from there.
- New tests are collocated in `server/tools/documents.responses.test.ts`. Module seams in that file are passthrough by default and overridden only inside the test that needs them: the policy set, `./util` (`getDocumentBreadcrumb`, `getPublicShareUrlForDocument`, `pathToUrl`), and `@server/presenters` (`presentDocument`).

**Never:**
- Do not build the AD-7 fingerprint-mismatch rejection. It exists only on the HTML worker path, and Story 2.5 builds it and owns its fixtures (cross-story map: 2.4 AC3 → 2.5). Do not write `wikiLint.write_validation` summaries (Story 2.7), and do not touch the HTML interim or media.
- Do not change tool names, input schemas, descriptions, annotations, `/mcp` routing, or the baseline branches. Add no client-specific endpoint, adapter, prompt, or policy contract.
- Do not modify `server/models`, `server/commands`, `server/presenters`, `shared/utils`, `server/editor`, `server/storage`, or `server/tools/util.ts`. Do not import the post-`v1.10.1` patch fix.
- Do not edit `sprint-status.yaml`, `deferred-work.md`, `epics.md`, `server/tools/README.md`, or the SPEC/PRD/spine. Do not add pilot identifiers.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Committed, reader | Update by a collection member: valid body; valid body + blockquote; open policy with a link whose savepoint read fails, plus a blockquote | Baseline fields, then `validation`. Status `validated` / `validated_with_warnings` / `degraded_validation`, the last with its Warning kept and one `VALIDATION_RUNTIME_FAILED` at `scope{collection, collectionId}`. Identity is `policySchemaVersion: 1` plus `policyFingerprint`, never `invalidFingerprint` | — |
| Committed, non-reader | Same writes by a document-membership editor of a private collection | Same statuses and codes. No identity, no `collectionId`, no `detail` | — |
| Enrichment fails | Breadcrumb throws (non-patch and patch); `shareUrl` throws (patch, publicly shared doc); `presentDocument` throws (patch); `pathToUrl` throws (non-patch, patch) | Only the failed enrichment is omitted. Identity failure → first block `{success:true,id,validation}`; patch keeps its echo unless presentation failed, in which case there is one block | Never `isError` |
| Assembly too slow | Patch update of a Y.js-state document: collaboration notify held 1200 ms, breadcrumb resolving after 1000 ms, `shareUrl` never resolving; versus notify immediate | Response within 2 s (+ small slack) of COMMIT. Breadcrumb omitted with the held notify, present without it. `shareUrl` omitted in both. Write committed | Never `isError` |
| Row 7 | Open policy and degraded decision; socket destroyed at `COMMIT;` on a create | `isError` with exactly `OPERATION_FAILED`, no `validation`, no document | `isError` |
| Unchanged scopes | `read_only` and absent (another collection configured) vs no configuration: create, replace, patch success; absent `findText`, unchanged update, unpublish of a parent | Results equal the unconfigured run after normalizing IDs, `urlId`s, and timestamps; failures equal exactly. No `validation`, no `wikiLint.*` Event | Baseline |
| Repeats | One rejected update (two missing sections, a table, a blockquote) via OAuth, API key, and OAuth with another User-Agent; two degraded creates | Byte-identical rejected results; degraded results identical after normalizing the allocated ID | — |

</intent-contract>

## Code Map

- `server/tools/documents.ts:123-135` -- `guarded`, which the row-6 assembly keeps using.
- `server/tools/documents.ts:137-234` -- `enforcedWriteResult`. Rows 2/3/4/5/7 stay. Its row-6 tail (:180-233) is replaced by the bounded, non-throwing assembly; rewrite it in place or as a sibling helper.
- `server/tools/documents.ts:701-732,985-1010` -- the enforced branches. Their calls stay as they are.
- `server/tools/documents.ts:783-792,1044-1082` -- the frozen baseline non-patch and patch responses, which the enforced shapes mirror.
- `server/wikiLint/application/enforcedWrite.ts:89-94,501-508` -- `EnforcedWriteOutcome` (row 6 gains `assembly: Deadline`) and the commit-established tail, where the deadline starts before `runCallbacks`.
- `server/wikiLint/application/deadline.ts:42-46` -- `POST_COMMIT_ASSEMBLY_BOUND_MS`. Its doc says callbacks only; it now covers callbacks plus enrichments in total. `within` moves here.
- `server/wikiLint/adapters/writeTransaction.ts:141-165,215,404,438,500` -- `within` and its four uses. `runCallbacks` (:419-446) is unchanged.
- `server/tools/util.ts:82-112,255,412,462` -- `success`/`error`, `getDocumentBreadcrumb`, `getPublicShareUrlForDocument`, and `pathToUrl`, used read-only and as mock seams.
- `server/presenters/document.ts:29` -- `presentDocument`, which is async.
- `server/models/Document.ts:628-643` -- `@AfterUpdate notifyCollaborationServer` registers `afterCommit(notify)`. `notify` awaits `APIUpdateExtension.notifyUpdate`, and it fires only when `state` changed (a text edit of a Y.js-state document).
- `server/test/factories.ts:72` -- `buildShare` (published) makes `shareUrl` present. `buildApiKey` is at :60.
- Existing evidence, not duplicated, in `server/tools/documents.enforcement.test.ts`:
  - the exact sentinel and valid-policy rejections, readable and not (:151, :335, :868-1018);
  - row-1 baseline failures (:780);
  - the destination matrix with key/state parity for unconfigured/`read_only` (:596);
  - committed keys and patch echo vs baseline (:1656);
  - row 2 (:1771, :1835), row 3 (:1902), and row 5 (:1955);
  - move/restore (:1328).
- Patterns to copy:
  - the policy-set and clock `vi.mock` seams (`documents.enforcement.test.ts:41-63`);
  - `failSavepointReads` (`server/wikiLint/application/enforcedWrite.test.ts:365`);
  - the socket destroy at `COMMIT;` (`enforcedWrite.concurrency.test.ts:653-673`);
  - the Y.js state setup (`documents.enforcement.test.ts:1734-1749`);
  - `rpc`/`apiKeyToken` with extra headers (`server/routes/mcp/wikiLint.test.ts:349-375`).
- `server/wikiLint/core/registry.ts` (`createSystemFailure`, `OPERATION_FAILED`) -- builds the exact expected System Failures.

## Tasks & Acceptance

**Execution:**
- `server/wikiLint/application/deadline.ts` -- Export `within`, moved verbatim. Reword the `POST_COMMIT_ASSEMBLY_BOUND_MS` doc to the total post-commit assembly: callback wait plus response enrichments. -- AD-11 single 2 s term.
- `server/wikiLint/adapters/writeTransaction.ts` -- Delete the local `within` and import it from `../application/deadline`. -- Reuse without duplication.
- `server/wikiLint/application/enforcedWrite.ts` -- Row 6 becomes `{ row: 6; document; validation; assembly: Deadline }`. Start the deadline once the commit is established and pass its remainder to `runCallbacks`. -- AC2 total bound.
- `server/tools/documents.ts` -- Implement the row-6 assembly as in Always, and update the `enforcedWriteResult` doc comment. -- AC1, AC2.
- `server/tools/documents.responses.test.ts` (new, DB) -- Cover every I/O-matrix row as an MCP fixture. Also cover AC8 discovery: `tools/list` returns identical `create_document`/`update_document` entries with and without an enforced configuration. Their `inputSchema` property names must be exactly the baseline lists: create `title, text, format, sourceFileName, collectionId, parentDocumentId, templateId, icon, color, publish, fullWidth`; update `id, title, text, editMode, findText, collectionId, icon, color, publish, fullWidth`. In every committed and rejected case, assert that `validation.status` is present. Every non-reader response, and every response at all, must also contain none of: the classified and decoy collection IDs, any fingerprint, the identity field names, `detail`, `activation`, `runtimeFailureMode`, or rule kinds. Committed identity values must equal the stored document's `id`, `title`, and `new URL(path, team.url).href`. For patch, the nested `document` keys must equal the baseline's. -- AC1–AC9 evidence.
- `server/wikiLint/application/enforcedWrite.test.ts` -- Assert that a committed outcome's `assembly` started no earlier than the commit and that its remainder is at most `POST_COMMIT_ASSEMBLY_BOUND_MS`. -- Pins the deadline's start.

**Acceptance Criteria:**
- Given any row-6 write whose enrichments fail, throw, or exceed the deadline, when the MCP result is returned, then it is never `isError`, its first block keeps `validation` as the last key, and only the failed parts are missing.
- Given a committed write whose buffered callbacks and enrichments together exceed 2 s, when its MCP result returns, then at most `POST_COMMIT_ASSEMBLY_BOUND_MS` plus scheduling slack has elapsed since COMMIT resolved.
- Given an enforced write by an actor without collection read, when it ends in row 4 or row 6, then the response reveals only the status, its own Findings by code and location, and System Failures located without `collectionId`.
- Given the `create_document` and `update_document` registrations, when `git diff 4a5a616a21be800257dc11cef4263d0dd0412156 -- server/tools/documents.ts` is read, then no tool name, description, annotation, or input-schema line changed.
- Given the existing suites, when they run, then every existing enforcement, projection, shell, and route fixture passes unchanged.

## Spec Change Log

## Review Triage Log

### 2026-10-03 — Review pass

- verdicts: 26 findings — high 0, medium 2, low 13, false 11, maybe-false 0
- findings:
  - `[low]` `[reject]` blind: the unit test "starts the post-commit assembly deadline once the commit is established" would also pass if the deadline were built after `runCallbacks`, and its `remainingMs() <= bound` assertion is vacuous — Real weakness, but the property is pinned at the MCP surface. With the notify held 1200 ms, a deadline started after the callbacks would give the 1000 ms breadcrumb time to land and push the answer past the bound, so the assembly-bound fixture would fail. The temporary mutation that gives enrichments a fresh budget fails it in the same way. On the probe path, the deadline is created only after `probeCommit` returns `present`, as AD-20 requires.
  - `[medium]` `[patch]` blind: the `assembly.expired()` short-circuit and an expired patch presentation are never exercised — Grouped with the verification-gap row below. Fixed: the assembly-bound describe gained two cases. In one, a presentation never resolves: the answer is the single-block `{ success: true, id, validation }` within the bound. In the other, the callbacks use up the bound: no enrichment seam is called and the same fallback is returned. A 20 ms busy-wait in the `bound_expired` report removes a sub-millisecond race between the timer and the clock. Mutations dropping `optional(...)` around the presentation, or dropping the `expired()` short-circuit, now fail.
  - `[low]` `[reject]` blind: enrichment failures, expiries, and the outer catch are swallowed without an operator log — Real, but the contract only requires omission (Story 2.4 AC2, AD-12), and AD-20 defines the minimized correlated diagnostic for callback failures only. A log would mean threading `requestId` into `enforcedWriteResult` and adding branches. Not worth it for a path that only fires when an enrichment fails.
  - `[low]` `[patch]` blind: the wall-clock bound check has only 300 ms of end-to-end slack and no lower bound — Fixed: `SCHEDULING_SLACK_MS` is now 700, still below the ~3.2 s a fresh-budget regression produces. Each bound case also asserts `elapsed >= POST_COMMIT_ASSEMBLY_BOUND_MS - 50`.
  - `[low]` `[reject]` blind: the exported `within` has no unit tests, and `readAudit.ts` keeps its own inline race — `within` was moved verbatim. Its expiry value, timer clearing, and clamping are exercised through the `runCallbacks`, commit-timer, and probe tests in `writeTransaction.test.ts` and through the new bound fixtures. The `readAudit` race predates this story.
  - `[low]` `[reject]` blind: committed non-reader responses are covered only on the document-membership replace path — The identity gate is the single `writeValidation({ readable })` builder. The per-path `readable` flag for the three AD-18 paths is proven by the existing row-4 fixtures (`documents.enforcement.test.ts:868-1018`). More committed fixtures would retest the same gate.
  - `[low]` `[reject]` blind: committed `validation` assertions use `toEqual`, which ignores key order — Row 4 and row 6 build `validation` with the same `writeValidation` builder, and the row-4 MCP fixtures compare exact serialized text. A key-order change would fail them. The repeat fixtures also prove byte-identical serialization.
  - `[low]` `[reject]` blind: cross-client determinism varies only the User-Agent and credential, and is not checked for committed `validated`/`validated_with_warnings` writes — Response assembly reads no request header: `presentDocument` runs with no context, and the stateless `/mcp` passes the handler only arguments and auth. Extra client variations would exercise no new branch.
  - `[low]` `[reject]` blind: the discovery test cannot fail because of configuration, and it pins only property names — The `git diff 4a5a616a…` check over `documents.ts` (run in Verification) proves that no registration, description, annotation, or schema line changed. A full snapshot would duplicate upstream strings without adding any authority.
  - `[low]` `[reject]` blind: the `wikiLint.*` Event-count assertion cannot fail today — It is a forward guard by design. No write-validation writer exists until Story 2.7, which owns the positive control (cross-story map 2.1 AC10 → 2.7).
  - `[false]` `[reject]` blind: Story 2.7's audit could later run after the assembly deadline starts and use up its budget — In this diff nothing runs between the established commit and `new Deadline`. Where to place the audit, and where its 3 s AD-11 term sits, is Story 2.7's work.
  - `[low]` `[reject]` edge: abandoned enrichment reads keep running after the response and hold pool connections — True, but the baseline holds the same connection while also blocking the response. Cancelling reads would need abort signals or statement timeouts on upstream helpers, which is more than a direct correction for a read that stalls past 2 s.
  - `[false]` `[reject]` edge (claim): an identity failure drops a breadcrumb and share URL that succeeded — Story 2.4 AC2 and AD-12 fix the identity-failure first block to exactly `{ success: true, id, validation }`, and so does this spec's I/O matrix.
  - `[false]` `[reject]` edge (claim): a non-reader's patch response reveals the classified collection ID — `presentDocument` sets `collectionId` for every non-public presentation (`server/presenters/document.ts:108-112`), so the unconfigured v1.10.1 patch response gives it to the same document editor. AC1 requires preserving baseline document fields. The AD-12 readability gate binds `validation`'s identity and locations, and those are gated.
  - `[false]` `[reject]` edge (claim): a probe-established commit can answer ~4 s after COMMIT — On the probe path the commit is established when the probe finds the row (AD-20), and the probe is charged to the 9 s persistence budget (AD-11). The 2 s assembly bound runs from that point, and the 55 s sum holds.
  - `[medium]` `[patch]` verification-gap: the patch presentation is never tested against the post-commit deadline — Grouped with the blind expired-path row; the same two fixtures were added.
  - `[false]` `[reject]` intent: baseline parity is shown against the fork's unconfigured run, not an upstream v1.10.1 run — The unconfigured branch runs the v1.10.1 response assembly unchanged (the diff against `4a5a616a…` touches only enforced branches and helpers), and the upstream `documents.test.ts` passes.
  - `[false]` `[reject]` intent: the post-commit tail of `runAttempt` sits outside the row-6 no-throw boundary — None of it can throw. `runCallbacks` catches every callback failure and every report failure, and the `Deadline` construction and the `finally` assignments cannot fail.
  - `[false]` `[reject]` intent: a failed patch presentation also drops the echo — The echo is that presentation's own `text` (baseline semantics). Without a presentation there is no baseline final Markdown to return.
  - `[low]` `[reject]` intent: replace mode's assembly is not timed — Both modes race the breadcrumb through the same `optional` call in one `Promise.all`. The patch fixtures time it, and the no-`within` mutation fails the suite.
  - `[false]` `[reject]` intent: AC5's never-degraded classes are not exercised — Existing suites prove each class: sentinel rejections, the `+1 byte` and queued-timeout row-4 fixtures, the `writeDecision` matrix, and the row 1/2/3/5 MCP fixtures. Row 7 is new here. Audit failure has no source before Story 2.7.
  - `[false]` `[reject]` intent: AC3's fingerprint-mismatch rejection is deferred by a convention outside the story text — Only the Story 2.5 HTML worker can produce an AD-7 mismatch, and the cross-story map assigns its fixtures to 2.5. No Markdown path compares fingerprints.
  - `[false]` `[reject]` intent: AC6 rows 2, 3, and 5 rely on existing fixtures — Those fixtures run at the MCP surface and assert exact results without `validation` (`documents.enforcement.test.ts:1771`, `:1835`, `:1902`, `:1955`).
  - `[low]` `[reject]` intent: AC7's audit assertion cannot fail today — Same as the blind forward-guard row.
  - `[false]` `[reject]` intent: AC8 uses no real MCP client — The PRD scopes real-client evidence to the Gate 4 pilot (OD-6), which is not authorized. In the repo, discovery and invocation run through the single `/mcp`, and the diff adds no route, adapter, or prompt (verified by diff and grep).
  - `[low]` `[reject]` intent: AC9 determinism is not checked across clients for committed `validated` writes — Same as the blind cross-client row.

### 2026-10-03 — Follow-up review pass

- verdicts: 13 findings — high 0, medium 1, low 11, false 1, maybe-false 0
- findings:
  - `[medium]` `[patch]` blind: an enrichment can win `Promise.race` after the shared deadline when the event loop delays the timer — `guarded(step)` may resolve after a synchronous delay, before the queued timer callback. Each optional result now checks `assembly.expired()` after its race; a collocated MCP test proves that a late breadcrumb is omitted.
  - `[low]` `[patch]` blind: committed reader fixtures did not assert `success: true` — Added the direct assertion in the committed response matrix; all six cases pass.
  - `[low]` `[patch]` blind: committed reader fixtures compared baseline keys but not breadcrumb values — Added a comparison with the baseline twin's breadcrumb; the stored ID, title, and URL were already checked separately.
  - `[low]` `[reject]` blind: patch fixtures do not compare every nested document value with a baseline twin — The unchanged `presentDocument` options and `pathToUrl` call serve both branches; the MCP fixture checks nested keys and stored ID, title, URL, and echo. Normalizing every additional dynamic presenter field would add a second presenter contract to this suite for negligible risk.
  - `[low]` `[reject]` blind: committed non-reader fixtures cover replace but not patch — carried: the previous review verified the single `writeValidation({ readable })` identity gate and the row-4 path matrix for the per-path readability flag. The code still uses that builder for committed paths.
  - `[low]` `[reject]` blind: the rejected repeat fixture sorts codes and does not assert full ordered Findings — Its byte-identical MCP results prove repeat ordering; the core `ordering.test.ts`, `result.test.ts`, and rule tests pin the AD-4 order, severity, and locations. Repeating the full engine contract here would add brittle fixture detail.
  - `[low]` `[reject]` blind: broad ID normalization can hide a wrong document in an unchanged-scope response — The existing destination matrix compares response keys, success, and persisted document roles and contents across configured and unconfigured runs; the baseline branches were not changed. More identity checks here would duplicate that matrix.
  - `[low]` `[reject]` blind: the new unchanged-scope success fixtures do not compare persisted state — `documents.enforcement.test.ts`'s destination matrix already compares stored title, text, collection, parent, publication, and revision count for both paths. The new fixtures add exact MCP result parity.
  - `[low]` `[reject]` blind: unchanged-scope failure fixtures do not assert no partial state or Event — The unchanged baseline branches produce the same exact error result as the unconfigured run, and this suite checks zero `wikiLint.*` Events. Adding state snapshots for three pre-existing baseline errors would duplicate the existing baseline behavior coverage.
  - `[low]` `[reject]` blind: the deadline fixtures do not isolate a late breadcrumb from a successful share URL — The same `optional` function races each enrichment independently; the failure matrix proves that a missing breadcrumb retains the share URL and echo, and the timeout matrix proves the deadline omission. A further 2-second fixture is unlikely to catch a separate branch.
  - `[low]` `[reject]` blind: no fixture returns a non-string patch echo from the presenter — The unchanged baseline ternary `typeof text === "string" ? text : ""` is copied exactly. A malformed presenter return is outside normal operation; another mock would only restate that direct expression.
  - `[false]` `[reject]` intent: baseline parity uses the fork's unconfigured path rather than a separately running v1.10.1 — carried: the prior review established that the unconfigured branch retains the v1.10.1 response assembly and its upstream suite passes. The new patch touches only enforced row-6 assembly.
  - `[low]` `[reject]` intent: different credentials and User-Agent are narrower than independent MCP clients — carried: the previous review established that the repo's supported surface is the same `/mcp` route and real-client pilot evidence belongs to Gate 4. These repeat fixtures still exercise OAuth, API key, and header variation at `/mcp`.

## Design Notes

**One shared 2 s.** AD-11 and AD-20 have the shell wait for the callbacks "within the AD-11 post-commit assembly bound". They also bound "post-commit response assembly ... at 2 seconds in total". The Markdown sum of 55 s (2 + 30 + 9 + 9 + 3 + 2) has exactly one 2 s post-commit term. So the callback wait and the enrichments share one deadline, and enrichments get only what the callbacks left.

**Shape of the bounded assembly** (non-patch):

```ts
const optional = async <T>(step: () => Promise<T> | T) => {
  if (assembly.expired()) return undefined;
  const result = await within(guarded(step), assembly.remainingMs(), undefined);
  return assembly.expired() ? undefined : result;
};
try {
  const breadcrumb = await optional(() => getDocumentBreadcrumb(document, user));
  const identity = pathToUrl(user.team, { id, title, url });   // throw → fallback
  return success({ success: true, ...identity, ...(breadcrumb !== undefined && { breadcrumb }), validation });
} catch { return fallback(); }
```

A timed-out step keeps running in the background. `guarded` absorbs its rejection, so nothing goes unhandled.

**Not tightening `WriteValidation`.** Story 2.1 noted that 2.4 *could* make the identity fields a per-kind union. No AC requires it, and both producers are pinned by exact-text fixtures, so it is skipped.

## Verification

**Commands:**
- `scripts/test-db.sh ensure` -- expected: exit 0. A non-zero exit blocks the story before any DB-backed suite runs.
- `TZ=UTC node_modules/.bin/vitest run --project server server/tools/documents.responses.test.ts` -- expected: all pass.
- `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint server/tools/documents.test.ts server/tools/documents.enforcement.test.ts server/tools/wikiLint.test.ts server/routes/mcp` -- expected: all pass.
- `corepack yarn tsc` -- expected: exit 0.
- `node_modules/.bin/oxlint --type-aware` and `node_modules/.bin/oxfmt --check` on the changed files -- expected: clean.
- `git diff 4a5a616a21be800257dc11cef4263d0dd0412156 -- server/models server/commands server/presenters shared/utils server/editor server/storage server/tools/util.ts` -- expected: empty.
- `grep -rn "registerPrompt" server --include=*.ts` -- expected: no match outside tests.
- Temporary mutations, each reverted afterwards -- expected: a suite fails for each:
  - give enrichments a fresh 2 s instead of the remainder;
  - drop the row-6 `try`/`catch`;
  - drop the `readable` gate on the identity;
  - await enrichments without `within`.

## Auto Run Result

Status: done

**Summary.** Enforced Markdown writes keep the baseline MCP response fields and append one structured validation outcome. One 2-second post-commit deadline covers buffered callbacks and response enrichments. The row-6 assembly cannot raise a Tool-Execution Error; failed or expired enrichments are omitted and identity failures use the specified fallback. This follow-up review also closes a timer-order edge case: each enrichment is checked against the shared deadline after its race settles, so a late result cannot be included merely because its queued timer has not run.

**Files changed since `baseline_revision`.**
- `server/wikiLint/application/deadline.ts` — exports the shared `within` helper and documents the total post-commit bound.
- `server/wikiLint/adapters/writeTransaction.ts` — imports the shared helper.
- `server/wikiLint/application/enforcedWrite.ts` — starts one deadline after the established commit and shares it with callback waiting and row 6.
- `server/tools/documents.ts` — assembles bounded, non-throwing row-6 responses and omits results that settle after the deadline.
- `server/wikiLint/application/enforcedWrite.test.ts` — checks the deadline's start relative to COMMIT.
- `server/tools/documents.responses.test.ts` — 33 MCP-level response fixtures, including the late-result regression, exact success and breadcrumb assertions, unchanged scopes, row 7, and repeated clients.
- This spec — follow-up triage, design note, and run result.

**Follow-up review.** 13 findings: high 0, medium 1, low 11, false 1, maybe-false 0. Patched three entries (medium 1, low 2): the late race result, missing `success: true` assertion, and missing breadcrumb value comparison. Deferred: none. Rejected ten findings for the reasons recorded above: nested presenter metadata is already served by the unchanged helper and its identity is checked; the non-reader patch request duplicates the shared readability gate; full rejected Finding records are covered by exact repeated responses and core ordering tests; broad ID normalization is paired with the existing destination/state matrix; that matrix already checks successful stored state; the three baseline failure paths are unchanged and write no `wikiLint.*` Event; independent timeout behavior uses the same helper and is covered by failure and timeout fixtures; the non-string echo expression is identical to baseline; the unconfigured fork path retains v1.10.1 response assembly; and independent real-client evidence belongs to Gate 4. Follow-up review recommended: false; no high entry was patched.

**Verification (2026-10-03).** `scripts/test-db.sh ensure` exited 0. The response suite passed 33/33, and the specified broader server scope passed 1424/1424 across 35 files. `corepack yarn tsc`, targeted type-aware `oxlint`, targeted `oxfmt --check`, and `git diff --check` exited 0. The protected-path diff from the v1.10.1 source commit is empty; no `registerPrompt` exists in server TypeScript. The late-result fixture failed when its post-race deadline check was temporarily removed, then passed after restoration. The four earlier mutation checks and their restored results are recorded in the prior run's review log.

**Residual risks.** A blocked event loop can delay the HTTP response past two seconds because synchronous work cannot be preempted; the post-race check now prevents its late enrichment from appearing. Wall-clock bound fixtures retain 700 ms scheduling slack. An abandoned enrichment read may keep its database connection until it settles. The AD-7 HTML mismatch and write-validation audit summaries remain with Stories 2.5 and 2.7. The orchestrator-owned ledger and sprint board were not edited by this run.
