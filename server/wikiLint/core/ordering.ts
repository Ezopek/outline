import type {
  Finding,
  IssueItem,
  LocationKind,
  PathSegment,
  SystemFailure,
} from "./contracts";

const locationKindRank: Record<LocationKind, number> = {
  text: 0,
  document: 1,
  relationship: 2,
  scope: 3,
};

/**
 * Compares two strings by their UTF-8 bytes, which is equivalent to Unicode
 * code-point order. Locale and UTF-16 code-unit order are never used.
 *
 * @param a - the first string.
 * @param b - the second string.
 * @returns a negative number, zero, or a positive number.
 */
export function compareUtf8(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index++) {
    if (a.charCodeAt(index) !== b.charCodeAt(index)) {
      // The first differing unit starts a code point in both strings (or both
      // are low surrogates after a shared high surrogate), so comparing the
      // full code points here yields code-point order.
      return (a.codePointAt(index) ?? 0) - (b.codePointAt(index) ?? 0);
    }
  }
  return a.length - b.length;
}

/**
 * Compares two structural paths segment by segment: integers before strings,
 * integers numerically, strings bytewise, and a shorter prefix first.
 *
 * @param a - the first path.
 * @param b - the second path.
 * @returns a negative number, zero, or a positive number.
 */
export function comparePath(
  a: readonly PathSegment[],
  b: readonly PathSegment[]
): number {
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index++) {
    const x = a[index];
    const y = b[index];
    if (typeof x === "number" && typeof y === "number") {
      if (x !== y) {
        return x - y;
      }
    } else if (typeof x === "number") {
      return -1;
    } else if (typeof y === "number") {
      return 1;
    } else {
      const order = compareUtf8(x, y);
      if (order !== 0) {
        return order;
      }
    }
  }
  return a.length - b.length;
}

/**
 * Compares two optional values, placing absent values last.
 *
 * @param a - the first value.
 * @param b - the second value.
 * @param compare - the comparison for two present values.
 * @returns a negative number, zero, or a positive number.
 */
function compareOptional<T>(
  a: T | undefined,
  b: T | undefined,
  compare: (x: T, y: T) => number
): number {
  if (a === undefined) {
    return b === undefined ? 0 : 1;
  }
  if (b === undefined) {
    return -1;
  }
  return compare(a, b);
}

const compareNumbers = (a: number, b: number) => a - b;

interface SortKey {
  collectionId?: string;
  documentId?: string;
  line?: number;
  column?: number;
  path?: readonly PathSegment[];
  rank: number;
  code: string;
  ordinal?: number;
  index: number;
}

/**
 * Derives the AD-4 sort key of an item. Only the location, code, ordinal, and
 * server-derived collection key are used; messages never affect order.
 *
 * @param item - the item to derive a key for.
 * @param index - the item's emission index, used as the final tie-break.
 * @returns the sort key.
 */
function sortKey(item: IssueItem, index: number): SortKey {
  const location = item.issue.location;
  const key: SortKey = {
    collectionId: item.sortCollectionId,
    documentId: location.documentId,
    rank: locationKindRank[location.kind],
    code: item.issue.code,
    ordinal: item.ordinal,
    index,
  };
  if (location.kind === "scope" && location.collectionId !== undefined) {
    key.collectionId = location.collectionId;
  }
  if (location.kind === "text") {
    key.line = location.line;
    key.column = location.column;
    key.path = location.path;
  }
  return key;
}

/**
 * Compares two sort keys by collection, document, line, column, path,
 * location-kind rank, code, ordinal, and finally emission order.
 *
 * @param a - the first key.
 * @param b - the second key.
 * @returns a negative number, zero, or a positive number.
 */
function compareKeys(a: SortKey, b: SortKey): number {
  return (
    compareOptional(a.collectionId, b.collectionId, compareUtf8) ||
    compareOptional(a.documentId, b.documentId, compareUtf8) ||
    compareOptional(a.line, b.line, compareNumbers) ||
    compareOptional(a.column, b.column, compareNumbers) ||
    compareOptional(a.path, b.path, comparePath) ||
    a.rank - b.rank ||
    compareUtf8(a.code, b.code) ||
    compareOptional(a.ordinal, b.ordinal, compareNumbers) ||
    a.index - b.index
  );
}

/**
 * Sorts issues into the deterministic AD-4 order.
 *
 * @param items - the issues with their sort keys, in emission order.
 * @returns the issues in deterministic order.
 */
export function sortIssues<T extends Finding | SystemFailure>(
  items: readonly IssueItem<T>[]
): T[] {
  return items
    .map((item, index) => ({ issue: item.issue, key: sortKey(item, index) }))
    .sort((a, b) => compareKeys(a.key, b.key))
    .map((entry) => entry.issue);
}
