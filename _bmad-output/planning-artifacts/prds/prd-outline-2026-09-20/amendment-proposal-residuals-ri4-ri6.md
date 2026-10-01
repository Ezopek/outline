---
title: "Proposed Contract Amendment: Accepted Residuals RI-4 and RI-6"
status: applied
created: 2026-09-30
updated: 2026-09-30
source_prd: prd.md
source_addendum: addendum.md
source_architecture: ../../architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md
resolves:
  - RI-4
  - RI-6
---

# Proposed Contract Amendment: Accepted Residuals RI-4 and RI-6

## Status and Authority

This document is a proposal. It changes no approved source. Applying it requires a separate, explicit operator authorization that names it. The authority order is unchanged: PRD, then addendum, then `ARCHITECTURE-SPINE.md`, then `SPEC.md`, then repository contracts.

The operator decided both residuals on 2026-09-30 (PRD and architecture workspace memlogs). The residuals were reported in the applied `amendment-proposal-prd-spine-alignment.md`:

- **RI-4, accept.** An actor who may read or write a document but cannot read its collection may learn that collection's policy class. It never learns the collection's identity, fingerprint, or policy content beyond the Findings and System Failures its own document produces. NFR-11 names this as an exception, and SM-I4 and SM-P5 follow it.
- **RI-6, accept.** A lost HTML import-job result combined with a missing audit summary makes the response report an unestablished outcome. FR-22 names this as its one exception, and NFR-27, SM-C7, SM-I6, the Section 4.6 criterion, SPEC, and the addendum reference it.

Neither decision changes AD rule text. The spine already records both behaviors: AD-12 lists the residual disclosures, and AD-7 and AD-20 row 7 define the recovery failure. This delta states them as accepted in the PRD, removes them from the spine's Open PRD residuals paragraph, and aligns the SPEC clauses that each would otherwise contradict. It introduces no OD-2, OD-6, or OD-7 value and authorizes no implementation, publication, deployment, configuration, or rollout.

## Proposed Normative Delta

This delta is exhaustive. Every quoted "Replace" text and insertion anchor occurs exactly once in its target.

### Part A: PRD (`prd.md`)

#### A-1. NFR-11 (RI-4)

Replace:

> Durable audit summaries are operator evidence, not actor-facing output: FR-21 governs the identifiers they carry, and only the authorized audit surface returns them.

With:

> Durable audit summaries are operator evidence, not actor-facing output: FR-21 governs the identifiers they carry, and only the authorized audit surface returns them. One exception is accepted. An actor who may read or write a document but cannot read its collection may learn that collection's policy class (no policy, `read_only`, `enforced`, or invalid) from a lint result's state and System Failures, from whether a write returns a Validation Status, and from a validation correlation identifier on a mutation event the actor can see. That actor never learns the collection's identity, its policy fingerprint, or policy content beyond the Findings and System Failures that its own document produces.

#### A-2. SM-I4 (RI-4)

Replace:

> distinguishes or obtains protected document, collection, link-target, scope, or audit information.

With:

> distinguishes or obtains protected document, collection, link-target, scope, or audit information, other than the policy class that NFR-11 permits.

#### A-3. SM-P5 (RI-4)

Replace:

> produces zero protected-information disclosures.

With:

> produces zero protected-information disclosures beyond the policy class that NFR-11 permits.

#### A-4. FR-22: add one consequence (RI-6)

Insert after the consequence "Audit persistence failure does not reject, roll back, or downgrade an otherwise permitted configured write.":

> - One narrow exception is accepted. When the committing attempt's result from an asynchronous HTML import job does not reach the requester and that attempt's committed audit summary is also missing, the response reports an unestablished outcome under FR-16 instead of the committed Validation Status. The write itself is unaffected, the response claims neither success nor failure, and the document remains readable through the ordinary tools.

#### A-5. NFR-27 (RI-6)

Replace:

> or add internal audit diagnostics to standard agent-facing responses.

With:

> or add internal audit diagnostics to standard agent-facing responses. FR-22 names the one exception.

#### A-6. SM-C7 (RI-6)

Replace:

> expose internal audit failures to agents performing ordinary Wiki work.

With:

> expose internal audit failures to agents performing ordinary Wiki work; FR-22 names the one exception.

#### A-7. Addendum audit-isolation bullet (`addendum.md`, RI-6)

Replace:

> or appear in the standard MCP response. Emit correlated operator-facing diagnostics instead;

With:

> or appear in the standard MCP response. PRD FR-22 names the one accepted exception: a lost HTML import-job result whose committed audit summary is also missing. Emit correlated operator-facing diagnostics instead;

#### A-8. Section 4.6 audit-failure criterion and SM-I6 (RI-6)

Replace:

> expose no audit state in the standard MCP response, and produce a correlated operator-facing diagnostic.

With:

> expose no audit state in the standard MCP response, and produce a correlated operator-facing diagnostic; FR-22 names the one exception.

Replace:

> injected audit failures leave functional outcomes unchanged and produce correlated operator diagnostics only.

With:

> injected audit failures leave functional outcomes unchanged and produce correlated operator diagnostics only; FR-22 names the one exception.

### Part B: Architecture Spine (`ARCHITECTURE-SPINE.md`)

No AD rule text, identifier, `Binds`, `Prevents`, or adopted status changes.

#### B-1. Open PRD residuals paragraph

Replace:

> reports these residuals as unresolved. For RI-1 (FR-19 policy fields and AD-14 read summaries) and RI-2 (FR-12 and NFR-16 and the AD-5 and AD-3 startup-fatal classes), the PRD controls until each is decided. For RI-4 (NFR-11, SM-I4, and SM-P5 and the AD-12 residual disclosures) and RI-6 (FR-22 and the AD-7 status recovery), the amended PRD states the spine behavior pending an operator decision.

With:

> reports six residuals. RI-4 (the AD-12 residual disclosures) and RI-6 (the AD-7 status recovery) are closed by exceptions that the PRD names in NFR-11 and FR-22 (`amendment-proposal-residuals-ri4-ri6.md`). For RI-1 (FR-19 policy fields and AD-14 read summaries) and RI-2 (FR-12 and NFR-16 and the AD-5 and AD-3 startup-fatal classes), the PRD controls until each is decided.

#### B-2. Amendment Record row

Append to the Amendment Record table, after the last row:

> | *date of application* | AD-7, AD-12 | Open PRD residuals paragraph updated: RI-4 and RI-6 closed by exceptions named in PRD NFR-11 and FR-22 and referenced in SM-I4, SM-P5, NFR-27, SM-C7, SM-I6, the Section 4.6 criterion, the addendum, and SPEC; no rule text, identifier, `Binds`, `Prevents`, or adopted status changed. | Operator decisions on RI-4 and RI-6 and their authorization, recorded in the PRD and architecture workspace memlogs, applying `_bmad-output/planning-artifacts/prds/prd-outline-2026-09-20/amendment-proposal-residuals-ri4-ri6.md` |

Replace the italic date cell with the actual application date.

### Part C: `SPEC.md`

#### C-1. Disclosure constraint (RI-4)

Replace:

> Findings and observability must not reveal inaccessible resources, and rejected writes

With:

> Findings and observability must not reveal inaccessible resources beyond the policy class that PRD NFR-11 permits, and rejected writes

#### C-2. Audit-isolation constraint (RI-6)

Replace:

> Audit failure never changes lint or write outcomes or appears in standard MCP responses.

With:

> Audit failure never changes lint or write outcomes or appears in standard MCP responses; PRD FR-22 names the one exception.

#### C-3. CAP-6 success (RI-6)

Replace:

> while producing only correlated operator diagnostics.

With:

> while producing only correlated operator diagnostics; PRD FR-22 names the one exception.

### Explicitly Unchanged

The following stay as they are:

- all other PRD, addendum, spine, and SPEC text;
- `server/tools/README.md` and `AGENTS.md`, because neither states the disclosure or audit-isolation rule these exceptions qualify; and
- frontmatter `updated` values in `prd.md`, `addendum.md`, and the spine, which are already 2026-09-30 (`SPEC.md` has none).

## Effect

- **RI-4 and RI-6 close.** RI-1, RI-2, RI-3, and RI-5 stay open.
- **Gate 1 stays `not ready`.** It waits on RI-1 to RI-3, the epics replan, and D-9.
- **Epics.** The Story 3.4 blocker list in the replan drops RI-4 and RI-6. The Story 2.5 and 2.7 audit rows and the AD-18 disclosure fixtures cite these exceptions.

## Application Plan (Only After Separate Authorization)

1. Check that every quoted text still occurs exactly once in its target, stop on drift, and record the SHA-256 of each target.
2. Apply Parts A, B, and C exactly, and fill the B-2 date.
3. Record the application through `_bmad/scripts/memlog.py` in the PRD, architecture, and SPEC workspace memlogs.
4. Verify the result by script:
   - every With text occurs once;
   - the reverse reconstruction matches the pre-apply hashes; and
   - `CLAUDE.md` is untouched.
5. Mark this proposal `applied`. Do not implement, publish, deploy, configure, or roll out anything, and commit only when asked.

## Suggested Authorization Wording

> I authorize applying the exact delta from `amendment-proposal-residuals-ri4-ri6.md` to `prd.md`, `addendum.md`, `ARCHITECTURE-SPINE.md` (Open PRD residuals paragraph and one Amendment Record row, with no rule-text change), and `SPEC.md`. I do not authorize implementation, image publication, deployment, configuration, or rollout.
