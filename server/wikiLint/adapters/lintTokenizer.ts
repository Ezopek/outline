import type MarkdownIt from "markdown-it";
import type StateCore from "markdown-it/lib/rules_core/state_core.mjs";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import type Token from "markdown-it/lib/token.mjs";
import makeRules from "@shared/editor/lib/markdown/rules";
import { extensionManager, schema } from "@server/editor";
import mentionRules from "@server/editor/rules/mentions";
import type { SyntaxPosition } from "../core/contracts";

/** The private env key under which the link observer keeps its record. */
const ENV_KEY = "wikiLintLinkSources";

/**
 * Where the content of an inline token lies in the processed source: on the
 * mapped lines of its block, or in an aligned table cell of a row line.
 */
type InlineSource =
  | { kind: "lines"; map: [number, number]; content: string }
  | { kind: "cell"; line: number; start: number; content: string };

/** The offset in its inline source at which a link token begins. */
interface LinkStart {
  source: InlineSource;
  offset: number;
}

/** The observer's record of one tokenizer run. */
interface LinkSources {
  /** The outer core state; a nested parse never replaces it. */
  core?: StateCore;
  /** The processed source of the outer state, split on LF. */
  lines: string[];
  /** The source of each outer inline token, keyed by its children array. */
  sources: Map<Token[], InlineSource>;
  /** The inline position and token count at the previous observation. */
  windows: Map<StateInline, { pos: number; length: number }>;
  /** The start of each link token whose start could be attributed. */
  starts: Map<Token, LinkStart>;
}

/**
 * Returns the observer's record carried by a parser environment.
 *
 * @param env - the markdown-it environment.
 * @returns the record, or undefined for another environment.
 */
function recordOf(env: unknown): LinkSources | undefined {
  return (env as Record<string, LinkSources | undefined> | undefined)?.[
    ENV_KEY
  ];
}

/**
 * Records the outer core state and its processed source, once.
 *
 * @param state - a core state.
 */
function recordProcessedSource(state: StateCore): void {
  const record = recordOf(state.env);
  if (record && !record.core) {
    record.core = state;
    record.lines = state.src.split("\n");
  }
}

/**
 * Maps each outer inline token's children array to its source: its mapped
 * lines, or, for an unmapped table cell, the cell aligned left to right on
 * its row line. Once a cell fails to align, the rest of its row stays
 * unaligned.
 *
 * @param state - a core state, after block parsing.
 */
function mapInlineSources(state: StateCore): void {
  const record = recordOf(state.env);
  if (!record || record.core !== state) {
    return;
  }

  let row: { line: number; cursor: number } | null = null;
  for (const token of state.tokens) {
    if (token.type === "tr_open") {
      row = token.map ? { line: token.map[0], cursor: 0 } : null;
    } else if (token.type === "tr_close") {
      row = null;
    } else if (token.type === "inline" && token.children) {
      if (token.map) {
        record.sources.set(token.children, {
          kind: "lines",
          map: [token.map[0], token.map[1]],
          content: token.content,
        });
      } else if (row) {
        // The parser reduces each escaped pipe of a cell to a bare pipe.
        const escaped = token.content.replace(/\|/g, "\\|");
        const start =
          record.lines[row.line]?.indexOf(escaped, row.cursor) ?? -1;
        if (start === -1) {
          row = null;
        } else {
          row.cursor = start + escaped.length;
          record.sources.set(token.children, {
            kind: "cell",
            line: row.line,
            start,
            content: token.content,
          });
        }
      }
    }
  }
}

/**
 * Attributes the link token pushed since the previous observation of an
 * inline state to that observation's position. A window holding more than one
 * link token is left unattributed.
 *
 * @param record - the observer's record.
 * @param state - the inline state.
 */
function attributeWindow(record: LinkSources, state: StateInline): void {
  const window = record.windows.get(state);
  if (!window) {
    return;
  }
  const opened = state.tokens
    .slice(window.length)
    .filter((token) => token.type === "link_open");
  const source = record.sources.get(state.tokens);
  if (opened.length === 1 && source) {
    record.starts.set(opened[0], { source, offset: window.pos });
  }
}

/**
 * An inline rule that runs before every other rule at each position. It never
 * matches and never changes a token.
 *
 * @param state - the inline state.
 * @param silent - whether the parser is only validating.
 * @returns false.
 */
function observeLinkStart(state: StateInline, silent: boolean): boolean {
  const record = recordOf(state.env);
  if (record && !silent) {
    attributeWindow(record, state);
    record.windows.set(state, { pos: state.pos, length: state.tokens.length });
  }
  return false;
}

/**
 * A post-processing rule that attributes the last window of an inline state.
 *
 * @param state - the inline state.
 * @returns false.
 */
function flushLinkStart(state: StateInline): boolean {
  const record = recordOf(state.env);
  if (record) {
    attributeWindow(record, state);
    record.windows.delete(state);
  }
  return false;
}

/**
 * A markdown-it plugin that records where link tokens begin. It adds rules
 * only and never changes a token.
 *
 * @param md - the markdown-it instance.
 */
function linkObserver(md: MarkdownIt): void {
  md.core.ruler.after("normalize", "wiki_lint_source", recordProcessedSource);
  md.core.ruler.before("inline", "wiki_lint_inline_sources", mapInlineSources);
  md.inline.ruler.before("text", "wiki_lint_link_start", observeLinkStart);
  md.inline.ruler2.before(
    "balance_pairs",
    "wiki_lint_link_end",
    flushLinkStart
  );
}

/**
 * The lint tokenizer: built exactly as the server parser's tokenizer, plus the
 * link observer. The shared parser is never mutated.
 */
const tokenizer = makeRules({
  schema,
  plugins: [...extensionManager.rulePlugins, mentionRules, linkObserver],
});

/**
 * Lists the offsets of a character in a string, in ascending order.
 *
 * @param text - the string.
 * @param char - the character.
 * @returns the offsets.
 */
function offsetsOf(text: string, char: string): number[] {
  const offsets: number[] = [];
  for (
    let at = text.indexOf(char);
    at !== -1;
    at = text.indexOf(char, at + 1)
  ) {
    offsets.push(at);
  }
  return offsets;
}

/**
 * Counts the values of an ascending list that are below a bound.
 *
 * @param sorted - the ascending values.
 * @param bound - the exclusive upper bound.
 * @returns the count.
 */
function countBelow(sorted: readonly number[], bound: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle] < bound) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

/** Lookups of one inline source, computed once per tokenizer run. */
interface SourceIndex {
  /**
   * The offsets of LF in the content of a `lines` source, or of bare pipes in
   * the content of a `cell` source.
   */
  marks: number[];
  /** The processed start of each content line's segment; null when absent. */
  segmentStarts: Map<number, number | null>;
}

/** Lookups of one source line, computed once per tokenizer run. */
interface LineIndex {
  /** The length of the common suffix of the processed and original line. */
  suffix: number;
  /** The offsets at which a surrogate pair begins in the original line. */
  pairs: number[];
}

/**
 * Finds the processed line and offset of a link start.
 *
 * @param start - the link start.
 * @param index - the lookups of its source.
 * @param lines - the processed source lines.
 * @returns the zero-based line and UTF-16 offset, or null when unprovable.
 */
function processedLocation(
  { source, offset }: LinkStart,
  index: SourceIndex,
  lines: readonly string[]
): { line: number; offset: number } | null {
  // The number of LFs, or of bare pipes, before the offset.
  const count = countBelow(index.marks, offset);
  if (source.kind === "cell") {
    // Each bare pipe before the offset is an escaped pipe in the source.
    return { line: source.line, offset: source.start + offset + count };
  }

  const line = source.map[0] + count;
  if (line >= source.map[1]) {
    return null;
  }
  const segmentStart = count === 0 ? 0 : index.marks[count - 1] + 1;
  let at = index.segmentStarts.get(count);
  if (at === undefined) {
    const segment = source.content.slice(
      segmentStart,
      index.marks[count] ?? source.content.length
    );
    const found = lines[line]?.indexOf(segment) ?? -1;
    at = found === -1 ? null : found;
    index.segmentStarts.set(count, at);
  }
  return at === null ? null : { line, offset: at + offset - segmentStart };
}

/**
 * Tokenizes canonical Markdown with the lint tokenizer.
 *
 * @param markdown - the canonical Markdown, without carriage returns.
 * @returns the tokens, and a function that returns the source position of a
 *   link token: the `[` or `<` that begins it, with the given path, or null
 *   when that position cannot be proven.
 */
export function tokenizeCanonicalMarkdown(markdown: string): {
  tokens: Token[];
  linkPosition: (linkOpen: Token, path: number[]) => SyntaxPosition | null;
} {
  const record: LinkSources = {
    lines: [],
    sources: new Map(),
    windows: new Map(),
    starts: new Map(),
  };
  const tokens = tokenizer.parse(markdown, { [ENV_KEY]: record });
  const originalLines = markdown.split("\n");
  const sourceIndexes = new Map<InlineSource, SourceIndex>();
  const lineIndexes = new Map<number, LineIndex>();

  const sourceIndexOf = (source: InlineSource): SourceIndex => {
    let index = sourceIndexes.get(source);
    if (!index) {
      index = {
        marks: offsetsOf(source.content, source.kind === "cell" ? "|" : "\n"),
        segmentStarts: new Map(),
      };
      sourceIndexes.set(source, index);
    }
    return index;
  };

  const lineIndexOf = (
    line: number,
    processed: string,
    original: string
  ): LineIndex => {
    let index = lineIndexes.get(line);
    if (!index) {
      let suffix = 0;
      while (
        suffix < processed.length &&
        suffix < original.length &&
        processed[processed.length - 1 - suffix] ===
          original[original.length - 1 - suffix]
      ) {
        suffix++;
      }
      const pairs: number[] = [];
      for (let at = 0; at < original.length - 1; at++) {
        const code = original.charCodeAt(at);
        const next = original.charCodeAt(at + 1);
        if (
          code >= 0xd800 &&
          code <= 0xdbff &&
          next >= 0xdc00 &&
          next <= 0xdfff
        ) {
          pairs.push(at);
          at++;
        }
      }
      index = { suffix, pairs };
      lineIndexes.set(line, index);
    }
    return index;
  };

  const linkPosition = (
    linkOpen: Token,
    path: number[]
  ): SyntaxPosition | null => {
    const start = record.starts.get(linkOpen);
    const located = start
      ? processedLocation(start, sourceIndexOf(start.source), record.lines)
      : null;
    const processed = located ? record.lines[located.line] : undefined;
    const original = located ? originalLines[located.line] : undefined;
    if (!located || processed === undefined || original === undefined) {
      return null;
    }

    // The processed line maps to the original by identity when both have
    // equal length, and otherwise through their common suffix.
    const { suffix, pairs } = lineIndexOf(located.line, processed, original);
    const fromEnd = processed.length - located.offset;
    const offset =
      processed.length === original.length
        ? located.offset
        : fromEnd <= suffix
          ? original.length - fromEnd
          : null;
    if (
      offset === null ||
      (original[offset] !== "[" && original[offset] !== "<")
    ) {
      return null;
    }
    // A surrogate pair wholly before the offset is one code point.
    return {
      line: located.line + 1,
      column: offset - countBelow(pairs, offset - 1) + 1,
      path,
    };
  };

  return { tokens, linkPosition };
}
