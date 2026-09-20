<!-- bmad:context -->
<!-- Verified 2026-09-20 against v1.10.1 commit 4a5a616a21be800257dc11cef4263d0dd0412156 and fork design e5e3f7905. Managed by bmad-project-context. -->

## Ezopek Outline fork

This is an operator-maintained Outline fork for deterministic Wiki linting in the built-in MCP server. Product scope and acceptance criteria live in `server/tools/README.md`; BMAD artifacts live in `_bmad-output/`. Upstream documentation remains useful technical reference, but does not define this fork's product policy.

## Policy

- Target `v1.10.1^{}` at commit `4a5a616a21be800257dc11cef4263d0dd0412156`.
- Do not merge or rebase linting work onto `upstream/main`. Evaluate each upstream fix as a separate, explicit backport with its own tests.
- BMAD artifacts under `_bmad-output/` and deliberate fork documentation may be created as Markdown. Do not create incidental notes.
- Keep linting deterministic. Do not invoke an LLM or perform semantic classification.
- Preserve existing authentication, authorization, transaction, and information-disclosure boundaries.
- Keep workspace-specific schemas and document IDs in server-side configuration; never hard-code private Wiki identifiers into reusable source or MCP tool descriptions.
- Treat implementation, image publication, deployment, and production rollout as separate approval boundaries.

## Where things are

- Fork roadmap and acceptance criteria: `server/tools/README.md`
- Built-in MCP tools: `server/tools/`
- Planning and implementation artifacts: `_bmad-output/`
- Upstream architecture reference: `docs/ARCHITECTURE.md`

## Running and verifying

- Use the Yarn version declared by the checked-out baseline.
- Prefer targeted Vitest files while iterating. Run broad suites only when their scope is justified.
- Run the relevant formatting, lint, type-check, and targeted test commands declared in `package.json` before presenting implementation as complete.
- Keep tests collocated with the code they cover; do not create new test directories.

## Conventions that differ from defaults

- Follow the checked-out baseline's TypeScript configuration; do not claim full strict mode where `tsconfig.json` does not enable it.
- Implement one reusable lint engine shared by write enforcement and read-only lint tools.
- Validate `update_document` against the fully projected post-edit document, not only the incoming fragment.
- Return stable machine-readable issue codes. Errors block configured writes; warnings do not.
- Failed linting must not persist partial state or externally visible side effects.
- Unconfigured collections retain upstream behavior.
- Never reveal inaccessible link targets or document metadata through lint results.
- In ProseMirror `toDOM`, sanitize user-controlled `href` and `src` values with `sanitizeUrl()`.

## Known pitfalls

- `v1.10.1` is an annotated tag: `9686f7264506a910ed87a4ad8704bafd361a3393` is the tag object; `4a5a616a21be800257dc11cef4263d0dd0412156` is the source commit.
- Tests against newer `upstream/main` do not validate the `v1.10.1` implementation.
- Do not mix the post-`v1.10.1` patch-edit fix into the first linting change.

<!-- /bmad:context -->
