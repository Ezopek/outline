import { randomUUID } from "node:crypto";
import type { User } from "@server/models";
import { canReadCollection } from "../adapters/documentReader";
import { getPolicySet } from "../adapters/policyConfig";
import type { WriteValidation } from "../core/contracts";
import { WikiLintContractError } from "../core/contracts";
import type { PolicySet, PolicySetEntry } from "../core/policySet";
import { createSystemFailure } from "../core/registry";
import type { MonotonicClock } from "./deadline";
import { monotonicClock } from "./deadline";
import { decideWrite } from "./writeDecision";

/** The AD-20 bound, in milliseconds, of P0 and P1 together. */
export const ENFORCED_PRE_WRITE_BOUND_MS = 2000;

/**
 * The once-per-request AD-8 class of an MCP create or update. `baseline`
 * keeps the exact baseline path; `failed` is an AD-20 row 1 failure of P1.
 * For a create, `documentId` is the pre-allocated ID of the new document.
 */
export type WriteClassification =
  | Readonly<{ kind: "baseline" }>
  | Readonly<{
      kind: "enforced";
      entry: Extract<PolicySetEntry, { status: "valid" }>;
      /** Whether the actor can read the classified collection. */
      readable: boolean;
      documentId?: string;
    }>
  | Readonly<{
      kind: "sentinel";
      entry: Extract<PolicySetEntry, { status: "invalid" }>;
      /** Whether the actor can read the classified collection. */
      readable: boolean;
      documentId?: string;
    }>
  | Readonly<{ kind: "failed" }>;

const BASELINE: WriteClassification = Object.freeze({ kind: "baseline" });

const FAILED: WriteClassification = Object.freeze({ kind: "failed" });

/**
 * Classifies an MCP create or update once, in AD-20 P1, after the baseline
 * pre-write steps. A baseline write reads nothing and is not timed; an
 * enforced or sentinel write gets its `readable` flag, a create its
 * pre-allocated document ID, and P0 plus P1 are checked against the bound.
 *
 * @param input.collectionId - the post-operation collection as the baseline
 *   resolves it, never the raw `collectionId` input.
 * @param input.actor - the acting user.
 * @param input.create - whether the write creates a document.
 * @param input.enteredAt - the clock reading at handler entry.
 * @param input.policySet - the immutable startup policy set; defaults to the
 *   worker's set.
 * @param input.clock - the monotonic clock; defaults to `monotonicClock`.
 * @returns the frozen classification; `failed` for any P1 failure.
 */
export async function classifyWrite(input: {
  collectionId: string | null | undefined;
  actor: User;
  create: boolean;
  enteredAt: number;
  policySet?: PolicySet;
  clock?: MonotonicClock;
}): Promise<WriteClassification> {
  const { collectionId, actor, create, enteredAt } = input;
  if (collectionId === null || collectionId === undefined) {
    return BASELINE;
  }
  try {
    const policySet = input.policySet ?? getPolicySet();
    const entry = policySet.entries.find(
      (item) => item.collectionId === collectionId
    );
    if (
      !entry ||
      (entry.status === "valid" && entry.policy.activation === "read_only")
    ) {
      return BASELINE;
    }
    const readable = await canReadCollection(actor, entry.collectionId);
    const allocated = create ? { documentId: randomUUID() } : {};
    const clock = input.clock ?? monotonicClock;
    if (clock() - enteredAt > ENFORCED_PRE_WRITE_BOUND_MS) {
      return FAILED;
    }
    return Object.freeze(
      entry.status === "valid"
        ? { kind: "enforced", entry, readable, ...allocated }
        : { kind: "sentinel", entry, readable, ...allocated }
    );
  } catch {
    return FAILED;
  }
}

/**
 * Rejects a write classified under an invalid-policy sentinel, through the
 * AD-13 decision, without any effect. The sentinel's `invalidFingerprint` and
 * the location's `collectionId` are present only when the actor can read the
 * classified collection.
 *
 * @param sentinel - the classification.
 * @returns the modeled rejection.
 * @throws WikiLintContractError when the decision is not `rejected`.
 */
export function rejectInvalidPolicyWrite(
  sentinel: Extract<WriteClassification, { kind: "sentinel" }>
): { success: false; validation: WriteValidation } {
  const { entry, readable } = sentinel;
  const systemFailures = [
    createSystemFailure("POLICY_CONFIGURATION_INVALID", {
      kind: "scope",
      scopeKind: "collection",
      ...(readable && { collectionId: entry.collectionId }),
    }),
  ];
  const status = decideWrite({
    errors: [],
    warnings: [],
    systemFailures,
    runtimeFailureMode: "closed",
    withinLimits: false,
    halfDeadlineAtP5: false,
  });
  if (status !== "rejected") {
    throw new WikiLintContractError("An invalid policy must reject the write");
  }
  return {
    success: false,
    validation: {
      status,
      ...(readable && { invalidFingerprint: entry.invalidFingerprint }),
      errors: [],
      warnings: [],
      systemFailures,
    },
  };
}
