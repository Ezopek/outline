# Adversarial Review: Spine Delta 2026-10-02

- **Target:** `ARCHITECTURE-SPINE.md`, uncommitted delta (AD-3 `VALIDATION_TIMEOUT`, AD-9 `readDocument`, AD-10/AD-11 below-floor snapshot, AD-12 unprovable-check wording, AD-16 admission order, AD-18 fixtures, D-9, Open PRD residuals, Amendment Record).
- **Decision rationale read:** `.memlog.md`, entries for the 2026-10-02 update run (items 1 to 4).
- **Cross-read:** `epics.md` Stories 1.3, 1.5, 1.6, 1.7, 3.4; `sprint-change-proposal-2026-10-01.md` §4.6; baseline `server/policies/collection.ts` (`read` lines 34-48, `readDocument` lines 69-80) and `server/routes/api/collections/collections.ts:170-187`.
- **Lens:** construct two units one level down that each obey every AD to the letter and still build incompatibly.
- **Line numbers** refer to the working-tree spine.

## Verdict

**Not ready to hand to the story edits as written.** The three operator decisions are sound and the delta is internally consistent at the level of each AD taken alone. Their interactions, however, leave four High holes where two compliant units build incompatibly:

- who owns the "unprovable without `readDocument`" outcome;
- the code returned when a scoped collection's readability lookup fails;
- what the timeout "prefix" means once unprovable checks are deterministic; and
- whether `lint_document` authorization may sit behind a floor-guarded snapshot batch.

Each hole closes with a sentence-level AD tightening. No new decision is needed except H-2, where the operator must confirm which of two existing texts wins. No Critical finding.

## Critical

None.

## High

### H-1. Two owners of the "structure-derived check is unprovable" outcome; `global_index` is computable without structure

**Where:** AD-9 line 157 (new sentences), AD-12 line 175 ("a structure-derived check without `readDocument` (AD-9), is `VALIDATION_RUNTIME_FAILED`"), AD-3 line 64 (check ownership), AD-16 line 292, Story 1.6 C1 and C6-C7 (not in the residuals follow-up list).

**Construction:**

- **Unit A, the snapshot adapter (Story 1.5).** It obeys AD-9 literally: for collection C, where the actor has `read` but not `readDocument`, it "reads no structure or hierarchy input". The snapshot still carries the membership-readable documents and their link maps, because "documents the actor can read through document membership are still evaluated". It emits nothing else, since AD-9 and Story 1.5 C9 say the adapter "does not claim completed checks [or] System Failures".
- **Unit B, the pure core's `global_index` rule (Story 1.6).** It obeys AD-9 sentence 4: it emits `GLOBAL_INDEX_LINK_MISSING` "only when every fact needed to prove it is authorized and resolved". `global_index` needs no `documentStructure`. It needs the surface document, the configured index documents, and the surface's direct links, all of which may be readable through document membership and present in the snapshot. Unit B therefore completes the check, emits a Finding or completes clean, and lists `global_index` in `completedChecks`.
- **Unit B', the core's `hierarchy` rule.** Of the four hierarchy codes, only `PUBLISHED_DOCUMENT_MISSING_FROM_STRUCTURE` needs structure. `PARENT_DOCUMENT_UNRESOLVED`, `HIERARCHY_CYCLE`, and `PARENT_COLLECTION_MISMATCH` are computable from the evaluated documents' `parentDocumentId` and the membership-aware parent resolution, which AD-9 still requires. A literal core treats an absent structure as "zero structure inputs" and runs the other three rules. AD-11 line 169 says "a required check with zero inputs completes vacuously".
- **The shell (Story 1.7)** expects one `VALIDATION_RUNTIME_FAILED` per required structure-derived check, located at the collection.

All units comply, and the result is either `clean` with `completedChecks: [documents, hierarchy, global_index]` or `incomplete` with two System Failures. "Absent structure" and "zero structure inputs" have the same shape in the snapshot contract. Nothing says which unit converts "no `readDocument`" into the System Failure.

**Fix (AD-9, replace the sentence "Without it the adapter reads no structure … located at the collection."):**

> Without it the adapter reads no structure or hierarchy input for that collection, including no `documentStructure` size or existence probe, and marks the collection in the `WikiSnapshot` as `structureAuthorized: false`. That marker is a distinct value from an empty structure. The application shell, not a rule, turns each required `hierarchy` and `global_index` check of a collection marked `structureAuthorized: false` into one `VALIDATION_RUNTIME_FAILED` located `scope { scopeKind: "collection", collectionId }`, without invoking the check's rules, even when the inputs a rule would need are present through document membership. A collection with `structureAuthorized: false` never completes either check vacuously.

Add to the AD-18 delta fixture: "…proving that no structure is read **and that `global_index` and the parent-based hierarchy rules are not run even when their inputs are readable through document membership**."

Add Story 1.6 to the Open PRD residuals follow-up list (see M-6).

### H-2. A scoped collection whose readability lookup fails gets two contradictory codes

**Where:** AD-16 step 1, line 287 ("A denied or missing collection, or a failure of that lookup, is a tool-execution error with no summary"), and AD-11 last sentence, line 169 ("An invalid-policy sentinel's System Failure … is returned whenever its collection is established as actor-readable …; if readability cannot be established, the run adds only the generic snapshot `VALIDATION_RUNTIME_FAILED`"). Also AD-14 line 227 (summary on every non-`isError` path) and AD-12 line 175 (sentinel contributes nothing when unreadable).

**Construction:** a collection-scoped `lint_wiki` targets collection S, whose policy entry is a sentinel. The lookup with memberships (`Collection.findByPk(id, { userId })` in the baseline idiom) is exactly the "readability check" for S, because `can(read)` is synchronous over the loaded memberships. Suppose the lookup throws, for example on a statement timeout.

- **Unit A, admission and scoping (Story 1.7 C7)** follows AD-16 step 1. The result is a tool-execution error with no summary.
- **Unit B, sentinel handling (Story 1.5 C5)** follows AD-11. The result is modeled, `state: failed`, with the generic snapshot `VALIDATION_RUNTIME_FAILED` located `scope { scopeKind: "collection", collectionId }`, and AD-14 requires a `wikiLint.wiki` summary.

Both texts govern "readability of a sentinel's collection cannot be established", and they disagree on result kind (`isError` vs modeled), audit (none vs one), and whether `collectionId` is echoed. AD-12's run-wide location for a collection-scoped request would carry `collectionId` for a collection the actor has not been shown to read. That breaks AD-4 ("every identifier present is actor-authorized") and the memlog item-3 rationale ("echoing an unconfirmed collectionId").

**Fix (AD-11, replace the last clause):**

> …if readability cannot be established, a collection-scoped `lint_wiki` follows AD-16 step 1 (tool-execution error, no summary); a default-scope `lint_wiki` omits that sentinel and adds one generic `VALIDATION_RUNTIME_FAILED` located `scope { scopeKind: "configured_collections" }`; `lint_document` returns the generic document-scope `VALIDATION_RUNTIME_FAILED` of AD-12.

Operator confirmation is needed only if the intent was the modeled reading for scoped requests. In that case AD-16 step 1 must carve the failure out, and the location must drop `collectionId`.

### H-3. "Longest fully completed prefix" now collides deterministically with unprovable checks

**Where:** AD-11 line 169 ("Timeout returns the longest fully completed prefix", "a unit that finished with a partial rule failure keeps its Findings", "Isolated failures do not suppress later independent units", "A unit with a partial failure is not counted as completed"). AD-9 line 157 makes unprovable `hierarchy` and `global_index` units deterministic and common, since every admin-without-membership private collection produces them.

**Construction:** default scope over C1 (no `readDocument`, hierarchy enabled) and C2 (full access). Unit order (AD-11): documents of C1 and C2, then C1.hierarchy (unprovable, System Failure), C1.global_index (unprovable), C2.hierarchy (completes with Findings), C2.global_index. The deadline check before C2.global_index fails.

- **Unit A, the evaluator (Story 1.7 C2-C3)** reads "prefix" as the units started and finished before the failing deadline check. It returns C2.hierarchy's Findings and lists `hierarchy` for C2.
- **Unit B, the result assembler (Story 1.7 C4)** reads "longest fully completed prefix" as the longest leading run of units that completed, and a unit with a System Failure is "not counted as completed". The prefix therefore ends before C1.hierarchy, and C2.hierarchy's Findings and `completedChecks` entry are dropped.

Before the delta this needed a transient failure *and* a timeout. Now it needs only a timeout with any no-`readDocument` collection ahead in key order. The two readings return different Findings for the same input, which breaks determinism (NFR-26, Story 1.7 C11) between implementations.

**Fix (AD-11, replace "Timeout returns the longest fully completed prefix"):**

> Timeout returns every unit that finished before the failing deadline check, in unit order (the prefix), including finished units that carry a System Failure, which keep their Findings but are not counted as completed; a unit not started or not finished is excluded.

Add to AD-18: "`completedChecks` and prefix semantics under a timeout **with an unprovable check earlier in unit order than a completed one**."

### H-4. `lint_document` authorization can sit behind a floor-guarded snapshot batch, leaking a resolved ID

**Where:** AD-10 line 163 (snapshot materializes "scope"; `lint_document` "uses the same mechanism for one document and its authorized dependencies"), AD-11 line 169 (new: `VALIDATION_TIMEOUT` before a snapshot-construction batch of `lint_document`), AD-2 line 56 (policies run in adapters), AD-12 line 175 (run-wide failure carries `documentId` for a document-scoped request), AD-4 line 94 (every identifier is actor-authorized). AD-16 pins "authorize first" for `lint_wiki` only.

**Construction:**

- **Unit A, the `lint_document` adapter (Story 1.3)** performs the document lookup and `can(actor, "read", document)` *inside* the `REPEATABLE READ` snapshot. This is a defensible point-in-time choice that AD-10's "scope" invites. The 9-second deadline starts at tool entry. Pool-acquisition wait, which is charged to the phase, can leave the remainder below the floor before the first batch.
- **Unit B, the shell** applies the new AD-11 mapping, so the result is modeled `VALIDATION_TIMEOUT` located `scope { scopeKind: "document", documentId }`. Story 1.3 C1 accepts URL identifiers, so `documentId` is the *resolved* UUID of a document whose readability was never established.

Both units comply. The result discloses the UUID behind a urlId, and through modeled-versus-`isError` behavior, the existence of an inaccessible document. That violates AD-4 and the CLAUDE.md non-disclosure boundary. Deadline expiry during construction already had this shape before the delta. The delta adds a second, load-reachable trigger and makes it a first-class contract.

**Fix (AD-10, append; mirrors AD-16 step 1):**

> For `lint_document`, document lookup, `can(actor, "read", document)`, and the collection-readability check for AD-12 identity complete before the first floor-guarded snapshot batch; a denial, a missing document, or a failure of these steps is a tool-execution error with no summary; `VALIDATION_TIMEOUT` and the snapshot `VALIDATION_RUNTIME_FAILED` are returned only after the document is established as actor-readable, and only its authorized UUID is echoed.

If authorization must stay inside the snapshot for point-in-time consistency, re-check it inside the snapshot too, but the pre-snapshot check is what gates the modeled result.

## Medium

### M-1. Zero document units plus an unprovable check: `failed` or `incomplete`?

**Where:** AD-11 line 169 ("a required check with zero inputs completes vacuously and is listed in `completedChecks`"), AD-12 line 175 (`incomplete` = "at least one atomic unit completed"; `failed` = "no atomic unit completed"), AD-18 line 304 (new fixture "with and without a document readable through document membership").

**Construction:** a no-`readDocument` collection with no membership-readable documents and document plus hierarchy rules enabled. `documents` is required with zero inputs, so it is vacuously completed and listed. `hierarchy` is unprovable. Under one reading, a vacuous check is a completed unit, so the result is `incomplete`. Under the other, AD-11's atomic-unit list contains document units and per-collection checks, `documents` is not a unit, and zero units completed, so the result is `failed`. The new AD-18 "without" fixture is exactly this input, so Stories 1.5 and 1.7 will pin opposite expectations.

**Fix (AD-12, append to the `incomplete`/`failed` definitions):**

> A vacuously completed check counts as a completed atomic unit; a `documents` check with zero document units is such a check.

The alternative is "does not count". Either is fine, but one must be written.

### M-2. Below-floor during default-scope enumeration or sentinel readability: `TIMEOUT` or `RUNTIME_FAILED`?

**Where:** AD-11 line 169 (below-floor before a snapshot-construction batch is `VALIDATION_TIMEOUT`; readability not established is the "generic snapshot `VALIDATION_RUNTIME_FAILED`"), AD-16 step 3 line 289 (enumeration and sentinel readability are listed separately from "snapshot construction"), AD-10 line 163 ("scope" is snapshot content).

**Construction:** after admission, default-scope enumeration and the sentinel readability checks run. One implementer puts them in the snapshot transaction (AD-10 "scope"). For that implementer, a refused batch is `VALIDATION_TIMEOUT`, and under AD-11's sentinel clause the unestablished sentinels also add `VALIDATION_RUNTIME_FAILED`, giving two codes for one event. Another implementer runs them before the snapshot, outside any `SET LOCAL` guard (AD-16 lists them as distinct steps). That implementer never produces the `TIMEOUT`, and a slow lookup hangs until the 60-second deadline. Item 1's purpose, one code per condition so clients branch retry-versus-fault consistently, is defeated.

**Fix (AD-16, step 3, append):**

> Default-scope enumeration and sentinel readability checks are the first batches of the snapshot transaction and are floor-guarded like every other batch; a refusal or deadline expiry there is the single run-wide `VALIDATION_TIMEOUT`, and no `VALIDATION_RUNTIME_FAILED` is added for sentinels whose readability was thereby not established.

Align AD-11's sentinel clause with H-2.

### M-3. `lint_document` "required" checks are undefined against a policy that enables hierarchy rules

**Where:** AD-11 line 169 ("A check is required exactly when at least one enabled rule kind belongs to it"), AD-12 line 175 (`complete` = "every required unit ran"), AD-3 line 64 (`wiki` surface = `lint_wiki` only).

**Construction:** the policy enables `documents` and `hierarchy` rule kinds. The `lint_document` shell (Story 1.3 C5: "cannot emit `complete` until every rule enabled by that policy … has run") derives requiredness from the policy, as AD-11 does. Hierarchy never runs on that surface, so `lint_document` can never be `complete`. A second implementer applies the surface table, and the result is `complete` after the document unit. The enforced-write path (AD-13 "Complete, no Errors") faces the same question. Post-delta, AD-9's `readDocument` sentence ("each required structure-derived check is unprovable") invites a third reading: `lint_document` emits a structure System Failure when the actor lacks `readDocument`.

**Fix (AD-11, after the requiredness sentence):**

> Requiredness is per surface: on `lint_document` and enforced writes the only atomic unit is the document unit, which runs the enabled rule kinds whose `Surfaces` include `document`; `hierarchy` and `global_index` exist only on `lint_wiki`, and the AD-9 `readDocument` condition does not apply to other surfaces.

### M-4. The `VALIDATION_TIMEOUT` definition over-claims the floor

**Where:** AD-3 line 85 ("…or its remainder fell below the code-owned floor before a step that the floor guards (AD-11)"), and AD-11 line 169 (the floor guards P3 and P4, which are row 3; P5 entry, which is row 3; and P7, which is row 5).

**Construction:** the registry owner (Story 1.1) writes the semantic description from AD-3, so the catalogued meaning becomes "any guarded step below floor". The write path (Story 2.3) maps a P3 or P7 below-floor refusal to rows 3 and 5. The registry's "fixed meaning" contradicts the emitted behavior for the same condition, and NFR-23 forbids a code meaning drift after Gate 1.

**Fix (AD-3, `VALIDATION_TIMEOUT` meaning):**

> The server-owned deadline expired, or its remainder fell below the code-owned floor before a P5 related-state batch after P5 began or before a `lint_wiki` or `lint_document` snapshot-construction batch (AD-11).

### M-5. `read` and `readDocument` evaluated at different points in time

**Where:** AD-16 step 1 line 287 (`read` before admission, outside the snapshot), AD-16 line 291 (`readDocument` "inside the snapshot"), AD-12 identity gated on `read`, AD-10 point-in-time.

**Construction:** Unit A (Story 1.7) loads C with memberships at T0, checks `read`, and passes the model into the snapshot. The snapshot evaluates `can(readDocument)` on that preloaded model, so the result is from T0. Unit B (Story 1.5) reloads memberships inside the `REPEATABLE READ` transaction, so its result is from T1. If membership is revoked between T0 and T1, A evaluates structure under stale authority. Under B, the actor may at T1 hold neither `read` nor `readDocument` while identity, `collectionId`, and the policy were already committed to the result from T0. The spine does not say whether `read` is re-checked in the snapshot, or what happens if it fails there.

**Fix (AD-16, the `readDocument` sentence):**

> The AD-9 `readDocument` check, and every membership-aware document and target query, use memberships loaded inside the snapshot transaction; the pre-admission `read` result fixes identity visibility for the whole invocation, and a collection that is no longer `read`-able at snapshot time contributes zero documents and unprovable structure-derived checks, never a disclosure.

### M-6. The follow-up list omits stories that the delta also invalidates

**Where:** Open PRD residuals, line 434 ("Stories 1.3, 1.5, and 1.7 … need a follow-up edit").

**Problem:**

- **Story 1.6** C1 still has hierarchy rules operate on "authoritative collection structure" with no `readDocument` gate, and C7 limits the unprovable System Failure to inaccessible facts. This is the build-side half of H-1.
- **Story 3.4** C5 still lists the three architect items as "none of which is decided or implemented here", with a revisit owner. That is now false.
- **Story 3.2** carries the AD-18 fixture list and must gain the three new fixtures.

**Fix:** "Stories 1.3, 1.5, 1.6, and 1.7 predate …; Story 3.2's AD-18 fixture list and Story 3.4 C5's open architect items also need the follow-up edit."

### M-7. Global-index suppression granularity is still two-way after the AD-12 rewording

**Where:** AD-9 line 157 ("emitted only when every fact needed to prove it is authorized and resolved; otherwise that check is incomplete") and AD-12 line 175 ("An unprovable global-index check … is `VALIDATION_RUNTIME_FAILED`").

**Construction:** a surface has five configured indexes, and one index is inaccessible. Core implementer A emits `GLOBAL_INDEX_LINK_MISSING` for the provable pairs and adds the System Failure, consistent with AD-11's "finished with a partial rule failure keeps its Findings". Implementer B suppresses the whole check, consistent with the AD-12 delta's "unprovable … check", and returns no Findings. Different Findings for one snapshot.

**Fix (AD-9):**

> …Findings for each surface/index pair whose facts are all authorized and resolved are emitted; any unprovable pair adds one generic System Failure for the check, which is then not completed.

The alternative is to suppress all of them. Whichever is chosen, H-1's `structureAuthorized: false` short-circuit suppresses all.

## Low

### L-1. Default scope with no configured collection pays admission

AD-16 step 3 (line 289) puts admission before default-scope enumeration. Step 2's rationale, "because it starts no scan", applies equally to a default request whose readable configured scope is empty, and trivially so when there is no config file at all. Under contention, one implementer returns `not_evaluated`, following Story 1.5 C12 "without scanning", and another returns `failed` with `VALIDATION_RESOURCE_LIMIT_EXCEEDED`.

**Fix:** "A default-scope request when the startup policy set is empty returns `not_evaluated` without admission; otherwise admission precedes enumeration even if enumeration later finds nothing."

### L-2. Slot release versus the audit write

"The slot is released on every terminal path" (line 290) does not say whether the awaited 3-second audit write (AD-15) is inside the slot. The 63-second `lint_wiki` sum in AD-11 includes it, which implies it is inside. Story 1.8 and Story 1.7 can disagree.

**Fix:** "The slot is released after the audit write settles or its bound expires."

### L-3. Structure-node limit accounting

The 10,000-node limit (AD-16 line 292) does not say whether collections marked `structureAuthorized: false` count. A limit checker that issues a size query on `documentStructure` would violate "reads no structure".

**Fix:** "Only structures the adapter is authorized to read count toward the structure-node limit."

### L-4. P5-entry parity claim

The 2026-10-02 Amendment Record row (line 432) and memlog item 1 say the snapshot case matches "write phase P5". The write path maps a below-floor remainder *on entering* P5 to row 3, a tool-execution error, while `lint_document`'s first batch maps to `VALIDATION_TIMEOUT`. The parity holds only for "within P5". This is wording only; say "as within write phase P5".

### L-5. Frontmatter status

`status: draft` (line 8) replaces `final`, while the Amendment Record says "adopted status unchanged". That is consistent, since the record is about AD status, but say in the record whether the document returns to `final` after this review, so later readers do not treat the ADs as unadopted.

## Suggested AD-18 additions (consolidated)

- An unprovable check earlier in unit order than a completed check under a timeout (H-3).
- `global_index` and the parent-based hierarchy rules not run on a `structureAuthorized: false` collection when their inputs are readable through document membership (H-1).
- A scoped sentinel collection whose lookup fails: `isError`, no summary (H-2).
- `lint_document` below-floor before authorization: no modeled result (H-4).
- The zero-document `readDocument`-less collection: the AD-12 state is pinned (M-1).
- Below-floor during default-scope enumeration: exactly one `VALIDATION_TIMEOUT` (M-2).
- `lint_document` with hierarchy rules enabled: `complete` is reachable (M-3).
