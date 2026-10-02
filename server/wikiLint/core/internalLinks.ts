import isUUID from "validator/lib/isUUID";
import { UrlHelper } from "@shared/utils/UrlHelper";
import type { InternalLinkReference, SyntaxLink } from "./contracts";
import { WikiLintContractError } from "./contracts";
import { compareUtf8 } from "./ordering";

/** The largest number of unique keys resolved by one lookup batch. */
export const LINK_LOOKUP_BATCH_SIZE = 500;

/** A unique lookup key of an internal-link target. */
export type LinkLookupKey = Pick<InternalLinkReference, "key" | "keyKind">;

/** The first path segments of the document paths. */
const documentPathSegments: ReadonlySet<string> = new Set(["doc", "d"]);

/**
 * Parses a link destination as an internal URL of the instance: a path that
 * begins with exactly one `/` and keeps the instance origin, or an absolute
 * `http:` or `https:` URL whose hostname and port equal the instance's,
 * ignoring scheme and credentials.
 *
 * @param href - the link destination.
 * @param origin - the parsed instance origin.
 * @returns the parsed URL, or undefined when the destination is not internal.
 */
function parseInternalUrl(href: string, origin: URL): URL | undefined {
  try {
    if (href.startsWith("/")) {
      // A second slash or backslash makes the destination protocol-relative.
      if (href[1] === "/" || href[1] === "\\") {
        return undefined;
      }
      const url = new URL(href, origin);
      return url.origin === origin.origin ? url : undefined;
    }
    const url = new URL(href);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname === origin.hostname &&
      url.port === origin.port
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Classifies a link destination as a document reference: the segment after a
 * leading `/doc/` or `/d/` of the parsed, dot-segment-normalized path, read
 * without decoding. A UUID is tested first and lowercased; only another value
 * is matched as a URL identifier with an optional title slug.
 *
 * @param href - the link destination.
 * @param origin - the parsed instance origin.
 * @returns the lookup key, or undefined when the destination is not recognized.
 */
function classify(href: string, origin: URL): LinkLookupKey | undefined {
  const url = parseInternalUrl(href, origin);
  const [, first, ref] = url?.pathname.split("/") ?? [];
  if (first === undefined || !documentPathSegments.has(first) || !ref) {
    return undefined;
  }
  if (isUUID(ref)) {
    return { key: ref.toLowerCase(), keyKind: "id" };
  }
  const match = UrlHelper.SLUG_URL_REGEX.exec(ref);
  return match ? { key: match[1], keyKind: "urlId" } : undefined;
}

/**
 * Extracts the internal-link references of a document. This is the only link
 * classifier: every surface that validates internal links calls it. Each
 * recognized link yields one reference at the adapter's position; any other
 * link yields nothing.
 *
 * @param links - the link tokens from the canonical syntax adapter.
 * @param instanceOrigin - the instance origin, supplied by the shell.
 * @returns the references, in document order.
 * @throws WikiLintContractError when the instance origin is not a URL.
 */
export function extractInternalLinks(
  links: readonly SyntaxLink[],
  instanceOrigin: string
): InternalLinkReference[] {
  let origin: URL;
  try {
    origin = new URL(instanceOrigin);
  } catch {
    throw new WikiLintContractError("The instance origin is not a URL");
  }

  const references: InternalLinkReference[] = [];
  for (const link of links) {
    const lookup = classify(link.href, origin);
    if (lookup) {
      references.push({ ...lookup, position: link.position });
    }
  }
  return references;
}

/**
 * Groups the unique lookup keys of references into resolution batches: sorted
 * bytewise by key, then kind, and chunked at `LINK_LOOKUP_BATCH_SIZE`.
 *
 * @param references - the extracted references.
 * @returns the batches, in sorted order.
 */
export function linkLookupBatches(
  references: readonly InternalLinkReference[]
): LinkLookupKey[][] {
  const unique = new Map<string, LinkLookupKey>();
  for (const { key, keyKind } of references) {
    unique.set(`${keyKind}:${key}`, { key, keyKind });
  }
  const sorted = [...unique.values()].sort(
    (a, b) => compareUtf8(a.key, b.key) || compareUtf8(a.keyKind, b.keyKind)
  );

  const batches: LinkLookupKey[][] = [];
  for (let start = 0; start < sorted.length; start += LINK_LOOKUP_BATCH_SIZE) {
    batches.push(sorted.slice(start, start + LINK_LOOKUP_BATCH_SIZE));
  }
  return batches;
}
