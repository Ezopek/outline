# Epic 1 Context: Deterministic and Auditable Read-Only Wiki Validation

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Add two read-only MCP tools on the existing `/mcp` endpoint: `lint_document` for one readable document, and `lint_wiki` for one collection or, by default, every readable configured collection. They report mechanically verifiable defects in structure, internal links, hierarchy, and global-index coverage. A closed result algebra separates clean, not-evaluated, incomplete, and failed outcomes, so an agent can lint, repair, and re-lint in a bounded loop. Invalid policy goes to the operator for correction, never reported as clean. Operators get minimized durable audit evidence. Epic 2 enforcement reuses this shared engine and starts only after Epic 1 is accepted.

## Stories

- Story 1.1: Establish the Deterministic Result Contract and Closed Rule Registry
- Story 1.2: Load and Identify Collection Policy Safely at Startup
- Story 1.3: Lint One Authorized Document for Structural Integrity
- Story 1.4: Validate Internal Links Without Disclosing Protected Targets
- Story 1.5: Materialize an Authorized Wiki Scope from One Coherent Snapshot
- Story 1.6: Detect Authorized Hierarchy and Global-Index Defects
- Story 1.7: Preserve Safe Work Under Timeouts, Limits, and Isolated Failures
- Story 1.8: Record Minimized and Failure-Isolated Read-Only Audit Evidence
- Story 1.9: Sanitize User-Controlled Editor URLs
- Story 1.10: Accept the Complete Read-Only Lint and Repair Loop

## Requirements & Constraints

- **Baseline:** use only `v1.10.1^{}` at `4a5a616a21be800257dc11cef4263d0dd0412156`. Never merge or rebase onto `upstream/main`; later fixes come in only as separately approved, tested backports. The post-`v1.10.1` patch-edit fix stays out.
- **Determinism:** program logic only. No LLM, semantic judgment, fuzzy or anchor inference, or secret scanning. Identical policy, authorization, request, and state give byte-equivalent output, excluding request-correlation metadata. Titles, locale, database order, timing, and client never change the output.
- **Stable codes:** a closed, code-owned registry gives each code one fixed severity. Configuration selects registered rule kinds and closed parameters only. Supplying code, a regex, a custom code, or a severity override invalidates that entry. A change in meaning needs a new code.
- **Result algebra:**
  - `state` is `complete`, `incomplete`, `failed`, or `not_evaluated`, alongside `complete`, `clean`, the ordered `errors`, `warnings`, and `systemFailures` arrays (always present), `scope`, and `policies`.
  - `clean` means complete with zero Errors. Warnings never affect it, and any System Failure rules it out.
  - A `failed` result may still carry Findings.
  - `isError` is only for invalid input, a denied or missing target (the two indistinguishable), and unmodellable failures (fixed message `The operation could not be completed`). JSON-RPC errors are never raised.
- **Applicability:**
  - A `null` or unconfigured collection returns `not_evaluated` with `POLICY_NOT_CONFIGURED`.
  - A readable invalid-policy collection returns `POLICY_CONFIGURATION_INVALID`, which goes to the operator, not the agent.
  - Unconfigured writes keep baseline behavior.
- **Disclosure:** keep baseline authentication, authorization, transaction, and disclosure boundaries.
  - Missing, deleted, and inaccessible targets or parents all become one `unresolved` state.
  - Collection and policy identity appear only under `can(actor, "read", collection)`. The only accepted leak is the policy class a document-only reader can see.
  - Logs, audit, and descriptions never contain content, locations, raw configuration or requests, or protected target data.
- **Generic artifacts:** workspace schemas, surface and global-index IDs, and policy values live only in server-side configuration. Code, schemas, tool descriptions, and fixtures stay free of pilot identifiers. OD-2, OD-6, and OD-7 stay undecided.
- **Read-only:** linting mutates nothing and grants no repair authority. The audit summary is its only durable effect.
- **Performance targets** (measured in Epic 3):
  - `lint_document`: p95 ≤ 1 s.
  - `lint_wiki`: p95 ≤ 10 s for the 150-document profile (NFR-3); the 1,000-document profile must complete within 60 s (NFR-4).

## Technical Decisions

- **Layout:**
  - Use a pure core with an imperative shell: `server/wikiLint/{core,application,adapters}`, with tools in `server/tools/wikiLint.ts`.
  - The core imports no models, policies, config singletons, Events, loggers, clocks, network, or storage; a forbidden-import test enforces this.
  - Keep tests collocated, add no framework, and follow the baseline TypeScript configuration (not full strict).
- **Positions:**
  - One component produces all coordinates over `toMarkdown(doc, { includeTitle: false })`: one-based, in code points, LF only, plus a structural `path`.
  - Parsing uses Outline's Markdown rules with `linkify: false`.
  - Sort bytewise by collection, document, line, column, path, location kind, code, and ordinal.
- **Links:** every surface, including Epic 2, uses one shared extraction function with fixture-fixed forms. The shell supplies the instance origin.
- **Policy configuration:**
  - Optional `WIKI_LINT_CONFIG_PATH`: a schema-v1 JSON file of at most 64 KiB, read by a custom duplicate-aware byte decoder.
  - The master reads it once and passes the exact bytes to its workers.
  - Root defects stop startup; the log shows a code and byte offset, no content.
  - A bad entry becomes a fail-closed sentinel for its collection only.
  - Fingerprints are sha256 over canonical forms. No hot reload or mutation API.
- **Snapshot:**
  - Read the primary database in one `REPEATABLE READ` transaction with explicit `SET TRANSACTION READ ONLY` (not Sequelize `readOnly`), and commit it before evaluation.
  - Before each batch, set `SET LOCAL` timeouts from the monotonic remainder. A remainder below the floor gives `VALIDATION_TIMEOUT`.
  - Never read `Document.text`.
  - Read `documentStructure` only when the actor has `readDocument` on the collection. Otherwise its graph checks return a generic `VALIDATION_RUNTIME_FAILED`.
- **Bounds:**
  - `lint_wiki` gets a 60 s deadline, with the `/mcp` socket timeout raised to at least 65 s; `lint_document` gets 9 s.
  - Units run in a fixed order with a deadline check before each. Finished units are kept, and each (unit, code) pair produces at most one System Failure.
  - `lint_wiki` resource limits and single per-process admission are code-owned; the stop margin and floor are provisional constants.
- **Audit:**
  - Write one idempotent Event per lint result, `wikiLint.document` or `wikiLint.wiki`, with the closed minimized `AuditDataV1` payload.
  - Write it after completion in an independent transaction bounded at 3 s. Its failure never changes the response.
  - Retrieval is admin-only through `auditWikiLint`.
- **Tools:**
  - `lint_document { id }` and `lint_wiki { collectionId? }`, annotated `{ readOnlyHint: true, idempotentHint: true }`.
  - Registration is gated by token scope, and discovery stays off until Story 1.10.
- **Rendering:** `toDOM` passes every user-controlled `href` and `src` through `sanitizeUrl()`.

## Cross-Story Dependencies

- Story 1.1 supplies the contracts, registry, ordering, and positions every story uses. The Story 1.2 policy set feeds Stories 1.3, 1.5, and 1.7.
- The Story 1.4 link function serves Story 1.3, the Story 1.6 global-index check, and Epic 2. The Story 1.5 snapshot feeds Stories 1.6 and 1.7.
- Story 1.8 audit must exist before Story 1.10 exposes the tools. Story 1.10 is the epic gate and comes before Epic 2.
- Story 3.3 fixes the floor and stop margin from benchmarks, and Story 3.1 adds fingerprint readiness gating. Gates 2–4 are not authorized here.
