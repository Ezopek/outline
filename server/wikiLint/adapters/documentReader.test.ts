import { randomUUID } from "node:crypto";
import type { Transaction, TransactionOptions } from "sequelize";
import { CollectionPermission, DocumentPermission } from "@shared/types";
import { parser } from "@server/editor";
import {
  Collection,
  Document,
  GroupMembership,
  UserMembership,
} from "@server/models";
import { sequelize } from "@server/storage/database";
import { withExclusiveDatabase } from "@server/test/databaseMutex";
import {
  buildCollection,
  buildDocument,
  buildDraftDocument,
  buildGroup,
  buildGroupUser,
  buildTeam,
  buildUser,
} from "@server/test/factories";
import { Deadline, DeadlineFloorError } from "../application/deadline";
import { parseCanonicalMarkdown } from "./canonicalSyntax";
import { linkLookupBatches } from "../core/internalLinks";
import {
  DocumentSnapshotError,
  authorizeLintTarget,
  isDatabaseTimeout,
  readDocumentSnapshot,
  readOnlyTransaction,
  resolveLinkTargets,
} from "./documentReader";

/** The generic instance origin of the link fixtures. */
const ORIGIN = "https://wiki.example.test";

/**
 * Builds the snapshot expected for Markdown read without links.
 *
 * @param markdown - the canonical Markdown.
 * @returns the snapshot.
 */
const snapshotOf = (markdown: string) => ({
  syntax: parseCanonicalMarkdown(markdown),
  links: null,
});

/** A fixed clock, so every batch timeout is the floored budget. */
const fixedClock = () => 0;

/**
 * Starts a deadline with a fixed remainder.
 *
 * @param budgetMs - the remainder.
 * @returns the deadline.
 */
const fixedDeadline = (budgetMs = 1234.5) => new Deadline(budgetMs, fixedClock);

/**
 * Reduces a statement to a comparable form: a SELECT becomes its first table.
 *
 * @param sql - the statement.
 * @returns the reduced statement.
 */
function statementOf(sql: string): string {
  const select = /^SELECT .*? FROM "(\w+)"/s.exec(sql);
  return select ? `SELECT ${select[1]}` : sql;
}

/**
 * Reads the options a transaction was started with.
 *
 * @param transaction - the transaction.
 * @returns its options.
 */
const optionsOf = (transaction: Transaction | undefined) =>
  (transaction as unknown as { options: TransactionOptions } | undefined)
    ?.options;

/**
 * Spies on `sequelize.query` and records each statement with its transaction.
 *
 * @returns a function that returns the recorded statements.
 */
function recordStatements() {
  const spy = vi.spyOn(sequelize, "query");
  return () =>
    spy.mock.calls.map(([sql, options]) => ({
      sql: typeof sql === "string" ? sql : sql.query,
      transaction: (options as { transaction?: Transaction } | undefined)
        ?.transaction,
    }));
}

/**
 * Builds a user with a collection and a document in it.
 *
 * @param documentOverrides - document attributes.
 * @returns the user, collection, and document.
 */
async function buildFixture(
  documentOverrides: Parameters<typeof buildDocument>[0] = {}
) {
  const user = await buildUser();
  const collection = await buildCollection({
    teamId: user.teamId,
    userId: user.id,
  });
  const document = await buildDocument({
    teamId: user.teamId,
    userId: user.id,
    collectionId: collection.id,
    ...documentOverrides,
  });
  return { user, collection, document };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("authorizeLintTarget", () => {
  it("authorizes in one read-only transaction with bounded batches", async () => {
    const { user, collection, document } = await buildFixture();
    const statements = recordStatements();

    await expect(
      authorizeLintTarget({
        id: document.id,
        actor: user,
        deadline: fixedDeadline(),
      })
    ).resolves.toEqual({
      documentId: document.id,
      collectionId: collection.id,
      collectionReadability: "readable",
    });

    const recorded = statements();
    expect(recorded.map(({ sql }) => statementOf(sql))).toEqual([
      "START TRANSACTION;",
      "SET TRANSACTION READ ONLY",
      "SET LOCAL lock_timeout = 1234",
      "SET LOCAL statement_timeout = 1234",
      "SELECT documents",
      "SELECT group_permissions",
      "SELECT group_permissions",
      "SET LOCAL lock_timeout = 1234",
      "SET LOCAL statement_timeout = 1234",
      "SELECT collections",
      "SELECT group_permissions",
      "COMMIT;",
    ]);
    const transaction = recorded[0].transaction;
    expect(transaction).toBeDefined();
    expect(optionsOf(transaction)?.readOnly).toBe(false);
    expect(recorded.every((entry) => entry.transaction === transaction)).toBe(
      true
    );
    expect(recorded.map(({ sql }) => sql).join("\n")).not.toMatch(/"text"/);
    expect(recorded[9].sql).not.toContain('"documentStructure"');
  });

  it("resolves a URL identifier with a title slug", async () => {
    const { user, document } = await buildFixture();

    await expect(
      authorizeLintTarget({
        id: `any-title-${document.urlId}`,
        actor: user,
        deadline: fixedDeadline(),
      })
    ).resolves.toEqual(expect.objectContaining({ documentId: document.id }));
  });

  it.each([
    ["an unknown UUID", () => "00000000-0000-4000-8000-000000000000"],
    ["an unmatched slug", () => "any-title-abcdefghij"],
    ["an unresolvable string", () => "not a document"],
  ])("returns null for %s", async (_name, id) => {
    const user = await buildUser();

    await expect(
      authorizeLintTarget({ id: id(), actor: user, deadline: fixedDeadline() })
    ).resolves.toBeNull();
  });

  it("returns null for another team's document", async () => {
    const { document } = await buildFixture();
    const outsider = await buildUser({ teamId: (await buildTeam()).id });

    await expect(
      authorizeLintTarget({
        id: document.id,
        actor: outsider,
        deadline: fixedDeadline(),
      })
    ).resolves.toBeNull();
  });

  it("returns null for a private document the actor cannot read", async () => {
    const owner = await buildUser();
    const collection = await buildCollection({
      teamId: owner.teamId,
      userId: owner.id,
      permission: null,
    });
    const document = await buildDocument({
      teamId: owner.teamId,
      userId: owner.id,
      collectionId: collection.id,
    });
    const member = await buildUser({ teamId: owner.teamId });

    await expect(
      authorizeLintTarget({
        id: document.id,
        actor: member,
        deadline: fixedDeadline(),
      })
    ).resolves.toBeNull();
  });

  it("marks a document-only reader's collection unreadable", async () => {
    const owner = await buildUser();
    const collection = await buildCollection({
      teamId: owner.teamId,
      userId: owner.id,
      permission: null,
    });
    const document = await buildDocument({
      teamId: owner.teamId,
      userId: owner.id,
      collectionId: collection.id,
    });
    const reader = await buildUser({ teamId: owner.teamId });
    await UserMembership.create({
      documentId: document.id,
      userId: reader.id,
      createdById: owner.id,
      permission: DocumentPermission.Read,
    });

    await expect(
      authorizeLintTarget({
        id: document.id,
        actor: reader,
        deadline: fixedDeadline(),
      })
    ).resolves.toEqual({
      documentId: document.id,
      collectionId: collection.id,
      collectionReadability: "unreadable",
    });
  });

  it("marks a document without a collection unreadable", async () => {
    const user = await buildUser();
    const draft = await buildDraftDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: null,
    });
    const statements = recordStatements();

    await expect(
      authorizeLintTarget({
        id: draft.id,
        actor: user,
        deadline: fixedDeadline(),
      })
    ).resolves.toEqual({
      documentId: draft.id,
      collectionId: null,
      collectionReadability: "unreadable",
    });
    const recorded = statements().map(({ sql }) => statementOf(sql));
    expect(recorded).not.toContain("SELECT collections");
    expect(recorded.filter((sql) => sql.startsWith("SET LOCAL"))).toHaveLength(
      2
    );
  });

  it("leaves readability unestablished when the collection lookup fails", async () => {
    const { user, collection, document } = await buildFixture();
    vi.spyOn(Collection, "findByPk").mockRejectedValue(new Error("lookup"));

    await expect(
      authorizeLintTarget({
        id: document.id,
        actor: user,
        deadline: fixedDeadline(),
      })
    ).resolves.toEqual({
      documentId: document.id,
      collectionId: collection.id,
      collectionReadability: "unestablished",
    });
  });

  it("leaves readability unestablished when its batch times out", async () => {
    const { user, collection, document } = await buildFixture();
    vi.spyOn(Collection, "findByPk").mockImplementation(
      async (_id, options) => {
        await sequelize.query("SELECT pg_sleep(5)", {
          transaction: options?.transaction,
        });
        return null;
      }
    );

    await expect(
      authorizeLintTarget({
        id: document.id,
        actor: user,
        deadline: new Deadline(800),
      })
    ).resolves.toEqual({
      documentId: document.id,
      collectionId: collection.id,
      collectionReadability: "unestablished",
    });
  });

  it("leaves readability unestablished when the floor refuses its batch", async () => {
    const { user, collection, document } = await buildFixture();
    let now = 0;
    const findByPk = Document.findByPk.bind(Document);
    vi.spyOn(Document, "findByPk").mockImplementation(async (...args) => {
      const found = await findByPk(...args);
      now = 950;
      return found;
    });
    const statements = recordStatements();

    await expect(
      authorizeLintTarget({
        id: document.id,
        actor: user,
        deadline: new Deadline(1000, () => now),
      })
    ).resolves.toEqual({
      documentId: document.id,
      collectionId: collection.id,
      collectionReadability: "unestablished",
    });
    expect(
      statements().filter(({ sql }) => sql.startsWith("SET LOCAL"))
    ).toHaveLength(2);
  });

  it("propagates a document lookup failure", async () => {
    const { user, document } = await buildFixture();
    vi.spyOn(Document, "findByPk").mockRejectedValue(new Error("lookup"));

    await expect(
      authorizeLintTarget({
        id: document.id,
        actor: user,
        deadline: fixedDeadline(),
      })
    ).rejects.toThrow("lookup");
  });

  it("refuses to start below the floor", async () => {
    const { user, document } = await buildFixture();
    const statements = recordStatements();

    await expect(
      authorizeLintTarget({
        id: document.id,
        actor: user,
        deadline: fixedDeadline(99.9),
      })
    ).rejects.toThrow(DeadlineFloorError);
    expect(
      statements().filter(
        ({ sql }) => sql.startsWith("SET LOCAL") || sql.startsWith("SELECT")
      )
    ).toEqual([]);
  });
});

describe("readDocumentSnapshot", () => {
  it("re-reads the row in one repeatable-read, read-only transaction", async () => {
    const { user, collection, document } = await buildFixture();
    const statements = recordStatements();

    await expect(
      readDocumentSnapshot({
        documentId: document.id,
        collectionId: collection.id,
        deadline: fixedDeadline(),
        actor: user,
      })
    ).resolves.toEqual(snapshotOf("This is the text in an example document"));

    const recorded = statements();
    expect(recorded.map(({ sql }) => statementOf(sql))).toEqual([
      "START TRANSACTION;",
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;",
      "SET TRANSACTION READ ONLY",
      "SET LOCAL lock_timeout = 1234",
      "SET LOCAL statement_timeout = 1234",
      "SELECT documents",
      "COMMIT;",
    ]);
    const transaction = recorded[0].transaction;
    expect(optionsOf(transaction)?.readOnly).toBe(false);
    expect(optionsOf(transaction)?.isolationLevel).toBe("REPEATABLE READ");
    expect(recorded.every((entry) => entry.transaction === transaction)).toBe(
      true
    );
    expect(recorded[5].sql).toMatch(
      /^SELECT "id", "collectionId", "deletedAt", "content", "state" FROM "documents"/
    );
  });

  it("reads drafts and archived documents", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const draft = await buildDraftDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
      text: "## Draft",
    });
    const archived = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
      archivedAt: new Date(),
      text: "## Archived",
    });

    for (const [document, markdown] of [
      [draft, "## Draft"],
      [archived, "## Archived"],
    ] as const) {
      await expect(
        authorizeLintTarget({
          id: document.id,
          actor: user,
          deadline: fixedDeadline(),
        })
      ).resolves.toEqual({
        documentId: document.id,
        collectionId: collection.id,
        collectionReadability: "readable",
      });
      await expect(
        readDocumentSnapshot({
          documentId: document.id,
          collectionId: collection.id,
          deadline: fixedDeadline(),
          actor: user,
        })
      ).resolves.toEqual(snapshotOf(markdown));
    }
  });

  it("serializes content, never a stale text column", async () => {
    const { user, collection, document } = await buildFixture({
      text: "## Stale",
      content: parser.parse("## Current")?.toJSON(),
    });

    await expect(
      readDocumentSnapshot({
        documentId: document.id,
        collectionId: collection.id,
        deadline: fixedDeadline(),
        actor: user,
      })
    ).resolves.toEqual(snapshotOf("## Current"));
  });

  it("throws after the document is soft deleted", async () => {
    const { user, collection, document } = await buildFixture();
    await authorizeLintTarget({
      id: document.id,
      actor: user,
      deadline: fixedDeadline(),
    });
    await Document.unscoped().update(
      { deletedAt: new Date() },
      { where: { id: document.id }, hooks: false }
    );

    await expect(
      readDocumentSnapshot({
        documentId: document.id,
        collectionId: collection.id,
        deadline: fixedDeadline(),
        actor: user,
      })
    ).rejects.toThrow(DocumentSnapshotError);
  });

  it("throws after the document moves to another collection", async () => {
    const { user, collection, document } = await buildFixture();
    const other = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    await authorizeLintTarget({
      id: document.id,
      actor: user,
      deadline: fixedDeadline(),
    });
    await Document.unscoped().update(
      { collectionId: other.id },
      { where: { id: document.id }, hooks: false }
    );

    await expect(
      readDocumentSnapshot({
        documentId: document.id,
        collectionId: collection.id,
        deadline: fixedDeadline(),
        actor: user,
      })
    ).rejects.toThrow(DocumentSnapshotError);
  });

  it("refuses to start below the floor", async () => {
    const { user, collection, document } = await buildFixture();
    const statements = recordStatements();

    await expect(
      readDocumentSnapshot({
        documentId: document.id,
        collectionId: collection.id,
        deadline: fixedDeadline(99),
        actor: user,
      })
    ).rejects.toThrow(DeadlineFloorError);
    expect(
      statements().filter(
        ({ sql }) => sql.startsWith("SET LOCAL") || sql.startsWith("SELECT")
      )
    ).toEqual([]);
  });
});

describe("readDocumentSnapshot with internal links", () => {
  /**
   * Builds a UUID that no document has.
   *
   * @param index - a distinguishing number.
   * @returns the UUID.
   */
  const missingUuid = (index: number) =>
    `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

  /**
   * Builds Markdown that links each reference in its own paragraph.
   *
   * @param refs - the document references.
   * @returns the Markdown.
   */
  const linking = (refs: string[]) =>
    refs.map((ref, index) => `[link ${index}](/doc/${ref})`).join("\n\n");

  it("resolves only targets the actor can read, in the snapshot", async () => {
    const actor = await buildUser();
    const collection = await buildCollection({
      teamId: actor.teamId,
      userId: actor.id,
    });
    const readable = await buildDocument({
      teamId: actor.teamId,
      userId: actor.id,
      collectionId: collection.id,
    });
    const draft = await buildDraftDocument({
      teamId: actor.teamId,
      userId: actor.id,
      collectionId: collection.id,
    });
    const archived = await buildDocument({
      teamId: actor.teamId,
      userId: actor.id,
      collectionId: collection.id,
      archivedAt: new Date(),
    });
    const deleted = await buildDocument({
      teamId: actor.teamId,
      userId: actor.id,
      collectionId: collection.id,
    });
    await deleted.destroy();

    const owner = await buildUser({ teamId: actor.teamId });
    const privateCollection = await buildCollection({
      teamId: owner.teamId,
      userId: owner.id,
      permission: null,
    });
    const shared = await buildDocument({
      teamId: owner.teamId,
      userId: owner.id,
      collectionId: privateCollection.id,
    });
    await UserMembership.create({
      documentId: shared.id,
      userId: actor.id,
      createdById: owner.id,
      permission: DocumentPermission.Read,
    });
    const protectedDocument = await buildDocument({
      teamId: owner.teamId,
      userId: owner.id,
      collectionId: privateCollection.id,
    });
    const foreign = await buildDocument();

    // Targets readable only through a group: one shared with the group on the
    // document, one in a private collection shared with the group.
    const group = await buildGroup({ teamId: owner.teamId, userId: owner.id });
    await buildGroupUser({
      groupId: group.id,
      userId: actor.id,
      teamId: actor.teamId,
    });
    const groupShared = await buildDocument({
      teamId: owner.teamId,
      userId: owner.id,
      collectionId: privateCollection.id,
    });
    await GroupMembership.create({
      createdById: owner.id,
      documentId: groupShared.id,
      groupId: group.id,
      permission: DocumentPermission.Read,
    });
    const groupCollection = await buildCollection({
      teamId: owner.teamId,
      userId: owner.id,
      permission: null,
    });
    await GroupMembership.create({
      createdById: owner.id,
      collectionId: groupCollection.id,
      groupId: group.id,
      permission: CollectionPermission.Read,
    });
    const inGroupCollection = await buildDocument({
      teamId: owner.teamId,
      userId: owner.id,
      collectionId: groupCollection.id,
    });

    // A readable document whose URL identifier equals the last group of a
    // UUID that no document has.
    const collisionUuid = randomUUID();
    const collision = await buildDocument({
      teamId: actor.teamId,
      userId: actor.id,
      collectionId: collection.id,
    });
    await Document.unscoped().update(
      { urlId: collisionUuid.split("-")[4] },
      { where: { id: collision.id }, hooks: false, validate: false }
    );

    const source = await buildDocument({
      teamId: actor.teamId,
      userId: actor.id,
      collectionId: collection.id,
      text: linking([
        readable.id.toUpperCase(),
        `any-title-${readable.urlId}`,
        draft.id,
        archived.urlId,
        shared.id,
        groupShared.id,
        inGroupCollection.urlId,
        deleted.id,
        protectedDocument.id,
        `any-title-${protectedDocument.urlId}`,
        foreign.id,
        missingUuid(1),
        "abcdefghij",
        collisionUuid,
        collisionUuid.split("-")[4],
      ]),
    });

    const snapshot = await readDocumentSnapshot({
      documentId: source.id,
      collectionId: collection.id,
      deadline: fixedDeadline(),
      actor,
      instanceOrigin: ORIGIN,
    });

    expect(snapshot.links?.references.map(({ key }) => key)).toEqual([
      readable.id,
      readable.urlId,
      draft.id,
      archived.urlId,
      shared.id,
      groupShared.id,
      inGroupCollection.urlId,
      deleted.id,
      protectedDocument.id,
      protectedDocument.urlId,
      foreign.id,
      missingUuid(1),
      "abcdefghij",
      collisionUuid,
      collisionUuid.split("-")[4],
    ]);
    expect(Object.fromEntries(snapshot.links?.targets ?? [])).toEqual({
      [readable.id]: "resolved",
      [readable.urlId]: "resolved",
      [draft.id]: "resolved",
      [archived.urlId]: "resolved",
      [shared.id]: "resolved",
      [groupShared.id]: "resolved",
      [inGroupCollection.urlId]: "resolved",
      [deleted.id]: "unresolved",
      [protectedDocument.id]: "unresolved",
      [protectedDocument.urlId]: "unresolved",
      [foreign.id]: "unresolved",
      [missingUuid(1)]: "unresolved",
      abcdefghij: "unresolved",
      [collisionUuid]: "unresolved",
      [collisionUuid.split("-")[4]]: "resolved",
    });
    expect(snapshot.syntax.links).toHaveLength(15);
  });

  it("resolves nothing without an instance origin", async () => {
    const { user, collection, document } = await buildFixture({
      text: linking([missingUuid(1)]),
    });
    const statements = recordStatements();

    const snapshot = await readDocumentSnapshot({
      documentId: document.id,
      collectionId: collection.id,
      deadline: fixedDeadline(),
      actor: user,
    });

    expect(snapshot.links).toBeNull();
    expect(snapshot.syntax.links).toHaveLength(1);
    expect(
      statements().filter(({ sql }) => statementOf(sql) === "SELECT documents")
    ).toHaveLength(1);
  });

  it("resolves 501 keys in two bounded, sorted batches before commit", async () => {
    const keys = Array.from({ length: 501 }, (_, index) =>
      missingUuid(1000 - index)
    );
    const { user, collection, document } = await buildFixture({
      text: linking(keys),
    });
    const statements = recordStatements();

    const snapshot = await readDocumentSnapshot({
      documentId: document.id,
      collectionId: collection.id,
      deadline: fixedDeadline(),
      actor: user,
      instanceOrigin: ORIGIN,
    });

    expect(snapshot.links?.references).toHaveLength(501);
    expect([...(snapshot.links?.targets.values() ?? [])]).toEqual(
      keys.map(() => "unresolved")
    );

    const recorded = statements();
    expect(recorded.map(({ sql }) => statementOf(sql))).toEqual([
      "START TRANSACTION;",
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;",
      "SET TRANSACTION READ ONLY",
      "SET LOCAL lock_timeout = 1234",
      "SET LOCAL statement_timeout = 1234",
      "SELECT documents",
      "SET LOCAL lock_timeout = 1234",
      "SET LOCAL statement_timeout = 1234",
      "SELECT documents",
      "SET LOCAL lock_timeout = 1234",
      "SET LOCAL statement_timeout = 1234",
      "SELECT documents",
      "COMMIT;",
    ]);
    const transaction = recorded[0].transaction;
    expect(recorded.every((entry) => entry.transaction === transaction)).toBe(
      true
    );

    const sorted = [...keys].sort();
    const keysIn = (sql: string) =>
      [
        ...(/"id" IN \(([^)]*)\)/.exec(sql)?.[1] ?? "").matchAll(
          /'([0-9a-f-]{36})'/g
        ),
      ].map((match) => match[1]);
    expect(keysIn(recorded[8].sql)).toEqual(sorted.slice(0, 500));
    expect(keysIn(recorded[11].sql)).toEqual(sorted.slice(500));
    for (const index of [8, 11]) {
      expect(recorded[index].sql).toContain(
        `"document"."teamId" = '${user.teamId}'`
      );
      expect(recorded[index].sql).not.toMatch(
        /"document"\."(text|content|state)"/
      );
    }
    expect(
      recorded.filter(({ sql }) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql))
    ).toEqual([]);
  });

  it("refuses a link batch below the floor", async () => {
    const { user, collection, document } = await buildFixture({
      text: linking([missingUuid(1)]),
    });
    // The deadline starts and bounds the opening and the re-read at 0 ms;
    // 950 ms have passed when the link batch is bounded.
    let readings = 0;
    const clock = () => (readings++ < 3 ? 0 : 950);
    const statements = recordStatements();

    await expect(
      readDocumentSnapshot({
        documentId: document.id,
        collectionId: collection.id,
        deadline: new Deadline(1000, clock),
        actor: user,
        instanceOrigin: ORIGIN,
      })
    ).rejects.toThrow(DeadlineFloorError);

    const recorded = statements().map(({ sql }) => statementOf(sql));
    expect(recorded.filter((sql) => sql.startsWith("SET LOCAL"))).toHaveLength(
      2
    );
    expect(recorded.filter((sql) => sql === "SELECT documents")).toHaveLength(
      1
    );
    expect(recorded.at(-1)).toBe("ROLLBACK;");
  });
});

describe("resolveLinkTargets with a read wrapper", () => {
  /**
   * Builds the references of some keys.
   *
   * @param keys - lowercased document UUIDs.
   * @returns the references.
   */
  const referencesOf = (keys: string[]) =>
    keys.map((key) => ({ key, keyKind: "id" as const, position: null }));

  it("wraps only each batch's read, after the batch is bounded", async () => {
    const { user, document } = await buildFixture();
    const keys = [
      document.id,
      ...Array.from(
        { length: 500 },
        (_, index) =>
          `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
      ),
    ];
    const statements = recordStatements();
    const reads: { from: number; to: number }[] = [];

    const targets = await sequelize.transaction((transaction) =>
      resolveLinkTargets({
        batches: linkLookupBatches(referencesOf(keys)),
        actor: user,
        transaction,
        deadline: fixedDeadline(),
        read: async (run) => {
          const from = statements().length;
          const result = await run();
          reads.push({ from, to: statements().length });
          return result;
        },
      })
    );

    expect(targets.get(document.id)).toBe("resolved");
    expect(targets.size).toBe(501);
    expect(
      [...targets.values()].filter((state) => state === "unresolved")
    ).toHaveLength(500);
    const recorded = statements().map(({ sql }) => statementOf(sql));
    expect(reads).toHaveLength(2);
    for (const { from, to } of reads) {
      expect(recorded.slice(from - 2, from)).toEqual([
        "SET LOCAL lock_timeout = 1234",
        "SET LOCAL statement_timeout = 1234",
      ]);
      // The membership includes may add their own reads, never a bound.
      const inside = recorded.slice(from, to);
      expect(inside[0]).toBe("SELECT documents");
      expect(inside.filter((sql) => sql.startsWith("SET LOCAL"))).toEqual([]);
    }
  });

  it("propagates the wrapper's error and stops", async () => {
    const { user } = await buildFixture();
    const failure = new Error("wrapped read failed");
    const read = vi.fn(() => Promise.reject(failure));

    await expect(
      sequelize.transaction((transaction) =>
        resolveLinkTargets({
          batches: [
            [{ key: randomUUID(), keyKind: "id" }],
            [{ key: randomUUID(), keyKind: "id" }],
          ],
          actor: user,
          transaction,
          deadline: fixedDeadline(),
          read,
        })
      )
    ).rejects.toBe(failure);
    expect(read).toHaveBeenCalledTimes(1);
  });
});

/** PostgreSQL's `lock_not_available`, the only lock failure that is retried. */
const LOCK_NOT_AVAILABLE = "55P03";

/** The number of `NOWAIT` lock attempts before the test gives up. */
const LOCK_ATTEMPTS = 100;

/** The pause between two `NOWAIT` lock attempts. */
const LOCK_RETRY_MS = 50;

/**
 * Opens a transaction holding `documents` in ACCESS EXCLUSIVE mode without
 * ever waiting in the lock queue, where it would queue every other worker's
 * read of `documents` behind it. A `lock_not_available` attempt is rolled back
 * and retried from a fresh transaction after a short pause.
 *
 * @param attempts - the retry budget.
 * @param retryMs - the pause between two attempts.
 * @returns the transaction holding the lock.
 * @throws when the lock is not granted within the retry budget, or on any
 * other error from the lock statement or a rollback.
 */
const lockDocumentsTable = async (
  attempts = LOCK_ATTEMPTS,
  retryMs = LOCK_RETRY_MS
): Promise<Transaction> => {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const holder = await sequelize.transaction();
    try {
      await sequelize.query(
        "LOCK TABLE documents IN ACCESS EXCLUSIVE MODE NOWAIT",
        { transaction: holder }
      );
      return holder;
    } catch (error) {
      await holder.rollback();
      const code = (error as { parent?: { code?: unknown } }).parent?.code;
      if (code !== LOCK_NOT_AVAILABLE) {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, retryMs));
  }
  throw new Error(
    `Could not acquire the documents table lock in ${attempts} attempts`
  );
};

/**
 * Opens a transaction holding `documents` in ACCESS SHARE mode, the lock any
 * open read of `documents` holds, which conflicts with ACCESS EXCLUSIVE.
 *
 * @returns the blocking transaction.
 */
const blockDocumentsTable = async (): Promise<Transaction> => {
  const blocker = await sequelize.transaction();
  await sequelize.query("LOCK TABLE documents IN ACCESS SHARE MODE", {
    transaction: blocker,
  });
  return blocker;
};

/**
 * Records every transaction opened from now on, with its rollback spied on.
 *
 * @returns the opened transactions with their rollback spies, in order.
 */
function recordTransactions() {
  const open = sequelize.transaction.bind(
    sequelize
  ) as () => Promise<Transaction>;
  const opened: {
    transaction: Transaction;
    rollback: ReturnType<typeof vi.spyOn>;
  }[] = [];
  vi.spyOn(sequelize, "transaction").mockImplementation((async () => {
    const transaction = await open();
    opened.push({ transaction, rollback: vi.spyOn(transaction, "rollback") });
    return transaction;
  }) as typeof sequelize.transaction);
  return opened;
}

describe("lockDocumentsTable", () => {
  it("retries a busy table from a fresh transaction until it is granted", async () => {
    const blocker = await blockDocumentsTable();
    const opened = recordTransactions();
    const locking = lockDocumentsTable(LOCK_ATTEMPTS, 10);
    try {
      await vi.waitFor(() => expect(opened.length).toBeGreaterThan(2));
    } finally {
      await blocker.rollback();
    }
    const holder = await locking;
    try {
      const granted = opened.at(-1);
      expect(granted?.transaction).toBe(holder);
      expect(granted?.rollback).not.toHaveBeenCalled();
      for (const { rollback } of opened.slice(0, -1)) {
        expect(rollback).toHaveBeenCalledOnce();
      }
    } finally {
      await holder.rollback();
    }
  });

  it("fails naming the lock when the table stays busy for the whole budget", async () => {
    const blocker = await blockDocumentsTable();
    const opened = recordTransactions();
    const statements = recordStatements();
    try {
      await expect(lockDocumentsTable(3, 10)).rejects.toThrow(
        "Could not acquire the documents table lock in 3 attempts"
      );
    } finally {
      await blocker.rollback();
    }
    expect(opened).toHaveLength(3);
    for (const { rollback } of opened) {
      expect(rollback).toHaveBeenCalledOnce();
    }
    expect(
      statements()
        .filter(({ transaction }) => transaction !== blocker)
        .map(({ sql }) => sql)
    ).toEqual(
      Array.from({ length: 3 }).flatMap(() => [
        "START TRANSACTION;",
        "LOCK TABLE documents IN ACCESS EXCLUSIVE MODE NOWAIT",
        "ROLLBACK;",
      ])
    );
  });
});

describe("database timeouts", () => {
  it("times out behind an exclusive lock held by another transaction", async () => {
    const { user, collection, document } = await buildFixture();
    // Holding `documents` exclusively would time out other workers' enforced
    // writes, so no other test file may run meanwhile. The test timeout covers
    // waiting for the other worker's current test file to end.
    await withExclusiveDatabase(async () => {
      const holder = await lockDocumentsTable();
      try {
        const snapshotError = await readDocumentSnapshot({
          documentId: document.id,
          collectionId: collection.id,
          deadline: new Deadline(400),
          actor: user,
        }).catch((error: unknown) => error);
        expect(isDatabaseTimeout(snapshotError)).toBe(true);

        const lookupError = await authorizeLintTarget({
          id: document.id,
          actor: user,
          deadline: new Deadline(400),
        }).catch((error: unknown) => error);
        expect(lookupError).toBeInstanceOf(Error);
        expect(isDatabaseTimeout(lookupError)).toBe(true);
      } finally {
        await holder.rollback();
      }
    });
  }, 300_000);

  it("does not treat other errors as timeouts", () => {
    expect(isDatabaseTimeout(new Error("canceling statement"))).toBe(false);
    expect(isDatabaseTimeout(new DocumentSnapshotError())).toBe(false);
  });
});

describe("readOnlyTransaction", () => {
  it("propagates a failed commit", async () => {
    const failure = new Error("commit");
    const commit = vi.fn().mockRejectedValue(failure);
    const rollback = vi.fn();
    const transaction = { commit, rollback } as unknown as Transaction;
    vi.spyOn(sequelize, "transaction").mockResolvedValue(transaction);
    vi.spyOn(sequelize, "query").mockResolvedValue(undefined as never);

    await expect(
      readOnlyTransaction({ deadline: fixedDeadline() }, async () => "read")
    ).rejects.toBe(failure);
    expect(commit).toHaveBeenCalledOnce();
    expect(rollback).not.toHaveBeenCalled();
  });

  it("preserves the work error when rollback fails", async () => {
    const failure = new Error("work");
    const rollback = vi.fn().mockRejectedValue(new Error("rollback"));
    const commit = vi.fn();
    const transaction = { commit, rollback } as unknown as Transaction;
    vi.spyOn(sequelize, "transaction").mockResolvedValue(transaction);
    vi.spyOn(sequelize, "query").mockResolvedValue(undefined as never);

    await expect(
      readOnlyTransaction({ deadline: fixedDeadline() }, async () => {
        throw failure;
      })
    ).rejects.toBe(failure);
    expect(rollback).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
  });

  it("keeps the error of an opening that fails before its bound", async () => {
    const failure = new Error("acquisition");
    vi.spyOn(sequelize, "transaction").mockRejectedValue(failure);
    const run = vi.fn();

    await expect(
      readOnlyTransaction({ deadline: fixedDeadline() }, run)
    ).rejects.toBe(failure);
    expect(run).not.toHaveBeenCalled();
  });

  it("absorbs the rejection and the failed rollback of a late opening", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const openings: {
      resolve: (transaction: Transaction) => void;
      reject: (error: Error) => void;
    }[] = [];
    vi.spyOn(sequelize, "transaction").mockImplementation(
      (() =>
        new Promise<Transaction>((resolve, reject) => {
          openings.push({ resolve, reject });
        })) as typeof sequelize.transaction
    );
    const rollback = vi.fn().mockRejectedValue(new Error("rollback"));

    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        await expect(
          readOnlyTransaction({ deadline: new Deadline(150) }, async () => 0)
        ).rejects.toThrow(DeadlineFloorError);
      }

      openings[0].reject(new Error("late"));
      openings[1].resolve({ rollback } as unknown as Transaction);
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      expect(rollback).toHaveBeenCalledTimes(1);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});
