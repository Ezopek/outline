import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { TextEditMode } from "@shared/types";
import { parser, serializer } from "@server/editor";
import { Document, User } from "@server/models";
import {
  parseCanonicalMarkdown,
  toCanonicalMarkdown,
} from "@server/wikiLint/adapters/canonicalSyntax";
import {
  prepareMarkdownCreate,
  prepareMarkdownUpdate,
  projectMarkdownCreate,
  projectMarkdownUpdate,
} from "@server/wikiLint/adapters/documentProjection";
import { DocumentConverter } from "./DocumentConverter";

const requirePackage = createRequire(import.meta.url);

describe("parser security backports", () => {
  it("pins the qualified Markdown and YAML patch versions", () => {
    expect(requirePackage("markdown-it/package.json").version).toBe("14.3.3");
    expect(requirePackage("js-yaml/package.json").version).toBe("4.3.2");
  });

  it("bounds hostile references and empty frontmatter merges in a child process", () => {
    const output = execFileSync(
      process.execPath,
      [
        "--max-old-space-size=128",
        "-e",
        `
          const assert = require('node:assert/strict');
          const MarkdownIt = require('markdown-it');
          const { BaseConverter } = require('./server/converters/BaseConverter.ts');
          class Converter extends BaseConverter {
            static convert(text) { return this.processFrontmatter(text); }
          }
          const md = new MarkdownIt();
          for (const size of [128, 256, 512]) {
            for (const prefix of ['[label]: /doc "', '[label']) {
              const source = prefix + '\\ncontinued'.repeat(size);
              assert.ok(md.parse(source, {}).length > 0);
            }
          }
          const yaml = 'arr: &arr [' + Array(128).fill('{}').join(',') +
            ']\\ntargets:\\n' + '  - <<: *arr\\n'.repeat(128);
          const source = '---\\n' + yaml + '---\\nBody';
          // The converter keeps invalid/over-budget YAML unchanged. Empty
          // source visits must consume the default merge budget, too.
          assert.equal(Converter.convert(source), source);
          process.stdout.write('bounded parser controls passed');
        `,
      ],
      { timeout: 5000, maxBuffer: 64 * 1024, encoding: "utf8" }
    );
    expect(output).toBe("bounded parser controls passed");
  });

  it.each(["md", "txt"])(
    "preserves ordinary aliased %s frontmatter",
    async (ext) => {
      const result = await DocumentConverter.convert(
        "---\ndefaults: &defaults {status: active}\npage: {<<: *defaults}\n---\n# Heading\n\nBody",
        `control.${ext}`,
        ext === "md" ? "text/markdown" : "text/plain"
      );
      expect(result.text).toContain("```yaml\ndefaults: &defaults");
      expect(result.text).toContain("page: {<<: *defaults}");
      expect(result.text).toContain("Body");
      expect(result.doc.textContent).toContain("status: active");
    }
  );

  it("keeps malformed frontmatter as ordinary content", async () => {
    const result = await DocumentConverter.convert(
      "---\ninvalid: [unterminated\n---\nBody",
      "control.md",
      "text/markdown"
    );
    expect(result.text).not.toContain("```yaml");
    expect(result.doc.textContent).toContain("invalid: [unterminated");
    expect(result.text).toContain("Body");
  });

  it("preserves reference links and canonical visible metadata in a create projection", async () => {
    const markdown =
      "## Document metadata\n\n* Status: Active\n* Last verified: 2026-10-28\n\n[Page][page]\n\n[page]: /doc/control-abcdefghij";
    expect(parser.tokenizer.options).toMatchObject({
      html: false,
      linkify: false,
      typographer: false,
    });
    const projected = await projectMarkdownCreate({
      prepared: prepareMarkdownCreate({
        title: "Control",
        text: markdown,
        publish: true,
      }),
      documentId: "00000000-0000-4000-8000-000000000001",
      collectionId: "00000000-0000-4000-8000-000000000002",
      actor: User.build({}),
    });
    const canonical = await toCanonicalMarkdown(projected.content);
    expect(canonical).toBe(projected.text);
    expect(serializer.serialize(parser.parse(canonical))).toBe(canonical);
    expect(canonical).toContain("* Last verified: 2026-10-28");
    expect(
      parseCanonicalMarkdown(canonical).links.map((link) => link.href)
    ).toEqual(["/doc/control-abcdefghij"]);
  });

  it.each(Object.values(TextEditMode))(
    "round trips hostile reference text through full %s projection",
    async (editMode) => {
      const original = "Before\n\nReplace me\n\nAfter";
      const document = Document.build({
        id: "00000000-0000-4000-8000-000000000001",
        collectionId: "00000000-0000-4000-8000-000000000002",
        title: "Control",
        content: parser.parse(original).toJSON(),
        text: original,
        state: null,
      });
      const before = structuredClone(document.content);
      const projected = await projectMarkdownUpdate({
        prepared: prepareMarkdownUpdate({
          editMode,
          text: '[label]: /doc "' + "\ncontinued".repeat(64),
          // Span blocks so the baseline patch path reparses Markdown rather
          // than inserting literal newlines inside one existing text node.
          findText: editMode === TextEditMode.Patch ? original : undefined,
        }),
        document,
        collectionId: document.collectionId!,
      });
      const canonical = await toCanonicalMarkdown(projected.content);
      expect(serializer.serialize(parser.parse(canonical))).toBe(canonical);
      expect(parseCanonicalMarkdown(canonical).links).toEqual([]);
      expect(document.content).toEqual(before);
    }
  );
});
