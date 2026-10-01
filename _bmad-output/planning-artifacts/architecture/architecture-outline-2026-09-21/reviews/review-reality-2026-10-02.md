# Reality-Check Review: Spine Delta 2026-10-02

- **Artifact:** `ARCHITECTURE-SPINE.md`, uncommitted delta (AD-3 `VALIDATION_TIMEOUT` row, AD-9, AD-10, AD-11, AD-12, AD-16, AD-18, Deferred D-9, Open PRD residuals, Amendment Record 2026-10-02)
- **Lens:** reality check. Every claim the delta makes about baseline code was verified against the working tree, not recalled from memory.
- **Baseline:** HEAD `d01f67066` on `feature/mcp-wiki-linting-v1.10.1`. `git diff --stat 4a5a616a21be800257dc11cef4263d0dd0412156 HEAD -- server shared app` shows only `server/tools/README.md`, so all cited source is v1.10.1 baseline code. The branch is 4 ahead of `origin` and not behind after `git fetch --prune`.
- **MCP SDK:** `yarn.lock:2840-2842` resolves `@modelcontextprotocol/sdk` to 1.29.0. `node_modules` is not installed, so `dist/cjs/server/mcp.js` was read from the published 1.29.0 package on unpkg.
- **Verdict:** **Revise before re-finalizing.** There are no Critical findings. One High finding: the stated baseline premise for the `readDocument` gate is incomplete, and the memlog's rejection of option A depends on it. The decision itself holds up on a different and stronger ground, so the fix is to the rationale and wording, not to the behavior. There are four Medium and four Low findings.

## Claims verified as true

| Claim in delta / memlog | Evidence | Result |
|---|---|---|
| `read` on Collection is true for any same-team admin, including private collections | `server/policies/collection.ts:34-47`. A team mismatch returns false at `:35`, and `user.isAdmin` returns true at `:38-40` before any membership check. | True |
| `readDocument` requires membership on a private collection, with no admin bypass | `server/policies/collection.ts:67-85`. It has no `isAdmin` branch, and `isPrivate \|\| isGuest` goes to `includesMembership` at `:76-81`. | True |
| `collections.documents` authorizes `readDocument` before exposing `documentStructure` | `server/routes/api/collections/collections.ts:169-187` (`authorize` at `:179`, then `getCachedDocumentStructure()` at `:181`) | True for this route |
| The only population with `read` but without `readDocument` is non-member admins on private collections | For non-admins, the `read` predicate (`collection.ts:42-46`) and the `readDocument` predicate (`:72-83`) are identical. They diverge only through the admin branch at `:38-40`. | True. The AD-18 fixture targets exactly this population. |
| Lookup failure, denial, and invalid input surface as `isError` (tool-execution error), never as JSON-RPC errors | In SDK 1.29.0 `mcp.js:103-145`, every throw inside `tools/call` is caught. That includes `McpError(InvalidParams)` from `validateToolInput` (`:169-181`), unknown tools, and disabled tools. The catch returns `createToolError` → `isError: true` (`:155-164`). The only exception is `UrlElicitationRequired`, which lint never raises. Baseline tools also catch and return `error()` → `isError` (`server/tools/util.ts:104-112`, `server/tools/fetch.ts` final `catch`). | True. This is consistent with AD-12 and the Consistency Conventions "Errors" row. |
| `SET LOCAL statement_timeout` / `lock_timeout` inside the AD-10 `READ ONLY` `REPEATABLE READ` snapshot | PostgreSQL allows `SET` in read-only transactions because it is not a data write. | True per PostgreSQL documentation. Not executed here. AD-18 fixtures should exercise it. |
| Artifact references in D-9 and Open PRD residuals | `sprint-change-proposal-2026-10-01.md:3-5` says `status: approved`, `approved: 2026-10-02`. §4.5 is at `:179` and §4.6 at `:201`. Stories 1.3 (`epics.md:335`), 1.4 (`:411`), 1.5 (`:493`), 1.7 (`:645`), 1.10 (`:824`), and 3.3 (`:1502`) exist. | True |

## Critical

None.

## High

### H-1 — `readDocument` is not "the" baseline predicate for exposing `documentStructure`; the stated rationale and the rejection of option A are factually wrong

**Spine:** AD-9 (`ARCHITECTURE-SPINE.md:157`) says structure-derived checks require `readDocument`, "the predicate the baseline `collections.documents` route uses before exposing `documentStructure`". The `.memlog.md` Item 2 entry gives the decision's purpose as "Prevents the adapter exceeding baseline structure exposure". It rejects option A because option A "reads structure beyond baseline".

**Reality:** the baseline is inconsistent. The MCP server that this fork extends already exposes collection structure under `read` alone:

- `server/tools/fetch.ts:162-183`: `fetch` with `resource: "collection"` loads `includeDocumentStructure: true`, authorizes only `read` (`:169`), and returns the **full** `documentStructure` tree, with every node's id, title, and url (`:180-182`). The tool description promises this at `:105` ("the response includes the full hierarchical document tree"). A same-team admin without membership on a private collection therefore receives the whole tree through baseline MCP.
- `server/tools/util.ts:241-286` and `:317-337`: breadcrumbs, which include ancestor document titles, are derived from `getCachedDocumentStructure()` under `can(user, "read", collection)`. The comment at `:244-246` names `read` as the deliberate leak boundary.
- `server/routes/api/collections/collections.ts:538-553`: `collections.export` authorizes `export`, which is `download` → `read` plus team admin (`server/policies/collection.ts:206-216`, `:57-65`). `ExportDocumentTreeTask.ts:415-426` then walks the full `documentStructure`, and `:68-70` exports each document without a per-document check. A non-member admin can therefore export a private collection's structure and content.
- `server/routes/api/documents/documents.ts:911-936`: `documents.documents` returns a document's `documentStructure` subtree (`getDocumentTree`, `:931`) under document `read`. Document membership alone can grant that.

The baseline sites that do use `readDocument` are the dedicated listing paths: `collections.ts:179`, `server/tools/documents.ts:129` and `:348` (`list_documents` and `list_collection_documents`), `documents.ts:311` (`sort=index`), and `server/models/helpers/Filters.ts:475` (the `collectionId` filter).

**Impact:** the operator chose option B on a premise that is half true. Option A, which keeps `read`, would not exceed baseline exposure: it matches `fetch`. An implementer or a later reviewer who is told to "match baseline" can cite `fetch.ts:169` and argue for `read`. The decision record is the authority that is supposed to settle that argument.

**Why B still stands:** under `server/policies/document.ts:21-33`, a document is readable through document membership, through the actor's own draft, or through `can(actor, "readDocument", collection)`. `readDocument` on the collection is therefore exactly the condition under which every published document of the collection is actor-readable. Without it, the actor's authorized graph is a strict subset of the collection's graph:

- A collection-level hierarchy or global-index verdict cannot be proven over a strict subset.
- AD-4 forbids locating a Finding at an unreadable document, so for example `PUBLISHED_DOCUMENT_MISSING_FROM_STRUCTURE` on a document the actor cannot read is impossible to report.

That is a sound and stronger reason, and it does not depend on baseline exposure parity.

**Fix:**
1. In AD-9, replace "the predicate the baseline `collections.documents` route uses before exposing `documentStructure`" with wording along these lines: "the predicate under which every published document of the collection is actor-readable (`server/policies/document.ts:31`), which the baseline's dedicated structure listings (`collections.documents`, `list_collection_documents`) also require. Baseline `fetch` and breadcrumbs expose structure under `read`, and this spine deliberately takes the stricter predicate."
2. Append a memlog correction entry that supersedes "Prevents the adapter exceeding baseline structure exposure" and the reason given for rejecting A. The correction should record that A matches baseline `fetch` exposure and that B is chosen for graph completeness and AD-4 location safety.
3. Optionally, report the `fetch`/`readDocument` inconsistency as a separate baseline observation under D-8, as was done for `authorizeDocumentPublish`. Do not fix it here.

## Medium

### M-1 — "Structure-derived" mislabels three hierarchy codes and the global-index check; only one code needs `documentStructure`

**Spine:** AD-9 (`:157`) and AD-12 (`:175`) call the hierarchy and global-index checks "structure-derived". AD-9 also says that without `readDocument`, "the adapter reads no structure or hierarchy input".

**Reality:**
- `HIERARCHY_CYCLE`, `PARENT_DOCUMENT_UNRESOLVED`, and `PARENT_COLLECTION_MISMATCH` (AD-3, `:75-78`) are computable from `Document.parentDocumentId` and `Document.collectionId` plus membership-aware resolution. Baseline presents both fields to **every** document reader (`server/presenters/document.ts:111-112`, used by `fetch` after a document `read` check at `server/tools/fetch.ts:131`). That includes document-membership readers without collection access.
- Only `PUBLISHED_DOCUMENT_MISSING_FROM_STRUCTURE` (`:77`) needs `documentStructure`.
- `GLOBAL_INDEX_LINK_MISSING` (`:79`; `epics.md` Story 1.6 AC6-7, around `:614-623`) needs the configured surface document's links and the resolution of the configured index IDs. It needs no `documentStructure`. AD-9 already makes this check incomplete unless "every fact needed to prove it is authorized and resolved", so the extra `readDocument` gate on it is redundant.

**Impact:** the gate fails safe, because the check is incomplete and non-clean, never a false clean. But the stated mechanism ("structure") is not the real one, which is graph completeness (H-1). Under the current wording, a non-member admin who can read the surface and every index through document membership cannot pass a global-index check that AD-9's own proof rule would otherwise allow. The task asked whether the gate is consistent with how baseline exposes `parentDocumentId` to document-membership readers. It is not consistent on exposure grounds. It is consistent only on completeness grounds.

**Fix (operator choice):**
- **(a)** Rename the gated set to "collection-graph checks" and state the completeness rationale from H-1. Keep the behavior.
- **(b)** Gate only the `hierarchy` unit on `readDocument`. Let `global_index` rely on AD-9's existing proof rule, which also needs no structure read.

Either way, delete "structure or hierarchy input" in favor of the precise effect: "reads no `documentStructure` for that collection and runs neither of its `hierarchy` / `global_index` units".

### M-2 — "For that collection" is ambiguous for cross-collection parent resolution

**Spine:** AD-9 (`:157`) says "a readable parent outside the evaluated collection resolves, and a cross-collection parent is `PARENT_COLLECTION_MISMATCH`". The new sentence says that without `readDocument`, "the adapter reads no structure or hierarchy input for that collection".

**Reality:** take a document in collection A, where the actor has `readDocument`. Its parent is in collection B, where the actor lacks `readDocument` but can read the parent through document membership (`server/policies/document.ts:25-29`). A's hierarchy unit then has to read the parent row in B, including its `parentDocumentId` and `collectionId`, to emit `PARENT_COLLECTION_MISMATCH`, or to keep walking for `HIERARCHY_CYCLE`. One implementer will read "no hierarchy input for that collection [B]" as forbidding this, which turns a provable MISMATCH into UNRESOLVED. Another will allow it. Both readings fit the text.

**Fix:** scope the prohibition explicitly: "for a collection without `readDocument`, the adapter reads none of that collection's `documentStructure` and runs none of its own `hierarchy` and `global_index` units. Parent and link resolution for other units still follows document `read` through the membership-aware queries." Add one AD-18 fixture: an A-document whose parent is in a `readDocument`-denied collection B and is readable through document membership.

### M-3 — The AD-3 `VALIDATION_TIMEOUT` fixed meaning is broader than the AD-11 mapping

**Spine:** AD-3 (`:85`) defines the code as: the deadline expired, "or its remainder fell below the code-owned floor before a step that the floor guards (AD-11)". AD-11 (`:169`) maps below-floor outcomes by phase: "row 3 in P3 and P4, `VALIDATION_TIMEOUT` in P5, row 5 in P7, and `VALIDATION_TIMEOUT` before a snapshot-construction batch". It also says "a remainder below the floor on entering P5 is row 3, and `VALIDATION_TIMEOUT` requires that P5 began".

**Problem:** P3, P4, and P7 are also "steps that the floor guards", but below-floor there is not `VALIDATION_TIMEOUT`. A registry reader who treats the AD-3 meaning as a sufficient condition will emit the code on those rows. AD-20 says those rows end in `isError` without validation. Separately, "on entering P5 is row 3" sits awkwardly next to "`VALIDATION_TIMEOUT` in P5". The intended reading appears to be: below-floor before a batch *inside* P5 is the code, and below-floor *at* P5 entry is row 3. That reading should be stated.

**Fix:** in AD-3, replace "before a step that the floor guards (AD-11)" with "before a validation batch inside P5 of an enforced write, or before a snapshot-construction batch of `lint_wiki` or `lint_document` (AD-11)". In AD-11, add "after P5 began" to "`VALIDATION_TIMEOUT` in P5".

### M-4 — Open PRD residuals omit Story 1.6, the story the `readDocument` gate changes most

**Spine:** Open PRD residuals (`:434`) lists Stories 1.3, 1.5, and 1.7 as predating the 2026-10-02 amendments.

**Reality:** Story 1.6, "Detect Authorized Hierarchy and Global-Index Defects" (`epics.md:574`), owns the hierarchy and global-index unit outcomes. Its AC7 already defines the generic `VALIDATION_RUNTIME_FAILED` at `scope { collection }` for the global index. It now also needs the `readDocument` precondition and the hierarchy-unit outcome. `grep -n readDocument epics.md` finds no match anywhere, so no story carries the new predicate.

**Fix:** add Story 1.6 to the follow-up list. Story 1.10, the end-to-end acceptance story, likely needs the non-member-admin case as well.

## Low

### L-1 — `readDocument` throws unless memberships are preloaded; the admin `read` path hides this

`server/policies/collection.ts:248-255` asserts with `invariant` (which throws in every environment) that `collection.memberships` and `collection.groupMemberships` are loaded. For admins, `read` returns at `:38-40` before it touches memberships. An adapter that loads collections without the `withMembership` scope therefore passes admin admission and then throws on the AD-9 `readDocument` call for a private collection. The test then shows a generic snapshot `VALIDATION_RUNTIME_FAILED` rather than the intended unit-level outcome. The AD-18 fixture would pass for the wrong reason.

**Fix:** in AD-9 or AD-16, state that in-snapshot collection loads use `Collection.scope(["defaultScope", { method: ["withMembership", actor.id] }])`, as `server/tools/util.ts:317-321` does, or `Collection.findByPk(id, { userId })` (`server/models/Collection.ts:678-683`). The AD-18 fixture should assert that the run is `incomplete` with the failure located at that collection's check and that document units completed. A run that is `failed` with a snapshot-level failure must not pass the fixture.

### L-2 — The AD-16 step 1 message for "denied or missing" is unpinned, and the SDK forwards raw messages

`Collection.findByPk(..., { rejectOnEmpty: true })` throws `EmptyResultError("Collection doesn't exist with id: …")` (`server/models/Collection.ts:703-706`), while a denial throws `AuthorizationError`. The `fetch` and `list_collection_documents` tools therefore tell the client whether a collection is missing or merely denied. `collections.documents` (`collections.ts:176-179`, without `rejectOnEmpty`) returns the same `AuthorizationError` for both. Separately, SDK 1.29.0 `mcp.js:144` returns `error.message` verbatim for any uncaught throw, so a database failure during the lookup could surface driver text.

**Fix:** pin AD-16 step 1 to one uniform denial result for missing and denied collections (look up without `rejectOnEmpty`, then `authorize`). Map a non-application lookup failure to the AD-20 fixed message.

### L-3 — A non-member admin can get a vacuous `clean` over zero documents

AD-11 lets a required check with zero inputs complete vacuously. AD-9 lets a non-member admin with only document rules enabled receive `clean`. Together they mean that an admin with no document memberships in a private collection gets `complete: true, clean: true, evaluatedDocumentCount: 0` for that collection. The residual is recorded and consistent with the PRD, but the spine's wording ("over the documents it can read") does not make the zero case visible.

**Fix:** add "including zero" to the AD-9 residual sentence. Add an AD-18 case asserting the counts so clients are shown that they must read `evaluatedDocumentCount`.

### L-4 — Admission authorizes outside the snapshot; the gate runs inside it

AD-16 step 1 evaluates `read` before admission, outside the AD-10 transaction. AD-9 evaluates `readDocument` inside it. A collection deleted, or a membership changed, between those two points is not assigned an outcome.

**Fix:** state that the snapshot re-reads the collection and re-evaluates `read` under the snapshot. If the re-evaluation fails, the result is the generic snapshot `VALIDATION_RUNTIME_FAILED` with `state: failed`. That matches AD-10's "inability to establish" clause, and no collection identity is echoed.

## Out of scope, noted

`sprint-change-proposal-2026-10-01.md:24` says the `epics.md` replan "is not committed". It was committed in `d01f67066`. This is stale prose outside the spine delta.
