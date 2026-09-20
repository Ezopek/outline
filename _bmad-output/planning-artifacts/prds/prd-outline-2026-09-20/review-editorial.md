# Editorial Review — PRD and Addendum

This document exists to let product, architecture, implementation, and operations readers derive one unambiguous contract for deterministic Wiki linting and its staged release. The selected structure model is **Strategic/Context (Pyramid)**; the documents contain 7,591 words in total (`prd.md`: 7,038; `addendum.md`: 553).

| Pass | Original Text | Revised Text | Changes |
| --- | --- | --- | --- |
| structure | §7.2 and §11; §13 | PRESERVE | The short stage-boundary signpost and explicit assumptions closure resemble repetition, but they prevent implementation-complete from being read as deployment authority and prevent downstream readers from inventing assumptions. No cut recommended. |
| structure | `addendum.md` Fixed Architecture Inputs | PRESERVE | The addendum deliberately repeats fixed product constraints for architecture consumers; moving mechanisms into the PRD or removing these constraints would weaken the handoff. No cut recommended. |
| prose | Glossary — “Projected Document — The complete title and body...” | “Projected Document — The complete prospective title and body ... together with the post-operation collection scope used to select policy...” | Aligns the term with the newly approved post-operation scope rule. |
| prose | UJ-2 — “A valid write or a write containing warnings succeeds...” | “A write that passes existing checks and validation succeeds; Warnings do not block it...” | Avoids implying that lint validation supersedes authentication, authorization, or other upstream checks. |
| prose | FR-14 — “Zero Errors permits persistence unless...” | “Zero Errors does not block persistence; the write remains subject to fail-closed System Failures and existing upstream checks.” | Separates validation permission from overall write authority. |
| prose | FR-19 — “for the authenticated actor and authorized scope” | “attributable to the authenticated actor and authorized scope” | Avoids implying that ordinary actors can retrieve operator audit data. |

The structure pass recommends no reduction. The prose pass contains four small precision edits and preserves the technical, normative voice. No comprehension trade-off is introduced.
