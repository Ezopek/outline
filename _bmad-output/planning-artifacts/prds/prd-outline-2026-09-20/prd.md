---
title: "PRD: Deterministic Wiki Linting for Outline MCP"
status: final
created: 2026-09-20
updated: 2026-10-01
---

# PRD: Deterministic Wiki Linting for Outline MCP

## 0. Document Purpose

This PRD defines the product requirements for deterministic Wiki linting in the built-in Outline MCP server. It translates the approved product brief into grouped capabilities, globally stable functional requirements, measurable acceptance criteria, cross-cutting quality requirements, success measures, and delivery gates. Technical mechanisms and integration design are deferred to the accompanying addendum and subsequent architecture work.

## 1. Vision

The fork provides an agent-facing, deterministic integrity contract for Outline Wiki operations. It gives agents using any MCP client one standard server-side way to discover mechanically verifiable structural drift, repair authorized defects, and confirm a clean logical change batch without relying on client-specific prompts or remembered procedures.

Read-only linting delivers the first product value: `lint_document` and `lint_wiki` return stable, ordered, machine-readable findings that support a bounded lint–repair–re-lint loop. Write enforcement follows within the same initial implementation and uses the same policy to prevent conclusively invalid MCP creates and updates before persistence.

The product does not assess meaning, truth, relevance, prose quality, logical placement, or token efficiency. Its promise is narrower and testable: identical authorized inputs, configuration, and Wiki state produce identical integrity findings while preserving Outline's existing security, compatibility, and information-disclosure boundaries.

## 2. Target Users

### 2.1 Primary User: MCP Agent

The primary user is an AI agent operating through an MCP client connected to Outline's standard `/mcp` endpoint. The agent needs deterministic, machine-readable evidence that a document or an authorized Wiki scope satisfies the configured structural policy. It uses that evidence to repair defects within its existing authority, re-lint the affected scope, and escalate only work that requires judgment or additional permission.

**Jobs To Be Done:**

- After a logical Wiki change batch, identify structural drift before a later task depends on damaged context.
- Locate each mechanically verifiable defect precisely enough to determine a safe repair.
- Distinguish blocking integrity errors, non-blocking warnings, and validation-system failures without parsing prose.
- Re-run validation until the applicable scope contains zero errors while keeping warnings visible.
- Avoid making unauthorized changes or inferring permission from a lint result.

### 2.2 Secondary User: Wiki Operator

The Wiki operator owns policy and release decisions rather than routine remediation. The operator approves configured policy, accepts or rejects stage gates, and receives escalations that require judgment, broader authority, or an explicit operational risk decision.

**Jobs To Be Done:**

- Approve the deterministic policy applied to configured collections.
- Review unresolved findings and decide how they should be handled without silently expanding linter scope.
- Approve implementation readiness, image publication, deployment, and production rollout independently.
- Recognize and respond to degraded validation without mistaking it for a successful integrity check.

### 2.3 Non-Users in the Initial Implementation

- UI and direct-API writers are not hard-enforcement users; their changes remain possible and are detected later by read-only linting.
- The linter is not an editorial reviewer, semantic classifier, security scanner, or autonomous authorization system.

### 2.4 Key User Journeys

- **UJ-1. An MCP agent closes a logical Wiki change batch.** After completing an authorized batch, the agent invokes `lint_wiki` for the applicable scope, receives deterministic findings, repairs errors within its existing authority, and re-runs the lint until the result is complete and contains zero errors. Warnings remain visible but do not cause an unbounded repair loop. Findings requiring judgment or additional authority are escalated to the Wiki operator.
- **UJ-2. An MCP agent attempts an invalid document write.** The agent invokes `create_document` or `update_document`; when the post-operation collection is an Enforced Collection, the server evaluates the fully projected document under its policy before persistence. Blocking errors return precise machine-readable findings and leave no partial effects. A write that passes existing checks and validation succeeds; Warnings do not block it and remain visible to the agent.
- **UJ-3. A Wiki operator handles validation risk.** The operator approves policy and delivery gates, receives escalated findings, and can distinguish a clean validation result from incomplete or degraded validation before deciding whether later publication, deployment, or rollout stages may proceed.

## 3. Glossary

- **Clean Result** — A completed lint evaluation with zero Errors. Warnings may remain. An incomplete or degraded evaluation is never a Clean Result.
- **Configured Collection** — A collection for which a valid Policy Configuration explicitly enables linting.
- **Degraded Validation** — An unmistakable machine-readable state indicating that a write proceeded under an explicitly enabled runtime-failure bypass. It is not a Clean Result.
- **Enforced Collection** — A Configured Collection whose valid Policy Configuration sets `enforced` activation. A Configured Collection with `read_only` activation is not an Enforced Collection.
- **Enforced Write** — A built-in MCP `create_document` or `update_document` operation that meets both of these conditions:
  - as applicable and in baseline order, it passes baseline authentication, MCP input-schema validation, lookup of its target document, parent, and template, and baseline pre-write authorization; and
  - its post-operation collection is an Enforced Collection or an Invalid-Policy Collection under the serving instance's startup Policy Configuration.

  The post-operation collection is determined as for its Projected Document, at the time the request is handled. This classification is made once per request and does not change later in that operation.
- **Error** — A conclusively proven policy violation that blocks configured MCP writes and prevents a Clean Result.
- **Evaluated Scope** — The authorized documents and collections actually inspected by a lint operation, plus any Invalid-Policy Collection, or document in one, that the operation reports under FR-12 with nothing inspected. It is reported without revealing inaccessible resources.
- **Finding** — A deterministic machine-readable report of an Error or Warning, identified by a stable issue code and a safe, applicable location.
- **Invalid-Policy Collection** — A collection whose identifiable Policy Configuration entry is invalid. For write behavior, it is neither an unconfigured collection nor a collection without enabled policy. FR-12 governs its Enforced Writes. A rejection of such a write is a validation rejection for FR-16, FR-17, FR-20, and NFR-9.
- **Logical Change Batch** — An operator- or agent-defined group of related Wiki changes after which read-only linting is run. The MCP server does not infer this boundary.
- **Policy Configuration** — Deterministic server-side policy that selects Configured Collections and their applicable rule settings and identifiers.
- **Projected Document** — The complete prospective title and body after applying a requested create or update with Outline's supported transformation semantics, together with the post-operation collection scope used to select policy, but before persistence.
- **System Failure** — A failure of configuration or runtime validation, reported separately from Errors and Warnings because it does not describe document content.
- **Tool-Execution Error** — An MCP tool result marked as an error (`isError`). It is distinct from a JSON-RPC protocol error and carries no Validation Status.
- **Validation Attempt** — An Enforced Write from its completed classification until it commits, is rejected, or aborts. Its validation decision is the point at which the validation result and the collection's policy either reject the write or let it proceed to persistence; an attempt aborts before or after that decision. A failure during classification and a collection-change conflict under FR-16 are not Validation Attempts. Lowercase "validation attempt" in this PRD and its addendum has the same meaning.
- **Validation Status** — The explicit outcome of validation for an Enforced Write: `validated`, `validated_with_warnings`, `degraded_validation`, or `rejected`.
- **Warning** — A non-blocking deterministic finding that remains visible but does not prevent a Clean Result or a configured MCP write.

Wherever this PRD or its addendum uses "configured", in any inflection or hyphenation, to qualify an MCP write, create, update, write outcome, validation, validation attempt, Validation Status, or validation audit, it refers to an Enforced Write or to its validation. The phrase "hard-enforced write" has the same meaning. "Configured" keeps its ordinary meaning when it qualifies a collection, scope, policy, rule, parameter, or identifier.

## 4. Capabilities and Functional Requirements

Functional Requirement identifiers are stable client and planning references; they do not encode presentation order. Requirements remain grouped with the capability whose behavior they govern.

### 4.1 Deterministic Result Contract

**Description:** All lint surfaces use one agent-oriented result model. Content findings, validation-system failures, evaluation completeness, and authorized scope remain distinguishable so clients never need to infer state from prose.

#### FR-1: Result classification and clean-state semantics

The system shall return Errors, Warnings, and System Failures as distinct machine-readable classes and shall report whether evaluation completed.

**Consequences:**

- A result is clean only when evaluation is complete and its Errors collection is empty.
- Warnings remain visible but do not prevent a Clean Result.
- Any System Failure makes a read-only result non-clean and incomplete or failed as applicable.
- Policy-not-configured is an explicit not-evaluated outcome, never an empty successful result.

#### FR-2: Stable finding identity and safe location

Every Finding shall contain a stable issue code, severity, safe diagnostic message, and the most precise applicable location.

**Consequences:**

- A textual issue identifies the readable document and uses a one-based source position and/or deterministic structural path when available.
- A document-level or relationship issue uses an explicit document or relationship location instead of a fabricated line number.
- Clients can branch on issue codes without parsing message text.
- A material change in issue meaning requires a new code; message wording may improve without changing the code.

#### FR-3: Deterministic ordering

For identical Policy Configuration, actor authorization, request, and Wiki state, the system shall return identical Findings in identical order.

**Consequences:**

- Errors, Warnings, and System Failures are returned in separate ordered collections.
- Within each class, results are ordered by stable collection and document identifiers, then by applicable location, then by issue code.
- Titles, diagnostic prose, retrieval timing, and database return order do not control result ordering.

**Capability acceptance criteria:**

- Repeated runs over identical fixtures produce byte-equivalent issue codes, severities, locations, completeness state, and ordering after excluding explicitly documented request-correlation metadata.
- Fixtures cover textual, document-level, relationship, not-evaluated, incomplete, and failed outcomes.
- A client can determine clean, not evaluated, incomplete, and degraded states without parsing human-readable messages.

### 4.2 Read-Only Document Linting

**Description:** `lint_document` evaluates the current stored state of one authorized document under the policy of its collection and returns deterministic findings without modifying Wiki state.

#### FR-4: Authorized document inspection

An authenticated MCP actor can invoke `lint_document` for a document the actor may read.

**Consequences:**

- The tool evaluates the document's current stored title and body plus only the authorized related state required by applicable rules.
- An inaccessible document is handled through existing access boundaries and is not exposed through lint diagnostics.
- A document whose collection is `null` or has no Policy Configuration entry returns the explicit policy-not-configured/not-evaluated outcome. A document in an Invalid-Policy Collection returns the System Failure FR-12 requires.

#### FR-5: Deterministic document-structure rules

For a Configured Collection, `lint_document` shall evaluate the configured mechanically verifiable document rules.

**Consequences:**

- Supported rules cover required sections and order, allowed heading levels, required visible metadata, configured field syntax, and explicitly unsupported Markdown structures.
- The initial implementation does not infer document type or policy from prose.
- Template use does not substitute for validation of the resulting document.

#### FR-6: Access-aware internal-link validation

`lint_document` shall validate supported Outline document identifiers and URL identifiers referenced by the document without exposing protected target information.

**Consequences:**

- Resolvable authorized targets pass the link rule.
- Missing, deleted, and inaccessible targets collapse to the same non-disclosing outcome whenever distinguishing them would reveal information unavailable to the actor.
- More specific diagnostics are permitted only when the actor is already authorized to know the distinguishing state.
- Anchor correctness and fuzzy matching remain outside the initial implementation.

**Capability acceptance criteria:**

- Every configured document rule has valid and invalid fixtures with a stable expected issue code and location.
- Canonical visible metadata is accepted only after fixtures prove it survives the selected baseline's actual Markdown/ProseMirror round trip; front matter receives no special semantics without equivalent evidence.
- Link fixtures prove valid targets pass, unresolved targets fail, and unauthorized actors cannot distinguish a protected target from another unresolvable target.
- Invoking `lint_document` causes no document, collection, permission, or hierarchy mutation. Its only permitted durable effect is the minimized audit summary required by FR-19.

### 4.3 Read-Only Wiki Linting

**Description:** `lint_wiki` detects drift across an authorized configured scope. It combines document checks with mechanically verifiable collection-level integrity checks and reports exactly what was evaluated.

#### FR-7: Authorized Wiki scope

An authenticated MCP actor can invoke `lint_wiki` with an optional collection identifier.

**Consequences:**

- With a collection identifier, the tool evaluates that collection only when the actor may access it. A Configured Collection is linted, an Invalid-Policy Collection is reported under FR-12, and any other collection is not evaluated.
- Without a collection identifier, the tool evaluates all Configured Collections and documents readable by the actor and reports each readable Invalid-Policy Collection under FR-12.
- The response describes the Evaluated Scope without naming or implying inaccessible collections or documents.
- Clean applies only to the reported authorized scope, never implicitly to the entire workspace.

#### FR-8: Technical hierarchy integrity

Within the Evaluated Scope, `lint_wiki` shall detect configured mechanically verifiable hierarchy defects.

**Consequences:**

- The initial rules cover dangling parent identifiers, cycles, published documents missing from collection structure, and structurally inconsistent cross-collection parent relationships.
- The system does not judge whether a document is logically placed under the correct parent or category.

#### FR-9: Configured global-index integrity

Within the Evaluated Scope, `lint_wiki` shall verify that the configured surface document directly links to every explicitly configured global-index document.

**Consequences:**

- The system checks only identifiers explicitly supplied by Policy Configuration.
- It does not infer which documents should be global indexes.
- Diagnostics preserve authorization and information-disclosure boundaries.

#### FR-10: Partial read-only evaluation

When an isolated runtime failure prevents evaluation of part of an otherwise authorized Wiki scope, the system shall preserve useful completed findings and continue independent checks when safe.

**Consequences:**

- The response includes separate System Failures and reports `complete: false`.
- The response identifies evaluated portions safely and does not claim a Clean Result.
- A failure does not authorize broader access or disclose protected resource metadata.

**Capability acceptance criteria:**

- Collection fixtures cover valid structure, each hierarchy defect, required direct surface links, and absent direct links.
- Actor fixtures prove default scope is limited to readable Configured Collections and readable Invalid-Policy Collections and that no inaccessible identity or metadata appears in results.
- An injected isolated runtime failure produces retained findings for completed work, a stable System Failure, `complete: false`, and no Clean Result.
- Re-running a repaired logical batch yields a complete zero-error result for the same Evaluated Scope.

### 4.4 Policy Scope and Validation Failure Safety

**Description:** Policy applies only where explicitly configured. Configuration defects and runtime failures are distinguishable, fail safely, and cannot be silently reclassified as content findings or clean results.

#### FR-11: Per-collection policy applicability

The system shall enable deterministic lint policy explicitly per collection through server-side Policy Configuration.

**Consequences:**

- Workspace-specific schemas, templates, surface identifiers, and global-index identifiers remain configuration data rather than reusable source, tool descriptions, examples, or fixtures.
- Applicability to `create_document` and `update_document` is determined by the Projected Document's post-operation collection.
- An Enforced Write whose post-operation collection is an Enforced Collection is validated before persistence; a supported write whose post-operation collection is not an Enforced Collection is not blocked by a former collection's content policy.
- Read-only requests whose actor-readable scope contains neither a Configured Collection nor an Invalid-Policy Collection return policy-not-configured/not-evaluated; an Invalid-Policy Collection in that scope follows FR-12. For `lint_document`, the actor-readable scope is the collection of the document the actor can read, even when the actor cannot read that collection itself; for `lint_wiki`, it is the requested collection when the actor can read it and, without a collection identifier, the collections the actor can read.
- MCP writes that are not Enforced Writes retain upstream behavior and response compatibility. They include every write whose post-operation collection, when the request is handled, is `null`, has no Policy Configuration entry, or is a Configured Collection with `read_only` activation.

#### FR-12: Invalid configuration handling

Invalid Policy Configuration shall produce a distinct stable System Failure and shall fail closed for every hard-enforced write in the affected scope. A configuration defect that prevents identifying which collections the configuration covers instead stops the instance from starting, and its startup diagnostics name a stable failure code and a non-secret location of the defect without any configuration content.

**Consequences:**

- Invalid configuration never becomes a Warning or a content Error.
- Invalid configuration never permits fail-open behavior.
- Read-only operations affected by invalid configuration never report a Clean Result.
- A read-only operation whose actor-readable scope (FR-11) contains an Invalid-Policy Collection reports it as this System Failure, or as a generic runtime System Failure when the collection's readability cannot be established, and never as not evaluated. Its collection and policy identity appear only as NFR-11 allows.
- A configuration System Failure is an operator escalation, not an agent-repairable Finding. The agent escalates it to the Wiki operator under UJ-1 rather than repairing it, and a scope that contains one reaches a Clean Result only after the operator corrects the configuration.

#### FR-13: Runtime validation failure handling

After valid configuration has been established, runtime validation failures shall fail closed for configured MCP writes by default.

**Consequences:**

- An operator may explicitly enable runtime-failure fail-open separately for a Configured Collection.
- Fail-open defaults to disabled and cannot be enabled or overridden by an MCP request.
- Fail-open applies only to runtime validation failures, never invalid configuration or known content Errors.
- Every write admitted through fail-open returns the unmistakable `degraded_validation` Validation Status and a safe machine-readable System Failure.
- Failures of the write's own authorization, locking, transformation, media staging, model validation, or persistence, a commit that does not take effect, and any failure that leaves the write's transaction unusable, are not runtime validation failures. They never fail open and follow the second FR-16 exception.
- A write is admitted through fail-open only when it commits. A fail-open decision followed by an abort returns no `degraded_validation` and does not exercise fail-open. A fail-open write whose commit the server cannot establish, or whose status it cannot recover under FR-16, returns the FR-16 Tool-Execution Error instead of `degraded_validation`, and its audit follows FR-20.

#### FR-23: Stable severity semantics

Each Finding issue code shall have one fixed severity as part of its client-visible meaning.

**Consequences:**

- The same issue code is always an Error or always a Warning across collections and Policy Configurations.
- Policy Configuration may enable a rule and set its deterministic parameters but may not override the severity of its issue code.
- Advisory and blocking variants of the same mechanical condition require distinct issue codes with independently documented semantics.
- A configuration that attempts to override issue-code severity is invalid and follows FR-12.

**Capability acceptance criteria:**

- Configuration fixtures prove each malformed or inconsistent collection entry produces a stable System Failure and blocks affected writes. Each defect that prevents identifying the covered collections blocks startup with a stable failure code and a non-secret location and logs no configuration content.
- A read-only request whose actor-readable scope (FR-11) contains neither a Configured Collection nor an Invalid-Policy Collection returns not evaluated. An Invalid-Policy Collection in the actor-readable scope returns the System Failure FR-12 requires, never a not-evaluated or Clean Result. In `lint_document` this includes a readable document whose collection the actor cannot read, and that result carries no collection or policy identity. In collection-scoped and default-scope `lint_wiki`, an Invalid-Policy Collection the actor cannot read contributes nothing. A write that is not an Enforced Write matches baseline upstream behavior.
- Injected runtime failures prove default fail-closed behavior and per-collection fail-open behavior independently.
- No request parameter or tool input can activate, widen, or override fail-open policy.
- Severity fixtures prove each issue code has one invariant severity and that attempted configuration overrides fail closed.

### 4.5 MCP Write Enforcement

**Description:** The shared lint policy evaluates the complete state that an Enforced Write into an Enforced Collection would persist; an Enforced Write into an Invalid-Policy Collection fails closed without evaluation. Known Errors and fail-closed System Failures reject the operation before externally visible effects; Warnings remain visible without blocking.

#### FR-14: Create enforcement

For a `create_document` Enforced Write whose Projected Document belongs to an Enforced Collection, the system shall validate the complete Projected Document before persistence.

**Consequences:**

- Known Errors return deterministic Findings and the `rejected` Validation Status.
- Zero Errors does not block persistence; the write remains subject to fail-closed System Failures and existing upstream checks.
- Templates may populate content but do not substitute for validation of the Projected Document.

#### FR-15: Complete update enforcement

For an `update_document` Enforced Write whose Projected Document belongs to an Enforced Collection, the system shall validate the complete Projected Document before persistence for every supported update mode.

**Consequences:**

- `replace`, `append`, `prepend`, and `patch` use the selected baseline's actual transformation semantics.
- Validation covers the resulting title and body, including unchanged content relevant to policy.
- Validating only the incoming fragment is non-conforming.

#### FR-16: Explicit configured-write outcome

Every Enforced Write response shall expose one Validation Status without requiring the client to infer validation from missing fields or message prose. This requirement has three exceptions.

1. **Collection change.** Suppose an Enforced Write was classified under a valid `enforced` policy, and the server's re-check before commit then finds a post-operation collection that differs from the classified one. Whenever that difference is detected, the write fails with a Tool-Execution Error that carries a stable error identifier. It has no Validation Status and is not a Validation Attempt, and any validation already performed is discarded.
2. **Abort or unestablished outcome.** A Validation Attempt whose response can report neither a commit nor a rejection fails with a Tool-Execution Error and has no Validation Status, whatever the attempt's eventual outcome. The error carries the message of an Outline application error that has a stable identifier, and otherwise, and always for an outcome the server cannot establish or a committed status it cannot recover, a fixed generic message. This covers the failures that FR-13 excludes from runtime validation failures, before or after the validation decision; client cancellation before the write proceeds to persistence; a requester that obtains no result from the asynchronous HTML import job; and a commit whose outcome the server cannot establish. The write is rolled back, except that when the server cannot establish whether it committed or will commit, or cannot recover a committed write's status, the error makes no claim about persistence.

3. **Classification failure.** A failure during classification itself keeps baseline behavior or fails with a Tool-Execution Error that carries the fixed generic message. It has no Validation Status, is not a Validation Attempt, and records no summary.

A committed Enforced Write returns its Validation Status unless the server cannot establish that it committed or, for an HTML create whose committed row is found by a later lookup or probe rather than reported by the attempt that committed it, cannot recover the status that attempt recorded. A status recovered that way may carry empty Error and Warning collections. Failure to assemble the breadcrumb, share URL, or patch-mode final-Markdown echo omits that detail, and failure to assemble the other document fields reduces the response to the document identifier and the validation object; neither turns a committed write into an error.

**Consequences:**

- `validated` means validation completed with zero Errors and zero Warnings.
- `validated_with_warnings` means the write succeeded with zero Errors and one or more Warnings, which are returned unless the status was recovered from a committed row found by a later lookup or probe (FR-16).
- `degraded_validation` means the write succeeded only because the collection's runtime-failure fail-open policy was exercised.
- `rejected` means the write did not persist because of Errors or a fail-closed System Failure.

#### FR-17: No partial or externally visible rejected-write effects

An Enforced Write whose Validation Status is `rejected` shall not persist partial document state or produce externally visible write side effects.

**Consequences:**

- A rejected create leaves no created document.
- A rejected update leaves the prior document state intact.
- A Validation Attempt that aborts under the second FR-16 exception and is rolled back persists no created document, no change to the prior document state, no attachment record, and no document mutation event; media it staged stays inaccessible through Outline. It emits no successful-mutation signal, such as a webhook, websocket message, or notification. When the attempt that issued the commit cannot establish that its own commit took effect, it withholds those signals and the related post-commit processing even though the write may have committed; the architecture records this residual.
- Failed validation does not emit an externally visible successful mutation signal.
- A privacy-preserving audit record of the rejected validation attempt is permitted and required under FR-20; it is evidence of rejection, not a successful mutation effect.

#### FR-18: Initial enforcement boundary

Hard validation in the initial implementation shall apply only to built-in MCP `create_document` and `update_document` operations.

**Consequences:**

- UI and direct-API writes remain possible and are detected by later read-only linting.
- Expanding enforcement to shared lower-level write paths requires a separate product and blast-radius decision.
- Built-in `move_document` and `restore_document` remain outside the initial configured-write validation-status and configured-write validation-audit contracts. Compatibility fixtures characterize their unchanged baseline behavior for collection-changing cases but do not count as CAP-5 Projected Document enforcement evidence.

**Capability acceptance criteria:**

- Invalid create fixtures are rejected before persistence with stable Findings and `rejected` status.
- Each supported update mode is tested against the complete Projected Document, including a case where the incoming fragment appears valid but the resulting document is invalid.
- Collection-applicability fixtures prove that policy selection uses the Projected Document's post-operation collection for every destination-selection path reachable through the selected baseline's in-scope `create_document` and `update_document` contracts. Tool-level fixtures distinguish among the following conditions: an absent policy or null collection, a valid policy with `read_only` activation, a valid policy with `enforced` activation, and an invalid-policy sentinel. An existing collectionless draft with a stable known Error is rejected before publication into an `enforced` destination, leaving its collection and publication state unchanged and producing the required minimized rejection audit. Unconfigured and `read_only` destinations preserve baseline write behavior and response shape and add no configured-write validation audit; an invalid-policy destination fails closed. Separately labeled compatibility fixtures exercise `move_document` and `restore_document` collection changes among `enforced`, unconfigured, `read_only`, and identifiable invalid-policy scopes in every direction permitted by baseline authorization, while preserving baseline authorization, persistence, response, and mutation-event behavior and adding no validation field or configured-write validation-audit summary. These compatibility fixtures provide neither Projected Document enforcement evidence nor CAP-5 enforcement evidence. Resulting out-of-band drift remains detectable by `lint_wiki` only when the destination has a valid configured policy and lies within the actor-authorized Evaluated Scope; unconfigured and invalid-policy destinations retain their approved not-evaluated or System Failure behavior.

| In-scope operation path | Post-operation collection source | Required evidence |
| --- | --- | --- |
| `create_document` with `collectionId` | Explicit destination collection | Unconfigured, `read_only`, `enforced`, and invalid-policy outcomes select only the resolved destination policy. |
| `create_document` with `parentDocumentId` | Authorized parent collection | The parent-derived destination follows the same four policy cases without trusting a conflicting request value. |
| `update_document` on an existing collected document | Existing collection | Policy selection uses the retained collection for every edit mode, title-only update, publication state, and update with unchanged policy-relevant content; `collectionId` cannot move the document. |
| `update_document` on an existing collectionless draft without publication | `null` | Baseline response behavior is preserved, no validation field or configured-write validation audit is added, and `collectionId` without `publish: true` neither moves nor attaches the draft. |
| `update_document` publishing an existing collectionless draft | Authorized `collectionId` destination | A stable known Error proves `enforced` pre-persistence rejection; clean and Warning cases remain governed by the existing acceptance criteria. |
| `update_document` unpublishing an existing collected document | Existing collection because `detach: false` | Policy selection uses the retained collection; the operation is not treated as leave-scope. |
| `move_document` collection change | Destination chosen by the baseline move contract | Compatibility across `enforced`, unconfigured, `read_only`, and identifiable invalid-policy scopes only: no lint enforcement, validation field, or configured-write validation audit is added. |
| `restore_document` collection change | Explicit or original collection under the baseline restore contract | Compatibility across `enforced`, unconfigured, `read_only`, and identifiable invalid-policy scopes only: no lint enforcement, validation field, or configured-write validation audit is added. |

For all policy-bearing in-scope rows, fixtures separately cover an absent-policy state, a valid `read_only` state, a valid `enforced` state, and an identifiable invalid-policy sentinel state. Authorization failures return their baseline error content, never become lint Findings, and never admit writes on a fail-open basis.

- Warnings permit persistence and are returned with `validated_with_warnings`, except in a status recovered under FR-16.
- Rejected create and update tests prove no partial state, activity, event, or other externally visible successful-write effect remains.
- Runtime failure tests prove default rejection and explicit per-collection degraded admission, while invalid configuration and known Errors remain unconditionally blocking.
- Abort fixtures prove, for established aborts before and after the validation decision, that the second FR-16 exception returns a Tool-Execution Error without a Validation Status, never fails open, persists nothing as FR-17 requires, and records its aborted outcome under FR-20. They also prove that a committed write whose optional response details fail still returns its Validation Status, and that a write whose outcome cannot be established makes no persistence claim.
- Invalid-Policy Collection fixtures cover each policy-bearing in-scope `create_document` and `update_document` path. The fixtures include:
  - HTML-format create;
  - template use;
  - a `patch` whose target text is absent;
  - an update with no changed field;
  - an update containing embedded images; and
  - unpublish.

  They prove that once baseline authentication, input-schema validation, lookup, and pre-write authorization succeed, the write behaves as follows:
  - It returns the modeled `rejected` Validation Status with the stable configuration System Failure.
  - It persists nothing and creates no import job, attachment, activity, or successful-mutation signal.
  - It exposes no fabricated valid policy identity and no raw configuration.
  - It attempts exactly one minimized validation-audit summary. That summary's payload carries the stable System Failure code and no valid or invalid policy fingerprint.

  A failed authentication, input-schema, lookup, or pre-write authorization check keeps its baseline behavior. It produces neither this outcome nor a validation-audit summary.
- Classification fixtures prove three things:
  - An HTML `create_document` Enforced Write may be classified under a valid `enforced` policy and then, before persistence, find a different fingerprint for the same post-operation collection. This covers worker-time `read_only`, absent, and invalid states. It then returns `rejected` with one configuration System Failure and, only when the actor can read the classified collection, its request-time valid policy identity.
  - An Enforced Write classified under a valid `enforced` policy may have its post-operation collection change before or after validation. When the re-check before commit detects the change, the write fails with the Tool-Execution Error of the first FR-16 exception. It persists nothing and records no validation audit.
  - A write that is not an Enforced Write when the request is handled is not reclassified by a later policy or collection change.
- Discovery and integration tests prove the same `/mcp` endpoint exposes the lint tools and enforced write tools to supported clients.

### 4.6 Durable Audit Evidence

**Description:** The product extends Outline's existing authorized Event/audit-log capability with durable, privacy-preserving summaries of lint and configured-write validation. Pilot and operational evidence must not depend on an external telemetry backend being enabled.

#### FR-19: Read-only lint audit summary

Every `lint_document` and `lint_wiki` invocation that returns a lint result, which is any modeled outcome including not evaluated, incomplete, and failed, shall attempt to record one audit summary attributable to the authenticated actor and authorized scope. Under normal audit operation, exactly one retrievable summary shall be recorded per such invocation.

**Consequences:**

- The summary identifies the lint operation, outcome, completion state, duration, scope kind, and server request correlation identifier, and, when the scope is one collection or one document under a valid policy, that policy's version and fingerprint.
- It records counts of evaluated documents and links where applicable, plus Finding counts by severity and stable code.
- It records whether the outcome was clean, not evaluated, incomplete, or failed.
- An invocation that ends in a Tool-Execution Error, such as an invalid call or an authorization denial, returns no lint result and records no summary.
- It records a reliable authenticated client identifier only when one is available; it shall not trust an arbitrary client-supplied label.

#### FR-20: Configured-write validation audit summary

Every Enforced Write Validation Attempt shall attempt to record one audit summary, including attempts rejected before mutation, rejections because the post-operation collection is an Invalid-Policy Collection, and attempts whose abort under the second FR-16 exception the server establishes. Under normal audit operation, exactly one retrievable summary shall be recorded per Validation Attempt whose outcome the server establishes; the consequence below on attempts whose outcome the server cannot establish governs them.

**Consequences:**

- The summary records the Validation Status or, for an aborted attempt, whether it aborted before or after its validation decision, together with the duration, Finding counts by severity and stable code, and whether runtime fail-open was exercised. When the Enforced Write was classified under a valid policy, the summary also records that policy's version and fingerprint. A rejection because the post-operation collection is an Invalid-Policy Collection records its stable System Failure code and no valid or invalid policy fingerprint.
- Successful writes remain represented by the baseline's existing document mutation events and can be correlated with their validation audit summary.
- A rejected attempt produces no document mutation event but retains its validation audit evidence.
- Degraded validation is identifiable both in the MCP response and in the durable audit record.
- An aborted attempt records zero Finding and System Failure counts, records runtime fail-open as not exercised, and never counts as validation success.
- When the server cannot establish an attempt's outcome, the request records no summary of its own. A summary recorded by the component that ended the attempt stands, and a missing summary is an accepted audit evidence gap that operators reconcile out of band as FR-22 describes.

#### FR-21: Audit minimization and authorized retrieval

Lint and validation audit summaries shall use Outline's existing authorized audit surface and retention policy without persisting full lint results.

**Consequences:**

- Audit data excludes document bodies, excerpts, diagnostic messages, line or path locations, protected target identifiers or metadata, raw Policy Configuration, and MCP request bodies.
- Document or collection identifiers are associated only when allowed by the existing audit authorization model and necessary to identify the audited scope. For read-only lint, the audited scope is the actor-authorized scope. For an Enforced Write, it is the classified post-operation collection and, when the document row exists, the written document, recorded with the policy fields FR-20 requires whether or not the writing actor can read that collection. That collection is the write's own scope, not a protected target, and the summary is retrievable only through the authorized audit surface.
- Authorized operators can retrieve summaries needed to calculate pilot and operational measures without direct database access.
- External APM, StatsD, or equivalent telemetry may enrich operations later but is not required to prove initial implementation or pilot success.
- Audit persistence state is not part of the standard MCP response contract and is not presented to the agent as a Wiki integrity concern.

#### FR-22: Audit failure isolation

Failure of the added lint or validation audit mechanism shall not alter the functional outcome of the operation it observes.

**Consequences:**

- A completed read-only lint retains its actual clean, warning-bearing, incomplete, or failed outcome regardless of audit persistence.
- Audit persistence failure does not reject, roll back, or downgrade an otherwise permitted configured write.
- One narrow exception is accepted. When the committing attempt's result from an asynchronous HTML import job does not reach the requester and that attempt's committed audit summary is also missing, the response reports an unestablished outcome under FR-16 instead of the committed Validation Status. The write itself is unaffected, the response claims neither success nor failure, and the document remains readable through the ordinary tools.
- A content or validation rejection remains rejected regardless of whether its audit summary can be persisted.
- Audit persistence failures are reported through operator-facing structured server diagnostics with request correlation, not through the standard MCP response.
- Pilot evidence collection may record an audit evidence gap out of band; the agent is not asked to diagnose internal observability infrastructure unless explicitly performing an authorized debugging task.

**Capability acceptance criteria:**

- Tests prove one summary is recorded for each clean, warning-bearing, not-evaluated, incomplete, failed, rejected, degraded, aborted-before-decision, and aborted-after-decision scenario. They prove that none is recorded for a lint invocation that ends in a Tool-Execution Error, a failure during classification, or a collection-change conflict, and that the request path records none for an attempt whose outcome the server cannot establish.
- A rejected write produces validation audit evidence while leaving document state and successful-mutation events unchanged.
- Audit authorization tests prove unauthorized actors cannot retrieve summaries or infer protected target information.
- Payload fixtures prove all required aggregate fields are present and all prohibited content, request, location, and target data are absent.
- Under normal audit operation, an authorized operator can calculate tool use, duration, completion, severity/code counts, Validation Status counts, and degraded-validation counts from the audit surface without direct database access.
- Injected audit-write failures leave lint and write outcomes unchanged, expose no audit state in the standard MCP response, and produce a correlated operator-facing diagnostic; FR-22 names the one exception.

## 5. Cross-Cutting Non-Functional Requirements

### 5.1 Performance and Growth

Performance budgets are implementation-readiness requirements measured on an agreed reference environment against the selected `v1.10.1^{}` baseline. Exceeding a budget does not turn a successfully completed lint into an Error, Warning, or non-clean result. An actual timeout, interruption, or incomplete evaluation is a System Failure and follows FR-1 and FR-10.

- **NFR-1 — Document lint latency:** `lint_document` shall complete within 1 second at p95 for the normal acceptance profile.
- **NFR-2 — Write-enforcement overhead:** Configured validation shall add no more than 500 milliseconds at p95 above the equivalent upstream create or update operation for the normal acceptance profile.
- **NFR-3 — Normal Wiki lint latency:** `lint_wiki` shall complete within 10 seconds at p95 for an Evaluated Scope of 150 representative documents.
- **NFR-4 — Growth guardrail:** `lint_wiki` shall complete within 60 seconds for a representative 1,000-document scope. This profile is a scalability guardrail, not a declared product limit.
- **NFR-5 — Growth evidence:** Implementation evidence shall report p95 runtime and peak working-set memory for both the 150- and 1,000-document reference profiles, normalized by evaluated document and internal-link counts. The evidence shall identify and explain any increase in normalized resource cost; NFR-3 and NFR-4 remain the hard latency budgets.

**Measurement requirements:**

- Architecture work shall define reproducible reference hardware, dataset characteristics, link density, warm-up, sample size, and percentile calculation before implementation is performance-gated.
- Implementation evidence shall report the baseline upstream operation and the lint-enabled operation separately for write-overhead measurement.
- Runtime duration and processed-scope counts shall be observable without changing Finding severity or Clean Result semantics.
- Deterministic collection-size or reference-density warnings remain outside the initial implementation as deferred Wiki quality statistics.

### 5.2 Reliability and Consistency

- **NFR-6 — Point-in-time meaning:** A Clean Result shall describe one coherent observed state of the Evaluated Scope. The architecture may choose the consistency mechanism, but it may not claim clean when concurrent changes make coherence unverifiable.
- **NFR-7 — Concurrent-change handling:** If the evaluated state changes during `lint_wiki` and coherence cannot be confirmed, the operation shall return a stable System Failure and `complete: false`; the agent may re-run lint after changes settle.
- **NFR-8 — Failure isolation:** A rule or resource failure shall not silently suppress other required checks. Read-only operations preserve safe completed work under FR-10; configured writes follow FR-12 and FR-13.
- **NFR-9 — Rejected-write atomicity:** Validation rejection shall preserve the pre-operation externally visible state under FR-17 across every supported create and update path. A Validation Attempt that aborts and is rolled back under the second FR-16 exception shall preserve the pre-operation externally visible state.

### 5.3 Security and Information Disclosure

- **NFR-10 — Existing security boundaries:** All lint and enforcement paths shall preserve the selected baseline's authentication, authorization, transaction, and information-disclosure boundaries.
- **NFR-11 — Least disclosure:** Findings, scope summaries, System Failures, logs, and metrics shall contain no document content, target identity, title, URL identifier, collection identity, or metadata that the current actor is not authorized to access. Durable audit summaries are operator evidence, not actor-facing output: FR-21 governs the identifiers they carry, and only the authorized audit surface returns them. One exception is accepted. An actor who may read or write a document but cannot read its collection may learn that collection's policy class (no policy, `read_only`, `enforced`, or invalid) from a lint result's state and System Failures, from whether a write returns a Validation Status, and from a validation correlation identifier on a mutation event the actor can see. That actor never learns the collection's identity, its policy fingerprint, or policy content beyond the Findings and System Failures that its own document produces. A second, narrower exception is accepted. A Finding for a missing required section, a missing required metadata field, or a missing required global-index link may name the missing item to an actor who can read the collection, and only to that actor. The name is limited to the configured heading, field name, or the readable index document, and never extends to other policy content, fingerprints, or collection identity beyond what the actor may already read.
- **NFR-12 — No authority expansion:** A Finding is diagnostic evidence only. It shall not grant write authority, broaden an MCP batch, bypass single-writer coordination, or authorize repair of another document.
- **NFR-13 — Safe rendering:** User-controlled `href` and `src` values emitted through ProseMirror `toDOM` shall be sanitized with the baseline's approved URL sanitizer.

### 5.4 Observability

- **NFR-14 — Durable structured evidence:** Under normal audit operation, operators shall be able to observe lint and configured-write validation counts, durations, completion states, Validation Status values, Finding counts by severity and code, and System Failure codes through the existing authorized Event/audit-log capability. Audit persistence failures follow NFR-27.
- **NFR-15 — Degraded-validation signal:** Under normal audit operation, every write admitted through runtime fail-open shall emit a durable operator-visible audit event in addition to the MCP response. Audit persistence failure follows NFR-27 and cannot conceal the `degraded_validation` status already returned to the agent. A write whose outcome the server cannot establish (FR-16) is an audit evidence gap under FR-20, not a breach of this requirement or of SM-P6.
- **NFR-16 — Configuration health:** Invalid Policy Configuration shall be observable before or at the first affected operation with a stable failure code and enough non-secret context for an operator to locate the configuration scope.
- **NFR-17 — Privacy-preserving observability:** Audit records, logs, and any optional telemetry shall not record document bodies, diagnostic excerpts, protected target metadata, raw requests, or reusable private Wiki identifiers in generic labels or tool descriptions.
- **NFR-27 — Observation failure isolation:** Failure of the added audit path shall be observable to operators but shall not change validation semantics, block functional operations, or add internal audit diagnostics to standard agent-facing responses. FR-22 names the one exception.

### 5.5 Compatibility

- **NFR-18 — Fixed implementation baseline:** Compatibility evidence shall be produced against `v1.10.1^{}` at `4a5a616a21be800257dc11cef4263d0dd0412156`. Results from another revision do not satisfy this requirement.
- **NFR-19 — Standard endpoint:** All supported MCP clients shall discover and use the lint tools and enforced writes through the same existing `/mcp` endpoint without client-specific server composition.
- **NFR-20 — Unconfigured behavior:** Collections without enabled policy shall retain baseline upstream create and update behavior and response compatibility.
- **NFR-21 — Explicit backports only:** Later upstream changes shall not enter the linting implementation through merge or rebase. Each accepted backport requires an explicit decision and its own compatibility evidence.

### 5.6 Maintainability and Reusability

- **NFR-22 — Shared policy behavior:** Read-only linting and write enforcement shall use one reusable rule engine so a rule has one observable meaning across every surface.
- **NFR-23 — Stable codes:** Issue and System Failure codes are client contracts. A material semantic change requires a new code and test evidence; clients must not be required to parse message prose.
- **NFR-24 — Rule-level verification:** Every in-scope rule shall have isolated valid and invalid fixtures plus integration evidence on each surface where it applies.
- **NFR-25 — Environment independence:** Reusable code, public interfaces, codes, tool descriptions, examples, fixtures, and generic documentation shall contain no Laura-specific or pilot-workspace identifiers or assumptions.
- **NFR-26 — Baseline-conformant implementation:** Implementation shall follow the selected baseline's TypeScript and test conventions and shall not claim stricter language guarantees than its checked-in configuration provides.

## 6. Success Metrics and Counter-Metrics

### 6.1 Implementation Readiness

- **SM-I1 — Capability coverage:** 100% of capability acceptance criteria covering FR-1 through FR-23 pass on the selected baseline, including all rule families, read-only surfaces, write outcomes, update modes, failure classes, authorization cases, and audit-failure isolation.
- **SM-I2 — Deterministic contract:** Repeated evaluation of identical fixtures produces identical normalized outcomes, stable codes, safe locations, completeness, and ordering with zero nondeterministic failures across the implementation gate suite.
- **SM-I3 — Write safety:** Every invalid configured create and update fixture is rejected before document mutation; every warning-only fixture persists successfully; rollback and externally visible state checks report zero partial mutation effects.
- **SM-I4 — Security boundary:** Authorization and non-disclosure suites pass with zero cases in which an unauthorized actor distinguishes or obtains protected document, collection, link-target, scope, or audit information, other than the policy class that NFR-11 permits.
- **SM-I5 — Performance:** NFR-1 through NFR-4 budgets pass on the documented reference environment and datasets, and NFR-5 normalized growth evidence is complete and inspectable; observed durations are calculated from benchmark evidence rather than lint severity.
- **SM-I6 — Audit evidence:** Normal-operation tests produce one minimized authorized audit summary per lint invocation that returns a lint result and per configured Validation Attempt whose outcome the server establishes; injected audit failures leave functional outcomes unchanged and produce correlated operator diagnostics only; FR-22 names the one exception.
- **SM-I7 — Compatibility and portability:** Unconfigured collections match baseline behavior, all tools are discoverable on the same `/mcp` endpoint, and reusable artifacts contain zero pilot-environment identifiers.

Implementation-readiness evidence comes from automated tests, benchmark outputs, schema/payload fixtures, and source review. It does not authorize image publication or deployment.

### 6.2 Pilot Success

The initial pilot runs for at least seven days and covers at least ten explicitly declared Logical Change Batches across at least two supported MCP clients using the same `/mcp` endpoint.

- **SM-P1 — Representative and client-equivalent use:** Pilot evidence includes `lint_document`, scoped and/or default `lint_wiki`, a validated write, a validated write with Warnings, and a rejected write. At least two supported MCP clients produce equivalent normalized machine-readable results for the same configuration, actor authorization, request, and Wiki state through the same `/mcp` endpoint. Tool and outcome counts come from authorized audit summaries; client attribution and Logical Change Batch identity come from the restricted pilot evidence record when no reliable authenticated client identifier exists.
- **SM-P2 — Clean batch closure:** 100% of closed pilot batches end with a captured `lint_wiki` result for the intended Evaluated Scope showing `complete: true` and zero Errors. An audit evidence gap does not change the lint result but must be reconciled from the restricted pilot capture before the batch counts toward this metric.
- **SM-P3 — Actionable remediation:** At least one representative batch exercises lint–repair–re-lint and reaches SM-P2 without an unbounded Warning loop or unauthorized scope expansion.
- **SM-P4 — No confirmed false blocking:** Every pilot `rejected` outcome is reviewed against the configured policy; zero are confirmed as valid writes incorrectly blocked by the linter.
- **SM-P5 — No confirmed disclosure regression:** The pilot authorization scenario with actors of different visibility produces zero protected-information disclosures beyond the policy class that NFR-11 permits. Automated authorization tests remain the primary evidence; production logs alone do not satisfy this metric.
- **SM-P6 — Degraded operation control:** Every `degraded_validation` occurrence is reviewed by the Wiki operator, with zero unreviewed occurrences at pilot close. Degraded writes do not count as validated success.
- **SM-P7 — Live performance:** Audit summaries show live pilot latency within the applicable NFR budgets, or every observed breach is triaged as an implementation issue without being reclassified as a Wiki integrity Error.

### 6.3 Counter-Metrics

- **SM-C1 — No skipped checks for speed:** Performance improvement must not reduce required rule execution, Evaluated Scope, or authorization coverage. Counterbalances SM-I5 and SM-P7.
- **SM-C2 — No severity gaming:** Success is not achieved by deleting rules, changing proven Errors into Warnings, hiding Warnings, or weakening stable issue semantics. Counterbalances SM-I1, SM-P2, and SM-P4.
- **SM-C3 — No warning-chasing:** Pilot success does not require zero Warnings and agents must not enter unbounded repair loops for non-blocking findings. Counterbalances SM-P2 and SM-P3.
- **SM-C4 — No authority expansion:** Faster remediation, higher closure rate, or cleaner results must not come from broader actor permissions, cross-document edits outside the authorized batch, or disclosure of inaccessible scope. Counterbalances SM-P2 through SM-P5.
- **SM-C5 — No fail-open normalization:** A higher write-success rate achieved through runtime fail-open is not success. Degraded writes remain exceptional and operator-reviewed. Counterbalances SM-P6.
- **SM-C6 — No client-specific fork:** Equivalent outcomes across clients must not depend on client-specific servers, prompts, adapters, or policy duplication. Counterbalances SM-P1.
- **SM-C7 — No user-visible observability burden:** Audit coverage must not change validation outcomes, block functional operations, or expose internal audit failures to agents performing ordinary Wiki work; FR-22 names the one exception. Counterbalances SM-I6 and SM-P1.

## 7. Scope and Delivery Order

### 7.1 Initial Implementation

The initial implementation includes the shared deterministic result contract, read-only document and Wiki linting, per-collection policy and failure behavior, MCP create/update enforcement, durable minimized audit summaries, and all associated security, compatibility, performance, and verification requirements.

Delivery within the implementation proceeds in this order:

1. Build and validate the shared policy behavior, result contract, `lint_document`, `lint_wiki`, and their audit summaries.
2. Demonstrate the lint–repair–re-lint loop and read-only acceptance criteria.
3. Integrate the same policy behavior with `create_document` and `update_document` enforcement.
4. Demonstrate all configured-write outcomes, atomic rejection, failure modes, audit summaries, compatibility, and implementation-readiness metrics.

Read-only linting is delivered and validated first because it provides the first product value. The initial implementation is not complete until write enforcement also satisfies its acceptance criteria.

### 7.2 Separately Approved Stages

Implementation readiness, image publication, deployment, and production rollout are separate stages. Passing one stage authorizes only consideration of the next stage; it does not authorize or imply it.

## 8. Explicit Non-Goals

The initial implementation does not:

- judge logical placement, meaning, truth, relevance, authority choice, prose quality, language, usefulness, or token efficiency;
- invoke an LLM or semantic classifier;
- scan for secrets or private payloads;
- validate fuzzy anchors or infer intended link targets;
- decide whether a `_misses` entry describes a real incident;
- perform onboarding-specific hash validation;
- require one `_log` entry per MCP mutation or infer Logical Change Batch boundaries;
- add `begin_wiki_batch`, `finish_wiki_batch`, or other batch-orchestration tools;
- enforce writes made through the UI, direct API, or shared lower-level writer paths;
- add Wiki quality statistics, size/density warnings, or semantic quality scoring;
- build a new telemetry platform, audit subsystem, operator dashboard, or administrative UI;
- persist full lint results, document excerpts, diagnostic locations, or protected target metadata in audit records;
- upgrade, merge, or rebase the implementation onto `upstream/main`;
- publish an image, deploy the fork, migrate production policy, or authorize production rollout as part of implementation completion.

## 9. Risks and Guardrails

| Risk | Product guardrail |
| --- | --- |
| False-positive Errors block legitimate MCP work | Only conclusively proven deterministic violations are Errors; valid fixtures and operator review of every pilot rejection gate release. |
| False negatives create unjustified confidence | Clean is scoped to configured mechanical rules and an explicit Evaluated Scope; the product makes no semantic-integrity claim. |
| Link and hierarchy checks disclose protected resources | Authorization-aware evaluation, access-aware outcome collapsing, safe locations, minimized audit records, and dedicated non-disclosure tests are mandatory. |
| Invalid or ambiguous policy weakens enforcement | Invalid Policy Configuration always fails closed and cannot be bypassed by runtime fail-open. |
| Runtime fail-open becomes normal operation | It is per collection, defaults off, cannot be requested by clients, emits degraded status, and requires operator review. |
| Concurrent writes make a clean scan incoherent | Clean requires point-in-time meaning; unverifiable concurrent drift produces `complete: false`, never clean. |
| Full-Wiki lint becomes disruptive as scope grows | Reference performance profiles, proportional-growth requirements, explicit incomplete results, and staged rollout bound the risk without redefining slow results as integrity Errors. |
| Audit records create a second disclosure surface | Persist aggregate counts and safe scope only, reuse existing audit authorization, and isolate audit failure from user-visible functionality. |
| Fixed-baseline behavior diverges from newer upstream | Validate only on `v1.10.1^{}` and evaluate each later upstream change as an explicit tested backport. |
| Pilot assumptions contaminate reusable code | Keep private identifiers and schemas in server-side configuration and gate reusable artifacts on zero pilot-specific dependencies. |

## 10. Dependencies

- **Selected source baseline:** the exact `v1.10.1^{}` source commit and its declared package, TypeScript, database, transaction, and test behavior.
- **Outline security and data access:** existing authentication, authorization, document/collection lookup, transaction, and information-disclosure boundaries.
- **Projection and conversion behavior:** the baseline's create/update transformations and actual Markdown/ProseMirror round trip.
- **Policy inputs:** an operator-approved deterministic schema for each pilot Configured Collection, including required structures, metadata, templates where used, surface identifiers, and global-index identifiers.
- **Audit infrastructure:** the existing authorized Event/audit-log capability and retention policy; external APM or StatsD is not an initial dependency.
- **Verification infrastructure:** representative fixtures, actors with different access levels, a reproducible reference performance environment, and baseline-compatible test services.
- **Pilot participation:** an accountable Wiki operator, at least two supported MCP clients, declared Logical Change Batches, and a restricted evidence record for client and batch attribution when server-side identity is unavailable.
- **Release operations:** separately approved image registry, immutable source/image identification, backup and rollback procedures, target-environment configuration, and operator-controlled enablement.

## 11. Delivery and Approval Gates

No gate is implied by completion of the prior gate. Each requires explicit operator approval and retained evidence for its own scope.

### Gate 1 — Implementation Readiness

**Entry:** Approved PRD and architecture inputs; implementation work is authorized separately.

**Pass conditions:**

- The implementation is based on the exact selected source commit with no merge or rebase onto `upstream/main`.
- SM-I1 through SM-I7 pass with inspectable test, benchmark, security, compatibility, and audit evidence.
- All phase-blocking product and architecture decisions are resolved; non-blocking deferrals have an owner and revisit condition.
- Reusable code, interfaces, descriptions, examples, and fixtures contain no pilot-environment dependencies.
- The implementation diff and evidence identify every explicit upstream backport, if any.

**Exit authority:** The implementation may be considered for image publication. No image publication, environment change, deployment, or rollout is authorized.

### Gate 2 — Image Publication

**Entry:** Gate 1 passed and image publication is explicitly approved.

**Pass conditions:**

- The image is reproducibly attributable to the approved source commit and implementation evidence.
- The immutable image digest, version/tag, build provenance, dependency or vulnerability review, and rollback identifier are recorded.
- Image startup and packaged-artifact smoke checks pass without substituting for deployment verification.
- The approved registry and access boundary are identified.

**Exit authority:** The exact published digest may be considered for deployment. Publication does not authorize pulling or running the image in any environment.

### Gate 3 — Deployment

**Entry:** Gate 2 passed and deployment of the exact approved digest to the named target environment is explicitly approved.

**Pass conditions:**

- Backup, restore, and rollback procedures applicable to the target environment are verified before change.
- Configuration and migration impact are reviewed; any required migration has its own tested rollback treatment.
- The running digest matches the approved publication evidence.
- Health, UI/direct-API compatibility, `/mcp` discovery, existing MCP tools, new lint tools, audit visibility, and unconfigured-collection upstream behavior pass smoke verification.
- No collection policy or hard enforcement is enabled merely by deploying the image.

**Exit authority:** The code may remain running with collections unconfigured or lint policy inactive. Deployment does not authorize enabling read-only policy or hard enforcement for a production collection.

### Gate 4 — Production Rollout

**Entry:** Gate 3 passed and rollout is explicitly approved for named collections and actors.

**Pass conditions and order:**

1. Validate the target collection's Policy Configuration; invalid configuration blocks rollout.
2. Enable read-only linting for the named collection without enabling hard enforcement.
3. Run `lint_wiki`, remediate authorized Errors, and reach a complete zero-error result for the intended Evaluated Scope.
4. Complete SM-P1 through SM-P7, including at least seven days, ten declared Logical Change Batches, and two supported MCP clients.
5. Review every degraded-validation occurrence, rejected-write adjudication, performance breach, security result, and audit evidence gap.
6. Obtain explicit operator approval to enable MCP create/update enforcement for the named collection.
7. Enable enforcement, run post-enable smoke and representative acceptance checks, and verify the documented disable/rollback path.

**Exit authority:** Hard enforcement is active only for the explicitly approved collections. Additional collections, broader write paths, new rule families, or a changed fail-open posture require a new scoped rollout decision.

## 12. Open Decisions and Downstream Owners

No unresolved product-policy decision blocks architecture. The following bounded decisions remain explicit and must be resolved by their stated gate:

- **OD-1 — Initial issue-code catalog:** Product and architecture work shall define the exact generic code names, fixed severities, location types, and semantic descriptions for every initial rule and System Failure. Approve before implementation begins; later material semantic changes require new codes under NFR-23.
- **OD-2 — Pilot Policy Configuration:** The Wiki operator shall approve the actual pilot collection schemas, required visible metadata, templates where used, surface identifier, global-index identifiers, and fail-open posture before Gate 4. These values must not enter reusable code or generic tool descriptions.
- **OD-3 — Consistency and timeout mechanism:** Architecture shall choose the point-in-time consistency strategy, hard execution bounds, and incomplete-result behavior that satisfy FR-10, NFR-6, and NFR-7 before implementation readiness can pass.
- **OD-4 — Audit event design and client attribution:** Architecture shall define event names, minimized payload types, correlation, indexes, failure isolation, and reliable client identity where available before implementation begins. The pilot evidence record remains required when the server cannot authenticate client identity reliably.
- **OD-5 — Performance reference definition:** Architecture and the operator shall define reference hardware, representative documents and link density, warm-up, sample size, and percentile method before SM-I5 is evaluated.
- **OD-6 — Pilot clients and evidence procedure:** The operator shall name the two supported MCP clients and approve the restricted Logical Change Batch evidence procedure before Gate 4.
- **OD-7 — Release-operation details:** The operator shall identify the authorized registry, image naming, target environment, change window, backup/restore evidence, and rollback procedure before the applicable Gate 2 or Gate 3 approval.

## 13. Assumptions Status

No unconfirmed product assumptions remain in this PRD. Downstream mechanism and environment choices are tracked explicitly in Section 12 rather than embedded as silent assumptions.
