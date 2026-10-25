import httpErrors from "http-errors";
import type {
  Finding,
  SystemFailure,
  SystemFailureCode,
  ValidationStatus,
} from "../core/contracts";
import type { CollectionPolicy } from "../core/policySet";
import { OPERATION_FAILED } from "../core/registry";

/**
 * The largest canonical Markdown, in UTF-8 bytes, of a projected document
 * whose `VALIDATION_RUNTIME_FAILED` or `VALIDATION_TIMEOUT` may fail open.
 * Fixed by the Story 3.3 criterion 7 rule and confirmed by the retained
 * Gate 1 reference run (source commit `e5e16ec25`,
 * `docs/wikilint-gate-1/benchmark/reference-manifest.json`). It is distinct
 * from the AD-16 snapshot caps and never reuses them.
 */
export const WRITE_ELIGIBLE_MARKDOWN_BYTES = 131072;

/**
 * The most internal-link references of a projected document whose
 * `VALIDATION_RUNTIME_FAILED` or `VALIDATION_TIMEOUT` may fail open.
 * Fixed by the Story 3.3 criterion 7 rule and confirmed by the retained
 * Gate 1 reference run (source commit `e5e16ec25`,
 * `docs/wikilint-gate-1/benchmark/reference-manifest.json`). It is distinct
 * from the AD-16 snapshot caps and never reuses them.
 */
export const WRITE_ELIGIBLE_LINK_REFERENCES = 1000;

/**
 * Checks one measure against its write-eligibility constant.
 *
 * @param measure - the measure; anything but a finite non-negative integer
 *   counts as not produced.
 * @param limit - the constant.
 * @returns whether the measure was produced and is at or below the limit.
 */
const withinLimit = (measure: number | null | undefined, limit: number) =>
  typeof measure === "number" &&
  Number.isInteger(measure) &&
  measure >= 0 &&
  measure <= limit;

/**
 * Checks whether a projected document is within both write-eligibility
 * constants. A measure that could not be produced counts as beyond them.
 *
 * @param measures - the document's Markdown byte length and internal-link
 *   reference count.
 * @returns whether both measures were produced and are within their limits.
 */
export function withinWriteEligibility(measures: {
  markdownBytes?: number | null;
  linkReferences?: number | null;
}): boolean {
  return (
    withinLimit(measures.markdownBytes, WRITE_ELIGIBLE_MARKDOWN_BYTES) &&
    withinLimit(measures.linkReferences, WRITE_ELIGIBLE_LINK_REFERENCES)
  );
}

/** The explicit inputs of the AD-13 decision. */
export interface WriteDecisionInput {
  errors: readonly Finding[];
  warnings: readonly Finding[];
  systemFailures: readonly SystemFailure[];
  /** The immutable mode of the classified collection's policy. */
  runtimeFailureMode: CollectionPolicy["runtimeFailureMode"];
  /** Whether the projected document is within both eligibility constants. */
  withinLimits: boolean;
  /** Whether P5 began with at least half of the validation deadline left. */
  halfDeadlineAtP5: boolean;
}

/**
 * Applies the AD-13 decision matrix. It branches only on issue codes and its
 * explicit inputs, never on message prose, and leaves its inputs untouched,
 * so the caller returns the Warnings and System Failures it passed in.
 *
 * @param input - the validation result and the decision inputs.
 * @returns the validation status; any status but `rejected` persists.
 */
export function decideWrite(input: WriteDecisionInput): ValidationStatus {
  const {
    errors,
    warnings,
    systemFailures,
    runtimeFailureMode,
    withinLimits,
    halfDeadlineAtP5,
  } = input;
  if (errors.length > 0) {
    return "rejected";
  }
  if (systemFailures.length === 0) {
    return warnings.length > 0 ? "validated_with_warnings" : "validated";
  }
  if (runtimeFailureMode !== "open") {
    return "rejected";
  }
  const eligible = (code: SystemFailureCode) =>
    code === "VALIDATION_RESOURCE_LIMIT_EXCEEDED" ||
    (code === "VALIDATION_RUNTIME_FAILED" && withinLimits) ||
    (code === "VALIDATION_TIMEOUT" && withinLimits && halfDeadlineAtP5);
  return systemFailures.every((failure) => eligible(failure.code))
    ? "degraded_validation"
    : "rejected";
}

/**
 * Applies the AD-20 row 3 and row 5 message rule to a failure: an Outline
 * application error with a stable identifier keeps its message, and anything
 * else gets the fixed generic message.
 *
 * @param error - the failure.
 * @returns the Tool-Execution Error message.
 */
export function abortMessage(error: unknown): string {
  return httpErrors.isHttpError(error) &&
    typeof error.id === "string" &&
    error.id !== ""
    ? error.message
    : OPERATION_FAILED;
}
