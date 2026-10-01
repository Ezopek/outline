# Review Record: amendment-proposal-prd-spine-alignment.md

**Target:** `amendment-proposal-prd-spine-alignment.md` (status: proposed).
**Method:** independent fresh-context reviewer subagents, read-only on the repository, five rounds. Each round's full text was kept in the session scratchpad; this record keeps the outcome. Every round also script-checked that each quoted Replace, Delete, and insertion anchor occurs exactly once in its target and that no With text already exists there.

## Rounds

| Round | Lenses | Critical | High | Medium | Low | Main findings, all resolved in the proposal |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Spine consistency; adversarial edge cases; minimality, companions, epics | 0 | 7 | 21 | 20 | A-8 self-contradiction and over-reach into `lint_wiki`; AD-20 row 7 missing from FR-20, SM-I6, Section 4.6 and NFR-15; AD-7 status recovery against FR-16; author defaults presented as fixed decisions; Part B hiding still-open conflicts; undefined "actor-readable scope"; message rule; classification failure; addendum payload list; README block boundary; symlink check; epics rows |
| 2 | Consistency plus adversarial; minimality and companions | 0 | 2 | 5 | 16 | Recovery also after a later probe; FR-13 "admitted" against unestablished commits; decision labels; "three exceptions"; B-2 wording per residual; plan check colliding with B-3 |
| 3 | Final confirmation, all lenses | 0 | 0 | 1 | 7 | Section 4.5 Warning criterion against a recovered status |
| 4 | Closing confirmation | 0 | 0 | 3 | 4 | `lint_wiki` scope definition in A-6; exception 2 for an unrecoverable committed status; FR-19 `isError` rule labelled as an author default (Decision 14) |
| 5 | Closing confirmation | 0 | 0 | 0 | 1 | No material findings |

## Final State

- Round 5 verdict: **no material findings**. All round-4 Mediums are closed, and the Lows applied in rounds 3 and 4 introduced no defect.
- Mechanical check (round 5): 27 PRD, 1 addendum, 6 spine-marker, 4 SPEC, 1 README, and 1 AGENTS target texts each occur exactly once; the AGENTS line is inside the managed block; `CLAUDE.md` is a symlink with git mode `120000`.
- Branch currency (round 5): after fetch, 1 commit ahead of origin and 0 behind.

## Residual Low, Not Applied

- **A-6 and A-8, unauthorized reads.** Read literally, a read the actor may not make has an empty actor-readable scope and would be "not evaluated". FR-4's second consequence and the new FR-19 consequence make it a Tool-Execution Error, and the more specific clauses govern. The ambiguity predates this delta in FR-11, and D-9 owns the tool contracts. Optional wording: start the A-6 With text with "Authorized read-only requests whose actor-readable scope…".

## Items Outside the Review Verdict

The proposal reports RI-1 to RI-6 as unresolved residuals needing separate operator decisions. Reviewers checked their descriptions, not their resolution.
