import { createHash } from "node:crypto";
import type { User } from "@server/models";
import { parseCanonicalMarkdown } from "../adapters/canonicalSyntax";
import type { WikiSnapshotDocument } from "../core/contracts";
import { extractInternalLinks } from "../core/internalLinks";
import { buildPolicySet } from "../core/policySet";
import { Deadline } from "./deadline";
import type { LintWikiReader } from "./lintWiki";
import { LINT_WIKI_DEADLINE_MS, lintWiki } from "./lintWiki";
import type { TimingSpanKind } from "./timingProbe";
import { setTimingProbe, span } from "./timingProbe";

const COLLECTION = "00000000-0000-4000-8000-0000000000c1";
const DOC_1 = "00000000-0000-4000-8000-0000000000d1";
const DOC_2 = "00000000-0000-4000-8000-0000000000d2";
const MISSING = "00000000-0000-4000-8000-0000000000a1";
const ORIGIN = "https://wiki.example.test";

const sha256Hex = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const loaded = buildPolicySet(
  Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      collections: {
        [COLLECTION]: {
          activation: "read_only",
          rules: [
            {
              kind: "required_sections",
              headingLevel: 2,
              headings: ["Overview", "Details"],
            },
            { kind: "internal_links" },
            { kind: "hierarchy_acyclic" },
            { kind: "published_documents_in_structure" },
          ],
        },
      },
    }),
    "utf8"
  ),
  sha256Hex
);
if (!loaded.ok) {
  throw new Error("The test configuration must load");
}
const { policySet } = loaded;

/**
 * Builds an evaluated document with recognized links.
 *
 * @param documentId - the document.
 * @param markdown - the canonical Markdown.
 * @returns the snapshot document.
 */
function documentOf(
  documentId: string,
  markdown: string
): WikiSnapshotDocument {
  const syntax = parseCanonicalMarkdown(markdown);
  return {
    documentId,
    content: { syntax, links: extractInternalLinks(syntax.links, ORIGIN) },
    parent: { state: "none" },
  };
}

/** A fixed snapshot with one Finding of each enabled document kind. */
const reader: LintWikiReader = {
  authorizeLintCollection: () => Promise.resolve(COLLECTION),
  readWikiSnapshot: () =>
    Promise.resolve({
      ok: true,
      snapshot: {
        collections: [
          {
            collectionId: COLLECTION,
            documents: [
              documentOf(DOC_1, "## Overview\n\nSummary\n\n## Details\n\nBody"),
              documentOf(DOC_2, `## Overview\n\nSee [a](/doc/${MISSING})`),
            ],
            graph: {
              authorized: true,
              structureDocumentIds: [DOC_1],
              globalIndex: null,
            },
          },
        ],
        sentinelCollectionIds: [],
        targets: new Map([[MISSING, "unresolved"]]),
      },
    }),
};

/**
 * Lints the fixed snapshot.
 *
 * @returns the serialized outcome.
 */
async function lintOnce(): Promise<string> {
  const outcome = await lintWiki({
    actor: { id: "actor", teamId: "team" } as User,
    policySet,
    deadline: new Deadline(LINT_WIKI_DEADLINE_MS),
    reader,
    instanceOrigin: ORIGIN,
    admit: () => true,
  });
  return JSON.stringify(outcome);
}

describe("timingProbe", () => {
  afterEach(() => {
    setTimingProbe(undefined);
  });

  it("drops every span by default", () => {
    expect(() => span("unit", 1)).not.toThrow();
  });

  it("forwards spans to the installed probe until it is removed", () => {
    const spans: [TimingSpanKind, number][] = [];
    setTimingProbe((kind, ms) => spans.push([kind, ms]));
    span("unit", 1.5);
    span("result_assembly", 2);
    setTimingProbe(undefined);
    span("batch_serialize_parse", 3);

    expect(spans).toEqual([
      ["unit", 1.5],
      ["result_assembly", 2],
    ]);
  });

  it("ignores a probe that throws", () => {
    setTimingProbe(() => {
      throw new Error("probe failure");
    });
    expect(() => span("unit", 1)).not.toThrow();
  });

  it("leaves the lint_wiki result byte-identical with and without a probe", async () => {
    const unset = await lintOnce();

    const spans: [TimingSpanKind, number][] = [];
    setTimingProbe((kind, ms) => spans.push([kind, ms]));
    const set = await lintOnce();

    expect(set).toBe(unset);
    // Two documents units, one hierarchy unit, then the result assembly.
    expect(spans.map(([kind]) => kind)).toEqual([
      "unit",
      "unit",
      "unit",
      "result_assembly",
    ]);
    for (const [, ms] of spans) {
      expect(ms).toBeGreaterThanOrEqual(0);
    }
  });

  it("leaves the lint_wiki result byte-identical with a throwing probe", async () => {
    const unset = await lintOnce();
    setTimingProbe(() => {
      throw new Error("probe failure");
    });

    expect(await lintOnce()).toBe(unset);
  });
});
