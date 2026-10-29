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

/** Operator declarations; these are test inputs, not observed host facts. */
function sharedMetadata() {
  return {
    schemaVersion: 1,
    source: "operator",
    coTenancy: "shared-smt-ordinary-host-traffic",
    preflightEvidenceRef: "evidence:preflight-001",
    postgresCpuset: "4-5",
    cpuTopology: [2, 3, 4, 5].map((cpu) => ({ cpu, socket: 0, core: cpu })),
    storage: "local-nvme-ssd",
    attestations: {
      affinityPinned: "yes",
      coTenancyDisclosed: "yes",
      fixtureExclusive: "yes",
      noHeavyWork: "yes",
      pgdataOnLocalNvme: "yes",
    },
    telemetry: {
      collector: "controller",
      windowId: "benchmark-001",
      evidenceRef: "evidence:telemetry-001",
      capture: "planned-before-during-after",
      coverage: ["cpu", "io", "psi", "memory", "device", "network"],
    },
  };
}

/** Exercises the same environment input as the production entrypoint. */
function selectedCapture(
  overrides: NodeJS.ProcessEnv = {}
): EnvironmentCapture {
  const capture = captureEnvironment({
    env: {
      NODE_ENV: "production",
      npm_config_user_agent: "yarn/4.11.0 node/v26.12.1",
      [OPERATOR_INPUTS.postgresCpus]: "2",
      [OPERATOR_INPUTS.postgresMemoryBytes]: String(4 * 1024 ** 3),
      [OPERATOR_INPUTS.imageDigest]: `sha256:${"a".repeat(64)}`,
      [OPERATOR_INPUTS.sourceCommit]: "b".repeat(40),
      ...Object.fromEntries(
        Object.values(ATTESTATIONS).map((key) => [key, "yes"])
      ),
      WIKILINT_BENCH_REFERENCE_PROFILE: "shared-host-ssd-v1",
      WIKILINT_BENCH_ATTEST_NO_COMPETING_TRAFFIC: "no",
      WIKILINT_BENCH_SHARED_HOST_METADATA: JSON.stringify(sharedMetadata()),
      ...overrides,
    },
    repoRoot: ROOT,
    entryPath: path.join(ROOT, "build/server/wikiLint/benchmark/run.js"),
    postgres: { serverVersion: "14.2", settings: {} },
    pool: { max: 5, min: 0 },
    read: filesOf({
      "/sys/fs/cgroup/cpu.max": "200000 100000\n",
      "/sys/fs/cgroup/memory.max": `${4 * 1024 ** 3}\n`,
      "/sys/fs/cgroup/cpuset.cpus.effective": "2-3\n",
      [path.join(ROOT, "Dockerfile")]: "FROM node:26.12.1-slim AS runner\n",
      [path.join(ROOT, "package.json")]: '{"packageManager":"yarn@4.11.0"}',
    }),
  });
  return {
    ...capture,
    platform: "linux",
    arch: "x64",
    nodeVersion: "v26.12.1",
  };
}

describe("explicit reference selection", () => {
  it("defaults to strict and admits explicit strict with unchanged legacy inputs", () => {
    const capture = referenceCapture();
    expect(capture).toMatchObject({ referenceProfile: "strict-dedicated-v1" });
    const explicit = selectedCapture({
      WIKILINT_BENCH_REFERENCE_PROFILE: "strict-dedicated-v1",
      WIKILINT_BENCH_ATTEST_NO_COMPETING_TRAFFIC: "yes",
    });
    expect(profileDeviations(explicit)).toEqual([]);
    expect(explicit).toMatchObject({ referenceProfile: "strict-dedicated-v1" });
  });

  it("retains shared co-tenancy, provenance and the false legacy attestation", () => {
    const capture = selectedCapture();
    expect(capture).toMatchObject({
      referenceProfile: "shared-host-ssd-v1",
      sharedHost: sharedMetadata(),
      attestations: { noCompetingTraffic: false },
    });
    expect(profileDeviations(capture)).toEqual([]);
    expect(isGate1Eligible(profileDeviations(capture), false)).toBe(true);
    expect(isGate1Eligible(profileDeviations(capture), true)).toBe(false);
  });

  it.each(["", "unknown", " shared-host-ssd-v1", "SHARED-HOST-SSD-V1"])(
    "rejects an unknown or malformed selector %j without strict fallback",
    (selector) => {
      const capture = selectedCapture({
        WIKILINT_BENCH_REFERENCE_PROFILE: selector,
        WIKILINT_BENCH_ATTEST_NO_COMPETING_TRAFFIC: "yes",
      });
      expect(profileDeviations(capture).map(({ item }) => item)).toContain(
        "reference profile selector"
      );
      expect(isGate1Eligible(profileDeviations(capture), false)).toBe(false);
    }
  );
});

describe("shared-host admission", () => {
  const admission = (metadata: unknown) =>
    selectedCapture({
      WIKILINT_BENCH_SHARED_HOST_METADATA: JSON.stringify(metadata),
    });
  const rejects = (capture: EnvironmentCapture) => {
    expect(profileDeviations(capture).length).toBeGreaterThan(0);
    expect(isGate1Eligible(profileDeviations(capture), false)).toBe(false);
  };

  it.each([undefined, "", "{", "null", "[]", "{}", '"metadata"'])(
    "rejects missing/malformed metadata %j",
    (value) =>
      rejects(selectedCapture({ WIKILINT_BENCH_SHARED_HOST_METADATA: value }))
  );

  it.each(Object.keys(sharedMetadata()))(
    "requires metadata field %s",
    (key) => {
      const metadata: Record<string, unknown> = sharedMetadata();
      delete metadata[key];
      rejects(admission(metadata));
    }
  );

  it.each(Object.keys(sharedMetadata().attestations))(
    "requires positive attestation %s",
    (key) => {
      for (const value of [undefined, "no", true, "YES"]) {
        const metadata = sharedMetadata();
        const attestations: Record<string, unknown> = metadata.attestations;
        attestations[key] = value;
        rejects(admission(metadata));
      }
    }
  );

  it.each([
    { source: "detected" },
    { coTenancy: "dedicated" },
    { storage: "raid" },
    { storage: "tmpfs" },
    { storage: "ssd" },
    { preflightEvidenceRef: "" },
    { preflightEvidenceRef: "unbound evidence" },
    { preflightEvidenceRef: "evidence:preflight-001\n" },
    { schemaVersion: 2 },
    { unknown: "ignored?" },
    ...Object.keys(sharedMetadata().telemetry).map((key) => {
      const telemetry: Record<string, unknown> = sharedMetadata().telemetry;
      delete telemetry[key];
      return { telemetry };
    }),
    { telemetry: { ...sharedMetadata().telemetry, capture: "completed" } },
    { telemetry: { ...sharedMetadata().telemetry, collector: "automatic" } },
    { telemetry: { ...sharedMetadata().telemetry, evidenceRef: "" } },
    {
      telemetry: {
        ...sharedMetadata().telemetry,
        evidenceRef: "evidence:window\n",
      },
    },
    { telemetry: { ...sharedMetadata().telemetry, windowId: "" } },
    { telemetry: { ...sharedMetadata().telemetry, windowId: "window\n" } },
    { telemetry: { ...sharedMetadata().telemetry, coverage: ["cpu"] } },
  ])("rejects unsupported claims or incomplete provenance %j", (overrides) => {
    rejects(admission({ ...sharedMetadata(), ...overrides }));
  });

  it.each([
    null,
    "",
    "2",
    "2-4",
    "3-2",
    "2,2",
    "2,,3",
    "2, 3",
    "-1,2",
    "2-999999999",
  ])("rejects absent/invalid detected app affinity %j", (cpuset) => {
    const capture = selectedCapture();
    rejects({ ...capture, cgroup: { ...capture.cgroup, cpuset } });
  });

  it.each([
    "",
    "4",
    "4-6",
    "5-4",
    "4,4",
    "4,,5",
    "4, 5",
    "4,5\n",
    "4-999999999",
    "3,4",
  ])(
    "rejects absent/invalid/overlapping PostgreSQL affinity %j",
    (postgresCpuset) => {
      rejects(admission({ ...sharedMetadata(), postgresCpuset }));
    }
  );

  it.each(
    [
      sharedMetadata().cpuTopology.slice(1),
      sharedMetadata().cpuTopology.map((row, index) =>
        index === 1 ? { ...row, cpu: 2 } : row
      ),
      sharedMetadata().cpuTopology.map((row, index) =>
        index === 1 ? { ...row, core: 2 } : row
      ),
      sharedMetadata().cpuTopology.map((row, index) =>
        index === 3 ? { ...row, core: 4 } : row
      ),
      sharedMetadata().cpuTopology.map((row, index) =>
        index === 2 ? { ...row, core: 2 } : row
      ),
      sharedMetadata().cpuTopology.map((row, index) =>
        index === 2 ? { ...row, cpu: 6 } : row
      ),
      sharedMetadata().cpuTopology.map((row) => ({ ...row, socket: -1 })),
      sharedMetadata().cpuTopology.map((row) => ({ ...row, core: "0" })),
    ].map((cpuTopology) => ({ cpuTopology }))
  )(
    "rejects missing/invalid/duplicate or shared physical-core topology %j",
    ({ cpuTopology }) => {
      rejects(admission({ ...sharedMetadata(), cpuTopology }));
    }
  );

  it("accepts comma cpusets and distinguishes core IDs by socket", () => {
    const capture = admission({
      ...sharedMetadata(),
      postgresCpuset: "4,5",
      cpuTopology: [
        { cpu: 2, socket: 0, core: 0 },
        { cpu: 3, socket: 0, core: 1 },
        { cpu: 4, socket: 1, core: 0 },
        { cpu: 5, socket: 1, core: 1 },
      ],
    });
    expect(
      profileDeviations({
        ...capture,
        cgroup: { ...capture.cgroup, cpuset: "2,3" },
      })
    ).toEqual([]);
  });

  it("keeps strict false legacy attestation ineligible despite valid shared metadata", () => {
    rejects(
      selectedCapture({
        WIKILINT_BENCH_REFERENCE_PROFILE: "strict-dedicated-v1",
      })
    );
    rejects(selectedCapture({ WIKILINT_BENCH_REFERENCE_PROFILE: undefined }));
    rejects(
      selectedCapture({ WIKILINT_BENCH_ATTEST_NO_COMPETING_TRAFFIC: "yes" })
    );
  });

  it.each<[string, (capture: EnvironmentCapture) => EnvironmentCapture]>([
    ["platform", (c) => ({ ...c, platform: "darwin" })],
    ["architecture", (c) => ({ ...c, arch: "arm64" })],
    ["app quota", (c) => ({ ...c, cgroup: { ...c.cgroup, cpus: 4 } })],
    [
      "app memory",
      (c) => ({ ...c, cgroup: { ...c.cgroup, memoryBytes: null } }),
    ],
    ["runtime", (c) => ({ ...c, nodeVersion: "v26.3.0" })],
    [
      "old runner pin",
      (c) => ({
        ...c,
        nodeVersion: "v26.3.0",
        dockerfileNodeVersion: "v26.3.0",
      }),
    ],
    ["Yarn", (c) => ({ ...c, yarnVersion: "4.10.0" })],
    ["production build", (c) => ({ ...c, runningFromBuild: false })],
    ["production environment", (c) => ({ ...c, nodeEnv: "test" })],
    [
      "PG version",
      (c) => ({ ...c, postgres: { ...c.postgres, serverVersion: "14.20" } }),
    ],
    [
      "PG quota",
      (c) => ({ ...c, operator: { ...c.operator, postgresCpus: 1 } }),
    ],
    [
      "PG memory",
      (c) => ({ ...c, operator: { ...c.operator, postgresMemoryBytes: null } }),
    ],
    [
      "same host",
      (c) => ({ ...c, attestations: { ...c.attestations, sameHost: false } }),
    ],
    [
      "SSD",
      (c) => ({ ...c, attestations: { ...c.attestations, localSsd: false } }),
    ],
    [
      "latency",
      (c) => ({
        ...c,
        attestations: { ...c.attestations, noArtificialLatency: false },
      }),
    ],
  ])("retains common environment requirement: %s", (_name, deviate) => {
    rejects(deviate(selectedCapture()));
  });
});
