# Confirmation Review: Spine Delta 2026-10-02 After First-Round Fixes

- **Target:** `ARCHITECTURE-SPINE.md`, working tree (`updated: '2026-10-02'`, `status: final`), uncommitted delta against `HEAD` `d01f67066`.
- **Rationale read:** the last nine `.memlog.md` entries, which cover the direction, items 1 to 4, the item-2 correction and reconfirmation, the FR-12 reading, and the reviewer-gate fix list.
- **First-round reviews:** `reviews/review-{adversarial,rubric,reality,reconcile}-2026-10-02.md`.
- **PRD cross-read:** `prd.md` FR-7, FR-11, FR-12 and its capability criteria, NFR-6, NFR-10, NFR-11, and NFR-23.
- **Repository state:** branch `feature/mcp-wiki-linting-v1.10.1`. After `git fetch --prune` it is 4 ahead of `origin` and 0 behind. Only the spine and the memlog are modified, and the review files are untracked.
- **Lenses:**
  1. Closure of every Critical, High, and Medium first-round finding, judged against the current spine text.
  2. An adversarial pass on the fix text itself: two units one level down that obey every AD and still build incompatibly.
- **Not re-raised (accepted residuals):**
  - An admin may get `clean` over the documents it can read through document membership when only document rules are enabled, including the zero-document case.
  - The FR-12 clarification is a non-blocking residual.

## Verdict

**Not ready to commit as final. One sentence-level Critical blocks, and everything else is Medium or Low.** The first round is substantially closed. All four adversarial Highs, both rubric Highs, the reality High, and the reconcile Critical (through the operator's FR-12 reading) are closed.

One of the fixes introduces a direct contradiction. The new AD-10 `lint_document` pre-snapshot clause makes a failed collection-readability check a tool-execution error. AD-11 and the operator's FR-12 reading make the same event a modeled generic failure, and AD-11 leaves its code ambiguous. The remaining findings are second-order seams in the new AD-11 unit and requiredness text, in AD-16's trailing paragraph, and in the still-broad first clause of AD-3.

| Tier | Count |
| --- | --- |
| Critical | 1 |
| High | 0 |
| Medium | 6 |
| Low | 4 |

## Part 1: Closure of First-Round Findings

Status values:

- **Closed:** the current text resolves the finding.
- **Partial:** part of the finding remains; the reference names this review's finding.
- **Open:** not addressed.
- **Not taken:** a deliberate choice or out of spine scope.

### Adversarial (`review-adversarial-2026-10-02.md`)

| ID | Status | Basis in current spine |
| --- | --- | --- |
| H-1 Owner of the unprovable graph outcome | Closed | AD-9 `graphAuthorized: false` marker: the shell, not a rule, emits the outcome without invoking the rules, even when inputs are readable through document membership, and the check never completes vacuously. The AD-18 fixture covers "no graph rule runs". |
| H-2 Scoped lookup failure gets two codes | Closed | The AD-11 last clause now defers collection-scoped `lint_wiki` to AD-16 step 1, per the operator's FR-12 reading. |
| H-3 Meaning of "prefix" | Closed | AD-11 now says "every unit that finished before the failing deadline check … including finished units that carry a System Failure". An AD-18 fixture was added. The positions of vacuous and marker checks remain open (M-2). |
| H-4 `lint_document` authorization behind a floor-guarded batch | Closed for disclosure | AD-10 clause added. Its collection-readability branch introduces C-1. |
| M-1 Zero document units plus an unprovable check | Closed | AD-11: "counts as a completed atomic unit". The unit position under timeout is M-2. |
| M-2 Below-floor during enumeration | Closed | AD-16 step 3: the first floor-guarded batches and a single run-wide `VALIDATION_TIMEOUT`. The non-floor failure of the same batch is M-1. |
| M-3 `lint_document` requiredness | Closed | AD-11 per-surface requiredness. The zero-applicable-kind edge is M-3. |
| M-4 AD-3 timeout over-claims the floor | Partial | The floor clause is narrowed. The "deadline expired" clause is still unqualified (M-4). |
| M-5 `read` and `readDocument` evaluated at different times | Closed in mechanism | AD-9 loads memberships in the snapshot, and AD-16 fixes identity visibility at the pre-admission `read`. The outcome text conflicts with AD-9 (M-5). |
| M-6 Follow-up list omits stories | Closed | Stories 1.3, 1.5, 1.6, 3.2, and 3.4 are listed. The epics inventory remains (L-4). |
| M-7 Global-index granularity | Closed | AD-9 final sentence: provable pairs emit, and unprovable pairs add one System Failure. |

### Rubric (`review-rubric-2026-10-02.md`)

| ID | Status | Basis |
| --- | --- | --- |
| H-1 Vacuous completion vs AD-9 unprovability | Closed | AD-11 excepts `graphAuthorized: false`. The Amendment Record lists AD-11. |
| H-2 Wrong follow-up stories | Partial | The story list is corrected. The `epics.md` AD inventory (L115, L122) and the Epic 1 implementation note (L181) are not named (L-4). |
| M-1 AD-3 vs the AD-11 phase mapping | Partial | Same as adversarial M-4 (M-4). |
| M-2 AD-16 lookup failure vs the AD-11 readability clause | Closed | AD-11 split by surface. |
| M-3 Admission-rejection result not closed | Partial | "Its only System Failure" was added. The scope and `policies` shape for a scoped rejection is unstated (L-1). |
| M-4 `Binds`/`Prevents` of AD-9 and AD-16 | Closed | Both extended, and the Amendment Record says so. |

### Reality (`review-reality-2026-10-02.md`)

| ID | Status | Basis |
| --- | --- | --- |
| H-1 Wrong baseline premise for `readDocument` | Closed | AD-9 now states the predicate that makes every document of the collection readable. The memlog correction entry is recorded. The optional D-8 note was not taken, which is acceptable. |
| M-1 "Structure-derived" mislabel | Closed | Renamed "collection-graph checks" (option a), and the rule now reads "reads no `documentStructure`". |
| M-2 Cross-collection parent ambiguity | Closed in text | "parents and link targets inside it still resolve by document readability". The suggested fixture (a parent in a `readDocument`-denied collection) was not added to AD-18. |
| M-3 AD-3 vs the AD-11 mapping | Partial | Same as M-4 below. |
| M-4 Story 1.6 omitted | Closed | — |

### Reconcile (`review-reconcile-2026-10-02.md`)

| ID | Status | Basis |
| --- | --- | --- |
| C-1 FR-12 vs AD-16 step 1 | Closed by operator ruling | FR-12 is read as applying inside an established scope. A PRD clarification is an accepted non-blocking residual. |
| H-1 to H-7 Stale epics ACs | Not taken (out of spine scope) | Tracked: the residuals paragraph names the follow-up edit for Stories 1.3, 1.5, 1.6, 3.2, and 3.4. |
| M-1 Load-dependent `not_evaluated` | Partial | An empty startup policy set now short-circuits. A non-empty set with an empty actor-readable scope remains load-dependent, which contradicts AD-16's new `Prevents` (L-2). |
| M-2 Status `draft` | Closed | `status: final`. |
| M-3 `global_index` gated without structure | Closed by rationale | Graph completeness, recorded in the memlog. |
| M-4 Residuals story list | Closed | — |
| M-5 Pilot actor needs `readDocument` | Not taken | This belongs to OD-2/OD-6 and Story 1.10 AC7, not to the spine. It is still worth carrying into the epics follow-up. |

## Part 2: Adversarial Findings on the Fix Text

### Critical

#### C-1. `lint_document` collection-readability failure: tool-execution error (AD-10) vs modeled generic failure (AD-11), with an ambiguous code

**Where:**

- AD-10, new final sentence: "document lookup, `can(actor, "read", document)`, and the collection-readability check for AD-12 identity complete before the first floor-guarded batch; a denial, a missing document, **or a failure of these steps** is a tool-execution error with no summary".
- AD-11, last clause: "if readability cannot be established, … `lint_document` returns the generic document-scope failure of AD-12".
- Memlog FR-12 reading: FR-12 applies "inside an established actor-readable scope (… a lint_document's collection)".
- PRD FR-12: "or as a generic runtime System Failure when the collection's readability cannot be established".
- PRD FR-11: for `lint_document`, the scope is the collection of the readable document, "even when the actor cannot read that collection itself".

**Construction:** a readable document lives in collection S, and S is an invalid-policy sentinel. The document lookup and the document `read` check succeed. The collection membership load that backs `can(actor, "read", collection)` then fails.

- **Unit A, the Story 1.3 `lint_document` shell,** follows AD-10. The result is `isError`, with no summary.
- **Unit B, the Story 1.5 sentinel handling,** follows AD-11 and AD-12. It returns "the generic document-scope failure of AD-12". The only generic document-scope sentinel failure that AD-12 defines is `POLICY_CONFIGURATION_INVALID` at `scope { scopeKind: "document", documentId }`, so the result is modeled `failed`, with a summary.
- **Unit B′** reads FR-12 literally and emits `VALIDATION_RUNTIME_FAILED` at `scope { scopeKind: "document", documentId }`, also modeled.

**Impact:** there are three outcomes for one event:

- The result kind differs (`isError` or modeled).
- The audit differs (no summary or one summary).
- The code differs (an operator escalation or a possibly transient runtime failure).

The AD-10 branch contradicts the operator's own FR-12 reading. In that reading the scope is established, because the document is readable, so FR-12 requires a modeled generic runtime System Failure. A secondary effect: under AD-10, a valid-policy document in the same situation becomes `isError`. Yet AD-12 says `lint_document` "evaluates under the document's collection policy whenever the actor can read the document", and only identity is gated by collection read.

**Fix (AD-10):** replace "a denial, a missing document, or a failure of these steps is a tool-execution error with no summary" with:

> a denial, a missing document, or a failure of the document lookup or the document `read` check is a tool-execution error with no summary; a failure of the collection-readability check is not: the collection is then treated as unreadable for AD-12 identity (no `collectionId`, empty `policies`), evaluation continues under its policy, and an invalid-policy sentinel there yields the generic runtime failure of AD-11

**Fix (AD-11, last clause):** replace "and `lint_document` returns the generic document-scope failure of AD-12" with:

> and `lint_document` returns one generic `VALIDATION_RUNTIME_FAILED` located `scope { scopeKind: "document", documentId }` without `collectionId` (FR-12)

**Fix (AD-18):** add "a `lint_document` whose collection-readability check fails, for a sentinel collection and for a valid one".

### High

None.

### Medium

#### M-1. Default-scope sentinel readability: snapshot failure, or omit the sentinel and continue?

**Where:**

- AD-16 step 3 (new): "Default-scope enumeration and sentinel readability checks are the first floor-guarded batches of the snapshot transaction".
- AD-10: "inability to establish it returns `VALIDATION_RUNTIME_FAILED` … with `complete: false`".
- AD-11: "A snapshot failure or limit excess returns no Findings and `state: failed`".
- AD-11, last clause (new): "a default-scope `lint_wiki` omits that sentinel and adds one generic `VALIDATION_RUNTIME_FAILED` located `scope { scopeKind: "configured_collections" }`".

**Construction:** in default scope, readability is synchronous `can(read)` over memberships loaded by one batch. "Readability cannot be established" therefore means that batch failed (not a floor refusal).

- **Unit A** treats the failure as a snapshot failure, which is forced anyway inside a `REPEATABLE READ` transaction without a savepoint. The result is `failed`, no Findings, one System Failure.
- **Unit B** follows the AD-11 clause. It wraps the batch in a savepoint, omits the sentinel, adds the `configured_collections` failure, and lints the other collections. The result is `incomplete`, with Findings.

The clause also leaves open whether it adds one failure per unestablished sentinel or one per run. The results, counts, and `byCode` audit all differ.

**Fix (AD-11, replace the default-scope part of the last clause):**

> a default-scope `lint_wiki` establishes readability in the AD-16 enumeration batch, so a failure there is a snapshot failure (AD-10): `state: failed`, no Findings, and exactly one run-wide `VALIDATION_RUNTIME_FAILED` located `scope { scopeKind: "configured_collections" }`, or the run-wide `VALIDATION_TIMEOUT` on a floor refusal or deadline expiry;

**Fix (AD-18):** add "a default-scope enumeration batch that fails other than by the floor".

#### M-2. Unit position of vacuous checks and `graphAuthorized: false` checks under a timeout

**Where:**

- AD-11: the unit list is "every document in AD-4 key order, then, for each collection in key order, its hierarchy check followed by its global-index check".
- AD-11: "a required check with zero inputs completes vacuously, counts as a completed atomic unit".
- AD-11: "the deadline is checked before each unit".
- AD-9: "The application shell … turns each required graph check of such a collection into one `VALIDATION_RUNTIME_FAILED`".
- AD-12: `incomplete` means at least one unit completed, and `failed` means none did.

**Construction 1:** default scope over C1 (zero readable documents, document rules enabled) and C2 (100 documents). The deadline check fails before the first document unit of C2.

- **Unit A** completes C1's vacuous `documents` check as soon as the snapshot shows zero inputs. The result is `incomplete`, with `documents` listed for C1.
- **Unit B** gives the vacuous check no position. It is evaluated only after the document units, or never reached. The result is `failed`.

The state changes.

**Construction 2:** C1 is marked `graphAuthorized: false`. The deadline fails before C1's hierarchy turn.

- **Unit A** emits the marker failures eagerly at snapshot time, because they are deterministic.
- **Unit B** emits them at their unit turn, so they are never reached.

The `systemFailures` arrays differ.

**Fix (AD-11, after the requiredness sentence):**

> Every unit, including a vacuous check and a check of a collection marked `graphAuthorized: false`, occupies its position in this unit order and is preceded by the deadline check; a collection's `documents` check with zero document units sits where that collection's first document unit would sort. A check not reached before the failing deadline check is neither completed nor reported: a vacuous check is not listed, and a `graphAuthorized: false` check adds no System Failure.

**Fix (AD-18):** extend the new prefix fixture with "a vacuous check and a `graphAuthorized: false` check after the failing deadline check".

#### M-3. Do document units exist when no document rule is enabled?

**Where:**

- AD-11 lists document units unconditionally ("every document in AD-4 key order").
- AD-11: "A check is required exactly when at least one enabled rule kind belongs to it".
- AD-11 (new): "on `lint_document` and enforced writes the only atomic unit is the document unit, which runs the enabled rule kinds whose AD-3 surfaces include it".
- AD-5 allows a policy whose `rules` are all hierarchy or global-index kinds.

**Construction:** collection-scoped `lint_wiki` on C, marked `graphAuthorized: false`, with only `hierarchy` rules enabled.

- **Unit A** runs every document unit with zero rule kinds, so they complete and are counted. The result is `incomplete`, with `evaluatedDocumentCount` = N.
- **Unit B** skips document units, because the `documents` check is not required. Only the unprovable graph check remains, so the result is `failed` with count 0.

The same split appears on `lint_document` and on enforced-write summaries for such a policy, where `evaluatedDocumentCount` is 1 or 0. It is reachable deterministically now that the marker makes graph checks fail without inputs.

**Fix (AD-11, append to the requiredness sentence):**

> Document units exist only when the `documents` check is required on that surface; otherwise `lint_wiki` runs and counts no document units, and `lint_document` or an enforced write completes with zero counts and no Findings.

#### M-4. AD-3 `VALIDATION_TIMEOUT`: the "deadline expired" clause still over-claims (partial closure of rubric M-1, adversarial M-4, reality M-3)

**Where:**

- AD-3 row: "The server-owned deadline expired, or its remainder fell below …".
- AD-20 P3: "lock or statement timeout … 3".
- AD-11: "persistence (P7, P8) has its own 9-second budget".
- AD-10 (new): a failure of the `lint_document` pre-snapshot steps is a tool-execution error.

**Construction:** the write validation deadline starts at P3. Expiry during P3 lock wait or P4 projection is row 3 under AD-20. A Story 1.1 registry reader who takes the AD-3 meaning as sufficient emits `VALIDATION_TIMEOUT`, which feeds AD-13 as fail-open-eligible. That is exactly the outcome the item-1 rejection of option C protects against. The same applies to expiry during the `lint_document` pre-snapshot lookup, which AD-10 makes `isError`, and to expiry of the persistence budget in P7, which is row 5. Only the floor half of the definition was narrowed.

**Fix (AD-3 `VALIDATION_TIMEOUT` meaning):**

> The server-owned deadline expired during `lint_wiki` or `lint_document` snapshot construction or unit evaluation, or during an enforced write's P5 after P5 began, or its remainder fell below the code-owned floor before a P5 related-state batch after P5 began, or before a `lint_wiki` or `lint_document` snapshot-construction batch (AD-11). Expiry or a below-floor remainder in the AD-10 `lint_document` pre-snapshot steps, the AD-16 step-1 lookup, or write phases P2 to P4, P7, and P8 is not this code.

#### M-5. AD-16 "contributes zero documents" contradicts AD-9 evaluation through document membership

**Where:**

- AD-16 trailing paragraph (new): "a collection no longer readable at snapshot time contributes zero documents and unprovable graph checks".
- AD-9 (new): the marker "affects only that collection's own graph checks: its documents readable through document membership are still evaluated as document units".
- AD-9: membership-aware queries use memberships "loaded inside the snapshot transaction".

**Construction:** a scoped request passes `read` before admission. Collection membership is then revoked, but the actor keeps a document membership on D in that collection.

- **Unit A, the snapshot adapter,** follows AD-9's natural mechanism. It runs the membership-aware document query, so D is evaluated. In-snapshot `readDocument` is false, so the collection is marked.
- **Unit B** follows AD-16 literally and contributes zero documents.

The Findings and counts differ. Under Unit B, document rules only, and no documents, the `documents` check is vacuous, so the result is `clean` while D's Errors are dropped.

**Fix (AD-16):** replace "contributes zero documents and unprovable graph checks, never a disclosure" with:

> contributes only the documents its membership-aware queries return at snapshot time, its graph checks are unprovable exactly as under `graphAuthorized: false` (AD-9), and nothing else of it is disclosed

#### M-6. Pre-scope lookups have no statement bound and no uniform denial contract

**Where:**

- AD-10 (new): the `lint_document` lookup and checks run before the first floor-guarded batch.
- AD-16 step 1 (new): the scoped collection lookup runs before admission.
- AD-11: `SET LOCAL` is issued "at each phase boundary of an enforcement transaction and before each batch of snapshot construction". It covers neither lookup.
- AD-11 `Prevents`: "transport aborts without a result".
- AD-20 fixed-message rule (write paths only).

**Construction:**

- **Unit A** runs the lookup bare. With no per-process statement timeout, which AD-11 says is absent in all-in-one deployments, a stalled query runs until the 65-second transport cut. The client gets no result.
- **Unit B** wraps the lookup in a short transaction with `SET LOCAL statement_timeout` from the remainder. The client gets `isError` within the deadline.

On messages:

- `Collection.findByPk(…, { rejectOnEmpty: true })`, the baseline `fetch` idiom, returns "Collection doesn't exist with id …".
- The `collections.documents` idiom returns a uniform `AuthorizationError`.

The first idiom distinguishes "missing" from "denied" for an actor-supplied ID, which shows that an inaccessible collection or document exists (NFR-11). A database failure can surface driver text through the SDK's `error.message` passthrough (reality L-2, left open).

**Fix (AD-11, after the `SET LOCAL` sentence):**

> The AD-10 `lint_document` pre-snapshot steps and the AD-16 step-1 lookup run in a short read-only transaction with `SET LOCAL statement_timeout` and `lock_timeout` from the monotonic remainder of the surface deadline; expiry or a below-floor remainder there is a tool-execution error with no summary. A missing and a denied document or collection return the same authorization-denial error, and every non-application failure in these steps returns the AD-20 fixed message.

**Fix (AD-18):** add "a stalled pre-scope lookup on both read surfaces, and identical errors for a missing and a denied target".

### Low

#### L-1. The shape of a scoped admission rejection is unstated (partial closure of rubric M-3)

AD-16 step 3 fixes "only System Failure, no Findings, and zero counts". AD-14 gives a single valid-policy collection scope its policy fields. AD-12 does not say whether `policies` carries that collection's identity when the request is rejected before the snapshot. One unit echoes the identity, because the `read` check passed in step 1, and another returns empty `policies`.

**Fix (AD-16 step 3, append):**

> A rejected collection-scoped request carries `scope { kind: "collection", collectionId, zero counts, completedChecks: [] }` and that collection's `PolicyIdentity`; a rejected default-scope request carries `collections: []` and empty `policies`.

#### L-2. The AD-16 `Prevents` clause over-claims

"a result kind that depends on load" is false by construction for admitted requests. A default-scope request whose startup policy set is non-empty, but whose actor-readable scope holds nothing, returns `not_evaluated` when idle and `failed` with `VALIDATION_RESOURCE_LIMIT_EXCEEDED` under contention (reconcile M-1, second half).

**Fix:** change the `Prevents` text to "a denial or identity result that depends on load". Optionally note the residual in the Open PRD residuals paragraph against FR-11.

#### L-3. Terminology in AD-9

- "Collection admission and identity stay on `can(actor, "read", collection)`" reuses "admission", which AD-16 now reserves for the scan slot (reconcile L-1, open).
- "For a global-index check with all inputs authorized" reads as contradicting "any unprovable pair" in the same sentence.

**Fix:** "Collection inclusion and identity stay on …", and "For a global-index check of a collection not marked `graphAuthorized: false`, …".

#### L-4. The residuals paragraph omits stale `epics.md` non-story text (partial closure of rubric H-2)

`epics.md` L115 (the AD-9 summary has no `readDocument` gate) and L122 (the AD-16 summary has no admission order) still predate the amendment. So does L181: "Before Stories 1.3, 1.5, and 1.7 are implemented, the Architect reviews the three items".

**Fix:** append to the Open PRD residuals sentence: "…; the `epics.md` AD-9 and AD-16 inventory summaries and the Epic 1 implementation note also need the follow-up edit."

## Checks That Passed

- **AD-12 state algebra.** It stays closed under the new marker. A marked check is never vacuous, never completed, and is located `scope { collection, collectionId }` with an identity already authorized through `read`. Sentinel collections have no required checks, so nothing vacuous arises from them.
- **AD-4 locations and order.** The new failures use `scope` locations already defined. The `configured_collections` failure has no collection ID and sorts last.
- **AD-13 and AD-20.** The write path is unaffected apart from M-4. Per-surface requiredness keeps graph checks off writes. `VALIDATION_RESOURCE_LIMIT_EXCEEDED` stays `lint_wiki`-only, as AD-3 and AD-13 agree.
- **AD-14 consistency:**
  - Admission rejection is a modeled `failed` result with one summary.
  - A scoped sentinel or unconfigured request without admission is modeled with a summary, and policy fields are omitted for a sentinel.
  - An empty policy set gives modeled `not_evaluated` with a summary.
  - A pre-scope denial is `isError` with no summary.
- **NFR-23.** The widened `VALIDATION_TIMEOUT` meaning is not shipped and is fixed before Gate 1. M-4 is about precision, not a semantic change.
- **NFR-11.** With C-1 and M-6 fixed, no new path echoes an unauthorized ID. The `lint_document` modeled failures echo only a pre-authorized document ID.
