---
title: "Proposed Contract Amendment: Enforced-Write Applicability and Invalid-Policy Identity"
status: applied
created: 2026-09-25
updated: 2026-09-30
source_prd: prd.md
source_architecture: ../../architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md
resolves:
  - C-1
  - C-2
reports_unresolved:
  - C-3
  - C-4
  - C-5
  - C-6
  - C-7
---

# Proposed Contract Amendment: Enforced-Write Applicability and Invalid-Policy Identity

## Status and Authority

This document is a proposal. It changes no approved source.

Applying its normative delta requires a separate, explicit operator authorization that names this proposal. That authorization would also be the explicit override needed to amend the adopted rule text of AD-7, AD-8, AD-12, and AD-14. It would further authorize the listed companion edits to `SPEC.md`, `server/tools/README.md`, and `AGENTS.md`. `CLAUDE.md` is a tracked symlink to `AGENTS.md` and follows it.

The binding authority order is unchanged:

1. The final PRD controls product scope and acceptance.
2. The PRD addendum controls its binding technical inputs.
3. `ARCHITECTURE-SPINE.md` controls implementation consistency.
4. `SPEC.md` remains the lean feature kernel and capability map.
5. `server/tools/README.md` and repository instructions remain binding repository contracts.

Until the delta is applied and reconciled:

- the current amended PRD and AD-1 through AD-19 remain binding exactly as written;
- the epics remain incomplete at final validation; and
- Gate 1 remains `not ready`.

Applying the delta would not make Gate 1 `ready`. The residual contradictions C-3 through C-7 still require separate decisions.

## Contradictions Resolved

### C-1: `read_only` Applicability

Under the PRD glossary, a Configured Collection is any collection whose valid Policy Configuration enables linting. AD-5 makes `activation: read_only | enforced` part of every valid policy, so a valid `read_only` collection is a Configured Collection.

These clauses apply write validation, a Validation Status, or validation audit to every Configured Collection, including `read_only` ones:

- **PRD glossary:** the Validation Status entry ("configured MCP write").
- **PRD narrative:** UJ-2 and the Section 4.5 description.
- **FR-11:** its third consequence ("places a Projected Document in a Configured Collection is validated before persistence").
- **FR-14 and FR-15:** "belongs to a Configured Collection".
- **FR-16:** "Every configured MCP create or update response".
- **FR-17:** "A configured MCP write rejected by validation".
- **FR-20:** "Every configured `create_document` and `update_document` validation attempt".
- **Companions:**
  - SPEC CAP-5, CAP-6, its validation constraint, and its unconditional "Errors block and Warnings do not.";
  - the enforcement list in `server/tools/README.md` and its line "Errors block MCP create and update operations"; and
  - `AGENTS.md` ("Errors block configured writes").

These clauses require `read_only` writes to keep baseline behavior and response shape, with no Validation Status and no configured-write validation audit:

- the amended Section 4.5 capability acceptance criterion;
- AD-8 ("`read_only` and unconfigured writes retain baseline behavior and response shape");
- AD-12 ("`read_only` and unconfigured writes add nothing");
- AD-18 ("exact unconfigured and `read_only` compatibility"); and
- AD-19 ("Disabling enforcement is an approved `read_only` config change").

A collection with an identifiable invalid Policy Configuration entry is not a Configured Collection. The following clauses assign baseline write behavior to collections that are outside Configured Collections, unconfigured, or without enabled policy:

- the fifth FR-11 consequence ("outside Configured Collections");
- the write half of the CAP-4 criterion ("outside configured scope");
- NFR-20 ("without enabled policy");
- SM-I7 ("Unconfigured collections");
- the Gate 3 smoke check; and
- in the companions, the README configuration-error sentence ("in a configured scope") and the README and SPEC unconfigured-behavior statements.

Read literally, these clauses conflict with FR-12's requirement that affected hard-enforced writes fail closed. The C-1 correction resolves this write-side conflict.

### C-2: Invalid-Policy Identity

- AD-6 permits a parseable invalid entry to expose only its `invalidFingerprint`, stable code, and schema path.
- AD-12 requires every enforced-write response to carry `validation.policySchemaVersion` and `validation.policyFingerprint`, and it defines no invalid-policy identity variant.
- AD-13 requires an invalid configuration to produce `rejected`.
- AD-14 makes `policyFingerprint` optional, but it does not say when the field is omitted or how an invalid-policy rejection is summarized.

To return a modeled invalid-policy rejection, an implementation would therefore have to fabricate a valid fingerprint, omit a required field, leak raw configuration, or invent an undefined variant.

Two more places run into the same identity question:

- **The AD-7 worker fingerprint mismatch.** A mismatch is `POLICY_CONFIGURATION_INVALID`, but AD-12 does not say whether the rejection carries the expected identity or the worker-time identity. The worker-time state may be an invalid sentinel.
- **The AD-7 "enforced write" requirements.** AD-7 requires a full projection and a worker intent. If "enforced write" also covered invalid-policy writes, those requirements would apply to writes that cannot be validated.

The delta settles both.

## Recommended Resolution in Brief

1. **Introduce three PRD terms: Enforced Collection, Invalid-Policy Collection, and Enforced Write.**
   - An Enforced Write is a built-in MCP `create_document` or `update_document` that passes the four baseline pre-write steps defined in A-1.
   - Its post-operation collection is an Enforced Collection or an Invalid-Policy Collection. That classification is fixed when the request is handled.
   - The core clauses use these terms directly. One usage note binds the remaining configured-write phrases in the PRD and its addendum.
   - `read_only`, unconfigured, and `null` destinations stay on the exact baseline path.
2. **Add one mutually exclusive invalid-policy identity to the AD-12 enforced-write response.**
   - Every `validation` object carries exactly one identity. It is either `policySchemaVersion` with `policyFingerprint`, or `invalidFingerprint`; the field that is present shows the kind.
   - An AD-7 mismatch carries the request-time valid identity.
   - Every other valid-policy response is unchanged.
3. **Keep the `AuditDataV1` schema closed and unchanged.** AD-14 gains presence and value rules for the two policy-configuration rejections. No invalid fingerprint is persisted.
4. **Define the invalid-policy sequence in AD-8 and scope AD-7.**
   - Rejection follows the four baseline pre-write steps.
   - It precedes projection and every check that runs inside the writer.
   - It opens no transaction and has no side effects.
   - AD-7 applies only under a valid `enforced` policy.
5. **Align companion wording** in SPEC, in the README, and in `AGENTS.md` (through the `CLAUDE.md` symlink), so that none of them restates the C-1 conflict.

## Proposed Normative Delta

This delta is exhaustive. Every text outside the replacements and insertions below remains unchanged.

### Part A: PRD (`prd.md`)

#### A-1. Glossary: add three terms and one usage note

Insert after **Degraded Validation**:

> - **Enforced Collection** — A Configured Collection whose valid Policy Configuration sets `enforced` activation. A Configured Collection with `read_only` activation is not an Enforced Collection.
> - **Enforced Write** — A built-in MCP `create_document` or `update_document` operation that meets both of these conditions:
>   - as applicable and in baseline order, it passes baseline authentication, MCP input-schema validation, lookup of its target document, parent, and template, and baseline pre-write authorization; and
>   - its post-operation collection is an Enforced Collection or an Invalid-Policy Collection under the serving instance's startup Policy Configuration.
>
>   The post-operation collection is determined as for its Projected Document, at the time the request is handled. This classification is made once per request and does not change later in that operation.

Insert after **Finding**:

> - **Invalid-Policy Collection** — A collection whose identifiable Policy Configuration entry is invalid. For write behavior, it is neither an unconfigured collection nor a collection without enabled policy. FR-12 governs its Enforced Writes. A rejection of such a write is a validation rejection for FR-16, FR-17, FR-20, and NFR-9.

Append after the last glossary entry:

> Wherever this PRD or its addendum uses "configured", in any inflection or hyphenation, to qualify an MCP write, create, update, write outcome, validation, validation attempt, Validation Status, or validation audit, it refers to an Enforced Write or to its validation. The phrase "hard-enforced write" has the same meaning. "Configured" keeps its ordinary meaning when it qualifies a collection, scope, policy, rule, parameter, or identifier.

#### A-2. Glossary: Validation Status

Replace:

> - **Validation Status** — The explicit outcome of validation for a configured MCP write: `validated`, `validated_with_warnings`, `degraded_validation`, or `rejected`.

With:

> - **Validation Status** — The explicit outcome of validation for an Enforced Write: `validated`, `validated_with_warnings`, `degraded_validation`, or `rejected`.

#### A-3. UJ-2

Replace:

> the server evaluates the fully projected document under the configured policy before persistence.

With:

> when the post-operation collection is an Enforced Collection, the server evaluates the fully projected document under its policy before persistence.

#### A-4. FR-11 consequences

Replace the third consequence:

> - A supported write that places a Projected Document in a Configured Collection is validated before persistence; a supported write that leaves configured scope is not blocked by the former collection's content policy.

With:

> - An Enforced Write whose post-operation collection is an Enforced Collection is validated before persistence; a supported write whose post-operation collection is not an Enforced Collection is not blocked by a former collection's content policy.

Replace the fifth consequence:

> - MCP writes outside Configured Collections retain upstream behavior and response compatibility.

With:

> - MCP writes that are not Enforced Writes retain upstream behavior and response compatibility. They include every write whose post-operation collection, when the request is handled, is `null`, has no Policy Configuration entry, or is a Configured Collection with `read_only` activation.

#### A-5. CAP-4 capability acceptance criterion (Section 4.4)

Replace:

> - A read-only request outside configured scope returns not evaluated; a write outside configured scope matches baseline upstream behavior.

With:

> - A read-only request outside configured scope returns not evaluated; a write that is not an Enforced Write matches baseline upstream behavior.

The read-only half of this criterion is deliberately unchanged; see C-3.

#### A-6. Section 4.5 description

Replace:

> **Description:** The shared lint policy evaluates the complete state a configured MCP write would persist.

With:

> **Description:** The shared lint policy evaluates the complete state that an Enforced Write into an Enforced Collection would persist; an Enforced Write into an Invalid-Policy Collection fails closed without evaluation.

The remaining description sentence is unchanged.

#### A-7. FR-14 and FR-15 statements

In FR-14, replace:

> For `create_document` whose Projected Document belongs to a Configured Collection, the system shall validate the complete Projected Document before persistence.

With:

> For a `create_document` Enforced Write whose Projected Document belongs to an Enforced Collection, the system shall validate the complete Projected Document before persistence.

In FR-15, replace:

> For `update_document` whose Projected Document belongs to a Configured Collection, the system shall validate the complete Projected Document before persistence for every supported update mode.

With:

> For an `update_document` Enforced Write whose Projected Document belongs to an Enforced Collection, the system shall validate the complete Projected Document before persistence for every supported update mode.

#### A-8. FR-16 and FR-17 statements

In FR-16, replace:

> Every configured MCP create or update response shall expose one Validation Status without requiring the client to infer validation from missing fields or message prose.

With:

> Every Enforced Write response shall expose one Validation Status without requiring the client to infer validation from missing fields or message prose. This requirement has one exception. Suppose an Enforced Write was classified under a valid `enforced` policy, and the server's re-check before commit then finds a post-operation collection that differs from the classified one. Whenever that difference is detected, the write fails with a protocol conflict error that carries a stable error identifier. It has no Validation Status and is not a validation attempt, and any validation already performed is discarded.

In FR-17, replace:

> A configured MCP write rejected by validation shall not persist partial document state or produce externally visible write side effects.

With:

> An Enforced Write whose Validation Status is `rejected` shall not persist partial document state or produce externally visible write side effects.

#### A-9. FR-20 statement and first consequence

Replace:

> Every configured `create_document` and `update_document` validation attempt shall attempt to record one audit summary, including attempts rejected before mutation. Under normal audit operation, exactly one retrievable summary shall be recorded per validation attempt.

With:

> Every Enforced Write validation attempt shall attempt to record one audit summary, including attempts rejected before mutation and rejections because the post-operation collection is an Invalid-Policy Collection. Under normal audit operation, exactly one retrievable summary shall be recorded per validation attempt.

Replace:

> - The summary records the Validation Status, duration, policy version or fingerprint, Finding counts by severity and stable code, and whether runtime fail-open was exercised.

With:

> - The summary records the Validation Status, the duration, Finding counts by severity and stable code, and whether runtime fail-open was exercised. When the Enforced Write was classified under a valid policy, the summary also records that policy's version and fingerprint. A rejection because the post-operation collection is an Invalid-Policy Collection records its stable System Failure code and no valid or invalid policy fingerprint.

#### A-10. Section 4.5 capability acceptance criteria: add two bullets

Insert after the bullet that begins "Runtime failure tests prove default rejection":

> - Invalid-Policy Collection fixtures cover each policy-bearing in-scope `create_document` and `update_document` path. The fixtures include:
>   - HTML-format create;
>   - template use;
>   - a `patch` whose target text is absent;
>   - an update with no changed field;
>   - an update containing embedded images; and
>   - unpublish.
>
>   They prove that once baseline authentication, input-schema validation, lookup, and pre-write authorization succeed, the write behaves as follows:
>   - It returns the modeled `rejected` Validation Status with the stable configuration System Failure.
>   - It persists nothing and creates no import job, attachment, activity, or successful-mutation signal.
>   - It exposes no fabricated valid policy identity and no raw configuration.
>   - It attempts exactly one minimized validation-audit summary. That summary's payload carries the stable System Failure code and no valid or invalid policy fingerprint.
>
>   A failed authentication, input-schema, lookup, or pre-write authorization check keeps its baseline behavior. It produces neither this outcome nor a validation-audit summary.
> - Classification fixtures prove three things:
>   - An HTML `create_document` Enforced Write may be classified under a valid `enforced` policy and then, before persistence, find a different fingerprint for the same post-operation collection. This covers worker-time `read_only`, absent, and invalid states. It then returns `rejected` with its request-time valid policy identity and one configuration System Failure.
>   - An Enforced Write classified under a valid `enforced` policy may have its post-operation collection change before or after validation. When the re-check before commit detects the change, the write fails with the protocol conflict error. It persists nothing and records no validation audit.
>   - A write that is not an Enforced Write when the request is handled is not reclassified by a later policy or collection change.

### Part B: Architecture Spine (`ARCHITECTURE-SPINE.md`)

AD identifiers, titles, `[ADOPTED]` markers, `Binds` lines, and `Prevents` lines remain unchanged. Only the rule text shown below changes, plus the amendment record added in B-5.

#### B-1. AD-7 — One side-effect-free Projected Document

Replace:

> an enforced write builds one full `ProjectedDocument`

With:

> an enforced write classified under a valid `enforced` policy builds one full `ProjectedDocument`

#### B-2. AD-8 — Enforced-write transaction and concurrency

Replace the final sentence:

> `read_only` and unconfigured writes retain baseline behavior and response shape; enforcement remains MCP-only.

With:

> In this spine, "enforced write", and "configured MCP create/update" in `Binds` lines, mean a PRD Enforced Write.
>
> **Classification.** An enforced write is classified as either a valid `enforced` policy or an invalid-policy sentinel. The classification is made once, from the serving instance's immutable startup policy set, when the MCP request is handled. It is keyed on the post-operation collection's UUID as the baseline resolves it:
>
> - for collected updates and unpublish, the existing `document.collectionId`;
> - for creates, the collection returned by the baseline create authorization; and
> - for draft publication, the collection returned by the baseline publish authorization.
>
> The classification never uses the raw `collectionId` input, and it does not rewrite the writer's inputs.
>
> **Collection change.** This rule applies to an enforced write classified under a valid `enforced` policy. An AD-8 in-transaction re-fetch, or an AD-7 worker re-authorization at any point up to commit, may find a post-operation collection other than the classified one. For example, a parent may have moved concurrently. Whenever the difference is detected, the write fails with an AD-12 unmodellable-failure `isError` result. The result carries a stable collection-conflict error identifier. Any validation already performed is discarded. There is no persistence, no Validation Status, and no validation audit. The check precedes the AD-7 fingerprint comparison, so an AD-7 mismatch always concerns the classified collection. The invalid-policy path opens no transaction and performs no re-check.
>
> **Invalid-policy sentinel.** For an invalid-policy sentinel, the write is rejected under AD-13 immediately after these baseline pre-write steps succeed, as applicable and in baseline order:
>
> 1. authentication;
> 2. MCP input-schema validation;
> 3. lookup of the target document, parent, and template; and
> 4. the handler-level authorization, including its publish preconditions, that the baseline tool performs before it invokes its writer, unpublish operation, or import job.
>
> A failure of any of these steps keeps baseline behavior. No check that the baseline performs inside or after its writer, unpublish operation, import job, conversion, content transformation, or model save runs on this path. That includes the patch-target, attachment, import-size, model-validation, unpublish-precondition, and unchanged-update checks. The path opens no write transaction and builds no projection. It performs no media staging, no worker job, no rule evaluation, no persistence, no activity, and no mutation Event.
>
> **Other writes.** `read_only` and unconfigured writes retain baseline behavior and response shape. A write that is not an enforced write at request time, including a baseline HTML import job, is not reclassified. Enforcement remains MCP-only.

#### B-3. AD-12 — Explicit result algebra

Replace:

> Enforced-write responses add:
>
> ```text
> validation.status = validated | validated_with_warnings | degraded_validation | rejected
> validation.policySchemaVersion
> validation.policyFingerprint
> validation.errors[]
> validation.warnings[]
> validation.systemFailures[]
> ```

With:

> Enforced-write responses add:
>
> ```text
> validation.status = validated | validated_with_warnings | degraded_validation | rejected
> validation.policySchemaVersion   valid-policy identity only
> validation.policyFingerprint     valid-policy identity only
> validation.invalidFingerprint    invalid-policy identity only
> validation.errors[]
> validation.warnings[]
> validation.systemFailures[]
> ```
>
> Every `validation` object carries exactly one policy identity. The AD-8 request-time classification fixes which one; the field that is present, `policyFingerprint` or `invalidFingerprint`, shows the kind.
>
> **Valid `enforced` policy.** An enforced write classified under a valid `enforced` policy carries `policySchemaVersion: 1`, that policy's `policyFingerprint`, and no `invalidFingerprint`.
>
> **AD-7 fingerprint mismatch.** If AD-7 rejects such a write for fingerprint mismatch, whatever the worker-time state, its `validation` contains:
>
> - `status: rejected`;
> - the request-time identity, which is the expected `policyFingerprint` from the trusted job intent;
> - empty `errors` and `warnings`, even if Findings were produced before the mismatch was detected; and
> - exactly one `POLICY_CONFIGURATION_INVALID` System Failure.
>
> **Invalid-policy sentinel.** An enforced write classified under an identifiable invalid-policy sentinel carries only that sentinel's AD-6 `invalidFingerprint`, and neither valid-policy field. Its `status` is `rejected`, its `errors` and `warnings` are empty, and its `systemFailures` contains exactly one `POLICY_CONFIGURATION_INVALID`.
>
> **Location and disclosure.** Both rejection kinds locate their System Failure as `scope { scopeKind: "collection", collectionId? }` for the classified post-operation collection. `collectionId` is present only when `can(actor, "read", collection)` holds. The policy identity is returned to an actor who has passed the baseline write authorization for the operation, as on every other enforced-write path. No valid policy identity is fabricated. Raw configuration and the policy state of other collections are never returned.

Rationale (not part of the AD text): AD-5 entries carry no schema version, so `POLICY_CONFIGURATION_INVALID` is the only AD-3 code an entry-level sentinel can carry.

The adopted sentence that follows the block remains unchanged: "Successful writes preserve existing document fields and add `validation`; patch preserves its final-Markdown block. Policy rejection returns `{ success: false, validation }` as a modeled result without nonexistent document fields. `read_only` and unconfigured writes add nothing."

#### B-4. AD-14 — Minimized durable Event summaries

Replace:

> No additional key may carry bodies, excerpts, messages, locations, raw config/request, or unresolved target identity.

With:

> No additional key may carry bodies, excerpts, messages, locations, raw config/request, or unresolved target identity.
>
> **Policy fields.** In `wikiLint.write_validation`, `policySchemaVersion` and `policyFingerprint` are present exactly when the enforced write was classified under a valid `enforced` policy. An AD-7 mismatch rejection records the request-time values.
>
> **Policy-configuration rejections.** Two AD-12 rejection kinds are policy-configuration rejections: the AD-7 mismatch and the invalid-policy sentinel. Both record:
>
> - `outcome: rejected`;
> - `complete: false`;
> - zero evaluated document and link counts;
> - `runtimeFailOpenExercised: false`;
> - `scopeKind: collection`; and
> - counts containing only their one System Failure, as `systemFailures: 1` and one `byCode` entry.
>
> **Invalid-policy sentinel rejection.** In addition, an invalid-policy sentinel rejection omits both policy fields. It persists no fingerprint, schema path, or configuration content; its only policy-related data is the stable System Failure code count.
>
> Event columns follow the existing rule for safe document and collection IDs. A collection-change conflict records no summary.

#### B-5. Amendment record

Append at the end of the document, after the Deferred table:

> ## Amendment Record
>
> | Date | Decisions | Change | Authority |
> | --- | --- | --- | --- |
> | *date of application* | AD-7, AD-8, AD-12, AD-14 | Rule text amended for enforced-write applicability and invalid-policy identity; identifiers, `Binds`, and adopted status unchanged. | Operator authorization recorded in the PRD and architecture workspace memlogs, applying `_bmad-output/planning-artifacts/prds/prd-outline-2026-09-20/amendment-proposal-enforced-write-applicability.md` |

When applying the record, replace the italic date cell with the actual application date.

### Part C: Companion Wording

#### C-a. `SPEC.md`

Replace the CAP-5 intent:

> Configured MCP document writes are checked against the complete state they would persist.

With:

> MCP document writes into Enforced Collections (PRD term) are checked against the complete state they would persist.

Replace the CAP-6 intent:

> Authorized operators receive durable, privacy-preserving aggregate evidence for lint and configured-write validation attempts.

With:

> Authorized operators receive durable, privacy-preserving aggregate evidence for lint and Enforced Write (PRD term) validation attempts, including invalid-policy rejections.

Replace the constraint:

> - Validate `create_document` and every `update_document` mode against the full Projected Document. Select policy from its post-operation collection; unconfigured collections retain baseline behavior and response compatibility.

With:

> - Validate `create_document` and every `update_document` mode against the full Projected Document when its post-operation collection has valid `enforced` policy. Select policy from its post-operation collection; unconfigured and `read_only` collections retain baseline write behavior and response compatibility.

In the constraint that begins "Errors block and Warnings do not.", replace:

> Errors block and Warnings do not.

With:

> Errors block Enforced Writes (PRD term) and Warnings do not.

#### C-b. `server/tools/README.md`

Insert after the bullet list that follows "Create one reusable lint engine and call it from:":

> Create and update enforcement applies only when the post-operation collection's
> policy enforces writes or its configuration entry is invalid. Other collections
> keep upstream write behavior.

Replace:

> Errors block MCP create and update operations. Warnings are returned but do not
> block writes.

With:

> Errors block MCP create and update operations into collections whose policy
> enforces writes. Warnings are returned but do not block writes.

Replace:

> Configuration errors must fail closed for hard-enforced writes in a configured
> scope and return a distinct machine-readable error. Unconfigured collections must
> retain upstream behavior until explicitly enabled.

With:

> Configuration errors must fail closed for MCP create and update operations into
> a collection whose configuration entry is invalid and report a distinct
> machine-readable System Failure. Unconfigured and `read_only` collections must
> retain upstream write behavior.

Replace:

> - compatibility tests proving unconfigured collections retain upstream behavior.

With:

> - compatibility tests proving unconfigured and `read_only` collections retain
>   upstream write behavior.

#### C-c. `AGENTS.md` (managed `bmad:context` block)

Apply this one-line replacement exactly and only once, to `AGENTS.md`, inside its managed block.

- Leave the block's verification stamp unchanged. This edit does not re-verify the block.
- Record the edit in the PRD workspace memlog.
- Do not edit through the `CLAUDE.md` path. `CLAUDE.md` must remain a symlink (git mode `120000`).

Replace:

> - Return stable machine-readable issue codes. Errors block configured writes; warnings do not.

With:

> - Return stable machine-readable issue codes. Errors block enforced MCP writes; warnings do not.

### Explicitly Unchanged

**PRD.** Everything not listed above is unchanged, including:

- the Configured Collection definition;
- FR-1 through FR-10, FR-12, FR-13, FR-18, FR-19, and FR-21 through FR-23;
- the applied scope-transition criterion and its destination-selection inventory;
- every NFR, SM, and Gate text; and
- OD-1 through OD-7.

**Architecture Spine.** AD-1 through AD-6, AD-9 through AD-11, AD-13, and AD-15 through AD-19 are unchanged. That includes:

- the AD-6 fingerprint algorithms;
- the AD-12 read-only `PolicyIdentity` union and state algebra;
- the AD-13 decision matrix; and
- the `AuditDataV1` schema.

**PRD addendum.** The text is unchanged. The A-1 usage note binds its configured-write phrase. Its statements on Projected Document evaluation describe how validation is performed, not when it applies.

## Decisions Made Explicit by This Delta

Authorizing the delta also accepts the following decisions. Each one follows from resolving C-1 or C-2.

1. **Request-time classification.** An operation is classified once, when the request is handled. This keeps the AD-7 mismatch an Enforced Write; without it, a worker-time `read_only` or absent state would make the mismatch contradict FR-11.

   Writes that are not Enforced Writes at request time stay on the baseline path. They are not reclassified by a later policy restart or collection move. A baseline HTML import job queued before a restart that enables enforcement can therefore land unvalidated. That window already exists under unamended AD-7. `lint_wiki` detects the result later. The OD-7 owner should include draining the import queue in the drain-and-replace procedure. This is a recommendation, not an OD-7 value.
2. **Invalid-policy precedence.** For an Invalid-Policy Collection, rejection pre-empts every baseline check that runs inside or after the writer or import job. That covers:
   - patch-target errors;
   - the unchanged-update error;
   - import-size and conversion errors;
   - model validation; and
   - unpublish preconditions.

   Each such request returns `rejected` and produces one audit summary.
3. **An invalid entry fails closed whatever activation it declares.** AD-5 already makes an invalid entry a fail-closed sentinel. This delta settles that every MCP `create_document` and `update_document` into that collection is a rejected Enforced Write.

   As a consequence, a malformed `read_only` rollout or a malformed AD-19 disable change blocks those MCP writes. Gate 4 step 1 validates configuration only for rollout, and the AD-19 readiness fingerprint confirms only which file is being served. Operators should therefore validate a disable change before restart. Making that step mandatory is outside this delta.
4. **Identity parity.**
   - `invalidFingerprint` is returned to an actor who passed baseline write authorization, just as `policyFingerprint` already is on the valid path.
   - `collectionId` appears in a rejection location only when the actor may read that collection.
   - Whether either fingerprint may reach an actor without collection read access is residual C-5.
5. **AD-7 mismatch response.** A worker fingerprint mismatch discards any Findings already produced. It carries only the request-time valid identity and `POLICY_CONFIGURATION_INVALID`.
6. **Collection-change conflict.** Request-time classification rules out re-selecting policy partway through an operation.
   - **What happens instead:** when the post-operation collection of an enforced write classified under a valid `enforced` policy changes, the write fails with a protocol conflict error that carries a stable identifier. The change can be detected at the AD-8 re-fetch or at the AD-7 worker re-authorization, whenever up to commit. Any validation already performed is discarded.
   - **Why a conflict:** this prevents validating under one collection's policy and persisting into another.
   - **Scope of the FR-16 exception:** FR-16 gains a narrow exception for this case only. The case is not a validation attempt, so FR-20 and NFR-15 are unaffected.

## Resulting Write Behavior

This matrix follows from the delta. It is not an additional normative source.

| Request-time post-operation collection | Operation | Validation field | Status | Policy identity | Write-validation audit |
| --- | --- | --- | --- | --- | --- |
| `null` or no policy entry | `create_document` or `update_document` | none | none | none | none |
| Valid `read_only` | `create_document` or `update_document` | none | none | none | none |
| Valid `enforced` | `create_document` or `update_document` | present | any AD-13 status | `policySchemaVersion` + `policyFingerprint` | one, with both policy fields |
| Valid `enforced`; AD-7 worker mismatch against any worker-time state | HTML `create_document` | present | `rejected` | request-time `policyFingerprint` | one, with request-time policy fields |
| Valid `enforced`; collection differs at the AD-8 re-fetch or AD-7 re-authorization | `create_document` (parent-derived, including HTML) or `update_document` | none (`isError` conflict) | none | none | none |
| Invalid-policy sentinel | `create_document` or `update_document` | present | `rejected` | `invalidFingerprint` only | one, without policy fields |
| Any | `move_document` or `restore_document` | none | none | none | none; FR-18 unchanged |
| Any | baseline authentication, input-schema, lookup, or pre-write authorization failure | none | none | none | none |

Other valid-`enforced` writes that end in a protocol error after classification are covered by residual C-6. Examples are a failure after validation, a failure after commit, a re-authorization denial, and a transformation failure.

A valid `read_only` policy may still declare `runtimeFailureMode: open`. The mode has no write effect, because no write validation runs. This follows from AD-5 and AD-13 and is not changed.

## Why This Delta Is Minimal

- **C-1** changes only the clauses that give validation, status, or audit to all Configured Collections, or baseline behavior to Invalid-Policy Collections.
  - The usage note binds the remaining configured-write phrases, so clauses whose meaning is already consistent need no rewrite. These are:
    - the Error and Warning glossary entries;
    - FR-12, FR-13, FR-18, and FR-22;
    - NFR-2, NFR-8, and NFR-14;
    - SM-I3 and SM-I6;
    - the Section 4.5 criterion from the previous authorized amendment;
    - the Section 4.6 description;
    - Section 7.1; and
    - the addendum.
  - The Invalid-Policy Collection definition settles NFR-20, SM-I7, and Gate 3 without editing them.
- **C-2** adds one mutually exclusive response field, taken from the adopted `PolicyIdentity` vocabulary, plus AD-14 presence and value rules. It adds no response wrapper, discriminator field, audit key, System Failure code, or decision-matrix row.
- **AD-7 and AD-8** receive only two things. The first is the invalid-policy sequence that non-disclosure and determinism require: authorization precedes rejection, and no writer-internal check competes with it. The second is the classification timing that keeps one identity per operation.
- **Pre-existing gaps on the enforced path stay unchanged.** The delta handles only the collection-change case, because its own request-time classification creates that case (Decision 6). Post-validation failures, post-commit failures, transformation failures, and re-authorization failures are reported as C-6 instead. The `scopeKind` of ordinary write summaries is reported as C-7.
- **Companion edits** are short alignments. Without them, the same C-1 conflict would remain in lower-authority binding sources.

## Considered Alternatives

### C-1 alternatives

| Alternative | Verdict | Reason |
| --- | --- | --- |
| Narrow each affected FR inline ("a Configured Collection with `enforced` activation or an identifiable invalid entry") without a term | Rejected | The long qualifier would repeat across FR-11, FR-14–FR-17, FR-20, the glossary, and the companions. Configured-write phrases elsewhere would stay ambiguous. |
| Redefine Configured Collection to mean `enforced` only | Rejected | FR-4, FR-5, FR-7 through FR-9, and Gate 4 step 2 rely on read-only linting of `read_only` collections. Every read-only requirement would change. |
| Validate `read_only` writes in advisory mode, with a status but no blocking | Rejected | This contradicts the just-applied Section 4.5 criterion, AD-8, AD-12, AD-18, and AD-19. It would add response fields and audit to baseline writes, and it would change the meaning of Gate 4 read-only rollout. |
| Add only the Enforced Collection term, without Enforced Write | Rejected | An invalid-policy destination is not an Enforced Collection, so FR-16, FR-17, and FR-20 would still need a second qualifier for fail-closed invalid-policy writes. |
| Classify at persistence time instead of request time | Rejected | For an AD-7 mismatch, the worker-time state can be absent, `read_only`, or invalid. The identity would then be missing or contradictory. Baseline-path writes would also need new worker checks, which breaks the exact-baseline requirement. |

### C-2 alternatives

| Alternative | Verdict | Reason |
| --- | --- | --- |
| Replace the flat fields with `validation.policy: PolicyIdentity` | Rejected | This changes the shape of every successful enforced response and rewrites the Story 2.4 response criteria. A mutually exclusive field achieves the same effect. |
| Add a `validation.policyStatus: "valid" \| "invalid"` discriminator | Rejected | Field presence already discriminates, because exactly one of `policyFingerprint` and `invalidFingerprint` is always present. The System Failure code alone does not discriminate, since `POLICY_CONFIGURATION_INVALID` also appears on AD-7 mismatch. A discriminator would add a field to every successful response without adding information. |
| Omit identity for invalid-policy rejection | Rejected | AD-6 designates `invalidFingerprint` as the safe identity of an invalid entry, and the adopted AD-12 `PolicyIdentity` union already carries an invalid variant. Omitting it would create a third write-response shape with no identity. |
| Fabricate or zero a `policyFingerprint` | Rejected | The proposal constraints and AD-6 prohibit it, and it would falsely identify a valid policy. |
| Return protocol `isError` | Rejected | AD-12 reserves `isError` for invalid calls, authorization denial, or unmodellable failures. FR-16 requires a Validation Status for a modeled fail-closed rejection. |
| Add `invalidFingerprint?` to `AuditDataV1` | Rejected | This widens a closed durable schema. Parity would also force a change to the read-only audit contract (FR-19, Story 1.8). The delta leaves NFR-16 as it is. Operators own the configuration and can validate it offline, and the audit already records the stable code count. |

## Residual Contradictions: Reported, Not Resolved

C-3, C-5, C-6, and C-7 predate this delta. C-4 also predates it, but the delta extends it: B-3 adds one more rule that depends on the same assumption. The delta resolves none of them, and each needs a separate decision. Where the delta touches one of them, the entry says how.

### C-3: Read-only treatment of Invalid-Policy Collections (product decision)

On one side, three clauses require a document or request outside a Configured Collection, or outside configured scope, to return policy-not-configured/not-evaluated:

- FR-4, third consequence;
- FR-11, fourth consequence; and
- the unchanged read-only half of the CAP-4 criterion.

An Invalid-Policy Collection is outside Configured Collections by definition. In addition, FR-7 (first consequence) scopes collection lint to "that Configured Collection", and FR-1 (fourth consequence) treats policy-not-configured as not evaluated.

On the other side:

- FR-12 requires invalid configuration to produce a distinct stable System Failure.
- AD-12 defines `not_evaluated` as "policy absent" with empty `systemFailures`, and it includes an invalid `PolicyIdentity` variant for read-only results.
- The applied Section 4.5 criterion already assumes "their approved not-evaluated or System Failure behavior".
- Story 1.3 criterion 6 applies FR-12 over FR-4 by specificity. The source text does not state that precedence.

Open questions:

- Do scoped and default `lint_wiki` include readable Invalid-Policy Collections as System Failures?
- If they do, does one such collection make a default-scope result non-clean?

The A-1 definition speaks only "for write behavior", so it does not decide read-only semantics. It can stand as written if C-3 is settled as `not_evaluated`. No other edit in Part A, B, or C depends on the answer.

### C-4: Invalid entries without a computable `invalidFingerprint` (architecture decision)

- AD-6 canonical JSON "rejects lone surrogates". A parseable invalid entry that contains a lone-surrogate escape therefore has no computable `invalidFingerprint`.
- AD-5 makes duplicate root and collection keys startup-fatal. It does not say whether a duplicate key nested inside an entry is root-fatal or entry-local.
- Two adopted rules assume that every sentinel has an `invalidFingerprint`, and neither is defined for such entries:
  - the read-only `PolicyIdentity`; and
  - `policySetFingerprint`, and through it the AD-19 readiness fingerprint.
- The B-3 write-identity rule adds a third dependent rule. C-4's resolution must either preserve the assumption or amend all three rules together.
- A candidate resolution is to make any identifiable entry that cannot be canonicalized, or decoded without duplicates, startup-fatal. That would amend AD-5.

### C-5: Policy identity for actors without collection read access (security decision)

The baseline authorizes the following writes without any collection-level read check:

- **Document-membership updates.** A document-membership `update` needs no collection-level check.
- **Publishing a parent-bearing collectionless draft.** `authorizeDocumentPublish` authorizes `publish` on the draft and `createChildDocument` on the parent. It performs no create or read check on the requested collection, and `documentUpdater` then publishes into that collection. The actor may hold no permission on it.
- **Cross-team case (statically inspected, not runtime-confirmed).** In the inspected baseline code, neither `Collection.findByPk` nor the `createChildDocument` policy restricts the requested collection to the actor's team. If that is confirmed, classification, returned identity, and Event columns could reflect another team's policy. The underlying baseline authorization question is outside this feature's scope and should be reported separately.

Adopted AD-12 returns `policyFingerprint` and Findings for such enforced writes. NFR-11 forbids collection metadata the actor may not access. The write response can therefore act as an oracle for the target collection's policy class and identity. The same question applies to which collection identifiers an audit Event may carry under FR-21 and NFR-11.

This delta suppresses `collectionId` in response locations under AD-4. It keeps `invalidFingerprint` at parity with `policyFingerprint`, and it leaves Event columns under the existing AD-14 rule.

Two possible resolutions each carry a further cost:

- **Withholding identity** would also amend the B-3 exactly-one-identity rule and the B-4 presence rule.
- **Denying such writes** would change baseline authorization behavior.

### C-6: Post-classification protocol failures on the enforced path (architecture and product decision)

Several adopted rules conflict when a write classified under a valid `enforced` policy ends in a protocol error instead of a modeled result:

- **FR-16** requires a Validation Status in every Enforced Write response.
- **AD-12** reserves `isError` for unmodellable failures.
- **FR-20 and AD-14** require one summary per validation attempt. `AuditDataV1.outcome` has no value for "validated but not persisted".
- **NFR-15 and SM-P6** require a durable audit record for every write admitted through fail-open.

This conflict predates the delta. The one case the delta itself creates, a collection change after classification, is resolved by Decision 6 and the narrow FR-16 exception. The following cases remain:

- **(b)** A failure occurs after validation, so the write does not commit. This covers a conflict (other than the Decision 6 collection change), model validation, an unpublish precondition, the unchanged-update check, and persistence.
- **(c)** Response assembly fails after commit. Examples are a breadcrumb, presenter, or HTML-job reload failure.
- **(d)** A transformation, conversion, or import-size failure occurs during projection, before validation. The order of these checks relative to validation is also undecided. Story 2.2 criterion 7 already keeps baseline behavior for transformation failures.
- **(e)** A re-authorization denial, actor-reload failure, or row-lock or statement timeout occurs at the AD-8 re-fetch or the AD-7 worker, after classification.

A candidate resolution:

- **Cases (b), (d), and (e):** roll back, return a protocol error, and record no summary. For (d), transformation-time checks run before validation.
- **Case (c):** attempt the summary with the committed status. Never suppress audit for a committed write.
- **All cases:** add a matching FR-16 exception.

Any resolution must keep the A-1 rule that classification does not change during an operation. The invalid-policy path defined in this delta opens no transaction and persists nothing, so it does not depend on C-6.

### C-7: `scopeKind` for ordinary write-validation summaries (architecture decision)

`AuditDataV1.scopeKind` is required. AD-14 does not define its value for ordinary `wikiLint.write_validation` summaries (validated, warning-bearing, degraded, or rejected by a known Error). The delta sets `scopeKind: collection` only for the two policy-configuration rejections.

One candidate resolution is `scopeKind: document`. That candidate must handle a create rejected by a known Error, which has no document. It must also either accept or avoid mixed `scopeKind` values within `outcome: rejected`.

## Impact After Application

| Contract area | Impact |
| --- | --- |
| CAP-4 | Write applicability becomes explicit for unconfigured, `read_only`, `enforced`, and invalid-policy destinations. Invalid-policy write rejection is traced here and in the PRD Section 4.5 criteria. Read-only behavior is unchanged pending C-3. |
| CAP-5 | Projection validation is limited to Enforced Writes into Enforced Collections. Invalid-policy destinations fail closed under FR-12 without projection. |
| CAP-6 | Write-validation audit covers Enforced Write validation attempts, including invalid-policy rejections. The audit schema is unchanged. |
| UJ-2 and Section 4.5 description | Narrative aligned to Enforced Collections. |
| FR-11, FR-14–FR-15, FR-17, FR-20 | Amended as listed. For a valid `enforced` policy, behavior is unchanged except for three things: request-time classification, the AD-7 mismatch identity, and the collection-change conflict (Decision 6). |
| FR-16 | Amended as listed. It gains one exception, for the collection-change conflict (Decision 6). |
| FR-12, FR-13, FR-18, FR-22 | Text unchanged. Through the usage note, their configured-write and hard-enforced-write phrases now mean Enforced Write. FR-12 fail-closed applies to every Invalid-Policy Collection, whatever activation it declares (Decision 3). |
| FR-1–FR-10, FR-19, FR-21, FR-23 | Unchanged. None contains a bound phrase. The C-3 read-only clauses are untouched. |
| NFR-2, NFR-8, NFR-14 | Text unchanged. Their configured-write and configured-validation phrases now mean Enforced Writes. |
| NFR-9 | Text unchanged. It covers invalid-policy rejections through the A-1 definition. |
| NFR-11 | Text unchanged. Write-surface identity follows Decision 4, pending C-5. |
| NFR-16 | Text unchanged. The delta does not change how an invalid entry is located. |
| NFR-20 | Text unchanged. For write behavior, "without enabled policy" excludes Invalid-Policy Collections by definition. Unconfigured and `read_only` writes keep baseline behavior. |
| Other NFRs | Unchanged. |
| SM-I3, SM-I6, SM-I7 | Text unchanged. SM-I3 and SM-I6 apply to Enforced Writes through the usage note. For writes, SM-I7's "unconfigured" excludes Invalid-Policy Collections. |
| Other SMs | Unchanged. |
| Gate 1 | Application and replanning would remove the C-1 and C-2 source blockers. C-3 through C-7 still block `ready`. |
| Gate 2 | Unchanged and not authorized. |
| Gate 3 | Text unchanged and not authorized. Its unconfigured-collection smoke check excludes Invalid-Policy Collections. |
| Gate 4 | Unchanged and not authorized. Implementation readiness, image publication, deployment, `read_only` rollout, and `enforced` rollout remain separate approvals. |
| AD-7, AD-8, AD-12, AD-14 | Rule text amended as listed, with an amendment record appended to the Spine. Identifiers, `Binds` lines, and adopted status are unchanged. OD-4, which AD-14 resolves, keeps its closed Event schema. |
| AD-1–AD-6, AD-9–AD-11, AD-13, AD-15–AD-19 | Unchanged. |
| OD-1–OD-7 | Unchanged. No environment-specific value is introduced. |
| SPEC | Aligned as listed. "AD identifiers unchanged" remains true. |
| README and `AGENTS.md` | Aligned as listed. `CLAUDE.md` follows through its symlink. The README's illustrative JSON response example predates this delta and is not normative; reconciliation records it. |
| PRD addendum | Text unchanged. Its configured-write phrase is bound by A-1. |

## Application Plan (Only After Separate Authorization)

1. Apply the delta:
   - Apply Part A to `prd.md` and Part B to `ARCHITECTURE-SPINE.md` exactly. Update only their `updated` frontmatter dates. Fill the B-5 date with the actual application date.
   - Apply Part C exactly.
   - Apply the `AGENTS.md` line once, inside its managed block, and leave the verification stamp unchanged. Then verify that `git ls-files -s CLAUDE.md` still shows mode `120000`.
2. Record the change through `_bmad/scripts/memlog.py`. Never edit either memlog by hand.
   - In the PRD workspace memlog, record the authorization, the application, the addendum binding, and the `AGENTS.md` edit.
   - In the architecture workspace memlog, record the operator authorization and the AD-7, AD-8, AD-12, and AD-14 rule-text amendments.
3. Reconcile:
   - Mark this proposal `applied`.
   - Reconcile the PRD, addendum, Architecture Spine, SPEC, `server/tools/README.md` (including its illustrative example), and `AGENTS.md`.
   - Record any new contradiction as blocking rather than silently editing a companion.
4. Replan only the affected epics content, keeping the 3-epic, 21-story structure:
   - **Requirements Inventory and summaries:** FR-11, FR-14–FR-17, FR-20, CAP-5, CAP-6, the AD-7, AD-8, AD-12, and AD-14 summaries, and the Epic 2 goal.
   - **Story 2.1:**
     - request-time classification keyed as in AD-8;
     - invalid-policy sequencing and its modeled rejection; and
     - the collection-change conflict.
   - **Story 2.2:**
     - determine the post-operation collection and the invalid sentinel before projection or media handling, so that Invalid-Policy Collections get no projection; and
     - amend criterion 6 so that a changed post-operation collection fails with the B-2 collection conflict, while other changed assumptions still rebuild and revalidate.
   - **Story 2.3:**
     - remove the invalid-configuration case from criterion 5, because the sentinel follows the AD-8 path that opens no transaction; and
     - add the Markdown collection-change conflict.
   - **Story 2.4:**
     - add the response identity variant, the mismatch response, the `collectionId` rule, and the collection-change conflict response; and
     - remove the note about the C-1/C-2 contradiction.
   - **Story 2.5:**
     - no worker job for invalid-policy destinations;
     - the request-time mismatch identity and mismatch rollback inside the materialization transaction;
     - the worker collection-change conflict; and
     - the no-reclassification fixture for a baseline HTML job.
   - **Story 2.6:** no staging for invalid-policy destinations.
   - **Story 2.7:** audit values for invalid-policy and mismatch rejections, and no summary for a collection-change conflict.
   - **Story 3.2:** include invalid-policy sequencing, classification, identity, and the collection-change conflict in the AD-18 evidence layers.
   - **Story 3.4:** replace the C-1/C-2 blocker with blockers for C-3 through C-7 while they remain open.
   - **Blocker notes:**
     - C-3: Stories 1.3, 1.5, 1.10, and 2.1 criterion 12.
     - C-4: Stories 1.2, 1.3, 1.10, 2.1, 2.4, and 3.1.
     - C-5: Stories 2.1, 2.3, 2.4, 2.7, and 3.2.
     - C-6: Stories 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, and 2.7.
     - C-7: Story 2.7.
5. Re-run CAP, FR, NFR, SM, Gate, and AD coverage validation. Mark `step-04-final-validation` complete only if no gap, contradiction (including C-3 through C-7), placeholder, or unverified claim remains.
6. Do not implement product code, publish images, deploy, configure collections, or authorize rollout.

## Suggested Authorization Wording

> I authorize applying the exact reviewed delta from `amendment-proposal-enforced-write-applicability.md`, including the AD-7, AD-8, AD-12, and AD-14 rule-text amendments with the Spine amendment record and the listed SPEC, README, and `AGENTS.md` alignments, and I accept its stated explicit decisions. I do not authorize implementation, image publication, deployment, configuration, or rollout.

C-3 through C-7 each need a separate decision. This wording does not cover them.
