import { WikiLintContractError } from "./contracts";
import { compareUtf8 } from "./ordering";

/**
 * A decoded JSON value with its exact source span: `start` is the offset of
 * its first byte and `end` the offset just past its last byte.
 */
export type JsonNode =
  | JsonObjectNode
  | JsonArrayNode
  | JsonStringNode
  | JsonNumberNode
  | JsonLiteralNode;

/** An object member as written. Duplicate keys are kept in source order. */
export interface JsonMember {
  /** The unescaped key, which may hold lone surrogates. */
  key: string;
  /** Offset of the key's opening quote. */
  keyStart: number;
  value: JsonNode;
}

export interface JsonObjectNode {
  type: "object";
  start: number;
  end: number;
  members: JsonMember[];
}

export interface JsonArrayNode {
  type: "array";
  start: number;
  end: number;
  items: JsonNode[];
}

export interface JsonStringNode {
  type: "string";
  start: number;
  end: number;
  /** The unescaped value, which may hold lone surrogates. */
  value: string;
}

export interface JsonNumberNode {
  type: "number";
  start: number;
  end: number;
  /** The number token exactly as written. */
  raw: string;
}

export interface JsonLiteralNode {
  type: "literal";
  start: number;
  end: number;
  value: boolean | null;
}

export type JsonDecodeResult =
  | { ok: true; root: JsonNode }
  | { ok: false; offset: number };

/** Thrown inside the decoder to stop at the first non-viable byte. */
class JsonSyntaxFailure extends Error {
  name = "JsonSyntaxFailure";
  offset: number;

  constructor(offset: number) {
    super("Malformed JSON");
    this.offset = offset;
  }
}

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const COMMA = 0x2c;
const COLON = 0x3a;
const MINUS = 0x2d;
const PLUS = 0x2b;
const DOT = 0x2e;
const ZERO = 0x30;
const NINE = 0x39;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;
/** Returned by `peek` at the end of the decodable input. */
const END = -1;

const simpleEscapes: Record<number, string> = {
  0x22: '"',
  0x5c: "\\",
  0x2f: "/",
  0x62: "\b",
  0x66: "\f",
  0x6e: "\n",
  0x72: "\r",
  0x74: "\t",
};

/**
 * Checks whether a byte is RFC 8259 whitespace: space, tab, LF, or CR.
 *
 * @param byte - the byte.
 * @returns whether the byte is whitespace.
 */
const isWhitespace = (byte: number) =>
  byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;

/**
 * Checks whether a byte is an ASCII digit.
 *
 * @param byte - the byte, or `END`.
 * @returns whether the byte is a digit.
 */
const isDigit = (byte: number) => byte >= ZERO && byte <= NINE;

/**
 * Returns the value of an ASCII hexadecimal digit.
 *
 * @param byte - the byte, or `END`.
 * @returns the digit's value, or -1 when the byte is not a hex digit.
 */
function hexValue(byte: number): number {
  if (isDigit(byte)) {
    return byte - ZERO;
  }
  const lower = byte | 0x20;
  return lower >= 0x61 && lower <= 0x66 ? lower - 0x57 : -1;
}

/**
 * Finds the first byte that does not start a well-formed UTF-8 character
 * (Unicode Table 3-7). An ill-formed or truncated sequence is located at its
 * lead byte, and a stray continuation byte at itself.
 *
 * @param bytes - the input.
 * @returns the offset, or -1 when the input is well-formed UTF-8.
 */
function findIllFormedUtf8(bytes: Uint8Array): number {
  let index = 0;
  while (index < bytes.length) {
    const lead = bytes[index];
    if (lead < 0x80) {
      index++;
      continue;
    }
    let length: number;
    let low = 0x80;
    let high = 0xbf;
    if (lead >= 0xc2 && lead <= 0xdf) {
      length = 2;
    } else if (lead === 0xe0) {
      length = 3;
      low = 0xa0;
    } else if (lead === 0xed) {
      length = 3;
      high = 0x9f;
    } else if (lead >= 0xe1 && lead <= 0xef) {
      length = 3;
    } else if (lead === 0xf0) {
      length = 4;
      low = 0x90;
    } else if (lead === 0xf4) {
      length = 4;
      high = 0x8f;
    } else if (lead >= 0xf1 && lead <= 0xf3) {
      length = 4;
    } else {
      return index;
    }
    if (index + length > bytes.length) {
      return index;
    }
    const second = bytes[index + 1];
    if (second < low || second > high) {
      return index;
    }
    for (let next = index + 2; next < index + length; next++) {
      if (bytes[next] < 0x80 || bytes[next] > 0xbf) {
        return index;
      }
    }
    index += length;
  }
  return -1;
}

/**
 * Parses one RFC 8259 text from `bytes[0, limit)`, where `limit` is treated as
 * the end of input and every character before it is well-formed UTF-8. The
 * parser is iterative and LL(1), so it fails at the first byte at which the
 * input stops being a prefix of some JSON text.
 *
 * @param bytes - the input.
 * @param limit - the end of the decodable input.
 * @returns the root node.
 * @throws JsonSyntaxFailure at the first non-viable offset.
 */
function parseText(bytes: Uint8Array, limit: number): JsonNode {
  let position = 0;

  const peek = () => (position < limit ? bytes[position] : END);
  const fail = (offset: number): never => {
    throw new JsonSyntaxFailure(offset);
  };
  const skipWhitespace = () => {
    while (position < limit && isWhitespace(bytes[position])) {
      position++;
    }
  };
  const consume = (byte: number) => {
    if (peek() !== byte) {
      fail(position);
    }
    position++;
  };

  const parseString = (): JsonStringNode => {
    const start = position;
    position++;
    let value = "";
    for (;;) {
      const byte = peek();
      if (byte === END) {
        return fail(position);
      }
      if (byte === QUOTE) {
        position++;
        return { type: "string", start, end: position, value };
      }
      if (byte === BACKSLASH) {
        position++;
        const escape = peek();
        if (escape === 0x75) {
          position++;
          let unit = 0;
          for (let digit = 0; digit < 4; digit++) {
            const nibble = hexValue(peek());
            if (nibble < 0) {
              fail(position);
            }
            unit = unit * 16 + nibble;
            position++;
          }
          value += String.fromCharCode(unit);
        } else if (escape !== END && simpleEscapes[escape] !== undefined) {
          position++;
          value += simpleEscapes[escape];
        } else {
          fail(position);
        }
      } else if (byte < 0x20) {
        fail(position);
      } else if (byte < 0x80) {
        position++;
        value += String.fromCharCode(byte);
      } else {
        // The input before `limit` is well-formed, so the sequence is complete.
        let codePoint: number;
        if (byte < 0xe0) {
          codePoint = ((byte & 0x1f) << 6) | (bytes[position + 1] & 0x3f);
          position += 2;
        } else if (byte < 0xf0) {
          codePoint =
            ((byte & 0x0f) << 12) |
            ((bytes[position + 1] & 0x3f) << 6) |
            (bytes[position + 2] & 0x3f);
          position += 3;
        } else {
          codePoint =
            ((byte & 0x07) << 18) |
            ((bytes[position + 1] & 0x3f) << 12) |
            ((bytes[position + 2] & 0x3f) << 6) |
            (bytes[position + 3] & 0x3f);
          position += 4;
        }
        value += String.fromCodePoint(codePoint);
      }
    }
  };

  const parseNumber = (): JsonNumberNode => {
    const start = position;
    if (peek() === MINUS) {
      position++;
    }
    if (peek() === ZERO) {
      position++;
    } else if (isDigit(peek())) {
      while (isDigit(peek())) {
        position++;
      }
    } else {
      fail(position);
    }
    if (peek() === DOT) {
      position++;
      if (!isDigit(peek())) {
        fail(position);
      }
      while (isDigit(peek())) {
        position++;
      }
    }
    if ((peek() | 0x20) === 0x65) {
      position++;
      if (peek() === PLUS || peek() === MINUS) {
        position++;
      }
      if (!isDigit(peek())) {
        fail(position);
      }
      while (isDigit(peek())) {
        position++;
      }
    }
    let raw = "";
    for (let index = start; index < position; index++) {
      raw += String.fromCharCode(bytes[index]);
    }
    return { type: "number", start, end: position, raw };
  };

  const parseLiteral = (
    word: string,
    value: boolean | null
  ): JsonLiteralNode => {
    const start = position;
    for (let index = 0; index < word.length; index++) {
      if (peek() !== word.charCodeAt(index)) {
        fail(position);
      }
      position++;
    }
    return { type: "literal", start, end: position, value };
  };

  /** Parses a member key and its colon; whitespace before it is skipped. */
  const parseKey = (): { key: string; keyStart: number } => {
    if (peek() !== QUOTE) {
      fail(position);
    }
    const keyStart = position;
    const key = parseString().value;
    skipWhitespace();
    consume(COLON);
    return { key, keyStart };
  };

  type Frame =
    | { kind: "object"; node: JsonObjectNode; key: string; keyStart: number }
    | { kind: "array"; node: JsonArrayNode };
  const stack: Frame[] = [];

  for (;;) {
    skipWhitespace();
    const byte = peek();
    let value: JsonNode;
    if (byte === OPEN_BRACE) {
      const node: JsonObjectNode = {
        type: "object",
        start: position,
        end: -1,
        members: [],
      };
      position++;
      skipWhitespace();
      if (peek() !== CLOSE_BRACE) {
        stack.push({ kind: "object", node, ...parseKey() });
        continue;
      }
      position++;
      node.end = position;
      value = node;
    } else if (byte === OPEN_BRACKET) {
      const node: JsonArrayNode = {
        type: "array",
        start: position,
        end: -1,
        items: [],
      };
      position++;
      skipWhitespace();
      if (peek() !== CLOSE_BRACKET) {
        stack.push({ kind: "array", node });
        continue;
      }
      position++;
      node.end = position;
      value = node;
    } else if (byte === QUOTE) {
      value = parseString();
    } else if (byte === MINUS || isDigit(byte)) {
      value = parseNumber();
    } else if (byte === 0x74) {
      value = parseLiteral("true", true);
    } else if (byte === 0x66) {
      value = parseLiteral("false", false);
    } else if (byte === 0x6e) {
      value = parseLiteral("null", null);
    } else {
      return fail(position);
    }

    // Attach the completed value, closing every container it completes.
    for (;;) {
      const frame = stack[stack.length - 1];
      if (!frame) {
        skipWhitespace();
        if (position < limit) {
          fail(position);
        }
        return value;
      }
      if (frame.kind === "object") {
        frame.node.members.push({
          key: frame.key,
          keyStart: frame.keyStart,
          value,
        });
      } else {
        frame.node.items.push(value);
      }
      skipWhitespace();
      const next = peek();
      if (next === COMMA) {
        position++;
        if (frame.kind === "object") {
          skipWhitespace();
          const { key, keyStart } = parseKey();
          frame.key = key;
          frame.keyStart = keyStart;
        }
        break;
      }
      if (next !== (frame.kind === "object" ? CLOSE_BRACE : CLOSE_BRACKET)) {
        fail(position);
      }
      position++;
      frame.node.end = position;
      stack.pop();
      value = frame.node;
    }
  }
}

/**
 * Decodes RFC 8259 JSON from raw bytes without `JSON.parse`. Duplicate keys
 * are kept, every node carries its byte span, and strings may hold lone
 * surrogates written as escapes. The decoder is iterative, so nesting depth
 * is bounded only by the input length.
 *
 * Malformed input is a leading byte-order mark, ill-formed UTF-8, or any
 * grammar violation. It is located at the lower of the first ill-formed UTF-8
 * offset and the first byte at which the preceding input stops being a prefix
 * of some JSON text; an unexpected end of input is located at the input length.
 *
 * @param bytes - the input.
 * @returns the root node, or the offset of the first malformed byte.
 */
export function decodeJson(bytes: Uint8Array): JsonDecodeResult {
  const illFormedAt = findIllFormedUtf8(bytes);
  const limit = illFormedAt < 0 ? bytes.length : illFormedAt;
  let root: JsonNode;
  try {
    root = parseText(bytes, limit);
  } catch (error) {
    if (error instanceof JsonSyntaxFailure) {
      return { ok: false, offset: error.offset };
    }
    throw error;
  }
  return illFormedAt < 0
    ? { ok: true, root }
    : { ok: false, offset: illFormedAt };
}

/**
 * Checks whether a string holds an unpaired UTF-16 surrogate.
 *
 * @param text - the string.
 * @returns whether the string holds a lone surrogate.
 */
export function hasLoneSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index++;
        continue;
      }
      return true;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/**
 * Encodes a well-formed string as UTF-8.
 *
 * @param text - the string.
 * @returns the UTF-8 bytes.
 * @throws WikiLintContractError when the string holds a lone surrogate.
 */
export function encodeUtf8(text: string): Uint8Array {
  if (hasLoneSurrogate(text)) {
    throw new WikiLintContractError("Text contains a lone surrogate");
  }
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index++) {
    const codePoint = text.codePointAt(index) ?? 0;
    if (codePoint > 0xffff) {
      index++;
    }
    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    }
  }
  return Uint8Array.from(bytes);
}

/**
 * Serializes a JSON string with the AD-6 shortest escapes. `JSON.stringify`
 * escapes exactly quote, reverse solidus, and U+0000–U+001F, using lowercase
 * `\u00xx` where no short escape exists.
 *
 * @param text - the string.
 * @returns the quoted string.
 * @throws WikiLintContractError when the string holds a lone surrogate.
 */
function quote(text: string): string {
  if (hasLoneSurrogate(text)) {
    throw new WikiLintContractError("Text contains a lone surrogate");
  }
  return JSON.stringify(text);
}

/**
 * Checks whether a value is a plain object.
 *
 * @param value - the value.
 * @returns whether the value is a non-array object with a plain prototype.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

type CanonicalWork = { text: string } | { value: unknown };

/**
 * Serializes a plain JSON value in AD-6 canonical form: no whitespace, object
 * keys sorted by their UTF-8 bytes, array order kept, no Unicode
 * normalization, and integers in base 10. The walk is iterative.
 *
 * @param value - null, a boolean, a safe integer other than -0, a string
 * without lone surrogates, or an array or plain object of such values.
 * @returns the canonical JSON text.
 * @throws WikiLintContractError for any other value.
 */
export function canonicalJson(value: unknown): string {
  let output = "";
  const stack: CanonicalWork[] = [{ value }];
  while (stack.length > 0) {
    const work = stack.pop() as CanonicalWork;
    if ("text" in work) {
      output += work.text;
      continue;
    }
    const current = work.value;
    if (current === null) {
      output += "null";
    } else if (typeof current === "boolean") {
      output += current ? "true" : "false";
    } else if (typeof current === "number") {
      if (!Number.isSafeInteger(current) || Object.is(current, -0)) {
        throw new WikiLintContractError("Number is not canonical");
      }
      output += String(current);
    } else if (typeof current === "string") {
      output += quote(current);
    } else if (Array.isArray(current)) {
      output += "[";
      stack.push({ text: "]" });
      for (let index = current.length - 1; index >= 0; index--) {
        stack.push({ value: current[index] as unknown });
        if (index > 0) {
          stack.push({ text: "," });
        }
      }
    } else if (isPlainObject(current)) {
      const keys = Object.keys(current).sort(compareUtf8);
      output += "{";
      stack.push({ text: "}" });
      for (let index = keys.length - 1; index >= 0; index--) {
        stack.push({ value: current[keys[index]] });
        stack.push({ text: `${quote(keys[index])}:` });
        if (index > 0) {
          stack.push({ text: "," });
        }
      }
    } else {
      throw new WikiLintContractError("Value is not canonical JSON");
    }
  }
  return output;
}
