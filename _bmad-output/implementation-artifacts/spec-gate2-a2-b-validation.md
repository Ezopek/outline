# A2+B criteria validation

## Pre-development criteria check

Validated before development on 2026-10-28 against the accepted SPEC, PRD,
Architecture Spine, epics, A1 spec and Gate 2 handoff.

| Check | Result |
| --- | --- |
| Concrete base and protected A1 preimage | Exact base and preservation requirement stated |
| Human intent and scope | MCP-only lint enforcement preserved; browser checks are compatibility |
| Testable criteria | Seven numbered criteria map to explicit positive/negative tests and gates |
| Minimal implementation | Exact dependency pins and one scoped mailparser edge; no production rewrite |
| Resource isolation | Bounded child processes, synthetic inputs, loopback-only transport, offline mail |
| TDD sequence | One coherent executed RED/GREEN slice before the next |
| Review authority | Author self-review distinct from controller independent review and acceptance |
| Release gates | No publication/deployment/policy authority; seven-day/ten-batch/two-client pilot retained |
| Privacy | Generic fixtures and attribution; no private environment identifiers in deliverables |
| Native installed-method gate | BLOCKED/UNVERIFIED: UNSUPPORTED_CONTRACT; no installed native BMAD contract |

Criteria are sufficiently bounded to begin authorized local development. This is
an author criteria check, not independent approval or native-method validation.
Execution evidence had not yet been recorded at that checkpoint. The following
post-development evidence is a separate closeout record.

## Post-development execution and closeout (2026-10-28)

Status: **READY_FOR_INDEPENDENT_SOURCE_REVIEW**. This section was appended after
implementation and controller qualification; it does not retroactively make that
evidence part of the pre-development criteria check. Original intent and criteria
remain binding. Criterion 5's locator wording clarifies the effective dependency
graph: no installed or locked Nodemailer 9.0.5 locator remains, while mailparser's
upstream declaration remains metadata overridden by the exact parent-scoped
resolution. Both root and nested actual resolver assertions passed.

| Criterion | Executed evidence |
| --- | --- |
| 1: Parser resources | Author valid RED before pins, then 10 parser/converter/projection tests passed, including bounded child probes and normal controls |
| 2: Canonical MCP compatibility | Actual create/all four update projections, metadata and link round trips passed; controller targeted server/MCP and fresh-database Wiki lint suites passed |
| 3: Clipboard compatibility | Author RED/GREEN: 14 shared clipboard executions and three actual title paste tests passed; controller shared editor and title suites passed with shipped validators unchanged |
| 4: Transport | Author protocol-mismatch RED, then eight loopback handshake/upgrade/reconnect tests passed; controller targeted rerun passed |
| 5: Mail | Separate author version/recipient RED, then eight offline MIME/composition/resolver tests passed; controller targeted rerun passed |
| 6: Source qualification | Early author typecheck and final author checks passed; controller full typecheck, formatting, type-aware lint and actual offline `yarn install --immutable --immutable-cache` passed |
| 7: Preservation and review | Author sequential adversarial self-review completed; controller qualification retained all 23 candidate hashes; this closeout preserves the other 20 candidate hashes and all 13 protected A1 hashes; separate independent source review and controller acceptance remain pending |

The independent controller qualification completed 16 commands with exit status
zero: audit controls passed two tests; affected server/MCP targeted suites passed
387; fresh-database `yarn test:wikilint` passed 2,333 with one retained baseline
skip; shared editor projects passed 1,201 with nine retained Node-only DOM skips
(all nine run and pass in jsdom); title passed three. Scopes overlap and must not
be summed as unique tests. No required regression was skipped.

The prior install-state transport failures remain historical failures. Only the
controller's generated install-state location was corrected, preserving read-only
source, offline networking, immutable lock/cache flags and product configuration.
All 531 checked linked dependency source files, including patched libraries, were
identical before and after the successful immutable install. The complete lock
comparison found 2,085 unchanged stanzas out of 2,093; only the eight admitted
logical stanzas and six approved effective package versions changed.

Detailed behaviors, generic commands, counts and limitations are in the
[backport record](../../docs/wikilint-gate-2/a2-b-security-backports.md).
Native BMAD remains **BLOCKED/UNVERIFIED / UNSUPPORTED_CONTRACT**; source
qualification does not install, repair or waive it. Independent source review and
controller acceptance are not yet granted. Image/build provenance, advisory
rematching and Gate 1 evidence-impact assessment remain open; publication,
deployment and policy activation require separate approvals. The pilot still
requires at least seven days, ten logical batches and two clients; none is claimed.
