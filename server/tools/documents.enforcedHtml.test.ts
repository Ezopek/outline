import { createHash, randomUUID } from "node:crypto";
import type { Job } from "bull";
import { QueryTypes } from "sequelize";
import { yDocToProsemirrorJSON } from "y-prosemirror";
import * as Y from "yjs";
import { DocumentPermission, Scope } from "@shared/types";
import {
  Attachment,
  type Collection,
  Document,
  Event,
  type User,
  UserMembership,
} from "@server/models";
import DocumentImportTask from "@server/queues/tasks/DocumentImportTask";
import EnforcedDocumentImportTask from "@server/queues/tasks/EnforcedDocumentImportTask";
import { BaseTask } from "@server/queues/tasks/base/BaseTask";
import { sequelize } from "@server/storage/database";
import FileStorage from "@server/storage/files";
import {
  buildCollection,
  buildDocument,
  buildOAuthAuthentication,
  buildTemplate,
  buildUser,
} from "@server/test/factories";
import { buildOAuthUser, callMcpTool } from "@server/test/McpHelper";
import { getTestServer } from "@server/test/support";
import type * as PolicyConfig from "@server/wikiLint/adapters/policyConfig";
import type { AuditDataV1 } from "@server/wikiLint/adapters/auditEvents";
import type { EnforcedImportIntent } from "@server/wikiLint/application/enforcedImport";
import type { PolicySet } from "@server/wikiLint/core/policySet";
import { buildPolicySet } from "@server/wikiLint/core/policySet";
import { OPERATION_FAILED } from "@server/wikiLint/core/registry";

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

/** The policy entry of each policy state; `absent` has none. */
const POLICIES = {
  absent: undefined,
  read_only: { activation: "read_only", rules },
  enforced: { activation: "enforced", rules },
  sentinel: { activation: "read_only", rules: [] },
  // Another valid fingerprint for the same collection.
  reconfigured: {
    activation: "enforced",
    rules: [...rules, { kind: "internal_links" }],
  },
} as const;

type PolicyState = keyof typeof POLICIES;

/** A body that satisfies `rules`. */
const VALID_HTML = "<h1>Imported</h1><h2>Overview</h2><p>ok</p>";

/** A body that violates `rules`. */
const BODY = "Text without the required section";

type McpResponse = Awaited<ReturnType<typeof callMcpTool>>;

/** Matches a UUID. */
const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/**
 * Serves a policy set with each collection in its policy state.
 *
 * @param collections - each collection and its state.
 * @returns the served set.
 */
function configure(collections: [Collection, PolicyState][]): PolicySet {
  const entries: Record<string, unknown> = {};
  for (const [collection, policyState] of collections) {
    const policy = POLICIES[policyState];
    if (policy) {
      entries[collection.id] = policy;
    }
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
 * Returns the valid fingerprint of a collection in a set.
 *
 * @param set - the set.
 * @param collectionId - the collection.
 * @returns the fingerprint.
 */
function fingerprintOf(set: PolicySet, collectionId: string): string {
  const entry = set.entries.find((item) => item.collectionId === collectionId);
  if (entry?.status !== "valid") {
    throw new Error("Expected a valid policy");
  }
  return entry.policyFingerprint;
}

/**
 * Builds an access token with the scopes of `buildOAuthUser`.
 *
 * @param user - the user.
 * @returns the actor and their token.
 */
async function actorOf(user: User) {
  const auth = await buildOAuthAuthentication({
    user,
    scope: [Scope.Read, Scope.Write, Scope.Create],
  });
  return { user, accessToken: auth.accessToken! };
}

/**
 * Builds an actor and a collection.
 *
 * @returns the fixture.
 */
async function fixture() {
  const actor = await buildOAuthUser();
  const collection = await buildCollection({
    teamId: actor.user.teamId,
    userId: actor.user.id,
  });
  return { ...actor, collection };
}

/**
 * Returns the spy that the server test setup installs on task scheduling.
 *
 * @returns the spy.
 */
const scheduleSpy = () => vi.spyOn(BaseTask.prototype, "schedule");

/**
 * Records the enforced intents scheduled from now on; each job runs
 * lazily, as in every server test.
 *
 * @param before - runs, and is awaited, before the job is performed.
 * @returns the intents.
 */
function recordIntents(before?: () => unknown): EnforcedImportIntent[] {
  const intents: EnforcedImportIntent[] = [];
  scheduleSpy().mockImplementation(function (
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
 * Lists the enforced import jobs scheduled so far in the test.
 *
 * @returns the scheduling task instances of the enforced task.
 */
const enforcedJobs = () =>
  scheduleSpy().mock.contexts.filter(
    (context) => context instanceof EnforcedDocumentImportTask
  );

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
 * Lists a team's Wiki lint Events.
 *
 * @param teamId - the team.
 * @returns the Events.
 */
const wikiLintEvents = (teamId: string) =>
  sequelize.query(
    `SELECT id FROM events WHERE "teamId" = :teamId AND name LIKE 'wikiLint.%'`,
    { replacements: { teamId }, type: QueryTypes.SELECT }
  );

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
 * Reads the stored fields an HTML create must match the baseline in.
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
    icon: document.icon,
    color: document.color,
    fullWidth: document.fullWidth,
    sourceMetadata: document.sourceMetadata,
    published: document.publishedAt !== null,
  };
}

/**
 * Returns the first content block of a response with every UUID that is not
 * a known fixture identifier replaced by `<allocated>`.
 *
 * @param response - the response.
 * @param known - the fixture identifiers to keep.
 * @returns the normalized text.
 */
function normalizedText(response: McpResponse, known: readonly string[]) {
  return (response?.result?.content?.[0]?.text ?? "").replace(
    UUID_PATTERN,
    (id) => (known.includes(id) ? id : "<allocated>")
  );
}

afterEach(() => {
  state.policySet = undefined;
  vi.restoreAllMocks();
});

/**
 * Builds a private enforced collection with a published parent, its member,
 * and a user who can edit only that parent.
 *
 * @returns the fixture.
 */
async function membershipFixture() {
  const member = await buildOAuthUser();
  const editor = await actorOf(await buildUser({ teamId: member.user.teamId }));
  const collection = await buildCollection({
    teamId: member.user.teamId,
    userId: member.user.id,
    permission: null,
  });
  const parent = await buildDocument({
    teamId: member.user.teamId,
    userId: member.user.id,
    collectionId: collection.id,
    title: "Shared",
  });
  await UserMembership.create({
    documentId: parent.id,
    userId: editor.user.id,
    createdById: member.user.id,
    permission: DocumentPermission.ReadWrite,
  });
  return { member, editor, collection, parent };
}

describe("enforced HTML creates", () => {
  it("commits a text-only create equal to the baseline import, with validation last", async () => {
    const { user, accessToken, collection } = await fixture();
    const baselineCollection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const set = configure([[collection, "enforced"]]);
    const intents = recordIntents();
    const baselineJob = vi.spyOn(DocumentImportTask, "scheduleAndWait");

    const enforced = await callMcpTool(server, accessToken, "create_document", {
      text: VALID_HTML,
      format: "html",
      icon: "😀",
      collectionId: collection.id,
    });
    expect(baselineJob).not.toHaveBeenCalled();
    const baseline = await callMcpTool(server, accessToken, "create_document", {
      text: VALID_HTML,
      format: "html",
      icon: "😀",
      collectionId: baselineCollection.id,
    });

    expect(enforced?.result?.isError).toBeUndefined();
    expect(enforced?.result?.content).toHaveLength(1);
    const first = JSON.parse(enforced?.result?.content?.[0]?.text ?? "");
    const baselineFirst = JSON.parse(
      baseline?.result?.content?.[0]?.text ?? ""
    );
    expect(Object.keys(first)).toEqual([
      ...Object.keys(baselineFirst),
      "validation",
    ]);
    expect(first.validation).toEqual({
      status: "validated",
      policySchemaVersion: 1,
      policyFingerprint: fingerprintOf(set, collection.id),
      errors: [],
      warnings: [],
      systemFailures: [],
    });
    const [intent] = intents;
    expect(first.id).toBe(intent.documentId);
    expect(await storedFields(first.id)).toEqual(
      await storedFields(baselineFirst.id)
    );

    const events = (await Event.findAll({ where: { documentId: first.id } }))
      .filter((event) => event.name !== "wikiLint.write_validation")
      .map((event) => ({ name: event.name, data: event.data }));
    const baselineEvents = (
      await Event.findAll({ where: { documentId: baselineFirst.id } })
    ).map((event) => event.name);
    expect(events.map((event) => event.name).sort()).toEqual(
      baselineEvents.sort()
    );
    for (const event of events) {
      expect(event.data).toMatchObject({
        validationCorrelationId: intent.invocationId,
      });
    }
    const [summary, ...rest] = await summaries(intent.invocationId);
    expect(rest).toEqual([]);
    expect(summary).toMatchObject({
      documentId: first.id,
      data: { outcome: "validated", operation: "create_document" },
    });
    await expect(FileStorage.getFileExists(intent.key)).resolves.toBe(false);
  });

  it("commits a draft with every create attribute equal to the baseline import", async () => {
    const { user, accessToken, collection } = await fixture();
    const baselineCollection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    configure([[collection, "enforced"]]);
    const intents = recordIntents();
    const args = {
      title: "Explicit title",
      text: VALID_HTML,
      format: "html",
      icon: "😀",
      color: "#FF0000",
      fullWidth: true,
      publish: false,
      sourceFileName: "notes.html",
    };

    const enforced = await callMcpTool(server, accessToken, "create_document", {
      ...args,
      collectionId: collection.id,
    });
    const baseline = await callMcpTool(server, accessToken, "create_document", {
      ...args,
      collectionId: baselineCollection.id,
    });

    const first = JSON.parse(enforced?.result?.content?.[0]?.text ?? "");
    const baselineFirst = JSON.parse(
      baseline?.result?.content?.[0]?.text ?? ""
    );
    expect(first.validation).toMatchObject({ status: "validated" });
    expect(first.id).toBe(intents[0].documentId);
    const stored = await storedFields(first.id);
    expect(stored).toEqual(await storedFields(baselineFirst.id));
    expect(stored).toMatchObject({
      title: "Explicit title",
      icon: "😀",
      color: "#FF0000",
      fullWidth: true,
      published: false,
      sourceMetadata: { fileName: "notes.html", mimeType: "text/html" },
    });
  });

  it.each([
    ["commits", VALID_HTML, "validated"],
    ["rejects", `<p>${BODY}</p>`, "rejected"],
  ])(
    "%s a non-reader's create without any collection or policy identity",
    async (_name, text, status) => {
      const { editor, collection, parent } = await membershipFixture();
      configure([[collection, "enforced"]]);
      const intents = recordIntents();

      const response = await callMcpTool(
        server,
        editor.accessToken,
        "create_document",
        { title: "Child", text, format: "html", parentDocumentId: parent.id }
      );

      expect(response?.result?.isError).toBeUndefined();
      expect(intents.map((intent) => intent.readable)).toEqual([false]);
      const body = JSON.stringify(response);
      expect(
        JSON.parse(response?.result?.content?.[0]?.text ?? "").validation
      ).toMatchObject({ status });
      for (const field of [
        "policySchemaVersion",
        "policyFingerprint",
        "collectionId",
        "detail",
        collection.id,
      ]) {
        expect(body).not.toContain(field);
      }
    }
  );

  it("rejects exactly as the Markdown create of the same body, without any effect", async () => {
    const { user, accessToken, collection } = await fixture();
    configure([[collection, "enforced"]]);
    const intents = recordIntents();
    const documents = await Document.unscoped().count({
      where: { teamId: user.teamId },
      paranoid: false,
    });

    const html = await callMcpTool(server, accessToken, "create_document", {
      title: "Written",
      text: `<p>${BODY}</p>`,
      format: "html",
      collectionId: collection.id,
    });
    const markdown = await callMcpTool(server, accessToken, "create_document", {
      title: "Written",
      text: BODY,
      collectionId: collection.id,
    });

    expect(html?.result?.isError).toBeUndefined();
    expect(html?.result?.content).toHaveLength(1);
    expect(normalizedText(html, [collection.id])).toBe(
      normalizedText(markdown, [collection.id])
    );
    expect(JSON.parse(html?.result?.content?.[0]?.text ?? "")).toMatchObject({
      success: false,
      validation: { status: "rejected" },
    });
    expect(
      await Document.unscoped().count({
        where: { teamId: user.teamId },
        paranoid: false,
      })
    ).toBe(documents);
    const [intent] = intents;
    expect(
      await Event.count({ where: { documentId: intent.documentId } })
    ).toBe(0);
    expect(await Attachment.count({ where: { teamId: user.teamId } })).toBe(0);
    const [summary] = await summaries(intent.invocationId);
    expect(summary.data).toMatchObject({
      outcome: "rejected",
      complete: true,
      evaluatedDocumentCount: 1,
    });
    await expect(FileStorage.getFileExists(intent.key)).resolves.toBe(false);
  });

  it("reports an unestablished outcome as the fixed isError result", async () => {
    const { accessToken, collection } = await fixture();
    configure([[collection, "enforced"]]);
    scheduleSpy().mockRejectedValue(new Error("queue down"));

    const response = await callMcpTool(server, accessToken, "create_document", {
      text: VALID_HTML,
      format: "html",
      collectionId: collection.id,
    });

    expect(response?.result).toEqual({
      content: [{ type: "text", text: OPERATION_FAILED }],
      isError: true,
    });
  });

  it("returns { success, id, validation } when the committed document cannot be loaded", async () => {
    const { accessToken, collection } = await fixture();
    configure([[collection, "enforced"]]);
    const intents = recordIntents();
    const findByPk = Document.findByPk.bind(Document);
    vi.spyOn(Document, "findByPk").mockImplementation(((
      id: string,
      options?: { transaction?: unknown }
    ) =>
      options?.transaction
        ? findByPk(id, options as never)
        : Promise.reject(new Error("load failed"))) as never);

    const response = await callMcpTool(server, accessToken, "create_document", {
      text: VALID_HTML,
      format: "html",
      collectionId: collection.id,
    });

    expect(response?.result?.isError).toBeUndefined();
    expect(JSON.parse(response?.result?.content?.[0]?.text ?? "")).toEqual({
      success: true,
      id: intents[0].documentId,
      validation: expect.objectContaining({ status: "validated" }),
    });
  });

  it("ignores client arguments that imitate the intent", async () => {
    const { user, accessToken, collection } = await fixture();
    const set = configure([[collection, "enforced"]]);
    const intents = recordIntents();
    const forged = randomUUID();

    await callMcpTool(server, accessToken, "create_document", {
      text: VALID_HTML,
      format: "html",
      collectionId: collection.id,
      actorId: forged,
      documentId: forged,
      readable: false,
      expectedPolicyFingerprint: `sha256:${"0".repeat(64)}`,
      deadlineAt: 1,
      intent: { actorId: forged, key: "uploads/other/source.html" },
    });

    const [intent] = intents;
    expect(intent).toMatchObject({
      actorId: user.id,
      readable: true,
      expectedPolicyFingerprint: fingerprintOf(set, collection.id),
    });
    expect(intent.documentId).not.toBe(forged);
    expect(intent.deadlineAt).toBeGreaterThan(Date.now());
    expect(intent.key).toBe(
      `uploads/${user.id}/${intent.invocationId}/source.html`
    );
    expect(Object.keys(intent)).not.toContain("intent");
  });
});

describe("worker-time failures", () => {
  /**
   * Expects an `isError` result without `validation` and no document.
   *
   * @param response - the response.
   * @param text - the exact text of its block.
   * @param intent - the scheduled intent.
   */
  async function expectFailure(
    response: McpResponse,
    text: string,
    intent: EnforcedImportIntent
  ) {
    expect(response?.result).toEqual({
      content: [{ type: "text", text }],
      isError: true,
    });
    expect(
      await Document.unscoped().findByPk(intent.documentId, {
        paranoid: false,
      })
    ).toBeNull();
    expect(
      await Event.count({ where: { documentId: intent.documentId } })
    ).toBe(0);
    await expect(FileStorage.getFileExists(intent.key)).resolves.toBe(false);
  }

  it("reports an authorization denial with its message and an aborted summary", async () => {
    const owner = await buildOAuthUser();
    const editor = await actorOf(
      await buildUser({ teamId: owner.user.teamId })
    );
    const collection = await buildCollection({
      teamId: owner.user.teamId,
      userId: owner.user.id,
      permission: null,
    });
    const membership = await UserMembership.create({
      collectionId: collection.id,
      userId: editor.user.id,
      createdById: owner.user.id,
      permission: DocumentPermission.ReadWrite,
    });
    configure([[collection, "enforced"]]);
    const intents = recordIntents(() => membership.destroy());

    const response = await callMcpTool(
      server,
      editor.accessToken,
      "create_document",
      { text: VALID_HTML, format: "html", collectionId: collection.id }
    );

    const [intent] = intents;
    await expectFailure(response, "Authorization error", intent);
    const [summary] = await summaries(intent.invocationId);
    expect(summary.data.outcome).toBe("aborted_before_decision");
  });

  it("reports a parent moved before the worker as collection_conflict without a summary", async () => {
    const { user, accessToken, collection } = await fixture();
    const other = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const parent = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
    });
    configure([[collection, "enforced"]]);
    const intents = recordIntents(() =>
      sequelize.query(
        `UPDATE documents SET "collectionId" = :other WHERE id = :id`,
        { replacements: { other: other.id, id: parent.id } }
      )
    );

    const response = await callMcpTool(server, accessToken, "create_document", {
      text: VALID_HTML,
      format: "html",
      parentDocumentId: parent.id,
    });

    const [intent] = intents;
    await expectFailure(
      response,
      JSON.stringify({ error: { id: "collection_conflict" } }),
      intent
    );
    expect(await summaries(intent.invocationId)).toEqual([]);
  });

  it("reports importable media as a projection failure without an Attachment", async () => {
    const { user, accessToken, collection } = await fixture();
    configure([[collection, "enforced"]]);
    const intents = recordIntents();

    const response = await callMcpTool(server, accessToken, "create_document", {
      text: `<h2>Overview</h2><p><img src="https://example.com/a.png"></p>`,
      format: "html",
      collectionId: collection.id,
    });

    const [intent] = intents;
    await expectFailure(response, OPERATION_FAILED, intent);
    expect(await Attachment.count({ where: { teamId: user.teamId } })).toBe(0);
    const [summary] = await summaries(intent.invocationId);
    expect(summary.data.outcome).toBe("aborted_before_decision");
  });

  it("reports a transaction rollback in P7 as row 5", async () => {
    const { accessToken, collection } = await fixture();
    configure([[collection, "enforced"]]);
    const intents = recordIntents();
    const query = sequelize.query.bind(sequelize) as (
      ...args: unknown[]
    ) => Promise<unknown>;
    vi.spyOn(sequelize, "query").mockImplementation(((...args: unknown[]) => {
      const [first] = args;
      const sql =
        typeof first === "string" ? first : (first as { query: string }).query;
      return sql.startsWith('INSERT INTO "documents"')
        ? Promise.reject(new Error("writer failed"))
        : query(...args);
    }) as never);

    const response = await callMcpTool(server, accessToken, "create_document", {
      text: VALID_HTML,
      format: "html",
      collectionId: collection.id,
    });

    const [intent] = intents;
    await expectFailure(response, OPERATION_FAILED, intent);
    const [summary] = await summaries(intent.invocationId);
    expect(summary.data.outcome).toBe("aborted_after_decision");
  });

  it("authorizes a template but does not apply it, as the baseline import", async () => {
    const { user, accessToken, collection } = await fixture();
    const template = await buildTemplate({
      teamId: user.teamId,
      userId: user.id,
      title: "Template title",
      text: "## Template body",
    });
    configure([[collection, "enforced"]]);
    const intents = recordIntents();

    const response = await callMcpTool(server, accessToken, "create_document", {
      text: VALID_HTML,
      format: "html",
      collectionId: collection.id,
      templateId: template.id,
    });

    const [intent] = intents;
    expect(JSON.stringify(intent)).not.toContain(template.id);
    const { id } = JSON.parse(response?.result?.content?.[0]?.text ?? "");
    const stored = await Document.unscoped().findByPk(id, {
      paranoid: false,
      rejectOnEmpty: true,
    });
    expect(stored.templateId).toBeNull();
    expect(stored.title).toBe("Imported");
    expect(stored.text).not.toContain("Template body");

    const denied = await callMcpTool(server, accessToken, "create_document", {
      text: VALID_HTML,
      format: "html",
      collectionId: collection.id,
      templateId: randomUUID(),
    });
    expect(denied?.result?.isError).toBe(true);
    expect(intents).toHaveLength(1);
  });
});

describe("a worker-time fingerprint mismatch", () => {
  it.each(["read_only", "absent", "sentinel", "reconfigured"] as const)(
    "rejects with the request-time identity only for a reader when the worker sees %s",
    async (workerState) => {
      const { member, editor, collection, parent } = await membershipFixture();
      const set = configure([[collection, "enforced"]]);
      const fingerprint = fingerprintOf(set, collection.id);
      const intents = recordIntents(() =>
        configure([[collection, workerState]])
      );

      const responses = [];
      for (const actor of [editor, member]) {
        configure([[collection, "enforced"]]);
        responses.push(
          await callMcpTool(server, actor.accessToken, "create_document", {
            title: "Child",
            text: VALID_HTML,
            format: "html",
            parentDocumentId: parent.id,
          })
        );
      }
      const [hidden, visible] = responses;

      /**
       * Builds the expected mismatch rejection.
       *
       * @param readable - whether the actor can read the collection.
       * @returns the first content block.
       */
      const expected = (readable: boolean) =>
        JSON.stringify({
          success: false,
          validation: {
            status: "rejected",
            ...(readable && {
              policySchemaVersion: 1,
              policyFingerprint: fingerprint,
            }),
            errors: [],
            warnings: [],
            systemFailures: [
              {
                code: "POLICY_CONFIGURATION_INVALID",
                message: "The collection lint policy is invalid.",
                location: {
                  kind: "scope",
                  scopeKind: "collection",
                  ...(readable && { collectionId: collection.id }),
                },
              },
            ],
          },
        });
      expect(hidden?.result?.isError).toBeUndefined();
      expect(hidden?.result?.content?.[0]?.text).toBe(expected(false));
      expect(visible?.result?.content?.[0]?.text).toBe(expected(true));
      expect(intents.map((intent) => intent.readable)).toEqual([false, true]);
      for (const intent of intents) {
        const [summary] = await summaries(intent.invocationId);
        expect(summary.data).toMatchObject({
          outcome: "rejected",
          complete: false,
          policySchemaVersion: 1,
          policyFingerprint: fingerprint,
          evaluatedDocumentCount: 0,
          counts: {
            systemFailures: 1,
            byCode: { POLICY_CONFIGURATION_INVALID: 1 },
          },
        });
        expect(
          await Document.unscoped().findByPk(intent.documentId, {
            paranoid: false,
          })
        ).toBeNull();
      }
    }
  );
});

describe("selection", () => {
  it.each(["unconfigured", "read_only", "absent"] as const)(
    "keeps a %s HTML create on the exact baseline job",
    async (policyState) => {
      const { user, accessToken, collection } = await fixture();
      const other = await buildCollection({
        teamId: user.teamId,
        userId: user.id,
      });
      configure(
        policyState === "unconfigured"
          ? []
          : policyState === "absent"
            ? [[other, "enforced"]]
            : [[collection, "read_only"]]
      );
      const job = vi.spyOn(DocumentImportTask, "scheduleAndWait");

      const response = await callMcpTool(
        server,
        accessToken,
        "create_document",
        {
          title: "Imported",
          text: VALID_HTML,
          format: "html",
          icon: "😀",
          collectionId: collection.id,
        }
      );

      expect(enforcedJobs()).toEqual([]);
      expect(job).toHaveBeenCalledTimes(1);
      expect(job.mock.calls[0][0]).toEqual({
        content: VALID_HTML,
        sourceMetadata: { fileName: "document.html", mimeType: "text/html" },
        attributes: {
          title: "Imported",
          icon: "😀",
          color: undefined,
          fullWidth: undefined,
        },
        userId: user.id,
        publish: true,
        collectionId: collection.id,
        parentDocumentId: undefined,
        authType: "mcp",
        ip: expect.any(String),
      });
      expect(response?.result?.isError).toBeUndefined();
      expect(JSON.stringify(response)).not.toContain("validation");
      expect(
        JSON.parse(response?.result?.content?.[0]?.text ?? "")
      ).toMatchObject({ success: true, title: "Imported" });
      expect(await wikiLintEvents(user.teamId)).toEqual([]);
    }
  );

  it("schedules no job of either task for a sentinel", async () => {
    const { user, accessToken, collection } = await fixture();
    configure([[collection, "sentinel"]]);
    const schedule = scheduleSpy();
    schedule.mockClear();

    const response = await callMcpTool(server, accessToken, "create_document", {
      text: VALID_HTML,
      format: "html",
      collectionId: collection.id,
    });

    expect(schedule).not.toHaveBeenCalled();
    expect(
      JSON.parse(response?.result?.content?.[0]?.text ?? "")
    ).toMatchObject({
      success: false,
      validation: {
        status: "rejected",
        systemFailures: [{ code: "POLICY_CONFIGURATION_INVALID" }],
      },
    });
    expect(await wikiLintEvents(user.teamId)).toEqual([]);
  });
});
