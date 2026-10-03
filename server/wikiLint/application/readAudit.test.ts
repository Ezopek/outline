import { randomUUID } from "node:crypto";
import Logger from "@server/logging/Logger";
import type { User } from "@server/models";
import type { AuditEventRow, AuditEventWriter } from "../adapters/auditEvents";
import type {
  EvaluatedScope,
  Finding,
  PolicyIdentity,
  ReadOnlyResult,
  ResultState,
  SystemFailure,
} from "../core/contracts";
import { createFinding, createSystemFailure } from "../core/registry";
import { AUDIT_WRITE_BOUND_MS } from "./deadline";
import type { ReadOperation, ReadResultOutcome } from "./readAudit";
import { readAuditData, recordReadAudit } from "./readAudit";

const D = "00000000-0000-4000-8000-0000000000d1";
const C1 = "00000000-0000-4000-8000-0000000000c1";
const C2 = "00000000-0000-4000-8000-0000000000c2";
const REQUEST_ID = "00000000-0000-4000-8000-00000000a001";
const FINGERPRINT = `sha256:${"a".repeat(64)}`;

const VALID: PolicyIdentity = {
  collectionId: C1,
  status: "valid",
  policySchemaVersion: 1,
  policyFingerprint: FINGERPRINT,
};

const INVALID: PolicyIdentity = {
  collectionId: C1,
  status: "invalid",
  invalidFingerprint: `sha256:${"b".repeat(64)}`,
};

const actor = { id: randomUUID(), teamId: randomUUID() } as User;

const documentScope = (counts = { documents: 0, links: 0 }) => ({
  kind: "document" as const,
  documentId: D,
  evaluatedDocumentCount: counts.documents,
  evaluatedLinkCount: counts.links,
});

const collectionScope = (counts = { documents: 0, links: 0 }) => ({
  kind: "collection" as const,
  collectionId: C1,
  evaluatedDocumentCount: counts.documents,
  evaluatedLinkCount: counts.links,
  completedChecks: [],
});

const missingSection = createFinding("REQUIRED_SECTION_MISSING", {
  kind: "document",
  documentId: D,
});
const badHeading = createFinding("HEADING_LEVEL_NOT_ALLOWED", {
  kind: "text",
  documentId: D,
  line: 1,
  column: 1,
});
const discouraged = createFinding("DISCOURAGED_MARKDOWN_STRUCTURE", {
  kind: "text",
  documentId: D,
  line: 3,
  column: 1,
});
const runtimeFailure = createSystemFailure("VALIDATION_RUNTIME_FAILED", {
  kind: "scope",
  scopeKind: "document",
  documentId: D,
});

/**
 * Builds a result outcome.
 *
 * @param input - the result fields; the rest default to a clean, complete,
 *   zero-count document result.
 * @returns the outcome.
 */
function outcomeOf(input: {
  state?: ResultState;
  errors?: Finding[];
  warnings?: Finding[];
  systemFailures?: SystemFailure[];
  scope?: EvaluatedScope;
  policies?: PolicyIdentity[];
  auditPolicy?: PolicyIdentity;
}): ReadResultOutcome {
  const state = input.state ?? "complete";
  const errors = input.errors ?? [];
  const result: ReadOnlyResult = {
    state,
    complete: state === "complete",
    clean: state === "complete" && errors.length === 0,
    errors,
    warnings: input.warnings ?? [],
    systemFailures: input.systemFailures ?? [],
    scope: input.scope ?? documentScope(),
    policies: input.policies ?? [],
  };
  return input.auditPolicy
    ? { kind: "result", result, auditPolicy: input.auditPolicy }
    : { kind: "result", result };
}

/**
 * Maps an outcome with fixed API attribution and duration.
 *
 * @param outcome - the outcome.
 * @param operation - the lint operation.
 * @returns the summary data.
 */
const dataOf = (
  outcome: ReadResultOutcome,
  operation: ReadOperation = "lint_document"
) =>
  readAuditData({
    operation,
    outcome,
    attribution: { requestId: REQUEST_ID, credentialAuthType: "api" },
    durationMs: 7,
  });

/** The data of a clean, complete document result without a policy. */
const baseData = {
  schemaVersion: 1,
  requestId: REQUEST_ID,
  operation: "lint_document",
  outcome: "clean",
  complete: true,
  durationMs: 7,
  scopeKind: "document",
  evaluatedDocumentCount: 0,
  evaluatedLinkCount: 0,
  counts: { errors: 0, warnings: 0, systemFailures: 0, byCode: {} },
  runtimeFailOpenExercised: false,
  credentialAuthType: "api",
};

describe("readAuditData", () => {
  it.each([
    ["complete without Errors", { warnings: [discouraged] }, "clean"],
    ["complete with Errors", { errors: [missingSection] }, "findings"],
    ["not evaluated", { state: "not_evaluated" as const }, "not_evaluated"],
    [
      "incomplete",
      { state: "incomplete" as const, systemFailures: [runtimeFailure] },
      "incomplete",
    ],
    [
      "failed",
      { state: "failed" as const, systemFailures: [runtimeFailure] },
      "failed",
    ],
  ])("maps a result that is %s", (_name, fields, outcome) => {
    const data = dataOf(outcomeOf(fields));

    expect(data.outcome).toBe(outcome);
    expect(data.complete).toBe(!("state" in fields));
  });

  it("emits exactly the AD-14 keys of a document result under a valid policy", () => {
    expect(
      dataOf(
        outcomeOf({
          scope: documentScope({ documents: 1, links: 3 }),
          policies: [VALID],
          auditPolicy: VALID,
        })
      )
    ).toStrictEqual({
      ...baseData,
      policySchemaVersion: 1,
      policyFingerprint: FINGERPRINT,
      evaluatedDocumentCount: 1,
      evaluatedLinkCount: 3,
    });
  });

  it("keeps the policy of a document whose collection the actor cannot read", () => {
    const readable = dataOf(
      outcomeOf({
        scope: { ...documentScope(), collectionId: C1 },
        policies: [VALID],
        auditPolicy: VALID,
      })
    );
    const unreadable = dataOf(
      outcomeOf({ scope: documentScope(), policies: [], auditPolicy: VALID })
    );

    expect(unreadable).toStrictEqual(readable);
    expect(unreadable.policyFingerprint).toBe(FINGERPRINT);
  });

  it.each([
    ["a sentinel document", outcomeOf({ policies: [INVALID] })],
    ["an unconfigured document", outcomeOf({ state: "not_evaluated" })],
    [
      "a sentinel collection",
      outcomeOf({ scope: collectionScope(), policies: [INVALID] }),
    ],
    [
      "an unconfigured collection",
      outcomeOf({ state: "not_evaluated", scope: collectionScope() }),
    ],
    [
      "a default scope",
      outcomeOf({
        scope: {
          kind: "configured_collections",
          collections: [{ ...collectionScope(), collectionId: C1 }],
        },
        policies: [VALID],
      }),
    ],
  ])("omits the policy fields for %s", (_name, outcome) => {
    const data = dataOf(outcome, "lint_wiki");

    expect(Object.keys(data)).not.toContain("policySchemaVersion");
    expect(Object.keys(data)).not.toContain("policyFingerprint");
    expect(JSON.stringify(data)).not.toContain("invalidFingerprint");
    expect(JSON.stringify(data)).not.toContain(C1);
  });

  it("takes the valid policy of a collection scope from the result", () => {
    expect(
      dataOf(
        outcomeOf({
          scope: collectionScope({ documents: 2, links: 5 }),
          policies: [VALID],
        }),
        "lint_wiki"
      )
    ).toStrictEqual({
      ...baseData,
      operation: "lint_wiki",
      scopeKind: "collection",
      policySchemaVersion: 1,
      policyFingerprint: FINGERPRINT,
      evaluatedDocumentCount: 2,
      evaluatedLinkCount: 5,
    });
  });

  it("sums the counts of configured collections", () => {
    const data = dataOf(
      outcomeOf({
        scope: {
          kind: "configured_collections",
          collections: [
            {
              collectionId: C1,
              evaluatedDocumentCount: 2,
              evaluatedLinkCount: 3,
              completedChecks: [],
            },
            {
              collectionId: C2,
              evaluatedDocumentCount: 4,
              evaluatedLinkCount: 1,
              completedChecks: [],
            },
          ],
        },
      }),
      "lint_wiki"
    );

    expect(data).toStrictEqual({
      ...baseData,
      operation: "lint_wiki",
      scopeKind: "configured_collections",
      evaluatedDocumentCount: 6,
      evaluatedLinkCount: 4,
    });
  });

  it("counts every code across the three arrays in bytewise key order", () => {
    const data = dataOf(
      outcomeOf({
        state: "failed",
        errors: [missingSection, badHeading, missingSection],
        warnings: [discouraged],
        systemFailures: [runtimeFailure],
      })
    );

    expect(data.counts).toStrictEqual({
      errors: 3,
      warnings: 1,
      systemFailures: 1,
      byCode: {
        DISCOURAGED_MARKDOWN_STRUCTURE: 1,
        HEADING_LEVEL_NOT_ALLOWED: 1,
        REQUIRED_SECTION_MISSING: 2,
        VALIDATION_RUNTIME_FAILED: 1,
      },
    });
    expect(Object.keys(data.counts.byCode)).toEqual([
      "DISCOURAGED_MARKDOWN_STRUCTURE",
      "HEADING_LEVEL_NOT_ALLOWED",
      "REQUIRED_SECTION_MISSING",
      "VALIDATION_RUNTIME_FAILED",
    ]);
  });

  it("is identical whether or not the Findings carry detail", () => {
    const relationship = {
      kind: "relationship" as const,
      documentId: D,
      relationshipKind: "global_index" as const,
    };
    const document = { kind: "document" as const, documentId: D };
    const named = [
      createFinding("REQUIRED_SECTION_MISSING", document, {
        kind: "section",
        heading: "Summary",
        headingLevel: 2,
      }),
      createFinding("REQUIRED_METADATA_FIELD_MISSING", document, {
        kind: "metadata_field",
        field: "Owner",
      }),
      createFinding("GLOBAL_INDEX_LINK_MISSING", relationship, {
        kind: "global_index",
        documentId: C2,
        urlId: "IndexUrlId",
      }),
    ];
    const unnamed = [
      missingSection,
      createFinding("REQUIRED_METADATA_FIELD_MISSING", document),
      createFinding("GLOBAL_INDEX_LINK_MISSING", relationship),
    ];
    const scope = collectionScope({ documents: 1, links: 0 });

    const withDetail = dataOf(
      outcomeOf({ errors: named, scope, policies: [VALID] }),
      "lint_wiki"
    );
    const withoutDetail = dataOf(
      outcomeOf({ errors: unnamed, scope, policies: [VALID] }),
      "lint_wiki"
    );

    expect(withDetail).toStrictEqual(withoutDetail);
    expect(withDetail.counts).toStrictEqual({
      errors: 3,
      warnings: 0,
      systemFailures: 0,
      byCode: {
        GLOBAL_INDEX_LINK_MISSING: 1,
        REQUIRED_METADATA_FIELD_MISSING: 1,
        REQUIRED_SECTION_MISSING: 1,
      },
    });
    expect(JSON.stringify(withDetail)).not.toMatch(
      /detail|Summary|Owner|IndexUrlId/
    );
    expect(JSON.stringify(withDetail)).not.toContain(C2);
  });

  it.each([
    ["oauth", "client-k", { authenticatedClientId: "client-k" }],
    ["oauth", "", {}],
    ["oauth", undefined, {}],
    ["oauth", 42, {}],
    ["api", "client-k", {}],
  ] as const)(
    "records the client of a %s credential given %j only when it is OAuth",
    (credentialAuthType, authenticatedClientId, expected) => {
      const data = readAuditData({
        operation: "lint_document",
        outcome: outcomeOf({}),
        attribution: {
          requestId: REQUEST_ID,
          credentialAuthType,
          authenticatedClientId,
        },
        durationMs: 0,
      });

      expect(data).toStrictEqual({
        ...baseData,
        durationMs: 0,
        credentialAuthType,
        ...expected,
      });
    }
  );
});

describe("recordReadAudit", () => {
  const extra = {
    user: actor,
    requestId: REQUEST_ID,
    credentialAuthType: "api",
    ip: "::ffff:127.0.0.1",
  };

  /**
   * Records an audit with a capturing writer.
   *
   * @param overrides - input overrides.
   * @param write - the writer; defaults to one that resolves.
   * @returns the rows written and the warnings logged.
   */
  async function record(
    overrides: Partial<Parameters<typeof recordReadAudit>[0]> = {},
    write?: AuditEventWriter
  ) {
    const rows: AuditEventRow[] = [];
    const timeouts: number[] = [];
    const warn = vi.spyOn(Logger, "warn").mockImplementation(() => undefined);
    const writer: AuditEventWriter =
      write ??
      (async (row, statementTimeoutMs) => {
        rows.push(row);
        timeouts.push(statementTimeoutMs);
      });
    await expect(
      recordReadAudit(
        {
          operation: "lint_document",
          outcome: outcomeOf({
            scope: documentScope({ documents: 1, links: 0 }),
          }),
          actor,
          extra,
          invocationId: "00000000-0000-4000-8000-00000000b001",
          enteredAt: 100,
          clock: () => 112.6,
          ...overrides,
        },
        writer
      )
    ).resolves.toBeUndefined();
    return { rows, timeouts, warnings: warn.mock.calls };
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("writes one row with the bound as its statement timeout", async () => {
    const { rows, timeouts, warnings } = await record();

    expect(rows).toStrictEqual([
      {
        id: "00000000-0000-4000-8000-00000000b001",
        name: "wikiLint.document",
        teamId: actor.teamId,
        actorId: actor.id,
        ip: "::ffff:127.0.0.1",
        documentId: D,
        data: {
          ...baseData,
          durationMs: 13,
          evaluatedDocumentCount: 1,
        },
      },
    ]);
    expect(timeouts).toEqual([AUDIT_WRITE_BOUND_MS]);
    expect(warnings).toEqual([]);
  });

  it.each([
    [
      "a document scope",
      "lint_document" as const,
      outcomeOf({
        scope: { ...documentScope(), collectionId: C1 },
        policies: [VALID],
        auditPolicy: VALID,
      }),
      { name: "wikiLint.document", documentId: D },
    ],
    [
      "a collection scope",
      "lint_wiki" as const,
      outcomeOf({ scope: collectionScope(), policies: [VALID] }),
      { name: "wikiLint.wiki", collectionId: C1 },
    ],
    [
      "a default scope",
      "lint_wiki" as const,
      outcomeOf({
        state: "not_evaluated",
        scope: { kind: "configured_collections", collections: [] },
      }),
      { name: "wikiLint.wiki" },
    ],
  ])("sets the columns of %s", async (_name, operation, outcome, columns) => {
    const { rows } = await record({ operation, outcome });

    const { data: _data, ...row } = rows[0];
    expect(row).toStrictEqual({
      id: "00000000-0000-4000-8000-00000000b001",
      teamId: actor.teamId,
      actorId: actor.id,
      ip: "::ffff:127.0.0.1",
      ...columns,
    });
  });

  it.each([
    [0, 0],
    [0.4, 0],
    [0.5, 1],
    [-5, 0],
  ])(
    "rounds an elapsed time of %s ms to the non-negative integer %s",
    async (elapsed, durationMs) => {
      const { rows } = await record({
        enteredAt: 50,
        clock: () => 50 + elapsed,
      });

      expect(rows[0].data.durationMs).toBe(durationMs);
    }
  );

  it("records an API credential without a client even when one is given", async () => {
    const { rows } = await record({
      extra: { ...extra, authenticatedClientId: "client-k" },
    });

    expect(rows[0].data.credentialAuthType).toBe("api");
    expect(rows[0].data).not.toHaveProperty("authenticatedClientId");
  });

  it("records the client of an OAuth credential", async () => {
    const { rows } = await record({
      extra: {
        ...extra,
        credentialAuthType: "oauth",
        authenticatedClientId: "client-k",
      },
    });

    expect(rows[0].data).toMatchObject({
      credentialAuthType: "oauth",
      authenticatedClientId: "client-k",
    });
  });

  /**
   * Builds the single diagnostic of an audit failure.
   *
   * @param reason - the failure reason.
   * @param requestId - the logged request ID; null when none was valid.
   * @returns the expected `Logger.warn` calls.
   */
  const diagnostic = (
    reason: "timeout" | "error",
    requestId: string | null = REQUEST_ID
  ) => [
    [
      "Wiki lint audit write failed",
      {
        requestId: requestId ?? undefined,
        invocationId: "00000000-0000-4000-8000-00000000b001",
        reason,
      },
    ],
  ];

  it("logs one minimized diagnostic when the writer rejects", async () => {
    const { warnings } = await record({}, async () => {
      throw new Error("raw SQL detail");
    });

    expect(warnings).toEqual(diagnostic("error"));
  });

  it("logs one minimized diagnostic when the writer throws synchronously", async () => {
    const { warnings } = await record({}, () => {
      throw new Error("raw detail");
    });

    expect(warnings).toEqual(diagnostic("error"));
  });

  it.each([
    ["missing", { requestId: undefined }],
    ["not a UUID", { requestId: "request" }],
    ["not a string", { requestId: 1 }],
  ])("fails without writing when the request ID is %s", async (_name, gap) => {
    const write = vi.fn(async () => undefined);
    const { warnings } = await record({ extra: { ...extra, ...gap } }, write);

    expect(write).not.toHaveBeenCalled();
    expect(warnings).toEqual(diagnostic("error", null));
  });

  it.each([
    ["missing", { credentialAuthType: undefined }],
    ["unknown", { credentialAuthType: "mcp" }],
  ])(
    "fails without writing when the credential type is %s",
    async (_name, gap) => {
      const write = vi.fn(async () => undefined);
      const { warnings } = await record({ extra: { ...extra, ...gap } }, write);

      expect(write).not.toHaveBeenCalled();
      expect(warnings).toEqual(diagnostic("error"));
    }
  );

  it("fails without writing when there is no attribution", async () => {
    const write = vi.fn(async () => undefined);
    const { warnings } = await record({ extra: undefined }, write);

    expect(write).not.toHaveBeenCalled();
    expect(warnings).toEqual(diagnostic("error", null));
  });

  it.each([
    [
      "throws",
      () => {
        throw new Error("raw clock detail");
      },
    ],
    ["is not finite", () => Number.NaN],
  ])("fails without writing when the clock %s", async (_name, clock) => {
    const write = vi.fn(async () => undefined);
    const { warnings } = await record({ clock }, write);

    expect(write).not.toHaveBeenCalled();
    expect(warnings).toEqual(diagnostic("error"));
  });

  it("never rejects when logging fails", async () => {
    vi.spyOn(Logger, "warn").mockImplementation(() => {
      throw new Error("logger");
    });

    await expect(
      recordReadAudit(
        {
          operation: "lint_document",
          outcome: outcomeOf({}),
          actor,
          extra: undefined,
          invocationId: randomUUID(),
          enteredAt: 0,
          clock: () => 0,
        },
        async () => undefined
      )
    ).resolves.toBeUndefined();
  });

  it("times out at the bound and absorbs a late rejection", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(Logger, "warn").mockImplementation(() => undefined);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    let reject: (error: Error) => void = () => undefined;
    let settled = false;

    try {
      const pending = recordReadAudit(
        {
          operation: "lint_document",
          outcome: outcomeOf({}),
          actor,
          extra,
          invocationId: "00000000-0000-4000-8000-00000000b001",
          enteredAt: 0,
          clock: () => 0,
        },
        () =>
          new Promise<void>((_resolve, fail) => {
            reject = fail;
          })
      ).then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(AUDIT_WRITE_BOUND_MS - 1);
      expect(settled).toBe(false);
      expect(warn).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(settled).toBe(true);
      expect(warn.mock.calls).toEqual(diagnostic("timeout"));
      expect(vi.getTimerCount()).toBe(0);

      reject(new Error("late"));
      vi.useRealTimers();
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("clears the timer once the write settles", async () => {
    vi.useFakeTimers();
    await record();

    expect(vi.getTimerCount()).toBe(0);
  });
});
