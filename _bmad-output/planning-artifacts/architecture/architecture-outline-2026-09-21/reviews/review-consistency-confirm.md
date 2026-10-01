# Internal-consistency review (confirm pass) — ARCHITECTURE-SPINE.md

Reviewer lens: internal consistency of the spine against itself and against `.memlog.md` decisions. Fresh context; read-only on the project (this file is the only write). Line numbers refer to the current `ARCHITECTURE-SPINE.md`. Known PRD conflicts listed in "Pending PRD alignment" are not reported. Nothing was checked against prior review files.

## Verdict

The spine is largely coherent and faithful to the memlog decisions (C-3 to C-7, the four gate decisions, 9 s/3 s deadlines, 65 s `/mcp` override, expected-fingerprint requirement, actor-independent audit all present). It is not yet clean: two contract gaps around the HTML worker (`deadlineAt`, the result union) are High, and ten Medium items are direct sentence-level contradictions or unmarked additions.

Counts: Critical 0, High 2, Medium 10, Low 12.

## High

### H-1 — `deadlineAt` is undefined and, as worded, forbids the fail-open persist that AD-13 requires (AD-7 L115 vs AD-11 L160, AD-13 L213, AD-20, Conventions L335)

Quotes:
- AD-7: "the `readable` flag computed at classification (AD-12), a `deadlineAt`, and the auth envelope ..." and "it does not enter the persist step after `deadlineAt`."
- AD-11: the 9 s deadline is "started at classification (writes) ... and covering row-lock wait and related-state reads"; each transaction sets `SET LOCAL lock_timeout`/`statement_timeout` "from the remaining deadline".
- AD-13: "`VALIDATION_TIMEOUT` ... fail-open eligible" (an expired deadline under `open` gives `degraded_validation, persist`).
- Conventions: "deadlines use a monotonic clock."

Conflicts:
1. If `deadlineAt` is the AD-11 validation deadline, a validation timeout under `open` mode would arrive at the persist step after `deadlineAt`, which the worker refuses. HTML creates then cannot degrade while Markdown creates can, which is the create/update/worker divergence AD-20's `Prevents` line forbids. Nothing in AD-20 says which row that refusal selects (default rule would give row 5, `aborted_after_decision`, for a write the matrix said to persist).
2. If it is some other deadline, no AD defines it (value, start point, or relation to the 9 s deadline).
3. An absolute `deadlineAt` carried through a queue cannot be a monotonic-clock value across processes, contradicting the Conventions Time row.
4. The same ambiguity applies to "remaining deadline" for `SET LOCAL` once the 9 s deadline has expired and the persist statements still have to run.
5. This behavior is not in the memlog decisions or in the "Reviewer-gate fixes" author-default list.

Minimal fix: state that `deadlineAt` is the AD-11 9 s validation deadline expressed as a wall-clock instant, that its expiry during evaluation is `VALIDATION_TIMEOUT` and follows AD-13 (including persist under `open`), and that the persist step and its `SET LOCAL` budget are bounded by a separate persistence bound. Or delete the "does not enter the persist step" clause. Record the choice in the memlog as an author default.

### H-2 — `EnforcedImportResult` has no variant for AD-20 row 2, though the worker must detect collection change (AD-7 L115, AD-8 L131, AD-20 rows/P2)

Quotes:
- AD-7: worker order is "reload the actor, re-authorize the destination, check the AD-8 collection change, compare the current policy fingerprint ..."; the union is "`{ kind: "committed", documentId, validation } | { kind: "rejected", validation } | { kind: "aborted", row: 3 | 5 }`".
- AD-8: "The AD-8 in-transaction re-fetch, or an AD-7 worker re-authorization, may find a post-operation collection other than the classified one ... the write fails with a tool-execution error ... `collection_conflict`."
- AD-20: P2 "collection change 2"; row 2 summary `outcome`: "none".

Conflict: the worker can detect row 2 (both outside and inside its transaction) but cannot return it. Mapping it to `aborted` (3|5) would make the worker write an `aborted_*` summary, contradicting row 2 ("none") and AD-14 ("A collection-change conflict ... record no summary"). The AD-18 requirement of a fixture for "the HTML-worker result union" and "one fixture per AD-20 row" is unimplementable as written.

Minimal fix: add `| { kind: "aborted", row: 2 }` (or `{ kind: "conflict" }`) to the union and state that the requester maps it to `collection_conflict` and no party writes a summary.

## Medium

### M-1 — "unreadable sentinel contributes nothing" contradicts the document-membership case in the same paragraph (AD-12 L167; memlog C-3)

Quotes, same paragraph:
- "An unreadable sentinel contributes nothing."
- "a sentinel in a collection the actor cannot read, reached through a readable document, yields the generic `POLICY_CONFIGURATION_INVALID` without `collectionId`".
- Also `not_evaluated` "means the actor-readable scope holds neither a valid policy nor an invalid-policy sentinel", while `lint_document` "evaluates under the document's collection policy whenever the actor can read the document".
- Memlog C-3: "Unreadable sentinels are invisible."

Conflict: "readable" is used for both the collection and the document, and "actor-readable scope" is undefined for `lint_document`. The exception is an author default (memlog: "read-side readability"), but it contradicts the operator wording of C-3 and the sentence that states the general rule.

Minimal fix: scope the general sentence ("For collection-scoped and default-scope `lint_wiki`, an unreadable sentinel contributes nothing; for `lint_document` the policy scope is the document's collection whenever the document is readable, and only the identity fields are gated by collection read"), define `not_evaluated` in those terms, and note in the memlog that C-3's "invisible" is narrowed for document readers.

### M-2 — "persist exactly one idempotent summary" is contradicted by several no-summary paths (AD-14 L220 vs L248, L266, AD-20 rows 1, 2, 7, AD-15 L272)

Quotes:
- AD-14 rule: "persist exactly one idempotent summary under `wikiLint.document`, `wikiLint.wiki`, or `wikiLint.write_validation`."
- AD-14: "A read that ends in an `isError` result (invalid call, authorization denial) records no summary." "A collection-change conflict and any failure before AD-8 classification record no summary."
- AD-20 row 7: "none written by the requester ... an absent one is an accepted evidence gap"; AD-15: crash-after-commit-before-audit and audit failure.

Also: the read no-summary rule is an author default ("read outcome mapping") that conflicts with PRD FR-19 ("Every `lint_document` and `lint_wiki` invocation shall attempt to record one audit summary"). FR-19 is not in "Pending PRD alignment" (which lists only C-3, C-5, C-6, addendum).

Minimal fix: reword to "persist at most one idempotent summary per invocation; exactly one on every path except those listed below (read `isError`, AD-20 rows 1, 2, 7, audit failure)". Add FR-19 to the C-6/C-3 list of pending items.

### M-3 — `durationMs` cannot be computed by the party that owns the HTML summary (AD-14 L248 vs AD-7 L115)

Quotes:
- AD-14: "`durationMs` is monotonic time from tool-handler entry to the initiation of the audit write, including any queue wait."
- AD-7: the worker is "the sole owner of evaluation, the AD-13 decision, the commit, and the audit summary for an HTML enforced create". The intent carries request/invocation IDs, `actorId`, `sourceIp`, `documentId`, expected fingerprint, `readable`, `deadlineAt`, auth envelope; no start time.

Conflict: tool-handler entry is in the requester process; the worker has no start value, and monotonic values are not comparable across processes.

Minimal fix: add a requester-supplied start instant to the intent and define `durationMs` for the HTML path as wall-clock elapsed from that instant (or exclude queue wait for the worker path); state the difference.

### M-4 — "the validation recorded for `invocationId`" has nowhere to be recorded (AD-7 L115 vs AD-14 L244)

Quotes:
- AD-7: "a redelivered job that finds that row returns it as `committed` with the validation recorded for `invocationId`."
- AD-14: "No additional key may carry bodies, excerpts, messages, locations, raw config/request ..."; `AuditDataV1` stores only counts.

Conflict: a full `validation` (Warnings, System Failures, locations) is not persisted anywhere by AD-14, so a redelivered job cannot return the original object. The spine does not say whether it re-evaluates, stores the result in the job, or returns a reduced `validation`.

Minimal fix: say where it is recorded (for example the queue job's return value) or define the redelivered result as a status-only `validation` reconstructed from the summary counts, and require a fixture for it.

### M-5 — Location of write-path System Failures other than the two policy-configuration rejections is unspecified (AD-12 L167/L194, AD-3 L83-84, AD-4 L93)

Quotes:
- AD-3 table: `VALIDATION_RUNTIME_FAILED` and `VALIDATION_TIMEOUT` have Location `scope`, Surfaces `all`.
- AD-12: run-wide failures are "located `scope { scopeKind }` with the request's scope kind and `collectionId` only for a collection-scoped request"; "Location and disclosure" covers only "Both rejection kinds".
- AD-14: writes always use `scopeKind: collection`.

Conflict: for a write, "the request's scope kind" is undefined (document? collection?), and it is not stated whether `collectionId` follows the `readable` flag. Two implementers will diverge; this affects deterministic sort keys too.

Minimal fix: add "For an enforced write, every System Failure is located `scope { scopeKind: "collection", collectionId? }` for the classified collection, `collectionId` subject to the `readable` flag."

### M-6 — "always returned" sentinel failure vs readability gating and snapshot failure (AD-11 L160 vs AD-12 L167)

Quotes:
- AD-11: "a global snapshot failure may return no findings, but an invalid-policy sentinel's System Failure needs no snapshot and is always returned."
- AD-12: "An unreadable sentinel contributes nothing"; "default-scope `lint_wiki` contains only collections the actor can read".

Conflict: deciding whether a sentinel is actor-readable requires the same membership-aware primary-DB reads that fail in a snapshot failure. "Always returned" is unsafe when readability cannot be established (it would disclose or over-report), which conflicts with the inherited non-disclosure invariant.

Minimal fix: "always returned when its collection is established as actor-readable; if readability cannot be established the run adds only the generic snapshot `VALIDATION_RUNTIME_FAILED`."

### M-7 — Additions not decided by the operator and not marked as author defaults (memlog L60 list)

Each is absent from the memlog decisions and from the "Reviewer-gate fixes applied by the author" entry:
1. AD-13 L213: "`VALIDATION_RESOURCE_LIMIT_EXCEEDED` has no write-path source today; if one is added, a limit the client controls through content size is not fail-open eligible." This narrows the operator-adopted eligibility list ("Only ... may proceed under explicit ... open mode").
2. AD-20 L304: "MCP cancellation and client disconnect are honored only before the persist decision." No row or outcome is assigned to a cancelled attempt.
3. AD-20 L304: the exact fixed message `The operation could not be completed` and the `transaction.finished === "commit"` definition.
4. AD-19 L297: per-sentinel startup logging of `collectionId`, JSON-Pointer path, and `invalidFingerprint`, plus invalid counts. The adopted AD-19 (memlog L42; HEAD text) says startup "reports only config status, activation counts, and a `policySetFingerprint`". AD-6 (memlog L29) permits hash, code, and path to be exposed, but not specifically in startup logs. Probably justified by NFR-16, but it widens an "only" list.
5. AD-11 L160: write-path rule scheduling ("all enabled document and link rules run as one unit; a failure or timeout of one rule kind ... never skips another") and "a required check with zero inputs completes vacuously and is listed in `completedChecks`".
6. AD-16 L278: "`lint_document` and write validation add no size cap beyond the baseline document limit."

Minimal fix: add these to the memlog's author-default entry (or drop them); no spine change needed if marked.

### M-8 — Amendment Record says `Binds` unchanged, but Binds/Prevents of existing ADs changed (AD-11, AD-12; Amendment Record L411)

Quote: "Identifiers, `Binds`, and adopted status of existing decisions unchanged." Verified against the committed spine (`git diff HEAD`): AD-11 `Binds` gained "`lint_document`, enforced-write validation" and its `Prevents` gained "a write path with no deadline whose value decides fail-open admission"; AD-12 `Prevents` changed "protocol error state" to "tool-execution error state". The memlog itself lists "binds ... updates".

Minimal fix: "Identifiers and adopted status unchanged; `Binds`/`Prevents` of AD-11 and AD-12 extended" (or list them).

### M-9 — "expected fingerprint" names two different values, and the enforced-only requirement ignores sentinels (AD-19 L297, AD-7 L115, AD-12 L190, AD-6 L107)

Quotes:
- AD-19: "`WIKI_LINT_EXPECTED_CONFIG_FINGERPRINT` is required whenever any collection has `activation: enforced`; a missing or mismatched value makes readiness false". It never says the comparison is against `policySetFingerprint` (AD-6 says "expected policy-set fingerprint").
- AD-7/AD-12: "the expected policy fingerprint" / "the expected `policyFingerprint` from the trusted job intent" (per collection).

Conflicts: (a) "expected fingerprint" (AD-18 test names, AD-19 prose) is ambiguous between the set-level env value and the per-collection job value. (b) A sentinel entry rejects enforced writes (AD-8) but its `activation` is untrusted, so "any collection has `activation: enforced`" does not cover a config whose only enforced-intended entry is invalid, yet that instance still rejects writes and can differ across instances.

Minimal fix: name the value ("compared with the startup `policySetFingerprint`") and define the trigger as "any collection whose entry is `enforced` or is an invalid-policy sentinel"; rename the job field `expectedPolicyFingerprint`.

### M-10 — AD-8 says connection loss after the decision is row 5; AD-20 P8 makes COMMIT-time loss row 7 (AD-8 L121 vs AD-20 L316)

Quotes:
- AD-8: "a failure that invalidates the transaction, such as connection loss, is AD-20 row 3 before the decision and row 5 after it."
- AD-20 P8: "COMMIT error 5, or 7 when its outcome cannot be established"; row 7 "COMMIT's outcome cannot be established".

Conflict: connection loss during COMMIT is the canonical outcome-unknown case; AD-8's sentence would classify it as row 5 (audited `aborted_after_decision`) instead of row 7 (no summary, "no claim about persistence"). Audit and agent result differ.

Minimal fix: append "except at COMMIT, where an unestablished outcome is row 7".

## Low

- L-1 (AD-3 L64, L82, L85): the `Surfaces` legend defines `document`, `wiki`, `all` only, but rows use `lint_wiki` (`VALIDATION_RESOURCE_LIMIT_EXCEEDED`) and "startup diagnostics only" (`POLICY_SCHEMA_VERSION_UNSUPPORTED`). Add both to the legend (or use `wiki`-style tokens). The same table also uses the token `document` for the Location and Surfaces columns in one row with different meanings (also `scopeKind: document`, `EvaluatedScope.kind: document`).
- L-2 (AD-3 vs AD-11/AD-12): no table maps codes or rule kinds to the AD-11 checks (`documents`, `hierarchy`, `global_index`), yet "A check is required exactly when at least one enabled rule kind belongs to it". Add a one-line mapping (the four hierarchy codes to `hierarchy`, `GLOBAL_INDEX_LINK_MISSING` to `global_index`).
- L-3 (AD-12 L189 vs AD-7 L115): "empty `errors` and `warnings`, even if Findings were produced before the mismatch was detected" is vacuous, because AD-7 fixes the fingerprint comparison before conversion and evaluation. Either drop the clause or state a second comparison point.
- L-4 (AD-20 L306-326): (a) row 3 is "Before the AD-13 decision" but a P2 fingerprint mismatch is also before the decision and selects row 4; add "excluding policy-configuration rejections and collection change". (b) Row 7's requester-side branch (job failure, stall, interrupted wait) has no phase in the P-table. (c) P7 omits "conflict", which memlog C-6(4) and AD-13 name; the default rule covers it but it is not listed.
- L-5 (terms): "attempt" is defined as the span ending at the AD-13 decision ("the AD-13 decision is the boundary of a validation attempt") yet "An attempt passes the phases below in order" includes P7/P8 after the decision. "AD-13 decision" and "persist decision" both appear (AD-20 L304 rows 5/6, cancellation rule). "classification" means both the AD-8 policy classification and AD-13 "validation classification". "issue" (AD-3 title, AD-12 "issue arrays") is used without definition beside Finding/System Failure. Define once.
- L-6 (AD-11 L160): "an interrupted unit contributes nothing" vs "Deadlines are checked between units, and a synchronous parse is not preempted" (interruption is only possible through DB timeouts). Also, AD-11 says the 9 s deadline covers "row-lock wait" while AD-3 defines `VALIDATION_TIMEOUT` as "The server-owned validation deadline expired"; AD-20 P3 makes a lock timeout row 3, not a System Failure. One clause would remove the doubt.
- L-7 (AD-4 L93): the ordinal is "within one document", so two scope-level System Failures with the same collection and code (for example hierarchy and global-index runtime failures) tie on every key. Order is deterministic only via emission order, which is not stated as the tie-breaker. Also the sort key "authorized collection ID" is not carried by `text`/`document`/`relationship` locations; say that it is derived server-side.
- L-8 (template hygiene): AD-12, AD-14, AD-18, AD-20 carry a fourth bullet ("PRD alignment pending") between `Prevents` and `Rule`; AD-20 is labeled `[ADOPTED]` though its phase table, row 7, and fixed message are author defaults; AD-14 states the Event-column rule twice (L220 and L266); the mermaid diagram is valid but draws `ADAPTERS --> CONTRACTS` and not `CORE --> CONTRACTS` although the prose says the core owns the contracts; `companions: []` while the Amendment Record discusses lower-authority companions (acceptable, but worth one line).
- L-9 (Pending PRD alignment L413-421): the AD-12 marker names only the C-3 sentinel read rule, while the pending list also has the C-5 identity item that AD-12 defines. PRD FR-16 calls the collection conflict a "protocol conflict error"; the spine reserves "protocol error" for JSON-RPC and calls it a tool-execution error. Add the terminology to the FR-16 item.
- L-10 (AD-8 L121-127): `Prevents` claims "TOCTOU between projection and save" while the rule records an accepted create/publication parent-move residual. Classification lists only collected updates/unpublish, creates, and draft publication; an update to a collectionless draft that stays a draft has no listed case (presumably baseline).
- L-11 (AD-12 L194, AD-14 L237): "Two residuals are accepted" attributes an acceptance to the operator that the memlog does not record; `runtimeFailOpenExercised` is never defined (implied: true only for a committed `degraded_validation`, and false for reads).
- L-12 (AD-6 L107): "An invalid entry exposes only that hash, a stable code, and a JSON-Pointer schema path" does not say the path is operator-only (AD-19), while AD-12 `PolicyIdentity` returns only the hash. Add "the path is operator-only".

## Checked and consistent (no finding)

- Cross-references resolve and say what the target says: AD-3/AD-4/AD-7/AD-8/AD-11/AD-12/AD-13/AD-14/AD-15/AD-18/AD-19/AD-20 to each other, D-9, OD-7, AD-20 rows 2, 3, 5, 7 and phases P0-P8, FR-16/17/20/21, NFR-9/11/15, SM-P6, CAP-4, SM-I6 (all exist in the PRD). The frontmatter FR-1..FR-23 and NFR-1..NFR-27 ranges match the PRD.
- AD-1..AD-20 are unique and in order, each with Binds/Prevents/Rule; D-1..D-9, rows 1-7, P0-P8 in order. No placeholders or template comments (grep clean). All 20 ADs appear in the Capability map. The mermaid block is syntactically valid.
- AD-13 matrix against AD-20 rows 3-6 and AD-12 statuses; the `AuditDataV1` `outcome` enum against read states plus write statuses plus the two `aborted_*` values; the AD-3 Location column against the four AD-4 kinds; Surfaces `document`/`wiki` against AD-11 units and AD-12 `completedChecks`.
- Memlog fidelity: C-3 (except the M-1 narrowing), C-4, C-5 (identity half and actor-independent audit half), C-6 items (1)-(8), C-7, `/mcp` 65 s override with `SET LOCAL` and the >10 s test, 9 s and 3 s bounds, Findings retained on failure, expected-fingerprint requirement, D-1..D-8 owners.
- Stack values match the baseline commit's Dockerfile (Node 26.3.0), `package.json`, `yarn.lock` (SDK 1.29.0 resolved), and CI (`postgres:14.2`, Node `26.x`). SPEC.md does list AD-1 to AD-19 as stated.
