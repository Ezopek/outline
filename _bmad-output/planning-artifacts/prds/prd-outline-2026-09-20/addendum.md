---
title: "PRD Addendum: Deterministic Wiki Linting for Outline MCP"
status: final
created: 2026-09-20
updated: 2026-09-21
---

# PRD Addendum: Deterministic Wiki Linting for Outline MCP

## Purpose

This addendum preserves approved technical constraints and architecture inputs that shape the product but do not belong in capability-level requirements. It is an input to later `/bmad-architecture` work, not an architecture design or implementation plan. The approved product brief and its addendum remain unchanged and authoritative for their respective decisions.

## Fixed Architecture Inputs

- Implement against `v1.10.1^{}` at source commit `4a5a616a21be800257dc11cef4263d0dd0412156`; do not upgrade, merge, or rebase linting work onto `upstream/main`.
- Keep the post-`v1.10.1` container-block patch-edit fix outside the initial linting change. Evaluate later upstream changes only as explicit backports with their own tests.
- Expose read-only lint tools and write enforcement through Outline's existing `/mcp` endpoint for all MCP clients.
- Use one reusable deterministic lint engine for `lint_document`, `lint_wiki`, `create_document`, and `update_document` enforcement.
- Evaluate `update_document` against the complete Projected Document for `replace`, `append`, `prepend`, and `patch`, using the baseline's actual transformation semantics.
- Preserve existing handler authentication and authorization responsibilities, transaction boundaries, and information-disclosure controls.
- Keep collection schemas, templates, surface document identifiers, global-index identifiers, and other workspace-specific policy in deterministic server-side configuration.
- Ensure user-controlled `href` and `src` values emitted by ProseMirror `toDOM` pass through `sanitizeUrl()`.
- Prove canonical visible metadata survives the actual Markdown/ProseMirror round trip before relying on it. Do not assign special semantics to front matter without equivalent evidence.
- Extend Outline's existing Event/audit-log infrastructure with durable aggregate summaries for `lint_document`, `lint_wiki`, and configured write-validation attempts, including rejected and degraded outcomes. Initial acceptance must not depend on external APM or StatsD because the pilot does not currently enable such telemetry.
- Persist only audit-safe aggregate evidence: operation and outcome, completion, duration, authorized scope kind or identifier, policy version/fingerprint, request correlation, evaluated-object counts, and Finding counts by severity and stable code. Do not persist full findings, document content or excerpts, diagnostic locations or messages, protected target metadata, raw configuration, or request bodies.
- Isolate the added audit path from functional outcomes. Audit persistence failures must not change lint results, reject or roll back otherwise valid writes, or appear in the standard MCP response. Emit correlated operator-facing diagnostics instead; architecture must choose a failure-isolated persistence mechanism rather than widening the mutation transaction's failure domain.

## Intentionally Deferred Architecture Decisions

- Module, class, and package boundaries for the shared lint engine.
- Configuration transport, schema representation, startup validation mechanism, and reload behavior.
- Internal data-access strategy, batching, caching, and concurrency controls for `lint_wiki`.
- Exact TypeScript types and MCP response-envelope implementation.
- Transaction integration and projection mechanics for each update mode.
- Logging, metrics backend, and operational dashboard implementation.
- The mechanism used to provide point-in-time meaning or detect concurrent drift during `lint_wiki`.
- Exact audit event names, payload types, correlation strategy, indexes, and authorized reporting/query surface.
- Reliable MCP client attribution when the authenticated protocol context exposes no trustworthy client identity.

## Parked Future Direction

- A later product increment may add a deterministic `documentType` input that selects a configured template and structural schema. It is not part of the initial implementation and requires its own product decision and acceptance criteria.

These decisions must preserve the observable product contracts in the PRD and the fixed baseline constraints above.
