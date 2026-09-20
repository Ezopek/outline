---
title: "Product Brief: Deterministic Wiki Linting for Outline MCP"
status: final
created: 2026-09-20
updated: 2026-09-20
---

# Product Brief: Deterministic Wiki Linting for Outline MCP

## Executive Summary

Outline's built-in MCP server should provide a deterministic, configuration-driven integrity layer through the standard `/mcp` endpoint. Successful MCP operations can still leave latent structural defects, such as broken references, that surface only when a later agent needs the missing context.

The first priority is read-only linting after logical change batches. Agents receive machine-readable findings, repair what is safe and authorized, re-lint to zero errors, and escalate only issues requiring judgment. The same policy then blocks conclusively invalid MCP writes before persistence. Both stages belong to one initial implementation.

The reusable fork targets `v1.10.1^{}`, preserves Outline's security and compatibility boundaries, and excludes semantic or editorial judgment. Implementation readiness, image publication, deployment, and pilot outcomes remain separate approval and success gates.

## Problem and User Need

Individually successful MCP creates or updates can collectively leave a Wiki structurally invalid. Without consistent server-side diagnostics, agents rely on client-specific prompts, remembered procedures, or later human review.

A fresh agent may follow a page's promise of essential context only to find that the target no longer resolves. A document split can likewise leave inbound references broken. These defects remain latent until a later task needs the missing context. Discovery then fails precisely when the Wiki should reduce uncertainty.

The primary users are AI agents operating through any MCP client connected to Outline's standard endpoint. They need stable issue codes, precise locations, clear severity, and deterministic diagnostic context for a bounded repair loop. A zero-error result defines a clean batch; warnings remain visible but do not block completion. Wiki operators are secondary beneficiaries who configure policy without duplicating it in prompts, local skills, or client-specific wiring.

## Expected Outcomes

- Every MCP client receives the same actionable findings through `/mcp`.
- Configured structural defects are found before they disrupt future knowledge retrieval.
- Authorized agents complete a lint–repair–re-lint loop and escalate only what requires judgment.
- Write enforcement prevents known errors without partial side effects.
- Configuration supplies local policy while reusable code remains environment-independent.

## Scope and Constraints

### Scope

- Add read-only document and Wiki linting, then apply the same policy to MCP document creation and updates.
- Cover mechanically verifiable document structure, internal references, technical hierarchy integrity, and explicitly configured global indexes.
- Return stable findings that distinguish blocking errors from non-blocking warnings.
- Enable policy per collection while preserving upstream behavior elsewhere.
- Use the standard `/mcp` endpoint for every client.

Read-only linting is delivered and validated first. Write prevention follows within the same initial implementation, which is complete only when both stages pass acceptance.

### Constraints

- Target `v1.10.1^{}` (`4a5a616a21be800257dc11cef4263d0dd0412156`) without upgrading or rebasing onto `upstream/main`.
- Use deterministic program logic only; do not call an LLM or classify meaning, truth, relevance, or intent.
- Preserve existing authentication, authorization, transaction, and information-disclosure boundaries.
- When policy configuration is invalid, validation always fails closed. Runtime validation failures also fail closed by default, but a documented server setting may explicitly allow fail-open behavior with an unmistakable degraded-validation signal.
- Evaluate the complete resulting document before persistence and ensure that failed linting produces no partial effects that are externally visible.
- Keep workspace-specific policy in server-side configuration, never reusable code or tool descriptions.
- Treat implementation, image publication, deployment, and production rollout as separate approval boundaries.

## Success Criteria

### Implementation success

- `lint_document` and `lint_wiki` are discoverable alongside existing tools on `/mcp`.
- Identical configuration, actor, and Wiki state produce identical ordered findings with stable codes, severity, and locations.
- Every in-scope rule detects invalid fixtures and accepts valid fixtures.
- The system evaluates the complete result for every MCP create and supported update mode; errors prevent persistence without partial effects, while warnings do not block writes.
- Linting preserves access and disclosure boundaries, and unconfigured collections retain upstream behavior.
- Reusable code, interfaces, descriptions, examples, and fixtures contain no pilot-environment dependencies.

These gates establish implementation readiness only.

### Pilot success

After an independently approved rollout:

- the configured Wiki is remediated to zero errors, with remaining warnings visible;
- an agent completes a representative post-batch repair loop to zero errors and escalates only findings requiring judgment or additional authority; and
- at least two supported MCP clients return equivalent machine-readable results through the same endpoint.

Implementation success does not imply pilot success.

## Risks

| Risk | Guardrail |
| --- | --- |
| Semantic or editorial scope creep | Restrict blocking rules to explicit, mechanically decidable contracts; leave placement, meaning, prose quality, and token efficiency to agents and operators. |
| False positives block legitimate work | Treat only conclusively proven violations as errors. Use warnings when ambiguity can be surfaced safely and usefully; otherwise, leave the case out of scope. |
| False negatives create unjustified confidence | Test every rule with valid and invalid fixtures and make no claim of semantic correctness. |
| Fail-open operation admits invalid writes | Default to fail closed; never allow invalid configuration to bypass validation; expose every allowed bypass in machine-readable output. |
| Cross-document checks leak protected information | Keep findings access-aware, disclose no protected metadata, and gate release on authorization tests. |
| Full-Wiki linting becomes disruptive at scale | Measure performance before wider rollout and define performance budgets and execution bounds during PRD and architecture work. |
| Pilot assumptions contaminate the reusable fork | Keep identities and schemas in configuration; review generic interfaces and fixtures as an acceptance condition. |

## Non-Goals

The linter does not decide logical placement or judge correctness, relevance, authority choice, prose quality, language, or token efficiency. It does not use an LLM or semantic classifier.

The initial implementation also excludes secret scanning, fuzzy anchor validation, onboarding-specific checks, incident-narrative validation, per-mutation logging, inferred batch boundaries, new batch operations, enforcement for UI or direct-API writes, Wiki quality statistics, and publication or rollout work.

These are deliberate boundaries. Any later increment needs its own problem statement, safety analysis, and acceptance criteria.
