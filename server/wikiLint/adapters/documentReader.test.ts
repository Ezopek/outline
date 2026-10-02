import type { Transaction, TransactionOptions } from "sequelize";
import { DocumentPermission } from "@shared/types";
import { parser } from "@server/editor";
import { Collection, Document, UserMembership } from "@server/models";
import { sequelize } from "@server/storage/database";
import {
  buildCollection,
  buildDocument,
  buildDraftDocument,
  buildTeam,
  buildUser,
} from "@server/test/factories";
import { Deadline, DeadlineFloorError } from "../application/deadline";
import {
  DocumentSnapshotError,
  authorizeLintTarget,
  isDatabaseTimeout,
  readDocumentSnapshot,
} from "./documentReader";

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
    const { collection, document } = await buildFixture();
    const statements = recordStatements();

    await expect(
      readDocumentSnapshot({
        documentId: document.id,
        collectionId: collection.id,
        deadline: fixedDeadline(),
      })
    ).resolves.toBe("This is the text in an example document");

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
        })
      ).resolves.toBe(markdown);
    }
  });

  it("serializes content, never a stale text column", async () => {
    const { collection, document } = await buildFixture({
      text: "## Stale",
      content: parser.parse("## Current")?.toJSON(),
    });

    await expect(
      readDocumentSnapshot({
        documentId: document.id,
        collectionId: collection.id,
        deadline: fixedDeadline(),
      })
    ).resolves.toBe("## Current");
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
      })
    ).rejects.toThrow(DocumentSnapshotError);
  });

  it("refuses to start below the floor", async () => {
    const { collection, document } = await buildFixture();
    const statements = recordStatements();

    await expect(
      readDocumentSnapshot({
        documentId: document.id,
        collectionId: collection.id,
        deadline: fixedDeadline(99),
      })
    ).rejects.toThrow(DeadlineFloorError);
    expect(
      statements().filter(
        ({ sql }) => sql.startsWith("SET LOCAL") || sql.startsWith("SELECT")
      )
    ).toEqual([]);
  });
});

describe("database timeouts", () => {
  it("times out behind an exclusive lock held by another transaction", async () => {
    const { user, collection, document } = await buildFixture();
    const holder = await sequelize.transaction();
    try {
      await sequelize.query("LOCK TABLE documents IN ACCESS EXCLUSIVE MODE", {
        transaction: holder,
      });

      const snapshotError = await readDocumentSnapshot({
        documentId: document.id,
        collectionId: collection.id,
        deadline: new Deadline(400),
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

  it("does not treat other errors as timeouts", () => {
    expect(isDatabaseTimeout(new Error("canceling statement"))).toBe(false);
    expect(isDatabaseTimeout(new DocumentSnapshotError())).toBe(false);
  });
});
