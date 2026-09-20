# Input Reconciliation — Approved Product Brief Addendum

**Source role:** Technical input for the PRD and later architecture

**Verdict:** Fully aligned after the shared acceptance-evidence repair

## Confirmed Coverage

The PRD and PRD addendum preserve the source's:

- delivery sequence and requirement that read-only linting plus write enforcement both pass before initial implementation is complete;
- fixed baseline, excluded patch-edit fix, standard endpoint, deterministic implementation, security boundaries, and separate delivery gates;
- shared engine and complete projected-state enforcement for all four supported update modes;
- exact initial deterministic rule families and deferred anchor validation;
- generic server-side configuration, fail-closed invalid configuration, narrowly scoped runtime fail-open, and unconfigured compatibility;
- template semantics, visible metadata preference, and Markdown/ProseMirror round-trip constraint;
- access-aware results, stable codes, URL sanitization, and bounded remediation-loop behavior;
- required verification categories and parked future quality/statistics direction.

## Repair Required

The round-trip constraint is present in the PRD addendum but must also appear as explicit acceptance evidence for the document-structure capability. This is the same repair identified in `reconcile-server-tools-readme.md`, not an additional product decision.

## Intentionally Deferred

The exact configuration representation, projection mechanics, consistency mechanism, audit schema, and telemetry implementation remain architecture decisions, as required by the source.

## Conflicts

None.

## Resolution

The document-structure capability now requires canonical visible-metadata fixtures to survive the selected baseline's actual Markdown/ProseMirror round trip.
