# Reconciliation review: companions vs Architecture Spine (2026-09-30 decisions C-3 to C-7)

**Reviewer:** independent, fresh context, read-only. **Date:** 2026-09-30.
**Checked against:** `ARCHITECTURE-SPINE.md` (status final, updated 2026-09-30) and the spine `.memlog.md` decisions C-3, C-4, C-5, C-6, C-7 (plus the AD-8 punctuation fix, which no companion quotes).
**Checked:** `_bmad-output/specs/spec-outline-mcp-wiki-linting/SPEC.md`, `server/tools/README.md`, the `bmad:context` block in `AGENTS.md` (`CLAUDE.md` is a symlink to it), and `_bmad-output/planning-artifacts/epics.md`.
**Authority applied:** PRD > PRD addendum > spine > SPEC > README/repo instructions. The PRD was read only where needed to decide whether a suggested companion edit would contradict a higher-authority document.

## Verdict

**Reconciliation incomplete.** None of the four companions absorbed the second 2026-09-30 batch (C-3 to C-7), and SPEC.md still names AD-1 through AD-19 as the adopted set although AD-20 is now adopted. The first 2026-09-30 batch (enforced-write applicability and invalid-policy classification) did land correctly in SPEC, README and AGENTS. Most residual defects are omissions, not contradictions, but 20 passages conflict with or are stale against the spine (6 High, 9 Medium, 5 Low). The epics carry the most hard conflicts, which is expected for a stale-by-design file.

**Constraint on the fix.** The spine (Pending PRD alignment, line 381) says C-3, C-5 and C-6 still contradict the PRD and that the PRD controls until a separately authorized PRD amendment. Suggested SPEC and README wording below therefore points at the spine rather than restating C-3, C-5 or C-6 as companion-owned rules, and uses only claims the current PRD already supports (for example FR-12: "Read-only operations affected by invalid configuration never report a Clean Result").

## Count

| File | High | Medium | Low | Total |
| --- | --- | --- | --- | --- |
| SPEC.md | 1 | 1 | 1 | 3 |
| README.md | 1 | 1 | 1 | 3 |
| AGENTS.md block | 0 | 2 | 1 | 3 |
| epics.md (acceptance criteria) | 4 | 5 | 2 | 11 |
| **Total** | **6** | **9** | **5** | **20** |

## 1. Conflicting or stale passages

### SPEC.md

**S-1 (High). AD-20 not adopted; the ID range is stale.**
- `SPEC.md:58`: "Adopt Architecture Spine identifiers `AD-1`, ..., `AD-18`, and `AD-19` unchanged; their detailed decisions live only in the adopted companion."
- `SPEC.md:72`: "...while conforming to `AD-1` through `AD-19`."
- Conflicts with: AD-20 `[ADOPTED]` (spine line 288), the Capability map rows for enforcement and audit (spine lines 355 to 356), and the C-6 decision.
- Effect: `SPEC.md:72` is the Gate 1 conformance sentence. A validator can declare readiness while ignoring the post-classification failure table, the two aborted outcomes, and the committed-write-always-succeeds rule.
- The SPEC `.memlog.md` (lines 22 and 29) carries the same "AD-1 through AD-19 unchanged" claim. It is not one of the companions checked but will mislead a future SPEC update.

**S-2 (Medium). CAP-6 "per attempt" no longer matches the audit boundary.**
- `SPEC.md:44` to `46` (CAP-6): "...validation attempts, including invalid-policy rejections." / "Normal operation records exactly one retrievable minimized summary per attempt".
- Conflicts with: AD-14 "Aborted attempts" and "A collection-change conflict and any failure before AD-8 classification record no summary" (spine lines 254 to 256), and AD-20 rows 1 to 3 and 5 (spine lines 296 to 300). "Attempt" is now defined by AD-20 (the AD-13 decision is the boundary). Aborted attempts after classification are recorded, while row 1 and row 2 failures are not.
- Effect: a builder can read "per attempt" as "every failed MCP write" or as "only the four Validation Statuses".

**S-3 (Low). "Always returning `degraded_validation`" is unqualified.**
- `SPEC.md:54`: "...may fail open only for its eligible failure class through explicit per-collection policy, always returning unmistakable `degraded_validation`."
- Conflicts with: AD-20 row 5, where a persist decision that does not commit returns a protocol error with no `validation` and outcome `aborted_after_decision`. Only row 6 (committed) returns `degraded_validation`.
- Effect: cosmetic if "fail open" is read as "commits". Otherwise it implies a modeled result for a write that rolled back.

### server/tools/README.md

**R-1 (High). The only concrete response example contradicts AD-3, AD-4 and AD-12.**
- `README.md:59` to `75`: "for example:" followed by `{ "ok": false, "errors": [ { "code": "REQUIRED_FIELD_MISSING", "documentId": "document-id", "line": 7, "path": "Document metadata.Last verified", "message": ... } ], "warnings": [] }`.
- AD-3: `REQUIRED_FIELD_MISSING` is not in the closed registry (the code is `REQUIRED_METADATA_FIELD_MISSING`).
- AD-4: locations are typed objects with `column`, and `path` is an array of string or integer segments. The example uses flat `documentId`/`line` and a dotted string `path` with no `column`.
- AD-12: `Finding` is `{ code, severity, message, location }` and has `severity`. A rejected enforced write is `{ success: false, validation: { status: "rejected", ... } }`, not `{ ok, errors, warnings }`.
- Pre-existing, not introduced by C-3 to C-7. It is High because AGENTS.md (`:6`, `:20`) tells builders that "acceptance criteria live in README", so this example is likely to be copied as the response contract.

**R-2 (Medium). "Required tests" omits the conformance layers the spine now requires.**
- `README.md:169` to `182`.
- Conflicts with: AD-18 (spine line 280), which now requires the following:
  - nested duplicate keys, lone surrogates and non-canonical numbers, with source-byte `invalidFingerprint` stability;
  - the read-only invalid-policy sentinel matrix (document, collection and default scope; readable and unreadable);
  - policy-identity omission for actors without collection read on document-membership updates and parent-bearing draft publication;
  - one fixture per AD-20 row, including post-commit enrichment failure.
- README also lacks the earlier AD-18 layers (projection parity, HTML worker and media, audit), so it cannot serve as the required-tests list.

**R-3 (Low). Link-target wording implies three distinct reports.**
- `README.md:93` to `94`: "report missing, deleted, or inaccessible targets without leaking target metadata".
- AD-2 and AD-3: all three collapse to one `unresolved` value and one code, `INTERNAL_LINK_TARGET_UNRESOLVED`.

### AGENTS.md `bmad:context` block

**A-1 (Medium). Authority statement contradicts the operator's authority order.**
- `AGENTS.md:6`: "Product scope and acceptance criteria live in `server/tools/README.md`".
- `AGENTS.md:20`: "Fork roadmap and acceptance criteria: `server/tools/README.md`".
- Conflicts with: the operator's authority order (README is lowest) and the spine's role as the binding implementation-consistency contract (SPEC.md:50). The block has no pointer to the PRD, spine or SPEC, so an agent that loads only AGENTS.md never learns that AD-20 exists.

**A-2 (Medium). Compatibility rule omits `read_only`.**
- `AGENTS.md:39`: "Unconfigured collections retain upstream behavior."
- Conflicts with: AD-8 "Other writes" (spine line 138): "`read_only` and unconfigured writes retain baseline behavior and response shape". SPEC.md:53 and README.md:167 and 181 to 182 already say "unconfigured and `read_only`".
- The bare "upstream behavior" is also ambiguous for the read tools: unconfigured lint returns `not_evaluated`, not upstream behavior.

**A-3 (Low). Verification stamp predates the spine and both 2026-09-30 amendments.**
- `AGENTS.md:2`: "Verified 2026-09-20 against v1.10.1 commit ... and fork design e5e3f7905. Managed by bmad-project-context."
- The block is now inconsistent with a spine dated 2026-09-21 and amended 2026-09-30.

### epics.md (only acceptance criteria that conflict or did not land)

**E-1 (High). Story 1.2 AC6 defines `invalidFingerprint` over canonical values.** (C-4, AD-6)
- `epics.md:298` to `301`: "Given any valid or parseable-invalid policy value ... Then canonical JSON follows every AD-6 ordering ... And the resulting `policyFingerprint`, `invalidFingerprint`, and `policySetFingerprint` use `sha256:<lowercase-hex>` over the prescribed canonical values."
- AD-6 (spine line 105): `invalidFingerprint` is SHA-256 over the exact UTF-8 source bytes of the entry's JSON value, so it exists for every defect. Canonicalization applies to valid entries only.
- "Parseable-invalid" also excludes exactly the entries C-4 targets (lone surrogates, nested duplicates, exponent or negative-zero numbers). Implemented as written, an uncanonicalizable entry would have no identity.

**E-2 (Medium). Story 1.2 AC2, AC4 and AC5 mishandle duplicate and lexical defects.** (C-4, AD-5)
- `epics.md:278` to `281`: "a duplicate-aware decoder rejects duplicate object keys before materialization."
- AD-5: duplicates at the root or `collections` level block startup, but a duplicate nested inside an identifiable entry, or any lexical defect in it, makes that entry a sentinel. The custom decoder must also report lone surrogates, source number forms and each entry's byte span. AC2 as written can be read as "any duplicate fails startup".
- AC4 (`:288` to `291`) and AC5 (`:293` to `296`) never say that nested duplicates and lexical defects yield a sentinel.

**E-3 (High). Story 1.5 drops readable sentinels from default and scoped `lint_wiki`.** (C-3, AD-12)
- AC3 (`epics.md:466` to `469`): default scope "includes only actor-readable Configured Collections and documents".
- AC10 (`epics.md:501` to `504`): "a scoped readable collection without configured policy, or a default request with no readable Configured Collections ... returns the explicit no-policy state".
- AD-12 (spine line 162): a readable sentinel contributes exactly one `POLICY_CONFIGURATION_INVALID` System Failure located `scope { scopeKind: "collection", collectionId }`, its invalid `PolicyIdentity` and a zero-count scope entry, and completes no atomic unit. A default-scope result containing a sentinel is `incomplete` or `failed`, never clean. `not_evaluated` applies only when the readable scope holds neither a valid policy nor a sentinel.
- Under the PRD glossary a sentinel collection is not a "Configured Collection", so AC3 silently drops it and AC10 returns `not_evaluated`. That is the outcome C-3 forbids. Story 1.5 has no sentinel acceptance criterion at all.

**E-4 (Medium). Stories 2.4 AC1 and AC3 (and 2.1 AC9) omit the C-5 identity condition.** (C-5, AD-12)
- `epics.md:1036` to `1039`: "one exact `validation` object ... its schema version, policy fingerprint, and ordered Finding/System Failure arrays follow AD-12".
- `epics.md:1046` to `1049`: rejection returns `{ success: false, validation }` with no identity rule.
- AD-12 (spine lines 176 to 189): exactly one policy identity (`policyFingerprint` for a valid policy, `invalidFingerprint` for a sentinel) is present only when `can(actor, "read", collection)` holds on the classified collection. Otherwise `collectionId` and identity are omitted and only status, Findings and System Failures remain. The baseline paths that skip the collection-read check (document-membership updates, parent-bearing collectionless draft publication) need explicit fixtures.
- Story 2.1 AC9 (`epics.md:883` to `886`) covers publication of a collectionless draft but says nothing about identity omission.

**E-5 (Medium). Story 2.4 AC2 makes the patch block unconditional.** (C-6, AD-12, AD-20)
- `epics.md:1041` to `1044`: "the baseline final-Markdown content block remains present".
- AD-12 (spine line 191) and AD-20: after commit, a failure assembling optional enrichments (breadcrumb, share URL, patch echo) omits them and still returns success with `validation`.

**E-6 (High). The "Known binding contradictions" paragraph and Story 3.4 AC5 list blockers the spine has closed and omit the ones that remain.** (AD-12, spine line 381)
- `epics.md:1071`: "...AD-12's exact enforced-write response requires `validation.policyFingerprint` and defines no invalid-policy identity variant ... Gate 1 remains `not ready` until separately authorized source amendments reconcile both contracts".
- `epics.md:1419` to `1422` (Story 3.4 AC5): the same two contradictions as "phase-blocking".
- Both are closed. AD-12 now defines the invalid-policy identity variant (`validation.invalidFingerprint`, the "Invalid-policy sentinel" subsection). The `read_only` applicability half is closed by the PRD's Enforced Write, Enforced Collection and Invalid-Policy Collection glossary and FR-14 to FR-16 wording (PRD lines 63 to 80, 279 to 303).
- The blockers the spine actually names (line 381) are FR-4 third consequence, FR-7 first, FR-11 fourth, the read half of CAP-4 (C-3); the FR-16 exception and FR-20 summary content (C-6); and the identity wording in Section 4.5 (C-5). Gate 1 evidence built from this list would trace the wrong contradictions.

**E-7 (High). Story 2.7 covers four outcomes, not six, and the wrong audit boundary.** (C-6, C-7, AD-14, AD-15, AD-20)
- AC1 (`epics.md:1186` to `1189`): "Given any enforced create/update validation attempt ... `validated`, `validated_with_warnings`, `degraded_validation`, or `rejected`".
- AC5 (`epics.md:1206` to `1209`): audit runs "after commit or rejection rollback in an independent transaction".
- AC8 (`epics.md:1221` to `1224`): "cover every status".
- Conflicts with:
  - AD-14: `outcome` also includes `aborted_before_decision` and `aborted_after_decision`, with zero counts and a defined payload.
  - AD-15: audit runs after commit, rejection rollback or AD-20 abort rollback.
  - AD-20: audit for a committed write is initiated immediately after commit and before response assembly.
- AC2 (`epics.md:1191` to `1194`) says only "safe scope" and omits the C-7 rule that every `wikiLint.write_validation` summary has `scopeKind: collection`. No criterion says that a collection-change conflict and any failure before AD-8 classification record no summary. No criterion covers the sentinel-rejection payload (`rejected`, `complete: false`, zero counts, one System Failure, both policy fields omitted).

**E-8 (Medium). Stories 2.2, 2.3 and 2.5 do not carry the AD-20 rows.** (C-6, AD-20)
- Story 2.2 AC7 (`epics.md:949` to `952`): projection failure preserves "existing input/conflict behavior".
- Story 2.3 AC7 (`epics.md:1005` to `1008`): authorization, input, conflict or persistence failure preserves "upstream/protocol semantics".
- Story 2.5 AC3 and AC6 (`epics.md:1099` to `1102`, `:1114` to `1117`): worker authorization denial, fingerprint mismatch and rollback "match the synchronous enforced contract".
- Behavior is compatible, but the criteria never say that these are AD-20 rows 3 or 5 with a durable `aborted_before_decision` or `aborted_after_decision` summary, that a collection change is row 2 (protocol conflict, no summary), or that "conflict" splits into rows 2 and 5. The AD-8 ordering that runs the collection-change check before the AD-7 fingerprint comparison is also absent.

**E-9 (Medium). Story 3.2 AC1 enumerates the old AD-18 layers.** (AD-18)
- `epics.md:1292` to `1295`: "...configuration/fingerprint/duplicate-key, projection-parity, ..., audit, ...".
- Missing AD-18 layers: the read-only sentinel matrix, source-byte `invalidFingerprint` stability (nested duplicates, lone surrogates, non-canonical numbers), identity omission for actors without collection read, and one fixture per AD-20 row including post-commit enrichment failure.

**E-10 (Low). Story 1.3 AC5 wording overlaps the sentinel case.** (C-3)
- `epics.md:354` to `357`: "a readable document outside every Configured Collection ... `not_evaluated`".
- A sentinel collection is not a Configured Collection under the PRD glossary. AC6 (`:359` to `362`) supplies the right failed result, so the outcome is correct but the two criteria depend on reader inference. AC6 also omits the `scope { collection, collectionId }` location.

**E-11 (Low). Story 2.1 AC1 keys classification on the Projected Document.** (AD-8)
- `epics.md:843` to `846`: "the lookup uses only the Projected Document's post-operation collection and the immutable startup policy set".
- AD-8: classification is made once at request time, keyed on the collection as the baseline resolves it, and never uses the raw `collectionId` input. The sentinel path builds no projection.

**Also stale in epics.md (not acceptance criteria; listed for completeness):**
- The AD inventory (`epics.md:94` to `116`) has no AD-20 entry.
- The AD-6 line (`:101`) still says "canonical JSON rules and SHA-256 policy, invalid-entry, and policy-set fingerprints".
- The AD-8 line (`:103`) lacks classification, the sentinel path and the collection-change conflict.
- "AD-1 to AD-19" or "AD-17 to AD-19" appears at `:191`, `:1288`, `:1395` and `:1401`. The AD tag lines of Stories 2.3, 2.4, 2.7 and 3.2 lack AD-14, AD-15 or AD-20 where relevant.

## 2. Should a companion mention AD-20, the outcomes or the sentinel behavior?

| Companion | Mention? | What, and what to avoid |
| --- | --- | --- |
| SPEC.md | **Yes.** | Add AD-20 to the adoption list (`:58`) and the Gate 1 sentence (`:72`). Add one clause to CAP-6 pointing at AD-14 and AD-20 for the attempt boundary, so aborted attempts are audited and pre-classification failures and collection-change conflicts are not. Keep it as a pointer. Do not restate the AD-20 table or the sentinel read states, because the PRD (FR-4, FR-7, FR-11, CAP-4 read half, FR-16, FR-20) still says otherwise and the PRD wins until it is amended. CAP-3's "complete zero-Error result after authorized repair" is only reachable when no readable sentinel is in scope, but the spine already states that, so no SPEC edit is needed. |
| README.md | **Yes, small.** | Fix the example (R-1). Add one Configuration sentence: read-only lint reports an invalid collection entry as a `POLICY_CONFIGURATION_INVALID` System Failure and never as clean. The PRD FR-12 already supports that wording, and it stays silent on `failed` versus `not_evaluated`. Point "Required tests" at AD-18. Do not copy AD-20 into README, because README is the lowest authority and the table will change. |
| AGENTS.md block | **Yes, one pointer.** | Every builder loads this file first. Add a binding-contracts pointer that names AD-1 to AD-20, and fix `:39`. An optional one-line convention ("a committed enforced write always returns success with `validation`; post-commit enrichment or audit failure never turns it into an error, AD-20") is justified because it is the mistake a builder is most likely to make. Add `:40` "or policy identity" to cover C-5. Edit through `bmad-project-context`, since the block is managed. |
| epics.md | **Do not patch piecemeal.** | It is stale by design and Gate 1 stays `not ready` until the PRD amendment lands. Replan Stories 1.2, 1.5, 2.4, 2.7, 3.2 and 3.4 with `bmad-correct-course` or `bmad-create-epics-and-stories` after PRD alignment. If a stopgap is wanted, add a header note listing E-1 to E-9 as superseded by the spine. |

## 3. Suggested minimal wording (suggestions only; nothing was edited)

**SPEC.md**
- S-1 (`:58`): change "`AD-18`, and `AD-19` unchanged" to "`AD-18`, `AD-19`, and `AD-20` unchanged". Change `:72` "`AD-1` through `AD-19`" to "`AD-1` through `AD-20`".
- S-2 (CAP-6 success, `:46`): "...records exactly one retrievable minimized summary per attempt, with attempt boundaries and aborted outcomes as defined by the Architecture Spine (AD-14, AD-20); ...".
- S-3 (`:54`): "...and a write that fails open and commits always returns unmistakable `degraded_validation`."

**README.md**
- R-1 (`:59`): replace "for example:" with "illustration only; exact codes, locations and response shapes are defined by the Architecture Spine (AD-3, AD-4, AD-12):". Minimal fix inside the block: `REQUIRED_FIELD_MISSING` becomes `REQUIRED_METADATA_FIELD_MISSING`, `"ok": false` becomes `"success": false`, and the issues sit under a `validation` object with `"status": "rejected"`. Add `"severity": "error"` and a spine-shaped `location`. Do not invent a location discriminator field, because AD-4 does not define one.
- R-2 (`:181`): add a bullet, "the additional conformance layers required by the Architecture Spine (AD-18), including the invalid-policy sentinel matrix and one fixture per AD-20 failure row."
- R-3 (`:93`): "report missing, deleted, and inaccessible targets identically as unresolved, without leaking target metadata".
- Configuration (`:164`): append "Read-only lint must report an invalid collection entry as a `POLICY_CONFIGURATION_INVALID` System Failure and never as a clean result."

**AGENTS.md block**
- A-1 (`:6` and `:20`): "The fork roadmap lives in `server/tools/README.md`. Binding contracts (PRD, addendum, Architecture Spine AD-1 to AD-20, SPEC) live under `_bmad-output/`; the README is subordinate to them."
- A-2 (`:39`): "Unconfigured and `read_only` collections retain upstream write behavior."
- A-3 (`:2`): refresh the verification stamp when the block is next regenerated.
- Optional (`:40`): "Never reveal inaccessible link targets, document metadata, or policy identity through lint results."

**epics.md (for the replan, not now)**
- E-1 (Story 1.2 AC6): "...`policyFingerprint` uses canonical JSON for valid entries; `invalidFingerprint` is SHA-256 over the exact UTF-8 source bytes of the entry's JSON value (AD-5 byte span) and exists for every defect kind, including lone surrogates, nested duplicate keys and non-canonical numbers."
- E-2 (Story 1.2 AC2 and AC5): "a custom duplicate-aware decoder reports duplicate keys, lone surrogates, source number forms and each entry's byte span. Duplicates at the root or `collections` level block startup; a nested duplicate or lexical defect inside an identifiable entry makes that entry a sentinel."
- E-3 (Story 1.5 AC3 and AC10, plus a new AC): "actor-readable collections holding a valid policy or an invalid-policy sentinel"; "no-policy state only when the readable scope holds neither". New criterion: a readable sentinel yields one `POLICY_CONFIGURATION_INVALID` System Failure at `scope { collection, collectionId }` with the invalid `PolicyIdentity`, a zero-count scope entry, no completed unit, and a default-scope result that is `incomplete` or `failed`, never clean; an unreadable sentinel contributes nothing.
- E-4 (Story 2.4 AC1 and AC3, Story 2.1 AC9): "carries exactly one policy identity, and `collectionId`, only when the actor can read the AD-8-classified collection; otherwise none". Add fixtures for document-membership updates and parent-bearing draft publication.
- E-5 (Story 2.4 AC2): "...remains present unless its post-commit assembly fails, in which case it is omitted and success with `validation` is still returned."
- E-6 (Story 2.4 paragraph `:1071` and Story 3.4 AC5): replace the two closed contradictions with "Pending PRD alignment per the spine Amendment Record: FR-4, FR-7, FR-11 and CAP-4 read half (C-3); FR-16 exception and FR-20 summary content (C-6); Section 4.5 identity wording (C-5)."
- E-7 (Story 2.7): add `aborted_before_decision` and `aborted_after_decision` to AC1; add abort rollback and "initiated immediately after commit, before response assembly" to AC5; add `scopeKind: collection` to AC2; add criteria for "no summary on collection-change conflict or pre-classification failure" and the sentinel-rejection payload; require one fixture per AD-20 row in AC8.
- E-8 (Stories 2.2 AC7, 2.3 AC7, 2.5 AC3 and AC6): name the AD-20 row and audit outcome for each listed failure; add the collection-change-before-fingerprint ordering to Story 2.5.
- E-9 (Story 3.2 AC1): add the four missing AD-18 layers.
- E-10 and E-11: "a readable document whose collection has neither a valid policy nor a sentinel" (1.3 AC5); "classification keyed on the baseline-resolved post-operation collection, made once at request time, never on raw `collectionId` input" (2.1 AC1).

## Checked, no conflict found

- SPEC.md:20 (Why), CAP-1 to CAP-3 and CAP-5, and Constraints at :50 to :57, :59 to :60. Line 53 already limits full-projection validation to "valid `enforced` policy" and names `read_only` correctly, matching AD-7 and AD-8.
- README.md:46 to 48, :56 to 59, :164 to 167, :181 to 182 match AD-8 classification and the sentinel write rule. README.md:53 to 54 ("must not ... leave externally visible side effects") does not conflict with the AD-14 audit summary, because audit Events are admin-only and PRD FR-17 permits the minimized rejection audit.
- AGENTS.md:35 to 38 match AD-1 and AD-13 ("Errors block enforced MCP writes; warnings do not"). AGENTS.md:36 is consistent because it applies only to enforced writes.
- Epics Stories 1.1, 1.4, 1.6 to 1.10, 2.6, 3.1 and 3.3 have no acceptance-criteria conflict with C-3 to C-7. Story 1.8 AC3 already excludes `invalidFingerprint` and any policy array, and Story 2.7 AC2 already excludes the invalid fingerprint, both consistent with AD-14.
