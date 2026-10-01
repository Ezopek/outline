# Internal-consistency review (confirm pass 2, round 3) — ARCHITECTURE-SPINE.md

Reviewer lens: internal consistency of the spine against itself and against `.memlog.md`. Fresh context; read-only on the project (this file is the only write). Line numbers refer to the current `ARCHITECTURE-SPINE.md` as rendered by the Read tool. Known PRD conflicts in "Pending PRD alignment" are not reported. Baseline code was read only to verify two sentences of the spine that round-2 edits may have falsified (`server/commands/documentMover.ts`, `server/tools/documents.ts`). The committed spine (`152f48c08`) was used only to identify what changed since.

## Verdict

All round-2 High and Medium findings are closed in the text, and the spine is now largely self-consistent. It still carries eight Medium items: three sentences the round-2 edits made false or ambiguous (publication residual, "interrupted unit", the concurrent-attempt/unique-violation path), one unresolved timing composition (commit-probe bound and the 65 s arithmetic), one missing cleanup row, one table-versus-prose conflict (parent resolution), and two provenance defects (an Amendment Record that overstates operator authority, and unrecorded normative additions).

Counts of new findings: Critical 0, High 0, Medium 8, Low 18.

## 1. Round-2 High and Medium status

| Id | Status | Basis in current text |
| --- | --- | --- |
| H-1 `deadlineAt` | CLOSED | L121 defines `deadlineAt` (requester wait bound = classification + preparation bound + validation deadline + persistence budget + audit bound + 5 s grace); L166 gives persistence its own 9 s budget "so a fail-open `VALIDATION_TIMEOUT` can still persist"; Conventions L346 makes cross-process values epoch milliseconds converted to a local monotonic remainder; the choices are in memlog L61-L62. Residual composition gaps are new finding M-1. |
| H-2 no row-2 variant | CLOSED | L119 adds `{ kind: "conflict" }`, "row 2 (the requester emits the AD-8 error, no summary)". Residual staged-blob gap is new finding M-4. |
| M-1 unreadable sentinel | CLOSED | L173 scopes "an unreadable sentinel contributes nothing" to `lint_wiki` and states the `lint_document` rule ("policy scope is the document's collection whenever the document is readable, and only the identity fields are gated"); `not_evaluated` is defined over "the actor-readable scope". Memlog notes it only as "read-side readability" (Low L-13). |
| M-2 "exactly one" summary | CLOSED | L226 now reads "at most one ... and exactly one on every path except a read that ends in an `isError` result, AD-20 rows 1, 2, and 7, and an audit failure"; FR-19 added to the pending list (L427). |
| M-3 `durationMs` | CLOSED | `handlerEnteredAtEpochMs` in the intent (L115) and "the worker adds the queue wait computed from `handlerEnteredAtEpochMs`" (L254). |
| M-4 recorded `validation` | CLOSED | L117 defines status-only reconstruction from the summary. Residuals: M-5, L-17. |
| M-5 write System Failure location | CLOSED | L200: "so does every other System Failure of an enforced write". |
| M-6 "always returned" sentinel | CLOSED | L166: "returned whenever its collection is established as actor-readable; if readability cannot be established, the run adds only the generic snapshot `VALIDATION_RUNTIME_FAILED`". |
| M-7 unmarked additions | CLOSED | All six items are now in memlog L62 (fixed message, cancellation, AD-13 resource-limit note, per-sentinel logging, write-path rule scheduling and vacuous check, AD-16 no-cap statement); the `transaction.finished` definition was replaced by commit detection (L61). New unrecorded additions are M-8. |
| M-8 Amendment Record `Binds` | CLOSED | L422 now says `Binds` and `Prevents` of AD-8, AD-11, AD-12 were extended; verified against the committed spine (AD-8 Prevents, AD-11 Binds and Prevents, AD-12 Prevents; AD-20 new). New defect in the same record: M-7. |
| M-9 "expected fingerprint" | CLOSED | L303 compares the env value with `policySetFingerprint` and triggers on "any entry [that] is valid and `enforced` or is an invalid-policy sentinel"; the job field is `expectedPolicyFingerprint` (L115). |
| M-10 connection loss vs row 7 | CLOSED | L127: "except during COMMIT, where an outcome that cannot be established is row 7"; consistent with L312 and L327. |

Totals: CLOSED 12, PARTIALLY CLOSED 0, OPEN 0.

## 2. New findings

### Critical

None.

### High

None.

### Medium

**M-1 — The write-path time composition is incomplete: the commit-probe bound has no value and sits outside every budget, and nothing shows that the sums fit under the 65 s override (AD-7 L121, AD-11 L166, AD-20 L312 and L326-L327).**
- L121: "`deadlineAt` is ... classification plus the AD-11 preparation bound, validation deadline, persistence budget, and audit bound, plus a fixed 5-second grace." That is 30 + 9 + 9 + 3 + 5 = 56 s after classification (51 s for a Markdown write, which has no grace).
- L166: "persistence (P7, P8) has its own 9-second budget". L327 lists P7 as "budgeted at 9 seconds" but P8 with no budget. L312: the probe runs "within a code-owned bound" with no value, and that bound is in neither the P8 budget nor the `deadlineAt` sum.
- L166 requires the `/mcp` socket timeout to be "at least 65 seconds". The spine never states the margin. 65 − 56 = 9 s must absorb P0/P1 time before classification (unbounded by any AD), the probe, and response assembly.
- L121: "the worker does not enter the persist step after it." The guard only refuses entry after `deadlineAt`; a worker that enters P7 just before it commits up to 9 s after the requester reported row 7 (L314). That is a legal outcome under row 7, but then the sentence bounds nothing useful.
- Fix: add "the probe bound (code-owned, N s) is part of the P8 persistence budget"; state that P8 belongs to the 9 s budget in the P-table; add the probe to the `deadlineAt` sum or absorb it in the grace explicitly; add one sentence "the write path is bounded by 30 + 9 + 9 + 3 s (+5 s grace on the HTML path) after classification, which fits under 65 s only if P0 and P1 are bounded by [x]"; change the guard to "does not enter the persist step unless the remainder covers the persistence budget".

**M-2 — "an interrupted unit contributes nothing" contradicts "never Findings" and has no reachable referent (AD-11 L166; memlog L56).**
- Same paragraph: "a failure of one rule kind yields one System Failure per (unit, code) ... Findings already produced are retained ... Only System Failure sources may be discarded, never Findings" and "The deadline is checked before each unit; an interrupted unit contributes nothing".
- "Deadlines are checked between units, and a synchronous parse is not preempted", so a deadline can only fire inside a unit through a DB `statement_timeout` in a related-state read (P5). That is a "failure of one rule kind" (Findings retained), not an "interrupted unit" (nothing retained). Memlog L56 (operator gate decision): "Findings are retained on failure or timeout".
- Risk: an implementer who follows the "contributes nothing" clause in the write path discards a known Error on a timeout and, under `open` mode, persists (AD-13 row "Runtime System Failure, no known Error").
- Fix: restrict the clause to `lint_wiki` ("a document unit not started or not finished when the deadline is checked is not counted and adds no Findings; a unit that finished with a partial rule failure keeps its Findings") and state that on the write path and `lint_document` Findings are never discarded.

**M-3 — AD-8 says a publication is exposed to a concurrent parent move, but the round-2 collection lock serializes it (AD-8 L127).**
- L127: "a publication or unpublication takes the classified collection's `NO_KEY_UPDATE` lock first, matching the baseline mover's order" and, later in the same paragraph, "A concurrent parent move between the re-fetch and commit of a create or publication is not prevented; `lint_wiki` detects the resulting drift".
- Baseline check: `documentMover.ts` lines 44-58 take `NO_KEY_UPDATE` on the moved document's current and destination collections. The classified collection of a publication is the parent's collection, so a move of the parent or any ancestor out of it blocks on the publication's lock until commit, and a move that completes earlier is caught by the post-lock re-fetch as row 2. The residual survives only for a create (no lock). Memlog L60 ("residual create/publish window recorded (no new parent locks)") predates the L61 lock and is stale.
- Fix: "A concurrent parent move between the re-fetch and commit of a create is not prevented (a publication holds the classified collection's lock, which the baseline mover also takes)". Update memlog L60.

**M-4 — Staged-blob cleanup omits AD-20 row 2 (AD-7 L113 and L119, AD-8 L137, AD-20 P2/P3).**
- L113: "AD-20 rows 3, 4, and 5 delete the invocation's staged blobs idempotently; row 7 never deletes them."
- Row 2 is reachable at P3, after P2 has staged media (L322), and via the worker's `conflict` variant. L137 says only "Any validation already performed is discarded. There is no persistence, no Validation Status, and no validation audit". The blobs written at their final keys under pre-allocated Attachment IDs are orphaned, which is the outcome AD-7's `Prevents` line ("rejected writes leaving visible media or records") exists to stop, and D-9 defers only crash-orphaned blobs.
- Fix: "AD-20 rows 2, 3, 4, and 5 delete ...". Also assign cleanup ownership for the requester-side branch "the call definitively did not enqueue" (L-2).

**M-5 — The concurrent-attempt and unique-violation path is self-contradictory and could delete a committed document's media (AD-7 L117 and L119, AD-20 P7 L326).**
- L117: a found row "returns `committed` ... and if no summary exists the worker throws (row 7)". L119: the worker "inserts its summary if absent, so a losing concurrent attempt for the same `documentId` returns `committed` without a second summary". A loser cannot both insert an absent summary and throw for an absent summary. In the window between the winner's commit and its audit insert (audit is initiated after commit and may fail), the loser throws and the requester is told row 7 for a committed write.
- L117 also says a unique violation on the ID "returns `committed` before any re-authorization, fingerprint comparison, or storage read". A unique violation occurs at the P7 insert, after those steps and after staging, so "before" is false for it. P7 (L326) lists "conflict other than row 2" as row 5, and row 5 deletes the invocation's staged blobs (L113). Attachment IDs and storage keys are pre-allocated per invocation, so the loser's cleanup would delete the blobs of the winner's committed attachments.
- Fix: in P7 add "except a unique violation on the pre-allocated `documentId`, which is AD-7's `committed` path and never deletes blobs"; replace "inserts its summary if absent" with "the winner inserts its summary with `ON CONFLICT DO NOTHING`", and define the loser behavior when no summary exists yet (retry within the probe bound, then row 7).

**M-6 — `PARENT_DOCUMENT_UNRESOLVED` is defined against the evaluated scope, but AD-9 says parents do not resolve against it (AD-3 L75 vs AD-9 L154).**
- AD-3: "An evaluated document's parent cannot be safely resolved in scope."
- AD-9: "Parents and link targets resolve through the same membership-aware queries rather than against the evaluated scope alone: a readable parent outside the evaluated collection resolves, and a cross-collection parent is `PARENT_COLLECTION_MISMATCH`, not unresolved."
- Implementing the table's "in scope" wording gives a false `PARENT_DOCUMENT_UNRESOLVED` for every readable cross-collection parent. The AD-9 clarification is also a normative addition that the memlog does not list.
- Fix: AD-3 "cannot be safely resolved for the actor"; record the AD-9 clarification in the memlog defaults.

**M-7 — The Amendment Record overstates authority and omits a changed AD (Amendment Record L422 vs memlog L60-L62).**
- Row 2 (Authority): "Operator decisions on the Coaching path, recorded in the architecture workspace memlog." The memlog labels the reviewer-gate, second-round and "additions" entries as author defaults "open to operator veto" (L60, L61, L62). Only C-3 to C-7 and the four gate decisions are operator decisions.
- Row 2 Decisions column lists AD-3 ... AD-20 but omits AD-9, which changed (`lint_wiki` document set; parent and target resolution, L154). Verified by diffing against the committed spine: AD-1 and AD-2 are the only unchanged ADs.
- Fix: Authority: "Operator decisions C-3 to C-7 and the four gate decisions; all other changes are author defaults recorded in the memlog and open to operator veto". Add AD-9 to the Decisions column.

**M-8 — Normative additions that are neither operator decisions nor recorded author defaults (memlog L60-L62).** Each needs a memlog default entry or removal:
1. AD-19 L303: "readiness reports the fingerprint through an extension of the baseline health endpoint". Memlog L42 says only that readiness "may require" the expected fingerprint (L58 makes it mandatory); the mechanism is new.
2. AD-7 L115: "the queue's failure handler logs only the job ID and task name for an enforced job". A behavior change in shared queue code; not in any memlog list.
3. AD-13 L219: "Write-summary `complete` means validation ran to completion with no System Failure, so a write rejected by Errors alone is `complete: true`." Memlog C-6(7) fixes `complete=false` only for aborted summaries.
4. AD-14 L226: the index migration is "additive, concurrent ... so image rollback stays safe". Memlog L37 decides the index only.
5. AD-11 L166: SET LOCAL steps fail "when the remainder is below a code-owned floor" (a new failure mode with no value or owner).

### Low

- **L-1 (AD-20 L314).** "MCP cancellation and client disconnect are honored only before the persist decision; on the HTML path the requester stops waiting and reports row 7." On the HTML path the requester cannot see the worker's decision, so cancellation is honored at any time after enqueue, contradicting "only before". No row is assigned to a cancelled attempt (the default rule gives row 3, which is not said). Fix: "a cancellation before the persist decision is row 3; on the HTML path the requester stops waiting at any time and reports row 7".
- **L-2 (AD-7 L119 vs AD-20 row 7 L337).** L119: "a failed `queue.add` is row 7 unless the call definitively did not enqueue." Row 7 lists "failed enqueue" unconditionally, and the "definitively did not enqueue" branch has no row, no summary owner (L119 allows a requester summary only for outcomes determined "before scheduling the job"), and no blob cleanup owner. Fix: name row 3 and the requester as summary writer for that branch.
- **L-3 (AD-3 L64-L85, AD-4 L93).** `relationshipKind` (`parent | collection_structure | global_index`) is not fixed per code, so two implementers can locate `PARENT_COLLECTION_MISMATCH` or `HIERARCHY_CYCLE` differently. The token `document` still appears in both the Location and Surfaces columns of the same rows (the legend explains Surfaces only), and "every other rule code" in the legend does not say whether Warnings and System Failures are rule codes. Fix: add a `relationshipKind` per code; rename the Surfaces token to `documents`-style or `doc`.
- **L-4 (AD-10 L160 vs AD-11 L166).** A `statement_timeout` or deadline expiry during snapshot construction is either "inability to establish [the snapshot]: `VALIDATION_RUNTIME_FAILED`" (AD-10) or `VALIDATION_TIMEOUT` (AD-11 "Timeout ... adds `VALIDATION_TIMEOUT`"). Pick one for snapshot-phase expiry.
- **L-5 (AD-6 L107 vs AD-5 L99).** "an explicit empty file also produces [the empty-set fingerprint]". A zero-byte file is malformed JSON and startup-fatal under AD-5. Say "an explicit envelope with `collections: {}`".
- **L-6 (AD-20 Prevents L308, AD-7 L117).** "a committed write presenting as a failure" is claimed as prevented, but row 7 (unestablished COMMIT, redelivery with no summary) deliberately presents a possibly committed write as a tool-execution error. Add "except row 7, which makes no claim about persistence".
- **L-7 (AD-4 L93).** "absent values sort last" versus "the collection-ID sort key is derived server-side for locations that carry none": a `scope` location whose `collectionId` was omitted for lack of read access is both "absent" and "derivable". State which one applies (derived, since the key is server-side and never disclosed).
- **L-8 (template hygiene).** Structure lints clean (AD-1 to AD-20 unique and in order; 20 `Binds`, 20 `Prevents`, 20 `Rule`; no placeholders; mermaid valid; all 20 ADs in the capability map). Remaining items: AD-12, AD-14, AD-18 and AD-20 carry a fourth "PRD alignment pending" bullet between `Prevents` and `Rule`; AD-20 is labeled `[ADOPTED]` although its P-table, row 7, fixed message and probe are author defaults (memlog L60-L62); frontmatter `status: final` while the memlog has no closing event after L45 for the update run (L48 says the amended text "has had no reviewer pass and no closing event").
- **L-9 (attributions of acceptance).** "which is accepted" (AD-7 L117), "an accepted residual" (AD-20 L312), "Three residuals remain by design" (AD-12 L200): none is recorded as an operator acceptance; the memlog records author defaults. Reword to "recorded residual" or add to memlog L62.
- **L-10 (pending markers and PRD ids).** The pending list (L424) says only AD-12, AD-14, AD-18 and AD-20 carry a marker, but AD-3 (`VALIDATION_RUNTIME_FAILED` narrowing, FR-13 item) and AD-8 (`collection_conflict` as a tool-execution error, FR-16 wording item) also hold text that conflicts with listed PRD items; the AD-14 marker omits FR-19 (its no-summary-on-`isError`-read rule). `CAP-4` and `CAP-6` (L172, L427) are not literal PRD identifiers (the PRD names only CAP-5; CAP-N is Section 4.N); use "Section 4.4" and "Section 4.6" as the C-3 item already does.
- **L-11 (capability map L393-L394).** "Timeouts and deadlines" omits AD-7 (`deadlineAt`, worker deadlines) and AD-20 (P2 and P7 budgets); the `lint_document` row omits AD-10 and AD-11.
- **L-12 (AD-18 L297).** No explicit fixture for the AD-13 matrix rows, the AD-11 prefix/`completedChecks` semantics, the AD-16 limits and admission, the cancellation rule, the fixed message, or the "probe cannot run" outcome (only "three COMMIT-probe outcomes" are listed and the fourth path in L312 is not one of them), although AD-18 `Binds` "every boundary above".
- **L-13 (memlog hygiene).** L56 (operator gate decision: deadline "started at classification (writes)") is not marked superseded by the L61 default (starts when the transaction opens); L58 ("required whenever any collection has activation enforced") is superseded by L61; L60 ("residual create/publish window") is stale (M-3); C-3's "Unreadable sentinels are invisible" (L51) is narrowed for document readers without an explicit note.
- **L-14 (AD-11 L166 vs AD-12 L173).** "An invalid-policy sentinel's System Failure ... is returned whenever its collection is established as actor-readable" does not cover the `lint_document` case where the document is readable and its collection is not (generic failure located `scope { scopeKind: "document" }`). Add "or, for `lint_document`, the generic document-scope failure of AD-12".
- **L-15 (AD-8 L129-L133, AD-20 L319).** Classification lists three cases; an update of a collectionless draft that stays a draft has none (carried over from round-2 L-10). P1 failures are row 1 = "Baseline behavior", but a failed `readable` computation has no baseline analog and is not in the fixed-message list (L314).
- **L-16 (AD-7 L121, AD-11 L166).** The 30 s preparation bound is one number for a phase split between requester (content staging) and worker (conversion, staging). State whether the worker restarts the bound or receives a remainder.
- **L-17 (AD-7 L117).** The status-only reconstruction gives "empty `errors` and `warnings`" but says nothing about `systemFailures` for a reconstructed `degraded_validation`, and does not say the `readable` flag from the intent governs the identity fields.
- **L-18 (terms).** "classification" still means both the AD-8 policy classification and AD-13's "validation classification" (L208); "issue" (AD-3 title, AD-4, AD-12) is undefined beside Finding and System Failure; "worker" means both a forked throng worker (AD-5, AD-18) and the queue-worker HTML job runner (AD-7). One glossary line would remove each.

## 3. Cross-references, numbers, and terms re-verified

- **References resolve** and say what the target says: AD-3, AD-4, AD-7 to AD-15, AD-18, AD-19, AD-20 to each other; D-9 (L62 to L415); OD-1, OD-3, OD-4, OD-5, OD-7; rows 1 to 7; phases P0 to P8 including P2b; the FR, NFR, SM-P6, SM-I6 and OD ids cited in `Binds` exist in the PRD. Exceptions: L-10 (CAP ids).
- **Tables versus prose.** AD-3 Surfaces legend covers `document`, `wiki`, `all`, `lint_wiki` and `startup diagnostics only`; the four hierarchy codes plus `GLOBAL_INDEX_LINK_MISSING` match `completedChecks` in AD-12 and the unit list in AD-11; the Location column matches the four AD-4 kinds. AD-14 `outcome` enum equals read states plus write statuses plus the two `aborted_*` values; the row table maps 1:1 to it (row 4 `rejected`, rows 3 and 5 `aborted_*`, row 6 the three success values, rows 1, 2, 7 none). AD-13's matrix agrees with rows 4 and 6 and with AD-12 statuses.
- **Numbers.** 9 s validation (lint_document and writes), 9 s persistence (P7; P8 per M-1), 30 s preparation, 3 s audit (AD-11, AD-14, AD-15 agree), 5 s grace (AD-7 only), 60 s `lint_wiki`, 65 s socket (`lint_wiki` 60 + 3 = 63 s fits; write path per M-1). `deadlineAt` sums to 56 s after classification, so the 65 s override can hold it, but the spine never shows the margin.
- **Terminology.** "tool-execution error" is used consistently and defined twice (AD-12 L173, Conventions L347); the only "protocol conflict error" is a quotation of the PRD. "decision", "persist decision" and "attempt" are defined in AD-20 L310. "readable" is defined as the `readable` flag plus can-read checks.
- **Sentences the round-2 edits could have falsified.** Locks: M-3. Isolation: AD-8 `READ COMMITTED` versus AD-10 `REPEATABLE READ` are consistent. Startup/master: AD-5 (master reads once, workers never read) and AD-19 ("each service ... validates the file at startup") are consistent because each service's master does both. "exactly one": L173, L189, L198, L226 are consistent after the round-2 rewording. Commit detection: L127, L312, L327 and AD-15 L278 agree on rows 5, 6, 7. Baseline-compat sentences (`unchanged-update` uses `revisionCount`) match `server/tools/documents.ts` 702-716.
