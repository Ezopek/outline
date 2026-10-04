---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
  - step-03-create-stories
  - step-04-final-validation
inputDocuments:
  - AGENTS.md
  - server/tools/README.md
  - _bmad-output/specs/spec-outline-mcp-wiki-linting/SPEC.md
  - _bmad-output/planning-artifacts/prds/prd-outline-2026-09-20/prd.md
  - _bmad-output/planning-artifacts/prds/prd-outline-2026-09-20/addendum.md
  - _bmad-output/planning-artifacts/architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md
replanInputs:
  - _bmad-output/planning-artifacts/prds/prd-outline-2026-09-20/amendment-proposal-prd-spine-alignment.md
  - _bmad-output/planning-artifacts/prds/prd-outline-2026-09-20/amendment-proposal-residuals-ri4-ri6.md
  - _bmad-output/planning-artifacts/prds/prd-outline-2026-09-20/amendment-proposal-residuals-ri1-ri3.md
replanned: 2026-10-01
changeRecord: _bmad-output/planning-artifacts/sprint-change-proposal-2026-10-01.md
amended: 2026-10-02
amendmentRecord: _bmad-output/planning-artifacts/sprint-change-proposal-2026-10-02.md
---

# outline - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for deterministic Wiki linting in the built-in Outline MCP server, decomposing the approved PRD, its technical addendum, the adopted Architecture Spine, the lean feature specification, and repository contracts into independently reviewable implementation work.

**Replan status (2026-10-01).** The breakdown was replanned against the final PRD and addendum, the Architecture Spine with AD-1 through AD-20, and the SPEC, using the replan tables of the three applied amendment proposals listed in the frontmatter. No PRD and spine conflict remains open: C-1 to C-7 and RI-1 to RI-4 and RI-6 are closed by applied amendments, and RI-5 concerns only lower-authority README and AGENTS wording. Stories 1.3, 1.4, 1.5, and 1.10 fix the D-9 tool contracts and the recognized internal-link forms. The D-9 write-eligibility constants, `lint_wiki` stop margin, and `SET LOCAL` floor stay explicit evidence tasks that Story 3.3 fixes from AD-17 evidence. Gate 1 is `not ready`: it requires implementation evidence that does not exist yet. The change record is `sprint-change-proposal-2026-10-01.md`.

**Amendment (2026-10-02).** Stories 1.3, 1.5, 1.6, 1.7, 1.10, 3.2, and 3.4, the AD-9, AD-10, AD-11, and AD-16 summaries, and the Epic 1 implementation note follow the spine amendment of 2026-10-02, which decided the three architect items of `sprint-change-proposal-2026-10-01.md` §4.6: a snapshot batch refused below the `SET LOCAL` floor is `VALIDATION_TIMEOUT` on every read surface; collection-graph checks require `can(actor, "readDocument", collection)`; and the `lint_wiki` admission order is fixed. The change record is `sprint-change-proposal-2026-10-02.md`.

## Requirements Inventory

### Functional Requirements

- **FR-1 — Result classification and clean-state semantics:** Return Errors, Warnings, and System Failures as distinct machine-readable classes, report completion explicitly, and treat only a complete zero-Error evaluation as clean; any System Failure makes a read-only result incomplete or failed, and policy-not-configured is an explicit not-evaluated outcome.
- **FR-2 — Stable finding identity and safe location:** Every Finding contains a stable issue code, fixed severity, safe message, and the most precise authorized location without fabricated source positions.
- **FR-3 — Deterministic ordering:** Identical policy, authorization, request, and Wiki state produce identical Findings in identical identifier- and location-based order, independent of titles, prose, retrieval order, locale, or timing.
- **FR-4 — Authorized document inspection:** An authenticated actor may lint a readable stored document under its collection policy using only the authorized related state that enabled rules require; an inaccessible document is handled through existing access boundaries and never exposed through lint diagnostics; a document whose collection is `null` or has no Policy Configuration entry is not evaluated, and a document in an Invalid-Policy Collection returns the FR-12 System Failure.
- **FR-5 — Deterministic document-structure rules:** Configured document lint covers required sections and order, allowed heading levels, required visible metadata, registered field syntax, and configured unsupported Markdown structures without inferring policy or type from prose.
- **FR-6 — Access-aware internal-link validation:** Validate supported Outline document IDs and URL IDs while collapsing missing, deleted, and inaccessible targets whenever distinction would leak protected information; fuzzy and anchor inference are excluded.
- **FR-7 — Authorized Wiki scope:** `lint_wiki` evaluates one actor-accessible collection (a Configured Collection is linted, an Invalid-Policy Collection is reported under FR-12, and any other collection is not evaluated) or, by default, every actor-readable Configured Collection plus each readable Invalid-Policy Collection, and reports only the safely Evaluated Scope.
- **FR-8 — Technical hierarchy integrity:** Detect dangling parents, cycles, published documents missing from collection structure, and cross-collection parent inconsistencies without judging logical placement.
- **FR-9 — Configured global-index integrity:** Verify that each configured surface directly links to every explicitly configured global-index document, without inferring which documents should be indexes and without disclosing protected facts.
- **FR-10 — Partial read-only evaluation:** Preserve safe completed findings and continue independent checks after isolated runtime failures, while returning separate System Failures, `complete: false`, and never a Clean Result.
- **FR-11 — Per-collection policy applicability:** Enable policy only through server-side per-collection configuration; select write applicability from the Projected Document's post-operation collection; validate Enforced Writes into Enforced Collections before persistence, while a write whose post-operation collection is not an Enforced Collection is never blocked by a former collection's policy; return not evaluated only for a read-only request whose actor-readable scope holds neither a Configured nor an Invalid-Policy Collection, where that scope is the document's collection for `lint_document` even when the actor cannot read the collection itself, and the readable requested collection or the readable collections for `lint_wiki`; and keep upstream behavior and response compatibility for every write that is not an Enforced Write (post-operation collection `null`, without a policy entry, or `read_only`).
- **FR-12 — Invalid configuration handling:** Invalid Policy Configuration yields a stable distinct System Failure, never becomes a Finding, never permits fail-open, fails every Enforced Write in its scope closed, and never yields a clean or not-evaluated read-only result; a read-only scope containing an Invalid-Policy Collection reports this System Failure, or a generic runtime System Failure when the collection's readability cannot be established, with collection and policy identity only as NFR-11 allows; a defect that prevents identifying the covered collections stops startup with a stable code and a non-secret location and no configuration content; a configuration System Failure is an operator escalation, not an agent-repairable Finding.
- **FR-13 — Runtime validation failure handling:** Runtime validation failures fail Enforced Writes closed by default and may fail open only through immutable per-collection policy, never through MCP input; failures of the write's own authorization, locking, transformation, media staging, model validation, persistence, or commit, and any failure that leaves the write's transaction unusable, are not runtime validation failures and never fail open; a write is admitted through fail-open only when it commits and then returns `degraded_validation`, while a fail-open write whose commit cannot be established or whose status cannot be recovered returns the FR-16 Tool-Execution Error instead.
- **FR-14 — Create enforcement:** Validate the complete Projected Document of a `create_document` Enforced Write into an Enforced Collection before persistence; reject known Errors and fail-closed System Failures while still applying upstream checks; templates never substitute for validation.
- **FR-15 — Complete update enforcement:** For an `update_document` Enforced Write into an Enforced Collection, validate one complete Projected Document for `replace`, `append`, `prepend`, and `patch` using the selected baseline's exact transformation semantics, including unchanged policy-relevant content.
- **FR-16 — Explicit configured-write outcome:** Every Enforced Write response exposes exactly one of `validated`, `validated_with_warnings`, `degraded_validation`, or `rejected`, except three cases without a Validation Status: a detected post-operation collection change (Tool-Execution Error with a stable error identifier), an abort or unestablished outcome (Tool-Execution Error), and a classification failure (baseline behavior or a Tool-Execution Error with the fixed generic message); a committed write keeps its status when optional response details fail, and an HTML create status recovered by a later lookup or probe may carry empty Error and Warning collections.
- **FR-17 — No partial or externally visible rejected-write effects:** A rejected create leaves no document and a rejected update preserves prior state; a rolled-back aborted attempt persists nothing and emits no successful-mutation signal; an attempt that cannot establish its own commit withholds post-commit signals; only the required minimized rejection audit is permitted.
- **FR-18 — Initial enforcement boundary:** Hard validation applies only to built-in MCP `create_document` and `update_document`; UI, direct API, lower-level writers, `move_document`, and `restore_document` remain outside this increment, with collection-changing move/restore fixtures proving unchanged baseline behavior without counting as CAP-5 evidence.
- **FR-19 — Read-only lint audit summary:** Every `lint_document` and `lint_wiki` invocation that returns a lint result, including not-evaluated, incomplete, and failed outcomes, attempts exactly one durable, retrievable, actor- and scope-attributable minimized summary under normal audit operation; policy version and fingerprint appear only for a one-collection or one-document scope under a valid policy; an invocation that ends in a Tool-Execution Error records none.
- **FR-20 — Configured-write validation audit summary:** Every Enforced Write Validation Attempt, including rejections, Invalid-Policy Collection rejections, and established aborts, attempts exactly one durable minimized summary under normal audit operation, correlated with mutation events when applicable; degraded validation is identifiable in the durable record; an Invalid-Policy Collection rejection records its stable System Failure code and no valid or invalid policy fingerprint; aborted attempts record before- or after-decision outcomes with zero counts; an attempt whose outcome the server cannot establish records no request-path summary, which is an accepted evidence gap.
- **FR-21 — Audit minimization and authorized retrieval:** Reuse Outline's authorized Event/audit surface and retention; persist aggregate evidence only; the audited scope is the actor-authorized scope for reads and the classified post-operation collection (with the written document when its row exists) for Enforced Writes, whether or not the writing actor can read that collection; authorized operators calculate required measures without direct database access.
- **FR-22 — Audit failure isolation:** Audit persistence failure never changes lint or write outcomes and never appears in the standard MCP response, except the one named case in which a lost HTML import-job result plus a missing committed audit summary is reported as an unestablished outcome; failures produce only minimized correlated operator diagnostics.
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
- **NFR-9 — Rejected-write atomicity:** Validation rejection, and a Validation Attempt that aborts and is rolled back under the second FR-16 exception, preserve the pre-operation externally visible state for every supported create and update path.
- **NFR-10 — Existing security boundaries:** Preserve baseline authentication, authorization, transaction, and information-disclosure boundaries on every lint and enforcement path.
- **NFR-11 — Least disclosure:** Findings, scope summaries, System Failures, logs, and metrics reveal no content, identity, or metadata inaccessible to the current actor; durable audit summaries are operator evidence governed by FR-21. Two exceptions are accepted. First, an actor who may read or write a document but cannot read its collection may learn that collection's policy class, never its identity, fingerprint, or policy content. Second, a Finding for a missing required section, a missing required metadata field, or a missing required global-index link may name the missing item to an actor who can read the collection, and only to that actor. The name is limited to the configured heading, field name, or the readable index document, and never extends to other policy content, fingerprints, or collection identity beyond what the actor may already read.
- **NFR-12 — No authority expansion:** Findings are diagnostic only and never grant write authority, broaden a batch, bypass single-writer coordination, or authorize repair.
- **NFR-13 — Safe rendering:** User-controlled `href` and `src` emitted through ProseMirror `toDOM` use the baseline-approved `sanitizeUrl()` path.
- **NFR-14 — Durable structured evidence:** Under normal audit operation, existing authorized Event/audit capabilities expose counts, durations, completion, statuses, severity/code aggregates, and System Failure codes.
- **NFR-15 — Degraded-validation signal:** Every runtime fail-open write returns agent-visible degraded status and, under normal audit operation, emits a durable operator-visible event; a write whose outcome the server cannot establish is an audit evidence gap, not a breach.
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
- **NFR-27 — Observation failure isolation:** Added audit-path failure is operator-observable but never changes validation semantics, blocks functional operations, or reaches standard agent-facing responses, except the one FR-22 exception.

### Additional Requirements

#### Capability and delivery constraints

- **CAP-1:** Provide one deterministic machine-readable result contract with stable codes, fixed severities, safe locations, completeness, clean-state semantics, and deterministic ordering across all lint surfaces.
- **CAP-2:** Provide read-only linting of one readable document under collection policy, with full configured document/link rule coverage, non-disclosure, round-trip evidence, and no durable effect except the minimized audit summary.
- **CAP-3:** Provide authorized scoped/default Wiki linting that covers document, hierarchy, and global-index rules, retains safe partial work, supports bounded lint-repair-re-lint, and never labels incomplete work clean.
- **CAP-4:** Provide explicit per-collection policy with upstream behavior outside configured scope, fail-closed invalid configuration, default fail-closed runtime behavior for eligible failures, fail-open only through immutable per-collection policy with `degraded_validation`, and immutable issue severity.
- **CAP-5:** Validate creates and every update mode into Enforced Collections against one full Projected Document using post-operation collection policy, allow Warnings, block Errors/fail-closed failures, and prevent externally visible partial effects.
- **CAP-6:** Provide exactly one minimized authorized aggregate audit summary per lint invocation that returns a lint result and per Validation Attempt whose outcome is established, including invalid-policy rejections and aborted attempts, under normal operation, with failure isolation and correlated operator diagnostics; PRD FR-22 names the one exception.
- Read-only linting and its audit evidence must be implemented and accepted before integrating write enforcement in the same initial implementation.
- Implementation readiness, image publication, deployment, read-only production rollout, and enforced production rollout are distinct approval boundaries; completing a prior stage grants no authority for the next.
- Keep OD-2 (pilot policy values), OD-6 (pilot clients/evidence procedure), and OD-7 (release-operation details) deferred to their assigned Gate 4, Gate 4, and Gate 2/3 decisions respectively; do not invent their values.
- Do not implement semantic/editorial judgment, LLM-backed classification, private-payload scanning, fuzzy/anchor inference, inferred batch boundaries, per-mutation `_log` requirements, batch orchestration, broader writer enforcement, a new telemetry platform/dashboard, image publication, deployment, migration, or rollout authorization.
- **D-9 (spine Deferred):** the lint tool input schemas, annotations, and token-scope gating and the exact recognized internal-link forms are fixed by Stories 1.3, 1.4, 1.5, and 1.10 before Gate 1; the two AD-13 write-eligibility constants, the AD-11 `lint_wiki` stop margin, and the AD-11 `SET LOCAL` floor are code-owned constants whose values Story 3.3 fixes from AD-17 evidence before Gate 1; the crash-orphaned staged-blob sweeper and the AD-16 1 MiB per-document cap against the baseline 1,536,000-character document limit are revisited only if pilot evidence shows accumulation or a legal document blocked from a complete `lint_wiki`.
- D-4 to D-8 stay outside this increment: no broader writer enforcement (D-4), anchor/fuzzy/semantic/secret/statistics rules (D-5), durable audit outbox (D-6), parallel evaluation or cross-instance admission (D-7), or baseline upgrade/backport, including the separately reported baseline authorization gaps on publication and creation paths (D-8).

#### Adopted Architecture Spine decisions

- **AD-1 — Functional Core, Imperative Shell [ADOPTED]:** One pure core owns deterministic contracts and rule behavior; the application shell, adapters, and existing handlers/workers own authorization, data access, sequencing, transactions, timeouts, media, audit, and responses; the core imports no Sequelize model, policy, environment/config singleton, queue, Event, cache, logger, clock, network, or storage implementation.
- **AD-2 — Authorized data boundary [ADOPTED]:** The core receives only validated immutable policy, a full `ProjectedDocument` or authorized `WikiSnapshot`, canonical syntax with safe locations, an access-collapsed link map, and an evaluation context/deadline; adapters collapse missing, deleted, and inaccessible targets to one `unresolved` value.
- **AD-3 — Closed rule and issue registry [ADOPTED]:** A code-owned discriminated registry defines every rule kind, parameter validator, fixed severity, emitted code, location kind, surface, check membership, and meaning, including the startup-only `POLICY_SCHEMA_VERSION_UNSUPPORTED` and `POLICY_CONFIGURATION_MALFORMED`, the `POLICY_NOT_CONFIGURED` not-evaluated reason, and the `collection_conflict` tool-execution error identifier; configuration cannot supply code, regex, codes, or severity overrides; one code-owned link-extraction function serves every surface, with recognized forms fixed by fixtures (D-9); `VALIDATION_TIMEOUT` is limited to snapshot construction, unit evaluation, write P5 after it began, and the `lint_wiki` stop margin.
- **AD-4 — Safe locations and deterministic order [ADOPTED]:** Exactly the `text`, `document`, `relationship`, and `scope` locations, with one-based LF-only code-point coordinates over the exact `toMarkdown(document, { includeTitle: false })` string from one position-producing component; only actor-authorized identifiers, `collectionId` only when the actor can read the collection, and the pre-allocated ID for creates; bytewise sort by collection ID, document ID, line, column, path, location-kind rank, code, and rule-local ordinal.
- **AD-5 — Startup-loaded policy configuration [ADOPTED]:** Optional `WIKI_LINT_CONFIG_PATH` names one schema-version-1 JSON file of at most 64 KiB, read once by each service's master, decoded by a custom raw-byte duplicate-aware decoder that reports entry byte spans, and passed as exact bytes to forked workers; root-level malformed, unsupported-schema, duplicate, or unidentifiable-key defects block startup; each identifiable invalid entry becomes a collection-local fail-closed sentinel.
- **AD-6 — Policy identity and lifecycle [ADOPTED]:** Canonical-JSON `policyFingerprint` over registry-normalized valid entries, `invalidFingerprint` over an invalid entry's exact source bytes, and `policySetFingerprint` over the sorted valid/invalid set (the empty set when no file is configured); raw configuration is never returned or logged; a rollout is complete only when every serving instance reports the expected set fingerprint.
- **AD-7 — One side-effect-free Projected Document [ADOPTED]:** An enforced write classified under a valid `enforced` policy builds one complete projection with exact baseline semantics, validates and persists it once, uses the per-attempt `stage -> project -> validate -> materialize` media protocol with final-key staging and pre-allocated Attachment IDs, pre-allocates a create's document ID at classification, and runs enforced HTML creation as a distinct worker task with a trusted intent, a closed result union, lookup-first idempotence, `committedFromSummary` status recovery, and a `deadlineAt` wait bound.
- **AD-8 — Enforced-write transaction and concurrency [ADOPTED]:** Each Enforced Write is classified once at request time, keyed on the baseline-resolved post-operation collection, as valid `enforced` or invalid-policy sentinel; a sentinel is rejected after baseline pre-write steps with no transaction or projection; a valid `enforced` write runs in one primary-DB `READ COMMITTED` transaction that locks the classified collection and then the updated document row, re-fetches, re-authorizes, projects, validates under savepointed related-state reads, and persists; a changed post-operation collection is the `collection_conflict` tool-execution error; `read_only`, unconfigured, move, and restore writes keep baseline behavior.
- **AD-9 — Minimal authorized WikiSnapshot [ADOPTED]:** A dedicated adapter loads only actor-readable configured scope and rule-required fields from the primary DB with membership-aware batch resolution and uncached `Collection.documentStructure`; `lint_wiki` evaluates readable published, non-archived, non-deleted documents and `lint_document` any readable non-deleted document; parents and targets resolve for the actor beyond the evaluated scope; a global-index Error requires every proving fact to be authorized and resolved, and only provable surface/index pairs yield Findings; collection-graph checks (hierarchy and global-index) also require `can(actor, "readDocument", collection)` and otherwise yield the generic `VALIDATION_RUNTIME_FAILED` without reading that collection's structure.
- **AD-10 — One point-in-time snapshot per `lint_wiki` [ADOPTED]:** Each `lint_wiki`, and `lint_document` for its dependencies, materializes all required authorized input in one primary-DB `REPEATABLE READ` transaction with explicit `SET TRANSACTION READ ONLY`, commits before evaluation, never treats asynchronously refreshed `Document.text` as authority, and returns `VALIDATION_RUNTIME_FAILED`, or `VALIDATION_TIMEOUT` when the deadline expired or a batch was refused below the `SET LOCAL` floor, with `complete: false` when the snapshot cannot be established; `lint_document` completes its lookup, authorization, and collection-readability check, whose failure only withholds identity, before the first batch and re-reads the document's collection and deletion state inside the snapshot.
- **AD-11 — Server-owned timeout and partial-result semantics [ADOPTED]:** Code-owned bounds: a 60-second `lint_wiki` deadline with a `/mcp` socket-timeout override of at least 65 seconds; a shared 9-second validation deadline for `lint_document` and enforced writes; 30-second preparation, 9-second persistence (including a 2-second probe), 3-second audit, and 2-second post-commit bounds; `SET LOCAL` timeouts from the monotonic remainder with a code-owned floor; ordered atomic units with prefix semantics (finished units keep their Findings, including units that carry a System Failure) and vacuous-check semantics (a vacuous check counts as completed, except a graph check of a collection marked `graphAuthorized: false`; graph checks exist only on `lint_wiki`), a code-owned stop margin, retained Findings, and one System Failure per (unit, code); every surface's bound sum is at most 63 seconds; pre-scope steps run in a short `SET LOCAL`-bounded read-only transaction, return one indistinguishable missing-or-denied error, and use the fixed message for non-application failures.
- **AD-12 — Explicit result algebra [ADOPTED]:** The closed `Finding`, `SystemFailure`, `PolicyIdentity` (valid or invalid), `EvaluatedScope`, read-only state (with `reason` only for `not_evaluated`), and enforced-write `validation` contracts; policy, sentinel, and collection identity appear only under `can(actor, "read", collection)`; a readable sentinel adds one zero-count System Failure; post-commit enrichments are optional; `isError` is reserved for invalid calls, denials, and unmodellable failures, including the AD-20 tool-execution errors; a collection whose readability cannot be established follows AD-10 and AD-11.
- **AD-13 — Central write-decision matrix [ADOPTED]:** One pure function applies the closed/open matrix; only `VALIDATION_RUNTIME_FAILED`, `VALIDATION_TIMEOUT`, and `VALIDATION_RESOURCE_LIMIT_EXCEEDED` are fail-open eligible, with timeout and runtime failures further limited to projected documents within two code-owned write-eligibility constants and, for timeout, P5 entered with at least half the validation deadline remaining; `degraded_validation` dominates Warnings; an Error-only rejection is a complete write summary.
- **AD-14 — Minimized durable Event summaries [ADOPTED]:** At most one idempotent Event summary per invocation under `wikiLint.document`, `wikiLint.wiki`, or `wikiLint.write_validation`, exactly one except for `isError` reads, AD-20 rows 1, 2, and 7, and audit failure; `invocationId` is the Event ID; the closed actor-independent `AuditDataV1` with read outcome mapping, write `scopeKind: collection`, policy-field presence rules, policy-configuration and aborted payloads, and committed-over-aborted replacement; `validationCorrelationId` on writer mutation Events; an insert in an independent transaction that suppresses only the global-queue enqueue and keeps IP normalization; an additive concurrent `events(teamId, name, createdAt)` index.
- **AD-15 — Narrow audit access and failure isolation [ADOPTED]:** Add `auditWikiLint` same-team-admin retrieval limited to the three names, kept in a new constant outside `AUDIT_EVENTS` and `ACTIVITY_EVENTS`; propagate only trustworthy server-derived `credentialAuthType` and OAuth client attribution; run audit persistence after completion, rejection, or abort rollback in an independent transaction awaited with a 3-second bound; isolate failures to correlated minimized operator diagnostics; crash-after-commit-before-audit and AD-20 row 7 remain explicit evidence gaps.
- **AD-16 — Bounded query and memory plan [ADOPTED]:** Use keyset order `(collectionId, id)`, batches of 100 documents and 500 unique link targets, request-local maps, transient ASTs, one concurrent `lint_wiki` scan per process admitted in a fixed order (scoped lookup and `read` first; sentinel, unconfigured, and empty-policy-set requests without admission; admission before enumeration and the snapshot), and code-owned `lint_wiki` limits of 5,000 documents, 1 MiB Markdown per document, 64 MiB total Markdown, 100,000 internal-link references, and 10,000 structure nodes; `lint_document` and write validation add no size cap beyond the baseline limit, and the AD-13 write-eligibility constants are separate.
- **AD-17 — Reproducible performance gate [ADOPTED]:** Use the specified production-build Linux/PostgreSQL 14.2 resource profile with Node exactly the Dockerfile runner version, deterministic seeded 150/1,000-document datasets, the stratified 40-document `lint_document` profile, warmup/sample/nearest-rank p95 method, paired baseline/enabled write tests, raw evidence, and a retained manifest that includes process-topology settings; the D-9 constants, stop margin, and floor are fixed from this evidence.
- **AD-18 — Layered conformance evidence [ADOPTED]:** Provide the complete collocated AD-18 layer list, including pure-core, dependency, configuration/fingerprint and startup-diagnostic, read-only sentinel matrix, identity omission, one fixture per AD-20 row, COMMIT probe and callback buffering, HTML-worker and media, `/mcp` timeout, discovery per token scope, projection parity, round-trip, multi-actor disclosure, lock/rollback/snapshot concurrency, audit, compatibility, and URL-sanitization evidence, using only minimal injected seams, plus exact baseline/backport proof, including the AD-16 admission order, the below-floor snapshot timeout on both read surfaces, graph checks without `readDocument`, pre-scope lookups, and timeout-prefix fixtures.
- **AD-19 — Deployment does not enable policy [ADOPTED]:** Ship generic implementation/schema/example without pilot policy; use an optional read-only mounted configuration with restart-only changes; log operator-only startup status, counts, set fingerprint, per-sentinel detail, and one code and byte location before any startup-fatal exit; require the expected fingerprint whenever any entry is valid `enforced` or a sentinel; report readiness through a health-endpoint extension; enforce single-fingerprint rollout and separate approvals.
- **AD-20 — Post-classification failure and audit boundary [ADOPTED]:** A validation attempt runs from classification through phases P0 to P8 and ends in exactly one of seven rows that fixes its agent result and summary outcome (none, `aborted_before_decision`, `rejected`, `aborted_after_decision`, or a committed status); COMMIT is detected with an unmanaged transaction and a fresh-connection probe; `afterCommit` callbacks are buffered and run only when the attempt establishes its own commit; non-application failures return the fixed message `The operation could not be completed`.
- The structural seed is `server/wikiLint/{core,application,adapters}`, `server/tools/wikiLint.ts`, and the existing `server/tools/documents.ts`; tests remain collocated and no parallel framework tree is introduced.
- Use the baseline's declared Node/Yarn/TypeScript/MCP SDK/Sequelize/Zod/markdown-it/PostgreSQL versions, keep markdown-it at `linkify: false` in any new instance, and add no framework or external service.

#### Success measures and approval gates

- **SM-I1 through SM-I7:** Gate 1 evidence must prove full FR/capability coverage, deterministic outcomes, write safety, zero disclosure regressions beyond the policy class and the readability-gated missing-item names NFR-11 permits, all performance/growth evidence, one minimized audit summary under normal operation per lint invocation that returns a lint result and per Validation Attempt whose outcome the server establishes, with isolated audit failure (FR-22 names the one exception), single-endpoint compatibility, unconfigured parity, and generic reusable artifacts.
- **SM-P1 through SM-P7:** Product support and later Gate 4 evidence must cover client-equivalent representative use, complete zero-Error batch closure, bounded repair/re-lint, zero confirmed false blocking or disclosure regression beyond the NFR-11 policy class and readability-gated missing-item names, review of every degraded write, and live performance triage; implementation does not itself claim pilot completion.
- **SM-C1 through SM-C7:** Evidence and implementation must not achieve success by skipping checks, weakening severity, chasing zero Warnings, expanding authority, normalizing fail-open, creating client-specific forks, or letting audit coverage change validation outcomes, block functional operations, or expose internal audit failures in ordinary MCP responses (FR-22 names the one exception).
- **Gate 1 — Implementation Readiness:** Require the exact baseline, SM-I1–SM-I7, resolved blocking decisions including the fixed D-9 items, generic artifacts, and explicit evidence for any separately approved backport; exit authorizes only consideration of publication.
- **Gate 2 — Image Publication:** Remains separately approved and requires immutable build identity, provenance, review, smoke evidence, registry boundary, and rollback identifier; it is not authorized by these implementation stories.
- **Gate 3 — Deployment:** Remains separately approved and requires target-specific backup/restore/rollback, digest, configuration/migration review, compatibility/discovery/audit smoke checks, and no automatic policy activation; it is not authorized by these implementation stories.
- **Gate 4 — Production Rollout:** Remains separately approved and ordered as policy validation, named read-only enablement, clean scoped lint, full pilot evidence, operator review, explicit enforcement approval, and post-enable/rollback verification; these stories may build the required capabilities but must not choose OD-2, OD-6, or OD-7 or perform rollout.

### UX Design Requirements

Not applicable. This increment adds no UI or administrative interface, and no UX design contract exists. Standard MCP responses and existing authorized audit surfaces are governed by the PRD and Architecture Spine.

### FR Coverage Map

- **FR-1:** Epic 1 — explicit deterministic result classification and clean-state semantics; Epic 3 verifies the normalized contract.
- **FR-2:** Epic 1 — stable finding identity and safe locations; Epic 3 verifies disclosure-safe fixtures.
- **FR-3:** Epic 1 — deterministic ordering; Epic 3 verifies repeatability.
- **FR-4:** Epic 1 — authorized `lint_document` inspection, including the `null`/no-entry not-evaluated outcome and the Invalid-Policy Collection System Failure for collection readers and document-only readers.
- **FR-5:** Epic 1 — configured deterministic document-structure rules.
- **FR-6:** Epic 1 — access-aware internal-link validation through one shared link-extraction function with fixture-fixed recognized forms, also used by the global-index check; Epic 2 applies it on the write surface.
- **FR-7:** Epic 1 — authorized scoped and default `lint_wiki` operation, including readable Invalid-Policy Collections.
- **FR-8:** Epic 1 — technical hierarchy integrity.
- **FR-9:** Epic 1 — configured global-index integrity.
- **FR-10:** Epic 1 — safe partial read-only evaluation.
- **FR-11:** Epic 1 — per-collection read-only applicability and not-evaluated scope; Epic 2 — request-time post-operation classification and write compatibility.
- **FR-12:** Epic 1 — invalid-policy loading, startup-fatal diagnostics, and read-only sentinel behavior; Epic 2 — unconditional fail-closed sentinel writes; Epic 3 — startup and readiness evidence.
- **FR-13:** Epic 2 — default runtime fail-closed, eligibility-bounded per-collection fail-open, and admission only on established commit.
- **FR-14:** Epic 2 — complete create projection enforcement.
- **FR-15:** Epic 2 — complete update projection enforcement for every supported mode.
- **FR-16:** Epic 2 — explicit Validation Status and the three Tool-Execution Error exceptions, optional post-commit enrichments, and recovered HTML status.
- **FR-17:** Epic 2 — no partial or externally visible rejected-write or aborted-write effects, including buffered post-commit callbacks.
- **FR-18:** Epic 2 — MCP-only enforcement on built-in create/update, with explicit non-enforcement compatibility evidence for collection-changing `move_document` and `restore_document` paths and no widening of lower-level writers.
- **FR-19:** Epic 1 — one minimized audit summary per read-only lint invocation that returns a lint result, with the narrowed policy-field rule.
- **FR-20:** Epic 2 — one minimized audit summary per Validation Attempt whose outcome is established, including aborted and invalid-policy outcomes.
- **FR-21:** Epic 1 — minimized authorized read-only audit retrieval; Epic 2 — actor-independent write-validation audit and retrieval.
- **FR-22:** Epic 1 and Epic 2 — audit failure isolation on every applicable surface; Epic 2 — the one named HTML exception.
- **FR-23:** Epic 1 — closed fixed-severity registry and invalid override handling; Epic 2 — identical severity semantics in write enforcement.
- **FR-1 through FR-23:** Epic 3 — cross-cutting implementation-readiness verification without adding or weakening product behavior.

## Epic List

### Epic 1: Deterministic and Auditable Read-Only Wiki Validation

An authenticated MCP agent can use the standard `/mcp` endpoint to deterministically lint one readable document or an authorized configured Wiki scope, distinguish clean, not-evaluated, incomplete, and failed outcomes, and complete a bounded lint–repair–re-lint loop. Invalid collection policy is reported as an operator escalation rather than as clean or not evaluated. Authorized operators receive minimized durable audit evidence without changing lint outcomes or leaking protected information.

**FRs covered:** FR-1–FR-12, FR-19, FR-21–FR-23

**Primary capabilities:** CAP-1–CAP-4, CAP-6

**Implementation notes:** Deliver the shared pure rule/result core, startup policy loading, sentinels, identity, and startup-fatal diagnostics, authorized point-in-time snapshots, deterministic document/link/hierarchy/global-index evaluation, the read-only invalid-policy sentinel behavior, the fixed lint tool contracts and link forms (D-9), read-only MCP tools, and their isolated audit path. This epic must be accepted before write enforcement is integrated. The three architect items recorded by the 2026-10-01 replan were decided in the spine amendment of 2026-10-02 and are carried by Stories 1.3, 1.5, 1.6, and 1.7.

**Dependency:** None. This epic delivers complete standalone read-only product value and enables later enforcement.

### Epic 2: Safe Policy-Enforced MCP Document Writes

An authenticated MCP agent can create and update documents in Enforced Collections with deterministic validation of the one complete state that would be persisted. Errors and fail-closed failures reject without visible mutation effects, writes into Invalid-Policy Collections fail closed, Warnings remain non-blocking, approved runtime fail-open is unmistakably degraded, aborted attempts never present as validation outcomes, and every Validation Attempt whose outcome is established receives minimized isolated audit treatment.

**FRs covered:** FR-6 (write surface), FR-11–FR-18, FR-20–FR-23

**Primary capabilities:** CAP-4–CAP-6

**Implementation notes:** Reuse the accepted Epic 1 engine and registry; add request-time classification with the `readable` flag and pre-allocated document ID, the invalid-policy sentinel path, exact baseline projection for create/templates/publish and every update mode, the AD-20 phase and row model, transactional locking/re-authorization/persistence with the COMMIT probe and buffered post-commit callbacks, the central decision matrix with write-eligibility inputs, response integration, the distinct enforced HTML worker task, per-attempt staged media, and actor-independent write-validation audit correlation. Preserve exact read-only and unconfigured baseline behavior.

**Dependency:** Epic 1. No later epic is required for the enforced-write capability to function.

### Epic 3: Inspectable Implementation Readiness

The Wiki operator can make an evidence-backed Gate 1 decision using reproducible performance, security, compatibility, determinism, atomicity, audit, and generic-data evidence produced on the exact selected baseline, while later publication, deployment, read-only rollout, and enforced rollout remain separate and unauthorized.

**FRs covered:** Cross-cutting verification of FR-1–FR-23; no new product scope. Story 3.1 implements the AD-19 readiness behavior that the operator gates depend on.

**Primary requirements:** NFR-1–NFR-27, AD-17–AD-20, SM-I1–SM-I7, SM-C1–SM-C7, Gate 1

**Implementation notes:** Complete the adopted benchmark harness and retained manifest, the D-9 constant, margin, and floor derivations, the layered AD-18 conformance suite, forbidden-import and private-identifier reviews, exact merge-base/backport evidence, startup/readiness policy-fingerprint behavior, and the Gate 1 evidence index. Record Gate 2–4 prerequisites, deferrals, and accepted residuals without selecting OD-2, OD-6, or OD-7 or performing any release operation.

**Dependency:** Epics 1 and 2. No future epic is required for the Gate 1 readiness decision.

## Epic 1: Deterministic and Auditable Read-Only Wiki Validation

An authenticated MCP agent can use the standard `/mcp` endpoint to deterministically lint one readable document or an authorized configured Wiki scope, distinguish clean, not-evaluated, incomplete, and failed outcomes, and complete a bounded lint–repair–re-lint loop. Invalid collection policy is reported as an operator escalation rather than as clean or not evaluated. Authorized operators receive minimized durable audit evidence without changing lint outcomes or leaking protected information.

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
AD: AD-1, AD-3, AD-4, AD-11, AD-12, AD-18

**Acceptance Criteria:**

1. **Given** the shared lint core
   **When** its public contracts are inspected
   **Then** `Finding` is exactly `{ code, severity, message, location }` plus the optional readability-gated `detail` defined by AD-12, `SystemFailure` is exactly `{ code, message, location }`, `PolicyIdentity` is exactly the valid variant `{ collectionId, status: "valid", policySchemaVersion: 1, policyFingerprint }` or the invalid variant `{ collectionId, status: "invalid", invalidFingerprint }`, and `EvaluatedScope` is exactly the AD-12 `document`, `collection`, or `configured_collections` variant, with `completedChecks` an ordered subset of `documents | hierarchy | global_index`
   **And** read-only results carry `state`, `complete`, `clean`, always-present ordered `errors`, `warnings`, and `systemFailures`, `scope`, `policies`, and `reason: "POLICY_NOT_CONFIGURED"` exactly when `state` is `not_evaluated`, keeping Errors, Warnings, System Failures, completion, cleanliness, and not-evaluated reasons structurally distinct.

2. **Given** the initial issue registry
   **When** every registered entry is enumerated
   **Then** it contains exactly the AD-3 rows with their fixed class, meaning, location kind, and surface, and assigns the four hierarchy codes to the `hierarchy` check, `GLOBAL_INDEX_LINK_MISSING` to `global_index`, and every other rule code to `documents`
   **And** `POLICY_NOT_CONFIGURED` exists only as a `not_evaluated` reason, `POLICY_SCHEMA_VERSION_UNSUPPORTED` and `POLICY_CONFIGURATION_MALFORMED` are startup-diagnostic-only codes that no result constructor accepts, `VALIDATION_RESOURCE_LIMIT_EXCEEDED` is limited to `lint_wiki` snapshot and admission, and the registry owns the stable tool-execution error identifier `collection_conflict`.

3. **Given** configuration-facing rule definitions
   **When** their accepted shape is validated
   **Then** only code-owned registered rule kinds and closed parameter schemas are permitted
   **And** executable code, arbitrary regular expressions, caller-provided issue codes, and severity overrides cannot be represented.

4. **Given** the same normalized Findings and System Failures supplied in different input orders
   **When** deterministic ordering is applied repeatedly
   **Then** each of `errors`, `warnings`, and `systemFailures` is byte-equivalent and sorted by authorized collection ID (derived server-side for a location that carries none), document ID, line, column, structural path, location-kind rank (`text` 0, `document` 1, `relationship` 2, `scope` 3), issue code, and rule-local ordinal, with absent values last, bytewise UTF-8 string comparison, segment-wise path comparison (integers before strings, integers numerically, strings bytewise, a shorter prefix first), and ties broken by emission order
   **And** titles, messages, locale, database return order, and timing do not affect ordering.

5. **Given** complete, warning-only, error-bearing, incomplete, failed, and not-evaluated fixtures
   **When** result state is derived
   **Then** `complete` holds only when every required unit ran and `systemFailures` is empty, with `clean` equal to an empty `errors` array; `incomplete` means at least one atomic unit completed and at least one System Failure exists; `failed` means no atomic unit completed and at least one System Failure exists; and `not_evaluated` has `complete: false`, `clean: false`, and empty issue arrays and `policies`
   **And** Warnings never affect cleanliness, every System Failure prevents `complete` and `clean`, and a `failed` result may carry retained Findings that clients must not drop.

6. **Given** canonical Markdown fixtures for every document-structure rule, including non-ASCII text before the defect
   **When** the pure rule core evaluates valid and invalid cases
   **Then** it emits the registered stable code and fixed severity for required sections, section order, heading levels, required visible metadata, registered metadata formats, unsupported structures, and discouraged structures, with document-level conditions at `document` locations and no fabricated line or relationship
   **And** every `text` location's one-based line and column, counted in Unicode code points over the exact `toMarkdown(document, { includeTitle: false })` string (no `commonMark`, no signed URLs, LF the only line terminator), and every structural `path`, come from one position-producing component that parses with Outline's Markdown rules and `linkify: false`, and no rule recomputes positions.

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
   **Then** startup succeeds with zero Configured Collections and the immutable policy set represents the explicit no-policy state without embedding a pilot default
   **And** its `policySetFingerprint` is the empty-set fingerprint, identical to that of a file containing `{ "schemaVersion": 1, "collections": {} }`.

2. **Given** a configuration path is present
   **When** a service's master process reads the file once
   **Then** a custom duplicate-aware decoder operating on the raw bytes, not stock `JSON.parse`, reports duplicate keys compared after JSON unescaping, unpaired surrogates, source number forms, and each collection entry's exact value byte span
   **And** the accepted root envelope is exactly `{ schemaVersion: 1, collections: Record<UUID, CollectionPolicy> }`, with unknown fields invalid at every level.

3. **Given** an unreadable file, a file larger than 64 KiB, malformed input (any RFC 8259 grammar violation, a leading byte-order mark, or bytes that are not well-formed UTF-8), an unsupported root schema, or a duplicate or unidentifiable key at the root or `collections` level, where any collection key other than a lowercase canonical 8-4-4-4-12 hexadecimal UUID is unidentifiable
   **When** startup validation runs
   **Then** startup fails, no partial policy set becomes available, and before exiting the process logs as operator-only fields exactly one stable code — `POLICY_SCHEMA_VERSION_UNSUPPORTED` only when the decoded root is an object whose `schemaVersion` member is present and is not the integer 1, and `POLICY_CONFIGURATION_MALFORMED` for every other startup-fatal defect, with decoding defects taking precedence over root-schema defects — and exactly one location
   **And** the location is the zero-based byte offset of the first byte of the token that carries the code-selecting defect (the key for a key defect, otherwise the value or the offending byte), the lowest such offset among defects of that code, the offset of the enclosing object's opening brace for an absent required member, or `file` when the file cannot be read or exceeds the size limit, and no file content, key text, or value is logged.

4. **Given** a parseable schema-version-1 envelope
   **When** collection entries are validated independently
   **Then** each valid entry requires `activation` (`read_only | enforced`), defaults an omitted `runtimeFailureMode` to `closed` (`closed | open`), and requires a non-empty `rules` array of unique registered rule kinds with the exact closed AD-3 parameter schemas
   **And** numbers must be base-10 integers within the JavaScript safe-integer range written without fraction, exponent, or negative-zero form, and keys and strings must not contain unpaired surrogates.

5. **Given** an identifiable collection entry with any schema defect, a duplicate key nested inside it, an unpaired surrogate, an out-of-profile number, an unknown field, a severity override, an arbitrary regular expression, or a client-defined code, alongside valid entries
   **When** the policy set is constructed
   **Then** that entry becomes an immutable fail-closed sentinel for its collection
   **And** valid or absent collections remain unaffected.

6. **Given** valid and invalid entries
   **When** their identities are calculated
   **Then** `policyFingerprint` is `sha256:<lowercase-hex>` over the canonical UTF-8 JSON of `{ schemaVersion, activation, runtimeFailureMode, rules }` in registry-normalized form with every omitted default materialized, using every AD-6 canonicalization rule (no whitespace, keys sorted by the UTF-8 bytes of their unescaped scalars, array order preserved, shortest escapes with lowercase `\u00xx`, no Unicode normalization, base-10 integers without leading zeroes), and an invalid entry's `invalidFingerprint` is `sha256:<lowercase-hex>` over the exact bytes of its value token from first to last byte, excluding key, colon, comma, and surrounding whitespace and hashing interior bytes, line endings, and escapes verbatim
   **And** `policySetFingerprint` hashes canonical `{ schemaVersion, collections }`, where `collections` is sorted by collection UUID and each item is `{ collectionId, status: "valid", policyFingerprint }` or `{ collectionId, status: "invalid", invalidFingerprint }`, and fixtures prove that converting line endings changes an `invalidFingerprint` but never a `policyFingerprint`.

7. **Given** a service that forks worker processes
   **When** its master has validated the file and computed the policy set
   **Then** the master passes the exact validated bytes to every forked worker through an inherited environment variable, and no worker ever reads `WIKI_LINT_CONFIG_PATH`, including after a respawn
   **And** a respawned worker serves the master's policy set even after the mounted file changes, and each service's master does this for its own workers.

8. **Given** a successfully loaded policy set
   **When** startup completes
   **Then** the service logs as operator-only fields its configuration status, activation and invalid counts, `policySetFingerprint`, and, per sentinel, its `collectionId`, `POLICY_CONFIGURATION_INVALID`, the JSON-Pointer path of the first defect, and its `invalidFingerprint`
   **And** raw configuration is never logged or returned, the JSON-Pointer path never appears in any result, and readiness gating on the expected fingerprint is delivered by Story 3.1.

9. **Given** a running server
   **When** an MCP request or administrative request attempts to alter activation, policy, rule parameters, severity, or runtime-failure mode
   **Then** no request-controlled mutation or override path exists
   **And** policy changes require a configuration change and restart because no watcher, hot reload, or policy mutation API is introduced.

10. **Given** the generic configuration schema, example, tests, and diagnostics
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
AD: AD-1, AD-2, AD-4–AD-6, AD-9–AD-12, AD-18, AD-19

**Acceptance Criteria:**

1. **Given** the shared application shell and an authenticated tool context
   **When** integration tests invoke the internal single-document lint orchestration
   **Then** its tool input schema (D-9) is exactly one required string `id`, described generically as the identifier of the document to lint and accepting the identifier forms the baseline `Document.findByPk` resolves (a UUID, or a URL identifier optionally prefixed by a title slug), with no policy, activation, scope, deadline, failure-mode, or other execution-control field, and an undeclared argument has no effect
   **And** policy, authorization, and execution controls come only from server-owned context, while public `/mcp` discovery remains disabled until every enabled document/link rule and the required read-only audit path pass Story 1.10 acceptance.

2. **Given** an actor-readable, non-deleted document, including a draft or archived document, in a collection with valid policy
   **When** the internal application orchestration evaluates it
   **Then** the adapter obtains the authoritative current content and state from the primary database inside one `REPEATABLE READ` transaction made read-only by an explicit `SET TRANSACTION READ ONLY` (not Sequelize's `readOnly` option, which selects a replica pool), issuing `SET LOCAL` lock and statement timeouts from the monotonic remainder before each batch and never 0 or a negative value
   **And** canonical Markdown is serialized from authoritative content rather than asynchronously refreshed `Document.text`, and the transaction commits before rule evaluation; the snapshot re-reads the document's collection and deletion state, and if either changed since the pre-snapshot steps of criterion 9, the result is the snapshot `VALIDATION_RUNTIME_FAILED` of criterion 10.

3. **Given** the code-owned 9-second validation deadline, which starts at tool entry on a monotonic clock
   **When** the deadline expires during snapshot construction, or the remainder before a snapshot batch is below the code-owned `SET LOCAL` floor
   **Then** snapshot construction fails as AD-10 requires: `VALIDATION_TIMEOUT` when the deadline expired during construction or a snapshot batch was refused because the remainder was below the code-owned `SET LOCAL` floor (AD-11), and `VALIDATION_RUNTIME_FAILED` for every other failure to establish the snapshot
   **And** the floor is one named code-owned constant, provisional until Story 3.3 fixes its value from AD-17 evidence.

4. **Given** the authorized snapshot
   **When** document rules are evaluated
   **Then** the pure shared core evaluates the complete stored title and body under the immutable collection policy, and all enabled section, order, heading-level, visible-metadata, field-format, unsupported-structure, discouraged-structure, and link rules run as one document unit using the Story 1.1 registry
   **And** a failure of one rule kind yields one System Failure per (unit, code) located `scope { scopeKind: "document", documentId, collectionId? }`, never skips another rule kind, keeps every Finding already produced, and leaves the unit uncompleted, so the result is `failed` and may carry those Findings.

5. **Given** a structural document evaluation
   **When** its buffered output is assembled internally
   **Then** it uses actor-authorized scope and policy identity, deterministic AD-4 ordering, and truthful safe locations
   **And** the application shell cannot emit an AD-12 `complete` result until every enabled rule kind whose AD-3 surfaces include the document surface, including link rules, has run successfully; hierarchy and global-index rule kinds never run on this surface and do not make it incomplete, and when the `documents` check is not required the result completes with zero counts and no Findings (AD-11).

6. **Given** an actor who can read the document but not its collection
   **When** a document in a collection with valid policy is evaluated
   **Then** evaluation still uses that collection's policy and returns Findings and System Failures, while `collectionId` is omitted from `EvaluatedScope`, `PolicyIdentity`, and every `scope` location and `policies` is empty
   **And** identity visibility is decided only by `can(actor, "read", collection)`, and the actor learns nothing beyond the policy class NFR-11 permits; if the collection-readability check itself fails, including by expiry or a below-floor remainder, the collection is treated as unreadable for identity in the same way and evaluation continues under its policy (AD-10, AD-11).

7. **Given** a readable document whose collection is `null` or has no Policy Configuration entry
   **When** the internal application orchestration evaluates it
   **Then** it returns `state: not_evaluated`, `complete: false`, `clean: false`, empty issue and policy arrays, a zero-count document scope, and `reason: "POLICY_NOT_CONFIGURED"`
   **And** it does not misrepresent the result as an empty successful lint.

8. **Given** a readable document whose collection has an identifiable invalid-policy sentinel
   **When** the internal application orchestration evaluates it without building a snapshot
   **Then** an actor who can read the collection receives `state: failed` with exactly one `POLICY_CONFIGURATION_INVALID` located `scope { scopeKind: "collection", collectionId }`, the invalid `PolicyIdentity`, and a zero-count document scope; an actor who can read only the document receives `state: failed` with the generic `POLICY_CONFIGURATION_INVALID` located `scope { scopeKind: "document", documentId }`, without `collectionId`, with empty `policies`; and when the collection's readability cannot be established the result is `state: failed` carrying only the generic `VALIDATION_RUNTIME_FAILED` located `scope { scopeKind: "document", documentId }`
   **And** the result is never `not_evaluated` or clean, exposes no raw configuration, JSON-Pointer path, or other collection's state, and is an operator escalation rather than an agent-repairable Finding.

9. **Given** an inaccessible document or invalid tool input
   **When** the internal application orchestration is invoked
   **Then** an authorization denial or a missing or inaccessible document returns the same authorization-denial Tool-Execution Error (`isError`), so missing and denied documents are indistinguishable, while an authentication failure keeps baseline behavior; the document lookup, `read` check, and collection-readability check complete in a short read-only transaction bounded by `SET LOCAL` timeouts from the deadline remainder before the first snapshot batch, and expiry, a below-floor remainder, or another non-application failure of the document lookup or `read` check is a Tool-Execution Error with the fixed message `The operation could not be completed`; and an input-schema failure keeps the baseline MCP SDK behavior, which a fixture asserts is an `isError` result against SDK `1.29.0`; if the SDK instead raises a JSON-RPC error, the fixture records it as a blocking finding for the architect (AD-12) rather than as accepted behavior
   **And** neither is converted into a Finding or a modeled validation result that reveals document existence, and no audit summary is recorded (Story 1.8).

10. **Given** a snapshot or canonicalization failure before the document unit completes
    **When** the operation returns a modeled runtime outcome
    **Then** it returns `state: failed`, `complete: false`, `clean: false`, no Findings, zero counts, and `VALIDATION_RUNTIME_FAILED` or `VALIDATION_TIMEOUT` located `scope { scopeKind: "document", documentId }`
    **And** an unmodellable failure is a Tool-Execution Error, never a JSON-RPC protocol error.

11. **Given** any internal single-document lint invocation
    **When** execution completes or fails
    **Then** no document, collection, permission, hierarchy, or other Wiki mutation is performed
    **And** the operation does not grant or imply authority to repair any finding.

12. **Given** identical policy, authorization, request, and stored state
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
AD: AD-1–AD-4, AD-9, AD-10, AD-12, AD-16, AD-18

**Acceptance Criteria:**

1. **Given** `lint_document`, the `lint_wiki` document unit, the `lint_wiki` global-index check (Story 1.6), and enforced-write validation
   **When** internal links are extracted
   **Then** all four call one code-owned link-extraction function in the shared core, applied to the link tokens that the Story 1.1 position-producing component yields from canonical Markdown parsed with `linkify: false`
   **And** the function reuses the baseline `isUUID` and `UrlHelper.SLUG_URL_REGEX`, restates the baseline internal-URL rule inside the core with the configured instance origin supplied by the application shell as evaluation input (the baseline `isInternalUrl` reads an environment singleton, which the core may not import, AD-1), and no surface has its own link parser, pattern, or recognized-form list.

2. **Given** the generic link-form fixture table below (D-9)
   **When** extraction runs over each fixture
   **Then** each link destination is classified exactly as listed: the destination is parsed with the WHATWG `URL` parser against the instance origin; it is internal only when it begins with exactly one `/` and the parse keeps the instance origin, or when it is an absolute `http:` or `https:` URL whose parsed `hostname` and `port` strings equal those of the instance origin URL, ignoring scheme and username or password as the baseline comparison does (a default port is the empty string, and a trailing-dot hostname differs and is not recognized); and recognition reads the parsed, dot-segment-normalized `pathname` without further decoding
   **And** a recognized reference yields one lookup key — `isUUID` is tested first and a UUID key is lowercased, and only a non-UUID value is matched against `SLUG_URL_REGEX`, whose captured URL identifier is the key — and one `text` location at the first character of the link's source syntax, whose coordinates the fixtures pin, while an unrecognized destination yields no lookup, no Finding, and no count and is never reported as an unresolved internal target.

   | Fixture | Link destination in canonical Markdown | Recognized | Lookup key |
   | --- | --- | --- | --- |
   | L1 | `/doc/<uuid>`, in any letter case the baseline `isUUID` accepts | yes | the lowercased UUID |
   | L2 | `/doc/<title-slug>-<urlId>` | yes | `urlId` |
   | L3 | `/doc/<urlId>` | yes | `urlId` |
   | L4 | an L1–L3 path followed by further path segments, a query string, or a fragment (for example `/edit` or `#heading`) | yes; extra segments, query, and fragment are ignored and the anchor is not validated | as L1–L3 |
   | L5 | an absolute `http:` or `https:` URL to the instance origin with an L1–L4 path | yes | as L1–L4 |
   | L6 | a document mention, which canonical Markdown serializes as `[label](/doc/<id>)` with an optional `#anchor` | yes | as L1–L4 |
   | L7 | the baseline `/d/<ref>` document redirect path, with or without the L4 and L5 variations | yes | as L1–L3 |
   | L8 | an absolute URL to another hostname or port string, including a trailing-dot form of the instance hostname, with a `/doc/` or `/d/` path | no | — |
   | L9 | a protocol-relative `//<host>/doc/<uuid>`, a `/\<host>` form, or a relative path without a leading `/` such as `doc/<uuid>` | no | — |
   | L10 | a share path `/s/<shareId>/doc/<slug>`, any path whose first normalized segment is neither `doc` nor `d` (such as `/collection/...`, `/api/...`, or `/doc/<id>/../../api/x`), or a `/doc/` or `/d/` path whose next segment is empty, percent-encoded, or neither a UUID nor a `SLUG_URL_REGEX` match, such as `/doc/new` | no | — |
   | L11 | a non-HTTP scheme such as `mailto:` or `mention://`, an image destination, or link-like text inside a code span or code block | no | — |

   Fixtures are written as the canonical Markdown that the baseline serializer produces, including a document mention whose label contains `]` and an L5 link preceded by `@`, which the baseline mention rule parses as a mention token rather than a link; the fixtures pin both classifications.

3. **Given** recognized references in a completed unit
   **When** counts are produced
   **Then** every recognized occurrence is one internal-link reference and `evaluatedLinkCount` counts recognized references, not unique targets
   **And** the same AD-16 reference count governs the `lint_wiki` limit of 100,000 internal-link references.

4. **Given** extracted lookup keys
   **When** the adapter resolves them
   **Then** it uses primary-database, membership-aware, actor-authorized queries in batches of at most 500 unique keys, within the invocation's point-in-time snapshot for lint and within the enforcement transaction for writes (Story 2.3)
   **And** it does not use an unscoped lookup, replica, cache, network request, or rule-core data access.

5. **Given** a target that is missing, deleted, or inaccessible to the actor
   **When** target state crosses into the pure core
   **Then** every such case is represented by the same `unresolved` value
   **And** the core cannot distinguish the protected underlying cause.

6. **Given** an authorized resolvable target
   **When** the internal-link rule evaluates it
   **Then** no unresolved-target Finding is emitted
   **And** no target content or unrelated metadata is added to the result.

7. **Given** an unresolved internal target
   **When** the rule evaluates it
   **Then** it emits `INTERNAL_LINK_TARGET_UNRESOLVED` at the authorized source document's `text` location
   **And** the message, path, location, and scope reveal no protected target ID, title, URL identifier, collection, existence state, or metadata.

8. **Given** two actors who may read the source document but have different visibility of a referenced target
   **When** each actor lints the source
   **Then** unauthorized target states remain indistinguishable from other unresolved states
   **And** multi-actor fixtures demonstrate zero protected-information disclosure through findings, System Failures, scope, counts, or diagnostics.

9. **Given** duplicate or differently ordered references to the same targets, including one document referenced through both its UUID and its URL identifier
   **When** resolution and evaluation complete
   **Then** unique lookup keys are batched deterministically while every source occurrence remains independently reportable
   **And** output ordering follows AD-4 regardless of database return order.

10. **Given** the link-rule unit and integration suites
    **When** they run
    **Then** valid, unresolved, deleted, inaccessible, every L1–L11 form, an uppercase UUID that resolves, a UUID never looked up as a URL identifier, repeated-link, and non-ASCII-preceding-text cases assert the stable code, severity, safe location coordinates, and evaluated-link count
    **And** all reusable fixtures use a generic instance origin and remain environment-independent.

### Story 1.5: Materialize an Authorized Wiki Scope from One Coherent Snapshot

As an authenticated MCP agent,
I want Wiki linting to observe one authorized coherent snapshot,
So that later rule evaluation cannot mix protected or concurrently changing data.

**Traceability:**
CAP: CAP-3, CAP-4
FR: FR-7, FR-11, FR-12
NFR: NFR-3, NFR-4, NFR-6, NFR-7, NFR-10, NFR-11, NFR-18, NFR-20, NFR-25, NFR-26
SM: SM-I4, SM-I7, SM-C4, SM-C6
Gates: Gate 1 evidence contribution; Gate 4 read-only capability support without rollout authority
AD: AD-2, AD-5, AD-6, AD-9–AD-12, AD-16, AD-18, AD-19

**Acceptance Criteria:**

1. **Given** the shared application shell and an authenticated tool context
   **When** integration tests invoke internal Wiki snapshot orchestration with or without a collection identifier
   **Then** its tool input schema (D-9) is exactly one optional string `collectionId`, built with the baseline `optionalString()` so that an empty string is treated as omitted, described generically and accepting the identifier forms the baseline collection lookup resolves, with no other field, and an undeclared argument has no effect
   **And** policy, activation, failure posture, concurrency, resource limits, and deadline remain server-owned, and public `/mcp` discovery remains disabled until all Wiki rule families, partial-result behavior, and required audit handling pass Story 1.10 acceptance.

2. **Given** a requested collection identifier
   **When** internal scoped Wiki snapshot orchestration runs
   **Then** the collection is resolved through the baseline lookup and authorized with `can(actor, "read", collection)` (AD-12), its policy, identity, and scope use the resolved lowercase `collection.id` rather than the input string, a readable collection with valid policy contributes only itself and its actor-readable rule-required state, a readable invalid-policy sentinel follows criterion 5, and a readable collection with neither follows criterion 12
   **And** a denied or missing collection returns the same authorization-denial Tool-Execution Error, so the two are indistinguishable; the lookup runs in a short read-only transaction bounded by `SET LOCAL` timeouts from the deadline remainder, and expiry, a below-floor remainder, or another non-application failure of it is a Tool-Execution Error with the fixed message `The operation could not be completed`; neither records a summary or exposes the collection's identity through validation output, and fixtures cover uppercase-UUID and URL-identifier inputs.
   **And** the pre-admission `read` result fixes identity visibility for the whole invocation; a requested collection that is no longer readable at snapshot time contributes only the documents its membership-aware queries return at snapshot time, its required graph checks yield the generic `VALIDATION_RUNTIME_FAILED` exactly as under `graphAuthorized: false` (Story 1.6 criterion 12), and nothing else of it is disclosed (AD-16).

3. **Given** no collection identifier
   **When** internal default Wiki snapshot orchestration runs
   **Then** the operation includes every collection the actor can read under `can(actor, "read", collection)` that has a valid policy or an invalid-policy sentinel, and an unreadable collection, including an unreadable sentinel, contributes nothing
   **And** it neither names nor implies inaccessible collections, documents, targets, or counts, and a fixture pins the case of an admin who can read a private collection without membership (`read` without `readDocument`): the collection is included with only the documents the actor can read, so its counts may be zero; no `documentStructure` is read for it; each required hierarchy or global-index check yields the generic `VALIDATION_RUNTIME_FAILED` located `scope { scopeKind: "collection", collectionId }` (Story 1.6 criterion 12); and the result can be clean only when no hierarchy or global-index rule is enabled (AD-9). A second fixture adds a document readable through document membership and proves it is evaluated.

4. **Given** an evaluated collection
   **When** its document set is selected
   **Then** it contains only documents the actor can read that are published, not archived, and not deleted, so drafts and archived documents are outside every `lint_wiki` unit
   **And** parents and link targets resolve through the same membership-aware queries rather than against the evaluated scope alone.

5. **Given** an actor-readable collection whose policy entry is an invalid-policy sentinel
   **When** scope selection runs
   **Then** the sentinel contributes exactly one `POLICY_CONFIGURATION_INVALID` located `scope { scopeKind: "collection", collectionId }`, its invalid `PolicyIdentity`, and a zero-count scope entry with empty `completedChecks`, needs no snapshot, and completes no atomic unit; when the readability of a requested collection cannot be established, the request is the Tool-Execution Error of criterion 2, and in default scope readability is established in the first, floor-guarded snapshot batch, so a failure there is the snapshot failure of criterion 11 and no sentinel whose readability was not established is returned
   **And** a result containing a sentinel is `incomplete` when any other unit completed and `failed` otherwise, never clean or `not_evaluated`.

6. **Given** an authorized lint scope
   **When** the snapshot adapter materializes its input
   **Then** the snapshot loads only the inputs of required checks (AD-9, AD-11): the evaluated scope always; authoritative document content and state, canonical Markdown serialization, extracted links, and authorized target resolutions only when the `documents` check is required, plus those of the configured surface documents when the `global_index` check is required; and authoritative hierarchy and structure only when the `hierarchy` or `global_index` check is required. Every input that is loaded is read from the primary database within one `REPEATABLE READ` transaction made read-only by an explicit `SET TRANSACTION READ ONLY`, not by Sequelize's `readOnly` option
   **And** uncached `Collection.documentStructure` is used as hierarchy authority only for a collection where `can(actor, "readDocument", collection)` holds, checked with memberships loaded inside the snapshot transaction; for any other evaluated collection the adapter reads no `documentStructure`, not even a size or existence probe, and marks the collection `graphAuthorized: false`, distinct from an empty graph (AD-9); default-scope enumeration and sentinel readability checks are the first floor-guarded batches; only structures the adapter may read count toward the structure-node limit; and asynchronously refreshed `Document.text` is never snapshot authority.

7. **Given** snapshot construction is in progress
   **When** all snapshot-dependent lookups complete
   **Then** the transaction commits before pure rule evaluation begins
   **And** no network, storage operation, audit write, or full rule evaluation occurs inside the snapshot transaction.

8. **Given** a scope containing multiple documents and link targets
   **When** the adapter reads it
   **Then** documents use keyset order `(collectionId, id)` in batches of 100 and unique link targets in batches of 500, with request-local maps, transient per-document ASTs, and bounded sequential work instead of unbounded `Promise.all`
   **And** the shell issues `SET LOCAL` lock and statement timeouts from the monotonic remainder before each batch, never 0 or a negative value, and fails snapshot construction as criterion 11 describes when the remainder is below the code-owned `SET LOCAL` floor that Story 3.3 fixes.

9. **Given** the immutable authorized snapshot
   **When** it is handed to the application shell
   **Then** its documents and authorized graph inputs are ordered by the AD-4 identifier keys required for later atomic evaluation
   **And** the adapter itself does not claim completed checks, Findings, or an AD-12 complete result.

10. **Given** concurrent commits after the snapshot has been materialized
    **When** pure evaluation completes
    **Then** the result retains valid point-in-time meaning for the transaction's observed state
    **And** later commits are not mixed into that result.

11. **Given** the server cannot establish the required coherent snapshot
    **When** snapshot construction fails
    **Then** the result is `failed` with no Findings, no partial snapshot, and `VALIDATION_RUNTIME_FAILED`, or `VALIDATION_TIMEOUT` when the AD-11 deadline expired during construction or a construction batch was refused because the remainder was below the AD-11 floor, located `scope { scopeKind }` with the request's scope kind plus `collectionId` for a collection-scoped request
    **And** the `POLICY_CONFIGURATION_INVALID` and invalid `PolicyIdentity` of every sentinel established as actor-readable (criterion 5) are still returned, because they need no snapshot, and no caller can convert that failure into a complete or clean result.

12. **Given** a scoped readable collection with neither a valid policy nor a sentinel, or a default request whose actor-readable collections include none with a valid policy or sentinel
    **When** snapshot orchestration begins
    **Then** it returns the explicit not-evaluated state with `reason: "POLICY_NOT_CONFIGURED"` without scanning the collection; a default request when the startup policy set is empty returns it without admission, while otherwise admission precedes enumeration (Story 1.7 criterion 7), so under contention such a request returns the admission-rejection `failed` result instead
    **And** unconfigured collections are not silently enrolled.

13. **Given** identical policy, authorization, request, and database state
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
   **Then** they run only for a collection where `can(actor, "readDocument", collection)` holds (criterion 12), and operate only on actor-authorized graph nodes, edges, publication state, collection identity, and authoritative collection structure
   **And** the pure core receives no inaccessible node, target identity, title, URL identifier, or metadata.

2. **Given** an evaluated document whose parent cannot be resolved for the actor through the membership-aware queries
   **When** the parent rule evaluates it
   **Then** it emits `PARENT_DOCUMENT_UNRESOLVED` at a `relationship` location naming only the authorized source document and `relationshipKind: parent`, with missing, deleted, and inaccessible parent states indistinguishable
   **And** a readable parent outside the evaluated collection resolves and is not reported as unresolved.

3. **Given** an authorized hierarchy graph containing a cycle
   **When** cycle detection runs
   **Then** it emits exactly one `HIERARCHY_CYCLE` Finding for each authorized source document proven to participate in the cycle, using that document's parent relationship location
   **And** each such document has one stable rule-local ordinal and repeated evaluation produces the same cardinality, locations, and AD-4 order.

4. **Given** an evaluated published document absent from authoritative `Collection.documentStructure`
   **When** the collection-structure rule runs
   **Then** it emits `PUBLISHED_DOCUMENT_MISSING_FROM_STRUCTURE` at the authorized source document's `collection_structure` relationship
   **And** drafts, archived documents, and inaccessible documents, which are outside every `lint_wiki` unit, do not create findings.

5. **Given** an evaluated document whose readable parent belongs to a different collection
   **When** the relationship rule runs
   **Then** it emits `PARENT_COLLECTION_MISMATCH` at the authorized source document's parent relationship rather than `PARENT_DOCUMENT_UNRESOLVED`
   **And** it does not disclose protected parent or collection identity.

6. **Given** a configured surface and explicitly configured global-index documents whose required facts are actor-authorized and resolved
   **When** global-index validation runs
   **Then** the surface document's direct links are those the Story 1.4 link-extraction function recognizes, and every configured global index without such a link emits `GLOBAL_INDEX_LINK_MISSING` at the authorized surface document's `global_index` relationship
   **And** transitive links do not satisfy the direct-link requirement.

7. **Given** the surface, a configured global index, or another fact required to prove the global-index condition is inaccessible or unresolved
   **When** the check cannot be completed without disclosure
   **Then** no `GLOBAL_INDEX_LINK_MISSING` Finding is emitted for that surface/index pair, while Findings for every pair whose facts are all authorized and resolved are still emitted
   **And** the check reports one generic `VALIDATION_RUNTIME_FAILED` located `scope { scopeKind: "collection", collectionId }` and is not counted as completed, making the overall result incomplete or failed and non-clean without naming the unresolved fact.

8. **Given** a check is required exactly when at least one enabled rule kind belongs to it
   **When** a required check has zero inputs
   **Then** it completes vacuously, counts as a completed atomic unit, and is listed in `completedChecks`, except a check of a collection marked `graphAuthorized: false` (criterion 12), which never completes vacuously
   **And** a check with no enabled rule kind is not required and is not listed.

9. **Given** a technically valid hierarchy whose placement may appear editorially unusual
   **When** hierarchy evaluation runs
   **Then** no Finding is emitted merely for logical category choice, authority choice, prose meaning, language, relevance, or usefulness
   **And** no semantic classifier or LLM is invoked.

10. **Given** successful document, hierarchy, and global-index atomic units
    **When** the result is assembled
    **Then** `completedChecks`, evaluated counts, policy identities, and scope reflect only fully completed authorized work
    **And** each collection's hierarchy check precedes its global-index check after all document units, as required by AD-11, and every unit, including a vacuous check and a `graphAuthorized: false` check, keeps its position in that order.

11. **Given** valid and defective collection fixtures
    **When** the rule and integration suites run
    **Then** they cover dangling parents, readable out-of-scope parents, cycles, missing published structure entries, excluded drafts and archived documents, cross-collection parent mismatches, present and absent direct surface links, including surface links in the recognized L2, L5, L6, and L7 forms and the unrecognized L8 to L10 forms of Story 1.4, inaccessible proving facts, partially provable global-index checks, vacuous required checks, and collections without `readDocument`
    **And** exact stable codes, fixed severities, safe locations, completeness, and deterministic ordering are asserted.

12. **Given** an evaluated collection the actor can `read` but not `readDocument`, so the snapshot marks it `graphAuthorized: false`
    **When** its required hierarchy or global-index check is scheduled
    **Then** the application shell, not a rule, emits one generic `VALIDATION_RUNTIME_FAILED` located `scope { scopeKind: "collection", collectionId }` for each such check without invoking its rules, even when their inputs are readable through document membership, and the check is not completed
    **And** no hierarchy or global-index Finding is emitted for that collection, its documents readable through document membership are still evaluated as document units, and parents and link targets inside it still resolve by document readability (AD-9, AD-11, AD-12).

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
   **Then** the server applies a non-client-configurable 60-second hard deadline measured with a monotonic clock, and the `/mcp` router overrides the request socket timeout to at least 65 seconds for its own requests without changing the global `REQUEST_TIMEOUT` or exposing a request-level override
   **And** a fixture proves a `/mcp` request longer than 10 seconds is not cut by the socket timeout, injected-clock fixtures prove every snapshot query and bounded stage receives an internal deadline no later than the invocation's remaining time, the sum of the `lint_wiki` code-owned bounds is at most 63 seconds, and proxy and CDN read timeouts remain OD-7 evidence.

2. **Given** an immutable Wiki snapshot
   **When** evaluation is scheduled
   **Then** atomic units are ordered as every document with all enabled document/link rules (document units exist only when the `documents` check is required), followed by each collection's hierarchy check and then its global-index check, all in AD-4 key order
   **And** every unit, including a vacuous check and a check of a collection marked `graphAuthorized: false`, occupies its position and is preceded by the deadline check, a `documents` check with zero document units sitting where that collection's first document unit would sort; each unit buffers its findings until it finishes, so an interrupted unit contributes nothing, while a finished unit with a partial rule failure contributes its Findings without being counted as completed (criterion 5).

3. **Given** the deadline is checked before each atomic unit
   **When** less than the code-owned stop margin remains or the deadline has expired
   **Then** no new unit starts, result assembly is charged to that margin, and a unit not started or not finished when the deadline is checked is not counted and adds no Findings, while a synchronous parse is never preempted; stopping at the margin is the `VALIDATION_TIMEOUT` of criterion 4 (AD-3)
   **And** the stop margin is one named code-owned constant, provisional until Story 3.3 fixes it from AD-17's measured maximum unit time.

4. **Given** a timeout
   **When** the result is assembled
   **Then** it retains every unit that finished before the failing deadline check, in unit order, including finished units that carry a System Failure, which keep their Findings but are not counted as completed, adds `VALIDATION_TIMEOUT` located `scope { scopeKind }` with the request's scope kind plus `collectionId` for a collection-scoped request, and sets `complete: false` and `clean: false`
   **And** its state is `failed` when no unit completed and otherwise `incomplete`, carrying the Findings of every finished unit and the counts of completed units only; a check not reached before the failing deadline check is neither listed nor reported, and a `graphAuthorized: false` check not reached adds no System Failure.

5. **Given** an isolated rule or authorized-resource failure
   **When** later units are independent and safe to execute
   **Then** the operation records one safe System Failure per (unit, code), located `scope { scopeKind: "document", documentId, collectionId? }` for a document unit and `scope { scopeKind: "collection", collectionId }` for a check, and continues those later units
   **And** a unit that finished with a partial rule failure keeps its Findings but is not counted as completed, and no required check is silently suppressed because a prior independent unit failed.

6. **Given** snapshot admission or construction detects more than 5,000 documents, more than 1 MiB of UTF-8 Markdown in one document, more than 64 MiB of total Markdown, more than 100,000 internal-link references, or more than 10,000 authoritative structure nodes
   **When** the limit is exceeded
   **Then** the result is `failed` with `VALIDATION_RESOURCE_LIMIT_EXCEEDED`, no Findings, zero completed counts, `complete: false`, and `clean: false`
   **And** none of these limits is configurable through policy or MCP input, `lint_document` and write validation impose none of them, and the 1 MiB cap against the baseline 1,536,000-character document limit remains a recorded D-9 item revisited only if pilot evidence shows a legal document blocked from a complete `lint_wiki`.

7. **Given** one `lint_wiki` is already admitted on a server process
   **When** another invocation requests admission concurrently
   **Then** a collection-scoped request first completes its top-level collection lookup and `can(actor, "read", collection)` check (Story 1.5 criterion 2), so a denied or missing collection stays the same authorization-denial Tool-Execution Error, a requested collection that is a sentinel or has no policy returns its Story 1.5 result without admission, and a default request with an empty startup policy set returns `not_evaluated` without admission; admission is then checked before default-scope enumeration, any sentinel readability check, and the snapshot, and at most one scan runs on that process
   **And** expiry, a below-floor remainder, or another non-application failure of the pre-admission lookup is a Tool-Execution Error with the fixed message `The operation could not be completed` and records no summary, while the rejected invocation returns `state: failed` with `VALIDATION_RESOURCE_LIMIT_EXCEEDED`, empty Findings, and zero completed counts — for a collection-scoped request with scope `{ kind: "collection", collectionId }`, an empty `completedChecks`, that collection's valid `PolicyIdentity`, the failure located `scope { scopeKind: "collection", collectionId }`, and an audit Event whose collection column is that collection, and for a default-scope request with scope `{ kind: "configured_collections", collections: [] }`, empty `policies`, a failure located `scope { scopeKind: "configured_collections" }`, no sentinel, and an audit Event with no collection column — and introduces no unbounded queue or cross-instance coordination mechanism
   **And** terminal-path fixtures prove the admission slot is released, once the audit write settles or its bound expires, after success, timeout, snapshot failure, resource-limit failure, cancellation, and any other failed completion so the next invocation can be admitted.

8. **Given** an admitted invocation whose scope contains an actor-readable invalid-policy sentinel
   **When** the run ends in a timeout, a snapshot failure, or a resource-limit excess
   **Then** the sentinel's `POLICY_CONFIGURATION_INVALID` and invalid `PolicyIdentity` (Story 1.5 criterion 5) are returned alongside the run-wide System Failure, because they need no snapshot
   **And** default-scope fixtures cover each combination and assert the AD-12 state, ordering, and the absence of any sentinel whose readability was not established, while a collection-scoped request for a sentinel collection performs no snapshot or unit and returns the sentinel-only `failed` result of Story 1.5.

9. **Given** incomplete or failed evaluation
   **When** `EvaluatedScope` is returned
   **Then** document/link counts include completed document units even before `documents` is listed, `documents` is listed only when every document unit of that collection completed, and `completedChecks` and counts contain only completed atomic units and actor-authorized identifiers
   **And** no inaccessible or interrupted target is inferred from missing counts.

10. **Given** any Warning, Error, or System Failure combination
    **When** result state is calculated
    **Then** Warnings never affect cleanliness, Errors prevent cleanliness, and every System Failure makes the result incomplete or failed and non-clean
    **And** performance duration itself never becomes a Finding or changes severity.

11. **Given** injected timeout, stop-margin, resource-limit, isolated-rule-failure, global-snapshot-failure, and concurrent-admission fixtures
    **When** the integration suite runs repeatedly
    **Then** state, completeness, safe retained findings, System Failure codes and locations, counts, `completedChecks`, and ordering are deterministic
    **And** the suite proves no skipped check is hidden as a clean or complete result.

### Story 1.8: Record Minimized and Failure-Isolated Read-Only Audit Evidence

As a Wiki operator,
I want one durable privacy-preserving summary for every read-only lint invocation that returns a lint result,
So that I can measure usage and outcomes without storing lint details or making audit health part of agent-facing validation.

**Traceability:**
CAP: CAP-6
FR: FR-19, FR-21, FR-22
NFR: NFR-11, NFR-14, NFR-17, NFR-27
SM: SM-I1, SM-I4, SM-I6, SM-I7, SM-P1, SM-C4, SM-C7
Gates: Gate 1 audit-evidence contribution; Gate 4 measurement support without pilot claim
AD: AD-1, AD-2, AD-11, AD-14, AD-15, AD-18

**Acceptance Criteria:**

1. **Given** a `lint_document` or `lint_wiki` invocation
   **When** the server establishes request context
   **Then** it generates a server-owned `requestId` for the HTTP request and a server-owned `invocationId`
   **And** the `invocationId` is also the idempotent Event ID for `wikiLint.document` or `wikiLint.wiki`.

2. **Given** normal audit operation
   **When** an invocation returns a lint result that is clean, findings-bearing, not evaluated, incomplete, or failed
   **Then** exactly one retrievable summary Event is persisted for that invocation, and retries using the same invocation identity cannot create duplicate summaries
   **And** an invocation that ends in a Tool-Execution Error, such as an invalid call or an authorization denial, returns no lint result and records no summary.

3. **Given** a read-only audit summary
   **When** its Event data is inspected
   **Then** it contains exactly the applicable closed `AuditDataV1` fields: `outcome` maps a `complete` result with no Errors to `clean`, a `complete` result with any Error to `findings`, and `not_evaluated`, `incomplete`, and `failed` one to one; `scopeKind` is `document` for `lint_document` and `collection` or `configured_collections` for `lint_wiki`; `durationMs` is monotonic time from tool-handler entry to the initiation of the audit write; and completion, evaluated counts, severity/code aggregates, `runtimeFailOpenExercised: false`, request correlation, credential type, and optional authenticated client identity match the actual invocation
   **And** `policySchemaVersion` and `policyFingerprint` are present only when the scope is a single collection or document under a valid policy, and are omitted for default scope and for a sentinel scope, with no `invalidFingerprint`, policy array, or additional key.

4. **Given** any audit payload or Event row
   **When** privacy conformance fixtures inspect it
   **Then** the row has `teamId` set to the actor's team, `actorId` to the authenticated actor, `ip` to the source IP, `authType` to the command-context value, and `userId` and `modelId` null, and safe document/collection identifiers use existing Event columns only when necessary to identify the audited scope
   **And** neither data nor columns contain bodies, excerpts, diagnostic messages, line/path locations, raw policy configuration, raw request, or protected target identity or metadata, and neither depends on whether the actor can read the collection.

5. **Given** API or OAuth authentication
   **When** attribution is written
   **Then** the private authentication result and MCP `AuthInfo.extra` propagate `credentialAuthType`, OAuth includes only the `OAuthClient.clientId` bound to the access token, and API authentication omits client identity
   **And** `User-Agent`, MCP client claims, `_meta`, and tool arguments are ignored for attribution.

6. **Given** an authorized audit query
   **When** `events.list` is called with `auditWikiLint`
   **Then** a same-team admin may retrieve only the three adopted Wiki-lint Event names, including the future write-validation name, and the requested names are intersected with those three without error
   **And** the three names live in a new constant outside the shared `AUDIT_EVENTS` and `ACTIVITY_EVENTS`, existing full `audit` access remains unchanged, a non-admin cannot list or infer summaries, and a `"*"` webhook receives no `wikiLint.*` Event.

7. **Given** the Event store requires efficient operator queries
   **When** the story's database migration is applied
   **Then** the required `events(teamId, name, createdAt)` index is created through an additive concurrent migration that keeps image rollback safe
   **And** existing Event retention remains the sole retention mechanism; no second audit subsystem or dashboard is introduced.

8. **Given** any completed read-only functional outcome
   **When** audit persistence runs
   **Then** it runs afterward in an independent transaction with its own `SET LOCAL statement_timeout` equal to the 3-second audit bound, is awaited with that bound, and treats expiry as an audit failure
   **And** the insert suppresses only the global-queue enqueue and keeps the baseline IP normalization, so no webhook, websocket, or other `"*"` processor receives it, and success or failure cannot alter, reject, roll back, downgrade, or annotate the standard MCP result.

9. **Given** an injected audit-write failure
   **When** audit persistence fails
   **Then** the agent receives the unchanged lint result with no audit-state field or internal diagnostic
   **And** the server emits only a minimized structured operator diagnostic correlated by request/invocation ID.

10. **Given** normal and failure-injected audit tests
    **When** the suite evaluates every read-only outcome class, each Tool-Execution Error case, and each access role, including an admission rejection for a scoped request (collection column and valid-policy fields present) and a default request (neither present), a `not_evaluated` result returned without admission, a pre-scope lookup failure, expiry, or below-floor remainder (no summary), and a `lint_document` whose collection-readability check fails (one summary whose data and columns do not depend on actor readability)
    **Then** exactly-once behavior, no summary for Tool-Execution Errors, outcome mapping, policy-field presence, required aggregate fields, prohibited-field absence, authorized retrieval, and unchanged functional outcomes are asserted
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
   **When** the lint tools are registered on the one existing `/mcp` server (D-9)
   **Then** `lint_document` is registered only when `AuthenticationHelper.canAccess("documents.info", scopes)` holds and `lint_wiki` only when `canAccess("documents.list", scopes)`, `canAccess("collections.list", scopes)`, and `canAccess("collections.documents", scopes)` all hold, because default scope enumerates readable collections; each tool has the Story 1.3 or Story 1.5 input schema, annotations exactly `{ readOnlyHint: true, idempotentHint: true }` as in the baseline read tools, and a generic title and description that name no environment-specific identifier
   **And** each tool returns its modeled AD-12 result as the JSON object of its first text content block without `isError`.

2. **Given** tokens with the scope sets below
   **When** each client performs discovery through the one existing `/mcp` endpoint
   **Then** both lint tools appear for `*`, `read`, `write`, and `documents:read` with `collections:read`; only `lint_document` appears for `documents:read` alone and for `/api/documents.info` alone; only `lint_wiki` appears for `/api/documents.list` with `/api/collections.list` and `/api/collections.documents`; and neither appears for `create`, `collections:read` alone, or `documents:create`, each alongside the existing tools the same token may use
   **And** no second endpoint, client-specific server, prompt, adapter, policy input, or execution-control input is required.

3. **Given** valid, invalid, warning-only, unconfigured, invalid-policy, runtime-failure, timeout, resource-limit, and inaccessible-dependency fixtures for an otherwise authorized invocation
   **When** each applicable read-only tool runs
   **Then** its modeled result uses the exact AD-12 state algebra, stable codes, fixed severities, safe locations, authorized scope, policy identity, counts, completeness, cleanliness, and AD-4 ordering
   **And** denial or absence of the requested top-level document/collection remains one indistinguishable authorization-denial Tool-Execution Error (`isError`), expiry, a below-floor remainder, or another non-application failure of that lookup returns the fixed message, and invalid tool input keeps the baseline SDK behavior pinned in Story 1.3, while inaccessible dependencies are collapsed before entering the core and no enabled rule is silently skipped.

4. **Given** the read-only invalid-policy sentinel matrix — document, collection, and default scope; readable and unreadable sentinel collections; and readers of a document whose collection they cannot read
   **When** both tools run
   **Then** each result matches Stories 1.3 and 1.5 exactly, including `reason` only for `not_evaluated`, the location and identity rules, and the generic document-scope failure without `collectionId`
   **And** no result is clean or `not_evaluated` while an actor-readable sentinel is in scope, and an unreadable sentinel contributes nothing to collection-scoped or default-scope `lint_wiki`.

5. **Given** canonical visible metadata in a valid Outline document
   **When** the document passes through the selected baseline's actual Markdown-to-ProseMirror-to-Markdown round trip and is linted
   **Then** required metadata and its one-based diagnostic coordinates remain valid and stable
   **And** YAML front matter receives no special validation semantics without equivalent round-trip evidence.

6. **Given** actors with different document, collection, link-target, and audit visibility, including a same-team admin with collection `read` but without `readDocument`
   **When** they run both lint tools and query permitted evidence
   **Then** authorization and access-collapsing fixtures show zero disclosure of protected identities, metadata, content, scope, target state, or audit summaries beyond the policy class and the readability-gated missing-item names that NFR-11 permits
   **And** no Finding grants repair authority or widens the actor's logical change batch.

7. **Given** a configured collection containing representative document, link, hierarchy, and global-index Errors and no configuration System Failure
   **When** an authorized agent lints, repairs only resources already within its authority, and re-lints the same scope
   **Then** the final result is `complete: true`, contains zero Errors, and is clean while any remaining Warnings stay visible, and the loop terminates without requiring zero Warnings, semantic judgment, or edits outside the authorized batch
   **And** a scope that contains a `POLICY_CONFIGURATION_INVALID` System Failure is escalated to the Wiki operator rather than repaired by the agent, and reaches a Clean Result only after the operator corrects the configuration.

8. **Given** identical policy, actor authorization, request, and Wiki state
   **When** either read-only tool runs repeatedly
   **Then** normalized responses are byte-equivalent after excluding documented request-correlation metadata
   **And** titles, messages, database return order, locale, timing, and MCP client do not alter classification or ordering.

9. **Given** normal audit operation for every read-only outcome class
   **When** lint execution completes
   **Then** exactly one minimized retrievable summary exists per invocation that returns a lint result and matches the functional result's aggregate counts and completion state
   **And** authorized operators can obtain the required aggregate evidence without direct database access.

10. **Given** injected audit persistence failure
    **When** either read-only tool completes
    **Then** its functional result is unchanged and contains no audit-state or internal diagnostic field
    **And** only the minimized correlated operator diagnostic records the evidence gap.

11. **Given** collections without enabled policy
    **When** read-only tools and baseline MCP document operations are exercised
    **Then** lint returns the explicit not-evaluated outcome and baseline create/update behavior and response compatibility remain unchanged
    **And** deployment or tool discovery alone cannot activate collection policy.

12. **Given** the read-only integration and security suite on the selected source baseline
    **When** its evidence is reviewed
    **Then** it proves the exact merge base `4a5a616a21be800257dc11cef4263d0dd0412156`, one-endpoint discovery per token scope, shared-core behavior, generic reusable data, every Story 1.9 `toDOM` `href`/`src` sanitization path, and exclusion of the post-`v1.10.1` container-block patch-edit fix
    **And** every explicit later upstream change, if any, is identified as a separately approved and tested backport rather than a merge or rebase.

13. **Given** read-only acceptance has passed
    **When** Epic 1 is closed
    **Then** no MCP create/update hard enforcement has been integrated or enabled by this epic
    **And** AD-17 performance evidence, the D-9 constant derivations, and the complete Gate 1 decision remain in Epic 3, while image publication, deployment, OD-2/OD-6/OD-7 selection, production read-only rollout, and enforced rollout remain separate unfinished approvals.

## Epic 2: Safe Policy-Enforced MCP Document Writes

An authenticated MCP agent can create and update documents in Enforced Collections with deterministic validation of the one complete state that would be persisted. Errors and fail-closed failures reject without visible mutation effects, writes into Invalid-Policy Collections fail closed, Warnings remain non-blocking, approved runtime fail-open is unmistakably degraded, aborted attempts never present as validation outcomes, and every Validation Attempt whose outcome is established receives minimized isolated audit treatment.

### Story 2.0: Name the Missing Configured Item to Collection Readers

As an authenticated MCP agent that can read a collection,
I want each Finding for a missing required section, metadata field, or global-index link to name the configured item it lacks,
So that I can complete the lint–repair–re-lint loop from the Findings alone before write rejections return the same Findings.

**Traceability:**
CAP: CAP-1–CAP-3, CAP-4 configuration facet
FR: FR-2, FR-3, FR-5, FR-7, FR-9, FR-10, FR-12, FR-19, FR-21
NFR: NFR-6, NFR-10–NFR-12, NFR-17, NFR-22–NFR-26
SM: SM-I1, SM-I2, SM-I4, SM-I7, future Gate 4 prerequisites for SM-P3 and SM-P5 only, SM-C1, SM-C4, SM-C6
Gates: Gate 1 evidence contribution only; Story 2.1 depends on this story and starts only after it is done (Epic 1 retrospective action item 1)
AD: AD-1–AD-6, AD-9–AD-12, AD-14, AD-16, AD-18

**Acceptance Criteria:**

1. **Given** the shared lint core
   **When** the `Finding` contract and the result constructors are inspected
   **Then** `Finding` is `{ code, severity, message, location }` plus an optional `detail` that only `REQUIRED_SECTION_MISSING` may carry, as `{ kind: "section", heading, headingLevel }`, only `REQUIRED_METADATA_FIELD_MISSING`, as `{ kind: "metadata_field", field }`, and only `GLOBAL_INDEX_LINK_MISSING`, as `{ kind: "global_index", documentId, urlId }`, each with exactly those keys (AD-12)
   **And** the constructors reject a `detail` on any other code, a `kind` that does not match its code, and any additional key, so `detail` never carries another rule parameter, a regular expression, allowed metadata values, a fingerprint, or document content, and no `SystemFailure` carries `detail`.

2. **Given** a document unit or a global-index check
   **When** the application shell invokes the pure core
   **Then** it passes one boolean `detailVisible`, and when it is true each Finding of the three codes carries its `detail`: the configured heading text and level or field name from the emitting rule's own configuration, or the `documentId` and `urlId` of the missing index from the snapshot's readable `indexes`
   **And** when it is false no Finding carries `detail` and every other field is byte-identical to the result with `detail` removed, and the core performs no authorization of its own (AD-1).

3. **Given** each read-only surface
   **When** the shell derives `detailVisible`
   **Then** `lint_document` takes it from the existing collection-readability result, `true` for `readable` and `false` for `unreadable` and `unestablished`, without a second readability check, and `lint_wiki` takes it from the collection-read result that already fixes identity visibility for the invocation (AD-16): `true` for a collection scope, whose pre-admission `read` check passed, and per evaluated collection from `can(actor, "read", collection)` inside the snapshot for the default scope
   **And** the write surfaces are not changed here: Stories 2.1 and 2.3 pass the classification-time `readable` flag through the same input, so one rule serves every surface (NFR-22).

4. **Given** a global-index check of a collection the actor can read
   **When** a surface/index pair is evaluated
   **Then** a `GLOBAL_INDEX_LINK_MISSING` Finding, and therefore a `global_index` detail, exists only for an index document the actor can read in the same snapshot, while an unprovable pair stays the generic `VALIDATION_RUNTIME_FAILED` located `scope { scopeKind: "collection", collectionId }` without `detail` (AD-9, AD-12)
   **And** a fixture with one readable and one unreadable configured index on one surface proves that no `detail` names the unreadable index.

5. **Given** Findings that carry `detail`
   **When** results are ordered, messages are produced, and evidence is recorded
   **Then** `detail` is never part of the AD-4 sort key, Findings of one code at one location stay ordered by the rule-local ordinal, which follows configured order, and every registry message keeps its fixed generic text with no configured value interpolated
   **And** the `AuditDataV1` payload carries counts by code only and is identical whether or not `detail` was returned, and no log line, metric, tool description, or System Failure contains `detail` or a configured heading or field name (AD-14, NFR-11, NFR-17).

6. **Given** the policy schema in `server/wikiLint/core/registry.ts`
   **When** an entry configures heading text longer than 200 UTF-16 code units (an entry of `required_sections.headings` or `section_order.headings`, or a `metadataSection.heading`) or a metadata field name longer than 64 UTF-16 code units (an entry of `required_metadata_fields.fields` or a `metadata_field_formats` field `name`)
   **Then** that collection entry is invalid and becomes its collection-local fail-closed sentinel with the source-byte `invalidFingerprint` under the existing AD-5 and AD-6 rules, without blocking startup or affecting any other entry
   **And** a value of exactly each limit stays valid with an unchanged `policyFingerprint`, and fixtures cover each limit, one code unit over it, and a supplementary-plane character that crosses it.

7. **Given** the Story 1.10 golden repair-loop fixture (`server/routes/mcp/wikiLint.test.ts`, "repair loop") extended so that one document lacks two configured required sections, one lacks two required metadata fields while keeping its metadata section with at least one field, and the surface lacks links to two configured global indexes
   **When** the loop runs with a repair function that receives no conventions and may use only the previous round's results (Findings with their `detail`, and the result's `scope`) and the Markdown of documents the agent can fetch
   **Then** the scope reaches a Clean Result (`complete: true`, zero Errors, its Warning still visible) within the existing three-round bound, each missing-item repair inserting exactly the item its `detail` names, and no edit falls outside the batch
   **And** because allowed metadata values are outside the amended AD-12, the extended fixture's missing fields carry no format rule and it has no `METADATA_FIELD_FORMAT_INVALID` defect, which stays covered by the unchanged conventions-supplied loop that keeps passing.

8. **Given** an actor who can read a document but not its collection, and an actor whose collection-readability check is unestablished
   **When** `lint_document` evaluates a document whose Findings carry `detail` for a collection reader
   **Then** each receives the same codes, severities, messages, locations, and order with no `detail` on any Finding
   **And** the collection reader's `errors` with `detail` removed are byte-identical to theirs, which is the accepted NFR-11 residual: a document-only reader still cannot tell repeated missing-item Findings apart.

9. **Given** identical policy, actor authorization, request, and Wiki state
   **When** either read-only tool runs repeatedly for a collection reader and for a document-only reader
   **Then** each actor's normalized responses are byte-equivalent across runs, and the existing determinism, ordering, disclosure, and audit suites pass with no change other than the added `detail` on the three codes for collection readers
   **And** fixtures contain no environment-specific identifier, and this story integrates no MCP create/update enforcement.

### Story 2.1: Classify Enforced Writes and Decide from Post-Operation Policy

As an authenticated MCP agent,
I want every MCP document write to be classified once and decided by one server-owned function,
So that validation cannot be bypassed or reclassified by request parameters, handler differences, or collection transitions.

**Traceability:**
CAP: CAP-4, CAP-5
FR: FR-11–FR-13, FR-16–FR-18, FR-20, FR-23
NFR: NFR-8, NFR-10–NFR-12, NFR-15, NFR-16, NFR-20, NFR-22, NFR-23, NFR-25, NFR-26
SM: SM-I1, SM-I3, SM-I4, SM-I7, SM-C2, SM-C5, SM-C6
Gates: Gate 1 evidence contribution only; no policy or rollout activation
AD: AD-3, AD-5–AD-8, AD-11–AD-13, AD-18–AD-20

**Acceptance Criteria:**

1. **Given** an in-scope MCP `create_document` or `update_document` request that has passed, as applicable and in baseline order, authentication, MCP input-schema validation, lookup of its target document, parent, and template, and the handler-level authorization, including publish preconditions, that the baseline tool performs before invoking its writer, unpublish operation, or import job (AD-20 P0)
   **When** it is classified (AD-20 P1)
   **Then** classification is made once from the serving instance's immutable startup policy set, keyed on the post-operation collection UUID as the baseline resolves it — the existing `document.collectionId` for collected updates and unpublish, the collection returned by the baseline create authorization for creates, and the collection returned by the baseline publish authorization for draft publication — and yields exactly one of valid `enforced`, invalid-policy sentinel, or not an Enforced Write
   **And** classification never uses the raw `collectionId` input or rewrites the writer's inputs, the former collection, request-supplied values, client metadata, and document prose cannot select or override policy, and the classification does not change later in the operation.

2. **Given** a write classified as valid `enforced` or invalid-policy sentinel
   **When** P1 completes
   **Then** it has computed `readable = can(actor, "read", classified collection)` once, without inferring it from baseline authorization, and, for a create, pre-allocated the document ID that becomes the projection's ID and every location's `documentId` and appears in no Event column unless the row commits
   **And** a failure during P1 is AD-20 row 1: baseline behavior, or a Tool-Execution Error with the fixed message `The operation could not be completed` when no baseline analog exists, with no Validation Status and no summary; elapsed handler time at classification is checked against the 2-second P0 and P1 bound, an enforced write that exceeds it ends as such a row 1 Tool-Execution Error with the fixed message, and a fixture proves it.

3. **Given** a post-operation collection that is `null`, has no policy entry, or has valid `read_only` policy
   **When** built-in MCP create/update orchestration classifies the write
   **Then** the write keeps the exact baseline path and response shape with no `validation` field and no write-validation audit attempt, and is not reclassified by a later policy or collection change, including a baseline HTML import job
   **And** hard enforcement remains limited to MCP `create_document` and `update_document`, not UI, direct API, or lower-level shared writers.

4. **Given** a write classified under a valid `enforced` policy
   **When** its validation classification is supplied to the pure decision function
   **Then** the function applies the exact AD-13 closed/open matrix with the validation result, the immutable `runtimeFailureMode`, the within-limits flag, and the P5 half-deadline flag as explicit inputs
   **And** it returns one of `validated`, `validated_with_warnings`, `degraded_validation`, or `rejected` without parsing message prose.

5. **Given** complete validation with no Errors
   **When** there are zero Warnings or one or more Warnings
   **Then** the decision is respectively `validated` or `validated_with_warnings` and permits persistence
   **And** Warning severity cannot be promoted, hidden, or made blocking by collection configuration.

6. **Given** any known Error or invalid configuration
   **When** runtime failure mode is either `closed` or `open`
   **Then** the decision is always `rejected`
   **And** invalid configuration remains a System Failure, never a Finding or fail-open-eligible condition.

7. **Given** a runtime System Failure and no known Error
   **When** policy mode is `closed` or `open`
   **Then** `closed` yields `rejected`, and `open` yields `degraded_validation` with the triggering safe System Failure only for an eligible failure: `VALIDATION_RUNTIME_FAILED` and `VALIDATION_TIMEOUT` only when the projected document is within both write-eligibility constants and, for `VALIDATION_TIMEOUT`, only when P5 began with at least half of the validation deadline remaining, and `VALIDATION_RESOURCE_LIMIT_EXCEEDED`, which has no write-path source today
   **And** when either measure cannot be produced the document is treated as beyond the limits, an ineligible failure rejects the write exactly as in a `closed` collection, and `degraded_validation` dominates Warnings while still returning them with the triggering System Failure.

8. **Given** the two write-eligibility constants, a Markdown byte length and an internal-link reference count
   **When** they are implemented
   **Then** each is one named code-owned constant, distinct from the AD-16 snapshot caps, provisional until Story 3.3 fixes its value from AD-17's measured maxima
   **And** decision fixtures cover a document at each limit, beyond it, a missing measure, and P5 entered below the half-deadline threshold.

9. **Given** an authorization, input, conflict, persistence, invalid-configuration, or audit failure, or a failure of the write's own locking, transformation, media staging, model validation, or commit
   **When** the write path classifies it
   **Then** it is not eligible for runtime fail-open and follows its AD-20 row rather than the AD-13 runtime-failure row
   **And** audit failure remains outside the functional write decision entirely.

10. **Given** a write classified under an identifiable invalid-policy sentinel
    **When** P0 has succeeded
    **Then** the write is rejected immediately under AD-13 (P1 to P6, AD-20 row 4) as the modeled result `{ success: false, validation }` with `status: rejected`, empty `errors` and `warnings`, exactly one `POLICY_CONFIGURATION_INVALID` located `scope { scopeKind: "collection", collectionId? }`, the sentinel's `invalidFingerprint` only when `readable` holds, and no valid-policy field, and one write-validation summary is attempted (Story 2.7)
    **And** the path opens no transaction, builds no projection, stages no media, creates no worker job, evaluates no rule, persists nothing, emits no activity or mutation Event, and runs none of the baseline in-writer checks (patch target, attachment, import size, model validation, unpublish precondition, unchanged update), as fixtures prove for HTML-format create, template use, a `patch` whose target text is absent, an update with no changed field, an update containing embedded images, unpublish, and every other policy-bearing destination path, while a P0 failure keeps baseline behavior and records no summary.

11. **Given** a write classified under a valid `enforced` policy
    **When** the AD-8 in-transaction re-fetch (Story 2.3) or the AD-7 worker re-authorization (Story 2.5) finds a post-operation collection other than the classified one
    **Then** the write fails with a Tool-Execution Error whose first text block is the JSON `{ "error": { "id": "collection_conflict" } }`, names no collection, discards any validation already performed, persists nothing, carries no Validation Status, and records no summary (AD-20 row 2)
    **And** re-authorization precedes the collection comparison and the comparison precedes the AD-7 fingerprint comparison, while the invalid-policy path performs no re-check.

12. **Given** direct-collection create, parent-derived create, an existing collected-document update, a collectionless-draft update without publication, collectionless-draft publication, and unpublish with retained collection
    **When** each reachable destination-selection path is evaluated across absent policy, valid `read_only`, valid `enforced`, and identifiable invalid-policy states where applicable
    **Then** the selected policy and write behavior use only the closed post-operation collection inventory in the PRD and the criterion 1 classification keys
    **And** `collectionId` cannot move an already collected document, unpublish is not treated as leave-scope, and a collectionless update without publication remains at `null` with baseline response and no configured-write validation audit.

13. **Given** an authorized collectionless draft containing a stable known Error
    **When** `update_document` attempts to publish it into a destination with valid `enforced` policy
    **Then** validation rejects before publication, the draft's collection and publication state remain unchanged, and no successful mutation signal is emitted
    **And** exactly the required minimized rejection audit is attempted, and the response carries the valid policy identity only when the actor can read the destination collection.

14. **Given** actors without read access to the classified collection on document-membership updates, publication of a parent-bearing collectionless draft, and creation under a parent reachable by document membership
    **When** their enforced writes return a `validation` object
    **Then** it carries status, Findings, and System Failures but no `policySchemaVersion`, `policyFingerprint`, `invalidFingerprint`, `collectionId`, or Finding `detail`
    **And** the actor learns nothing beyond the policy class that NFR-11 permits.

15. **Given** authorized `move_document` and `restore_document` collection changes among `enforced`, unconfigured, `read_only`, and identifiable invalid-policy scopes
    **When** every direction permitted by baseline authorization is exercised with content that would be invalid under an enforced destination policy
    **Then** baseline authorization, persistence, response shape, and mutation-event behavior remain unchanged, with no validation field or configured-write validation-audit summary
    **And** the fixtures are labeled compatibility evidence only, never Projected Document or CAP-5 enforcement evidence, and no lint enforcement is added to either tool.

16. **Given** out-of-band drift after a permitted move or restore
    **When** subsequent read-only evaluation is requested
    **Then** `lint_wiki` can detect the drift only for a destination with valid configured policy inside the actor-authorized Evaluated Scope
    **And** unconfigured and invalid-policy destinations retain their approved not-evaluated or System Failure behavior without a false clean result.

### Story 2.2: Project the Complete Markdown Document Once

As an authenticated MCP agent,
I want Markdown creates and updates validated against the exact complete state they would persist,
So that valid-looking fragments cannot bypass policy and validation cannot drift from the eventual write.

**Traceability:**
CAP: CAP-5
FR: FR-11, FR-14–FR-17, FR-20
NFR: NFR-8–NFR-10, NFR-18, NFR-20, NFR-22, NFR-24, NFR-26
SM: SM-I1, SM-I3, SM-I7, SM-C1
Gates: Gate 1 projection-parity evidence contribution only
AD: AD-1, AD-2, AD-7, AD-8, AD-18, AD-20

**Acceptance Criteria:**

1. **Given** an authorized Markdown create or update classified under a valid `enforced` policy
   **When** projection runs
   **Then** it produces one immutable `ProjectedDocument` containing final title, canonical body/content/state, post-operation collection and parent, publication state, and rule-required relationships, and a create's projection uses the pre-allocated document ID from Story 2.1
   **And** projection creates no document, Attachment row, mutation Event, activity, or externally accessible blob, and an invalid-policy sentinel or a write that is not an Enforced Write builds no projection.

2. **Given** a Markdown create with or without a selected template
   **When** its projection is built
   **Then** template substitution, explicit field precedence, canonical Markdown/ProseMirror conversion, collection/parent placement, and publish state match the exact selected-baseline writer semantics
   **And** template use never substitutes for linting the resulting complete projection.

3. **Given** `replace`, `append`, `prepend`, or `patch` update input
   **When** its projection is built
   **Then** the resulting title and complete body use the exact selected-baseline transformation semantics for that mode, and unchanged policy-relevant content is included rather than validating only the incoming fragment
   **And** content-dependent edits (`append`, `prepend`, `patch`) are applied inside the AD-8 transaction after the locks, against the re-fetched state (AD-20 P4), while only input-only conversion, HTML import, and media staging run outside (P2) and every assumption they made is revalidated inside.

4. **Given** the selected `v1.10.1^{}` patch behavior
   **When** parity fixtures exercise supported patch edits, including baseline container-block behavior
   **Then** projection matches commit `4a5a616a21be800257dc11cef4263d0dd0412156`
   **And** the post-`v1.10.1` container-block patch-edit fix is neither copied nor assumed.

5. **Given** any create or update that changes destination or publication state
   **When** the projection is complete
   **Then** policy applicability uses its classified post-operation collection
   **And** final parent, publication, content, and relationships are available to every enabled `document`-surface rule before persistence.

6. **Given** the transaction phases of Story 2.3
   **When** an enforced write is projected and persisted
   **Then** the post-operation collection is compared with the classified one in P3, before projection, and a difference fails with the Story 2.1 `collection_conflict` Tool-Execution Error, while every assumption of the prepared P2 work is revalidated against the locked state as the projection is built once in P4
   **And** P7 stores exactly the projection validated in P5 without reapplying the edit, re-running conversion, or rebuilding the projection after the decision.

7. **Given** projection failure, input found invalid after classification, or a baseline transformation check that fails, such as an absent `patch` target or an import-size limit
   **When** projection cannot complete
   **Then** the failure is AD-20 row 3: rollback, a Tool-Execution Error carrying the Outline application error message when that error has a stable identifier and the fixed generic message otherwise, no `validation`, and one `aborted_before_decision` summary
   **And** the failure never becomes a lint Finding, and no partial document or externally visible effect is produced.

8. **Given** collocated projection-parity tests
   **When** they compare the projection with the actual baseline writer for create, templates, publish/unpublish, title-only changes, and every update mode
   **Then** final canonical title/body/state/relationships are identical for supported inputs
   **And** the fixtures remain generic and record no pilot schema or identifiers.

### Story 2.3: Enforce Markdown Creates and Updates Atomically

As an authenticated MCP agent,
I want enforced Markdown creates and updates to validate and commit as one authorized operation,
So that rejected or aborted writes leave the prior externally visible state unchanged while permitted writes persist exactly what was validated.

**Traceability:**
CAP: CAP-4, CAP-5
FR: FR-6, FR-11–FR-18, FR-20, FR-23
NFR: NFR-2, NFR-8–NFR-12, NFR-15, NFR-18–NFR-26
SM: SM-I1, SM-I3, SM-I4, SM-I7, SM-C1, SM-C2, SM-C4–SM-C6
Gates: Gate 1 atomicity and compatibility evidence contribution only
AD: AD-1, AD-2, AD-5–AD-9, AD-11–AD-13, AD-17, AD-18, AD-20

**Acceptance Criteria:**

1. **Given** a built-in MCP create/update classified under a valid `enforced` policy
   **When** write orchestration begins
   **Then** enforcement uses the immutable policy selected in Story 2.1 and the shared core accepted in Epic 1
   **And** `read_only` and unconfigured destinations remain on the unchanged baseline path, and the invalid-policy sentinel follows the Story 2.1 path that opens no transaction.

2. **Given** an enforced Markdown write
   **When** its preparation and transaction run
   **Then** input-only conversion and media staging (P2) run outside the transaction within the code-owned 30-second preparation bound measured from classification, which also covers acquiring the enforcement connection and issuing `BEGIN`, and expiry is AD-20 row 3
   **And** one unmanaged primary-database transaction at baseline `READ COMMITTED` locks the classified collection (`NO_KEY_UPDATE`) and then, for an update, the document row (`FOR NO KEY UPDATE`, with the writer's own re-lock downgraded to match) while a create takes no parent lock, then re-fetches and re-authorizes every mutation input and compares the post-operation collection (P3), where denial, a missing target, a lock or statement timeout, or connection loss is row 3 and a differing collection is row 2.

3. **Given** the 9-second validation deadline, which starts when the enforcement transaction opens and governs P3 to P5, and the separate 9-second persistence budget, which governs P7 and P8
   **When** the shell enters each phase boundary or related-state batch
   **Then** it issues `SET LOCAL lock_timeout` and `statement_timeout` outside any savepoint, never 0 or a negative value, from the monotonic remainder of the validation deadline in P3 to P5 and from the persistence budget less the 2-second probe reserve in P7 and for `commit()`, so a fail-open `VALIDATION_TIMEOUT` can still persist
   **And** a remainder below the code-owned floor is row 3 in P3 and P4 and on entering P5, `VALIDATION_TIMEOUT` once P5 has begun, and row 5 in P7; the sum of a Markdown write's code-owned bounds is at most 55 seconds; and the floor is the same named code-owned constant whose value Story 3.3 fixes.

4. **Given** valid transaction-time assumptions
   **When** the write is evaluated
   **Then** the transaction builds the authoritative projection from locked state (P4, Story 2.2), reads related state under its own savepoint per read in batches of at most 500 unique targets so that a contained failure becomes a System Failure while a failure that leaves the transaction unusable is row 3, runs the shared engine, and applies the Story 2.1 decision (P5, P6)
   **And** a failure of one rule kind yields one System Failure per (unit, code) located at the classified collection scope, and every Finding already produced is retained, including under an `open` runtime failure; only enabled rule kinds whose AD-3 surfaces include the document surface run, hierarchy and global-index rule kinds never run on the write surface and never make it incomplete, the AD-9 `readDocument` condition does not apply, and when the `documents` check is not required validation completes with zero counts and no Findings, so the decision is `validated` (AD-11, AD-13).

5. **Given** representative enforced writes
   **When** integration fixtures execute create with template/published/draft variants and update with `replace`, `append`, `prepend`, `patch`, title-only, publish, and unpublish variants
   **Then** every operation validates the full resulting title/body/state/relationships with every enabled `document`-surface rule under the post-operation policy
   **And** a valid-looking fragment cannot hide an Error in unchanged content.

6. **Given** zero Errors, Warnings only, a known Error, or a runtime-only System Failure
   **When** the central decision is applied
   **Then** persistence and rollback match AD-13 exactly, including eligible `degraded_validation` only for explicit per-collection `open` mode within the Story 2.1 eligibility rule
   **And** no MCP argument can request, widen, or override fail-open.

7. **Given** validation rejection (AD-20 row 4)
   **When** the transaction rolls back
   **Then** a rejected create leaves no document and a rejected update preserves prior content, state, relationships, and revision
   **And** no Attachment row, activity, successful mutation Event, or other externally visible successful-write effect remains.

8. **Given** a persist decision followed by a P7 failure — model validation, unpublish precondition, the unchanged-update check that compares the `revisionCount` read after the lock with the post-save value, a conflict other than row 2, or a database error or timeout
   **When** the transaction rolls back
   **Then** the result is AD-20 row 5: a Tool-Execution Error with baseline content or the fixed generic message, no `validation`, and one `aborted_after_decision` summary
   **And** a fail-open decision followed by such an abort returns no `degraded_validation` and records runtime fail-open as not exercised.

9. **Given** the P8 commit
   **When** `commit()` runs under a wall-clock timer equal to the remaining persistence budget less the 2-second probe reserve, so a commit timeout still leaves the probe its full bound, with the P7 and `commit()` statement timeouts set from that budget less the same reserve, and the shell never reads `transaction.finished`
   **Then** expiry of the `commit()` timer counts as a connection-level rejection, and any rejection triggers one probe on a fresh connection in a short transaction with `SET LOCAL statement_timeout` at the 2-second probe bound, acquisition included, whose own timer expiry means the probe cannot run: the pre-allocated `documentId` with `paranoid: false` for a create, or the writer's mutation Event by `documentId`, event `name`, and `createdAt` since the transaction started, filtered for this attempt's `validationCorrelationId`, for an update, publication, or unpublication
   **And** a found row is row 6, a missing row after a server-reported error (one produced from a PostgreSQL ErrorResponse whose `parent` carries the server `severity` and SQLSTATE `code`) is row 5, and a missing row after any other, connection-level error, or a probe that cannot run, is row 7: a Tool-Execution Error with the fixed generic message, no `validation`, no claim about persistence, and no request-path summary.

10. **Given** writer `afterCommit` callbacks registered on the enforcement transaction or on any child transaction of it, directly or through a child's `parent`
    **When** the attempt ends
    **Then** the transaction buffers them in registration order so Sequelize's own lists stay empty, drops those registered on a rolled-back savepoint, and starts each buffered callback independently only when the attempt establishes its own commit — its `commit()` resolves within its timer, or the Markdown-path probe finds the row this request wrote — waiting for them within the 2-second post-commit assembly bound, with a throw, rejection, or expiry logged only as a minimized correlated operator diagnostic that never affects row 6, the response, or the remaining callbacks
    **And** rows 5 and 7 discard the buffer, including the baseline event enqueue and collaboration reload, so no false signal is ever emitted, and a committed write whose attempt cannot establish its commit lacks those effects as the accepted residual RI-3a.

11. **Given** a persist decision whose commit is established
    **When** the write succeeds
    **Then** the transaction has persisted exactly the validated projection through existing save/publish hooks without reapplying the edit, every baseline mutation Event the writer created inside it carries `validationCorrelationId` (Story 2.7), and success with `validation` is returned only after commit
    **And** audit for the committed write is initiated immediately after commit and before response assembly.

12. **Given** MCP cancellation or client disconnect
    **When** it occurs before the persist decision
    **Then** the attempt is AD-20 row 3 and rolls back
    **And** cancellation after the persist decision does not stop the write.

13. **Given** an authorization, input, conflict, or persistence failure
    **When** it occurs before or during the write transaction
    **Then** it follows its AD-20 row — baseline behavior before classification, `collection_conflict` for a changed collection, and the row 3 or row 5 Tool-Execution Error otherwise — with rollback
    **And** the failure cannot become a Finding, `degraded_validation`, or runtime fail-open admission.

14. **Given** UI, direct-API, or lower-level shared writer paths and concurrent writers
    **When** they create or update documents
    **Then** this story adds no hard lint enforcement to those paths, and collocated transaction, row-lock, rollback, and concurrent-update tests prove the MCP-only boundary while benchmarkable baseline/enabled paths remain available for Epic 3's NFR-2 measurement
    **And** fixtures against a real PostgreSQL cover a child create against an enforced update of its parent, a deadlock with a baseline document-first writer whose enforced victim is row 3 or row 5, a `commit()` that hangs, a lock-queued write entering P5 below the half-deadline threshold, a document at an eligibility limit, every COMMIT error shape (server-reported, socket, client timeout) and a probe that cannot run, and a concurrent parent move between the re-fetch and commit of a create, which is not prevented and is later detected by `lint_wiki` as `PARENT_COLLECTION_MISMATCH`.

15. **Given** two actors whose enforced projections reference the same missing, deleted, or differently accessible target
    **When** create/update validation resolves related state through the Story 1.4 link function
    **Then** adapters collapse inaccessible target state before it reaches the shared core and return only safe source-document findings or System Failures
    **And** multi-actor fixtures on create and every update mode prove zero disclosure of protected target identity or metadata on the write surface.

### Story 2.4: Preserve Exact MCP Write Responses and Baseline Compatibility

As an MCP agent,
I want enforced write responses to expose one explicit validation outcome while unchanged scopes preserve baseline responses,
So that I can branch on stable machine-readable state without client-specific inference or compatibility regressions.

**Traceability:**
CAP: CAP-4, CAP-5
FR: FR-11–FR-13, FR-16–FR-18, FR-22, FR-23
NFR: NFR-11, NFR-15, NFR-19, NFR-20, NFR-22–NFR-26
SM: SM-I1, SM-I2, SM-I4, SM-I7, SM-C2, SM-C5, SM-C6
Gates: Gate 1 response-compatibility evidence contribution only
AD: AD-3–AD-8, AD-11–AD-13, AD-18–AD-20

**Acceptance Criteria:**

1. **Given** an enforced write whose commit is established
   **When** the MCP result is assembled
   **Then** the first content block's JSON object preserves all baseline document fields and adds the top-level `validation` with status `validated`, `validated_with_warnings`, or `degraded_validation` and ordered AD-4 `errors`, `warnings`, and `systemFailures`
   **And** `validation` carries `policySchemaVersion: 1` and the valid `policyFingerprint`, and no `invalidFingerprint`, only when the actor can read the classified collection, and no policy identity otherwise.

2. **Given** a committed enforced write
   **When** post-commit response assembly runs behind its own boundary, bounded at 2 seconds in total, that cannot raise into a Tool-Execution Error
   **Then** the optional enrichments are exactly `breadcrumb`, `shareUrl`, and the patch-mode second content block (the final-Markdown echo), each guarded independently and omitted on failure, and when the document identity fields themselves cannot be assembled the first block is `{ success: true, id, validation }`
   **And** a present patch block retains its baseline meaning without replacement, reinterpretation, or the post-`v1.10.1` patch fix.

3. **Given** a policy rejection (AD-20 row 4)
   **When** the MCP result is returned
   **Then** it is the modeled `{ success: false, validation }` with status `rejected`, contains no nonexistent document fields, and is not a Tool-Execution Error
   **And** a rejection under a valid policy carries that policy's identity when readable; an AD-7 fingerprint-mismatch rejection carries the request-time expected `policyFingerprint` when readable, empty `errors` and `warnings` even if Findings were produced, and exactly one `POLICY_CONFIGURATION_INVALID`; and a sentinel rejection carries `invalidFingerprint` when readable, empty `errors` and `warnings`, and exactly one `POLICY_CONFIGURATION_INVALID`.

4. **Given** any System Failure of an enforced write, including a failure of its document unit
   **When** it is located
   **Then** it is located `scope { scopeKind: "collection", collectionId? }` for the classified post-operation collection, with `collectionId` present only when the actor can read that collection
   **And** no valid policy identity is fabricated, raw configuration and other collections' policy state are never returned, and fixtures prove an actor without collection read learns only the policy class that NFR-11 permits.

5. **Given** an eligible runtime-only failure admitted through explicit `open` policy
   **When** the write's commit is established
   **Then** status is `degraded_validation`, the safe triggering System Failure is returned, and that status dominates any Warnings
   **And** invalid configuration, known Errors, ineligible failures, authorization, input, conflict, persistence, and audit failures can never produce this status, and an attempt that does not establish its commit never returns it.

6. **Given** an Enforced Write that ends in AD-20 row 2, 3, 5, or 7
   **When** the MCP result is returned
   **Then** row 2 is a Tool-Execution Error whose first text block is `{ "error": { "id": "collection_conflict" } }`; rows 3 and 5 are Tool-Execution Errors carrying the Outline application error message when that error has a stable identifier and `The operation could not be completed` otherwise; and row 7 is a Tool-Execution Error with that fixed message and no claim about persistence
   **And** none of them carries `validation`, and a row 1 failure keeps baseline behavior.

7. **Given** an unconfigured or `read_only` post-operation collection
   **When** create/update succeeds or fails
   **Then** no `validation` field or write-validation audit attempt is added
   **And** baseline response fields, modeled results, Tool-Execution Error behavior, and upstream compatibility remain unchanged.

8. **Given** any supported MCP client
   **When** it discovers and invokes document write tools
   **Then** the same existing `/mcp` endpoint and tool names are used
   **And** no client-specific endpoint, response adapter, prompt, or duplicated policy contract is introduced.

9. **Given** repeated identical write-decision fixtures
   **When** responses are normalized
   **Then** status, codes, severities, locations, System Failures, identity presence, and ordering are deterministic
   **And** clients never need to parse diagnostic prose or the absence of fields to infer an enforced outcome.

### Story 2.5: Carry Enforced HTML Projection Through a Distinct Trusted Worker Task

As an authenticated MCP agent,
I want enforced HTML creates carried through a distinct server-owned worker task with a trusted intent,
So that asynchronous processing cannot trust client claims, materialize against stale policy and authorization, or report a committed write as a failure.

**Traceability:**
CAP: CAP-4–CAP-6
FR: FR-11–FR-18, FR-20, FR-22, FR-23
NFR: NFR-8–NFR-12, NFR-15, NFR-17, NFR-20, NFR-22–NFR-27
SM: SM-I1, SM-I3, SM-I4, SM-I6, SM-I7, SM-C4, SM-C5, SM-C7
Gates: Gate 1 worker authorization and projection evidence contribution only
AD: AD-1, AD-2, AD-7, AD-8, AD-11–AD-15, AD-18, AD-20

**Acceptance Criteria:**

1. **Given** the shared HTML import conversion code
   **When** enforced HTML creation is implemented
   **Then** it runs as a distinct registered task with its own class and name that shares the baseline conversion code, while the baseline `DocumentImportTask`, its API mode, and its payload contract remain unchanged
   **And** only trusted server orchestration can select the enforced task, no worker job is created for an invalid-policy destination, and a baseline HTML import job is never reclassified.

2. **Given** an enforced HTML job
   **When** its intent is constructed
   **Then** it carries exactly the request and invocation IDs, `actorId`, `sourceIp`, the pre-allocated `documentId`, `expectedPolicyFingerprint`, the classification-time `readable` flag, `handlerEnteredAtEpochMs`, `classifiedAtEpochMs`, `deadlineAt` in epoch milliseconds, the auth envelope `{ credentialAuthType: "api" }` or `{ credentialAuthType: "oauth", authenticatedClientId }`, and the create inputs that the baseline passes to its import job — the staged-content reference in place of inline content, the source file name and MIME type, `title`, `icon`, `color`, `fullWidth`, `publish`, the classified collection ID, and `parentDocumentId`
   **And** it carries no access/API token, secret, cookie, authorization header, or client-claimed identity, a `templateId` is authorized but not applied on the HTML path exactly as in the baseline, and its props appear in no log line or tracer tag beyond the job ID and task name at every site (task start, task failure, tracer tags, queue failure).

3. **Given** a requester waiting for an enforced HTML job
   **When** the outcome is determined
   **Then** the requester writes a summary only for an outcome it determines before calling `queue.add` (row 3, deleting the requester-staged source content itself), treats any error from `queue.add` and any result without the `EnforcedImportResult` shape as row 7 with no requester summary, and waits for the job result until `deadlineAt`, stopping earlier only on MCP cancellation or client disconnect, which it reports as row 7 while the job may still commit
   **And** before reporting `aborted`, `rejected`, `conflict`, or no result, it probes the pre-allocated `documentId` once, and the probe and any summary read it triggers form a single read with no retry under the one 2-second probe bound, reporting a found row as `committed` from a committed summary (criterion 5) or as row 7 when no committed summary exists, and a probe that cannot run or cannot be bounded as row 7.

4. **Given** an enforced job received by the worker
   **When** processing begins
   **Then** the worker first looks up the pre-allocated `documentId` and returns a row found before the attempt has done any work as `committed` through `committedFromSummary`, without re-authorization, fingerprint comparison, or storage read; otherwise it reloads the actor, re-authorizes the destination, checks the AD-8 collection change (the `conflict` result), compares the current policy fingerprint, where a mismatch for any worker-time state (`read_only`, absent, or invalid) is `POLICY_CONFIGURATION_INVALID` and never fail-open, and only then converts, stages, and opens the AD-8 transaction
   **And** after acquiring the collection lock, and again before returning or summarizing any non-committed outcome (rows 2, 3, 4, 5), it repeats the lookup, converts a found row to `committedFromSummary`, and writes no summary for a converted attempt
   **And** the first lookup, or a lookup repeated before a non-committed outcome, that cannot run or cannot be bounded means the outcome cannot be established: the attempt ends in row 7 with no committed or failed claim, writes no summary, and retains the staged source.

5. **Given** a found committed row
   **When** `committedFromSummary(invocationId)` resolves it
   **Then** in the worker it waits up to the probe bound, and in the requester it reads once within the criterion 3 bound, for a summary whose `outcome` is `validated`, `validated_with_warnings`, or `degraded_validation`, treats `status` as authoritative, returns `errors` and `warnings` empty, rebuilds `systemFailures` only from `counts.byCode` entries whose code is a System Failure code (one entry per counted code with a fixed message at the collection scope location), and follows the intent's `readable` flag for the policy identity
   **And** an absent summary, or one with any other stored outcome, at the bound is row 7, which is the one FR-22 exception: the response reports an unestablished outcome, claims neither success nor failure, and leaves the committed document readable through the ordinary tools.

6. **Given** any worker outcome
   **When** the job returns
   **Then** it returns exactly `{ kind: "committed", documentId, validation } | { kind: "rejected", validation } | { kind: "conflict" } | { kind: "aborted", row: 3 | 5, message }`, where `conflict` is row 2 and the requester emits the `collection_conflict` Tool-Execution Error without a summary, and `message` follows the AD-20 message rule
   **And** the worker catches every exception raised by its own code and returns `aborted` by phase, so only a process crash, stall, queue failure, or a COMMIT or commit-detection lookup whose outcome cannot be established (criterion 4) reaches the requester as no result (row 7).

7. **Given** `deadlineAt`, set at classification to the 30-second preparation bound plus the 9-second validation deadline, the 9-second persistence budget, the 3-second audit bound, and a fixed 5-second grace
   **When** the worker runs
   **Then** it converts `deadlineAt` to a local monotonic remainder at job start, measures the preparation bound from `classifiedAtEpochMs` so queue wait is charged to it, starts its validation deadline when it opens its transaction, applies the Story 2.3 `SET LOCAL` and floor rules to its own transaction, and does not enter the persist step unless the remainder covers the persistence budget plus the audit bound
   **And** the HTML create's code-owned bounds, including the requester's post-`deadlineAt` tail of one 2-second probe read and 2-second assembly, sum to at most 62 seconds.

8. **Given** the worker transaction
   **When** it persists
   **Then** the AD-8 collection lock serializes the persist steps of two live attempts for one `documentId`, a unique violation of the pre-allocated `documentId` after the attempt's own persist decision returns that attempt's own `validation` as `committed` rather than row 5, and a successful commit persists the exact validated projection and returns `committed` with the document ID and the exact structured `validation`
   **And** when the commit-detection probe that follows the attempt's own rejected `commit()` finds the pre-allocated `documentId`, the worker may return that attempt's own `validation` as `committed` (row 6) only when the found row's title and `text` equal the title and `text` of this attempt's exact validated projection, and otherwise resolves the row through `committedFromSummary`
   **And** an attempt whose `commit()` rejected discards its buffered `afterCommit` callbacks because its probe cannot distinguish its own row from another attempt's.

9. **Given** the worker as the sole owner of evaluation, the AD-13 decision, the commit, and the audit summary for an enforced HTML create
   **When** summaries are written for one invocation
   **Then** a summary of a committed outcome replaces an `aborted_*` or `rejected` summary for the same Event ID, and never the reverse
   **And** `durationMs` adds the queue wait computed from `handlerEnteredAtEpochMs`.

10. **Given** text-only worker success, rejection, authorization denial, fingerprint mismatch, collection change, projection failure, or transaction rollback
    **When** integration fixtures run
    **Then** document persistence and structured outcomes match the synchronous enforced contract without duplicate documents, activities, or mutation Events
    **And** baseline API/import mode and unconfigured/read-only behavior remain unchanged.

11. **Given** the worker conformance suite
    **When** it runs
    **Then** it covers the full result union, `aborted` with a message, worker crash after commit, a redelivered job with status-only reconstruction, an interrupted requester wait, a requester probe that finds a committed row after an `aborted` result, two concurrent attempts for one `documentId`, a worker without the enforced task registered, `committedFromSummary` with a non-committed stored outcome, requester-staged source ownership, the HTML requester tail, and the absence of content in job-failure logs
    **And** client input cannot select the enforced intent or supply identity or policy authority, no access credential crosses the job boundary, and the story does not import the post-`v1.10.1` container-block patch-edit fix.

### Story 2.6: Materialize Staged Media Without Visible Partial Effects

As an authenticated MCP agent,
I want imported media to remain inaccessible until its validated document commits,
So that rejection, retry, cleanup failure, or worker crashes cannot create duplicate or visible orphaned effects.

**Traceability:**
CAP: CAP-5
FR: FR-14–FR-17
NFR: NFR-8–NFR-10, NFR-17, NFR-24–NFR-26
SM: SM-I1, SM-I3, SM-I4, SM-I7, SM-C1, SM-C4
Gates: Gate 1 media atomicity evidence contribution only
AD: AD-7, AD-8, AD-11, AD-18, AD-20

**Acceptance Criteria:**

1. **Given** an enforced write classified under a valid `enforced` policy whose input contains media that the baseline writer path would import, including HTML-import media and Markdown base64 images
   **When** media preparation begins (P2)
   **Then** every blob is staged under the server-owned `invocationId` and attempt and written at its final storage key under an Attachment ID pre-allocated for that attempt, so it stays Outline-inaccessible until that Attachment row commits
   **And** no committed Attachment row or public attachment ownership exists before validation permits materialization, no storage I/O runs inside an enforced transaction, and no media is staged for an invalid-policy destination.

2. **Given** staged media handles
   **When** Story 2.2 or Story 2.5 projects and validates the complete document
   **Then** attachment relationships participate in the one Projected Document and shared-rule evaluation
   **And** no blob is promoted merely because conversion or staging succeeded.

3. **Given** a permitted write
   **When** the primary transaction commits
   **Then** materialization is only the insertion of the corresponding Attachment rows inside that transaction together with the exact validated document projection
   **And** document, attachments, activity, mutation Event, and structured success become externally visible only after the commit is established.

4. **Given** an attempt that ends in AD-20 row 2, 3, 4, or 5, or on a unique violation of the pre-allocated `documentId` whose transaction rolled back
   **When** cleanup runs
   **Then** the attempt idempotently deletes only the blobs it staged, never another attempt's, and no document, Attachment row, activity, or successful mutation Event becomes visible
   **And** row 7 never deletes staged blobs, and cleanup failure leaves only Outline-inaccessible staged blobs plus a minimized correlated operator diagnostic.

5. **Given** requester-staged HTML source content
   **When** the invocation ends
   **Then** the requester deletes it before `queue.add` on a requester-determined row 3, the worker otherwise deletes it when it returns a terminal outcome (`committed`, `rejected`, `conflict`, or `aborted`) after its repeated lookup, the baseline conversion code's own delete is disabled for the enforced task, and row 7 leaves it, a source so retained that no later attempt consumes being an accepted orphan residual with no cleanup owner
   **And** an attempt whose input is gone is row 3, and the stager refuses new blobs after its phase bound or once cleanup has begun.

6. **Given** worker retry before commit or replay after commit-before-acknowledgement under the same `invocationId`
   **When** the job runs again
   **Then** a found pre-allocated `documentId` returns `committed` through `committedFromSummary`, and otherwise a fresh attempt runs with its own staged blobs, so at most one document, one Attachment-row set, and one set of mutation Events and activities ever commit for the invocation
   **And** a committed outcome supersedes an earlier rejected or aborted summary for the same Event ID as Story 2.7 requires, an outcome already reported to the agent is never rewritten, and the only residue an interrupted attempt may leave is Outline-inaccessible staged blobs.

7. **Given** failure injection at every stage, projection, validation, materialization, commit, cleanup, and acknowledgement boundary
   **When** the media lifecycle suite runs
   **Then** it proves zero accessible rejected-write or aborted-write effects, per-attempt cleanup ownership, and exactly one committed object set after retry/replay
   **And** unconfigured/read-only import behavior remains baseline-compatible, and blobs orphaned by a process crash stay inaccessible without a sweeper, which remains a recorded D-9 item revisited only if pilot evidence shows accumulation.

### Story 2.7: Record Correlated and Failure-Isolated Write-Validation Audit Evidence

As a Wiki operator,
I want one minimized durable summary for every Validation Attempt whose outcome is established,
So that successful, rejected, degraded, and aborted writes are accountable without making audit persistence part of write correctness.

**Traceability:**
CAP: CAP-6
FR: FR-16, FR-17, FR-20–FR-22
NFR: NFR-11, NFR-14, NFR-15, NFR-17, NFR-27
SM: SM-I1, SM-I4, SM-I6, SM-I7, SM-C4, SM-C7
Gates: Gate 1 audit-evidence contribution; Gate 4 measurement support without pilot claim
AD: AD-7, AD-12–AD-15, AD-18, AD-20

**Acceptance Criteria:**

1. **Given** an Enforced Write Validation Attempt whose outcome is established
   **When** it ends as `validated`, `validated_with_warnings`, or `degraded_validation` (row 6), `rejected` by an Error, an ineligible or fail-closed System Failure, or a policy-configuration rejection (row 4), `aborted_before_decision` (row 3), or `aborted_after_decision` (row 5)
   **Then** normal audit operation persists exactly one idempotent `wikiLint.write_validation` Event whose ID is the `invocationId`, with the server-generated `requestId` as request correlation
   **And** AD-20 rows 1, 2, and 7 record no request-path summary, and a summary written by the HTML worker for a row 7 attempt stands while an absent one is a recorded evidence gap.

2. **Given** a write-validation audit Event
   **When** its payload and row are inspected
   **Then** it conforms exactly to closed `AuditDataV1` with `scopeKind: collection` for the classified post-operation collection, the Event `collectionId` set to that collection and `documentId` set only when the document row exists, and data and columns that do not depend on whether the writing actor can read that collection
   **And** `policySchemaVersion` and `policyFingerprint` are present exactly when the write was classified under a valid `enforced` policy, with an AD-7 mismatch rejection recording the request-time values, and no body, excerpt, message, location, protected target, raw request or configuration, secret, invalid fingerprint, schema path, or extra policy array is persisted.

3. **Given** each established outcome
   **When** its aggregate fields are written
   **Then** `complete` means validation ran to completion with no System Failure, so an Error-only rejection is `complete: true`, and `runtimeFailOpenExercised` is true only for a committed `degraded_validation` write
   **And** a policy-configuration rejection (AD-7 mismatch or invalid-policy sentinel) records `outcome: rejected`, `complete: false`, zero evaluated counts, `runtimeFailOpenExercised: false`, and counts containing only its one System Failure, a sentinel rejection additionally omits both policy fields, and an aborted attempt records `complete: false`, zero evaluated counts, zero counts with an empty `byCode`, `runtimeFailOpenExercised: false`, and the valid-policy fields, never counting as validation success.

4. **Given** an enforced mutation
   **When** the writer creates baseline mutation Events inside the enforced transaction
   **Then** each carries `data.validationCorrelationId = invocationId` added to any existing keys
   **And** the independent write-validation summary can be correlated without copying lint detail.

5. **Given** a rejected or aborted attempt
   **When** its rollback completes
   **Then** its write-validation summary is attempted while no successful document mutation Event exists
   **And** the summary is evidence of rejection or abort, never an externally visible write effect.

6. **Given** a committed, degraded, rejected, or aborted functional outcome
   **When** audit persistence runs
   **Then** it is initiated immediately after an established commit and before response assembly, or after rejection or abort rollback, in an independent transaction with its own `SET LOCAL statement_timeout` equal to the 3-second audit bound, awaited with that bound, inserted by `INSERT … ON CONFLICT (id) DO UPDATE` that overwrites a stored `aborted_*` or `rejected` row only with a committed outcome (replacing `data`, `documentId`, and `collectionId` and keeping `createdAt`) and does nothing on any other conflict, with only the global-queue enqueue suppressed
   **And** audit success or failure cannot commit, reject, roll back, downgrade, or admit the write.

7. **Given** injected audit persistence failure
   **When** the MCP write result is returned
   **Then** the result remains unchanged and exposes no audit state or internal diagnostic, except the one FR-22 case in Story 2.5 where a lost HTML job result plus a missing committed summary is reported as an unestablished outcome
   **And** only a minimized structured operator diagnostic records request/invocation correlation.

8. **Given** an authorized operator query
   **When** `auditWikiLint` retrieves write-validation summaries
   **Then** the same-team-admin restriction, adopted Event names, existing retention, non-delivery to `"*"` processors, and prohibited-field guarantees from Story 1.8 remain intact, and the operator can calculate tool use, duration, completion, severity/code counts, Validation Status counts, aborted-outcome counts, and degraded-validation counts from the audit surface without direct database access
   **And** unauthorized actors cannot retrieve summaries or infer rejected protected targets.

9. **Given** normal and failure-injected write-audit fixtures
   **When** they cover one fixture per AD-20 row, every Validation Status, both aborted outcomes, both policy-configuration rejections, summary replacement (aborted then committed replaced, committed then aborted unchanged, rejected then committed replaced), and audit failure
   **Then** exactly-once behavior, no summary for rows 1, 2, and 7 on the request path, correlation, aggregate correctness, minimization, actor independence, authorization, and unchanged functional outcomes are asserted
   **And** the crash-after-commit-before-audit and row 7 evidence gaps remain explicit rather than widening the mutation transaction.

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
AD: AD-5, AD-6, AD-18, AD-19

**Acceptance Criteria:**

1. **Given** no `WIKI_LINT_CONFIG_PATH`
   **When** a production build starts
   **Then** startup succeeds with zero Configured Collections, the empty-set `policySetFingerprint`, and no active enforcement
   **And** deployment, `/mcp` discovery, or image contents cannot enroll a collection.

2. **Given** any loaded policy set
   **When** readiness is inspected through the extension of the baseline health endpoint
   **Then** it reports only readiness and the `policySetFingerprint`
   **And** configuration status, activation and invalid counts, raw policy, collection and document IDs, rules, parameters, JSON-Pointer paths, and invalid-entry detail are not exposed there; they appear only in the operator-only startup log fields of Story 1.2.

3. **Given** `WIKI_LINT_EXPECTED_CONFIG_FINGERPRINT` absent, matching, or mismatching
   **When** readiness is evaluated
   **Then** a supplied value is always compared with the startup `policySetFingerprint`, so a mismatch makes readiness false for every policy set and a match passes this check, and an absent value makes readiness false whenever any entry is valid and `enforced` or is an invalid-policy sentinel, and is permitted otherwise
   **And** a missing or mismatched value never weakens policy or enables runtime fail-open.

4. **Given** two serving instances for one prospective rollout
   **When** their readiness evidence is compared with the same expected fingerprint
   **Then** only instances reporting that exact policy-set fingerprint can become ready, and instances with different fingerprints may not simultaneously serve the same policy rollout
   **And** OD-7 selects blue/green or drain-and-replace, and no hot reload, watcher, admin mutation API, or cross-instance policy coordinator is introduced.

5. **Given** the startup diagnostics evidence
   **When** each startup-fatal class and each sentinel class is exercised
   **Then** fixtures prove the one stable code and the byte position or `file` logged without content for each startup-fatal class, the precedence of decoding defects over root-schema defects, the per-sentinel operator-only log fields, and a respawned worker serving the master's policy set after the mounted file changes
   **And** readiness is proven with and without the expected fingerprint.

6. **Given** the built artifact and generic configuration materials
   **When** they are inspected
   **Then** they contain implementation, generic schema, and generic examples only, with no pilot policy or environment-specific identifiers
   **And** policy changes still require a read-only mount change and restart, and disabling enforcement is an approved `read_only` configuration change and restart separate from image rollback.

7. **Given** completion of this story
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
AD: AD-1–AD-20 through the AD-18 layers, with AD-18 and AD-19 governing

**Acceptance Criteria:**

1. **Given** a clean supported verification environment
   **When** the retained conformance command runs
   **Then** it executes every AD-18 layer: pure-core code/severity/location/order fixtures including rank, path comparison, and non-ASCII coordinates; the forbidden-import check; configuration and fingerprint cases including root-level and nested duplicate keys, unpaired surrogates, non-canonical numbers, uppercase collection keys, BOM, invalid UTF-8, CRLF, and source-byte `invalidFingerprint` stability; startup diagnostics and readiness; the read-only invalid-policy sentinel matrix and `reason` field; identity omission for actors without collection read, asserting no disclosure beyond the policy class that NFR-11 permits; one fixture per AD-20 row including post-commit enrichment failure, a failing callback, and a fail-open write whose related-state read fails inside the transaction; Findings retained under an `open` runtime failure; the COMMIT probe outcomes and error shapes and `afterCommit` buffering; the HTML-worker result union, crash, redelivery, concurrency, and log-content cases; the `/mcp` socket timeout; `move_document` and `restore_document` compatibility; the persistence budget, P5 entry, and eligibility-limit cases; every AD-13 matrix row; `completedChecks` and prefix semantics; the AD-16 limits, admission, and admission order (a denied or missing scoped collection while the slot is held, identical errors for a missing and a denied target, a stalled pre-scope lookup on both read surfaces, sentinel, unconfigured, and empty-policy-set requests without admission, and slot release on every terminal path); a snapshot batch refused below the floor returning `VALIDATION_TIMEOUT` on both `lint_wiki` and `lint_document`; collection-graph checks for an actor with collection `read` but without `readDocument`, with and without a document readable through document membership and with memberships not preloaded, proving that no structure is read and no graph rule runs; `completedChecks` and prefix semantics under a timeout with an unprovable check earlier in unit order than a completed one, which is retained and counted; a vacuous check and a `graphAuthorized: false` check after the failing deadline check, neither listed nor reported; a scoped `lint_wiki` whose collection lookup fails; `lint_document` authorization completing before any snapshot batch; a same-team admin on a private collection without membership; a scoped collection whose `read` is revoked between the pre-admission check and the snapshot; a policy with only document rules reading no `documentStructure`, and a policy with only hierarchy or global-index rules serializing no Markdown for documents other than configured surfaces, counting no document units, and not failed by a limit on an input it did not load; a `lint_document` whose collection-readability check fails, for a sentinel and for a valid collection; a default-scope enumeration batch that fails other than by the floor; cancellation; summary replacement and `committedFromSummary`; requester-staged source ownership; real-PostgreSQL lock and hang cases; the `lint_wiki` document set; projection parity; metadata round trip; multi-actor disclosure, asserting zero disclosure beyond the NFR-11 policy class and readability-gated missing-item names, with Finding `detail` present for a collection reader and absent for a document-only reader and for an unestablished collection readability; row-lock, rollback, and snapshot concurrency; media stage/materialize/cleanup; audit idempotence, access, non-delivery, and failure injection; exact unconfigured and `read_only` compatibility; single-`/mcp` discovery per token scope; the L1–L11 link forms; and URL sanitization
   **And** every command, result, and raw evidence location is recorded.

2. **Given** the binding requirement inventory
   **When** coverage is generated
   **Then** every CAP, FR, NFR-6–NFR-27, SM-I1–SM-I4, SM-I6–SM-I7, SM-C1–SM-C7, AD-1–AD-20, and fixed D-9 contract maps to concrete tests, fixtures, source review, or an explicit unresolved gap
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

### Story 3.3: Produce Reproducible Performance, Growth, and Constant-Derivation Evidence

As a Wiki operator,
I want performance budgets measured on the adopted reproducible reference profile and every AD-17-derived constant fixed from that evidence,
So that Gate 1 latency, growth, and bound decisions use inspectable evidence rather than incidental developer-machine timing or provisional values.

**Traceability:**
CAP: CAP-1, CAP-3–CAP-5
FR: supporting evidence for FR-4, FR-7, FR-10, FR-13–FR-15
NFR: NFR-1–NFR-5, NFR-8, NFR-20, NFR-22
SM: SM-I5, SM-C1, SM-C2, SM-C5
Gates: Gate 1 performance evidence only
AD: AD-11, AD-13, AD-16–AD-18

**Acceptance Criteria:**

1. **Given** the deterministic seeded fixture generator
   **When** it creates reference datasets
   **Then** profiles are exactly 3 collections/150 documents and 10 collections/1,000 documents, average eight internal links per document, Markdown median/p95/max 8/32/128 KiB, hierarchy depth at most 12, and coverage of every rule class, every link-resolution class (resolvable, missing, deleted, and inaccessible targets), and every parent-resolution class (missing, deleted, inaccessible, and readable cross-collection parents), while the benchmark actor and policy produce no System Failure: no invalid-policy entry, and every global-index proving fact is provable for the benchmark actor
   **And** seed and dataset hash are stable and retained, the generator declares its per-document maximum internal-link reference count, which the manifest records, and the System-Failure classes stay covered by the Story 3.2 conformance fixtures rather than by the timed datasets.

2. **Given** the benchmark harness
   **When** it provisions the reference profile
   **Then** it uses a production build on Linux x86-64 with app limited to two dedicated vCPU/4 GiB and PostgreSQL 14.2 to two dedicated vCPU/4 GiB/local SSD on the same host, baseline Yarn, Node exactly the Dockerfile runner version, no artificial latency, and no competing traffic
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
   **Then** every measured run returns `state: complete` with no `VALIDATION_TIMEOUT`, the 150-document nearest-rank p95 is at most 10 seconds, and every measured 1,000-document run is at most 60 seconds
   **And** normalized runtime, peak working-set memory, query, document, and link costs are reported with any increase explained.

6. **Given** paired baseline and lint-enabled Markdown writes
   **When** create and every update mode are measured on the same fixtures
   **Then** validation overhead p95 is at most 500 milliseconds and baseline/enabled timings are reported separately, and the enforced-write samples include documents at the generator's Markdown-size maximum and at its link-reference maximum
   **And** HTML/import performance is reported separately without substituting for the required Markdown comparison.

7. **Given** the retained raw samples (D-9 evidence task)
   **When** the AD-17-derived constants are fixed
   **Then** each AD-13 write-eligibility constant (Markdown byte length; internal-link reference count) equals the largest value of its measure among retained enforced-write samples whose validation completed without `VALIDATION_TIMEOUT`; the AD-11 `lint_wiki` stop margin is no less than the largest retained atomic-unit time plus the largest retained result-assembly time charged to it, while every measured run still completes (criterion 5); and the AD-11 `SET LOCAL` floor is no less than the largest retained duration of a single statement issued under `SET LOCAL` in a pre-scope lookup, snapshot construction, or an enforcement transaction, and less than the smallest budget it guards (the 9-second validation deadline and the persistence budget less its probe reserve)
   **And** each value, the rule it satisfies, and its source samples are recorded in the manifest, the value is committed as the code-owned constant that Stories 1.3, 1.5, 1.7, 2.1, 2.3, and 2.5 use, the dependent fixtures are re-run with it (a document at each eligibility limit and one just above it, a lock-queued write entering P5 below the threshold, P5 entered with an exhausted remainder, stop-margin and prefix semantics under a timeout, a snapshot batch refused below the floor on both read surfaces, and a below-floor pre-scope lookup), and Gate 1 cannot be `ready` while any of these values is provisional or fails its rule.

8. **Given** completed benchmark runs
   **When** the retained manifest is inspected
   **Then** it includes source commit, local unpublished image digest, fixture-generator commit/seed/dataset hash, policy fingerprint, the exact `node --version`, Yarn and PostgreSQL versions including the server minor, CPU/kernel/container limits, process-topology settings (`SERVICES`, `WEB_CONCURRENCY`, `REQUEST_TIMEOUT`, connection-pool size), relevant DB settings, exact command, warmups, and sample count
   **And** every measured raw timing, RSS, and query sample value is retained, while the local digest remains benchmark identity only and not Gate 2 publication.

9. **Given** a budget breach or optimization
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
AD: AD-1–AD-20 evidence index, with AD-17–AD-20 governing readiness, failure boundaries, and gate separation

**Acceptance Criteria:**

1. **Given** completed implementation evidence
   **When** the English evidence index is assembled
   **Then** every binding CAP, FR, NFR, SM-I, SM-C, Gate 1 condition, AD-1–AD-20 decision, and fixed D-9 item links to a test, benchmark, fixture, manifest, source review, or explicit unresolved gap
   **And** each entry records the exact command, source revision, result, and raw evidence location.

2. **Given** the Gate 1 decision
   **When** readiness is evaluated
   **Then** `ready` is permitted only when SM-I1–SM-I7 and every phase-blocking requirement have passed with inspectable evidence
   **And** any missing, failed, contradictory, or unverified claim produces `not ready` without a silent waiver.

3. **Given** the retained decision record
   **When** it is reviewed
   **Then** it includes the exact baseline and merge-base, explicit backport inventory, generic-data review, startup/readiness fingerprint result, conformance results, and AD-17 benchmark manifest
   **And** it records the crash-after-functional-completion-before-audit and AD-20 row 7 evidence gaps without changing functional outcomes.

4. **Given** the collection-applicability acceptance contract
   **When** Gate 1 evidence is assessed
   **Then** the complete closed destination-selection inventory is linked to selector and tool-level fixtures for every applicable policy state, including the invalid-policy sentinel fixtures and identity omission for actors without collection read
   **And** `move_document` and `restore_document` evidence is labeled non-enforcement compatibility evidence, with no lint hook, validation field, configured-write validation audit, or CAP-5 coverage claim added to either tool.

5. **Given** the planning state at replan
   **When** the Gate 1 decision is assembled
   **Then** it records that no PRD and spine conflict is open (C-1 to C-7 and RI-1 to RI-4 and RI-6 closed by applied amendments) and treats as phase-blocking only the D-9 items: the tool input schemas, annotations, and token-scope gating and the L1–L11 link forms, each fixed by its story and proven by fixtures, and the write-eligibility constants, stop margin, and `SET LOCAL` floor, each fixed from AD-17 evidence in Story 3.3
   **And** it lists the accepted residuals and non-blocking items with owner and revisit condition: RI-3a (lost post-commit processing for a commit the attempt cannot establish), the two NFR-11 exceptions (policy class; readability-gated missing-item names) and the FR-22 exception, the residual that a document-only reader cannot tell repeated missing-item Findings apart, RI-5 (stale `server/tools/README.md` and `AGENTS.md` lines, lower-authority wording owned by a separately authorized companion edit), the D-9 orphan sweeper and 1 MiB cap, the D-8 baseline authorization gaps reported separately, the operator option of a convert-only HTML worker, and the FR-12 clarification recommended by the spine amendment of 2026-10-02 (owner Wiki operator, non-blocking), the residual that an actor with `read` but without `readDocument` may receive a clean result over the documents it can read when only document rules are enabled, and the residual that a default-scope request whose readable scope holds no configured collection returns the admission-rejection `failed` result under contention; the three architect items of `sprint-change-proposal-2026-10-01.md` §4.6 were decided in that amendment and are evidenced in Stories 1.3, 1.5, 1.6, and 1.7.

6. **Given** Gate 1 evidence is complete or incomplete
   **When** the record states its decision
   **Then** Gate 2 image publication, Gate 3 deployment, and Gate 4 read-only/enforced rollout remain separately approved and unauthorized
   **And** no image is pushed, environment changed, deployment performed, pilot policy mounted, or collection policy enabled.

7. **Given** the deferred operational decisions
   **When** later-gate prerequisites are listed
   **Then** OD-2, OD-6, and OD-7 retain their approved owners and revisit gates without invented environment-specific values
   **And** the index does not claim SM-P1–SM-P7 pilot evidence or production success.
