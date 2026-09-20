# Input Reconciliation — Approved Product Brief

**Source role:** Primary authority for product decisions

**Verdict:** Fully aligned after one success-metric repair

## Confirmed Coverage

The PRD preserves the brief's product intent and decisions for:

- the agent-facing problem, primary and secondary users, and deterministic lint–repair–re-lint value proposition;
- read-only drift detection as the first priority and write prevention as the second priority within one initial implementation;
- the four rule families, collection-scoped policy, standard `/mcp` endpoint, and environment-independent reusable fork;
- stable codes, deterministic ordering, precise safe locations, blocking Errors, visible non-blocking Warnings, and explicit clean-state semantics;
- complete projected-document validation, atomic rejection, authorization, non-disclosure, and unconfigured-collection compatibility;
- fixed baseline, no merge or rebase onto `upstream/main`, and four distinct approval boundaries;
- all declared non-goals, including semantic judgments, inferred batches, broader write enforcement, and Wiki quality statistics;
- separately measured implementation-readiness, pilot-success, and counter-metrics.

## Repair Required

The pilot section requires two supported MCP clients and prohibits client-specific behavior, but it does not yet state the brief's positive acceptance condition that both clients return equivalent normalized machine-readable results. Add this explicitly to SM-P1 or a dedicated pilot metric.

## Conflicts

None. The PRD adds approved detail without reopening or weakening a brief decision.

## Resolution

SM-P1 now requires equivalent normalized machine-readable results from at least two supported MCP clients under equivalent inputs and state.
