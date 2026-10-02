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
