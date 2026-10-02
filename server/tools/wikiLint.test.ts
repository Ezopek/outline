import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DocumentPermission } from "@shared/types";
import { parser } from "@server/editor";
import {
  Collection,
  Document,
  Event,
  type User,
  UserMembership,
} from "@server/models";
import { sequelize } from "@server/storage/database";
import {
  buildCollection,
  buildDocument,
  buildDraftDocument,
  buildTeam,
  buildUser,
} from "@server/test/factories";
import {
  buildOAuthUser,
  mcpHeaders,
  mcpRequest,
  parseMcpResponse,
} from "@server/test/McpHelper";
import { getTestServer } from "@server/test/support";
import type { LintDocumentDependencies } from "@server/wikiLint/application/lintDocument";
import type { PolicySet } from "@server/wikiLint/core/policySet";
import { buildPolicySet } from "@server/wikiLint/core/policySet";
import { lintDocumentInputSchema, lintDocumentTool } from "./wikiLint";

const server = getTestServer();

const OPERATION_FAILED = "The operation could not be completed";

const sha256Hex = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** Requires two sections and allows only level-2 and level-3 headings. */
const structurePolicy = {
  activation: "read_only",
  rules: [
    {
      kind: "required_sections",
      headingLevel: 2,
      headings: ["Overview", "Details"],
    },
    { kind: "allowed_heading_levels", levels: [2, 3] },
  ],
};

/** An entry that fails validation, so it becomes a sentinel. */
const invalidPolicy = { activation: "read_only", rules: [] };

const CLEAN_MARKDOWN = "## Overview\n\nSummary\n\n## Details\n\nBody";

/**
 * Builds a policy set over factory collection IDs.
 *
 * @param collections - the policy entry of each collection ID.
 * @returns the policy set.
 */
function policySetFor(collections: Record<string, unknown>): PolicySet {
  const result = buildPolicySet(
    Buffer.from(JSON.stringify({ schemaVersion: 1, collections }), "utf8"),
    sha256Hex
  );
  if (!result.ok) {
    throw new Error("The test configuration must load");
  }
  return result.policySet;
}

const clients: Client[] = [];

/**
 * Connects a client to an in-test MCP server that registers `lint_document`
 * with the production input schema and handler. Every request carries the
 * user as authentication, as the `/mcp` route does.
 *
 * @param user - the acting user.
 * @param policySet - the policy set.
 * @param dependencies - other handler dependencies, such as the clock.
 * @returns the connected client.
 */
async function connect(
  user: User,
  policySet: PolicySet,
  dependencies: Omit<LintDocumentDependencies, "policySet"> = {}
): Promise<Client> {
  const mcp = new McpServer({ name: "wiki-lint-test", version: "1.0.0" });
  mcp.registerTool(
    "lint_document",
    { inputSchema: lintDocumentInputSchema },
    (input, extra) =>
      lintDocumentTool(input, extra, { ...dependencies, policySet })
  );

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const send = clientTransport.send.bind(clientTransport);
  clientTransport.send = (message, options) =>
    send(message, {
      ...options,
      authInfo: {
        token: "test",
        clientId: "test",
        scopes: [],
        extra: { user },
      },
    });

  const client = new Client({ name: "wiki-lint-test", version: "1.0.0" });
  await mcp.connect(serverTransport);
  await client.connect(clientTransport);
  clients.push(client);
  return client;
}

/**
 * Calls `lint_document`.
 *
 * @param client - the connected client.
 * @param args - the tool arguments.
 * @returns the tool result.
 */
async function lint(
  client: Client,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  return (await client.callTool({
    name: "lint_document",
    arguments: args,
  })) as CallToolResult;
}

/**
 * Returns the text of a result's first content block.
 *
 * @param result - the tool result.
 * @returns the text.
 */
function firstText(result: CallToolResult): string {
  const [block] = result.content;
  if (block?.type !== "text") {
    throw new Error("Expected a text block");
  }
  return block.text;
}

/**
 * Calls `lint_document` and parses the modeled result.
 *
 * @param client - the connected client.
 * @param id - the document identifier.
 * @returns the parsed result.
 */
async function lintResult(client: Client, id: string) {
  const result = await lint(client, { id });
  expect(result.isError).toBeUndefined();
  return JSON.parse(firstText(result));
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

/**
 * Builds a document in a private collection and a user who can read only
 * the document.
 *
 * @returns the reader, collection, and document.
 */
async function buildDocumentOnlyReader() {
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
    text: "# Title",
  });
  const reader = await buildUser({ teamId: owner.teamId });
  await UserMembership.create({
    documentId: document.id,
    userId: reader.id,
    createdById: owner.id,
    permission: DocumentPermission.Read,
  });
  return { reader, collection, document };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("lint_document", () => {
  it("exposes only the document identifier as input", async () => {
    const { user, collection } = await buildFixture();
    const client = await connect(
      user,
      policySetFor({ [collection.id]: structurePolicy })
    );

    const { tools } = await client.listTools();
    const tool = tools.find((entry) => entry.name === "lint_document");

    expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual(["id"]);
    expect(tool?.inputSchema.properties?.id).toEqual({
      type: "string",
      description: expect.stringContaining("UUID"),
    });
    expect(tool?.inputSchema.required).toEqual(["id"]);
  });

  it("ignores extra arguments", async () => {
    const { user, collection, document } = await buildFixture({
      text: "# Title",
    });
    const other = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const client = await connect(
      user,
      policySetFor({ [collection.id]: structurePolicy })
    );

    const plain = await lint(client, { id: document.id });
    const extended = await lint(client, {
      id: document.id,
      policy: invalidPolicy,
      activation: "enforced",
      collectionId: other.id,
      deadlineMs: 1,
    });

    expect(plain.isError).toBeUndefined();
    expect(JSON.parse(firstText(plain)).errors).not.toEqual([]);
    expect(firstText(extended)).toBe(firstText(plain));
  });

  it("evaluates a draft and an archived document", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const draft = await buildDraftDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
      text: CLEAN_MARKDOWN,
    });
    const archived = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
      archivedAt: new Date(),
      text: CLEAN_MARKDOWN,
    });
    const client = await connect(
      user,
      policySetFor({ [collection.id]: structurePolicy })
    );

    for (const document of [draft, archived]) {
      await expect(lintResult(client, document.id)).resolves.toMatchObject({
        state: "complete",
        clean: true,
        scope: {
          documentId: document.id,
          collectionId: collection.id,
          evaluatedDocumentCount: 1,
          evaluatedLinkCount: 0,
        },
      });
    }
  });

  it("lints the content, never a stale text column", async () => {
    const { user, collection, document } = await buildFixture({
      text: "Nothing here",
      content: parser.parse(CLEAN_MARKDOWN)?.toJSON(),
    });
    const client = await connect(
      user,
      policySetFor({ [collection.id]: structurePolicy })
    );

    const result = await lintResult(client, document.id);

    expect(result.state).toBe("complete");
    expect(result.errors).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("REQUIRED_SECTION_MISSING");
  });

  it("answers missing and denied targets identically", async () => {
    const owner = await buildUser();
    const privateCollection = await buildCollection({
      teamId: owner.teamId,
      userId: owner.id,
      permission: null,
    });
    const privateDocument = await buildDocument({
      teamId: owner.teamId,
      userId: owner.id,
      collectionId: privateCollection.id,
    });
    const otherTeam = await buildTeam();
    const otherUser = await buildUser({ teamId: otherTeam.id });
    const foreign = await buildDocument({
      teamId: otherTeam.id,
      userId: otherUser.id,
    });
    const actor = await buildUser({ teamId: owner.teamId });
    const readableCollection = await buildCollection({
      teamId: owner.teamId,
      userId: owner.id,
    });
    const trashed = await buildDocument({
      teamId: owner.teamId,
      userId: actor.id,
      collectionId: readableCollection.id,
    });
    await trashed.destroy();
    const client = await connect(
      actor,
      policySetFor({
        [privateCollection.id]: structurePolicy,
        [readableCollection.id]: structurePolicy,
        [foreign.collectionId as string]: structurePolicy,
      })
    );

    const responses = await Promise.all(
      [
        "00000000-0000-4000-8000-000000000000",
        "any-title-abcdefghij",
        "not a document",
        foreign.id,
        privateDocument.id,
        trashed.id,
      ].map((id) => lint(client, { id }))
    );

    expect(responses[0]).toEqual({
      content: [{ type: "text", text: "Authorization error" }],
      isError: true,
    });
    for (const response of responses) {
      expect(JSON.stringify(response)).toBe(JSON.stringify(responses[0]));
    }
  });

  it.each([
    ["a non-string id", { id: 1 }],
    ["a missing id", {}],
  ])("returns an isError result for %s", async (_name, args) => {
    const user = await buildUser();
    const client = await connect(user, policySetFor({}));

    const result = await lint(client, args);

    expect(result.isError).toBe(true);
  });

  it("returns Findings without collection identity to a document-only reader", async () => {
    const { reader, collection, document } = await buildDocumentOnlyReader();
    const client = await connect(
      reader,
      policySetFor({ [collection.id]: structurePolicy })
    );

    const result = await lintResult(client, document.id);

    expect(result.state).toBe("complete");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.policies).toEqual([]);
    expect(JSON.stringify(result)).not.toContain(collection.id);
  });

  it("reports only the policy class of a sentinel to a document-only reader", async () => {
    const { reader, collection, document } = await buildDocumentOnlyReader();
    const client = await connect(
      reader,
      policySetFor({ [collection.id]: invalidPolicy })
    );

    const result = await lintResult(client, document.id);

    expect(result.systemFailures).toEqual([
      expect.objectContaining({
        code: "POLICY_CONFIGURATION_INVALID",
        location: {
          kind: "scope",
          scopeKind: "document",
          documentId: document.id,
        },
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain(collection.id);
  });

  it("reports an invalid policy to a collection reader", async () => {
    const { user, collection, document } = await buildFixture();
    const policySet = policySetFor({ [collection.id]: invalidPolicy });
    const client = await connect(user, policySet);

    await expect(lintResult(client, document.id)).resolves.toEqual({
      state: "failed",
      complete: false,
      clean: false,
      errors: [],
      warnings: [],
      systemFailures: [
        {
          code: "POLICY_CONFIGURATION_INVALID",
          message: expect.any(String),
          location: {
            kind: "scope",
            scopeKind: "collection",
            collectionId: collection.id,
          },
        },
      ],
      scope: {
        kind: "document",
        documentId: document.id,
        collectionId: collection.id,
        evaluatedDocumentCount: 0,
        evaluatedLinkCount: 0,
      },
      policies: [
        {
          collectionId: collection.id,
          status: "invalid",
          invalidFingerprint: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        },
      ],
    });
  });

  it("is not evaluated for an unconfigured collection", async () => {
    const { user, collection, document } = await buildFixture();
    const client = await connect(user, policySetFor({}));

    await expect(lintResult(client, document.id)).resolves.toMatchObject({
      state: "not_evaluated",
      reason: "POLICY_NOT_CONFIGURED",
      scope: { collectionId: collection.id, evaluatedDocumentCount: 0 },
      policies: [],
    });
  });

  describe("when the collection lookup fails", () => {
    it("completes a valid policy without collection identity", async () => {
      const { user, collection, document } = await buildFixture({
        text: "# Title",
      });
      const client = await connect(
        user,
        policySetFor({ [collection.id]: structurePolicy })
      );
      vi.spyOn(Collection, "findByPk").mockRejectedValue(new Error("lookup"));

      const result = await lintResult(client, document.id);

      expect(result.state).toBe("complete");
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.scope).not.toHaveProperty("collectionId");
      expect(result.policies).toEqual([]);
      expect(JSON.stringify(result)).not.toContain(collection.id);
    });

    it("fails a sentinel generically at the document", async () => {
      const { user, collection, document } = await buildFixture();
      const client = await connect(
        user,
        policySetFor({ [collection.id]: invalidPolicy })
      );
      vi.spyOn(Collection, "findByPk").mockRejectedValue(new Error("lookup"));

      const result = await lintResult(client, document.id);

      expect(result.state).toBe("failed");
      expect(result.systemFailures).toEqual([
        {
          code: "VALIDATION_RUNTIME_FAILED",
          message: expect.any(String),
          location: {
            kind: "scope",
            scopeKind: "document",
            documentId: document.id,
          },
        },
      ]);
      expect(result.policies).toEqual([]);
      expect(JSON.stringify(result)).not.toContain(collection.id);
    });
  });

  it("returns the fixed failure message when the document lookup fails", async () => {
    const { user, collection, document } = await buildFixture();
    const client = await connect(
      user,
      policySetFor({ [collection.id]: structurePolicy })
    );
    vi.spyOn(Document, "findByPk").mockRejectedValue(
      new Error("raw database detail")
    );

    await expect(lint(client, { id: document.id })).resolves.toEqual({
      content: [{ type: "text", text: OPERATION_FAILED }],
      isError: true,
    });
  });

  it("returns the fixed failure message for an unmodellable failure", async () => {
    const user = await buildUser();

    await expect(
      lintDocumentTool(
        { id: "00000000-0000-4000-8000-000000000000" },
        { authInfo: { token: "", clientId: "", scopes: [], extra: { user } } },
        {
          clock: () => {
            throw new Error("raw clock detail");
          },
        }
      )
    ).resolves.toEqual({
      content: [{ type: "text", text: OPERATION_FAILED }],
      isError: true,
    });
  });

  it("mutates nothing", async () => {
    const { user, collection, document } = await buildFixture({
      text: "# Title",
    });
    const client = await connect(
      user,
      policySetFor({ [collection.id]: structurePolicy })
    );
    const before = await Document.findByPk(document.id, {
      rejectOnEmpty: true,
    });
    const eventCount = await Event.count({ where: { teamId: user.teamId } });
    const query = vi.spyOn(sequelize, "query");

    const result = await lintResult(client, document.id);

    expect(result.errors.length).toBeGreaterThan(0);
    const statements = query.mock.calls.map(([sql]) =>
      typeof sql === "string" ? sql : sql.query
    );
    expect(statements.length).toBeGreaterThan(0);
    expect(
      statements.filter((sql) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql))
    ).toEqual([]);
    query.mockRestore();

    const after = await Document.findByPk(document.id, {
      rejectOnEmpty: true,
    });
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(after.revisionCount).toBe(before.revisionCount);
    await expect(Event.count({ where: { teamId: user.teamId } })).resolves.toBe(
      eventCount
    );
  });

  it("bounds the first database batch by the 9000 ms deadline", async () => {
    const { user, collection, document } = await buildFixture();
    const client = await connect(
      user,
      policySetFor({ [collection.id]: structurePolicy }),
      { clock: () => 0 }
    );
    const query = vi.spyOn(sequelize, "query");

    await lintResult(client, document.id);

    const setLocals = query.mock.calls
      .map(([sql]) => (typeof sql === "string" ? sql : sql.query))
      .filter((sql) => sql.startsWith("SET LOCAL"));
    expect(setLocals.slice(0, 2)).toEqual([
      "SET LOCAL lock_timeout = 9000",
      "SET LOCAL statement_timeout = 9000",
    ]);
  });

  it("is byte-stable for identical inputs", async () => {
    const { user, collection, document } = await buildFixture({
      text: "# Title\n\n## Details\n\n#### Deep",
    });
    const client = await connect(
      user,
      policySetFor({ [collection.id]: structurePolicy })
    );

    const first = await lint(client, { id: document.id });
    const second = await lint(client, { id: document.id });

    expect(JSON.parse(firstText(first)).errors.length).toBeGreaterThan(1);
    expect(firstText(second)).toBe(firstText(first));
  });
});

describe("POST /mcp/ tools/list", () => {
  it("does not register lint_document yet", async () => {
    const { accessToken } = await buildOAuthUser();
    const { body } = mcpRequest("tools/list");

    const res = await server.post("/mcp/", {
      headers: mcpHeaders(accessToken),
      body,
    });
    expect(res.status).toEqual(200);

    const parsed = await parseMcpResponse(res);
    const names = (
      (parsed?.result as { tools?: { name: string }[] })?.tools ?? []
    ).map((tool) => tool.name);
    expect(names).toContain("fetch");
    expect(names).not.toContain("lint_document");
  });
});
