---
id: SPEC-outline-mcp-wiki-linting
companions:
  - ../../../AGENTS.md
  - ../../../server/tools/README.md
  - ../../planning-artifacts/prds/prd-outline-2026-09-20/prd.md
  - ../../planning-artifacts/prds/prd-outline-2026-09-20/addendum.md
  - ../../planning-artifacts/architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md
sources:
  - ../../planning-artifacts/briefs/brief-outline-2026-09-20/brief.md
  - ../../planning-artifacts/briefs/brief-outline-2026-09-20/addendum.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are retained for decision provenance; downstream consumers do not need them.

# Deterministic Wiki Linting for Outline MCP

## Why

Outline's built-in MCP server needs one server-side integrity contract so agents using any MCP client can find mechanically verifiable Wiki drift, repair only what they are authorized to change, and prevent conclusively invalid MCP document writes without relying on client-specific prompts or remembered procedures. Read-only linting provides the first value; write enforcement completes the same initial implementation.

## Capabilities

- **CAP-1**
  - **intent:** MCP clients receive one deterministic, machine-readable result contract across lint surfaces.
  - **success:** Identical authorized inputs, policy, request, and Wiki state yield identical ordered classifications, stable codes, fixed severities, safe locations, completeness, and clean-state semantics.

- **CAP-2**
  - **intent:** An authenticated actor can lint one readable document under its collection policy without modifying Wiki state.
  - **success:** All configured document and link rules pass valid, invalid, round-trip, and non-disclosure fixtures, and the only permitted durable effect is the minimized audit summary required by the PRD.

- **CAP-3**
  - **intent:** An authenticated actor can lint an authorized configured Wiki scope and use the result to close a bounded repair loop.
  - **success:** Scoped and default runs cover the configured document, hierarchy, and global-index rules; retain safe completed work on isolated failure; never report incomplete work as clean; and return a complete zero-Error result after authorized repair while keeping Warnings visible.

- **CAP-4**
  - **intent:** An operator can enable deterministic policy per collection with explicit, safe configuration and runtime-failure behavior.
  - **success:** Tests prove unconfigured scope preserves upstream behavior, invalid configuration always fails closed, eligible runtime failures fail closed by default and can fail open only through immutable per-collection policy with `degraded_validation`, and issue-code severity cannot vary by configuration.

- **CAP-5**
  - **intent:** MCP document writes into Enforced Collections (PRD term) are checked against the complete state they would persist.
  - **success:** Create and `replace`, `append`, `prepend`, and `patch` update tests select policy from the post-operation collection, validate one full Projected Document, allow Warnings, reject Errors and fail-closed failures, and prove no externally visible partial effects.

- **CAP-6**
  - **intent:** Authorized operators receive durable, privacy-preserving aggregate evidence for lint and Enforced Write (PRD term) validation attempts, including invalid-policy rejections.
  - **success:** Normal operation records exactly one retrievable minimized summary per lint invocation that returns a lint result and per Validation Attempt (PRD term) whose outcome is established, including aborted attempts; authorization and payload fixtures prevent disclosure; and injected audit failure leaves lint and write outcomes unchanged while producing only correlated operator diagnostics; PRD FR-22 names the one exception.

## Constraints

- The final PRD is the binding product contract, its addendum supplies binding technical inputs, and the adopted Architecture Spine is the binding implementation-consistency contract; `AGENTS.md` and `server/tools/README.md` remain binding repository contracts.
- Target `v1.10.1^{}` at `4a5a616a21be800257dc11cef4263d0dd0412156`. Never merge or rebase onto `upstream/main`; admit later upstream changes only as separately approved and tested backports, excluding the post-`v1.10.1` container-block patch-edit fix from this increment.
- Expose lint tools and enforced writes through the one existing `/mcp` endpoint. Use deterministic program logic without an LLM or semantic classification, and one shared rule engine for read-only linting and write enforcement.
- Validate `create_document` and every `update_document` mode against the full Projected Document when its post-operation collection has valid `enforced` policy. Select policy from its post-operation collection; unconfigured and `read_only` collections retain baseline write behavior and response compatibility.
- Errors block Enforced Writes (PRD term) and Warnings do not. Invalid configuration always fails closed. Runtime validation fails closed by default and may fail open only for its eligible failure class through explicit per-collection policy, and a fail-open write whose commit the server establishes and whose status it can report returns unmistakable `degraded_validation`.
- Preserve existing authentication, authorization, transaction, consistency, and information-disclosure boundaries. Findings and observability must not reveal inaccessible resources beyond the policy class and the readability-gated missing-item names that PRD NFR-11 permits, and rejected writes must leave no externally visible partial effects.
- Audit failure never changes lint or write outcomes or appears in standard MCP responses; PRD FR-22 names the one exception. Durable audit evidence is aggregate and access-controlled and excludes content, excerpts, locations, raw configuration or requests, and protected target metadata.
- Keep workspace-specific schemas, templates, policy values, and document identifiers in server-side configuration. Reusable code, schemas, interfaces, issue codes, descriptions, examples, fixtures, and generic documentation remain environment-independent.
- On the selected baseline, canonical visible metadata is one list of `* ` bullets with no blank lines between items, the form the Markdown serializer writes for it; it round-trips byte-identically with stable diagnostic coordinates. Equivalent `- ` input lints clean and converges to that canonical form instead of round-tripping byte for byte. This is the binding interpretation of Story 1.10 AC5 in `epics.md`.
- Adopt Architecture Spine identifiers `AD-1`, `AD-2`, `AD-3`, `AD-4`, `AD-5`, `AD-6`, `AD-7`, `AD-8`, `AD-9`, `AD-10`, `AD-11`, `AD-12`, `AD-13`, `AD-14`, `AD-15`, `AD-16`, `AD-17`, `AD-18`, `AD-19`, and `AD-20` unchanged; their detailed decisions live only in the adopted companion.
- Deliver and validate read-only linting first, then integrate write enforcement in the same initial implementation. Implementation readiness, image publication, deployment, read-only rollout, and enforced production rollout remain separate approval gates.
- Do not invent values for `OD-2`, `OD-6`, or `OD-7`; resolve them only at the gates assigned by the approved PRD and Architecture Spine.

## Non-goals

- Semantic or editorial judgment, including meaning, truth, relevance, authority choice, logical placement, prose quality, language, usefulness, or token efficiency.
- LLM-backed rules, secret or private-payload scanning, fuzzy anchor or intended-target inference, onboarding-specific validation, incident-narrative validation, or Wiki quality scoring.
- Inferred batch boundaries, per-mutation `_log` requirements, batch-orchestration tools, or authority to repair beyond the actor's existing permissions and single-writer scope.
- Hard enforcement for UI, direct-API, or lower-level shared writer paths; a new telemetry platform, audit subsystem, dashboard, or administrative UI.
- Image publication, deployment, production policy values, migration, or rollout authorization.

## Success signal

- Implementation readiness is demonstrated on the exact selected baseline when every PRD capability criterion and `SM-I1` through `SM-I7` pass with inspectable deterministic, security, compatibility, performance, atomicity, audit, and generic-data evidence while conforming to `AD-1` through `AD-20`.
- After separately approved publication, deployment, and rollout, pilot success is decided only by the PRD's `SM-P1` through `SM-P7` and counter-metrics; implementation completion alone does not claim or authorize that outcome.
