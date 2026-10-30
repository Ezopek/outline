# Gate 2 handoff: image publication of the wiki-lint fork

## Latest candidate (2026-10-29)

Use [release candidate `42485693`](release-candidate-42485693.md) for the current source, build, local image, smoke, performance, security residuals, and remaining delivery gates. Its [derived qualification summary](qualification-42485693.json) binds the retained evidence by SHA-256; private raw receipts are not copied here.

The built image comes from source `42485693aa9bdddfeac31011f01137257167f515`, with runtime parent `c2bcfa1070c20871360c90760aa8fc42f1bd514d`, Node 26.12.1 and Yarn 4.11.0. Its local image ID is `sha256:c33b509b2d811b8145e159413127cf592db21f04ae5239f4862d757366bf4a45`. There is **no registry digest or publication approval**. A later records-only commit is not this image's source.

The registry choice is settled: private GitHub Container Registry under the fork owner. Publication and residual-risk disposition remain separate operator decisions. The adopted `shared-host-ssd-v1` performance run is parent-verified; the [complete current Gate 1 inventory](../wikilint-gate-1/candidate-42485693-evidence-index.md) records formal Gate 1 as **`not ready`** as of the latest amendment: the 21 AC5 owner/revisit fields in 13 residuals now carry operator-adopted tracking values, and focused independent review plus parent acceptance are still pending; the completed SM-I/D9 technical evidence remains pass. No runtime test is requested. The bounded risk assessment is complete with explicit residual acceptance still pending. Native feature closure is not established by this documentation.

## Historical snapshot (2026-10-25; superseded for the latest candidate)

**All remaining sections below retain the original handoff as history.** Their source, readiness, production/rollback observations, registry alternatives, Node 26.3.0 pin, old lock hash/parity claims, dependency counts and dry-run image describe that snapshot only. They are not current instructions or proof for `42485693`. The latest candidate record supersedes their current applicability, including the request to select a registry and the old rebuild procedure. Historical Gate 1 rows and manifests remain unchanged; their scoped addenda link the latest evidence without extending historical acceptance.

This is the hand-off for the agent and operator who take the wiki-lint fork from Gate 1 to Gate 2, image publication (PRD §11). The Claude Code session that built Epics 1–3 prepared it on 2026-10-25. It is the single entry point: what has been settled, what the operator still decides, the exact procedure, and what follows after Gate 2.

**Nothing here authorizes publication.** Gate 2 needs the operator's explicit approval. Publication does not authorize pulling or running the image anywhere (Gate 3), and deployment does not authorize enabling any policy (Gate 4).

## Where things stand

| Item | State | Evidence |
|---|---|---|
| Gate 1, implementation readiness | `ready` (no blocking row) | [`../wikilint-gate-1/decision-record.md`](../wikilint-gate-1/decision-record.md), [`../wikilint-gate-1/evidence-index.md`](../wikilint-gate-1/evidence-index.md) |
| AD-17 reference run | attested, `gate1Eligible: true`, every budget `pass` | [`../wikilint-gate-1/benchmark/reference-manifest.json`](../wikilint-gate-1/benchmark/reference-manifest.json) (source `e5e16ec25`) |
| Epic 3 retrospective | `accepted-with-open-items` | `_bmad-output/implementation-artifacts/epic-3-retro-2026-10-25.md` |
| Gate 2 dry run | smoke script and dependency review run on a local, unpublished build; see [Dry run](#dry-run-2026-10-25) | this directory |
| Gate 2 | **not approved, not started** | — |

- **Source:** `git@github.com:Ezopek/outline.git`, branch `feature/mcp-wiki-linting-v1.10.1`. It was never merged or rebased onto `upstream/main`. The baseline is `v1.10.1^{}` = `4a5a616a21be800257dc11cef4263d0dd0412156`.
- **Handoff commit:** the commit that adds this file, `git log -1 --format=%H -- docs/wikilint-gate-2/README.md`. Code changes after Gate 1's evidence revision touch only benchmark, test and comment code (DW-58, DW-61); the runtime lint path is the one the evidence measured.
- **What runs in production today:** `outlinewiki/outline:1.10.1@sha256:832051f039b446c87aa23929cf92c00980c66aaa2d744d118c48c016ec816ad8` (upstream) on `ezopnas`, with `postgres:16-alpine`. This is the **rollback identifier**.

## Operator decisions needed before Gate 2 (OD-7 and the dependency review)

Ask the operator for each item and record the answer in the Gate 2 record before anything is pushed.

1. **Registry and access boundary.** Where the image is published, and who can pull it. Options:
   - a private GitHub Container Registry package under the fork's owner, such as `ghcr.io/ezopek/outline-wikilint`;
   - no remote registry, with the image kept only in the local Docker image store on `ezopnas`. **This does not meet the PRD Gate 2 condition** "the approved registry and access boundary are identified", and it yields no registry digest. Gate 2 can then pass only if the operator explicitly amends that condition and records the amendment, for example that the registry is the `ezopnas` image store and the access boundary is shell access to that host;
   - another registry the operator names.

   Credentials for a registry are the operator's to provide. Never store them in Git or Wiki.
2. **Image name and tag.** A suggestion is `<registry>/outline-wikilint:1.10.1-wikilint.<short-sha>`. The immutable identity is always the digest, never the tag.
3. **Dependency review acceptance.** See [Dependency review](#dependency-review). The lockfile is identical to upstream `v1.10.1`, so the fork ships exactly the advisories that production runs today. The operator either accepts that parity for Gate 2, or first orders separate, explicit dependency backports, each with its own tests (CLAUDE.md policy). The likeliest candidate is `@modelcontextprotocol/sdk`, because the lint tools are served through `/mcp`.
4. **Node runner.** It stays pinned to `node:26.3.0-slim` (the AD-17 evidence and Gate 1 used it). A runner bump is a separate release-operator decision (D-3, D-8).

## Gate 2 procedure

Run these on the build host the operator names (`ezopnas` has Docker 29.5 and 31 GB RAM). Use SSH for Git. On `ezopnas`, `~/repos/outline` currently has an **HTTPS** `origin` and an old branch (`feature/mcp-wiki-linting`). Switch the remote to SSH once SSH access is verified (the Laura Wiki `_rules`), and never build from that old branch.

1. **Check out the approved commit exactly**, and confirm that the tree is clean:
   ```sh
   git fetch --prune origin
   git checkout --detach <approved-sha>
   git status --short   # must be empty
   ```
2. **Build** with the repository's own Dockerfiles. Builds are not bit-for-bit reproducible, so this build, and nothing else, is the candidate:
   ```sh
   C=$(git rev-parse HEAD)
   docker build -f Dockerfile.base -t outline-base:wikilint-$C .
   docker build --build-arg BASE_IMAGE=outline-base:wikilint-$C -t outline:wikilint-$C .
   docker image inspect --format '{{.Id}}' outline:wikilint-$C
   ```
3. **Provenance record:** the approved commit, the build host, `docker version`, the exact two commands above, the digests of the base images (`docker image inspect --format '{{index .RepoDigests 0}}' node:26.3.0 node:26.3.0-slim`), the local image ID, and the `yarn.lock` sha256 (`2aa4fee18aa4dbb6214fb6a679ce11e6ffda17988c2a35f703a60053df0517c7` at the handoff commit).
4. **Smoke checks** against that image, with the output kept under `$HOME`:
   ```sh
   docs/wikilint-gate-2/gate2-smoke.sh outline:wikilint-$C ~/wikilint-gate2-evidence/<sha>
   ```
   Every line must be `pass`, and the run must end with `overall pass`. See [What the smoke checks prove](#what-the-smoke-checks-prove).
5. **Dependency review:** confirm that `yarn.lock` still has the sha256 above. If it does, the [Dependency review](#dependency-review) below applies unchanged. If it does not, the lockfile changed and the review must be redone.
6. **Stop and ask for approval.** Show the operator the provenance record, the smoke results, the dependency review and the rollback identifier. Publication happens only after an explicit yes.
7. **Publish (after approval only):** tag and push to the approved registry, then record the registry digest that the push prints, together with the tag:
   ```sh
   docker tag outline:wikilint-$C <registry>/<name>:<tag>
   docker push <registry>/<name>:<tag>
   docker image inspect --format '{{index .RepoDigests 0}}' <registry>/<name>:<tag>
   ```
   Under the local-store variant of item 1, which needs the operator's recorded amendment, record the local image ID and keep the image; nothing is pushed.
8. **Gate 2 record.** Write it to `docs/wikilint-gate-2/gate2-record.md` (commit it, no secrets). It holds:
   - the operator's decisions for items 1–4;
   - the provenance record;
   - the smoke results file;
   - the dependency-review decision;
   - the published digest and tag;
   - the rollback identifier;
   - the approval with its date.

## What the smoke checks prove

`gate2-smoke.sh` runs the image with throwaway PostgreSQL (`postgres:16-alpine`, the production major) and Redis containers on a private network. Probes run inside the app container with the image's own `wget`. Every container and network it creates carries a run label and is removed afterwards, and each container's anonymous volumes go with it (`docker rm -v`). The PostgreSQL wait is bounded at 120 s, and the script refuses an output directory that already holds results.

| Check | Setup | Expected (AD-19) |
|---|---|---|
| S1 | no policy file | starts, migrates, `/_health` 200 `OK` with the policy-set fingerprint header (upstream behaviour) |
| S2 | the generic `read_only` example mounted read-only | 200 `OK`, startup log `Wiki lint policy configuration loaded` |
| S3 | the example with a wrong expected fingerprint | 503 with the fingerprint header |
| S4a | the example switched to `enforced`, no expected fingerprint | 503 |
| S4b | the same, with `WIKI_LINT_EXPECTED_CONFIG_FINGERPRINT` set to the reported fingerprint | 200 `OK` |
| S5 | a malformed file containing a marker string | the process exits (a hang fails the check) after logging `POLICY_CONFIGURATION_MALFORMED` with a numeric byte `location`, and the log never contains the file's content |
| S6 | packaged artifacts | `node --version` equals the Dockerfile runner pin; the lint build and the generic example are present; there is no other policy file |

These checks prove image startup and packaging only. They do not replace the Gate 3 smoke checks on the target: UI and API compatibility, `/mcp` discovery, existing and new tools, audit visibility, and unconfigured-collection behaviour.

## Dependency review

Run on 2026-10-25 at handoff commit `45df4867b`.
- **Tools:** OSV-Scanner v2.7.0 in offline mode, inside a network-less sandbox, with the npm DB exported 2026-10-25T06:33Z.
- **Input:** `yarn.lock` (sha256 above), 2,087 npm packages. 4 `patch:` entries are local patches of public packages (`fsevents`, `resolve`, `typescript` ×2), and these are unassessed.
- **Verdict:** `INCOMPLETE_VULNERABILITIES_FOUND`. The scanner extracted 2,091 entries and listed 2,087; the difference is the 4 `patch:` entries. Findings are real; coverage of those 4 is not.
- **Scope:** the Yarn Berry lockfile format is not yet a qualified input for this procedure. The raw report stays outside Git (`~/security-scans/outline-45df4867b-20261025/` on the scanning workstation).

**Result:** 104 advisory groups in 33 packages (7 critical, 37 high, 47 medium, 11 low, 2 unscored). Each package was checked against the production image's `node_modules` (after `yarn workspaces focus --production`):
- **Ship in the production image (26 packages).** Highest score first: `dompurify@3.4.13` (9.2), `proxy-addr@2.0.7` (9.1), `source-map-js@1.2.1` and `http-cache-semantics@4.2.0` (8.7), `@modelcontextprotocol/sdk@1.29.0` (8.6, 5 advisories), `prosemirror-view@1.41.8` (8.5), `axios@1.18.1` (8.3, 12), `zod@4.5.4` and `follow-redirects@1.16.0` (8.2), then at 7.5 `vite@8.1.5`, `undici@7.29.0` (13), `nodemailer@9.0.5` (11), `markdown-it@14.3.0`, `js-yaml@4.3.1`, `fast-uri@3.1.6`, `engine.io@6.6.9`, `brace-expansion` (three versions) and `body-parser@2.3.0`, and lower: `ip-address`, `hono`, `moment`, `i18next-http-backend`, `serialize-javascript`, `katex`.
- **Build or test only (7 packages, not in the image):** `tinypool`, `shell-quote`, `piscina`, `@xhmikosr/decompress` (the critical scores), `fflate`, `vitest`, `@vitest/mocker`.

Every one of these versions is also in the upstream `outlinewiki/outline:1.10.1` image running in production today, because the lockfile is unchanged. Publication alone changes no exposure; what it would ship is the operator's decision (item 3 above). `markdown-it`'s earlier advisory GHSA-253c-mchw-3w2r affects only `linkify: true`, and the lint rules use `linkify: false` (Architecture Spine, risks). The new advisories were not assessed against the lint code's usage.

## Dry run (2026-10-25)

The Claude Code session built `outline:wikilint-45df4867b99660ce0e60ac608390ba54e6c3b33a` (local image `sha256:9ed80d5269c7a12fa3bb4503c1385d787a1812504f3ea217cefab83f1894c469`) on the developer workstation and ran the smoke script against it. The result is in [`dry-run-45df4867b-results.txt`](dry-run-45df4867b-results.txt). This proves that the procedure works. It is not Gate 2 evidence, because that build is not the one that will be published.

## After Gate 2

**Gate 3, deployment (a separate approval):**
- **Target:** `ezopnas`, compose project `outline`, configuration in the `configs` repository at `outline/`. Backup, verify and restore-drill scripts: `configs/outline/backup.sh`, `verify-backup.sh`, `restore-drill.sh`.
- **Backup and rollback:** verify backup, restore and rollback before the change. The rollback target is the identifier above.
- **Database version (OD-7):** production runs PostgreSQL 16, while the AD-17 evidence and the tests ran on 14.2 and 14. The S1–S5 smoke checks already run on 16; the operator confirms the target major as part of OD-7.
- **Smoke (PRD §11):** health, UI and API compatibility, `/mcp` discovery, existing MCP tools, the new `lint_document` and `lint_wiki`, audit visibility, and unconfigured-collection upstream behaviour.
- **Readiness:** deploy **without** `WIKI_LINT_CONFIG_PATH` (AD-19: deployment enables no policy). Policy readiness is enforced through `/_health` only, so health-gated routing is a deployment precondition (retro A-9).

**Gate 4, rollout (a separate approval):** the operator first approves the pilot policy values (OD-2) and the two MCP clients and the evidence procedure (OD-6). The PRD §11 order then applies:
1. validate the policy;
2. enable read-only linting for the named collection;
3. reach a clean `lint_wiki`;
4. run the pilot (at least 7 days, 10 batches, 2 clients);
5. review the evidence;
6. get explicit approval for enforcement;
7. enable enforcement and verify the rollback path.

## For agents that use the Wiki after deployment

Until a policy is mounted and confirmed, every collection keeps upstream write behaviour. The new things an MCP client sees:
- **New read-only tools:** `lint_document` and `lint_wiki`.
- **Write responses** gain a `validation` object.
- **Errors block** `create_document` and `update_document` only in collections whose policy enforces writes, or whose configuration entry is invalid. Warnings never block.
- **Issue codes are stable.** Repair by reading `code`, `location` and `detail`, not the prose.

The contract summary is [`server/tools/README.md`](../../server/tools/README.md). The binding rules are the Architecture Spine AD-3, AD-4, AD-12 and AD-13 and `_bmad-output/specs/spec-outline-mcp-wiki-linting/SPEC.md`. Writes made through the UI or the REST API are not blocked; `lint_wiki` detects them.

## Open items that travel with the image

The tracking sources are `_bmad-output/implementation-artifacts/deferred-work.md` and the `action_items` in `sprint-status.yaml`. The low-severity ledger entries are DW-48, DW-49, DW-52, DW-53, DW-55, DW-57 and DW-62. Retrospective actions still open:
- **A-8:** test-mutex timeouts;
- **A-9:** the readiness precondition above;
- **A-11:** triage of unverified review findings;
- **A-12:** ledger reconciliation of DW-4, DW-20 and DW-41;
- **A-13** and **A-14:** process lessons.

Earlier open entries that the Gate 1 record lists are DW-13, DW-21, DW-25, DW-30, DW-35 and DW-36. None of them blocks Gate 2.
