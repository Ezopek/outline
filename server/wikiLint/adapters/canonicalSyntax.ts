import type Token from "markdown-it/lib/token.mjs";
import type { ProsemirrorData } from "@shared/types";
import type { Document } from "@server/models";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";
import type {
  CanonicalSyntax,
  SyntaxField,
  SyntaxLink,
  SyntaxNode,
  SyntaxPosition,
} from "../core/contracts";
import { tokenizeCanonicalMarkdown } from "./lintTokenizer";

/**
 * Thrown when canonical Markdown cannot be produced or positioned safely. No
 * position is ever fabricated in its place.
 */
export class CanonicalMarkdownError extends Error {
  name = "CanonicalMarkdownError";
}

/**
 * Serializes a document to its canonical Markdown: the exact string that all
 * lint positions index into. Only authoritative `content` or `state` is used;
 * `Document.text` is never read.
 *
 * @param input - a document with content or state, or ProseMirror data.
 * @returns the canonical Markdown.
 * @throws CanonicalMarkdownError when a document has neither content nor state.
 */
export async function toCanonicalMarkdown(
  input: Document | ProsemirrorData
): Promise<string> {
  const isProsemirrorData = "type" in input && input.type === "doc";
  if (
    !isProsemirrorData &&
    !(input as Document).content &&
    !(input as Document).state
  ) {
    throw new CanonicalMarkdownError("Document has no authoritative content");
  }
  return DocumentHelper.toMarkdown(input, { includeTitle: false });
}

/**
 * Returns the one-based code-point column of a UTF-16 offset in a line.
 *
 * @param line - the source line.
 * @param offset - the UTF-16 offset within the line.
 * @returns the one-based column in Unicode code points.
 */
function codePointColumn(line: string, offset: number): number {
  return Array.from(line.slice(0, offset)).length + 1;
}

/**
 * Computes the position of a block token: its first source line and the
 * column of the first non-space, non-tab character on that line.
 *
 * @param token - the block token.
 * @param path - the block's structural path.
 * @param lines - the canonical Markdown split on LF.
 * @returns the position, or null when the parser reports no source map.
 */
function blockPosition(
  token: Token,
  path: number[],
  lines: readonly string[]
): SyntaxPosition | null {
  if (!token.map) {
    return null;
  }
  const line = lines[token.map[0]];
  const offset = line === undefined ? -1 : line.search(/[^ \t]/);
  if (offset === -1) {
    throw new CanonicalMarkdownError("Block starts on an empty line");
  }
  return {
    line: token.map[0] + 1,
    column: codePointColumn(line, offset),
    path,
  };
}

/**
 * Indentation plus blockquote and list markers at the start of a source line.
 */
const SOURCE_PREFIX =
  /^(?:[ \t]*(?:>[ \t]?|[-+*][ \t]+|[0-9]{1,9}[.)][ \t]+))*/;

/** A checkbox marker at the start of an item's source text. */
const CHECKBOX_MARKER = /^\[(?:x|X|_|-|\s)\]\s/;

/**
 * Returns the source text of a line: the line without its source prefix,
 * trimmed with JS `trim()`.
 *
 * @param line - the source line.
 * @returns the source text and its UTF-16 offset within the line.
 */
function sourceText(line: string): { text: string; start: number } {
  const rest = line.slice(line.match(SOURCE_PREFIX)?.[0].length ?? 0);
  return { text: rest.trim(), start: line.length - rest.trimStart().length };
}

/**
 * Removes backslash escapes of ASCII punctuation, then trims with JS `trim()`.
 *
 * @param part - a raw field name or value.
 * @returns the cleaned text.
 */
function cleanFieldPart(part: string): string {
  return part.replace(/\\([!-/:-@[-`{-~])/g, "$1").trim();
}

/**
 * Returns the source map of the paragraph that opens a list item.
 *
 * @param item - the list item node.
 * @param tokens - the opening token of each node.
 * @returns the paragraph's map, or undefined when the item does not open with
 *   a mapped paragraph.
 */
function firstParagraphMap(
  item: SyntaxNode,
  tokens: ReadonlyMap<SyntaxNode, Token>
): [number, number] | undefined {
  const first = item.children[0];
  return first?.kind === "paragraph"
    ? (tokens.get(first)?.map ?? undefined)
    : undefined;
}

/**
 * Reads a `name: value` field from the source text of the single-line
 * paragraph that opens a bullet list item. The inline token's content is never
 * used, because Outline's rules may rewrite it.
 *
 * @param item - the list item node.
 * @param itemPath - the list item's structural path.
 * @param tokens - the opening token of each node.
 * @param lines - the canonical Markdown split on LF.
 * @returns the field, or undefined when the item holds no field.
 */
function readField(
  item: SyntaxNode,
  itemPath: number[],
  tokens: ReadonlyMap<SyntaxNode, Token>,
  lines: readonly string[]
): SyntaxField | undefined {
  const map = firstParagraphMap(item, tokens);
  if (!map || map[1] - map[0] !== 1) {
    return undefined;
  }
  const line = lines[map[0]];
  const { text, start } = sourceText(line);
  const colon = text.indexOf(":");
  if (colon === -1) {
    return undefined;
  }

  let valueOffset = colon + 1;
  while (valueOffset < text.length && /\s/.test(text[valueOffset])) {
    valueOffset++;
  }
  return {
    name: cleanFieldPart(text.slice(0, colon)),
    value: cleanFieldPart(text.slice(colon + 1)),
    valuePosition: {
      line: map[0] + 1,
      column: codePointColumn(line, start + valueOffset),
      path: itemPath,
    },
  };
}

const listKinds: ReadonlySet<string> = new Set([
  "bullet_list",
  "ordered_list",
  "checkbox_list",
]);

interface OpenBlock {
  node: SyntaxNode;
  token: Token;
  path: number[];
  /** Whether the block is a table or lies inside one. */
  inTable: boolean;
  /** The position of the enclosing table row, for blocks below a row. */
  row?: SyntaxPosition | null;
}

/**
 * Corrects the kind of a list outside tables from its source, because
 * Outline's checkbox rule mis-types lists, then reads the fields of a bullet
 * list. A list stays a checkbox list only when one of its direct items opens
 * with a checkbox marker; any other list takes its kind from its tag and its
 * items become plain list items.
 *
 * @param list - the list block that just closed.
 * @param tokens - the opening token of each node.
 * @param lines - the canonical Markdown split on LF.
 */
function finishList(
  list: OpenBlock,
  tokens: ReadonlyMap<SyntaxNode, Token>,
  lines: readonly string[]
): void {
  const { node } = list;
  const isChecklist =
    node.kind === "checkbox_list" &&
    node.children.some((item) => {
      const map = firstParagraphMap(item, tokens);
      return !!map && CHECKBOX_MARKER.test(sourceText(lines[map[0]]).text);
    });

  if (!isChecklist) {
    node.kind = list.token.tag === "ol" ? "ordered_list" : "bullet_list";
    for (const item of node.children) {
      if (item.kind === "checkbox_item") {
        item.kind = "list_item";
      }
    }
  }

  if (node.kind === "bullet_list") {
    node.children.forEach((item, index) => {
      const field = readField(item, [...list.path, index], tokens, lines);
      if (field) {
        item.field = field;
      }
    });
  }
}

/**
 * Parses canonical Markdown with Outline's own Markdown rules into a block
 * tree and its link tokens. This is the single producer of lint lines,
 * columns, and paths: lines are one-based over the exact string, columns
 * count code points, and paths are zero-based child indices that exclude
 * inline tokens. A table's children are its rows, a row's children are its
 * cells, and a cell's children are its blocks; every node below a row takes
 * the row's line and column, because the parser reports no document position
 * for it. Each link token that is a direct child of an inline token is listed
 * in document order with its enclosing block's path, at the `[` or `<` that
 * begins it, or with a null position when that cannot be proven.
 *
 * @param markdown - the canonical Markdown from `toCanonicalMarkdown`.
 * @returns the canonical syntax.
 * @throws CanonicalMarkdownError when the input contains a carriage return.
 */
export function parseCanonicalMarkdown(markdown: string): CanonicalSyntax {
  // markdown-it normalizes CR to LF, which would shift every later line.
  if (markdown.includes("\r")) {
    throw new CanonicalMarkdownError("Canonical Markdown contains a CR");
  }

  const lines = markdown.split("\n");
  const { tokens, linkPosition } = tokenizeCanonicalMarkdown(markdown);
  const tokenOf = new Map<SyntaxNode, Token>();
  const root: SyntaxNode[] = [];
  const links: SyntaxLink[] = [];
  const stack: OpenBlock[] = [];

  for (const token of tokens) {
    const parent = stack[stack.length - 1];

    // Opening and closing types can differ, so the tree follows nesting only.
    if (token.nesting === -1) {
      const closed = stack.pop();
      if (closed && !closed.inTable && listKinds.has(closed.node.kind)) {
        finishList(closed, tokenOf, lines);
      }
      continue;
    }

    if (token.type === "inline") {
      if (parent?.node.kind === "heading") {
        parent.node.text = (token.children ?? [])
          .filter((child) => ["text", "code_inline"].includes(child.type))
          .map((child) => child.content)
          .join("")
          .trim();
      }
      for (const child of token.children ?? []) {
        if (child.type === "link_open") {
          links.push({
            href: child.attrGet("href") ?? "",
            position: linkPosition(child, [...(parent?.path ?? [])]),
          });
        }
      }
      continue;
    }

    const siblings = parent ? parent.node.children : root;
    const path = [...(parent?.path ?? []), siblings.length];
    const kind =
      token.nesting === 1 ? token.type.replace(/_open$/, "") : token.type;
    // Below a table row, the parser's maps are null or cell-relative, so they
    // are never read: the row's own position is used instead.
    let position: SyntaxPosition | null;
    if (parent?.row === undefined) {
      position = blockPosition(token, path, lines);
    } else {
      position = parent.row
        ? { line: parent.row.line, column: parent.row.column, path }
        : null;
    }
    const node: SyntaxNode = { kind, position, children: [] };
    if (kind === "heading") {
      node.level = Number(token.tag.slice(1));
      node.text = "";
    }
    siblings.push(node);
    tokenOf.set(node, token);

    if (token.nesting === 1) {
      stack.push({
        node,
        token,
        path,
        inTable: kind === "table" || !!parent?.inTable,
        row: kind === "tr" ? position : parent?.row,
      });
    }
  }

  return { children: root, links };
}
