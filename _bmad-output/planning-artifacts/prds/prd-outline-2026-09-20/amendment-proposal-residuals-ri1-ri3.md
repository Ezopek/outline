---
title: "Proposed Contract Amendment: Residuals RI-1, RI-2, and RI-3"
status: applied
created: 2026-10-01
updated: 2026-10-01
source_prd: prd.md
source_architecture: ../../architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md
resolves:
  - RI-1
  - RI-2
  - RI-3
---

# Proposed Contract Amendment: Residuals RI-1, RI-2, and RI-3

## Status and Authority

This document is a proposal and changes no approved source. Applying it requires a separate, explicit operator authorization that names it. That authorization would also be the explicit override needed to amend the adopted rule text of AD-3, AD-18, AD-19, and AD-20. The authority order is unchanged: PRD, addendum, `ARCHITECTURE-SPINE.md`, `SPEC.md`, then repository contracts.

The applied `amendment-proposal-prd-spine-alignment.md` reported these three residuals. The operator decided all three on 2026-10-01, and the decisions are recorded in the PRD and architecture workspace memlogs:

- **RI-1: narrow FR-19 to AD-14.** A read summary carries the policy version and fingerprint only when its scope is one collection, or one document, under a valid policy. The operator correlates default-scope reads through the AD-19 readiness `policySetFingerprint` and the event time. `AuditDataV1` is unchanged.
- **RI-2: stable code and non-secret location before a startup-fatal exit.** A configuration defect that prevents identifying the covered collections stops the instance. Before exiting, the instance logs one stable startup-only code and a non-secret location, and never logs content. FR-12 and the Section 4.4 criterion allow this startup blocking. AD-3 gains one startup-only code, and AD-19 and AD-18 state the diagnostic and its fixture.
- **RI-3: buffer post-commit callbacks until the commit is established.** The enforcement transaction runs post-commit callbacks only when the attempt itself establishes its own commit, and discards them otherwise. This is a subset of AD-20 row 6; limiting it to a commit the attempt can prove is its own is the author's refinement, recorded in the PRD memlog. A commit the attempt cannot establish as its own may therefore lose baseline post-commit processing, but it never emits a false signal. That lost processing is named below as a recorded residual that authorization accepts. FR-17 and NFR-9 extend to signals for rolled-back aborts, and AD-20 and AD-18 state the rule and its fixtures.

Every AD identifier stays, and so do every `Binds` line, every `Prevents` line, and adopted status. The proposal introduces no OD-2, OD-6, or OD-7 value. It authorizes no implementation, publication, deployment, configuration, or rollout.

## Proposed Normative Delta

This delta is exhaustive. Every quoted "Replace" text and insertion anchor occurs exactly once in its target.

### Part A: PRD (`prd.md`)

#### A-1. FR-19 first consequence (RI-1)

Replace:

> - The summary identifies the lint operation, outcome, completion state, duration, scope kind, policy version or fingerprint, and server request correlation identifier.

With:

> - The summary identifies the lint operation, outcome, completion state, duration, scope kind, and server request correlation identifier, and, when the scope is one collection or one document under a valid policy, that policy's version and fingerprint.

#### A-2. FR-12 statement (RI-2)

Replace:

> Invalid Policy Configuration shall produce a distinct stable System Failure and shall fail closed for every hard-enforced write in the affected scope.

With:

> Invalid Policy Configuration shall produce a distinct stable System Failure and shall fail closed for every hard-enforced write in the affected scope. A configuration defect that prevents identifying which collections the configuration covers instead stops the instance from starting, and its startup diagnostics name a stable failure code and a non-secret location of the defect without any configuration content.

#### A-3. Section 4.4 capability acceptance criterion 1 (RI-2)

Replace:

> - Configuration fixtures prove each malformed or inconsistent configuration class produces a stable System Failure and blocks affected writes.

With:

> - Configuration fixtures prove each malformed or inconsistent collection entry produces a stable System Failure and blocks affected writes. Each defect that prevents identifying the covered collections blocks startup with a stable failure code and a non-secret location and logs no configuration content.

#### A-4. FR-17 abort consequence (RI-3)

Replace:

> no attachment record, and no document mutation event; media it staged stays inaccessible through Outline.

With:

> no attachment record, and no document mutation event; media it staged stays inaccessible through Outline. It emits no successful-mutation signal, such as a webhook, websocket message, or notification. When the attempt that issued the commit cannot establish that its own commit took effect, it withholds those signals and the related post-commit processing even though the write may have committed; the architecture records this residual.

#### A-5. NFR-9 (RI-3)

Replace:

> A Validation Attempt that aborts and is rolled back under the second FR-16 exception shall preserve the pre-operation persisted state.

With:

> A Validation Attempt that aborts and is rolled back under the second FR-16 exception shall preserve the pre-operation externally visible state.

### Part B: Architecture Spine (`ARCHITECTURE-SPINE.md`)

AD-3, AD-18, AD-19, and AD-20 rule text is amended as listed. Identifiers, `Binds`, `Prevents`, and adopted status do not change.

#### B-1. AD-3 registry: one startup-only code (RI-2)

Insert after the table row that begins "| System Failure | `POLICY_SCHEMA_VERSION_UNSUPPORTED` |":

> | System Failure | `POLICY_CONFIGURATION_MALFORMED` | none | startup diagnostics only | The configuration file is unreadable, malformed, or too large, has duplicate or unidentifiable keys at the root or `collections` level, or has any other defect that prevents establishing the v1 envelope; startup-fatal and never returned in a result. |

#### B-2. AD-19 startup diagnostic (RI-2)

Replace:

> and per sentinel its `collectionId`, `POLICY_CONFIGURATION_INVALID`, the JSON-Pointer path of the first defect, and its `invalidFingerprint`.

With:

> and per sentinel its `collectionId`, `POLICY_CONFIGURATION_INVALID`, the JSON-Pointer path of the first defect, and its `invalidFingerprint`. When an AD-5 startup-fatal defect stops the process, it first logs, as operator-only fields, exactly one stable code and one location. The code is `POLICY_SCHEMA_VERSION_UNSUPPORTED` only when the decoded root is an object whose `schemaVersion` member is present and is not the integer 1, and `POLICY_CONFIGURATION_MALFORMED` for every other startup-fatal defect; decoding defects take precedence over root-schema defects. The position is the zero-based byte offset of the first byte of the token that carries the defect selecting the code (the key for a key defect, otherwise the value or the offending byte), choosing the lowest offset among defects of that code, the offset of the enclosing object's opening brace for an absent required member, or `file` when the file cannot be read or exceeds the size limit. It logs no file content, key text, or value.

#### B-3. AD-20 commit detection (RI-3)

Replace:

> Writer `afterCommit` hooks can fire after a failed COMMIT, which is a recorded residual.

With:

> The enforcement transaction buffers every `afterCommit` callback registered on it or on any child transaction of it, directly or through a child's `parent`, in registration order, so Sequelize's own lists for those transactions stay empty; callbacks registered on a savepoint that is rolled back are dropped. The shell starts the buffered callbacks, each invoked independently, when the attempt establishes its own commit: its `commit()` resolves within its wall-clock timer, or, on the Markdown path, where one request makes one attempt, the probe finds the row this request wrote (the pre-allocated `documentId` for a create, or the mutation Event carrying its `validationCorrelationId` for an update, publication, or unpublication). Before assembling the response, the shell waits for them within the AD-11 post-commit assembly bound. A synchronous throw, a rejection, or expiry of that bound is caught and logged only as a minimized correlated operator diagnostic, and never affects row 6, the response, or the remaining callbacks. Every other end of the attempt discards the buffer: rows 5 and 7, an HTML worker attempt whose `commit()` rejected (its probe cannot tell its own row from another attempt's), and an attempt that reports `committed` through `committedFromSummary` after its own transaction rolled back. Discarded callbacks include the baseline event enqueue, which feeds webhooks, websockets, notifications, and the revision, backlink, search-index, and collaboration-access processors, and the collaboration-server reload. A write that committed but whose attempt cannot establish it therefore lacks those effects, and an open collaboration session may not see it; this is a recorded residual. No false signal is ever emitted.

Replace:

> Row present is row 6, including a failing `afterCommit` hook;

With:

> Row present is row 6, including a failing buffered callback;

#### B-4. AD-18 fixtures (RI-2, RI-3)

Replace:

> startup diagnostics and readiness with and without the expected fingerprint;

With:

> startup diagnostics, including the code and byte position or `file` logged without content for each startup-fatal class and the precedence between decoding and root-schema defects, and readiness with and without the expected fingerprint;

Replace:

> a writer `afterCommit` hook firing after a failed COMMIT

With:

> writer `afterCommit` callbacks buffered, run after `commit()` resolves or after a Markdown-path probe finds the request's own row, isolated from one another when one throws or rejects, dropped for a rolled-back savepoint, and discarded for rows 5 and 7, an HTML worker attempt whose `commit()` rejected, and a `committedFromSummary` conversion

#### B-5. Open PRD residuals paragraph

Replace:

> reports six residuals. RI-4 (the AD-12 residual disclosures) and RI-6 (the AD-7 status recovery) are closed by exceptions that the PRD names in NFR-11 and FR-22 (`amendment-proposal-residuals-ri4-ri6.md`). For RI-1 (FR-19 policy fields and AD-14 read summaries) and RI-2 (FR-12 and NFR-16 and the AD-5 and AD-3 startup-fatal classes), the PRD controls until each is decided. RI-3 (AD-20 `afterCommit` hooks after a failed COMMIT) awaits operator acceptance. Gate 1 stays `not ready` until they are decided.

With:

> reports six residuals. RI-4 (the AD-12 residual disclosures) and RI-6 (the AD-7 status recovery) are closed by exceptions that the PRD names in NFR-11 and FR-22 (`amendment-proposal-residuals-ri4-ri6.md`). RI-1 (FR-19 policy fields), RI-2 (startup-fatal diagnostics), and RI-3 (post-commit callbacks) are closed by `amendment-proposal-residuals-ri1-ri3.md`. No PRD conflict remains open; Gate 1 stays `not ready` until the epics are replanned and the D-9 items are fixed.

#### B-6. Amendment Record row

Append to the Amendment Record table, after the last row:

> | *date of application* | AD-3, AD-18, AD-19, AD-20 | Rule text amended: `POLICY_CONFIGURATION_MALFORMED` startup-only code (AD-3); startup-fatal code and byte-position diagnostic (AD-19); `afterCommit` callbacks buffered until the attempt establishes its own commit (AD-20); matching fixtures (AD-18); Open PRD residuals paragraph records RI-1 to RI-3 closed. Identifiers, `Binds`, `Prevents`, and adopted status unchanged. | Operator decisions on RI-1, RI-2, and RI-3 and their authorization, recorded in the PRD and architecture workspace memlogs, applying `_bmad-output/planning-artifacts/prds/prd-outline-2026-09-20/amendment-proposal-residuals-ri1-ri3.md` |

Replace the italic date cell with the actual application date, and set the spine frontmatter `updated` to that date.

### Explicitly Unchanged

- **Addendum.** Its audit-payload list already says "policy version/fingerprint" without a per-summary obligation.
- **SPEC, README, and AGENTS.** None states the read-summary policy fields, the startup diagnostic, or post-commit signals.
- **`AuditDataV1`, AD-5 (startup-fatal classes), AD-14, and every other AD.** Unchanged.
- **NFR-16.** The text is unchanged and is now satisfied for startup-fatal defects.

## Recorded Residual Accepted by Authorization

- **RI-3a. Post-commit processing for a commit the attempt cannot establish.** This covers AD-20 row 7 and an HTML worker attempt whose `commit()` rejected while its row exists. If such a write actually committed, it lacks the baseline post-commit processing:
  - webhooks, websocket messages, and notifications;
  - revision, backlink, search-index, and collaboration-access processing; and
  - the collaboration-server reload, so an open editing session may not see the change and could overwrite it on its next save; and
  - the refresh of the cached collection document tree, so the sidebar may stay stale until the cache expires.

  The case needs a lost or failed COMMIT response for a write that nonetheless committed. The alternative, running the callbacks, could emit false signals for a write that did not commit.

## Effect

- RI-1, RI-2, and RI-3 close, so no PRD and spine conflict remains open. RI-5, the stale lower-authority README and AGENTS lines, remains open.
- Gate 1 stays `not ready` until the epics replan and the D-9 items are complete.
- Epics replan:
  - Story 1.8: the read policy-field rule.
  - Stories 1.2 and 3.1: the startup-fatal diagnostic.
  - Stories 2.3 and 3.2: post-commit callback buffering.
  - Story 3.4: no open residual blocker.

## Application Plan (Only After Separate Authorization)

1. Copy each target to the session scratchpad. Check that every quoted text occurs exactly once, and stop on any drift.
2. Apply Parts A and B exactly, fill the B-6 date, and set the `updated` frontmatter in `prd.md` and the spine.
3. Record the application through `_bmad/scripts/memlog.py` in the PRD and architecture workspace memlogs.
4. Verify by script:
   - every With text and insertion occurs exactly once;
   - reversing the delta reproduces the copies byte for byte; and
   - `CLAUDE.md` is untouched.
5. Mark this proposal `applied`. Do not implement, publish, deploy, configure, or roll out anything. Commit only when asked.

## Suggested Authorization Wording

> I authorize applying the exact delta from `amendment-proposal-residuals-ri1-ri3.md` to `prd.md` and `ARCHITECTURE-SPINE.md`, including the AD-3, AD-18, AD-19, and AD-20 rule-text amendments, the Open PRD residuals paragraph, and one Amendment Record row, and I accept the recorded residual RI-3a. I do not authorize implementation, image publication, deployment, configuration, or rollout.
