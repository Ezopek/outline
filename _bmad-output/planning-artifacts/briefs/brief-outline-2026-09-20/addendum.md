# Product Brief Addendum: Downstream PRD and Architecture Inputs

This addendum preserves approved or evidence-backed technical details intentionally excluded from the product brief. It informs later PRD and architecture work; it is not an architecture decision record.

## Product sequencing signal

The primary product value is detecting existing Wiki drift through read-only linting, especially `lint_wiki`. An operating procedure may call for Wiki linting after each logical batch of updates or upserts so defects become visible immediately and can be corrected while the change context is still fresh.

Preventing invalid documents at MCP write time remains important, but it is the second product priority. Both capabilities belong to the same initial implementation: deliver and validate the read-only audit surface first, then integrate the shared engine with MCP writes. The initial implementation is complete only when both stages meet their acceptance criteria.

## Fixed technical boundaries

- Implement against the deployed `v1.10.1^{}` source commit `4a5a616a21be800257dc11cef4263d0dd0412156`.
- Do not upgrade, merge, or rebase the linting work onto `upstream/main`. Assess later upstream changes as explicit backports with their own tests.
- Keep the post-`v1.10.1` container-block patch-edit fix outside the initial linting change.
- Expose all tools and enforcement through Outline's existing `/mcp` endpoint for every MCP client.
- Use deterministic program logic only. Do not call an LLM or perform semantic classification.
- Preserve existing authentication, authorization, transaction, and information-disclosure boundaries.
- Implementation completion does not authorize image publication, deployment, migration, or production rollout. Each is a separate stage with its own verification and approval boundary.

## Intended enforcement and inspection surfaces

Use one reusable lint engine for:

- pre-persistence enforcement in `create_document`;
- pre-persistence enforcement in `update_document` against the fully projected post-edit document for `replace`, `append`, `prepend`, and `patch`;
- a read-only `lint_document` MCP tool; and
- a read-only `lint_wiki` MCP tool, optionally scoped to a collection.

Errors block configured MCP writes; warnings do not. Failed linting must not persist partial document state or externally visible side effects. UI and direct API writes remain outside hard enforcement in the first increment and are detected by `lint_wiki` instead.

## Deterministic rule families for the first increment

- Document structure: required sections and order, allowed heading levels, required visible metadata, field syntax, and explicitly unsupported Markdown structures.
- Internal links: validate supported Outline document IDs or URL identifiers, and report missing, deleted, or inaccessible targets without leaking metadata.
- Technical hierarchy integrity: dangling parents, cycles, published documents missing from collection structure, and inconsistent cross-collection parents.
- Configured global indexes: one configured surface document must directly link to each explicitly configured global-index document ID.

Anchor validation remains deferred unless it can be implemented without fuzzy matching. Logical placement under a parent or category is not a lint rule.

## Configuration and compatibility

- Keep schemas, templates, surface IDs, global-index IDs, and other workspace-specific policy in deterministic server-side configuration.
- Do not hard-code private Wiki identifiers in reusable source or MCP tool descriptions.
- Use Laura Wiki only as the first configured pilot. Reusable code, public interfaces, issue codes, tool descriptions, examples, fixtures, and generic documentation must not refer to Laura or depend on the current environment; another Outline deployment must be able to adopt the fork with its own configuration.
- If policy configuration is invalid, hard-enforced writes in configured scope must fail closed, and the system must return a distinct stable issue code.
- After successful configuration validation, runtime failures must also cause writes to fail closed by default. A documented server option may explicitly permit fail-open writes for this failure class only; responses to those writes must include an unmistakable machine-readable degraded-validation signal, and the documentation must state the integrity risk. The exact setting shape and scope are deferred to PRD and architecture.
- Unconfigured collections retain upstream behavior.
- Templates may generate canonical document shapes, but the projected document is still validated.
- Prefer visible Markdown metadata that survives the Outline Markdown/ProseMirror round trip. Support front matter only after its round-trip behavior is proven.

## Security and correctness constraints

- Tool handlers retain their existing access checks.
- Lint results must not reveal inaccessible documents, link targets, or their metadata.
- Stable machine-readable issue codes are part of the client contract.
- User-controlled `href` and `src` values in ProseMirror `toDOM` must pass through `sanitizeUrl()`.

## Agent remediation loop

The linter reports deterministic findings; it does not orchestrate edits or grant authority. For this loop, a batch is clean when it has zero errors. Warnings remain visible and may be corrected, but they do not block completion and must not cause an unbounded retry loop. This preserves a meaningful operational distinction between errors and warnings.

The expected operating procedure is:

1. lint after a logical update or upsert batch;
2. let the agent correct issues that are safe and within its existing authorization;
3. lint again until the applicable clean-state criterion is met; and
4. escalate only findings that cannot be corrected mechanically or require an operator decision.

This procedure must preserve existing authorization and single-writer boundaries. A lint result is diagnostic evidence, not permission to modify another document or broaden batch scope.

## Verification inputs for later planning

Plan unit coverage for every rule and issue code, plus tests for `create_document` and `update_document` enforcement; all four update modes against projected content; rollback and no-side-effect behavior; authorization and information disclosure; collection hierarchy and links; metadata round trips; MCP discovery on `/mcp`; and compatibility with unconfigured collections.

## Parked future direction

A later increment may add non-blocking statistics or other inspectable signals that help agents and operators manage Wiki quality. These capabilities are not part of the initial product and must remain distinct from semantic enforcement: measurements may inform an agent's judgment, but they must not silently become blocking rules about logical placement, prose usefulness, or token efficiency. Any such increment requires a separate product decision and acceptance criteria.
