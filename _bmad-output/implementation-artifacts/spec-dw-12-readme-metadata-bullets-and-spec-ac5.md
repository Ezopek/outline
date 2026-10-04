---
title: 'DW-12: Confirm the README `* ` metadata example and the SPEC AC5 interpretation (retro item 2, DW-7)'
type: 'chore'
created: '2026-10-04'
status: done
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
baseline_revision: dbc504b2c81b7c28a3bfd5e66188d39343960510
---

<intent-contract>

## Intent

**Problem:** DW-12 is Epic 1 retro action item 2 (finding F-2): change the `server/tools/README.md` visible-metadata example to `* ` bullets, record the Story 1.10 AC5 interpretation (canonical `* ` round-trips byte-identically; `- ` input lints clean) in the binding SPEC, and close DW-7 with the same change. The human chose option 1, "Apply README and SPEC reconciliation", on 2026-10-04. Commit `72e8f2ea6b4e346823f3def86965342b5aa159c4` (DW-7) already made exactly this change, and DW-7 is already `done` in the ledger.

**Approach:** Make no further source or documentation edit. Verify that HEAD satisfies every clause of the DW-12 decision, and record the evidence in this spec so the orchestrator can resolve DW-12 against the existing commit.

## Boundaries & Constraints

**Always:**
- Judge DW-12 only against its decision text: README example uses `* ` bullets; the binding SPEC records the AC5 interpretation; DW-7 is closed by the same change.
- Cite the full commit identifier of the existing change as the deliverable.
- If any clause is not satisfied at HEAD, apply only the minimal README or SPEC edit the DW-7 spec prescribed (`spec-dw-7-readme-metadata-canonical-bullet-marker.md`, Tasks & Acceptance), with the same wording.

**Never:**
- Edit the deferred-work ledger, `sprint-status.yaml`, the retro document, `epics.md`, the PRD, its addendum, the Architecture Spine, the DW-7 spec or any other existing implementation-artifact spec.
- Change code or lasting tests, or reword the already-reviewed README comment, README example or SPEC bullet.
- Add a duplicate `.memlog.md` entry; its existing DW-7 `(change)` line already records this amendment.

</intent-contract>

## Code Map

- `server/tools/README.md:119-141` -- "Templates and visible metadata". The comment and directive are at `:129-130`; the fenced example at `:131-137` holds `## Document metadata` and three `* ` bullets (`Status`, `Last verified`, `Authority`); the explanatory comment and `<!-- prettier-ignore -->` sit directly above the fence so `oxfmt` keeps `* `.
- `_bmad-output/specs/spec-outline-mcp-wiki-linting/SPEC.md:58` -- the `## Constraints` bullet stating canonical `* ` metadata round-trips byte-identically, equivalent `- ` input lints clean and converges, as the binding interpretation of Story 1.10 AC5 in `epics.md`.
- `_bmad-output/specs/spec-outline-mcp-wiki-linting/.memlog.md` (last line) -- the DW-7 `(change)` entry recording the amendment; read-only.
- `server/routes/mcp/wikiLint.test.ts:201-202,1675-1706` (read-only evidence) -- `METADATA` is the canonical two-field `* ` form; "round trip" proves `- ` input fetches as `METADATA`, `METADATA` fetches byte-identically, and both lint `complete` and `clean`.
- `_bmad-output/implementation-artifacts/deferred-work.md` DW-7 (read-only) -- `status: done 2026-10-04`, resolved by sweep bundle `dw-decision-dw-7`.
- `_bmad-output/implementation-artifacts/epic-1-retro-2026-10-03.md:55-57,150` (read-only) -- F-2 and action item 2, the origin of DW-12.

## Tasks & Acceptance

**Execution:**
- `server/tools/README.md` -- verify the example block holds exactly three `* ` bullets in the original order, preceded by the comment and the `<!-- prettier-ignore -->` directive; edit only if a clause fails (see Always) -- confirms the README clause of the decision.
- `_bmad-output/specs/spec-outline-mcp-wiki-linting/SPEC.md` -- verify the AC5 Constraints bullet is present with the DW-7 wording; edit only if absent -- confirms the SPEC clause.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- read DW-7's status (read-only) -- confirms the "close DW-7" clause is already met.

**Acceptance Criteria:**
- Given HEAD, when the README visible-metadata example is read, then every bullet uses `* ` and `oxfmt --check` accepts the file.
- Given HEAD, when the binding SPEC Constraints are read, then one bullet states that canonical `* ` metadata round-trips byte-identically and that `- ` input lints clean, as the Story 1.10 AC5 interpretation.
- Given HEAD, when the canonical `* ` metadata is created through MCP and fetched, then it returns byte-identically and `- ` input lints clean (the "round trip" test passes).
- Given the change set against the baseline, when it is diffed, then only this spec file differs.

## Spec Change Log

## Review Triage Log

### 2026-10-04 — Review pass
- verdicts: 16 findings — high 0, medium 0, low 11, false 5, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind Hunter: `git diff --stat <baseline>` omits the untracked spec, so it prints nothing instead of "only this spec file". — Confirmed (the companion `git status --porcelain` shows the one `??` line). The fix edits this build's spec; after the finalize commit the spec is tracked and the check shows it.
  - `[low]` `[reject]` Blind Hunter: AC4 contradicts the Always fallback that permits a minimal README/SPEC edit. — The fallback is conditional and never ran, since every clause held at HEAD; AC4 holds. The fix edits this build's spec.
  - `[false]` `[reject]` Blind Hunter: AC4 fails once the orchestrator writes `deferred-work.md`. — AC4 is judged against this run's change set; `git status --porcelain` at review shows only this spec, and the ledger write happens after this run in the orchestrator's own commit (as `dbc504b2c` did for DW-7).
  - `[low]` `[reject]` Blind Hunter: the "round trip" test uses the two-field `METADATA`, not the README's three-field example. — Confirmed (`wikiLint.test.ts:201-202`). The three-field example was proven byte-identical by DW-7's temporary probe (`spec-dw-7-readme-metadata-canonical-bullet-marker.md`, Auto Run Result); the fix edits this build's spec. Noted under residual risks.
  - `[low]` `[reject]` Blind Hunter: the DW-7 closure is asserted from ledger status, and its closing commit `dbc504b2c` is not cited. — Confirmed but cosmetic; the fix edits this build's spec. The Auto Run Result cites `dbc504b2c81b7c28a3bfd5e66188d39343960510`.
  - `[low]` `[reject]` Blind Hunter: no handoff for `sprint-status.yaml` retro item 2, still `open` (item 1 also stays `open` although DW-11 is `done`). — Confirmed (`sprint-status.yaml:79-93`, DW-11 `status: done`). Out of scope by intent: the invocation assigns resolution to the orchestrator and names the sprint board orchestrator-owned. Handoff recorded in the Auto Run Result.
  - `[low]` `[reject]` Blind Hunter: Design Notes omit that DW-23 (authors' own `- ` bullets) stays open. — Confirmed DW-23 `status: open`; the notes make no claim that it is closed. The fix edits this build's spec; mentioned under residual risks.
  - `[low]` `[reject]` Blind Hunter: AC1 ("every bullet uses `* `") is weaker than the SPEC's tight-list definition. — The README example is one tight list (`README.md:131-137`, no blank lines between items, checked with `cat -A`). The fix edits this build's spec.
  - `[low]` `[reject]` Blind Hunter: AC2 checks only two clauses of the SPEC bullet and does not quote it. — `SPEC.md:58` was read in full and holds every clause of the DW-7 wording. The fix edits this build's spec.
  - `[low]` `[reject]` Edge Case Hunter: `git diff --stat` against the baseline omits the untracked spec. — Same claim as the first Blind Hunter row; the fix edits this build's spec.
  - `[low]` `[reject]` Edge Case Hunter: retro item 2 in `sprint-status.yaml` stays open with no handoff. — Same claim as the Blind Hunter sprint-status row; out of scope by intent (orchestrator-owned board). Handoff recorded in the Auto Run Result.
  - `[false]` `[reject]` Intent Alignment: the diff edits none of the intent's files; README, SPEC and DW-7 closure live in earlier commits, so "the same change" cannot be produced now. — Not a defect: DW-7 was already `done` and both files were unchanged since `72e8f2ea6` when this run started, so the intent's end state holds at HEAD and a new edit would only duplicate reviewed text.
  - `[low]` `[reject]` Intent Alignment: automated checks exercise serializer behaviour on a two-field fixture, not the README/SPEC text, which is evidenced only by line citations. — Confirmed. A documentation-content test is new complexity for a defect unlikely to be met; manual line checks were performed and DW-7's probe covered the three-field example.
  - `[false]` `[reject]` Intent Alignment: the SPEC bullet says more than the decision ("no blank lines", "stable diagnostic coordinates", "converges"). — The bullet states both decision clauses verbatim in substance; the extra qualifiers narrow the claim to what the HTTP suite proves and were settled in DW-7's three review loopbacks. No contradiction.
  - `[false]` `[reject]` Intent Alignment: retro item 2 (reading R5) is not closed by the diff. — Same subject as the sprint-status rows; the intent and the receipt text assign the sprint board to the orchestrator, so not acting on it is the correct reading, not a divergence.
  - `[false]` `[reject]` Intent Alignment: the artifact-only receipt's qualifying condition is not met. — Correct and intended: `git check-ignore` exits 1 for this spec and sibling specs are tracked, so the run does not assert the receipt.

## Design Notes

DW-12 and DW-7 are the same work recorded twice: DW-7 came from the Story 1.10 spec's deferred item, DW-12 from the retro's action item 2 that cites DW-7. The DW-7 run already applied and reviewed the README and SPEC change under the same 2026-10-04 decision, so re-editing either file would only churn reviewed wording.

## Verification

**Commands:**
- `scripts/test-db.sh ensure && corepack yarn vitest run server/routes/mcp/wikiLint.test.ts -t "round trip"` -- expected: 1 test passes.
- `corepack yarn oxfmt --check server/tools/README.md` -- expected: all matched files use the correct format.
- `git status --porcelain` and `git diff --stat dbc504b2c81b7c28a3bfd5e66188d39343960510` -- expected: only this spec file (the HEAD at planning time).

**Manual checks (if no CLI):**
- README example: `## Document metadata`, a blank line, then `* Status: Active`, `* Last verified: 2026-09-20`, `* Authority: Repository`. SPEC line 58 holds the AC5 bullet. DW-7 reads `status: done 2026-10-04`.

**Evidence at HEAD `dbc504b2c81b7c28a3bfd5e66188d39343960510` (2026-10-04):**
- Deliverable: commit `72e8f2ea6b4e346823f3def86965342b5aa159c4` ("docs: reconcile the visible-metadata example with canonical `* ` bullets (DW-7)"). `git diff --stat 72e8f2ea6b4e346823f3def86965342b5aa159c4 HEAD -- server/tools/README.md _bmad-output/specs/spec-outline-mcp-wiki-linting/SPEC.md` is empty, so both files are unchanged since that commit.
- README clause: `server/tools/README.md:129` holds the "Keep `* `" comment, `:130` the `<!-- prettier-ignore -->` directive, `:131-137` the fence with `## Document metadata`, a blank line, then `* Status: Active`, `* Last verified: 2026-09-20`, `* Authority: Repository` (`:134-136`), in the original order. `corepack yarn oxfmt --check server/tools/README.md` reported "All matched files use the correct format."
- SPEC clause: `_bmad-output/specs/spec-outline-mcp-wiki-linting/SPEC.md:58` (`## Constraints`) holds the DW-7 bullet: canonical `* ` metadata round-trips byte-identically with stable diagnostic coordinates, equivalent `- ` input lints clean and converges, "the binding interpretation of Story 1.10 AC5 in `epics.md`". The last `.memlog.md` line is the DW-7 `(change)` entry.
- DW-7 clause: `deferred-work.md` DW-7 reads `status: done 2026-10-04`, `resolution: resolved by sweep bundle dw-decision-dw-7`.
- Round trip: `scripts/test-db.sh ensure` reported "outline-test ready"; `corepack yarn vitest run server/routes/mcp/wikiLint.test.ts -t "round trip"` passed 1 test (45 skipped).
- `git fetch --prune` succeeded; HEAD was 54 ahead of and 0 behind `origin/feature/mcp-wiki-linting-v1.10.1`. No README, SPEC, memlog, code or test edit was needed or made.

## Auto Run Result

Status: done

**Summary.** DW-12 (Epic 1 retro action item 2) needed no new README, SPEC, code or test change. Commit `72e8f2ea6b4e346823f3def86965342b5aa159c4` (DW-7) already changed the `server/tools/README.md` visible-metadata example to `* ` bullets and added the Story 1.10 AC5 interpretation to the binding SPEC, and sweep commit `dbc504b2c81b7c28a3bfd5e66188d39343960510` closed DW-7. This run verified every clause of the 2026-10-04 decision at HEAD and recorded the evidence, so DW-12 can be resolved against that existing change.

**Files changed.**
- `_bmad-output/implementation-artifacts/spec-dw-12-readme-metadata-bullets-and-spec-ac5.md` -- this spec: intent, verification evidence, review triage and result. No other file changed.

**Review.** Four layers reported 16 findings: high 0, medium 0, low 11, false 5, maybe-false 0 (Verification Gap reported none). Patches applied: none (high 0, medium 0, low 0). Deferred: none. Rejected, with reasons as logged in the Review pass above: the untracked-file `git diff --stat` wording (twice), the conditional fallback versus AC4, the ledger write versus AC4 (false), the two-field round-trip fixture, the uncited DW-7 closing commit, the sprint-status handoff (twice, out of scope by intent), DW-23 not mentioned, AC1 and AC2 wording, the earlier-commit "same change" divergence (false), the absence of a doc-content test, the broader SPEC wording (false), the R5 reading (false), and the non-qualifying artifact-only receipt (false). `followup_review_recommended: false`: no patch was applied and no unverified risk remains.

**Verification performed.** `git fetch --prune` succeeded; HEAD `dbc504b2c81b7c28a3bfd5e66188d39343960510` was 54 ahead of and 0 behind `origin/feature/mcp-wiki-linting-v1.10.1`. `scripts/test-db.sh ensure` reported `outline-test ready`; `corepack yarn vitest run server/routes/mcp/wikiLint.test.ts -t "round trip"` passed (1 passed, 45 skipped). `corepack yarn oxfmt --check server/tools/README.md` reported all matched files use the correct format. Manual checks: README `:129-137` holds the comment, the `<!-- prettier-ignore -->` directive and one tight list of `* Status: Active`, `* Last verified: 2026-09-20`, `* Authority: Repository`; `SPEC.md:58` holds the AC5 bullet; the last `.memlog.md` line is the DW-7 `(change)` entry; DW-7 reads `status: done 2026-10-04`. `git status --porcelain` showed only this spec before commit.

**Residual risks and handoff.** The committed round-trip test covers the two-field canonical form; the three-field README example was proven only by DW-7's temporary probe. DW-23 (authors' own `- ` bullets and patch `findText`) stays open and is out of scope. The DW-12 ledger resolution and the `sprint-status.yaml` action item `epic-1-retro-item-2-change-the-readme-visible-metadata-examp` (still `open`) belong to the orchestrator or operator; this run did not edit either. This spec is tracked, not ignored, so the artifact-only receipt does not apply.
