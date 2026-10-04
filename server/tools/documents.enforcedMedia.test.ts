import { createHash, randomUUID } from "node:crypto";
import type { Job } from "bull";
import { http, HttpResponse } from "msw";
import type { Transaction } from "sequelize";
import { Op } from "sequelize";
import { yDocToProsemirrorJSON } from "y-prosemirror";
import * as Y from "yjs";
import { TextEditMode } from "@shared/types";
import env from "@server/env";
import Logger from "@server/logging/Logger";
import { Attachment, Document, Event } from "@server/models";
import type { Collection, User } from "@server/models";
import AttachmentHelper from "@server/models/helpers/AttachmentHelper";
import { ProsemirrorHelper } from "@server/models/helpers/ProsemirrorHelper";
import { TextHelper } from "@server/models/helpers/TextHelper";
import EnforcedDocumentImportTask from "@server/queues/tasks/EnforcedDocumentImportTask";
import { BaseTask } from "@server/queues/tasks/base/BaseTask";
import { sequelize } from "@server/storage/database";
import FileStorage from "@server/storage/files";
import {
  buildCollection,
  buildDocument,
  buildUser,
} from "@server/test/factories";
import { buildOAuthUser, callMcpTool } from "@server/test/McpHelper";
import { server as msw } from "@server/test/msw";
import { getTestServer } from "@server/test/support";
import type { AuditDataV1 } from "@server/wikiLint/adapters/auditEvents";
import type * as PolicyConfig from "@server/wikiLint/adapters/policyConfig";
import { MediaStager } from "@server/wikiLint/adapters/mediaStaging";
import type { EnforcedImportIntent } from "@server/wikiLint/application/enforcedImport";
import type { PolicySet } from "@server/wikiLint/core/policySet";
import { buildPolicySet } from "@server/wikiLint/core/policySet";
import {
  COLLECTION_CONFLICT,
  OPERATION_FAILED,
} from "@server/wikiLint/core/registry";

/** What the replaced seam serves; reset after each test. */
const state = vi.hoisted(() => ({
  /** The served policy set; the real getter serves when unset. */
  policySet: undefined as PolicySet | undefined,
}));

vi.mock("@server/wikiLint/adapters/policyConfig", async (importOriginal) => {
  const actual = await importOriginal<typeof PolicyConfig>();
  return {
    ...actual,
    getPolicySet: () => state.policySet ?? actual.getPolicySet(),
  };
});

const server = getTestServer();

const sha256Hex = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** Requires an Overview section. */
const rules = [
  { kind: "required_sections", headingLevel: 2, headings: ["Overview"] },
];

/** The policy entry of each policy state. */
const POLICIES = {
  read_only: { activation: "read_only", rules },
  enforced: { activation: "enforced", rules },
  // An empty rule list fails validation, so the entry becomes a sentinel.
  sentinel: { activation: "read_only", rules: [] },
} as const;

type PolicyState = keyof typeof POLICIES;

/** A Markdown body that satisfies `rules`. */
const VALID = "## Overview\n\nAll good.";

/** A Markdown body that violates `rules`. */
const INVALID = "No overview here";

/** A one-pixel PNG, base64-encoded. */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/** The `data:` image of the fixtures. */
const DATA_SRC = `data:image/png;base64,${PNG_BASE64}`;

/** A Markdown image that `documentUpdater` would import. */
const DATA_IMAGE = `![pixel](${DATA_SRC})`;

/** The external image of the fixtures, served by msw. */
const EXTERNAL = "https://media.example.test/pixel.png";

/**
 * Builds HTML with a data image, a data link, and an external image.
 *
 * @param heading - whether the body has the required section.
 * @returns the HTML.
 */
const mediaHtml = (heading = true) =>
  `<h1>Imported</h1>${heading ? "<h2>Overview</h2>" : ""}<p>ok</p><p><img src="${DATA_SRC}" alt="pixel"></p><p><a href="data:application/pdf;base64,${PNG_BASE64}">report</a></p><p><img src="${EXTERNAL}"></p>`;

type McpResponse = Awaited<ReturnType<typeof callMcpTool>>;

/** Matches a UUID. */
const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/**
 * Copies a JSON value with every UUID other than the known ones replaced by
 * its order of first appearance.
 *
 * @param value - the value.
 * @param known - the IDs to keep.
 * @returns the normalized copy.
 */
function normalized(value: unknown, known: readonly string[] = []): unknown {
  const seen = new Map<string, string>();
  return JSON.parse(
    JSON.stringify(value).replace(UUID_PATTERN, (id) => {
      if (known.includes(id)) {
        return id;
      }
      if (!seen.has(id)) {
        seen.set(id, `<id ${seen.size}>`);
      }
      return seen.get(id)!;
    })
  );
}

/**
 * Serves a policy set with each collection in its policy state.
 *
 * @param collections - each collection and its state.
 * @returns the served set.
 */
function configure(collections: [Collection, PolicyState][]): PolicySet {
  const entries: Record<string, unknown> = {};
  for (const [collection, policyState] of collections) {
    entries[collection.id] = POLICIES[policyState];
  }
  const result = buildPolicySet(
    Buffer.from(
      JSON.stringify({ schemaVersion: 1, collections: entries }),
      "utf8"
    ),
    sha256Hex
  );
  if (!result.ok) {
    throw new Error("The test configuration must load");
  }
  state.policySet = result.policySet;
  return result.policySet;
}

/**
 * Serves the external image, or a failure for it.
 *
 * @param status - the response status.
 */
function serveExternal(status = 200) {
  msw.use(
    http.get(EXTERNAL, () =>
      status === 200
        ? new HttpResponse(Buffer.from(PNG_BASE64, "base64"), {
            headers: { "Content-Type": "image/png" },
          })
        : new HttpResponse(null, { status })
    )
  );
}

/**
 * Records the enforced intents scheduled from now on; each job runs lazily,
 * as in every server test.
 *
 * @param before - runs, and is awaited, before an enforced job is performed.
 * @returns the intents.
 */
function recordIntents(before?: () => unknown): EnforcedImportIntent[] {
  const intents: EnforcedImportIntent[] = [];
  vi.spyOn(BaseTask.prototype, "schedule").mockImplementation(function (
    this: BaseTask<object>,
    props: object
  ) {
    const enforced = this instanceof EnforcedDocumentImportTask;
    if (enforced) {
      intents.push(props as EnforcedImportIntent);
    }
    return Promise.resolve({
      finished: async () => {
        if (enforced) {
          await before?.();
        }
        return this.perform(props);
      },
    } as Job);
  });
  return intents;
}

/**
 * Records the key of every blob staged from now on, calling through to
 * storage.
 *
 * @returns the recorded keys.
 */
function recordKeys(): string[] {
  const keys: string[] = [];
  const store = FileStorage.storeFromUrl.bind(FileStorage);
  vi.spyOn(FileStorage, "storeFromUrl").mockImplementation((...args) => {
    keys.push(args[1]);
    return store(...args);
  });
  return keys;
}

/**
 * Replaces `sequelize.query` with a handler around the real query.
 *
 * @param handler - the handler.
 */
function interceptQueries(
  handler: (
    sql: string,
    options: { transaction?: Transaction } | undefined,
    next: () => Promise<unknown>
  ) => Promise<unknown>
) {
  const query = sequelize.query.bind(sequelize) as unknown as (
    ...args: unknown[]
  ) => Promise<unknown>;
  vi.spyOn(sequelize, "query").mockImplementation(((...args: unknown[]) => {
    const [first, options] = args;
    const sql =
      typeof first === "string" ? first : (first as { query: string }).query;
    return handler(sql, options as { transaction?: Transaction }, () =>
      query(...args)
    );
  }) as never);
}

/**
 * Runs an action on the COMMIT of the transaction that inserted Attachment
 * rows, the enforcement transaction of a media write.
 *
 * @param action - the action; given the transaction and the real COMMIT.
 */
function onEnforcedCommit(
  action: (transaction: Transaction, next: () => Promise<unknown>) => unknown
) {
  let enforcement: Transaction | undefined;
  interceptQueries((sql, options, next) => {
    if (sql.startsWith('INSERT INTO "attachments"')) {
      enforcement = options?.transaction;
    }
    if (
      sql === "COMMIT;" &&
      enforcement &&
      options?.transaction === enforcement
    ) {
      enforcement = undefined;
      return Promise.resolve(action(options!.transaction!, next));
    }
    return next();
  });
}

/**
 * Destroys the socket of a transaction's connection.
 *
 * @param transaction - the transaction.
 */
const destroySocket = (transaction: Transaction) =>
  (
    transaction as unknown as {
      connection: { connection: { stream: { destroy(): void } } };
    }
  ).connection.connection.stream.destroy();

/**
 * Builds a socket error as a destroyed connection reports it.
 *
 * @returns the error.
 */
const socketError = () =>
  Object.assign(new Error("read ECONNRESET"), {
    code: "ECONNRESET",
    syscall: "read",
  });

/**
 * Checks whether each key's blob exists.
 *
 * @param keys - the keys.
 * @returns whether each blob exists.
 */
const blobsExist = (keys: readonly string[]) =>
  Promise.all(keys.map((key) => FileStorage.getFileExists(key)));

/**
 * Reads how each staged blob is reached: by a team member through
 * `attachments.redirect` with the pre-allocated ID, and by its owner through
 * `files.get` with the key.
 *
 * @param viewers.member - a member of the actor's team.
 * @param viewers.owner - the actor.
 * @param keys - the staged keys.
 * @returns the response statuses.
 */
async function access(
  viewers: { member: User; owner: User },
  keys: readonly string[]
) {
  return Promise.all(
    keys.map(async (key) => ({
      redirect: (
        await server.post("/api/attachments.redirect", viewers.member, {
          body: { id: AttachmentHelper.parseKey(key).id },
          redirect: "manual",
        })
      ).status,
      files: (await server.get(`/api/files.get?key=${key}`, viewers.owner))
        .status,
    }))
  );
}

/**
 * The access of a blob without a committed row.
 *
 * @param count - the number of blobs.
 * @returns the statuses.
 */
const inaccessible = (count: number) =>
  Array.from({ length: count }, () => ({ redirect: 404, files: 404 }));

/**
 * Reads a team's Attachment rows as values that compare across writes: the
 * Attachment ID dropped from the key, sorted by key.
 *
 * @param teamId - the team.
 * @returns the rows.
 */
async function comparableRows(teamId: string) {
  const rows = await Attachment.unscoped().findAll({ where: { teamId } });
  return rows
    .map((row) => ({
      key: row.key.replace(`/${row.id}/`, "/<id>/"),
      acl: row.acl,
      size: Number(row.size),
      contentType: row.contentType,
      userId: row.userId,
      documentId: row.documentId,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Decodes collaborative state to ProseMirror JSON.
 *
 * @param stored - the state, if any.
 * @returns the decoded document, or null.
 */
function decodeState(stored: Uint8Array | null | undefined) {
  if (!stored) {
    return null;
  }
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, stored);
  return yDocToProsemirrorJSON(ydoc, "default");
}

/**
 * Reads the stored fields of a document that a write determines.
 *
 * @param id - the document.
 * @returns the fields.
 */
async function storedFields(id: string) {
  const document = await Document.unscoped().findOne({
    where: { id },
    paranoid: false,
    rejectOnEmpty: true,
  });
  return {
    title: document.title,
    text: document.text,
    content: document.content,
    state: decodeState(document.state),
    published: document.publishedAt !== null,
  };
}

/**
 * Parses the first content block of a successful response.
 *
 * @param response - the response.
 * @returns the parsed block.
 */
function success(response: McpResponse) {
  expect(response?.result?.isError).toBeUndefined();
  return JSON.parse(response?.result?.content?.[0]?.text ?? "") as {
    id: string;
    validation?: { status: string };
  };
}

/**
 * Checks the fixed or baseline-message `isError` result.
 *
 * @param response - the response.
 * @param text - the exact text.
 */
function expectToolError(response: McpResponse, text = OPERATION_FAILED) {
  expect(response?.result).toEqual({
    content: [{ type: "text", text }],
    isError: true,
  });
}

/**
 * Checks a modeled rejection of a body without the required section.
 *
 * @param response - the response.
 */
function expectRejected(response: McpResponse) {
  expect(response?.result?.isError).toBeUndefined();
  const block = JSON.parse(response?.result?.content?.[0]?.text ?? "");
  expect(block).toMatchObject({
    success: false,
    validation: {
      status: "rejected",
      errors: [{ code: "REQUIRED_SECTION_MISSING" }],
    },
  });
}

/**
 * Builds an actor with a team member, an enforced collection, and an
 * unconfigured one.
 *
 * @returns the fixture.
 */
async function fixture() {
  const actor = await buildOAuthUser();
  const { user } = actor;
  const member = await buildUser({ teamId: user.teamId });
  const [collection, unconfigured] = await Promise.all([
    buildCollection({ teamId: user.teamId, userId: user.id }),
    buildCollection({ teamId: user.teamId, userId: user.id }),
  ]);
  configure([[collection, "enforced"]]);
  // Settles the throttled authentication activity writes first.
  await callMcpTool(server, actor.accessToken, "list_collections");
  return {
    ...actor,
    viewers: { member, owner: user },
    collection,
    unconfigured,
  };
}

/**
 * Builds a document with the valid body.
 *
 * @param user - the actor.
 * @param collectionId - its collection.
 * @returns the document.
 */
const documentIn = (user: User, collectionId: string) =>
  buildDocument({
    teamId: user.teamId,
    userId: user.id,
    collectionId,
    title: "Target",
    text: VALID,
  });

/**
 * Runs a write with a deferred constraint trigger that fails the COMMIT of
 * any transaction that inserted an Attachment row for the actor.
 *
 * @param userId - the actor.
 * @param run - the write.
 * @returns the write's result.
 */
async function withFailingCommit<T>(
  userId: string,
  run: () => Promise<T>
): Promise<T> {
  const name = `wiki_lint_media_${randomUUID().replace(/-/g, "")}`;
  await sequelize.query(
    `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'rejected at commit'; END $$`
  );
  await sequelize.query(
    `CREATE CONSTRAINT TRIGGER ${name} AFTER INSERT ON attachments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW."userId" = '${userId}') EXECUTE FUNCTION ${name}()`
  );
  try {
    return await run();
  } finally {
    await sequelize.query(`DROP TRIGGER IF EXISTS ${name} ON attachments`);
    await sequelize.query(`DROP FUNCTION IF EXISTS ${name}()`);
  }
}

/** The Event name of a write summary, which no effect check counts. */
const WRITE_SUMMARY = "wikiLint.write_validation";

/**
 * Counts a team's Events other than write summaries.
 *
 * @param teamId - the team.
 * @returns the count.
 */
const effectEvents = (teamId: string) =>
  Event.count({ where: { teamId, name: { [Op.ne]: WRITE_SUMMARY } } });

/**
 * Lists the outcome and document column of a team's write summaries.
 *
 * @param teamId - the team.
 * @returns the summaries, oldest first.
 */
const summariesOf = async (teamId: string) =>
  (
    await Event.findAll({
      where: { teamId, name: WRITE_SUMMARY },
      order: [["createdAt", "ASC"]],
      raw: true,
    })
  ).map((event) => ({
    outcome: (event.data as AuditDataV1).outcome,
    documentId: event.documentId,
  }));

afterEach(() => {
  state.policySet = undefined;
  vi.restoreAllMocks();
});

describe("an enforced Markdown update with media", () => {
  /**
   * Updates a document of the enforced collection.
   *
   * @param accessToken - the actor's token.
   * @param id - the document.
   * @param args - the other arguments.
   * @returns the response.
   */
  const update = (
    accessToken: string,
    id: string,
    args: Record<string, unknown>
  ) => callMcpTool(server, accessToken, "update_document", { id, ...args });

  it("commits a data image equal to the baseline update, modulo IDs", async () => {
    const { user, accessToken, viewers, collection, unconfigured } =
      await fixture();
    const [document, baseline] = await Promise.all([
      documentIn(user, collection.id),
      documentIn(user, unconfigured.id),
    ]);
    const keys = recordKeys();
    const args = { text: `\n\n${DATA_IMAGE}`, editMode: TextEditMode.Append };

    const enforced = success(await update(accessToken, document.id, args));
    const [key] = keys.splice(0);
    const enforcedRows = await comparableRows(user.teamId);
    const [row] = await Attachment.unscoped().findAll({
      where: { teamId: user.teamId },
    });
    success(await update(accessToken, baseline.id, args));

    expect(enforced.validation?.status).toBe("validated");
    expect(row.key).toBe(`uploads/${user.id}/${row.id}/pixel`);
    expect(key).toBe(row.key);
    const stored = await storedFields(document.id);
    expect(stored.text).toContain(`/api/attachments.redirect?id=${row.id}`);
    expect(stored.text).not.toContain("data:");
    expect(normalized(stored)).toEqual(
      normalized(await storedFields(baseline.id))
    );
    // The baseline update added one more row with the same values.
    expect([...enforcedRows, ...enforcedRows]).toEqual(
      await comparableRows(user.teamId)
    );
    expect(await blobsExist([key])).toEqual([true]);
    expect(await access(viewers, [key])).toEqual([
      { redirect: 302, files: 200 },
    ]);
    const [created] = await Event.findAll({
      where: { name: "attachments.create", modelId: row.id },
    });
    const [updated] = await Event.findAll({
      where: { name: "documents.update", documentId: document.id },
    });
    expect(created.data?.validationCorrelationId).toEqual(expect.any(String));
    expect(created.data?.validationCorrelationId).toBe(
      updated.data?.validationCorrelationId
    );
  });

  it("keeps a source the baseline fails to import, without a row, and commits", async () => {
    const { user, accessToken, collection, unconfigured } = await fixture();
    const [document, baseline] = await Promise.all([
      documentIn(user, collection.id),
      documentIn(user, unconfigured.id),
    ]);
    // Markdown admits no `data:` image whose MIME type is over the limit.
    const oversize = `![big](data:image/png;base64,${"A".repeat(400)})`;
    const args = { text: `\n\n${oversize}`, editMode: TextEditMode.Append };
    const maxSize = env.FILE_STORAGE_UPLOAD_MAX_SIZE;
    env.FILE_STORAGE_UPLOAD_MAX_SIZE = 200;
    try {
      expect(
        success(await update(accessToken, document.id, args)).validation?.status
      ).toBe("validated");
      success(await update(accessToken, baseline.id, args));
    } finally {
      env.FILE_STORAGE_UPLOAD_MAX_SIZE = maxSize;
    }

    const stored = await storedFields(document.id);
    expect(stored.text).toContain(`data:image/png;base64,${"A".repeat(400)}`);
    expect(normalized(stored)).toEqual(
      normalized(await storedFields(baseline.id))
    );
    expect(await Attachment.count({ where: { teamId: user.teamId } })).toBe(0);
  });

  it.each([
    {
      name: "a rejection",
      args: { text: `${INVALID}\n\n${DATA_IMAGE}` },
      expectResult: expectRejected,
      summary: "rejected",
    },
    {
      name: "a projection failure",
      args: {
        text: DATA_IMAGE,
        editMode: TextEditMode.Patch,
        findText: "absent text",
      },
      expectResult: (response: McpResponse) =>
        expectToolError(
          response,
          "The specified text was not found in the document"
        ),
      summary: "aborted_before_decision",
    },
    {
      name: "a failed materialization",
      args: { text: `${VALID}\n\n${DATA_IMAGE}` },
      expectResult: (response: McpResponse) => expectToolError(response),
      failInsert: true,
      summary: "aborted_after_decision",
    },
  ])(
    "leaves no effect and deletes the staged blob on $name",
    async ({ args, expectResult, failInsert, summary }) => {
      const { user, accessToken, viewers, collection } = await fixture();
      const document = await documentIn(user, collection.id);
      const events = await effectEvents(user.teamId);
      const keys = recordKeys();
      if (failInsert) {
        interceptQueries((sql, _options, next) =>
          sql.startsWith('INSERT INTO "attachments"')
            ? Promise.reject(new Error("insert failed"))
            : next()
        );
      }

      expectResult(await update(accessToken, document.id, args));

      expect(keys).toHaveLength(1);
      expect(await blobsExist(keys)).toEqual([false]);
      expect(await access(viewers, keys)).toEqual(inaccessible(1));
      expect(await Attachment.count({ where: { teamId: user.teamId } })).toBe(
        0
      );
      expect(await effectEvents(user.teamId)).toBe(events);
      expect(await summariesOf(user.teamId)).toEqual([
        { outcome: summary, documentId: document.id },
      ]);
      expect((await storedFields(document.id)).text).toBe(document.text);
    }
  );

  it("ends in row 5 and deletes the blob on a server-reported COMMIT error", async () => {
    const { user, accessToken, viewers, collection } = await fixture();
    const document = await documentIn(user, collection.id);
    const keys = recordKeys();

    const response = await withFailingCommit(user.id, () =>
      update(accessToken, document.id, { text: `${VALID}\n\n${DATA_IMAGE}` })
    );

    expectToolError(response);
    expect(await blobsExist(keys)).toEqual([false]);
    expect(await access(viewers, keys)).toEqual(inaccessible(1));
    expect((await storedFields(document.id)).text).toBe(document.text);
    expect(await summariesOf(user.teamId)).toEqual([
      { outcome: "aborted_after_decision", documentId: document.id },
    ]);
  });

  it("ends in row 7 and keeps the blob, with no visible row, when no COMMIT landed", async () => {
    const { user, accessToken, viewers, collection } = await fixture();
    const document = await documentIn(user, collection.id);
    const keys = recordKeys();
    onEnforcedCommit((transaction, next) => {
      destroySocket(transaction);
      return next();
    });

    expectToolError(
      await update(accessToken, document.id, {
        text: `${VALID}\n\n${DATA_IMAGE}`,
      })
    );

    vi.restoreAllMocks();
    expect(await blobsExist(keys)).toEqual([true]);
    expect(await access(viewers, keys)).toEqual(inaccessible(1));
    expect(await Attachment.count({ where: { teamId: user.teamId } })).toBe(0);
    expect((await storedFields(document.id)).text).toBe(document.text);
    expect(await summariesOf(user.teamId)).toEqual([]);
  });

  it("commits with its row and blob on a socket error after a real COMMIT", async () => {
    const { user, accessToken, viewers, collection } = await fixture();
    const document = await documentIn(user, collection.id);
    const keys = recordKeys();
    onEnforcedCommit(async (transaction, next) => {
      await next();
      destroySocket(transaction);
      throw socketError();
    });

    const response = success(
      await update(accessToken, document.id, {
        text: `${VALID}\n\n${DATA_IMAGE}`,
      })
    );

    vi.restoreAllMocks();
    expect(response.validation?.status).toBe("validated");
    expect(await blobsExist(keys)).toEqual([true]);
    expect(await access(viewers, keys)).toEqual([
      { redirect: 302, files: 200 },
    ]);
    expect(await summariesOf(user.teamId)).toEqual([
      { outcome: "validated", documentId: document.id },
    ]);
  });

  it.each([
    ["rejects", () => Promise.reject(new Error("delete failed for a key"))],
    ["hangs", () => new Promise<void>(() => undefined)],
  ])(
    "reports a cleanup whose deletion %s once, minimized, with the same result",
    async (_name, deletion) => {
      const { user, accessToken, viewers, collection } = await fixture();
      const document = await documentIn(user, collection.id);
      const keys = recordKeys();
      vi.spyOn(FileStorage, "deleteFile").mockImplementation(deletion);
      const warn = vi.spyOn(Logger, "warn");

      expectRejected(
        await update(accessToken, document.id, {
          text: `${INVALID}\n\n${DATA_IMAGE}`,
        })
      );

      const reports = warn.mock.calls.filter(
        ([message]) => message === "Enforced write staged media cleanup failed"
      );
      expect(reports).toHaveLength(1);
      const [[, extra]] = reports;
      expect(Object.keys(extra ?? {}).sort()).toEqual([
        "attachmentIds",
        "attemptId",
        "invocationId",
        "requestId",
      ]);
      expect(extra?.attachmentIds).toEqual([
        AttachmentHelper.parseKey(keys[0]).id,
      ]);
      expect(JSON.stringify(reports)).not.toMatch(
        /uploads|pixel|data:|delete failed/
      );
      vi.restoreAllMocks();
      expect(await blobsExist(keys)).toEqual([true]);
      expect(await access(viewers, keys)).toEqual(inaccessible(1));
    }
  );
});

describe("an enforced HTML create with media", () => {
  /**
   * Creates a document from HTML.
   *
   * @param accessToken - the actor's token.
   * @param args - the arguments.
   * @returns the response.
   */
  const createHtml = (accessToken: string, args: Record<string, unknown>) =>
    callMcpTool(server, accessToken, "create_document", {
      format: "html",
      ...args,
    });

  it("commits a data image, a data link, and an external image equal to the baseline import, modulo IDs", async () => {
    serveExternal();
    const { user, accessToken, viewers, collection, unconfigured } =
      await fixture();
    const intents = recordIntents();
    const keys = recordKeys();

    const enforced = success(
      await createHtml(accessToken, {
        text: mediaHtml(),
        collectionId: collection.id,
      })
    );
    const staged = keys.splice(0);
    const enforcedRows = await comparableRows(user.teamId);
    const baseline = success(
      await createHtml(accessToken, {
        text: mediaHtml(),
        collectionId: unconfigured.id,
      })
    );

    const [intent] = intents;
    expect(enforced.id).toBe(intent.documentId);
    expect(enforced.validation?.status).toBe("validated");
    expect(staged).toHaveLength(3);
    // The converted state is dropped; the editor derives it from the content.
    expect(normalized(await storedFields(enforced.id))).toEqual(
      normalized({ ...(await storedFields(baseline.id)), state: null })
    );
    const all = await comparableRows(user.teamId);
    expect(enforcedRows).toHaveLength(3);
    expect(all).toEqual(
      [...enforcedRows, ...enforcedRows].sort((a, b) =>
        a.key.localeCompare(b.key)
      )
    );
    const { text } = await storedFields(enforced.id);
    for (const key of staged) {
      expect(text).toContain(
        `/api/attachments.redirect?id=${AttachmentHelper.parseKey(key).id}`
      );
    }
    expect(await access(viewers, staged)).toEqual(
      staged.map(() => ({ redirect: 302, files: 200 }))
    );
    const events = await Event.findAll({
      where: { name: "attachments.create", teamId: user.teamId },
    });
    expect(
      events.filter(
        (event) => event.data?.validationCorrelationId === intent.invocationId
      )
    ).toHaveLength(3);
    await expect(FileStorage.getFileExists(intent.key)).resolves.toBe(false);
  });

  it("keeps a source whose import fails, as the baseline does, and commits", async () => {
    serveExternal(404);
    const { user, accessToken, collection, unconfigured } = await fixture();
    recordIntents();
    const html = `<h2>Overview</h2><p><img src="${EXTERNAL}"></p><p><img src="data:image/png;base64,${"A".repeat(400)}"></p><p><img src="data:image/${"x".repeat(260)};base64,${PNG_BASE64}"></p>`;
    const maxSize = env.FILE_STORAGE_UPLOAD_MAX_SIZE;
    env.FILE_STORAGE_UPLOAD_MAX_SIZE = 200;
    const keys = recordKeys();
    let enforced: { id: string; validation?: { status: string } };
    let baseline: { id: string };
    let staged: string[];
    try {
      enforced = success(
        await createHtml(accessToken, {
          text: html,
          collectionId: collection.id,
        })
      );
      staged = keys.splice(0);
      baseline = success(
        await createHtml(accessToken, {
          text: html,
          collectionId: unconfigured.id,
        })
      );
    } finally {
      env.FILE_STORAGE_UPLOAD_MAX_SIZE = maxSize;
    }

    expect(enforced.validation?.status).toBe("validated");
    const stored = await storedFields(enforced.id);
    expect(stored.text).toContain(EXTERNAL);
    expect(stored.text).toContain(`data:image/${"x".repeat(260)}`);
    expect(stored.text).toContain(`data:image/png;base64,${"A".repeat(400)}`);
    expect(normalized(stored)).toEqual(
      normalized({ ...(await storedFields(baseline.id)), state: null })
    );
    expect(await Attachment.count({ where: { teamId: user.teamId } })).toBe(0);
    // The refused blob is deleted although a committed write runs no cleanup.
    expect(staged).toHaveLength(3);
    await vi.waitFor(async () =>
      expect(await blobsExist(staged)).toEqual([false, false, false])
    );
  });

  it.each([
    {
      name: "a rejection",
      html: mediaHtml(false),
      expectResult: expectRejected,
      job: {
        kind: "rejected",
        validation: {
          status: "rejected",
          errors: [{ code: "REQUIRED_SECTION_MISSING" }],
        },
      },
      summary: "rejected",
    },
    {
      name: "a failed materialization",
      html: mediaHtml(),
      expectResult: (response: McpResponse) => expectToolError(response),
      failInsertAt: 1,
      job: { kind: "aborted", row: 5, message: OPERATION_FAILED },
      summary: "aborted_after_decision",
    },
    {
      name: "a failed later materialization",
      html: mediaHtml(),
      expectResult: (response: McpResponse) => expectToolError(response),
      failInsertAt: 2,
      job: { kind: "aborted", row: 5, message: OPERATION_FAILED },
      summary: "aborted_after_decision",
    },
    {
      name: "a server-reported COMMIT error",
      html: mediaHtml(),
      expectResult: (response: McpResponse) => expectToolError(response),
      failCommit: true,
      job: { kind: "aborted", row: 5, message: OPERATION_FAILED },
      summary: "aborted_after_decision",
    },
  ])(
    "leaves no effect and deletes every staged blob on $name",
    async ({ html, expectResult, failInsertAt, failCommit, job, summary }) => {
      serveExternal();
      const { user, accessToken, viewers, collection } = await fixture();
      const intents = recordIntents();
      const perform = vi.spyOn(EnforcedDocumentImportTask.prototype, "perform");
      const keys = recordKeys();
      if (failInsertAt) {
        let inserts = 0;
        interceptQueries((sql, _options, next) => {
          if (sql.startsWith('INSERT INTO "attachments"')) {
            inserts += 1;
            if (inserts === failInsertAt) {
              return Promise.reject(new Error("insert failed"));
            }
          }
          return next();
        });
      }
      /**
       * Runs the create.
       *
       * @returns the response.
       */
      const run = () =>
        createHtml(accessToken, { text: html, collectionId: collection.id });

      expectResult(
        failCommit ? await withFailingCommit(user.id, run) : await run()
      );

      const [intent] = intents;
      expect(perform.mock.settledResults).toMatchObject([
        { type: "fulfilled", value: job },
      ]);
      expect(await summariesOf(user.teamId)).toEqual([
        { outcome: summary, documentId: null },
      ]);
      expect(keys).toHaveLength(3);
      expect(await blobsExist(keys)).toEqual([false, false, false]);
      expect(await access(viewers, keys)).toEqual(inaccessible(3));
      expect(await Attachment.count({ where: { teamId: user.teamId } })).toBe(
        0
      );
      expect(
        await Document.unscoped().count({
          where: { id: intent.documentId },
          paranoid: false,
        })
      ).toBe(0);
      expect(
        await Event.count({
          where: { name: "attachments.create", teamId: user.teamId },
        })
      ).toBe(0);
    }
  );

  it("returns collection_conflict and deletes every staged blob when the parent moves inside P3", async () => {
    serveExternal();
    const { user, accessToken, viewers, collection, unconfigured } =
      await fixture();
    const parent = await documentIn(user, collection.id);
    recordIntents();
    const keys = recordKeys();
    let moved = false;
    interceptQueries(async (sql, _options, next) => {
      if (sql === "SELECT id FROM documents WHERE id = :documentId" && !moved) {
        moved = true;
        await Document.unscoped().update(
          { collectionId: unconfigured.id },
          { where: { id: parent.id }, hooks: false }
        );
      }
      return next();
    });

    expectToolError(
      await createHtml(accessToken, {
        text: mediaHtml(),
        parentDocumentId: parent.id,
      }),
      JSON.stringify({ error: { id: COLLECTION_CONFLICT } })
    );

    expect(moved).toBe(true);
    expect(keys).toHaveLength(3);
    expect(await blobsExist(keys)).toEqual([false, false, false]);
    expect(await access(viewers, keys)).toEqual(inaccessible(3));
  });

  it("reports row 7 and keeps the blobs, with no visible row, when no COMMIT landed", async () => {
    serveExternal();
    const { user, accessToken, viewers, collection } = await fixture();
    const intents = recordIntents();
    const keys = recordKeys();
    onEnforcedCommit((transaction, next) => {
      destroySocket(transaction);
      return next();
    });

    expectToolError(
      await createHtml(accessToken, {
        text: mediaHtml(),
        collectionId: collection.id,
      })
    );

    vi.restoreAllMocks();
    const [intent] = intents;
    expect(await blobsExist(keys)).toEqual([true, true, true]);
    expect(await access(viewers, keys)).toEqual(inaccessible(3));
    expect(await Attachment.count({ where: { teamId: user.teamId } })).toBe(0);
    expect(
      await Document.unscoped().count({
        where: { id: intent.documentId },
        paranoid: false,
      })
    ).toBe(0);
  });

  it("commits with its rows and blobs on a socket error after a real COMMIT", async () => {
    serveExternal();
    const { accessToken, viewers, collection } = await fixture();
    const intents = recordIntents();
    const keys = recordKeys();
    onEnforcedCommit(async (transaction, next) => {
      await next();
      destroySocket(transaction);
      throw socketError();
    });

    const response = success(
      await createHtml(accessToken, {
        text: mediaHtml(),
        collectionId: collection.id,
      })
    );

    vi.restoreAllMocks();
    expect(response.id).toBe(intents[0].documentId);
    expect(await blobsExist(keys)).toEqual([true, true, true]);
    expect(await access(viewers, keys)).toEqual(
      keys.map(() => ({ redirect: 302, files: 200 }))
    );
  });

  it("reports a failed cleanup once, minimized, with the same result", async () => {
    serveExternal();
    const { accessToken, viewers, collection } = await fixture();
    const intents = recordIntents();
    const keys = recordKeys();
    const deleteFile = FileStorage.deleteFile.bind(FileStorage);
    // The staged source is still deleted; the staged media are not.
    vi.spyOn(FileStorage, "deleteFile").mockImplementation((key) =>
      key.endsWith("/source.html")
        ? deleteFile(key)
        : Promise.reject(new Error("delete failed for a key"))
    );
    const warn = vi.spyOn(Logger, "warn");

    expectRejected(
      await createHtml(accessToken, {
        text: mediaHtml(false),
        collectionId: collection.id,
      })
    );

    const reports = warn.mock.calls.filter(
      ([message]) => message === "Enforced write staged media cleanup failed"
    );
    expect(reports).toHaveLength(1);
    const [intent] = intents;
    expect(reports[0][1]).toMatchObject({
      requestId: intent.requestId,
      invocationId: intent.invocationId,
      attemptId: expect.any(String),
    });
    expect(reports[0][1]?.attachmentIds).toEqual(
      keys.map((key) => AttachmentHelper.parseKey(key).id)
    );
    expect(JSON.stringify(reports)).not.toMatch(
      /uploads|pixel|report|data:|delete failed/
    );
    vi.restoreAllMocks();
    expect(await blobsExist(keys)).toEqual([true, true, true]);
    expect(await access(viewers, keys)).toEqual(inaccessible(3));
  });

  it("stages nothing on a worker-time fingerprint mismatch", async () => {
    serveExternal();
    const { user, accessToken, collection } = await fixture();
    const store = vi.spyOn(FileStorage, "store");
    const storeFromUrl = vi.spyOn(FileStorage, "storeFromUrl");
    // The storage calls made before the worker ran: the staged source.
    let before: number[] = [];
    recordIntents(() => {
      configure([[collection, "read_only"]]);
      before = [store.mock.calls.length, storeFromUrl.mock.calls.length];
    });

    const response = await createHtml(accessToken, {
      text: mediaHtml(),
      collectionId: collection.id,
    });

    const block = JSON.parse(response?.result?.content?.[0]?.text ?? "");
    expect(block.validation.status).toBe("rejected");
    expect(block.validation.systemFailures[0].code).toBe(
      "POLICY_CONFIGURATION_INVALID"
    );
    expect(before).toEqual([1, 0]);
    expect([store.mock.calls.length, storeFromUrl.mock.calls.length]).toEqual(
      before
    );
    expect(await Attachment.count({ where: { teamId: user.teamId } })).toBe(0);
  });
});

describe("unchanged scopes", () => {
  it.each(["read_only", "unconfigured"] as const)(
    "runs the baseline import for a %s collection",
    async (scope) => {
      serveExternal();
      const { user, accessToken, collection, unconfigured } = await fixture();
      const target = await buildCollection({
        teamId: user.teamId,
        userId: user.id,
      });
      configure(scope === "read_only" ? [[target, "read_only"]] : []);
      const [document, baseline] = await Promise.all([
        documentIn(user, target.id),
        documentIn(user, unconfigured.id),
      ]);
      void collection;
      // The baseline importers create their Attachments with
      // `attachmentCreator`; the stager runs on no baseline path.
      const importers = [
        vi.spyOn(TextHelper, "replaceImagesWithAttachments"),
        vi.spyOn(ProsemirrorHelper, "replaceImagesWithAttachments"),
      ];
      const stager = [
        vi.spyOn(MediaStager.prototype, "stageMarkdown"),
        vi.spyOn(MediaStager.prototype, "stageProsemirror"),
      ];
      const args = { text: `\n\n${DATA_IMAGE}`, editMode: TextEditMode.Append };

      const updated = success(
        await callMcpTool(server, accessToken, "update_document", {
          id: document.id,
          ...args,
        })
      );
      const created = success(
        await callMcpTool(server, accessToken, "create_document", {
          text: mediaHtml(),
          format: "html",
          collectionId: target.id,
        })
      );
      for (const importer of importers) {
        expect(importer).toHaveBeenCalledTimes(1);
      }
      for (const stage of stager) {
        expect(stage).not.toHaveBeenCalled();
      }
      expect(await Attachment.count({ where: { teamId: user.teamId } })).toBe(
        4
      );
      success(
        await callMcpTool(server, accessToken, "update_document", {
          id: baseline.id,
          ...args,
        })
      );
      const baselineCreated = success(
        await callMcpTool(server, accessToken, "create_document", {
          text: mediaHtml(),
          format: "html",
          collectionId: unconfigured.id,
        })
      );

      expect(updated).not.toHaveProperty("validation");
      expect(created).not.toHaveProperty("validation");
      expect(normalized(await storedFields(document.id))).toEqual(
        normalized(await storedFields(baseline.id))
      );
      expect(normalized(await storedFields(created.id))).toEqual(
        normalized(await storedFields(baselineCreated.id))
      );
      expect(await Attachment.count({ where: { teamId: user.teamId } })).toBe(
        8
      );
    }
  );

  it("stages nothing and creates no row for a sentinel", async () => {
    serveExternal();
    const { user, accessToken, unconfigured } = await fixture();
    const sentinel = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    configure([[sentinel, "sentinel"]]);
    const document = await documentIn(user, sentinel.id);
    const store = vi.spyOn(FileStorage, "store");
    const storeFromUrl = vi.spyOn(FileStorage, "storeFromUrl");
    void unconfigured;

    for (const response of [
      await callMcpTool(server, accessToken, "update_document", {
        id: document.id,
        text: `${VALID}\n\n${DATA_IMAGE}`,
      }),
      await callMcpTool(server, accessToken, "create_document", {
        text: mediaHtml(),
        format: "html",
        collectionId: sentinel.id,
      }),
    ]) {
      const block = JSON.parse(response?.result?.content?.[0]?.text ?? "");
      expect(block.validation.systemFailures[0].code).toBe(
        "POLICY_CONFIGURATION_INVALID"
      );
    }

    expect(store).not.toHaveBeenCalled();
    expect(storeFromUrl).not.toHaveBeenCalled();
    expect(await Attachment.count({ where: { teamId: user.teamId } })).toBe(0);
  });

  it("stores a Markdown create's data image inline, as the baseline does", async () => {
    const { user, accessToken, collection, unconfigured } = await fixture();
    const storeFromUrl = vi.spyOn(FileStorage, "storeFromUrl");
    const args = { title: "Inline", text: `${VALID}\n\n${DATA_IMAGE}` };

    const enforced = success(
      await callMcpTool(server, accessToken, "create_document", {
        ...args,
        collectionId: collection.id,
      })
    );
    const baseline = success(
      await callMcpTool(server, accessToken, "create_document", {
        ...args,
        collectionId: unconfigured.id,
      })
    );

    expect(enforced.validation?.status).toBe("validated");
    expect(storeFromUrl).not.toHaveBeenCalled();
    const stored = await storedFields(enforced.id);
    expect(stored.text).toContain(DATA_SRC);
    expect(stored).toEqual(await storedFields(baseline.id));
    expect(await Attachment.count({ where: { teamId: user.teamId } })).toBe(0);
  });
});
