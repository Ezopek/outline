import {
  COMMIT_PROBE_BOUND_MS,
  SET_LOCAL_FLOOR_MS,
  VALIDATION_DEADLINE_MS,
  WRITE_PERSISTENCE_BUDGET_MS,
} from "../application/deadline";
import {
  LINT_WIKI_DEADLINE_MS,
  LINT_WIKI_STOP_MARGIN_MS,
} from "../application/lintWiki";
import {
  WRITE_ELIGIBLE_LINK_REFERENCES,
  WRITE_ELIGIBLE_MARKDOWN_BYTES,
} from "../application/writeDecision";

/** One retained enforced-write sample. */
export interface EnforcedWriteMeasure {
  sampleId: string;
  /** The projected document's canonical Markdown byte length. */
  markdownBytes: number | null;
  /** The projected document's internal-link reference count. */
  linkReferences: number | null;
  /** Whether validation produced a result. */
  validated: boolean;
  /** Whether the result carries `VALIDATION_TIMEOUT`. */
  timedOut: boolean;
}

/** The unit and result-assembly maxima of one retained `lint_wiki` run. */
export interface LintWikiMeasure {
  sampleId: string;
  complete: boolean;
  maxUnitMs: number | null;
  assemblyMs: number | null;
}

/** The longest single statement under `SET LOCAL` of one retained sample. */
export interface SetLocalMeasure {
  sampleId: string;
  maxStatementMs: number;
}

/** The retained samples the constants are derived from. */
export interface DerivationInput {
  /** Whether the samples come from a Gate 1 eligible reference run. */
  referenceEligible: boolean;
  enforcedWrites: readonly EnforcedWriteMeasure[];
  lintWikiRuns: readonly LintWikiMeasure[];
  setLocalStatements: readonly SetLocalMeasure[];
}

/** The derivation of one AD-17 constant. */
export interface ConstantRecord {
  name:
    | "WRITE_ELIGIBLE_MARKDOWN_BYTES"
    | "WRITE_ELIGIBLE_LINK_REFERENCES"
    | "LINT_WIKI_STOP_MARGIN_MS"
    | "SET_LOCAL_FLOOR_MS";
  /** The code-owned value, which this story never changes. */
  current: number;
  /** The value the rule derives; null without a qualifying sample. */
  candidate: number | null;
  rule: string;
  verdict: "pass" | "fail";
  reason: string | null;
  sourceSampleIds: string[];
  /** Whether the code-owned value already satisfies the rule. */
  currentSatisfiesRule: boolean;
  status: "provisional" | "reference";
}

/** The derivation of every AD-17 constant, and the Gate 1 readiness. */
export interface DerivationRecord {
  constants: ConstantRecord[];
  gate1: "ready" | "not ready";
}

/** The smallest budget the `SET LOCAL` floor guards. */
export const FLOOR_GUARD_MS = Math.min(
  VALIDATION_DEADLINE_MS,
  WRITE_PERSISTENCE_BUDGET_MS - COMMIT_PROBE_BOUND_MS
);

/**
 * Finds the largest value of a measure and the samples holding it.
 *
 * @param items - the samples and their values.
 * @returns the maximum and its sample IDs, or null without a value.
 */
function largest(
  items: readonly { sampleId: string; value: number }[]
): { value: number; sampleIds: string[] } | null {
  if (items.length === 0) {
    return null;
  }
  const value = Math.max(...items.map((item) => item.value));
  return {
    value,
    sampleIds: items
      .filter((item) => item.value === value)
      .map((item) => item.sampleId),
  };
}

/** Whether a measure is a produced, finite non-negative number. */
const produced = (value: number | null): value is number =>
  value !== null && Number.isFinite(value) && value >= 0;

/**
 * Derives one write-eligibility constant: the largest value of its measure
 * among the enforced-write samples whose validation completed without
 * `VALIDATION_TIMEOUT`.
 *
 * @param input - the retained samples.
 * @param name - the constant.
 * @param current - its code-owned value.
 * @param measure - reads the measure of a sample.
 * @param status - the record status.
 * @returns the record.
 */
function eligibilityConstant(
  input: DerivationInput,
  name: "WRITE_ELIGIBLE_MARKDOWN_BYTES" | "WRITE_ELIGIBLE_LINK_REFERENCES",
  current: number,
  measure: (sample: EnforcedWriteMeasure) => number | null,
  status: ConstantRecord["status"]
): ConstantRecord {
  const qualifying = input.enforcedWrites.flatMap((sample) => {
    const value = measure(sample);
    return sample.validated && !sample.timedOut && produced(value)
      ? [{ sampleId: sample.sampleId, value }]
      : [];
  });
  const found = largest(qualifying);
  return {
    name,
    current,
    candidate: found?.value ?? null,
    rule: "equals the largest value of its measure among retained enforced-write samples whose validation completed without VALIDATION_TIMEOUT",
    verdict: found ? "pass" : "fail",
    reason: found
      ? null
      : "no retained enforced-write sample completed validation without VALIDATION_TIMEOUT",
    sourceSampleIds: found?.sampleIds ?? [],
    currentSatisfiesRule: found?.value === current,
    status,
  };
}

/**
 * Derives the AD-17 constants from the retained samples (criterion 7). A
 * failing rule is recorded as it is, never adjusted, and a constant without
 * a qualifying sample has no candidate rather than its current value. Every
 * record is provisional unless the samples come from a reference run, and
 * Gate 1 is ready only when every constant passes its rule, is not
 * provisional, and is already committed at its candidate.
 *
 * @param input - the retained samples.
 * @returns the derivation.
 */
export function deriveConstants(input: DerivationInput): DerivationRecord {
  const status = input.referenceEligible ? "reference" : "provisional";

  const markdown = eligibilityConstant(
    input,
    "WRITE_ELIGIBLE_MARKDOWN_BYTES",
    WRITE_ELIGIBLE_MARKDOWN_BYTES,
    (sample) => sample.markdownBytes,
    status
  );
  const links = eligibilityConstant(
    input,
    "WRITE_ELIGIBLE_LINK_REFERENCES",
    WRITE_ELIGIBLE_LINK_REFERENCES,
    (sample) => sample.linkReferences,
    status
  );

  const unit = largest(
    input.lintWikiRuns.flatMap((run) =>
      produced(run.maxUnitMs)
        ? [{ sampleId: run.sampleId, value: run.maxUnitMs }]
        : []
    )
  );
  const assembly = largest(
    input.lintWikiRuns.flatMap((run) =>
      produced(run.assemblyMs)
        ? [{ sampleId: run.sampleId, value: run.assemblyMs }]
        : []
    )
  );
  const incomplete = input.lintWikiRuns.filter((run) => !run.complete);
  const marginCandidate =
    unit && assembly ? Math.ceil(unit.value + assembly.value) : null;
  let marginReason: string | null = null;
  if (marginCandidate === null) {
    marginReason =
      "no retained lint_wiki run timed a unit and its result assembly";
  } else if (incomplete.length > 0) {
    marginReason = `${incomplete.length} measured lint_wiki run(s) did not complete`;
  } else if (marginCandidate >= LINT_WIKI_DEADLINE_MS) {
    marginReason = "the candidate is not below the lint_wiki deadline";
  }
  const margin: ConstantRecord = {
    name: "LINT_WIKI_STOP_MARGIN_MS",
    current: LINT_WIKI_STOP_MARGIN_MS,
    candidate: marginCandidate,
    rule: "no less than the largest retained atomic-unit time plus the largest retained result-assembly time, while every measured run completes",
    verdict: marginReason === null ? "pass" : "fail",
    reason: marginReason,
    sourceSampleIds: [
      ...new Set([...(unit?.sampleIds ?? []), ...(assembly?.sampleIds ?? [])]),
    ],
    currentSatisfiesRule:
      marginReason === null &&
      marginCandidate !== null &&
      LINT_WIKI_STOP_MARGIN_MS >= marginCandidate,
    status,
  };

  const statement = largest(
    input.setLocalStatements.flatMap((sample) =>
      produced(sample.maxStatementMs)
        ? [{ sampleId: sample.sampleId, value: sample.maxStatementMs }]
        : []
    )
  );
  // A SET LOCAL timeout is never 0, so the floor is at least 1 ms.
  const floorCandidate = statement
    ? Math.max(1, Math.ceil(statement.value))
    : null;
  let floorReason: string | null = null;
  if (floorCandidate === null) {
    floorReason = "no retained statement was issued under SET LOCAL";
  } else if (floorCandidate >= FLOOR_GUARD_MS) {
    floorReason = `the candidate is not below the smallest guarded budget (${FLOOR_GUARD_MS} ms)`;
  }
  const floor: ConstantRecord = {
    name: "SET_LOCAL_FLOOR_MS",
    current: SET_LOCAL_FLOOR_MS,
    candidate: floorCandidate,
    rule: `no less than the largest retained single statement under SET LOCAL, and less than the smallest budget it guards (min(${VALIDATION_DEADLINE_MS}, ${WRITE_PERSISTENCE_BUDGET_MS} - ${COMMIT_PROBE_BOUND_MS}) = ${FLOOR_GUARD_MS} ms)`,
    verdict: floorReason === null ? "pass" : "fail",
    reason: floorReason,
    sourceSampleIds: statement?.sampleIds ?? [],
    currentSatisfiesRule:
      floorReason === null &&
      floorCandidate !== null &&
      SET_LOCAL_FLOOR_MS >= floorCandidate &&
      SET_LOCAL_FLOOR_MS < FLOOR_GUARD_MS,
    status,
  };

  const constants = [markdown, links, margin, floor];
  return {
    constants,
    gate1: constants.every(
      (constant) =>
        constant.verdict === "pass" &&
        constant.status === "reference" &&
        constant.currentSatisfiesRule
    )
      ? "ready"
      : "not ready",
  };
}
