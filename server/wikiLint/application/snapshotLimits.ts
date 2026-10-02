/**
 * The code-owned AD-16 resource limits of one `lint_wiki` snapshot. They are
 * never read from policy or MCP input, and `lint_document` and write
 * validation impose none of them.
 *
 * D-9: the 1 MiB `documentMarkdownBytes` cap sits below the baseline document
 * limit of 1,536,000 characters, so a legal document can exceed it; the cap
 * is revisited only if pilot evidence shows a legal document blocked from a
 * complete `lint_wiki`.
 */
export const WIKI_SNAPSHOT_LIMITS = Object.freeze({
  /**
   * The readable published documents in the snapshot, across all its
   * collections, counted after the `read` filter.
   */
  documents: 5000,
  /** UTF-8 bytes of one canonical Markdown string. */
  documentMarkdownBytes: 1048576,
  /** UTF-8 bytes of all serialized canonical Markdown together. */
  totalMarkdownBytes: 67108864,
  /** Extracted internal-link references. */
  linkReferences: 100000,
  /** Object nodes, at any depth, of every `documentStructure` read. */
  structureNodes: 10000,
});

/** The snapshot resource limits. */
export type WikiSnapshotLimits = typeof WIKI_SNAPSHOT_LIMITS;

/** Thrown as soon as a snapshot exceeds one of its resource limits. */
export class WikiResourceLimitError extends Error {
  name = "WikiResourceLimitError";

  constructor() {
    super("A snapshot resource limit was exceeded");
  }
}

/** The limits metered as running sums. */
type SummedLimit = Exclude<keyof WikiSnapshotLimits, "documentMarkdownBytes">;

/** Meters what one snapshot holds against its resource limits. */
export class SnapshotMeter {
  private readonly limits: WikiSnapshotLimits;

  private readonly totals: Record<SummedLimit, number> = {
    documents: 0,
    totalMarkdownBytes: 0,
    linkReferences: 0,
    structureNodes: 0,
  };

  /**
   * Starts an empty meter.
   *
   * @param limits - the limits to enforce.
   */
  constructor(limits: WikiSnapshotLimits) {
    this.limits = limits;
  }

  /**
   * Adds evaluated documents.
   *
   * @param count - the number of documents.
   * @throws WikiResourceLimitError when the documents exceed their limit.
   */
  addDocuments(count: number): void {
    this.add("documents", count);
  }

  /**
   * Adds one serialized canonical Markdown string.
   *
   * @param text - the Markdown.
   * @throws WikiResourceLimitError when the string or the total exceeds its
   *   limit.
   */
  addMarkdown(text: string): void {
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > this.limits.documentMarkdownBytes) {
      throw new WikiResourceLimitError();
    }
    this.add("totalMarkdownBytes", bytes);
  }

  /**
   * Adds extracted internal-link references.
   *
   * @param count - the number of references.
   * @throws WikiResourceLimitError when the references exceed their limit.
   */
  addLinkReferences(count: number): void {
    this.add("linkReferences", count);
  }

  /**
   * Adds the object nodes of one collection structure.
   *
   * @param count - the number of nodes.
   * @throws WikiResourceLimitError when the nodes exceed their limit.
   */
  addStructureNodes(count: number): void {
    this.add("structureNodes", count);
  }

  /**
   * Adds to a running sum and checks it against its limit.
   *
   * @param limit - the summed limit.
   * @param amount - the amount to add.
   * @throws WikiResourceLimitError when the sum exceeds the limit.
   */
  private add(limit: SummedLimit, amount: number): void {
    this.totals[limit] += amount;
    if (this.totals[limit] > this.limits[limit]) {
      throw new WikiResourceLimitError();
    }
  }
}
