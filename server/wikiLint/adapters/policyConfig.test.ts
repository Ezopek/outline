import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Logger from "@server/logging/Logger";
import {
  getPolicySet,
  initializePolicyConfiguration,
  policySetFromEnvironment,
  readPolicyConfigFile,
} from "./policyConfig";

const EMPTY_FINGERPRINT =
  "sha256:25d4e8ec86646fe465b938d352ab3973a46bef099e8ec712c5535c1a2609ecc2";

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const C = "00000000-0000-4000-8000-000000000003";
const D = "00000000-0000-4000-8000-000000000004";

/** Distinctive text planted in fixtures; it must never reach a log line. */
const PLANTED = "PLANTED_CANARY_7f3a";

const validPolicy =
  '{"activation":"read_only","rules":[{"kind":"internal_links"}]}';

let directory: string;
let fileCount = 0;

/**
 * Writes a temporary policy file.
 *
 * @param contents - the file contents.
 * @returns the file path.
 */
function writePolicyFile(contents: string | Uint8Array): string {
  const filePath = path.join(directory, `policy-${fileCount++}.json`);
  fs.writeFileSync(filePath, contents);
  return filePath;
}

beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-lint-policy-"));
});

afterAll(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

let warn: ReturnType<typeof vi.spyOn>;
let info: ReturnType<typeof vi.spyOn>;
let exit: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(Logger, "warn").mockImplementation(() => undefined);
  info = vi.spyOn(Logger, "info").mockImplementation(() => undefined);
  exit = vi
    .spyOn(process, "exit")
    .mockImplementation((() => undefined) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readPolicyConfigFile", () => {
  it("reads the exact bytes", () => {
    const bytes = Buffer.from([0x7b, 0x0d, 0x0a, 0xff, 0x7d]);

    expect(
      Buffer.from(readPolicyConfigFile(writePolicyFile(bytes)) ?? [])
    ).toEqual(bytes);
  });

  it("returns null for a missing path, a directory, or an oversize file", () => {
    expect(
      readPolicyConfigFile(path.join(directory, "missing.json"))
    ).toBeNull();
    expect(readPolicyConfigFile(directory)).toBeNull();
    expect(readPolicyConfigFile(writePolicyFile(" ".repeat(65537)))).toBeNull();
    expect(
      readPolicyConfigFile(writePolicyFile(" ".repeat(65536)))
    ).toHaveLength(65536);
  });
});

describe("initializePolicyConfiguration", () => {
  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])("loads the empty set when the path is %s", (_name, configPath) => {
    const env: NodeJS.ProcessEnv = { WIKI_LINT_CONFIG_PATH: configPath };
    const openSync = vi.spyOn(fs, "openSync");

    const policySet = initializePolicyConfiguration(env);

    expect(exit).not.toHaveBeenCalled();
    expect(openSync).not.toHaveBeenCalled();
    expect(policySet).toEqual({
      policySetFingerprint: EMPTY_FINGERPRINT,
      entries: [],
    });
    expect(env.WIKI_LINT_CONFIG_BASE64).toBe("");
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      "lifecycle",
      "Wiki lint policy configuration loaded",
      {
        configStatus: "absent",
        readOnlyCount: 0,
        enforcedCount: 0,
        invalidCount: 0,
        policySetFingerprint: EMPTY_FINGERPRINT,
        sentinels: [],
      }
    );
  });

  it("overrides a worker variable inherited from elsewhere when absent", () => {
    const env: NodeJS.ProcessEnv = { WIKI_LINT_CONFIG_BASE64: "e30=" };

    initializePolicyConfiguration(env);

    expect(env.WIKI_LINT_CONFIG_BASE64).toBe("");
  });

  it("gives an empty envelope file the absent fingerprint", () => {
    const contents = '{ "schemaVersion": 1, "collections": {} }';
    const env: NodeJS.ProcessEnv = {
      WIKI_LINT_CONFIG_PATH: writePolicyFile(contents),
    };

    const policySet = initializePolicyConfiguration(env);

    expect(policySet.policySetFingerprint).toBe(EMPTY_FINGERPRINT);
    expect(env.WIKI_LINT_CONFIG_BASE64).toBe(
      Buffer.from(contents).toString("base64")
    );
    expect(info).toHaveBeenCalledWith(
      "lifecycle",
      "Wiki lint policy configuration loaded",
      expect.objectContaining({ configStatus: "loaded", invalidCount: 0 })
    );
  });

  it("accepts a file of exactly 65,536 bytes", () => {
    const contents = `{"schemaVersion":1,"collections":{"${A}":${validPolicy}}}`;
    const env: NodeJS.ProcessEnv = {
      WIKI_LINT_CONFIG_PATH: writePolicyFile(
        contents + "\n".repeat(65536 - contents.length)
      ),
    };

    const policySet = initializePolicyConfiguration(env);

    expect(exit).not.toHaveBeenCalled();
    expect(policySet.entries).toHaveLength(1);
    expect(
      Buffer.from(env.WIKI_LINT_CONFIG_BASE64 ?? "", "base64")
    ).toHaveLength(65536);
  });

  it("logs counts and sentinels for valid, invalid, and valid entries", () => {
    const invalid = `{"activation":"read_only","rules":[{"kind":"required_sections","headingLevel":2,"headings":["${PLANTED}"]}],"severity":"${PLANTED}"}`;
    const enforced =
      '{"activation":"enforced","rules":[{"kind":"hierarchy_acyclic"}]}';
    const env: NodeJS.ProcessEnv = {
      WIKI_LINT_CONFIG_PATH: writePolicyFile(
        `{"schemaVersion":1,"collections":{"${A}":${validPolicy},"${B}":${invalid},"${C}":${enforced},"${D}":${validPolicy}}}`
      ),
    };

    const policySet = initializePolicyConfiguration(env);

    expect(exit).not.toHaveBeenCalled();
    expect(policySet.entries.map((entry) => entry.status)).toEqual([
      "valid",
      "invalid",
      "valid",
      "valid",
    ]);
    expect(policySet.entries[2]).toMatchObject({
      policy: { activation: "enforced", runtimeFailureMode: "closed" },
    });
    const invalidEntry = policySet.entries[1];
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      "lifecycle",
      "Wiki lint policy configuration loaded",
      {
        configStatus: "loaded",
        readOnlyCount: 2,
        enforcedCount: 1,
        invalidCount: 1,
        policySetFingerprint: policySet.policySetFingerprint,
        sentinels: [
          {
            collectionId: B,
            code: "POLICY_CONFIGURATION_INVALID",
            path: `/collections/${B}`,
            invalidFingerprint:
              invalidEntry.status === "invalid"
                ? invalidEntry.invalidFingerprint
                : undefined,
          },
        ],
      }
    );
    expect(JSON.stringify(info.mock.calls)).not.toContain(PLANTED);
    expect(JSON.stringify(policySet)).not.toContain(PLANTED);
  });

  describe("startup-fatal defects", () => {
    const tooLarge = `{"schemaVersion":1,"collections":{"${PLANTED}":{}}}`;

    it.each([
      ["a missing path", () => path.join(directory, `${PLANTED}.json`), "file"],
      ["a directory", () => directory, "file"],
      [
        "an oversize file",
        () => writePolicyFile(tooLarge + " ".repeat(65537 - tooLarge.length)),
        "file",
      ],
      ["an empty file", () => writePolicyFile(""), 0],
      [
        "a byte-order mark",
        () => writePolicyFile(`\ufeff{"schemaVersion":1,"collections":{}}`),
        0,
      ],
      [
        "ill-formed UTF-8",
        () =>
          writePolicyFile(
            Buffer.concat([
              Buffer.from(`{"schemaVersion":1,"collections":{"${PLANTED}`),
              Buffer.from([0xed, 0xa0, 0x80]),
              Buffer.from('":{}}}'),
            ])
          ),
        35 + PLANTED.length,
      ],
      [
        "a grammar violation",
        () =>
          writePolicyFile(
            `{"schemaVersion":1,"collections":{"${PLANTED}":"${PLANTED}",}}`
          ),
        40 + PLANTED.length * 2,
      ],
      [
        "a grammar violation with an unsupported version",
        () => writePolicyFile(`{"schemaVersion":2,"${PLANTED}":`),
        22 + PLANTED.length,
      ],
      ["a non-object root", () => writePolicyFile(`["${PLANTED}"]`), 0],
      [
        "an unknown root key",
        () =>
          writePolicyFile(
            `{"schemaVersion":1,"collections":{},"${PLANTED}":"${PLANTED}"}`
          ),
        36,
      ],
      [
        "an unidentifiable collection key",
        () =>
          writePolicyFile(
            `{"schemaVersion":1,"collections":{"${PLANTED}":${validPolicy}}}`
          ),
        34,
      ],
      [
        "a duplicate collection key",
        () =>
          writePolicyFile(
            `{"schemaVersion":1,"collections":{"${A}":{},"${A}":{}}}`
          ),
        34 + A.length + 6,
      ],
    ])("stops on %s with MALFORMED", (_name, makePath, location) => {
      const env: NodeJS.ProcessEnv = {
        WIKI_LINT_CONFIG_PATH: makePath(),
        WIKI_LINT_CONFIG_BASE64: "previous",
      };

      initializePolicyConfiguration(env);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][1]).toStrictEqual({
        code: "POLICY_CONFIGURATION_MALFORMED",
        location,
      });
      expect(exit).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(1);
      expect(env.WIKI_LINT_CONFIG_BASE64).toBe("previous");
      expect(info).not.toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain(PLANTED);
    });

    it.each([
      [
        "an unsupported version",
        `{"schemaVersion":2,"collections":{"${PLANTED}":"${PLANTED}"}}`,
        17,
      ],
      [
        "an unsupported version after an unknown key",
        `{"${PLANTED}":1,"schemaVersion":"1","collections":{}}`,
        22 + PLANTED.length,
      ],
    ])("stops on %s with UNSUPPORTED", (_name, contents, location) => {
      const env: NodeJS.ProcessEnv = {
        WIKI_LINT_CONFIG_PATH: writePolicyFile(contents),
      };

      initializePolicyConfiguration(env);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][1]).toStrictEqual({
        code: "POLICY_SCHEMA_VERSION_UNSUPPORTED",
        location,
      });
      expect(exit).toHaveBeenCalledWith(1);
      expect(env.WIKI_LINT_CONFIG_BASE64).toBeUndefined();
      expect(JSON.stringify(warn.mock.calls)).not.toContain(PLANTED);
    });

    it("emits the warning before exiting", () => {
      initializePolicyConfiguration({
        WIKI_LINT_CONFIG_PATH: writePolicyFile("{"),
      });

      expect(warn.mock.invocationCallOrder[0]).toBeLessThan(
        exit.mock.invocationCallOrder[0]
      );
    });
  });
});

describe("policySetFromEnvironment", () => {
  it("rebuilds the master's set without reading any file", () => {
    const configPath = writePolicyFile(
      `{\r\n"schemaVersion":1,"collections":{"${A}":${validPolicy},"${B}":{}}}`
    );
    const masterEnv: NodeJS.ProcessEnv = { WIKI_LINT_CONFIG_PATH: configPath };
    const openSync = vi.spyOn(fs, "openSync");
    const readFileSync = vi.spyOn(fs, "readFileSync");
    const masterSet = initializePolicyConfiguration(masterEnv);
    // The spy observes the adapter's reads: the master opened the file once.
    expect(openSync).toHaveBeenCalledTimes(1);
    expect(openSync).toHaveBeenCalledWith(configPath, "r");
    fs.writeFileSync(configPath, '{"schemaVersion":1,"collections":{}}');
    const otherPath = writePolicyFile('{"schemaVersion":1,"collections":{}}');
    openSync.mockClear();
    readFileSync.mockClear();

    const workerSet = policySetFromEnvironment({
      ...masterEnv,
      WIKI_LINT_CONFIG_PATH: otherPath,
    });

    expect(workerSet).toEqual(masterSet);
    expect(workerSet.entries).toHaveLength(2);
    expect(openSync).not.toHaveBeenCalled();
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])("gives the empty set when the bytes are %s", (_name, encoded) => {
    expect(
      policySetFromEnvironment({ WIKI_LINT_CONFIG_BASE64: encoded })
    ).toEqual({ policySetFingerprint: EMPTY_FINGERPRINT, entries: [] });
  });

  it("throws a fixed error when the bytes do not load", () => {
    const encoded = Buffer.from(`{"${PLANTED}":`).toString("base64");

    expect(() =>
      policySetFromEnvironment({ WIKI_LINT_CONFIG_BASE64: encoded })
    ).toThrow(
      new Error("The wiki lint policy configuration could not be loaded")
    );
  });
});

describe("getPolicySet", () => {
  it("builds one frozen set and ignores later environment changes", () => {
    const previous = process.env.WIKI_LINT_CONFIG_BASE64;
    process.env.WIKI_LINT_CONFIG_BASE64 = Buffer.from(
      `{"schemaVersion":1,"collections":{"${A}":${validPolicy}}}`
    ).toString("base64");
    try {
      const policySet = getPolicySet();
      process.env.WIKI_LINT_CONFIG_BASE64 = "";

      expect(getPolicySet()).toBe(policySet);
      expect(policySet.entries).toHaveLength(1);
      const entry = policySet.entries[0] as unknown as {
        policy: { rules: { kind: string }[] };
      };
      expect(() => {
        entry.policy.rules[0].kind = "hierarchy_acyclic";
      }).toThrow(TypeError);
      expect(() => {
        (policySet.entries as unknown[]).length = 0;
      }).toThrow(TypeError);
    } finally {
      if (previous === undefined) {
        delete process.env.WIKI_LINT_CONFIG_BASE64;
      } else {
        process.env.WIKI_LINT_CONFIG_BASE64 = previous;
      }
    }
  });
});
