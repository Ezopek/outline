# Gate 1 source provenance (Story 3.2)

All commands are read-only Git, run one per call in the story worktree on 2026-10-24. No fetch was performed. Exit status `0` is reported where a command printed nothing and the tool reported no error.

- Inspected HEAD: `92eed955f83fdb93d84a2b3ae1b3ebef19f15497` (the retained source is HEAD plus the working-tree diff recorded in [conformance.md](conformance.md)).
- Local `upstream/main` (`git rev-parse upstream/main`): `d410db1b24594d71b766212282804d79ca18e5c1`.

## Checks

| Check | Command                                                                                                                                             | Output                                                                                                                                                                                       | Exit | Result          |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------------- |
| (a)   | `git merge-base HEAD upstream/main`                                                                                                                 | `4a5a616a21be800257dc11cef4263d0dd0412156`                                                                                                                                                   | 0    | pass            |
| (b)   | `git rev-list --count --cherry-pick --right-only upstream/main...HEAD`                                                                              | not run: the session's tool policy denied the command (it requires approval, and no approval surface exists). A `git cherry upstream/main HEAD 4a5a616a…` substitute was denied the same way | —    | **`gap`**       |
| (b)   | `git rev-list --count 4a5a616a21be800257dc11cef4263d0dd0412156..HEAD`                                                                               | `153`                                                                                                                                                                                        | 0    | —               |
| (c)   | `git rev-list --merges --count 4a5a616a21be800257dc11cef4263d0dd0412156..HEAD`                                                                      | `2`                                                                                                                                                                                          | 0    | —               |
| (c)   | `git log --merges --format='%H %P' 4a5a616a21be800257dc11cef4263d0dd0412156..HEAD`                                                                  | the two merges below                                                                                                                                                                         | 0    | —               |
| (d)   | `git merge-base --is-ancestor c17d2c52b3a9e26834b846d27ee9213ee3003c4c HEAD`                                                                        | (none)                                                                                                                                                                                       | 1    | pass (excluded) |
| (e)   | `git show -s --format=%s c17d2c52b3a9e26834b846d27ee9213ee3003c4c`                                                                                  | `fix: Patch edit mode drops content spliced inside container blocks (#13794)`                                                                                                                | 0    | —               |
| (e)   | `git show --stat --format= c17d2c52b3a9e26834b846d27ee9213ee3003c4c`                                                                                | `server/commands/documentUpdater.test.ts \| 460 +…`, `server/models/helpers/DocumentHelper.tsx \| 206 +…`, `2 files changed, 615 insertions(+), 51 deletions(-)`                             | 0    | —               |
| (e)   | `git diff --stat 4a5a616a21be800257dc11cef4263d0dd0412156 HEAD -- server/commands/documentUpdater.test.ts server/models/helpers/DocumentHelper.tsx` | empty                                                                                                                                                                                        | 0    | pass            |

(a) The merge-base equals the `v1.10.1` source commit, so no merge from `upstream/main` moved it.

(b) The correction attempt (2026-10-24, HEAD `e17fb654716f21d736dcf29cccbe72bb7fe1ad67`, the coordinator's attempt commit, whose source tree equals the retained source) tried the exact (b) command again, and the tool policy denied it again, with no approval surface. The continuation attempt after decision `5d255d91-…` (HEAD `354804c21`, same source tree) tried it a third time and was denied the same way. The worker did not substitute another way of running Git. The patch-equivalence comparison could not be made, so this attempt cannot prove that no fork commit was rebased or cherry-picked from `upstream/main`. **`gap` (owner: the coordinator, which can run the (b) command read-only and compare its count with `153`).**

(c) Merge commits in `4a5a616a…..HEAD`, each parent checked with `git merge-base --is-ancestor <parent> upstream/main`:

| Merge                                      | Parent                                     | `--is-ancestor <parent> upstream/main` | Result |
| ------------------------------------------ | ------------------------------------------ | -------------------------------------- | ------ |
| `cf2412fb2e912a87b7cb735ba716ba786fc18e61` | `1f5ff220dc5ac5612c76d83af03f3d6b638301ee` | exit 1                                 | pass   |
| `cf2412fb2e912a87b7cb735ba716ba786fc18e61` | `c76cb504f38b369763fe639f2a50a97d44507ca0` | exit 1                                 | pass   |
| `c163469b8cb5293195fe97e58a2193de5531d7bc` | `4c1ddecb595af4c16a61b17aa200cf88bd69fca8` | exit 1                                 | pass   |
| `c163469b8cb5293195fe97e58a2193de5531d7bc` | `45b726f570f3cd0dd1064a0188005b782c3246d8` | exit 1                                 | pass   |

No parent is reachable from `upstream/main`, so neither merge brought in upstream history. (c) passes.

(d) and (e) The container-block patch-edit fix `c17d2c52b3a9e26834b846d27ee9213ee3003c4c` exists locally, is not an ancestor of HEAD (exit 1), and its two files are unchanged from the base (empty restricted diff). Its exclusion is proven.

## Backport inventory

`none`. No separately approved upstream backport is in `4a5a616a…..HEAD`. Because check (b) could not run, this inventory is not cross-checked by patch equivalence (the (b) `gap`).

Listed separately, not as an upstream backport: operator commit `1dc68a9044379d9102017adf2c7c366daef5700c` (`test(shared): use placeholder UUIDs in the URL sanitization test`) on the base branch `feature/mcp-wiki-linting-v1.10.1`. It changes only `shared/editor/nodes/urlSanitization.test.ts:24-25` and is cited by the generic-data review under the Q1 decision ([conformance.md](conformance.md), Generic-data review).

## AC 6

Recorded as a **`gap`**: (a), (c), (d) and (e) pass, but (b) was not run.

## No publication, deployment or rollout

This story built no image, published nothing, mutated no environment, mounted no policy, deployed nothing and authorizes no rollout. It selects no OD-2 or OD-7 value. The only build was a local `corepack yarn build`, which failed in this worktree ([conformance.md](conformance.md), Commands). The evidence supports Gate 1 only.
