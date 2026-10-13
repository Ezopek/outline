---
title: 'DW-20: Bound the documentStructure read before materializing it'
type: 'bugfix'
created: '2026-10-13'
baseline_revision: '33bc749aa1afc270ceadc50cb214772ba99a0e28'
status: 'in-progress'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** `readWikiSnapshot` (`server/wikiLint/adapters/wikiReader.ts`, the graph block after `const graphs = evaluated.filter(...)`) loads the full `documentStructure` JSON of every graph collection with one `Collection.unscoped().findAll({ attributes: ["id", "documentStructure"] })` and only then meters its nodes with `meter.addStructureNodes(structureNodeCount(row.documentStructure))`. The AD-16 node limit therefore bounds neither the memory nor the parse cost of that read: a pathological structure column is fully transferred and parsed before it can fail the snapshot (Epic 1 retrospective F-7, DW-20).

**Approach:** Meter the size of the structure columns before any of them is materialized. A new AD-16 limit `structureBytes` (UTF-8 bytes of the JSON text of every `documentStructure` read, together; 4 MiB) joins `WIKI_SNAPSHOT_LIMITS`, and `SnapshotMeter` gains `addStructureBytes(bytes)`. In the graph block, before the existing structure `findAll`, one additional query over the same collection ids selects `id` and `octet_length("documentStructure"::text)` (a null column counts as 0 bytes) and feeds every size into the meter, so a snapshot above the limit fails with `WikiResourceLimitError` before the first structure JSON reaches Node. The existing structure read and the node meter stay as they are, after the size query. Every query call keeps its bounded batch (`boundBatch` before the size query and, as today, before the structure read). `lint_wiki` already maps `WikiResourceLimitError` to `VALIDATION_RESOURCE_LIMIT_EXCEEDED`; nothing in the shell changes.

## Boundaries & Constraints

**Always:**
- `server/wikiLint/application/snapshotLimits.ts`: add `structureBytes: 4194304` to `WIKI_SNAPSHOT_LIMITS` with a JSDoc line in the style of its neighbours, add it to the summed totals and add `addStructureBytes(bytes: number)` beside `addStructureNodes`, documented the same way.
- `server/wikiLint/adapters/wikiReader.ts`: in the graph block, after `await boundBatch(transaction, deadline)` and before the structure `findAll`, run the size query through the Sequelize model API of the file (`Collection.unscoped().findAll` with a `sequelize.literal` or `sequelize.fn` attribute, or a raw `sequelize.query` with bound ids: the worker's choice, consistent with the file), meter every row with `addStructureBytes`, then `await boundBatch(transaction, deadline)` again and keep the existing structure read unchanged. Extend the `readWikiSnapshot` JSDoc with one sentence saying that the structure columns are size-metered before they are read.
- The size expression is `octet_length("documentStructure"::text)` with a null column counted as 0.
- Tests in `server/wikiLint/application/snapshotLimits.test.ts`: the frozen-constants assertion gains `structureBytes: 4194304`, and the `summed` table gains the `structureBytes` row, so the at-limit, above-limit and accumulation cases cover it.
- Tests in `server/wikiLint/adapters/wikiReader.test.ts`, inside `describe("graph authorization")` or a new `describe("structure size")` beside it, with the file's helpers (`buildAdminFixture`, `hierarchyPolicy`, `entriesFor`, `snapshotOf`, `recordStatements`, `reduced`): (1) the size query precedes the structure read, asserted on the recorded statements; (2) a snapshot whose structure columns exceed the limit fails with `WikiResourceLimitError` and no recorded statement selects the `documentStructure` column itself. How the over-limit case is produced (a fixture written above 4 MiB, or the limit lowered through `vi.mock` of `../application/snapshotLimits` with the real `SnapshotMeter` and `WikiResourceLimitError` kept) is the worker's choice; the test must not slow the file by more than a few seconds.
- Every existing test of both files passes unchanged.

**Never:**
- Do not change `structureNodes`, `structureNodeCount`, `structureDocumentIds`, `walkStructure`, the document keyset loop, the link lookup, the shell (`lintWiki.ts`), the policy model or any rule evaluator.
- Do not read the structure column twice or drop the node meter: the size meter is added in front of the existing read.
- Do not add a dependency, a migration, a new file or a new test directory.
- Do not edit the planning artifacts (`_bmad-output/planning-artifacts/`), the deferred-work ledger, the sprint board or this spec; the AD-16 wording in `epics.md` is the operator's to amend.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| within the limit | graph-authorized collections whose structure columns total at most 4 MiB | the snapshot equals today's: same collections, documents, graph inputs | none |
| at the limit | structure columns totalling exactly 4,194,304 bytes | passes (the meter throws only above the limit) | none |
| one byte above | structure columns totalling 4,194,305 bytes | `WikiResourceLimitError` before any statement selects the `documentStructure` column; `lint_wiki` reports `VALIDATION_RESOURCE_LIMIT_EXCEEDED` as for every other limit | the error is the only effect; the transaction ends as today |
| null structure | a graph collection with `documentStructure` null | 0 bytes metered; the structure read and the node meter behave as today | none |
| no graph collections | no collection with a graph check, or the actor lacks `readDocument` everywhere | no size query is issued; the existing "reads no structure" tests pass unchanged | none |
| statement order | one graph-authorized collection with `hierarchyPolicy` | the recorded statements hold the size SELECT (containing `octet_length`) before the SELECT that reads `documentStructure`, each after its bounded batch | none |

</intent-contract>

## Code Map

- `server/wikiLint/adapters/wikiReader.ts` -- `readWikiSnapshot` (exported async function, JSDoc above it); the graph block starts at `const graphs = evaluated.filter(` and reads the structures under `if (graphs.length > 0) {`: `await boundBatch(transaction, deadline);` then `Collection.unscoped().findAll({ attributes: ["id", "documentStructure"], where: { id: graphs.map((item) => item.collectionId) }, transaction })` and the `for (const row of structureRows)` loop with `meter.addStructureNodes(...)`. `boundBatch` is imported from `./documentReader`; `Op` and `Transaction` come from `sequelize`; `Collection` from `@server/models` (its default scope excludes `documentStructure`, hence `unscoped()`). `walkStructure`, `structureDocumentIds` and `structureNodeCount` sit above `readWikiSnapshot`.
- `server/wikiLint/application/snapshotLimits.ts` -- `WIKI_SNAPSHOT_LIMITS` (frozen), `WikiResourceLimitError`, `SnapshotMeter` with `totals`, `addDocuments`, `addMarkdown`, `addLinkReferences`, `addStructureNodes` and the private `add`.
- `server/wikiLint/application/snapshotLimits.test.ts` -- the frozen-constants `toEqual` and the `summed` table driving `it.each`.
- `server/wikiLint/adapters/wikiReader.test.ts` -- `recordStatements()` spies on `sequelize.query` and returns the recorded `{ sql, transaction }` list; `reduced` folds them to statement heads; `hierarchyPolicy`, `entriesFor`, `snapshotOf`, `buildAdminFixture`; `describe("graph authorization")` holds "reads no structure where the actor lacks readDocument", which asserts on the recorded SQL the same way the new tests do.
- `server/wikiLint/application/lintWiki.ts` -- maps a `WikiResourceLimitError` from the reader to `VALIDATION_RESOURCE_LIMIT_EXCEEDED` (no change).

## Tasks & Acceptance

**Execution:**
- `server/wikiLint/application/snapshotLimits.ts` -- the `structureBytes` limit and `addStructureBytes`.
- `server/wikiLint/adapters/wikiReader.ts` -- the bounded size query and its metering in front of the structure read; the JSDoc sentence.
- `server/wikiLint/application/snapshotLimits.test.ts` -- the constant and the `summed` row.
- `server/wikiLint/adapters/wikiReader.test.ts` -- the statement-order test and the over-limit test.

**Acceptance Criteria:**
- Given the statement-order row, when the snapshot is read, then the recorded statements contain the size SELECT before the structure SELECT.
- Given the one-byte-above row, when the snapshot is read, then it fails with `WikiResourceLimitError` and no recorded statement selects the `documentStructure` column.
- Given the baseline reader (no size query), when the two new reader tests run, then both fail (no size SELECT is recorded; the over-limit snapshot succeeds), so the tests detect DW-20.
- Given `corepack yarn tsc`, `node_modules/.bin/oxlint --type-aware server shared`, `node_modules/.bin/oxfmt --check` on the four changed files, `node_modules/.bin/vitest run --project server server/wikiLint/application/snapshotLimits.test.ts` and `node_modules/.bin/vitest run --project server server/wikiLint/adapters/wikiReader.test.ts`, when they run, then every one passes.
