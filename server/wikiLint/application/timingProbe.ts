/**
 * The timed spans of the AD-17 benchmark: one `lint_wiki` atomic unit, the
 * result assembly charged to the stop margin, and the serialization and
 * parsing of one keyset batch between two deadline checks.
 */
export type TimingSpanKind =
  | "unit"
  | "result_assembly"
  | "batch_serialize_parse";

/** Receives each timed span, in milliseconds. */
export type TimingProbe = (kind: TimingSpanKind, ms: number) => void;

let probe: TimingProbe | undefined;

/**
 * Installs the process's timing probe, or removes it. Only the benchmark
 * harness installs one; by default every span is dropped.
 *
 * @param next - the probe, or undefined to remove it.
 */
export function setTimingProbe(next: TimingProbe | undefined): void {
  probe = next;
}

/**
 * Reports one timed span to the installed probe. It never reads or changes a
 * lint result, and a probe that throws is ignored.
 *
 * @param kind - the span kind.
 * @param ms - the span duration, in milliseconds.
 */
export function span(kind: TimingSpanKind, ms: number): void {
  if (!probe) {
    return;
  }
  try {
    probe(kind, ms);
  } catch {
    // Timing never changes the lint result.
  }
}
