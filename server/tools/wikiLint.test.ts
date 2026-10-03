import { createHash, randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DocumentPermission, type ProsemirrorData } from "@shared/types";
import { parser } from "@server/editor";
import env from "@server/env";
import { ClientClosedRequestError } from "@server/errors";
import Logger from "@server/logging/Logger";
import {
  Collection,
  Document,
  Event,
  type User,
  UserMembership,
} from "@server/models";
import { globalEventQueue } from "@server/queues";
import { sequelize } from "@server/storage/database";
import {
  buildAdmin,
  buildCollection,
  buildDocument,
  buildDraftDocument,
  buildGuestUser,
  buildTeam,
  buildUser,
  buildViewer,
  buildWebhookSubscription,
} from "@server/test/factories";
import { getTestServer } from "@server/test/support";
import {
  parseCanonicalMarkdown,
  toCanonicalMarkdown,
} from "@server/wikiLint/adapters/canonicalSyntax";
import type { AuditEventWriter } from "@server/wikiLint/adapters/auditEvents";
import {
  WIKI_LINT_AUDIT_EVENTS,
  insertAuditEvent,
} from "@server/wikiLint/adapters/auditEvents";
import type { WikiSnapshotRead } from "@server/wikiLint/adapters/wikiReader";
import { lintWikiAdmission } from "@server/wikiLint/application/admission";
import {
  AUDIT_WRITE_BOUND_MS,
  DeadlineFloorError,
} from "@server/wikiLint/application/deadline";
import type { LintDocumentDependencies } from "@server/wikiLint/application/lintDocument";
import { defaultLintDocumentReader } from "@server/wikiLint/application/lintDocument";
import type { LintWikiReader } from "@server/wikiLint/application/lintWiki";
import {
  LINT_WIKI_DEADLINE_MS,
  LINT_WIKI_STOP_MARGIN_MS,
  defaultLintWikiReader,
} from "@server/wikiLint/application/lintWiki";
import { WikiResourceLimitError } from "@server/wikiLint/application/snapshotLimits";
import type { Finding, ScopeLocation } from "@server/wikiLint/core/contracts";
import type { PolicySet } from "@server/wikiLint/core/policySet";
import {
  buildPolicySet,
  policyIdentity,
} from "@server/wikiLint/core/policySet";
import {
  createFinding,
  createSystemFailure,
} from "@server/wikiLint/core/registry";
import {
  lintDocumentInputSchema,
  lintDocumentTool,
  lintWikiInputSchema,
  lintWikiTool,
} from "./wikiLint";

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

/**
 * Returns the mutating statements among recorded SQL.
 *
 * @param statements - the recorded SQL.
 * @returns the INSERT, UPDATE, and DELETE statements.
 */
const mutationsOf = (statements: readonly string[]) =>
  statements.filter((sql) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql));

/** The audit summary insert, the only mutation a lint result makes. */
const auditInsert = expect.stringMatching(/^\s*INSERT INTO events\b/);

const clients: Client[] = [];

/**
 * Connects a client to an in-test MCP server that registers `lint_document`
 * and `lint_wiki` with the production input schemas and handlers. Every
 * request carries the user and the audit attribution of an API key, as the
 * `/mcp` route does.
 *
 * @param user - the acting user.
 * @param policySet - the policy set.
 * @param dependencies - other handler dependencies, such as the clock, plus
 *   the `lint_wiki` reader.
 * @returns the connected client.
 */
async function connect(
  user: User,
  policySet: PolicySet,
  dependencies: Omit<LintDocumentDependencies, "policySet"> & {
    wikiReader?: LintWikiReader;
  } = {}
): Promise<Client> {
  const { reader, wikiReader, ...shared } = dependencies;
  const mcp = new McpServer({ name: "wiki-lint-test", version: "1.0.0" });
  mcp.registerTool(
    "lint_document",
    { inputSchema: lintDocumentInputSchema },
    (input, extra) =>
      lintDocumentTool(input, extra, { ...shared, reader, policySet })
  );
  mcp.registerTool(
    "lint_wiki",
    { inputSchema: lintWikiInputSchema },
    (input, extra) =>
      lintWikiTool(input, extra, { ...shared, reader: wikiReader, policySet })
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
        extra: { user, requestId: randomUUID(), credentialAuthType: "api" },
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
 * @returns the reader, owner, collection, and document.
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
  return { reader, owner, collection, document };
}

/**
 * Builds a paragraph.
 *
 * @param content - the inline content.
 * @returns the paragraph node.
 */
const paragraphOf = (...content: ProsemirrorData[]): ProsemirrorData => ({
  type: "paragraph",
  content,
});

/**
 * Builds linked text.
 *
 * @param text - the text.
 * @param href - the link destination.
 * @returns the text node.
 */
const linkedText = (text: string, href: string): ProsemirrorData => ({
  type: "text",
  text,
  marks: [{ type: "link", attrs: { href } }],
});

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
    expect(JSON.stringify(result)).not.toContain('"detail"');
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
      expect(JSON.stringify(result)).not.toContain('"detail"');
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

  it("mutates nothing but its audit summary", async () => {
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
    expect(mutationsOf(statements)).toEqual([auditInsert]);
    query.mockRestore();

    const after = await Document.findByPk(document.id, {
      rejectOnEmpty: true,
    });
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(after.revisionCount).toBe(before.revisionCount);
    await expect(Event.count({ where: { teamId: user.teamId } })).resolves.toBe(
      eventCount + 1
    );
    await expect(
      Event.count({
        where: { teamId: user.teamId, name: "wikiLint.document" },
      })
    ).resolves.toBe(1);
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

describe("lint_document internal links", () => {
  const ORIGIN = "https://wiki.example.test";

  /** The structure policy plus `internal_links`. */
  const linkPolicy = {
    activation: "read_only",
    rules: [...structurePolicy.rules, { kind: "internal_links" }],
  };

  /**
   * Builds a source document body: the required sections, then one
   * paragraph per link.
   *
   * @param hrefs - the link destinations.
   * @returns the Markdown.
   */
  const sourceText = (hrefs: string[]) =>
    [
      "## Overview",
      "",
      ...hrefs.flatMap((href, index) => [`Link [${index}](${href})`, ""]),
      "## Details",
      "",
      "Body",
    ].join("\n");

  /**
   * Builds the unresolved-link Error expected at a link paragraph.
   *
   * @param documentId - the source document.
   * @param index - the zero-based index of the link.
   * @returns the expected Finding.
   */
  const unresolvedAt = (documentId: string, index: number) => ({
    code: "INTERNAL_LINK_TARGET_UNRESOLVED",
    severity: "error",
    message: expect.any(String),
    location: {
      kind: "text",
      documentId,
      line: 3 + 2 * index,
      column: 6,
      path: [1 + index],
    },
  });

  /**
   * Builds a team with a readable collection, a reader who can read a
   * protected document in a private collection, and an actor who cannot.
   *
   * @returns the fixture.
   */
  async function buildActors() {
    const reader = await buildUser();
    const collection = await buildCollection({
      teamId: reader.teamId,
      userId: reader.id,
    });
    const privateCollection = await buildCollection({
      teamId: reader.teamId,
      userId: reader.id,
      permission: null,
    });
    const protectedTarget = await buildDocument({
      teamId: reader.teamId,
      userId: reader.id,
      collectionId: privateCollection.id,
      title: "Protected generic title",
    });
    const blind = await buildUser({ teamId: reader.teamId });
    const policySet = policySetFor({ [collection.id]: linkPolicy });
    return {
      reader,
      blind,
      collection,
      privateCollection,
      protectedTarget,
      policySet,
    };
  }

  it("resolves readable targets in every recognized form", async () => {
    const { reader, collection, policySet } = await buildActors();
    const owner = await buildUser({ teamId: reader.teamId });
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
      userId: reader.id,
      createdById: owner.id,
      permission: DocumentPermission.Read,
    });
    const readable = await buildDocument({
      teamId: reader.teamId,
      userId: reader.id,
      collectionId: collection.id,
    });
    const draft = await buildDraftDocument({
      teamId: reader.teamId,
      userId: reader.id,
      collectionId: collection.id,
    });
    const archived = await buildDocument({
      teamId: reader.teamId,
      userId: reader.id,
      collectionId: collection.id,
      archivedAt: new Date(),
    });
    const source = await buildDocument({
      teamId: reader.teamId,
      userId: reader.id,
      collectionId: collection.id,
      text: sourceText([
        `/doc/${readable.id.toUpperCase()}`,
        `${ORIGIN}/doc/any-title-${readable.urlId}`,
        `/d/${draft.urlId}`,
        `/doc/${archived.id}#heading`,
        `/doc/${shared.id}`,
        "https://other.example.test/doc/unrelated",
      ]),
    });
    const client = await connect(reader, policySet, { instanceOrigin: ORIGIN });

    await expect(lintResult(client, source.id)).resolves.toEqual({
      state: "complete",
      complete: true,
      clean: true,
      errors: [],
      warnings: [],
      systemFailures: [],
      scope: {
        kind: "document",
        documentId: source.id,
        collectionId: collection.id,
        evaluatedDocumentCount: 1,
        evaluatedLinkCount: 5,
      },
      policies: [expect.objectContaining({ collectionId: collection.id })],
    });
  });

  it("makes protected, missing, and deleted targets indistinguishable", async () => {
    const {
      reader,
      blind,
      collection,
      privateCollection,
      protectedTarget,
      policySet,
    } = await buildActors();
    const deleted = await buildDocument({
      teamId: reader.teamId,
      userId: reader.id,
      collectionId: collection.id,
    });
    await deleted.destroy();
    const missing = randomUUID();
    const source = await buildDocument({
      teamId: reader.teamId,
      userId: reader.id,
      collectionId: collection.id,
      text: sourceText([
        `/doc/${protectedTarget.id}`,
        `/doc/${missing}`,
        `/doc/${deleted.id}`,
        `${ORIGIN}/doc/any-title-${protectedTarget.urlId}`,
      ]),
    });

    const readerResult = await lintResult(
      await connect(reader, policySet, { instanceOrigin: ORIGIN }),
      source.id
    );
    const blindResult = await lintResult(
      await connect(blind, policySet, { instanceOrigin: ORIGIN }),
      source.id
    );

    expect(readerResult.errors).toEqual([
      unresolvedAt(source.id, 1),
      unresolvedAt(source.id, 2),
    ]);
    expect(blindResult.errors).toEqual([
      unresolvedAt(source.id, 0),
      unresolvedAt(source.id, 1),
      unresolvedAt(source.id, 2),
      unresolvedAt(source.id, 3),
    ]);
    const [protectedFinding, ...others] = blindResult.errors;
    for (const finding of others) {
      expect({ ...finding, location: undefined }).toEqual({
        ...protectedFinding,
        location: undefined,
      });
    }
    expect(blindResult.scope.evaluatedLinkCount).toBe(4);
    expect(readerResult.scope.evaluatedLinkCount).toBe(4);

    for (const result of [readerResult, blindResult]) {
      const serialized = JSON.stringify(result);
      for (const secret of [
        protectedTarget.id,
        protectedTarget.urlId,
        protectedTarget.title,
        privateCollection.id,
        deleted.id,
        missing,
      ]) {
        expect(serialized).not.toContain(secret);
      }
    }
  });

  it("answers a protected target exactly as a never-existing one", async () => {
    const { reader, blind, collection, protectedTarget, policySet } =
      await buildActors();
    const missing = randomUUID();
    const build = (target: string) =>
      buildDocument({
        teamId: reader.teamId,
        userId: reader.id,
        collectionId: collection.id,
        text: sourceText([`/doc/${target}`]),
      });
    const toProtected = await build(protectedTarget.id);
    const toMissing = await build(missing);
    const client = await connect(blind, policySet, { instanceOrigin: ORIGIN });

    const first = firstText(await lint(client, { id: toProtected.id }));
    const second = firstText(await lint(client, { id: toMissing.id }));

    expect(JSON.parse(first).errors).toEqual([unresolvedAt(toProtected.id, 0)]);
    expect(second.split(toMissing.id).join(toProtected.id)).toBe(first);
    expect(first).not.toContain(protectedTarget.id);
  });

  it("reports every occurrence of one target and is byte-stable", async () => {
    const { reader, blind, collection, protectedTarget, policySet } =
      await buildActors();
    const forms = [
      `/doc/${protectedTarget.id}`,
      `/doc/${protectedTarget.id.toUpperCase()}`,
      `/doc/any-title-${protectedTarget.urlId}`,
      `/doc/${protectedTarget.id}`,
      `/doc/any-title-${protectedTarget.urlId}`,
    ];
    const source = await buildDocument({
      teamId: reader.teamId,
      userId: reader.id,
      collectionId: collection.id,
      text: sourceText(forms),
    });

    const resolved = await lintResult(
      await connect(reader, policySet, { instanceOrigin: ORIGIN }),
      source.id
    );
    expect(resolved.errors).toEqual([]);
    expect(resolved.scope.evaluatedLinkCount).toBe(5);

    const client = await connect(blind, policySet, { instanceOrigin: ORIGIN });
    const first = firstText(await lint(client, { id: source.id }));
    const second = firstText(await lint(client, { id: source.id }));

    expect(JSON.parse(first).errors).toEqual(
      forms.map((_form, index) => unresolvedAt(source.id, index))
    );
    expect(JSON.parse(first).scope.evaluatedLinkCount).toBe(5);
    expect(second).toBe(first);
  });

  it("never looks up a UUID as a URL identifier", async () => {
    const { reader, collection, policySet } = await buildActors();
    const uuid = randomUUID();
    const lastGroup = uuid.split("-")[4];
    const collision = await buildDocument({
      teamId: reader.teamId,
      userId: reader.id,
      collectionId: collection.id,
    });
    await Document.unscoped().update(
      { urlId: lastGroup },
      { where: { id: collision.id }, hooks: false, validate: false }
    );
    const source = await buildDocument({
      teamId: reader.teamId,
      userId: reader.id,
      collectionId: collection.id,
      text: sourceText([`/doc/${uuid}`, `/doc/${lastGroup}`]),
    });
    const client = await connect(reader, policySet, { instanceOrigin: ORIGIN });

    const result = await lintResult(client, source.id);

    expect(result.errors).toEqual([unresolvedAt(source.id, 0)]);
    expect(result.scope.evaluatedLinkCount).toBe(2);
  });

  it("completes structure and link Findings in AD-4 order", async () => {
    const { reader, collection, policySet } = await buildActors();
    const missing = randomUUID();
    const source = await buildDocument({
      teamId: reader.teamId,
      userId: reader.id,
      collectionId: collection.id,
      text: [
        "# Title [a](/doc/" + missing + ")",
        "",
        "## Details",
        "",
        "#### Deep",
        "",
        "Text [b](/doc/" + missing + ")",
      ].join("\n"),
    });
    const client = await connect(reader, policySet, { instanceOrigin: ORIGIN });

    const result = await lintResult(client, source.id);

    const at = (line: number, column: number, path: number[]) => ({
      kind: "text",
      documentId: source.id,
      line,
      column,
      path,
    });
    expect(result).toEqual({
      state: "complete",
      complete: true,
      clean: false,
      errors: [
        expect.objectContaining({
          code: "HEADING_LEVEL_NOT_ALLOWED",
          location: at(1, 1, [0]),
        }),
        expect.objectContaining({
          code: "INTERNAL_LINK_TARGET_UNRESOLVED",
          location: at(1, 9, [0]),
        }),
        expect.objectContaining({
          code: "HEADING_LEVEL_NOT_ALLOWED",
          location: at(5, 1, [2]),
        }),
        expect.objectContaining({
          code: "INTERNAL_LINK_TARGET_UNRESOLVED",
          location: at(7, 6, [3]),
        }),
        expect.objectContaining({
          code: "REQUIRED_SECTION_MISSING",
          location: { kind: "document", documentId: source.id },
          detail: { kind: "section", heading: "Overview", headingLevel: 2 },
        }),
      ],
      warnings: [],
      systemFailures: [],
      scope: {
        kind: "document",
        documentId: source.id,
        collectionId: collection.id,
        evaluatedDocumentCount: 1,
        evaluatedLinkCount: 2,
      },
      policies: [expect.objectContaining({ collectionId: collection.id })],
    });
  });

  it("fails the unit on an unresolved link without a provable position", async () => {
    const { reader, collection, policySet } = await buildActors();
    const missing = randomUUID();
    const paragraph = (...content: ProsemirrorData[]): ProsemirrorData => ({
      type: "paragraph",
      content,
    });
    const linked = (text: string): ProsemirrorData => ({
      type: "text",
      text,
      marks: [{ type: "link", attrs: { href: `/doc/${missing}` } }],
    });
    const source = await buildDocument({
      teamId: reader.teamId,
      userId: reader.id,
      collectionId: collection.id,
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Title" }],
          },
          {
            type: "table",
            content: [
              {
                type: "tr",
                content: [{ type: "th", content: [paragraph(linked("head"))] }],
              },
              {
                type: "tr",
                content: [
                  {
                    type: "td",
                    content: [
                      {
                        type: "container_notice",
                        attrs: { style: "info" },
                        content: [paragraph(linked("noted"))],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    const client = await connect(reader, policySet, { instanceOrigin: ORIGIN });

    const result = await lintResult(client, source.id);

    expect(result).toEqual({
      state: "failed",
      complete: false,
      clean: false,
      errors: [
        expect.objectContaining({
          code: "HEADING_LEVEL_NOT_ALLOWED",
          location: expect.objectContaining({ line: 1, column: 1 }),
        }),
        expect.objectContaining({
          code: "INTERNAL_LINK_TARGET_UNRESOLVED",
          location: expect.objectContaining({ line: 3, column: 3 }),
        }),
        expect.objectContaining({
          code: "REQUIRED_SECTION_MISSING",
          detail: { kind: "section", heading: "Overview", headingLevel: 2 },
        }),
        expect.objectContaining({
          code: "REQUIRED_SECTION_MISSING",
          detail: { kind: "section", heading: "Details", headingLevel: 2 },
        }),
      ],
      warnings: [],
      systemFailures: [
        {
          code: "VALIDATION_RUNTIME_FAILED",
          message: expect.any(String),
          location: {
            kind: "scope",
            scopeKind: "document",
            documentId: source.id,
            collectionId: collection.id,
          },
        },
      ],
      scope: {
        kind: "document",
        documentId: source.id,
        collectionId: collection.id,
        evaluatedDocumentCount: 0,
        evaluatedLinkCount: 0,
      },
      policies: [expect.objectContaining({ collectionId: collection.id })],
    });
  });

  it("recognizes links against the server URL by default", async () => {
    const { reader, collection, policySet } = await buildActors();
    const missing = randomUUID();
    const source = await buildDocument({
      teamId: reader.teamId,
      userId: reader.id,
      collectionId: collection.id,
      text: sourceText([
        `${env.URL}/doc/${missing}`,
        `${ORIGIN}.invalid/doc/${missing}`,
      ]),
    });
    const client = await connect(reader, policySet);

    const result = await lintResult(client, source.id);

    expect(result.errors).toEqual([unresolvedAt(source.id, 0)]);
    expect(result.scope.evaluatedLinkCount).toBe(1);
  });

  it("mutates nothing but its audit summary while resolving links", async () => {
    const { reader, collection, protectedTarget, policySet } =
      await buildActors();
    const source = await buildDocument({
      teamId: reader.teamId,
      userId: reader.id,
      collectionId: collection.id,
      text: sourceText([`/doc/${protectedTarget.id}`, `/doc/${randomUUID()}`]),
    });
    const client = await connect(reader, policySet, { instanceOrigin: ORIGIN });
    const query = vi.spyOn(sequelize, "query");

    const result = await lintResult(client, source.id);

    expect(result.errors).toHaveLength(1);
    const statements = query.mock.calls.map(([sql]) =>
      typeof sql === "string" ? sql : sql.query
    );
    expect(mutationsOf(statements)).toEqual([auditInsert]);

    // The link-target SELECT ran inside the read-only snapshot transaction.
    const target = statements.findIndex(
      (sql) =>
        sql.startsWith("SELECT") && sql.includes(`'${protectedTarget.id}'`)
    );
    expect(target).toBeGreaterThan(-1);
    const readOnly = statements.lastIndexOf(
      "SET TRANSACTION READ ONLY",
      target
    );
    expect(readOnly).toBeGreaterThan(-1);
    expect(statements.slice(readOnly, target)).not.toContain("COMMIT;");
    expect(statements.indexOf("COMMIT;", target)).toBeGreaterThan(target);
  });

  /** A policy that enables only `internal_links`. */
  const linksOnlyPolicy = {
    activation: "read_only",
    rules: [{ kind: "internal_links" }],
  };

  it("reports recognized forms end to end and ignores the others", async () => {
    const { reader, collection } = await buildActors();
    const missing = randomUUID();
    const mentioned = randomUUID();
    const content: ProsemirrorData = {
      type: "doc",
      content: [
        paragraphOf(
          { type: "text", text: "ż😀 " },
          linkedText("gone", `/doc/${missing}`)
        ),
        paragraphOf({
          type: "mention",
          attrs: {
            type: "document",
            label: "Mentioned",
            modelId: mentioned,
            id: randomUUID(),
            anchorId: "anchor",
          },
        }),
        paragraphOf(
          linkedText("relative", `doc/${missing}`),
          { type: "text", text: " " },
          linkedText("collection", `/collection/${missing}`),
          { type: "text", text: " " },
          linkedText("mail", "mailto:someone@example.test")
        ),
      ],
    };
    const source = await buildDocument({
      teamId: reader.teamId,
      userId: reader.id,
      collectionId: collection.id,
      content,
    });
    const client = await connect(
      reader,
      policySetFor({ [collection.id]: linksOnlyPolicy }),
      { instanceOrigin: ORIGIN }
    );

    expect((await toCanonicalMarkdown(content)).split("\n")).toEqual([
      `ż😀 [gone](/doc/${missing})`,
      "",
      `[Mentioned](/doc/${mentioned}#anchor)`,
      "",
      `[relative](doc/${missing}) [collection](/collection/${missing}) [mail](mailto:someone@example.test)`,
    ]);
    const unresolved = (line: number, column: number, path: number[]) => ({
      code: "INTERNAL_LINK_TARGET_UNRESOLVED",
      severity: "error",
      message: expect.any(String),
      location: { kind: "text", documentId: source.id, line, column, path },
    });
    await expect(lintResult(client, source.id)).resolves.toEqual({
      state: "complete",
      complete: true,
      clean: false,
      errors: [unresolved(1, 4, [0]), unresolved(3, 1, [1])],
      warnings: [],
      systemFailures: [],
      scope: {
        kind: "document",
        documentId: source.id,
        collectionId: collection.id,
        evaluatedDocumentCount: 1,
        evaluatedLinkCount: 2,
      },
      policies: [expect.objectContaining({ collectionId: collection.id })],
    });
  });

  it("keeps a System Failure from distinguishing protected targets", async () => {
    const { reader, blind, collection, protectedTarget } = await buildActors();
    const policySet = policySetFor({ [collection.id]: linksOnlyPolicy });
    const missing = randomUUID();
    // The link sits in a notice inside a table cell, so it has no position.
    const build = (target: string) =>
      buildDocument({
        teamId: reader.teamId,
        userId: reader.id,
        collectionId: collection.id,
        content: {
          type: "doc",
          content: [
            {
              type: "table",
              content: [
                {
                  type: "tr",
                  content: [
                    {
                      type: "th",
                      content: [paragraphOf({ type: "text", text: "Head" })],
                    },
                  ],
                },
                {
                  type: "tr",
                  content: [
                    {
                      type: "td",
                      content: [
                        {
                          type: "container_notice",
                          attrs: { style: "info" },
                          content: [
                            paragraphOf(linkedText("note", `/doc/${target}`)),
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      });
    const toProtected = await build(protectedTarget.id);
    const toMissing = await build(missing);
    const blindClient = await connect(blind, policySet, {
      instanceOrigin: ORIGIN,
    });

    const first = firstText(await lint(blindClient, { id: toProtected.id }));
    const second = firstText(await lint(blindClient, { id: toMissing.id }));

    expect(JSON.parse(first)).toMatchObject({
      state: "failed",
      errors: [],
      systemFailures: [
        {
          code: "VALIDATION_RUNTIME_FAILED",
          location: {
            kind: "scope",
            scopeKind: "document",
            documentId: toProtected.id,
            collectionId: collection.id,
          },
        },
      ],
      scope: { evaluatedDocumentCount: 0, evaluatedLinkCount: 0 },
    });
    expect(second.split(toMissing.id).join(toProtected.id)).toBe(first);
    expect(first).not.toContain(protectedTarget.id);

    const readerClient = await connect(reader, policySet, {
      instanceOrigin: ORIGIN,
    });
    await expect(
      lintResult(readerClient, toProtected.id)
    ).resolves.toMatchObject({
      state: "complete",
      errors: [],
      systemFailures: [],
      scope: { evaluatedDocumentCount: 1, evaluatedLinkCount: 1 },
    });
  });
});

describe("lint_wiki", () => {
  const ORIGIN = "https://wiki.example.test";

  /** Hierarchy rules only. */
  const hierarchyPolicy = {
    activation: "read_only",
    rules: [{ kind: "hierarchy_acyclic" }],
  };

  /** The structure policy plus a hierarchy rule. */
  const mixedPolicy = {
    activation: "read_only",
    rules: [...structurePolicy.rules, { kind: "parent_document_resolved" }],
  };

  /**
   * Calls `lint_wiki`.
   *
   * @param client - the connected client.
   * @param args - the tool arguments.
   * @returns the tool result.
   */
  async function lintWikiCall(
    client: Client,
    args: Record<string, unknown> = {}
  ): Promise<CallToolResult> {
    return (await client.callTool({
      name: "lint_wiki",
      arguments: args,
    })) as CallToolResult;
  }

  /**
   * Calls `lint_wiki` and parses the modeled result.
   *
   * @param client - the connected client.
   * @param args - the tool arguments.
   * @returns the parsed result.
   */
  async function wikiResult(
    client: Client,
    args: Record<string, unknown> = {}
  ) {
    const result = await lintWikiCall(client, args);
    expect(result.isError).toBeUndefined();
    return JSON.parse(firstText(result));
  }

  /**
   * Records the statements sent through `sequelize.query`.
   *
   * @returns a function that returns the recorded SQL.
   */
  function recordSql() {
    const query = vi.spyOn(sequelize, "query");
    return () =>
      query.mock.calls.map(([sql]) =>
        typeof sql === "string" ? sql : sql.query
      );
  }

  /**
   * Builds an admin and a private collection the admin can read without
   * membership, with one published document.
   *
   * @returns the admin, owner, collection, and document.
   */
  async function buildAdminFixture() {
    const owner = await buildUser();
    const admin = await buildAdmin({ teamId: owner.teamId });
    const collection = await buildCollection({
      teamId: owner.teamId,
      userId: owner.id,
      permission: null,
    });
    const document = await buildDocument({
      teamId: owner.teamId,
      userId: owner.id,
      collectionId: collection.id,
      text: CLEAN_MARKDOWN,
    });
    return { admin, owner, collection, document };
  }

  it("exposes only an optional collection identifier as input", async () => {
    const user = await buildUser();
    const client = await connect(user, policySetFor({}));

    const { tools } = await client.listTools();
    const tool = tools.find((entry) => entry.name === "lint_wiki");

    expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual([
      "collectionId",
    ]);
    expect(tool?.inputSchema.properties?.collectionId).toEqual({
      type: "string",
      description: expect.stringContaining("UUID"),
    });
    expect(tool?.inputSchema.required ?? []).toEqual([]);
  });

  it("treats an empty, omitted, or extra argument as the default scope", async () => {
    const { user, collection } = await buildFixture({ text: "# Title" });
    const client = await connect(
      user,
      policySetFor({ [collection.id]: structurePolicy })
    );

    const omitted = await lintWikiCall(client);
    const empty = await lintWikiCall(client, { collectionId: "" });
    const extended = await lintWikiCall(client, {
      policy: invalidPolicy,
      activation: "enforced",
      deadlineMs: 1,
    });

    expect(omitted.isError).toBeUndefined();
    expect(JSON.parse(firstText(omitted))).toMatchObject({
      state: "complete",
      scope: {
        kind: "configured_collections",
        collections: [
          {
            collectionId: collection.id,
            evaluatedDocumentCount: 1,
            completedChecks: ["documents"],
          },
        ],
      },
    });
    expect(JSON.parse(firstText(omitted)).errors).not.toEqual([]);
    expect(firstText(empty)).toBe(firstText(omitted));
    expect(firstText(extended)).toBe(firstText(omitted));
  });

  it("keys a requested collection by its resolved lowercase ID", async () => {
    const { user, collection } = await buildFixture({ text: "# Title" });
    const client = await connect(
      user,
      policySetFor({ [collection.id]: mixedPolicy })
    );

    const canonical = await lintWikiCall(client, {
      collectionId: collection.id,
    });
    const parsed = JSON.parse(firstText(canonical));

    expect(parsed).toMatchObject({
      state: "complete",
      clean: false,
      systemFailures: [],
      scope: {
        kind: "collection",
        collectionId: collection.id,
        evaluatedDocumentCount: 1,
        completedChecks: ["documents", "hierarchy"],
      },
      policies: [{ collectionId: collection.id, status: "valid" }],
    });
    for (const collectionId of [
      collection.id.toUpperCase(),
      collection.urlId,
      `any-name-${collection.urlId}`,
    ]) {
      const result = await lintWikiCall(client, { collectionId });
      expect(firstText(result)).toBe(firstText(canonical));
      expect(firstText(result)).not.toContain(collection.id.toUpperCase());
    }
  });

  it("answers missing and denied collections identically", async () => {
    const owner = await buildUser();
    const actor = await buildUser({ teamId: owner.teamId });
    const privateCollection = await buildCollection({
      teamId: owner.teamId,
      userId: owner.id,
      permission: null,
    });
    const foreign = await buildCollection({ teamId: (await buildTeam()).id });
    const deleted = await buildCollection({
      teamId: owner.teamId,
      userId: owner.id,
    });
    await deleted.destroy({ hooks: false });
    const client = await connect(
      actor,
      policySetFor({
        [privateCollection.id]: structurePolicy,
        [foreign.id]: invalidPolicy,
        [deleted.id]: structurePolicy,
      })
    );

    const responses = [];
    for (const collectionId of [
      "00000000-0000-4000-8000-000000000000",
      "any-name-abcdefghij",
      "not a collection",
      privateCollection.id,
      foreign.id,
      deleted.id,
    ]) {
      responses.push(await lintWikiCall(client, { collectionId }));
    }

    expect(responses[0]).toEqual({
      content: [{ type: "text", text: "Authorization error" }],
      isError: true,
    });
    for (const response of responses) {
      expect(JSON.stringify(response)).toBe(JSON.stringify(responses[0]));
    }
  });

  it("returns the fixed failure message when the lookup is refused", async () => {
    const { user, collection } = await buildFixture();
    // The deadline starts at 0 ms; 59,950 ms have passed at the lookup.
    let readings = 0;
    const client = await connect(
      user,
      policySetFor({ [collection.id]: structurePolicy }),
      { clock: () => (readings++ === 0 ? 0 : 59950) }
    );
    const sql = recordSql();

    await expect(
      lintWikiCall(client, { collectionId: collection.id })
    ).resolves.toEqual({
      content: [{ type: "text", text: OPERATION_FAILED }],
      isError: true,
    });
    expect(
      sql().filter((statement) =>
        /^(SET LOCAL|SELECT|SET TRANSACTION ISOLATION)/.test(statement)
      )
    ).toEqual([]);
  });

  it("returns the fixed failure message when the lookup fails", async () => {
    const { user, collection } = await buildFixture();
    const client = await connect(
      user,
      policySetFor({ [collection.id]: structurePolicy })
    );
    vi.spyOn(Collection, "findByPk").mockRejectedValue(
      new Error("raw database detail")
    );

    await expect(
      lintWikiCall(client, { collectionId: collection.id })
    ).resolves.toEqual({
      content: [{ type: "text", text: OPERATION_FAILED }],
      isError: true,
    });
  });

  it("returns the fixed failure message for an unmodellable failure", async () => {
    const user = await buildUser();

    await expect(
      lintWikiTool(
        {},
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

  it("times out when the first snapshot batch is refused", async () => {
    const { user, collection } = await buildFixture({ text: "# Title" });
    // The deadline starts and bounds the lookup at 0 ms; 59,950 ms have
    // passed when the first snapshot batch is bounded.
    let readings = 0;
    const client = await connect(
      user,
      policySetFor({ [collection.id]: structurePolicy }),
      { clock: () => (readings++ < 2 ? 0 : 59950) }
    );

    await expect(
      wikiResult(client, { collectionId: collection.id })
    ).resolves.toEqual({
      state: "failed",
      complete: false,
      clean: false,
      errors: [],
      warnings: [],
      systemFailures: [
        {
          code: "VALIDATION_TIMEOUT",
          message: expect.any(String),
          location: {
            kind: "scope",
            scopeKind: "collection",
            collectionId: collection.id,
          },
        },
      ],
      scope: {
        kind: "collection",
        collectionId: collection.id,
        evaluatedDocumentCount: 0,
        evaluatedLinkCount: 0,
        completedChecks: [],
      },
      policies: [
        {
          collectionId: collection.id,
          status: "valid",
          policySchemaVersion: 1,
          policyFingerprint: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        },
      ],
    });
  });

  it("bounds the lookup by the 60000 ms deadline", async () => {
    const { user, collection } = await buildFixture();
    const client = await connect(
      user,
      policySetFor({ [collection.id]: structurePolicy }),
      { clock: () => 0 }
    );
    const sql = recordSql();

    await wikiResult(client, { collectionId: collection.id });

    expect(
      sql()
        .filter((statement) => statement.startsWith("SET LOCAL"))
        .slice(0, 2)
    ).toEqual([
      "SET LOCAL lock_timeout = 60000",
      "SET LOCAL statement_timeout = 60000",
    ]);
  });

  describe("an admin who can read a private collection without membership", () => {
    it("fails its graph checks without reading its structure", async () => {
      const { admin, collection } = await buildAdminFixture();
      const client = await connect(
        admin,
        policySetFor({ [collection.id]: hierarchyPolicy })
      );
      const sql = recordSql();

      await expect(wikiResult(client)).resolves.toEqual({
        state: "failed",
        complete: false,
        clean: false,
        errors: [],
        warnings: [],
        systemFailures: [
          {
            code: "VALIDATION_RUNTIME_FAILED",
            message: expect.any(String),
            location: {
              kind: "scope",
              scopeKind: "collection",
              collectionId: collection.id,
            },
          },
        ],
        scope: {
          kind: "configured_collections",
          collections: [
            {
              collectionId: collection.id,
              evaluatedDocumentCount: 0,
              evaluatedLinkCount: 0,
              completedChecks: [],
            },
          ],
        },
        policies: [expect.objectContaining({ collectionId: collection.id })],
      });
      expect(sql().join("\n")).not.toContain("documentStructure");
    });

    it("is clean with document rules only and nothing readable", async () => {
      const { admin, collection } = await buildAdminFixture();
      const client = await connect(
        admin,
        policySetFor({ [collection.id]: structurePolicy })
      );

      await expect(wikiResult(client)).resolves.toMatchObject({
        state: "complete",
        clean: true,
        scope: {
          collections: [
            {
              collectionId: collection.id,
              evaluatedDocumentCount: 0,
              evaluatedLinkCount: 0,
              completedChecks: ["documents"],
            },
          ],
        },
      });
    });

    it("evaluates a document readable through membership", async () => {
      const { admin, owner, collection, document } = await buildAdminFixture();
      await UserMembership.create({
        documentId: document.id,
        userId: admin.id,
        createdById: owner.id,
        permission: DocumentPermission.Read,
      });
      const client = await connect(
        admin,
        policySetFor({ [collection.id]: structurePolicy })
      );

      await expect(wikiResult(client)).resolves.toMatchObject({
        state: "complete",
        clean: true,
        scope: {
          collections: [
            { collectionId: collection.id, evaluatedDocumentCount: 1 },
          ],
        },
      });
    });
  });

  it("keeps a requested collection that becomes unreadable before the snapshot", async () => {
    const { user: owner, collection } = await buildFixture({
      text: CLEAN_MARKDOWN,
    });
    const shared = await buildDocument({
      teamId: owner.teamId,
      userId: owner.id,
      collectionId: collection.id,
      text: CLEAN_MARKDOWN,
    });
    const actor = await buildUser({ teamId: owner.teamId });
    await UserMembership.create({
      documentId: shared.id,
      userId: actor.id,
      createdById: owner.id,
      permission: DocumentPermission.Read,
    });
    const wikiReader: LintWikiReader = {
      ...defaultLintWikiReader,
      async authorizeLintCollection(input) {
        const resolved =
          await defaultLintWikiReader.authorizeLintCollection(input);
        await Collection.update(
          { permission: null },
          { where: { id: collection.id }, hooks: false }
        );
        return resolved;
      },
    };
    const client = await connect(
      actor,
      policySetFor({ [collection.id]: mixedPolicy }),
      { wikiReader }
    );

    const result = await wikiResult(client, { collectionId: collection.id });

    expect(result).toMatchObject({
      state: "incomplete",
      errors: [],
      systemFailures: [
        {
          code: "VALIDATION_RUNTIME_FAILED",
          location: {
            kind: "scope",
            scopeKind: "collection",
            collectionId: collection.id,
          },
        },
      ],
      scope: {
        kind: "collection",
        collectionId: collection.id,
        evaluatedDocumentCount: 1,
        completedChecks: ["documents"],
      },
    });
  });

  it("neither names nor counts unreadable configured collections", async () => {
    const { user: actor, collection: valid } = await buildFixture({
      text: "# Title",
    });
    const sentinel = await buildCollection({
      teamId: actor.teamId,
      userId: actor.id,
    });
    const owner = await buildUser({ teamId: actor.teamId });
    const hidden = [];
    for (let index = 0; index < 2; index++) {
      const collection = await buildCollection({
        teamId: owner.teamId,
        userId: owner.id,
        permission: null,
      });
      await buildDocument({
        teamId: owner.teamId,
        userId: owner.id,
        collectionId: collection.id,
      });
      hidden.push(collection.id);
    }
    const visible = {
      [valid.id]: structurePolicy,
      [sentinel.id]: invalidPolicy,
    };

    const withHidden = await lintWikiCall(
      await connect(
        actor,
        policySetFor({
          ...visible,
          [hidden[0]]: structurePolicy,
          [hidden[1]]: invalidPolicy,
        })
      )
    );
    const withoutHidden = await lintWikiCall(
      await connect(actor, policySetFor(visible))
    );

    expect(JSON.parse(firstText(withHidden))).toMatchObject({
      state: "incomplete",
      policies: [
        expect.objectContaining({ collectionId: expect.any(String) }),
        expect.objectContaining({ collectionId: expect.any(String) }),
      ],
    });
    expect(firstText(withHidden)).toBe(firstText(withoutHidden));
    for (const collectionId of hidden) {
      expect(firstText(withHidden)).not.toContain(collectionId);
    }
  });

  it("resolves links to drafts and archived documents without evaluating them", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const draft = await buildDraftDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
    });
    const archived = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
      archivedAt: new Date(),
    });
    await buildDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
      text: `[draft](/doc/${draft.id})\n\n[archived](/doc/${archived.urlId})`,
    });
    const client = await connect(
      user,
      policySetFor({
        [collection.id]: {
          activation: "read_only",
          rules: [{ kind: "internal_links" }],
        },
      }),
      { instanceOrigin: ORIGIN }
    );

    await expect(wikiResult(client)).resolves.toMatchObject({
      state: "complete",
      clean: true,
      errors: [],
      scope: {
        collections: [
          {
            collectionId: collection.id,
            evaluatedDocumentCount: 1,
            evaluatedLinkCount: 2,
          },
        ],
      },
    });
  });

  it("keeps point-in-time meaning when commits follow the snapshot", async () => {
    const { user, collection, document } = await buildFixture({
      text: "# Title",
    });
    const policySet = policySetFor({ [collection.id]: structurePolicy });
    const before = firstText(
      await lintWikiCall(await connect(user, policySet))
    );

    const wikiReader: LintWikiReader = {
      ...defaultLintWikiReader,
      async readWikiSnapshot(input) {
        const read = await defaultLintWikiReader.readWikiSnapshot(input);
        await Document.unscoped().update(
          { content: parser.parse(CLEAN_MARKDOWN)?.toJSON() },
          { where: { id: document.id }, hooks: false }
        );
        await buildDocument({
          teamId: user.teamId,
          userId: user.id,
          collectionId: collection.id,
          text: CLEAN_MARKDOWN,
        });
        return read;
      },
    };
    const during = firstText(
      await lintWikiCall(await connect(user, policySet, { wikiReader }))
    );
    const after = JSON.parse(
      firstText(await lintWikiCall(await connect(user, policySet)))
    );

    expect(JSON.parse(before).errors).not.toEqual([]);
    expect(during).toBe(before);
    expect(after).toMatchObject({
      state: "complete",
      clean: true,
      scope: { collections: [{ evaluatedDocumentCount: 2 }] },
    });
  });

  it("mutates nothing but its audit summaries and is byte-stable for identical state", async () => {
    const { user, collection } = await buildFixture({
      text: "# Title\n\n## Details\n\n#### Deep",
    });
    const client = await connect(
      user,
      policySetFor({ [collection.id]: mixedPolicy })
    );
    const eventCount = await Event.count({ where: { teamId: user.teamId } });
    const sql = recordSql();

    const first = await lintWikiCall(client);
    const second = await lintWikiCall(client);

    expect(JSON.parse(firstText(first)).errors.length).toBeGreaterThan(1);
    expect(firstText(second)).toBe(firstText(first));
    const statements = sql();
    expect(statements.join("\n")).toContain("SET TRANSACTION READ ONLY");
    expect(mutationsOf(statements)).toEqual([auditInsert, auditInsert]);
    expect(statements.join("\n")).not.toMatch(/"document"\."text"/);
    vi.restoreAllMocks();
    await expect(Event.count({ where: { teamId: user.teamId } })).resolves.toBe(
      eventCount + 2
    );
    await expect(
      Event.count({ where: { teamId: user.teamId, name: "wikiLint.wiki" } })
    ).resolves.toBe(2);
  });
  describe("hierarchy and global index", () => {
    /** Every hierarchy rule kind. */
    const fullHierarchyPolicy = {
      activation: "read_only",
      rules: [
        { kind: "parent_document_resolved" },
        { kind: "hierarchy_acyclic" },
        { kind: "published_documents_in_structure" },
        { kind: "parent_collection_consistent" },
      ],
    };

    /**
     * Builds a policy that enables only `global_index_links`.
     *
     * @param surfaceDocumentId - the surface.
     * @param globalIndexDocumentIds - the global indexes.
     * @returns the policy entry.
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
     * Builds a published document in a collection.
     *
     * @param user - the author.
     * @param collectionId - the collection.
     * @param overrides - other document attributes.
     * @returns the document, which is not added to the collection structure.
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
     * Adds parentless documents to the root of a collection structure.
     *
     * @param collection - the collection.
     * @param documents - the documents.
     */
    async function addToStructure(
      collection: Collection,
      documents: Document[]
    ) {
      for (const document of documents) {
        await collection.addDocumentToStructure(document);
      }
    }

    /**
     * Sets a document's parent without hooks or structure changes.
     *
     * @param document - the child.
     * @param parent - the parent.
     */
    async function setParent(document: Document, parent: Document) {
      await Document.unscoped().update(
        { parentDocumentId: parent.id },
        { where: { id: document.id }, hooks: false }
      );
    }

    /**
     * Builds an expected relationship-located Error.
     *
     * @param code - the code.
     * @param documentId - the location document.
     * @param relationshipKind - the relationship kind.
     * @returns the expected Finding.
     */
    const relationshipError = (
      code: string,
      documentId: string,
      relationshipKind: string
    ) => ({
      code,
      severity: "error",
      message: expect.any(String),
      location: { kind: "relationship", documentId, relationshipKind },
    });

    /**
     * Builds the expected generic System Failure of a collection.
     *
     * @param collectionId - the collection.
     * @returns the expected System Failure.
     */
    const collectionFailure = (collectionId: string) => ({
      code: "VALIDATION_RUNTIME_FAILED",
      message: expect.any(String),
      location: { kind: "scope", scopeKind: "collection", collectionId },
    });

    it("reports hierarchy defects in AD-4 order without disclosing protected parents", async () => {
      const user = await buildUser();
      const collection = await buildCollection({
        teamId: user.teamId,
        userId: user.id,
      });
      const elsewhere = await buildCollection({
        teamId: user.teamId,
        userId: user.id,
      });
      const owner = await buildUser({ teamId: user.teamId });
      const privateCollection = await buildCollection({
        teamId: owner.teamId,
        userId: owner.id,
        permission: null,
      });
      const root = await publishedIn(user, collection.id);
      const child = await publishedIn(user, collection.id);
      const deletedParent = await publishedIn(user, collection.id);
      const ofDeleted = await publishedIn(user, collection.id);
      const protectedParent = await publishedIn(owner, privateCollection.id);
      const ofProtected = await publishedIn(user, collection.id);
      const sharedParent = await publishedIn(owner, privateCollection.id);
      await UserMembership.create({
        documentId: sharedParent.id,
        userId: user.id,
        createdById: owner.id,
        permission: DocumentPermission.Read,
      });
      const ofShared = await publishedIn(user, collection.id);
      const otherParent = await publishedIn(user, elsewhere.id);
      const ofOther = await publishedIn(user, collection.id);
      const draftParent = await buildDraftDocument({
        teamId: user.teamId,
        userId: user.id,
        collectionId: collection.id,
      });
      const ofDraft = await publishedIn(user, collection.id);
      const archivedParent = await publishedIn(user, collection.id, {
        archivedAt: new Date(),
      });
      const ofArchived = await publishedIn(user, collection.id);
      const cycleA = await publishedIn(user, collection.id);
      const cycleB = await publishedIn(user, collection.id);
      const missing = await publishedIn(user, collection.id);
      await buildDraftDocument({
        teamId: user.teamId,
        userId: user.id,
        collectionId: collection.id,
      });
      await addToStructure(collection, [
        root,
        child,
        ofDeleted,
        ofProtected,
        ofShared,
        ofOther,
        ofDraft,
        ofArchived,
        cycleA,
        cycleB,
      ]);
      for (const [document, parent] of [
        [child, root],
        [ofDeleted, deletedParent],
        [ofProtected, protectedParent],
        [ofShared, sharedParent],
        [ofOther, otherParent],
        [ofDraft, draftParent],
        [ofArchived, archivedParent],
        [cycleA, cycleB],
        [cycleB, cycleA],
      ]) {
        await setParent(document, parent);
      }
      await Document.unscoped().update(
        { deletedAt: new Date() },
        { where: { id: deletedParent.id }, hooks: false }
      );
      const client = await connect(
        user,
        policySetFor({ [collection.id]: fullHierarchyPolicy })
      );

      const first = await lintWikiCall(client, { collectionId: collection.id });
      const second = await lintWikiCall(client, {
        collectionId: collection.id,
      });

      const expected = [
        relationshipError("PARENT_DOCUMENT_UNRESOLVED", ofDeleted.id, "parent"),
        relationshipError(
          "PARENT_DOCUMENT_UNRESOLVED",
          ofProtected.id,
          "parent"
        ),
        relationshipError("PARENT_COLLECTION_MISMATCH", ofShared.id, "parent"),
        relationshipError("PARENT_COLLECTION_MISMATCH", ofOther.id, "parent"),
        relationshipError("HIERARCHY_CYCLE", cycleA.id, "parent"),
        relationshipError("HIERARCHY_CYCLE", cycleB.id, "parent"),
        relationshipError(
          "PUBLISHED_DOCUMENT_MISSING_FROM_STRUCTURE",
          missing.id,
          "collection_structure"
        ),
      ].sort((a, b) =>
        a.location.documentId < b.location.documentId ? -1 : 1
      );
      expect(first.isError).toBeUndefined();
      expect(JSON.parse(firstText(first))).toEqual({
        state: "complete",
        complete: true,
        clean: false,
        errors: expected,
        warnings: [],
        systemFailures: [],
        scope: {
          kind: "collection",
          collectionId: collection.id,
          evaluatedDocumentCount: 0,
          evaluatedLinkCount: 0,
          completedChecks: ["hierarchy"],
        },
        policies: [
          expect.objectContaining({
            collectionId: collection.id,
            status: "valid",
          }),
        ],
      });
      for (const hidden of [
        protectedParent.id,
        sharedParent.id,
        deletedParent.id,
        privateCollection.id,
      ]) {
        expect(firstText(first)).not.toContain(hidden);
      }
      expect(firstText(second)).toBe(firstText(first));
    });

    it("completes a vacuous hierarchy check", async () => {
      const user = await buildUser();
      const collection = await buildCollection({
        teamId: user.teamId,
        userId: user.id,
      });
      await buildDraftDocument({
        teamId: user.teamId,
        userId: user.id,
        collectionId: collection.id,
      });
      const client = await connect(
        user,
        policySetFor({ [collection.id]: fullHierarchyPolicy })
      );

      await expect(
        wikiResult(client, { collectionId: collection.id })
      ).resolves.toEqual({
        state: "complete",
        complete: true,
        clean: true,
        errors: [],
        warnings: [],
        systemFailures: [],
        scope: {
          kind: "collection",
          collectionId: collection.id,
          evaluatedDocumentCount: 0,
          evaluatedLinkCount: 0,
          completedChecks: ["hierarchy"],
        },
        policies: [expect.objectContaining({ collectionId: collection.id })],
      });
    });

    /**
     * Builds a surface that links four of eight indexes in recognized forms,
     * three only in unrecognized forms, and one only through another
     * document; plus an index and a surface in a private collection the
     * user cannot read.
     *
     * @returns the fixture.
     */
    async function buildGlobalIndexFixture() {
      const user = await buildUser();
      const collection = await buildCollection({
        teamId: user.teamId,
        userId: user.id,
      });
      const indexes: Document[] = [];
      for (let index = 0; index < 8; index++) {
        indexes.push(await publishedIn(user, collection.id));
      }
      const [l2, l5, l6, l7, l8, l9, l10, transitive] = indexes;
      const intermediate = await publishedIn(user, collection.id, {
        content: {
          type: "doc",
          content: [paragraphOf(linkedText("next", `/doc/${transitive.id}`))],
        },
      });
      const surface = await publishedIn(user, collection.id, {
        content: {
          type: "doc",
          content: [
            paragraphOf(linkedText("L2", `/doc/any-title-${l2.urlId}`)),
            paragraphOf(linkedText("L5", `${ORIGIN}/doc/${l5.id}`)),
            paragraphOf({
              type: "mention",
              attrs: {
                type: "document",
                label: "L6",
                modelId: l6.id,
                id: randomUUID(),
                anchorId: "anchor",
              },
            }),
            paragraphOf(linkedText("L7", `/d/${l7.id}`)),
            paragraphOf(
              linkedText("L8", `https://other.example.test/doc/${l8.id}`)
            ),
            paragraphOf(linkedText("L9", `//wiki.example.test/doc/${l9.id}`)),
            paragraphOf(
              linkedText("L10", `/s/share-id/doc/any-title-${l10.urlId}`)
            ),
            paragraphOf(linkedText("via", `/doc/${intermediate.id}`)),
          ],
        },
      });
      const owner = await buildUser({ teamId: user.teamId });
      const privateCollection = await buildCollection({
        teamId: owner.teamId,
        userId: owner.id,
        permission: null,
      });
      const hiddenIndex = await publishedIn(owner, privateCollection.id);
      const hiddenSurface = await publishedIn(owner, privateCollection.id, {
        content: {
          type: "doc",
          content: [paragraphOf(linkedText("L1", `/doc/${l2.id}`))],
        },
      });
      return {
        user,
        collection,
        privateCollection,
        surface,
        indexes,
        indexIds: indexes.map(({ id }) => id),
        hiddenIndex,
        hiddenSurface,
      };
    }

    /**
     * Builds the expected missing-link Error that names its index.
     *
     * @param surfaceId - the surface.
     * @returns a function from the missing index to its expected Finding.
     */
    const missingIndexOf = (surfaceId: string) => (index: Document) => ({
      ...relationshipError(
        "GLOBAL_INDEX_LINK_MISSING",
        surfaceId,
        "global_index"
      ),
      detail: {
        kind: "global_index",
        documentId: index.id,
        urlId: index.urlId,
      },
    });

    it("reports each global index the surface does not link directly", async () => {
      const { user, collection, surface, indexes, indexIds } =
        await buildGlobalIndexFixture();
      const client = await connect(
        user,
        policySetFor({
          [collection.id]: globalIndexPolicy(surface.id, indexIds),
        }),
        { instanceOrigin: ORIGIN }
      );

      // The four unrecognized indexes, in configured order.
      await expect(
        wikiResult(client, { collectionId: collection.id })
      ).resolves.toEqual({
        state: "complete",
        complete: true,
        clean: false,
        errors: indexes.slice(4).map(missingIndexOf(surface.id)),
        warnings: [],
        systemFailures: [],
        scope: {
          kind: "collection",
          collectionId: collection.id,
          evaluatedDocumentCount: 0,
          evaluatedLinkCount: 0,
          completedChecks: ["global_index"],
        },
        policies: [expect.objectContaining({ collectionId: collection.id })],
      });
      // The four recognized forms alone leave nothing missing.
      const recognized = await connect(
        user,
        policySetFor({
          [collection.id]: globalIndexPolicy(surface.id, indexIds.slice(0, 4)),
        }),
        { instanceOrigin: ORIGIN }
      );
      await expect(
        wikiResult(recognized, { collectionId: collection.id })
      ).resolves.toMatchObject({ state: "complete", clean: true, errors: [] });
    });

    it("keeps provable Findings and fails generically for an unreadable index", async () => {
      const {
        user,
        collection,
        privateCollection,
        surface,
        indexes,
        indexIds,
        hiddenIndex,
      } = await buildGlobalIndexFixture();
      const client = await connect(
        user,
        policySetFor({
          [collection.id]: globalIndexPolicy(surface.id, [
            ...indexIds,
            hiddenIndex.id,
          ]),
        }),
        { instanceOrigin: ORIGIN }
      );

      const text = firstText(
        await lintWikiCall(client, { collectionId: collection.id })
      );

      expect(JSON.parse(text)).toEqual({
        state: "failed",
        complete: false,
        clean: false,
        errors: indexes.slice(4).map(missingIndexOf(surface.id)),
        warnings: [],
        systemFailures: [collectionFailure(collection.id)],
        scope: {
          kind: "collection",
          collectionId: collection.id,
          evaluatedDocumentCount: 0,
          evaluatedLinkCount: 0,
          completedChecks: [],
        },
        policies: [expect.objectContaining({ collectionId: collection.id })],
      });
      expect(text).not.toContain(hiddenIndex.id);
      expect(text).not.toContain(hiddenIndex.urlId);
      expect(text).not.toContain(privateCollection.id);
    });

    it("reports no missing link for an unreadable surface", async () => {
      const { user, collection, privateCollection, indexIds, hiddenSurface } =
        await buildGlobalIndexFixture();
      const client = await connect(
        user,
        policySetFor({
          [collection.id]: globalIndexPolicy(hiddenSurface.id, indexIds),
        }),
        { instanceOrigin: ORIGIN }
      );

      const text = firstText(
        await lintWikiCall(client, { collectionId: collection.id })
      );

      expect(JSON.parse(text)).toMatchObject({
        state: "failed",
        clean: false,
        errors: [],
        systemFailures: [collectionFailure(collection.id)],
        scope: { completedChecks: [] },
      });
      expect(text).not.toContain(hiddenSurface.id);
      expect(text).not.toContain(privateCollection.id);
    });

    it("fails the graph checks of an admin without membership without reading the structure", async () => {
      const { admin, owner, collection, document } = await buildAdminFixture();
      await UserMembership.create({
        documentId: document.id,
        userId: admin.id,
        createdById: owner.id,
        permission: DocumentPermission.Read,
      });
      const client = await connect(
        admin,
        policySetFor({
          [collection.id]: {
            activation: "read_only",
            rules: [
              ...structurePolicy.rules,
              { kind: "published_documents_in_structure" },
              {
                kind: "global_index_links",
                surfaceDocumentId: document.id,
                globalIndexDocumentIds: [randomUUID()],
              },
            ],
          },
        })
      );
      const sql = recordSql();

      const result = await wikiResult(client);

      expect(result).toMatchObject({
        state: "incomplete",
        errors: [],
        systemFailures: [
          collectionFailure(collection.id),
          collectionFailure(collection.id),
        ],
        scope: {
          kind: "configured_collections",
          collections: [
            {
              collectionId: collection.id,
              evaluatedDocumentCount: 1,
              evaluatedLinkCount: 0,
              completedChecks: ["documents"],
            },
          ],
        },
      });
      expect(sql().join("\n")).not.toContain("documentStructure");
    });

    it("completes every check of a clean collection", async () => {
      const user = await buildUser();
      const collection = await buildCollection({
        teamId: user.teamId,
        userId: user.id,
      });
      const index = await publishedIn(user, collection.id, {
        text: CLEAN_MARKDOWN,
      });
      const surface = await publishedIn(user, collection.id, {
        text: `## Overview\n\nSee [index](/doc/${index.id})\n\n## Details\n\nBody`,
      });
      await addToStructure(collection, [surface, index]);
      await setParent(index, surface);
      const client = await connect(
        user,
        policySetFor({
          [collection.id]: {
            activation: "read_only",
            rules: [
              ...structurePolicy.rules,
              { kind: "internal_links" },
              ...fullHierarchyPolicy.rules,
              ...globalIndexPolicy(surface.id, [index.id]).rules,
            ],
          },
        }),
        { instanceOrigin: ORIGIN }
      );

      await expect(
        wikiResult(client, { collectionId: collection.id })
      ).resolves.toEqual({
        state: "complete",
        complete: true,
        clean: true,
        errors: [],
        warnings: [],
        systemFailures: [],
        scope: {
          kind: "collection",
          collectionId: collection.id,
          evaluatedDocumentCount: 2,
          evaluatedLinkCount: 1,
          completedChecks: ["documents", "hierarchy", "global_index"],
        },
        policies: [
          {
            collectionId: collection.id,
            status: "valid",
            policySchemaVersion: 1,
            policyFingerprint: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
          },
        ],
      });
    });
  });
  describe("bounds and admission", () => {
    /**
     * Returns the policy identity of a collection in a policy set.
     *
     * @param set - the policy set.
     * @param collectionId - the collection.
     * @returns the identity.
     */
    const identityIn = (set: PolicySet, collectionId: string) => {
      const entry = set.entries.find((e) => e.collectionId === collectionId);
      if (!entry) {
        throw new Error("Unknown test collection");
      }
      return policyIdentity(entry);
    };

    const configured: ScopeLocation = {
      kind: "scope",
      scopeKind: "configured_collections",
    };

    const collectionAt = (collectionId: string): ScopeLocation => ({
      kind: "scope",
      scopeKind: "collection",
      collectionId,
    });

    const zeroEntry = (collectionId: string) => ({
      collectionId,
      evaluatedDocumentCount: 0,
      evaluatedLinkCount: 0,
      completedChecks: [],
    });

    /**
     * Builds the `failed` result of a request rejected by admission.
     *
     * @param set - the policy set.
     * @param collectionId - the requested collection, or undefined for the
     *   default scope.
     * @returns the result.
     */
    const rejection = (set: PolicySet, collectionId?: string) => ({
      state: "failed",
      complete: false,
      clean: false,
      errors: [],
      warnings: [],
      systemFailures: [
        createSystemFailure(
          "VALIDATION_RESOURCE_LIMIT_EXCEEDED",
          collectionId === undefined ? configured : collectionAt(collectionId)
        ),
      ],
      scope:
        collectionId === undefined
          ? { kind: "configured_collections", collections: [] }
          : { kind: "collection", ...zeroEntry(collectionId) },
      policies:
        collectionId === undefined ? [] : [identityIn(set, collectionId)],
    });

    /**
     * Creates a promise and its resolver.
     *
     * @returns the promise and its resolver.
     */
    function deferred() {
      let resolve: () => void = () => undefined;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    }

    it("keeps the finished units when it stops at the margin", async () => {
      const user = await buildUser();
      const collectionId = randomUUID();
      const [d1, d2, d3] = [1, 2, 3].map(
        (index) => `00000000-0000-4000-8000-0000000000d${index}`
      );
      const documentOf = (documentId: string, markdown: string) => ({
        documentId,
        content: { syntax: parseCanonicalMarkdown(markdown), links: null },
        parent: { state: "none" as const },
      });
      const wikiReader: LintWikiReader = {
        authorizeLintCollection: async () => collectionId,
        readWikiSnapshot: async () => ({
          ok: true,
          snapshot: {
            collections: [
              {
                collectionId,
                documents: [
                  documentOf(d1, "## Overview\n\nBody"),
                  documentOf(d2, CLEAN_MARKDOWN),
                  documentOf(d3, CLEAN_MARKDOWN),
                ],
                graph: {
                  authorized: true,
                  structureDocumentIds: [d1, d2, d3],
                  globalIndex: null,
                },
              },
            ],
            sentinelCollectionIds: [],
            targets: new Map(),
          },
        }),
      };
      const policySet = policySetFor({ [collectionId]: mixedPolicy });
      // The deadline start, the post-snapshot expiry check, and the checks
      // before the first two units read 0 ms; the check before the third
      // unit finds less than the stop margin left.
      let readings = 0;
      const client = await connect(user, policySet, {
        wikiReader,
        clock: () =>
          readings++ < 4
            ? 0
            : LINT_WIKI_DEADLINE_MS - LINT_WIKI_STOP_MARGIN_MS + 1,
      });

      const result = await lintWikiCall(client, { collectionId });

      expect(result.isError).toBeUndefined();
      expect(JSON.parse(firstText(result))).toEqual({
        state: "incomplete",
        complete: false,
        clean: false,
        errors: [
          createFinding(
            "REQUIRED_SECTION_MISSING",
            { kind: "document", documentId: d1 },
            { kind: "section", heading: "Details", headingLevel: 2 }
          ),
        ],
        warnings: [],
        systemFailures: [
          createSystemFailure("VALIDATION_TIMEOUT", collectionAt(collectionId)),
        ],
        scope: {
          kind: "collection",
          collectionId,
          evaluatedDocumentCount: 2,
          evaluatedLinkCount: 0,
          completedChecks: [],
        },
        policies: [identityIn(policySet, collectionId)],
      });
    });

    it("fails above the structure-node limit and keeps a readable sentinel", async () => {
      const { user, collection } = await buildFixture({
        text: CLEAN_MARKDOWN,
      });
      const sentinel = await buildCollection({
        teamId: user.teamId,
        userId: user.id,
      });
      const policySet = policySetFor({
        [collection.id]: hierarchyPolicy,
        [sentinel.id]: invalidPolicy,
      });
      const client = await connect(user, policySet);
      /**
       * Replaces the collection structure with root nodes.
       *
       * @param count - the number of nodes.
       */
      const setStructure = (count: number) =>
        Collection.update(
          {
            documentStructure: Array.from({ length: count }, () => ({
              id: randomUUID(),
              title: "",
              url: "",
              children: [],
            })),
          },
          { where: { id: collection.id }, hooks: false }
        );

      await setStructure(10000);
      await expect(
        wikiResult(client, { collectionId: collection.id })
      ).resolves.toMatchObject({ state: "complete" });

      await setStructure(10001);
      await expect(
        wikiResult(client, { collectionId: collection.id })
      ).resolves.toEqual({
        state: "failed",
        complete: false,
        clean: false,
        errors: [],
        warnings: [],
        systemFailures: [
          createSystemFailure(
            "VALIDATION_RESOURCE_LIMIT_EXCEEDED",
            collectionAt(collection.id)
          ),
        ],
        scope: { kind: "collection", ...zeroEntry(collection.id) },
        policies: [identityIn(policySet, collection.id)],
      });
      await expect(wikiResult(client)).resolves.toEqual({
        state: "failed",
        complete: false,
        clean: false,
        errors: [],
        warnings: [],
        systemFailures: [
          createSystemFailure(
            "POLICY_CONFIGURATION_INVALID",
            collectionAt(sentinel.id)
          ),
          createSystemFailure("VALIDATION_RESOURCE_LIMIT_EXCEEDED", configured),
        ],
        scope: {
          kind: "configured_collections",
          collections: [zeroEntry(sentinel.id)],
        },
        policies: [identityIn(policySet, sentinel.id)],
      });
    });

    it("rejects concurrent scans only after their authorization", async () => {
      const { user, collection } = await buildFixture({
        text: CLEAN_MARKDOWN,
      });
      const sentinel = await buildCollection({
        teamId: user.teamId,
        userId: user.id,
      });
      const unconfigured = await buildCollection({
        teamId: user.teamId,
        userId: user.id,
      });
      const owner = await buildUser({ teamId: user.teamId });
      const denied = await buildCollection({
        teamId: owner.teamId,
        userId: owner.id,
        permission: null,
      });
      const policySet = policySetFor({
        [collection.id]: structurePolicy,
        [sentinel.id]: invalidPolicy,
        [denied.id]: structurePolicy,
      });
      const entered = deferred();
      const hold = deferred();
      const holdingReader: LintWikiReader = {
        ...defaultLintWikiReader,
        async readWikiSnapshot(input) {
          entered.resolve();
          await hold.promise;
          return defaultLintWikiReader.readWikiSnapshot(input);
        },
      };
      const client = await connect(user, policySet);
      const emptyClient = await connect(user, policySetFor({}));
      /**
       * Makes the requests that never need admission.
       *
       * @returns their responses.
       */
      const unadmitted = async () => [
        await lintWikiCall(client, { collectionId: sentinel.id }),
        await lintWikiCall(client, { collectionId: unconfigured.id }),
        await lintWikiCall(emptyClient),
      ];

      const holding = lintWikiCall(
        await connect(user, policySet, { wikiReader: holdingReader }),
        { collectionId: collection.id }
      );
      let whileHeld: CallToolResult[];
      try {
        await entered.promise;

        await expect(
          wikiResult(client, { collectionId: collection.id })
        ).resolves.toEqual(rejection(policySet, collection.id));
        await expect(wikiResult(client)).resolves.toEqual(rejection(policySet));
        await expect(
          lintWikiCall(client, { collectionId: denied.id })
        ).resolves.toEqual({
          content: [{ type: "text", text: "Authorization error" }],
          isError: true,
        });
        whileHeld = await unadmitted();
      } finally {
        hold.resolve();
      }

      const first = await holding;
      expect(first.isError).toBeUndefined();
      expect(JSON.parse(firstText(first))).toMatchObject({
        state: "complete",
      });
      expect(whileHeld).toEqual(await unadmitted());
      expect(whileHeld.map((result) => JSON.parse(firstText(result)))).toEqual([
        expect.objectContaining({ state: "failed" }),
        expect.objectContaining({ state: "not_evaluated" }),
        expect.objectContaining({ state: "not_evaluated" }),
      ]);
      await expect(
        wikiResult(client, { collectionId: collection.id })
      ).resolves.toMatchObject({ state: "complete" });
    });

    it.each([
      [
        "success",
        (input: Parameters<LintWikiReader["readWikiSnapshot"]>[0]) =>
          defaultLintWikiReader.readWikiSnapshot(input),
        null,
      ],
      [
        "a timeout",
        async (): Promise<WikiSnapshotRead> => ({
          ok: false,
          error: new DeadlineFloorError(),
          sentinelCollectionIds: [],
        }),
        "VALIDATION_TIMEOUT",
      ],
      [
        "a snapshot failure",
        async (): Promise<WikiSnapshotRead> => ({
          ok: false,
          error: new Error("raw detail"),
          sentinelCollectionIds: [],
        }),
        "VALIDATION_RUNTIME_FAILED",
      ],
      [
        "a resource-limit failure",
        async (): Promise<WikiSnapshotRead> => ({
          ok: false,
          error: new WikiResourceLimitError(),
          sentinelCollectionIds: [],
        }),
        "VALIDATION_RESOURCE_LIMIT_EXCEEDED",
      ],
      [
        "a cancellation",
        async (): Promise<WikiSnapshotRead> => {
          throw ClientClosedRequestError();
        },
        "VALIDATION_RUNTIME_FAILED",
      ],
      [
        "a thrown error",
        async (): Promise<WikiSnapshotRead> => ({
          ok: true,
          snapshot: {
            collections: [
              { collectionId: randomUUID(), documents: [], graph: null },
            ],
            sentinelCollectionIds: [],
            targets: new Map(),
          },
        }),
        OPERATION_FAILED,
      ],
    ] as const)(
      "releases the slot after %s",
      async (_name, readWikiSnapshot, outcome) => {
        const { user, collection } = await buildFixture({
          text: CLEAN_MARKDOWN,
        });
        const policySet = policySetFor({ [collection.id]: structurePolicy });
        let heldDuringRead = false;
        const wikiReader: LintWikiReader = {
          ...defaultLintWikiReader,
          readWikiSnapshot(input) {
            const probe = lintWikiAdmission.lease();
            heldDuringRead = !probe.acquire();
            probe.release();
            return readWikiSnapshot(input);
          },
        };

        const terminal = await lintWikiCall(
          await connect(user, policySet, { wikiReader }),
          { collectionId: collection.id }
        );

        expect(heldDuringRead).toBe(true);
        if (outcome === OPERATION_FAILED) {
          expect(terminal).toEqual({
            content: [{ type: "text", text: OPERATION_FAILED }],
            isError: true,
          });
        } else {
          expect(terminal.isError).toBeUndefined();
          expect(
            JSON.parse(firstText(terminal)).systemFailures.map(
              ({ code }: { code: string }) => code
            )
          ).toEqual(outcome === null ? [] : [outcome]);
        }
        await expect(
          wikiResult(await connect(user, policySet), {
            collectionId: collection.id,
          })
        ).resolves.toMatchObject({ state: "complete" });
      }
    );
  });
});

describe("audit summary", () => {
  /** Dependencies a test passes to both lint tools. */
  type AuditDependencies = Omit<LintDocumentDependencies, "policySet"> & {
    wikiReader?: LintWikiReader;
  };

  /** Structure rules plus a discouraged blockquote, which is a Warning. */
  const warningPolicy = {
    activation: "read_only",
    rules: [
      ...structurePolicy.rules,
      { kind: "discouraged_markdown_structures", structures: ["blockquote"] },
    ],
  };

  /**
   * Calls `lint_wiki`.
   *
   * @param client - the connected client.
   * @param args - the tool arguments.
   * @returns the tool result.
   */
  const lintWikiCall = async (
    client: Client,
    args: Record<string, unknown> = {}
  ) =>
    (await client.callTool({
      name: "lint_wiki",
      arguments: args,
    })) as CallToolResult;

  /**
   * Returns the valid policy fields of a collection.
   *
   * @param set - the policy set.
   * @param collectionId - the collection.
   * @returns the AD-14 policy fields.
   */
  const policyFieldsOf = (set: PolicySet, collectionId: string) => {
    const entry = set.entries.find((e) => e.collectionId === collectionId);
    if (entry?.status !== "valid") {
      throw new Error("Expected a valid test policy");
    }
    return {
      policySchemaVersion: entry.policySchemaVersion,
      policyFingerprint: entry.policyFingerprint,
    };
  };

  /**
   * Reads the stored Wiki lint audit Events of a team.
   *
   * @param teamId - the team.
   * @returns the stored columns of each Event, oldest first.
   */
  async function auditRows(teamId: string) {
    const events = await Event.findAll({
      where: { teamId, name: [...WIKI_LINT_AUDIT_EVENTS] },
      order: [
        ["createdAt", "ASC"],
        ["id", "ASC"],
      ],
    });
    return events.map((event) => ({
      id: event.id,
      name: event.name,
      teamId: event.teamId,
      actorId: event.actorId,
      userId: event.userId,
      modelId: event.modelId,
      documentId: event.documentId,
      collectionId: event.collectionId,
      ip: event.ip,
      authType: event.authType,
      changes: event.changes,
      data: event.data,
    }));
  }

  /**
   * Builds an expected audit Event.
   *
   * @param input.id - the Event ID.
   * @param input.user - the actor.
   * @param input.name - the Event name.
   * @param input.documentId - the document column.
   * @param input.collectionId - the collection column.
   * @param data - the data fields that differ from a clean, complete,
   *   zero-count `lint_document` result without a policy.
   * @returns the expected stored columns.
   */
  const expectedRow = (
    input: {
      id: string;
      user: User;
      name?: string;
      documentId?: string;
      collectionId?: string;
    },
    data: Record<string, unknown>
  ) => ({
    id: input.id,
    name: input.name ?? "wikiLint.document",
    teamId: input.user.teamId,
    actorId: input.user.id,
    userId: null,
    modelId: null,
    documentId: input.documentId ?? null,
    collectionId: input.collectionId ?? null,
    ip: null,
    authType: "mcp",
    changes: null,
    data: {
      schemaVersion: 1,
      requestId: expect.any(String),
      operation: "lint_document",
      outcome: "clean",
      complete: true,
      durationMs: expect.any(Number),
      scopeKind: "document",
      evaluatedDocumentCount: 0,
      evaluatedLinkCount: 0,
      counts: { errors: 0, warnings: 0, systemFailures: 0, byCode: {} },
      runtimeFailOpenExercised: false,
      credentialAuthType: "api",
      ...data,
    },
  });

  /**
   * Runs a call with the production writer, recording the Event IDs it
   * writes, then runs it again without audit and checks the results match.
   *
   * @param call - makes the call with the given dependencies.
   * @returns the audited result and the IDs written.
   */
  async function auditedCall(
    call: (dependencies: AuditDependencies) => Promise<CallToolResult>
  ) {
    const ids: string[] = [];
    const result = await call({
      writeAudit: async (row, statementTimeoutMs) => {
        ids.push(row.id);
        await insertAuditEvent(row, statementTimeoutMs);
      },
    });
    const unaudited = await call({ writeAudit: async () => undefined });
    expect(JSON.stringify(unaudited)).toBe(JSON.stringify(result));
    return { result, ids };
  }

  /**
   * Builds the context of a direct tool call, as the `/mcp` route fills it.
   *
   * @param user - the actor.
   * @returns the context.
   */
  const contextOf = (user: User) => ({
    authInfo: {
      token: "",
      clientId: "",
      scopes: [],
      extra: { user, requestId: randomUUID(), credentialAuthType: "api" },
    },
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("of lint_document", () => {
    it("records a clean document with its policy and without its collection", async () => {
      const { user, collection, document } = await buildFixture({
        text: CLEAN_MARKDOWN,
      });
      const policySet = policySetFor({ [collection.id]: structurePolicy });

      const { result, ids } = await auditedCall(async (dependencies) =>
        lint(await connect(user, policySet, dependencies), {
          id: document.id,
        })
      );

      expect(JSON.parse(firstText(result)).state).toBe("complete");
      expect(ids).toHaveLength(1);
      expect(await auditRows(user.teamId)).toStrictEqual([
        expectedRow(
          { id: ids[0], user, documentId: document.id },
          {
            ...policyFieldsOf(policySet, collection.id),
            evaluatedDocumentCount: 1,
          }
        ),
      ]);
    });

    it("records the counts of Errors and Warnings", async () => {
      const { user, collection, document } = await buildFixture({
        text: "# Title\n\n> Quote",
      });
      const policySet = policySetFor({ [collection.id]: warningPolicy });

      const { result, ids } = await auditedCall(async (dependencies) =>
        lint(await connect(user, policySet, dependencies), {
          id: document.id,
        })
      );

      const parsed = JSON.parse(firstText(result));
      expect(parsed.errors.length).toBeGreaterThan(0);
      expect(parsed.warnings.length).toBeGreaterThan(0);
      const byCode: Record<string, number> = {};
      for (const { code } of [...parsed.errors, ...parsed.warnings]) {
        byCode[code] = (byCode[code] ?? 0) + 1;
      }
      expect(await auditRows(user.teamId)).toStrictEqual([
        expectedRow(
          { id: ids[0], user, documentId: document.id },
          {
            outcome: "findings",
            ...policyFieldsOf(policySet, collection.id),
            evaluatedDocumentCount: 1,
            counts: {
              errors: parsed.errors.length,
              warnings: parsed.warnings.length,
              systemFailures: 0,
              byCode,
            },
          }
        ),
      ]);
    });

    it.each([
      ["an unconfigured collection", true],
      ["no collection", false],
    ])(
      "records a document in %s as not evaluated without a policy",
      async (_name, inCollection) => {
        const fixture = await buildFixture({ text: CLEAN_MARKDOWN });
        const { user } = fixture;
        const document = inCollection
          ? fixture.document
          : await buildDraftDocument({
              teamId: user.teamId,
              userId: user.id,
              collectionId: null,
              text: CLEAN_MARKDOWN,
            });
        const policySet = policySetFor({
          [randomUUID()]: structurePolicy,
        });

        const { result, ids } = await auditedCall(async (dependencies) =>
          lint(await connect(user, policySet, dependencies), {
            id: document.id,
          })
        );

        expect(JSON.parse(firstText(result)).state).toBe("not_evaluated");
        expect(await auditRows(user.teamId)).toStrictEqual([
          expectedRow(
            { id: ids[0], user, documentId: document.id },
            { outcome: "not_evaluated", complete: false }
          ),
        ]);
      }
    );

    it("records a sentinel as failed without a policy", async () => {
      const { user, collection, document } = await buildFixture();
      const policySet = policySetFor({ [collection.id]: invalidPolicy });

      const { ids } = await auditedCall(async (dependencies) =>
        lint(await connect(user, policySet, dependencies), {
          id: document.id,
        })
      );

      expect(await auditRows(user.teamId)).toStrictEqual([
        expectedRow(
          { id: ids[0], user, documentId: document.id },
          {
            outcome: "failed",
            complete: false,
            counts: {
              errors: 0,
              warnings: 0,
              systemFailures: 1,
              byCode: { POLICY_CONFIGURATION_INVALID: 1 },
            },
          }
        ),
      ]);
    });

    it("records the same summary for a reader without collection access", async () => {
      const { reader, owner, collection, document } =
        await buildDocumentOnlyReader();
      const policySet = policySetFor({ [collection.id]: structurePolicy });

      const byReader = await auditedCall(async (dependencies) =>
        lint(await connect(reader, policySet, dependencies), {
          id: document.id,
        })
      );
      const byOwner = await auditedCall(async (dependencies) =>
        lint(await connect(owner, policySet, dependencies), {
          id: document.id,
        })
      );

      expect(JSON.parse(firstText(byReader.result)).policies).toEqual([]);
      const rows = await auditRows(owner.teamId);
      const readerRow = rows.find((row) => row.actorId === reader.id);
      const ownerRow = rows.find((row) => row.actorId === owner.id);
      expect(rows).toHaveLength(2);
      expect(readerRow).toStrictEqual(
        expectedRow(
          { id: byReader.ids[0], user: reader, documentId: document.id },
          {
            outcome: "findings",
            ...policyFieldsOf(policySet, collection.id),
            evaluatedDocumentCount: 1,
            counts: ownerRow?.data?.counts,
          }
        )
      );
      /**
       * Drops the fields that may differ between the two actors.
       *
       * @param row - the stored row.
       * @returns the comparable row.
       */
      const comparable = (row: typeof readerRow) => {
        const { id: _id, actorId: _actor, ip: _ip, data, ...columns } = row!;
        const {
          requestId: _request,
          durationMs: _duration,
          ...rest
        } = data as Record<string, unknown>;
        return { ...columns, data: rest };
      };
      expect(comparable(readerRow)).toStrictEqual(comparable(ownerRow));
      expect(ownerRow?.id).toBe(byOwner.ids[0]);
    });

    it("records the policy when collection readability cannot be established", async () => {
      const { user, collection, document } = await buildFixture({
        text: CLEAN_MARKDOWN,
      });
      const policySet = policySetFor({ [collection.id]: structurePolicy });
      vi.spyOn(Collection, "findByPk").mockRejectedValue(new Error("lookup"));

      const { result, ids } = await auditedCall(async (dependencies) =>
        lint(await connect(user, policySet, dependencies), {
          id: document.id,
        })
      );

      expect(JSON.parse(firstText(result)).scope).not.toHaveProperty(
        "collectionId"
      );
      expect(await auditRows(user.teamId)).toStrictEqual([
        expectedRow(
          { id: ids[0], user, documentId: document.id },
          {
            ...policyFieldsOf(policySet, collection.id),
            evaluatedDocumentCount: 1,
          }
        ),
      ]);
    });

    it("records each access role as its own actor", async () => {
      const { user, collection, document } = await buildFixture({
        text: CLEAN_MARKDOWN,
      });
      const admin = await buildAdmin({ teamId: user.teamId });
      const viewer = await buildViewer({ teamId: user.teamId });
      const guest = await buildGuestUser({ teamId: user.teamId });
      await UserMembership.create({
        documentId: document.id,
        userId: guest.id,
        createdById: user.id,
        permission: DocumentPermission.Read,
      });
      const policySet = policySetFor({ [collection.id]: structurePolicy });

      for (const actor of [admin, user, viewer, guest]) {
        const result = await lint(await connect(actor, policySet), {
          id: document.id,
        });
        expect(result.isError).toBeUndefined();
      }

      const rows = await auditRows(user.teamId);
      expect(rows.map((row) => row.actorId)).toEqual([
        admin.id,
        user.id,
        viewer.id,
        guest.id,
      ]);
      for (const [index, actor] of [admin, user, viewer, guest].entries()) {
        expect(rows[index]).toStrictEqual(
          expectedRow(
            { id: rows[index].id, user: actor, documentId: document.id },
            {
              ...policyFieldsOf(policySet, collection.id),
              evaluatedDocumentCount: 1,
            }
          )
        );
      }
    });

    /** A missing target linked from a table header and a nested notice. */
    const missingTarget = randomUUID();

    /**
     * Builds linked text to the missing target.
     *
     * @param text - the text.
     * @returns the text node.
     */
    const missingLink = (text: string) =>
      linkedText(text, `/doc/${missingTarget}`);

    it.each([
      [
        "a snapshot that times out",
        structurePolicy.rules,
        { text: CLEAN_MARKDOWN },
        {
          reader: {
            ...defaultLintDocumentReader,
            readDocumentSnapshot: async () => {
              throw new DeadlineFloorError();
            },
          },
        },
        {
          outcome: "failed",
          complete: false,
          counts: {
            errors: 0,
            warnings: 0,
            systemFailures: 1,
            byCode: { VALIDATION_TIMEOUT: 1 },
          },
        },
      ],
      [
        "a policy without document rules",
        [{ kind: "hierarchy_acyclic" }],
        { text: "# Title" },
        {},
        {},
      ],
      [
        "a rule kind that fails",
        [...structurePolicy.rules, { kind: "internal_links" }],
        {
          content: {
            type: "doc",
            content: [
              {
                type: "heading",
                attrs: { level: 1 },
                content: [{ type: "text", text: "Title" }],
              },
              {
                type: "table",
                content: [
                  {
                    type: "tr",
                    content: [
                      {
                        type: "th",
                        content: [paragraphOf(missingLink("head"))],
                      },
                    ],
                  },
                  {
                    type: "tr",
                    content: [
                      {
                        type: "td",
                        content: [
                          {
                            type: "container_notice",
                            attrs: { style: "info" },
                            content: [paragraphOf(missingLink("noted"))],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
        {},
        {
          outcome: "failed",
          complete: false,
          counts: {
            errors: 4,
            warnings: 0,
            systemFailures: 1,
            byCode: {
              HEADING_LEVEL_NOT_ALLOWED: 1,
              INTERNAL_LINK_TARGET_UNRESOLVED: 1,
              REQUIRED_SECTION_MISSING: 2,
              VALIDATION_RUNTIME_FAILED: 1,
            },
          },
        },
      ],
    ] as const)(
      "records the policy of %s",
      async (_name, rules, documentOverrides, dependencies, data) => {
        const user = await buildUser();
        const collection = await buildCollection({
          teamId: user.teamId,
          userId: user.id,
        });
        const document = await buildDocument({
          teamId: user.teamId,
          userId: user.id,
          collectionId: collection.id,
          ...(documentOverrides as Parameters<typeof buildDocument>[0]),
        });
        const policySet = policySetFor({
          [collection.id]: { activation: "read_only", rules },
        });

        const { ids } = await auditedCall(async (audit) =>
          lint(
            await connect(user, policySet, {
              ...(dependencies as AuditDependencies),
              ...audit,
            }),
            { id: document.id }
          )
        );

        expect(await auditRows(user.teamId)).toStrictEqual([
          expectedRow(
            { id: ids[0], user, documentId: document.id },
            { ...policyFieldsOf(policySet, collection.id), ...data }
          ),
        ]);
      }
    );

    it("measures the duration from the handler's first clock reading", async () => {
      const { user, collection, document } = await buildFixture({
        text: CLEAN_MARKDOWN,
      });
      const policySet = policySetFor({ [collection.id]: structurePolicy });
      let readings = 0;

      await lint(
        await connect(user, policySet, {
          clock: () => (readings++ === 0 ? 5000 : 5012),
        }),
        { id: document.id }
      );

      const rows = await auditRows(user.teamId);
      expect(rows).toHaveLength(1);
      expect(rows[0].data?.durationMs).toBe(12);
    });

    it("is retrievable by a team admin through events.list", async () => {
      const { user, collection, document } = await buildFixture({
        text: CLEAN_MARKDOWN,
      });
      const admin = await buildAdmin({ teamId: user.teamId });
      const policySet = policySetFor({ [collection.id]: structurePolicy });
      await lint(await connect(user, policySet), { id: document.id });
      const [summary] = await auditRows(user.teamId);

      const res = await server.post("/api/events.list", admin, {
        body: { auditWikiLint: true },
      });
      const body = await res.json();

      expect(res.status).toEqual(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({
        id: summary.id,
        name: "wikiLint.document",
      });
      expect(body.data[0].data).toStrictEqual(summary.data);
      expect(summary).toStrictEqual(
        expectedRow(
          { id: summary.id, user, documentId: document.id },
          {
            ...policyFieldsOf(policySet, collection.id),
            evaluatedDocumentCount: 1,
          }
        )
      );
    });

    it("keeps the first summary when the same invocation is written twice", async () => {
      const { user, collection, document } = await buildFixture({
        text: CLEAN_MARKDOWN,
      });
      const policySet = policySetFor({ [collection.id]: structurePolicy });
      const ids: string[] = [];
      const retrying: AuditEventWriter = async (row, statementTimeoutMs) => {
        ids.push(row.id);
        await insertAuditEvent(row, statementTimeoutMs);
        await insertAuditEvent(
          { ...row, data: { ...row.data, outcome: "findings" } },
          statementTimeoutMs
        );
      };

      await lint(await connect(user, policySet, { writeAudit: retrying }), {
        id: document.id,
      });

      expect(await auditRows(user.teamId)).toStrictEqual([
        expectedRow(
          { id: ids[0], user, documentId: document.id },
          {
            ...policyFieldsOf(policySet, collection.id),
            evaluatedDocumentCount: 1,
          }
        ),
      ]);
    });
  });

  describe("of lint_wiki", () => {
    it("records an incomplete collection run with its policy", async () => {
      const { user, collection } = await buildFixture();
      const [d1, d2, d3] = [1, 2, 3].map(
        (index) => `00000000-0000-4000-8000-0000000000d${index}`
      );
      const documentOf = (documentId: string, markdown: string) => ({
        documentId,
        content: { syntax: parseCanonicalMarkdown(markdown), links: null },
        parent: null,
      });
      const wikiReader: LintWikiReader = {
        authorizeLintCollection: async () => collection.id,
        readWikiSnapshot: async () => ({
          ok: true,
          snapshot: {
            collections: [
              {
                collectionId: collection.id,
                documents: [
                  documentOf(d1, "## Overview\n\nBody"),
                  documentOf(d2, CLEAN_MARKDOWN),
                  documentOf(d3, CLEAN_MARKDOWN),
                ],
                graph: null,
              },
            ],
            sentinelCollectionIds: [],
            targets: new Map(),
          },
        }),
      };
      const policySet = policySetFor({ [collection.id]: structurePolicy });

      const { result, ids } = await auditedCall(async (dependencies) => {
        // The deadline start, the post-snapshot expiry check, and the checks
        // before the first two units read 0 ms; the check before the third
        // unit finds less than the stop margin left.
        let readings = 0;
        return lintWikiCall(
          await connect(user, policySet, {
            ...dependencies,
            wikiReader,
            clock: () =>
              readings++ < 4
                ? 0
                : LINT_WIKI_DEADLINE_MS - LINT_WIKI_STOP_MARGIN_MS + 1,
          }),
          { collectionId: collection.id }
        );
      });

      expect(JSON.parse(firstText(result)).state).toBe("incomplete");
      expect(await auditRows(user.teamId)).toStrictEqual([
        expectedRow(
          {
            id: ids[0],
            user,
            name: "wikiLint.wiki",
            collectionId: collection.id,
          },
          {
            operation: "lint_wiki",
            outcome: "incomplete",
            complete: false,
            scopeKind: "collection",
            ...policyFieldsOf(policySet, collection.id),
            evaluatedDocumentCount: 2,
            counts: {
              errors: 1,
              warnings: 0,
              systemFailures: 1,
              byCode: { REQUIRED_SECTION_MISSING: 1, VALIDATION_TIMEOUT: 1 },
            },
          }
        ),
      ]);
    });

    it("records admission rejections of a collection and of the default scope", async () => {
      const { user, collection } = await buildFixture({
        text: CLEAN_MARKDOWN,
      });
      const policySet = policySetFor({ [collection.id]: structurePolicy });
      const holder = lintWikiAdmission.lease();
      expect(holder.acquire()).toBe(true);
      let scoped: { result: CallToolResult; ids: string[] };
      let unscoped: { result: CallToolResult; ids: string[] };
      try {
        scoped = await auditedCall(async (dependencies) =>
          lintWikiCall(await connect(user, policySet, dependencies), {
            collectionId: collection.id,
          })
        );
        unscoped = await auditedCall(async (dependencies) =>
          lintWikiCall(await connect(user, policySet, dependencies))
        );
      } finally {
        holder.release();
      }

      const rejected = {
        operation: "lint_wiki",
        outcome: "failed",
        complete: false,
        counts: {
          errors: 0,
          warnings: 0,
          systemFailures: 1,
          byCode: { VALIDATION_RESOURCE_LIMIT_EXCEEDED: 1 },
        },
      };
      expect(await auditRows(user.teamId)).toStrictEqual([
        expectedRow(
          {
            id: scoped.ids[0],
            user,
            name: "wikiLint.wiki",
            collectionId: collection.id,
          },
          {
            ...rejected,
            scopeKind: "collection",
            ...policyFieldsOf(policySet, collection.id),
          }
        ),
        expectedRow(
          { id: unscoped.ids[0], user, name: "wikiLint.wiki" },
          { ...rejected, scopeKind: "configured_collections" }
        ),
      ]);
    });

    it("records not-evaluated scopes without claiming admission", async () => {
      const { user, collection } = await buildFixture();
      const policySet = policySetFor({});
      const admit = vi.fn(() => true);
      vi.spyOn(lintWikiAdmission, "lease").mockImplementation(() => ({
        acquire: admit,
        release: () => undefined,
      }));

      const scoped = await auditedCall(async (dependencies) =>
        lintWikiCall(await connect(user, policySet, dependencies), {
          collectionId: collection.id,
        })
      );
      const unscoped = await auditedCall(async (dependencies) =>
        lintWikiCall(await connect(user, policySet, dependencies))
      );

      expect(admit).not.toHaveBeenCalled();
      const notEvaluated = {
        operation: "lint_wiki",
        outcome: "not_evaluated",
        complete: false,
      };
      expect(await auditRows(user.teamId)).toStrictEqual([
        expectedRow(
          {
            id: scoped.ids[0],
            user,
            name: "wikiLint.wiki",
            collectionId: collection.id,
          },
          { ...notEvaluated, scopeKind: "collection" }
        ),
        expectedRow(
          { id: unscoped.ids[0], user, name: "wikiLint.wiki" },
          { ...notEvaluated, scopeKind: "configured_collections" }
        ),
      ]);
    });

    it("holds the scan slot until a pending audit write settles", async () => {
      const { user, collection } = await buildFixture({
        text: CLEAN_MARKDOWN,
      });
      const policySet = policySetFor({ [collection.id]: structurePolicy });
      let entered: () => void = () => undefined;
      const writing = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const blocked: AuditEventWriter = async (row, statementTimeoutMs) => {
        entered();
        await held;
        await insertAuditEvent(row, statementTimeoutMs);
      };
      const client = await connect(user, policySet);

      const pending = lintWikiCall(
        await connect(user, policySet, { writeAudit: blocked }),
        { collectionId: collection.id }
      );
      let concurrent: CallToolResult;
      try {
        await writing;
        concurrent = await lintWikiCall(client, {
          collectionId: collection.id,
        });
      } finally {
        release();
      }
      const first = await pending;

      expect(JSON.parse(firstText(first)).state).toBe("complete");
      expect(JSON.parse(firstText(concurrent)).systemFailures).toEqual([
        createSystemFailure("VALIDATION_RESOURCE_LIMIT_EXCEEDED", {
          kind: "scope",
          scopeKind: "collection",
          collectionId: collection.id,
        }),
      ]);
      const next = await lintWikiCall(client, {
        collectionId: collection.id,
      });
      expect(JSON.parse(firstText(next)).state).toBe("complete");
      expect(
        (await auditRows(user.teamId)).map((row) => row.data?.outcome)
      ).toEqual(["failed", "clean", "clean"]);
    });
  });

  it("records nothing for tool-execution errors", async () => {
    const { user, collection, document } = await buildFixture();
    const policySet = policySetFor({ [collection.id]: structurePolicy });
    const client = await connect(user, policySet);
    const eventCount = await Event.count({ where: { teamId: user.teamId } });
    /**
     * Returns a clock whose readings after the first are near the deadline,
     * so the first lookup batch is refused below the floor.
     *
     * @param deadlineMs - the deadline.
     * @returns the clock.
     */
    const lateClock = (deadlineMs: number) => {
      let readings = 0;
      return () => (readings++ === 0 ? 0 : deadlineMs - 50);
    };

    const results = [
      await client.callTool({ name: "lint_document", arguments: { id: 1 } }),
      await client.callTool({
        name: "lint_wiki",
        arguments: { collectionId: 1 },
      }),
      await lint(client, { id: randomUUID() }),
      await lintWikiCall(client, { collectionId: randomUUID() }),
      await lint(await connect(user, policySet, { clock: lateClock(9000) }), {
        id: document.id,
      }),
      await lint(
        await connect(user, policySet, { clock: () => Number.MAX_VALUE }),
        { id: document.id }
      ),
      await lintWikiCall(
        await connect(user, policySet, {
          clock: lateClock(LINT_WIKI_DEADLINE_MS),
        }),
        { collectionId: collection.id }
      ),
    ];
    vi.spyOn(Document, "findByPk").mockRejectedValueOnce(new Error("lookup"));
    results.push(await lint(client, { id: document.id }));
    vi.spyOn(Collection, "findByPk").mockRejectedValueOnce(new Error("lookup"));
    results.push(await lintWikiCall(client, { collectionId: collection.id }));

    expect(results.map((result) => result.isError)).toEqual(
      results.map(() => true)
    );
    await expect(auditRows(user.teamId)).resolves.toEqual([]);
    await expect(Event.count({ where: { teamId: user.teamId } })).resolves.toBe(
      eventCount
    );
  });

  describe("with Finding detail", () => {
    const HEADING = "Zebra heading marker";
    const FIELD = "Quokka field marker";
    const LOGGER_METHODS = [
      "debug",
      "info",
      "silly",
      "warn",
      "error",
      "fatal",
    ] as const;

    /**
     * Serializes the arguments of one Logger call. An Error, at any depth, is
     * serialized by its name and message, which `JSON.stringify` drops.
     *
     * @param args - the call arguments.
     * @returns the serialized arguments.
     */
    const serializeCall = (args: unknown[]) =>
      args
        .map((arg) =>
          typeof arg === "string"
            ? arg
            : (JSON.stringify(arg, (_key, value: unknown) =>
                value instanceof Error
                  ? { name: value.name, message: value.message }
                  : value
              ) ?? String(arg))
        )
        .join(" ");

    it("records identical summaries with and without detail, and logs no detail value", async () => {
      const { reader, owner, collection, document } =
        await buildDocumentOnlyReader();
      const index = await buildDocument({
        teamId: owner.teamId,
        userId: owner.id,
        collectionId: collection.id,
        text: "Index",
      });
      const policySet = policySetFor({
        [collection.id]: {
          activation: "read_only",
          rules: [
            { kind: "required_sections", headingLevel: 2, headings: [HEADING] },
            {
              kind: "required_metadata_fields",
              metadataSection: { heading: "Metadata", headingLevel: 2 },
              fields: [FIELD],
            },
            {
              kind: "global_index_links",
              surfaceDocumentId: document.id,
              globalIndexDocumentIds: [index.id],
            },
          ],
        },
      });
      const spies = LOGGER_METHODS.map((method) => vi.spyOn(Logger, method));

      const byOwner = await auditedCall(async (dependencies) =>
        lint(await connect(owner, policySet, dependencies), {
          id: document.id,
        })
      );
      const byReader = await auditedCall(async (dependencies) =>
        lint(await connect(reader, policySet, dependencies), {
          id: document.id,
        })
      );
      const wiki = await auditedCall(async (dependencies) =>
        lintWikiCall(await connect(owner, policySet, dependencies), {
          collectionId: collection.id,
        })
      );
      // A failed audit write is logged, without any detail value either.
      await lintWikiCall(
        await connect(owner, policySet, {
          writeAudit: async () => {
            throw new Error("audit write failed");
          },
        }),
        { collectionId: collection.id }
      );

      const named = [
        { kind: "metadata_field", field: FIELD },
        { kind: "section", heading: HEADING, headingLevel: 2 },
      ];
      const ownerErrors = JSON.parse(firstText(byOwner.result)).errors;
      expect(ownerErrors.map((finding: Finding) => finding.detail)).toEqual(
        named
      );
      expect(
        JSON.parse(firstText(byReader.result)).errors.map(
          ({ detail: _detail, ...finding }: Finding) => finding
        )
      ).toEqual(
        ownerErrors.map(({ detail: _detail, ...finding }: Finding) => finding)
      );
      expect(firstText(byReader.result)).not.toContain('"detail"');
      expect(JSON.parse(firstText(wiki.result)).errors).toContainEqual(
        expect.objectContaining({
          code: "GLOBAL_INDEX_LINK_MISSING",
          detail: {
            kind: "global_index",
            documentId: index.id,
            urlId: index.urlId,
          },
        })
      );

      const rows = await auditRows(owner.teamId);
      const ownerRow = rows.find((row) => row.id === byOwner.ids[0]);
      const readerRow = rows.find((row) => row.id === byReader.ids[0]);
      const counts = {
        errors: 2,
        warnings: 0,
        systemFailures: 0,
        byCode: {
          REQUIRED_METADATA_FIELD_MISSING: 1,
          REQUIRED_SECTION_MISSING: 1,
        },
      };
      const data = {
        outcome: "findings",
        ...policyFieldsOf(policySet, collection.id),
        evaluatedDocumentCount: 1,
        counts,
      };
      expect(ownerRow).toStrictEqual(
        expectedRow(
          { id: byOwner.ids[0], user: owner, documentId: document.id },
          data
        )
      );
      expect(readerRow).toStrictEqual(
        expectedRow(
          { id: byReader.ids[0], user: reader, documentId: document.id },
          data
        )
      );
      /**
       * Drops the per-invocation fields of a stored summary.
       *
       * @param row - the stored row.
       * @returns the remaining summary data.
       */
      const payload = (row: typeof ownerRow) => {
        const {
          requestId: _request,
          durationMs: _duration,
          ...rest
        } = (row?.data ?? {}) as Record<string, unknown>;
        return rest;
      };
      expect(payload(readerRow)).toStrictEqual(payload(ownerRow));

      const values = [HEADING, FIELD, index.id, index.urlId];
      const stored = JSON.stringify(rows);
      expect(stored).not.toContain('"detail"');
      for (const value of values) {
        expect(stored).not.toContain(value);
      }
      expect(spies[LOGGER_METHODS.indexOf("warn")]).toHaveBeenCalledWith(
        "Wiki lint audit write failed",
        expect.anything()
      );
      for (const spy of spies) {
        for (const call of spy.mock.calls) {
          const line = serializeCall(call);
          for (const value of values) {
            expect(line).not.toContain(value);
          }
        }
      }
    });
  });

  describe("when the audit write fails", () => {
    /**
     * Returns the audit failure diagnostics logged so far.
     *
     * @param warn - the `Logger.warn` spy.
     * @returns the logged extras.
     */
    const diagnostics = (warn: { mock: { calls: unknown[][] } }) =>
      warn.mock.calls
        .filter(([message]) => message === "Wiki lint audit write failed")
        .map(([, extra]) => extra);

    it.each([
      [
        "rejects",
        "error",
        (async () => {
          throw new Error("raw SQL detail");
        }) as AuditEventWriter,
      ],
      [
        "never settles",
        "timeout",
        (() => {
          // Fake only the timers started from here on, then expire the bound.
          vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
          setImmediate(() => vi.advanceTimersByTime(AUDIT_WRITE_BOUND_MS));
          return new Promise<void>(() => undefined);
        }) as AuditEventWriter,
      ],
    ])(
      "returns the audited result and logs once when the writer %s",
      async (_name, reason, writeAudit) => {
        const { user, collection, document } = await buildFixture({
          text: "# Title",
        });
        const policySet = policySetFor({ [collection.id]: structurePolicy });
        const audited = await lintDocumentTool(
          { id: document.id },
          contextOf(user),
          { policySet }
        );
        const warn = vi.spyOn(Logger, "warn");
        const context = contextOf(user);

        const failed = await lintDocumentTool({ id: document.id }, context, {
          policySet,
          writeAudit,
        });
        vi.useRealTimers();

        expect(JSON.stringify(failed)).toBe(JSON.stringify(audited));
        expect(diagnostics(warn)).toStrictEqual([
          {
            requestId: context.authInfo.extra.requestId,
            invocationId: expect.stringMatching(
              /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
            ),
            reason,
          },
        ]);
        await expect(auditRows(user.teamId)).resolves.toHaveLength(1);
      }
    );
  });

  it("never reaches the global Event queue", async () => {
    const { user, collection, document } = await buildFixture({
      text: CLEAN_MARKDOWN,
    });
    await buildWebhookSubscription({
      teamId: user.teamId,
      createdById: user.id,
      events: ["*"],
    });
    const policySet = policySetFor({ [collection.id]: structurePolicy });
    const client = await connect(user, policySet);
    const add = vi.spyOn(globalEventQueue(), "add");

    await lint(client, { id: document.id });
    await lintWikiCall(client, { collectionId: collection.id });

    expect(
      (await auditRows(user.teamId)).map((row) => row.name).sort()
    ).toEqual(["wikiLint.document", "wikiLint.wiki"]);
    expect(
      add.mock.calls.filter(([event]) =>
        String((event as { name?: unknown }).name).startsWith("wikiLint.")
      )
    ).toEqual([]);
  });
});
