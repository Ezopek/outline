# Reconciliation Review: PRD and Addendum Against the Architecture Spine (2026-09-30 decisions C-3 to C-7)

**Reviewer:** independent, fresh context, read-only on the project.
**Inputs read:** `ARCHITECTURE-SPINE.md` (updated 2026-09-30), spine `.memlog.md`, `prd.md` (updated 2026-09-30), `addendum.md`, `reconcile-applied-enforced-write-applicability.md`, and the "Residual Contradictions" section of `amendment-proposal-enforced-write-applicability.md`.
**Authority order applied:** PRD controls product scope and acceptance; the addendum controls its technical inputs; the spine controls implementation consistency. Every conflict below is surfaced, none is resolved. Wording changes are suggestions for the PRD (or, where marked, for the spine) and nothing was edited.

## Verdict

The spine implements C-3 to C-7 coherently, and C-4 and C-7 conflict with no PRD text. But the "Pending PRD alignment" paragraph is incomplete: 14 PRD or addendum clauses contradict or no longer fit the spine as it stands, and the paragraph names only about 7 of them. It misses the default-scope and acceptance-criterion clauses of C-3, the FR-13 seam behind C-6, and the audit half of C-5. Gate 1 must stay `not ready`. Separately, AD-12, AD-14, AD-18 and AD-20 carry PRD-conflicting rules with no inline marker, which is a governance risk for downstream story builders.

Severity scale: **High** means a PRD acceptance criterion or stated behavior would fail against spine-conformant behavior. **Medium** means a real conflict or seam that needs a decision. **Low** means definitional or cosmetic.

## 1. Contradictions and inconsistencies (14)

R-1 to R-7 stem from C-3, R-8 to R-10 from C-6, R-11 and R-12 from C-5. R-13 and R-14 predate 2026-09-30 and are reported because the task asks for every inconsistency with the spine as it stands.

### C-3 (read-only invalid-policy sentinel)

The PRD glossary defines a Configured Collection as one where "a valid Policy Configuration explicitly enables linting". An Invalid-Policy Collection is therefore outside Configured Collections by definition. The spine (AD-12) reports a readable sentinel as one `POLICY_CONFIGURATION_INVALID` System Failure, state `failed` or `incomplete`, never clean, and reserves `not_evaluated` for a scope holding neither a valid policy nor a sentinel.

**R-1 (High): FR-4, third consequence.**
- PRD: "A document outside a Configured Collection returns the explicit policy-not-configured/not-evaluated outcome."
- Spine: `lint_document` on a document in a readable sentinel collection returns `failed` with the System Failure, and never `not_evaluated`.
- Suggested change: "A document in a collection with no Policy Configuration entry returns the explicit policy-not-configured/not-evaluated outcome. A document in a readable Invalid-Policy Collection returns the FR-12 System Failure and is never reported as not evaluated or clean."

**R-2 (Medium): FR-7, first consequence.** This is an implication, not a direct contradiction.
- PRD: "With a collection identifier, the tool evaluates that Configured Collection only when the actor may access it."
- Together with FR-11's fourth consequence, this implies a scoped request for a non-Configured collection is `not_evaluated`. The spine returns a System Failure for a readable sentinel collection.
- Suggested change: "…evaluates that collection only when the actor may access it, and reports it under FR-12 when it is an Invalid-Policy Collection."

**R-3 (Medium): FR-7, second consequence.** The pending paragraph does not list it.
- PRD: "Without a collection identifier, the tool evaluates all Configured Collections and documents readable by the actor."
- Spine: the default-scope result also includes every readable sentinel, as a zero-count scope entry plus a System Failure. Such a result is `incomplete` or `failed` and can never be `complete: true` or clean.
- Suggested change: "…evaluates all readable Configured Collections and reports each readable Invalid-Policy Collection under FR-12; the result is not clean while such a collection is in scope."

**R-4 (High): Section 4.3 capability acceptance criteria, second bullet.** The pending paragraph does not list it.
- PRD: "Actor fixtures prove default scope is limited to readable Configured Collections and that no inaccessible identity or metadata appears in results."
- Spine: a conformant default-scope run puts a readable sentinel collection's ID and invalid `PolicyIdentity` into `scope` and `policies`, so this fixture cannot pass as written.
- Suggested change: "…limited to readable Configured Collections and readable Invalid-Policy Collections…".

**R-5 (High): FR-11, fourth consequence.**
- PRD: "Read-only requests outside Configured Collections return policy-not-configured/not-evaluated."
- Suggested change: "Read-only requests whose readable scope contains no Policy Configuration entry, valid or invalid, return policy-not-configured/not-evaluated. A readable Invalid-Policy Collection follows FR-12."

**R-6 (High): Section 4.4 capability acceptance criteria, second bullet (read half).**
- PRD: "A read-only request outside configured scope returns not evaluated; a write that is not an Enforced Write matches baseline upstream behavior."
- Suggested change: "A read-only request whose readable scope has no Policy Configuration entry returns not evaluated; a readable Invalid-Policy Collection returns the FR-12 System Failure; a write that is not an Enforced Write matches baseline upstream behavior."

**R-7 (Low): Glossary, "Evaluated Scope".** The pending paragraph does not list it.
- PRD: "The authorized documents and collections actually inspected by a lint operation."
- Spine: the sentinel appears in `EvaluatedScope` with zero counts and empty `completedChecks`, though nothing was inspected.
- Suggested change: append "…, together with any readable Invalid-Policy Collection reported as a System Failure with zero evaluated counts."

### C-6 (post-classification failures and audit boundary)

**R-8 (High): FR-16, first paragraph (single exception).**
- PRD: "Every Enforced Write response shall expose one Validation Status… This requirement has one exception." The exception covers only the collection-change conflict.
- Spine: AD-20 rows 3 and 5 also return a protocol error with baseline content and "no `validation`" for an Enforced Write classified under a valid `enforced` policy. Row 3 covers transformation, conversion, import-size, re-authorization denial, actor-reload failure, and lock or statement timeout. Row 5 covers non-collection-change conflict, model validation, unpublish precondition, unchanged-update check, and persistence error or timeout.
- Those writes are Enforced Writes by the glossary definition, so FR-16 requires a Validation Status that the spine does not give them. No PRD clause requires their rollback either: FR-17 and NFR-9 speak only of `rejected`.
- Row 2 matches the PRD exception and is consistent.
- Suggested change: "This requirement has two exceptions. (1) [existing collection-change text]. (2) An Enforced Write that ends in a baseline protocol failure, before or after the validation decision, without committing fails with that protocol error, has no Validation Status, persists nothing, and is recorded under FR-20 as an aborted attempt. A committed Enforced Write always returns its Validation Status, even when optional response enrichments are omitted." Extend FR-17 and NFR-9 to any Enforced Write that does not commit.

**R-9 (Medium): FR-13 with the FR-16 `rejected` definition and the Section 4.5 runtime-failure criterion.**
- PRD FR-13: "runtime validation failures shall fail closed for configured MCP writes by default."
- PRD FR-16: "`rejected` means the write did not persist because of Errors or a fail-closed System Failure."
- PRD Section 4.5: "Runtime failure tests prove default rejection and explicit per-collection degraded admission."
- Spine, AD-20 row 3: a "row-lock or statement timeout at the AD-8 re-fetch or AD-7 worker" is a protocol error (`aborted_before_decision`), regardless of `runtimeFailureMode`.
- Spine, AD-3: `VALIDATION_RUNTIME_FAILED` is defined as "An unexpected validation or authorized-data operation failed." The AD-8 re-fetch is an authorized-data operation, so under AD-13 it would be a modeled `rejected` or `degraded_validation`. AD-3 and AD-20 disagree about the boundary.
- The seam is in the spine, but it leaves FR-13 untestable exactly where the two overlap.
- Suggested change (PRD): add an FR-13 consequence stating that failures of the write's own transaction machinery (lock or statement timeout, re-authorization denial, actor reload, baseline transformation, model validation, persistence) are not runtime validation failures, are never fail-open, and follow FR-16 exception (2).
- Suggested change (spine, not PRD): narrow the `VALIDATION_RUNTIME_FAILED` definition to exclude AD-8 and AD-7 re-fetch and lock failures.

**R-10 (High): FR-20, first consequence (and the CAP-6 criterion and SM-I6 enumerations).**
- PRD FR-20: "The summary records the Validation Status, the duration, Finding counts by severity and stable code, and whether runtime fail-open was exercised."
- Spine, AD-14 and AD-20: two summaries, `aborted_before_decision` and `aborted_after_decision`, have no Validation Status. The `outcome` enum is wider than the four Validation Status values.
- PRD "validation attempt": FR-20 says "Every Enforced Write validation attempt shall attempt to record one audit summary", but the term is never defined. FR-16's exception says the collection conflict "is not a validation attempt". Only AD-20 defines the attempt, as everything after classification.
- PRD Section 4.6 criterion: "Tests prove one summary is recorded for each clean, warning-bearing, not-evaluated, incomplete, failed, rejected, and degraded scenario." It omits the two aborted scenarios. AD-18 adds a fixture per AD-20 row, so coverage exists, but the PRD list is not exhaustive.
- Suggested change: "The summary records the Validation Status or, for an attempt that ends without one, its abort outcome (before or after the validation decision)…". Add a glossary line: "Validation attempt: an Enforced Write from classification until it commits, is rejected, or aborts; a collection-change conflict or a failure before classification is not a validation attempt." Add "aborted before or after the decision" to the CAP-6 scenario list.

### C-5 (policy identity for actors without collection read)

**R-11 (Medium): Section 4.5, classification-fixture bullet 1.**
- PRD: "It then returns `rejected` with its request-time valid policy identity and one configuration System Failure."
- Spine, AD-12: the identity, and `collectionId` in the System Failure location, are present only when `can(actor, "read", collection)` holds. For an actor without read, the mismatch rejection carries no identity.
- The pending paragraph's "identity wording in Section 4.5" points here, but it should name the bullet.
- Suggested change: "…with its request-time valid policy identity when the actor can read the classified collection, and without any policy or collection identity otherwise, plus one configuration System Failure."

**R-12 (Medium, needs an operator decision): FR-21, second consequence, with NFR-11 and NFR-17.** The pending paragraph does not list it.
- PRD FR-21: "Document or collection identifiers are associated only when allowed by the existing audit authorization model and necessary to identify the actor-authorized scope."
- PRD NFR-11 forbids "collection identity… that the current actor is not authorized to access" in "logs" and "scope summaries".
- Spine, AD-12: "Audit Event data is actor-independent." AD-14: the policy fields are present "whether or not the actor can read that collection". AD-14 says Event columns "follow the existing rule for safe document and collection IDs", and the memlog says C-5 leaves audit data and columns "unchanged".
- So a write into a collection the actor cannot read still records that collection's classified fingerprint, `scopeKind: collection`, and (probably) its ID column. That collection is not "the actor-authorized scope".
- The spine never says whether the Event `collectionId` column is populated in that case. The word "safe" suggests it is omitted, yet the fingerprint is explicitly kept. The treatment is internally uneven.
- Suggested change (PRD): "…necessary to identify the audited scope; summaries are retrievable only through the authorized audit surface and may identify the classified collection of a write even when the writing actor cannot read it."
- The alternative is a spine change: omit the column and policy fields for actors without read.
- Do not resolve silently. The operator must choose.

### Other inconsistencies (predate 2026-09-30)

**R-13 (Medium): FR-12 and the Section 4.4 criterion vs AD-5 startup-fatal classes.**
- PRD FR-12: "Invalid Policy Configuration shall produce a distinct stable System Failure…".
- PRD Section 4.4, first criterion: "each malformed or inconsistent configuration class produces a stable System Failure and blocks affected writes."
- PRD NFR-16: an operator-locatable stable failure code "before or at the first affected operation".
- Spine, AD-5: root unreadability, malformed root JSON, unsupported root schema, and duplicate or unidentifiable root or `collections` keys "block startup". AD-3 says `POLICY_SCHEMA_VERSION_UNSUPPORTED` is "startup-fatal" at the root. The schema version only exists at the root, so that code can never appear in an MCP result.
- No spine element says the stable code and a non-secret location reach operators at startup. AD-19 reports only "config status, activation counts, and a `policySetFingerprint`".
- C-4 sharpens the entry-local versus fatal boundary but leaves this gap.
- Suggested change (PRD): "Invalid Policy Configuration shall produce a distinct stable System Failure or, where no collection entry can be identified, shall block instance startup with a stable failure code and non-secret location visible to operators." Apply the same to the Section 4.4 criterion. Alternatively the spine states the startup diagnostic.

**R-14 (Low): Addendum, audit-payload bullet.**
- Addendum: "Persist only audit-safe aggregate evidence: operation and outcome, completion, duration, authorized scope kind or identifier, policy version/fingerprint, request correlation, evaluated-object counts, and Finding counts by severity and stable code."
- Spine, AuditDataV1: adds `credentialAuthType`, which is not in that list. `runtimeFailOpenExercised` and `authenticatedClientId` are backed by FR-20 and FR-19.
- Per the authority order, the addendum controls.
- Suggested change: add "authentication credential type" to the list, or drop the field from the spine.

## 2. Audit of the spine's "Pending PRD alignment" paragraph

| Paragraph item | Verdict |
| --- | --- |
| FR-4 (third consequence) | Accurate (R-1). |
| FR-7 (first consequence) | Correct clause, but an implication only (R-2). The direct clauses are missing (see below). |
| FR-11 (fourth consequence) | Accurate (R-5). |
| Read-only half of the CAP-4 criterion | Accurate (R-6). |
| FR-16 exception | Imprecise. The existing exception matches AD-8 and AD-20 row 2. The real conflict is that FR-16 permits no exception for AD-20 rows 3 and 5 (R-8). |
| FR-20 summary content | Accurate (R-10), but it should also name the "validation attempt" term and the CAP-6 and SM-I6 scenario lists. |
| "identity wording in Section 4.5" | Accurate, but should cite the classification-fixture bullet, "request-time valid policy identity" (R-11). |

**Missing from the paragraph:**
- R-3: FR-7, second consequence.
- R-4: Section 4.3 criterion, "default scope is limited to readable Configured Collections".
- R-7: Evaluated Scope glossary.
- R-9: the FR-13 / FR-16 `rejected` seam.
- R-12: the audit half of C-5 (FR-21, NFR-11, NFR-17).
- R-13 and R-14, which predate the decisions but are real.
- A statement that C-4 and C-7 need no PRD change. Without it a reader may think they were forgotten.

**Wrongly listed:** none outright.

**Suggested replacement paragraph:**

> The 2026-09-30 decisions are not yet reflected in the higher-authority PRD.
> - C-3 (read-only sentinel): FR-4 third consequence; FR-7 first and second consequences; FR-11 fourth consequence; Section 4.3 criterion 2 (default scope); Section 4.4 criterion 2 (read half); the Evaluated Scope glossary entry.
> - C-6: FR-16 (add a second exception for AD-20 rows 3 and 5); FR-13 (runtime-validation boundary); FR-17 and NFR-9 (rollback of non-committing Enforced Writes); FR-20 first consequence and the "validation attempt" term; the CAP-6 scenario list.
> - C-5: Section 4.5 classification fixture 1; FR-21 second consequence, subject to an operator decision.
> - C-4 and C-7 require no PRD change.
>
> Until a separately authorized PRD amendment closes them, the PRD controls scope and Gate 1 stays `not ready`. AD-12 (sentinel read rule), AD-14 (aborted outcomes) and AD-20 rows 3 and 5 are provisional until then.

## 3. Uncovered requirements and quiet requirements

| ID | Sev | PRD requirement | Gap in the spine |
| --- | --- | --- | --- |
| G-1 | Medium | NFR-11 and SM-I4: no collection identity the actor may not access. | C-5 was applied to write validation only. In AD-12 read-only results, `EvaluatedScope.collectionId` and `PolicyIdentity` (collection ID plus fingerprint) for `lint_document` are not made conditional on collection read. For an actor holding only a document membership, the oracle C-5 closed on writes remains on the read side. AD-4 and AD-12 say "authorized" for collection IDs without defining it as `can(actor, "read", collection)`. AD-18's C-5 tests cover only writes. |
| G-2 | Medium | NFR-16: "enough non-secret context for an operator to locate the configuration scope". | AD-6 says an invalid entry "exposes only that hash, stable code, and schema path", but nothing carries the schema path. `SystemFailure.location` is `scope { scopeKind, collectionId? }`, AuditDataV1 excludes it, and AD-19 startup reports counts and status only. The startup-fatal classes have no channel either (R-13). |
| G-3 | Medium | FR-19: the summary records "policy version or fingerprint". | AD-14 defines policy fields only for `wikiLint.write_validation`. The rule is silent for `lint_document`, for default-scope `lint_wiki` (many policies), for `not_evaluated`, and for the new read-only sentinel results (C-3), where AuditDataV1 has no invalid-identity field. |
| G-4 | Medium | FR-18, third consequence, and the Section 4.5 criterion: `move_document` and `restore_document` compatibility fixtures across enforced, unconfigured, `read_only` and invalid-policy scopes. | The spine never mentions move or restore. AD-8 "Enforcement remains MCP-only" is ambiguous, because those tools are also built-in MCP tools. AD-18's test list has no such fixtures. |
| G-5 | Governance, Medium | PRD controls scope. The spine must surface conflicts, not silently resolve them. | AD-12 (C-3 sentence), AD-14 (aborted outcomes), AD-18 (sentinel matrix, one fixture per AD-20 row) and AD-20 present PRD-conflicting rules as `[ADOPTED]` with no inline marker. AD-20 lists FR-16 and FR-20 in `Binds` while overriding them. Only the last paragraph flags the conflict. A story builder or test author who reads AD-20 or AD-18 alone would write tests that fail the PRD-derived CAP-4 and FR-16 criteria. Suggestion: add "PRD-pending" markers in those ADs. |
| G-6 | Medium, product effect | UJ-1 and SM-P2: a lint–repair–re-lint loop ends in a complete, zero-error result. AD-5 "Prevents… a malformed entry disabling unrelated collections". | With C-3, a readable sentinel in any collection makes every default-scope `lint_wiki` `incomplete` or `failed`. The agent cannot repair it, since configuration is operator-owned. Collection-scoped lint stays usable, so the loop can end there, but the default-scope loop cannot. This is arguably intended, but it is in tension with AD-5's Prevents line. The PRD should say a configuration System Failure is an operator escalation, not an agent-repairable finding, so it does not count against the loop bound. |
| G-7 | Low | FR-1 and FR-11: "policy-not-configured" is an explicit not-evaluated outcome. | AD-3 calls `POLICY_NOT_CONFIGURED` "a stable `not_evaluated` reason", but AD-12's closed result algebra has no `reason` field to carry it. |
| G-8 | Low | (Spine-internal.) | The AD-12 sentinel rule says a zero-count entry with empty `completedChecks`, but the `document` `EvaluatedScope` shape has no `completedChecks`. |
| G-9 | Low, residual disclosure | NFR-11. | C-5 withholds identity only. For an actor without read, the presence of a `validation` object still reveals that the collection is enforced (read_only and unconfigured writes add nothing). Findings such as `REQUIRED_METADATA_FIELD_MISSING` reveal rule content. The operator accepted "status, Findings and System Failures are still returned", so this is a conscious residual to record, not a defect. |
| G-10 | Low | Gate 3: "any required migration has its own tested rollback treatment". | AD-14 adds the `events(teamId, name, createdAt)` index (a migration). AD-19 is silent on migration rollback. |
| G-11 | Low | NFR-12 (a Finding grants no authority and does not bypass single-writer coordination), Section 8 non-goals (no LLM, no batch tools), NFR-26 (no stricter-than-config TypeScript claims). | No AD states these. They hold only implicitly (read-only tools, deterministic registry). |
| G-12 | Low | FR-2: "safe diagnostic message". | No rule fixes message content (static templates, no excerpts). NFR-11 relies on AD-2 implicitly. |
| G-13 | Low | FR-6 permits more specific diagnostics when the actor is authorized to know. | AD-2 always collapses. This is stricter but permitted. |
| G-14 | Low | (Spine hygiene.) | The Amendment Record's second row omits AD-18, whose rule text changed in the working tree. |

## 4. Confirmed consistent

- **C-4:** no PRD or addendum clause touches invalid-entry identity. The glossary "Invalid-Policy Collection" (an identifiable entry is invalid) matches the nested-duplicate and lexical-defect rule.
- **C-7:** the PRD never specifies `scopeKind` for writes. FR-19's "scope kind" is read-only.
- **Enforced Write definition:** the PRD's ordered pre-write steps match AD-8 steps 1 to 4 and AD-20 row 1. A failure there produces no outcome and no summary.
- **Collection-change conflict:** matches AD-8, FR-16's exception and the Section 4.5 classification bullet 2 (protocol conflict error, nothing persisted, no audit). The check precedes the fingerprint comparison.
- **Invalid-Policy Collection fixtures:** the HTML create, template, absent patch target, unchanged update, embedded image and unpublish cases match the AD-8 sentinel skip-list.
- **Identity exclusivity, summary content and NFR-11:** the sentinel summary carries no fingerprint (FR-20), and the spine's C-5 identity omission conforms to NFR-11.
- **Other requirements landing as specified:** the HTML worker mismatch, FR-12's "never a Clean Result", NFR-15 and SM-P6 through AD-20 row 6, FR-22 and NFR-27 through AD-15, FR-23 through AD-3 and AD-5's "unknown fields invalid", NFR-6 and NFR-7 through AD-10, and NFR-1 to NFR-5 through AD-17.
- **Companion documents:** SPEC, README and AGENTS were not checked here. They should be re-reconciled once the PRD amendment lands.
