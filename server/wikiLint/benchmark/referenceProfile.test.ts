import path from "node:path";
import type { EnvironmentCapture, ReadText } from "./referenceProfile";
import {
  ATTESTATIONS,
  OPERATOR_INPUTS,
  REFERENCE_PROFILE,
  captureEnvironment,
  isGate1Eligible,
  packageManagerYarn,
  profileDeviations,
  readCgroupLimits,
  runnerNodeVersion,
  yarnFromUserAgent,
} from "./referenceProfile";

const ROOT = "/srv/outline";

/**
 * Builds a file reader over fixed files.
 *
 * @param files - the files by path.
 * @returns the reader.
 */
const filesOf =
  (files: Record<string, string>): ReadText =>
  (file) =>
    files[file] ?? null;

/** A reference host: every detected item, input, and attestation conforms. */
function referenceCapture(): EnvironmentCapture {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    npm_config_user_agent: "yarn/4.11.0 npm/? node/v26.3.0 linux x64",
    [OPERATOR_INPUTS.postgresCpus]: "2",
    [OPERATOR_INPUTS.postgresMemoryBytes]: String(4 * 1024 ** 3),
    [OPERATOR_INPUTS.imageDigest]: `sha256:${"a".repeat(64)}`,
    [OPERATOR_INPUTS.sourceCommit]: "b".repeat(40),
  };
  for (const variable of Object.values(ATTESTATIONS)) {
    env[variable] = "yes";
  }
  const capture = captureEnvironment({
    env,
    repoRoot: ROOT,
    entryPath: path.join(ROOT, "build/server/wikiLint/benchmark/run.js"),
    postgres: {
      serverVersion: "14.2 (Debian 14.2-1.pgdg110+1)",
      settings: { max_connections: "100" },
    },
    pool: { max: 5, min: 0 },
    read: filesOf({
      "/sys/fs/cgroup/cpu.max": "200000 100000\n",
      "/sys/fs/cgroup/memory.max": `${4 * 1024 ** 3}\n`,
      "/sys/fs/cgroup/cpuset.cpus.effective": "2-3\n",
      [path.join(ROOT, "Dockerfile")]:
        "ARG BASE_IMAGE\nFROM ${BASE_IMAGE} AS base\nFROM node:26.3.0-slim AS runner\n",
      [path.join(ROOT, "package.json")]: JSON.stringify({
        packageManager: "yarn@4.11.0",
      }),
    }),
  });
  // The detected host items are fixed so the test runs on any host.
  return { ...capture, platform: "linux", arch: "x64", nodeVersion: "v26.3.0" };
}

describe("profileDeviations", () => {
  it("finds no deviation on a conforming reference host", () => {
    const capture = referenceCapture();
    expect(profileDeviations(capture)).toEqual([]);
    expect(isGate1Eligible([], false)).toBe(true);
    expect(capture.topology.connectionPoolMax).toBe(5);
    expect(capture.cgroup).toEqual({
      version: 2,
      cpus: 2,
      memoryBytes: 4 * 1024 ** 3,
      cpuset: "2-3",
    });
  });

  it("never qualifies a smoke run", () => {
    expect(isGate1Eligible([], true)).toBe(false);
  });

  it.each<[string, (capture: EnvironmentCapture) => EnvironmentCapture]>([
    ["platform", (c) => ({ ...c, platform: "win32" })],
    ["arch", (c) => ({ ...c, arch: "arm64" })],
    [
      "app cgroup CPU limit (vCPU)",
      (c) => ({ ...c, cgroup: { ...c.cgroup, cpus: null } }),
    ],
    [
      "app cgroup memory limit (bytes)",
      (c) => ({ ...c, cgroup: { ...c.cgroup, memoryBytes: 8 * 1024 ** 3 } }),
    ],
    ["node --version", (c) => ({ ...c, nodeVersion: "v26.3.1" })],
    ["node --version", (c) => ({ ...c, dockerfileNodeVersion: null })],
    ["Yarn version", (c) => ({ ...c, yarnVersion: null })],
    ["Yarn version", (c) => ({ ...c, packageManagerYarnVersion: null })],
    ["NODE_ENV", (c) => ({ ...c, nodeEnv: "test" })],
    ["production build", (c) => ({ ...c, runningFromBuild: false })],
    [
      "PostgreSQL server_version",
      (c) => ({ ...c, postgres: { ...c.postgres, serverVersion: "14.20" } }),
    ],
    [
      `PostgreSQL CPU limit (vCPU, ${OPERATOR_INPUTS.postgresCpus})`,
      (c) => ({ ...c, operator: { ...c.operator, postgresCpus: null } }),
    ],
    [
      `PostgreSQL memory limit (bytes, ${OPERATOR_INPUTS.postgresMemoryBytes})`,
      (c) => ({ ...c, operator: { ...c.operator, postgresMemoryBytes: 1 } }),
    ],
    [
      `local image digest (${OPERATOR_INPUTS.imageDigest})`,
      (c) => ({ ...c, operator: { ...c.operator, imageDigest: null } }),
    ],
    [
      `source commit (${OPERATOR_INPUTS.sourceCommit})`,
      (c) => ({ ...c, operator: { ...c.operator, sourceCommit: "main" } }),
    ],
    ...Object.entries(ATTESTATIONS).map(
      ([key, variable]): [
        string,
        (capture: EnvironmentCapture) => EnvironmentCapture,
      ] => [
        `attestation ${key} (${variable})`,
        (c) => ({ ...c, attestations: { ...c.attestations, [key]: false } }),
      ]
    ),
  ])("lists a deviating or missing %s", (item, deviate) => {
    const deviations = profileDeviations(deviate(referenceCapture()));
    expect(deviations.map((deviation) => deviation.item)).toEqual([item]);
    expect(isGate1Eligible(deviations, false)).toBe(false);
  });

  it("lists every item on a host with nothing captured", () => {
    const capture = captureEnvironment({
      env: {},
      repoRoot: "/nowhere",
      entryPath: null,
      postgres: { serverVersion: null, settings: {} },
      pool: { max: null, min: null },
      read: () => null,
    });
    const items = profileDeviations(capture).map(({ item }) => item);
    for (const expected of [
      "app cgroup CPU limit (vCPU)",
      "app cgroup memory limit (bytes)",
      "node --version",
      "Yarn version",
      "NODE_ENV",
      "production build",
      "PostgreSQL server_version",
      ...Object.keys(ATTESTATIONS).map(
        (key) =>
          `attestation ${key} (${ATTESTATIONS[key as keyof typeof ATTESTATIONS]})`
      ),
    ]) {
      expect(items).toContain(expected);
    }
    expect(capture.cgroup.version).toBeNull();
  });
});

describe("readCgroupLimits", () => {
  it("reads unlimited v2 limits as null", () => {
    expect(
      readCgroupLimits(
        filesOf({
          "/sys/fs/cgroup/cpu.max": "max 100000\n",
          "/sys/fs/cgroup/memory.max": "max\n",
        })
      )
    ).toEqual({ version: 2, cpus: null, memoryBytes: null, cpuset: null });
  });

  it("falls back to v1", () => {
    expect(
      readCgroupLimits(
        filesOf({
          "/sys/fs/cgroup/cpu/cpu.cfs_quota_us": "200000\n",
          "/sys/fs/cgroup/cpu/cpu.cfs_period_us": "100000\n",
          "/sys/fs/cgroup/memory/memory.limit_in_bytes":
            "9223372036854771712\n",
        })
      )
    ).toEqual({ version: 1, cpus: 2, memoryBytes: null, cpuset: null });
  });
});

describe("version readers", () => {
  it("reads the runner, packageManager, and Yarn user-agent versions", () => {
    expect(runnerNodeVersion("FROM node:26.3.0-slim AS runner")).toBe(
      "v26.3.0"
    );
    expect(runnerNodeVersion("FROM node:26.3.0-slim AS base")).toBeNull();
    expect(
      packageManagerYarn('{"packageManager":"yarn@4.11.0+sha512.x"}')
    ).toBe("4.11.0");
    expect(packageManagerYarn("not json")).toBeNull();
    expect(yarnFromUserAgent("yarn/4.11.0 npm/? node/v26.3.0")).toBe("4.11.0");
    expect(yarnFromUserAgent("npm/10.0.0 node/v26.3.0")).toBeNull();
    expect(yarnFromUserAgent(undefined)).toBeNull();
  });

  it("matches the checked-out Dockerfile and package.json", () => {
    const capture = captureEnvironment({
      env: {},
      repoRoot: process.cwd(),
      entryPath: null,
      postgres: { serverVersion: null, settings: {} },
      pool: { max: null, min: null },
    });
    expect(capture.dockerfileNodeVersion).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(capture.packageManagerYarnVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(REFERENCE_PROFILE.postgresVersion).toBe("14.2");
  });
});
