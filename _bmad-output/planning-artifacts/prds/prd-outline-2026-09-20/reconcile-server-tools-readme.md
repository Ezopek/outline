# Input Reconciliation — `server/tools/README.md`

**Source role:** Fork roadmap, enforcement boundary, and required acceptance evidence

**Verdict:** Fully aligned after two repairs and one approved product-boundary clarification

## Confirmed Coverage

The PRD and addendum preserve the source's decisions for:

- one standard `/mcp` endpoint, one reusable deterministic engine, and no dependency on a particular MCP client;
- `lint_document`, `lint_wiki`, and hard validation of built-in MCP `create_document` and `update_document` only;
- validation of the complete projected title and body for `replace`, `append`, `prepend`, and `patch`;
- stable machine-readable findings, fixed severity, blocking Errors, non-blocking Warnings, and explicit System Failures;
- document-structure, internal-link, hierarchy-integrity, and configured global-index rule families;
- access-aware diagnostics and non-disclosure of protected documents or link targets;
- server-side per-collection policy, fail-closed invalid configuration, and upstream behavior for unconfigured collections;
- templates as authoring aids rather than proof of validity;
- the listed first-release non-goals and the decision not to infer logical batch boundaries;
- unit, write rejection, update projection, rollback, authorization, collection, endpoint-discovery, and unconfigured-compatibility evidence;
- the fixed baseline and separation of implementation from deployment approval.

## Repairs Required

1. The PRD addendum records the canonical visible-metadata round-trip constraint, but capability acceptance does not explicitly require evidence through the actual Markdown/ProseMirror conversion pipeline. FR-5 acceptance should make this test evidence explicit.
2. The source preserves a possible future deterministic `documentType` input. This should be recorded as a parked future direction in the addendum, without adding it to initial scope.

## Product-Boundary Clarification Required

FR-11, FR-14, and FR-15 do not yet define which collection controls applicability when a supported create or update operation changes or establishes collection scope. The product contract should state whether enforcement follows the Projected Document's post-operation collection. This matters especially when a document enters or leaves a Configured Collection; architecture cannot safely choose that semantic boundary on its own.

Recommended interpretation: determine applicability from the Projected Document's post-operation collection. Entering a Configured Collection is validated before persistence; leaving configured scope is not blocked by the former collection's content policy. Other mutation tools remain outside the initial hard-enforcement boundary and are detected later by `lint_wiki`.

## Conflicts

No conflict with the approved source was found.

## Resolution

- FR-5 acceptance now requires actual Markdown/ProseMirror round-trip evidence.
- The possible future deterministic `documentType` input is parked in the PRD addendum.
- The user approved post-operation collection scope as the enforcement-applicability boundary; FR-11, FR-14, FR-15, and write acceptance criteria now state it explicitly.
