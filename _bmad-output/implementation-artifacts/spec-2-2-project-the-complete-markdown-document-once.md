---
title: 'Story 2.2: Project the Complete Markdown Document Once'
type: 'feature'
created: '2026-10-03'
status: done
baseline_revision: 3b5332438bff2902590795b7d7ca821848f4b9db
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

### 2026-10-03 — Escalation resolution: DB verification gate

- Trigger: the follow-up review could not run the DB-backed suite. Its first Verification step pointed at an agent-private memory that the reviewer could not read, `pg_isready` was not on `PATH`, the database was not running, and Vitest hung.
- Amended: only the first Verification command. It now runs the repository's `scripts/test-db.sh ensure` (documented in `AGENTS.md`), so the session starts the test database itself.
- Known-bad state avoided: treating a hung or interrupted Vitest run as a result, or finalizing from static checks alone.
- KEEP: the intent contract and the follow-up review's patches (template title-before-body order and the added parity fixtures) are restored for review unchanged.

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

### 2026-10-03 — Follow-up review pass

- verdicts: 18 findings — high 0, medium 2, low 11, false 5, maybe-false 0
- findings:
  - `[low]` `[patch]` blind: template title and body substitutions ran in the reverse order from `documentCreator` — Moved title substitution before content substitution in `documentProjection.ts`; this matches the baseline order at a clock boundary.
  - `[medium]` `[patch]` blind: a default-scope load can alias omitted Y.js state to null — Carried from the prior pass. The documented `includeState: true` precondition and residual risk remain; Story 2.3 must satisfy them.
  - `[low]` `[reject]` blind: a caller can mutate the projection's copied Buffer — The contract explicitly exempts TypedArrays from freezing and requires a private copy from the input, which the implementation supplies. A getter that copies on each read adds complexity without an existing mutating caller.
  - `[false]` `[reject]` blind: an empty update on null stored content would be persisted with a backfilled body — The baseline MCP handler rejects unchanged `revisionCount` as a no-change operation; no successful write of an empty update is compared with the projection. Story 2.3 owns that P7 check.
  - `[low]` `[patch]` blind: create parity lacked explicit false and null values against a populated template — Added a fixture with `fullWidth: false`, `icon: null`, and `color: null`; the null values inherit template fields under the writer's `??` precedence.
  - `[low]` `[patch]` blind: create parity lacked an empty explicit title against a titled template — The same fixture asserts the empty title is retained.
  - `[low]` `[reject]` blind: no multi-block rich-content patch fixture — The adapter calls the same baseline `applyMarkdownToDocument` helper for every patch. Existing paragraph and table fixtures exercise that branch; another content shape does not exercise new projection logic.
  - `[low]` `[patch]` blind: unpublish parity lacked a published child and an already-draft document — Added both fixtures through `updateWithParity`, including collection-structure comparison.
  - `[false]` `[reject]` blind: separately comparing content and decoded state could miss a projection mismatch — Both values are compared with the actual writer result, whose state is the required parity target. This is the same claim refuted in the prior pass.
  - `[false]` `[reject]` blind: the sprint board says done while this spec is in review — The orchestrator owns `sprint-status.yaml`, and its row is bookkeeping rather than verification. This run has not written or reverted it.
  - `[low]` `[reject]` blind: the spec lacked observed verification results — The workflow explicitly rejects findings whose fix is to edit this build's spec; the Auto Run Result below records this pass's actual outcomes and blocker.
  - `[medium]` `[patch]` edge: a default-scope load can drop Y.js state — Carried from the prior pass; same location, claim, precondition, and residual risk as the blind state-load row.
  - `[low]` `[reject]` edge: the returned Buffer is writable — The caller receives a copy and the explicit TypedArray exception applies. No current consumer mutates it; a getter would add complexity for a future caller.
  - `[low]` `[patch]` verification-gap: empty update text had no parity case — Added `empty replace` to the update parity modes.
  - `[low]` `[patch]` verification-gap: clearing existing display fields had no parity case — Added a mode that clears populated icon and color and changes `fullWidth: true` to false.
  - `[low]` `[patch]` verification-gap: explicit false did not override a true template fullWidth in a parity case — Added it to the populated-template fixture.
  - `[false]` `[reject]` intent-alignment: the diff tests the adapter rather than a complete enforced MCP write — The intent contract explicitly assigns handler wiring, transaction, validation, and persistence to Story 2.3; this pass preserves that boundary.
  - `[false]` `[reject]` intent-alignment: the diff contains a sprint-status change — That local change belongs to the orchestrator and was already present before this run; it is not a Story 2.2 edit.

### 2026-10-03 — Review pass

- verdicts: 17 findings — high 0, medium 0, low 6, false 11, maybe-false 0
- findings:
  - `[low]` `[patch]` blind: the shared update fixture's new `fullWidth: true` turns the `display fields` mode into a `fullWidth` no-op, so no update parity case changes `fullWidth` from false to true — Fixed: the base fixture now starts opposite to the mode's value (`fullWidth: input.fullWidth !== true`). `display fields` now covers false→true, `clear display fields` covers true→false, and the other modes keep a non-default true. A mutation that ignores an explicit `true` now fails 2 tests; before the fix it passed.
  - `[false]` `[reject]` blind: "keeps an already-draft document unpublished" proves parity for a path the MCP handler refuses (`authorize(user, "unpublish")` denies drafts, `server/policies/document.ts:253-262`) — For this input the projection's output equals the writer's (`unpublishWithCtx` on a draft only saves), so nothing is wrong at the cited location. The projection contract takes writer-facing arguments (first pass). The refusal happens in the handler before P4, and the intent forbids wiring the projection into `server/tools/documents.ts`.
  - `[false]` `[reject]` blind: the new create fixture sends `title: ""` and `icon`/`color: null`, which `optionalString()` (`server/tools/util.ts:63-68`) never produces. It also skips the reachable empty-title case, and `MarkdownCreateInput` is wider than the handler — Parity proves the projection equals `documentCreator` for these writer-facing arguments. The reachable MCP case (`""` becomes `undefined`, so the template title wins) is pinned by "projects the complete substituted template body…" (`input: { publish: true }` → `"Note by Ada Lovelace"`). A `null` from any caller gets `documentCreator`'s own `??` inheritance, so projection and writer cannot diverge.
  - `[low]` `[reject]` blind: the title-before-body reorder is unverified, and clock-dependent template variables could make the linted title or body differ from the persisted one — The reorder makes the projection substitute in the same order as `documentCreator` (:202, then :206), so a clock tick can only produce a combination the writer could also produce. Telling the two orders apart needs a clock that advances between two substitutions inside one call, and `vi.setSystemTime` freezes it instead. Such a test is more than a direct correction for a cosmetic path. The cross-call skew claim is carried from the first pass's `[false]` edge row: Story 2.3 P7 stores `projection.title`/`content` as given (AC6).
  - `[false]` `[reject]` blind: the unpublish-child test checks its structure claim only implicitly, never checks the parent node, and runs only without `state` — `expectParity` asserts that the child is absent from the stored structure after the writer ran. The `Document` `AfterCreate` hook (`server/models/Document.ts:519-538`) had inserted it under the parent beforehand. `ProjectedDocument` has no structure field, so removing the wrong node would be a regression in the baseline writer, and `git diff 4a5a616a… -- server/models` is empty. Prior `state` does not touch the structure, and the existing unpublish case covers both `state` variants.
  - `[false]` `[reject]` edge: `publish: false` on a published document with active children projects `published: false`, while `unpublishWithCtx` throws — carried: AD-20 places the unpublish precondition in P7 (row 5), after the decision. The projection's unpublish branch still reads as the first pass described.
  - `[false]` `[reject]` edge: the already-draft unpublish fixture covers a path that MCP authorization denies — Same refutation as the blind row: the output matches the writer, and the handler's refusal comes before P4, which this story does not wire.
  - `[false]` `[reject]` edge: the create fixture's `title: ""`/`null` inputs cannot arrive through MCP, and the empty-title assertion contradicts MCP behavior — Same refutation as the blind row: parity with the writer-facing arguments holds, and the template-body fixture pins the reachable `undefined` title.
  - `[false]` `[reject]` edge: `clear display fields` on a document whose display fields are already cleared projects success, while `update_document` returns a no-changes error — The no-change rejection is the handler's `revisionCount` check, which AD-8 places in P7 (Story 2.3 AC8). The projection is a pure function of the re-fetched state and the arguments, and an identical projection is the right input for that check.
  - `[low]` `[patch]` edge: the `fullWidth: true` fixture turns `display fields` into a `fullWidth` no-op — Grouped with the first blind row; same fix.
  - `[false]` `[reject]` edge: nothing asserts the child's place in the structure before the unpublish, so the absence check would pass even if the child had never been inserted — The `AfterCreate` hook `addDocumentToCollectionStructure` (`server/models/Document.ts:519-538`) inserts every published document that has a collection under its parent at creation. If that hook regressed, every published-update parity case that expects presence would also fail.
  - `[low]` `[patch]` verification-gap (other): the update parity modes no longer change `fullWidth` from false to true — Grouped with the first blind row; same fix, confirmed by the mutation run.
  - `[false]` `[reject]` intent: the new create fixture uses inputs MCP cannot send (R1/R2 divergence) — Descriptive. Same refutation as the blind row: the projection contract is writer-facing, and the reachable case is pinned.
  - `[false]` `[reject]` intent: the already-draft unpublish fixture cannot be reached through MCP — Descriptive. Same refutation as the blind row.
  - `[low]` `[reject]` intent: no test can tell the two substitution orders apart — Same as the blind reorder row: it needs a clock that advances inside one call, which is a test beyond a direct correction for a cosmetic path.
  - `[low]` `[patch]` intent: the update coverage direction for `fullWidth` shifted — Grouped with the first blind row; same fix.
  - `[false]` `[reject]` intent: the working tree carries a `sprint-status.yaml` change that the "Never" list names — carried: the change belongs to the orchestrator and was present before this run. This run neither wrote nor reverted it.

### 2026-10-03 — Follow-up review pass

- verdicts: 11 findings — high 0, medium 0, low 3, false 8, maybe-false 0
- findings:
  - `[low]` `[reject]` blind: `## Auto Run Result` is absent although earlier review rows refer to it — The section is written during this pass's required finalization below; a finding whose fix edits this spec is rejected.
  - `[false]` `[reject]` blind: the sprint row says `done` while this spec was temporarily `in-review` — Carried: the row is orchestrator bookkeeping, not verification or a defect; this run did not change it.
  - `[low]` `[reject]` blind: the template title-before-body change lacks a clock-boundary order test — Carried: testing a tick between helper calls needs a controlled internal clock transition; the implementation now follows `documentCreator`'s order, and a test is more than a direct correction for this edge case.
  - `[false]` `[reject]` blind: the create fixture's empty title and null display fields cannot be sent through MCP — Carried: this tests writer-facing parity; the reachable undefined-title template case is also covered.
  - `[false]` `[reject]` blind: the already-draft unpublish fixture bypasses MCP authorization — Carried: it tests parity with `unpublishWithCtx`; handler authorization is outside this adapter's contract.
  - `[false]` `[reject]` blind: the Y.js default-scope state risk was incorrectly presented as fixed — The earlier log explicitly says the patch documents the `includeState: true` precondition and carries the runtime integration risk to Story 2.3; it does not claim the loader was changed.
  - `[low]` `[reject]` verification-gap: a clock-boundary title/body order assertion is missing — Carried: same location and claim as the blind order row and the preceding review's order-test row; the helper call order matches the baseline writer.
  - `[false]` `[reject]` intent: the tests do not exercise a complete enforced MCP write — Carried: the intent assigns handler wiring, transaction, validation, and persistence to Story 2.3; this story proves adapter parity with the baseline writers.
  - `[false]` `[reject]` intent: the new create fixture includes MCP-unreachable values — Carried: the writer-facing parity contract permits them, and a separate template fixture covers the reachable case.
  - `[false]` `[reject]` intent: the already-draft unpublish fixture is MCP-unreachable — Carried: the handler rejects it before P4, while the fixture tests the underlying writer's behavior.
  - `[false]` `[reject]` intent: the diff includes a sprint-status change despite this story's boundary — Carried: the change was staged before this run and belongs to the orchestrator; this run neither wrote nor reverted it.

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
- `scripts/test-db.sh ensure` -- expected: exit 0, with the test PostgreSQL from `.env.test` reachable and migrated. A non-zero exit blocks the story before any DB-backed suite runs, because Vitest hangs rather than fails without the database.
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

Status: done.

The adapter projects the complete Markdown create/update result from prepared input and the current document state, matching the v1.10.1 writers without side effects. The create projection substitutes the template title before its body. The parity tests cover the added publication, display-field, empty-input, and state cases. `abortMessage` applies the stable-id error rule. MCP transaction and persistence integration remains assigned to Story 2.3.

Files in the reviewed change: `server/wikiLint/adapters/documentProjection.ts` (projection and writer-order parity), `server/wikiLint/adapters/documentProjection.test.ts` (writer parity and no-effect coverage), and this spec (review record). The staged `sprint-status.yaml` change predates this run and is orchestrator-owned.

Review: 11 findings; 0 patches applied, 0 deferred items, 3 low findings rejected for the recorded scope or test-cost reasons, and 8 false findings rejected with the refutations above. Follow-up review recommended: false (0 high and 0 medium patches).

Verification on 2026-10-03: `scripts/test-db.sh ensure` exited 0; `TZ=UTC node_modules/.bin/vitest run --project server server/wikiLint server/tools/documents.enforcement.test.ts` passed 25 files and 1075 tests; `corepack yarn tsc`, type-aware `oxlint`, and `oxfmt --check` exited 0. `git diff 4a5a616a21be800257dc11cef4263d0dd0412156 -- server/models server/commands shared/utils server/editor` was empty. The listed temporary mutation checks were established in the earlier review pass and were not repeated because this pass made no implementation patch.

Residual risk: a default-scope load can alias omitted Y.js state to `null`, so Story 2.3 must load with `includeState: true` and verify that call path. The projected `state` is a private copy, but TypedArrays remain writable by callers under the explicit contract exception. The adapter is not yet wired into MCP writes; Story 2.3 owns that integration.
