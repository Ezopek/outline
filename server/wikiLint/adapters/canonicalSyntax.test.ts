import type Token from "markdown-it/lib/token.mjs";
import type { ProsemirrorData } from "@shared/types";
import { parser } from "@server/editor";
import { Document } from "@server/models";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";
import { ProsemirrorHelper } from "@server/models/helpers/ProsemirrorHelper";
import type { SyntaxNode } from "../core/contracts";
import { evaluateDocumentRules } from "../core/documentRules";
import { ruleConfigSchema } from "../core/registry";
import {
  CanonicalMarkdownError,
  parseCanonicalMarkdown,
  toCanonicalMarkdown,
} from "./canonicalSyntax";
import { tokenizeCanonicalMarkdown } from "./lintTokenizer";

/**
 * Lists every node of a tree in pre-order.
 *
 * @param nodes - the root nodes.
 * @returns all nodes in pre-order.
 */
function flatten(nodes: SyntaxNode[]): SyntaxNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

/**
 * Follows a structural path from the root.
 *
 * @param nodes - the root nodes.
 * @param path - zero-based child indices.
 * @returns the node at the path.
 */
function nodeAt(nodes: SyntaxNode[], path: number[]): SyntaxNode {
  const [head, ...rest] = path;
  return rest.length ? nodeAt(nodes[head].children, rest) : nodes[head];
}

const documentId = "00000000-0000-4000-8000-000000000001";

/**
 * Builds ProseMirror data for a paragraph of plain text.
 *
 * @param text - the paragraph text.
 * @returns the paragraph node.
 */
const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

const fixture = [
  "## Summary",
  "",
  "Text with ż and 😀.",
  "",
  "## Metadata",
  "",
  "- Owner: Alice",
  "- Statusż😀: active",
  "- Updated:",
  "",
  "> ### Quoted",
  "",
  "- item",
  "",
  "  ### Nested heading",
  "",
  "```js",
  "code",
  "```",
  "",
  "| a | b |",
  "|---|---|",
  "| 1 | 2 |",
].join("\n");

describe("parser.tokenizer", () => {
  it("does not linkify", () => {
    expect(parser.tokenizer.options.linkify).toBe(false);
  });
});

describe("toCanonicalMarkdown", () => {
  const doc = parser.parse(fixture)?.toJSON() as ProsemirrorData;

  it("serializes ProseMirror data without a title", async () => {
    expect(await toCanonicalMarkdown(doc)).toBe(
      await DocumentHelper.toMarkdown(doc, { includeTitle: false })
    );
  });

  it("produces positions that index into the exact canonical string", async () => {
    const markdown = await toCanonicalMarkdown(doc);
    const lines = markdown.split("\n");
    const nodes = flatten(parseCanonicalMarkdown(markdown).children);

    expect(nodes.length).toBeGreaterThan(10);
    for (const node of nodes) {
      const { line, column, path } = node.position!;
      const chars = Array.from(lines[line - 1]);
      expect(chars[column - 1]).toMatch(/[^ \t]/);
      expect(chars.slice(0, column - 1).join("")).toMatch(/^[ \t]*$/);
      expect(nodeAt(parseCanonicalMarkdown(markdown).children, path)).toEqual(
        node
      );
      if (node.kind === "heading") {
        expect(lines[line - 1]).toContain(node.text);
      }
      if (node.field?.value) {
        const value = node.field.valuePosition;
        expect(
          Array.from(lines[value.line - 1])
            .slice(value.column - 1)
            .join("")
        ).toBe(node.field.value);
      }
    }
  });

  it("reads authoritative document content, never text", async () => {
    const document = {
      content: doc,
      state: null,
      get text(): string {
        throw new Error("Document.text was read");
      },
    } as unknown as Document;

    expect(await toCanonicalMarkdown(document)).toBe(
      await toCanonicalMarkdown(doc)
    );
  });

  it("omits the title of a real document", async () => {
    const document = Document.build({ title: "Generic title", content: doc });
    const markdown = await toCanonicalMarkdown(document);

    expect(markdown).not.toContain("Generic title");
    expect(markdown).toBe(await toCanonicalMarkdown(doc));
  });

  it("reads collaborative state when content is null, never text", async () => {
    const document = {
      content: null,
      state: ProsemirrorHelper.toState(ProsemirrorHelper.toYDoc(doc)),
      get text(): string {
        throw new Error("Document.text was read");
      },
    } as unknown as Document;

    expect(await toCanonicalMarkdown(document)).toBe(
      await toCanonicalMarkdown(doc)
    );
  });

  it("rejects a document without content or state", async () => {
    const document = {
      content: null,
      state: null,
      get text(): string {
        throw new Error("Document.text was read");
      },
    } as unknown as Document;

    await expect(toCanonicalMarkdown(document)).rejects.toThrow(
      CanonicalMarkdownError
    );
  });
});

describe("parseCanonicalMarkdown", () => {
  it.each([["a\r\nb"], ["a\rb"], ["a\nb\r"]])(
    "rejects a carriage return in %j",
    (markdown) => {
      expect(() => parseCanonicalMarkdown(markdown)).toThrow(
        CanonicalMarkdownError
      );
    }
  );

  it("builds the block tree with structural paths", () => {
    const syntax = parseCanonicalMarkdown(fixture);

    expect(syntax.children.map((node) => node.kind)).toEqual([
      "heading",
      "paragraph",
      "heading",
      "bullet_list",
      "blockquote",
      "bullet_list",
      "fence",
      "table",
    ]);

    const quoted = nodeAt(syntax.children, [4, 0]);
    expect(quoted).toMatchObject({
      kind: "heading",
      level: 3,
      text: "Quoted",
      position: { line: 11, column: 1, path: [4, 0] },
    });

    const nested = nodeAt(syntax.children, [5, 0, 1]);
    expect(nested).toMatchObject({
      kind: "heading",
      level: 3,
      text: "Nested heading",
      position: { line: 15, column: 3, path: [5, 0, 1] },
    });

    const table = syntax.children[7];
    expect(table.position).toEqual({ line: 21, column: 1, path: [7] });
    expect(
      flatten(table.children).map((node) => [node.kind, node.position])
    ).toEqual([
      ["tr", { line: 21, column: 1, path: [7, 0] }],
      ["th", { line: 21, column: 1, path: [7, 0, 0] }],
      ["paragraph", { line: 21, column: 1, path: [7, 0, 0, 0] }],
      ["th", { line: 21, column: 1, path: [7, 0, 1] }],
      ["paragraph", { line: 21, column: 1, path: [7, 0, 1, 0] }],
      ["tr", { line: 23, column: 1, path: [7, 1] }],
      ["td", { line: 23, column: 1, path: [7, 1, 0] }],
      ["paragraph", { line: 23, column: 1, path: [7, 1, 0, 0] }],
      ["td", { line: 23, column: 1, path: [7, 1, 1] }],
      ["paragraph", { line: 23, column: 1, path: [7, 1, 1, 0] }],
    ]);
  });

  it("follows nesting when opening and closing token types differ", () => {
    const syntax = parseCanonicalMarkdown(
      "1. first\n\n- [ ] one\n- [ ] two\n\n## After"
    );

    expect(syntax.children.map((node) => node.kind)).toEqual([
      "ordered_list",
      "checkbox_list",
      "heading",
    ]);
    expect(syntax.children[0].children[0].kind).toBe("list_item");
    expect(syntax.children[2].position).toEqual({
      line: 6,
      column: 1,
      path: [2],
    });
  });

  it("reads heading text from text and code children", () => {
    const [heading] = parseCanonicalMarkdown(
      "## Head \\*esc\\* `code` *em*  "
    ).children;

    expect(heading.text).toBe("Head *esc* code em");
  });

  it("positions a setext heading at its text line", () => {
    const syntax = parseCanonicalMarkdown("para\n\n  Title\n=====");

    expect(syntax.children[1]).toMatchObject({
      kind: "heading",
      level: 1,
      text: "Title",
      position: { line: 3, column: 3, path: [1] },
    });
  });

  it("reads bullet list fields with code-point value columns", () => {
    const syntax = parseCanonicalMarkdown(
      [
        "* Owner:   Alice  ",
        "* Statusż😀: nope",
        "* Esc\\*aped: x\\_y",
        "* Empty:",
        "* no colon",
        "* Two: lines",
        "  continued",
      ].join("\n")
    );
    const items = syntax.children[0].children;

    expect(items.map((item) => item.field)).toEqual([
      {
        name: "Owner",
        value: "Alice",
        valuePosition: { line: 1, column: 12, path: [0, 0] },
      },
      {
        name: "Statusż😀",
        value: "nope",
        valuePosition: { line: 2, column: 13, path: [0, 1] },
      },
      {
        name: "Esc*aped",
        value: "x_y",
        valuePosition: { line: 3, column: 14, path: [0, 2] },
      },
      {
        name: "Empty",
        value: "",
        valuePosition: { line: 4, column: 9, path: [0, 3] },
      },
      undefined,
      undefined,
    ]);
  });

  it("never takes a field from a later paragraph of an item", () => {
    const syntax = parseCanonicalMarkdown(
      [
        "* Owner: Alice",
        "",
        "  Owner: Bob",
        "* Two",
        "  lines",
        "",
        "  Status: draft",
        "* > Quoted: x",
        "",
        "  Updated: 2024-01-01",
      ].join("\n")
    );
    const items = syntax.children[0].children;

    expect(items.map((item) => item.field?.value)).toEqual([
      "Alice",
      undefined,
      undefined,
    ]);
  });

  it("reads fields from source text, trimming JS whitespace", () => {
    const [list] = parseCanonicalMarkdown(
      "> * Owner:\u00a0 Alice\u00a0\n> * \u00a0Status :draft"
    ).children[0].children;

    expect(list.children.map((item) => item.field)).toEqual([
      {
        name: "Owner",
        value: "Alice",
        valuePosition: { line: 1, column: 13, path: [0, 0, 0] },
      },
      {
        name: "Status",
        value: "draft",
        valuePosition: { line: 2, column: 14, path: [0, 0, 1] },
      },
    ]);
  });

  it.each([
    [
      "a later checklist",
      "* Owner: Alice\n\n- [ ] one\n- [ ] two",
      ["bullet_list", "checkbox_list"],
    ],
    [
      "an item containing a checkbox marker",
      "* Status: [x] done\n* Owner: Bob",
      ["bullet_list"],
    ],
    [
      "a checklist between bullet lists",
      "* Owner: Alice\n\n- [ ] one\n- [x] two\n\n* Note: later",
      ["bullet_list", "checkbox_list", "bullet_list"],
    ],
  ])(
    "corrects lists the checkbox rule mis-types: %s",
    (_name, markdown, kinds) => {
      const syntax = parseCanonicalMarkdown(markdown);

      expect(syntax.children.map((node) => node.kind)).toEqual(kinds);
      for (const list of syntax.children) {
        const itemKind =
          list.kind === "checkbox_list" ? "checkbox_item" : "list_item";
        expect(list.children.every((item) => item.kind === itemKind)).toBe(
          true
        );
      }
      const fields = flatten(syntax.children).flatMap((node) =>
        node.field ? [[node.field.name, node.field.value]] : []
      );
      expect(fields).toEqual(
        markdown
          .split("\n")
          .filter((line) => line.startsWith("* "))
          .map((line) => line.slice(2).split(": "))
      );
    }
  );

  it("keeps parser kinds and reads no fields inside tables", () => {
    const [table] = parseCanonicalMarkdown(
      "| H |\n|---|\n| [x] done |"
    ).children;

    expect(flatten(table.children).map((node) => node.kind)).toEqual([
      "tr",
      "th",
      "paragraph",
      "tr",
      "td",
      "checkbox_list",
      "checkbox_item",
      "paragraph",
    ]);
    expect(flatten(table.children).every((node) => !node.field)).toBe(true);
    expect(
      flatten(table.children)
        .slice(4)
        .every((node) => node.position?.line === 3)
    ).toBe(true);
  });

  it("reads fields only from bullet lists", () => {
    const syntax = parseCanonicalMarkdown("1. Owner: Alice\n\nOwner: Bob");

    expect(flatten(syntax.children).some((node) => node.field)).toBe(false);
  });

  it("reports no position for a block the parser does not map", () => {
    const syntax = parseCanonicalMarkdown(
      "[report.pdf 1024](/api/attachments.redirect?id=00000000-0000-4000-8000-000000000001)"
    );

    expect(syntax.children).toEqual([
      { kind: "attachment", position: null, children: [] },
    ]);
  });
});

describe("serializer-produced regressions", () => {
  it("keeps metadata fields when the document also holds checklists", async () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Metadata" }],
        },
        {
          type: "bullet_list",
          content: [
            { type: "list_item", content: [paragraph("Owner: Alice")] },
            { type: "list_item", content: [paragraph("Status: [x] done")] },
          ],
        },
        {
          type: "checkbox_list",
          content: [
            {
              type: "checkbox_item",
              attrs: { checked: false },
              content: [paragraph("one")],
            },
            {
              type: "checkbox_item",
              attrs: { checked: true },
              content: [paragraph("two")],
            },
          ],
        },
        {
          type: "bullet_list",
          content: [
            { type: "list_item", content: [paragraph("Updated: 2024-01-01")] },
          ],
        },
      ],
    } as unknown as ProsemirrorData;
    const syntax = parseCanonicalMarkdown(await toCanonicalMarkdown(doc));

    expect(syntax.children.map((node) => node.kind)).toEqual([
      "heading",
      "bullet_list",
      "checkbox_list",
      "bullet_list",
    ]);
    expect(
      syntax.children[1].children.map((item) => [
        item.field?.name,
        item.field?.value,
      ])
    ).toEqual([
      ["Owner", "Alice"],
      ["Status", "[x] done"],
    ]);
    expect(
      evaluateDocumentRules({
        documentId,
        syntax,
        rules: [
          ruleConfigSchema.parse({
            kind: "required_metadata_fields",
            metadataSection: { heading: "Metadata", headingLevel: 2 },
            fields: ["Owner", "Status", "Updated"],
          }),
        ],
      })
    ).toEqual({ findings: [], failedKinds: [] });
  });

  it("trims heading text around non-text inline children", async () => {
    const emoji = { type: "emoji", attrs: { "data-name": "rocket" } };
    const doc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Summary " }, emoji],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [emoji, { type: "text", text: " Details" }],
        },
      ],
    } as unknown as ProsemirrorData;
    const markdown = await toCanonicalMarkdown(doc);
    const syntax = parseCanonicalMarkdown(markdown);

    expect(markdown).toBe("## Summary :rocket:\n\n## :rocket: Details");
    expect(syntax.children.map((node) => node.text)).toEqual([
      "Summary",
      "Details",
    ]);
    expect(
      evaluateDocumentRules({
        documentId,
        syntax,
        rules: [
          ruleConfigSchema.parse({
            kind: "required_sections",
            headingLevel: 2,
            headings: ["Summary", "Details"],
          }),
        ],
      })
    ).toEqual({ findings: [], failedKinds: [] });
  });

  it("reports structures inside table cells on their row", async () => {
    const doc = {
      type: "doc",
      content: [
        paragraph("before"),
        {
          type: "table",
          content: [
            {
              type: "tr",
              content: [
                { type: "th", content: [paragraph("Head")] },
                { type: "th", content: [paragraph("Other")] },
              ],
            },
            {
              type: "tr",
              content: [
                {
                  type: "td",
                  content: [
                    {
                      type: "code_block",
                      attrs: { language: "js" },
                      content: [{ type: "text", text: "x = 1" }],
                    },
                    {
                      type: "container_notice",
                      attrs: { style: "info" },
                      content: [paragraph("note")],
                    },
                  ],
                },
                { type: "td", content: [paragraph("plain")] },
              ],
            },
          ],
        },
      ],
    } as unknown as ProsemirrorData;
    const markdown = await toCanonicalMarkdown(doc);
    const syntax = parseCanonicalMarkdown(markdown);
    const rowLine =
      markdown.split("\n").findIndex((line) => line.includes("```")) + 1;

    expect(nodeAt(syntax.children, [1, 1, 0, 0])).toMatchObject({
      kind: "fence",
      position: { line: rowLine, column: 1, path: [1, 1, 0, 0] },
    });
    expect(nodeAt(syntax.children, [1, 1, 0, 1])).toMatchObject({
      kind: "container_notice",
      position: { line: rowLine, column: 1, path: [1, 1, 0, 1] },
    });

    const result = evaluateDocumentRules({
      documentId,
      syntax,
      rules: [
        ruleConfigSchema.parse({
          kind: "unsupported_markdown_structures",
          structures: ["code_block", "notice"],
        }),
      ],
    });

    expect(result.failedKinds).toEqual([]);
    expect(result.findings.map((item) => item.issue.location)).toEqual([
      {
        kind: "text",
        documentId,
        line: rowLine,
        column: 1,
        path: [1, 1, 0, 0],
      },
      {
        kind: "text",
        documentId,
        line: rowLine,
        column: 1,
        path: [1, 1, 0, 1],
      },
    ]);
  });
});

describe("link positions", () => {
  /**
   * Parses Markdown and returns its links, checking that each position points
   * at a `[` or `<` of the exact string.
   *
   * @param markdown - the canonical Markdown.
   * @returns the links.
   */
  function linksOf(markdown: string) {
    const lines = markdown.split("\n");
    const { links } = parseCanonicalMarkdown(markdown);
    for (const { position } of links) {
      if (position) {
        expect(
          Array.from(lines[position.line - 1])[position.column - 1]
        ).toMatch(/^[[<]$/);
      }
    }
    return links;
  }

  /**
   * Builds a link to a document path.
   *
   * @param ref - the document reference.
   * @param line - the line.
   * @param column - the column.
   * @param path - the enclosing block's path.
   * @returns the link.
   */
  const linkAt = (
    ref: string,
    line: number,
    column: number,
    path: number[]
  ) => ({
    href: `/doc/${ref}`,
    position: { line, column, path },
  });

  it.each([
    [
      "a paragraph after astral text",
      "Text ż😀 [a](/doc/x)",
      [linkAt("x", 1, 9, [0])],
    ],
    ["a soft line", "first line\nsecond [a](/doc/x)", [linkAt("x", 2, 8, [0])]],
    [
      "a serialized hard-break line",
      "before\\nafter [a](/doc/x)",
      [linkAt("x", 1, 15, [0])],
    ],
    [
      "a CommonMark hard-break line",
      "before  \nafter [a](/doc/x)",
      [linkAt("x", 2, 7, [0])],
    ],
    [
      "a heading with a closing #",
      "## Heading [a](/doc/x) ##",
      [linkAt("x", 1, 12, [0])],
    ],
    [
      "a blockquote's second line",
      "> quoted\n> second [a](/doc/x)",
      [linkAt("x", 2, 10, [0, 0])],
    ],
    ["a list item", "- item [a](/doc/x)", [linkAt("x", 1, 8, [0, 0, 0])]],
    [
      "a checkbox item",
      "- [ ] task [a](/doc/x)\n- [x] done [b](/doc/y)",
      [linkAt("x", 1, 12, [0, 0, 0]), linkAt("y", 2, 12, [0, 1, 0])],
    ],
    [
      "a notice",
      ":::info\nnotice [a](/doc/x)\n:::",
      [linkAt("x", 2, 8, [0, 0])],
    ],
    [
      "duplicate and escaped-pipe table cells",
      [
        "| H   | I   |",
        "|-----|-----|",
        "| [a](/doc/x) | [a](/doc/x) |",
        "| a\\|b [c](/doc/z) | \\| [d](/doc/w) |",
      ].join("\n"),
      [
        linkAt("x", 3, 3, [0, 1, 0, 0]),
        linkAt("x", 3, 17, [0, 1, 1, 0]),
        linkAt("z", 4, 8, [0, 2, 0, 0]),
        linkAt("w", 4, 25, [0, 2, 1, 0]),
      ],
    ],
    [
      "an alpha-list line whose length changed",
      "j. one\nk. two [a](/doc/x)",
      [linkAt("x", 2, 8, [0, 1, 0])],
    ],
    [
      "a nested list",
      "1. one\n   - nested [a](/doc/x)",
      [linkAt("x", 2, 13, [0, 0, 1, 0, 0])],
    ],
  ])("pins a link in %s", (_name, markdown, expected) => {
    expect(linksOf(markdown)).toEqual(expected);
  });

  it("pins an autolink at its <", () => {
    expect(
      linksOf("See <https://wiki.example.test/doc/x> and [a](/doc/y)")
    ).toEqual([
      {
        href: "https://wiki.example.test/doc/x",
        position: { line: 1, column: 5, path: [0] },
      },
      linkAt("y", 1, 43, [0]),
    ]);
  });

  it("gives no position to a link in a notice inside a table cell", () => {
    expect(
      linksOf(
        [
          "| H   | I   |",
          "|-----|-----|",
          "| :::info<br>n [a](/doc/x)<br><br>::: | [b](/doc/y) |",
        ].join("\n")
      )
    ).toEqual([
      { href: "/doc/x", position: null },
      linkAt("y", 3, 41, [0, 1, 1, 0]),
    ]);
  });

  it("skips images, mentions, code, and escaped brackets", () => {
    expect(
      linksOf(
        [
          "![alt](/doc/x) `[a](/doc/x)` \\[b](/doc/x)",
          "",
          "@[label](https://wiki.example.test/doc/x) [c]d](/doc/x)",
          "",
          "```",
          "[e](/doc/x)",
          "```",
        ].join("\n")
      )
    ).toEqual([]);
  });

  it("positions 8,000 links on one line in linear time", () => {
    const line = Array.from(
      { length: 8000 },
      (_, index) =>
        `ż😀 [link ${index}](/doc/00000000-0000-4000-8000-${String(index).padStart(12, "0")})`
    ).join(" ");

    const { links } = parseCanonicalMarkdown(line);

    expect(links).toHaveLength(8000);
    expect(links.every(({ position }) => position?.line === 1)).toBe(true);
    expect(links[7999].position?.column).toBe(
      Array.from(line.slice(0, line.lastIndexOf("["))).length + 1
    );
  });

  it("positions links of serializer output", async () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "ż😀 " },
            {
              type: "text",
              text: "one",
              marks: [{ type: "link", attrs: { href: "/doc/x" } }],
            },
            { type: "br" },
            {
              type: "text",
              text: "two",
              marks: [{ type: "link", attrs: { href: "/doc/y" } }],
            },
          ],
        },
      ],
    } as unknown as ProsemirrorData;
    const markdown = await toCanonicalMarkdown(doc);

    expect(markdown).toBe("ż😀 [one](/doc/x)\\n[two](/doc/y)");
    expect(linksOf(markdown)).toEqual([
      linkAt("x", 1, 4, [0]),
      linkAt("y", 1, 19, [0]),
    ]);
  });
});

describe("tokenizeCanonicalMarkdown", () => {
  /**
   * Reduces a token to its compared fields. A mention's `id` and `modelId`
   * may be generated per parse, so they are left out.
   *
   * @param token - the token.
   * @returns the compared fields.
   */
  const shape = (token: Token): unknown => ({
    type: token.type,
    tag: token.tag,
    map: token.map,
    content: token.content,
    markup: token.markup,
    attrs:
      token.type === "mention"
        ? token.attrs?.filter(([name]) => name !== "id" && name !== "modelId")
        : token.attrs,
    children: token.children?.map(shape) ?? null,
  });

  const corpus = [
    fixture,
    "Text ż😀 [a](/doc/x) <https://wiki.example.test/doc/y> ![i](/i.png)",
    "first\nsecond [a](/doc/x)\\nthird  \nfourth\n\\\nfifth",
    "## Heading [a](/doc/x) ##\n\nSetext\n===",
    "> quoted\n> second [a](/doc/x)\n> - in list",
    "- [ ] task [a](/doc/x)\n- [x] done\n  - nested [b](/doc/y)",
    "j. one\nk. two [a](/doc/x)\n\nA. upper",
    ":::info\nnotice [a](/doc/x)\n:::\n\n+++ Toggle\nbody\n+++",
    [
      "| H   | I   |",
      "|-----|-----|",
      "| [a](/doc/x) | a\\|b [c](/doc/z) |",
      "| :::info<br>n [a](/doc/x)<br><br>::: | [x] done<br>[ ] open |",
      "| one\\ntwo | <br> |",
    ].join("\n"),
    "@[label](https://wiki.example.test/doc/x) @[User](mention://00000000-0000-4000-8000-000000000001/user/00000000-0000-4000-8000-000000000002)",
    "[a]b](/doc/x) ==mark== __under__ ~~strike~~ $x^2$ :smile:",
    "$$\nx = 1\n$$\n\n```js\n[a](/doc/x)\n```\n\n---",
    "[report.pdf 1024](/api/attachments.redirect?id=00000000-0000-4000-8000-000000000001)",
  ];

  it.each(corpus.map((markdown) => [markdown]))(
    "yields the shared parser's tokens for %j",
    (markdown) => {
      expect(tokenizeCanonicalMarkdown(markdown).tokens.map(shape)).toEqual(
        parser.tokenizer.parse(markdown, {}).map(shape)
      );
    }
  );

  it("returns null for a token it did not observe", () => {
    const { tokens, linkPosition } = tokenizeCanonicalMarkdown("[a](/doc/x)");
    const other = parser.tokenizer.parse("[a](/doc/x)", {})[1].children?.[0];

    expect(tokens[1].children?.[0].type).toBe("link_open");
    expect(linkPosition(tokens[1].children![0], [0])).toEqual({
      line: 1,
      column: 1,
      path: [0],
    });
    expect(other?.type).toBe("link_open");
    expect(linkPosition(other!, [0])).toBeNull();
  });
});
