import { createHash, randomUUID } from "node:crypto";
import type { Transaction, TransactionOptions } from "sequelize";
import {
  CollectionPermission,
  DocumentPermission,
  FileOperationType,
  type NavigationNode,
} from "@shared/types";
import { parser } from "@server/editor";
import {
  Collection,
  Document,
  GroupMembership,
  type User,
  UserMembership,
} from "@server/models";
import { sequelize } from "@server/storage/database";
import {
  buildAdmin,
  buildCollection,
  buildDocument,
  buildDraftDocument,
  buildFileOperation,
  buildGroup,
  buildGroupUser,
  buildTeam,
  buildUser,
} from "@server/test/factories";
import { Deadline, DeadlineFloorError } from "../application/deadline";
import type { WikiSnapshot } from "../core/contracts";
import type { PolicySetEntry } from "../core/policySet";
import { buildPolicySet } from "../core/policySet";
import { parseCanonicalMarkdown } from "./canonicalSyntax";
import type { WikiScope, WikiSnapshotRead } from "./wikiReader";
import {
  WIKI_DOCUMENT_BATCH_SIZE,
  authorizeLintCollection,
  readWikiSnapshot,
  structureDocumentIds,
} from "./wikiReader";

/** The generic instance origin of the link fixtures. */
const ORIGIN = "https://wiki.example.test";

const sha256Hex = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** Document rules only. */
const documentPolicy = {
  activation: "read_only",
  rules: [{ kind: "allowed_heading_levels", levels: [2, 3] }],
};

/** A document rule plus `internal_links`. */
const linkPolicy = {
  activation: "read_only",
  rules: [
    { kind: "allowed_heading_levels", levels: [2, 3] },
    { kind: "internal_links" },
  ],
};

/** Hierarchy rules only. */
const hierarchyPolicy = {
  activation: "read_only",
  rules: [{ kind: "hierarchy_acyclic" }, { kind: "parent_document_resolved" }],
};

/** An entry that fails validation, so it becomes a sentinel. */
const invalidPolicy = { activation: "read_only", rules: [] };

/**
 * Builds a global-index policy.
 *
 * @param surfaceDocumentId - the surface document.
 * @param globalIndexDocumentIds - the configured global indexes.
 * @returns the policy.
 */
const globalIndexPolicy = (
  surfaceDocumentId: string,
  globalIndexDocumentIds: string[]
) => ({
  activation: "read_only",
  rules: [
    {
      kind: "global_index_links",
      surfaceDocumentId,
      globalIndexDocumentIds,
    },
  ],
});

/**
 * Builds the policy set entries of factory collection IDs.
 *
 * @param collections - the policy entry of each collection ID.
 * @returns the sorted entries.
 */
function entriesFor(
  collections: Record<string, unknown>
): readonly PolicySetEntry[] {
  const result = buildPolicySet(
    Buffer.from(JSON.stringify({ schemaVersion: 1, collections }), "utf8"),
    sha256Hex
  );
  if (!result.ok) {
    throw new Error("The test configuration must load");
  }
  return result.policySet.entries;
}

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
 * Reduces a statement to a comparable form: a SELECT becomes its kind.
 *
 * @param sql - the statement.
 * @returns the reduced statement.
 */
function statementOf(sql: string): string {
  if (sql.startsWith('SELECT "id", "content", "state" FROM "documents"')) {
    return "SELECT content";
  }
  if (sql.startsWith('SELECT "id", "documentStructure" FROM "collections"')) {
    return "SELECT structure";
  }
  const select = /^SELECT .*? FROM "(\w+)"/s.exec(sql);
  if (select?.[1] === "documents") {
    return sql.includes(`LIMIT ${WIKI_DOCUMENT_BATCH_SIZE}`)
      ? "SELECT documents"
      : "SELECT lookup";
  }
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
 * Reduces recorded statements, without the separate membership SELECTs that
 * follow a query call.
 *
 * @param recorded - the recorded statements.
 * @returns the reduced statements.
 */
const reduced = (recorded: { sql: string }[]) =>
  recorded
    .map(({ sql }) => statementOf(sql))
    .filter((sql) => sql !== "SELECT group_permissions");

/** The bounded batch pair of the fixed deadline. */
const BOUND = [
  "SET LOCAL lock_timeout = 1234",
  "SET LOCAL statement_timeout = 1234",
];

/**
 * Returns the UUIDs a lookup SELECT asks for by `id`.
 *
 * @param sql - the statement.
 * @returns the UUIDs, in statement order.
 */
const keysIn = (sql: string) =>
  [
    ...(/"id" IN \(([^)]*)\)/.exec(sql)?.[1] ?? "").matchAll(
      /'([0-9a-f-]{36})'/g
    ),
  ].map((match) => match[1]);

/**
 * Asserts that statements read no document text and write nothing. No table
 * the snapshot reads besides `documents` has a `text` column, so any quoted
 * `text` identifier, qualified or not, is the document text.
 *
 * @param recorded - the recorded statements.
 */
function expectReadOnly(recorded: { sql: string }[]) {
  expect(recorded.filter(({ sql }) => /"text"/.test(sql))).toEqual([]);
  expect(
    recorded.filter(({ sql }) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql))
  ).toEqual([]);
}

/**
 * Reads a snapshot with the fixed deadline.
 *
 * @param input.scope - the scope; the default scope by default.
 * @param input.entries - the policy set entries.
 * @param input.actor - the acting user.
 * @param input.deadline - the deadline; the fixed deadline by default.
 * @returns the snapshot read.
 */
function read(input: {
  scope?: WikiScope;
  entries: readonly PolicySetEntry[];
  actor: User;
  deadline?: Deadline;
}): Promise<WikiSnapshotRead> {
  return readWikiSnapshot({
    scope: input.scope ?? { kind: "configured_collections" },
    entries: input.entries,
    actor: input.actor,
    deadline: input.deadline ?? fixedDeadline(),
    instanceOrigin: ORIGIN,
  });
}

/**
 * Reads a snapshot that must succeed.
 *
 * @param input - as for `read`.
 * @returns the snapshot.
 */
async function snapshotOf(input: Parameters<typeof read>[0]) {
  const result = await read(input);
  if (!result.ok) {
    throw result.error;
  }
  return result.snapshot;
}

/**
 * Serializes a snapshot with its targets as sorted entries.
 *
 * @param snapshot - the snapshot.
 * @returns the JSON.
 */
const serialize = (snapshot: WikiSnapshot) =>
  JSON.stringify({
    ...snapshot,
    targets: [...snapshot.targets.entries()].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    ),
  });

/**
 * Builds a user with a readable collection.
 *
 * @returns the user and collection.
 */
async function buildReadableCollection() {
  const user = await buildUser();
  const collection = await buildCollection({
    teamId: user.teamId,
    userId: user.id,
  });
  return { user, collection };
}

/**
 * Builds a published document in a collection.
 *
 * @param user - the creator.
 * @param collectionId - the collection.
 * @param overrides - other document attributes.
 * @returns the document.
 */
const publishedIn = (
  user: User,
  collectionId: string,
  overrides: Parameters<typeof buildDocument>[0] = {}
) =>
  buildDocument({
    teamId: user.teamId,
    userId: user.id,
    collectionId,
    ...overrides,
  });

/**
 * Builds a missing document UUID.
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

/**
 * Builds a private collection owned by another user of the actor's team.
 *
 * @param actor - the acting user.
 * @returns the owner and collection.
 */
async function buildPrivateCollection(actor: User) {
  const owner = await buildUser({ teamId: actor.teamId });
  const collection = await buildCollection({
    teamId: owner.teamId,
    userId: owner.id,
    permission: null,
  });
  return { owner, collection };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("authorizeLintCollection", () => {
  it("authorizes in one bounded read-only transaction", async () => {
    const { user, collection } = await buildReadableCollection();
    const statements = recordStatements();

    await expect(
      authorizeLintCollection({
        id: collection.id,
        actor: user,
        deadline: fixedDeadline(),
      })
    ).resolves.toBe(collection.id);

    const recorded = statements();
    expect(recorded.map(({ sql }) => statementOf(sql))).toEqual([
      "START TRANSACTION;",
      "SET TRANSACTION READ ONLY",
      ...BOUND,
      "SELECT collections",
      "SELECT group_permissions",
      "COMMIT;",
    ]);
    const transaction = recorded[0].transaction;
    expect(optionsOf(transaction)?.readOnly).toBe(false);
    expect(recorded.every((entry) => entry.transaction === transaction)).toBe(
      true
    );
    expect(recorded[4].sql).not.toContain("documentStructure");
  });

  it("resolves an uppercase UUID and URL identifiers to the lowercase ID", async () => {
    const { user, collection } = await buildReadableCollection();

    for (const id of [
      collection.id.toUpperCase(),
      collection.urlId,
      `any-name-${collection.urlId}`,
    ]) {
      await expect(
        authorizeLintCollection({ id, actor: user, deadline: fixedDeadline() })
      ).resolves.toBe(collection.id);
    }
  });

  it("returns null for missing, unreadable, foreign, and deleted collections", async () => {
    const { user, collection: deleted } = await buildReadableCollection();
    await deleted.destroy({ hooks: false });
    const { collection: unreadable } = await buildPrivateCollection(user);
    const foreign = await buildCollection({ teamId: (await buildTeam()).id });

    for (const id of [
      "00000000-0000-4000-8000-000000000000",
      "any-name-abcdefghij",
      "not a collection",
      unreadable.id,
      foreign.id,
      deleted.id,
    ]) {
      await expect(
        authorizeLintCollection({ id, actor: user, deadline: fixedDeadline() })
      ).resolves.toBeNull();
    }
  });

  it("refuses to start below the floor", async () => {
    const { user, collection } = await buildReadableCollection();
    const statements = recordStatements();

    await expect(
      authorizeLintCollection({
        id: collection.id,
        actor: user,
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

describe("structureDocumentIds", () => {
  it("flattens nested nodes to sorted unique IDs", () => {
    const node = (id: string, children: unknown[] = []) =>
      ({ id, title: "", url: "", children }) as NavigationNode;

    expect(
      structureDocumentIds([
        node("c", [node("b", [node("a")]), node("a")]),
        node("d"),
      ])
    ).toEqual(["a", "b", "c", "d"]);
  });

  it("ignores malformed nodes", () => {
    expect(structureDocumentIds(null)).toEqual([]);
    expect(
      structureDocumentIds([
        null,
        "x",
        { id: 1, children: [{ id: "b", children: "x" }] },
        { children: [{ id: "a" }] },
      ] as unknown as NavigationNode[])
    ).toEqual(["a", "b"]);
  });
});

describe("readWikiSnapshot", () => {
  it("reads exactly the published documents the actor can read", async () => {
    const actor = await buildAdmin();
    const collection = await buildCollection({
      teamId: actor.teamId,
      userId: actor.id,
    });
    const published = await publishedIn(actor, collection.id);
    await buildDraftDocument({
      teamId: actor.teamId,
      userId: actor.id,
      collectionId: collection.id,
    });
    await publishedIn(actor, collection.id, { archivedAt: new Date() });
    await publishedIn(actor, collection.id, { template: true });
    const trialImport = await buildFileOperation({
      teamId: actor.teamId,
      userId: actor.id,
      type: FileOperationType.Import,
    });
    const trial = await publishedIn(actor, collection.id, {
      importId: trialImport.id,
      sourceMetadata: { trial: true },
    });
    const deleted = await publishedIn(actor, collection.id);
    await Document.unscoped().update(
      { deletedAt: new Date() },
      { where: { id: deleted.id }, hooks: false }
    );
    const other = await buildCollection({
      teamId: actor.teamId,
      userId: actor.id,
    });
    await publishedIn(actor, other.id);

    const { owner, collection: privateCollection } =
      await buildPrivateCollection(actor);
    await publishedIn(owner, privateCollection.id);
    const shared = await publishedIn(owner, privateCollection.id);
    await UserMembership.create({
      documentId: shared.id,
      userId: actor.id,
      createdById: owner.id,
      permission: DocumentPermission.Read,
    });

    const snapshot = await snapshotOf({
      entries: entriesFor({
        [collection.id]: documentPolicy,
        [privateCollection.id]: documentPolicy,
      }),
      actor,
    });

    expect(
      snapshot.collections.map(({ collectionId, documents }) => ({
        collectionId,
        documentIds: documents.map(({ documentId }) => documentId),
      }))
    ).toEqual(
      [
        { collectionId: collection.id, documentIds: [published.id] },
        { collectionId: privateCollection.id, documentIds: [shared.id] },
      ].sort((a, b) => (a.collectionId < b.collectionId ? -1 : 1))
    );
    expect(snapshot.collections[0].documents[0]).toEqual({
      documentId: expect.any(String),
      content: {
        syntax: parseCanonicalMarkdown(
          "This is the text in an example document"
        ),
        links: null,
      },
      parent: null,
    });
    expect(snapshot.collections.map(({ graph }) => graph)).toEqual([
      null,
      null,
    ]);
    expect(trial.isTrialImport).toBe(true);
    expect(serialize(snapshot)).not.toContain(trial.id);
  });

  it("evaluates a collection readable only through a group", async () => {
    const actor = await buildUser();
    const owner = await buildUser({ teamId: actor.teamId });
    const collection = await buildCollection({
      teamId: owner.teamId,
      userId: owner.id,
      permission: null,
    });
    const group = await buildGroup({ teamId: owner.teamId, userId: owner.id });
    await buildGroupUser({
      groupId: group.id,
      userId: actor.id,
      teamId: actor.teamId,
    });
    await GroupMembership.create({
      createdById: owner.id,
      collectionId: collection.id,
      groupId: group.id,
      permission: CollectionPermission.Read,
    });
    const document = await publishedIn(owner, collection.id);

    const snapshot = await snapshotOf({
      entries: entriesFor({ [collection.id]: documentPolicy }),
      actor,
    });

    expect(snapshot.collections).toEqual([
      {
        collectionId: collection.id,
        documents: [
          {
            documentId: document.id,
            content: expect.objectContaining({ links: null }),
            parent: null,
          },
        ],
        graph: null,
      },
    ]);
  });

  it("reads 101 documents in one transaction with bounded keyset batches", async () => {
    const { user, collection } = await buildReadableCollection();
    const documents = [];
    for (let index = 0; index < WIKI_DOCUMENT_BATCH_SIZE + 1; index++) {
      documents.push(
        await publishedIn(user, collection.id, {
          text: index === 0 ? linking([missingUuid(1)]) : "## Overview",
        })
      );
    }
    const statements = recordStatements();

    const snapshot = await snapshotOf({
      entries: entriesFor({
        [collection.id]: {
          activation: "read_only",
          rules: [...linkPolicy.rules, ...hierarchyPolicy.rules],
        },
      }),
      actor: user,
    });

    const sorted = documents.map(({ id }) => id).sort();
    expect(
      snapshot.collections[0].documents.map(({ documentId }) => documentId)
    ).toEqual(sorted);
    expect(Object.fromEntries(snapshot.targets)).toEqual({
      [missingUuid(1)]: "unresolved",
    });

    const recorded = statements();
    expect(reduced(recorded)).toEqual([
      "START TRANSACTION;",
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;",
      "SET TRANSACTION READ ONLY",
      ...BOUND,
      "SELECT collections",
      ...BOUND,
      "SELECT documents",
      ...BOUND,
      "SELECT content",
      ...BOUND,
      "SELECT documents",
      ...BOUND,
      "SELECT content",
      ...BOUND,
      "SELECT lookup",
      ...BOUND,
      "SELECT structure",
      "COMMIT;",
    ]);
    const transaction = recorded[0].transaction;
    expect(optionsOf(transaction)?.readOnly).toBe(false);
    expect(optionsOf(transaction)?.isolationLevel).toBe("REPEATABLE READ");
    expect(recorded.every((entry) => entry.transaction === transaction)).toBe(
      true
    );
    expectReadOnly(recorded);

    const pages = recorded
      .map(({ sql }) => sql)
      .filter((sql) => statementOf(sql) === "SELECT documents");
    expect(pages[0]).not.toContain(`"id" > `);
    expect(pages[1]).toContain(
      `"collectionId" = '${collection.id}' AND "document"."id" > '${sorted[99]}'`
    );
    for (const page of pages) {
      for (const predicate of [
        `"document"."deletedAt" IS NULL`,
        `"document"."teamId" = '${user.teamId}'`,
        `"document"."collectionId" IN ('${collection.id}')`,
        `"document"."publishedAt" IS NOT NULL`,
        `"document"."template" = false`,
        `("document"."sourceMetadata"#>>'{trial}') IS NULL`,
        `"document"."archivedAt" IS NULL`,
      ]) {
        expect(page).toContain(predicate);
      }
      expect(page).toMatch(
        /ORDER BY "document"\."collectionId" ASC, "document"\."id" ASC LIMIT 100/
      );
    }
    const contents = recorded
      .map(({ sql }) => sql)
      .filter((sql) => statementOf(sql) === "SELECT content");
    expect(contents[1]).toContain(`'${sorted[100]}'`);
  });

  it("continues the keyset from one collection into the next", async () => {
    const user = await buildUser();
    const [low, high] = (
      await Promise.all([
        buildCollection({ teamId: user.teamId, userId: user.id }),
        buildCollection({ teamId: user.teamId, userId: user.id }),
      ])
    ).sort((a, b) => (a.id < b.id ? -1 : 1));
    const lowIds: string[] = [];
    for (let index = 0; index < WIKI_DOCUMENT_BATCH_SIZE; index++) {
      lowIds.push((await publishedIn(user, low.id)).id);
    }
    const highIds = [
      (await publishedIn(user, high.id)).id,
      (await publishedIn(user, high.id)).id,
    ];
    const statements = recordStatements();

    const snapshot = await snapshotOf({
      entries: entriesFor({
        [low.id]: hierarchyPolicy,
        [high.id]: hierarchyPolicy,
      }),
      actor: user,
    });

    expect(
      snapshot.collections.map(({ collectionId, documents }) => [
        collectionId,
        documents.map(({ documentId }) => documentId),
      ])
    ).toEqual([
      [low.id, lowIds.sort()],
      [high.id, highIds.sort()],
    ]);
    expect(
      reduced(statements()).filter((sql) => sql === "SELECT documents")
    ).toHaveLength(2);
  });

  it("continues the keyset after a page ending in an unreadable row", async () => {
    const admin = await buildAdmin();
    const { owner, collection } = await buildPrivateCollection(admin);
    const ids: string[] = [];
    for (let index = 0; index < WIKI_DOCUMENT_BATCH_SIZE + 1; index++) {
      ids.push((await publishedIn(owner, collection.id)).id);
    }
    const sorted = [...ids].sort();
    // Only the first, a middle, and the last row are readable, so the first
    // page ends in an unreadable row.
    const readable = [sorted[0], sorted[50], sorted[100]];
    for (const documentId of readable) {
      await UserMembership.create({
        documentId,
        userId: admin.id,
        createdById: owner.id,
        permission: DocumentPermission.Read,
      });
    }
    const statements = recordStatements();

    const snapshot = await snapshotOf({
      entries: entriesFor({ [collection.id]: hierarchyPolicy }),
      actor: admin,
    });

    expect(
      snapshot.collections[0].documents.map(({ documentId }) => documentId)
    ).toEqual(readable);
    const pages = statements()
      .map(({ sql }) => sql)
      .filter((sql) => statementOf(sql) === "SELECT documents");
    expect(pages).toHaveLength(2);
    expect(pages[1]).toContain(`"document"."id" > '${sorted[99]}'`);
  });

  it("resolves 501 unique link keys in two target batches", async () => {
    const { user, collection } = await buildReadableCollection();
    const keys = Array.from({ length: 501 }, (_, index) =>
      missingUuid(1000 - index)
    );
    await publishedIn(user, collection.id, {
      text: linking(keys.slice(0, 300)),
    });
    await publishedIn(user, collection.id, {
      text: linking(keys.slice(200)),
    });
    const statements = recordStatements();

    const snapshot = await snapshotOf({
      entries: entriesFor({ [collection.id]: linkPolicy }),
      actor: user,
    });

    expect(snapshot.targets.size).toBe(501);
    const lookups = statements()
      .map(({ sql }) => sql)
      .filter((sql) => statementOf(sql) === "SELECT lookup");
    const sorted = [...keys].sort();
    expect(lookups.map(keysIn)).toEqual([
      sorted.slice(0, 500),
      sorted.slice(500),
    ]);
  });

  describe("required inputs", () => {
    /**
     * Builds a readable collection with a root document and its child.
     *
     * @returns the user, collection, root, and child.
     */
    async function buildTree() {
      const { user, collection } = await buildReadableCollection();
      const root = await publishedIn(user, collection.id);
      const child = await publishedIn(user, collection.id, {
        parentDocumentId: root.id,
      });
      return { user, collection, root, child };
    }

    it("reads no structure or parent for document rules only", async () => {
      const { user, collection } = await buildTree();
      const statements = recordStatements();

      const snapshot = await snapshotOf({
        entries: entriesFor({ [collection.id]: documentPolicy }),
        actor: user,
      });

      const recorded = statements();
      expect(reduced(recorded)).not.toContain("SELECT lookup");
      expect(recorded.map(({ sql }) => sql).join("\n")).not.toContain(
        "documentStructure"
      );
      expect(snapshot.collections[0].graph).toBeNull();
      expect(
        snapshot.collections[0].documents.map(({ parent }) => parent)
      ).toEqual([null, null]);
      expectReadOnly(recorded);
    });

    it("reads no content for hierarchy rules only", async () => {
      const { user, collection, root, child } = await buildTree();
      const stale = missingUuid(7);
      await Collection.update(
        {
          documentStructure: [
            {
              id: root.id,
              title: "",
              url: "",
              children: [{ id: stale, title: "", url: "", children: [] }],
            },
          ],
        },
        { where: { id: collection.id }, hooks: false }
      );
      const statements = recordStatements();

      const snapshot = await snapshotOf({
        entries: entriesFor({ [collection.id]: hierarchyPolicy }),
        actor: user,
      });

      const recorded = statements();
      expect(reduced(recorded)).toEqual([
        "START TRANSACTION;",
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;",
        "SET TRANSACTION READ ONLY",
        ...BOUND,
        "SELECT collections",
        ...BOUND,
        "SELECT documents",
        ...BOUND,
        "SELECT structure",
        ...BOUND,
        "SELECT lookup",
        "COMMIT;",
      ]);
      expect(
        recorded.filter(({ sql }) =>
          /"document"\."(content|state|text)"|^SELECT "id", "content"/.test(sql)
        )
      ).toEqual([]);
      expect(
        recorded.filter(({ sql }) => sql.includes("documentStructure"))
      ).toHaveLength(1);
      expect(snapshot.collections[0]).toEqual({
        collectionId: collection.id,
        documents: [root, child]
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .map((document) => ({
            documentId: document.id,
            content: null,
            parent:
              document.id === root.id
                ? { state: "none" }
                : {
                    state: "resolved",
                    documentId: root.id,
                    sameCollection: true,
                  },
          })),
        graph: {
          authorized: true,
          structureDocumentIds: [root.id, stale].sort(),
          globalIndex: null,
        },
      });
      expectReadOnly(recorded);
    });
  });

  describe("graph authorization", () => {
    /**
     * Builds an admin and a private collection the admin can read without
     * membership, with one document.
     *
     * @returns the admin, owner, collection, and document.
     */
    async function buildAdminFixture() {
      const admin = await buildAdmin();
      const { owner, collection } = await buildPrivateCollection(admin);
      const document = await publishedIn(owner, collection.id);
      return { admin, owner, collection, document };
    }

    it("reads no structure where the actor lacks readDocument", async () => {
      const { admin, collection } = await buildAdminFixture();
      const statements = recordStatements();

      const snapshot = await snapshotOf({
        entries: entriesFor({ [collection.id]: hierarchyPolicy }),
        actor: admin,
      });

      expect(snapshot.collections).toEqual([
        {
          collectionId: collection.id,
          documents: [],
          graph: { authorized: false },
        },
      ]);
      const recorded = statements();
      expect(recorded.map(({ sql }) => sql).join("\n")).not.toContain(
        "documentStructure"
      );
      expect(reduced(recorded)).not.toContain("SELECT lookup");
    });

    it("evaluates a document readable through membership", async () => {
      const { admin, owner, collection, document } = await buildAdminFixture();
      await UserMembership.create({
        documentId: document.id,
        userId: admin.id,
        createdById: owner.id,
        permission: DocumentPermission.Read,
      });

      const snapshot = await snapshotOf({
        entries: entriesFor({
          [collection.id]: {
            activation: "read_only",
            rules: [...documentPolicy.rules, ...hierarchyPolicy.rules],
          },
        }),
        actor: admin,
      });

      expect(snapshot.collections).toEqual([
        {
          collectionId: collection.id,
          documents: [
            {
              documentId: document.id,
              content: expect.objectContaining({ links: null }),
              parent: null,
            },
          ],
          graph: { authorized: false },
        },
      ]);
    });

    it("keeps a requested collection that is no longer readable", async () => {
      const { user, collection } = await buildReadableCollection();
      await publishedIn(user, collection.id);
      const actor = await buildUser({ teamId: user.teamId });
      await Collection.update(
        { permission: null },
        { where: { id: collection.id }, hooks: false }
      );
      const statements = recordStatements();

      const snapshot = await snapshotOf({
        scope: { kind: "collection", collectionId: collection.id },
        entries: entriesFor({ [collection.id]: hierarchyPolicy }),
        actor,
      });

      expect(snapshot.collections).toEqual([
        {
          collectionId: collection.id,
          documents: [],
          graph: { authorized: false },
        },
      ]);
      expect(
        statements()
          .map(({ sql }) => sql)
          .join("\n")
      ).not.toContain("documentStructure");
    });
  });

  it("resolves parent edges through readable documents", async () => {
    const { user: actor, collection } = await buildReadableCollection();
    const elsewhere = await buildCollection({
      teamId: actor.teamId,
      userId: actor.id,
    });
    const { owner, collection: privateCollection } =
      await buildPrivateCollection(actor);
    const otherParent = await publishedIn(actor, elsewhere.id);
    const deletedParent = await publishedIn(actor, collection.id);
    const protectedParent = await publishedIn(owner, privateCollection.id);
    const root = await publishedIn(actor, collection.id);
    const children = new Map<string, string>();
    for (const parent of [root, otherParent, deletedParent, protectedParent]) {
      const child = await publishedIn(actor, collection.id);
      await Document.unscoped().update(
        { parentDocumentId: parent.id },
        { where: { id: child.id }, hooks: false }
      );
      children.set(parent.id, child.id);
    }
    await Document.unscoped().update(
      { deletedAt: new Date() },
      { where: { id: deletedParent.id }, hooks: false }
    );

    const snapshot = await snapshotOf({
      entries: entriesFor({ [collection.id]: hierarchyPolicy }),
      actor,
    });

    const edges = new Map(
      snapshot.collections[0].documents.map(({ documentId, parent }) => [
        documentId,
        parent,
      ])
    );
    expect(edges.size).toBe(5);
    expect(edges.get(root.id)).toEqual({ state: "none" });
    expect(edges.get(children.get(root.id) as string)).toEqual({
      state: "resolved",
      documentId: root.id,
      sameCollection: true,
    });
    expect(edges.get(children.get(otherParent.id) as string)).toEqual({
      state: "resolved",
      documentId: otherParent.id,
      sameCollection: false,
    });
    expect(edges.get(children.get(deletedParent.id) as string)).toEqual({
      state: "unresolved",
    });
    expect(edges.get(children.get(protectedParent.id) as string)).toEqual({
      state: "unresolved",
    });
    expect(serialize(snapshot)).not.toContain(protectedParent.id);
    expect(serialize(snapshot)).not.toContain(privateCollection.id);
  });

  it("reads the surface and only the readable global indexes", async () => {
    const { user: actor, collection } = await buildReadableCollection();
    const { owner, collection: privateCollection } =
      await buildPrivateCollection(actor);
    const index = await publishedIn(actor, collection.id);
    const protectedIndex = await publishedIn(owner, privateCollection.id);
    const surface = await publishedIn(actor, collection.id, {
      text: linking([index.id, `any-title-${protectedIndex.urlId}`]),
    });

    const snapshot = await snapshotOf({
      entries: entriesFor({
        [collection.id]: globalIndexPolicy(surface.id, [
          protectedIndex.id,
          index.id,
        ]),
      }),
      actor,
    });

    const syntax = parseCanonicalMarkdown(
      linking([index.id, `any-title-${protectedIndex.urlId}`])
    );
    expect(snapshot.collections[0].graph).toEqual({
      authorized: true,
      structureDocumentIds: expect.any(Array),
      globalIndex: {
        surface: {
          documentId: surface.id,
          links: [
            {
              key: index.id,
              keyKind: "id",
              position: syntax.links[0].position,
            },
            {
              key: protectedIndex.urlId,
              keyKind: "urlId",
              position: syntax.links[1].position,
            },
          ],
        },
        indexes: [{ documentId: index.id, urlId: index.urlId }],
      },
    });
    expect(snapshot.targets.size).toBe(0);
  });

  it("discloses nothing of a surface the actor cannot read", async () => {
    const { user: actor, collection } = await buildReadableCollection();
    const { owner, collection: privateCollection } =
      await buildPrivateCollection(actor);
    const index = await publishedIn(actor, collection.id);
    const hiddenKey = missingUuid(4242);
    const surface = await publishedIn(owner, privateCollection.id, {
      text: linking([hiddenKey, "any-title-hiddenurl1"]),
    });
    const statements = recordStatements();

    const snapshot = await snapshotOf({
      entries: entriesFor({
        [collection.id]: globalIndexPolicy(surface.id, [index.id]),
      }),
      actor,
    });

    expect(snapshot.collections[0].graph).toEqual(
      expect.objectContaining({
        globalIndex: {
          surface: null,
          indexes: [{ documentId: index.id, urlId: index.urlId }],
        },
      })
    );
    expect(
      statements().filter(
        ({ sql }) =>
          statementOf(sql) === "SELECT content" && sql.includes(surface.id)
      )
    ).toEqual([]);
    for (const hidden of [surface.id, hiddenKey, "hiddenurl1"]) {
      expect(serialize(snapshot)).not.toContain(hidden);
    }
  });

  it("looks up 501 configured IDs in two bounded batches", async () => {
    const { user, collection } = await buildReadableCollection();
    const indexIds = Array.from({ length: 501 }, () => randomUUID());
    const statements = recordStatements();

    // The surface is one of the indexes, so 501 unique IDs are looked up.
    const snapshot = await snapshotOf({
      entries: entriesFor({
        [collection.id]: globalIndexPolicy(indexIds[0], indexIds),
      }),
      actor: user,
    });

    expect(snapshot.collections[0].graph).toEqual({
      authorized: true,
      structureDocumentIds: [],
      globalIndex: { surface: null, indexes: [] },
    });
    const recorded = statements();
    expect(reduced(recorded)).toEqual([
      "START TRANSACTION;",
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;",
      "SET TRANSACTION READ ONLY",
      ...BOUND,
      "SELECT collections",
      ...BOUND,
      "SELECT documents",
      ...BOUND,
      "SELECT structure",
      ...BOUND,
      "SELECT lookup",
      ...BOUND,
      "SELECT lookup",
      "COMMIT;",
    ]);
    const sorted = [...indexIds].sort();
    expect(
      recorded
        .map(({ sql }) => sql)
        .filter((sql) => statementOf(sql) === "SELECT lookup")
        .map(keysIn)
    ).toEqual([sorted.slice(0, 500), sorted.slice(500)]);
  });

  it("marks an unavailable document and surface without failing the snapshot", async () => {
    const { user, collection } = await buildReadableCollection();
    const unavailable = await publishedIn(user, collection.id);
    const available = await publishedIn(user, collection.id);
    await Document.unscoped().update(
      { content: null, state: null },
      { where: { id: unavailable.id }, hooks: false }
    );

    const snapshot = await snapshotOf({
      entries: entriesFor({
        [collection.id]: {
          activation: "read_only",
          rules: [
            ...documentPolicy.rules,
            ...globalIndexPolicy(unavailable.id, [available.id]).rules,
          ],
        },
      }),
      actor: user,
    });

    const contents = new Map(
      snapshot.collections[0].documents.map(({ documentId, content }) => [
        documentId,
        content,
      ])
    );
    expect(contents.get(unavailable.id)).toBe("unavailable");
    expect(contents.get(available.id)).toEqual(
      expect.objectContaining({ links: null })
    );
    expect(snapshot.collections[0].graph).toEqual(
      expect.objectContaining({
        globalIndex: {
          surface: null,
          indexes: [{ documentId: available.id, urlId: available.urlId }],
        },
      })
    );
  });

  describe("default scope", () => {
    /**
     * Builds readable valid and sentinel collections next to unreadable ones.
     *
     * @returns the actor, collections, and entries.
     */
    async function buildDefaultFixture() {
      const { user: actor, collection: valid } =
        await buildReadableCollection();
      const sentinel = await buildCollection({
        teamId: actor.teamId,
        userId: actor.id,
      });
      const { collection: hiddenValid } = await buildPrivateCollection(actor);
      const { collection: hiddenSentinel } =
        await buildPrivateCollection(actor);
      const entries = entriesFor({
        [valid.id]: documentPolicy,
        [sentinel.id]: invalidPolicy,
        [hiddenValid.id]: documentPolicy,
        [hiddenSentinel.id]: invalidPolicy,
        "00000000-0000-4000-8000-0000000000c9": documentPolicy,
      });
      return { actor, valid, sentinel, hiddenValid, hiddenSentinel, entries };
    }

    it("includes only readable collections", async () => {
      const { actor, valid, sentinel, entries } = await buildDefaultFixture();

      const snapshot = await snapshotOf({ entries, actor });

      expect(
        snapshot.collections.map(({ collectionId }) => collectionId)
      ).toEqual([valid.id]);
      expect(snapshot.sentinelCollectionIds).toEqual([sentinel.id]);
    });

    it("returns a readable sentinel as the only readable collection", async () => {
      const { user: actor, collection: sentinel } =
        await buildReadableCollection();
      const { collection: hidden } = await buildPrivateCollection(actor);

      await expect(
        snapshotOf({
          entries: entriesFor({
            [sentinel.id]: invalidPolicy,
            [hidden.id]: documentPolicy,
          }),
          actor,
        })
      ).resolves.toEqual({
        collections: [],
        sentinelCollectionIds: [sentinel.id],
        targets: new Map(),
      });
    });

    it("reads only the enumeration batch when nothing is readable", async () => {
      const { entries } = await buildDefaultFixture();
      const outsider = await buildUser();
      const statements = recordStatements();

      await expect(snapshotOf({ entries, actor: outsider })).resolves.toEqual({
        collections: [],
        sentinelCollectionIds: [],
        targets: new Map(),
      });
      expect(reduced(statements())).toEqual([
        "START TRANSACTION;",
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;",
        "SET TRANSACTION READ ONLY",
        ...BOUND,
        "SELECT collections",
        "COMMIT;",
      ]);
    });

    it("carries the sentinels established before a failure", async () => {
      const { actor, sentinel, entries } = await buildDefaultFixture();
      // The deadline starts and bounds the enumeration at 0 ms; 950 ms have
      // passed when the documents batch is bounded.
      let readings = 0;
      const clock = () => (readings++ < 2 ? 0 : 950);

      const result = await read({
        entries,
        actor,
        deadline: new Deadline(1000, clock),
      });

      expect(result).toEqual({
        ok: false,
        error: expect.any(DeadlineFloorError),
        sentinelCollectionIds: [sentinel.id],
      });
    });

    it("carries no sentinel when the enumeration batch is refused", async () => {
      const { actor, entries } = await buildDefaultFixture();
      const statements = recordStatements();

      const result = await read({
        entries,
        actor,
        deadline: fixedDeadline(99),
      });

      expect(result).toEqual({
        ok: false,
        error: expect.any(DeadlineFloorError),
        sentinelCollectionIds: [],
      });
      expect(reduced(statements())).toEqual([
        "START TRANSACTION;",
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;",
        "SET TRANSACTION READ ONLY",
        "ROLLBACK;",
      ]);
    });

    it("carries no sentinel when the enumeration query fails", async () => {
      const { actor, entries } = await buildDefaultFixture();
      vi.spyOn(Collection, "scope").mockImplementation(() => {
        throw new Error("enumeration");
      });

      await expect(read({ entries, actor })).resolves.toEqual({
        ok: false,
        error: new Error("enumeration"),
        sentinelCollectionIds: [],
      });
    });
  });

  it("observes one point in time despite concurrent commits", async () => {
    const { user, collection } = await buildReadableCollection();
    const document = await publishedIn(user, collection.id, {
      text: "## Before",
    });
    const query = sequelize.query.bind(sequelize);
    let committed = false;
    let added: Document | undefined;
    vi.spyOn(sequelize, "query").mockImplementation((async (
      sql: string,
      options?: { transaction?: Transaction }
    ) => {
      if (
        !committed &&
        options?.transaction &&
        typeof sql === "string" &&
        statementOf(sql) === "SELECT documents"
      ) {
        committed = true;
        await Document.unscoped().update(
          {
            content: parser.parse("## After")?.toJSON(),
          },
          { where: { id: document.id }, hooks: false }
        );
        added = await publishedIn(user, collection.id);
      }
      return query(sql, options);
    }) as unknown as typeof sequelize.query);

    const snapshot = await snapshotOf({
      entries: entriesFor({ [collection.id]: documentPolicy }),
      actor: user,
    });

    expect(committed).toBe(true);
    expect(added).toBeDefined();
    expect(snapshot.collections[0].documents).toEqual([
      {
        documentId: document.id,
        content: {
          syntax: parseCanonicalMarkdown("## Before"),
          links: null,
        },
        parent: null,
      },
    ]);

    vi.restoreAllMocks();
    const later = await snapshotOf({
      entries: entriesFor({ [collection.id]: documentPolicy }),
      actor: user,
    });
    expect(later.collections[0].documents).toHaveLength(2);
  });

  it("is byte-stable for identical state", async () => {
    const { user, collection } = await buildReadableCollection();
    for (let index = 0; index < 3; index++) {
      await publishedIn(user, collection.id, {
        text: linking([missingUuid(index), missingUuid(9 - index)]),
      });
    }
    const entries = entriesFor({
      [collection.id]: {
        activation: "read_only",
        rules: [...linkPolicy.rules, ...hierarchyPolicy.rules],
      },
    });

    const first = await snapshotOf({ entries, actor: user });
    const second = await snapshotOf({ entries, actor: user });

    expect(first.targets.size).toBe(6);
    expect(serialize(second)).toBe(serialize(first));
  });
});
