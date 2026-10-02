import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Logger from "@server/logging/Logger";
import { checkPendingMigrations } from "./utils/startup";

const captured = vi.hoisted(() => ({
  master: undefined as (() => Promise<void>) | undefined,
}));

vi.mock("throng", () => ({
  default: (options: { master: () => Promise<void> }) => {
    captured.master = options.master;
    return Promise.resolve();
  },
}));

vi.mock("./utils/startup", () => ({
  checkPendingMigrations: vi.fn(() => Promise.resolve()),
  printEnv: vi.fn(() => Promise.resolve()),
  configureChildHeapLimit: vi.fn(),
}));

/** Thrown by the mocked `process.exit` so that `master()` stops there. */
const exitSentinel = new Error("process.exit");

let directory: string;
let previousEnv: Record<string, string | undefined>;
let info: ReturnType<typeof vi.spyOn>;
let exit: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-lint-startup-"));
  await import("./index");
});

afterAll(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

beforeEach(() => {
  previousEnv = {
    WIKI_LINT_CONFIG_PATH: process.env.WIKI_LINT_CONFIG_PATH,
    WIKI_LINT_CONFIG_BASE64: process.env.WIKI_LINT_CONFIG_BASE64,
  };
  vi.clearAllMocks();
  vi.spyOn(Logger, "warn").mockImplementation(() => undefined);
  info = vi.spyOn(Logger, "info").mockImplementation(() => undefined);
  exit = vi.spyOn(process, "exit").mockImplementation(() => {
    throw exitSentinel;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("master", () => {
  it("stops on a malformed policy before the migration check", async () => {
    const configPath = path.join(directory, "malformed.json");
    fs.writeFileSync(configPath, '{"schemaVersion":1,');
    process.env.WIKI_LINT_CONFIG_PATH = configPath;

    await expect(captured.master?.()).rejects.toBe(exitSentinel);

    expect(exit).toHaveBeenCalledWith(1);
    expect(checkPendingMigrations).not.toHaveBeenCalled();
  });

  it("exports the policy bytes before the migration check", async () => {
    const bytes = Buffer.from(
      '{\r\n"schemaVersion":1,"collections":{"00000000-0000-4000-8000-000000000001":{"activation":"read_only","rules":[{"kind":"internal_links"}]}}}\r\n'
    );
    const configPath = path.join(directory, "valid.json");
    fs.writeFileSync(configPath, bytes);
    process.env.WIKI_LINT_CONFIG_PATH = configPath;
    delete process.env.WIKI_LINT_CONFIG_BASE64;

    await captured.master?.();

    expect(exit).not.toHaveBeenCalled();
    expect(process.env.WIKI_LINT_CONFIG_BASE64).toBe(bytes.toString("base64"));
    const loaded = info.mock.calls.findIndex(
      (call: unknown[]) => call[1] === "Wiki lint policy configuration loaded"
    );
    expect(loaded).toBeGreaterThanOrEqual(0);
    expect(vi.mocked(checkPendingMigrations)).toHaveBeenCalledTimes(1);
    expect(info.mock.invocationCallOrder[loaded]).toBeLessThan(
      vi.mocked(checkPendingMigrations).mock.invocationCallOrder[0]
    );
  });
});
