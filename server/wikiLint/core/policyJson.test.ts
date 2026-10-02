import { WikiLintContractError } from "./contracts";
import type { JsonNode } from "./policyJson";
import {
  canonicalJson,
  decodeJson,
  encodeUtf8,
  hasLoneSurrogate,
} from "./policyJson";

const bytesOf = (text: string) => Buffer.from(text, "utf8");

/**
 * Builds bytes from text with `\xNN` placeholders for raw bytes.
 *
 * @param pattern - ASCII text in which `\xNN` stands for one raw byte.
 * @returns the bytes.
 */
const rawBytes = (pattern: string) =>
  Uint8Array.from(
    pattern
      .split(/(\\x[0-9a-fA-F]{2})/)
      .filter((part) => part.length > 0)
      .flatMap((part) =>
        part.startsWith("\\x")
          ? [parseInt(part.slice(2), 16)]
          : [...Buffer.from(part, "latin1")]
      )
  );

const decodeOk = (text: string): JsonNode => {
  const result = decodeJson(bytesOf(text));
  if (!result.ok) {
    throw new Error(`unexpected malformed offset ${result.offset}`);
  }
  return result.root;
};

describe("decodeJson", () => {
  it("decodes every value kind with exact byte spans", () => {
    const root = decodeOk(' {"a": [1, -2.5e+3, "x"], "b": true, "c": null} ');

    expect(root).toEqual({
      type: "object",
      start: 1,
      end: 47,
      members: [
        {
          key: "a",
          keyStart: 2,
          value: {
            type: "array",
            start: 7,
            end: 24,
            items: [
              { type: "number", start: 8, end: 9, raw: "1" },
              { type: "number", start: 11, end: 18, raw: "-2.5e+3" },
              { type: "string", start: 20, end: 23, value: "x" },
            ],
          },
        },
        {
          key: "b",
          keyStart: 26,
          value: { type: "literal", start: 31, end: 35, value: true },
        },
        {
          key: "c",
          keyStart: 37,
          value: { type: "literal", start: 42, end: 46, value: null },
        },
      ],
    });
  });

  it("keeps duplicate keys in source order", () => {
    const root = decodeOk('{"a":1,"a":2}');

    expect(root.type === "object" && root.members).toEqual([
      {
        key: "a",
        keyStart: 1,
        value: { type: "number", start: 5, end: 6, raw: "1" },
      },
      {
        key: "a",
        keyStart: 7,
        value: { type: "number", start: 11, end: 12, raw: "2" },
      },
    ]);
  });

  it("unescapes strings and keys, keeping lone surrogates", () => {
    const text =
      '{"k\\u0065y": "\\"\\\\\\/\\b\\f\\n\\r\\t\\u00e9\\uD83D\\uDE00\\ud800é😀"}';
    const root = decodeOk(text);

    expect(root.type === "object" && root.members[0].key).toBe("key");
    const value = root.type === "object" ? root.members[0].value : root;
    expect(value).toEqual({
      type: "string",
      start: 13,
      end: bytesOf(text).length - 1,
      value: '"\\/\b\f\n\r\té😀\ud800é😀',
    });
  });

  it("decodes 3-byte characters across their lead-byte ranges", () => {
    const value = "\u0800\u2013\ud7ff\ufffd";
    const text = `"${value}"`;

    expect(decodeOk(text)).toEqual({
      type: "string",
      start: 0,
      end: 14,
      value,
    });
    expect(bytesOf(text).toString("utf8")).toBe(text);
  });

  it("decodes top-level scalars", () => {
    expect(decodeOk("0")).toEqual({
      type: "number",
      start: 0,
      end: 1,
      raw: "0",
    });
    expect(decodeOk('\t\r\n "s" ')).toEqual({
      type: "string",
      start: 4,
      end: 7,
      value: "s",
    });
    expect(decodeOk("false")).toEqual({
      type: "literal",
      start: 0,
      end: 5,
      value: false,
    });
  });

  it.each([
    ["an unexpected end inside an object", '{"a":1', 6],
    ["a leading zero", "[01]", 2],
    ["an invalid escape", '"\\x"', 2],
    ["a byte-order mark", "\\xEF\\xBB\\xBF{}", 0],
    ["an empty input", "", 0],
    ["whitespace only", "  \n", 3],
    ["a non-ASCII byte outside a string", "[1, \\xC3\\xA9]", 4],
    ["a stray continuation byte", '"a\\x80"', 2],
    ["a lead followed by ASCII", '"\\xC3A"', 1],
    ["an overlong three-byte sequence", '"\\xE0\\x80\\x80"', 1],
    ["an encoded surrogate", '"\\xED\\xA0\\x80"', 1],
    [
      "a four-byte lead below its second-byte range",
      '"\\xF0\\x80\\x80\\x80"',
      1,
    ],
    ["a bad third byte", '"\\xE2\\x82A"', 1],
    ["a bad fourth byte", '"\\xF0\\x9F\\x98A"', 1],
    ["a truncated lead at the end", '"ab\\xE2\\x82', 3],
    ["an invalid lead byte", '"\\xC0\\x80"', 1],
    ["a byte above U+10FFFF", '"\\xF4\\x90\\x80\\x80"', 1],
    ["a lead byte beyond F4", '"\\xF5"', 1],
    ["a grammar defect before ill-formed UTF-8", "[x\\x80]", 1],
    ["ill-formed UTF-8 before a grammar defect", "[\\x80x]", 1],
    ["a missing colon", '{"a" 1}', 5],
    ["a trailing comma in an object", '{"a":1,}', 7],
    ["a trailing comma in an array", "[1,]", 3],
    ["a non-string key", "{1:2}", 1],
    ["a lone minus", "-", 1],
    ["a minus without digits", "[-]", 2],
    ["a fraction without digits", "1.", 2],
    ["an exponent without digits", "1e", 2],
    ["a signed exponent without digits", "1e+", 3],
    ["a truncated literal", "tru", 3],
    ["a misspelled literal", "trux", 3],
    ["a capitalized literal", "True", 0],
    ["a bad unicode escape digit", '"\\u12G4"', 5],
    ["a raw control character in a string", '"a\nb"', 2],
    ["an unterminated string", '"abc', 4],
    ["trailing content", "{} x", 3],
    ["a second root value", "{}{}", 2],
    ["an extra closing brace", '{"a":1}}', 7],
    ["a mismatched closing bracket", '{"a":[1}', 7],
    ["a vertical tab as whitespace", "\\x0B1", 0],
  ])("locates %s", (_name, pattern, offset) => {
    expect(decodeJson(rawBytes(pattern))).toEqual({ ok: false, offset });
  });

  it("decodes 32,768 levels of nesting without recursion", () => {
    const depth = 32768;
    const nested = "[".repeat(depth) + "]".repeat(depth);
    const root = decodeJson(bytesOf(nested));

    expect(root.ok).toBe(true);
    expect(root.ok && root.root).toMatchObject({
      type: "array",
      start: 0,
      end: depth * 2,
    });
  });

  it("decodes 32,768 levels of nesting inside an entry", () => {
    const depth = 32768;
    const text = `{"schemaVersion":1,"collections":{"00000000-0000-4000-8000-000000000001":${"[".repeat(depth)}${"]".repeat(depth)}}}`;
    const result = decodeJson(bytesOf(text));

    expect(result.ok).toBe(true);
    expect(decodeJson(bytesOf("[".repeat(depth)))).toEqual({
      ok: false,
      offset: depth,
    });
  });
});

describe("hasLoneSurrogate", () => {
  it.each([
    ["", false],
    ["plain é", false],
    ["😀", false],
    ["\ud83d", true],
    ["\ude00", true],
    ["a\ude00\ud83d", true],
    ["\ud83d😀", true],
  ])("checks %j", (text, expected) => {
    expect(hasLoneSurrogate(text)).toBe(expected);
  });
});

describe("encodeUtf8", () => {
  it("encodes one- to four-byte characters", () => {
    const text = "a\u007f\u0080é߿ࠀ€￿😀\u{10ffff}";

    expect(Buffer.from(encodeUtf8(text))).toEqual(Buffer.from(text, "utf8"));
  });

  it("rejects lone surrogates", () => {
    expect(() => encodeUtf8("a\ud800")).toThrow(WikiLintContractError);
  });
});

describe("canonicalJson", () => {
  it("sorts keys by UTF-8 bytes and keeps array order", () => {
    expect(
      canonicalJson({
        b: [3, 1, 2],
        aa: { z: null, y: true },
        a: false,
        é: 0,
        "｡": 1,
        "😀": 2,
      })
    ).toBe(
      '{"a":false,"aa":{"y":true,"z":null},"b":[3,1,2],"é":0,"｡":1,"😀":2}'
    );
  });

  it("emits the shortest string escapes", () => {
    expect(
      canonicalJson('"\\/\b\f\n\r\t\u0000\u0001\u001f\u007f\u2028é😀')
    ).toBe('"\\"\\\\/\\b\\f\\n\\r\\t\\u0000\\u0001\\u001f\u007f\u2028é😀"');
  });

  it("emits integers in base 10", () => {
    expect(canonicalJson([0, -5, 9007199254740991, -9007199254740991])).toBe(
      "[0,-5,9007199254740991,-9007199254740991]"
    );
  });

  it("does not normalize Unicode", () => {
    expect(canonicalJson(["e\u0301", "\u00e9"])).toBe('["e\u0301","\u00e9"]');
  });

  it.each([
    ["negative zero", -0],
    ["a fraction", 1.5],
    ["NaN", NaN],
    ["infinity", Infinity],
    ["an unsafe integer", 2 ** 53],
    ["undefined", undefined],
    ["a function", () => 1],
    ["a big integer", BigInt(1)],
    ["a lone surrogate string", "\ud800"],
    ["a lone surrogate key", { "\udc00": 1 }],
    ["a map", new Map()],
    ["a class instance", new (class Example {})()],
    ["a nested undefined", { a: [undefined] }],
  ])("rejects %s", (_name, value) => {
    expect(() => canonicalJson(value)).toThrow(WikiLintContractError);
  });

  it("serializes 32,768 levels of nesting without recursion", () => {
    let value: unknown = [];
    for (let level = 1; level < 32768; level++) {
      value = [value];
    }

    expect(canonicalJson(value)).toBe("[".repeat(32768) + "]".repeat(32768));
  });
});
