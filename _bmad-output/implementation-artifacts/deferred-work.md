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
status: open

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
status: open
decision: 2026-10-04 Amend Story 3.4 ACs now — Add an acceptance criterion to Story 3.4 in _bmad-output/planning-artifacts/epics.md: the Gate 1 decision record states that no read-only production rollout is authorized until Story 3.3 evidence closes DW-4, DW-5 and DW-6 (event-loop blocking, CPU between deadline checks, pool-wait acquisition). Planning-artifact edit only.
decision: 2026-10-04 Amend Story 3.4 ACs now — Add an acceptance criterion to Story 3.4 in _bmad-output/planning-artifacts/epics.md: the Gate 1 decision record states that no read-only production rollout is authorized until Story 3.3 evidence closes DW-4, DW-5 and DW-6 (event-loop blocking, CPU between deadline checks, pool-wait acquisition). Planning-artifact edit only.

### DW-15: Encode deferrals of the form needs-a-decision-before-Story-X as blockers on Story X in sprint-status or story preconditions.
origin: retro action item epic-1-retro-item-5-encode-deferrals-of-the-form-needs-a-dec
location: n/a
source_spec: `_bmad-output/implementation-artifacts/epic-1-retro-2026-10-03.md`
severity: low
reason: retrospective action item from sprint-status.yaml (epic 1; owner Operator; sprint-status status open)
status: open
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
status: open
decision: 2026-10-04 Backfill Story 1.10 Spec Change Log — Append dated entries to the Spec Change Log of _bmad-output/implementation-artifacts/spec-1-10-accept-the-complete-read-only-lint-and-repair-loop.md recording the AC5 bullet-marker interpretation and the stale Code Map statements (buildDocument/structure, rule-kind list), citing the Auto Run Result. Do not edit sprint-status.yaml; the operator sets epic-1 done with the sprint tooling.
decision: 2026-10-04 Backfill Story 1.10 Spec Change Log — Append dated entries to the Spec Change Log of _bmad-output/implementation-artifacts/spec-1-10-accept-the-complete-read-only-lint-and-repair-loop.md recording the AC5 bullet-marker interpretation and the stale Code Map statements (buildDocument/structure, rule-kind list), citing the Auto Run Result. Do not edit sprint-status.yaml; the operator sets epic-1 done with the sprint tooling.

### DW-19: Log unmodellable lint failures with invocationId and error class only (F-6); defer to Epic 3 hardening.
origin: retro action item epic-1-retro-item-9-log-unmodellable-lint-failures-with-invo
location: n/a
source_spec: `_bmad-output/implementation-artifacts/epic-1-retro-2026-10-03.md`
severity: low
reason: retrospective action item from sprint-status.yaml (epic 1; owner Dev agent; sprint-status status open)
status: open
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

### DW-22: A metadata one_of policy can validate a linked inline image value that loses its link when Y.js builds the editor state from content.
origin: spec-deferred e0367ea24a48
location: server/wikiLint/adapters/documentProjection.test.ts:1557; server/wikiLint/core/documentRules.ts:270-285
source_spec: `spec-dw-10-html-create-state-content-parity.md`
severity: medium
reason: The class B metadata fixture in documentProjection.test.ts shows that the linked image is present in validated content but loses its link in the derived Y.js document. metadataFieldFormats in documentRules.ts compares the field value to configured one_of values. This Y.js conversion also occurs for Markdown creates and predates DW-10; the accepted Decision explicitly retains that behavior.
status: open

### DW-23: server/tools/README.md does not tell authors that their own `- ` bullets are stored and fetched as `* `, so a patch findText written from their input instead of the fetched Markdown still misses.
origin: spec-deferred eb7b895ea0db
location: server/tools/README.md:119-140
source_spec: `spec-dw-7-readme-metadata-canonical-bullet-marker.md`
severity: low
reason: Patch findText is an indexOf over serializeWithPositions output (DocumentHelper.tsx:668-683), and BulletList.toMarkdown always writes `* `. DW-7 fixes only the copied example; metadata an agent writes itself with `- ` behaves as before. Pre-existing, not caused by this change, and outside the 2026-10-04 decision, which covers the example and the SPEC record.
status: open

### DW-24: Decide the unavailable-probe rule for the HTML worker finish/first lookup and requester (spine analogue: row 7, source retained), record it in the Story 2.5 contract and spine, then implement with tests that fail finish probe (F-1).
origin: retro action item epic-2-retro-item-11-decide-the-unavailable-probe-rule-for-th
location: n/a
source_spec: `_bmad-output/implementation-artifacts/epic-2-retro-2026-10-04.md`
severity: low
reason: retrospective action item from sprint-status.yaml (epic 2; owner Operator with the architect, then Dev agent; sprint-status status open)
status: open

### DW-25: Restore the Story 2.5 spec (with its blocked follow-up review) from .bmad-loop/archive/20261003-130833-8009 and run one completed independent review of the 2.5 code (F-2).
origin: retro action item epic-2-retro-item-12-restore-the-story-2-5-spec-with-its-bloc
location: n/a
source_spec: `_bmad-output/implementation-artifacts/epic-2-retro-2026-10-04.md`
severity: low
reason: retrospective action item from sprint-status.yaml (epic 2; owner Operator; sprint-status status open)
status: open

### DW-26: Reserve COMMIT_PROBE_BOUND_MS out of the COMMIT timeout in runAttempt so a commit timeout can still probe; add a commit-timeout test (F-6).
origin: retro action item epic-2-retro-item-13-reserve-commit_probe_bound_ms-out-of-the
location: n/a
source_spec: `_bmad-output/implementation-artifacts/epic-2-retro-2026-10-04.md`
severity: low
reason: retrospective action item from sprint-status.yaml (epic 2; owner Dev agent; sprint-status status open)
status: open

### DW-27: Close staged-blob leaks: delete a late-landing requester source and the media blob when Attachment validation fails (F-7).
origin: retro action item epic-2-retro-item-14-close-staged-blob-leaks-delete-a-late-la
location: n/a
source_spec: `_bmad-output/implementation-artifacts/epic-2-retro-2026-10-04.md`
severity: low
reason: retrospective action item from sprint-status.yaml (epic 2; owner Dev agent; sprint-status status open)
status: open

### DW-28: Add tests for worker row 2/4/5 committedFromSummary conversion and HTML-with-media failure rows and summaries (F-12).
origin: retro action item epic-2-retro-item-15-add-tests-for-worker-row-2-4-5-committed
location: n/a
source_spec: `_bmad-output/implementation-artifacts/epic-2-retro-2026-10-04.md`
severity: low
reason: retrospective action item from sprint-status.yaml (epic 2; owner Dev agent; sprint-status status open)
status: open

### DW-29: Pin one reproducible broad verification command (--maxWorkers=2 or raised test PostgreSQL connection limit) for Epic 3 conformance evidence (F-13).
origin: retro action item epic-2-retro-item-16-pin-one-reproducible-broad-verification
location: n/a
source_spec: `_bmad-output/implementation-artifacts/epic-2-retro-2026-10-04.md`
severity: low
reason: retrospective action item from sprint-status.yaml (epic 2; owner Operator; sprint-status status open)
status: open

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
status: open

### DW-32: Never mark a loop-deferred story done by hand without moving its open review findings into deferred-work.md (F-2).
origin: retro action item epic-2-retro-item-19-never-mark-a-loop-deferred-story-done-by
location: n/a
source_spec: `_bmad-output/implementation-artifacts/epic-2-retro-2026-10-04.md`
severity: low
reason: retrospective action item from sprint-status.yaml (epic 2; owner Operator; sprint-status status open)
status: open

### DW-33: Sync tracking: set epic-2 (and epic-1) to done in sprint-status.yaml.
origin: retro action item epic-2-retro-item-20-sync-tracking-set-epic-2-and-epic-1-to-d
location: n/a
source_spec: `_bmad-output/implementation-artifacts/epic-2-retro-2026-10-04.md`
severity: low
reason: retrospective action item from sprint-status.yaml (epic 2; owner Operator; sprint-status status open)
status: open
