### DW-1: parseCanonicalMarkdown throws when a block token starts on a blank line, failing every rule of the document instead of only rules that need that position.
origin: spec-deferred 07c92c8bfe2c
location: server/wikiLint/adapters/canonicalSyntax.ts:74
source_spec: `spec-1-1-establish-the-deterministic-result-contract-and-closed-rule.md`
reason: server/wikiLint/adapters/canonicalSyntax.ts blockPosition throws CanonicalMarkdownError for a whitespace-only start line, while unmapped blocks degrade to position null. No canonical (serializer-produced) input reaching this path has been found. Settle it by finding a toCanonicalMarkdown output whose block token map starts on a blank line; if one exists, return position null instead of throwing.
status: open

### DW-2: Repeated missing-item Findings (REQUIRED_SECTION_MISSING, REQUIRED_METADATA_FIELD_MISSING) are byte-identical, so an agent cannot tell which configured section or field to add.
origin: spec-deferred d3b4850f196c
location: server/wikiLint/core/registry.ts (issue messages); Architecture Spine AD-12
source_spec: `spec-1-1-establish-the-deterministic-result-contract-and-closed-rule.md`
severity: medium
reason: AD-12 fixes Finding to { code, severity, message, location } with a document location; the registry message is fixed and generic for non-disclosure (NFR-11, policy class only for document-only readers); the rule-local ordinal is not part of the output. Identifying the missing item needs an architecture decision (for example readability-gated detail) before the Story 1.10 lint-repair-relint acceptance.
status: open

### DW-3: Repeated GLOBAL_INDEX_LINK_MISSING Findings are byte-identical, so an agent cannot tell which configured global index to link, or which collection policy required it when several collections in the
origin: spec-deferred 17d969ca65d2
location: server/wikiLint/core/graphRules.ts:182 (globalIndexLinks emit); Architecture Spine AD-12
source_spec: `spec-1-6-detect-authorized-hierarchy-and-global-index-defects.md`
severity: medium
reason: The AD-12 Finding is fixed to { code, severity, message, location }. The registry message is generic, and the relationship location names only the surface document. Every missing index of one surface, and every collection policy that shares that surface and index, therefore yields an identical Error that differs only in sort position. The configured index IDs are server-side configuration, which the agent never sees. This is the same root cause as DW-2: identifying the missing item needs an architecture decision before the Story 1.10 lint-repair-relint acceptance. Raised by the Blind Hunter and the Edge Case Hunter in the 2026-10-02 review pass.
status: open

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
status: open

### DW-7: The fork README's visible-metadata example uses `- ` bullets, but the v1.10.1 serializer emits every bullet as `* `, so the example does not round-trip byte for byte.
origin: spec-deferred 4a4cbba2a02c
location: server/tools/README.md (Templates and visible metadata)
source_spec: `spec-1-10-accept-the-complete-read-only-lint-and-repair-loop.md`
severity: low
reason: server/tools/README.md presents "- Status: Active" / "- Last verified: 2026-09-20" as the shape that survives the Markdown/ProseMirror round trip. Story 1.10's HTTP suite (server/routes/mcp/wikiLint.test.ts, "round trip") shows MCP create_document + fetch return "* Status: Active"; the fields stay valid and lint clean, but agents copying the example as patch findText would miss. The README is a companion of the binding SPEC, so the edit needs a deliberate contract update rather than an unattended story change.
status: open

### DW-8: The lint-repair-relint loop needs repair knowledge that Findings do not carry: a missing metadata field value or a missing configured global index is not identified by the AD-12 Finding.
origin: spec-deferred 656e36dfb1ba
location: server/wikiLint/core/registry.ts (issue messages); server/wikiLint/core/graphRules.ts (globalIndexLinks emit); Architecture Spine AD-12
source_spec: `spec-1-10-accept-the-complete-read-only-lint-and-repair-loop.md`
severity: medium
reason: Story 1.10's acceptance loop (server/routes/mcp/wikiLint.test.ts, "repair loop") reaches a Clean Result only because the test agent is given the collection's documented conventions (field values, global index id); the Finding is fixed to {code, severity, message, location} with a generic registry message. This is the pre-existing DW-2/DW-3 gap (deferred-work ledger), now observed at the accepted MCP surface; settling it needs an architecture decision on readability-gated detail.
status: open

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
status: open
