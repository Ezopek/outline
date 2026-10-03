import { createHash, randomUUID } from "node:crypto";
import { DocumentPermission, Scope } from "@shared/types";
import {
  Attachment,
  Collection,
  Document,
  Event,
  type User,
  UserMembership,
} from "@server/models";
import DocumentImportTask from "@server/queues/tasks/DocumentImportTask";
import { sequelize } from "@server/storage/database";
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
import type * as DeadlineModule from "@server/wikiLint/application/deadline";
import type { PolicySet } from "@server/wikiLint/core/policySet";
import { buildPolicySet } from "@server/wikiLint/core/policySet";
import { OPERATION_FAILED } from "@server/wikiLint/core/registry";

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
 * Calls a write that must have no effect and proves it: no transaction, no
 * import job, no scheduled Event, no mutating SQL, and no snapshotted row or
 * target field changed.
 *
 * @param actor - the actor and their access token.
 * @param tool - the tool.
 * @param args - the arguments.
 * @param targetId - the target document, if any.
 * @returns the response.
 */
async function callWithoutEffect(
  actor: { user: User; accessToken: string },
  tool: string,
  args: Record<string, unknown>,
  targetId?: string
): Promise<McpResponse> {
  // Settles the throttled authentication activity writes first.
  await callMcpTool(server, actor.accessToken, "list_collections");
  const before = await storedState(actor.user.teamId, targetId);
  const transaction = vi.spyOn(sequelize, "transaction");
  const importJob = vi.spyOn(DocumentImportTask, "scheduleAndWait");
  const scheduledEvent = vi.spyOn(Event, "schedule");
  const query = vi.spyOn(sequelize, "query");

  const response = await callMcpTool(server, actor.accessToken, tool, args);

  const statements = query.mock.calls.map(([sql]) =>
    typeof sql === "string" ? sql : sql.query
  );
  expect(transaction).not.toHaveBeenCalled();
  expect(importJob).not.toHaveBeenCalled();
  expect(scheduledEvent).not.toHaveBeenCalled();
  // The recorder sees the request's own reads, so it would see a mutation.
  expect(statements.some((sql) => /^\s*SELECT\b/i.test(sql))).toBe(true);
  expect(
    statements.filter((sql) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql))
  ).toEqual([]);
  transaction.mockRestore();
  importJob.mockRestore();
  scheduledEvent.mockRestore();
  query.mockRestore();
  await expect(storedState(actor.user.teamId, targetId)).resolves.toEqual(
    before
  );
  return response;
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
          expectOperationFailed(
            await callWithoutEffect(
              fixture,
              path.tool,
              path.args(fixture),
              fixture.target?.id
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

  it("keeps the baseline result when P0 fails", async () => {
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
        [collection, "sentinel"],
        [publicCollection, "sentinel"],
      ]);
      const sentinel = await callWithoutEffect(actor, tool, args, document.id);

      expect(unconfigured?.result?.isError).toBe(true);
      expect(sentinel?.result).toEqual(unconfigured?.result);
    }
  });
});

describe("actors who cannot read the classified collection", () => {
  /**
   * Builds a private sentinel collection with a published document, its
   * member, and a user who can edit only that document.
   *
   * @returns the fixture.
   */
  async function buildMembershipFixture() {
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
    const set = configure([[collection, "sentinel"]]);
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

  it.each(paths)(
    "omits every identity on $name and keeps it for a collection reader",
    async ({ tool, call }) => {
      const fixture = await buildMembershipFixture();
      const { member, documentEditor, collection, set } = fixture;

      const editorCall = await call(documentEditor, fixture);
      const hidden = await callWithoutEffect(
        documentEditor,
        tool,
        editorCall.args,
        editorCall.targetId
      );
      const memberCall = await call(member, fixture);
      const visible = await callWithoutEffect(
        member,
        tool,
        memberCall.args,
        memberCall.targetId
      );

      expectRejection(hidden, sentinelRejection(set, collection.id, false));
      const hiddenText = hidden?.result?.content?.[0]?.text ?? "";
      for (const field of [
        "invalidFingerprint",
        "policyFingerprint",
        "policySchemaVersion",
        "collectionId",
        collection.id,
      ]) {
        expect(hiddenText).not.toContain(field);
      }
      expectRejection(visible, sentinelRejection(set, collection.id, true));
    }
  );
});

describe("valid enforced policy before validation exists", () => {
  it("fails closed when publishing a collectionless draft, leaving it unpublished", async () => {
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
    configure([[collection, "enforced"]]);

    expectOperationFailed(
      await callWithoutEffect(
        actor,
        "update_document",
        { id: draft.id, publish: true, collectionId: collection.id },
        draft.id
      )
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
          : callWithoutEffect(actor, tool, args, args.id as string | undefined);

      for (const [plain, extra, tool] of pairs) {
        const without = await call(tool, plain);
        const withExtra = await call(tool, extra);

        if (policyState === "read_only") {
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

  it("keeps the documents.create and documents.update API routes baseline in a sentinel collection", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    configure([[collection, "sentinel"]]);

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

    const updated = await server.post("/api/documents.update", user, {
      body: { id: data.id, text: `${BODY} again` },
    });
    expect(updated.status).toBe(200);
    const stored = await Document.findByPk(data.id, { rejectOnEmpty: true });
    expect(stored.text).toBe(`${BODY} again`);
  });
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
