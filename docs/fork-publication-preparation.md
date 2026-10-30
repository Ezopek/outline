# Fork publication preparation runbook

Operator/maintainer runbook for moving the maintained fork source to a public
remote safely. It is a staged, source-bound checklist, not an authorization:
every stage that changes a remote, a repository setting, or a deployment needs
its own explicit grant.

## Current state (source-only)

This document and the accompanying workflow edits are **local source
preparation only**. As of writing:

- Nothing has been pushed. No GitHub Actions run, GHCR publication,
  deployment, repository-policy change, default-branch change, or risk
  acceptance has happened or is implied.
- The workflow definitions in this tree do not prove that GitHub executes them
  as written. Scheduled runs use the workflow as defined on the **default
  branch**. `workflow_dispatch` is only eligible if the workflow is defined on
  the default branch, but the run executes the definition at the ref selected
  at dispatch. The inherited nightly caller's explicit `ref: main` checkout is
  separate from either. The default branch (`main`) still carries the
  original, unsafe inherited definitions. Candidate-only changes therefore do
  **not** secure every ref.
- The accepted product candidate and the locally tested image are existing,
  separate evidence. Workflow-only changes do not invalidate product
  qualification, and a later build must not be relabelled as the tested image.

## Intended maintained lineage

- Maintained branch: `feature/mcp-wiki-linting-v1.10.1`, pinned to the
  upstream `v1.10.1` release per `AGENTS.md`. Do not merge or rebase onto
  upstream `main`.
- `main` stays the upstream-reference lineage. Never update, rename, force-push
  or merge into it as a shortcut to alignment.
- The unrelated older `feature/mcp-wiki-linting` branch is not the target.

## What the safeguards change

Source-only, no new publisher, no dispatch or schedule added:

1. Every job in `docker-build.yml` (build before any credential step, and
   merge), `docker.yml`, `docker-nightly.yml`, `auto-close-prs.yml`,
   `stale.yml`, `update-node.yml`, and `close-translation-prs.yml` carries the
   job-level guard `github.repository == 'outline/outline'`, ANDed with any
   pre-existing predicate. In the reusable publisher the `github` context is the
   caller's, so a fork caller disables both build and merge. There is no
   repository-variable opt-in and nothing relies on secrets being absent.
   Existing upstream-only guards in the image-compression workflow and the CI
   bundle-size job are unchanged.
2. `ci.yml` and `codeql-analysis.yml` push filters (and the CodeQL
   pull-request base filter) include the maintained branch alongside `main`.
   CI pull requests remain unrestricted. CI gets workflow-level
   `permissions: contents: read`; only the `changes` job overrides it with
   `contents: read` plus `pull-requests: read` (required by the pinned
   paths-filter on pull requests; a job map replaces, not extends, the workflow
   default). The CodeQL job keeps its explicit `security-events: write` scope.
3. A lightweight `publication-contract` CI job runs only
   `scripts/publication-safeguards.test.py` (standard library, no install,
   5-minute timeout, checkout without persisted credentials) and is part of the
   aggregate `ci` job's `needs`, so it is not skipped on documentation-only
   changes.
4. `scripts/publication-safeguards.test.py` is an offline static contract with
   negative mutation fixtures. It is a strict line matcher over today's
   block-style files, **not** a YAML parser or expression evaluator; it fails
   closed on shapes it does not recognise. Parse the YAML and run `actionlint`
   separately.

Known limitation, not certified: inherited third-party actions are mutable
tags in places, and no action pinning or runtime migration is attempted here.
Activation of CI/CodeQL must acknowledge this explicitly.

## Staged runbook

Each stage ends with evidence recorded outside the frozen documents.

### Stage 0: source identity

Record, without referencing the final commit inside its own content:

```
git rev-parse HEAD
git rev-parse HEAD^{tree}
git merge-base --is-ancestor <maintained-remote-head> HEAD
git merge-base --is-ancestor <product-candidate-commit> HEAD
git diff --stat <accepted-documentary-commit>..HEAD
```

Keep two deltas distinct: the **product** delta (source, tests, dependencies,
already qualified) and the **workflow/documentation-only** delta added by this
preparation. Re-run the contract test and a real YAML parser/`actionlint` over
the exact tree.

### Stage 1: documentary acceptance

Historical records contain "pending" labels. Later acceptance supersedes them
through a separate, hash-bound private acceptance record. Do not edit the
frozen accepted documents to change those labels.

### Stage 2: hygiene review before any public push

Accepted history contains historical host and person labels. Before any push to
the **public** fork, the parent must review the entire unpublished commit range
and resulting tree for such content and decide what may be disclosed. There is
no blanket permission to publish them. Admit one exact ref and tree.

### Stage 3: repository-wide Actions hold (separately authorized)

Because `main` and historical definitions remain unsafe, publication must happen
under a verified repository-wide hold on Actions, granted separately from the
push.

- An empty workflow registry, zero runs, missing credentials, missing runners,
  or an unset environment name are **not** a durable hold.
- Disabling workflows does not cancel existing runs. With fresh, fully paginated
  reads, reconcile totals for the workflow registry and **all** run states and
  history, inspect rerun exposure of unsafe definitions, and assign an explicit
  owner and disposition. No blind cancellation.
- Reading registry or run state is read-only; changing settings is a separate
  mutation needing its own grant. Existing "Actions enabled" metadata is not
  permission to change settings.

### Stage 4: publication under the hold

1. Push only the admitted ref/tree to the maintained branch (no force, no
   `main` update).
2. Read back the exact maintained head and tree over SSH.
3. Re-enumerate per-workflow state. Keep the inherited publisher and mutator
   workflow identifiers disabled across all refs.
4. Separately authorize an allowlisted activation of only CI and CodeQL.
5. If per-workflow reachability or an empty registry cannot prove both the hold
   and a safe activation path, **stop and report blocked**. Never dispatch a
   publisher as a probe.

### Stage 5: default branch and protections (separate grants)

Selecting the maintained branch as default, and any branch protection, each
need an exact grant and a read-back. Bind required status checks only to
contexts actually available on that ref; do not invent check names or assume a
new pull request exists. Re-check open pull requests and protections at the
moment of change. Changing the default does not rewrite explicit workflow
filters or publish an image.

### Reporting versus mutation

Read-only security/CodeQL reporting is distinct from content or registry
mutation. Retain its actual limits: the CodeQL schedule uses the default
branch, while its push and pull-request triggers follow the declared filters
(maintained branch and `main`; for pull requests, the merge/base context of the
targeted branch). Dependabot alert coverage of the default branch is separate.
Existence of a definition is not observed coverage.

## Image release (separate gate)

The intended private destination is `ghcr.io/ezopek/outline-wikilint`; the
inherited container-registry publication is not used. The locally tested image
has no verified remote digest and incomplete fork provenance. A later release
must bind the exact qualified product source and artifact provenance, private
package visibility, real digest/checksum read-back, and happen under explicit
publication authority. This preparation adds no registry authentication,
build, or push.

## Out of scope: separate parent gates

Production backup, restore, migration, deployment and restart, actual MCP write
enforcement, pilot, and risk acceptance are separate gates. A tracking owner is
not risk acceptance, and nothing here is a security-risk waiver.

## Rollback and hold semantics

Source: rollback means reverting through a reviewed new commit on the
maintained branch, never rewriting published history. Hold: if any stage
evidence is stale (intervening push, setting change, new run, or new open pull
request), stop and repeat the read-backs for that stage before continuing.
Runtime rollback is a separate operational procedure owned elsewhere and is not
described or authorized here.

## References

Repo-relative: `AGENTS.md`, `README.md`, `.github/workflows/`,
`scripts/publication-safeguards.test.py`, `docs/wikilint-gate-1/`,
`docs/wikilint-gate-2/`.
