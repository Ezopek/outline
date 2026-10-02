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
