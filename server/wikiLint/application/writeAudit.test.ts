import { randomUUID } from "node:crypto";
import Logger from "@server/logging/Logger";
import type { AuditDataV1, AuditEventRow } from "../adapters/auditEvents";
import type { IssueItem, WriteValidation } from "../core/contracts";
import type { RuleConfig } from "../core/registry";
import { createFinding, createSystemFailure } from "../core/registry";
import { AUDIT_WRITE_BOUND_MS, monotonicClock } from "./deadline";
import type { WriteAuditOutcome } from "./writeAudit";
import {
  authEnvelopeOf,
  evaluatedCounts,
  recordRequestWriteAudit,
  recordWriteAudit,
  validationFromSummary,
  writeAuditData,
  writeAuditRow,
} from "./writeAudit";

const D = "00000000-0000-4000-8000-0000000000d1";
const C = "00000000-0000-4000-8000-0000000000c1";
const REQUEST_ID = "00000000-0000-4000-8000-00000000a001";
const INVOCATION_ID = "00000000-0000-4000-8000-00000000b001";
const FINGERPRINT = `sha256:${"a".repeat(64)}`;

const REQUIRED = {
  kind: "required_sections",
  headingLevel: 2,
  headings: ["Overview"],
} as RuleConfig;
const LINKS = { kind: "internal_links" } as RuleConfig;
const HIERARCHY = { kind: "hierarchy_acyclic" } as RuleConfig;

const scope = { kind: "scope" as const, scopeKind: "collection" as const };
const missing = createFinding("REQUIRED_SECTION_MISSING", {
  kind: "document",
  documentId: D,
});
const discouraged = createFinding("DISCOURAGED_MARKDOWN_STRUCTURE", {
  kind: "text",
  documentId: D,
  line: 1,
  column: 1,
});
const timeout = createSystemFailure("VALIDATION_TIMEOUT", scope);
const runtime = createSystemFailure("VALIDATION_RUNTIME_FAILED", scope);

/**
 * Builds a validation.
 *
 * @param status - the status.
 * @param issues - the issues.
 * @returns the validation.
 */
const validationOf = (
  status: WriteValidation["status"],
  issues: Partial<
    Pick<WriteValidation, "errors" | "warnings" | "systemFailures">
  > = {}
): WriteValidation => ({
  status,
  errors: [],
  warnings: [],
  systemFailures: [],
  ...issues,
});

/**
 * Maps an outcome to summary data with fixed attribution.
 *
 * @param outcome - the outcome.
 * @returns the data.
 */
const dataOf = (outcome: WriteAuditOutcome) =>
  writeAuditData({
    requestId: REQUEST_ID,
    operation: "create_document",
    outcome,
    durationMs: 42,
    policyFingerprint: FINGERPRINT,
    auth: { credentialAuthType: "oauth", authenticatedClientId: "client-k" },
  });

const ONE = { evaluatedDocumentCount: 1, evaluatedLinkCount: 3 };

/** The fields every write summary shares. */
const COMMON = {
  schemaVersion: 1,
  requestId: REQUEST_ID,
  operation: "create_document",
  durationMs: 42,
  scopeKind: "collection",
  policySchemaVersion: 1,
  policyFingerprint: FINGERPRINT,
  credentialAuthType: "oauth",
  authenticatedClientId: "client-k",
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("writeAuditData", () => {
  it.each([
    [
      "validated",
      validationOf("validated"),
      {
        complete: true,
        counts: { errors: 0, warnings: 0, systemFailures: 0, byCode: {} },
      },
    ],
    [
      "validated_with_warnings",
      validationOf("validated_with_warnings", { warnings: [discouraged] }),
      {
        complete: true,
        counts: {
          errors: 0,
          warnings: 1,
          systemFailures: 0,
          byCode: { DISCOURAGED_MARKDOWN_STRUCTURE: 1 },
        },
      },
    ],
    [
      "rejected",
      validationOf("rejected", { errors: [missing], warnings: [discouraged] }),
      {
        complete: true,
        counts: {
          errors: 1,
          warnings: 1,
          systemFailures: 0,
          byCode: {
            DISCOURAGED_MARKDOWN_STRUCTURE: 1,
            REQUIRED_SECTION_MISSING: 1,
          },
        },
      },
    ],
    [
      "rejected",
      validationOf("rejected", {
        errors: [missing],
        systemFailures: [timeout],
      }),
      {
        complete: false,
        counts: {
          errors: 1,
          warnings: 0,
          systemFailures: 1,
          byCode: { REQUIRED_SECTION_MISSING: 1, VALIDATION_TIMEOUT: 1 },
        },
      },
    ],
    [
      "degraded_validation",
      validationOf("degraded_validation", {
        warnings: [discouraged],
        systemFailures: [timeout, runtime],
      }),
      {
        complete: false,
        runtimeFailOpenExercised: true,
        counts: {
          errors: 0,
          warnings: 1,
          systemFailures: 2,
          byCode: {
            DISCOURAGED_MARKDOWN_STRUCTURE: 1,
            VALIDATION_RUNTIME_FAILED: 1,
            VALIDATION_TIMEOUT: 1,
          },
        },
      },
    ],
  ])("summarizes a decided %s validation", (status, validation, expected) => {
    const data = dataOf({ kind: "decided", validation, evaluated: ONE });

    expect(data).toEqual({
      ...COMMON,
      outcome: status,
      evaluatedDocumentCount: 1,
      evaluatedLinkCount: 3,
      runtimeFailOpenExercised: false,
      ...expected,
    });
    expect(Object.keys(data.counts.byCode)).toEqual(
      Object.keys(data.counts.byCode).sort()
    );
  });

  it("summarizes a policy-configuration rejection", () => {
    expect(dataOf({ kind: "policy_rejection" })).toEqual({
      ...COMMON,
      outcome: "rejected",
      complete: false,
      evaluatedDocumentCount: 0,
      evaluatedLinkCount: 0,
      counts: {
        errors: 0,
        warnings: 0,
        systemFailures: 1,
        byCode: { POLICY_CONFIGURATION_INVALID: 1 },
      },
      runtimeFailOpenExercised: false,
    });
  });

  it("omits both policy fields for a sentinel rejection", () => {
    const data = writeAuditData({
      requestId: REQUEST_ID,
      operation: "update_document",
      outcome: { kind: "policy_rejection" },
      durationMs: 7,
      auth: { credentialAuthType: "api" },
    });

    expect(data).toEqual({
      schemaVersion: 1,
      requestId: REQUEST_ID,
      operation: "update_document",
      outcome: "rejected",
      complete: false,
      durationMs: 7,
      scopeKind: "collection",
      evaluatedDocumentCount: 0,
      evaluatedLinkCount: 0,
      counts: {
        errors: 0,
        warnings: 0,
        systemFailures: 1,
        byCode: { POLICY_CONFIGURATION_INVALID: 1 },
      },
      runtimeFailOpenExercised: false,
      credentialAuthType: "api",
    });
    expect(data).not.toHaveProperty("policySchemaVersion");
    expect(data).not.toHaveProperty("policyFingerprint");
  });

  it.each([
    [3, "aborted_before_decision"],
    [5, "aborted_after_decision"],
  ] as const)("summarizes a row %s abort", (row, outcome) => {
    expect(dataOf({ kind: "aborted", row })).toEqual({
      ...COMMON,
      outcome,
      complete: false,
      evaluatedDocumentCount: 0,
      evaluatedLinkCount: 0,
      counts: { errors: 0, warnings: 0, systemFailures: 0, byCode: {} },
      runtimeFailOpenExercised: false,
    });
  });

  it("carries no client for an API credential and no content", () => {
    const data = writeAuditData({
      requestId: REQUEST_ID,
      operation: "create_document",
      outcome: {
        kind: "decided",
        validation: validationOf("rejected", {
          errors: [
            createFinding(
              "REQUIRED_SECTION_MISSING",
              { kind: "document", documentId: D },
              { kind: "section", heading: "Secret heading", headingLevel: 2 }
            ),
          ],
        }),
        evaluated: ONE,
      },
      durationMs: 1,
      policyFingerprint: FINGERPRINT,
      auth: { credentialAuthType: "api" },
    });

    expect(data.credentialAuthType).toBe("api");
    expect(data).not.toHaveProperty("authenticatedClientId");
    expect(JSON.stringify(data)).not.toContain("Secret heading");
    expect(JSON.stringify(data)).not.toContain(D);
  });
});

describe("evaluatedCounts", () => {
  const item = (issue: IssueItem["issue"]): IssueItem => ({ issue });

  it("counts the document and its links when the unit completed", () => {
    expect(
      evaluatedCounts(
        { items: [item(missing)], measures: { linkReferences: 4 } },
        [REQUIRED, LINKS]
      )
    ).toEqual({ evaluatedDocumentCount: 1, evaluatedLinkCount: 4 });
    expect(
      evaluatedCounts({ items: [], measures: { linkReferences: 4 } }, [
        REQUIRED,
      ])
    ).toEqual({ evaluatedDocumentCount: 1, evaluatedLinkCount: 0 });
  });

  it("counts nothing for a System Failure or without document-surface rules", () => {
    expect(
      evaluatedCounts(
        { items: [item(timeout)], measures: { linkReferences: 4 } },
        [REQUIRED, LINKS]
      )
    ).toEqual({ evaluatedDocumentCount: 0, evaluatedLinkCount: 0 });
    expect(evaluatedCounts({ items: [], measures: {} }, [HIERARCHY])).toEqual({
      evaluatedDocumentCount: 0,
      evaluatedLinkCount: 0,
    });
  });
});

describe("writeAuditRow", () => {
  it("sets the document column only when given", () => {
    const actor = { id: randomUUID(), teamId: randomUUID() };
    const data = dataOf({ kind: "aborted", row: 3 });
    const row = writeAuditRow({
      invocationId: INVOCATION_ID,
      actor,
      sourceIp: "127.0.0.1",
      collectionId: C,
      data,
    });

    expect(row).toEqual({
      id: INVOCATION_ID,
      name: "wikiLint.write_validation",
      teamId: actor.teamId,
      actorId: actor.id,
      ip: "127.0.0.1",
      collectionId: C,
      data,
    });
    expect(
      writeAuditRow({
        invocationId: INVOCATION_ID,
        actor,
        sourceIp: null,
        collectionId: C,
        documentId: D,
        data,
      })
    ).toMatchObject({ documentId: D, ip: null });
  });
});

describe("recordWriteAudit", () => {
  const row = {
    id: INVOCATION_ID,
    name: "wikiLint.write_validation",
    teamId: randomUUID(),
    actorId: randomUUID(),
    ip: null,
    collectionId: C,
    data: dataOf({ kind: "aborted", row: 3 }),
  } satisfies AuditEventRow;
  const correlation = { requestId: REQUEST_ID, invocationId: INVOCATION_ID };

  it("writes the row with the audit bound", async () => {
    const write = vi.fn(() => Promise.resolve());

    await recordWriteAudit(row, correlation, write);

    expect(write).toHaveBeenCalledWith(row, AUDIT_WRITE_BOUND_MS);
  });

  it.each([
    [
      "a rejected write",
      () => Promise.reject(new Error(`leak ${D}`)),
      undefined,
    ],
    [
      "a row that cannot be built",
      undefined,
      () => {
        throw new Error(`leak ${D}`);
      },
    ],
  ])(
    "never rejects and logs only the correlation for %s",
    async (_name, failing, build) => {
      const warn = vi.spyOn(Logger, "warn").mockImplementation(() => undefined);
      const write = vi.fn(failing ?? (() => Promise.resolve()));

      await expect(
        recordWriteAudit(build ?? row, correlation, write)
      ).resolves.toBeUndefined();

      expect(warn).toHaveBeenCalledWith("Wiki lint audit write failed", {
        ...correlation,
        reason: "error",
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain(D);
    }
  );

  it("stops waiting at the audit bound", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(Logger, "warn").mockImplementation(() => undefined);
    const write = vi.fn(() => new Promise<void>(() => {}));

    const pending = recordWriteAudit(row, correlation, write);
    await vi.advanceTimersByTimeAsync(AUDIT_WRITE_BOUND_MS);

    await expect(pending).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("Wiki lint audit write failed", {
      ...correlation,
      reason: "timeout",
    });
  });
});

describe("authEnvelopeOf", () => {
  it.each([
    [
      { credentialAuthType: "api", authenticatedClientId: "ignored" },
      { credentialAuthType: "api" },
    ],
    [
      { credentialAuthType: "oauth", authenticatedClientId: "client-k" },
      { credentialAuthType: "oauth", authenticatedClientId: "client-k" },
    ],
    [{ credentialAuthType: "oauth" }, undefined],
    [{ credentialAuthType: "oauth", authenticatedClientId: "" }, undefined],
    [{ credentialAuthType: "session" }, undefined],
    [undefined, undefined],
  ])("reads %j as %j", (extra, expected) => {
    expect(authEnvelopeOf(extra)).toEqual(expected);
  });
});

describe("recordRequestWriteAudit", () => {
  const actor = { id: randomUUID(), teamId: randomUUID() };
  const EXTRA = {
    requestId: REQUEST_ID,
    credentialAuthType: "oauth",
    authenticatedClientId: "client-k",
    ip: "10.0.0.7",
  };

  /**
   * Records a summary with a capturing writer.
   *
   * @param overrides - the inputs to replace.
   * @returns the written rows and the writer.
   */
  async function record(
    overrides: Partial<Parameters<typeof recordRequestWriteAudit>[0]> = {}
  ) {
    const rows: AuditEventRow[] = [];
    const write = vi.fn(async (row: AuditEventRow) => {
      rows.push(row);
    });
    await recordRequestWriteAudit({
      extra: EXTRA,
      enteredAt: monotonicClock(),
      write,
      invocationId: INVOCATION_ID,
      actor,
      operation: "update_document",
      collectionId: C,
      documentId: D,
      policyFingerprint: FINGERPRINT,
      outcome: { kind: "aborted", row: 5 },
      ...overrides,
    });
    return { rows, write };
  }

  it("builds the row from the server-owned attribution only", async () => {
    const { rows, write } = await record();

    expect(write).toHaveBeenCalledWith(rows[0], AUDIT_WRITE_BOUND_MS);
    expect(rows).toEqual([
      {
        id: INVOCATION_ID,
        name: "wikiLint.write_validation",
        teamId: actor.teamId,
        actorId: actor.id,
        ip: "10.0.0.7",
        collectionId: C,
        documentId: D,
        data: {
          ...COMMON,
          operation: "update_document",
          durationMs: expect.any(Number),
          outcome: "aborted_after_decision",
          complete: false,
          evaluatedDocumentCount: 0,
          evaluatedLinkCount: 0,
          counts: { errors: 0, warnings: 0, systemFailures: 0, byCode: {} },
          runtimeFailOpenExercised: false,
        },
      },
    ]);
  });

  it("omits the document, the IP, and for a sentinel the policy fields", async () => {
    const { rows } = await record({
      extra: { ...EXTRA, credentialAuthType: "api", ip: 7 },
      documentId: undefined,
      policyFingerprint: undefined,
      outcome: { kind: "policy_rejection" },
    });

    expect(rows[0]).not.toHaveProperty("documentId");
    expect(rows[0].ip).toBeNull();
    expect(rows[0].data).not.toHaveProperty("policySchemaVersion");
    expect(rows[0].data).not.toHaveProperty("policyFingerprint");
    expect(rows[0].data).not.toHaveProperty("authenticatedClientId");
    expect(rows[0].data).toMatchObject({
      credentialAuthType: "api",
      outcome: "rejected",
    });
  });

  it("measures whole milliseconds from handler entry, never negative", async () => {
    const before = monotonicClock();
    const elapsed = await record({ enteredAt: before - 1234.4 });
    const ahead = await record({ enteredAt: monotonicClock() + 60000 });

    expect(elapsed.rows[0].data.durationMs).toBeGreaterThanOrEqual(1234);
    expect(elapsed.rows[0].data.durationMs).toBeLessThan(1234 + 1000);
    expect(Number.isInteger(elapsed.rows[0].data.durationMs)).toBe(true);
    expect(ahead.rows[0].data.durationMs).toBe(0);
  });

  it.each([
    ["a missing request ID", { requestId: undefined }, undefined],
    ["a malformed request ID", { requestId: "not-a-uuid" }, undefined],
    [
      "an uppercase request ID",
      { requestId: REQUEST_ID.toUpperCase() },
      undefined,
    ],
    ["an unknown credential", { credentialAuthType: "session" }, REQUEST_ID],
    [
      "an OAuth credential without a client",
      { authenticatedClientId: "" },
      REQUEST_ID,
    ],
  ])(
    "logs only the correlation and writes nothing for %s",
    async (_name, override, requestId) => {
      const warn = vi.spyOn(Logger, "warn").mockImplementation(() => undefined);

      const { write } = await record({ extra: { ...EXTRA, ...override } });

      expect(write).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith("Wiki lint audit write failed", {
        requestId,
        invocationId: INVOCATION_ID,
        reason: "error",
      });
    }
  );

  it("logs an audit failure for an invalid handler entry", async () => {
    const warn = vi.spyOn(Logger, "warn").mockImplementation(() => undefined);

    const { write } = await record({ enteredAt: Number.NaN });

    expect(write).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("Wiki lint audit write failed", {
      requestId: REQUEST_ID,
      invocationId: INVOCATION_ID,
      reason: "error",
    });
  });
});

describe("validationFromSummary", () => {
  /**
   * Builds stored summary data.
   *
   * @param overrides - the fields to replace.
   * @returns the data.
   */
  const summary = (overrides: Partial<AuditDataV1> = {}): AuditDataV1 => ({
    ...dataOf({
      kind: "decided",
      validation: validationOf("validated"),
      evaluated: ONE,
    }),
    ...overrides,
  });

  it.each([true, false])(
    "rebuilds a committed status with only result System Failures, readable %s",
    (readable) => {
      const location = {
        kind: "scope",
        scopeKind: "collection",
        ...(readable && { collectionId: C }),
      };

      expect(
        validationFromSummary(
          summary({
            outcome: "degraded_validation",
            counts: {
              errors: 0,
              warnings: 2,
              systemFailures: 3,
              byCode: {
                DISCOURAGED_MARKDOWN_STRUCTURE: 2,
                VALIDATION_TIMEOUT: 1,
                POLICY_CONFIGURATION_MALFORMED: 1,
                VALIDATION_RUNTIME_FAILED: 1,
                VALIDATION_RESOURCE_LIMIT_EXCEEDED: 0,
              },
            },
          }),
          { readable, collectionId: C, policyFingerprint: FINGERPRINT }
        )
      ).toEqual({
        status: "degraded_validation",
        ...(readable && {
          policySchemaVersion: 1,
          policyFingerprint: FINGERPRINT,
        }),
        errors: [],
        warnings: [],
        systemFailures: [
          {
            code: "VALIDATION_RUNTIME_FAILED",
            message: "Validation could not be completed.",
            location,
          },
          {
            code: "VALIDATION_TIMEOUT",
            message: "Validation did not finish before the deadline.",
            location,
          },
        ],
      });
    }
  );

  it.each([
    ["validated", "validated"],
    ["validated_with_warnings", "validated_with_warnings"],
  ] as const)("keeps a stored %s status", (outcome, status) => {
    expect(
      validationFromSummary(summary({ outcome }), {
        readable: true,
        collectionId: C,
        policyFingerprint: FINGERPRINT,
      })?.status
    ).toBe(status);
  });

  it.each([
    ["no summary", null],
    ["an aborted summary", { outcome: "aborted_before_decision" }],
    ["an aborted-after summary", { outcome: "aborted_after_decision" }],
    ["a rejected summary", { outcome: "rejected" }],
    ["a read summary", { outcome: "clean" }],
    ["a summary without counts", { outcome: "validated", counts: undefined }],
    ["a malformed value", "validated"],
  ])("returns nothing for %s", (_name, value) => {
    expect(
      validationFromSummary(
        value && typeof value === "object" ? summary(value as never) : value,
        { readable: true, collectionId: C, policyFingerprint: FINGERPRINT }
      )
    ).toBeUndefined();
  });
});
