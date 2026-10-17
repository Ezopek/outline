import { createHash } from "node:crypto";
import fs from "node:fs";
import Logger from "@server/logging/Logger";
import type { PolicySet, Sha256Hex } from "../core/policySet";
import {
  POLICY_CONFIG_MAX_BYTES,
  buildPolicySet,
  isPolicySetReady,
} from "../core/policySet";

/**
 * Computes the lowercase hexadecimal SHA-256 digest of some bytes.
 *
 * @param bytes - the bytes.
 * @returns the digest.
 */
const sha256Hex: Sha256Hex = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

/**
 * Reads at most one byte more than the size limit from a policy file.
 *
 * @param path - the file path.
 * @returns the exact bytes, or null when the file is unreadable or too large.
 */
export function readPolicyConfigFile(path: string): Uint8Array | null {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(path, "r");
    const buffer = Buffer.alloc(POLICY_CONFIG_MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = fs.readSync(
        descriptor,
        buffer,
        length,
        buffer.length - length,
        null
      );
      if (read === 0) {
        break;
      }
      length += read;
    }
    return length > POLICY_CONFIG_MAX_BYTES ? null : buffer.subarray(0, length);
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // The bytes, if any, were already read.
      }
    }
  }
}

/**
 * Loads the collection lint policy in a service's master process, before any
 * worker is forked. It reads `WIKI_LINT_CONFIG_PATH` once and either exports
 * the exact bytes to forked workers through `WIKI_LINT_CONFIG_BASE64` or
 * stops the process. Logs carry only operator-only codes, offsets, counts,
 * identifiers, fingerprints, and schema paths, never configuration content.
 *
 * @param env - the environment the workers inherit.
 * @returns the policy set.
 */
export function initializePolicyConfiguration(
  env: NodeJS.ProcessEnv = process.env
): PolicySet {
  const path = env.WIKI_LINT_CONFIG_PATH;
  const isAbsent = path === undefined || path === "";
  const bytes = isAbsent ? null : readPolicyConfigFile(path);
  const result =
    isAbsent || bytes
      ? buildPolicySet(bytes, sha256Hex)
      : ({
          ok: false,
          code: "POLICY_CONFIGURATION_MALFORMED",
          location: "file",
        } as const);

  if (!result.ok) {
    Logger.warn("Wiki lint policy configuration is invalid", {
      code: result.code,
      location: result.location,
    });
    return process.exit(1);
  }

  // Always set, so a value from a `.env` file can never reach a worker.
  env.WIKI_LINT_CONFIG_BASE64 = bytes
    ? Buffer.from(bytes).toString("base64")
    : "";

  const { policySet, sentinels } = result;
  let readOnlyCount = 0;
  let enforcedCount = 0;
  for (const entry of policySet.entries) {
    if (entry.status === "valid" && entry.policy.activation === "read_only") {
      readOnlyCount++;
    } else if (entry.status === "valid") {
      enforcedCount++;
    }
  }
  Logger.info("lifecycle", "Wiki lint policy configuration loaded", {
    configStatus: isAbsent ? "absent" : "loaded",
    readOnlyCount,
    enforcedCount,
    invalidCount: sentinels.length,
    policySetFingerprint: policySet.policySetFingerprint,
    sentinels: sentinels.map((sentinel) => ({
      collectionId: sentinel.collectionId,
      code: sentinel.code,
      path: sentinel.path,
      invalidFingerprint: sentinel.invalidFingerprint,
    })),
  });
  return policySet;
}

/**
 * Rebuilds a worker's policy set from the bytes its master exported. It never
 * reads `WIKI_LINT_CONFIG_PATH` or any file.
 *
 * @param env - the worker's environment.
 * @returns the policy set; empty when the master exported no bytes.
 * @throws Error when the exported bytes do not load.
 */
export function policySetFromEnvironment(env: NodeJS.ProcessEnv): PolicySet {
  const encoded = env.WIKI_LINT_CONFIG_BASE64;
  const result = buildPolicySet(
    encoded ? Buffer.from(encoded, "base64") : null,
    sha256Hex
  );
  if (!result.ok) {
    throw new Error("The wiki lint policy configuration could not be loaded");
  }
  return result.policySet;
}

let workerPolicySet: PolicySet | undefined;

/**
 * Returns this process's immutable policy set, built once from the bytes the
 * master exported.
 *
 * @returns the policy set.
 */
export function getPolicySet(): PolicySet {
  if (!workerPolicySet) {
    workerPolicySet = policySetFromEnvironment(process.env);
  }
  return workerPolicySet;
}

/** The response header that names a worker's startup policy set. */
export const POLICY_SET_FINGERPRINT_HEADER =
  "X-Wiki-Lint-Policy-Set-Fingerprint";

/** A worker's AD-19 policy readiness, fixed at startup. */
export interface PolicyReadiness {
  readonly ready: boolean;
  readonly policySetFingerprint: string;
}

let workerPolicyReadiness: PolicyReadiness | undefined;

/**
 * Returns this process's policy readiness, computed once from its policy set
 * and its inherited `WIKI_LINT_EXPECTED_CONFIG_FINGERPRINT`.
 *
 * @returns the readiness.
 */
export function getPolicyReadiness(): PolicyReadiness {
  if (!workerPolicyReadiness) {
    const policySet = getPolicySet();
    workerPolicyReadiness = Object.freeze({
      ready: isPolicySetReady(
        policySet,
        process.env.WIKI_LINT_EXPECTED_CONFIG_FINGERPRINT
      ),
      policySetFingerprint: policySet.policySetFingerprint,
    });
  }
  return workerPolicyReadiness;
}

/**
 * Reports policy readiness on a response: it always names the policy set in a
 * header and, when not ready, sets status 503 without any body detail.
 *
 * @param ctx - the response context.
 * @param readiness - the readiness to report.
 * @returns whether the worker is ready.
 */
export function applyPolicyReadiness(
  ctx: { set(field: string, value: string): void; status: number },
  readiness: PolicyReadiness = getPolicyReadiness()
): boolean {
  ctx.set(POLICY_SET_FINGERPRINT_HEADER, readiness.policySetFingerprint);
  if (!readiness.ready) {
    ctx.status = 503;
  }
  return readiness.ready;
}
