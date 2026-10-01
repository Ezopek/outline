---
title: "Proposed Contract Amendment: PRD Alignment with Architecture Decisions C-3, C-5, and C-6"
status: applied
created: 2026-09-30
updated: 2026-09-30
source_prd: prd.md
source_addendum: addendum.md
source_architecture: ../../architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md
resolves:
  - "Pending PRD alignment: C-3 (read-only invalid-policy sentinel)"
  - "Pending PRD alignment: C-5 (policy identity and actor-independent audit)"
  - "Pending PRD alignment: C-6 (post-classification failures and validation-attempt boundary)"
  - "Pending PRD alignment: addendum audit payload (credentialAuthType)"
reports_residual:
  - RI-1
  - RI-2
  - RI-3
  - RI-4
  - RI-5
  - RI-6
---

# Proposed Contract Amendment: PRD Alignment with Architecture Decisions C-3, C-5, and C-6

## Status and Authority

This document is a proposal. It changes no approved source.

Applying its normative delta requires a separate, explicit operator authorization that names this proposal. That authorization would also permit the listed edits to `ARCHITECTURE-SPINE.md`, `SPEC.md`, `server/tools/README.md`, and `AGENTS.md`. `CLAUDE.md` is a tracked symlink to `AGENTS.md` and follows it.

The binding authority order is unchanged:

1. The final PRD controls product scope and acceptance.
2. The PRD addendum controls its binding technical inputs.
3. `ARCHITECTURE-SPINE.md` controls implementation consistency.
4. `SPEC.md` remains the lean feature kernel and capability map.
5. `server/tools/README.md` and repository instructions remain binding repository contracts.

**Inputs.** The operator decisions C-3, C-4, C-5 (both halves), C-6, and C-7 and the four gate decisions recorded in the architecture workspace memlog are fixed and are not reopened. Closing the Pending list also requires writing into the PRD some spine rules that the architecture memlog records as author defaults open to operator veto. "Decisions Made Explicit" labels each such rule, and authorizing this delta turns it into an operator decision. The proposal keeps every AD identifier, adds no AD rule text, and introduces no OD-2, OD-6, or OD-7 value.

Until the delta is applied and reconciled, the PRD controls where it and the spine disagree, AD-3, AD-8, AD-12, AD-14, AD-18, and AD-20 keep their "PRD alignment pending" markers, and Gate 1 stays `not ready`. Application alone does not make Gate 1 `ready` (see Impact After Application).

## Conflicts Closed

The spine's "Pending PRD alignment" paragraph lists the clauses below, except NFR-15, the Section 4.5 authorization sentence, classification fixture 2, and Warning criterion, and the addendum scope wording, which the same decisions require. Each maps to delta items.

| Decision | PRD or addendum clause as written | Spine rule it contradicts | Delta item |
| --- | --- | --- | --- |
| C-3 | FR-4 third consequence: a document "outside a Configured Collection" is not evaluated | AD-12: a readable sentinel is one `POLICY_CONFIGURATION_INVALID`; `not_evaluated` only when scope holds neither a valid policy nor a sentinel | A-4 |
| C-3 | FR-7 first and second consequences: scoped and default `lint_wiki` cover Configured Collections only | AD-12: readable sentinels appear in scoped and default results as System Failures | A-5 |
| C-3 | FR-11 fourth consequence: "outside Configured Collections" is not evaluated | AD-12 closed algebra and read-side readability rule | A-6 |
| C-3 | Section 4.3 criterion 2: default scope "limited to readable Configured Collections" | AD-12: sentinel ID and invalid `PolicyIdentity` enter `scope` and `policies` | A-7 |
| C-3 | Section 4.4 criterion 2, read half: "outside configured scope returns not evaluated" | AD-12, AD-11, AD-18 sentinel matrix | A-8 |
| C-3 | Evaluated Scope glossary: "actually inspected" | AD-12: sentinel is a zero-count scope entry | A-1 |
| C-3 | None; the spine's product note on operator escalation (UJ-1 is silent on configuration failures) | — | A-9 |
| C-6 | FR-16: one exception; "protocol conflict error"; `validated_with_warnings` always returns Warnings | AD-8 `collection_conflict` tool-execution error; AD-20 rows 1, 3, 5, 7; AD-7 status recovery; AD-12 enrichments | A-2, A-11, A-12, A-17 |
| C-6 | FR-13: runtime failures fail closed; boundary and "admitted" unstated | AD-3 narrowed `VALIDATION_RUNTIME_FAILED`; AD-14 `runtimeFailOpenExercised`; AD-20 | A-10 |
| C-6 | FR-17 and NFR-9: rollback guaranteed only for `rejected` | AD-20 rows 3 and 5 roll back | A-13, A-22 |
| C-6 list; author default | FR-19: "Every ... invocation" records a summary | AD-14: a read ending in `isError` records none | A-18 |
| C-6 | FR-20 first consequence: "records the Validation Status"; "validation attempt" undefined; exactly one summary always | AD-14 `aborted_*` outcomes and no summary for rows 1, 2, 7; AD-20 attempt boundary | A-2, A-19 |
| C-6 | NFR-15: every fail-open write emits a durable event | AD-15, AD-20 row 7 evidence gap | A-23 |
| C-6 | Section 4.6 criterion 1 and SM-I6 scenario lists | AD-14, AD-18 one fixture per AD-20 row | A-21, A-25 |
| C-6 | Section 4.5 "protocol conflict error" (classification fixture 2) and "existing protocol behavior" | Spine convention: "protocol error" means JSON-RPC only | A-14, A-15 |
| C-5 | Section 4.5 classification fixture 1: rejection carries "its request-time valid policy identity" | AD-12: identity only when `can(actor, "read", collection)` | A-16 |
| C-5 (audit half, gate decision) | FR-21 second consequence ("actor-authorized scope") and NFR-11 | AD-12, AD-14: audit data actor-independent, admin-only retrieval | A-20, A-24 |
| Addendum | Audit-payload list omits `credentialAuthType` and other `AuditDataV1` fields, and says "authorized scope" | AD-14 `AuditDataV1`, AD-15, C-5 audit half | A-26 |

C-4 and C-7 require no PRD change: no PRD or addendum clause fixes invalid-entry identity, and FR-19's "scope kind" is read-only.

## Proposed Normative Delta

This delta is exhaustive. Every text outside the replacements and insertions below remains unchanged. Every quoted "Replace" text and every quoted insertion anchor occurs exactly once in its target.

### Part A: PRD (`prd.md`) and addendum (`addendum.md`)

#### A-1. Glossary: Evaluated Scope (C-3)

Replace:

> - **Evaluated Scope** — The authorized documents and collections actually inspected by a lint operation, reported without revealing inaccessible resources.

With:

> - **Evaluated Scope** — The authorized documents and collections actually inspected by a lint operation, plus any Invalid-Policy Collection, or document in one, that the operation reports under FR-12 with nothing inspected. It is reported without revealing inaccessible resources.

#### A-2. Glossary: two new terms (C-6)

Insert after **System Failure**:

> - **Tool-Execution Error** — An MCP tool result marked as an error (`isError`). It is distinct from a JSON-RPC protocol error and carries no Validation Status.

Insert after **Tool-Execution Error**:

> - **Validation Attempt** — An Enforced Write from its completed classification until it commits, is rejected, or aborts. Its validation decision is the point at which the validation result and the collection's policy either reject the write or let it proceed to persistence; an attempt aborts before or after that decision. A failure during classification and a collection-change conflict under FR-16 are not Validation Attempts. Lowercase "validation attempt" in this PRD and its addendum has the same meaning.

#### A-3. Frontmatter

Set `updated` in `prd.md` to the application date.

#### A-4. FR-4 third consequence (C-3)

Replace:

> - A document outside a Configured Collection returns the explicit policy-not-configured/not-evaluated outcome.

With:

> - A document whose collection is `null` or has no Policy Configuration entry returns the explicit policy-not-configured/not-evaluated outcome. A document in an Invalid-Policy Collection returns the System Failure FR-12 requires.

#### A-5. FR-7 first and second consequences (C-3)

Replace:

> - With a collection identifier, the tool evaluates that Configured Collection only when the actor may access it.
> - Without a collection identifier, the tool evaluates all Configured Collections and documents readable by the actor.

With:

> - With a collection identifier, the tool evaluates that collection only when the actor may access it. A Configured Collection is linted, an Invalid-Policy Collection is reported under FR-12, and any other collection is not evaluated.
> - Without a collection identifier, the tool evaluates all Configured Collections and documents readable by the actor and reports each readable Invalid-Policy Collection under FR-12.

#### A-6. FR-11 fourth consequence (C-3)

Replace:

> - Read-only requests outside Configured Collections return policy-not-configured/not-evaluated.

With:

> - Read-only requests whose actor-readable scope contains neither a Configured Collection nor an Invalid-Policy Collection return policy-not-configured/not-evaluated; an Invalid-Policy Collection in that scope follows FR-12. For `lint_document`, the actor-readable scope is the collection of the document the actor can read, even when the actor cannot read that collection itself; for `lint_wiki`, it is the requested collection when the actor can read it and, without a collection identifier, the collections the actor can read.

#### A-7. Section 4.3 capability acceptance criterion 2 (C-3)

Replace:

> - Actor fixtures prove default scope is limited to readable Configured Collections and that no inaccessible identity or metadata appears in results.

With:

> - Actor fixtures prove default scope is limited to readable Configured Collections and readable Invalid-Policy Collections and that no inaccessible identity or metadata appears in results.

#### A-8. Section 4.4 capability acceptance criterion 2 (C-3)

Replace:

> - A read-only request outside configured scope returns not evaluated; a write that is not an Enforced Write matches baseline upstream behavior.

With:

> - A read-only request whose actor-readable scope (FR-11) contains neither a Configured Collection nor an Invalid-Policy Collection returns not evaluated. An Invalid-Policy Collection in the actor-readable scope returns the System Failure FR-12 requires, never a not-evaluated or Clean Result. In `lint_document` this includes a readable document whose collection the actor cannot read, and that result carries no collection or policy identity. In collection-scoped and default-scope `lint_wiki`, an Invalid-Policy Collection the actor cannot read contributes nothing. A write that is not an Enforced Write matches baseline upstream behavior.

#### A-9. FR-12: add two consequences (C-3)

Insert after the consequence "Read-only operations affected by invalid configuration never report a Clean Result.":

> - A read-only operation whose actor-readable scope (FR-11) contains an Invalid-Policy Collection reports it as this System Failure, or as a generic runtime System Failure when the collection's readability cannot be established, and never as not evaluated. Its collection and policy identity appear only as NFR-11 allows.
> - A configuration System Failure is an operator escalation, not an agent-repairable Finding. The agent escalates it to the Wiki operator under UJ-1 rather than repairing it, and a scope that contains one reaches a Clean Result only after the operator corrects the configuration.

#### A-10. FR-13: add two consequences (C-6)

Insert after the last FR-13 consequence, "Every write admitted through fail-open returns the unmistakable `degraded_validation` Validation Status and a safe machine-readable System Failure.":

> - Failures of the write's own authorization, locking, transformation, media staging, model validation, or persistence, a commit that does not take effect, and any failure that leaves the write's transaction unusable, are not runtime validation failures. They never fail open and follow the second FR-16 exception.
> - A write is admitted through fail-open only when it commits. A fail-open decision followed by an abort returns no `degraded_validation` and does not exercise fail-open. A fail-open write whose commit the server cannot establish, or whose status it cannot recover under FR-16, returns the FR-16 Tool-Execution Error instead of `degraded_validation`, and its audit follows FR-20.

#### A-11. FR-16 statement (C-6)

Replace:

> Every Enforced Write response shall expose one Validation Status without requiring the client to infer validation from missing fields or message prose. This requirement has one exception. Suppose an Enforced Write was classified under a valid `enforced` policy, and the server's re-check before commit then finds a post-operation collection that differs from the classified one. Whenever that difference is detected, the write fails with a protocol conflict error that carries a stable error identifier. It has no Validation Status and is not a validation attempt, and any validation already performed is discarded.

With:

> Every Enforced Write response shall expose one Validation Status without requiring the client to infer validation from missing fields or message prose. This requirement has three exceptions.
>
> 1. **Collection change.** Suppose an Enforced Write was classified under a valid `enforced` policy, and the server's re-check before commit then finds a post-operation collection that differs from the classified one. Whenever that difference is detected, the write fails with a Tool-Execution Error that carries a stable error identifier. It has no Validation Status and is not a Validation Attempt, and any validation already performed is discarded.
> 2. **Abort or unestablished outcome.** A Validation Attempt whose response can report neither a commit nor a rejection fails with a Tool-Execution Error and has no Validation Status, whatever the attempt's eventual outcome. The error carries the message of an Outline application error that has a stable identifier, and otherwise, and always for an outcome the server cannot establish or a committed status it cannot recover, a fixed generic message. This covers the failures that FR-13 excludes from runtime validation failures, before or after the validation decision; client cancellation before the write proceeds to persistence; a requester that obtains no result from the asynchronous HTML import job; and a commit whose outcome the server cannot establish. The write is rolled back, except that when the server cannot establish whether it committed or will commit, or cannot recover a committed write's status, the error makes no claim about persistence.
>
> 3. **Classification failure.** A failure during classification itself keeps baseline behavior or fails with a Tool-Execution Error that carries the fixed generic message. It has no Validation Status, is not a Validation Attempt, and records no summary.
>
> A committed Enforced Write returns its Validation Status unless the server cannot establish that it committed or, for an HTML create whose committed row is found by a later lookup or probe rather than reported by the attempt that committed it, cannot recover the status that attempt recorded. A status recovered that way may carry empty Error and Warning collections. Failure to assemble the breadcrumb, share URL, or patch-mode final-Markdown echo omits that detail, and failure to assemble the other document fields reduces the response to the document identifier and the validation object; neither turns a committed write into an error.

#### A-12. FR-16 `validated_with_warnings` consequence (C-6)

Replace:

> - `validated_with_warnings` means the write succeeded with zero Errors and one or more returned Warnings.

With:

> - `validated_with_warnings` means the write succeeded with zero Errors and one or more Warnings, which are returned unless the status was recovered from a committed row found by a later lookup or probe (FR-16).

#### A-13. FR-17: add one consequence (C-6)

Insert after the consequence "A rejected update leaves the prior document state intact.":

> - A Validation Attempt that aborts under the second FR-16 exception and is rolled back persists no created document, no change to the prior document state, no attachment record, and no document mutation event; media it staged stays inaccessible through Outline.

#### A-14. Section 4.5 capability acceptance criteria: authorization-failure sentence (C-6 terminology)

Replace:

> Authorization failures retain existing protocol behavior and never become lint Findings or admit writes on a fail-open basis.

With:

> Authorization failures return their baseline error content, never become lint Findings, and never admit writes on a fail-open basis.

#### A-15. Section 4.5 classification fixture 2 (C-6 terminology)

Replace:

> When the re-check before commit detects the change, the write fails with the protocol conflict error.

With:

> When the re-check before commit detects the change, the write fails with the Tool-Execution Error of the first FR-16 exception.

#### A-16. Section 4.5 classification fixture 1 (C-5)

Replace:

> It then returns `rejected` with its request-time valid policy identity and one configuration System Failure.

With:

> It then returns `rejected` with one configuration System Failure and, only when the actor can read the classified collection, its request-time valid policy identity.

#### A-17. Section 4.5 capability acceptance criteria: Warning bullet and one new bullet (C-6)

Replace:

> - Warnings permit persistence and are returned with `validated_with_warnings`.

With:

> - Warnings permit persistence and are returned with `validated_with_warnings`, except in a status recovered under FR-16.

Insert after the bullet that begins "Runtime failure tests prove default rejection":

> - Abort fixtures prove, for established aborts before and after the validation decision, that the second FR-16 exception returns a Tool-Execution Error without a Validation Status, never fails open, persists nothing as FR-17 requires, and records its aborted outcome under FR-20. They also prove that a committed write whose optional response details fail still returns its Validation Status, and that a write whose outcome cannot be established makes no persistence claim.

#### A-18. FR-19 statement and one consequence (author default, AD-14 read outcome)

Replace:

> Every `lint_document` and `lint_wiki` invocation shall attempt to record one audit summary attributable to the authenticated actor and authorized scope. Under normal audit operation, exactly one retrievable summary shall be recorded per invocation.

With:

> Every `lint_document` and `lint_wiki` invocation that returns a lint result, which is any modeled outcome including not evaluated, incomplete, and failed, shall attempt to record one audit summary attributable to the authenticated actor and authorized scope. Under normal audit operation, exactly one retrievable summary shall be recorded per such invocation.

Insert after the FR-19 consequence "It records whether the outcome was clean, not evaluated, incomplete, or failed.":

> - An invocation that ends in a Tool-Execution Error, such as an invalid call or an authorization denial, returns no lint result and records no summary.

#### A-19. FR-20 statement and consequences (C-6)

Replace:

> Every Enforced Write validation attempt shall attempt to record one audit summary, including attempts rejected before mutation and rejections because the post-operation collection is an Invalid-Policy Collection. Under normal audit operation, exactly one retrievable summary shall be recorded per validation attempt.

With:

> Every Enforced Write Validation Attempt shall attempt to record one audit summary, including attempts rejected before mutation, rejections because the post-operation collection is an Invalid-Policy Collection, and attempts whose abort under the second FR-16 exception the server establishes. Under normal audit operation, exactly one retrievable summary shall be recorded per Validation Attempt whose outcome the server establishes; the consequence below on attempts whose outcome the server cannot establish governs them.

Replace:

> - The summary records the Validation Status, the duration, Finding counts by severity and stable code, and whether runtime fail-open was exercised.

With:

> - The summary records the Validation Status or, for an aborted attempt, whether it aborted before or after its validation decision, together with the duration, Finding counts by severity and stable code, and whether runtime fail-open was exercised.

Insert after the FR-20 consequence "Degraded validation is identifiable both in the MCP response and in the durable audit record.":

> - An aborted attempt records zero Finding and System Failure counts, records runtime fail-open as not exercised, and never counts as validation success.
> - When the server cannot establish an attempt's outcome, the request records no summary of its own. A summary recorded by the component that ended the attempt stands, and a missing summary is an accepted audit evidence gap that operators reconcile out of band as FR-22 describes.

#### A-20. FR-21 second consequence (C-5 audit half)

Replace:

> - Document or collection identifiers are associated only when allowed by the existing audit authorization model and necessary to identify the actor-authorized scope.

With:

> - Document or collection identifiers are associated only when allowed by the existing audit authorization model and necessary to identify the audited scope. For read-only lint, the audited scope is the actor-authorized scope. For an Enforced Write, it is the classified post-operation collection and, when the document row exists, the written document, recorded with the policy fields FR-20 requires whether or not the writing actor can read that collection. That collection is the write's own scope, not a protected target, and the summary is retrievable only through the authorized audit surface.

#### A-21. Section 4.6 capability acceptance criterion 1 (C-6)

Replace:

> - Tests prove one summary is recorded for each clean, warning-bearing, not-evaluated, incomplete, failed, rejected, and degraded scenario.

With:

> - Tests prove one summary is recorded for each clean, warning-bearing, not-evaluated, incomplete, failed, rejected, degraded, aborted-before-decision, and aborted-after-decision scenario. They prove that none is recorded for a lint invocation that ends in a Tool-Execution Error, a failure during classification, or a collection-change conflict, and that the request path records none for an attempt whose outcome the server cannot establish.

#### A-22. NFR-9 (C-6)

Replace:

> - **NFR-9 — Rejected-write atomicity:** Validation rejection shall preserve the pre-operation externally visible state under FR-17 across every supported create and update path.

With:

> - **NFR-9 — Rejected-write atomicity:** Validation rejection shall preserve the pre-operation externally visible state under FR-17 across every supported create and update path. A Validation Attempt that aborts and is rolled back under the second FR-16 exception shall preserve the pre-operation persisted state.

#### A-23. NFR-15 (C-6)

Replace:

> Audit persistence failure follows NFR-27 and cannot conceal the `degraded_validation` status already returned to the agent.

With:

> Audit persistence failure follows NFR-27 and cannot conceal the `degraded_validation` status already returned to the agent. A write whose outcome the server cannot establish (FR-16) is an audit evidence gap under FR-20, not a breach of this requirement or of SM-P6.

#### A-24. NFR-11 (C-5 audit half)

Replace:

> - **NFR-11 — Least disclosure:** Findings, scope summaries, System Failures, logs, and metrics shall contain no document content, target identity, title, URL identifier, collection identity, or metadata that the current actor is not authorized to access.

With:

> - **NFR-11 — Least disclosure:** Findings, scope summaries, System Failures, logs, and metrics shall contain no document content, target identity, title, URL identifier, collection identity, or metadata that the current actor is not authorized to access. Durable audit summaries are operator evidence, not actor-facing output: FR-21 governs the identifiers they carry, and only the authorized audit surface returns them.

#### A-25. SM-I6 (C-6)

Replace:

> - **SM-I6 — Audit evidence:** Normal-operation tests produce one minimized authorized audit summary per lint and configured validation attempt; injected audit failures leave functional outcomes unchanged and produce correlated operator diagnostics only.

With:

> - **SM-I6 — Audit evidence:** Normal-operation tests produce one minimized authorized audit summary per lint invocation that returns a lint result and per configured Validation Attempt whose outcome the server establishes; injected audit failures leave functional outcomes unchanged and produce correlated operator diagnostics only.

#### A-26. Addendum audit-payload list (`addendum.md`)

Replace:

> - Persist only audit-safe aggregate evidence: operation and outcome, completion, duration, authorized scope kind or identifier, policy version/fingerprint, request correlation, evaluated-object counts, and Finding counts by severity and stable code.

With:

> - Persist only audit-safe aggregate evidence: operation and outcome, completion, duration, audited scope kind or identifier under PRD FR-21, policy version/fingerprint, request correlation, the authenticated actor and source IP carried by the existing Event row, authentication credential type and, when reliably available, the authenticated client identifier, whether runtime fail-open was exercised, evaluated-object counts, Finding counts by severity and stable code, and System Failure counts by stable code.

Set `updated` in `addendum.md` to the application date.

### Part B: Architecture Spine (`ARCHITECTURE-SPINE.md`)

No AD rule text, identifier, `Binds`, `Prevents`, or adopted status changes.

#### B-1. Remove the six markers

Delete each of these lines entirely:

> - **PRD alignment pending:** the narrowed `VALIDATION_RUNTIME_FAILED` meaning conflicts with FR-13 as written; see the Amendment Record.

> - **PRD alignment pending:** the `collection_conflict` tool-execution error conflicts with FR-16's "protocol conflict error" wording as written; see the Amendment Record.

> - **PRD alignment pending:** the sentinel read rule and the identity-omission rule below conflict with FR-4, FR-7, FR-11, Section 4.4, and Section 4.5 as written; see the Amendment Record.

> - **PRD alignment pending:** the aborted outcomes conflict with FR-20 (summary "records the Validation Status"), the no-summary read `isError` rule with FR-19, and the actor-independent audit with FR-21 and NFR-11 as written; see the Amendment Record.

> - **PRD alignment pending:** the sentinel-matrix and AD-20 fixtures below follow spine rules that the PRD does not yet state; see the Amendment Record.

> - **PRD alignment pending:** rows 3, 5, and 7 conflict with FR-16 (single exception), FR-17, FR-20, and NFR-9 as written; see the Amendment Record.

#### B-2. Replace the Pending PRD alignment block

Replace the paragraph that begins "**Pending PRD alignment.**", its five-item list, and the paragraph that begins "Lower-authority companions were not edited" with:

> **Open PRD residuals.** `_bmad-output/planning-artifacts/prds/prd-outline-2026-09-20/amendment-proposal-prd-spine-alignment.md` reports these residuals as unresolved. For RI-1 (FR-19 policy fields and AD-14 read summaries) and RI-2 (FR-12 and NFR-16 and the AD-5 and AD-3 startup-fatal classes), the PRD controls until each is decided. For RI-4 (NFR-11, SM-I4, and SM-P5 and the AD-12 residual disclosures) and RI-6 (FR-22 and the AD-7 status recovery), the amended PRD states the spine behavior pending an operator decision. RI-3 (AD-20 `afterCommit` hooks after a failed COMMIT) awaits operator acceptance. Gate 1 stays `not ready` until they are decided. `epics.md` predates the 2026-09-30 decisions and the PRD alignment; it carries superseded blockers and lacks the new criteria until it is replanned. The `server/tools/README.md` and `AGENTS.md` lines listed under RI-5 remain stale.

#### B-3. Amendment Record row

Append to the Amendment Record table:

> | *date of application* | AD-3, AD-8, AD-12, AD-14, AD-18, AD-20 | Alignment markers removed and the pending-alignment paragraph replaced by an Open PRD residuals paragraph, after the PRD was amended to state the C-3, C-5, and C-6 decisions and the addendum to list the full audit payload; the author defaults labeled in the proposal's Decisions Made Explicit became operator decisions; no rule text, identifier, `Binds`, `Prevents`, or adopted status changed. | Operator authorization recorded in the PRD and architecture workspace memlogs, applying `_bmad-output/planning-artifacts/prds/prd-outline-2026-09-20/amendment-proposal-prd-spine-alignment.md` |

Replace the italic date cell with the actual application date, and set the frontmatter `updated` to that date.

### Part C: Companion Wording

#### C-a. `SPEC.md`

Replace:

> `AD-18`, and `AD-19` unchanged; their detailed decisions live only in the adopted companion.

With:

> `AD-18`, `AD-19`, and `AD-20` unchanged; their detailed decisions live only in the adopted companion.

Replace:

> while conforming to `AD-1` through `AD-19`.

With:

> while conforming to `AD-1` through `AD-20`.

Replace:

> Normal operation records exactly one retrievable minimized summary per attempt;

With:

> Normal operation records exactly one retrievable minimized summary per lint invocation that returns a lint result and per Validation Attempt (PRD term) whose outcome is established, including aborted attempts;

Replace:

> through explicit per-collection policy, always returning unmistakable `degraded_validation`.

With:

> through explicit per-collection policy, and a fail-open write whose commit the server establishes and whose status it can report returns unmistakable `degraded_validation`.

#### C-b. `server/tools/README.md` example response

Replace:

> use stable machine-readable issue codes rather than requiring clients to parse
> prose, for example:

With:

> use stable machine-readable issue codes rather than requiring clients to parse
> prose. For example, a rejected enforced write returns this first content block
> (illustrative only; the Architecture Spine defines exact codes, locations, and
> response shapes in AD-3, AD-4, and AD-12):

Replace the whole fenced JSON block that follows, from its opening ` ```json ` line through its closing fence, with this fenced block:

```json
{
  "success": false,
  "validation": {
    "status": "rejected",
    "policySchemaVersion": 1,
    "policyFingerprint": "sha256:<64 lowercase hex digits>",
    "errors": [
      {
        "code": "REQUIRED_METADATA_FIELD_MISSING",
        "severity": "error",
        "message": "A required metadata field is missing.",
        "location": { "documentId": "document-id" }
      }
    ],
    "warnings": [],
    "systemFailures": []
  }
}
```

Insert after the new block's closing fence, as its own paragraph:

> `policySchemaVersion` and `policyFingerprint` appear only when the actor can read the write's post-operation collection.

#### C-c. `AGENTS.md` (managed `bmad:context` block)

Apply this one-line replacement exactly once, to `AGENTS.md`, inside its managed block. Leave the verification stamp unchanged; this edit does not re-verify the block. Do not edit through the `CLAUDE.md` path, which must remain a symlink (git mode `120000`).

Replace:

> - Unconfigured collections retain upstream behavior.

With:

> - Unconfigured and `read_only` collections retain upstream write behavior; an invalid collection policy in an actor-readable lint scope is a System Failure, never clean or not evaluated.

### Explicitly Unchanged

- **PRD:** everything outside A-1 to A-25. Existing lowercase "validation attempt" text stays and is bound by the A-2 definition.
- **Addendum:** everything except the audit-payload bullet and `updated`.
- **Spine:** all AD rule text, the `AuditDataV1` schema, the Deferred table, and the two existing Amendment Record rows.
- **SPEC, README, AGENTS:** everything except the listed lines. The README's other stale lines are reported under RI-5.

## Decisions Made Explicit by This Delta

Authorizing the delta also accepts the following. "Fixed" marks an operator decision already recorded; "author default" marks a spine rule the architecture memlog records as open to operator veto, which authorization turns into an operator decision.

1. **Read-only sentinel precedence (fixed, C-3).** FR-12 governs an Invalid-Policy Collection in the actor-readable scope on every read surface. `not_evaluated` is reserved for a scope with neither a Configured nor an Invalid-Policy Collection, and a default-scope result that contains one is never clean.
2. **Document-only readers (author default, narrows C-3's "unreadable sentinels are invisible").** `lint_document` on a readable document whose Invalid-Policy Collection the actor cannot read returns the generic FR-12 System Failure without collection or policy identity. The residual disclosure is part of RI-4.
3. **Operator escalation (author default, the spine's product note).** A configuration System Failure is not agent-repairable. The UJ-1 loop, SM-P2, and SM-P3 close only after the operator fixes the configuration.
4. **Validation Attempt boundary (fixed, C-6; classification-failure placement is an author default, AD-20 P1).** The attempt runs from completed classification to commit, rejection, or abort, and the validation decision is the AD-13 decision. The collection-change conflict and failures before classification are not attempts and record no summary (C-6 rule 8). A failure during classification itself is placed the same way, with the fixed generic message when no baseline analog exists (author default).
5. **"Admitted" means an established commit (fixed, C-6 rule 7; the unestablished and unrecoverable cases are author defaults, AD-7 and AD-20 row 7).** A fail-open decision followed by an abort is not `degraded_validation` and records fail-open as not exercised. A fail-open write whose commit cannot be established, or whose status cannot be recovered, returns the FR-16 error. FR-13 now states both.
6. **Cancellation (author default).** On the Markdown path, client cancellation or disconnect before the persist decision aborts the attempt, and after it the write proceeds. On the HTML path the requester reports the unestablished-outcome error and the job may still commit.
7. **Unestablished outcome (author default, AD-20 row 7).** When a commit's outcome cannot be established, or the HTML requester obtains no result, the response makes no persistence claim and the request path records no summary. This is an accepted evidence gap, alongside the crash-after-commit gap already accepted by AD-15, and NFR-15 now says so for itself and SM-P6; the operator reconciles such writes out of band, for example through `validationCorrelationId` on the mutation Event.
8. **Recovered HTML status (author default, AD-7).** When a later lookup or probe, rather than the committing attempt, finds a committed HTML create, the response carries a status recovered from its committed summary, with empty Error and Warning collections; if no committed summary can be recovered, it returns the unestablished-outcome error. UJ-2's "remain visible" narrative and the Section 4.5 Warning criterion yield to this FR-16 provision. The audit coupling in the second case is RI-6.
9. **Message rule (author default, AD-20).** An aborted attempt's error carries an Outline application error message only when that error has a stable identifier, and otherwise a fixed generic message.
10. **Abort atomicity covers persisted state (fixed, C-6 rules 3 and 4).** FR-17's new consequence and the NFR-9 extension guarantee persisted state. They do not claim that no transient signal is emitted after a failed COMMIT; see RI-3.
11. **Actor-independent audit (fixed, C-5 audit half).** A write summary records the classified collection and its valid-policy fields even when the writing actor cannot read that collection. That collection is the write's own scope, not a protected target under FR-21. Retrieval stays with same-team admins through `auditWikiLint`.
12. **Terminology (author default, spine Consistency Conventions and AD-12).** "Tool-Execution Error" replaces "protocol conflict error". "Protocol error" means a JSON-RPC error only, matching the spine's Consistency Conventions.
13. **Fallbacks and placements (author default, AD-8, AD-11, AD-12, and AD-14).** When a sentinel collection's readability cannot be established, the read result carries a generic runtime System Failure. When a committed write's document fields cannot be assembled, the response is reduced to the document identifier and the validation object. A failure that leaves the write's transaction unusable is an abort, never a runtime validation failure (AD-8 savepoint model), and a write summary identifies the written document only when its row exists (AD-14).
14. **No summary for `isError` reads (author default, AD-14 Read outcome; listed under C-6 in the spine's Pending list, although C-6 covers writes only).** A lint invocation that ends in a Tool-Execution Error, such as an invalid call or an authorization denial, returns no lint result and records no summary.

## Residual Items: Reported, Not Resolved

These are outside the spine's Pending list. None is decided here, and each needs its own operator decision or a later amendment. Part B lists RI-1 to RI-4 and RI-6 in the spine so they stay visible.

- **RI-1. FR-19 policy fields on read summaries.** FR-19's first consequence requires every read summary to identify "policy version or fingerprint". AD-14 records the policy fields only for a single collection or document under a valid policy, so default scope and sentinel scope omit them. Candidate PRD wording: "...scope kind, the policy version and fingerprint when the scope is one collection or document under a valid policy, and server request correlation identifier."
- **RI-2. Startup-fatal configuration classes.** FR-12, NFR-16, and the Section 4.4 first criterion expect a stable System Failure for every malformed or inconsistent configuration class. AD-5 makes root-level classes block startup, and AD-3 keeps `POLICY_SCHEMA_VERSION_UNSUPPORTED` in startup diagnostics only. AD-19 logs identifiable sentinels, but no rule says a startup-fatal class logs a stable code and non-secret location. Candidate: state it in AD-19, or amend FR-12 to allow startup blocking with an operator-visible code.
- **RI-3. Hooks after a failed COMMIT.** AD-20 records that writer `afterCommit` hooks can fire after a failed COMMIT (row 5, "absent after a server-reported error"). A hook that enqueues a notification could emit a transient signal for a write that did not persist, which FR-17's third consequence forbids for rejected writes and this delta does not claim for aborts (Decision 10). The operator should accept this residual or require the architecture to suppress those hooks.
- **RI-4. Residual disclosures to actors without collection read.** AD-12 records four residuals. The presence of `validation` shows that a collection is enforced. On the read side, `state` for a document reader shows whether the unreadable collection is configured or, under Decision 2, invalid; this predates C-3 for valid policies, because FR-4 already lints under the document's collection policy. The activity-feed `validationCorrelationId` shows enforcement. The two rejection kinds are indistinguishable to that actor. NFR-11 forbids "metadata that the current actor is not authorized to access", and SM-I4 and SM-P5 count distinguishing protected collection information as failures, so these residuals conflict with them. The operator accepted "status, Findings and System Failures are still returned" under C-5, but the PRD has no matching carve-out. Candidate: an NFR-11 sentence naming these as accepted residuals, or architecture changes that remove them.
- **RI-5. Companion lines outside this delta.** README "Required tests" omits the AD-18 layers. README link wording ("missing, deleted, or inaccessible") implies three reports where AD-2 collapses them to one. The AGENTS block names `server/tools/README.md` as the home of acceptance criteria despite the authority order, and its verification stamp predates the spine. These are lower-authority wording gaps, not PRD conflicts.
- **RI-6. HTML status recovery depends on the audit summary.** AD-7 recovers a committed HTML create's status only from its committed audit summary, whenever a later lookup or probe rather than the committing attempt finds the row. When that summary is missing, for example after an audit failure, a committed write returns the unestablished-outcome error. FR-22 says audit failure shall not alter the functional outcome. A-11 describes the behavior without resolving that tension. Candidate: accept it as a narrow residual, or have the architecture recover the status from a source other than the audit summary.

Other items stay open outside this delta: D-9 (tool input, annotation, and scope contracts; link forms; the write-eligibility constants; the `lint_wiki` stop margin; the `SET LOCAL` floor), which the spine requires before Gate 1; the operator option to convert HTML enforcement to a convert-only worker; and the separately reported baseline authorization gap (D-8).

## Impact After Application

| Area | Impact |
| --- | --- |
| Glossary | Evaluated Scope widened for sentinels; Tool-Execution Error and Validation Attempt added. |
| FR-4, FR-7, FR-11, FR-12 | Sentinel read behavior and actor-readable scope stated (C-3); escalation note. |
| FR-13, FR-16, FR-17, FR-19, FR-20, NFR-9, NFR-15, SM-I6 | Attempt boundary, second exception, classification failure, recovered status, abort rollback, aborted audit outcomes, unestablished-outcome gap, no-summary `isError` reads (C-6). |
| Section 4.3, 4.4, 4.5, 4.6 criteria | Sentinel read fixtures, abort fixtures, identity condition, aborted audit scenarios, terminology. |
| FR-21, NFR-11 | Audit actor-independence stated (C-5 audit half). |
| Addendum | Audit-payload list covers the `AuditDataV1` evidence fields and FR-21. |
| Spine | Six markers removed; Pending paragraph replaced by an Open PRD residuals paragraph; one Amendment Record row. Rule text unchanged. |
| SPEC, README, AGENTS | AD-20 adopted in SPEC; CAP-6 attempt wording; `degraded_validation` only on established commit; README example matches AD-3, AD-4, and AD-12; AGENTS compatibility line. |
| Epics | Unchanged by application; replan required (below). |
| Gate 1 | Still `not ready`: the epics replan, RI-1 to RI-4 and RI-6, and D-9 remain. |
| Gates 2 to 4, OD-1 to OD-7 | Unchanged and not authorized. |

## Epics Stories to Replan

Replanning is a separate step. It uses `bmad-correct-course` and keeps the three-epic, 21-story structure. "Spine" means a spine rule that already binds regardless of this delta; "prior amendment" means the applied enforced-write-applicability amendment.

| Area | Replan content | Driver |
| --- | --- | --- |
| Requirements Inventory, FR Coverage, AD inventory | Summaries of FR-4, FR-7, FR-11 to FR-13, FR-16, FR-17, FR-19 to FR-21, NFR-9, NFR-11, NFR-15, SM-I6, and CAP-6 (as in C-a); add AD-20; refresh every AD summary amended in the spine's second Amendment Record row (AD-3 to AD-19); replace every `AD-1–AD-19` and `AD-17–AD-19` range and add AD-20 to the `AD:` traceability lines of Stories 2.1 to 2.7, 3.2, and 3.4 | this delta, spine |
| Story 1.2 | Source-byte `invalidFingerprint`; custom decoder with byte spans; nested duplicates and lexical defects become sentinels; lowercase keys; 64 KiB file; master-distributed bytes | spine (C-4) |
| Story 1.3 | AC5 limited to `null` or no-entry collections; AC6 sentinel location, including the generic document-scope failure for document-only readers; `reason` field; Tool-Execution Error terminology | this delta (C-3, C-6) |
| Story 1.4 | One shared link-extraction function; recognized link forms fixed by fixtures (D-9) | spine |
| Story 1.5 | AC3 and AC10 include readable sentinels; new sentinel criterion (zero-count entry, no completed unit, never clean, unreadable contributes nothing); `lint_wiki` document set | this delta (C-3), spine |
| Story 1.6 | Parents resolved for the actor; a readable cross-collection parent is `PARENT_COLLECTION_MISMATCH`; vacuous completion of a required check | spine |
| Story 1.7 | Sentinel failure needs no snapshot; readability-unestablished case; document-unit failure location; stop margin | spine |
| Story 1.8 | No summary for `isError` reads; read policy-fields rule (pending RI-1); outcome mapping | this delta (C-6), spine |
| Story 1.10 | A configuration System Failure is an escalation outside the repair loop; Tool-Execution Error terminology | this delta (C-3, C-6) |
| Story 2.1 | Classification on the baseline-resolved collection, the `readable` flag, the pre-allocated document ID, identity omission for actors without read, classification failure, Tool-Execution Error terminology | spine, this delta (C-5, C-6) |
| Story 2.2 | AD-20 rows 2 and 3; content-dependent edits inside the transaction | this delta (C-6), spine |
| Story 2.3 | Rows 3 and 5, lock order, savepoints, COMMIT probe, admitted-means-committed | this delta (C-6), spine |
| Story 2.4 | Identity condition; optional details omitted after commit; `collection_conflict` Tool-Execution Error; delete the "Known binding contradictions" paragraph | this delta (C-5, C-6); prior amendment (paragraph) |
| Story 2.5 | Distinct enforced import task; result union; redelivery and status recovery; `deadlineAt`; row 7 | this delta (C-6), spine |
| Story 2.6 | Per-attempt blob ownership; staging at the final key | spine |
| Story 2.7 | `aborted_*` outcomes; `scopeKind: collection`; actor-independent audit; no summary for rows 1, 2, 7 or `isError` reads; summary replacement; one fixture per AD-20 row | this delta (C-5, C-6), spine (C-7) |
| Story 3.1 | Expected fingerprint required for any enforced or sentinel entry; per-sentinel startup logging; readiness through the health endpoint | spine |
| Story 3.2 | AD-18 layers: sentinel matrix, identity omission, AD-20 rows, COMMIT probe, HTML worker cases, `/mcp` timeout | spine |
| Story 3.3 | Stratified `lint_document` benchmark and writer latency | spine |
| Story 3.4 | Replace the closed C-1/C-2 blocker with the open Gate 1 items: RI-1 to RI-4, RI-6, and D-9 | prior amendment (closed blocker), this delta (open items) |

## Application Plan (Only After Separate Authorization)

1. Before editing, check that each quoted "Replace" text and insertion anchor still occurs exactly once in its target. Stop on any drift.
2. Apply Part A to `prd.md` and `addendum.md`, Part B to `ARCHITECTURE-SPINE.md`, and Part C exactly. Update only the named frontmatter `updated` dates, and fill the B-3 date. Apply the `AGENTS.md` line once and leave its stamp unchanged. Then confirm that `git ls-files -s CLAUDE.md` shows mode `120000`, `test -L CLAUDE.md` succeeds, `readlink CLAUDE.md` prints `AGENTS.md`, and `git status --short CLAUDE.md` prints nothing.
3. Record the change through `_bmad/scripts/memlog.py` only:
   - PRD workspace: the authorization, the Part A application, and the `server/tools/README.md` and `AGENTS.md` edits.
   - Architecture workspace: the authorization, the marker removal, the Open PRD residuals paragraph, and the Amendment Record row, noting that the authority note on C-3, C-5, and C-6 is closed and that the labeled author defaults became operator decisions.
   - SPEC workspace: the AD-20 adoption and the CAP-6 and constraint wording.
4. Verify every replacement verbatim by script, confirm that the spine contains no line beginning `- **PRD alignment pending:**` and no paragraph beginning `**Pending PRD alignment.**`, run an independent post-application reconciliation, write `reconcile-applied-prd-spine-alignment.md`, and mark this proposal `applied`. Record any new contradiction as blocking rather than editing silently.
5. Replan the epics as listed, only under its own authorization or the optional clause below.
6. Do not implement product code, publish images, deploy, configure collections, or authorize rollout. Commit only when asked.

## Suggested Authorization Wording

> I authorize applying the exact reviewed delta from `amendment-proposal-prd-spine-alignment.md`: Part A to `prd.md` and `addendum.md`, Part B to `ARCHITECTURE-SPINE.md` (marker removal, the Open PRD residuals paragraph, and one Amendment Record row, with no rule-text change), and the Part C alignments to `SPEC.md`, `server/tools/README.md`, and `AGENTS.md`. I accept its stated explicit decisions, including the author defaults it labels. I do not authorize implementation, image publication, deployment, configuration, or rollout.

Optional clause for the replan:

> I also authorize replanning `epics.md` as listed in the proposal.

RI-1 to RI-6 each need a separate decision. This wording does not cover them.
