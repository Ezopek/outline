import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PolicySetResult } from "./policySet";
import { POLICY_CONFIG_MAX_BYTES, buildPolicySet } from "./policySet";

const sha256Hex = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const fingerprintOf = (text: string | Uint8Array) =>
  `sha256:${sha256Hex(typeof text === "string" ? Buffer.from(text, "utf8") : text)}`;

const EMPTY_FINGERPRINT =
  "sha256:25d4e8ec86646fe465b938d352ab3973a46bef099e8ec712c5535c1a2609ecc2";

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const C = "00000000-0000-4000-8000-000000000003";
/** A synthetic UUID in uppercase, which is not canonical. */
const UPPERCASE = "00000000-0000-4000-8000-00000000000A";

const load = (text: string | Uint8Array) =>
  buildPolicySet(
    typeof text === "string" ? Buffer.from(text, "utf8") : text,
    sha256Hex
  );

const envelope = (collections: string) =>
  `{"schemaVersion":1,"collections":{${collections}}}`;

const minimalPolicy =
  '{"activation":"read_only","rules":[{"kind":"internal_links"}]}';

/**
 * Loads a configuration that must be accepted.
 *
 * @param text - the configuration text.
 * @returns the accepted result.
 */
function loadOk(text: string | Uint8Array) {
  const result = load(text);
  if (!result.ok) {
    throw new Error(`unexpected ${result.code} at ${result.location}`);
  }
  return result;
}

/**
 * Loads one entry for collection A and returns its sentinel path.
 *
 * @param value - the entry value text.
 * @returns the sentinel diagnostics.
 */
function sentinelOf(value: string) {
  const result = loadOk(envelope(`"${A}":${value}`));
  expect(result.policySet.entries).toEqual([
    expect.objectContaining({ collectionId: A, status: "invalid" }),
  ]);
  return result.sentinels[0];
}

describe("buildPolicySet", () => {
  describe("empty sets", () => {
    it("gives the golden empty fingerprint for an absent configuration", () => {
      expect(buildPolicySet(null, sha256Hex)).toEqual({
        ok: true,
        policySet: { policySetFingerprint: EMPTY_FINGERPRINT, entries: [] },
        sentinels: [],
      });
      expect(fingerprintOf('{"collections":[],"schemaVersion":1}')).toBe(
        EMPTY_FINGERPRINT
      );
    });

    it("gives the same fingerprint for an empty envelope", () => {
      expect(load('{ "schemaVersion": 1, "collections": {} }')).toEqual(
        buildPolicySet(null, sha256Hex)
      );
    });
  });

  describe("size", () => {
    const padded = (size: number) => {
      const text = envelope("");
      return text + " ".repeat(size - text.length);
    };

    it("accepts exactly 65,536 bytes", () => {
      expect(POLICY_CONFIG_MAX_BYTES).toBe(65536);
      expect(loadOk(padded(65536)).policySet.policySetFingerprint).toBe(
        EMPTY_FINGERPRINT
      );
    });

    it("rejects 65,537 bytes as a file defect", () => {
      expect(load(padded(65537))).toEqual({
        ok: false,
        code: "POLICY_CONFIGURATION_MALFORMED",
        location: "file",
      });
    });
  });

  describe("startup-fatal defects", () => {
    const malformed = (location: number | "file"): PolicySetResult => ({
      ok: false,
      code: "POLICY_CONFIGURATION_MALFORMED",
      location,
    });
    const unsupported = (location: number): PolicySetResult => ({
      ok: false,
      code: "POLICY_SCHEMA_VERSION_UNSUPPORTED",
      location,
    });

    it.each([
      ["an empty file", "", 0],
      ["a byte-order mark", `\ufeff${envelope("")}`, 0],
      ["a grammar violation", '{"schemaVersion":1,"collections":{},}', 36],
      ["an unexpected end of input", '{"schemaVersion":1', 18],
    ])("rejects %s as malformed input", (_name, text, offset) => {
      expect(load(text)).toEqual(malformed(offset));
    });

    it("rejects ill-formed UTF-8 as malformed input", () => {
      const bytes = Buffer.concat([
        Buffer.from('{"schemaVersion":1,"collections":{"'),
        Buffer.from([0xc3, 0x41]),
        Buffer.from('":{}}}'),
      ]);
      expect(load(bytes)).toEqual(malformed(35));
    });

    it.each([
      ["2", "2"],
      ["a string", '"1"'],
      ["a fraction", "1.0"],
      ["an exponent", "1e0"],
      ["an object", "{}"],
    ])("rejects a schemaVersion of %s", (_name, version) => {
      const text = `{"schemaVersion":${version},"collections":{}}`;
      expect(load(text)).toEqual(unsupported(17));
    });

    it("prefers a decoding defect over an unsupported version", () => {
      expect(load('{"schemaVersion":2,"collections":{}')).toEqual(
        malformed(35)
      );
    });

    it("prefers an unsupported version over an earlier root defect", () => {
      expect(load('{"unknown":1,"schemaVersion":2,"collections":{}}')).toEqual(
        unsupported(29)
      );
    });

    it("locates the lowest unsupported version among duplicates", () => {
      expect(
        load('{"schemaVersion":1,"schemaVersion":3,"schemaVersion":2}')
      ).toEqual(unsupported(35));
    });

    it("locates the lowest of several root defects", () => {
      expect(
        load(`{"schemaVersion":1,"collections":{"${UPPERCASE}":{}},"extra":1}`)
      ).toEqual(malformed(34));
    });

    it.each([
      ["a non-object root", "  []", 2],
      ["a missing schemaVersion", '  {"collections":{}}', 2],
      ["a missing collections", ' {"schemaVersion":1}', 1],
      ["an unknown root key", '{"schemaVersion":1,"collections":{},"x":1}', 36],
      ["a missing member before an unknown key", '{"collections":{},"x":1}', 0],
      [
        "a duplicate root key after unescaping",
        '{"schemaVersion":1,"collections":{},"schema\\u0056ersion":1}',
        36,
      ],
      ["a non-object collections", '{"schemaVersion":1,"collections":[]}', 33],
      [
        "a duplicate collection key after unescaping",
        envelope(`"${A}":${minimalPolicy},"\\u0030${A.slice(1)}":{}`),
        34 + A.length + 3 + minimalPolicy.length + 1,
      ],
      ["an uppercase collection key", envelope(`"${UPPERCASE}":{}`), 34],
      ["a non-UUID collection key", envelope('"pilot":{}'), 34],
      ["a braced collection key", envelope(`"{${A}}":{}`), 34],
      ["a lone surrogate collection key", envelope('"\\ud800":{}'), 34],
    ])("rejects %s", (_name, text, offset) => {
      expect(load(text)).toEqual(malformed(offset));
    });

    it("rejects a 32,768-level root without a crash", () => {
      const depth = 32768;
      expect(load("[".repeat(depth) + "]".repeat(depth))).toEqual(malformed(0));
    });
  });

  describe("valid entries", () => {
    it("materializes the default failure mode", () => {
      const result = loadOk(envelope(`"${A}":${minimalPolicy}`));

      expect(result.sentinels).toEqual([]);
      expect(result.policySet.entries).toEqual([
        {
          collectionId: A,
          status: "valid",
          policySchemaVersion: 1,
          policyFingerprint: fingerprintOf(
            '{"activation":"read_only","rules":[{"kind":"internal_links"}],"runtimeFailureMode":"closed","schemaVersion":1}'
          ),
          policy: {
            activation: "read_only",
            runtimeFailureMode: "closed",
            rules: [{ kind: "internal_links" }],
          },
        },
      ]);
    });

    it("gives equivalent forms the same fingerprints", () => {
      const forms = [
        envelope(`"${A}":${minimalPolicy}`),
        [
          "{",
          '  "collections": {',
          `    "${A}": {`,
          '      "rules": [ { "kind": "internal_links" } ],',
          '      "runtimeFailureMode": "closed",',
          '      "activation": "read_only"',
          "    }",
          "  },",
          '  "schemaVersion": 1',
          "}",
        ].join("\n"),
        `{"schemaVersion":1,"collections":{"${A}":{"activation":"read\\u005fonly","rules":[{"kind":"internal\\u005Flinks"}]}}}`,
      ];
      forms.push(forms[1].replace(/\n/g, "\r\n"));
      const results = forms.map((form) => loadOk(form).policySet);

      for (const policySet of results) {
        expect(policySet).toEqual(results[0]);
      }
    });

    it("loads every rule kind with its parameters", () => {
      const rules = [
        { kind: "required_sections", headingLevel: 2, headings: ["Overview"] },
        { kind: "section_order", headingLevel: 2, headings: ["One", "Two"] },
        { kind: "allowed_heading_levels", levels: [2, 3] },
        {
          kind: "required_metadata_fields",
          metadataSection: { heading: "Metadata", headingLevel: 2 },
          fields: ["Status"],
        },
        {
          kind: "metadata_field_formats",
          metadataSection: { heading: "Metadata", headingLevel: 2 },
          fields: [
            { name: "Reviewed", format: "iso_date" },
            { name: "Status", format: "one_of", values: ["Draft", "Final"] },
          ],
        },
        { kind: "unsupported_markdown_structures", structures: ["table"] },
        { kind: "discouraged_markdown_structures", structures: ["notice"] },
        { kind: "internal_links" },
        { kind: "parent_document_resolved" },
        { kind: "hierarchy_acyclic" },
        { kind: "published_documents_in_structure" },
        { kind: "parent_collection_consistent" },
        {
          kind: "global_index_links",
          surfaceDocumentId: B,
          globalIndexDocumentIds: [C],
        },
      ];
      const policy = {
        activation: "enforced",
        runtimeFailureMode: "open",
        rules,
      };
      const result = loadOk(envelope(`"${A}":${JSON.stringify(policy)}`));

      expect(result.policySet.entries).toEqual([
        expect.objectContaining({ status: "valid", policy }),
      ]);
    });

    it("decodes multi-byte characters in parameters", () => {
      const heading = "Overview \u2013 Details";
      const result = loadOk(
        envelope(
          `"${A}":{"activation":"read_only","rules":[{"kind":"required_sections","headingLevel":2,"headings":["${heading}"]}]}`
        )
      );

      expect(result.policySet.entries).toEqual([
        expect.objectContaining({
          status: "valid",
          policy: expect.objectContaining({
            rules: [expect.objectContaining({ headings: [heading] })],
          }),
        }),
      ]);
    });
  });

  describe("invalid entries", () => {
    it.each([
      ["an unknown severity", '"severity":"warning"'],
      ["an unknown code", '"code":"X"'],
      ["an unknown pattern", '"pattern":"^x$"'],
    ])("rejects %s field", (_name, member) => {
      expect(
        sentinelOf(
          `{"activation":"read_only","rules":[{"kind":"internal_links"}],${member}}`
        ).path
      ).toBe(`/collections/${A}`);
    });

    it.each([
      [
        "a nested duplicate key",
        '{"activation":"read_only","rules":[{"kind":"internal_links","kind":"internal_links"}]}',
        "/rules/0",
      ],
      [
        "an unpaired surrogate in a string",
        '{"activation":"read_only","rules":[{"kind":"required_sections","headingLevel":2,"headings":["\\ud800"]}]}',
        "/rules/0/headings/0",
      ],
      [
        "an unpaired surrogate in a key",
        '{"activation":"read_only","rules":[{"kind":"internal_links","\\udc00":1}]}',
        "/rules/0",
      ],
      [
        "a fractional integer",
        '{"activation":"read_only","rules":[{"kind":"allowed_heading_levels","levels":[1.0]}]}',
        "/rules/0/levels/0",
      ],
      [
        "an exponent",
        '{"activation":"read_only","rules":[{"kind":"allowed_heading_levels","levels":[1e0]}]}',
        "/rules/0/levels/0",
      ],
      [
        "negative zero",
        '{"activation":"read_only","rules":[{"kind":"allowed_heading_levels","levels":[-0]}]}',
        "/rules/0/levels/0",
      ],
      [
        "an unsafe integer",
        '{"activation":"read_only","rules":[{"kind":"allowed_heading_levels","levels":[9007199254740992]}]}',
        "/rules/0/levels/0",
      ],
      [
        "duplicate rule kinds",
        '{"activation":"read_only","rules":[{"kind":"internal_links"},{"kind":"hierarchy_acyclic"},{"kind":"internal_links"}]}',
        "/rules/2/kind",
      ],
      ["empty rules", '{"activation":"read_only","rules":[]}', "/rules"],
      [
        "a bad activation",
        '{"activation":"enabled","rules":[{"kind":"internal_links"}]}',
        "/activation",
      ],
      [
        "a bad failure mode",
        '{"activation":"read_only","runtimeFailureMode":null,"rules":[{"kind":"internal_links"}]}',
        "/runtimeFailureMode",
      ],
      [
        "an unknown rule kind",
        '{"activation":"read_only","rules":[{"kind":"custom_regex"}]}',
        "/rules/0/kind",
      ],
      [
        "a missing rule kind",
        '{"activation":"read_only","rules":[{"levels":[2]}]}',
        "/rules/0/kind",
      ],
      [
        "a missing member",
        '{"rules":[{"kind":"internal_links"}]}',
        "/activation",
      ],
      [
        "an own __proto__ entry key",
        '{"activation":"read_only","rules":[{"kind":"internal_links"}],"__proto__":1}',
        "",
      ],
      [
        "an own __proto__ rule key",
        '{"activation":"read_only","rules":[{"kind":"internal_links","__proto__":null}]}',
        "/rules/0",
      ],
      ["a non-object entry", '"read_only"', ""],
      ["a null entry", "null", ""],
      ["an array entry", "[]", ""],
    ])("rejects %s", (_name, value, pointer) => {
      expect(sentinelOf(value)).toEqual({
        collectionId: A,
        code: "POLICY_CONFIGURATION_INVALID",
        path: `/collections/${A}${pointer}`,
        invalidFingerprint: fingerprintOf(value),
      });
    });

    it("picks the bytewise-lower pointer when defects share an offset", () => {
      expect(sentinelOf("{}").path).toBe(`/collections/${A}/activation`);
      // Zod reports metadataSection first; the bytewise-lower pointer wins.
      expect(
        sentinelOf(
          '{"activation":"read_only","rules":[{"kind":"required_metadata_fields"}]}'
        ).path
      ).toBe(`/collections/${A}/rules/0/fields`);
    });

    it("picks the lowest-offset defect", () => {
      expect(
        sentinelOf(
          '{"rules":[{"kind":"internal_links","x":1}],"activation":"no","runtimeFailureMode":"closed","runtimeFailureMode":"closed"}'
        ).path
      ).toBe(`/collections/${A}/rules/0`);
    });

    it.each([
      [
        '{"activation":"read_only","rules":[{"kind":"internal_links"}],"PLANTED_KEY":{"PLANTED_INNER":[1.5]}}',
        "",
      ],
      [
        '{"activation":"read_only","rules":[{"PLANTED":{"x":1.5},"kind":"bogus"}]}',
        "/rules/0",
      ],
    ])(
      "stops pointers before keys outside the schema vocabulary in %s",
      (value, pointer) => {
        const result = loadOk(envelope(`"${A}":${value}`));

        expect(result.sentinels[0].path).toBe(`/collections/${A}${pointer}`);
        expect(JSON.stringify(result)).not.toContain("PLANTED");
      }
    );

    it("hashes the exact value bytes of an invalid entry", () => {
      const value = '{\n  "activation": "read_only",\n  "rules": []\n}';
      const lf = loadOk(envelope(`"${A}":  ${value}  `));
      const crlf = loadOk(
        envelope(`"${A}":  ${value.replace(/\n/g, "\r\n")}  `)
      );

      expect(lf.policySet.entries).toEqual([
        {
          collectionId: A,
          status: "invalid",
          invalidFingerprint: fingerprintOf(value),
        },
      ]);
      expect(crlf.sentinels[0].invalidFingerprint).not.toBe(
        lf.sentinels[0].invalidFingerprint
      );
    });

    it("rejects 32,000 levels of nesting inside an entry without a crash", () => {
      const prefix = envelope(`"${A}":`).slice(0, -2);
      const depth = Math.floor(
        (POLICY_CONFIG_MAX_BYTES - prefix.length - 2) / 2
      );
      const text = `${prefix}${"[".repeat(depth)}${"]".repeat(depth)}}}`;

      expect(depth).toBeGreaterThan(32000);
      expect(sentinelOf(text.slice(prefix.length, -2)).path).toBe(
        `/collections/${A}`
      );
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(65536);
      expect(loadOk(text).policySet.entries).toHaveLength(1);
    });
  });

  describe("policy set identity", () => {
    const valid = minimalPolicy;
    const invalid = '{"activation":"read_only","rules":[],"severity":"x"}';
    const enforced =
      '{"activation":"enforced","runtimeFailureMode":"open","rules":[{"kind":"hierarchy_acyclic"}]}';

    it("isolates an invalid entry between valid ones", () => {
      const result = loadOk(
        envelope(`"${C}":${enforced},"${B}":${invalid},"${A}":${valid}`)
      );
      const validFingerprint = fingerprintOf(
        '{"activation":"read_only","rules":[{"kind":"internal_links"}],"runtimeFailureMode":"closed","schemaVersion":1}'
      );
      const enforcedFingerprint = fingerprintOf(
        '{"activation":"enforced","rules":[{"kind":"hierarchy_acyclic"}],"runtimeFailureMode":"open","schemaVersion":1}'
      );
      const invalidFingerprint = fingerprintOf(invalid);

      expect(
        result.policySet.entries.map((entry) => entry.collectionId)
      ).toEqual([A, B, C]);
      expect(result.policySet.entries[1]).toEqual({
        collectionId: B,
        status: "invalid",
        invalidFingerprint,
      });
      expect(result.policySet.entries[2]).toMatchObject({
        status: "valid",
        policyFingerprint: enforcedFingerprint,
        policy: { activation: "enforced", runtimeFailureMode: "open" },
      });
      expect(result.sentinels).toEqual([
        {
          collectionId: B,
          code: "POLICY_CONFIGURATION_INVALID",
          path: `/collections/${B}/rules`,
          invalidFingerprint,
        },
      ]);
      expect(result.policySet.policySetFingerprint).toBe(
        fingerprintOf(
          `{"collections":[{"collectionId":"${A}","policyFingerprint":"${validFingerprint}","status":"valid"},{"collectionId":"${B}","invalidFingerprint":"${invalidFingerprint}","status":"invalid"},{"collectionId":"${C}","policyFingerprint":"${enforcedFingerprint}","status":"valid"}],"schemaVersion":1}`
        )
      );
    });

    it("sorts sentinels by collection", () => {
      const result = loadOk(envelope(`"${B}":${invalid},"${A}":${invalid}`));

      expect(result.sentinels.map((sentinel) => sentinel.collectionId)).toEqual(
        [A, B]
      );
    });

    it("deep-freezes the result", () => {
      const result = loadOk(
        envelope(
          `"${A}":{"activation":"read_only","rules":[{"kind":"allowed_heading_levels","levels":[2]}]},"${B}":${invalid}`
        )
      );
      // The types are readonly; cast them away to prove the runtime freeze.
      const policySet = result.policySet as unknown as {
        policySetFingerprint: string;
        entries: Record<string, unknown>[];
      };
      const entry = policySet.entries[0] as unknown as {
        policy: { activation: string; rules: { levels: number[] }[] };
      };

      expect(() => {
        policySet.policySetFingerprint = "x";
      }).toThrow(TypeError);
      expect(() => policySet.entries.push({})).toThrow(TypeError);
      expect(() => {
        policySet.entries[1].status = "valid";
      }).toThrow(TypeError);
      expect(() => {
        entry.policy.activation = "enforced";
      }).toThrow(TypeError);
      expect(() => entry.policy.rules.pop()).toThrow(TypeError);
      expect(() => {
        entry.policy.rules[0].levels[0] = 1;
      }).toThrow(TypeError);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.sentinels[0])).toBe(true);
    });
  });

  describe("the shipped example", () => {
    const examplePath = path.join(__dirname, "..", "policy.example.json");
    const example = fs.readFileSync(examplePath, "utf8");

    it("is valid with zero sentinels", () => {
      const result = loadOk(example);

      expect(result.sentinels).toEqual([]);
      expect(result.policySet.entries).toHaveLength(1);
      expect(result.policySet.entries[0]).toMatchObject({
        status: "valid",
        policy: { activation: "read_only", runtimeFailureMode: "closed" },
      });
    });

    it("uses only synthetic identifiers and no open failure mode", () => {
      const uuids = example.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
      );

      expect(uuids?.length).toBeGreaterThan(0);
      for (const uuid of uuids ?? []) {
        expect(uuid).toMatch(/^00000000-0000-4000-8000-0000000000\d\d$/);
      }
      expect(example).not.toContain('"open"');
    });
  });
});
