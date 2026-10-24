import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../..");

/** The Gate 1 suite roots, walked recursively. */
const suiteRoots = ["server/wikiLint", "server/routes/mcp", "server/tools"];

/** The Gate 1 tests outside the suite roots. */
const namedTests = [
  "server/queues/tasks/EnforcedDocumentImportTask.test.ts",
  "server/queues/queue.test.ts",
  "server/services/worker.test.ts",
  "server/routes/api/events/events.test.ts",
  "shared/editor/nodes/urlSanitization.test.ts",
  "shared/utils/urls.test.ts",
  "server/index.test.ts",
  "server/models/helpers/DocumentHelper.test.ts",
];

/** Path segments that would form a separate test tree. */
const testDirectoryNames = new Set(["__tests__", "test", "tests"]);

/**
 * Gate 1 tests without a sibling source named by their first dotted segment,
 * each mapped to the path it covers.
 */
const allowlist: Record<string, string> = {
  "server/routes/mcp/audit.test.ts": "server/routes/mcp/index.ts",
  "server/routes/mcp/wikiLint.test.ts": "server/routes/mcp/index.ts",
  "server/routes/mcp/requestTimeout.test.ts": "server/routes/mcp/index.ts",
  "server/wikiLint/core/boundary.test.ts": "server/wikiLint/core/",
  "server/wikiLint/benchmark/smokeRun.test.ts":
    "server/wikiLint/benchmark/harness.ts",
  "server/wikiLint/benchmark/gate1EvidenceIndex.test.ts":
    "docs/wikilint-gate-1/evidence-index.md",
  "shared/editor/nodes/urlSanitization.test.ts": "shared/editor/nodes/index.ts",
  "server/wikiLint/layout.test.ts": "server/wikiLint/",
};

/** The one Gate 1 test allowed a skip-style call: a benchmark helper. */
const smokeRun = "server/wikiLint/benchmark/smokeRun.test.ts";

/** This file, exempt only between its exemption markers. */
const self = "server/wikiLint/layout.test.ts";
const exemptBegin = "// layout-exempt:" + "begin";
const exemptEnd = "// layout-exempt:" + "end";

// layout-exempt:begin
/** Call sites that would let a suite pass without running a check. */
const disablingCallPatterns = [
  /\b(it|test|describe)(\.\w+)*\.(skip|only|todo|skipIf|runIf)\s*\(/g,
  /\b(it|test)(\.\w+)*\.fails\s*\(/g,
  /\bx(it|test|describe)\s*\(/g,
];

const smokeRunCalls = ["describe.runIf("];

const matchingCalls = [
  'it.skip("x", () => {});',
  'describe.only("x", () => {});',
  'test.todo("x");',
  'it.skipIf(x)("x", () => {});',
  'describe.runIf(x)("x", () => {});',
  'it.fails("x", () => {});',
  'test.concurrent.fails("x", () => {});',
  'xit("x", () => {});',
  'xtest("x", () => {});',
  'xdescribe("x", () => {});',
];

const nonMatchingText = [
  'it("skip this", () => {});',
  "const skipped = 1;",
  "if (shouldSkip(x)) {}",
  "// skip",
];
// layout-exempt:end

/**
 * Finds the disabling call sites in a test source.
 *
 * @param source - the test source.
 * @returns the matched call sites, in order of pattern and position.
 */
function disablingCalls(source: string): string[] {
  return disablingCallPatterns.flatMap((pattern) =>
    Array.from(source.matchAll(pattern), (match) => match[0])
  );
}

/**
 * Removes the exempt regions of this file.
 *
 * @param source - the source of this file.
 * @returns the source without its pattern literals and matcher table.
 */
function withoutExemptRegions(source: string): string {
  const parts = source.split(exemptBegin);
  return [
    parts[0],
    ...parts.slice(1).map((part) => {
      const end = part.indexOf(exemptEnd);
      return end === -1 ? part : part.slice(end + exemptEnd.length);
    }),
  ].join("");
}

/**
 * Lists the test files below a directory, relative to the repository root.
 *
 * @param dir - the directory, relative to the repository root.
 * @returns the test paths with `/` separators.
 */
function testsUnder(dir: string): string[] {
  return fs
    .readdirSync(path.join(repoRoot, dir), {
      recursive: true,
      withFileTypes: true,
    })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
    .map((entry) =>
      path
        .relative(repoRoot, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join("/")
    );
}

const gate1Tests = [...suiteRoots.flatMap(testsUnder), ...namedTests].sort();

/**
 * Reads a Gate 1 test source.
 *
 * @param file - the path relative to the repository root.
 * @returns the source.
 */
const read = (file: string) =>
  fs.readFileSync(path.join(repoRoot, file), "utf8");

describe("Gate 1 test layout", () => {
  it("finds the suite-root tests and every named test", () => {
    expect(gate1Tests).toEqual(expect.arrayContaining(Object.keys(allowlist)));
    expect(
      namedTests.filter((file) => !fs.existsSync(path.join(repoRoot, file)))
    ).toEqual([]);
    expect(gate1Tests.length).toBeGreaterThan(namedTests.length);
  });

  it("has no test under a separate test directory", () => {
    const misplaced = gate1Tests.filter((file) =>
      file.split("/").some((segment) => testDirectoryNames.has(segment))
    );

    expect(misplaced).toEqual([]);
  });

  it("keeps every test beside the source it covers", () => {
    const unpaired = gate1Tests.filter((file) => {
      const covered = allowlist[file];
      if (covered !== undefined) {
        return !fs.existsSync(path.join(repoRoot, covered));
      }
      const base = path.posix.basename(file).split(".")[0];
      const dir = path.posix.dirname(file);
      return ![".ts", ".tsx"].some((extension) =>
        fs.existsSync(path.join(repoRoot, dir, `${base}${extension}`))
      );
    });

    expect(unpaired).toEqual([]);
  });

  it("disables no Gate 1 test", () => {
    const disabled = gate1Tests
      .filter((file) => file !== smokeRun)
      .flatMap((file) => {
        const source =
          file === self ? withoutExemptRegions(read(file)) : read(file);
        return disablingCalls(source).map((call) => `${file}: ${call}`);
      });

    expect(disabled).toEqual([]);
  });

  it("allows the benchmark helper only its one runIf", () => {
    expect(disablingCalls(read(smokeRun))).toEqual(smokeRunCalls);
  });

  it("exempts only the marked region of this file", () => {
    const source = read(self);

    expect(source.split(exemptBegin)).toHaveLength(2);
    expect(source.split(exemptEnd)).toHaveLength(2);
    expect(disablingCalls(source).length).toBeGreaterThan(0);
  });

  it.each(matchingCalls)("matches the call site %s", (call) => {
    expect(disablingCalls(call)).toHaveLength(1);
  });

  it.each(nonMatchingText)("does not match %s", (text) => {
    expect(disablingCalls(text)).toEqual([]);
  });
});
