import { createHash, randomUUID } from "node:crypto";
import { yDocToProsemirrorJSON } from "y-prosemirror";
import * as Y from "yjs";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { DocumentPermission, Scope, TextEditMode } from "@shared/types";
import {
  Attachment,
  Collection,
  Document,
  Event,
  type User,
  UserMembership,
} from "@server/models";
import { ProsemirrorHelper } from "@server/models/helpers/ProsemirrorHelper";
import { globalEventQueue } from "@server/queues";
import DocumentImportTask from "@server/queues/tasks/DocumentImportTask";
import { sequelize } from "@server/storage/database";
import FileStorage from "@server/storage/files";
import {
  buildCollection,
  buildDocument,
  buildOAuthAuthentication,
  buildTemplate,
  buildUser,
} from "@server/test/factories";
import {
  buildOAuthUser,
  callMcpTool,
  mcpHeaders,
  mcpRequest,
} from "@server/test/McpHelper";
import { getTestServer } from "@server/test/support";
import type * as PolicyConfig from "@server/wikiLint/adapters/policyConfig";
import type * as DeadlineModule from "@server/wikiLint/application/deadline";
import type { PolicySet } from "@server/wikiLint/core/policySet";
import { buildPolicySet } from "@server/wikiLint/core/policySet";
import {
  COLLECTION_CONFLICT,
  OPERATION_FAILED,
} from "@server/wikiLint/core/registry";

/** What the two replaced seams serve; reset after each test. */
const state = vi.hoisted(() => ({
  /** The served policy set; the real getter serves when unset. */
  policySet: undefined as PolicySet | undefined,
  /** The served monotonic clock; the real clock serves when unset. */
  clock: undefined as (() => number) | undefined,
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
    monotonicClock: () => (state.clock ?? actual.monotonicClock)(),
  };
});

const server = getTestServer();

const sha256Hex = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** Requires an Overview section, which no written body below has. */
const rules = [
  { kind: "required_sections", headingLevel: 2, headings: ["Overview"] },
];

/** The policy entry of each policy state; `absent` has none. */
const POLICIES = {
  absent: undefined,
  read_only: { activation: "read_only", rules },
  enforced: { activation: "enforced", rules },
  // An empty rule list fails validation, so the entry becomes a sentinel.
  sentinel: { activation: "read_only", rules: [] },
} as const;

type PolicyState = keyof typeof POLICIES;

const POLICY_STATES = Object.keys(POLICIES) as PolicyState[];

/** A written body that violates `rules`. */
const BODY = "Text without the required section";

/** Body text that imitates policy front matter. */
const POLICY_PROSE = [
  "---",
  "activation: read_only",
  "runtimeFailureMode: open",
  "policy: none",
  "---",
  "",
  BODY,
].join("\n");

/** Arguments that imitate policy input; the input schemas have none. */
const POLICY_ARGUMENTS = {
  activation: "read_only",
  runtimeFailureMode: "open",
  policy: { activation: "read_only", rules: [] },
};

/** A one-pixel PNG. */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

type McpResponse = Awaited<ReturnType<typeof callMcpTool>>;

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
 * Builds the modeled invalid-policy rejection.
 *
 * @param set - the served set.
 * @param collectionId - the sentinel collection.
 * @param readable - whether the actor can read it.
 * @returns the exact text of the first content block.
 */
function sentinelRejection(
  set: PolicySet,
  collectionId: string,
  readable: boolean
): string {
  const entry = set.entries.find((item) => item.collectionId === collectionId);
  if (entry?.status !== "invalid") {
    throw new Error("Expected a sentinel");
  }
  return JSON.stringify({
    success: false,
    validation: {
      status: "rejected",
      ...(readable && { invalidFingerprint: entry.invalidFingerprint }),
      errors: [],
      warnings: [],
      systemFailures: [
        {
          code: "POLICY_CONFIGURATION_INVALID",
          message: "The collection lint policy is invalid.",
          location: {
            kind: "scope",
            scopeKind: "collection",
            ...(readable && { collectionId }),
          },
        },
      ],
    },
  });
}

/**
 * Checks a modeled rejection: one JSON text block, without `isError`.
 *
 * @param response - the response.
 * @param expected - the exact text of the block.
 */
function expectRejection(response: McpResponse, expected: string) {
  expect(response?.error).toBeUndefined();
  expect(response?.result?.isError).toBeUndefined();
  expect(response?.result?.content).toHaveLength(1);
  expect(response?.result?.content?.[0]?.text).toBe(expected);
}

/**
 * Checks the fixed-message `isError` result without `validation`.
 *
 * @param response - the response.
 */
function expectOperationFailed(response: McpResponse) {
  expect(response?.result).toEqual({
    content: [{ type: "text", text: OPERATION_FAILED }],
    isError: true,
  });
}

/**
 * Reads a team's Document, Collection, Event, and Attachment rows, plus the
 * stored state of one target document. Other tables are covered by the
 * mutating-SQL check of `callWithoutEffect`.
 *
 * @param teamId - the team.
 * @param targetId - the target document, if any.
 * @returns the rows.
 */
async function storedState(teamId: string, targetId?: string) {
  const order: [string, string][] = [["id", "ASC"]];
  const [documents, collections, events, attachments, target] =
    await Promise.all([
      Document.unscoped().findAll({
        where: { teamId },
        paranoid: false,
        order,
        raw: true,
      }),
      Collection.unscoped().findAll({
        where: { teamId },
        paranoid: false,
        order,
        raw: true,
      }),
      Event.findAll({ where: { teamId }, order, raw: true }),
      Attachment.unscoped().findAll({ where: { teamId }, order, raw: true }),
      targetId
        ? Document.unscoped().findByPk(targetId, {
            attributes: [
              "collectionId",
              "publishedAt",
              "revisionCount",
              "text",
            ],
            paranoid: false,
            raw: true,
          })
        : null,
    ]);
  return { documents, collections, events, attachments, target };
}

/**
 * Calls a write that must have no effect and proves it: no import job, no
 * scheduled or enqueued Event, no mutating SQL, and no snapshotted row or
 * target field changed. A sentinel or pre-classification failure opens no
 * transaction; an enforced write rejected before persistence opens exactly
 * its one enforcement transaction.
 *
 * @param actor - the actor and their access token.
 * @param tool - the tool.
 * @param args - the arguments.
 * @param targetId - the target document, if any.
 * @param transactions - the number of transactions the write may open.
 * @returns the response.
 */
async function callWithoutEffect(
  actor: { user: User; accessToken: string },
  tool: string,
  args: Record<string, unknown>,
  targetId?: string,
  transactions = 0
): Promise<McpResponse> {
  // Settles the throttled authentication activity writes first.
  await callMcpTool(server, actor.accessToken, "list_collections");
  const before = await storedState(actor.user.teamId, targetId);
  const transaction = vi.spyOn(sequelize, "transaction");
  const importJob = vi.spyOn(DocumentImportTask, "scheduleAndWait");
  const scheduledEvent = vi.spyOn(Event, "schedule");
  const enqueued = vi.spyOn(globalEventQueue(), "add");
  const query = vi.spyOn(sequelize, "query");

  const response = await callMcpTool(server, actor.accessToken, tool, args);

  const statements = query.mock.calls.map(([sql]) =>
    typeof sql === "string" ? sql : sql.query
  );
  expect(transaction).toHaveBeenCalledTimes(transactions);
  expect(importJob).not.toHaveBeenCalled();
  expect(scheduledEvent).not.toHaveBeenCalled();
  expect(enqueued).not.toHaveBeenCalled();
  // The recorder sees the request's own reads, so it would see a mutation.
  expect(statements.some((sql) => /^\s*SELECT\b/i.test(sql))).toBe(true);
  expect(
    statements.filter((sql) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql))
  ).toEqual([]);
  transaction.mockRestore();
  importJob.mockRestore();
  scheduledEvent.mockRestore();
  enqueued.mockRestore();
  query.mockRestore();
  await expect(storedState(actor.user.teamId, targetId)).resolves.toEqual(
    before
  );
  return response;
}

/** Matches a UUID. */
const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/**
 * Returns the first content block of a response with every UUID that is not
 * a known fixture identifier replaced by `<allocated>`: the pre-allocated ID
 * of a create.
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

/**
 * Builds the modeled rejection of a written body that lacks the required
 * Overview section.
 *
 * @param set - the served set.
 * @param collectionId - the enforced collection.
 * @param documentId - the written document, or `<allocated>` for a create.
 * @param readable - whether the actor can read the collection.
 * @returns the exact text of the first content block.
 */
function enforcedRejection(
  set: PolicySet,
  collectionId: string,
  documentId: string,
  readable: boolean
): string {
  const entry = set.entries.find((item) => item.collectionId === collectionId);
  if (entry?.status !== "valid") {
    throw new Error("Expected a valid policy");
  }
  return JSON.stringify({
    success: false,
    validation: {
      status: "rejected",
      ...(readable && {
        policySchemaVersion: 1,
        policyFingerprint: entry.policyFingerprint,
      }),
      errors: [
        {
          code: "REQUIRED_SECTION_MISSING",
          severity: "error",
          message: "A required section is missing.",
          location: { kind: "document", documentId },
          ...(readable && {
            detail: { kind: "section", heading: "Overview", headingLevel: 2 },
          }),
        },
      ],
      warnings: [],
      systemFailures: [],
    },
  });
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

afterEach(() => {
  state.policySet = undefined;
  state.clock = undefined;
  vi.restoreAllMocks();
});

/** One destination-selection fixture. */
interface Fixture {
  user: User;
  accessToken: string;
  /** The collection whose policy state varies. */
  collection: Collection;
  /** Always an invalid-policy sentinel; passed only where it cannot steer. */
  decoy: Collection;
  /** The updated document, or the parent of a create. */
  target?: Document;
}

/** One AD-8 destination-selection path of an MCP write. */
interface WritePath {
  name: string;
  tool: "create_document" | "update_document";
  /** Whether the varied collection is the post-operation collection. */
  classified: boolean;
  /**
   * Builds the target, if any.
   *
   * @param fixture - the fixture without a target.
   * @returns the target.
   */
  target?: (fixture: Fixture) => Promise<Document>;
  /**
   * Returns the arguments.
   *
   * @param fixture - the fixture.
   * @returns the arguments.
   */
  args: (fixture: Fixture) => Record<string, unknown>;
}

/**
 * Builds a document of the fixture user.
 *
 * @param fixture - the fixture.
 * @param overrides - the document attributes.
 * @returns the document.
 */
const targetDocument = (
  fixture: Fixture,
  overrides: Parameters<typeof buildDocument>[0]
) =>
  buildDocument({
    teamId: fixture.user.teamId,
    userId: fixture.user.id,
    title: "Target",
    text: "Original text",
    ...overrides,
  });

const WRITE_PATHS: WritePath[] = [
  {
    name: "direct-collection Markdown create",
    tool: "create_document",
    classified: true,
    args: ({ collection }) => ({
      title: "Written",
      text: BODY,
      collectionId: collection.id,
    }),
  },
  {
    name: "direct-collection HTML create",
    tool: "create_document",
    classified: true,
    args: ({ collection }) => ({
      title: "Written",
      text: `<p>${BODY}</p>`,
      format: "html",
      collectionId: collection.id,
    }),
  },
  {
    name: "parent-derived create with another collectionId",
    tool: "create_document",
    classified: true,
    target: (fixture) =>
      targetDocument(fixture, { collectionId: fixture.collection.id }),
    args: ({ target, decoy }) => ({
      title: "Written",
      text: BODY,
      parentDocumentId: target!.id,
      collectionId: decoy.id,
    }),
  },
  {
    name: "collected-document update with another collectionId",
    tool: "update_document",
    classified: true,
    target: (fixture) =>
      targetDocument(fixture, { collectionId: fixture.collection.id }),
    args: ({ target, decoy }) => ({
      id: target!.id,
      text: BODY,
      collectionId: decoy.id,
    }),
  },
  {
    name: "collected-draft publication with another collectionId",
    tool: "update_document",
    classified: true,
    target: (fixture) =>
      targetDocument(fixture, {
        collectionId: fixture.collection.id,
        publishedAt: null,
      }),
    args: ({ target, decoy }) => ({
      id: target!.id,
      publish: true,
      collectionId: decoy.id,
    }),
  },
  {
    name: "collectionless-draft update without publication",
    tool: "update_document",
    classified: false,
    target: (fixture) => targetDocument(fixture, { collectionId: null }),
    args: ({ target, collection }) => ({
      id: target!.id,
      text: BODY,
      collectionId: collection.id,
    }),
  },
  {
    name: "collectionless-draft publication",
    tool: "update_document",
    classified: true,
    target: (fixture) => targetDocument(fixture, { collectionId: null }),
    args: ({ target, collection }) => ({
      id: target!.id,
      text: BODY,
      publish: true,
      collectionId: collection.id,
    }),
  },
  {
    name: "unpublish with retained collection and another collectionId",
    tool: "update_document",
    classified: true,
    target: (fixture) =>
      targetDocument(fixture, { collectionId: fixture.collection.id }),
    args: ({ target, decoy }) => ({
      id: target!.id,
      publish: false,
      collectionId: decoy.id,
    }),
  },
];

/**
 * Builds a fixture for one write path.
 *
 * @param path - the path.
 * @returns the fixture.
 */
async function buildFixture(path: WritePath): Promise<Fixture> {
  const { user, accessToken } = await buildOAuthUser();
  const [collection, decoy] = [
    await buildCollection({ teamId: user.teamId, userId: user.id }),
    await buildCollection({ teamId: user.teamId, userId: user.id }),
  ];
  const fixture: Fixture = { user, accessToken, collection, decoy };
  fixture.target = await path.target?.(fixture);
  return fixture;
}

/**
 * Normalizes a successful write: the response shape and the stored written
 * document, with fixture identifiers replaced by their roles.
 *
 * @param response - the response.
 * @param fixture - the fixture.
 * @returns the outcome.
 */
async function writeOutcome(response: McpResponse, fixture: Fixture) {
  const result = response?.result;
  expect(response?.error).toBeUndefined();
  expect(result?.isError).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain("validation");
  const first = JSON.parse(result?.content?.[0]?.text ?? "{}");
  const document = await Document.unscoped().findByPk(first.id, {
    paranoid: false,
    rejectOnEmpty: true,
  });
  const roles = new Map([
    [fixture.collection.id, "collection"],
    [fixture.decoy.id, "decoy"],
    [fixture.target?.id, "target"],
  ]);
  const role = (id?: string | null) => (id ? (roles.get(id) ?? id) : null);
  return {
    blocks: result?.content?.length,
    keys: Object.keys(first),
    success: first.success,
    title: document.title,
    text: document.text,
    collection: role(document.collectionId),
    parent: role(document.parentDocumentId),
    published: document.publishedAt !== null,
    revisionCount: document.revisionCount,
  };
}

describe("destination selection across policy states", () => {
  describe.each(WRITE_PATHS)("$name", (path) => {
    it.each(POLICY_STATES)(
      "in a collection with %s policy",
      async (policyState) => {
        const expected =
          path.classified && policyState === "enforced"
            ? "enforced"
            : path.classified && policyState === "sentinel"
              ? "sentinel"
              : "baseline";
        const fixture = await buildFixture(path);
        const set = configure([
          [fixture.collection, policyState],
          [fixture.decoy, "sentinel"],
        ]);

        if (expected === "sentinel") {
          const response = await callWithoutEffect(
            fixture,
            path.tool,
            path.args(fixture),
            fixture.target?.id
          );
          expectRejection(
            response,
            sentinelRejection(set, fixture.collection.id, true)
          );
          return;
        }
        if (expected === "enforced") {
          // An HTML create runs in its worker task, which records its summary
          // and deletes its staged source.
          if (path.args(fixture).format === "html") {
            const documents = await Document.unscoped().count({
              where: { teamId: fixture.user.teamId },
              paranoid: false,
            });
            const stored = vi.spyOn(FileStorage, "store");
            const response = await callMcpTool(
              server,
              fixture.accessToken,
              path.tool,
              path.args(fixture)
            );
            expect(response?.result?.isError).toBeUndefined();
            expect(response?.result?.content).toHaveLength(1);
            expect(
              normalizedText(response, [
                fixture.collection.id,
                fixture.decoy.id,
              ])
            ).toBe(
              enforcedRejection(set, fixture.collection.id, "<allocated>", true)
            );
            expect(
              await Document.unscoped().count({
                where: { teamId: fixture.user.teamId },
                paranoid: false,
              })
            ).toBe(documents);
            const [{ key }] = stored.mock.calls.map(([args]) => args);
            const invocationId = key.split("/")[2];
            const events = await Event.findAll({
              where: { teamId: fixture.user.teamId },
              raw: true,
            });
            expect(
              events.filter((event) => event.name.startsWith("documents."))
            ).toEqual([]);
            expect(
              events
                .filter((event) => event.name === "wikiLint.write_validation")
                .map((event) => ({
                  id: event.id,
                  outcome: (event.data as { outcome?: string }).outcome,
                }))
            ).toEqual([{ id: invocationId, outcome: "rejected" }]);
            await expect(FileStorage.getFileExists(key)).resolves.toBe(false);
            return;
          }
          const response = await callWithoutEffect(
            fixture,
            path.tool,
            path.args(fixture),
            fixture.target?.id,
            1
          );
          expect(response?.result?.isError).toBeUndefined();
          expect(response?.result?.content).toHaveLength(1);
          expect(
            normalizedText(response, [
              fixture.collection.id,
              fixture.decoy.id,
              ...(fixture.target ? [fixture.target.id] : []),
            ])
          ).toBe(
            enforcedRejection(
              set,
              fixture.collection.id,
              path.tool === "create_document"
                ? "<allocated>"
                : fixture.target!.id,
              true
            )
          );
          return;
        }

        const configured = await writeOutcome(
          await callMcpTool(
            server,
            fixture.accessToken,
            path.tool,
            path.args(fixture)
          ),
          fixture
        );
        const unconfiguredFixture = await buildFixture(path);
        configure([]);
        const unconfigured = await writeOutcome(
          await callMcpTool(
            server,
            unconfiguredFixture.accessToken,
            path.tool,
            path.args(unconfiguredFixture)
          ),
          unconfiguredFixture
        );

        expect(configured).toEqual(unconfigured);
        expect(configured.success).toBe(true);
        if (!path.classified) {
          expect(configured.collection).toBeNull();
        }
      }
    );
  });
});

describe("invalid-policy sentinel", () => {
  /** AD-10 paths beyond the destination table, each with its target. */
  const sentinelPaths: {
    name: string;
    tool: string;
    args: (fixture: {
      user: User;
      collection: Collection;
      document: Document;
    }) => Promise<Record<string, unknown>>;
  }[] = [
    {
      name: "a template create",
      tool: "create_document",
      args: async ({ user, collection }) => {
        const template = await buildTemplate({
          teamId: user.teamId,
          userId: user.id,
          collectionId: collection.id,
          text: BODY,
        });
        return { collectionId: collection.id, templateId: template.id };
      },
    },
    {
      name: "a patch whose findText is absent",
      tool: "update_document",
      args: async ({ document }) => ({
        id: document.id,
        editMode: "patch",
        findText: "absent text",
        text: BODY,
      }),
    },
    {
      name: "an update with no changed field",
      tool: "update_document",
      args: async ({ document }) => ({ id: document.id, title: "Target" }),
    },
    {
      name: "an update with no field",
      tool: "update_document",
      args: async ({ document }) => ({ id: document.id }),
    },
    {
      name: "an update with a base64 image",
      tool: "update_document",
      args: async ({ document }) => ({
        id: document.id,
        text: `${BODY}\n\n![image](data:image/png;base64,${PNG_BASE64})`,
      }),
    },
  ];

  it.each(sentinelPaths)(
    "rejects $name without any effect or in-writer check",
    async ({ tool, args }) => {
      const actor = await buildOAuthUser();
      const { user } = actor;
      const collection = await buildCollection({
        teamId: user.teamId,
        userId: user.id,
      });
      const document = await buildDocument({
        teamId: user.teamId,
        userId: user.id,
        collectionId: collection.id,
        title: "Target",
      });
      const set = configure([[collection, "sentinel"]]);

      const response = await callWithoutEffect(
        actor,
        tool,
        await args({ user, collection, document }),
        document.id
      );

      expectRejection(response, sentinelRejection(set, collection.id, true));
    }
  );

  it.each(["sentinel", "enforced"] as const)(
    "keeps the baseline result when P0 fails under a %s policy",
    async (policyState) => {
      const owner = await buildOAuthUser();
      const outsider = await actorOf(
        await buildUser({ teamId: owner.user.teamId })
      );
      const collection = await buildCollection({
        teamId: owner.user.teamId,
        userId: owner.user.id,
        permission: null,
      });
      const publicCollection = await buildCollection({
        teamId: owner.user.teamId,
        userId: owner.user.id,
      });
      const privateTemplate = await buildTemplate({
        teamId: owner.user.teamId,
        userId: owner.user.id,
        collectionId: collection.id,
      });
      const document = await buildDocument({
        teamId: owner.user.teamId,
        userId: owner.user.id,
        collectionId: collection.id,
      });
      const outsiderDraft = await buildDocument({
        teamId: owner.user.teamId,
        userId: outsider.user.id,
        collectionId: null,
      });
      const calls: [typeof owner, string, Record<string, unknown>][] = [
        [owner, "update_document", { id: randomUUID(), text: BODY }],
        [
          outsider,
          "create_document",
          {
            title: "Denied",
            text: BODY,
            collectionId: publicCollection.id,
            templateId: privateTemplate.id,
          },
        ],
        [
          outsider,
          "update_document",
          { id: outsiderDraft.id, publish: true, collectionId: collection.id },
        ],
        [outsider, "update_document", { id: document.id, text: BODY }],
        [outsider, "update_document", { id: document.id, publish: false }],
        [
          outsider,
          "create_document",
          { title: "Denied", text: BODY, collectionId: collection.id },
        ],
        [
          outsider,
          "create_document",
          { title: "Denied", text: BODY, parentDocumentId: document.id },
        ],
      ];

      for (const [actor, tool, args] of calls) {
        configure([]);
        const unconfigured = await callMcpTool(
          server,
          actor.accessToken,
          tool,
          args
        );
        configure([
          [collection, policyState],
          [publicCollection, policyState],
        ]);
        const configured = await callWithoutEffect(
          actor,
          tool,
          args,
          document.id
        );

        expect(unconfigured?.result?.isError).toBe(true);
        expect(configured?.result).toEqual(unconfigured?.result);
      }
    }
  );
});

describe("actors who cannot read the classified collection", () => {
  /**
   * Builds a private sentinel collection with a published document, its
   * member, and a user who can edit only that document.
   *
   * @returns the fixture.
   */
  async function buildMembershipFixture(policyState: "sentinel" | "enforced") {
    const member = await buildOAuthUser();
    const documentEditor = await actorOf(
      await buildUser({ teamId: member.user.teamId })
    );
    const collection = await buildCollection({
      teamId: member.user.teamId,
      userId: member.user.id,
      permission: null,
    });
    const document = await buildDocument({
      teamId: member.user.teamId,
      userId: member.user.id,
      collectionId: collection.id,
      title: "Shared",
    });
    await UserMembership.create({
      documentId: document.id,
      userId: documentEditor.user.id,
      createdById: member.user.id,
      permission: DocumentPermission.ReadWrite,
    });
    const set = configure([[collection, policyState]]);
    return { member, documentEditor, collection, document, set };
  }

  /** The three AC14 paths, as calls of one actor. */
  const paths: {
    name: string;
    tool: string;
    call: (
      actor: { user: User },
      fixture: Awaited<ReturnType<typeof buildMembershipFixture>>
    ) => Promise<{ args: Record<string, unknown>; targetId?: string }>;
  }[] = [
    {
      name: "a document-membership update",
      tool: "update_document",
      call: async (_actor, { document }) => ({
        args: { id: document.id, text: BODY },
        targetId: document.id,
      }),
    },
    {
      name: "publication of a parent-bearing collectionless draft",
      tool: "update_document",
      call: async ({ user }, { collection, document }) => {
        const draft = await buildDocument({
          teamId: user.teamId,
          userId: user.id,
          collectionId: null,
          parentDocumentId: document.id,
          title: "Draft",
          text: BODY,
        });
        return {
          args: { id: draft.id, publish: true, collectionId: collection.id },
          targetId: draft.id,
        };
      },
    },
    {
      name: "a create under a parent reachable by document membership",
      tool: "create_document",
      call: async (_actor, { document }) => ({
        args: { title: "Child", text: BODY, parentDocumentId: document.id },
      }),
    },
  ];

  describe.each(["sentinel", "enforced"] as const)(
    "under a %s policy",
    (policyState) => {
      it.each(paths)(
        "omits every identity on $name and keeps it for a collection reader",
        async ({ tool, call }) => {
          const fixture = await buildMembershipFixture(policyState);
          const { member, documentEditor, collection, set } = fixture;
          const transactions = policyState === "enforced" ? 1 : 0;
          /**
           * Builds the expected rejection of one actor's call.
           *
           * @param targetId - the written document, if it exists.
           * @param readable - whether the actor can read the collection.
           * @returns the exact text of the first content block.
           */
          const expected = (targetId: string | undefined, readable: boolean) =>
            policyState === "sentinel"
              ? sentinelRejection(set, collection.id, readable)
              : enforcedRejection(
                  set,
                  collection.id,
                  targetId ?? "<allocated>",
                  readable
                );

          const editorCall = await call(documentEditor, fixture);
          const hidden = await callWithoutEffect(
            documentEditor,
            tool,
            editorCall.args,
            editorCall.targetId,
            transactions
          );
          const memberCall = await call(member, fixture);
          const visible = await callWithoutEffect(
            member,
            tool,
            memberCall.args,
            memberCall.targetId,
            transactions
          );

          const known = [
            collection.id,
            fixture.document.id,
            ...[editorCall.targetId, memberCall.targetId].filter(
              (id): id is string => id !== undefined
            ),
          ];
          expect(hidden?.result?.isError).toBeUndefined();
          expect(normalizedText(hidden, known)).toBe(
            expected(editorCall.targetId, false)
          );
          const hiddenText = hidden?.result?.content?.[0]?.text ?? "";
          for (const field of [
            "invalidFingerprint",
            "policyFingerprint",
            "policySchemaVersion",
            "collectionId",
            "detail",
            collection.id,
          ]) {
            expect(hiddenText).not.toContain(field);
          }
          expect(visible?.result?.isError).toBeUndefined();
          expect(normalizedText(visible, known)).toBe(
            expected(memberCall.targetId, true)
          );
        }
      );
    }
  );
});

describe("collectionless-draft publication into an enforced collection", () => {
  it("rejects a draft with a known Error before publication, leaving it unpublished", async () => {
    const actor = await buildOAuthUser();
    const { user } = actor;
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const draft = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: null,
      text: BODY,
    });
    const revisionCount = draft.revisionCount;
    const set = configure([[collection, "enforced"]]);

    expectRejection(
      await callWithoutEffect(
        actor,
        "update_document",
        { id: draft.id, publish: true, collectionId: collection.id },
        draft.id,
        1
      ),
      enforcedRejection(set, collection.id, draft.id, true)
    );

    const stored = await Document.unscoped().findByPk(draft.id, {
      rejectOnEmpty: true,
    });
    expect(stored.collectionId).toBeNull();
    expect(stored.publishedAt).toBeNull();
    expect(stored.revisionCount).toBe(revisionCount);
  });
});

describe("request-supplied values", () => {
  it.each(["read_only", "enforced", "sentinel"] as const)(
    "cannot select policy for a %s collection",
    async (policyState) => {
      const actor = await buildOAuthUser();
      const { user } = actor;
      const collection = await buildCollection({
        teamId: user.teamId,
        userId: user.id,
      });
      const [plainTarget, extraTarget] = [
        await buildDocument({
          teamId: user.teamId,
          userId: user.id,
          collectionId: collection.id,
          title: "Target",
        }),
        await buildDocument({
          teamId: user.teamId,
          userId: user.id,
          collectionId: collection.id,
          title: "Target",
        }),
      ];
      configure([[collection, policyState]]);
      const create = { title: "Written", collectionId: collection.id };
      const pairs: [
        Record<string, unknown>,
        Record<string, unknown>,
        string,
      ][] = [
        [
          { ...create, text: BODY },
          { ...create, text: BODY, ...POLICY_ARGUMENTS },
          "create_document",
        ],
        [
          { ...create, text: BODY },
          { ...create, text: POLICY_PROSE },
          "create_document",
        ],
        [
          { id: plainTarget.id, text: BODY },
          { id: extraTarget.id, text: POLICY_PROSE, ...POLICY_ARGUMENTS },
          "update_document",
        ],
      ];

      /**
       * Calls a write; a rejected or failed one must have no effect.
       *
       * @param tool - the tool.
       * @param args - the arguments.
       * @returns the response.
       */
      const call = (tool: string, args: Record<string, unknown>) =>
        policyState === "read_only"
          ? callMcpTool(server, actor.accessToken, tool, args)
          : callWithoutEffect(
              actor,
              tool,
              args,
              args.id as string | undefined,
              policyState === "enforced" ? 1 : 0
            );

      for (const [plain, extra, tool] of pairs) {
        const without = await call(tool, plain);
        const withExtra = await call(tool, extra);

        if (policyState === "enforced") {
          // Only the written document's identity differs between the two.
          const written = (response: McpResponse, id?: unknown) =>
            normalizedText(response, [collection.id]).replace(
              typeof id === "string" ? id : "<allocated>",
              "<written>"
            );
          expect(withExtra?.result?.isError).toBeUndefined();
          expect(written(withExtra, extra.id)).toBe(written(without, plain.id));
          expect(written(without, plain.id)).toContain('"status":"rejected"');
        } else if (policyState === "read_only") {
          for (const response of [without, withExtra]) {
            expect(response?.result?.isError).toBeUndefined();
            expect(JSON.stringify(response)).not.toContain("validation");
          }
          expect(
            Object.keys(JSON.parse(withExtra?.result?.content?.[0]?.text ?? ""))
          ).toEqual(
            Object.keys(JSON.parse(without?.result?.content?.[0]?.text ?? ""))
          );
        } else {
          expect(withExtra?.result).toEqual(without?.result);
        }
      }
    }
  );
});

describe("the P0 and P1 bound", () => {
  /**
   * Serves a clock that reads 0 at handler entry and `elapsed` afterwards.
   *
   * @param elapsed - the elapsed time at classification.
   */
  function elapseAtClassification(elapsed: number) {
    let readings = 0;
    state.clock = () => (readings++ === 0 ? 0 : elapsed);
  }

  it.each(["enforced", "sentinel"] as const)(
    "fails a %s write past 2 seconds with the fixed message and no effect",
    async (policyState) => {
      const actor = await buildOAuthUser();
      const { user } = actor;
      const collection = await buildCollection({
        teamId: user.teamId,
        userId: user.id,
      });
      const document = await buildDocument({
        teamId: user.teamId,
        userId: user.id,
        collectionId: collection.id,
      });
      configure([[collection, policyState]]);

      for (const [tool, args, targetId] of [
        [
          "create_document",
          { title: "Late", text: BODY, collectionId: collection.id },
          undefined,
        ],
        ["update_document", { id: document.id, text: BODY }, document.id],
      ] as const) {
        elapseAtClassification(2001);
        expectOperationFailed(
          await callWithoutEffect(actor, tool, args, targetId)
        );
      }
    }
  );

  it("counts the time spent in a P0 lookup from handler entry", async () => {
    const actor = await buildOAuthUser();
    const { user } = actor;
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const document = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
    });
    configure([[collection, "sentinel"]]);
    let now = 0;
    state.clock = () => now;
    // `findByPk` replaces its caller's scope, so binding keeps its behavior.
    const findByPk = Document.findByPk.bind(Document);
    vi.spyOn(Document, "findByPk").mockImplementation(((
      ...args: Parameters<typeof findByPk>
    ) => {
      now += 2001;
      return findByPk(...args);
    }) as typeof Document.findByPk);

    expectOperationFailed(
      await callWithoutEffect(
        actor,
        "update_document",
        { id: document.id, text: BODY },
        document.id
      )
    );
  });

  it("keeps an unconfigured write on the baseline path under the same clock", async () => {
    const { user, accessToken } = await buildOAuthUser();
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const sentinel = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    configure([[sentinel, "sentinel"]]);
    elapseAtClassification(2001);

    const response = await callMcpTool(server, accessToken, "create_document", {
      title: "Late",
      text: BODY,
      collectionId: collection.id,
    });

    expect(response?.result?.isError).toBeUndefined();
    expect(JSON.parse(response?.result?.content?.[0]?.text ?? "")).toEqual(
      expect.objectContaining({ success: true, title: "Late" })
    );
  });
});

describe("baseline writes", () => {
  it("does not reclassify a baseline HTML import job when the policy changes", async () => {
    const { user, accessToken } = await buildOAuthUser();
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    configure([]);
    const scheduleAndWait =
      DocumentImportTask.scheduleAndWait.bind(DocumentImportTask);
    const job = vi
      .spyOn(DocumentImportTask, "scheduleAndWait")
      .mockImplementation((props) => {
        configure([[collection, "sentinel"]]);
        return scheduleAndWait(props);
      });

    const response = await callMcpTool(server, accessToken, "create_document", {
      title: "Imported",
      text: `<p>${BODY}</p>`,
      format: "html",
      collectionId: collection.id,
    });

    expect(job).toHaveBeenCalledTimes(1);
    expect(response?.result?.isError).toBeUndefined();
    expect(JSON.stringify(response)).not.toContain("validation");
    const { id, success } = JSON.parse(
      response?.result?.content?.[0]?.text ?? ""
    );
    expect(success).toBe(true);
    const stored = await Document.findByPk(id, { rejectOnEmpty: true });
    expect(stored.collectionId).toBe(collection.id);
  });

  it.each(["sentinel", "enforced"] as const)(
    "keeps the documents.create and documents.update API routes baseline in a %s collection",
    async (policyState) => {
      const user = await buildUser();
      const collection = await buildCollection({
        teamId: user.teamId,
        userId: user.id,
      });
      configure([[collection, policyState]]);

      const created = await server.post("/api/documents.create", user, {
        body: {
          title: "Created",
          text: BODY,
          collectionId: collection.id,
          publish: true,
        },
      });
      expect(created.status).toBe(200);
      const { data } = await created.json();
      expect(data.collectionId).toBe(collection.id);

      expect(JSON.stringify(data)).not.toContain("validation");

      const updated = await server.post("/api/documents.update", user, {
        body: { id: data.id, text: `${BODY} again` },
      });
      expect(updated.status).toBe(200);
      expect(JSON.stringify(await updated.json())).not.toContain("validation");
      const stored = await Document.findByPk(data.id, { rejectOnEmpty: true });
      expect(stored.text).toBe(`${BODY} again`);
    }
  );
});

describe("move_document and restore_document compatibility evidence", () => {
  it.each(["move_document", "restore_document"] as const)(
    "keeps %s baseline between every ordered pair of policy states",
    async (tool) => {
      const { user, accessToken } = await buildOAuthUser();
      const build = () =>
        buildCollection({ teamId: user.teamId, userId: user.id });
      const sources = new Map<PolicyState, Collection>();
      const destinations = new Map<PolicyState, Collection>();
      for (const policyState of POLICY_STATES) {
        sources.set(policyState, await build());
        destinations.set(policyState, await build());
      }
      configure([
        ...[...sources].map(([s, c]) => [c, s] as [Collection, PolicyState]),
        ...[...destinations].map(
          ([s, c]) => [c, s] as [Collection, PolicyState]
        ),
      ]);
      const moved = new Map<PolicyState, string[]>();
      const shapes: {
        pair: string;
        isError?: boolean;
        keys: string[];
        events: string[];
      }[] = [];
      /**
       * Lists the Events stored for a document.
       *
       * @param documentId - the document.
       * @returns the Events.
       */
      const eventsOf = (documentId: string) =>
        Event.findAll({ where: { documentId }, attributes: ["id", "name"] });

      for (const from of POLICY_STATES) {
        for (const to of POLICY_STATES) {
          const destination = destinations.get(to)!;
          const document = await buildDocument({
            teamId: user.teamId,
            userId: user.id,
            collectionId: sources.get(from)!.id,
            text: BODY,
            ...(tool === "restore_document" && { archivedAt: new Date() }),
          });
          const earlier = new Set(
            (await eventsOf(document.id)).map((event) => event.id)
          );

          const response = await callMcpTool(server, accessToken, tool, {
            id: document.id,
            collectionId: destination.id,
          });

          expect(JSON.stringify(response)).not.toContain("validation");
          expect(response?.result?.content).toHaveLength(1);
          shapes.push({
            pair: `${from}->${to}`,
            isError: response?.result?.isError,
            keys: Object.keys(
              JSON.parse(response?.result?.content?.[0]?.text ?? "")
            ),
            events: (await eventsOf(document.id))
              .filter((event) => !earlier.has(event.id))
              .map((event) => event.name)
              .sort(),
          });
          const stored = await Document.findByPk(document.id, {
            rejectOnEmpty: true,
          });
          expect(stored.collectionId).toBe(destination.id);
          moved.set(to, [...(moved.get(to) ?? []), document.id]);
        }
      }

      const baseline = shapes.find((shape) => shape.pair === "absent->absent");
      expect(baseline).toEqual({
        pair: "absent->absent",
        isError: undefined,
        keys: ["success", "id", "title", "url", "breadcrumb"],
        events: expect.any(Array),
      });
      expect(baseline?.events.length).toBeGreaterThan(0);
      for (const shape of shapes) {
        expect({ ...shape, pair: undefined }).toEqual({
          ...baseline,
          pair: undefined,
        });
      }

      for (const to of POLICY_STATES) {
        const response = await callMcpTool(server, accessToken, "lint_wiki", {
          collectionId: destinations.get(to)!.id,
        });
        const result = JSON.parse(response?.result?.content?.[0]?.text ?? "");
        const flagged = new Set(
          result.errors.map(
            (finding: { code: string; location: { documentId: string } }) =>
              finding.code === "REQUIRED_SECTION_MISSING"
                ? finding.location.documentId
                : undefined
          )
        );
        if (to === "enforced" || to === "read_only") {
          expect(result.state).toBe("complete");
          for (const documentId of moved.get(to)!) {
            expect(flagged.has(documentId)).toBe(true);
          }
        } else if (to === "absent") {
          expect(result.state).toBe("not_evaluated");
          expect(result.errors).toEqual([]);
        } else {
          expect(result.clean).toBe(false);
          expect(result.errors).toEqual([]);
          expect(
            result.systemFailures.map(
              (failure: { code: string }) => failure.code
            )
          ).toEqual(["POLICY_CONFIGURATION_INVALID"]);
        }
      }
    }
  );
});

describe("enforced Markdown writes", () => {
  /** A body that satisfies `rules`. */
  const VALID = "## Overview\n\nAll good.";

  /** One valid enforced write and how to build its target. */
  interface ValidWrite {
    name: string;
    tool: "create_document" | "update_document";
    /** The target's attributes, when the write updates one. */
    target?: Parameters<typeof buildDocument>[0];
    template?: boolean;
    args: (fixture: {
      collection: Collection;
      target?: Document;
      templateId?: string;
    }) => Record<string, unknown>;
  }

  const VALID_WRITES: ValidWrite[] = [
    {
      name: "published create",
      tool: "create_document",
      args: ({ collection }) => ({
        title: "Written",
        text: VALID,
        collectionId: collection.id,
      }),
    },
    {
      name: "draft create",
      tool: "create_document",
      args: ({ collection }) => ({
        title: "Written",
        text: VALID,
        collectionId: collection.id,
        publish: false,
      }),
    },
    {
      name: "template create",
      tool: "create_document",
      template: true,
      args: ({ collection, templateId }) => ({
        collectionId: collection.id,
        templateId,
      }),
    },
    {
      name: "replace",
      tool: "update_document",
      target: {},
      args: ({ target }) => ({
        id: target!.id,
        text: "## Overview\n\nReplaced",
      }),
    },
    {
      name: "append",
      tool: "update_document",
      target: {},
      args: ({ target }) => ({
        id: target!.id,
        text: "\n\nAppended",
        editMode: TextEditMode.Append,
      }),
    },
    {
      name: "prepend",
      tool: "update_document",
      target: {},
      args: ({ target }) => ({
        id: target!.id,
        text: "Prepended\n\n",
        editMode: TextEditMode.Prepend,
      }),
    },
    {
      name: "patch",
      tool: "update_document",
      target: {},
      args: ({ target }) => ({
        id: target!.id,
        text: "Patched.",
        editMode: TextEditMode.Patch,
        findText: "All good.",
      }),
    },
    {
      name: "title-only",
      tool: "update_document",
      target: {},
      args: ({ target }) => ({ id: target!.id, title: "Renamed" }),
    },
    {
      name: "publish",
      tool: "update_document",
      target: { publishedAt: null },
      args: ({ target }) => ({ id: target!.id, publish: true }),
    },
    {
      name: "unpublish",
      tool: "update_document",
      target: {},
      args: ({ target }) => ({ id: target!.id, publish: false }),
    },
    {
      name: "display-field create",
      tool: "create_document",
      args: ({ collection }) => ({
        title: "Written",
        text: VALID,
        collectionId: collection.id,
        icon: "🚀",
        color: "#FF0000",
        fullWidth: true,
      }),
    },
    {
      name: "sourceFileName create",
      tool: "create_document",
      args: ({ collection }) => ({
        title: "Written",
        text: VALID,
        collectionId: collection.id,
        sourceFileName: "notes.md",
      }),
    },
    {
      name: "parent-derived create",
      tool: "create_document",
      target: {},
      args: ({ target }) => ({
        title: "Child",
        text: VALID,
        parentDocumentId: target!.id,
      }),
    },
    {
      name: "display-field-only update",
      tool: "update_document",
      target: {},
      args: ({ target }) => ({
        id: target!.id,
        icon: "🔥",
        color: "#123456",
        fullWidth: true,
      }),
    },
  ];

  /**
   * Builds the fixture of one valid write.
   *
   * @param write - the write.
   * @returns the actor, collection, target, and template.
   */
  async function validFixture(write: ValidWrite) {
    const { user, accessToken } = await buildOAuthUser();
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const target = write.target
      ? await buildDocument({
          teamId: user.teamId,
          userId: user.id,
          collectionId: collection.id,
          title: "Target",
          text: VALID,
          ...write.target,
        })
      : undefined;
    const template = write.template
      ? await buildTemplate({
          teamId: user.teamId,
          userId: user.id,
          collectionId: collection.id,
          title: "From template",
          text: VALID,
        })
      : undefined;
    return {
      user,
      accessToken,
      collection,
      target,
      templateId: template?.id,
    };
  }

  /**
   * Reads the written document of a successful response.
   *
   * @param first - the parsed first content block.
   * @returns the stored row.
   */
  const writtenDocument = (first: { id?: string; document?: { id: string } }) =>
    Document.unscoped().findOne({
      where: { id: first.id ?? first.document!.id },
      paranoid: false,
      rejectOnEmpty: true,
    });

  it.each(VALID_WRITES)(
    "commits a valid $name with the baseline response plus validation",
    async (write) => {
      const enforced = await validFixture(write);
      const set = configure([[enforced.collection, "enforced"]]);
      const entry = set.entries[0];
      const response = await callMcpTool(
        server,
        enforced.accessToken,
        write.tool,
        write.args(enforced)
      );
      const plainFixture = await validFixture(write);
      configure([]);
      const plain = await callMcpTool(
        server,
        plainFixture.accessToken,
        write.tool,
        write.args(plainFixture)
      );

      expect(response?.error).toBeUndefined();
      expect(response?.result?.isError).toBeUndefined();
      expect(plain?.result?.isError).toBeUndefined();
      const first = JSON.parse(response?.result?.content?.[0]?.text ?? "");
      const plainFirst = JSON.parse(plain?.result?.content?.[0]?.text ?? "");
      expect(Object.keys(first)).toEqual([
        ...Object.keys(plainFirst),
        "validation",
      ]);
      expect(first.validation).toEqual({
        status: "validated",
        policySchemaVersion: 1,
        policyFingerprint:
          entry.status === "valid" ? entry.policyFingerprint : undefined,
        errors: [],
        warnings: [],
        systemFailures: [],
      });
      expect(response?.result?.content).toHaveLength(
        plain?.result?.content?.length ?? 0
      );
      if ((plain?.result?.content?.length ?? 0) > 1) {
        expect(response?.result?.content?.[1]).toEqual(
          plain?.result?.content?.[1]
        );
      }
      const [stored, plainStored] = await Promise.all([
        writtenDocument(first),
        writtenDocument(plainFirst),
      ]);
      /**
       * Reduces a stored document to the fields the handler maps, with the
       * fixture's own target replaced by its role.
       *
       * @param row - the stored document.
       * @param fixture - its fixture.
       * @returns the mapped fields.
       */
      const mapped = (row: Document, fixture: { target?: Document }) => ({
        title: row.title,
        text: row.text,
        published: !!row.publishedAt,
        icon: row.icon,
        color: row.color,
        fullWidth: row.fullWidth,
        sourceMetadata: row.sourceMetadata,
        parentDocumentId:
          row.parentDocumentId && row.parentDocumentId === fixture.target?.id
            ? "target"
            : row.parentDocumentId,
      });
      expect(mapped(stored, enforced)).toEqual(
        mapped(plainStored, plainFixture)
      );
    }
  );

  it("persists the appended content in the decoded Y.js state", async () => {
    const { user, accessToken } = await buildOAuthUser();
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const document = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
      text: VALID,
    });
    document.state = Buffer.from(
      Y.encodeStateAsUpdate(ProsemirrorHelper.toYDoc(document.content!))
    );
    await document.save();
    configure([[collection, "enforced"]]);

    const response = await callMcpTool(server, accessToken, "update_document", {
      id: document.id,
      text: "\n\nAppended with state",
      editMode: TextEditMode.Append,
    });

    expect(response?.result?.isError).toBeUndefined();
    const stored = await Document.unscoped().findOne({
      where: { id: document.id },
      rejectOnEmpty: true,
    });
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, stored.state!);
    expect(JSON.stringify(yDocToProsemirrorJSON(ydoc, "default"))).toContain(
      "Appended with state"
    );
    expect(stored.text).toContain("Appended with state");
  });

  it("returns collection_conflict when the parent moves before the transaction locks", async () => {
    const actor = await buildOAuthUser();
    const { user } = actor;
    const [collection, other] = [
      await buildCollection({ teamId: user.teamId, userId: user.id }),
      await buildCollection({ teamId: user.teamId, userId: user.id }),
    ];
    const parent = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
      text: VALID,
    });
    configure([[collection, "enforced"]]);
    const documents = await Document.unscoped().count({
      where: { teamId: user.teamId },
      paranoid: false,
    });
    const query = sequelize.query.bind(sequelize);
    let moved = false;
    vi.spyOn(sequelize, "query").mockImplementation((async (
      ...args: Parameters<typeof query>
    ) => {
      const [sql] = args;
      if (
        !moved &&
        typeof sql === "string" &&
        /FROM collections WHERE id = .* FOR NO KEY UPDATE/.test(sql)
      ) {
        moved = true;
        await query(
          `UPDATE documents SET "collectionId" = '${other.id}' WHERE id = '${parent.id}'`
        );
      }
      return query(...args);
    }) as typeof sequelize.query);
    const enqueued = vi.spyOn(globalEventQueue(), "add");

    const response = await callMcpTool(
      server,
      actor.accessToken,
      "create_document",
      { title: "Child", text: VALID, parentDocumentId: parent.id }
    );

    expect(moved).toBe(true);
    expect(response?.result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: { id: COLLECTION_CONFLICT } }),
        },
      ],
      isError: true,
    });
    expect(enqueued).not.toHaveBeenCalled();
    await expect(
      Document.unscoped().count({
        where: { teamId: user.teamId },
        paranoid: false,
      })
    ).resolves.toBe(documents);
  });

  it("returns collection_conflict when the target moves before the transaction locks", async () => {
    const actor = await buildOAuthUser();
    const { user } = actor;
    const [collection, other] = [
      await buildCollection({ teamId: user.teamId, userId: user.id }),
      await buildCollection({ teamId: user.teamId, userId: user.id }),
    ];
    const document = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
      text: VALID,
    });
    configure([[collection, "enforced"]]);
    await callMcpTool(server, actor.accessToken, "list_collections");
    const before = await storedState(user.teamId, document.id);
    const query = sequelize.query.bind(sequelize);
    let moved = false;
    vi.spyOn(sequelize, "query").mockImplementation((async (
      ...args: Parameters<typeof query>
    ) => {
      const [sql] = args;
      if (
        !moved &&
        typeof sql === "string" &&
        /FROM collections WHERE id = .* FOR NO KEY UPDATE/.test(sql)
      ) {
        moved = true;
        await query(
          `UPDATE documents SET "collectionId" = '${other.id}' WHERE id = '${document.id}'`
        );
      }
      return query(...args);
    }) as typeof sequelize.query);
    const enqueued = vi.spyOn(globalEventQueue(), "add");

    const response = await callMcpTool(
      server,
      actor.accessToken,
      "update_document",
      { id: document.id, title: "Conflicted" }
    );

    expect(moved).toBe(true);
    expect(response?.result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: { id: COLLECTION_CONFLICT } }),
        },
      ],
      isError: true,
    });
    expect(enqueued).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect(
      (await storedState(user.teamId, document.id)).target?.collectionId
    ).toBe(other.id);
    // Only the out-of-band move remains: undoing it restores every row.
    await sequelize.query(
      `UPDATE documents SET "collectionId" = '${collection.id}' WHERE id = '${document.id}'`
    );
    await expect(storedState(user.teamId, document.id)).resolves.toEqual(
      before
    );
  });

  it.each([
    {
      name: "an absent patch target",
      transactions: 1,
      args: (id: string) => ({
        id,
        text: "x",
        editMode: TextEditMode.Patch,
        findText: "absent text",
      }),
      message: "The specified text was not found in the document",
    },
    {
      name: "an absent patch target with a staged image",
      transactions: 1,
      args: (id: string) => ({
        id,
        text: `![image](data:image/png;base64,${PNG_BASE64})`,
        editMode: TextEditMode.Patch,
        findText: "absent text",
      }),
      message: "The specified text was not found in the document",
    },
  ])(
    "aborts before the decision on $name",
    async ({ args, transactions, message }) => {
      const actor = await buildOAuthUser();
      const { user } = actor;
      const collection = await buildCollection({
        teamId: user.teamId,
        userId: user.id,
      });
      const document = await buildDocument({
        teamId: user.teamId,
        userId: user.id,
        collectionId: collection.id,
        text: VALID,
      });
      configure([[collection, "enforced"]]);

      const response = await callWithoutEffect(
        actor,
        "update_document",
        args(document.id),
        document.id,
        transactions
      );

      expect(response?.result).toEqual({
        content: [{ type: "text", text: message }],
        isError: true,
      });
    }
  );

  it.each([
    {
      name: "an unchanged update",
      child: false,
      args: (id: string) => ({ id, title: "Target" }),
      message: OPERATION_FAILED,
    },
    {
      name: "an unpublish of a parent",
      child: true,
      args: (id: string) => ({ id, publish: false }),
      message: "Cannot unpublish document with child documents",
    },
  ])(
    "aborts after the decision on $name, rolling back",
    async ({ child, args, message }) => {
      const actor = await buildOAuthUser();
      const { user } = actor;
      const collection = await buildCollection({
        teamId: user.teamId,
        userId: user.id,
      });
      const document = await buildDocument({
        teamId: user.teamId,
        userId: user.id,
        collectionId: collection.id,
        title: "Target",
        text: VALID,
      });
      if (child) {
        await buildDocument({
          teamId: user.teamId,
          userId: user.id,
          collectionId: collection.id,
          parentDocumentId: document.id,
          text: VALID,
        });
      }
      configure([[collection, "enforced"]]);
      await callMcpTool(server, actor.accessToken, "list_collections");
      const before = await storedState(user.teamId, document.id);
      const enqueued = vi.spyOn(globalEventQueue(), "add");

      const response = await callMcpTool(
        server,
        actor.accessToken,
        "update_document",
        args(document.id)
      );

      expect(response?.result).toEqual({
        content: [{ type: "text", text: message }],
        isError: true,
      });
      expect(enqueued).not.toHaveBeenCalled();
      await expect(storedState(user.teamId, document.id)).resolves.toEqual(
        before
      );
    }
  );
});

describe("client cancellation", () => {
  /**
   * Starts an MCP update whose write is held after the n-th `SET LOCAL
   * lock_timeout`, then disconnects the client while it is held.
   *
   * @param n - the one-based statement count: 3 holds P5 entry, 4 holds P7.
   * @returns the written document and a promise that settles when the
   *   attempt's transaction has ended.
   */
  async function disconnectWhileHeld(n: number) {
    const { user, accessToken } = await buildOAuthUser();
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const document = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
      title: "Original",
      text: "## Overview\n\nAll good.",
    });
    configure([[collection, "enforced"]]);
    await callMcpTool(server, accessToken, "list_collections");

    const query = sequelize.query.bind(sequelize);
    let seen = 0;
    let reached: () => void = () => undefined;
    let release: () => void = () => undefined;
    let ended: () => void = () => undefined;
    const atHold = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const settled = new Promise<void>((resolve) => {
      ended = resolve;
    });
    vi.spyOn(sequelize, "query").mockImplementation((async (
      ...args: Parameters<typeof query>
    ) => {
      const [sql] = args;
      const result = await query(...args);
      if (typeof sql === "string") {
        if (sql.startsWith("SET LOCAL lock_timeout") && ++seen === n) {
          reached();
          await released;
        }
        if (sql === "COMMIT;" || sql === "ROLLBACK;") {
          ended();
        }
      }
      return result;
    }) as typeof sequelize.query);
    const close = vi.spyOn(StreamableHTTPServerTransport.prototype, "close");

    const controller = new AbortController();
    const { body } = mcpRequest("tools/call", {
      name: "update_document",
      arguments: { id: document.id, title: "Disconnected" },
    });
    const request = server
      .post("/mcp/", {
        headers: mcpHeaders(accessToken),
        body,
        signal: controller.signal,
      })
      .catch((error: unknown) => error);
    await atHold;
    controller.abort();
    await request;
    await vi.waitFor(() => expect(close).toHaveBeenCalled());
    release();
    await settled;
    return document;
  }

  it("rolls back a write whose client disconnects before the decision", async () => {
    const document = await disconnectWhileHeld(3);

    const stored = await Document.unscoped().findOne({
      where: { id: document.id },
      rejectOnEmpty: true,
    });
    expect(stored.title).toBe("Original");
    expect(stored.revisionCount).toBe(document.revisionCount);
  });

  it("commits a write whose client disconnects after the decision", async () => {
    const document = await disconnectWhileHeld(4);

    const stored = await Document.unscoped().findOne({
      where: { id: document.id },
      rejectOnEmpty: true,
    });
    expect(stored.title).toBe("Disconnected");
  });
});

describe("internal-link disclosure across actors", () => {
  /** A distinctive title of every link target. */
  const TARGET_TITLE = "Protected target title";

  /**
   * Builds two actors who can both write in an enforced collection, and link
   * targets: one only the first actor can read, a missing one, a deleted
   * one, and one neither can read.
   *
   * @returns the fixture.
   */
  async function linkFixture() {
    const owner = await buildOAuthUser();
    const reader = await actorOf(
      await buildUser({ teamId: owner.user.teamId })
    );
    const outsider = await buildUser({ teamId: owner.user.teamId });
    const collection = await buildCollection({
      teamId: owner.user.teamId,
      userId: owner.user.id,
    });
    const ownerOnly = await buildCollection({
      teamId: owner.user.teamId,
      userId: owner.user.id,
      permission: null,
    });
    const outsiderOnly = await buildCollection({
      teamId: owner.user.teamId,
      userId: outsider.id,
      permission: null,
    });
    const visible = await buildDocument({
      teamId: owner.user.teamId,
      userId: owner.user.id,
      collectionId: ownerOnly.id,
      title: TARGET_TITLE,
    });
    const deleted = await buildDocument({
      teamId: owner.user.teamId,
      userId: owner.user.id,
      collectionId: collection.id,
      title: TARGET_TITLE,
    });
    await deleted.destroy();
    const inaccessible = await buildDocument({
      teamId: owner.user.teamId,
      userId: outsider.id,
      collectionId: outsiderOnly.id,
      title: TARGET_TITLE,
    });
    const missing = randomUUID();
    const links = [
      `[visible](/doc/${visible.id})`,
      `[missing](/doc/${missing})`,
      `[deleted](/doc/any-title-${deleted.urlId})`,
      `[inaccessible](/doc/${inaccessible.id})`,
    ].join(" ");
    // A link-only policy: every Finding is a link Finding.
    state.policySet = buildPolicySetFor(collection.id);
    return {
      owner,
      reader,
      collection,
      links,
      secrets: [
        visible.id,
        visible.urlId,
        deleted.id,
        deleted.urlId,
        inaccessible.id,
        inaccessible.urlId,
        missing,
        TARGET_TITLE,
      ],
    };
  }

  /**
   * Builds a policy set whose collection only checks internal links.
   *
   * @param collectionId - the collection.
   * @returns the set.
   */
  function buildPolicySetFor(collectionId: string): PolicySet {
    const result = buildPolicySet(
      Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          collections: {
            [collectionId]: {
              activation: "enforced",
              rules: [{ kind: "internal_links" }],
            },
          },
        }),
        "utf8"
      ),
      sha256Hex
    );
    if (!result.ok) {
      throw new Error("The test configuration must load");
    }
    return result.policySet;
  }

  /** One write mode, as the calls of two actors. */
  const MODES: {
    name: string;
    tool: string;
    /**
     * Builds an actor's arguments; shared targets are built once.
     *
     * @param fixture - the fixture.
     * @param actor - the actor.
     * @param shared - the documents both actors write.
     * @returns the arguments.
     */
    args: (
      fixture: Awaited<ReturnType<typeof linkFixture>>,
      actor: { user: User },
      shared: { plain: Document; linked: Document }
    ) => Promise<Record<string, unknown>>;
  }[] = [
    {
      name: "create",
      tool: "create_document",
      args: async ({ collection, links }) => ({
        title: "Linked",
        text: links,
        collectionId: collection.id,
      }),
    },
    {
      name: "replace",
      tool: "update_document",
      args: async ({ links }, _actor, { plain }) => ({
        id: plain.id,
        text: links,
      }),
    },
    {
      name: "append",
      tool: "update_document",
      args: async ({ links }, _actor, { plain }) => ({
        id: plain.id,
        text: `\n\n${links}`,
        editMode: TextEditMode.Append,
      }),
    },
    {
      name: "prepend",
      tool: "update_document",
      args: async ({ links }, _actor, { plain }) => ({
        id: plain.id,
        text: `${links}\n\n`,
        editMode: TextEditMode.Prepend,
      }),
    },
    {
      name: "patch",
      tool: "update_document",
      args: async ({ links }, _actor, { plain }) => ({
        id: plain.id,
        text: links,
        editMode: TextEditMode.Patch,
        findText: "Plain body",
      }),
    },
    {
      name: "title-only",
      tool: "update_document",
      args: async (_fixture, _actor, { linked }) => ({
        id: linked.id,
        title: "Renamed",
      }),
    },
    {
      name: "publish",
      tool: "update_document",
      args: async ({ collection, links }, { user }) => {
        const draft = await buildDocument({
          teamId: user.teamId,
          userId: user.id,
          collectionId: collection.id,
          publishedAt: null,
          text: links,
        });
        return { id: draft.id, publish: true };
      },
    },
    {
      name: "unpublish",
      tool: "update_document",
      args: async (_fixture, _actor, { linked }) => ({
        id: linked.id,
        publish: false,
      }),
    },
  ];

  it.each(MODES)(
    "reveals no protected target on $name and differs only in the unresolved link",
    async ({ tool, args }) => {
      const fixture = await linkFixture();
      const { owner, reader, collection, links, secrets } = fixture;
      const shared = {
        plain: await buildDocument({
          teamId: owner.user.teamId,
          userId: owner.user.id,
          collectionId: collection.id,
          text: "Plain body",
        }),
        linked: await buildDocument({
          teamId: owner.user.teamId,
          userId: owner.user.id,
          collectionId: collection.id,
          text: links,
        }),
      };
      const ownerArgs = await args(fixture, owner, shared);
      const readerArgs = await args(fixture, reader, shared);

      const responses = [
        await callWithoutEffect(
          owner,
          tool,
          ownerArgs,
          ownerArgs.id as string,
          1
        ),
        await callWithoutEffect(
          reader,
          tool,
          readerArgs,
          readerArgs.id as string,
          1
        ),
      ];

      const [ownerResult, readerResult] = responses.map((response) => {
        expect(response?.result?.isError).toBeUndefined();
        const text = response?.result?.content?.[0]?.text ?? "";
        for (const secret of secrets) {
          expect(text).not.toContain(secret);
        }
        const parsed = JSON.parse(text);
        // Each actor's own written document is not a target identity.
        return JSON.parse(
          JSON.stringify(parsed).replace(
            /"documentId":"[^"]+"/g,
            '"documentId":"<written>"'
          )
        );
      });
      const ownerErrors: unknown[] = ownerResult.validation.errors;
      const readerErrors: unknown[] = readerResult.validation.errors;
      expect(ownerErrors).toHaveLength(3);
      expect(readerErrors).toHaveLength(4);
      const extra = readerErrors.filter(
        (error) =>
          !ownerErrors.some(
            (other) => JSON.stringify(other) === JSON.stringify(error)
          )
      );
      expect(extra).toEqual([
        expect.objectContaining({
          code: "INTERNAL_LINK_TARGET_UNRESOLVED",
          location: expect.objectContaining({ kind: "text" }),
        }),
      ]);
      for (const error of [...ownerErrors, ...readerErrors]) {
        expect(error).toEqual(
          expect.objectContaining({
            code: "INTERNAL_LINK_TARGET_UNRESOLVED",
            location: expect.objectContaining({ kind: "text" }),
          })
        );
      }
      expect({
        ...readerResult,
        validation: { ...readerResult.validation, errors: [] },
      }).toEqual({
        ...ownerResult,
        validation: { ...ownerResult.validation, errors: [] },
      });
    }
  );
});
