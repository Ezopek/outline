### DW-1: parseCanonicalMarkdown throws when a block token starts on a blank line, failing every rule of the document instead of only rules that need that position.
origin: spec-deferred 07c92c8bfe2c
location: server/wikiLint/adapters/canonicalSyntax.ts:74
source_spec: `spec-1-1-establish-the-deterministic-result-contract-and-closed-rule.md`
reason: server/wikiLint/adapters/canonicalSyntax.ts blockPosition throws CanonicalMarkdownError for a whitespace-only start line, while unmapped blocks degrade to position null. No canonical (serializer-produced) input reaching this path has been found. Settle it by finding a toCanonicalMarkdown output whose block token map starts on a blank line; if one exists, return position null instead of throwing.
status: done 2026-10-04
resolution: resolved by sweep bundle dw-canonical-block-blank-line-position
resolution-undo: 9cbb805e46e2013917b77310b2fd2ffaceb169bd9ef92ca30ab62f597b46b5a7 2026-10-04 7374617475733a206f70656e

### DW-2: Repeated missing-item Findings (REQUIRED_SECTION_MISSING, REQUIRED_METADATA_FIELD_MISSING) are byte-identical, so an agent cannot tell which configured section or field to add.
origin: spec-deferred d3b4850f196c
location: server/wikiLint/core/registry.ts (issue messages); Architecture Spine AD-12
source_spec: `spec-1-1-establish-the-deterministic-result-contract-and-closed-rule.md`
severity: medium
reason: AD-12 fixes Finding to { code, severity, message, location } with a document location; the registry message is fixed and generic for non-disclosure (NFR-11, policy class only for document-only readers); the rule-local ordinal is not part of the output. Identifying the missing item needs an architecture decision (for example readability-gated detail) before the Story 1.10 lint-repair-relint acceptance.
status: done 2026-10-04
resolution: already resolved: Story 2.0 (commit 1cac931a9, AD-12 amendment 2e50ee933): readability-gated FindingDetail {kind:"section",heading,headingLevel} / {kind:"metadata_field",field} in server/wikiLint/core/contracts.ts:92 and registry.ts:573-646, emitted per configured item in core/documentRules.ts:30,393-412 and gated by detailVisible in application/lintDocument.ts:307

### DW-3: Repeated GLOBAL_INDEX_LINK_MISSING Findings are byte-identical, so an agent cannot tell which configured global index to link, or which collection policy required it when several collections in the
origin: spec-deferred 17d969ca65d2
location: server/wikiLint/core/graphRules.ts:182 (globalIndexLinks emit); Architecture Spine AD-12
source_spec: `spec-1-6-detect-authorized-hierarchy-and-global-index-defects.md`
severity: medium
reason: The AD-12 Finding is fixed to { code, severity, message, location }. The registry message is generic, and the relationship location names only the surface document. Every missing index of one surface, and every collection policy that shares that surface and index, therefore yields an identical Error that differs only in sort position. The configured index IDs are server-side configuration, which the agent never sees. This is the same root cause as DW-2: identifying the missing item needs an architecture decision before the Story 1.10 lint-repair-relint acceptance. Raised by the Blind Hunter and the Edge Case Hunter in the 2026-10-02 review pass.
status: done 2026-10-04
resolution: already resolved: Story 2.0 (commit 1cac931a9): GLOBAL_INDEX_LINK_MISSING carries {kind:"global_index",documentId,urlId} via server/wikiLint/core/graphRules.ts:18,246-264 with detailVisible:true from application/lintWiki.ts:495,523

### DW-4: lint_wiki's unit-evaluation loop runs every unit synchronously with no await, so the whole evaluation phase blocks the worker's event loop.
origin: spec-deferred a09e04b78f1a
location: server/wikiLint/application/lintWiki.ts (unit loop over wikiUnits)
source_spec: `spec-1-7-preserve-safe-work-under-timeouts-limits-and-isolated-failur.md`
severity: medium
reason: `lintWiki` iterates `wikiUnits(...)` and calls the synchronous `evaluateDocumentRules` and `evaluateGraphCheck` with no yield between units. No other request on that process is served until evaluation ends, and a client disconnect cannot be observed meanwhile. The loop has been synchronous since Story 1.5/1.6, and Story 1.7 only added a synchronous clock read per unit, so this is pre-existing. How long the block lasts at the 150- and 1,000-document profiles is unmeasured. Story 3.3 (AD-17) would settle it by measuring the evaluation duration and the maximum unit time; yielding between units (not fan-out) is the candidate fix. Raised by the Blind Hunter in the 2026-10-02 review pass.
status: open

### DW-5: Synchronous CPU work between deadline checks (serializing and parsing up to 100 documents per keyset batch, surface serialization, one graph unit) can carry a lint_wiki run past its 60 s deadline and
origin: spec-deferred 28c283165e16
location: server/wikiLint/adapters/wikiReader.ts (keyset loop, canonicalContent); server/wikiLint/application/lintWiki.ts (stop margin)
source_spec: `spec-1-7-preserve-safe-work-under-timeouts-limits-and-isolated-failur.md`
reason: `boundBatch` checks the floor only before each database batch, and the shell checks the stop margin only before each unit. A batch whose serialization and parsing take seconds, or a long graph unit started just above the margin, is never preempted (AD-11). Whether any measured batch or unit exceeds the roughly 5 s gap between the 60 s deadline and the 65 s socket timeout is unverified. Story 3.3 would settle it by measuring the maximum batch CPU time and the maximum unit time on the AD-17 fixtures and sizing `SET_LOCAL_FLOOR_MS` and `LINT_WIKI_STOP_MARGIN_MS` to cover them. Raised by the Blind Hunter in the 2026-10-02 review pass.
status: open

### DW-6: Connection acquisition for the lint_wiki snapshot transaction (and the scoped lookup transaction) is not charged to the request deadline, so a pool wait of up to 30 s can overrun the 63 s bound while
origin: spec-deferred c347e597ebbf
location: server/wikiLint/adapters/documentReader.ts:78 (readOnlyTransaction)
source_spec: `spec-1-7-preserve-safe-work-under-timeouts-limits-and-isolated-failur.md`
severity: medium
reason: `readOnlyTransaction` calls `sequelize.transaction`, which waits for a pool connection up to `pool.acquire = 30000` (`server/storage/database.ts:169`) before the first `boundBatch` checks the remainder. AD-11 requires connection acquisition to be charged to the phase it serves. This has been pre-existing since Story 1.5, which introduced `readOnlyTransaction`. Settle it by bounding acquisition by `deadline.remainingMs()`, or by checking the floor before opening the transaction, with a fixture that holds the pool. Raised by the Edge Case Hunter in the 2026-10-02 review pass.
status: done 2026-10-04
resolution: resolved by sweep bundle dw-lint-snapshot-pool-acquire-deadline
resolution-undo: c7fb267736febfb6b65cf3938067c9be5046109f6eecada193f7f10238d5d3e3 2026-10-04 7374617475733a206f70656e

### DW-7: The fork README's visible-metadata example uses `- ` bullets, but the v1.10.1 serializer emits every bullet as `* `, so the example does not round-trip byte for byte.
origin: spec-deferred 4a4cbba2a02c
location: server/tools/README.md (Templates and visible metadata)
source_spec: `spec-1-10-accept-the-complete-read-only-lint-and-repair-loop.md`
severity: low
reason: server/tools/README.md presents "- Status: Active" / "- Last verified: 2026-09-20" as the shape that survives the Markdown/ProseMirror round trip. Story 1.10's HTTP suite (server/routes/mcp/wikiLint.test.ts, "round trip") shows MCP create_document + fetch return "* Status: Active"; the fields stay valid and lint clean, but agents copying the example as patch findText would miss. The README is a companion of the binding SPEC, so the edit needs a deliberate contract update rather than an unattended story change.
status: done 2026-10-04
resolution: resolved by sweep bundle dw-decision-dw-7
resolution-undo: 8a5da897cf69282f4ae77b1da4dd79679c323505c18287f61047c3a377510de0 2026-10-04 7374617475733a206f70656e
decision: 2026-10-04 Apply README and SPEC reconciliation — Change the server/tools/README.md visible-metadata example to `* Status: Active` / `* Last verified: 2026-09-20`, and record in the binding SPEC that canonical `* ` bullets round-trip byte-identically while `- ` input lints clean (Story 1.10 AC5 interpretation). No code change.
decision: 2026-10-04 Apply README and SPEC reconciliation — Change the server/tools/README.md visible-metadata example to `* Status: Active` / `* Last verified: 2026-09-20`, and record in the binding SPEC that canonical `* ` bullets round-trip byte-identically while `- ` input lints clean (Story 1.10 AC5 interpretation). No code change.

### DW-8: The lint-repair-relint loop needs repair knowledge that Findings do not carry: a missing metadata field value or a missing configured global index is not identified by the AD-12 Finding.
origin: spec-deferred 656e36dfb1ba
location: server/wikiLint/core/registry.ts (issue messages); server/wikiLint/core/graphRules.ts (globalIndexLinks emit); Architecture Spine AD-12
source_spec: `spec-1-10-accept-the-complete-read-only-lint-and-repair-loop.md`
severity: medium
reason: Story 1.10's acceptance loop (server/routes/mcp/wikiLint.test.ts, "repair loop") reaches a Clean Result only because the test agent is given the collection's documented conventions (field values, global index id); the Finding is fixed to {code, severity, message, location} with a generic registry message. This is the pre-existing DW-2/DW-3 gap (deferred-work ledger), now observed at the accepted MCP surface; settling it needs an architecture decision on readability-gated detail.
status: done 2026-10-04
resolution: already resolved: Story 2.0 (commit 1cac931a9): server/routes/mcp/wikiLint.test.ts:2113-2170 repairFromDetail repairs sections, metadata fields and global-index links from Finding.detail alone, without supplied conventions; field values stay undisclosed by the approved AD-12 amendment (2e50ee933)

### DW-9: Enforced writes that end in AD-20 rows 3, 5, or 7 leave no operator log; only post-commit callback failures are logged.
origin: spec-deferred 74f952c7d695
location: server/wikiLint/application/enforcedWrite.ts:369-497
source_spec: `spec-2-3-enforce-markdown-creates-and-updates-atomically.md`
severity: medium
reason: runAttempt maps every non-application failure to OPERATION_FAILED through abortMessage and logs nothing, and row 7 (a COMMIT whose outcome cannot be established, which the hang fixture shows can still land) is not logged either. An operator investigating a failed enforced write has no requestId/invocationId-correlated trace. This is the same gap as Epic 1 retrospective action item 9 (F-6: log unmodellable lint failures with invocationId and error class only), which the project deferred to Epic 3 hardening; Story 2.7 adds summaries for rows 3, 4, 5, and 6 but none for row 7.
status: done 2026-10-04
resolution: resolved by sweep bundle dw-enforced-write-operator-log
resolution-undo: 6ac2b654ba4e9b32525413cad07d1ce761e4b23a2494ef02c82ec9a4e41969d1 2026-10-04 7374617475733a206f70656e

### DW-10: An enforced HTML create persists the imported Y.js state, built before the Markdown round trip, while validation runs on the content re-parsed from that Markdown, so editor-visible state could hold
origin: spec-deferred 25158c5d6970
location: server/wikiLint/adapters/documentProjection.ts (prepareHtmlCreate)
source_spec: `spec-2-5-carry-enforced-html-projection-through-a-distinct-trusted-wo.md`
reason: The baseline DocumentImportTask persists the same text/state split, and the projection parity tests prove the enforced path matches it (documentProjection.test.ts "HTML creates"). Unverified: whether any DocumentConverter output loses lint-relevant structure (headings, metadata lines, links, discouraged structures) in serializer.serialize -> toProsemirror. Settle it with a fixture sweep across the converter's node and mark coverage that compares yDocToProsemirrorJSON(state) with the validated content. If lint-relevant divergence exists, an architecture decision is needed between failing closed and deriving state from the validated content (the latter departs from exact baseline semantics).
status: done 2026-10-04
resolution: resolved by sweep bundle dw-html-create-state-content-parity
resolution-undo: 59058bad43d47ff45aa438e74a8d3e893357c52a6f19a952b461ef2766173784 2026-10-04 7374617475733a206f70656e

### DW-11: Decide how a Finding identifies the missing configured item (e.g. readability-gated detail) and amend AD-12 before Story 2.1 starts; then re-run the Story 1.10 repair loop without supplied conventions (DW-2, DW-3, DW-8).
origin: retro action item epic-1-retro-item-1-decide-how-a-finding-identifies-the-miss
location: n/a
source_spec: `_bmad-output/implementation-artifacts/epic-1-retro-2026-10-03.md`
severity: low
reason: retrospective action item from sprint-status.yaml (epic 1; owner Operator with the architect; sprint-status status open)
status: done 2026-10-04
resolution: already resolved: Decided and applied before Story 2.1: AD-12 readability-gated detail amendment commit 2e50ee933, Story 2.0 commit 8446bbe4d/1cac931a9, and the conventions-free repair loop at server/routes/mcp/wikiLint.test.ts:2113 (repairFromDetail)

### DW-12: Change the README visible-metadata example to `* ` bullets and record the AC5 interpretation in the binding SPEC (DW-7).
origin: retro action item epic-1-retro-item-2-change-the-readme-visible-metadata-examp
location: n/a
source_spec: `_bmad-output/implementation-artifacts/epic-1-retro-2026-10-03.md`
severity: low
reason: retrospective action item from sprint-status.yaml (epic 1; owner Operator; sprint-status status open)
status: done 2026-10-04
resolution: resolved by DW-7 (commit 72e8f2ea6b4e346823f3def86965342b5aa159c4, closed by sweep commit dbc504b2c81b7c28a3bfd5e66188d39343960510); verified at HEAD in spec-dw-12-readme-metadata-bullets-and-spec-ac5.md. Closed by hand: a bundle with no change left cannot pass the sweep proof-of-work gate
decision: 2026-10-04 Apply README and SPEC reconciliation — Change the server/tools/README.md visible-metadata example to `* ` bullets and add the Story 1.10 AC5 interpretation (canonical `* ` round-trips byte-identically; `- ` input lints clean) to the binding SPEC. Close DW-7 with the same change.
decision: 2026-10-04 Apply README and SPEC reconciliation — Change the server/tools/README.md visible-metadata example to `* ` bullets and add the Story 1.10 AC5 interpretation (canonical `* ` round-trips byte-identically; `- ` input lints clean) to the binding SPEC. Close DW-7 with the same change.

### DW-13: In readWikiSnapshot, re-check collection read inside the snapshot for a collection scope and fail generically when it no longer holds; add a documents-only regression test (F-5).
origin: retro action item epic-1-retro-item-3-in-readwikisnapshot-re-check-collection
location: n/a
source_spec: `_bmad-output/implementation-artifacts/epic-1-retro-2026-10-03.md`
severity: low
reason: retrospective action item from sprint-status.yaml (epic 1; owner Dev agent; sprint-status status open)
status: open

### DW-14: Record in the Gate 1 plan (Story 3.4) that no read-only production rollout happens before Story 3.3 closes DW-4, DW-5 and DW-6.
origin: retro action item epic-1-retro-item-4-record-in-the-gate-1-plan-story-3-4-that
location: n/a
source_spec: `_bmad-output/implementation-artifacts/epic-1-retro-2026-10-03.md`
severity: low
reason: retrospective action item from sprint-status.yaml (epic 1; owner Operator; sprint-status status open)
status: done 2026-10-04
resolution: resolved by sweep bundle dw-decision-dw-14
resolution-undo: 58b6aa863dad7dbac330682a693d175eaf44eba12b69a32ff9e4b9fc0439c6bc 2026-10-04 7374617475733a206f70656e
decision: 2026-10-04 Amend Story 3.4 ACs now — Add an acceptance criterion to Story 3.4 in _bmad-output/planning-artifacts/epics.md: the Gate 1 decision record states that no read-only production rollout is authorized until Story 3.3 evidence closes DW-4, DW-5 and DW-6 (event-loop blocking, CPU between deadline checks, pool-wait acquisition). Planning-artifact edit only.
decision: 2026-10-04 Amend Story 3.4 ACs now — Add an acceptance criterion to Story 3.4 in _bmad-output/planning-artifacts/epics.md: the Gate 1 decision record states that no read-only production rollout is authorized until Story 3.3 evidence closes DW-4, DW-5 and DW-6 (event-loop blocking, CPU between deadline checks, pool-wait acquisition). Planning-artifact edit only.

### DW-15: Encode deferrals of the form needs-a-decision-before-Story-X as blockers on Story X in sprint-status or story preconditions.
origin: retro action item epic-1-retro-item-5-encode-deferrals-of-the-form-needs-a-dec
location: n/a
source_spec: `_bmad-output/implementation-artifacts/epic-1-retro-2026-10-03.md`
severity: low
reason: retrospective action item from sprint-status.yaml (epic 1; owner Operator; sprint-status status open)
status: done 2026-10-04
resolution: resolved by sweep bundle dw-decision-dw-15
resolution-undo: 0905d362f1081134af4d3a19897bbf8926877a30bba884b801d65ea4a147790d 2026-10-04 7374617475733a206f70656e
decision: 2026-10-04 Add a preconditions convention to epics.md — Add a short 'Story preconditions' convention to the header of _bmad-output/planning-artifacts/epics.md stating that a deferral requiring a decision before Story X is recorded as a named precondition on Story X, and record the currently known preconditions (e.g. Story 3.4 on DW-4..DW-6). Planning-artifact edit only; no sprint-status or tooling change.
decision: 2026-10-04 Add a preconditions convention to epics.md — Add a short 'Story preconditions' convention to the header of _bmad-output/planning-artifacts/epics.md stating that a deferral requiring a decision before Story X is recorded as a named precondition on Story X, and record the currently known preconditions (e.g. Story 3.4 on DW-4..DW-6). Planning-artifact edit only; no sprint-status or tooling change.

### DW-16: Split Epic 2 stories flagged oversized, or raise the per-story token cap deliberately; all ten Epic 1 stories exceeded it.
origin: retro action item epic-1-retro-item-6-split-epic-2-stories-flagged-oversized-o
location: n/a
source_spec: `_bmad-output/implementation-artifacts/epic-1-retro-2026-10-03.md`
severity: low
reason: retrospective action item from sprint-status.yaml (epic 1; owner Operator; sprint-status status open)
status: done 2026-10-04
resolution: already resolved: Commit c132ab9a7: .bmad-loop/policy.template.toml:58 max_tokens_per_story = 10000000 raises the per-story cap deliberately with the Epic 1 rationale (header lines 32-34); live .bmad-loop/policy.toml:20 matches

### DW-17: Choose an independent review model for the atomicity-critical Epic 2 stories (2.3, 2.5, 2.6).
origin: retro action item epic-1-retro-item-7-choose-an-independent-review-model-for-t
location: n/a
source_spec: `_bmad-output/implementation-artifacts/epic-1-retro-2026-10-03.md`
severity: low
reason: retrospective action item from sprint-status.yaml (epic 1; owner Operator; sprint-status status open)
status: done 2026-10-04
resolution: already resolved: Commit c132ab9a7: .bmad-loop/policy.template.toml:95 review trigger = "always" and :143-147 [adapter.review] name = "codex" (a different model family reviews every story, including 2.6)

### DW-18: Sync tracking: set epic-1 to done (script has no flag for it) and write the AC5 and Code Map deviations into Story 1.10 Spec Change Log.
origin: retro action item epic-1-retro-item-8-sync-tracking-set-epic-1-to-done-script
location: n/a
source_spec: `_bmad-output/implementation-artifacts/epic-1-retro-2026-10-03.md`
severity: low
reason: retrospective action item from sprint-status.yaml (epic 1; owner Operator; sprint-status status open)
status: done 2026-10-04
resolution: resolved by sweep bundle dw-story-1-10-spec-change-log
resolution-undo: b3cf22e4f7e5a9265278bd5f2a35aa9d2eadfb5f252acc93ae4c26b39a141d3c 2026-10-04 7374617475733a206f70656e
decision: 2026-10-04 Backfill Story 1.10 Spec Change Log — Append dated entries to the Spec Change Log of _bmad-output/implementation-artifacts/spec-1-10-accept-the-complete-read-only-lint-and-repair-loop.md recording the AC5 bullet-marker interpretation and the stale Code Map statements (buildDocument/structure, rule-kind list), citing the Auto Run Result. Do not edit sprint-status.yaml; the operator sets epic-1 done with the sprint tooling.
decision: 2026-10-04 Backfill Story 1.10 Spec Change Log — Append dated entries to the Spec Change Log of _bmad-output/implementation-artifacts/spec-1-10-accept-the-complete-read-only-lint-and-repair-loop.md recording the AC5 bullet-marker interpretation and the stale Code Map statements (buildDocument/structure, rule-kind list), citing the Auto Run Result. Do not edit sprint-status.yaml; the operator sets epic-1 done with the sprint tooling.

### DW-19: Log unmodellable lint failures with invocationId and error class only (F-6); defer to Epic 3 hardening.
origin: retro action item epic-1-retro-item-9-log-unmodellable-lint-failures-with-invo
location: n/a
source_spec: `_bmad-output/implementation-artifacts/epic-1-retro-2026-10-03.md`
severity: low
reason: retrospective action item from sprint-status.yaml (epic 1; owner Dev agent; sprint-status status open)
status: done 2026-10-04
resolution: resolved by sweep bundle dw-read-surface-failure-logging
resolution-undo: 63b400bfd07bf01845c12d58858fa8e38e8e1e60ec66e59199f87fa182e6e07d 2026-10-04 7374617475733a206f70656e
decision: 2026-10-04 Build read-surface logging now — In the lint_document and lint_wiki shells (server/wikiLint/application/lintDocument.ts, lintWiki.ts, server/tools/wikiLint.ts), log each unmodellable failure that maps to the fixed message or a tool-execution error with only invocationId/requestId and the error class name, never message, stack, content or identifiers; add collocated tests asserting the exact log fields. Write-path rows are left to DW-9 after Story 2.7.
decision: 2026-10-04 Build read-surface logging now — In the lint_document and lint_wiki shells (server/wikiLint/application/lintDocument.ts, lintWiki.ts, server/tools/wikiLint.ts), log each unmodellable failure that maps to the fixed message or a tool-execution error with only invocationId/requestId and the error class name, never message, stack, content or identifiers; add collocated tests asserting the exact log fields. Write-path rows are left to DW-9 after Story 2.7.

### DW-20: Meter documentStructure before materializing it, or bound the column read (F-7); fold into Story 3.3.
origin: retro action item epic-1-retro-item-10-meter-documentstructure-before-materiali
location: n/a
source_spec: `_bmad-output/implementation-artifacts/epic-1-retro-2026-10-03.md`
severity: low
reason: retrospective action item from sprint-status.yaml (epic 1; owner Dev agent; sprint-status status open)
status: open

### DW-21: Documents created by the baseline DocumentImportTask (REST imports, or imports made before a collection had a policy) keep a converter state that can hold structure their content lost, so
origin: spec-deferred 689f0b395a0b
location: server/queues/tasks/DocumentImportTask.ts:97-120
source_spec: `spec-dw-10-html-create-state-content-parity.md`
severity: medium
reason: DocumentImportTask.ts:97-120 still persists the converter `state` beside `content` parsed again from `text`. DocumentHelper.toProsemirror (DocumentHelper.tsx:86-104) prefers `content`, so the read-only lint tools never see the state. Class A in this spec's Design Notes shows a nested notice that is present in the state and absent from the content. This change fixes only the enforced MCP HTML create; the baseline split predates it.
status: open
decision: 2026-10-04 Keep open as a Gate 1 residual

### DW-22: A metadata one_of policy can validate a linked inline image value that loses its link when Y.js builds the editor state from content.
origin: spec-deferred e0367ea24a48
location: server/wikiLint/adapters/documentProjection.test.ts:1557; server/wikiLint/core/documentRules.ts:270-285
source_spec: `spec-dw-10-html-create-state-content-parity.md`
severity: medium
reason: The class B metadata fixture in documentProjection.test.ts shows that the linked image is present in validated content but loses its link in the derived Y.js document. metadataFieldFormats in documentRules.ts compares the field value to configured one_of values. This Y.js conversion also occurs for Markdown creates and predates DW-10; the accepted Decision explicitly retains that behavior.
status: open
decision: 2026-10-04 Keep open as a Gate 1 residual

### DW-23: server/tools/README.md does not tell authors that their own `- ` bullets are stored and fetched as `* `, so a patch findText written from their input instead of the fetched Markdown still misses.
origin: spec-deferred eb7b895ea0db
location: server/tools/README.md:119-140
source_spec: `spec-dw-7-readme-metadata-canonical-bullet-marker.md`
severity: low
reason: Patch findText is an indexOf over serializeWithPositions output (DocumentHelper.tsx:668-683), and BulletList.toMarkdown always writes `* `. DW-7 fixes only the copied example; metadata an agent writes itself with `- ` behaves as before. Pre-existing, not caused by this change, and outside the 2026-10-04 decision, which covers the example and the SPEC record.
status: done 2026-10-04
resolution: closed by human decision: update_document's findText description (server/tools/documents.ts:1049) already requires copying from existing Markdown, and the README example shows canonical `* ` bullets
decision: 2026-10-04 Close: the tool description already covers it — update_document's findText description (server/tools/documents.ts:1049) already requires copying from existing Markdown, and the README example shows canonical `* ` bullets

### DW-24: Decide the unavailable-probe rule for the HTML worker finish/first lookup and requester (spine analogue: row 7, source retained), record it in the Story 2.5 contract and spine, then implement with tests that fail finish probe (F-1).
origin: retro action item epic-2-retro-item-11-decide-the-unavailable-probe-rule-for-th
location: n/a
source_spec: `_bmad-output/implementation-artifacts/epic-2-retro-2026-10-04.md`
severity: low
reason: retrospective action item from sprint-status.yaml (epic 2; owner Operator with the architect, then Dev agent; sprint-status status open)
status: done 2026-10-04
resolution: resolved by sweep bundle dw-html-worker-commit-detection-rules
resolution-undo: caab443ce1ce16cfb94760b90a68e2456134656cd7d153e1ae1966a4453445c5 2026-10-04 7374617475733a206f70656e

### DW-25: Restore the Story 2.5 spec (with its blocked follow-up review) from .bmad-loop/archive/20261003-130833-8009 and run one completed independent review of the 2.5 code (F-2).
origin: retro action item epic-2-retro-item-12-restore-the-story-2-5-spec-with-its-bloc
location: n/a
source_spec: `_bmad-output/implementation-artifacts/epic-2-retro-2026-10-04.md`
severity: low
reason: retrospective action item from sprint-status.yaml (epic 2; owner Operator; sprint-status status open)
status: open
decision: 2026-10-04 Keep open for the Gate 1 review

### DW-26: Reserve COMMIT_PROBE_BOUND_MS out of the COMMIT timeout in runAttempt so a commit timeout can still probe; add a commit-timeout test (F-6).
origin: retro action item epic-2-retro-item-13-reserve-commit_probe_bound_ms-out-of-the
location: n/a
source_spec: `_bmad-output/implementation-artifacts/epic-2-retro-2026-10-04.md`
severity: low
reason: retrospective action item from sprint-status.yaml (epic 2; owner Dev agent; sprint-status status open)
status: done 2026-10-04
resolution: resolved by sweep bundle dw-commit-timer-probe-reserve
resolution-undo: ba069c1faf00d707aa94650750c27422aa94ccb5a1e6fdcb182cd39593da5ac3 2026-10-04 7374617475733a206f70656e

### DW-27: Close staged-blob leaks: delete a late-landing requester source and the media blob when Attachment validation fails (F-7).
origin: retro action item epic-2-retro-item-14-close-staged-blob-leaks-delete-a-late-la
location: n/a
source_spec: `_bmad-output/implementation-artifacts/epic-2-retro-2026-10-04.md`
severity: low
reason: retrospective action item from sprint-status.yaml (epic 2; owner Dev agent; sprint-status status open)
status: done 2026-10-04
resolution: resolved by sweep bundle dw-media-blob-validation-leak
resolution-undo: f9fd9ffc6dc57559d0ff10951f1473daf9cfeeae47fbf7dc6a509f5c8de59231 2026-10-04 7374617475733a206f70656e

### DW-28: Add tests for worker row 2/4/5 committedFromSummary conversion and HTML-with-media failure rows and summaries (F-12).
origin: retro action item epic-2-retro-item-15-add-tests-for-worker-row-2-4-5-committed
location: n/a
source_spec: `_bmad-output/implementation-artifacts/epic-2-retro-2026-10-04.md`
severity: low
reason: retrospective action item from sprint-status.yaml (epic 2; owner Dev agent; sprint-status status open)
status: done 2026-10-04
resolution: resolved by sweep bundle dw-html-worker-conversion-tests
resolution-undo: 9cc8545294b60bea6ee5b0ef9ca0dbb8a504187490b866eab5d5ea96bef5289f 2026-10-04 7374617475733a206f70656e

### DW-29: Pin one reproducible broad verification command (--maxWorkers=2 or raised test PostgreSQL connection limit) for Epic 3 conformance evidence (F-13).
origin: retro action item epic-2-retro-item-16-pin-one-reproducible-broad-verification
location: n/a
source_spec: `_bmad-output/implementation-artifacts/epic-2-retro-2026-10-04.md`
severity: low
reason: retrospective action item from sprint-status.yaml (epic 2; owner Operator; sprint-status status open)
status: done 2026-10-04
resolution: built by the coordinator by hand: package.json script `test:wikilint` (server project, --maxWorkers=2) and the AGENTS.md 'Running and verifying' bullet
decision: 2026-10-04 Pin --maxWorkers=2 — Add a package.json script (e.g. test:server:conformance = TZ=UTC vitest run --project server --maxWorkers=2) and name it in CLAUDE.md and AGENTS.md 'Running and verifying' as the broad verification command for Epic 3 conformance evidence. Verify that it runs green once against scripts/test-db.sh ensure, and record the result.

### DW-30: Fold the worker post-commit tail and cross-host clock-skew budget into Story 3.3 constant-derivation evidence (F-8, F-9).
origin: retro action item epic-2-retro-item-17-fold-the-worker-post-commit-tail-and-cro
location: n/a
source_spec: `_bmad-output/implementation-artifacts/epic-2-retro-2026-10-04.md`
severity: low
reason: retrospective action item from sprint-status.yaml (epic 2; owner Dev agent; sprint-status status open)
status: open

### DW-31: Reconcile ARCHITECTURE-SPINE.md:118 with the HTML worker probe-established row 6: fix or record an accepted deviation (F-3).
origin: retro action item epic-2-retro-item-18-reconcile-architecture-spine-md-118-with
location: n/a
source_spec: `_bmad-output/implementation-artifacts/epic-2-retro-2026-10-04.md`
severity: low
reason: retrospective action item from sprint-status.yaml (epic 2; owner Operator with the architect; sprint-status status open)
status: done 2026-10-04
resolution: resolved by sweep bundle dw-html-worker-commit-detection-rules
resolution-undo: caab443ce1ce16cfb94760b90a68e2456134656cd7d153e1ae1966a4453445c5 2026-10-04 7374617475733a206f70656e

### DW-32: Never mark a loop-deferred story done by hand without moving its open review findings into deferred-work.md (F-2).
origin: retro action item epic-2-retro-item-19-never-mark-a-loop-deferred-story-done-by
location: n/a
source_spec: `_bmad-output/implementation-artifacts/epic-2-retro-2026-10-04.md`
severity: low
reason: retrospective action item from sprint-status.yaml (epic 2; owner Operator; sprint-status status open)
status: done 2026-10-04
resolution: built by the coordinator by hand: the rule is in AGENTS.md 'Known pitfalls' (CLAUDE.md links to it)
decision: 2026-10-04 Add it to CLAUDE.md/AGENTS.md pitfalls — Add one line to 'Known pitfalls' in CLAUDE.md and the matching AGENTS.md section: before setting a bmad-loop story done by hand, move every open finding from its review gates into _bmad-output/implementation-artifacts/deferred-work.md. No other change.

### DW-33: Sync tracking: set epic-2 (and epic-1) to done in sprint-status.yaml.
origin: retro action item epic-2-retro-item-20-sync-tracking-set-epic-2-and-epic-1-to-d
location: n/a
source_spec: `_bmad-output/implementation-artifacts/epic-2-retro-2026-10-04.md`
severity: low
reason: retrospective action item from sprint-status.yaml (epic 2; owner Operator; sprint-status status open)
status: done 2026-10-04
resolution: closed by the operator coordinator: epic-1 and epic-2 set to done in sprint-status.yaml by hand (the sprint tooling has no flag for it), as the DW-18 decision requires; a sweep bundle must not edit that file. Action item epic-2-retro-item-20 set done

### DW-34: The spine's 2026-10-04 Amendment Record row still describes D2 as a match on a "recorded intent/source fingerprint", contradicting AD-7 and the amendment's resolved D2 (title and text equality).
origin: spec-deferred 7983dbba7b29
location: _bmad-output/planning-artifacts/architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md:434
source_spec: `spec-dw-24-dw-31-html-worker-commit-detection-rules.md`
severity: low
reason: ARCHITECTURE-SPINE.md:434 says "the worker may report its own `validation` as row 6 after its commit-detection probe finds a row whose fingerprint equals its recorded intent/source fingerprint (AD-7)". AD-7 at :118 and amendment-proposal-unavailable-probe-rule.md D2 / Open Point 1 instead require the found row's title and `text` to equal the validated projection's. The implementation follows AD-7. The stale record row predates this change (commit 78f9c101f).
status: done 2026-10-04
resolution: fixed by the coordinator: ARCHITECTURE-SPINE.md Amendment Record row now says title and text equality, as AD-7 and the amendment do

### DW-35: The preallocated-ID conflict path can attribute a concurrent delivery's different row to this attempt without comparing its content.
origin: spec-deferred 480f0b2042f1
location: server/wikiLint/application/enforcedImport.ts:805
source_spec: `spec-dw-24-dw-31-html-worker-commit-detection-rules.md`
severity: medium
reason: This path predates DW-24/DW-31: enforcedImport.ts captures ownConflict on isPreallocatedIdConflict during persist and case 5 returns this attempt's validation and writes its summary. If another delivery inserted a different row after the in-transaction absence check, the conflict branch does not compare title and text. D2 applies only to probe-established row 6, so this is separate work.
status: open

### DW-36: The worker's found-row conversion is still untested on the finish() routes outside runAttempt's own row arms: the pre-attempt conflict and worker-time fingerprint mismatch (`finish(...pending)`) and
origin: spec-deferred cf0257a3ba09
location: server/wikiLint/application/enforcedImport.ts:656, server/wikiLint/application/enforcedImport.ts:832
source_spec: `spec-dw-28-html-worker-conversion-tests.md`
severity: medium
reason: `server/wikiLint/application/enforcedImport.ts:656` (`finish(...pending)` for the reauthorization conflict at :623-624 and the mismatch rejection at :633-638) and `:832` (`finish(...failure)`, `aborted(decided ? 5 : 3, ...)`). No test makes the pre-allocated row appear before either call: the row 3 test and the DW-28 row 2/4/5 tests reach `finish` only through `switch (outcome.row)` at :789-825. Replacing those calls with a direct `return` of the non-committed outcome keeps every test green. Spine :120 requires the lookup before every non-committed outcome (rows 2, 3, 4, 5). DW-28's intent counts coverage per row (it called row 3 covered by one route), so this is the pre-existing remainder of the same gap class, raised by the Blind Hunter, Edge Case Hunter and Intent Alignment layers.
status: open

### DW-37: LocalStorage.deleteFile hides unlink failures from MediaStager and logs the full path on failure.
origin: spec-deferred 34abd6e8fa93
location: server/storage/files/LocalStorage.ts:92
source_spec: `spec-dw-27-media-blob-validation-leak.md`
severity: medium
reason: LocalStorage.ts catches unlink errors, logs the file path and error, then resolves. MediaStager's deleteLate therefore cannot report that failure by Attachment ID. This adapter behavior predates DW-27 and also affects existing staged-media cleanup and late-landing deletion.
status: done 2026-10-04
resolution: closed by human decision: Accepted: baseline v1.10.1 LocalStorage behavior, left unchanged to preserve upstream callers; S3 deletion already reports failures
decision: 2026-10-04 Close as accepted baseline behavior — Accepted: baseline v1.10.1 LocalStorage behavior, left unchanged to preserve upstream callers; S3 deletion already reports failures

### DW-38: Enforced HTML create outcomes decided outside runAttempt (requester row 3 before queue.add, requester row 7, and the worker's pre-attempt and final-catch aborts) still leave no operator log.
origin: spec-deferred e4dc78f49ace
location: server/wikiLint/application/enforcedHtmlCreate.ts; server/wikiLint/application/enforcedImport.ts:420-423, :839-845
source_spec: `spec-dw-9-enforced-write-operator-log.md`
severity: low
reason: DW-9 logs only the rows that runAttempt's body returns. enforcedHtmlCreate.ts has no Logger call for its own row 3 before scheduling or for row 7 when the worker returns nothing, a queue.add error, or an unavailable requester probe. enforcedImport.ts returns aborted for an unparseable intent and for its final catch (aborted(decided ? 5 : 3, ...)) without logging. The worker can also turn a logged attempt row 3 or 5 into committed or unestablished after its repeated lookup, so the logged row can differ from the row the client sees. These gaps existed before DW-9; the bundle intent scopes the fix to enforcedWrite.ts.
status: open

### DW-39: Story 3.3 has no acceptance criterion that produces the evidence Story 3.4 criterion 8 needs to close DW-4, DW-5 or DW-6.
origin: spec-deferred c84c517a00f9
location: _bmad-output/planning-artifacts/epics.md:1575-1634 (Story 3.3)
source_spec: `spec-dw-14-gate-1-read-only-rollout-precondition.md`
severity: medium
reason: Story 3.3 criteria 3, 5 and 7 measure lint_wiki call latency, atomic-unit time, result-assembly time and single SET LOCAL statement durations. None measures how long synchronous evaluation blocks the event loop (DW-4), or the serialize/parse CPU time of a keyset batch between deadline checks (DW-5). Criterion 2 forbids competing traffic, and criterion 7's re-run list has no held-pool case, so no Story 3.3 evidence exercises pool-wait acquisition (DW-6). DW-6 was resolved in code by b732efe0f2c58494558327776719fcaa122f2350 after the DW-14 decision was recorded in 495d11015982b164311f1f97072d7a7cdd526c7b. So the Gate 1 record will list DW-6 as not closed by Story 3.3 evidence while the ledger marks it done. Two ways to settle this, and the operator has to choose: amend Story 3.3 to add the DW-4 and DW-5 measurements and a held-pool fixture re-run under the AD-17-fixed floor, or revisit which evidence may close DW-6. The gap predates this change. This change follows the "Amend Story 3.4
status: done 2026-10-04
resolution: decided and applied by the coordinator under delegated authority: Story 3.3 gained criterion 9 (event-loop block and per-batch CPU measurements against the fixed AD-11 stop margin, plus a held-pool fixture re-run apart from the timed samples), which Story 3.4 criterion 8 links

### DW-40: The Story preconditions convention is prose only: nothing adds a Story X precondition when a decision-before-Story-X deferral is recorded, and nothing mechanically stops a run at an unmet
origin: spec-deferred 22d16b897b35
location: _bmad-output/planning-artifacts/epics.md (Overview, Story preconditions)
source_spec: `spec-dw-15-story-preconditions-convention.md`
severity: medium
reason: The human decision for DW-15 excludes sprint-status and tooling changes. bmad-loop dispatches from sprint-status.yaml, where Stories 3.3 and 3.4 are plain backlog. Ledger entries are written by the orchestrator, and no step adds the matching Preconditions item to epics.md, so F-1 (epic-1-retro-2026-10-03.md) can recur for a future deferral unless the operator, owner of Epic 1 retrospective action item 5, adds it. A run obeys a block only if it reads the story text; the compiled epic context has "No story-level details" (compile-epic-context.md). This change's verification proves the text only, not that any consumer obeys it.
status: open
decision: 2026-10-04 Add an AGENTS.md/CLAUDE.md pitfall — Add one Known pitfalls line to AGENTS.md and CLAUDE.md: when a deferral needs a decision before Story X, add the Preconditions item to Story X in epics.md and ask the orchestrator to add a gate: line on the ledger entry, because ledger prose alone does not stop a run. No tooling or sprint-status change.

### DW-41: Ledger work folded into Stories 3.3 and 3.4 (DW-20, DW-30) and their Gate 1 dispositions (DW-21, DW-25) do not appear in those stories' text.
origin: spec-deferred 7ec70511a749
location: _bmad-output/planning-artifacts/epics.md (Stories 3.3 and 3.4)
source_spec: `spec-dw-15-story-preconditions-convention.md`
severity: medium
reason: DW-20 ("Meter documentStructure before materializing it ...; fold into Story 3.3") and DW-30 (worker post-commit tail and cross-host clock-skew budget into Story 3.3 constant-derivation evidence) are open, and Story 3.3's criteria mention neither. DW-21 carries the decision "Keep open as a Gate 1 residual" but is missing from Story 3.4 criterion 5's residual list, and DW-25 ("Keep open for the Gate 1 review") appears nowhere in Story 3.4. These are not decision-before-Story-X deferrals, so the DW-15 convention does not record them. A run that builds Story 3.3 or 3.4 from the story text would still miss them, the same ledger-prose-only cause as F-1. Pre-existing.
status: open

### DW-42: DW-29's decided work, a pinned broad verification command for Epic 3 conformance evidence, does not reach Story 3.2's text, so Story 3.2 can run before the command exists.
origin: spec-deferred 08c97a006686
location: _bmad-output/planning-artifacts/epics.md (Story 3.2)
source_spec: `spec-dw-15-story-preconditions-convention.md`
severity: medium
reason: DW-29 is open and carries "decision: 2026-10-04 Pin --maxWorkers=2 — Add a package.json script ... and name it in CLAUDE.md and AGENTS.md 'Running and verifying' as the broad verification command for Epic 3 conformance evidence". Story 3.2 produces that conformance evidence, and `grep maxWorkers _bmad-output/planning-artifacts/epics.md` finds nothing. The decision is already recorded, so this is decided work, not a decision-before-Story-X deferral, and the DW-15 convention does not record it. It is the same ledger-prose-only cause as the Stories 3.3/3.4 item above. Pre-existing.
status: done 2026-10-04
resolution: applied by the coordinator: Story 3.2 criterion 1 names `yarn test:wikilint` as the retained broad verification command; the command exists (DW-29)

### DW-43: bmad-loop's ledger `gate:` field would pause dispatch of Stories 3-3 and 3-4 until DW-39 closes, but DW-39 has no `gate:` line, and this bundle may not edit the ledger.
origin: spec-deferred fb756e40b655
location: _bmad-output/implementation-artifacts/deferred-work.md (DW-39)
source_spec: `spec-dw-15-story-preconditions-convention.md`
severity: medium
reason: The installed bmad-loop engine.py `_refuse_gated_story` raises the PAUSE_STORY_GATE pause instead of dispatching a story that an unlanded ledger entry gates. It re-reads the ledger on every pick, and `bmad-loop validate` refuses the same story at preflight. No entry in deferred-work.md has a `gate:` line today. The DW-15 intent forbids ledger edits in this session. Adding a gate on DW-39 for Stories 3.3 and 3.4 through the orchestrator's sanctioned path would give the Story preconditions convention a mechanical stop. The gate releases only on `status: done`, which is stricter than the convention's settled-decision test.
status: done 2026-10-04
resolution: moot: DW-39 is decided and applied (Story 3.3 criterion 9), so no `gate:` line is needed to pause Stories 3-3 and 3-4

### DW-44: The `publishedIn` JSDoc in the in-memory lint suite still says the built document "is not added to the collection structure", the same false claim the Story 1.10 Code Map carried.
origin: spec-deferred 486d2a195a41
location: server/tools/wikiLint.test.ts:2374
source_spec: `spec-dw-18-story-1-10-spec-change-log.md`
severity: low
reason: server/tools/wikiLint.test.ts:2374 reads "@returns the document, which is not added to the collection structure". publishedIn calls buildDocument with a collectionId, so the document is published (server/test/factories.ts:412) and the @AfterCreate hook addDocumentToCollectionStructure adds it to the structure (server/models/Document.ts:520-539). DW-18 forbids code changes, so the comment stays as is; the Story 1.10 Spec Change Log entry records the corrected fact.
status: open

### DW-45: Story 3.1 could not document WIKI_LINT_EXPECTED_CONFIG_FINGERPRINT in `.env.sample` (clause S8): the file was outside the story's writable scopes, so the operator added the block by hand.
origin: operator decision 2026-10-17 (coordinator inbox decision for Story 3.1, request 9ca80e17)
location: .env.sample:51
source_spec: `spec-3-1-verify-safe-startup-and-readiness-policy-identity.md`
severity: low
reason: The spec's task "`.env.sample` -- document WIKI_LINT_EXPECTED_CONFIG_FINGERPRINT" and Always-clause S8 needed an edit outside the writable scopes granted at story add (server/wikiLint/, server/index.ts, server/index.test.ts, server/main.ts, server/routes/mcp/, server/tools/, server/utils/). The worker reported the conflict instead of writing outside its scope; the operator deferred the edit to a hand change on the working branch and the story finished without it. The block states when the variable is required, the byte-for-byte sha256 form, the 503 and HEALTHCHECK consequence (AD-19) and the mount-change-and-restart rule.
status: done 2026-10-17
resolution: resolved by the operator's hand edit of .env.sample in the commit that adds this entry

### DW-46: The Story 3.2 COMMIT-outcome test is not deterministic under `yarn test:wikilint`: another worker's `LOCK TABLE documents IN ACCESS EXCLUSIVE MODE` queues the COMMIT probe past its bound.
origin: Story 3.2 implementation review 3 (assignment f42b9892), findings /findings/0 (critical) and /findings/4 (medium); root cause reproduced by the coordinator 2026-10-24
location: server/wikiLint/adapters/documentReader.test.ts:933-960
source_spec: `spec-dw-46-shared-table-lock-test-isolation.md`
severity: high
reason: Retained run 1 of Story 3.2 failed `enforcedWrite.concurrency.test.ts > COMMIT outcomes > ends in row 7 when COMMIT hangs past its timer ...` at `:713` (`probeRows` undefined: the probe returned `unavailable`), while runs 2 and 3 passed, so AC 3 and S14 (identical runs) could not hold. Cause: `documentReader.test.ts` "times out behind an exclusive lock held by another transaction" sends `LOCK TABLE documents IN ACCESS EXCLUSIVE MODE` on the database shared by both Vitest workers. When it lands while the other worker holds an uncommitted enforcement transaction, the LOCK waits behind that transaction and the probe's `SELECT id FROM documents WHERE id = :id` waits behind the LOCK, past `COMMIT_PROBE_BOUND_MS`. Reproduced 2026-10-24: COMMIT tests alone 5/5 pass, under 48 busy CPU loops 6/6 pass, with the lock test looping in a second process the same test fails with "expected undefined to deeply equal []". A test-isolation defect, not a product defect: production takes no ACCESS EXCLUSIVE lock on `documents` outside migrations. Operator decision 2026-10-24: fix it as its own bugfix before Story 3.2 runs again; Story 3.2 lists this entry as a precondition, met only at `status: done`.
status: done 2026-10-24
resolution: story dw-46-shared-table-lock-test-isolation (feature fdfe295e, reviewed and accepted by the coordinator, fast-forwarded at 6b98faa89): the lock-timeout test takes its lock with NOWAIT and a bounded retry, so it never queues another worker's reads. Coordinator verification 2026-10-24 found a residual: while the granted lock is held (~800 ms) a second worker's enforced write with a short lock_timeout still fails (row 6 test returned row 5, 1 of 10 runs with the lock test looping). Determinism is carried by DW-47.

### DW-47: While the lock-timeout test holds ACCESS EXCLUSIVE on the shared `documents` table, timing-engineered tests in the other `yarn test:wikilint` worker can still time out.
origin: coordinator verification of DW-46, 2026-10-24
location: server/test/setup.ts; server/wikiLint/adapters/documentReader.test.ts ("database timeouts")
source_spec: `spec-dw-47-exclusive-database-test-mutex.md`
severity: high
reason: After DW-46 the lock is never queued, but once granted it is held for the two 400 ms reads. A test in the other worker that is mid-way through an enforced write with an engineered short lock_timeout then fails: with the lock test looping in a second process, `enforcedWrite.concurrency.test.ts > COMMIT outcomes > ends in row 6 with its callbacks when COMMIT lands but its reply outlives the timer` returned row 5 in 1 of 10 runs ("expected 5 to be 6"). Operator decision 2026-10-24: a cross-worker mutex in the server test setup (the real-lock test runs exclusive of every other server database test, and the wait happens before a test starts, never inside it). Story 3.2 lists this entry as a precondition, met only at `status: done`.
status: done 2026-10-24
resolution: story dw-47-exclusive-database-test-mutex (feature acb24222), finished attended by the coordinator after a critical-finding stop: server/test/databaseMutex.ts holds a session advisory lock shared per test file from setup.ts and gives the real-lock test an exclusive section. Coordinator stress run: COMMIT-outcome tests 10/10 with the real-lock test looping (11 runs). Repair of the queue test and the two deferred low findings are recorded in the story spec's Review Triage Log.

### DW-48: `withExclusiveDatabase` ignores the result of `pg_advisory_unlock`, and an unlock error replaces the section's own error.
origin: DW-47 implementation review a00aafe5, low finding
location: server/test/databaseMutex.ts (withExclusiveDatabase, inner finally)
source_spec: `spec-dw-47-exclusive-database-test-mutex.md`
severity: low
reason: If the unlock returns false or throws, the session keeps the exclusive lock until the file's afterAll closes the client, so other workers stall for the rest of that file, and a section error can be masked by the unlock error. Test infrastructure only; the file end always releases the session.
status: open

### DW-49: No test asserts that the setup file's shared hold is released only after the test file's own afterAll hooks.
origin: DW-47 implementation review a00aafe5, low finding
location: server/test/databaseMutex.test.ts; server/test/setup.ts
source_spec: `spec-dw-47-exclusive-database-test-mutex.md`
severity: low
reason: The ordering relies on Vitest's default `sequence.hooks: 'stack'` (verified for Vitest 4.1.10); a change of that setting or of the setup hook would go unnoticed except through indirect timing failures.
status: open

### DW-50: An unexplained 5-second database stall failed one coordinator verify run of `yarn test:wikilint` during Story 3.2.
origin: coordinator observation, Story 3.2 (key 3-2-…-r2) verify of attempt commit 867f96b9825b, 2026-10-24
location: server/queues/tasks/DocumentPublishedNotificationsTask.test.ts; server/wikiLint/adapters/auditEvents.test.ts
source_spec: `spec-3-2-close-layered-conformance-and-source-provenance-evidence-r2.md`
severity: medium
reason: The verify receipt (`.git/coordinator/story/9f98b154-3c68-4a16-b63c-6bb5a079078c/verify-c3cbee64-…-89c23d8b2a628022.json`) records 8 failures in two files that Story 3.2 did not change: seven tests timed out at 5000 ms on ordinary fixture writes (`buildUser`, `buildRow`), and one counted a notification leaked from a timed-out test. The same source passed every other full run: the worker's six retained or voided runs and five coordinator runs afterwards, all 2279 passed and 1 expected skip. The two files ran in the two workers at once, so the stall looks database-wide, but no lingering session or advisory lock was present afterwards and a lock sampler was not running when it happened. Not reproduced; frequency observed 1 in 12 full runs. Needs a reproduction (run the suite in a loop with a working pg_stat_activity/pg_blocking_pids sampler) before Gate 1 can rely on determinism of the whole suite. Lead (coordinator lock sampler during the Story 3.2 runs of 2026-10-24, 10:08–10:40Z): besides the expected advisory-lock waits of the DW-47 mutex, PostgreSQL backends waited 1.2–6.2 s on WAL I/O (`WALSync`, `WALWrite`, `DataFileRead`) during autovacuum of `documents`, `users` and a TOAST table. A WAL fsync stall of that length on this WSL2 host is enough to push an ordinary fixture write past Vitest's 5000 ms test timeout; candidate fix in the test-database setup (for example `synchronous_commit=off` or `fsync=off` for the throwaway test cluster), to be decided and verified separately.
resolution: Reproduction loop of 2026-10-24 (coordinator sampler of pg_stat_activity, /proc/diskstats and /proc/pressure/io every 500 ms): on the aged 1.27 GB test database, 12 runs gave 10 passes, 2 DW-54 failures, 265-370 s per run and autovacuum waits on WALSync/WALWrite/DataFileRead up to 4.8 s; on a fresh database, 12 runs gave 12 passes, 177-203 s and no wait above 1 s. The 5-second client stall itself was not reproduced, so its cause is an inference from the mechanism, and the fix is a mitigation of that mechanism rather than a proven fix of the stall. Mitigated by `scripts/test-db.sh reset` (story dw-50-fresh-test-database, accepted commit 91fd1a53b, review 22644bdd), and AGENTS.md now starts broad and evidence runs from it. The aged database is kept as `outline-test-aged-20261024` until the operator drops it.
status: done 2026-10-25

### DW-51: The Gate 1 evidence index and decision record predate Story 3.2, and the Story 3.2 evidence still lists AC 4 and AC 7 as gaps that are now settled.
origin: operator request 2026-10-24 after Story 3.2 (key 3-2-…-r2) reached done
location: docs/wikilint-gate-1/evidence-index.md; docs/wikilint-gate-1/decision-record.md; docs/wikilint-gate-1/coverage.md; docs/wikilint-gate-1/conformance.md
source_spec: `spec-dw-51-reassemble-gate-1-evidence.md`
severity: medium
reason: Story 3.4's record says it is re-assembled after Story 3.2; it still marks every Story 3.2 deliverable as a gap. AC 4 and AD-18 were gaps only for three seams that the operator admitted into AD-18 on 2026-10-24 (ten kinds). AC 7 was a gap because `corepack yarn build` failed in the story worktree; the failure came from a stray `node_modules/node_modules` symlink that a coordinator setup step had created in the main checkout, and after its removal the build exited 0 in the main checkout at 2026-10-24T12:04:00Z on HEAD 5308b7edf.
status: done 2026-10-24
resolution: story dw-51-reassemble-gate-1-evidence (feature da3d83fb), reviewed and accepted by the coordinator, fast-forwarded at 81c12b570. The recomputed Gate 1 decision stays `not ready` with 16 blocking rows (NFR-1–5, SM-I2, SM-I5, G1-SM-I, G1-BLOCKING-DECISIONS, AD-17, the three D-9 constants, DW-4, DW-5, DW-6). Two low review findings are DW-52 and DW-53.

### DW-52: The AC 7 paragraph in `conformance.md` cites a `git diff --stat` between the retained freeze and the build commit with no retained output.
origin: DW-51 implementation review 95a65e25, low finding
location: docs/wikilint-gate-1/conformance.md:125
source_spec: `spec-dw-51-reassemble-gate-1-evidence.md`
severity: low
reason: The claim that only the four test files and `urlSanitization.test.ts` differ between `92eed955f` and `5308b7edf` is true by construction of the commits but has no retained raw output; retain the command's output or drop the sentence.
status: open

### DW-53: `gate1EvidenceIndex.test.ts` no longer exercises the not-done branch of the Story 3.2 deliverable rows.
origin: DW-51 implementation review 95a65e25, low finding
location: server/wikiLint/benchmark/gate1EvidenceIndex.test.ts:598
source_spec: `spec-dw-51-reassemble-gate-1-evidence.md`
severity: low
reason: With the Story 3.2 sprint key at `done`, only the done branch runs; the matrix row's error column ("no evidence for an ID: `gap` naming the missing item") is no longer proven by a test.
status: open

### DW-54: `ErrorTimedOutFileOperationsTask.test.ts` fails once stale file operations from earlier runs outnumber the task's limit in the persistent test database.
origin: coordinator DW-50 reproduction loop, 2026-10-24 (runs 1 and 2 of 12 on the aged test database)
location: server/queues/tasks/ErrorTimedOutFileOperationsTask.test.ts:51; server/queues/tasks/ErrorTimedOutFileOperationsTask.ts
source_spec: `spec-dw-50-fresh-test-database.md`
severity: medium
reason: The task selects at most `limit` (100) file operations in `creating` or `uploading` that are older than 12 hours across all teams, without an order. Every suite run leaves about seven `creating` rows behind, and after 12 hours they qualify; on 2026-10-24 about 430 had accumulated from the day's earlier runs, so each invocation errored 100 other rows and missed the test's own (`expected +0 to deeply equal 1`). Run alone after the backlog was drained, the file passed 3 of 3. The upstream test assumes a fresh database, as upstream CI provides; fixed by starting broad runs from `scripts/test-db.sh reset` (DW-50), not by changing the upstream test.
resolution: Closed for broad and evidence runs by DW-50: they start from `scripts/test-db.sh reset`, so no file operation older than 12 hours exists unless one database outlives 12 hours of runs. A targeted run after `ensure` on a database older than 12 hours can still hit it; AGENTS.md says to reset and repeat such a run. The upstream test is unchanged.
status: done 2026-10-25

### DW-55: `scripts/test-db.sh` interpolates the database name from `.env.test` into SQL without quoting.
origin: DW-50 implementation review 22644bdd, low finding (security lens)
location: scripts/test-db.sh:73 (reset session check and DROP), scripts/test-db.sh:55-57 (start, existing pattern)
source_spec: `spec-dw-50-fresh-test-database.md`
severity: low
reason: The `DATABASE_URL` regex accepts any database name (`(.+)`), and `$db` goes into the `pg_stat_activity` check, `DROP DATABASE` and `CREATE DATABASE` without escaping, so a name with a quote could change those statements; `start()` also interpolates the user and password into `ALTER USER … PASSWORD`. The input is a local file the developer controls; validating `$db` against a plain identifier pattern in the URL check would close it.
status: open
