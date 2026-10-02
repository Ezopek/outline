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
