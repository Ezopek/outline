---
title: "Proposed Contract Amendment: Readability-Gated Finding Detail"
status: proposed
created: 2026-10-03
updated: 2026-10-03
source_prd: prd.md
source_architecture: ../../architecture/architecture-outline-2026-09-21/ARCHITECTURE-SPINE.md
source_retrospective: ../../../implementation-artifacts/epic-1-retro-2026-10-03.md
resolves:
  - DW-2
  - DW-3
  - DW-8
  - epic-1-retro-item-1
---

# Proposed Contract Amendment: Readability-Gated Finding Detail

## Status and Authority

This document is a proposal. It changes no approved source. Applying it requires a separate, explicit operator authorization that names it. The authority order is unchanged: PRD, then addendum, then `ARCHITECTURE-SPINE.md`, then `SPEC.md`, then repository contracts.

The operator chose option A on 2026-10-03, during the Epic 1 retrospective, and answered the three framing questions as follows:

1. An actor who can read the collection may see the name of the missing section, metadata field, or global index.
2. A global index is identified only when the actor can read it.
3. The first step names items only. Allowed metadata values are not part of this amendment.

## Problem

`Finding` is fixed to `{ code, severity, message, location }` (AD-12), and the registry messages are generic for non-disclosure (NFR-11). Three codes therefore produce Findings that are byte-identical when more than one item is missing, so an agent cannot tell which item to add:

| Code | Registry message | What the agent cannot tell |
| --- | --- | --- |
| `REQUIRED_SECTION_MISSING` | "A required section is missing." | which configured heading |
| `REQUIRED_METADATA_FIELD_MISSING` | "A required metadata field is missing." | which configured field |
| `GLOBAL_INDEX_LINK_MISSING` | "The document does not link to a required global index." | which configured index; its ID lives only in server-side configuration |

Story 1.10's repair loop reached a Clean Result only because the test agent was given the collection's conventions out of band (`spec-1-10-*.md`, Design Notes "Repair knowledge"). Epic 2 write rejections carry the same Finding shape, so the gap carries into enforcement.

## Proposed Normative Delta

Exactly three codes gain an optional `detail`. Nothing else about Findings changes.

### 1. Shape

`Finding` becomes `{ code, severity, message, location, detail? }`. `detail` is present only on the three codes below, and only when the disclosure condition holds:

| Code | `detail` |
| --- | --- |
| `REQUIRED_SECTION_MISSING` | `{ kind: "section", heading, headingLevel }`, the configured heading text and level that is missing |
| `REQUIRED_METADATA_FIELD_MISSING` | `{ kind: "metadata_field", field }`, the configured field name that is missing |
| `GLOBAL_INDEX_LINK_MISSING` | `{ kind: "global_index", documentId, urlId }`, the index document the surface does not link to |

`detail` carries names and identifiers only. It never carries a rule parameter other than the missing item, a regular expression, another rule's configuration, a fingerprint, or document content.

### 2. Disclosure condition

`detail` is present exactly when the actor can read the collection whose policy produced the Finding (`can(actor, "read", collection)`). It is omitted, and the Finding keeps today's generic shape, when:

- the actor can read the document but not its collection (the document-only reader);
- collection readability was not established (`unestablished` fails closed, as in AD-10 and AD-11);
- the Finding belongs to a write whose `readable` flag is false (AD-8).

The `global_index` detail adds no new exposure. A `GLOBAL_INDEX_LINK_MISSING` Finding exists only for an index the actor can read, because an unprovable pair is `VALIDATION_RUNTIME_FAILED` (AD-12), and the index identity the detail names is the same readable document the snapshot already carries.

### 3. Determinism and order

- Ordering (AD-4) is unchanged. `detail` is not a sort key, and Findings of one code at one location remain ordered by the rule-local ordinal, which follows policy order.
- Byte-equivalence holds under the existing wording, "identical policy, actor authorization, request, and state". The disclosure condition is part of actor authorization, in the same way that `collectionId` presence in locations already depends on it.

### 4. Surfaces

- `lint_document`, `lint_wiki`, and the `validation.errors[]` and `validation.warnings[]` of enforced writes share one Finding type, so one rule serves all three. Enforced writes use the `readable` flag AD-12 already records.
- Audit is unchanged. `AuditDataV1` carries counts by code, never Findings (AD-14).
- Logs and metrics never contain `detail` (NFR-11).
- Registry messages stay fixed and generic. No configured value is interpolated into `message`.

### 5. Accepted residual

A document-only reader still receives indistinguishable Findings. This is intended: that actor is not entitled to the collection's conventions, and NFR-11's one accepted exception is not widened.

## Anchored edits

Each "Replace" text occurs exactly once in its target. These edits are for the operator to apply.

**`ARCHITECTURE-SPINE.md`, AD-12.** Replace

> `Finding` is exactly `{ code, severity: "error" | "warning", message, location }`;

with

> `Finding` is exactly `{ code, severity: "error" | "warning", message, location }`, plus an optional `detail` that only `REQUIRED_SECTION_MISSING`, `REQUIRED_METADATA_FIELD_MISSING`, and `GLOBAL_INDEX_LINK_MISSING` may carry, as `{ kind: "section", heading, headingLevel }`, `{ kind: "metadata_field", field }`, or `{ kind: "global_index", documentId, urlId }`, present exactly when the actor can read the collection of the producing policy (the `readable` flag for enforced writes) and omitted otherwise, never part of the AD-4 sort key;

**`epics.md`, Story 1.1 AC (line 235).** Replace

> `Finding` is exactly `{ code, severity, message, location }`,

with

> `Finding` is exactly `{ code, severity, message, location }` plus the optional readability-gated `detail` defined by AD-12,

**`prd.md`, NFR-11, and the copy at `epics.md:74`.** In `prd.md`, append after the exception sentence ending "that its own document produces."; in `epics.md:74`, append after the text ending "never its identity, fingerprint, or policy content." (the shortened copy). The appended text is the same in both:

> A second, narrower exception is accepted. A Finding for a missing required section, a missing required metadata field, or a missing required global-index link may name the missing item to an actor who can read the collection, and only to that actor. The name is limited to the configured heading, field name, or the readable index document, and never extends to other policy content, fingerprints, or collection identity beyond what the actor may already read.

This is a clarification that the conservative reading of NFR-11 requires, because a configured heading is policy content. The operator should judge whether it is also required under the looser reading ("policy content beyond the Findings ... its own document produces"); the recommendation is to add it either way.

## Follow-on work (not part of this amendment)

- **Where the code change lives.** Recommended: the first story of Epic 2, since write rejections need it and Epic 1 is already accepted. Alternative: reopen Epic 1 with a new story. Operator's call.
- **Core change.** The pure core receives one boolean, `detailVisible`, from the shell. Each rule already holds the missing heading or field from its own configuration. The global-index detail comes from the snapshot's readable `indexes` (`documentId`, `urlId`).
- **Acceptance.** Re-run the Story 1.10 golden loop without supplying conventions: the agent may use only the Findings it receives, and the scope must reach a Clean Result. Add the inverse fixture, where a document-only reader receives no `detail` for the same Findings.
- **Close** DW-2, DW-3 and DW-8 in `deferred-work.md` when the acceptance passes, and mark action item 1 done.
- **Deferred.** Allowed metadata values (question 3), and the README example (action item 2, DW-7).

## Open points for the operator

1. Apply the NFR-11 clarification, or rely on the looser reading?
2. Place the code change in Epic 2's first story, or reopen Epic 1?
3. Verify that the policy schema already bounds the length of configured headings and field names, so `detail` cannot grow without limit. This proposal assumes it does and has not checked.
