---
title: 'Story 2.0: Name the Missing Configured Item to Collection Readers'
type: 'feature'
created: '2026-10-03'
status: 'done'
baseline_revision: '8446bbe4d8dfeea248925b9f8d1de362b58069d0'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/prds/prd-outline-2026-09-20/amendment-proposal-finding-detail.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** `REQUIRED_SECTION_MISSING`, `REQUIRED_METADATA_FIELD_MISSING`, and `GLOBAL_INDEX_LINK_MISSING` Findings are byte-identical when several items are missing, so an agent cannot repair from Findings alone (DW-2, DW-3, DW-8; Story 1.10 needed out-of-band conventions). Epic 2 write rejections will return the same Findings.

**Approach:** Implement the amended AD-12: an optional, closed, readability-gated `detail` on exactly those three codes. The pure core receives one `detailVisible` boolean from the shell and attaches the detail only when it is true. The read-only shells derive the flag from readability facts they already hold. The policy schema caps heading text at 200 and field names at 64 UTF-16 code units. Binding acceptance is `_bmad-output/planning-artifacts/epics.md`, Story 2.0, ACs 1–9.

## Boundaries & Constraints

**Always:**
- `Finding` stays `{ code, severity, message, location }`, with `detail` added as the last key only when present. The detail shapes are exactly:
  - `REQUIRED_SECTION_MISSING`: `{ kind: "section", heading, headingLevel }`
  - `REQUIRED_METADATA_FIELD_MISSING`: `{ kind: "metadata_field", field }`
  - `GLOBAL_INDEX_LINK_MISSING`: `{ kind: "global_index", documentId, urlId }`
- Each detail is rebuilt with its keys in that fixed order. The constructors throw `WikiLintContractError` in each of these cases:
  - a detail on any other code
  - a detail whose `kind` does not match its code
  - an extra key
  - a value that a valid policy could not configure
  - a `detail` key on a System Failure
- The core performs no authorization. `detailVisible` defaults to `false`, so a caller that omits it discloses nothing.
- Values come from the rule's own configuration: the heading and `rule.headingLevel`, or the field name. Global-index values come from the snapshot's readable `indexes` entry.
- With detail hidden, every other byte of the result is identical, including key order.
- Registry messages, AD-4 sort keys, ordinals, `AuditDataV1`, logs, metrics, and tool descriptions stay unchanged. None of them contains a detail value or a configured heading or field name.
- A heading or field name over its cap makes only its collection entry the AD-5/AD-6 sentinel, with a source-byte `invalidFingerprint`. Values at exactly the cap keep the same `policyFingerprint` as before this change.

**Never:**
- Do not interpolate configured values into `message`.
- Do not add a second readability query.
- Do not change write surfaces or integrate `create_document`/`update_document` enforcement (Stories 2.1/2.3).
- Do not disclose allowed metadata values, regular expressions, fingerprints, or document content in `detail`.
- Do not edit `sprint-status.yaml`, `deferred-work.md` (the bmad-loop sweep closes DW entries), `server/tools/README.md`, or the binding SPEC/PRD/spine.
- Do not add environment-specific identifiers to fixtures.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Collection reader, `lint_document` | Document lacks configured `Summary` and `References` (level 2) | Two `REQUIRED_SECTION_MISSING` Findings in configured order, each with its `section` detail | None |
| Document-only or unestablished reader | Same document | Same codes, messages, locations, and order, with no `detail`. Equals the reader's `errors` with `detail` stripped | None |
| `lint_wiki`, one readable and one unreadable index | One surface, both indexes unlinked | One `GLOBAL_INDEX_LINK_MISSING` with the readable index's `documentId`/`urlId`. The unreadable pair is a generic `VALIDATION_RUNTIME_FAILED` at `scope { collection, collectionId }`. No output names the unreadable index | None |
| Heading length cap | 200 code units / 201 / 199 + one astral character | Valid with unchanged fingerprint / sentinel / sentinel | Other entries unaffected, startup proceeds |
| Field name cap | 64 / 65 / 63 + one astral character | Same pattern as the heading cap | Same |
| Contract misuse | `createFinding("SECTION_ORDER_INVALID", loc, {kind:"section",…})`, wrong kind, extra key, `detail` on a System Failure | Rejected | Throws `WikiLintContractError` |

</intent-contract>

## Code Map

- `server/wikiLint/core/contracts.ts:85` -- `Finding`. Add the exported `FindingDetail` union and `detail?: FindingDetail`. `WikiGlobalIndexInput.indexes` (`{documentId, urlId}`) is the global-index detail source.
- `server/wikiLint/core/registry.ts:266-321` -- `trimmedString`, `fieldName`, and `metadataSection`, used by `requiredSections`, `sectionOrder`, `requiredMetadataFields`, and `metadataFieldFormats`. Caps go here. Installed zod 4.5.4 `z.string().max()` counts code points, not UTF-16 units: enforce each cap with a `String.length` refine.
- `server/wikiLint/core/registry.ts:571` -- `createFinding(code, location)`. Add an optional `detail` and validate it with strict per-kind schemas. Reuse the capped heading/field schemas, `headingLevel`, `uuid`, and a non-empty `urlId`.
- `server/wikiLint/core/result.ts:228` -- `revalidateIssue` rebuilds the issue through `createFinding`, then compares key sets. Pass `detail` through so a smuggled detail is validated and a System Failure carrying one still throws.
- `server/wikiLint/core/documentRules.ts:29` -- `Emit`. Change it to `(location, detail?)`. `requiredSections` (:233) and `requiredMetadataFields` (:270) emit per configured item. `evaluateDocumentRules` (:375) gains `detailVisible?` and drops `detail` in `emit` when the flag is false.
- `server/wikiLint/core/graphRules.ts:156` -- `globalIndexLinks` emits only for a provable pair, so `index` is the readable entry. `evaluateGraphCheck` (:228) gains `detailVisible?` and gates the same way. Replace the Story 1.6 sorted-index iteration (`[...rule.globalIndexDocumentIds].sort(compareUtf8)`, :172) with configured order, and update the JSDoc (see Design Notes).
- `server/wikiLint/core/ordering.ts:113` -- `sortKey` ignores `detail` already. No change. Add a test only.
- `server/wikiLint/core/policySet.ts:403` -- `buildEntry` already turns any schema defect into a collection-local sentinel through `locateIssue`. No change expected.
- `server/wikiLint/application/lintDocument.ts:212` -- `collectionReadability` (`readable | unreadable | unestablished`). Pass `detailVisible: collectionReadability === "readable"` to `evaluateDocumentRules` (:309).
- `server/wikiLint/application/lintWiki.ts:500,525` -- both evaluator calls. Pass `detailVisible: true`. Every evaluated collection is readable: collection scope passed `authorizeLintCollection`'s `can(actor,"read")`, and the default scope keeps only rows passing `can(actor,"read", row)` inside the snapshot (`wikiReader.ts:291-296`).
- `server/wikiLint/application/readAudit.ts:67` -- counts by code only. No change. Add an audit-equality assertion.
- `server/routes/mcp/wikiLint.test.ts:367` -- `expectAlgebra` asserts the exact Finding keys. Allow `detail` only on the three codes with the matching `kind`. The "repair loop" block (:1855) holds the conventions-supplied loop, which must keep passing unchanged. The document-only reader matrix is at `buildMatrix` and :1572.
- Existing assertions that now gain `detail` for collection readers: `lintWiki.test.ts` (:621, :794, :1144, :1398, :1825), `tools/wikiLint.test.ts` (:1082, :2813), `lintDocument.test.ts` (:270, :504), and `routes/mcp/wikiLint.test.ts:895`.

## Tasks & Acceptance

**Execution:**
- `server/wikiLint/core/contracts.ts` -- add the `FindingDetail` types and `Finding.detail?` -- AC1 shape.
- `server/wikiLint/core/registry.ts` -- cap headings at 200 and field names at 64. Extend `createFinding` with a validated, key-ordered `detail` -- AC1, AC6.
- `server/wikiLint/core/result.ts` -- carry `detail` through revalidation -- AC1.
- `server/wikiLint/core/documentRules.ts`, `server/wikiLint/core/graphRules.ts` -- emit the details and gate them on `detailVisible`. Update the JSDoc -- AC2, AC4, AC5.
- `server/wikiLint/application/lintDocument.ts`, `server/wikiLint/application/lintWiki.ts` -- derive and pass `detailVisible`, with a one-line rationale comment -- AC3.
- Collocated tests:
  - `registry.test.ts`: constructor rejections and key order. Values at exactly each cap are accepted, both in ASCII and with an astral character reaching the cap: 198 units plus one astral character for a heading, 62 plus one for a field.
  - `policySet.test.ts`: for each of the five schema sites, cover:
    - exactly at the cap in ASCII, and with an astral character reaching the cap, both valid with the canonical fingerprint;
    - one unit over the cap;
    - crossed by an astral character.

    A sentinel must not affect a sibling entry.
  - `result.test.ts`: revalidation.
  - `documentRules.test.ts`, `graphRules.test.ts`: cover:
    - detail on and off, and byte-identity once `detail` is stripped;
    - configured order for all three codes;
    - one readable plus one unreadable index.

    Rename the Story 1.6 test titled "...in sorted-index order" to say configured order. Its assertion is unchanged.
  - `ordering.test.ts`: `detail` never reorders. The ordinal-free case must feed an emission order that ascending `detail` order would reverse: `Zeta` emitted before `Alpha` stays `Zeta`, then `Alpha`.
  - `lintDocument.test.ts`: readable, unreadable, and unestablished.
  - `lintWiki.test.ts`: collection scope and default scope.
  - `readAudit.test.ts`: the payloads with and without detail are equal, and the expected `counts.byCode` is asserted.
  - `tools/wikiLint.test.ts`:
    - `AuditDataV1` is equal with and without detail.
    - No call to any `Logger` method (`debug`, `info`, `silly`, `warn`, `error`, `fatal`) contains a detail value. Serialize `Error` arguments by `name` and `message`, not by `JSON.stringify`.
    - The repeated `REQUIRED_SECTION_MISSING` expectations near :1082 and :1167–1168 assert each Finding's `detail`.
  - Update the existing expectations listed in the Code Map -- AC1–AC6, AC8, AC9.
- `server/routes/mcp/wikiLint.test.ts` -- relax `expectAlgebra` as described. Add a detail-only repair-loop test (Design Notes). Add an AC8 test: a document-only reader and a collection reader lint the same document, and the outputs are byte-identical after stripping `detail`. Add an AC9 test: repeated runs are byte-equivalent for both actors -- AC7–AC9.

**Acceptance Criteria:**
- Given the extended golden fixture (Design Notes) and an agent that gets no conventions, when the detail-only loop runs over `/mcp/`, then within three rounds the result is `complete: true` with zero Errors and the Warning still listed. Each missing-item repair inserts exactly the item its `detail` names, no document outside the batch changes, and the unchanged conventions-supplied loop still passes.
- Given identical policy, authorization, request, and Wiki state, when either read-only tool runs repeatedly for a collection reader and for a document-only reader, then each actor's responses are byte-equivalent across runs. The existing determinism, ordering, disclosure, and audit suites pass with no change other than `detail` on the three codes for collection readers.
- Given any read-only result with or without `detail`, when it is audited, then the stored `AuditDataV1` payload is identical in both cases. No log line, tool description, or System Failure contains a detail value.

## Spec Change Log

### 2026-10-03 — Review pass 1 loopback (bad_spec)

**Trigger:** The intent-alignment audit found a conflict with AC5. AC5 says Findings "stay ordered by the rule-local ordinal, which follows configured order", and the amendment says "which follows policy order". The first implementation followed this spec's Design Notes instead. It kept the Story 1.6 sorted-index iteration, so `GLOBAL_INDEX_LINK_MISSING` details came out in sorted ID order, not configured order. The Design Notes justified this with "ordering unchanged". That premise holds under either order, because the order among those byte-identical Findings could not be observed before this story.

**Amended:**
- **Design Notes:** global-index details follow configured order, and the MCP fixtures configure their indexes in reverse sorted order.
- **Code Map (graphRules):** drop the sort.
- **Code Map (registry):** zod 4.5.4 `.max` counts code points, so each cap uses a `String.length` refine.
- **Tasks, collocated test list:**
  - add astral values at exactly each cap;
  - give the ordering test an emission order that sorting by `detail` would reverse;
  - spy every `Logger` method, and serialize `Error` arguments by `name` and `message`;
  - assert `detail` on the repeated tools-test expectations;
  - assert `counts.byCode` in the readAudit equality test;
  - rename the Story 1.6 test title.

**Known-bad states avoided:**
- details in sorted order where configured order is required;
- an ordering test whose ordinal-free assertion also passes if `detail` becomes a tie-break;
- caps written with `.max()`, which accept 199 units plus an astral character;
- log checks that miss `silly` and `fatal`;
- an e2e order check that holds only when random UUIDs happen to be configured unsorted.

**KEEP** (these worked and passed the first time):
- **Caps:** shared `headingText` and `fieldName` schemas with a `String.length` refine, reused by the five policy sites and by the detail schemas.
- **`createFinding(code, location, detail?)`:**
  - a per-code map of strict zod detail schemas;
  - a `normalizeDetail` that rebuilds the fixed key order;
  - `detail` set last, and only when it is defined.
- **`revalidateIssue`:** passes `(issue as Finding).detail` into `createFinding`. The existing key-set comparison then covers `detail` and rejects a System Failure that carries one.
- **Rules and evaluators:** rules always emit `(location, detail)`. Evaluators gate on `input.detailVisible === true` before calling `createFinding`.
- **Shells:**
  - `lintDocument` passes `detailVisible: collectionReadability === "readable"`.
  - `lintWiki` passes `detailVisible: true` at both calls, with the comment explaining that every evaluated collection is readable by construction.
- **Route suite: assertions and fixtures**
  - `expectAlgebra` asserts the ordered keys `code, severity, message, location[, detail]`, using a code-to-kind map.
  - The fixtures are `detailPolicy`, a complete Markdown constant, and a lacking Markdown constant.
- **Route suite: repair mechanics**
  - The multi-line patch `${line}\n* ${field}: pending` adds an item to the same list, so no `replace` fallback is needed.
  - An appended link joins the last paragraph inline, so count occurrences, not lines.
- **Route suite: actor setup**
  - Unestablished readability is simulated with `vi.spyOn(Collection, "findByPk").mockRejectedValue(...)`.
  - The document-only reader comes from a private collection (`permission: null`) plus a read `UserMembership` on the document.
- **`policySet.test.ts`:** one table over the five schema sites, each row with its JSON pointer.

## Review Triage Log

### 2026-10-03 — Review pass

- verdicts: 31 findings — high 0, medium 1, low 11, false 19, maybe-false 0
- findings:
  - `[low]` `[patch]` blind: the ordering test's ordinal-free assertion `[Alpha, Zeta]` also matches sorting by detail — Confirmed at `ordering.test.ts` (`sortIssues([unordered[1], unordered[0]])`). Moot this pass (bad_spec loopback); folded into the amended Tasks.
  - `[false]` `[reject]` blind: detail is validated only when visible, so a malformed value fails only for collection readers — Unreachable. Headings and fields come from rules parsed by the same capped schemas. Index `documentId` and `urlId` come from readable rows (lowercase UUID, generated urlId).
  - `[false]` `[reject]` blind: `urlId` accepts any non-empty string — The value is the readable index document's Outline-generated `urlId`, which the actor can already see. It never carries user content.
  - `[false]` `[reject]` blind: `lint_wiki` hard-codes `detailVisible: true` — Every evaluated collection passed `can(read)`: pre-admission for the collection scope, as AC3 names, and the in-snapshot filter at `wikiReader.ts:291-296` for the default scope. The bad outcome does not occur.
  - `[false]` `[reject]` blind: nothing couples detail visibility to identity visibility at the result level — No current caller diverges. `lintDocument` derives both from `collectionReadability === "readable"`, and `lintWiki` shows identity for every evaluated collection.
  - `[false]` `[reject]` blind: the metadata_field detail omits its section, so the repair patches the first field line — AC1 fixes the shape to `{kind, field}`. AC7 has the fixture keep one field so the agent can anchor the patch.
  - `[false]` `[reject]` blind: the loop never meets `section_order` — AC7 defines the fixture without it, and nothing claims coverage of it.
  - `[low]` `[patch]` blind: the tools tests near :1082 and :1167 still use `objectContaining({code})` for repeated `REQUIRED_SECTION_MISSING` — Confirmed. Moot this pass; folded into Tasks.
  - `[low]` `[patch]` blind: the Logger spy misses `silly`/`fatal`, and `JSON.stringify` drops `Error` messages — Confirmed at `server/logging/Logger.ts:106,178`. Moot this pass; folded into Tasks.
  - `[low]` `[patch]` blind: the e2e global-index order uses random UUIDs, so configured order equals sorted order about half the time — Confirmed. Moot this pass; folded into Design Notes (reverse sorted configuration).
  - `[false]` `[reject]` blind: `server/tools/README.md` is stale — The example is labelled "illustrative only" and defers exact shapes to AD-12. It already omits `location.kind`, and it shows an enforced write, which is Story 2.1+ scope.
  - `[false]` `[reject]` blind: over-cap policies become sentinels without an upgrade note — AC6 mandates exactly this behaviour. No rollout is authorized (Gates 2–4), so no deployed policy is affected.
  - `[low]` `[patch]` blind: the readAudit detail test asserts only equality — Confirmed, though the `byCode` mapping is covered elsewhere. Moot this pass; folded into Tasks.
  - `[false]` `[reject]` blind: the final `[first, second, outside]` loop is redundant — It is harmless and mirrors the explicit assertions of the Story 1.10 loop and the Design Notes. No harm is named.
  - `[false]` `[reject]` blind: the at-cap fingerprint relies on a hand-written `sortedJson` — For the ASCII fixtures it is the canonical form, so the assertion does prove the canonical fingerprint is unchanged.
  - `[low]` `[reject]` blind: `Finding.detail` is not typed per code — The runtime schema enforces AC1. Per-code typing would ripple through every Finding consumer to catch a misuse that tests already catch.
  - `[low]` `[patch]` blind: there is no astral valid-at-cap case for fields or at the schema sites — Confirmed: the registry test has a heading-only astral case. Moot this pass; folded into Tasks.
  - `[false]` `[reject]` edge: if collection read is revoked between admission and snapshot, `detail` leaks — AC3 mandates deriving the flag from the existing pre-admission or collection-readability result, with no second check. Collection identity follows the same rule (AD-16), and the F-5 re-check is withdrawn.
  - `[low]` `[patch]` edge: Logger `silly`/`fatal` not spied — Same root cause as the blind Logger finding, and the same route.
  - `[low]` `[reject]` edge: the spec Tasks say "outputs" are byte-identical, but the test compares `errors` — The test matches AC8, which compares errors. The fix is an edit to this build's spec.
  - `[low]` `[patch]` verification-gap: the ordering test's ordinal-free assertion cannot distinguish its claim — Same root cause as the first blind finding, and the same route.
  - `[low]` `[reject]` verification-gap: the Code Map says zod `.max` counts UTF-16 units — The code is right. The fix edits this build's spec; the line was corrected as part of the bad_spec amendment's KEEP.
  - `[false]` `[reject]` intent: `lint_wiki` passes a constant, not a per-collection flag — Same refutation as the blind hard-code finding.
  - `[false]` `[reject]` intent: AD-12 readability at evaluation versus AC3 pre-admission — Same refutation as the edge revocation finding. AC3 names the pre-admission result explicitly.
  - `[medium]` `[bad_spec]` intent: `GLOBAL_INDEX_LINK_MISSING` details follow sorted order, not configured order, contrary to AC5 and the amendment ("policy order") — Triggered the Spec Change Log entry above, which amends Design Notes, the Code Map, and Tasks. Code reverted and re-derived.
  - `[false]` `[reject]` intent: the new fixture is a sibling test, not an "extended" 1.10 fixture — AC7 itself requires the conventions-supplied loop to stay unchanged and passing. The sibling carries the 1.10 defects (broken link, orphan, Warning) plus the missing items.
  - `[false]` `[reject]` intent: `expectAlgebra` now asserts key order — The contract fixes key order, and every existing suite passed under it.
  - `[false]` `[reject]` intent: there are no new metric or tool-description assertions — The wikiLint code emits no metrics, and the descriptions are static literals the diff never touches.
  - `[false]` `[reject]` intent: AC6 is exercised only through `buildPolicySet` — The cap defect takes the same `buildEntry` sentinel path that the route suite's restart-based sentinel fixtures already cover through the real loader.
  - `[false]` `[reject]` intent: the AC8 unestablished reader is simulated with a `findByPk` spy — This is the established technique, and the test asserts a complete result without detail.
  - `[false]` `[reject]` intent: orchestrator surface — The commit happens at Finalize. The spec is the claims file by design, and no operator actions are owed.

### 2026-10-03 — Review pass

- verdicts: 27 findings — high 0, medium 0, low 10, false 16, maybe-false 1
- findings:
  - `[low]` `[reject]` blind: `expectAlgebra` permits `detail` but never requires it or ties it to visibility — Every detail in output is built by `createFinding`, which validates its shape. Presence and absence per actor are pinned by the dedicated route, tools, application and core tests. Tying a generic helper to actor visibility would add branches for a regression those tests already catch.
  - `[low]` `[patch]` blind: `repairFromDetail` checks only `result?.isError`, so a JSON-RPC `error` passes — Fixed: the helper now also asserts `expect(response.error).toBeUndefined()`.
  - `[low]` `[patch]` blind: the AC9 test matches the bare word "detail", never checks the owner's default-scope `lint_wiki`, and never checks that `lint_document` was modeled — Fixed with a `textOf` helper. The test now checks the `'"detail"'` key, that the owner's `first[2]` carries `detail`, and that neither actor's `lint_document` returns `isError`.
  - `[low]` `[reject]` blind: the repair-loop test never compares each batch document's final Markdown — A clean re-lint plus the exactly-once insertion counts satisfy AC7. Exact expected Markdown would encode Outline's append and serialization quirks, such as an appended link joining the last paragraph. That is more than a direct correction for damage that this story's code cannot cause.
  - `[false]` `[reject]` blind: tool descriptions give agents no hint of `detail` — The key is self-describing in every collection reader's JSON result. AC5 keeps tool descriptions free of `detail`, and the descriptions are unchanged by design.
  - `[maybe-false]` `[reject]` blind: a configured heading with astral or Markdown-significant characters may not round-trip when an agent writes it back — To settle it, add an e2e fixture with `_`, `*`, `[` or an astral character in a configured heading and repair it through `update_document`. If true, it is only low: it depends on the configuration, and AC7 fixes plain names. Rejected with this note.
  - `[low]` `[patch]` blind: the `createFinding` rejection table lacks empty or untrimmed values, a non-integer or string `headingLevel`, a lowercase non-UUID, a non-string `urlId`, and a non-object detail — Fixed: those rows were added to the existing table in `registry.test.ts`.
  - `[false]` `[reject]` blind: `normalizeDetail`'s `default` relabels any other kind as `global_index` — The parsed value is the closed three-kind union, so TypeScript narrows `default` to `global_index`. A fourth kind would need a new schema and would fail type-checking on `documentId`/`urlId`. The explicit rebuild keeps key order independent of zod internals.
  - `[low]` `[patch]` blind: the `Finding.detail` comment says "only when" and omits the three-code restriction — Fixed: it now names the three codes and says the field is present exactly when the shell passes `detailVisible: true`.
  - `[false]` `[reject]` blind: `lint_document` decides visibility twice (`collectionReadability` versus `visibleCollectionId`) — At the evaluation point the entry exists, so `collectionId` is non-null and the two expressions are equivalent. AC3 names the collection-readability result itself.
  - `[low]` `[reject]` blind: `serializeCall` drops an `Error`'s `cause` and extra fields — No logging path carries a detail value. The only lint log is the audit failure warning, which holds `requestId`, `invocationId` and `reason`. The spec fixes the name-and-message serialization, and walking cause chains adds complexity for an unreachable case.
  - `[false]` `[reject]` blind: there is no same-actor e2e audit equality for `lint_wiki` — AC5 is shown at the tools layer by identical stored payloads for the owner (with `detail`) and the document-only reader (without), and for both operations by the `readAudit` unit test. A `lint_wiki` collection reader cannot receive a detail-free result for the same scope.
  - `[low]` `[patch]` blind: `epic-2-context.md` says Story 2.0 "changes only the read surfaces" and that `detail` appears "only when" the actor can read the collection — Fixed: both sentences now state the shared-schema caps (collection-local sentinel on every surface) and that `detail` is present exactly when the actor can read the classified collection, with writes passing `readable`.
  - `[false]` `[reject]` edge: collection read revoked between `authorizeLintCollection` and the snapshot — carried: AC3 mandates the pre-admission result without a second check, collection identity follows the same rule (AD-16), and F-5 is withdrawn.
  - `[false]` `[reject]` edge: collection read revoked between `authorizeLintTarget` and `readDocumentSnapshot` — carried: same refutation. AC3 requires the existing collection-readability result.
  - `[low]` `[patch]` edge: the Logger check leaves out `index.id`, the `global_index` detail's `documentId` — Confirmed by probe: the test still passes with it. Fixed: `index.id` is now in the one list checked against stored rows and every Logger call.
  - `[low]` `[reject]` edge: the claim "outputs byte-identical" while the test compares errors and warnings — carried: the test matches AC8, and the fix would edit this build's spec.
  - `[false]` `[reject]` intent: process rules (commit, final status) live outside the diff — carried: Finalize commits and records the status. No operator actions are owed, because no AC needs a human action outside the repo.
  - `[false]` `[reject]` intent: AC3 default scope uses a constant `true` — carried: every evaluated collection passed `can(read)` by construction (`wikiReader.ts:291-296`, pinned by the existing `wikiReader` tests).
  - `[false]` `[reject]` intent: AC4's unreadable index has no `/mcp/` route case — It is covered at the core (`graphRules.test.ts`), at the shell (`lintWiki.test.ts`, the partially provable check with `cs()` `VALIDATION_RUNTIME_FAILED`), and through the real tool handler with real authorization (`tools/wikiLint.test.ts` hidden index). The route layer adds only transport.
  - `[false]` `[reject]` intent: configured global-index order overrides Story 1.6's sorted order — This is the intended outcome of AC5 and the pass-1 bad_spec amendment (Spec Change Log). No pre-existing observable output changes.
  - `[false]` `[reject]` intent: no metric assertions, and descriptions are compared only as static text — carried: wikiLint emits no metrics, and the descriptions are untouched literals.
  - `[false]` `[reject]` intent: AC6 is not exercised through the real startup loader — carried: the cap defect takes the same `buildEntry` sentinel path that the route suite's restart-based sentinel fixtures cover.
  - `[false]` `[reject]` intent: the AC7 fixture is a sibling, the metadata repair anchors on the first field line, the test asserts 2 rounds, and write rejections are deferred — carried: AC7 requires the conventions loop unchanged, and AC1 fixes the detail shape. Two rounds is within the bound, and AC3 defers the write surfaces.
  - `[false]` `[reject]` intent: AC8's unestablished reader is simulated — carried: this is the established `findByPk` spy technique, and the test asserts a complete result without detail.
  - `[false]` `[reject]` intent: AC9 existing tests changed beyond adding detail (`toStrictEqual`, a renamed title, `not.toContain`, distinct global-index entries) — Each change adds the detail, tightens an assertion that existing behaviour already meets, or is the rename the spec mandates. Every pre-existing suite passes.
  - `[false]` `[reject]` intent: write surfaces untouched — AC3 and AC9 require exactly this. `detailVisible` defaults to false until Stories 2.1 and 2.3 pass `readable`.

### 2026-10-03 — Follow-up review pass

- verdicts: 14 findings — high 0, medium 0, low 6, false 7, maybe-false 1
- findings:
  - `[false]` `[reject]` blind: a missing metadata section cannot be located from `metadata_field` alone — Carried: AC1 fixes the detail to `{kind, field}`; the existing triage records the same claim and the AC7 repair fixture's existing field.
  - `[low]` `[reject]` blind: a configured heading containing a newline or Markdown syntax may not round-trip through a simple append — The schema permits it, but repair of such configurations is outside AC7's plain-name fixture and changing accepted policy syntax would add validation and migration complexity for an uncommon input. The earlier review already recorded the Markdown/astral variant.
  - `[low]` `[reject]` blind: an embedded newline in a configured metadata field name defeats the sample list insertion — The schema permits it, but the defect predates `detail`; rejecting formerly valid policy names is more than a direct correction to this story's fixed detail shape.
  - `[low]` `[reject]` blind: hidden section details are allocated before the evaluator drops them — `requiredSections` builds a small local object per missing item, but no measured user-visible cost is shown; avoiding it requires a new rule-layer visibility branch.
  - `[low]` `[reject]` blind: hidden global-index details are likewise allocated — The same small allocation occurs per missing link; avoiding it requires extra branching in the rule layer without a demonstrated performance problem.
  - `[maybe-false]` `[reject]` blind: many maximum-length details might make `lint_wiki` slow or large — No failing limit or measurement is identified. A bounded large-snapshot benchmark would settle it; if true, this is a low-grade cost, and adding a new benchmark here is more than a direct correction.
  - `[false]` `[reject]` blind: `urlId` needs a ten-character validator — Carried: the value comes from a readable Outline document, and the existing triage establishes why a nonempty string is the appropriate contract boundary.
  - `[low]` `[reject]` blind: the new default-scope detail test uses only one collection — The existing tools test at `server/tools/wikiLint.test.ts:1919` compares a default-scope response with and without unreadable configured collections byte-for-byte; the new test pins visible detail. A combined fixture adds little independent coverage.
  - `[false]` `[reject]` blind: over-cap sentinels lack a new route test — Carried: the cap uses the same `buildEntry` sentinel path as the restart-based route fixtures, already covered in the prior triage.
  - `[false]` `[reject]` blind: the sprint board says `done` while the spec says `in-review` — The orchestrator made the board change before this run and owns its bookkeeping; this review pass temporarily sets the spec to `in-review`. Neither fact is an implementation defect or permission to edit the board.
  - `[low]` `[reject]` edge: the spec's “outputs” wording is wider than the test's Finding-list comparison — Carried: AC8 compares `errors`; full result identity would incorrectly require a document-only reader to receive collection identity and policies. The proposed fix edits this build's spec.
  - `[false]` `[reject]` intent: future rejected writes are untested — The intent expressly excludes write-surface changes until Stories 2.1/2.3; this story tests the read-only MCP tools where its acceptance lives.
  - `[false]` `[reject]` intent: configured index order changes an ordinal's associated index — Carried: AC5 explicitly requires configured order, while hidden-detail Findings remain byte-identical; the prior bad-spec loopback resolved this.
  - `[false]` `[reject]` intent: the diff contains a forbidden sprint-board edit — It is an existing orchestrator-owned worktree change, not a change made or staged by this build; the user explicitly forbids us to write or revert it.

## Design Notes

**Global-index ordinal.** AC5 and the amendment both say the rule-local ordinal follows configured (policy) order, and that applies to all three codes. `globalIndexLinks` must therefore iterate `rule.globalIndexDocumentIds` in configured order and drop the Story 1.6 sort. This changes no output that existed before this story. Before detail, Findings of one surface and code were byte-identical, so the order among them could not be observed. The policy fingerprint already covers the array order. Tests must assert that a configured order of `[B, A]` yields details `B`, then `A`. The MCP fixtures configure their two indexes in reverse sorted ID order, so configured order differs from sorted order on every run.

**Detail-only repair loop.** Add this as a sibling `it` in the "repair loop" block, with its own `repairFromDetail(token, finding, scope)`.

The policy enables:
- `required_sections` at level 2 for `Body`, `Summary`, and `References`
- `required_metadata_fields` for `Status`, `Owner`, and `Reviewer`, with no `metadata_field_formats`
- `discouraged_markdown_structures`: blockquote
- `internal_links`
- the hierarchy rules
- `global_index_links` with two indexes

Every document has every section and field except the defective ones:
- one document lacks `Summary` and `References`
- one keeps `Status` but lacks `Owner` and `Reviewer`
- the surface links to neither index
- the Story 1.10 broken-link document, orphan, and blockquote Warning stay

Repairs use only the Finding, its `detail`, `result.scope.collectionId`, and fetched Markdown:

| Finding | Repair |
| --- | --- |
| section | append `"#".repeat(headingLevel) + " " + heading` |
| metadata_field | `patch` an existing `* Name: value` line to that line plus `\n* ${field}: pending` |
| global_index | append `[Global index](/doc/${documentId})` |
| `INTERNAL_LINK_TARGET_UNRESOLVED` | patch the link to its bare label |
| `PUBLISHED_DOCUMENT_MISSING_FROM_STRUCTURE` | `move_document` to `scope.collectionId` |

If the multi-line patch does not produce a new item in the same list, the metadata_field repair may instead use a `replace` with the fetched Markdown, where the same line is inserted after the existing field line. Record the choice in the test's JSDoc. Any other code throws. Assert three things: each round-0 detail names the configured items, the final Markdown contains each inserted item exactly once, and the states of the index documents and the outside document are unchanged.

## Verification

**Commands:**
- Start the test PostgreSQL per memory `local-test-postgres` -- expected: `pg_isready` reports that it accepts connections.
- `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint server/tools/wikiLint.test.ts server/routes/mcp` -- expected: all pass.
- `corepack yarn tsc` -- expected: exit 0.
- `node_modules/.bin/oxlint --type-aware` and `node_modules/.bin/oxfmt --check` on the changed files -- expected: clean.
- Temporary mutations, each reverted afterwards -- expected: the suite fails for each:
  - make `detailVisible` default to `true`;
  - pass `true` in `lintDocument`;
  - drop the cap on one schema site.

## Auto Run Result

Status: done

**Summary.** The three missing-item Findings carry validated, key-ordered `detail` only when the collection is readable. The core defaults to hiding it. Policy headings and field names now have UTF-16 length caps, and global-index details follow configured order. Read-only MCP repair from Findings alone is covered by the route suite. Write enforcement remains a later story.

**Files changed.** `server/wikiLint/core/{contracts,registry,result,documentRules,graphRules}.ts` define, validate, emit, and gate the detail; `server/wikiLint/application/{lintDocument,lintWiki}.ts` pass the existing readability decision. Their collocated tests, `server/wikiLint/core/{ordering,policySet}.test.ts`, `server/wikiLint/application/readAudit.test.ts`, `server/tools/wikiLint.test.ts`, and `server/routes/mcp/wikiLint.test.ts` cover ordering, disclosure, audit stability, and repair. `_bmad-output/implementation-artifacts/epic-2-context.md` records the corrected Epic 2 context. This spec records the contract and review.

**Review.** The initial run had a bad-spec loopback for configured global-index order and then six low-grade test/comment/context patches; its two earlier triage passes remain above. This follow-up found 14 claims: high 0, medium 0, low 6, false 7, maybe-false 1. Patches applied in this pass: 0. Deferred in this pass: 0. Every claim was rejected for the following recorded reason (the row-by-row evidence is in the follow-up triage log):

1. Metadata section absent from `metadata_field`: AC1 fixes the closed shape; carried prior disposition.
2. Special heading text: uncommon configuration; changing policy validity requires broader validation and migration.
3. Newline field name: pre-existing policy issue; changing validity exceeds this detail change.
4. Hidden section-detail allocations: no measured cost; removal adds rule-layer branching.
5. Hidden index-detail allocations: same cost and complexity assessment.
6. Large response concern: unmeasured; a bounded benchmark would settle it.
7. `urlId` length: the readable document supplies it; carried prior disposition.
8. One-collection default-scope fixture: the existing tool test proves unreadable collections do not change the response.
9. Over-cap route fixture: the existing sentinel route already covers the shared sentinel path; carried prior disposition.
10. Board/spec status mismatch: the board is orchestrator-owned; `in-review` was temporary during this pass.
11. Full-output equality wording: AC8 compares Finding lists, while scope identity must remain different; carried prior disposition.
12. Write rejection coverage: Stories 2.1/2.3 own the expressly excluded write surfaces.
13. Index ordinal assignment: AC5 requires configured order and hidden Findings remain byte-identical; carried prior disposition.
14. Board edit in the diff: it predates this run and belongs solely to the orchestrator.

**Follow-up review recommendation:** `false`; patched entries in this follow-up: high 0, medium 0, low 0. No patch-induced risk remains unverified.

**Verification this pass.** A scratch PostgreSQL 18 cluster under `/tmp` accepted connections and all migrations completed. `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint server/tools/wikiLint.test.ts server/routes/mcp` passed 26 files and 1058/1058 tests. The focused core run passed 9 files and 564/564 tests. `corepack yarn tsc`, `oxlint --type-aware`, and `oxfmt --check` passed on the 18 changed TypeScript files. The previous pass's temporary mutation checks remain recorded in its result and were not repeated because no source code changed in this follow-up.

**Residual risks.** `lint_wiki` relies on the existing readable-collection snapshot filter. Readability is fixed for one invocation, so a mid-invocation revocation follows AC3's accepted behavior. The new length caps can turn previously accepted over-cap policies into collection-local sentinels; no deployment is authorized here. Existing deferred-work ledger entries remain untouched. The sprint board's local change remains untouched and uncommitted by this run.
