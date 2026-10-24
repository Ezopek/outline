<!-- bmad:context -->
<!-- Verified 2026-10-02 against v1.10.1 commit 4a5a616a21be800257dc11cef4263d0dd0412156 and planning baseline 936d5b738. Managed by bmad-project-context. -->

## Ezopek Outline fork

This is an operator-maintained Outline fork for deterministic Wiki linting in the built-in MCP server. The binding contract is `_bmad-output/specs/spec-outline-mcp-wiki-linting/SPEC.md` with its companions (PRD, addendum, Architecture Spine); stories and acceptance criteria live in `_bmad-output/planning-artifacts/epics.md`, and `server/tools/README.md` summarizes the fork roadmap. Upstream documentation remains useful technical reference, but does not define this fork's product policy.

## Policy

- Target `v1.10.1^{}` at commit `4a5a616a21be800257dc11cef4263d0dd0412156`.
- Do not merge or rebase linting work onto `upstream/main`. Evaluate each upstream fix as a separate, explicit backport with its own tests.
- BMAD artifacts under `_bmad-output/` and deliberate fork documentation may be created as Markdown. Do not create incidental notes.
- Keep linting deterministic. Do not invoke an LLM or perform semantic classification.
- Preserve existing authentication, authorization, transaction, and information-disclosure boundaries.
- Keep workspace-specific schemas and document IDs in server-side configuration; never hard-code private Wiki identifiers into reusable source or MCP tool descriptions.
- Treat implementation, image publication, deployment, and production rollout as separate approval boundaries.

## Where things are

- Binding contract: `_bmad-output/specs/spec-outline-mcp-wiki-linting/SPEC.md` and its companions
- Stories and acceptance criteria: `_bmad-output/planning-artifacts/epics.md`
- Fork roadmap summary: `server/tools/README.md`
- Built-in MCP tools: `server/tools/`
- Planning and implementation artifacts: `_bmad-output/`
- Upstream architecture reference: `docs/ARCHITECTURE.md`

## Running and verifying

- Use the Yarn version declared by the checked-out baseline.
- Prefer targeted Vitest files while iterating. Run broad suites only when their scope is justified.
- DB-backed server tests need the PostgreSQL named in `.env.test`. Run `scripts/test-db.sh ensure` before them: it is idempotent, installs PostgreSQL 14 on first use where none is running, applies migrations, and leaves the server running. Without the database Vitest hangs instead of failing, so do not wait on a silent run. Before a broad run (`yarn test:wikilint`) and before every run retained as evidence, run `scripts/test-db.sh reset` instead: it drops, recreates and migrates the database, so the run does not depend on rows that earlier runs left behind (DW-50, DW-54), and it refuses while another session is connected. `ensure` is enough for other targeted runs; when one fails on rows it did not create, run `reset` and repeat it.
- Run the relevant formatting, lint, type-check, and targeted test commands declared in `package.json` before presenting implementation as complete.
- Broad verification for this fork (Epic 3 conformance evidence, and any claim about the whole linting surface): `yarn test:wikilint`. It runs the server project with `--maxWorkers=2` over `server/wikiLint`, `server/tools`, `server/queues` and `server/routes/mcp`; without the worker cap, parallel DB-backed files exhaust the test PostgreSQL connections.
- Keep tests collocated with the code they cover; do not create new test directories.

## Conventions that differ from defaults

- Follow the checked-out baseline's TypeScript configuration; do not claim full strict mode where `tsconfig.json` does not enable it.
- Implement one reusable lint engine shared by write enforcement and read-only lint tools.
- Validate `update_document` against the fully projected post-edit document, not only the incoming fragment.
- Return stable machine-readable issue codes. Errors block enforced MCP writes; warnings do not.
- Failed linting must not persist partial state or externally visible side effects.
- Unconfigured and `read_only` collections retain upstream write behavior; an invalid collection policy in an actor-readable lint scope is a System Failure, never clean or not evaluated.
- Never reveal inaccessible link targets or document metadata through lint results.
- In ProseMirror `toDOM`, sanitize user-controlled `href` and `src` values with `sanitizeUrl()`.

## Known pitfalls

- `v1.10.1` is an annotated tag: `9686f7264506a910ed87a4ad8704bafd361a3393` is the tag object; `4a5a616a21be800257dc11cef4263d0dd0412156` is the source commit.
- Tests against newer `upstream/main` do not validate the `v1.10.1` implementation.
- Do not mix the post-`v1.10.1` patch-edit fix into the first linting change.
- Before setting a `bmad-loop` story to `done` by hand, move every open finding from its review gates into `_bmad-output/implementation-artifacts/deferred-work.md`; a story spec that is deleted or archived takes its unresolved findings with it (Epic 2 retro, Story 2.5).
- During a `bmad-loop` sweep, `_bmad-output/implementation-artifacts/deferred-work.md` can hold an uncommitted change that belongs to the orchestrator's own pending ledger transaction, not to the story being built. It does not fail a clean-working-tree gate. Never stage, edit, revert or commit it; finalize the story without it and let the orchestrator commit it.

<!-- /bmad:context -->
<!-- bmad-coordinator:begin v1 -->
## Portable BMAD coordinator opt-in

For a substantial request, first inspect this repository and its installed BMAD instructions, then identify the intended outcome, authority, scope, exclusions, and a concrete Git base commit. Use the installed coordinator CLI at `.bmad-coordinator/run.py` to inspect state and record a mandate before assigning bounded work. A small direct request may be handled directly. The coordinator tracks state and evidence; its presence does not automatically launch workers or prove review.

If an assignment explicitly gives you `role: worker` or `role: reviewer`, follow that frozen assignment and its permitted paths. Do not perform top-level intake or claim coordinator ownership from inside that assignment. You may use bounded nested investigation or review when the mandate and run budget permit it. Return evidence and unresolved questions honestly; a self-report is not independent review or proof of effective permissions.

Use `python3 .bmad-coordinator/run.py --repo /absolute/worktree status` to inspect state. For a feature worktree, record the resolved base commit at creation and run `doctor --base COMMIT` before execution. A moving branch name is not a substitute for that concrete commit.
<!-- bmad-coordinator:end v1 -->
