---
title: 'Story 2.2: Project the Complete Markdown Document Once'
type: 'feature'
created: '2026-10-03'
status: 'done'
baseline_revision: 'e46831d3402894bdd14630ff95fb809a74390286'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Nothing yet computes the complete document that an enforced MCP Markdown create or update would persist. Validating only the incoming fragment would let a valid-looking edit hide an Error in unchanged content, and validation would drift from the eventual write. Stories 2.3 (transaction) and 2.5 (HTML worker) need one side-effect-free projection to validate and then persist unchanged. Binding acceptance is `_bmad-output/planning-artifacts/epics.md`, Story 2.2, ACs 1–8.

**Approach:** Add an adapter module that builds one immutable `ProjectedDocument` in two steps. P2 is input-only preparation, with no stored state and no I/O. P4 projects from the re-fetched (locked) state using the exact `v1.10.1` writer semantics, by calling the same baseline helpers on scratch copies and never persisting. Prove parity against the actual baseline writers. Add the AD-20 row 3/5 message rule. Wiring into the MCP handlers, the transaction, and persistence belongs to Story 2.3.

## Boundaries & Constraints

**Always:**
- `ProjectedDocument` fields:
  - `documentId`, `title`;
  - `content`, the canonical ProseMirror JSON;
  - `text`, the deprecated Markdown column exactly as the writer sets it;
  - `state`, the collaborative Y.js update or `null`;
  - `collectionId`, `parentDocumentId`, `published`;
  - `icon`, `color`, `fullWidth`, `templateId`, `sourceMetadata`.
- Immutability: the object, `content`, and `sourceMetadata` are deep-frozen. TypedArrays cannot be frozen, so `state` is a private copy.
- The projection never shares an object with, or mutates, the `document` or `template` instance it reads.
- Create semantics mirror `documentCreator` exactly, using the pre-allocated `documentId` from Story 2.1:
  - title: `title ?? (template ? TextHelper.replaceTemplateVariables(template.title, actor) : "")`, then `|| ""` (`processUpdate`);
  - content: the P2 content when `text` is truthy, else the template JSON with variables replaced on a clone, else an empty doc;
  - `text = DocumentHelper.toMarkdown(content, { includeTitle: false })`;
  - `icon`, `color`, and `fullWidth` take the explicit value over the template's, with `null`/`false` defaults;
  - `published = publish`;
  - `parentDocumentId = input ?? null`.
- Update semantics mirror the MCP `update_document` → `documentUpdater` path:
  - title: `title.trim()` when given;
  - `icon`, `color`, and `fullWidth` take the given value, else keep the existing one;
  - text: `DocumentHelper.applyMarkdownToDocument(scratch, text, editMode, findText)` on a scratch `Document.build` holding the re-fetched `content`, `state`, and `text`;
  - content without text: `DocumentHelper.toJSON(document)` (the `processUpdate` backfill);
  - `parentDocumentId`, `templateId`, and `sourceMetadata` keep the re-fetched values, and an absent `editMode` keeps the baseline default `replace`.
- Publication:
  - `publish: true` → `published: true`;
  - `publish: false` (unpublish) → `published: false`, ignoring every other field, as the MCP handler does;
  - otherwise the current publication state is kept.
- Final collection is `document.collectionId ?? (publish === true ? collectionId : null)`. It must equal the given post-operation `collectionId`, else `WikiLintContractError`. An update `document` loaded without `state` (`undefined`) also throws `WikiLintContractError`.
- P2 issues no query and reads no stored state. For an update, P2 throws `UnstagedMediaError` (fixed message, no content) when its text holds an image the baseline would import. That is an image whose `src` parses as a URL, is not `isInternalUrl`, and starts with `data:`, matching `replaceImagesWithAttachments(..., { base64Only: true })`. The interim refusal lasts until Story 2.6 stages media.
- Baseline errors, such as the `ValidationError` for an absent or missing `findText`, propagate unchanged. They never become Findings.
- `abortMessage(error)` returns `error.message` for an `http-errors` error with a non-empty string `id`, else `OPERATION_FAILED`.

**Never:**
- Do not wire the projection into `server/tools/documents.ts`. Do not open a transaction, take locks, re-fetch, persist, run rules, or build the HTML path or media staging. Those are Stories 2.3, 2.5, and 2.6. The enforced interim fail-closed stays.
- Do not modify `documentCreator`, `documentUpdater`, `Document`, `DocumentHelper`, `ProsemirrorHelper`, or `TextHelper`. Do not reimplement or copy the `v1.10.1` patch, append, or prepend logic, and do not import the post-`v1.10.1` fix `c17d2c52b`.
- Do not compute canonical syntax or link references in the projection. P5 (Story 2.3) derives them from `content`, so a failure there stays a System Failure.
- Do not edit `sprint-status.yaml`, `deferred-work.md`, `epics.md`, `server/tools/README.md`, or the SPEC/PRD/spine. Do not add pilot identifiers.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create, text / draft / template | Template title and body using `{author}`; template plus explicit title, text, and icon | Projection equals the persisted `documentCreator` result for the same args and `id`. The template instance is unchanged | — |
| Update modes | `replace`, `append`, `prepend`, `patch`, title-only, icon-only, each with and without prior `state` | Equals the persisted `documentUpdater` result, with `state` compared after decoding | — |
| Container patch (`v1.10.1`) | Table `alpha/beta/gamma`; patch the `beta` row with `${row}\n\n## New` | Equals the baseline writer, and the projected text lacks `gamma` and `## New`. That is baseline behavior: the later fix keeps both | — |
| Publish / unpublish | Collected draft `publish: true`; collectionless draft `publish: true` into B; `publish: false` with `title`/`text` | `published` and `collectionId` match the writer. Unpublish keeps title and content | — |
| Edit against locked state | Prepare, then change the stored doc, re-fetch, project `append` | The projection reflects the re-fetched content | — |
| Projection failure | Absent `findText` target; patch without `findText`; update text with a `data:` image | Throws `ValidationError` (abortMessage = its message), or `UnstagedMediaError` (abortMessage = `OPERATION_FAILED`). No effect | Thrown, no Finding |
| Contract misuse | Collection mismatch; `document` without `state` loaded | `WikiLintContractError` | Thrown |

</intent-contract>

## Code Map

- `server/commands/documentCreator.ts:148-275` -- read-only reference.
  - The title precedence is at :202.
  - The content precedence (`content ? : text ? : template ? : empty`) is at :206. Its template branch mutates `DocumentHelper.toJSON(template)`, which is `template.content` by reference, so clone before `ProsemirrorHelper.replaceTemplateVariables`.
  - `Document.build` (:217) applies the `icon`/`color`/`fullWidth` fallbacks to the template.
  - `text` is set at :242 and publish runs at :254. `id` is an accepted prop, which lets parity tests pass the pre-allocated ID.
- `server/commands/documentUpdater.ts:73-160` -- read-only reference.
  - Assignments are at :75-101. Text is at :102: `replaceImagesWithAttachments` with `base64Only`, then `applyMarkdownToDocument`.
  - `publish && cId` is at :144: it keeps an existing `collectionId` and otherwise sets `cId`.
- `server/models/helpers/DocumentHelper.tsx:660-814` -- `applyMarkdownToDocument`. It mutates the passed instance's `content`, `text`, and `state`, and calls `changed("state", true)`. It throws `ValidationError` for patch errors. `toJSON` (:144) returns `content` by reference, and `toMarkdown` is at :290. Read-only; it equals the baseline (`git diff 4a5a616a… -- server/models` is empty).
- `server/models/Document.ts:555-586` -- `processUpdate`: `title || ""`, plus the content backfill via `toJSON`. `publish` (:1217) and `unpublishWithCtx` (:1319) set publication only. `findByPk({ includeState })` is at :999. Read-only.
- `server/models/helpers/TextHelper.ts:68-130` -- the media-import predicate to mirror: `parseImages` (`server/utils/parseImages.ts`), `new URL`, `isInternalUrl` (`shared/utils/urls.ts:37`), and the `data:` prefix.
- `shared/utils/TextHelper.ts:21` and `shared/utils/ProsemirrorHelper.ts:582` -- template variables. The ProseMirror variant mutates in place. `{date}`/`{time}` depend on the clock, so fixtures use `{author}`.
- `server/tools/documents.ts:457-545,720-770` -- the MCP argument mapping that parity fixtures reproduce:
  - create passes `publish !== false`, `collectionId: collection?.id`, and `sourceMetadata` from `sourceFileName`;
  - update loads `includeState: true`, unpublishes with `{ detach: false }` (ignoring other fields), and calls `documentUpdater(ctx, { document, ...input })`.
  Untouched.
- `server/wikiLint/core/boundary.test.ts` -- the core cannot import Outline modules, so `ProjectedDocument` lives in `adapters/`.
- `server/wikiLint/adapters/canonicalSyntax.ts:31` -- `toCanonicalMarkdown(ProsemirrorData)`, used for canonical-body parity in tests.
- `server/wikiLint/application/writeDecision.ts`, `server/wikiLint/core/registry.ts:24` (`OPERATION_FAILED`), `server/errors.ts:137` (`ValidationError`, id `validation_error`) -- the `abortMessage` location and inputs.
- Test patterns:
  - `server/commands/documentUpdater.test.ts:71-96` (Y.js `state` fixture), and `withAPIContext` (`server/test/support.ts:71`);
  - factories `buildDocument`/`buildDraftDocument`/`buildTemplate`/`buildCollection`;
  - the SQL recorder in `server/tools/documents.enforcement.test.ts:248`.

## Tasks & Acceptance

**Execution:**
- `server/wikiLint/adapters/documentProjection.ts` (new) -- add:
  - the `ProjectedDocument`, `MarkdownCreateInput { title?, text?, icon?, color?, fullWidth?, publish, parentDocumentId?, sourceMetadata? }`, and `MarkdownUpdateInput { title?, text?, editMode?, findText?, icon?, color?, fullWidth?, publish? }` types;
  - `prepareMarkdownCreate(input)` (P2), which returns a frozen prepared value carrying `content` parsed by `ProsemirrorHelper.toProsemirror(text)` when `text` is truthy. Story 2.5 supplies converted HTML through the same field;
  - `prepareMarkdownUpdate(input)` (P2), which runs the media refusal, skipped when `publish === false`;
  - `async projectMarkdownCreate({ prepared, documentId, collectionId, actor, template })` (P4);
  - `async projectMarkdownUpdate({ prepared, document, collectionId })` (P4);
  - `UnstagedMediaError`.
  -- AC1–AC5.
- `server/wikiLint/application/writeDecision.ts` -- add `abortMessage(error: unknown): string` (the AD-20 row 3/5 rule), using `httpErrors.isHttpError` -- AC7.
- `server/wikiLint/adapters/documentProjection.test.ts` (new, DB-backed) -- add one parity helper. It re-fetches the persisted row unscoped with `paranoid: false` and compares:
  - every `ProjectedDocument` field;
  - `toCanonicalMarkdown` of both;
  - decoded `state` (`yDocToProsemirrorJSON`);
  - `published` against `!!publishedAt`;
  - collection-structure membership, under the parent when published and absent otherwise.
  Then cover:
  - every I/O-matrix row;
  - the no-effect proof: projection under a `sequelize.query` spy issues no statement and calls no `sequelize.transaction`, `Event.schedule`, or `attachmentCreator`. Stored rows are unchanged, and the `document`/`template` instances keep `changed() === false` and deep-equal content;
  - deep freezing;
  - a P2 prepared value that is reused while the stored doc changes;
  - the failure rows.
  -- AC1–AC8.
- `server/wikiLint/application/writeDecision.test.ts` -- `abortMessage` for `ValidationError`, `InvalidRequestError`, `UnstagedMediaError`, a plain `Error`, a Sequelize `DatabaseError`, an object with a non-string `id`, and a non-Error -- AC7.

**Acceptance Criteria:**
- Given any supported create or update fixture, when projected and then written by the actual baseline writer with the same arguments (the create receives the pre-allocated `id`), then title, content, text, decoded state, canonical Markdown, collection, parent, publication, structure membership, icon, color, fullWidth, templateId, and sourceMetadata are identical.
- Given projection of any fixture, when it completes or throws, then no SQL statement, transaction, Event, Attachment, or blob results, and the input instances are unmodified.
- Given a create with a template and no text, when projected, then `content` is the complete substituted template body, not a skipped or fragment value.
- Given a projection failure, when `abortMessage` maps it, then a stable-id Outline error yields its message and anything else yields `The operation could not be completed`.

## Spec Change Log

## Review Triage Log

### 2026-10-03 — Review pass

- verdicts: 28 findings — high 0, medium 3, low 13, false 12, maybe-false 0
- findings:
  - `[medium]` `[patch]` blind: the "loaded without state" guard misses a default-scope `findByPk`. The `withoutState` alias reads `state` as `null` when `content` is set, so Story 2.3 could drop collaborative state while trusting the guard — Confirmed: Sequelize maps an aliased attribute to its alias name (`model.js:101`), so an instance cannot tell the alias from a real `null`. A runtime fix would need an API change. The smallest fix removes the false assurance instead: the JSDoc and guard comment now require `includeState: true` and say a default-scope load is undetectable. Carried to Residual risks for Story 2.3.
  - `[low]` `[patch]` blind: `withoutEffect` cannot see a stored blob except through `attachmentCreator` — Fixed: `FileStorage.store` and `FileStorage.storeFromUrl` are spied and asserted uncalled.
  - `[low]` `[patch]` blind: no fixture has a document whose `content` is NULL, so neither the `toJSON` backfill nor the build-from-state edit is compared with the writer — Fixed: two parity cases on a stored null `content` with `state` (title-only, `append`).
  - `[false]` `[reject]` blind: the canonical-Markdown check is redundant and no check ties `state` to `content` — The redundancy is harmless. The projected `state` is compared, decoded, with the writer's own stored `state`, so a projected state/content mismatch fails parity unless the baseline writer produces the same mismatch, which the projection must mirror.
  - `[low]` `[reject]` blind: `ProjectedDocument` is only shallow `Readonly`, so deep mutation surfaces at runtime, not at compile time — The runtime freeze fails loudly. Rules consume canonical syntax, not `content`. A `DeepReadonly` variant of `ProsemirrorData` is more than a direct correction, for a misuse with no caller.
  - `[low]` `[patch]` blind: the contract-misuse tests run outside `withoutEffect`, and `withoutEffect`'s `finally` assertion masks the original error — Fixed: the three tests now run under `withoutEffect`, capture the rejection, and assert `changed() === false`. The masking claim is refuted: the masking happens only when an effect occurred, and that effect is itself the reported failure.
  - `[low]` `[patch]` blind: missing update parity fixtures — nested draft publish under a parent, `fullWidth`-only, `publish: true` on a published document, unpublish with prior `state`, and create with `text: ""` plus a template — Fixed: each is added through `updateWithParity`/`createWithParity`. A `display fields` mode sends `{ icon, color, fullWidth }`.
  - `[low]` `[reject]` blind: `{date}`/`{time}`/`{datetime}` template variables are untested — They pass through the same two baseline helpers as `{author}`, which the fixtures pin. Fake clocks in DB-backed suites add flakiness, so the fix is more than a direct correction for a path with no distinct code.
  - `[low]` `[reject]` blind: `UnstagedMediaError` has no stable id, so the agent gets the generic message — The fix would edit this build's spec (I/O matrix: `abortMessage` = `OPERATION_FAILED`). The refusal is an interim that Story 2.6 replaces, and enforced writes still fail closed.
  - `[low]` `[patch]` blind: the `abortMessage` tests lack a Sequelize `ValidationError`, `WikiLintContractError`, `CanonicalMarkdownError`, and an `InternalError` — Fixed: added to the two tables.
  - `[medium]` `[patch]` edge: same state-guard gap as the first blind row — Grouped with it; same JSDoc and comment fix.
  - `[false]` `[reject]` edge: `{date}`/`{time}` templates could differ between projection and the write across a minute boundary — No production path re-runs template substitution after projection. Story 2.3 P7 stores `projection.title`/`content` as given (AC6), and parity fixtures use the clock-independent `{author}`.
  - `[false]` `[reject]` edge: an unpublish with child documents projects successfully though the baseline refuses it — AD-20 places the unpublish precondition in P7 (row 5), after the decision. Checking it in P4 would contradict the architecture.
  - `[false]` `[reject]` edge: an over-long title or a non-hex color fails only at save, with a generic message — AD-20 places model validation in P7 (row 5), and its message rule gives errors without a stable id the fixed message. The projection is not where model validation runs.
  - `[low]` `[patch]` verification-gap: a collection draft updated without `publish` is never projected; mutation `published: !unpublish` survived — Fixed: "keeps a collection draft unpublished when updated without publish".
  - `[low]` `[patch]` verification-gap: no update fixture has a parent or `templateId`; nulling either survived — Fixed: "publishes a nested draft from a template under its parent".
  - `[low]` `[patch]` verification-gap: no update edits `fullWidth` or sets a non-null `color`; three mutations survived — Fixed: the `display fields` mode, with and without `state`.
  - `[low]` `[patch]` verification-gap: no create sends `text: ""` with a template; `text !== undefined` survived — Fixed: "falls back to the template body for empty text".
  - `[low]` `[patch]` verification-gap: the no-text branch's `structuredClone` is unproven, and removing it passed — Fixed: `updateWithParity` asserts `Object.isFrozen(document.content)` is false. The implementer re-ran with the clone removed, and 10 tests failed.
  - `[medium]` `[patch]` verification-gap (other): same state-guard gap as the first blind row — Grouped with it.
  - `[false]` `[reject]` intent: AC1's call-site clause and ACs 3, 5, and 6 live at the MCP write pipeline, but nothing calls the projection — The epics assign the wiring to Story 2.3: AC6 is "Given the transaction phases of Story 2.3", and 2.3 AC4 "builds the authoritative projection … (P4, Story 2.2)". The project's cross-story convention makes the later story own the integrated fixture. The sentinel path already returns before any writer (Story 2.1 `callWithoutEffect`).
  - `[false]` `[reject]` intent: AC2 parity calls `documentCreator` with a hand-copied MCP mapping and does not exercise the handler's `publish !== false` or `sourceFileName` mapping — The projection's contract takes the writer-facing arguments. The handler mapping is unchanged baseline code whose enforced use is Story 2.3's, with MCP-level fixtures under 2.3 AC5.
  - `[false]` `[reject]` intent: AC3 simulates the locked state without a lock, and the update parse runs in P4 — Locks are Story 2.3's P3 (AD-8). AD-8 limits only what may run outside the transaction, and the baseline helper fuses the parse with the content-dependent merge (Design Notes).
  - `[false]` `[reject]` intent: AC5 fields are not handed to rules — Rule evaluation from the projection is Story 2.3's P5 (2.3 AC4). The projection carries every field the document-surface rules need.
  - `[false]` `[reject]` intent: AC6 — a collection mismatch throws `WikiLintContractError`, not `collection_conflict`, and "once" is not enforced — P3 (Story 2.3) compares and emits `collection_conflict` before projection. The projection's check is a contract assertion for a caller bug. "Once" is the orchestration of one attempt, which Story 2.3 owns.
  - `[false]` `[reject]` intent: AC7 delivers only the message rule, with no rollback, summary, or import-size fixture — Rollback is Story 2.3's, the `aborted_before_decision` summary is Story 2.7's, and the import-size limit is the HTML import path of Story 2.5.
  - `[false]` `[reject]` intent: AC8 does not cover the handler path, including the `revisionCount` no-changes check — The unchanged-update check is P7 (AD-8, Story 2.3 AC8). AC8's comparison target, "the actual baseline writer", is exercised directly.
  - `[false]` `[reject]` intent: behavior beyond the ACs (`UnstagedMediaError`, the state guard, `abortMessage` placement) — Descriptive only. The media refusal is the fail-closed interim until Story 2.6 AC1/AC2, and `abortMessage` implements the AD-20 rule that AC7 names.

## Design Notes

**Why P2 is thin for updates.** Baseline `applyMarkdownToDocument` fuses the Markdown parse with the content-dependent merge. Splitting it would mean copying baseline code and losing parity-by-construction. So the update parse runs in P4, which AD-8 permits, since it restricts only what may run outside. P2 for Markdown makes no stored-state assumption, so there is nothing to revalidate inside until Story 2.6 adds staging.

**Cross-story ownership.** These pieces belong to later stories:
- AC1 (the sentinel and baseline build no projection, at the MCP surface), AC3 (inside the transaction), AC5 (available to rules), and AC6 (P3 comparison, and P7 stores without rebuilding) are wired and fixtured by Story 2.3;
- AC7's rollback and the `aborted_before_decision` summary belong to Stories 2.3 and 2.7.
This story makes them possible: a frozen projection that carries every value P7 needs (`text` and `state` included, so nothing is re-converted), the P2/P4 split, typed failures, and the message rule.

```ts
const scratch = Document.build({ id: document.id, content: document.content,
  state: document.state, text: document.text });
DocumentHelper.applyMarkdownToDocument(scratch, input.text, input.editMode, input.findText);
// → content: structuredClone(scratch.content), text: scratch.text, state: copy of scratch.state ?? null
```

## Verification

**Commands:**
- Resume the scratch PostgreSQL per memory `local-test-postgres` -- expected: `pg_isready -h 127.0.0.1 -p 5432` accepts connections.
- `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint server/tools/documents.enforcement.test.ts` -- expected: all pass.
- `corepack yarn tsc` -- expected: exit 0.
- `node_modules/.bin/oxlint --type-aware` and `node_modules/.bin/oxfmt --check` on the changed files -- expected: clean.
- `git diff 4a5a616a21be800257dc11cef4263d0dd0412156 -- server/models server/commands shared/utils server/editor` -- expected: empty.
- Temporary mutations, each reverted afterwards -- expected: the suite fails for each:
  - skip the template clone;
  - drop `.trim()` on the update title;
  - project `append` from the prepare-time document;
  - let unpublish apply `text`.

## Auto Run Result

Status: done

**Summary.** Story 2.2 adds one side-effect-free, deep-frozen `ProjectedDocument` for enforced MCP Markdown writes. P2 preparation (`prepareMarkdownCreate`/`prepareMarkdownUpdate`) is input-only: it parses create text and refuses update media the baseline would import, until Story 2.6. P4 projection (`projectMarkdownCreate`/`projectMarkdownUpdate`) reproduces the exact `v1.10.1` writer semantics: templates, explicit field precedence, `replace`/`append`/`prepend`/`patch` through the baseline helper on a scratch copy, publish/unpublish, collection, and parent. It issues no query and mutates no input instance. The AD-20 row 3/5 message rule is `abortMessage`. The MCP handlers are unchanged: wiring, the transaction, persistence, and the summary belong to Stories 2.3 and 2.7, and valid enforced writes still fail closed.

**Files changed.**
- `server/wikiLint/adapters/documentProjection.ts` (new) -- the projection types, P2/P4 functions, `UnstagedMediaError`, and the deep freeze.
- `server/wikiLint/adapters/documentProjection.test.ts` (new, DB-backed, 43 tests). These are parity tests against `documentCreator`, `documentUpdater`, and `unpublishWithCtx`. They cover every I/O-matrix row, including the `v1.10.1` container patch that drops later table rows. They also hold the no-effect proof (no SQL, transaction, Event, Attachment, or storage write), the immutability and re-fetched-state cases, and the failure and contract-misuse cases.
- `server/wikiLint/application/writeDecision.ts` -- `abortMessage(error)`: the message of an `http-errors` error with a non-empty string `id`, else `OPERATION_FAILED`.
- `server/wikiLint/application/writeDecision.test.ts` -- `abortMessage` cases.
- This spec.

**Review.** 28 findings: high 0, medium 3 (one grouped entry), low 13, false 12, maybe-false 0.
- Patched (all test-only, except a JSDoc and comment correction):
  - the state-guard precondition text (medium; three findings grouped);
  - storage spies in `withoutEffect`;
  - null-`content` parity fixtures;
  - contract-misuse tests under `withoutEffect`;
  - the missing update and create parity fixtures (draft without publish, nested template draft publish, republish, unpublish with state, display fields, empty text with a template);
  - the no-text clone assertion;
  - extra `abortMessage` cases.
- Rejected:
  - shallow `Readonly` typing (low; runtime freeze fails loudly, fix beyond a direct correction);
  - clock-dependent template variables (low; same helpers as `{author}`, fake clocks add flakiness);
  - `UnstagedMediaError` without a stable id (low; the fix edits this spec's matrix, and it is an interim);
  - every `false` row, with its refutation in the triage log.
- Deferred: none.
- Patched entries by verdict: high 0, medium 1, low 10. Follow-up review recommendation: `false`. Only one medium entry was patched, and it changed documentation only.

**Verification.**
- The scratch PostgreSQL 14 was resumed (`pg_isready` accepting).
- `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint server/tools/documents.enforcement.test.ts` passed: 25 files and 1055/1055 tests before the review patches, then 1068/1068 after.
- `corepack yarn tsc`, `oxlint --type-aware`, and `oxfmt --check` on the four changed files exited 0.
- `git diff 4a5a616a21be800257dc11cef4263d0dd0412156 -- server/models server/commands shared/utils server/editor` is empty, so the baseline writers and helpers are unchanged and the post-`v1.10.1` fix `c17d2c52b` is not imported.
- Four temporary mutations, each restored and checked with `cmp`, failed `documentProjection.test.ts`: skip the template clone (2 failed), drop the update title `.trim()` (3), project from the prepare-time document (1), and let unpublish apply `text` (1).
- After the review patches, removing the no-text `structuredClone` failed 10 tests (implementer run).

**Residual risks.**
- **`includeState` load in Story 2.3.** Story 2.3's P3 re-fetch must load the document with `includeState: true`. A default-scope load aliases `state` to `null` whenever `content` is set. The projection cannot detect that, and would silently omit the collaborative-state update. The JSDoc now states this precondition.
- **Interim media refusal.** Update text carrying `data:` images is refused (row 3, fixed message) until Story 2.6 stages media.
- **Wiring left to later stories.** The AC1 call-site clause, AC3, AC5, AC6, and AC7's rollback and summary are proven only once Stories 2.3 and 2.7 wire the projection in. Under the project's cross-story convention, those stories own the integrated fixtures.
