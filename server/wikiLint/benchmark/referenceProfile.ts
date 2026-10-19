import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** One GiB, in bytes. */
const GIB = 1024 * 1024 * 1024;

/**
 * The AD-17 reference profile: a production build on Linux x86-64, the app
 * limited to two dedicated vCPU and 4 GiB, and PostgreSQL 14.2 limited to two
 * dedicated vCPU and 4 GiB on local SSD on the same host.
 */
export const REFERENCE_PROFILE = Object.freeze({
  platform: "linux",
  arch: "x64",
  appCpus: 2,
  appMemoryBytes: 4 * GIB,
  nodeEnv: "production",
  postgresVersion: "14.2",
  postgresCpus: 2,
  postgresMemoryBytes: 4 * GIB,
});

/** The operator inputs, read from the environment. */
export const OPERATOR_INPUTS = Object.freeze({
  postgresCpus: "WIKILINT_BENCH_POSTGRES_CPUS",
  postgresMemoryBytes: "WIKILINT_BENCH_POSTGRES_MEMORY_BYTES",
  imageDigest: "WIKILINT_BENCH_IMAGE_DIGEST",
  sourceCommit: "WIKILINT_BENCH_SOURCE_COMMIT",
});

/**
 * The operator attestations, read from the environment; each holds only when
 * its variable is exactly `yes`.
 */
export const ATTESTATIONS = Object.freeze({
  sameHost: "WIKILINT_BENCH_ATTEST_SAME_HOST",
  localSsd: "WIKILINT_BENCH_ATTEST_LOCAL_SSD",
  noArtificialLatency: "WIKILINT_BENCH_ATTEST_NO_ARTIFICIAL_LATENCY",
  noCompetingTraffic: "WIKILINT_BENCH_ATTEST_NO_COMPETING_TRAFFIC",
});

export type Attestation = keyof typeof ATTESTATIONS;

/** The cgroup limits of the app process. */
export interface CgroupLimits {
  version: 1 | 2 | null;
  /** The CPU quota in vCPU; null when unlimited or unreadable. */
  cpus: number | null;
  memoryBytes: number | null;
  /** The effective cpuset, as the kernel prints it. */
  cpuset: string | null;
}

/** The captured benchmark environment (AD-17, criteria 2 and 8). */
export interface EnvironmentCapture {
  platform: string;
  arch: string;
  kernel: string;
  cpuModel: string | null;
  hostCpuCount: number;
  hostMemoryBytes: number;
  cgroup: CgroupLimits;
  nodeVersion: string;
  /** The Node version of the Dockerfile `runner` stage, `v`-prefixed. */
  dockerfileNodeVersion: string | null;
  /** The running Yarn version, from the Yarn user agent. */
  yarnVersion: string | null;
  /** The Yarn version of `package.json` `packageManager`. */
  packageManagerYarnVersion: string | null;
  nodeEnv: string | null;
  /** Whether the harness runs from the compiled `build/` output. */
  runningFromBuild: boolean;
  entryPath: string | null;
  postgres: {
    serverVersion: string | null;
    settings: Record<string, string>;
  };
  topology: {
    SERVICES: string | null;
    WEB_CONCURRENCY: string | null;
    REQUEST_TIMEOUT: string | null;
    connectionPoolMax: number | null;
    connectionPoolMin: number | null;
  };
  operator: {
    postgresCpus: number | null;
    postgresMemoryBytes: number | null;
    imageDigest: string | null;
    sourceCommit: string | null;
  };
  attestations: Record<Attestation, boolean>;
}

/** One way the environment departs from the reference profile. */
export interface Deviation {
  item: string;
  expected: string;
  actual: string;
}

/** Reads a text file, or returns null. */
export type ReadText = (file: string) => string | null;

/** The default file reader; any failure reads as null. */
export const readText: ReadText = (file) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

/**
 * Reads the app's cgroup CPU and memory limits, v2 first, then v1.
 *
 * @param read - the file reader.
 * @returns the limits; an unreadable or unlimited value is null.
 */
export function readCgroupLimits(read: ReadText = readText): CgroupLimits {
  const v2Cpu = read("/sys/fs/cgroup/cpu.max");
  if (v2Cpu !== null) {
    const [quota, period] = v2Cpu.trim().split(/\s+/);
    const memory = read("/sys/fs/cgroup/memory.max")?.trim();
    return {
      version: 2,
      cpus:
        quota && quota !== "max" && Number(period) > 0
          ? Number(quota) / Number(period)
          : null,
      memoryBytes:
        memory && memory !== "max" && /^\d+$/.test(memory)
          ? Number(memory)
          : null,
      cpuset: read("/sys/fs/cgroup/cpuset.cpus.effective")?.trim() || null,
    };
  }
  const quota = Number(read("/sys/fs/cgroup/cpu/cpu.cfs_quota_us")?.trim());
  const period = Number(read("/sys/fs/cgroup/cpu/cpu.cfs_period_us")?.trim());
  const memory = read("/sys/fs/cgroup/memory/memory.limit_in_bytes")?.trim();
  const cpuset = read("/sys/fs/cgroup/cpuset/cpuset.effective_cpus")?.trim();
  const found = Number.isFinite(quota) || memory !== undefined;
  return {
    version: found ? 1 : null,
    cpus: quota > 0 && period > 0 ? quota / period : null,
    // v1 reports an unlimited memory as a huge page-aligned number.
    memoryBytes:
      memory && /^\d+$/.test(memory) && Number(memory) < 2 ** 62
        ? Number(memory)
        : null,
    cpuset: cpuset || null,
  };
}

/**
 * Reads the Node version of the Dockerfile `runner` stage.
 *
 * @param dockerfile - the Dockerfile text.
 * @returns the version, `v`-prefixed, or null.
 */
export function runnerNodeVersion(dockerfile: string | null): string | null {
  const match = dockerfile?.match(
    /^FROM\s+node:(\d+\.\d+\.\d+)[^\s]*\s+AS\s+runner\s*$/im
  );
  return match ? `v${match[1]}` : null;
}

/**
 * Reads the Yarn version of a `packageManager` field.
 *
 * @param packageJson - the `package.json` text.
 * @returns the version, or null.
 */
export function packageManagerYarn(packageJson: string | null): string | null {
  try {
    const value = JSON.parse(packageJson ?? "null")?.packageManager;
    const match =
      typeof value === "string" ? /^yarn@(\d+\.\d+\.\d+)/.exec(value) : null;
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Reads the running Yarn version from the user agent Yarn sets for the
 * processes it starts.
 *
 * @param userAgent - `npm_config_user_agent`.
 * @returns the version, or null when the process was not started by Yarn.
 */
export function yarnFromUserAgent(
  userAgent: string | undefined
): string | null {
  const match = userAgent ? /\byarn\/(\d+\.\d+\.\d+)/.exec(userAgent) : null;
  return match ? match[1] : null;
}

/**
 * Parses a non-negative number from the environment.
 *
 * @param value - the variable.
 * @returns the number, or null.
 */
const numberOf = (value: string | undefined) =>
  value !== undefined && /^\d+(\.\d+)?$/.test(value) ? Number(value) : null;

/**
 * Captures the environment of a benchmark run: everything the process can
 * detect itself, the operator inputs, and the operator attestations.
 *
 * @param input.env - the process environment.
 * @param input.repoRoot - the checkout holding `Dockerfile` and `package.json`.
 * @param input.entryPath - the script the process runs, if any.
 * @param input.postgres - the PostgreSQL version and settings, as read.
 * @param input.pool - the connection-pool bounds.
 * @param input.read - the file reader.
 * @returns the capture.
 */
export function captureEnvironment(input: {
  env: NodeJS.ProcessEnv;
  repoRoot: string;
  entryPath: string | null;
  postgres: { serverVersion: string | null; settings: Record<string, string> };
  pool: { max: number | null; min: number | null };
  read?: ReadText;
}): EnvironmentCapture {
  const { env, repoRoot, entryPath, postgres, pool } = input;
  const read = input.read ?? readText;
  const [cpu] = os.cpus();
  const attestations = {} as Record<Attestation, boolean>;
  for (const [key, variable] of Object.entries(ATTESTATIONS)) {
    attestations[key as Attestation] = env[variable] === "yes";
  }
  return {
    platform: process.platform,
    arch: process.arch,
    kernel: `${os.type()} ${os.release()}`,
    cpuModel: cpu?.model ?? null,
    hostCpuCount: os.cpus().length,
    hostMemoryBytes: os.totalmem(),
    cgroup: readCgroupLimits(read),
    nodeVersion: process.version,
    dockerfileNodeVersion: runnerNodeVersion(
      read(path.join(repoRoot, "Dockerfile"))
    ),
    yarnVersion: yarnFromUserAgent(env.npm_config_user_agent),
    packageManagerYarnVersion: packageManagerYarn(
      read(path.join(repoRoot, "package.json"))
    ),
    nodeEnv: env.NODE_ENV ?? null,
    runningFromBuild:
      entryPath !== null &&
      path
        .relative(path.join(repoRoot, "build"), entryPath)
        .split(path.sep)[0] !== "..",
    entryPath,
    postgres,
    topology: {
      SERVICES: env.SERVICES ?? null,
      WEB_CONCURRENCY: env.WEB_CONCURRENCY ?? null,
      REQUEST_TIMEOUT: env.REQUEST_TIMEOUT ?? null,
      connectionPoolMax: pool.max,
      connectionPoolMin: pool.min,
    },
    operator: {
      postgresCpus: numberOf(env[OPERATOR_INPUTS.postgresCpus]),
      postgresMemoryBytes: numberOf(env[OPERATOR_INPUTS.postgresMemoryBytes]),
      imageDigest: env[OPERATOR_INPUTS.imageDigest] || null,
      sourceCommit: env[OPERATOR_INPUTS.sourceCommit] || null,
    },
    attestations,
  };
}

/**
 * Lists every way a captured environment departs from the reference profile.
 * A missing item is a deviation, never a pass.
 *
 * @param capture - the capture.
 * @returns the deviations, in a fixed order.
 */
export function profileDeviations(capture: EnvironmentCapture): Deviation[] {
  const deviations: Deviation[] = [];
  type Value = string | number | boolean | null | undefined;
  const show = (value: Value) =>
    value === null || value === undefined ? "missing" : String(value);
  const expect = (item: string, expected: Value, actual: Value) => {
    if (actual === null || actual === undefined || actual !== expected) {
      deviations.push({
        item,
        expected: String(expected),
        actual: show(actual),
      });
    }
  };

  expect("platform", REFERENCE_PROFILE.platform, capture.platform);
  expect("arch", REFERENCE_PROFILE.arch, capture.arch);
  expect(
    "app cgroup CPU limit (vCPU)",
    REFERENCE_PROFILE.appCpus,
    capture.cgroup.cpus
  );
  expect(
    "app cgroup memory limit (bytes)",
    REFERENCE_PROFILE.appMemoryBytes,
    capture.cgroup.memoryBytes
  );
  if (capture.dockerfileNodeVersion === null) {
    deviations.push({
      item: "node --version",
      expected: "the Dockerfile runner version",
      actual: `${capture.nodeVersion}; Dockerfile runner version missing`,
    });
  } else {
    expect(
      "node --version",
      capture.dockerfileNodeVersion,
      capture.nodeVersion
    );
  }
  if (capture.packageManagerYarnVersion === null) {
    deviations.push({
      item: "Yarn version",
      expected: "the package.json packageManager version",
      actual: `${show(capture.yarnVersion)}; packageManager missing`,
    });
  } else {
    expect(
      "Yarn version",
      capture.packageManagerYarnVersion,
      capture.yarnVersion
    );
  }
  expect("NODE_ENV", REFERENCE_PROFILE.nodeEnv, capture.nodeEnv);
  expect("production build", true, capture.runningFromBuild);
  expect(
    "PostgreSQL server_version",
    REFERENCE_PROFILE.postgresVersion,
    capture.postgres.serverVersion?.split(/\s+/)[0] ?? null
  );
  expect(
    `PostgreSQL CPU limit (vCPU, ${OPERATOR_INPUTS.postgresCpus})`,
    REFERENCE_PROFILE.postgresCpus,
    capture.operator.postgresCpus
  );
  expect(
    `PostgreSQL memory limit (bytes, ${OPERATOR_INPUTS.postgresMemoryBytes})`,
    REFERENCE_PROFILE.postgresMemoryBytes,
    capture.operator.postgresMemoryBytes
  );
  if (!/^sha256:[0-9a-f]{64}$/.test(capture.operator.imageDigest ?? "")) {
    deviations.push({
      item: `local image digest (${OPERATOR_INPUTS.imageDigest})`,
      expected: "sha256:<64 hex>",
      actual: show(capture.operator.imageDigest),
    });
  }
  if (!/^[0-9a-f]{40}$/.test(capture.operator.sourceCommit ?? "")) {
    deviations.push({
      item: `source commit (${OPERATOR_INPUTS.sourceCommit})`,
      expected: "<40 hex>",
      actual: show(capture.operator.sourceCommit),
    });
  }
  for (const [key, variable] of Object.entries(ATTESTATIONS)) {
    if (!capture.attestations[key as Attestation]) {
      deviations.push({
        item: `attestation ${key} (${variable})`,
        expected: "yes",
        actual: "not attested",
      });
    }
  }
  return deviations;
}

/**
 * Decides whether a run is Gate 1 evidence: only a full run with no
 * deviation. A smoke run never is.
 *
 * @param deviations - the deviations.
 * @param smoke - whether the run used reduced samples.
 * @returns whether the run is Gate 1 eligible.
 */
export function isGate1Eligible(
  deviations: readonly Deviation[],
  smoke: boolean
): boolean {
  return !smoke && deviations.length === 0;
}
