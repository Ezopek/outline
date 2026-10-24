import type { ProsemirrorData } from "@shared/types";
import {
  parseCanonicalMarkdown,
  toCanonicalMarkdown,
} from "../adapters/canonicalSyntax";
import type { InternalLinkReference, SyntaxPosition } from "./contracts";
import { WikiLintContractError } from "./contracts";
import {
  LINK_LOOKUP_BATCH_SIZE,
  extractInternalLinks,
  linkLookupBatches,
} from "./internalLinks";

const ORIGIN = "https://wiki.example.test";
const UUID = "00000000-0000-4000-8000-1a2b3c4d5e6f";
const UPPER_UUID = UUID.toUpperCase();
const URL_ID = "AbCdEf1234";

const position: SyntaxPosition = { line: 1, column: 1, path: [0] };

/**
 * Extracts the lookup keys of one link destination.
 *
 * @param href - the link destination.
 * @returns the keys and kinds of the references.
 */
const keysOf = (href: string) =>
  extractInternalLinks([{ href, position }], ORIGIN).map(
    ({ key, keyKind }) => ({ key, keyKind })
  );

const id = { key: UUID, keyKind: "id" };
const urlId = { key: URL_ID, keyKind: "urlId" };

/** The recognized rows of the L1–L11 fixture table: name, href, key. */
const RECOGNIZED: [string, string, { key: string; keyKind: string }][] = [
  ["L1", `/doc/${UUID}`, id],
  ["L1 uppercase", `/doc/${UPPER_UUID}`, id],
  ["L2", `/doc/any-title-${URL_ID}`, urlId],
  ["L2 symbols in slug", `/doc/a_b~c-${URL_ID}`, urlId],
  ["L3", `/doc/${URL_ID}`, urlId],
  ["L4 segment", `/doc/${UUID}/edit`, id],
  ["L4 query", `/doc/${UUID}?x=1`, id],
  ["L4 fragment", `/doc/any-title-${URL_ID}#heading`, urlId],
  ["L4 all", `/doc/${URL_ID}/edit?x=1#heading`, urlId],
  ["L5 https", `${ORIGIN}/doc/${UUID}`, id],
  ["L5 http", `http://wiki.example.test/doc/${URL_ID}`, urlId],
  ["L5 credentials", `https://user:pass@wiki.example.test/doc/${UUID}`, id],
  ["L5 default port", `https://WIKI.example.test:443/doc/${UPPER_UUID}`, id],
  ["L5 with L4", `${ORIGIN}/doc/any-title-${URL_ID}/edit#x`, urlId],
  ["L6 mention", `/doc/${UUID}#anchor`, id],
  ["L7", `/d/${UUID}`, id],
  ["L7 slug", `/d/any-title-${URL_ID}`, urlId],
  ["L7 with L4 and L5", `${ORIGIN}/d/${URL_ID}/edit?x=1`, urlId],
  ["L7 uppercase", `/d/${UPPER_UUID}#x`, id],
];

/** The unrecognized rows of the L1–L11 fixture table: name, href. */
const UNRECOGNIZED: [string, string][] = [
  ["L8 other host", `https://other.example.test/doc/${UUID}`],
  ["L8 other port", `https://wiki.example.test:8443/doc/${UUID}`],
  ["L8 http on 443", `http://wiki.example.test:443/doc/${UUID}`],
  ["L8 trailing dot", `https://wiki.example.test./doc/${UUID}`],
  ["L8 /d/ path", `https://other.example.test/d/${URL_ID}`],
  ["L9 protocol-relative", `//wiki.example.test/doc/${UUID}`],
  ["L9 backslash host", `/\\other.example.test/doc/${UUID}`],
  ["L9 backslash own host", `/\\wiki.example.test/doc/${UUID}`],
  ["L9 relative", `doc/${UUID}`],
  ["L10 share path", `/s/share-id/doc/any-title-${URL_ID}`],
  ["L10 collection", `/collection/${UUID}`],
  ["L10 api", "/api/documents.info"],
  ["L10 dot segments", `/doc/${UUID}/../../api/x`],
  ["L10 empty segment", `/doc//${UUID}`],
  ["L10 no segment", "/doc/"],
  ["L10 percent-encoded", `/doc/%41bCdEf1234`],
  ["L10 new", "/doc/new"],
  ["L10 short", "/doc/abc"],
  ["L10 uppercase path", `/DOC/${UUID}`],
  ["L11 mailto", "mailto:someone@example.test"],
  ["L11 mention", `mention://${UUID}/document/${UUID}`],
  ["L11 ftp", `ftp://wiki.example.test/doc/${UUID}`],
  ["empty", ""],
  ["unparseable", "https://[/doc"],
];

/**
 * Writes a link destination as canonical Markdown, escaped as the
 * serializer's `esc` escapes it, and extracts the references of the parsed
 * link.
 *
 * @param href - the link destination.
 * @returns the references.
 */
function canonicalReferencesOf(href: string) {
  const { links } = parseCanonicalMarkdown(
    `[x](${href.replace(/[`*\\~]/g, "\\$&")})`
  );
  expect(links).toHaveLength(1);
  return extractInternalLinks(links, ORIGIN);
}

describe("extractInternalLinks", () => {
  it.each(RECOGNIZED)("recognizes %s: %s", (_name, href, expected) => {
    expect(keysOf(href)).toEqual([expected]);
  });

  it.each(UNRECOGNIZED)("does not recognize %s: %s", (_name, href) => {
    expect(keysOf(href)).toEqual([]);
  });

  it.each(RECOGNIZED)(
    "recognizes %s as canonical Markdown: %s",
    (_name, href, expected) => {
      expect(canonicalReferencesOf(href)).toEqual([
        { ...expected, position: { line: 1, column: 1, path: [0] } },
      ]);
    }
  );

  it.each(UNRECOGNIZED)(
    "does not recognize %s as canonical Markdown: %s",
    (_name, href) => {
      expect(canonicalReferencesOf(href)).toEqual([]);
    }
  );

  it("never looks up a UUID as a URL identifier", () => {
    // The last group of a UUID also matches the URL identifier pattern.
    expect(keysOf(`/doc/${UUID}`)).toEqual([id]);
    expect(keysOf(`/doc/${UUID.split("-")[4]}`)).toEqual([
      { key: UUID.split("-")[4], keyKind: "urlId" },
    ]);
  });

  it("keeps every occurrence and its position, in order", () => {
    const second: SyntaxPosition = { line: 3, column: 5, path: [2, 0] };

    expect(
      extractInternalLinks(
        [
          { href: `/doc/${UUID}`, position },
          { href: "https://other.example.test/", position },
          { href: `/doc/${UPPER_UUID}`, position: second },
          { href: `/doc/${URL_ID}`, position: null },
        ],
        ORIGIN
      )
    ).toEqual([
      { ...id, position },
      { ...id, position: second },
      { ...urlId, position: null },
    ]);
  });

  it("recognizes links against the given origin only", () => {
    expect(
      extractInternalLinks(
        [{ href: `${ORIGIN}/doc/${UUID}`, position }],
        "http://localhost:3000"
      )
    ).toEqual([]);
    expect(
      extractInternalLinks(
        [{ href: `http://localhost:3000/doc/${UUID}`, position }],
        "http://localhost:3000"
      )
    ).toEqual([{ ...id, position }]);
  });

  it("rejects an origin that is not a URL", () => {
    expect(() => extractInternalLinks([], "not a url")).toThrow(
      WikiLintContractError
    );
  });
});

describe("canonical Markdown fixtures", () => {
  const text = (value: string, marks?: object[]) => ({
    type: "text",
    text: value,
    ...(marks ? { marks } : {}),
  });
  const link = (href: string) => [{ type: "link", attrs: { href } }];
  const mention = (label: string, anchorId?: string) => ({
    type: "mention",
    attrs: {
      type: "document",
      label,
      modelId: UUID,
      id: "00000000-0000-4000-8000-0000000000a1",
      ...(anchorId ? { anchorId } : {}),
    },
  });
  const paragraph = (...content: object[]) => ({ type: "paragraph", content });

  const doc = {
    type: "doc",
    content: [
      paragraph(
        text("Mention "),
        mention("Plain", "anchor"),
        text(" and "),
        mention("a]b")
      ),
      paragraph(
        text("Tail @"),
        text("label", link(`${ORIGIN}/doc/${UUID}`)),
        text(" then "),
        text("slug", link(`${ORIGIN}/doc/any-title-${URL_ID}`))
      ),
      paragraph(
        text("ż😀 "),
        text("redirect", link(`/d/${URL_ID}`)),
        text(" "),
        text("elsewhere", link(`https://other.example.test/doc/${UUID}`))
      ),
      paragraph(
        { type: "image", attrs: { src: `/doc/${UUID}`, alt: "image" } },
        text(" "),
        text(`[code](/doc/${UUID})`, [{ type: "code_inline" }])
      ),
      {
        type: "code_block",
        attrs: { language: "markdown" },
        content: [text(`[block](/doc/${UUID})`)],
      },
    ],
  } as unknown as ProsemirrorData;

  it("pins classifications and positions of serializer output", async () => {
    const markdown = await toCanonicalMarkdown(doc);
    const lines = markdown.split("\n");

    // The serializer writes the `]` label unescaped and the `@` before the
    // link, so neither is a link token of the canonical Markdown.
    expect(lines[0]).toBe(
      `Mention [Plain](/doc/${UUID}#anchor) and [a]b](/doc/${UUID})`
    );
    expect(lines[2]).toBe(
      `Tail @[label](${ORIGIN}/doc/${UUID}) then [slug](${ORIGIN}/doc/any-title-${URL_ID})`
    );

    const references = extractInternalLinks(
      parseCanonicalMarkdown(markdown).links,
      ORIGIN
    );
    expect(references).toEqual([
      { ...id, position: { line: 1, column: 9, path: [0] } },
      {
        ...urlId,
        position: { line: 3, column: lines[2].indexOf("[slug") + 1, path: [1] },
      },
      { ...urlId, position: { line: 5, column: 4, path: [2] } },
    ]);
  });
});

describe("linkLookupBatches", () => {
  /**
   * Builds a reference with no position.
   *
   * @param key - the lookup key.
   * @param keyKind - the key kind.
   * @returns the reference.
   */
  const reference = (
    key: string,
    keyKind: InternalLinkReference["keyKind"] = "id"
  ): InternalLinkReference => ({ key, keyKind, position: null });

  it("sorts unique keys bytewise and chunks them at 500", () => {
    const keys = Array.from(
      { length: 1001 },
      (_, index) =>
        `00000000-0000-4000-8000-${String(1000 - index).padStart(12, "0")}`
    );
    const references = [...keys, keys[0], keys[500]].map((key) =>
      reference(key)
    );

    const batches = linkLookupBatches(references);

    expect(LINK_LOOKUP_BATCH_SIZE).toBe(500);
    expect(batches.map((batch) => batch.length)).toEqual([500, 500, 1]);
    expect(batches.flat()).toEqual(
      [...keys].sort().map((key) => ({ key, keyKind: "id" }))
    );
  });

  it("orders keys by code point, never by locale", () => {
    const batches = linkLookupBatches([
      reference("bbbbbbbbbb", "urlId"),
      reference("BBBBBBBBBB", "urlId"),
      reference("aaaaaaaaaa", "urlId"),
      reference(UUID),
    ]);

    expect(batches).toEqual([
      [
        { key: UUID, keyKind: "id" },
        { key: "BBBBBBBBBB", keyKind: "urlId" },
        { key: "aaaaaaaaaa", keyKind: "urlId" },
        { key: "bbbbbbbbbb", keyKind: "urlId" },
      ],
    ]);
  });

  it("returns no batch for no references", () => {
    expect(linkLookupBatches([])).toEqual([]);
  });
});
