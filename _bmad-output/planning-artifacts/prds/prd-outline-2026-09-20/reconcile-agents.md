# Input Reconciliation — `AGENTS.md`

**Source role:** Repository policy and implementation constraints

**Verdict:** Aligned; both identified editorial repairs are resolved in the PRD

## Confirmed Coverage

The PRD and its addendum preserve the repository constraints for:

- the `v1.10.1^{}` / `4a5a616a21be800257dc11cef4263d0dd0412156` baseline and the prohibition on merging or rebasing linting work onto `upstream/main`;
- deterministic validation without LLM calls or semantic classification;
- the standard `/mcp` endpoint and generic, server-side policy configuration without private Wiki identifiers in reusable code or tool descriptions;
- existing authentication, authorization, transaction, and information-disclosure boundaries;
- one shared lint engine, full projected-document validation for `update_document`, stable issue codes, invariant severity, blocking errors, and non-blocking warnings;
- fail-closed invalid configuration, explicit degraded validation for the narrowly configured runtime fail-open case, and absence of partial content mutations;
- upstream-compatible behavior for unconfigured collections;
- URL sanitization and other baseline-specific implementation constraints delegated to the PRD addendum and later architecture;
- separate approval gates for implementation, image publication, deployment, and rollout;
- deliberate exclusion of the post-`v1.10.1` patch-edit fix from the first linting change.

## Repairs Required

1. FR-4 currently says that `lint_document` has no externally visible side effect, while FR-19 requires a minimized, durable audit summary. The requirement must distinguish prohibited Wiki-state mutations from the explicitly allowed audit event.
2. SM-I1 refers to FR-1 through FR-22 even though FR-23 is now part of the approved requirements. The range must end at FR-23.

## Intentionally Not Duplicated

The prescribed Yarn version, targeted-test preference, verification commands, and test colocation are repository execution instructions rather than product behavior. They remain authoritative through `AGENTS.md`; NFR-26 and the PRD addendum retain the baseline-conformance constraint without copying the operational checklist into the PRD.

## Conflicts

No product-policy conflict was found.

## Resolution

- FR-4 acceptance now excludes Wiki-state mutations while explicitly permitting the minimized FR-19 audit summary.
- SM-I1 now covers FR-1 through FR-23.
