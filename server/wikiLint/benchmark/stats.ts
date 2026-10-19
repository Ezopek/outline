/**
 * Returns the nearest-rank quantile of some values: the value at rank
 * `ceil(fraction * N)` in ascending order.
 *
 * @param values - the values; non-finite values are ignored.
 * @param fraction - the quantile, in (0, 1].
 * @returns the value, or null when there is none.
 */
export function nearestRank(
  values: readonly number[],
  fraction: number
): number | null {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (sorted.length === 0) {
    return null;
  }
  const rank = Math.max(1, Math.ceil(fraction * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

/**
 * Returns the nearest-rank p95 (AD-17): the value at rank `ceil(0.95 * N)`.
 *
 * @param values - the values.
 * @returns the p95, or null when there is no value.
 */
export const p95 = (values: readonly number[]) => nearestRank(values, 0.95);

/**
 * Returns the nearest-rank median: the value at rank `ceil(0.5 * N)`.
 *
 * @param values - the values.
 * @returns the median, or null when there is no value.
 */
export const median = (values: readonly number[]) => nearestRank(values, 0.5);

/**
 * Returns the largest finite value.
 *
 * @param values - the values.
 * @returns the maximum, or null when there is no value.
 */
export const maximum = (values: readonly number[]) => nearestRank(values, 1);

/** The cost of one measured run, normalized by its size. */
export interface NormalizedCosts {
  msPerDocument: number | null;
  msPerLink: number | null;
  queriesPerDocument: number | null;
  queriesPerLink: number | null;
  rssBytesPerDocument: number | null;
}

/**
 * Divides, or returns null for a zero or non-finite divisor.
 *
 * @param value - the dividend.
 * @param by - the divisor.
 * @returns the quotient, or null.
 */
const per = (value: number, by: number) =>
  by > 0 && Number.isFinite(by) && Number.isFinite(value) ? value / by : null;

/**
 * Normalizes a run's runtime, query count, and peak RSS by its evaluated
 * documents and links (AD-17).
 *
 * @param input.runtimeMs - the runtime.
 * @param input.queries - the statements issued.
 * @param input.peakRssBytes - the peak resident set size.
 * @param input.documents - the evaluated documents.
 * @param input.links - the evaluated internal-link references.
 * @returns the normalized costs; a cost over zero documents or links is null.
 */
export function normalizedCosts(input: {
  runtimeMs: number;
  queries: number;
  peakRssBytes: number;
  documents: number;
  links: number;
}): NormalizedCosts {
  const { runtimeMs, queries, peakRssBytes, documents, links } = input;
  return {
    msPerDocument: per(runtimeMs, documents),
    msPerLink: per(runtimeMs, links),
    queriesPerDocument: per(queries, documents),
    queriesPerLink: per(queries, links),
    rssBytesPerDocument: per(peakRssBytes, documents),
  };
}
