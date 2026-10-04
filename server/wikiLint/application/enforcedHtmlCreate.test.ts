import { createHash, randomUUID } from "node:crypto";
import { QueryTypes } from "sequelize";
import { createContext } from "@server/context";
import type { User } from "@server/models";
import EnforcedDocumentImportTask from "@server/queues/tasks/EnforcedDocumentImportTask";
import { sequelize } from "@server/storage/database";
import FileStorage from "@server/storage/files";
import {
  buildCollection,
  buildDocument,
  buildUser,
} from "@server/test/factories";
import { AuthenticationType } from "@server/types";
import type * as PolicyConfig from "../adapters/policyConfig";
import type { AuditDataV1 } from "../adapters/auditEvents";
import { insertAuditEvent } from "../adapters/auditEvents";
import type { PolicySet } from "../core/policySet";
import { buildPolicySet } from "../core/policySet";
import { OPERATION_FAILED } from "../core/registry";
import type * as DeadlineModule from "./deadline";
import {
  COMMIT_PROBE_BOUND_MS,
  ENFORCED_IMPORT_GRACE_MS,
  ENFORCED_IMPORT_WAIT_MS,
  POST_COMMIT_ASSEMBLY_BOUND_MS,
  WRITE_PREPARATION_BOUND_MS,
} from "./deadline";
import type { EnforcedImportIntent } from "./enforcedImport";
import { runEnforcedImport } from "./enforcedImport";
import type {
  EnforcedHtmlOutcome,
  EnforcedImportScheduler,
} from "./enforcedHtmlCreate";
import { enforceHtmlCreate } from "./enforcedHtmlCreate";
import type { EnforcedClassification } from "./enforcedWrite";
import { ENFORCED_PRE_WRITE_BOUND_MS } from "./writeClassification";

/** What the replaced seams serve; reset after each test. */
const state = vi.hoisted(() => ({
  policySet: undefined as PolicySet | undefined,
  /** Added to the real monotonic clock. */
  offset: 0,
}));

vi.mock("@server/wikiLint/adapters/policyConfig", async (importOriginal) => {
  const actual = await importOriginal<typeof PolicyConfig>();
  return {
    ...actual,
    getPolicySet: () => state.policySet ?? actual.getPolicySet(),
  };
});

vi.mock("@server/wikiLint/application/deadline", async (importOriginal) => {
  const actual = await importOriginal<typeof DeadlineModule>();
  return {
    ...actual,
    monotonicClock: () => actual.monotonicClock() + state.offset,
  };
});

const sha256Hex = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const REQUIRED = {
  kind: "required_sections",
  headingLevel: 2,
  headings: ["Overview"],
};

const VALID_HTML = "<h1>T</h1><h2>Overview</h2><p>ok</p>";

const INVALID_HTML = "<p>Text without the required section</p>";

/** A job whose result never arrives. */
const pendingJob = () => ({ finished: () => new Promise<never>(() => {}) });

/**
 * Builds an actor, an enforced collection, and its classification.
 *
 * @param options.readable - whether the actor can read the collection.
 * @returns the fixture.
 */
async function fixture(options: { readable?: boolean } = {}) {
  const user = await buildUser();
  const collection = await buildCollection({
    teamId: user.teamId,
    userId: user.id,
  });
  const result = buildPolicySet(
    Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        collections: {
          [collection.id]: { activation: "enforced", rules: [REQUIRED] },
        },
      }),
      "utf8"
    ),
    sha256Hex
  );
  const entry = result.ok ? result.policySet.entries[0] : undefined;
  if (!result.ok || entry?.status !== "valid") {
    throw new Error("The test policy must be valid");
  }
  state.policySet = result.policySet;
  const classification: EnforcedClassification = Object.freeze({
    kind: "enforced" as const,
    entry,
    readable: options.readable ?? true,
    documentId: randomUUID(),
  });
  return { user, collection, classification };
}

/** The `/mcp`-filled extra of an OAuth request. */
const extraOf = (overrides: Record<string, unknown> = {}) => ({
  requestId: randomUUID(),
  ip: "127.0.0.1",
  credentialAuthType: "oauth",
  authenticatedClientId: "client-k",
  token: "secret-token",
  ...overrides,
});

/**
 * Runs an enforced HTML create request.
 *
 * @param input.user - the actor.
 * @param input.classification - the classification.
 * @param input.html - the source.
 * @param input.schedule - schedules the job; runs the worker by default.
 * @param input.extra - the `/mcp`-filled extra.
 * @param input.signal - the cancellation signal.
 * @param input.write - the audit writer.
 * @returns the outcome and the scheduled intents.
 */
async function request(input: {
  user: User;
  classification: EnforcedClassification;
  html?: string;
  schedule?: EnforcedImportScheduler;
  extra?: Record<string, unknown>;
  signal?: AbortSignal;
  write?: typeof insertAuditEvent;
}) {
  const intents: EnforcedImportIntent[] = [];
  const schedule = vi.fn<EnforcedImportScheduler>((intent) => {
    intents.push(intent);
    return input.schedule
      ? input.schedule(intent)
      : Promise.resolve({ finished: () => runEnforcedImport(intent) });
  });
  const outcome = await enforceHtmlCreate({
    ctx: createContext({
      user: input.user,
      authType: AuthenticationType.MCP,
      ip: "127.0.0.1",
    }),
    classification: input.classification,
    input: { text: input.html ?? VALID_HTML, publish: true },
    extra: input.extra ?? extraOf(),
    enteredAt: performance.now() + state.offset,
    enteredAtEpochMs: Date.now(),
    signal: input.signal,
    schedule,
    write: input.write,
  });
  return { outcome, intents, schedule };
}

/**
 * Reads the stored write summary of an invocation.
 *
 * @param invocationId - the invocation.
 * @returns the rows.
 */
const summaries = (invocationId: string) =>
  sequelize.query<{ documentId: string | null; data: AuditDataV1 }>(
    `SELECT * FROM events WHERE id = :id`,
    { replacements: { id: invocationId }, type: QueryTypes.SELECT }
  );

/**
 * Expects a no-result outcome: row 7, no requester summary, source left.
 *
 * @param result - the request's result.
 * @param write - the audit writer spy.
 */
async function expectNoResult(
  result: Awaited<ReturnType<typeof request>>,
  write: ReturnType<typeof vi.fn>
) {
  expect(result.outcome).toEqual({ row: 7 });
  expect(write).not.toHaveBeenCalled();
  const [intent] = result.intents;
  expect(await summaries(intent.invocationId)).toEqual([]);
  await expect(FileStorage.getFileExists(intent.key)).resolves.toBe(true);
}

/**
 * Stores a write summary of an invocation.
 *
 * @param intent - the intent.
 * @param user - the actor.
 * @param overrides - the data fields to replace.
 */
const storeSummary = (
  intent: EnforcedImportIntent,
  user: User,
  overrides: Partial<AuditDataV1>
) =>
  insertAuditEvent(
    {
      id: intent.invocationId,
      name: "wikiLint.write_validation",
      teamId: user.teamId,
      actorId: user.id,
      ip: null,
      collectionId: intent.collectionId,
      data: {
        schemaVersion: 1,
        requestId: intent.requestId,
        operation: "create_document",
        outcome: "validated",
        complete: true,
        durationMs: 1,
        scopeKind: "collection",
        policySchemaVersion: 1,
        policyFingerprint: intent.expectedPolicyFingerprint,
        evaluatedDocumentCount: 1,
        evaluatedLinkCount: 0,
        counts: { errors: 0, warnings: 0, systemFailures: 0, byCode: {} },
        runtimeFailOpenExercised: false,
        credentialAuthType: "api",
        ...overrides,
      },
    },
    3000
  );

afterEach(() => {
  state.policySet = undefined;
  state.offset = 0;
  vi.restoreAllMocks();
});

describe("AD-11 bounds of an HTML create", () => {
  it("keeps the code-owned bounds and the requester tail within 62 seconds", () => {
    expect(ENFORCED_IMPORT_GRACE_MS).toBe(5000);
    expect(ENFORCED_IMPORT_WAIT_MS).toBe(56000);
    expect(
      ENFORCED_PRE_WRITE_BOUND_MS +
        ENFORCED_IMPORT_WAIT_MS +
        COMMIT_PROBE_BOUND_MS +
        POST_COMMIT_ASSEMBLY_BOUND_MS
    ).toBeLessThanOrEqual(62000);
  });

  it("answers within the probe and assembly bounds once its wait expired", async () => {
    const { user, classification } = await fixture();
    let expiredAt = 0;

    const result = await request({
      user,
      classification,
      schedule: () => {
        // Leave 20 ms of the wait.
        state.offset += ENFORCED_IMPORT_WAIT_MS - 20;
        expiredAt = performance.now() + 20;
        return Promise.resolve(pendingJob());
      },
    });

    expect(result.outcome).toEqual({ row: 7 });
    expect(performance.now() - expiredAt).toBeLessThan(
      COMMIT_PROBE_BOUND_MS + POST_COMMIT_ASSEMBLY_BOUND_MS + 1000
    );
  });
});

describe("the scheduled intent", () => {
  it("carries exactly the trusted fields and no credential", async () => {
    const { user, collection, classification } = await fixture({
      readable: false,
    });
    const extra = extraOf();
    const enteredAtEpochMs = Date.now();
    const intents: EnforcedImportIntent[] = [];

    const cancelled = await enforceHtmlCreate({
      ctx: createContext({ user, authType: AuthenticationType.MCP }),
      classification,
      input: {
        title: "Title",
        text: VALID_HTML,
        icon: "😀",
        color: "#FF0000",
        fullWidth: true,
        publish: false,
        parentDocumentId: "parent-ref",
        sourceFileName: "notes.html",
      },
      extra,
      enteredAt: performance.now(),
      enteredAtEpochMs,
      schedule: (intent) => {
        intents.push(intent);
        return Promise.resolve(pendingJob());
      },
      signal: AbortSignal.abort(),
    });
    // The signal was aborted before scheduling: nothing was scheduled.
    expect(cancelled).toEqual({ row: 3, message: OPERATION_FAILED });
    expect(intents).toEqual([]);

    const result = await enforceHtmlCreate({
      ctx: createContext({ user, authType: AuthenticationType.MCP }),
      classification,
      input: {
        title: "Title",
        text: VALID_HTML,
        icon: "😀",
        color: "#FF0000",
        fullWidth: true,
        publish: false,
        parentDocumentId: "parent-ref",
        sourceFileName: "notes.html",
      },
      extra,
      enteredAt: performance.now(),
      enteredAtEpochMs,
      schedule: (intent) => {
        intents.push(intent);
        return Promise.reject(new Error("queue down"));
      },
    });

    expect(result).toEqual({ row: 7 });
    const [intent] = intents;
    expect(intent).toEqual({
      requestId: extra.requestId,
      invocationId: expect.any(String),
      actorId: user.id,
      sourceIp: "127.0.0.1",
      documentId: classification.documentId,
      expectedPolicyFingerprint: classification.entry.policyFingerprint,
      readable: false,
      handlerEnteredAtEpochMs: enteredAtEpochMs,
      classifiedAtEpochMs: expect.any(Number),
      deadlineAt: intent.classifiedAtEpochMs + ENFORCED_IMPORT_WAIT_MS,
      authEnvelope: {
        credentialAuthType: "oauth",
        authenticatedClientId: "client-k",
      },
      key: `uploads/${user.id}/${intent.invocationId}/source.html`,
      sourceMetadata: { fileName: "notes.html", mimeType: "text/html" },
      title: "Title",
      icon: "😀",
      color: "#FF0000",
      fullWidth: true,
      publish: false,
      collectionId: collection.id,
      parentDocumentId: "parent-ref",
    });
    expect(JSON.stringify(intent)).not.toContain("secret-token");
    await expect(FileStorage.getFileBuffer(intent.key)).resolves.toEqual(
      Buffer.from(VALID_HTML, "utf8")
    );
  });

  it("omits the optional inputs the client did not give and carries an API envelope", async () => {
    const { user, classification } = await fixture();
    const result = await request({
      user,
      classification,
      extra: extraOf({ credentialAuthType: "api", ip: undefined }),
      schedule: () => Promise.reject(new Error("queue down")),
    });

    const [intent] = result.intents;
    expect(Object.keys(intent).sort()).toEqual(
      [
        "requestId",
        "invocationId",
        "actorId",
        "sourceIp",
        "documentId",
        "expectedPolicyFingerprint",
        "readable",
        "handlerEnteredAtEpochMs",
        "classifiedAtEpochMs",
        "deadlineAt",
        "authEnvelope",
        "key",
        "sourceMetadata",
        "publish",
        "collectionId",
      ].sort()
    );
    expect(intent.authEnvelope).toEqual({ credentialAuthType: "api" });
    expect(intent.sourceIp).toBeNull();
    expect(intent.sourceMetadata.fileName).toBe("document.html");
  });
});

describe("worker results", () => {
  it("returns row 6 for a committed job, through the registered task", async () => {
    const { user, classification } = await fixture();

    const result = await request({
      user,
      classification,
      schedule: (intent) => new EnforcedDocumentImportTask().schedule(intent),
    });

    const outcome = result.outcome as Extract<EnforcedHtmlOutcome, { row: 6 }>;
    expect(outcome).toMatchObject({
      row: 6,
      documentId: classification.documentId,
      validation: { status: "validated" },
    });
    expect(outcome.assembly.remainingMs()).toBeGreaterThan(0);
    await expect(
      FileStorage.getFileExists(result.intents[0].key)
    ).resolves.toBe(false);
  });

  it("returns row 4 for a rejected job", async () => {
    const { user, classification } = await fixture();

    const { outcome } = await request({
      user,
      classification,
      html: INVALID_HTML,
    });

    expect(outcome).toMatchObject({
      row: 4,
      validation: {
        status: "rejected",
        errors: [{ code: "REQUIRED_SECTION_MISSING" }],
      },
    });
  });

  it.each([
    ["conflict", { kind: "conflict" }, { row: 2 }],
    [
      "aborted before the decision",
      { kind: "aborted", row: 3, message: "Authorization error" },
      { row: 3, message: "Authorization error" },
    ],
    [
      "aborted after the decision",
      { kind: "aborted", row: 5, message: OPERATION_FAILED },
      { row: 5, message: OPERATION_FAILED },
    ],
  ])("maps a %s result without a found row", async (_name, value, row) => {
    const { user, classification } = await fixture();
    const write = vi.fn(insertAuditEvent);

    const { outcome } = await request({
      user,
      classification,
      write,
      schedule: () =>
        Promise.resolve({ finished: () => Promise.resolve(value) }),
    });

    expect(outcome).toEqual(row);
    expect(write).not.toHaveBeenCalled();
  });
});

describe("requester row 3", () => {
  it("ends in row 3 when staging fails, deleting its key and recording its summary", async () => {
    const { user, collection, classification } = await fixture();
    vi.spyOn(FileStorage, "store").mockRejectedValue(new Error("storage down"));
    const remove = vi.spyOn(FileStorage, "deleteFile");
    const extra = extraOf();

    const result = await request({ user, classification, extra });

    expect(result.outcome).toEqual({ row: 3, message: OPERATION_FAILED });
    expect(result.schedule).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledTimes(1);
    const [key] = remove.mock.calls[0];
    const invocationId = key.split("/")[2];
    const [summary] = await summaries(invocationId);
    expect(summary.documentId).toBeNull();
    expect(summary.data).toEqual({
      schemaVersion: 1,
      requestId: extra.requestId,
      operation: "create_document",
      outcome: "aborted_before_decision",
      complete: false,
      durationMs: summary.data.durationMs,
      scopeKind: "collection",
      policySchemaVersion: 1,
      policyFingerprint: classification.entry.policyFingerprint,
      evaluatedDocumentCount: 0,
      evaluatedLinkCount: 0,
      counts: { errors: 0, warnings: 0, systemFailures: 0, byCode: {} },
      runtimeFailOpenExercised: false,
      credentialAuthType: "oauth",
      authenticatedClientId: "client-k",
    });
    void collection;
  });

  it("ends in row 3 when staging exceeds the preparation bound", async () => {
    const { user, classification } = await fixture();
    vi.spyOn(FileStorage, "store").mockImplementation(() => {
      state.offset += WRITE_PREPARATION_BOUND_MS;
      return new Promise(() => {});
    });
    const remove = vi.spyOn(FileStorage, "deleteFile");

    const result = await request({ user, classification });

    expect(result.outcome).toEqual({ row: 3, message: OPERATION_FAILED });
    expect(result.schedule).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("ends in row 3 when cancelled before scheduling", async () => {
    const { user, classification } = await fixture();
    const controller = new AbortController();
    const store = FileStorage.store.bind(FileStorage);
    vi.spyOn(FileStorage, "store").mockImplementation(async (args) => {
      const stored = await store(args);
      controller.abort();
      return stored;
    });
    const remove = vi.spyOn(FileStorage, "deleteFile");

    const result = await request({
      user,
      classification,
      signal: controller.signal,
    });

    expect(result.outcome).toEqual({ row: 3, message: OPERATION_FAILED });
    expect(result.schedule).not.toHaveBeenCalled();
    const [key] = remove.mock.calls[0];
    await expect(FileStorage.getFileExists(key)).resolves.toBe(false);
    const [summary] = await summaries(key.split("/")[2]);
    expect(summary.data.outcome).toBe("aborted_before_decision");
  });

  it.each([
    ["no request ID", { requestId: undefined }],
    ["a session credential", { credentialAuthType: "mcp" }],
    [
      "an OAuth credential without a client",
      { authenticatedClientId: undefined },
    ],
  ])("ends in row 3 without a summary for %s", async (_name, overrides) => {
    const { user, classification } = await fixture();
    const write = vi.fn(insertAuditEvent);
    const store = vi.spyOn(FileStorage, "store");

    const result = await request({
      user,
      classification,
      extra: extraOf(overrides),
      write,
    });

    expect(result.outcome).toEqual({ row: 3, message: OPERATION_FAILED });
    expect(result.schedule).not.toHaveBeenCalled();
    expect(store).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});

describe("no result", () => {
  it.each([
    ["the schedule rejects", () => Promise.reject(new Error("queue down"))],
    [
      "the worker has not registered the task",
      () =>
        Promise.resolve({
          finished: () =>
            Promise.reject(
              new Error(
                'Task "EnforcedDocumentImportTask" is not registered. Check the file name matches the class name.'
              )
            ),
        }),
    ],
    [
      "the result is malformed",
      () =>
        Promise.resolve({
          finished: () => Promise.resolve({ documentId: "x" }),
        }),
    ],
    [
      "the committed result names another document",
      () =>
        Promise.resolve({
          finished: () =>
            Promise.resolve({
              kind: "committed",
              documentId: randomUUID(),
              validation: {
                status: "validated",
                errors: [],
                warnings: [],
                systemFailures: [],
              },
            }),
        }),
    ],
  ] as [string, EnforcedImportScheduler][])(
    "reports row 7 when %s",
    async (_name, schedule) => {
      const { user, classification } = await fixture({ readable: false });
      const write = vi.fn(insertAuditEvent);

      const result = await request({ user, classification, schedule, write });

      await expectNoResult(result, write);
    }
  );

  it("reports row 7 when the wait reaches deadlineAt", async () => {
    const { user, classification } = await fixture();
    const write = vi.fn(insertAuditEvent);

    const result = await request({
      user,
      classification,
      write,
      schedule: () => {
        state.offset += ENFORCED_IMPORT_WAIT_MS - 20;
        return Promise.resolve(pendingJob());
      },
    });

    await expectNoResult(result, write);
  });

  it("reports row 7 when the wait is interrupted, while the job may still commit", async () => {
    const { user, classification } = await fixture();
    const write = vi.fn(insertAuditEvent);
    const controller = new AbortController();
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let job: Promise<unknown> | undefined;

    const result = await request({
      user,
      classification,
      write,
      signal: controller.signal,
      schedule: (intent) => {
        job = released.then(() => runEnforcedImport(intent));
        setTimeout(() => controller.abort(), 20);
        return Promise.resolve({ finished: () => job! });
      },
    });

    await expectNoResult(result, write);
    release();
    await expect(job).resolves.toMatchObject({ kind: "committed" });
  });
});

describe("the requester probe", () => {
  it.each([
    [
      "rejected",
      {
        kind: "rejected",
        validation: {
          status: "rejected",
          errors: [],
          warnings: [],
          systemFailures: [
            {
              code: "POLICY_CONFIGURATION_INVALID",
              message: "The collection lint policy is invalid.",
              location: { kind: "scope", scopeKind: "collection" },
            },
          ],
        },
      },
    ],
    ["conflict", { kind: "conflict" }],
    ["aborted", { kind: "aborted", row: 3, message: OPERATION_FAILED }],
  ] as const)(
    "reports row 7 for a %s result when the probe is unavailable",
    async (_name, value) => {
      const { user, classification } = await fixture({ readable: false });
      const write = vi.fn(insertAuditEvent);
      const query = sequelize.query.bind(sequelize) as (
        ...args: unknown[]
      ) => Promise<unknown>;
      const probe = vi
        .spyOn(sequelize, "query")
        .mockImplementation(((...args: unknown[]) =>
          typeof args[0] === "string" && args[0].includes("LEFT JOIN events")
            ? Promise.reject(new Error("probe failed"))
            : query(...args)) as never);

      const result = await request({
        user,
        classification,
        write,
        schedule: () =>
          Promise.resolve({ finished: () => Promise.resolve(value) }),
      });

      expect(
        probe.mock.calls.some(
          ([sql]) => typeof sql === "string" && sql.includes("LEFT JOIN")
        )
      ).toBe(true);
      await expectNoResult(result, write);
    }
  );

  it("rebuilds a probe-found commit without identity for a non-reader", async () => {
    const { user, classification } = await fixture({ readable: false });

    const result = await request({
      user,
      classification,
      schedule: (intent) =>
        Promise.resolve({
          finished: async () => {
            await buildDocument({
              id: intent.documentId,
              teamId: user.teamId,
              userId: user.id,
              collectionId: intent.collectionId,
            });
            await storeSummary(intent, user, {
              outcome: "degraded_validation",
              counts: {
                errors: 0,
                warnings: 0,
                systemFailures: 1,
                byCode: { VALIDATION_TIMEOUT: 1 },
              },
            });
            return { kind: "aborted", row: 5, message: OPERATION_FAILED };
          },
        }),
    });

    expect(result.outcome).toEqual({
      row: 6,
      documentId: classification.documentId,
      validation: {
        status: "degraded_validation",
        errors: [],
        warnings: [],
        systemFailures: [
          {
            code: "VALIDATION_TIMEOUT",
            message: "Validation did not finish before the deadline.",
            location: { kind: "scope", scopeKind: "collection" },
          },
        ],
      },
      assembly: expect.anything(),
    });
  });

  it("reports a commit after an aborted result from the committed summary", async () => {
    const { user, classification } = await fixture();

    const result = await request({
      user,
      classification,
      schedule: (intent) =>
        Promise.resolve({
          finished: async () => {
            await runEnforcedImport(intent);
            return { kind: "aborted", row: 3, message: OPERATION_FAILED };
          },
        }),
    });

    expect(result.outcome).toMatchObject({
      row: 6,
      documentId: classification.documentId,
      validation: {
        status: "validated",
        policySchemaVersion: 1,
        errors: [],
        warnings: [],
        systemFailures: [],
      },
    });
  });

  it("reports a commit when the worker crashed after it, rebuilding System Failures", async () => {
    const { user, collection, classification } = await fixture();

    const result = await request({
      user,
      classification,
      schedule: (intent) =>
        Promise.resolve({
          finished: async () => {
            await buildDocument({
              id: intent.documentId,
              teamId: user.teamId,
              userId: user.id,
              collectionId: intent.collectionId,
            });
            await storeSummary(intent, user, {
              outcome: "degraded_validation",
              counts: {
                errors: 0,
                warnings: 0,
                systemFailures: 1,
                byCode: { VALIDATION_RUNTIME_FAILED: 1 },
              },
            });
            throw new Error("worker crashed");
          },
        }),
    });

    expect(result.outcome).toMatchObject({
      row: 6,
      validation: {
        status: "degraded_validation",
        errors: [],
        warnings: [],
        systemFailures: [
          {
            code: "VALIDATION_RUNTIME_FAILED",
            location: {
              kind: "scope",
              scopeKind: "collection",
              collectionId: collection.id,
            },
          },
        ],
      },
    });
  });

  it.each([
    ["no summary", undefined],
    ["an aborted summary", "aborted_before_decision" as const],
    ["a rejected summary", "rejected" as const],
  ])("reports row 7 for a found row with %s", async (_name, outcome) => {
    const { user, classification } = await fixture();
    const write = vi.fn(insertAuditEvent);

    const result = await request({
      user,
      classification,
      write,
      schedule: (intent) =>
        Promise.resolve({
          finished: async () => {
            await buildDocument({
              id: intent.documentId,
              teamId: user.teamId,
              userId: user.id,
              collectionId: intent.collectionId,
            });
            if (outcome) {
              await storeSummary(intent, user, { outcome });
            }
            return { kind: "aborted", row: 5, message: OPERATION_FAILED };
          },
        }),
    });

    expect(result.outcome).toEqual({ row: 7 });
    expect(write).not.toHaveBeenCalled();
  });
});
