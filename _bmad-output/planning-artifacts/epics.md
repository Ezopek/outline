---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
  - step-03-create-stories
inputDocuments:
  - AGENTS.md
  - server/tools/README.md
  - _bmad-output/specs/spec-outline-mcp-wiki-linting/SPEC.md
  - _bmad-output/planning-artifacts/prds/prd-outline-2026-09-20/prd.md
  - _bmad-output/planning-artifacts/prds/prd-outline-2026-09-20/addendum.md
  - _bmad-output/planning-artifacts/architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md
---

# outline - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for deterministic Wiki linting in the built-in Outline MCP server, decomposing the approved PRD, its technical addendum, the adopted Architecture Spine, the lean feature specification, and repository contracts into independently reviewable implementation work.

## Requirements Inventory

### Functional Requirements

- **FR-1 — Result classification and clean-state semantics:** Return Errors, Warnings, and System Failures as distinct machine-readable classes, report completion explicitly, and treat only a complete zero-Error evaluation as clean; policy-not-configured is explicitly not evaluated.
- **FR-2 — Stable finding identity and safe location:** Every Finding contains a stable issue code, fixed severity, safe message, and the most precise authorized location without fabricated source positions.
- **FR-3 — Deterministic ordering:** Identical policy, authorization, request, and Wiki state produce identical Findings in identical identifier- and location-based order, independent of titles, prose, retrieval order, locale, or timing.
- **FR-4 — Authorized document inspection:** An authenticated actor may lint a readable stored document using its collection policy and only the authorized related state required by enabled rules; an unconfigured document is explicitly not evaluated.
- **FR-5 — Deterministic document-structure rules:** Configured document lint covers required sections and order, allowed heading levels, required visible metadata, registered field syntax, and configured unsupported Markdown structures without inferring policy or type from prose.
- **FR-6 — Access-aware internal-link validation:** Validate supported Outline document IDs and URL IDs while collapsing missing, deleted, and inaccessible targets whenever distinction would leak protected information; fuzzy and anchor inference are excluded.
- **FR-7 — Authorized Wiki scope:** `lint_wiki` optionally evaluates one accessible Configured Collection or, by default, all actor-readable Configured Collections, and reports only the safely Evaluated Scope.
- **FR-8 — Technical hierarchy integrity:** Detect dangling parents, cycles, published documents missing from collection structure, and cross-collection parent inconsistencies without judging logical placement.
- **FR-9 — Configured global-index integrity:** Verify that each configured surface directly links to every explicitly configured global-index document, without inferring which documents should be indexes and without disclosing protected facts.
- **FR-10 — Partial read-only evaluation:** Preserve safe completed findings and continue independent checks after isolated runtime failures, while returning separate System Failures, `complete: false`, and never a Clean Result.
- **FR-11 — Per-collection policy applicability:** Enable policy only through server-side per-collection configuration, select write policy from the Projected Document's post-operation collection, and preserve upstream behavior and response compatibility outside configured scope.
- **FR-12 — Invalid configuration handling:** Invalid Policy Configuration yields a stable distinct System Failure, never becomes a Finding, never permits fail-open, fails affected writes closed, and never produces a clean read-only result.
- **FR-13 — Runtime validation failure handling:** Runtime validation failures fail configured writes closed by default and may fail open only through immutable per-collection policy, never through MCP input, always returning `degraded_validation`; Errors and invalid configuration remain blocking.
- **FR-14 — Create enforcement:** Validate the complete Projected Document for a create whose post-operation collection is enforced before persistence; reject known Errors and fail-closed System Failures while still applying upstream checks.
- **FR-15 — Complete update enforcement:** Validate one complete Projected Document for `replace`, `append`, `prepend`, and `patch` using the selected baseline's exact transformation semantics, including unchanged policy-relevant content.
- **FR-16 — Explicit configured-write outcome:** Every enforced create/update response exposes exactly one of `validated`, `validated_with_warnings`, `degraded_validation`, or `rejected` without requiring prose inference.
- **FR-17 — No partial or externally visible rejected-write effects:** A rejected create leaves no document, a rejected update preserves prior state, and neither emits an externally visible successful mutation signal; only the required minimized rejection audit is permitted.
- **FR-18 — Initial enforcement boundary:** Hard validation applies only to built-in MCP `create_document` and `update_document`; UI, direct API, lower-level writers, `move_document`, and `restore_document` remain outside this increment, with collection-changing move/restore fixtures proving unchanged baseline behavior without counting as CAP-5 evidence.
- **FR-19 — Read-only lint audit summary:** Every `lint_document` and `lint_wiki` invocation attempts exactly one durable, retrievable, actor- and scope-attributable minimized summary under normal audit operation.
- **FR-20 — Configured-write validation audit summary:** Every configured create/update validation attempt, including rejected and degraded attempts, attempts exactly one durable minimized summary under normal audit operation, correlated with mutation events when applicable.
- **FR-21 — Audit minimization and authorized retrieval:** Reuse Outline's authorized Event/audit surface and retention; persist aggregate evidence only, exclude content and protected detail, and allow authorized operators to calculate required measures without direct database access.
- **FR-22 — Audit failure isolation:** Audit persistence failure never changes lint or write outcomes, never appears in the standard MCP response, and produces only minimized correlated operator diagnostics.
- **FR-23 — Stable severity semantics:** Every issue code has one invariant severity; configuration may select registered rules and parameters but cannot override severity, and any attempted override invalidates configuration under FR-12.

### NonFunctional Requirements

- **NFR-1 — Document lint latency:** `lint_document` completes within 1 second at p95 for the approved normal acceptance profile.
- **NFR-2 — Write-enforcement overhead:** Configured validation adds no more than 500 milliseconds at p95 over the equivalent upstream create/update operation for the normal acceptance profile.
- **NFR-3 — Normal Wiki lint latency:** `lint_wiki` completes within 10 seconds at p95 for a representative 150-document Evaluated Scope.
- **NFR-4 — Growth guardrail:** `lint_wiki` completes within 60 seconds for a representative 1,000-document scope; this is a guardrail, not a product limit.
- **NFR-5 — Growth evidence:** Report p95 runtime and peak working-set memory for 150- and 1,000-document profiles, normalized by evaluated document and link counts, and explain normalized cost growth.
- **NFR-6 — Point-in-time meaning:** A Clean Result describes one coherent observed state; it cannot be claimed when concurrent change makes coherence unverifiable.
- **NFR-7 — Concurrent-change handling:** Unverifiable drift during `lint_wiki` returns a stable System Failure and `complete: false`.
- **NFR-8 — Failure isolation:** Rule or resource failure does not silently suppress other required checks; read-only lint preserves safe work and writes follow the approved failure matrix.
- **NFR-9 — Rejected-write atomicity:** Validation rejection preserves the pre-operation externally visible state for every supported create and update path.
- **NFR-10 — Existing security boundaries:** Preserve baseline authentication, authorization, transaction, and information-disclosure boundaries on every lint and enforcement path.
- **NFR-11 — Least disclosure:** Findings, scope summaries, System Failures, logs, and metrics reveal no content, identity, or metadata inaccessible to the current actor.
- **NFR-12 — No authority expansion:** Findings are diagnostic only and never grant write authority, broaden a batch, bypass single-writer coordination, or authorize repair.
- **NFR-13 — Safe rendering:** User-controlled `href` and `src` emitted through ProseMirror `toDOM` use the baseline-approved `sanitizeUrl()` path.
- **NFR-14 — Durable structured evidence:** Under normal audit operation, existing authorized Event/audit capabilities expose counts, durations, completion, statuses, severity/code aggregates, and System Failure codes.
- **NFR-15 — Degraded-validation signal:** Every runtime fail-open write returns agent-visible degraded status and, under normal audit operation, emits a durable operator-visible event.
- **NFR-16 — Configuration health:** Invalid configuration is observable before or at the first affected operation through a stable code and non-secret scope-locating context.
- **NFR-17 — Privacy-preserving observability:** Audit, logs, telemetry, generic labels, and tool descriptions exclude bodies, excerpts, protected targets, raw requests/configuration, and private reusable identifiers.
- **NFR-18 — Fixed implementation baseline:** Produce compatibility evidence only against `v1.10.1^{}` at `4a5a616a21be800257dc11cef4263d0dd0412156`.
- **NFR-19 — Standard endpoint:** All supported MCP clients discover and use lint tools and enforced writes through the one existing `/mcp` endpoint without client-specific composition.
- **NFR-20 — Unconfigured behavior:** Collections without enabled policy retain baseline upstream create/update behavior and response compatibility.
- **NFR-21 — Explicit backports only:** No merge or rebase onto `upstream/main`; every accepted later change is a separately approved and tested backport.
- **NFR-22 — Shared policy behavior:** All read-only and write-enforcement surfaces use one reusable rule engine with one observable meaning per rule.
- **NFR-23 — Stable codes:** Issue and System Failure codes are client contracts; material semantic changes require a new code and test evidence, never prose parsing.
- **NFR-24 — Rule-level verification:** Every in-scope rule has isolated valid/invalid fixtures and integration evidence on every applicable surface.
- **NFR-25 — Environment independence:** Reusable code, interfaces, codes, descriptions, examples, fixtures, and generic documentation contain no Laura-specific or pilot-workspace assumptions or identifiers.
- **NFR-26 — Baseline-conformant implementation:** Follow the selected baseline's TypeScript and test conventions without claiming stricter guarantees than its checked-in configuration.
- **NFR-27 — Observation failure isolation:** Added audit-path failure is operator-observable but never changes validation semantics, blocks functional operations, or reaches standard agent-facing responses.

### Additional Requirements

#### Capability and delivery constraints

- **CAP-1:** Provide one deterministic machine-readable result contract with stable codes, fixed severities, safe locations, completeness, clean-state semantics, and deterministic ordering across all lint surfaces.
- **CAP-2:** Provide read-only linting of one readable document under collection policy, with full configured document/link rule coverage, non-disclosure, round-trip evidence, and no durable effect except the minimized audit summary.
- **CAP-3:** Provide authorized scoped/default Wiki linting that covers document, hierarchy, and global-index rules, retains safe partial work, supports bounded lint-repair-re-lint, and never labels incomplete work clean.
- **CAP-4:** Provide explicit per-collection policy with upstream behavior outside configured scope, fail-closed invalid configuration, default fail-closed runtime behavior, narrowly approved fail-open, degraded signaling, and immutable issue severity.
- **CAP-5:** Validate configured creates and every update mode against one full Projected Document using post-operation collection policy, allow Warnings, block Errors/fail-closed failures, and prevent externally visible partial effects.
- **CAP-6:** Provide exactly one minimized authorized aggregate audit summary per attempt under normal operation, with failure isolation and correlated operator diagnostics.
- Read-only linting and its audit evidence must be implemented and accepted before integrating write enforcement in the same initial implementation.
- Implementation readiness, image publication, deployment, read-only production rollout, and enforced production rollout are distinct approval boundaries; completing a prior stage grants no authority for the next.
- Keep OD-2 (pilot policy values), OD-6 (pilot clients/evidence procedure), and OD-7 (release-operation details) deferred to their assigned Gate 4, Gate 4, and Gate 2/3 decisions respectively; do not invent their values.
- Do not implement semantic/editorial judgment, LLM-backed classification, private-payload scanning, fuzzy/anchor inference, inferred batch boundaries, per-mutation `_log` requirements, batch orchestration, broader writer enforcement, a new telemetry platform/dashboard, image publication, deployment, migration, or rollout authorization.

#### Adopted Architecture Spine decisions

- **AD-1 — Functional Core, Imperative Shell [ADOPTED]:** One pure core owns deterministic contracts and rule behavior; the application shell and existing handlers/workers own authorization, data access, sequencing, transactions, timeouts, media, audit, and responses.
- **AD-2 — Authorized data boundary [ADOPTED]:** Existing Outline policy-aware adapters collapse inaccessible link state before passing only immutable authorized policy, projections/snapshots, safe syntax locations, and evaluation context into the core.
- **AD-3 — Closed rule and issue registry [ADOPTED]:** A code-owned discriminated registry defines the exact initial rule kinds, parameter schemas, fixed severities, stable codes, meanings, and System Failure codes; configuration cannot supply executable code, regex, codes, or severity overrides.
- **AD-4 — Safe locations and deterministic order [ADOPTED]:** Use only the adopted `text`, `document`, `relationship`, and `scope` location algebra with authorized identifiers and the specified bytewise stable sort keys.
- **AD-5 — Startup-loaded policy configuration [ADOPTED]:** Optionally load one strict duplicate-aware schema-version-1 JSON file from `WIKI_LINT_CONFIG_PATH` once at startup; absence configures no collections, root-invalid configuration blocks startup, and identifiable invalid entries become collection-local fail-closed sentinels.
- **AD-6 — Policy identity and lifecycle [ADOPTED]:** Use the adopted canonical JSON rules and SHA-256 policy, invalid-entry, and policy-set fingerprints; never expose raw configuration, and require serving instances to agree on the expected policy-set fingerprint for rollout.
- **AD-7 — One side-effect-free Projected Document [ADOPTED]:** Build one complete projection with baseline create/template/conversion/publish/edit semantics, validate it once, persist that exact projection, and use the adopted `stage -> project -> validate -> materialize` media protocol plus server-only HTML worker intent and reauthorization.
- **AD-8 — Enforced-write transaction and concurrency [ADOPTED]:** For enforced post-operation scope, re-fetch, re-authorize, lock, project, validate, and persist in one primary-DB transaction; commit before success, roll back rejection, and retain exact baseline behavior for read-only/unconfigured writes.
- **AD-9 — Minimal authorized WikiSnapshot [ADOPTED]:** Batch-load only actor-readable configured scope and required fields from primary authoritative data, including uncached collection structure, and emit global-index errors only when all proving facts are authorized and resolved.
- **AD-10 — One point-in-time snapshot per `lint_wiki` [ADOPTED]:** Materialize every required authorized input in one primary-DB read-only `REPEATABLE READ` transaction, then evaluate the immutable snapshot; use the same mechanism for `lint_document` dependencies.
- **AD-11 — Server-owned timeout and partial-result semantics [ADOPTED]:** Use a non-client-configurable 60-second `lint_wiki` deadline, transport timeout of at least 65 seconds, ordered buffered atomic units, longest-completed-prefix timeout results, and safe continuation after isolated failure.
- **AD-12 — Explicit result algebra [ADOPTED]:** Implement the closed Finding, SystemFailure, PolicyIdentity, EvaluatedScope, read-only state/boolean/array, and enforced-write validation contracts exactly; reserve protocol errors for invalid calls, denials, or unmodellable failures.
- **AD-13 — Central write-decision matrix [ADOPTED]:** One pure decision function applies the exact closed/open matrix; only the three approved runtime System Failure codes may fail open, while Errors, invalid configuration, authorization/input/conflict/persistence/audit failures always block or remain outside validation decisions.
- **AD-14 — Minimized durable Event summaries [ADOPTED]:** Persist one idempotent Event summary per invocation under the three adopted names, using server request/invocation IDs, the exact closed `AuditDataV1` aggregate schema, existing retention, and the required Event index.
- **AD-15 — Narrow audit access and failure isolation [ADOPTED]:** Add narrowly scoped `auditWikiLint` admin access, propagate only trustworthy server-derived credential/client attribution, run audit persistence independently after functional completion, and isolate failures to correlated minimized operator diagnostics.
- **AD-16 — Bounded query and memory plan [ADOPTED]:** Use adopted keyset/batch sizes, request-local maps, transient ASTs, one concurrent `lint_wiki` per process, and the exact code-owned document/size/link/structure limits with stable resource-limit failure.
- **AD-17 — Reproducible performance gate [ADOPTED]:** Use the specified production-build Linux/PostgreSQL resource profile, deterministic seeded 150/1,000-document datasets, warmup/sample/p95 method, paired baseline/enabled write tests, raw evidence, and retained manifest.
- **AD-18 — Layered conformance evidence [ADOPTED]:** Provide collocated pure-core, dependency, configuration/fingerprint, projection parity, round-trip, multi-actor disclosure, transaction/concurrency, worker/media, audit, compatibility, endpoint-discovery, and URL-sanitization evidence, plus exact baseline/backport proof.
- **AD-19 — Deployment does not enable policy [ADOPTED]:** Ship generic implementation/schema/example without pilot policy; use optional read-only mounted configuration, restart-only policy changes, startup/readiness fingerprint reporting, single-fingerprint rollout, and separate approvals for readiness, publication, deployment, read-only rollout, and enforcement.
- The structural seed is `server/wikiLint/{core,application,adapters}`, `server/tools/wikiLint.ts`, and the existing `server/tools/documents.ts`; tests remain collocated and no parallel framework tree is introduced.
- Use the baseline's declared Node/Yarn/TypeScript/MCP SDK/Sequelize/Zod/markdown-it/PostgreSQL versions and add no framework or external service.

#### Success measures and approval gates

- **SM-I1 through SM-I7:** Gate 1 evidence must prove full FR/capability coverage, deterministic outcomes, write safety, zero disclosure regressions, all performance/growth evidence, exactly-once minimized audit behavior under normal operation with isolated audit failure, single-endpoint compatibility, unconfigured parity, and generic reusable artifacts.
- **SM-P1 through SM-P7:** Product support and later Gate 4 evidence must cover client-equivalent representative use, complete zero-Error batch closure, bounded repair/re-lint, zero confirmed false blocking or disclosure regression, review of every degraded write, and live performance triage; implementation does not itself claim pilot completion.
- **SM-C1 through SM-C7:** Evidence and implementation must not achieve success by skipping checks, weakening severity, chasing zero Warnings, expanding authority, normalizing fail-open, creating client-specific forks, or burdening ordinary MCP responses with audit failures.
- **Gate 1 — Implementation Readiness:** Require the exact baseline, SM-I1–SM-I7, resolved blocking decisions, generic artifacts, and explicit evidence for any separately approved backport; exit authorizes only consideration of publication.
- **Gate 2 — Image Publication:** Remains separately approved and requires immutable build identity, provenance, review, smoke evidence, registry boundary, and rollback identifier; it is not authorized by these implementation stories.
- **Gate 3 — Deployment:** Remains separately approved and requires target-specific backup/restore/rollback, digest, configuration/migration review, compatibility/discovery/audit smoke checks, and no automatic policy activation; it is not authorized by these implementation stories.
- **Gate 4 — Production Rollout:** Remains separately approved and ordered as policy validation, named read-only enablement, clean scoped lint, full pilot evidence, operator review, explicit enforcement approval, and post-enable/rollback verification; these stories may build the required capabilities but must not choose OD-2, OD-6, or OD-7 or perform rollout.

### UX Design Requirements

Not applicable. This increment adds no UI or administrative interface, and no UX design contract exists. Standard MCP responses and existing authorized audit surfaces are governed by the PRD and Architecture Spine.

### FR Coverage Map

- **FR-1:** Epic 1 — explicit deterministic result classification and clean-state semantics; Epic 3 verifies the normalized contract.
- **FR-2:** Epic 1 — stable finding identity and safe locations; Epic 3 verifies disclosure-safe fixtures.
- **FR-3:** Epic 1 — deterministic ordering; Epic 3 verifies repeatability.
- **FR-4:** Epic 1 — authorized `lint_document` inspection.
- **FR-5:** Epic 1 — configured deterministic document-structure rules.
- **FR-6:** Epic 1 — access-aware internal-link validation.
- **FR-7:** Epic 1 — authorized scoped and default `lint_wiki` operation.
- **FR-8:** Epic 1 — technical hierarchy integrity.
- **FR-9:** Epic 1 — configured global-index integrity.
- **FR-10:** Epic 1 — safe partial read-only evaluation.
- **FR-11:** Epic 1 — per-collection read-only applicability and upstream-compatible unconfigured results; Epic 2 — post-operation policy selection and write compatibility.
- **FR-12:** Epic 1 — invalid-policy loading and read-only behavior; Epic 2 — unconditional fail-closed write behavior.
- **FR-13:** Epic 2 — default runtime fail-closed and approved immutable per-collection fail-open behavior.
- **FR-14:** Epic 2 — complete create projection enforcement.
- **FR-15:** Epic 2 — complete update projection enforcement for every supported mode.
- **FR-16:** Epic 2 — explicit configured-write Validation Status.
- **FR-17:** Epic 2 — no partial or externally visible rejected-write effects.
- **FR-18:** Epic 2 — MCP-only enforcement on built-in create/update, with explicit non-enforcement compatibility evidence for collection-changing `move_document` and `restore_document` paths and no widening of lower-level writers.
- **FR-19:** Epic 1 — one minimized audit summary per read-only lint invocation under normal audit operation.
- **FR-20:** Epic 2 — one minimized audit summary per configured-write validation attempt under normal audit operation.
- **FR-21:** Epic 1 — minimized authorized read-only audit retrieval; Epic 2 — minimized authorized write-validation audit retrieval.
- **FR-22:** Epic 1 and Epic 2 — audit failure isolation on every applicable surface.
- **FR-23:** Epic 1 — closed fixed-severity registry and invalid override handling; Epic 2 — identical severity semantics in write enforcement.
- **FR-1 through FR-23:** Epic 3 — cross-cutting implementation-readiness verification without adding or weakening product behavior.

## Epic List

### Epic 1: Deterministic and Auditable Read-Only Wiki Validation

An authenticated MCP agent can use the standard `/mcp` endpoint to deterministically lint one readable document or an authorized configured Wiki scope, distinguish clean, not-evaluated, incomplete, and failed outcomes, and complete a bounded lint–repair–re-lint loop. Authorized operators receive minimized durable audit evidence without changing lint outcomes or leaking protected information.

**FRs covered:** FR-1–FR-12, FR-19, FR-21–FR-23

**Primary capabilities:** CAP-1–CAP-4, CAP-6

**Implementation notes:** Deliver the shared pure rule/result core, startup policy loading and identity, authorized point-in-time snapshots, deterministic document/link/hierarchy/global-index evaluation, read-only MCP tools, and their isolated audit path. This epic must be accepted before write enforcement is integrated.

**Dependency:** None. This epic delivers complete standalone read-only product value and enables later enforcement.

### Epic 2: Safe Policy-Enforced MCP Document Writes

An authenticated MCP agent can create and update documents in configured collections with deterministic validation of the one complete state that would be persisted. Errors and fail-closed failures reject without visible mutation effects, Warnings remain non-blocking, approved runtime fail-open is unmistakably degraded, and every validation attempt receives minimized isolated audit treatment.

**FRs covered:** FR-11–FR-18, FR-20–FR-23

**Primary capabilities:** CAP-4–CAP-6

**Implementation notes:** Reuse the accepted Epic 1 engine and registry; add post-operation policy selection, exact baseline projection for create/templates/publish and every update mode, server-only HTML worker intent, staged media ownership, transactional reauthorization/locking/persistence, the central decision matrix, response integration, and write-validation audit correlation. Preserve exact read-only and unconfigured baseline behavior.

**Dependency:** Epic 1. No later epic is required for the enforced-write capability to function.

### Epic 3: Inspectable Implementation Readiness

The Wiki operator can make an evidence-backed Gate 1 decision using reproducible performance, security, compatibility, determinism, atomicity, audit, and generic-data evidence produced on the exact selected baseline, while later publication, deployment, read-only rollout, and enforced rollout remain separate and unauthorized.

**FRs covered:** Cross-cutting verification of FR-1–FR-23; no new functional scope.

**Primary requirements:** NFR-1–NFR-27, AD-17–AD-19, SM-I1–SM-I7, SM-C1–SM-C7, Gate 1

**Implementation notes:** Complete the adopted benchmark harness and retained manifest, layered conformance suite, forbidden-import and private-identifier reviews, exact merge-base/backport evidence, startup/readiness policy-fingerprint behavior, and the Gate 1 evidence index. Record Gate 2–4 prerequisites and deferrals without selecting OD-2, OD-6, or OD-7 or performing any release operation.

**Dependency:** Epics 1 and 2. No future epic is required for the Gate 1 readiness decision.

## Epic 1: Deterministic and Auditable Read-Only Wiki Validation

An authenticated MCP agent can use the standard `/mcp` endpoint to deterministically lint one readable document or an authorized configured Wiki scope, distinguish clean, not-evaluated, incomplete, and failed outcomes, and complete a bounded lint–repair–re-lint loop. Authorized operators receive minimized durable audit evidence without changing lint outcomes or leaking protected information.

### Story 1.1: Establish the Deterministic Result Contract and Closed Rule Registry

As an MCP agent,
I want every lint surface to use one deterministic result and issue contract,
So that I can interpret validation outcomes reliably without parsing prose or depending on a particular client.

**Traceability:**
CAP: CAP-1, CAP-2
FR: FR-1, FR-2, FR-3, FR-5, FR-23
NFR: NFR-22, NFR-23, NFR-24, NFR-25, NFR-26
SM: SM-I1, SM-I2, SM-I7, SM-C1, SM-C2, SM-C6
Gates: Gate 1 evidence contribution only
AD: AD-1, AD-3, AD-4, AD-12, AD-18

**Acceptance Criteria:**

1. **Given** the shared lint core
   **When** its public contracts are inspected
   **Then** `Finding`, `SystemFailure`, `PolicyIdentity`, `EvaluatedScope`, and read-only result types implement the closed algebra adopted in AD-12
   **And** Errors, Warnings, System Failures, completion, cleanliness, and not-evaluated reasons remain structurally distinct.

2. **Given** the initial issue registry
   **When** every registered entry is enumerated
   **Then** it contains exactly the adopted AD-3 Finding and System Failure codes with their fixed meanings, severities, and location kinds
   **And** `POLICY_NOT_CONFIGURED` is represented as a `not_evaluated` reason rather than a System Failure.

3. **Given** configuration-facing rule definitions
   **When** their accepted shape is validated
   **Then** only code-owned registered rule kinds and closed parameter schemas are permitted
   **And** executable code, arbitrary regular expressions, caller-provided issue codes, and severity overrides cannot be represented.

4. **Given** the same normalized findings supplied in different input orders
   **When** deterministic ordering is applied repeatedly
   **Then** each result collection is byte-equivalent and follows the complete AD-4 sort order
   **And** titles, messages, locale, retrieval order, and timing do not affect ordering.

5. **Given** complete, warning-only, error-bearing, incomplete, failed, and not-evaluated fixtures
   **When** result state is derived
   **Then** the state, `complete`, and `clean` values match AD-12 exactly
   **And** Warnings do not prevent clean while every System Failure prevents clean.

6. **Given** canonical Markdown fixtures for every document-structure rule
   **When** the pure rule core evaluates valid and invalid cases
   **Then** it emits the registered stable code and fixed severity for required sections, section order, heading levels, required visible metadata, registered metadata formats, unsupported structures, and discouraged structures
   **And** each Finding uses the most precise truthful one-based location without fabricating a line or relationship.

7. **Given** the pure-core dependency boundary
   **When** the forbidden-import conformance check runs
   **Then** the core imports no Sequelize model, authorization policy, environment/config singleton, queue, Event, cache, logger, clock, network, or storage implementation
   **And** the check fails if any forbidden dependency is introduced.

8. **Given** all story fixtures, examples, messages, and exported contracts
   **When** they are reviewed for portability
   **Then** they contain no pilot collection, document, schema, template, Laura Wiki, or other environment-specific identifier
   **And** they follow the selected baseline's TypeScript and collocated-test conventions without adding a framework or external service.

### Story 1.2: Load and Identify Collection Policy Safely at Startup

As a Wiki operator,
I want collection lint policy to be loaded, validated, and fingerprinted deterministically at startup,
So that every server instance applies an explicit immutable policy and configuration defects cannot silently weaken validation.

**Traceability:**
CAP: CAP-4
FR: FR-11, FR-12, FR-23; configuration prerequisite for FR-13 without implementing write-failure behavior
NFR: NFR-16, NFR-17, NFR-20, NFR-23, NFR-25, NFR-26
SM: SM-I1, SM-I7, SM-C2, SM-C5, SM-C6
Gates: Gate 1 evidence contribution; Gate 4 configuration prerequisite support without selecting OD-2
AD: AD-3, AD-5, AD-6, AD-18, AD-19

**Acceptance Criteria:**

1. **Given** `WIKI_LINT_CONFIG_PATH` is absent
   **When** the server starts
   **Then** startup succeeds with zero Configured Collections
   **And** the immutable policy set represents the explicit no-policy state without embedding a pilot default.

2. **Given** a configuration path is present
   **When** the file is decoded
   **Then** the accepted root envelope is exactly `{ schemaVersion: 1, collections: Record<UUID, CollectionPolicy> }`
   **And** a duplicate-aware decoder rejects duplicate object keys before materialization.

3. **Given** an unreadable file, malformed JSON, unsupported root schema, duplicate root key, or unidentifiable collection key
   **When** startup validation runs
   **Then** startup fails with the applicable adopted stable System Failure
   **And** no partial policy set becomes available.

4. **Given** a parseable schema-version-1 envelope
   **When** collection entries are validated
   **Then** each valid entry requires `activation`, defaults an omitted `runtimeFailureMode` to `closed`, and accepts a non-empty list of unique registered rule kinds with exact closed parameter schemas
   **And** unknown fields, non-integer numbers, severity overrides, arbitrary regular expressions, and client-defined codes invalidate the entry.

5. **Given** one identifiable invalid collection entry alongside valid entries
   **When** the policy set is constructed
   **Then** the invalid entry becomes an immutable fail-closed sentinel for that collection
   **And** valid or absent collections remain unaffected.

6. **Given** any valid or parseable-invalid policy value
   **When** its identity is calculated
   **Then** canonical JSON follows every AD-6 ordering, escaping, integer, Unicode, and no-normalization rule
   **And** the resulting `policyFingerprint`, `invalidFingerprint`, and `policySetFingerprint` use `sha256:<lowercase-hex>` over the prescribed canonical values.

7. **Given** the loaded policy set
   **When** startup health and readiness information is emitted
   **Then** it contains only safe configuration status, activation counts, and `policySetFingerprint`
   **And** a configured `WIKI_LINT_EXPECTED_CONFIG_FINGERPRINT` mismatch prevents readiness without revealing raw configuration.

8. **Given** a running server
   **When** an MCP request or administrative request attempts to alter activation, policy, rule parameters, severity, or runtime-failure mode
   **Then** no request-controlled mutation or override path exists
   **And** policy changes require a configuration change and restart because no watcher, hot reload, or policy mutation API is introduced.

9. **Given** the generic configuration schema, example, tests, and diagnostics
   **When** they are inspected
   **Then** they contain no pilot collection IDs, document IDs, schemas, templates, or fail-open choices
   **And** OD-2 remains explicitly deferred to Gate 4.

### Story 1.3: Lint One Authorized Document for Structural Integrity

As an authenticated MCP agent,
I want to lint the current stored state of one readable document under its collection policy,
So that I can identify deterministic structural defects without changing Wiki state or inferring validation from prose.

**Traceability:**
CAP: CAP-1, CAP-2, CAP-4
FR: FR-1–FR-5, FR-11, FR-12, FR-23
NFR: NFR-1, NFR-6, NFR-8, NFR-10–NFR-12, NFR-18, NFR-19, NFR-22–NFR-26
SM: SM-I1, SM-I2, SM-I4, SM-I7, SM-C1, SM-C2, SM-C4, SM-C6
Gates: Gate 1 evidence contribution only
AD: AD-1, AD-2, AD-4–AD-6, AD-10, AD-12, AD-18, AD-19

**Acceptance Criteria:**

1. **Given** the shared application shell and an authenticated tool context
   **When** integration tests invoke the internal single-document lint orchestration
   **Then** it accepts only the target document identifier from the tool input and obtains policy, authorization, and execution controls from server-owned context
   **And** public `/mcp` discovery remains disabled until every enabled document/link rule and the required read-only audit path pass Story 1.10 acceptance.

2. **Given** an actor-readable document in a valid Configured Collection
   **When** the internal application orchestration evaluates it
   **Then** the adapter obtains the authoritative current content and state from the primary database inside one read-only `REPEATABLE READ` transaction
   **And** canonical Markdown is serialized from authoritative content rather than treating asynchronously refreshed `Document.text` as snapshot authority.

3. **Given** the authorized snapshot
   **When** document rules are evaluated
   **Then** the pure shared core evaluates the complete stored title and body under the immutable collection policy
   **And** all enabled section, order, heading-level, visible-metadata, field-format, unsupported-structure, and discouraged-structure rules use the registry behavior established in Story 1.1.

4. **Given** a structural document evaluation
   **When** its buffered output is assembled internally
   **Then** it uses actor-authorized scope and policy identity, deterministic AD-4 ordering, and truthful safe locations
   **And** the application shell cannot emit an AD-12 `complete` result until every rule enabled by that policy, including link rules, has run successfully.

5. **Given** a readable document outside every Configured Collection
   **When** the internal application orchestration evaluates it
   **Then** it returns `state: not_evaluated`, `complete: false`, `clean: false`, empty issue and policy arrays, and reason `POLICY_NOT_CONFIGURED`
   **And** it does not misrepresent the result as an empty successful lint.

6. **Given** a document whose collection has an identifiable invalid-policy sentinel
   **When** the internal application orchestration evaluates it
   **Then** it returns a safe failed result containing `POLICY_CONFIGURATION_INVALID` and the authorized invalid policy identity
   **And** no raw configuration or unrelated collection state is exposed.

7. **Given** an inaccessible document or invalid tool input
   **When** the internal application orchestration is invoked
   **Then** existing Outline authentication, authorization, and input-error behavior is preserved
   **And** the denial is not converted into a Finding or a modeled validation result that reveals document existence.

8. **Given** a snapshot or canonicalization failure before the document atomic unit completes
   **When** the operation returns a modeled runtime outcome
   **Then** it returns `state: failed`, `complete: false`, `clean: false`, no partial Findings, and the applicable safe System Failure
   **And** an unmodellable failure remains a protocol error as required by AD-12.

9. **Given** any internal single-document lint invocation
   **When** execution completes or fails
   **Then** no document, collection, permission, hierarchy, or other Wiki mutation is performed
   **And** the operation does not grant or imply authority to repair any finding.

10. **Given** identical policy, authorization, request, and stored state
    **When** the internal structural lint orchestration runs repeatedly
    **Then** normalized structural outputs are byte-equivalent after excluding explicitly documented request-correlation metadata
    **And** performance evidence for the NFR-1 Gate 1 budget remains assigned to the reproducible benchmark work rather than being inferred from unit-test timing.

### Story 1.4: Validate Internal Links Without Disclosing Protected Targets

As an authenticated MCP agent,
I want internal document links to be validated through my existing access boundary,
So that I can repair resolvable link defects without learning whether an inaccessible target exists.

**Traceability:**
CAP: CAP-2
FR: FR-2–FR-4, FR-6
NFR: NFR-10–NFR-13, NFR-17, NFR-22–NFR-25
SM: SM-I1, SM-I4, SM-I7, SM-C4
Gates: Gate 1 security-evidence contribution only
AD: AD-1–AD-4, AD-9, AD-10, AD-12, AD-18

**Acceptance Criteria:**

1. **Given** canonical Markdown containing syntactically valid supported Outline document UUID links or URL-identifier links
   **When** `lint_document` extracts internal links
   **Then** each supported identifier is recognized deterministically with a truthful one-based source location
   **And** external URLs, malformed internal-looking URLs outside the supported syntax, fuzzy target guesses, and anchor correctness are not evaluated as unresolved internal targets.

2. **Given** extracted internal identifiers
   **When** the adapter resolves them
   **Then** it uses primary-database, membership-aware, actor-authorized queries within the invocation's point-in-time snapshot
   **And** it does not use an unscoped lookup, replica, cache, network request, or rule-core data access.

3. **Given** a target that is missing, deleted, or inaccessible to the actor
   **When** target state crosses into the pure core
   **Then** every such case is represented by the same `unresolved` value
   **And** the core cannot distinguish the protected underlying cause.

4. **Given** an authorized resolvable target
   **When** the internal-link rule evaluates it
   **Then** no unresolved-target Finding is emitted
   **And** no target content or unrelated metadata is added to the result.

5. **Given** an unresolved internal target
   **When** the rule evaluates it
   **Then** it emits `INTERNAL_LINK_TARGET_UNRESOLVED` at the authorized source document's text location
   **And** the message, path, location, and scope reveal no protected target ID, title, URL identifier, collection, existence state, or metadata.

6. **Given** two actors who may read the source document but have different visibility of a referenced target
   **When** each actor lints the source
   **Then** unauthorized target states remain indistinguishable from other unresolved states
   **And** multi-actor fixtures demonstrate zero protected-information disclosure through findings, System Failures, scope, counts, or diagnostics.

7. **Given** duplicate or differently ordered references to the same targets
   **When** resolution and evaluation complete
   **Then** unique target lookup is batched deterministically while every source occurrence remains independently reportable
   **And** output ordering follows AD-4 regardless of database return order.

8. **Given** the link-rule unit and integration suites
   **When** they run
   **Then** valid, unresolved, deleted, inaccessible, malformed-unsupported, and repeated-link cases assert the stable code, severity, safe location, and evaluated-link count
   **And** all reusable fixtures remain generic and environment-independent.

### Story 1.5: Materialize an Authorized Wiki Scope from One Coherent Snapshot

As an authenticated MCP agent,
I want Wiki linting to observe one authorized coherent snapshot,
So that later rule evaluation cannot mix protected or concurrently changing data.

**Traceability:**
CAP: CAP-3, CAP-4
FR: FR-7, FR-11
NFR: NFR-3, NFR-4, NFR-6, NFR-7, NFR-10, NFR-11, NFR-18, NFR-20, NFR-25, NFR-26
SM: SM-I4, SM-I7, SM-C4, SM-C6
Gates: Gate 1 evidence contribution; Gate 4 read-only capability support without rollout authority
AD: AD-2, AD-5, AD-6, AD-9, AD-10, AD-16, AD-18, AD-19

**Acceptance Criteria:**

1. **Given** the shared application shell and an authenticated tool context
   **When** integration tests invoke internal Wiki snapshot orchestration with or without the approved optional collection identifier
   **Then** policy, activation, failure posture, concurrency, resource limits, and deadline remain server-owned
   **And** public `/mcp` discovery remains disabled until all Wiki rule families, partial-result behavior, and required audit handling pass Story 1.10 acceptance.

2. **Given** an actor-authorized Configured Collection identifier
   **When** internal scoped Wiki snapshot orchestration runs
   **Then** only that collection and its actor-readable rule-required state enter the Evaluated Scope
   **And** existing authorization behavior handles inaccessible collections without exposing their identity through validation output.

3. **Given** no collection identifier
   **When** internal default Wiki snapshot orchestration runs
   **Then** the operation includes only actor-readable Configured Collections and documents
   **And** it neither names nor implies inaccessible collections, documents, targets, or counts.

4. **Given** an authorized lint scope
   **When** the snapshot adapter materializes its input
   **Then** scope, authoritative document content/state, canonical Markdown, authoritative hierarchy, extracted links, and authorized target resolutions are read from the primary database within one read-only `REPEATABLE READ` transaction
   **And** uncached `Collection.documentStructure` is used as hierarchy authority.

5. **Given** snapshot construction is in progress
   **When** all snapshot-dependent lookups complete
   **Then** the transaction commits before pure rule evaluation begins
   **And** no network, storage operation, audit write, or full rule evaluation occurs inside the snapshot transaction.

6. **Given** a scope containing multiple documents and link targets
   **When** the adapter reads it
   **Then** documents use keyset order `(collectionId, id)` in batches of 100 and unique link targets in batches of 500
   **And** request-local maps, transient per-document ASTs, and bounded sequential work replace unbounded `Promise.all`.

7. **Given** the immutable authorized snapshot
   **When** it is handed to the application shell
   **Then** its documents and authorized graph inputs are ordered by the AD-4 identifier keys required for later atomic evaluation
   **And** the adapter itself does not claim completed checks, Findings, or an AD-12 complete result.

8. **Given** concurrent commits after the snapshot has been materialized
   **When** pure evaluation completes
   **Then** the result retains valid point-in-time meaning for the transaction's observed state
   **And** later commits are not mixed into that result.

9. **Given** the server cannot establish the required coherent snapshot
   **When** snapshot construction fails
   **Then** the adapter returns a safe `VALIDATION_RUNTIME_FAILED` failure to the application shell with no partial snapshot
   **And** no caller can convert that failure into a complete or clean result.

10. **Given** a scoped readable collection without configured policy, or a default request with no readable Configured Collections
    **When** snapshot orchestration begins
    **Then** it returns the explicit no-policy state to the application shell without scanning the collection
    **And** unconfigured collections are not silently enrolled.

11. **Given** identical policy, authorization, request, and database state
    **When** snapshot materialization runs repeatedly
    **Then** normalized authorized snapshot inputs, policy identities, scope, counts, and ordering are byte-equivalent
    **And** NFR-3 and NFR-4 timing claims remain reserved for the reproducible Gate 1 benchmark rather than inferred from functional tests.

### Story 1.6: Detect Authorized Hierarchy and Global-Index Defects

As an authenticated MCP agent,
I want Wiki-level hierarchy and configured global-index defects reported from the authorized snapshot,
So that I can repair mechanically proven structural drift without the linter judging logical placement or revealing protected resources.

**Traceability:**
CAP: CAP-3
FR: FR-2, FR-3, FR-7–FR-10
NFR: NFR-6–NFR-8, NFR-10–NFR-12, NFR-22–NFR-25
SM: SM-I1, SM-I2, SM-I4, SM-P2, SM-P3, SM-C1, SM-C4
Gates: Gate 1 evidence contribution; Gate 4 capability support without pilot or rollout claim
AD: AD-2–AD-4, AD-9–AD-12, AD-16, AD-18

**Acceptance Criteria:**

1. **Given** the immutable `WikiSnapshot`
   **When** hierarchy rules run
   **Then** they operate only on actor-authorized graph nodes, edges, publication state, collection identity, and authoritative collection structure
   **And** the pure core receives no inaccessible node, target identity, title, URL identifier, or metadata.

2. **Given** an evaluated document whose parent cannot be safely resolved within its authorized scope
   **When** the parent rule evaluates it
   **Then** it emits `PARENT_DOCUMENT_UNRESOLVED` at a `relationship` location naming only the authorized source document and `relationshipKind: parent`
   **And** missing, deleted, and inaccessible parent states remain indistinguishable.

3. **Given** an authorized hierarchy graph containing a cycle
   **When** cycle detection runs
   **Then** it emits exactly one `HIERARCHY_CYCLE` Finding for each authorized source document proven to participate in the cycle, using that document's parent relationship location
   **And** each such document has one stable rule-local ordinal and repeated evaluation produces the same cardinality, locations, and AD-4 order.

4. **Given** an authorized published document absent from authoritative `Collection.documentStructure`
   **When** the collection-structure rule runs
   **Then** it emits `PUBLISHED_DOCUMENT_MISSING_FROM_STRUCTURE` at the authorized source document's `collection_structure` relationship
   **And** drafts or inaccessible documents do not create unsupported findings.

5. **Given** an authorized parent relationship that crosses collections inconsistently
   **When** the relationship rule runs
   **Then** it emits `PARENT_COLLECTION_MISMATCH` at the authorized source document's parent relationship
   **And** it does not disclose protected parent or collection identity.

6. **Given** a configured surface and explicitly configured global-index documents whose required facts are actor-authorized and resolved
   **When** global-index validation runs
   **Then** every missing direct surface link emits `GLOBAL_INDEX_LINK_MISSING` at the authorized surface document's `global_index` relationship
   **And** transitive links do not satisfy the direct-link requirement.

7. **Given** the surface, a configured global index, or another fact required to prove the global-index condition is inaccessible or unresolved
   **When** the check cannot be completed without disclosure
   **Then** no `GLOBAL_INDEX_LINK_MISSING` Finding is emitted
   **And** the atomic check reports `VALIDATION_RUNTIME_FAILED` at the authorized collection scope, making the overall result incomplete and non-clean without naming the unresolved fact.

8. **Given** a technically valid hierarchy whose placement may appear editorially unusual
   **When** hierarchy evaluation runs
   **Then** no Finding is emitted merely for logical category choice, authority choice, prose meaning, language, relevance, or usefulness
   **And** no semantic classifier or LLM is invoked.

9. **Given** successful document, hierarchy, and global-index atomic units
   **When** the result is assembled
   **Then** `completedChecks`, evaluated counts, policy identities, and scope reflect only fully completed authorized work
   **And** hierarchy precedes global-index evaluation after all document units, as required by AD-11.

10. **Given** valid and defective collection fixtures
    **When** the rule and integration suites run
    **Then** they cover dangling parents, cycles, missing published structure entries, cross-collection parent mismatches, present and absent direct surface links, and inaccessible proving facts
    **And** exact stable codes, fixed severities, safe locations, completeness, and deterministic ordering are asserted.

### Story 1.7: Preserve Safe Work Under Timeouts, Limits, and Isolated Failures

As an authenticated MCP agent,
I want bounded Wiki linting to return every safely completed result when part of the evaluation fails,
So that I can act on useful evidence without mistaking incomplete work for a Clean Result.

**Traceability:**
CAP: CAP-1, CAP-3, CAP-4
FR: FR-1, FR-3, FR-5–FR-12, FR-23
NFR: NFR-3–NFR-8, NFR-10, NFR-11, NFR-22–NFR-26
SM: SM-I1, SM-I2, SM-I5, SM-P7, SM-C1
Gates: Gate 1 reliability and performance-evidence contribution only
AD: AD-1, AD-3, AD-4, AD-9–AD-12, AD-16–AD-18

**Acceptance Criteria:**

1. **Given** any internal `lint_wiki` application invocation
   **When** bounded evaluation begins
   **Then** the server applies a non-client-configurable 60-second hard deadline measured with a monotonic clock
   **And** the `/mcp` transport timeout is configured to allow at least 65 seconds without exposing a request-level override
   **And** injected-clock fixtures prove every snapshot query and bounded stage receives an internal deadline no later than the invocation's remaining time and cannot outlive the hard deadline.

2. **Given** an immutable Wiki snapshot
   **When** evaluation is scheduled
   **Then** atomic units are ordered as every document with all enabled document/link rules, followed by each collection's hierarchy check and then its global-index check, all in AD-4 key order
   **And** each unit buffers its findings until the complete unit succeeds.

3. **Given** the remaining deadline before an atomic unit
   **When** insufficient time remains or the deadline has expired
   **Then** that unit does not start or contributes no partial output
   **And** the result retains the longest fully completed prefix, adds `VALIDATION_TIMEOUT`, and sets `complete: false` and `clean: false`.

4. **Given** a timeout before any atomic unit completes
   **When** the result is assembled
   **Then** its state is `failed`
   **And** a timeout after at least one complete unit produces `incomplete` with only the safe completed findings and counts.

5. **Given** an isolated rule or authorized-resource failure
   **When** later units are independent and safe to execute
   **Then** the operation records the applicable safe System Failure and continues those later units
   **And** no required check is silently suppressed merely because a prior independent unit failed.

6. **Given** one of the adopted process limits is exceeded
   **When** snapshot admission or evaluation detects more than 5,000 documents, 1 MiB UTF-8 Markdown in one document, 64 MiB total Markdown, 100,000 internal-link references, or 10,000 authoritative structure nodes
   **Then** it emits `VALIDATION_RESOURCE_LIMIT_EXCEEDED`, returns `complete: false` and `clean: false`, and retains only fully completed safe units
   **And** if no unit completed, state is `failed` with empty Findings and zero completed counts; otherwise state is `incomplete`, and none of those limits is configurable through policy or MCP input.

7. **Given** one `lint_wiki` is already admitted on a server process
   **When** another invocation requests admission concurrently
   **Then** at most one scan runs on that process and the excess invocation receives the stable resource-limit failure
   **And** the rejected invocation returns `state: failed`, empty Findings, and zero completed counts without introducing an unbounded queue or cross-instance coordination mechanism
   **And** terminal-path fixtures prove the admission slot is released after success, timeout, snapshot failure, resource-limit failure, cancellation, and any other failed completion so the next invocation can be admitted.

8. **Given** incomplete or failed evaluation
   **When** `EvaluatedScope` is returned
   **Then** document/link counts and `completedChecks` include only completed atomic units and actor-authorized identifiers
   **And** no inaccessible or interrupted target is inferred from missing counts.

9. **Given** any Warning, Error, or System Failure combination
   **When** result state is calculated
   **Then** Warnings never affect cleanliness, Errors prevent cleanliness, and every System Failure makes the result incomplete or failed and non-clean
   **And** performance duration itself never becomes a Finding or changes severity.

10. **Given** injected timeout, resource-limit, isolated-rule-failure, global-snapshot-failure, and concurrent-admission fixtures
    **When** the integration suite runs repeatedly
    **Then** state, completeness, safe retained findings, System Failure codes, counts, and ordering are deterministic
    **And** the suite proves no skipped check is hidden as a clean or complete result.

### Story 1.8: Record Minimized and Failure-Isolated Read-Only Audit Evidence

As a Wiki operator,
I want one durable privacy-preserving summary for every read-only lint attempt,
So that I can measure usage and outcomes without storing lint details or making audit health part of agent-facing validation.

**Traceability:**
CAP: CAP-6
FR: FR-19, FR-21, FR-22
NFR: NFR-14, NFR-17, NFR-27
SM: SM-I1, SM-I4, SM-I6, SM-I7, SM-P1, SM-C4, SM-C7
Gates: Gate 1 audit-evidence contribution; Gate 4 measurement support without pilot claim
AD: AD-1, AD-2, AD-14, AD-15, AD-18

**Acceptance Criteria:**

1. **Given** a `lint_document` or `lint_wiki` invocation
   **When** the server establishes request context
   **Then** it generates a server-owned `requestId` and `invocationId`
   **And** the `invocationId` is also the idempotent Event ID for `wikiLint.document` or `wikiLint.wiki`.

2. **Given** normal audit operation
   **When** a clean, findings-bearing, not-evaluated, incomplete, or failed read-only invocation finishes
   **Then** exactly one retrievable summary Event is persisted for that invocation
   **And** retries using the same invocation identity cannot create duplicate summaries.

3. **Given** a read-only audit summary
   **When** its Event data is inspected
   **Then** it contains exactly the applicable closed `AuditDataV1` fields adopted in AD-14
   **And** outcome, completion, duration, scope kind, optional `policySchemaVersion` and `policyFingerprint`, evaluated counts, severity/code aggregates, runtime-fail-open flag, request correlation, and credential type match the actual invocation, with no `invalidFingerprint`, policy array, or additional multi-collection policy field.

4. **Given** any audit payload or Event columns
   **When** privacy conformance fixtures inspect them
   **Then** they contain no bodies, excerpts, diagnostic messages, line/path locations, raw policy configuration, raw request, protected target identity or metadata, or unnecessary document/collection identifiers
   **And** safe scope identifiers use existing Event columns only when authorized and necessary.

5. **Given** API or OAuth authentication
   **When** attribution is written
   **Then** `credentialAuthType` comes from the private authenticated server context, OAuth includes only the `OAuthClient.clientId` bound to the access token, and API authentication omits client identity
   **And** `User-Agent`, MCP client claims, `_meta`, and tool arguments are ignored for attribution.

6. **Given** an authorized audit query
   **When** `events.list` is called with `auditWikiLint`
   **Then** a same-team admin may retrieve only the three adopted Wiki-lint Event names, including the future write-validation name
   **And** existing full `audit` access remains unchanged while unauthorized actors cannot retrieve or infer summaries.

7. **Given** the Event store requires efficient operator queries
   **When** the story's database migration is applied
   **Then** the required `events(teamId, name, createdAt)` index exists
   **And** existing Event retention remains the sole retention mechanism; no second audit subsystem or dashboard is introduced.

8. **Given** any completed read-only functional outcome
   **When** audit persistence runs
   **Then** it runs afterward in an independent transaction
   **And** success or failure cannot alter, reject, roll back, downgrade, or annotate the standard MCP result.

9. **Given** an injected audit-write failure
   **When** audit persistence fails
   **Then** the agent receives the unchanged lint result with no audit-state field or internal diagnostic
   **And** the server emits only a minimized structured operator diagnostic correlated by request/invocation ID.

10. **Given** normal and failure-injected audit tests
    **When** the suite evaluates every read-only outcome class and access role
    **Then** exactly-once behavior, required aggregate fields, prohibited-field absence, authorized retrieval, and unchanged functional outcomes are asserted
    **And** the documented crash-after-completion-before-audit evidence gap remains explicit rather than being hidden or "solved" by widening the lint transaction.

### Story 1.9: Sanitize User-Controlled Editor URLs

As a Wiki user,
I want user-controlled links and media URLs rendered through the approved sanitizer,
So that deterministic Wiki linting does not ship alongside an avoidable unsafe-rendering path.

**Traceability:**
CAP: CAP-2 security boundary support
FR: FR-6 non-disclosure and link-handling support; no new functional scope
NFR: NFR-10, NFR-13, NFR-17, NFR-24–NFR-26
SM: SM-I4, SM-I7, SM-C4
Gates: Gate 1 security-evidence contribution only
AD: AD-18

**Acceptance Criteria:**

1. **Given** every ProseMirror node on the selected baseline whose `toDOM` emits a user-controlled `href` or `src`
   **When** the implementation paths are inspected
   **Then** each emitted value passes through `sanitizeUrl()` or an existing wrapper proven to invoke it
   **And** no affected node bypasses that sanitizer through direct attribute construction.

2. **Given** malicious URL fixtures using unsafe or obfuscated schemes
   **When** affected nodes render through `toDOM`
   **Then** unsafe values are neutralized according to the baseline sanitizer contract
   **And** no executable or unsupported unsafe URL is emitted into the rendered DOM attributes.

3. **Given** supported safe link and media URLs
   **When** affected nodes render through `toDOM`
   **Then** baseline-compatible safe behavior is preserved
   **And** sanitization does not rewrite unrelated document content or change lint Finding semantics.

4. **Given** the rendering conformance suite
   **When** it runs against the exact selected baseline
   **Then** it covers every affected `href` and `src` emission path with both safe and malicious fixtures
   **And** the tests fail if a future code path removes or bypasses the sanitizer.

5. **Given** the scope of this hardening
   **When** implementation is reviewed
   **Then** it introduces no secret scanning, semantic URL classification, fuzzy-link inference, new renderer framework, or post-`v1.10.1` patch-edit backport
   **And** the change remains generic and independent of pilot identifiers.

### Story 1.10: Accept the Complete Read-Only Lint and Repair Loop

As an authenticated MCP agent,
I want the complete audited read-only lint surfaces exposed through the standard endpoint,
So that I can identify, repair, and re-check authorized mechanical Wiki defects before write enforcement is introduced.

**Traceability:**
CAP: CAP-1–CAP-3, CAP-4 read-only/configuration facets, CAP-6
FR: FR-1–FR-10, FR-11–FR-12 read-only/configuration facets, FR-19, FR-21–FR-23
NFR: NFR-6–NFR-8, NFR-10–NFR-14, NFR-16–NFR-27
SM: SM-I1, SM-I2, SM-I4, SM-I6, SM-I7, future Gate 4 prerequisites for SM-P2, SM-P3, and SM-P5 only, SM-C1–SM-C4, SM-C6, SM-C7
Gates: Gate 1 read-only prerequisite evidence; Gate 4 capability support without pilot, configuration, deployment, or rollout claim
AD: AD-1–AD-6, AD-9–AD-12, AD-14–AD-16, AD-18, AD-19

**Acceptance Criteria:**

1. **Given** the complete read-only implementation and its audit path
   **When** an authenticated client performs discovery through the one existing `/mcp` endpoint
   **Then** both `lint_document` and `lint_wiki` are discoverable alongside existing tools with their generic approved inputs
   **And** no second endpoint, client-specific server, prompt, adapter, policy input, or execution-control input is required.

2. **Given** valid, invalid, warning-only, unconfigured, invalid-policy, runtime-failure, timeout, resource-limit, and inaccessible-dependency fixtures for an otherwise authorized invocation
   **When** each applicable read-only tool runs
   **Then** its modeled result uses the exact AD-12 state algebra, stable codes, fixed severities, safe locations, authorized scope, policy identity, counts, completeness, cleanliness, and AD-4 ordering
   **And** invalid tool input or denial of the requested top-level document/collection remains existing protocol `isError` behavior, while inaccessible dependencies are collapsed before entering the core and no enabled rule is silently skipped.

3. **Given** canonical visible metadata in a valid Outline document
   **When** the document passes through the selected baseline's actual Markdown-to-ProseMirror-to-Markdown round trip and is linted
   **Then** required metadata and its one-based diagnostic coordinates remain valid and stable
   **And** YAML front matter receives no special validation semantics without equivalent round-trip evidence.

4. **Given** actors with different document, collection, link-target, and audit visibility
   **When** they run both lint tools and query permitted evidence
   **Then** authorization and access-collapsing fixtures show zero disclosure of protected identities, metadata, content, scope, target state, or audit summaries
   **And** no Finding grants repair authority or widens the actor's logical change batch.

5. **Given** a configured collection containing representative document, link, hierarchy, and global-index Errors
   **When** an authorized agent lints, repairs only resources already within its authority, and re-lints the same scope
   **Then** the final result is `complete: true`, contains zero Errors, and is clean while any remaining Warnings stay visible
   **And** the loop terminates without requiring zero Warnings, semantic judgment, or edits outside the authorized batch.

6. **Given** identical policy, actor authorization, request, and Wiki state
   **When** either read-only tool runs repeatedly
   **Then** normalized responses are byte-equivalent after excluding documented request-correlation metadata
   **And** titles, messages, database return order, locale, timing, and MCP client do not alter classification or ordering.

7. **Given** normal audit operation for every read-only outcome class
   **When** lint execution completes
   **Then** exactly one minimized retrievable summary exists per invocation and matches the functional result's aggregate counts and completion state
   **And** authorized operators can obtain the required aggregate evidence without direct database access.

8. **Given** injected audit persistence failure
   **When** either read-only tool completes
   **Then** its functional result is unchanged and contains no audit-state or internal diagnostic field
   **And** only the minimized correlated operator diagnostic records the evidence gap.

9. **Given** collections without enabled policy
   **When** read-only tools and baseline MCP document operations are exercised
   **Then** lint returns the explicit not-evaluated outcome and baseline create/update behavior and response compatibility remain unchanged
   **And** deployment or tool discovery alone cannot activate collection policy.

10. **Given** the read-only integration and security suite on the selected source baseline
    **When** its evidence is reviewed
    **Then** it proves the exact merge base `4a5a616a21be800257dc11cef4263d0dd0412156`, one-endpoint discovery, shared-core behavior, generic reusable data, every Story 1.9 `toDOM` `href`/`src` sanitization path, and exclusion of the post-`v1.10.1` container-block patch-edit fix
    **And** every explicit later upstream change, if any, is identified as a separately approved and tested backport rather than a merge or rebase.

11. **Given** read-only acceptance has passed
    **When** Epic 1 is closed
    **Then** no MCP create/update hard enforcement has been integrated or enabled by this epic
    **And** AD-17 performance evidence and the complete Gate 1 decision remain in Epic 3, while image publication, deployment, OD-2/OD-6/OD-7 selection, production read-only rollout, and enforced rollout remain separate unfinished approvals.

## Epic 2: Safe Policy-Enforced MCP Document Writes

An authenticated MCP agent can create and update documents in configured collections with deterministic validation of the one complete state that would be persisted. Errors and fail-closed failures reject without visible mutation effects, Warnings remain non-blocking, approved runtime fail-open is unmistakably degraded, and every validation attempt receives minimized isolated audit treatment.

### Story 2.1: Decide Enforcement from Post-Operation Policy

As an authenticated MCP agent,
I want every MCP document write to use one server-owned enforcement decision,
So that validation cannot be bypassed or reclassified by request parameters, handler differences, or collection transitions.

**Traceability:**
CAP: CAP-4, CAP-5
FR: FR-11–FR-13, FR-16, FR-18, FR-23
NFR: NFR-8, NFR-10, NFR-12, NFR-15, NFR-16, NFR-20, NFR-22, NFR-23, NFR-25, NFR-26
SM: SM-I1, SM-I3, SM-I7, SM-C2, SM-C5, SM-C6
Gates: Gate 1 evidence contribution only; no policy or rollout activation
AD: AD-3, AD-5, AD-6, AD-12, AD-13, AD-18, AD-19

**Acceptance Criteria:**

1. **Given** a complete prospective write destination
   **When** policy applicability is selected
   **Then** the lookup uses only the Projected Document's post-operation collection and the immutable startup policy set
   **And** the former collection, request-supplied values, client metadata, and document prose cannot select or override policy.

2. **Given** an unconfigured or `read_only` post-operation collection
   **When** built-in MCP create/update orchestration asks for an enforcement decision
   **Then** the decision preserves the exact baseline write path and response shape without a `validation` field
   **And** hard enforcement remains limited to MCP `create_document` and `update_document`, not UI, direct API, or lower-level shared writers.

3. **Given** an `enforced` post-operation collection with valid policy
   **When** validation classification is supplied to the pure decision function
   **Then** the function applies the exact AD-13 closed/open matrix
   **And** it returns one of `validated`, `validated_with_warnings`, `degraded_validation`, or `rejected` without parsing message prose.

4. **Given** complete validation with no Errors
   **When** there are zero Warnings or one or more Warnings
   **Then** the decision is respectively `validated` or `validated_with_warnings` and permits persistence
   **And** Warning severity cannot be promoted, hidden, or made blocking by collection configuration.

5. **Given** any known Error or invalid configuration
   **When** runtime failure mode is either `closed` or `open`
   **Then** the decision is always `rejected`
   **And** invalid configuration remains a System Failure, never a Finding or fail-open-eligible condition.

6. **Given** a runtime System Failure and no known Error
   **When** policy mode is `closed` or `open`
   **Then** the decision is respectively `rejected` or `degraded_validation` with the triggering safe System Failure
   **And** only `VALIDATION_RUNTIME_FAILED`, `VALIDATION_TIMEOUT`, and `VALIDATION_RESOURCE_LIMIT_EXCEEDED` are fail-open eligible.

7. **Given** authorization, input, conflict, persistence, policy-fingerprint mismatch, or audit failure
   **When** the write path classifies it
   **Then** it is not eligible for runtime fail-open
   **And** audit failure remains outside the functional write decision entirely.

8. **Given** direct-collection create, parent-derived create, an existing collected-document update, a collectionless-draft update without publication, collectionless-draft publication, and unpublish with retained collection
   **When** each reachable destination-selection path is evaluated across absent policy, valid `read_only`, valid `enforced`, and identifiable invalid-policy states where applicable
   **Then** the selected policy and write behavior use only the closed post-operation collection inventory in the amended PRD
   **And** `collectionId` cannot move an already collected document, unpublish is not treated as leave-scope, and a collectionless update without publication remains at `null` with baseline response and no configured-write validation audit.

9. **Given** an authorized collectionless draft containing a stable known Error
   **When** `update_document` attempts to publish it into a destination with valid `enforced` policy
   **Then** validation rejects before publication, the draft's collection and publication state remain unchanged, and no successful mutation signal is emitted
   **And** exactly the required minimized rejection audit is attempted without exposing content or protected state.

10. **Given** an in-scope create/update whose post-operation destination is unconfigured, `read_only`, or an identifiable invalid-policy sentinel
    **When** applicability is resolved
    **Then** unconfigured and `read_only` destinations retain baseline write behavior and response shape without a validation field or configured-write validation audit attempt
    **And** an invalid-policy destination fails closed with the approved System Failure, while authorization failures retain protocol behavior and are never Findings or fail-open admissions.

11. **Given** authorized `move_document` and `restore_document` collection changes among `enforced`, unconfigured, `read_only`, and identifiable invalid-policy scopes
    **When** every direction permitted by baseline authorization is exercised with content that would be invalid under an enforced destination policy
    **Then** baseline authorization, persistence, response shape, and mutation-event behavior remain unchanged, with no validation field or configured-write validation-audit summary
    **And** the fixtures are labeled compatibility evidence only, never Projected Document or CAP-5 enforcement evidence, and no lint enforcement is added to either tool.

12. **Given** out-of-band drift after a permitted move or restore
    **When** subsequent read-only evaluation is requested
    **Then** `lint_wiki` can detect the drift only for a destination with valid configured policy inside the actor-authorized Evaluated Scope
    **And** unconfigured and invalid-policy destinations retain their approved not-evaluated or System Failure behavior without a false clean result.

### Story 2.2: Project the Complete Markdown Document Once

As an authenticated MCP agent,
I want Markdown creates and updates validated against the exact complete state they would persist,
So that valid-looking fragments cannot bypass policy and validation cannot drift from the eventual write.

**Traceability:**
CAP: CAP-5
FR: FR-11, FR-14, FR-15, FR-17
NFR: NFR-8–NFR-10, NFR-18, NFR-20, NFR-22, NFR-24, NFR-26
SM: SM-I1, SM-I3, SM-I7, SM-C1
Gates: Gate 1 projection-parity evidence contribution only
AD: AD-1, AD-2, AD-7, AD-8, AD-18

**Acceptance Criteria:**

1. **Given** an authorized Markdown create or update request prepared by the application shell
   **When** projection runs
   **Then** it produces one immutable `ProjectedDocument` containing final title, canonical body/content/state, post-operation collection and parent, publication state, and rule-required relationships
   **And** projection creates no document, Attachment row, mutation Event, activity, or externally accessible blob.

2. **Given** a Markdown create with or without a selected template
   **When** its projection is built
   **Then** template substitution, explicit field precedence, canonical Markdown/ProseMirror conversion, collection/parent placement, and publish state match the exact selected-baseline writer semantics
   **And** template use never substitutes for linting the resulting complete projection.

3. **Given** `replace`, `append`, `prepend`, or `patch` update input
   **When** its projection is built
   **Then** the resulting title and complete body use the exact selected-baseline transformation semantics for that mode
   **And** unchanged policy-relevant content is included rather than validating only the incoming fragment.

4. **Given** the selected `v1.10.1^{}` patch behavior
   **When** parity fixtures exercise supported patch edits, including baseline container-block behavior
   **Then** projection matches commit `4a5a616a21be800257dc11cef4263d0dd0412156`
   **And** the post-`v1.10.1` container-block patch-edit fix is neither copied nor assumed.

5. **Given** any create or update that changes destination or publication state
   **When** the projection is complete
   **Then** policy applicability uses its post-operation collection
   **And** final parent, publication, content, and relationships are available to every enabled rule before persistence.

6. **Given** a projection accepted for persistence
   **When** the write orchestration later materializes it
   **Then** it stores the already validated projection without reapplying the edit or re-running conversion
   **And** any changed transaction-time assumption requires rebuilding and revalidating rather than mutating the accepted projection.

7. **Given** projection failure, invalid input, or a baseline transformation conflict
   **When** projection cannot complete
   **Then** existing input/conflict behavior is preserved outside the lint Finding algebra
   **And** no partial document or externally visible effect is produced.

8. **Given** collocated projection-parity tests
   **When** they compare the projection with the actual baseline writer for create, templates, publish/unpublish, title-only changes, and every update mode
   **Then** final canonical title/body/state/relationships are identical for supported inputs
   **And** the fixtures remain generic and record no pilot schema or identifiers.

### Story 2.3: Enforce Markdown Creates and Updates Atomically

As an authenticated MCP agent,
I want enforced Markdown creates and updates to validate and commit as one authorized operation,
So that rejected writes leave the prior externally visible state unchanged while permitted writes persist exactly what was validated.

**Traceability:**
CAP: CAP-4, CAP-5
FR: FR-11–FR-18, FR-23
NFR: NFR-2, NFR-8–NFR-12, NFR-15, NFR-18–NFR-26
SM: SM-I1, SM-I3, SM-I4, SM-I7, SM-C1, SM-C2, SM-C4–SM-C6
Gates: Gate 1 atomicity and compatibility evidence contribution only
AD: AD-1, AD-2, AD-5–AD-9, AD-12, AD-13, AD-17, AD-18

**Acceptance Criteria:**

1. **Given** a built-in MCP create/update whose post-operation collection has `activation: enforced`
   **When** write orchestration begins
   **Then** enforcement uses the immutable policy selected in Story 2.1 and the shared core accepted in Epic 1
   **And** `read_only` and unconfigured destinations remain on the unchanged baseline path.

2. **Given** an enforced Markdown write prepared outside the transaction
   **When** the authoritative write phase begins
   **Then** one primary-database transaction re-fetches and re-authorizes every mutation input, and update locks the target document row
   **And** slow conversion or other prepared work remains outside while every assumption is revalidated inside.

3. **Given** valid transaction-time assumptions
   **When** the write is evaluated
   **Then** the transaction builds the authoritative complete projection, reads required related state, runs the shared engine, and applies the Story 2.1 decision matrix
   **And** success persists exactly that projection through existing save/publish hooks without reapplying the edit.

4. **Given** representative enforced writes
   **When** integration fixtures execute create with template/published/draft variants and update with `replace`, `append`, `prepend`, `patch`, title-only, publish, and unpublish variants
   **Then** every operation validates the full resulting title/body/state/relationships under the post-operation policy
   **And** a valid-looking fragment cannot hide an Error in unchanged content.

5. **Given** zero Errors, Warnings only, a known Error, invalid configuration, or a runtime-only System Failure
   **When** the central decision is applied
   **Then** persistence and rollback match AD-13 exactly, including eligible `degraded_validation` only for explicit per-collection `open` mode
   **And** no MCP argument can request, widen, or override fail-open.

6. **Given** validation rejection
   **When** the transaction rolls back
   **Then** a rejected create leaves no document and a rejected update preserves prior content, state, relationships, and revision
   **And** no Attachment row, activity, successful mutation Event, or other externally visible successful-write effect remains.

7. **Given** authorization, input, conflict, or persistence failure
   **When** it occurs before or during the write transaction
   **Then** existing upstream/protocol semantics and rollback behavior are preserved
   **And** the failure cannot become a Finding, `degraded_validation`, or runtime fail-open admission.

8. **Given** UI, direct-API, or lower-level shared writer paths
   **When** they create or update documents
   **Then** this story adds no hard lint enforcement to those paths
   **And** collocated transaction, row-lock, rollback, and concurrent-update tests prove the MCP-only boundary while benchmarkable baseline/enabled paths remain available for Epic 3's NFR-2 measurement.

9. **Given** two actors whose enforced projections reference the same missing, deleted, or differently accessible target
   **When** create/update validation resolves related state
   **Then** adapters collapse inaccessible target state before it reaches the shared core and return only safe source-document findings or System Failures
   **And** multi-actor fixtures on create and every update mode prove zero disclosure of protected target identity or metadata on the write surface.

### Story 2.4: Preserve Exact MCP Write Responses and Baseline Compatibility

As an MCP agent,
I want configured write responses to expose one explicit validation outcome while unchanged scopes preserve baseline responses,
So that I can branch on stable machine-readable state without client-specific inference or compatibility regressions.

**Traceability:**
CAP: CAP-4, CAP-5
FR: FR-11–FR-13, FR-16, FR-18, FR-23
NFR: NFR-15, NFR-19, NFR-20, NFR-22–NFR-26
SM: SM-I1, SM-I2, SM-I7, SM-C2, SM-C5, SM-C6
Gates: Gate 1 response-compatibility evidence contribution only
AD: AD-3–AD-6, AD-12, AD-13, AD-18, AD-19

**Acceptance Criteria:**

1. **Given** an enforced write that commits with no Warnings or with Warnings
   **When** the MCP result is assembled
   **Then** all baseline document fields are preserved and one exact `validation` object is added with status `validated` or `validated_with_warnings`
   **And** its schema version, policy fingerprint, and ordered Finding/System Failure arrays follow AD-12.

2. **Given** an enforced patch update that commits
   **When** the MCP result is assembled
   **Then** the baseline final-Markdown content block remains present and retains its meaning
   **And** `validation` is added without replacing, reinterpreting, or applying the post-`v1.10.1` patch fix to that block.

3. **Given** a policy rejection
   **When** the MCP result is returned
   **Then** it is a modeled `{ success: false, validation }` result with status `rejected`
   **And** it contains no nonexistent document fields and does not use protocol `isError` for the modeled rejection.

4. **Given** an eligible runtime-only failure admitted through explicit `open` policy
   **When** the write commits
   **Then** status is `degraded_validation`, the safe triggering System Failure is returned, and that status dominates any Warnings
   **And** invalid configuration, known Errors, authorization, input, conflict, persistence, and audit failures can never produce this status.

5. **Given** an unconfigured or `read_only` post-operation collection
   **When** create/update succeeds or fails
   **Then** no `validation` field or write-validation audit attempt is added
   **And** baseline response fields, modeled/protocol error behavior, and upstream compatibility remain unchanged.

6. **Given** any supported MCP client
   **When** it discovers and invokes document write tools
   **Then** the same existing `/mcp` endpoint and tool names are used
   **And** no client-specific endpoint, response adapter, prompt, or duplicated policy contract is introduced.

7. **Given** repeated identical write-decision fixtures
   **When** responses are normalized
   **Then** status, codes, severities, locations, System Failures, and ordering are deterministic
   **And** clients never need to parse diagnostic prose or absence of fields to infer an enforced outcome.

**Known binding contradictions:** The amended PRD requires `read_only` destinations to preserve baseline write behavior with no Validation Status or configured-write validation audit, while its glossary and FR-14 through FR-16 still apply those contracts to every Configured Collection, including valid `read_only` policy. Separately, AD-6 permits an invalid entry to expose only `invalidFingerprint`, while AD-12's exact enforced-write response requires `validation.policyFingerprint` and defines no invalid-policy identity variant. These contradictions cannot be resolved in a story without changing higher-authority sources. Gate 1 remains `not ready` until separately authorized source amendments reconcile both contracts and the affected stories are replanned.

### Story 2.5: Carry Enforced HTML Projection Through Trusted Worker Intent

As an authenticated MCP agent,
I want enforced HTML creates carried through a server-owned authenticated worker intent,
So that asynchronous processing cannot trust client claims or materialize against stale policy and authorization.

**Traceability:**
CAP: CAP-4, CAP-5
FR: FR-11–FR-18, FR-23
NFR: NFR-8–NFR-12, NFR-15, NFR-17, NFR-20, NFR-22–NFR-26
SM: SM-I1, SM-I3, SM-I4, SM-I7, SM-C4, SM-C5
Gates: Gate 1 worker authorization and projection evidence contribution only
AD: AD-1, AD-2, AD-7, AD-8, AD-12, AD-13, AD-18

**Acceptance Criteria:**

1. **Given** the shared HTML import job
   **When** callers use the existing baseline API/import mode
   **Then** its behavior and payload contract remain unchanged
   **And** only trusted server orchestration can select the new MCP-enforced intent.

2. **Given** an MCP-enforced HTML job
   **When** its payload is constructed
   **Then** it carries only request/invocation IDs, `actorId`, `sourceIp`, expected policy fingerprint, and `{ credentialAuthType: "api" }` or `{ credentialAuthType: "oauth", authenticatedClientId }`
   **And** it carries no access/API token, secret, cookie, authorization header, or client-claimed identity.

3. **Given** an enforced job received by the worker
   **When** processing begins
   **Then** the worker reloads the actor, re-authorizes the destination, and compares the current policy fingerprint with the expected fingerprint
   **And** authorization denial follows existing behavior while a mismatch is `POLICY_CONFIGURATION_INVALID` and always fails closed.

4. **Given** authorized text-only HTML or prepared inaccessible media handles
   **When** worker projection runs
   **Then** canonical conversion produces one complete `ProjectedDocument` including final title/body/state/destination and relationship placeholders
   **And** the worker runs the shared engine and Story 2.1 decision without trusting asynchronously refreshed text or reapplying conversion later.

5. **Given** a validated permitted text-only HTML create
   **When** the primary transaction commits
   **Then** it revalidates destination authorization and expected policy fingerprint, persists the exact validated projection, and emits success only after commit
   **And** the worker returns the document ID plus the exact structured validation outcome.

6. **Given** text-only worker success, rejection, authorization denial, fingerprint mismatch, projection failure, or transaction rollback
   **When** integration fixtures run
   **Then** document persistence and structured outcomes match the synchronous enforced contract without duplicate documents, activities, or mutation Events
   **And** baseline API/import mode and unconfigured/read-only behavior remain unchanged.

7. **Given** worker conformance review
   **When** the implementation is inspected
   **Then** client input cannot select enforced intent or supply identity/policy authority, and no access credential crosses the job boundary
   **And** the story does not import the post-`v1.10.1` container-block patch-edit fix.

### Story 2.6: Materialize Staged Media Without Visible Partial Effects

As an authenticated MCP agent,
I want imported media to remain inaccessible until its validated HTML document commits,
So that rejection, retry, cleanup failure, or worker crashes cannot create duplicate or visible orphaned effects.

**Traceability:**
CAP: CAP-5
FR: FR-14, FR-16, FR-17
NFR: NFR-8–NFR-10, NFR-17, NFR-24–NFR-26
SM: SM-I1, SM-I3, SM-I4, SM-I7, SM-C1, SM-C4
Gates: Gate 1 media atomicity evidence contribution only
AD: AD-7, AD-8, AD-18

**Acceptance Criteria:**

1. **Given** an enforced HTML create containing importable media
   **When** media preparation begins
   **Then** every blob is staged under the server-owned `invocationId` and remains inaccessible through Outline
   **And** no committed Attachment row or public attachment ownership exists before validation permits materialization.

2. **Given** staged media handles
   **When** Story 2.5 projects and validates the complete HTML document
   **Then** attachment relationships participate in the one Projected Document and shared-rule evaluation
   **And** no blob is promoted merely because conversion or staging succeeded.

3. **Given** a permitted HTML create
   **When** the primary transaction commits
   **Then** each blob transfers ownership only with its corresponding Attachment row commit and the exact validated document projection
   **And** document, attachments, activity, mutation Event, and structured success become externally visible only after commit.

4. **Given** rejection, authorization failure, fingerprint mismatch, projection failure, transaction rollback, or an abandoned pre-commit invocation
   **When** cleanup or recovery runs
   **Then** staged blobs are reclaimed idempotently by `invocationId` and no document, Attachment row, activity, or successful mutation Event becomes visible
   **And** cleanup failure leaves only an inaccessible staged blob plus minimized operator diagnostics for deterministic later reclamation.

5. **Given** worker retry before commit or replay after commit-before-ack under the same `invocationId`
   **When** the job runs again
   **Then** it returns or resumes the single logical outcome without duplicating documents, Attachment rows, stored blobs, activities, or mutation Events
   **And** idempotency never converts an earlier rejection into success.

6. **Given** failure injection at every stage, projection, validation, materialization, commit, cleanup, and acknowledgement boundary
   **When** the media lifecycle suite runs
   **Then** it proves zero accessible rejected-write effects, eventual idempotent reclamation of abandoned staged data, and exactly one committed object set after retry/replay
   **And** unconfigured/read-only HTML import behavior remains baseline-compatible.

### Story 2.7: Record Correlated and Failure-Isolated Write-Validation Audit Evidence

As a Wiki operator,
I want one minimized durable summary for every enforced write-validation attempt,
So that successful, rejected, and degraded writes are accountable without making audit persistence part of write correctness.

**Traceability:**
CAP: CAP-6
FR: FR-20–FR-22
NFR: NFR-14, NFR-15, NFR-17, NFR-27
SM: SM-I1, SM-I6, SM-I7, SM-C4, SM-C7
Gates: Gate 1 audit-evidence contribution; Gate 4 measurement support without pilot claim
AD: AD-14, AD-15, AD-18

**Acceptance Criteria:**

1. **Given** any enforced create/update validation attempt
   **When** its functional outcome is `validated`, `validated_with_warnings`, `degraded_validation`, or `rejected` by an Error, invalid configuration, or runtime System Failure
   **Then** normal audit operation persists exactly one idempotent `wikiLint.write_validation` Event
   **And** `invocationId` is its Event ID and the server-generated `requestId` provides request correlation.

2. **Given** a write-validation audit Event
   **When** its payload is inspected
   **Then** it conforms exactly to closed `AuditDataV1`, including actual status/outcome, completion, duration, safe scope, optional policy fields, aggregate counts, runtime-fail-open flag, and trusted credential attribution
   **And** no body, excerpt, message, location, protected target, raw request/configuration, secret, invalid fingerprint, or extra policy array is persisted.

3. **Given** a successfully committed enforced mutation
   **When** the baseline mutation Event is emitted
   **Then** its data adds only `validationCorrelationId = invocationId`
   **And** the independent write-validation summary can be correlated without copying lint detail.

4. **Given** a rejected validation attempt
   **When** rejection rollback completes
   **Then** its write-validation summary is attempted while no successful document mutation Event exists
   **And** the summary is evidence of rejection, never an externally visible write effect.

5. **Given** a committed, degraded, or rejected functional outcome
   **When** audit persistence runs
   **Then** it runs after commit or rejection rollback in an independent transaction
   **And** audit success or failure cannot commit, reject, roll back, downgrade, or admit the write.

6. **Given** injected audit persistence failure
   **When** the MCP write result is returned
   **Then** the result remains unchanged and exposes no audit state or internal diagnostic
   **And** only a minimized structured operator diagnostic records request/invocation correlation.

7. **Given** an authorized operator query
   **When** `auditWikiLint` retrieves write-validation summaries
   **Then** the same-team-admin restriction, adopted Event names, existing retention, and prohibited-field guarantees from Story 1.8 remain intact
   **And** unauthorized actors cannot retrieve summaries or infer rejected protected targets.

8. **Given** normal and failure-injected write-audit fixtures
   **When** they cover every status and audit failure
   **Then** exactly-once behavior, correlation, aggregate correctness, minimization, authorization, and unchanged functional outcomes are asserted
   **And** the crash-after-commit-before-audit evidence gap remains explicit rather than widening the mutation transaction.

## Epic 3: Inspectable Implementation Readiness

The Wiki operator can make an evidence-backed Gate 1 decision using reproducible performance, security, compatibility, determinism, atomicity, audit, and generic-data evidence produced on the exact selected baseline, while later publication, deployment, read-only rollout, and enforced rollout remain separate and unauthorized.

### Story 3.1: Verify Safe Startup and Readiness Policy Identity

As a Wiki operator,
I want every serving instance to prove its immutable policy-set identity safely,
So that deployment alone cannot activate policy and mixed-policy instances cannot participate in one rollout.

**Traceability:**
CAP: CAP-4
FR: FR-11–FR-13, FR-23
NFR: NFR-12, NFR-16, NFR-17, NFR-20, NFR-25, NFR-26
SM: SM-I1, SM-I7, SM-C2, SM-C5, SM-C6
Gates: Gate 1 evidence; future Gate 3 and Gate 4 prerequisites only
AD: AD-5, AD-6, AD-19

**Acceptance Criteria:**

1. **Given** no `WIKI_LINT_CONFIG_PATH`
   **When** a production build starts
   **Then** startup succeeds with zero Configured Collections and no active enforcement
   **And** deployment, `/mcp` discovery, or image contents cannot enroll a collection.

2. **Given** any loaded policy set
   **When** startup and readiness state are inspected
   **Then** they expose only safe configuration status, activation counts, and `policySetFingerprint`
   **And** raw policy, private collection/document IDs, rules, parameters, and invalid-entry detail are not exposed.

3. **Given** absent, matching, or mismatching `WIKI_LINT_EXPECTED_CONFIG_FINGERPRINT`
   **When** readiness is evaluated
   **Then** absence preserves approved optional behavior, a match passes this check, and a mismatch prevents readiness
   **And** mismatch never weakens policy or enables runtime fail-open.

4. **Given** two serving instances for one prospective rollout
   **When** their readiness evidence is compared with the same expected fingerprint
   **Then** only instances reporting that exact policy-set fingerprint can become ready
   **And** no hot reload, watcher, admin mutation API, or cross-instance policy coordinator is introduced.

5. **Given** the built artifact and generic configuration materials
   **When** they are inspected
   **Then** they contain implementation, generic schema, and generic examples only, with no pilot policy or environment-specific identifiers
   **And** policy changes still require a read-only mount change and restart.

6. **Given** completion of this story
   **When** its authority is assessed
   **Then** it selects no OD-2 or OD-7 value and performs no image publication, deployment, configuration mount, or rollout
   **And** it supplies evidence only for Gate 1 and later gate prerequisites.

### Story 3.2: Close Layered Conformance and Source-Provenance Evidence

As a Wiki operator,
I want one reproducible conformance suite tied to the exact approved source,
So that completeness, security, compatibility, and portability claims are inspectable rather than inferred from implementation structure.

**Traceability:**
CAP: CAP-1–CAP-6
FR: FR-1–FR-23
NFR: NFR-6–NFR-27
SM: SM-I1–SM-I4, SM-I6, SM-I7, SM-C1–SM-C7
Gates: Gate 1 evidence only
AD: AD-17–AD-19

**Acceptance Criteria:**

1. **Given** a clean supported verification environment
   **When** the retained conformance command runs
   **Then** it executes the AD-18 pure-core, forbidden-import, configuration/fingerprint/duplicate-key, projection-parity, metadata round-trip, multi-actor disclosure, lock/rollback/snapshot-concurrency, HTML-worker/media, audit, unconfigured/read-only compatibility, single-`/mcp` discovery, and URL-sanitization layers
   **And** every command, result, and raw evidence location is recorded.

2. **Given** the binding requirement inventory
   **When** coverage is generated
   **Then** every CAP, FR, NFR-6–NFR-27, SM-I1–SM-I4, SM-I6–SM-I7, and SM-C1–SM-C7 maps to concrete tests, fixtures, source review, or an explicit unresolved gap
   **And** no missing or failed evidence is represented as passed.

3. **Given** repeated deterministic fixtures
   **When** the suite runs multiple times
   **Then** normalized classifications, codes, severities, locations, completeness, counts, and ordering are identical
   **And** passing cannot be achieved by skipping checks, changing severity, hiding Warnings, broadening authority, normalizing fail-open, or introducing a client-specific fork.

4. **Given** dependency and seam review
   **When** core imports and test injection points are inspected
   **Then** the AD-1 forbidden-import boundary holds and only the minimal snapshot reader, deadline/clock, audit writer, and media stager seams permitted by AD-18 exist
   **And** a source-layout assertion proves every Gate 1 test is collocated with the code it covers under baseline conventions, with no new test directory, parallel framework tree, or external service.

5. **Given** reusable source, interfaces, tool descriptions, examples, fixtures, and generic documentation
   **When** private-identifier review runs
   **Then** zero pilot-environment identifiers or assumptions are found
   **And** the review scope excludes binding private source documents themselves rather than misclassifying their required references as reusable-code leakage.

6. **Given** source-provenance evidence
   **When** it is inspected
   **Then** merge-base is exactly `4a5a616a21be800257dc11cef4263d0dd0412156`, no merge/rebase from `upstream/main` occurred, and every separately approved/tested backport is listed or the inventory says `none`
   **And** exclusion of the post-`v1.10.1` container-block patch-edit fix is proven.

7. **Given** successful local build and conformance results
   **When** this story completes
   **Then** they are retained as Gate 1 evidence with baseline toolchain and exact commands
   **And** they do not publish an image, mutate an environment, deploy, or authorize rollout.

### Story 3.3: Produce Reproducible Performance and Growth Evidence

As a Wiki operator,
I want performance budgets measured on the adopted reproducible reference profile,
So that Gate 1 latency and growth decisions use inspectable evidence rather than incidental developer-machine timing.

**Traceability:**
CAP: CAP-1, CAP-3–CAP-5
FR: supporting evidence for FR-4, FR-7, FR-14, FR-15
NFR: NFR-1–NFR-5, NFR-8, NFR-20, NFR-22
SM: SM-I5, SM-C1, SM-C2, SM-C5
Gates: Gate 1 performance evidence only
AD: AD-16–AD-18

**Acceptance Criteria:**

1. **Given** the deterministic seeded fixture generator
   **When** it creates reference datasets
   **Then** profiles are exactly 3 collections/150 documents and 10 collections/1,000 documents, average eight internal links per document, Markdown median/p95/max 8/32/128 KiB, hierarchy depth at most 12, and coverage of every rule/resolution class
   **And** seed and dataset hash are stable and retained.

2. **Given** the benchmark harness
   **When** it provisions the reference profile
   **Then** it uses a production build on Linux x86-64 with app limited to two dedicated vCPU/4 GiB and PostgreSQL 14.2 to two dedicated vCPU/4 GiB/local SSD on the same host, baseline Node/Yarn, no artificial latency, and no competing traffic
   **And** deviations invalidate rather than silently qualify the Gate 1 measurement.

3. **Given** each benchmark case
   **When** measurements run
   **Then** they use five warmups, 40 sequential warm-cache samples, nearest-rank p95 at `ceil(0.95*N)`, one cold run, and peak-RSS/query/document/link-normalized reporting
   **And** concurrent-writer latency during snapshot assembly is recorded.

4. **Given** the stratified `lint_document` profile
   **When** 20 median-size, 16 p95-size, and four max-size documents with eight links each are measured
   **Then** p95 is at most one second
   **And** every sample retains equivalent rule scope and result semantics.

5. **Given** the 150- and 1,000-document `lint_wiki` profiles
   **When** they are measured
   **Then** the 150-document nearest-rank p95 is at most 10 seconds and every measured 1,000-document run is at most 60 seconds
   **And** normalized runtime, peak working-set memory, query, document, and link costs are reported with any increase explained.

6. **Given** paired baseline and lint-enabled Markdown writes
   **When** create and every update mode are measured on the same fixtures
   **Then** validation overhead p95 is at most 500 milliseconds and baseline/enabled timings are reported separately
   **And** HTML/import performance is reported separately without substituting for the required Markdown comparison.

7. **Given** completed benchmark runs
   **When** the retained manifest is inspected
   **Then** it includes source commit, local unpublished image digest, fixture-generator commit/seed/dataset hash, policy fingerprint, Node/Yarn/PostgreSQL versions, CPU/kernel/container limits, relevant DB settings, exact command, warmups, and sample count
   **And** every measured raw timing, RSS, and query sample value is retained, while the local digest remains benchmark identity only and not Gate 2 publication.

8. **Given** a budget breach or optimization
   **When** the lint result is evaluated
   **Then** timing never becomes a Finding, changes severity, reduces required checks, or narrows authorized scope
   **And** a true timeout/incomplete execution remains a System Failure under the functional contract.

### Story 3.4: Assemble the Gate 1 Evidence Index and Decision Record

As a Wiki operator,
I want one complete evidence index with an explicit readiness decision,
So that implementation readiness cannot be confused with image publication, deployment, or production rollout.

**Traceability:**
CAP: CAP-1–CAP-6
FR: FR-1–FR-23
NFR: NFR-1–NFR-27
SM: SM-I1–SM-I7, SM-C1–SM-C7; SM-P1–SM-P7 explicitly deferred to Gate 4 without claiming pilot evidence
Gates: Gate 1 decision and explicit separation from Gate 2–Gate 4
AD: AD-1–AD-19 evidence index, with AD-17–AD-19 governing readiness and gate separation

**Acceptance Criteria:**

1. **Given** completed implementation evidence
   **When** the English evidence index is assembled
   **Then** every binding CAP, FR, NFR, SM-I, SM-C, Gate 1 condition, and AD-1–AD-19 decision links to a test, benchmark, fixture, manifest, source review, or explicit unresolved gap
   **And** each entry records the exact command, source revision, result, and raw evidence location.

2. **Given** the Gate 1 decision
   **When** readiness is evaluated
   **Then** `ready` is permitted only when SM-I1–SM-I7 and every phase-blocking requirement have passed with inspectable evidence
   **And** any missing, failed, contradictory, or unverified claim produces `not ready` without a silent waiver.

3. **Given** the retained decision record
   **When** it is reviewed
   **Then** it includes the exact baseline and merge-base, explicit backport inventory, generic-data review, startup/readiness fingerprint result, conformance results, and AD-17 benchmark manifest
   **And** it records the crash-after-functional-completion-before-audit evidence gap without changing functional outcomes.

4. **Given** the amended collection-applicability acceptance contract
   **When** Gate 1 evidence is assessed
   **Then** the complete closed destination-selection inventory is linked to selector and tool-level fixtures for every applicable policy state
   **And** `move_document` and `restore_document` evidence is labeled non-enforcement compatibility evidence, with no lint hook, validation field, configured-write validation audit, or CAP-5 coverage claim added to either tool.

5. **Given** the unresolved `read_only` applicability and invalid-policy identity contradictions
   **When** the Gate 1 decision is assembled
   **Then** each contradiction is linked to the exact PRD and Architecture Spine clauses and is recorded as phase-blocking rather than silently resolved in implementation
   **And** Gate 1 remains `not ready` until separately authorized source amendments are reconciled into the stories and evidence plan.

6. **Given** Gate 1 evidence is complete or incomplete
   **When** the record states its decision
   **Then** Gate 2 image publication, Gate 3 deployment, and Gate 4 read-only/enforced rollout remain separately approved and unauthorized
   **And** no image is pushed, environment changed, deployment performed, pilot policy mounted, or collection policy enabled.

7. **Given** the deferred operational decisions
   **When** later-gate prerequisites are listed
   **Then** OD-2, OD-6, and OD-7 retain their approved owners and revisit gates without invented environment-specific values
   **And** the index does not claim SM-P1–SM-P7 pilot evidence or production success.
