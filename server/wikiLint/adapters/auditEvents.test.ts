import { randomUUID } from "node:crypto";
import { QueryTypes } from "sequelize";
import { globalEventQueue } from "@server/queues";
import { sequelize } from "@server/storage/database";
import { buildCollection, buildUser } from "@server/test/factories";
import type { AuditDataV1, AuditEventRow } from "./auditEvents";
import { insertAuditEvent } from "./auditEvents";

const data: AuditDataV1 = {
  schemaVersion: 1,
  requestId: "00000000-0000-4000-8000-00000000a001",
  operation: "lint_wiki",
  outcome: "findings",
  complete: true,
  durationMs: 12,
  scopeKind: "collection",
  policySchemaVersion: 1,
  policyFingerprint: `sha256:${"a".repeat(64)}`,
  evaluatedDocumentCount: 2,
  evaluatedLinkCount: 3,
  counts: {
    errors: 1,
    warnings: 0,
    systemFailures: 0,
    byCode: { REQUIRED_SECTION_MISSING: 1 },
  },
  runtimeFailOpenExercised: false,
  credentialAuthType: "oauth",
  authenticatedClientId: "client-k",
};

/**
 * Builds the row of a collection summary.
 *
 * @returns the row.
 */
async function buildRow(): Promise<AuditEventRow> {
  const user = await buildUser();
  const collection = await buildCollection({
    teamId: user.teamId,
    userId: user.id,
  });
  return {
    id: randomUUID(),
    name: "wikiLint.wiki",
    teamId: user.teamId,
    actorId: user.id,
    ip: "::ffff:127.0.0.1",
    collectionId: collection.id,
    data,
  };
}

/**
 * Reads the stored columns of an Event.
 *
 * @param id - the Event ID.
 * @returns the rows with that ID.
 */
const storedRows = (id: string) =>
  sequelize.query<Record<string, unknown>>(
    `SELECT * FROM events WHERE "id" = $1`,
    { bind: [id], type: QueryTypes.SELECT }
  );

describe("insertAuditEvent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("inserts the exact row with a normalized IP", async () => {
    const row = await buildRow();
    const before = new Date();

    await insertAuditEvent(row, 3000);

    const [stored, ...rest] = await storedRows(row.id);
    expect(rest).toEqual([]);
    const { createdAt, ...columns } = stored;
    expect(columns).toStrictEqual({
      id: row.id,
      name: "wikiLint.wiki",
      data,
      userId: null,
      collectionId: row.collectionId,
      teamId: row.teamId,
      documentId: null,
      actorId: row.actorId,
      modelId: null,
      ip: "127.0.0.1",
      changes: null,
      authType: "mcp",
    });
    expect(createdAt).toBeInstanceOf(Date);
    expect((createdAt as Date).getTime()).toBeGreaterThanOrEqual(
      before.getTime() - 1000
    );
  });

  it("stores a document column and leaves the collection column empty", async () => {
    const row = await buildRow();
    const documentId = randomUUID();

    await insertAuditEvent(
      { ...row, collectionId: undefined, documentId },
      3000
    );

    const [stored] = await storedRows(row.id);
    expect(stored).toMatchObject({ documentId, collectionId: null });
  });

  it("keeps the first row when the same ID is inserted again", async () => {
    const row = await buildRow();

    await insertAuditEvent(row, 3000);
    await insertAuditEvent(
      { ...row, data: { ...data, outcome: "clean", durationMs: 99 } },
      3000
    );

    const rows = await storedRows(row.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].data).toStrictEqual(data);
  });

  it("sets the statement timeout before the insert in the same transaction", async () => {
    const row = await buildRow();
    const query = vi.spyOn(sequelize, "query");

    await insertAuditEvent(row, 3000);

    const calls = query.mock.calls.map(([sql, options]) => ({
      sql: typeof sql === "string" ? sql : sql.query,
      transaction: (options as { transaction?: unknown } | undefined)
        ?.transaction,
    }));
    const timeout = calls.findIndex(
      ({ sql }) => sql === "SET LOCAL statement_timeout = 3000"
    );
    const insert = calls.findIndex(({ sql }) =>
      /^\s*INSERT INTO events\b/.test(sql)
    );
    expect(timeout).toBeGreaterThanOrEqual(0);
    expect(insert).toBeGreaterThan(timeout);
    expect(calls[timeout].transaction).toBeDefined();
    expect(calls[insert].transaction).toBe(calls[timeout].transaction);
    expect(calls[insert].sql).toContain('ON CONFLICT ("id") DO UPDATE');
    expect(calls[insert].sql).not.toContain(row.teamId);
  });

  describe("a repeated write summary", () => {
    /**
     * Builds the data of a write summary.
     *
     * @param outcome - the outcome.
     * @returns the data.
     */
    const writeData = (outcome: AuditDataV1["outcome"]): AuditDataV1 => ({
      ...data,
      operation: "create_document",
      outcome,
      complete: false,
      evaluatedDocumentCount: 0,
      evaluatedLinkCount: 0,
      counts: { errors: 0, warnings: 0, systemFailures: 0, byCode: {} },
    });

    /**
     * Writes a stored summary and then an incoming one with the same ID.
     *
     * @param stored - the stored outcome.
     * @param incoming - the incoming outcome.
     * @param name - the incoming Event name.
     * @returns the rows, the stored creation time, and the incoming row.
     */
    async function writeTwice(
      stored: AuditDataV1["outcome"],
      incoming: AuditDataV1["outcome"],
      name: AuditEventRow["name"] = "wikiLint.write_validation"
    ) {
      const row = await buildRow();
      const first: AuditEventRow = {
        ...row,
        name: "wikiLint.write_validation",
        data: writeData(stored),
      };
      await insertAuditEvent(first, 3000);
      const [{ createdAt }] = await storedRows(row.id);
      const second: AuditEventRow = {
        ...row,
        name,
        documentId: randomUUID(),
        collectionId: (await buildRow()).collectionId,
        data: { ...writeData(incoming), durationMs: 77 },
      };
      await insertAuditEvent(second, 3000);
      return { rows: await storedRows(row.id), createdAt, first, second };
    }

    it.each([
      ["aborted_before_decision", "validated"],
      ["aborted_after_decision", "validated_with_warnings"],
      ["rejected", "degraded_validation"],
    ] as const)(
      "replaces a stored %s summary with a committed %s one, keeping its creation time",
      async (stored, incoming) => {
        const { rows, createdAt, second } = await writeTwice(stored, incoming);

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          data: second.data,
          documentId: second.documentId,
          collectionId: second.collectionId,
          createdAt,
        });
      }
    );

    it.each([
      ["validated", "aborted_before_decision"],
      ["validated", "rejected"],
      ["validated", "validated_with_warnings"],
      ["aborted_before_decision", "aborted_after_decision"],
      ["rejected", "aborted_before_decision"],
    ] as const)(
      "keeps a stored %s summary over an incoming %s one",
      async (stored, incoming) => {
        const { rows, first } = await writeTwice(stored, incoming);

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          data: first.data,
          documentId: null,
          collectionId: first.collectionId,
        });
      }
    );

    it("never replaces a row of another name", async () => {
      const { rows, first } = await writeTwice(
        "aborted_before_decision",
        "validated",
        "wikiLint.document"
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        name: "wikiLint.write_validation",
        data: first.data,
        documentId: null,
      });
    });
  });

  it("never enqueues the Event", async () => {
    const row = await buildRow();
    const add = vi.spyOn(globalEventQueue(), "add");

    await insertAuditEvent(row, 3000);

    expect(add).not.toHaveBeenCalled();
  });

  it("is served by the team, name, and creation-time index", async () => {
    const indexes = await sequelize.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'events'`,
      { type: QueryTypes.SELECT }
    );

    expect(
      indexes.some(({ indexdef }) =>
        indexdef.endsWith('("teamId", name, "createdAt")')
      )
    ).toBe(true);
  });
});
