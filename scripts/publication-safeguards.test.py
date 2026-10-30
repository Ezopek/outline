#!/usr/bin/env python3
"""Offline static contract for the fork publication safeguards.

Standard library only; reads the ten workflow files and nothing else. No
network, credentials, subprocesses or product runtime.

Run: /usr/bin/python3 -B scripts/publication-safeguards.test.py

LIMITS (deliberate): this is NOT a YAML parser or a GitHub expression
evaluator. It is a strict line/indent matcher over the exact block-style shape
these ten files have today, and it fails closed (reports a violation) when it
meets a shape it does not recognise: tabs, flow-style `jobs`, unexpected job
ids, unexpected workflow files, non-exact `if` lines. It cannot prove runtime
behaviour on GitHub, action pinning, or that a workflow is (in)active. Use a
real YAML parser and actionlint separately for that. The publication-contract
job is matched as a whole against its current canonical text (only blank and
whole-line comment lines ignored), so any addition there is reported; that is a
current-source contract, not a proof that the job runs or gates merging.
"""

import re
import unittest
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parent.parent / ".github" / "workflows"

UPSTREAM = "github.repository == 'outline/outline'"
MAINTAINED = "feature/mcp-wiki-linting-v1.10.1"

GUARD_IF = "    if: ${{ %s }}" % UPSTREAM
TRANSLATION_IF = (
    "    if: ${{ %s && github.event.pull_request.user.login != "
    "'outline-translations' }}" % UPSTREAM
)
BUNDLE_IF = (
    "    if: ${{ (needs.changes.outputs.app == 'true' || "
    "needs.changes.outputs.config == 'true') && %s }}" % UPSTREAM
)
CALIBRE_IF = (
    "    if: |\n"
    "      github.repository == 'outline/outline' &&\n"
    "      (github.event_name != 'pull_request' ||\n"
    "       github.event.pull_request.head.repo.full_name == github.repository)"
)

# Accepted generic shape for a mutating job guard: the exact upstream equality,
# optionally ANDed with a tail that contains no `|` (so no OR can widen it).
GUARD_SHAPE = re.compile(
    r"^    if: \$\{\{ github\.repository == 'outline/outline'( && [^|]+)? \}\}$"
)

# file -> {job id: exact job-level `if` text (None = job needs no guard here)}
EXPECTED_JOBS = {
    "docker-build.yml": {"build": GUARD_IF, "merge": GUARD_IF},
    "docker.yml": {"publish": GUARD_IF},
    "docker-nightly.yml": {"publish": GUARD_IF},
    "auto-close-prs.yml": {"close-unsigned-prs": GUARD_IF},
    "stale.yml": {"stale": GUARD_IF},
    "update-node.yml": {"update-node": GUARD_IF},
    "close-translation-prs.yml": {"close-translation-prs": TRANSLATION_IF},
    "calibreapp-image-actions.yml": {"build": CALIBRE_IF},
    "codeql-analysis.yml": {"analyze": None},
    "ci.yml": {
        "changes": None,
        "lint": None,
        "actionlint": None,
        "types": None,
        "audit": None,
        "test": None,
        "test-server": None,
        "bundle-size": BUNDLE_IF,
        "publication-contract": None,
        "ci": None,
    },
}

# Jobs that must carry the generic mutating-guard shape (all but the exact
# special cases above are covered by the exact comparison; this is the second,
# independent check against OR/spoofed variants).
GENERIC_GUARDED = {
    ("docker-build.yml", "build"),
    ("docker-build.yml", "merge"),
    ("docker.yml", "publish"),
    ("docker-nightly.yml", "publish"),
    ("auto-close-prs.yml", "close-unsigned-prs"),
    ("stale.yml", "stale"),
    ("update-node.yml", "update-node"),
    ("close-translation-prs.yml", "close-translation-prs"),
}

CI_ON = (
    "on:\n"
    "  push:\n"
    "    branches: [main, %s]\n"
    "  pull_request:\n" % MAINTAINED
)
CODEQL_ON = (
    "on:\n"
    "  push:\n"
    "    branches: [main, %s]\n"
    "  pull_request:\n"
    "    # The branches below must be a subset of the branches above\n"
    "    branches: [main, %s]\n"
    "  schedule:\n"
    '    - cron: "28 15 * * 2"\n' % (MAINTAINED, MAINTAINED)
)
CI_PERMISSIONS = "permissions:\n  contents: read\n"
# The only job-level override in ci.yml: a job map replaces (does not extend)
# the workflow default, and paths-filter needs pull-requests: read on PRs.
CI_CHANGES_PERMISSIONS = (
    "    permissions:\n"
    "      contents: read\n"
    "      pull-requests: read\n"
)
CODEQL_JOB_PERMISSIONS = (
    "    permissions:\n"
    "      actions: read\n"
    "      contents: read\n"
    "      security-events: write\n"
)
CONTRACT_JOB = (
    "  publication-contract:\n"
    "    runs-on: ubuntu-latest\n"
    "    timeout-minutes: 5\n"
    "    steps:\n"
    "      - uses: actions/checkout@v5\n"
    "        with:\n"
    "          persist-credentials: false\n"
    "      - run: /usr/bin/python3 -B scripts/publication-safeguards.test.py\n"
)

# Upstream behaviour that must survive behind the guards (exact lines).
PRESERVED = {
    "docker-build.yml": [
        "  IMAGE_NAME: outlinewiki/outline",
        "  BASE_IMAGE_NAME: outlinewiki/outline-base",
        "        default: dockerhub",
        "    environment: ${{ inputs.environment }}",
        "          username: ${{ secrets.DOCKERHUB_USERNAME }}",
        "          password: ${{ secrets.DOCKERHUB_TOKEN }}",
    ],
    "docker-nightly.yml": [
        '    - cron: "0 3 * * *"',
        "      ref: main",
        "      environment: dockerhub-nightly",
        "        type=raw,value=nightly",
        "        type=raw,value=nightly-{{date 'YYYYMMDD'}}",
        "        type=sha,prefix=nightly-,format=short",
    ],
    "docker.yml": [
        '      - "v*"',
        "        type=ref,event=branch",
        "        type=semver,pattern={{version}}",
        "        type=semver,pattern={{major}}.{{minor}}",
    ],
    "close-translation-prs.yml": ["      - \"shared/i18n/locales/**\""],
    "ci.yml": ["    if: always()"],
}


def split_top_level(text, key):
    """Return the exact block `key:` ... up to the next column-0 key."""
    lines = text.split("\n")
    out = []
    inside = False
    for line in lines:
        if line.startswith(key + ":") and not inside:
            inside = True
            out.append(line)
            continue
        if inside:
            if line and not line[0].isspace() and not line.startswith("#"):
                break
            out.append(line)
    return "\n".join(out) + "\n" if out else None


def parse_jobs(text, name, problems):
    """Return {job id: body text} or record why the shape is unsupported."""
    if "\t" in text:
        problems.append("%s: tab character (unsupported shape)" % name)
    lines = text.split("\n")
    starts = [i for i, l in enumerate(lines) if re.match(r"^jobs:", l)]
    if len(starts) != 1 or lines[starts[0]] != "jobs:":
        problems.append("%s: need exactly one block-style column-0 `jobs:`" % name)
        return {}
    jobs = {}
    current = None
    for line in lines[starts[0] + 1:]:
        if not line.strip() or line.lstrip().startswith("#"):
            if current is not None:
                jobs[current].append(line)
            continue
        if not line[0].isspace():
            break  # next top-level key ends the jobs mapping
        m = re.match(r"^  ([A-Za-z_][A-Za-z0-9_-]*):$", line)
        if m:
            current = m.group(1)
            if current in jobs:
                problems.append("%s: duplicate job %s" % (name, current))
            jobs[current] = []
            continue
        if re.match(r"^  \S", line):
            problems.append("%s: unrecognised job-level line %r" % (name, line))
            continue
        if current is None:
            problems.append("%s: content before first job id" % name)
            continue
        jobs[current].append(line)
    return {k: "\n".join(v) for k, v in jobs.items()}


def job_if(body):
    """Return exact job-level `if` text (4-space key), or None; multi-line ok."""
    lines = body.split("\n")
    found = [i for i, l in enumerate(lines) if re.match(r"^    if:", l)]
    if len(found) != 1:
        return None if not found else "<multiple>"
    i = found[0]
    out = [lines[i]]
    if lines[i].rstrip() == "    if: |":
        for l in lines[i + 1:]:
            if l.startswith("      ") and l.strip():
                out.append(l)
            else:
                break
    return "\n".join(out)


def job_permissions(body):
    """Return the exact job-level `permissions` block (4-space key) or None.

    Multiple keys yield "<multiple>". The block runs while lines are indented
    deeper than the key; this is a specific static contract, not a YAML parser.
    """
    lines = body.split("\n")
    found = [i for i, l in enumerate(lines) if re.match(r"^    permissions:", l)]
    if not found:
        return None
    if len(found) != 1:
        return "<multiple>"
    out = [lines[found[0]]]
    for l in lines[found[0] + 1:]:
        if l.startswith("      ") and l.strip():
            out.append(l)
        else:
            break
    return "\n".join(out) + "\n"


def effective_job_text(job_id, body):
    """Header plus body with blank and whole-line comment lines removed.

    Only those two documented line kinds are dropped; every other line (any
    `if`, `needs`, `continue-on-error`, extra step, changed command, trailing
    whitespace) stays and must match the canonical text exactly.
    """
    kept = [
        l for l in body.split("\n") if l.strip() and not l.lstrip().startswith("#")
    ]
    return "  %s:\n%s\n" % (job_id, "\n".join(kept))


def validate(files):
    """files: {name: text}. Returns a list of violation strings ([] = pass)."""
    problems = []
    names = set(files)
    if names != set(EXPECTED_JOBS):
        problems.append(
            "workflow file set differs: extra=%s missing=%s"
            % (sorted(names - set(EXPECTED_JOBS)), sorted(set(EXPECTED_JOBS) - names))
        )
    for name in sorted(names & set(EXPECTED_JOBS)):
        text = files[name]
        jobs = parse_jobs(text, name, problems)
        expected = EXPECTED_JOBS[name]
        if set(jobs) != set(expected):
            problems.append(
                "%s: job set differs: extra=%s missing=%s"
                % (name, sorted(set(jobs) - set(expected)), sorted(set(expected) - set(jobs)))
            )
        for job, want in expected.items():
            if job not in jobs:
                continue
            got = job_if(jobs[job])
            if want is not None and got != want:
                problems.append("%s/%s: job-level if differs: %r" % (name, job, got))
            if (name, job) in GENERIC_GUARDED:
                if got is None or not GUARD_SHAPE.match(got):
                    problems.append("%s/%s: not an upstream-only AND guard" % (name, job))
            if want is None and name != "ci.yml" and got is not None:
                problems.append("%s/%s: unexpected job-level if" % (name, job))
        for line in PRESERVED.get(name, []):
            if line not in text.split("\n"):
                problems.append("%s: preserved upstream line missing: %r" % (name, line))
        if "ghcr.io" in text.lower():
            problems.append("%s: GHCR reference is out of scope for this change" % name)

    # Reusable publisher: only workflow_call, and callers delegate to it.
    db = files.get("docker-build.yml")
    if db is not None:
        on = split_top_level(db, "on") or ""
        if re.findall(r"^  (\w+):", on, re.M) != ["workflow_call"]:
            problems.append("docker-build.yml: must expose only workflow_call")
    for caller in ("docker.yml", "docker-nightly.yml"):
        if caller in files and "    uses: ./.github/workflows/docker-build.yml" not in files[caller]:
            problems.append("%s: no longer delegates to the reusable publisher" % caller)

    ci = files.get("ci.yml")
    if ci is not None:
        if (split_top_level(ci, "on") or "").rstrip("\n") != CI_ON.rstrip("\n"):
            problems.append("ci.yml: on-block differs from maintained-lineage filter")
        if (split_top_level(ci, "permissions") or "").rstrip("\n") != CI_PERMISSIONS.rstrip("\n"):
            problems.append("ci.yml: top-level permissions must be exactly contents: read")
        ci_jobs = parse_jobs(ci, "ci.yml", [])
        for job, jbody in ci_jobs.items():
            want = CI_CHANGES_PERMISSIONS if job == "changes" else None
            if job_permissions(jbody) != want:
                problems.append(
                    "ci.yml/%s: job-level permissions must be %s"
                    % (job, "exactly contents: read + pull-requests: read" if want else "absent")
                )
        # The COMPLETE effective job must equal the admitted body: a substring
        # prefix match would accept added `if`, `continue-on-error`, extra steps.
        contract_body = parse_jobs(ci, "ci.yml", []).get("publication-contract")
        if contract_body is None or effective_job_text(
            "publication-contract", contract_body
        ) != CONTRACT_JOB:
            problems.append("ci.yml: publication-contract job differs from exact shape")
        body = "\n".join(
            l
            for l in (contract_body or "").split("\n")
            if not l.lstrip().startswith("#")
        )
        for bad in ("yarn", "npm ", "pip ", "install", "setup-node"):
            if bad in body:
                problems.append("ci.yml: contract job must not use %r" % bad)
        agg = parse_jobs(ci, "ci.yml", []).get("ci", "")
        m = re.search(r"^    needs: \[([^\]]*)\]$", agg, re.M)
        needs = [x.strip() for x in m.group(1).split(",")] if m else []
        if "publication-contract" not in needs:
            problems.append("ci.yml: aggregate ci does not need publication-contract")
        if "bundle-size" not in needs:
            problems.append("ci.yml: aggregate lost bundle-size")

    cq = files.get("codeql-analysis.yml")
    if cq is not None:
        if (split_top_level(cq, "on") or "").rstrip("\n") != CODEQL_ON.rstrip("\n"):
            problems.append("codeql-analysis.yml: on-block differs from maintained filter")
        if CODEQL_JOB_PERMISSIONS not in cq:
            problems.append("codeql-analysis.yml: job security-events scope changed")
        if re.search(r"^permissions:", cq, re.M):
            problems.append("codeql-analysis.yml: unexpected top-level permissions")
    return problems


def load():
    return {p.name: p.read_text(encoding="utf-8") for p in sorted(WORKFLOWS.glob("*.y*ml"))}


def mutate(files, name, old, new, count=1):
    assert files[name].count(old) >= 1, "mutation target absent: %r" % old
    out = dict(files)
    out[name] = files[name].replace(old, new, count)
    assert out[name] != files[name]
    return out


class PositiveControls(unittest.TestCase):
    def test_current_tree_passes(self):
        self.assertEqual(validate(load()), [])

    def test_exactly_ten_workflows(self):
        self.assertEqual(set(load()), set(EXPECTED_JOBS))
        self.assertEqual(len(EXPECTED_JOBS), 10)

    def test_every_mutating_job_guarded_exactly(self):
        files = load()
        for name, jobs in EXPECTED_JOBS.items():
            parsed = parse_jobs(files[name], name, [])
            for job, want in jobs.items():
                if want is not None:
                    self.assertEqual(job_if(parsed[job]), want, "%s/%s" % (name, job))

    def test_upstream_semantics_and_inherited_guards_preserved(self):
        files = load()
        for name, lines in PRESERVED.items():
            for line in lines:
                self.assertIn(line, files[name].split("\n"))
        self.assertIn(CALIBRE_IF, files["calibreapp-image-actions.yml"])
        self.assertIn(BUNDLE_IF, files["ci.yml"])

    def test_no_new_publisher_or_dispatch(self):
        files = load()
        self.assertNotIn("workflow_dispatch", files["ci.yml"])
        self.assertNotIn("schedule", files["ci.yml"])
        self.assertIn(
            "  pull_request:\n\npermissions", files["ci.yml"],
            "CI pull_request stays unrestricted",
        )

    def test_validator_is_sensitive_to_unexpected_shapes(self):
        files = load()
        self.assertTrue(validate(mutate(files, "stale.yml", "jobs:\n", "jobs:\n\t")))
        self.assertTrue(validate(mutate(files, "stale.yml", "jobs:\n", "jobs: {}\n#")))


class NegativeMutations(unittest.TestCase):
    def assertCaught(self, files, fragment):
        problems = validate(files)
        self.assertTrue(problems, "mutation was NOT detected")
        self.assertTrue(
            any(fragment in p for p in problems), "unexpected report: %r" % problems
        )

    def test_remove_reusable_build_guard(self):
        files = mutate(load(), "docker-build.yml", GUARD_IF + "\n    strategy:", "    strategy:")
        self.assertCaught(files, "docker-build.yml/build")

    def test_remove_reusable_merge_guard(self):
        files = mutate(load(), "docker-build.yml", GUARD_IF + "\n    runs-on: blacksmith-8vcpu-ubuntu-2404\n", "    runs-on: blacksmith-8vcpu-ubuntu-2404\n")
        self.assertCaught(files, "docker-build.yml/merge")

    def test_remove_caller_guard(self):
        for name in ("docker.yml", "docker-nightly.yml", "auto-close-prs.yml", "stale.yml", "update-node.yml"):
            files = mutate(load(), name, GUARD_IF + "\n", "")
            self.assertCaught(files, name)

    def test_or_instead_of_and(self):
        files = mutate(load(), "close-translation-prs.yml", "' && github.event", "' || github.event")
        self.assertCaught(files, "close-translation-prs.yml/close-translation-prs")

    def test_spoofed_upstream_substring(self):
        spoofs = [
            "${{ contains(github.repository, 'outline/outline') }}",
            "${{ github.repository == 'outline/outline-fork' }}",
            "${{ github.repository == 'outline/outline' || vars.PUBLISH == 'true' }}",
            "${{ startsWith(github.repository, 'outline/') }}",
            "${{ github.repository_owner == 'outline' }}",
        ]
        for spoof in spoofs:
            files = mutate(load(), "docker.yml", GUARD_IF, "    if: " + spoof)
            self.assertCaught(files, "docker.yml/publish")

    def test_unguarded_new_job_in_known_file(self):
        files = dict(load())
        files["stale.yml"] += "\n  extra:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo x\n"
        self.assertCaught(files, "job set differs")

    def test_unexpected_new_workflow_file(self):
        files = dict(load())
        files["publish-new.yml"] = "name: x\non: push\njobs:\n  p:\n    runs-on: ubuntu-latest\n"
        self.assertCaught(files, "workflow file set differs")

    def test_guard_moved_off_job_level(self):
        files = mutate(load(), "docker.yml", GUARD_IF, "    #" + GUARD_IF.strip())
        self.assertCaught(files, "docker.yml/publish")

    def test_remove_maintained_filter(self):
        files = mutate(load(), "ci.yml", "branches: [main, %s]" % MAINTAINED, "branches: [main]")
        self.assertCaught(files, "ci.yml: on-block")
        files = mutate(load(), "codeql-analysis.yml", "branches: [main, %s]" % MAINTAINED, "branches: [main]", 1)
        self.assertCaught(files, "codeql-analysis.yml: on-block")
        files = mutate(load(), "codeql-analysis.yml", "branches: [main, %s]" % MAINTAINED, "branches: [main]", 2)
        self.assertTrue(validate(files))

    def test_detach_contract_job_from_aggregate(self):
        files = mutate(load(), "ci.yml", ", publication-contract]", "]")
        self.assertCaught(files, "aggregate ci does not need publication-contract")

    def test_ci_permissions_removed_or_widened(self):
        files = mutate(load(), "ci.yml", CI_PERMISSIONS + "\n", "")
        self.assertCaught(files, "ci.yml: top-level permissions")
        files = mutate(load(), "ci.yml", "contents: read", "contents: write")
        self.assertCaught(files, "ci.yml: top-level permissions")

    def test_changes_job_permissions_contract(self):
        # Positive control: the intended exact map is present and accepted.
        files = load()
        self.assertIn(CI_CHANGES_PERMISSIONS, files["ci.yml"])
        self.assertEqual(validate(files), [])
        frag = "ci.yml/changes: job-level permissions"
        files = mutate(load(), "ci.yml", "      contents: read\n      pull-requests: read\n", "      pull-requests: read\n")
        self.assertCaught(files, frag)
        files = mutate(load(), "ci.yml", "      contents: read\n      pull-requests: read\n", "      contents: read\n")
        self.assertCaught(files, frag)
        files = mutate(load(), "ci.yml", "      pull-requests: read\n", "      pull-requests: write\n")
        self.assertCaught(files, frag)
        files = mutate(load(), "ci.yml", "      contents: read\n      pull-requests: read\n", "      contents: write\n      pull-requests: read\n")
        self.assertCaught(files, frag)
        files = mutate(load(), "ci.yml", "      pull-requests: read\n", "      pull-requests: read\n      issues: read\n")
        self.assertCaught(files, frag)
        files = mutate(load(), "ci.yml", "    timeout-minutes: 5\n", "    timeout-minutes: 5\n    permissions:\n      contents: read\n")
        self.assertCaught(files, "ci.yml/publication-contract: job-level permissions")

    def test_contract_job_hardening_regressions(self):
        files = mutate(load(), "ci.yml", "          persist-credentials: false\n", "")
        self.assertCaught(files, "publication-contract job differs")
        files = mutate(load(), "ci.yml", "    timeout-minutes: 5\n", "")
        self.assertCaught(files, "publication-contract job differs")

    def test_contract_job_full_body_is_exact(self):
        frag = "publication-contract job differs"
        head = "  publication-contract:\n    runs-on: ubuntu-latest\n"
        run = "      - run: /usr/bin/python3 -B scripts/publication-safeguards.test.py\n"
        cases = {
            "job skip": (head, head + "    if: false\n"),
            "job needs": (head, head + "    needs: [lint]\n"),
            "job failure suppression": (head, head + "    continue-on-error: true\n"),
            "step failure suppression": (run, run + "        continue-on-error: true\n"),
            "step skip": (run, run + "        if: false\n"),
            "extra step": (run, run + "      - run: echo extra\n"),
            "altered command": (run, "      - run: /usr/bin/python3 -B scripts/other.py\n"),
            "timeout widened": ("    timeout-minutes: 5\n", "    timeout-minutes: 50\n"),
        }
        for label, (old, new) in cases.items():
            with self.subTest(label):
                self.assertCaught(mutate(load(), "ci.yml", old, new), frag)

    def test_contract_job_blank_and_comment_lines_tolerated(self):
        # Documented tolerance: only blank / whole-line comments are ignored.
        run = "      - run: /usr/bin/python3 -B scripts/publication-safeguards.test.py\n"
        files = mutate(load(), "ci.yml", run, run + "\n      # note\n")
        self.assertEqual(validate(files), [])

    def test_codeql_scope_changed(self):
        files = mutate(load(), "codeql-analysis.yml", "security-events: write", "security-events: read")
        self.assertCaught(files, "security-events scope")

    def test_inherited_upstream_guards_removed(self):
        files = mutate(load(), "ci.yml", " && github.repository == 'outline/outline' }}", " }}")
        self.assertCaught(files, "ci.yml/bundle-size")
        files = mutate(load(), "calibreapp-image-actions.yml", "github.repository == 'outline/outline' &&\n      ", "")
        self.assertCaught(files, "calibreapp-image-actions.yml/build")

    def test_ghcr_not_smuggled_in(self):
        files = mutate(load(), "docker-build.yml", "  IMAGE_NAME: outlinewiki/outline\n", "  IMAGE_NAME: ghcr.io/x/y\n")
        self.assertCaught(files, "GHCR")


if __name__ == "__main__":
    unittest.main(verbosity=2)
