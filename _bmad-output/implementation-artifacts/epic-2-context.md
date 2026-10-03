# Epic 2 Context: Safe Policy-Enforced MCP Document Writes

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Extend the accepted Epic 1 lint engine to MCP `create_document` and `update_document`. A write whose post-operation collection has a valid `enforced` policy is classified once. It is validated against the one complete document it would persist and decided by one central function. Errors and fail-closed failures reject the write with no visible effect, and Warnings never block it. Invalid-policy collections fail closed. Eligible runtime failures may fail open only under an immutable per-collection `open` policy, and such a write reports `degraded_validation`. Aborted attempts never look like validation outcomes, and every established attempt gets one isolated, minimized audit summary. Story 2.0 comes first. It applies the amended result contract: a Finding for a missing required section, metadata field, or global-index link names the missing item to collection readers only. Agents can then repair from Findings alone, both in the read-only loop and after a rejected write. Writes into unconfigured and `read_only` collections keep exact baseline behavior.

## Stories

- Story 2.0: Name the Missing Configured Item to Collection Readers
- Story 2.1: Classify Enforced Writes and Decide from Post-Operation Policy
- Story 2.2: Project the Complete Markdown Document Once
- Story 2.3: Enforce Markdown Creates and Updates Atomically
- Story 2.4: Preserve Exact MCP Write Responses and Baseline Compatibility
- Story 2.5: Carry Enforced HTML Projection Through a Distinct Trusted Worker Task
- Story 2.6: Materialize Staged Media Without Visible Partial Effects
- Story 2.7: Record Correlated and Failure-Isolated Write-Validation Audit Evidence

## Requirements & Constraints

- **Baseline:** projection, including patch, matches `4a5a616a21be800257dc11cef4263d0dd0412156`. The post-`v1.10.1` patch-edit fix stays out.
- **Scope:**
  - Enforcement covers only MCP `create_document` and `update_document`.
  - UI, direct API, lower-level writers, `move_document`, and `restore_document` stay baseline. Move and restore fixtures count as compatibility evidence only.
  - A post-operation collection that is `null`, has no policy entry, or is `read_only` keeps the exact baseline path and response, with no `validation` and no write audit.
  - A former collection's policy never blocks a write.
- **Stability:**
  - Severities are fixed by the Epic 1 registry.
  - Configuration cannot promote or hide Warnings.
  - No MCP argument can request or widen fail-open, and clients never parse prose.
- **Atomicity:**
  - A rejected or aborted write leaves no document, changed revision, Attachment row, activity, mutation Event, accessible blob, or post-commit signal.
  - Success is returned only after commit.
- **Disclosure:**
  - Collection and policy identity appear only when the actor can read the classified collection. Finding `detail` is present exactly when the actor can read the classified collection, with writes passing the `readable` flag. Story 2.0 also caps heading text at 200 and field names at 64 UTF-16 code units in the shared policy schema, so an over-cap entry becomes a collection-local sentinel on every surface. The identity fields are `collectionId`, `policySchemaVersion`, `policyFingerprint`, and `invalidFingerprint`.
  - The accepted leaks are the policy class and the readability-gated missing-item names.
  - Inaccessible link targets reach the core already collapsed.
- **Audit isolation:** audit failure never changes an outcome or appears in a response. The one exception: an HTML job result is lost and no committed summary exists, so the response reports an unestablished outcome.
- **Artifacts and performance:**
  - No pilot identifiers. OD-2, OD-6, and OD-7 stay undecided, and no rollout is authorized.
  - Validation adds at most 500 ms at p95 over the baseline write. Epic 3 measures this, so baseline and enabled paths must stay benchmarkable.

## Technical Decisions

- **Finding `detail` (amended AD-12):**
  - `Finding` is `{ code, severity, message, location, detail? }`.
  - Exact closed shapes:
    - `REQUIRED_SECTION_MISSING`: `{ kind: "section", heading, headingLevel }`.
    - `REQUIRED_METADATA_FIELD_MISSING`: `{ kind: "metadata_field", field }`.
    - `GLOBAL_INDEX_LINK_MISSING`: `{ kind: "global_index", documentId, urlId }`, for a readable index only.
  - No other code and no System Failure carries `detail`.
  - The core receives one shell boolean, `detailVisible`, and does no authorization. Read surfaces take it from their existing readability result, where `unestablished` means false. Writes pass the classification-time `readable` flag.
  - `detail` is not a sort key. Messages stay generic.
  - `detail` never appears in `AuditDataV1`, logs, metrics, or descriptions.
  - The schema caps heading text at 200 UTF-16 code units and field names at 64. An entry over a cap becomes a collection-local sentinel.
- **Classification (AD-8):**
  - Runs once in P1, after the baseline pre-write steps, from the immutable startup policy set.
  - The key is the baseline-resolved post-operation collection, never the raw `collectionId` input.
  - P1 computes `readable` once and pre-allocates the ID of a create. P0 and P1 together are bounded at 2 s.
- **Sentinel path:** a modeled `{ success: false, validation }` with status `rejected` and one `POLICY_CONFIGURATION_INVALID`. It opens no transaction, builds no projection, stages no media, creates no job, runs no rules, and persists nothing.
- **Projection and transaction (AD-7, AD-8):**
  - Build one immutable `ProjectedDocument` with exact baseline semantics, and persist exactly that projection.
  - One unmanaged primary-database `READ COMMITTED` transaction runs in this order:
    1. Lock the collection (`NO_KEY_UPDATE`), then the document (`FOR NO KEY UPDATE`).
    2. Re-fetch, re-authorize, and compare the collection.
    3. Project and apply content-dependent edits.
    4. Validate, with related-state reads under per-read savepoints in batches of at most 500 targets.
  - A changed collection is the `collection_conflict` Tool-Execution Error, with no `validation` and no summary.
  - Only document-surface rules run on writes.
- **Phases and rows (AD-20):**
  - Phases P0 to P8 end in exactly one of seven rows: 1 baseline, 2 conflict, 3 `aborted_before_decision`, 4 `rejected`, 5 `aborted_after_decision`, 6 committed, 7 unestablished.
  - Tool-Execution Errors carry the Outline application error message when the error has a stable id, and `The operation could not be completed` otherwise.
- **Decision (AD-13):**
  - One pure function over the validation result, `runtimeFailureMode`, a within-limits flag, and a P5 half-deadline flag.
  - Only `VALIDATION_RUNTIME_FAILED`, `VALIDATION_TIMEOUT`, and `VALIDATION_RESOURCE_LIMIT_EXCEEDED` can fail open.
  - The first two also need the document within two code-owned constants, a byte length and a link count. A missing measure counts as beyond them.
  - A timeout also needs P5 to have begun with at least half of the deadline left.
  - `degraded_validation` takes precedence over Warnings.
- **Bounds (AD-11):**
  - Preparation: 30 s, from classification.
  - Validation: 9 s, P3 to P5.
  - Persistence: 9 s, including a 2 s probe.
  - Audit: 3 s.
  - Post-commit assembly: 2 s.
  - `SET LOCAL` timeouts come from the monotonic remainder, are never 0 or negative, and fail below a shared floor constant.
  - Totals: at most 55 s for a Markdown write and 62 s for an HTML create.
- **Commit:**
  - Never read `transaction.finished`.
  - On a `commit()` rejection, probe once on a fresh connection.
  - Buffer `afterCommit` callbacks until the attempt establishes its own commit.
- **Response:**
  - `validation` is a top-level key of the first content block.
  - `breadcrumb`, `shareUrl`, and the patch echo are optional enrichments, guarded independently.
  - Write System Failures are located at `scope { scopeKind: "collection", collectionId? }`.
- **HTML and media:**
  - An enforced HTML create runs as a distinct worker task with a credential-free trusted intent, a closed result union, a lookup-first check, `committedFromSummary`, and `deadlineAt`.
  - Media goes `stage -> project -> validate -> materialize`. Blobs are written at their final keys, with no storage I/O inside the transaction.
  - Each attempt cleans up only its own blobs, and row 7 never deletes.
- **Audit (AD-14, AD-15):**
  - One idempotent `wikiLint.write_validation` Event per established attempt, with the `invocationId` as its Event ID.
  - The payload is actor-independent `AuditDataV1` with `scopeKind: collection`.
  - It is written in an independent 3 s transaction, where a committed outcome replaces an aborted or rejected summary.
  - Mutation Events carry `data.validationCorrelationId`.

## Cross-Story Dependencies

- Story 2.0 must be done before Story 2.1 starts. `sprint-status.yaml` does not enforce this. Story 2.0 changes the read surfaces and also caps heading text at 200 and field names at 64 UTF-16 code units in the shared policy schema, so an over-cap entry becomes a collection-local sentinel on every surface. Finding `detail` is present exactly when the actor can read the classified collection, with writes passing the `readable` flag: Stories 2.1 and 2.3 later pass it through the same input.
- The F-5 snapshot re-check is withdrawn. Do not implement it.
- Later stories own the integrated fixtures: 2.1 AC10 to 2.7, 2.1 AC11 to 2.3 and 2.5, 2.3 AC2 to 2.6, 2.3 AC11 to 2.7, and 2.4 AC3 to 2.5. Story 2.2's projection feeds Stories 2.3 and 2.5.
- Epic 1 supplies the core, registry, policy set, the Story 1.4 link function, and the Story 1.8 audit writer and `auditWikiLint`.
- Story 3.3 fixes the eligibility constants and the floor, which stay provisional here. Epic 3 owns the NFR-2 measurement and Gate 1. Gates 2 to 4 are not authorized.
