# Second Confirmation Review: Spine Delta 2026-10-02 After Confirmation-Round Fixes

- **Target:** `ARCHITECTURE-SPINE.md`, working tree (`updated: '2026-10-02'`, `status: final`), uncommitted delta against `HEAD` `d01f67066`.
- **Rationale read:** the last `.memlog.md` entry ("Confirmation-round fixes"), plus the FR-12 reading and the item 1 to 3 decisions.
- **Previous review:** `reviews/review-confirm-2026-10-02.md` (1 Critical, 0 High, 6 Medium, 4 Low).
- **PRD cross-read:** `prd.md` FR-1, FR-4, FR-7, FR-11, FR-12, FR-19, NFR-6, NFR-8, NFR-10, NFR-11, and NFR-23. The `epics.md` Stories 1.3, 1.5, and 1.7 were checked only for drift that the residuals paragraph claims to track.
- **Repository state:** branch `feature/mcp-wiki-linting-v1.10.1`. After `git fetch --prune` it is 4 ahead of `origin` and 0 behind. The spine and memlog are modified, and the review files are untracked.
- **Lenses:**
  1. Closure of every finding in the previous review, judged against the current text.
  2. An adversarial pass limited to text introduced or changed by those fixes, checked against itself, against the untouched AD-4, AD-12, AD-14, and the AD-20 fixed message, and against the PRD.
- **Fixed operator decisions (not re-litigated):**
  - A below-floor snapshot batch is `VALIDATION_TIMEOUT`.
  - Collection-graph checks need collection `readDocument`; otherwise the shell emits a generic `VALIDATION_RUNTIME_FAILED` (`graphAuthorized: false`).
  - The AD-16 `lint_wiki` admission order.
  - FR-12 is read as applying inside an established scope.
- **Accepted residuals (not re-raised):**
  - An admin may get `clean` over the documents it can read through membership when only document rules are enabled.
  - The FR-12 clarification is non-blocking.
  - FR-11 `not_evaluated` versus `failed` under contention.

## Verdict

**Not ready to commit as final. One sentence-level High blocks; everything else is Medium or Low.** All eleven findings of the previous review are closed or closed with a small remainder.

Two of the fixes collide with each other. The new AD-10 carve-out says a failed `lint_document` collection-readability check is not a tool-execution error. The new AD-11 pre-scope sentence says that expiry, a below-floor remainder, or any non-application failure in "these steps" (which include that check) is one. For a sentinel collection, one of the two compliant readings contradicts the operator's FR-12 reading. The fix is one clause in AD-11.

| Tier | Count |
| --- | --- |
| Critical | 0 |
| High | 1 |
| Medium | 1 |
| Low | 5 |

## Part 1: Closure of the Previous Review's Findings

| ID | Status | Basis in current spine |
| --- | --- | --- |
| C-1 `lint_document` collection-readability failure | Closed | AD-10 now carves the readability check out of the tool-execution-error branch: identity is withheld and evaluation continues. The AD-11 last clause gives the sentinel case one `VALIDATION_RUNTIME_FAILED` at `scope { scopeKind: "document", documentId }` without `collectionId`. The AD-18 fixture covers both the sentinel and the valid case. Story 1.3 AC8 already matches. The carve-out collides with the new M-6 text (H-1). |
| M-1 Default-scope readability failure | Closed | AD-11: readability is established in the enumeration batch, and a failure there is a snapshot failure (`failed`, no Findings, exactly one run-wide `VALIDATION_RUNTIME_FAILED` at `configured_collections`, or `VALIDATION_TIMEOUT`). This is consistent with AD-16 step 3, with AD-12 run-wide locations, and with Story 1.7 AC8 ("absence of any sentinel whose readability was not established"). AD-18 fixture added. |
| M-2 Unit position under timeout | Closed | AD-11: every unit, including vacuous and `graphAuthorized: false` checks, has a position and a preceding deadline check. A zero-document `documents` check sits at the collection's first document-unit position. Unreached checks are neither listed nor reported. AD-18 fixture added. This is consistent with AD-9's "never completes vacuously" and with the AD-12 state algebra. |
| M-3 Document units without document rules | Closed | AD-11: document units exist only when `documents` is required. A remainder about the snapshot requirement is L-3. |
| M-4 AD-3 `VALIDATION_TIMEOUT` over-claims | Closed | The AD-3 row now matches the proposed text verbatim. It is consistent with AD-11 (row 3 on entering P5; `VALIDATION_TIMEOUT` requires that P5 began), with AD-13 (half-deadline eligibility), and with AD-20 P3/P4/P7. A remainder about the stop margin is L-2. |
| M-5 AD-16 "contributes zero documents" | Closed | The AD-16 trailing paragraph now keeps the membership-aware documents and makes the graph checks unprovable "exactly as under `graphAuthorized: false`". This matches the AD-9 mechanism (memberships loaded in the snapshot). Identity stays fixed by the pre-admission `read`. |
| M-6 Pre-scope lookups unbounded and non-uniform | Closed for its own concerns | AD-11 adds a short read-only transaction with `SET LOCAL statement_timeout`/`lock_timeout` from the remainder, a tool-execution error on expiry, the same error for missing and denied targets, and the AD-20 fixed message. The AD-18 fixture is added. The sentence introduces H-1 (collision with the C-1 carve-out) and M-1 (separate transaction). |
| L-1 Scoped admission-rejection shape | Closed | AD-16 step 3 gives both shapes. Only valid-policy collections reach admission (step 2), so "that collection's `PolicyIdentity`" is always a valid identity. This is consistent with AD-12, with AD-14 read policy fields, and with Story 1.7 AC7. |
| L-2 AD-16 `Prevents` over-claim | Partial | Narrowed to "a denial or identity result that depends on load". The default-scope identity half still over-claims (L-5). |
| L-3 AD-9 terminology | Closed | "Collection inclusion and identity …"; "For a global-index check of a collection not marked `graphAuthorized: false` …". |
| L-4 Residuals omit the epics inventory | Closed | The residuals paragraph names the `epics.md` AD-9/AD-16 summaries and the Epic 1 note. A remainder about the newer deltas is L-4 below. |

Carried from the first round and not re-raised: the reality M-2 fixture (a parent in a `readDocument`-denied collection) is still absent from AD-18. The behavior text is closed.

## Part 2: Adversarial Findings on the Fix Text

### Critical

None.

### High

#### H-1. A failed `lint_document` collection-readability check is both modeled (AD-10) and a tool-execution error (AD-11)

**Where:**

- AD-10 (new): "a failure of the collection-readability check is not [a tool-execution error]: the collection is then treated as unreadable for AD-12 identity …, evaluation continues under its policy, and an invalid-policy sentinel there yields the generic runtime failure of AD-11".
- AD-11 (new): "The AD-10 `lint_document` pre-snapshot steps … run in a short read-only transaction with `SET LOCAL statement_timeout` and `lock_timeout` …; expiry or a below-floor remainder there is a tool-execution error with no summary. … every non-application failure in these steps returns the AD-20 fixed message."
- AD-3 (new): "Expiry or a below-floor remainder in the `lint_document` pre-snapshot steps (AD-10) … is not this code."
- The AD-10 pre-snapshot steps are defined as "document lookup, `can(actor, "read", document)`, and the collection-readability check".

**Construction:** a readable document lives in sentinel collection S. The document lookup and the document `read` check succeed. The membership load behind `can(actor, "read", collection)` then hits its `statement_timeout`, or fails with a connection error, or the remainder is below the floor before it.

- **Unit A, the Story 1.3 pre-scope helper,** follows AD-11. The step is one of "these steps", so the result is `isError` with the fixed message, no summary, and no lint result.
- **Unit B, the Story 1.3 identity logic,** follows AD-10. The readability check failed, so identity is withheld. The sentinel yields a modeled `failed` result with one `VALIDATION_RUNTIME_FAILED` at document scope, plus a summary.

For a valid-policy collection the split is `isError` versus a modeled result. If the remainder is exhausted, that modeled result is a `VALIDATION_TIMEOUT` from the first snapshot batch, which AD-3's exclusion clause makes doubtful as well.

**Impact:**

- The result kind, the audit (FR-19: modeled → one summary; `isError` → none), and the code all differ.
- Unit A contradicts the operator's FR-12 reading. The scope of a `lint_document` is established, and FR-12 requires "a generic runtime System Failure when the collection's readability cannot be established". A statement timeout or a database failure on the membership load is exactly that case.
- The previous review's C-1 was this same divergence over a wider set of causes. The specific-over-general reading favours AD-10, but AD-11 names the step set explicitly and AD-3 echoes it, so a careful implementer can follow either.

**Fix (AD-11):** after "expiry or a below-floor remainder there", insert "other than in the `lint_document` collection-readability check, which follows AD-10,". Then change "every non-application failure in these steps" to "every non-application failure in these steps other than that check".

**Fix (AD-3, optional):** change "the `lint_document` pre-snapshot steps (AD-10)" to "the `lint_document` document lookup and document `read` check (AD-10)".

### Medium

#### M-1. The separate pre-scope transaction leaves a gap between authorization and the `lint_document` snapshot

**Where:**

- AD-11 (new): the pre-snapshot steps run "in a short read-only transaction".
- AD-10: `lint_document` "uses the same mechanism for one document" (one `REPEATABLE READ` snapshot), and `complete: true` "is permitted only when every required input came from that snapshot".
- PRD NFR-6: a Clean Result describes "one coherent observed state".

**Construction:** the pre-scope transaction resolves document D in collection C1 (valid policy P1, readable, so identity is C1). Before the snapshot transaction begins, D is moved to C2 (policy P2), or deleted.

- **Unit A** runs two transactions, as "short" implies. It evaluates D's current content under P1 and reports C1's identity. The result can be `clean` under P1 while D now sits in a P2 collection where it has Errors. A deleted D surfaces as an undefined snapshot outcome.
- **Unit B** runs the pre-snapshot statements as the first, non-floor-guarded statements of the snapshot transaction. It sees one state.

The Findings, the identity, and possibly `clean` differ. Unit A's `clean` mixes two observed states. The race window is small, but the spine handles the analogous `lint_wiki` drift explicitly (AD-16 trailing paragraph), and the write path handles it through `collection_conflict`. `lint_document` now has no rule.

**Fix (AD-10, append):** "The snapshot re-reads the document's `collectionId` and deletion state; if the document is gone or its collection differs from the pre-snapshot one, the result is a snapshot `VALIDATION_RUNTIME_FAILED` echoing only the authorized document ID." Alternatively, AD-11 can allow the pre-snapshot steps to be the opening statements of the snapshot transaction.

### Low

#### L-1. AD-12's unreadable-sentinel sentence lacks the readability-failure exception

AD-12 still says that a sentinel in a collection the actor cannot read "yields the generic `POLICY_CONFIGURATION_INVALID` located `scope { scopeKind: "document", documentId }`". AD-10 says a failed readability check is "treated as unreadable for AD-12 identity" and then overrides the code. A reader who stops at AD-12 emits the wrong code. AD-10 and AD-11 are explicit, and Story 1.3 AC8 is correct, so no compliant unit diverges.

**Fix (AD-12):** append "(when readability cannot be established, AD-11's `VALIDATION_RUNTIME_FAILED` applies instead)".

#### L-2. The AD-3 `VALIDATION_TIMEOUT` enumeration omits the `lint_wiki` stop margin

AD-11 stops starting units "when less than a code-owned margin … remains". That happens before the deadline expires and is not the `SET LOCAL` floor (D-9 lists the margin and the floor separately). The new AD-3 row is written as an exhaustive "during … / before …" list and covers neither the margin stop nor a failing deadline check between units. The intended code is not in doubt, because no alternative exists.

**Fix (AD-3):** add "or, in `lint_wiki`, the remainder fell below the AD-11 stop margin before a unit".

#### L-3. A surface with no required check: is a snapshot still built?

The new AD-11 sentence says that `lint_document` or an enforced write with no `documents` check "completes with zero counts and no Findings". AD-10 still says that `lint_document` builds a snapshot.

- **Unit A** builds the snapshot first. It returns `failed` (`VALIDATION_TIMEOUT` or `VALIDATION_RUNTIME_FAILED`) on a below-floor remainder or a batch failure.
- **Unit B** short-circuits to `complete`/`clean`.

This is reachable only for a policy with graph rules alone. Relatedly, a graph-only `lint_wiki` reports `evaluatedDocumentCount: 0` even though the graph checks inspected documents. That is deterministic and allowed by FR-19's "where applicable", but it is worth a sentence.

**Fix (AD-11):** "with no required check, no snapshot is built".

#### L-4. The residuals paragraph's citation and story-drift list

- "FR-11 permits this because a resource System Failure may make any read result `failed`": the supporting PRD text is FR-1 ("Any System Failure makes a read-only result non-clean and incomplete or failed as applicable"), not FR-11. Cite FR-1.
- "(below-floor snapshot code, graph checks without `readDocument`, admission order, and the three settled architect items)": the first three are the architect items. "The three settled architect items" was probably meant to be the confirmation-round clarifications.
- Those confirmation-round deltas also drift from stories not described as needing them:
  - Stories 1.3 AC9 and 1.5 AC2 return "baseline content" for a missing or denied target, but AD-11 now requires the same denial error for both.
  - Story 1.7 AC7 keeps "the baseline Tool-Execution Error behavior" for a lookup failure, but AD-11 now requires the AD-20 fixed message.
  - Story 1.7 is described only as "already states the admission order", which is true but no longer sufficient.

**Fix:** name the uniform denial error, the pre-scope bounds, and the `lint_document` readability-failure path among the follow-up items, and add Story 1.7.

#### L-5. AD-16 `Prevents` still over-claims for default scope

An idle default-scope request returns the `PolicyIdentity` and sentinel failures of the readable collections. An admission-rejected one returns `collections: []`, empty `policies`, and no sentinel (the new L-1 shape). That is an identity result that depends on load. It follows from the fixed admission order and the FR-1-permitted `failed`, so only the `Prevents` wording is wrong.

**Fix:** "a denial result, or a collection's identity visibility, that depends on load".

A related wording nit: AD-11 says readability is established "in the AD-16 enumeration batch" (singular), and AD-16 says "the first floor-guarded batches" (plural). This causes no divergence, because any failure inside the snapshot transaction is a snapshot failure.

## Checks That Passed

- **AD-3 row versus AD-11, AD-13, and AD-20.** The P5 start rule, the below-floor row 3 on entering P5, half-deadline fail-open eligibility, and the P2–P4/P7/P8 exclusions agree. NFR-23 is unaffected, because the code is unshipped and its meaning is narrowed before Gate 1.
- **AD-4.**
  - The new document-scope `VALIDATION_RUNTIME_FAILED` carries `documentId` and no `collectionId`, as AD-4 requires for a `scopeKind: document` location without collection read.
  - The `configured_collections` failure sorts last.
  - The unit-position rule uses AD-4 key order consistently.
- **AD-12 algebra.**
  - Zero-unit surfaces are `complete` (every required unit ran, vacuously).
  - Unreached checks add neither a completion nor a System Failure, so the state follows the prefix.
  - The admission-rejection shapes match `EvaluatedScope`.
  - Run-wide failures carry the request's scope kind.
- **AD-14.** A `lint_document` readability failure is modeled, so it gets one summary. A valid-policy case keeps the audit policy fields (actor-independent) while the result's `policies` is empty, as AD-14 intends. Pre-scope `isError` paths record no summary, which matches FR-19.
- **AD-20 fixed message.** The extension to the read-side pre-scope steps uses the same "application error with stable `id`" test. Message prose is not a client contract (NFR-23).
- **AD-9 and AD-16 trailing paragraph.**
  - A loss of `read` at snapshot time is treated like `graphAuthorized: false`.
  - Membership-aware documents are retained.
  - Identity stays fixed by the pre-admission `read`.
  - No path echoes an unauthorized ID (NFR-11).
- **PRD.**
  - FR-12 (sentinel paths, given the operator reading and the H-1 fix).
  - FR-7 (default scope is limited to readable collections).
  - FR-4 (an inaccessible document is not exposed; the uniform denial is stricter than baseline and does not loosen NFR-10).
  - FR-19 (summary presence per result kind).
  - None is contradicted by the new text apart from H-1 Unit A.
