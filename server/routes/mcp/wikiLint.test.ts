import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CollectionPermission, DocumentPermission } from "@shared/types";
import env from "@server/env";
import Logger from "@server/logging/Logger";
import {
  Collection,
  Document,
  Event,
  User,
  UserMembership,
} from "@server/models";
import { sequelize } from "@server/storage/database";
import {
  buildAdmin,
  buildApiKey,
  buildCollection,
  buildDocument,
  buildOAuthAuthentication,
  buildUser,
} from "@server/test/factories";
import {
  mcpHeaders,
  mcpRequest,
  parseMcpResponse,
} from "@server/test/McpHelper";
import { getTestServer } from "@server/test/support";
import { lintDocumentTool, lintWikiTool } from "@server/tools/wikiLint";
import type * as AuditEvents from "@server/wikiLint/adapters/auditEvents";
import { WIKI_LINT_AUDIT_EVENTS } from "@server/wikiLint/adapters/auditEvents";
import type * as PolicyConfig from "@server/wikiLint/adapters/policyConfig";
import {
  initializePolicyConfiguration,
  policySetFromEnvironment,
} from "@server/wikiLint/adapters/policyConfig";
import type { ScanLease } from "@server/wikiLint/application/admission";
import { lintWikiAdmission } from "@server/wikiLint/application/admission";
import { DeadlineFloorError } from "@server/wikiLint/application/deadline";
import { defaultLintDocumentReader } from "@server/wikiLint/application/lintDocument";
import { defaultLintWikiReader } from "@server/wikiLint/application/lintWiki";
import type {
  Finding,
  ReadOnlyResult,
  TextLocation,
} from "@server/wikiLint/core/contracts";
import type { PolicySet } from "@server/wikiLint/core/policySet";
import { policyIdentity } from "@server/wikiLint/core/policySet";
import {
  UUID_PATTERN,
  getIssueDefinition,
} from "@server/wikiLint/core/registry";

/** What the two replaced seams serve; reset after each test. */
const state = vi.hoisted(() => ({
  /** The set the last `restart` loaded; the real getter serves when unset. */
  policySet: undefined as PolicySet | undefined,
  /** Whether the production audit writer rejects. */
  auditFails: false,
}));

// A restart is the only way an operator changes policy (AD-19); the worker
// getter serves the set the last restart loaded, else the real one.
vi.mock("@server/wikiLint/adapters/policyConfig", async (importOriginal) => {
  const actual = await importOriginal<typeof PolicyConfig>();
  return {
    ...actual,
    getPolicySet: () => state.policySet ?? actual.getPolicySet(),
  };
});

// The production audit writer, failing only while a test arms it.
vi.mock("@server/wikiLint/adapters/auditEvents", async (importOriginal) => {
  const actual = await importOriginal<typeof AuditEvents>();
  return {
    ...actual,
    insertAuditEvent: (...args: Parameters<typeof actual.insertAuditEvent>) =>
      state.auditFails
        ? Promise.reject(new Error("The armed audit write failed"))
        : actual.insertAuditEvent(...args),
  };
});

const server = getTestServer();

const OPERATION_FAILED = "The operation could not be completed";

/** The `isError` result of a denied or missing target. */
const AUTHORIZATION_ERROR = {
  content: [{ type: "text", text: "Authorization error" }],
  isError: true,
};

const LINT_TOOLS = ["lint_document", "lint_wiki"];

/** The three route scopes `lint_wiki` needs. */
const WIKI_ROUTES = [
  "/api/documents.list",
  "/api/collections.list",
  "/api/collections.documents",
];

/** Every baseline tool. */
const ALL_TOOLS = [
  "create_attachment",
  "list_users",
  "list_collections",
  "create_collection",
  "update_collection",
  "delete_collection",
  "list_comments",
  "create_comment",
  "update_comment",
  "delete_comment",
  "list_documents",
  "list_collection_documents",
  "create_document",
  "move_document",
  "update_document",
  "delete_document",
  "restore_document",
  "list_templates",
  "fetch",
];

/** The baseline tools of a `read` token. */
const READ_TOOLS = [
  "list_users",
  "list_collections",
  "list_comments",
  "list_documents",
  "list_collection_documents",
  "list_templates",
  "fetch",
];

const METADATA_SECTION = { heading: "Document metadata", headingLevel: 2 };

/** Two required visible metadata fields and their formats. */
const metadataRules = [
  {
    kind: "required_metadata_fields",
    metadataSection: METADATA_SECTION,
    fields: ["Status", "Last verified"],
  },
  {
    kind: "metadata_field_formats",
    metadataSection: METADATA_SECTION,
    fields: [
      { name: "Status", format: "one_of", values: ["Active", "Draft"] },
      { name: "Last verified", format: "iso_date" },
    ],
  },
];

/** Every hierarchy rule kind. */
const hierarchyRules = [
  { kind: "parent_document_resolved" },
  { kind: "hierarchy_acyclic" },
  { kind: "published_documents_in_structure" },
  { kind: "parent_collection_consistent" },
];

/** Metadata, a discouraged blockquote (a Warning), and internal links. */
const documentPolicy = {
  activation: "read_only",
  rules: [
    ...metadataRules,
    { kind: "discouraged_markdown_structures", structures: ["blockquote"] },
    { kind: "internal_links" },
  ],
};

/** An entry that fails validation, so it becomes a sentinel. */
const sentinelPolicy = { activation: "read_only", rules: [] };

/**
 * Builds a policy enabling every check: the document rules, every hierarchy
 * rule, and one global index.
 *
 * @param surfaceDocumentId - the surface.
 * @param indexDocumentId - the global index.
 * @returns the policy entry.
 */
const fullPolicy = (surfaceDocumentId: string, indexDocumentId: string) => ({
  activation: "read_only",
  rules: [
    ...documentPolicy.rules,
    ...hierarchyRules,
    {
      kind: "global_index_links",
      surfaceDocumentId,
      globalIndexDocumentIds: [indexDocumentId],
    },
  ],
});

/** Conforming visible metadata, in canonical Markdown. */
const METADATA =
  "## Document metadata\n\n* Status: Active\n* Last verified: 2026-09-20";

/** Visible metadata with an invalid date at line 4, column 18. */
const INVALID_DATE = METADATA.replace("2026-09-20", "2026-13-01");

/** A conforming document. */
const VALID = `${METADATA}\n\n## Body\n\nText`;

/** A link to a document that never existed. */
const MISSING_LINK = "[gone](/doc/missing-abcdefghij)";

interface ListedTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: {
    type: string;
    properties?: Record<string, { type?: string }>;
    required?: string[];
  };
  annotations?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: CallToolResult & { tools?: ListedTool[] };
  error?: unknown;
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-lint-mcp-"));
let restarts = 0;
let lease: ScanLease | undefined;

/**
 * Models an operator restart: runs the real master loader over a policy file,
 * decodes the exported bytes as a worker does, and serves the result.
 *
 * @param collections - the policy entry of each collection, or null for a
 *   restart without a policy file.
 * @returns the loaded policy set.
 */
function restart(collections: Record<string, unknown> | null): PolicySet {
  const masterEnv: NodeJS.ProcessEnv = {};
  if (collections !== null) {
    const file = path.join(tempDir, `policy-${restarts++}.json`);
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, collections }));
    masterEnv.WIKI_LINT_CONFIG_PATH = file;
  }
  initializePolicyConfiguration(masterEnv);
  state.policySet = policySetFromEnvironment(masterEnv);
  return state.policySet;
}

/**
 * Returns the policy identity of a collection in a loaded set.
 *
 * @param set - the policy set.
 * @param collectionId - the collection.
 * @returns the identity.
 */
function identityOf(set: PolicySet, collectionId: string) {
  const entry = set.entries.find((item) => item.collectionId === collectionId);
  if (!entry) {
    throw new Error("Unknown test collection");
  }
  return policyIdentity(entry);
}

/**
 * Builds a real OAuth access token.
 *
 * @param user - the user.
 * @param scope - the granted scopes.
 * @returns the bearer credential.
 */
async function oauthToken(user: User, scope: string[]) {
  return (await buildOAuthAuthentication({ user, scope })).accessToken!;
}

/**
 * Builds a real API key.
 *
 * @param user - the user.
 * @param scope - the granted scopes; null grants `*`.
 * @returns the bearer credential.
 */
async function apiKeyToken(user: User, scope: string[] | null = null) {
  return (await buildApiKey({ userId: user.id, scope })).value!;
}

/**
 * Sends one JSON-RPC request to `/mcp/`.
 *
 * @param token - the bearer credential.
 * @param method - the JSON-RPC method.
 * @param params - the params.
 * @param headers - extra HTTP headers.
 * @returns the parsed JSON-RPC response.
 */
async function rpc(
  token: string,
  method: string,
  params?: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<JsonRpcResponse> {
  const { body } = mcpRequest(method, params);
  const res = await server.post("/mcp/", {
    headers: { ...mcpHeaders(token), ...headers },
    body,
  });
  expect(res.status).toBe(200);
  return (await parseMcpResponse(res)) as unknown as JsonRpcResponse;
}

/**
 * Lists the tools a token discovers.
 *
 * @param token - the bearer credential.
 * @returns the tools.
 */
async function listTools(token: string): Promise<ListedTool[]> {
  const response = await rpc(token, "tools/list");
  expect(response.error).toBeUndefined();
  return response.result?.tools ?? [];
}

/**
 * Calls a tool over `/mcp/`.
 *
 * @param token - the bearer credential.
 * @param name - the tool.
 * @param args - the arguments.
 * @param headers - extra HTTP headers.
 * @returns the parsed JSON-RPC response.
 */
const callTool = (
  token: string,
  name: string,
  args: Record<string, unknown> = {},
  headers?: Record<string, string>
) => rpc(token, "tools/call", { name, arguments: args }, headers);

/**
 * Returns the text of a content block.
 *
 * @param result - a tool result.
 * @param index - the block index.
 * @returns the text.
 */
function blockText(result: CallToolResult | undefined, index = 0): string {
  const block = result?.content[index];
  if (block?.type !== "text") {
    throw new Error("Expected a text block");
  }
  return block.text;
}

/**
 * Checks the result algebra and the registry severities of a lint result.
 *
 * @param result - the lint result.
 */
function expectAlgebra(result: ReadOnlyResult) {
  expect(result.errors).toEqual(expect.any(Array));
  expect(result.warnings).toEqual(expect.any(Array));
  expect(result.systemFailures).toEqual(expect.any(Array));
  expect(result.complete).toBe(result.state === "complete");
  expect(result.clean).toBe(
    result.state === "complete" && result.errors.length === 0
  );
  expect("reason" in result).toBe(result.state === "not_evaluated");
  if (result.state === "not_evaluated") {
    expect(result.reason).toBe("POLICY_NOT_CONFIGURED");
  }
  for (const [findings, severity] of [
    [result.errors, "error"],
    [result.warnings, "warning"],
  ] as const) {
    for (const finding of findings) {
      expect(Object.keys(finding).sort()).toEqual([
        "code",
        "location",
        "message",
        "severity",
      ]);
      expect(finding.severity).toBe(severity);
      expect(getIssueDefinition(finding.code)?.class).toBe(severity);
    }
  }
  for (const failure of result.systemFailures) {
    expect(Object.keys(failure).sort()).toEqual([
      "code",
      "location",
      "message",
    ]);
    expect(getIssueDefinition(failure.code)?.class).toBe("system_failure");
  }
}

/**
 * Returns the text of a modeled lint result: one JSON text block, without a
 * JSON-RPC error or `isError`, satisfying the result algebra.
 *
 * @param response - the JSON-RPC response.
 * @returns the text.
 */
function modeledText(response: JsonRpcResponse): string {
  expect(response.error).toBeUndefined();
  expect(response.result?.isError).toBeUndefined();
  expect(response.result?.content).toHaveLength(1);
  const text = blockText(response.result);
  expectAlgebra(JSON.parse(text));
  return text;
}

/**
 * Calls a lint tool over `/mcp/` and parses its modeled result.
 *
 * @param token - the bearer credential.
 * @param name - the lint tool.
 * @param args - the arguments.
 * @returns the parsed result.
 */
async function lintResult(
  token: string,
  name: string,
  args: Record<string, unknown> = {}
): Promise<ReadOnlyResult> {
  return JSON.parse(modeledText(await callTool(token, name, args)));
}

/**
 * Calls a lint handler directly, without audit, for an actor and a loaded
 * set.
 *
 * @param user - the actor.
 * @param name - the lint tool.
 * @param args - the arguments.
 * @param policySet - the loaded set.
 * @returns the text of the first content block.
 */
async function handlerText(
  user: User,
  name: string,
  args: { id?: string; collectionId?: string },
  policySet: PolicySet
) {
  const context = {
    authInfo: { token: "", clientId: "", scopes: [], extra: { user } },
  };
  const dependencies = { policySet, writeAudit: async () => undefined };
  const result =
    name === "lint_document"
      ? await lintDocumentTool({ id: args.id ?? "" }, context, dependencies)
      : await lintWikiTool(
          { collectionId: args.collectionId },
          context,
          dependencies
        );
  return blockText(result);
}

/**
 * Builds a collection with documents in it.
 *
 * @param user - the author.
 * @param texts - the Markdown of each document.
 * @param overrides - collection attributes.
 * @returns the collection and its documents, in order.
 */
async function buildCollectionOf(
  user: User,
  texts: string[],
  overrides: Parameters<typeof buildCollection>[0] = {}
) {
  const collection = await buildCollection({
    teamId: user.teamId,
    userId: user.id,
    ...overrides,
  });
  const documents: Document[] = [];
  for (const text of texts) {
    documents.push(
      await buildDocument({
        teamId: user.teamId,
        userId: user.id,
        collectionId: collection.id,
        text,
      })
    );
  }
  return { collection, documents };
}

/**
 * Creates a document through MCP `create_document`.
 *
 * @param token - the bearer credential.
 * @param collectionId - the collection.
 * @param text - the Markdown.
 * @returns the document ID.
 */
async function createDocument(
  token: string,
  collectionId: string,
  text: string
): Promise<string> {
  const response = await callTool(token, "create_document", {
    title: "Created through MCP",
    text,
    collectionId,
  });
  expect(response.result?.isError).toBeUndefined();
  return JSON.parse(blockText(response.result)).id;
}

/**
 * Fetches a document's Markdown through MCP `fetch`.
 *
 * @param token - the bearer credential.
 * @param id - the document.
 * @returns the Markdown, the second text block.
 */
async function fetchMarkdown(token: string, id: string): Promise<string> {
  const response = await callTool(token, "fetch", {
    resource: "document",
    id,
  });
  expect(response.result?.isError).toBeUndefined();
  return blockText(response.result, 1);
}

/**
 * Checks that every issue is located in the linted scope.
 *
 * @param result - the lint result.
 * @param documentIds - the documents in scope.
 * @param collectionIds - the collections in scope.
 */
function expectLocatedIn(
  result: ReadOnlyResult,
  documentIds: string[],
  collectionIds: string[] = []
) {
  for (const { location } of [
    ...result.errors,
    ...result.warnings,
    ...result.systemFailures,
  ]) {
    if (location.documentId !== undefined) {
      expect(documentIds).toContain(location.documentId);
    }
    if (location.kind === "scope" && location.collectionId !== undefined) {
      expect(collectionIds).toContain(location.collectionId);
    }
  }
}

/**
 * Reads the stored state of every document of a team.
 *
 * @param teamId - the team.
 * @returns the serialized state of each document, by ID.
 */
async function documentStates(teamId: string) {
  const documents = await Document.unscoped().findAll({
    attributes: [
      "id",
      "title",
      "content",
      "collectionId",
      "parentDocumentId",
      "revisionCount",
      "updatedAt",
      "publishedAt",
      "deletedAt",
    ],
    where: { teamId },
    paranoid: false,
  });
  return new Map(
    documents.map((document) => [
      document.id,
      JSON.stringify([
        document.title,
        document.content,
        document.collectionId,
        document.parentDocumentId,
        document.revisionCount,
        document.updatedAt,
        document.publishedAt,
        document.deletedAt,
      ]),
    ])
  );
}

/**
 * Counts the stored Wiki lint audit summaries of a team.
 *
 * @param teamId - the team.
 * @returns the count.
 */
const auditCount = (teamId: string) =>
  Event.count({ where: { teamId, name: [...WIKI_LINT_AUDIT_EVENTS] } });

/**
 * Lists the Wiki lint audit summaries of the user's team, oldest first,
 * through `/api/events.list`.
 *
 * @param user - the requesting user.
 * @returns the response status and body text.
 */
async function listAuditSummaries(user: User) {
  const res = await server.post("/api/events.list", user, {
    body: { auditWikiLint: true, sort: "createdAt", direction: "ASC" },
  });
  return { status: res.status, text: await res.text() };
}

afterEach(() => {
  state.policySet = undefined;
  state.auditFails = false;
  vi.restoreAllMocks();
  lease?.release();
  lease = undefined;
});

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("registration and discovery", () => {
  it("lists both tools with the AD-12 input schemas and read-only annotations", async () => {
    const user = await buildUser();

    const tools = await listTools(await apiKeyToken(user));

    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    const lintDocument = byName.get("lint_document");
    const lintWiki = byName.get("lint_wiki");
    expect(lintDocument?.inputSchema).toMatchObject({
      type: "object",
      required: ["id"],
    });
    expect(Object.keys(lintDocument?.inputSchema.properties ?? {})).toEqual([
      "id",
    ]);
    expect(lintDocument?.inputSchema.properties?.id.type).toBe("string");
    expect(lintWiki?.inputSchema.type).toBe("object");
    expect(lintWiki?.inputSchema.required).toBeUndefined();
    expect(Object.keys(lintWiki?.inputSchema.properties ?? {})).toEqual([
      "collectionId",
    ]);
    expect(lintWiki?.inputSchema.properties?.collectionId.type).toBe("string");
    const hostname = new URL(env.URL).hostname.toLowerCase();
    for (const tool of [lintDocument, lintWiki]) {
      expect(tool?.annotations).toStrictEqual({
        readOnlyHint: true,
        idempotentHint: true,
      });
      expect(tool?.annotations).toStrictEqual(
        byName.get("list_documents")?.annotations
      );
      for (const text of [tool?.title, tool?.description]) {
        expect(text).toEqual(expect.any(String));
        expect(text).not.toMatch(
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
        );
        expect(text).not.toMatch(/https?:\/\//i);
        expect(text?.toLowerCase()).not.toContain(hostname);
      }
    }
  });

  const discovery: [string, string[] | null, string[]][] = [
    ["*", null, [...ALL_TOOLS, ...LINT_TOOLS]],
    ["read", ["read"], [...READ_TOOLS, ...LINT_TOOLS]],
    ["write", ["write"], [...ALL_TOOLS, ...LINT_TOOLS]],
    [
      "documents:read and collections:read",
      ["documents:read", "collections:read"],
      [
        "list_documents",
        "list_collections",
        "list_collection_documents",
        "fetch",
        ...LINT_TOOLS,
      ],
    ],
    [
      "documents:read",
      ["documents:read"],
      ["list_documents", "fetch", "lint_document"],
    ],
    [
      "/api/documents.info",
      ["/api/documents.info"],
      ["fetch", "lint_document"],
    ],
    [
      "three-route",
      WIKI_ROUTES,
      [
        "list_documents",
        "list_collections",
        "list_collection_documents",
        "lint_wiki",
      ],
    ],
    [
      "create",
      ["create"],
      [
        "create_attachment",
        "create_collection",
        "create_comment",
        "create_document",
      ],
    ],
    [
      "collections:read",
      ["collections:read"],
      ["list_collections", "list_collection_documents", "fetch"],
    ],
    ["documents:create", ["documents:create"], ["create_document"]],
    [
      "/api/documents.list and /api/collections.list",
      ["/api/documents.list", "/api/collections.list"],
      ["list_documents", "list_collections"],
    ],
    [
      "/api/documents.list and /api/collections.documents",
      ["/api/documents.list", "/api/collections.documents"],
      ["list_documents", "list_collection_documents"],
    ],
    [
      "/api/collections.list and /api/collections.documents",
      ["/api/collections.list", "/api/collections.documents"],
      ["list_collections", "list_collection_documents"],
    ],
  ];

  it.each(discovery)(
    "lists exactly the tools of a %s token",
    async (_name, scope, expected) => {
      const user = await buildUser();
      const tokens =
        scope === null
          ? [await apiKeyToken(user)]
          : [await oauthToken(user, scope), await apiKeyToken(user, scope)];

      for (const token of tokens) {
        const names = (await listTools(token)).map((tool) => tool.name);
        expect(names.sort()).toEqual([...expected].sort());
        for (const name of LINT_TOOLS.filter(
          (tool) => !expected.includes(tool)
        )) {
          const response = await callTool(token, name, { id: randomUUID() });
          expect(response.result?.isError).toBe(true);
          expect(blockText(response.result)).not.toContain('"state"');
        }
      }
    }
  );

  it("lets a route-scoped token call its one lint tool with no other input", async () => {
    const user = await buildUser();
    const {
      collection,
      documents: [document],
    } = await buildCollectionOf(user, [VALID]);
    restart({ [collection.id]: documentPolicy });

    await expect(
      lintResult(
        await oauthToken(user, ["/api/documents.info"]),
        "lint_document",
        { id: document.id }
      )
    ).resolves.toMatchObject({ state: "complete", clean: true });
    await expect(
      lintResult(await oauthToken(user, WIKI_ROUTES), "lint_wiki", {
        collectionId: collection.id,
      })
    ).resolves.toMatchObject({ state: "complete", clean: true });
  });
});

describe("results", () => {
  /** An unknown status, a missing date, and a link to a missing document. */
  const MANY_ERRORS = `## Document metadata\n\n* Status: Unknown\n\n## Body\n\nSee ${MISSING_LINK} here.`;

  /**
   * Builds the expected Error located in a document's text.
   *
   * @param code - the code.
   * @param documentId - the document.
   * @param line - the one-based line.
   * @param column - the one-based column.
   * @param segments - the structural path.
   * @returns the expected Finding.
   */
  const textError = (
    code: string,
    documentId: string,
    line: number,
    column: number,
    segments: number[]
  ) => ({
    code,
    severity: "error",
    message: expect.any(String),
    location: { kind: "text", documentId, line, column, path: segments },
  });

  it("is clean and complete for a conforming document and collection, completing every enabled check", async () => {
    const user = await buildUser();
    const {
      collection,
      documents: [index],
    } = await buildCollectionOf(user, [VALID]);
    const surface = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
      text: `${VALID}\n\nSee [index](/doc/${index.id})`,
    });
    const set = restart({ [collection.id]: fullPolicy(surface.id, index.id) });
    const token = await oauthToken(user, ["read"]);

    const document = await lintResult(token, "lint_document", {
      id: surface.id,
    });
    const wiki = await lintResult(token, "lint_wiki", {
      collectionId: collection.id,
    });

    const clean = {
      state: "complete",
      complete: true,
      clean: true,
      errors: [],
      warnings: [],
      systemFailures: [],
      policies: [identityOf(set, collection.id)],
    };
    expect(document).toEqual({
      ...clean,
      scope: {
        kind: "document",
        documentId: surface.id,
        collectionId: collection.id,
        evaluatedDocumentCount: 1,
        evaluatedLinkCount: 1,
      },
    });
    expect(wiki).toEqual({
      ...clean,
      scope: {
        kind: "collection",
        collectionId: collection.id,
        evaluatedDocumentCount: 2,
        evaluatedLinkCount: 1,
        completedChecks: ["documents", "hierarchy", "global_index"],
      },
    });
  });

  it("reports Errors with stable codes, located in scope, in AD-4 order", async () => {
    const user = await buildUser();
    const {
      collection,
      documents: [first, second],
    } = await buildCollectionOf(user, [
      MANY_ERRORS,
      `${INVALID_DATE}\n\n## Body\n\nText`,
    ]);
    const set = restart({ [collection.id]: documentPolicy });
    const token = await oauthToken(user, ["read"]);

    const document = await lintResult(token, "lint_document", {
      id: first.id,
    });
    const wiki = await lintResult(token, "lint_wiki", {
      collectionId: collection.id,
    });

    const firstErrors = [
      textError("METADATA_FIELD_FORMAT_INVALID", first.id, 3, 11, [1, 0]),
      textError("INTERNAL_LINK_TARGET_UNRESOLVED", first.id, 7, 5, [3]),
      {
        code: "REQUIRED_METADATA_FIELD_MISSING",
        severity: "error",
        message: expect.any(String),
        location: { kind: "document", documentId: first.id },
      },
    ];
    const secondErrors = [
      textError("METADATA_FIELD_FORMAT_INVALID", second.id, 4, 18, [1, 1]),
    ];
    expect(document).toEqual({
      state: "complete",
      complete: true,
      clean: false,
      errors: firstErrors,
      warnings: [],
      systemFailures: [],
      scope: {
        kind: "document",
        documentId: first.id,
        collectionId: collection.id,
        evaluatedDocumentCount: 1,
        evaluatedLinkCount: 1,
      },
      policies: [identityOf(set, collection.id)],
    });
    expect(wiki).toEqual({
      state: "complete",
      complete: true,
      clean: false,
      errors:
        first.id < second.id
          ? [...firstErrors, ...secondErrors]
          : [...secondErrors, ...firstErrors],
      warnings: [],
      systemFailures: [],
      scope: {
        kind: "collection",
        collectionId: collection.id,
        evaluatedDocumentCount: 2,
        evaluatedLinkCount: 1,
        completedChecks: ["documents"],
      },
      policies: [identityOf(set, collection.id)],
    });
  });

  it("stays clean with only a discouraged structure, listing its Warning", async () => {
    const user = await buildUser();
    const {
      collection,
      documents: [document],
    } = await buildCollectionOf(user, [`${VALID}\n\n> Quote`]);
    restart({ [collection.id]: documentPolicy });
    const token = await oauthToken(user, ["read"]);

    const warning = {
      code: "DISCOURAGED_MARKDOWN_STRUCTURE",
      severity: "warning",
      message: expect.any(String),
      location: {
        kind: "text",
        documentId: document.id,
        line: 10,
        column: 1,
        path: [4],
      },
    };
    for (const [name, args] of [
      ["lint_document", { id: document.id }],
      ["lint_wiki", { collectionId: collection.id }],
    ] as const) {
      await expect(lintResult(token, name, args)).resolves.toMatchObject({
        state: "complete",
        clean: true,
        errors: [],
        warnings: [warning],
        systemFailures: [],
      });
    }
  });

  it("is not evaluated for a collection absent from the loaded configuration", async () => {
    const user = await buildUser();
    const {
      collection,
      documents: [document],
    } = await buildCollectionOf(user, [VALID]);
    const configured = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    restart({ [configured.id]: documentPolicy });
    const token = await oauthToken(user, ["read"]);

    const notEvaluated = {
      state: "not_evaluated",
      complete: false,
      clean: false,
      errors: [],
      warnings: [],
      systemFailures: [],
      policies: [],
      reason: "POLICY_NOT_CONFIGURED",
    };
    await expect(
      lintResult(token, "lint_document", { id: document.id })
    ).resolves.toEqual({
      ...notEvaluated,
      scope: {
        kind: "document",
        documentId: document.id,
        collectionId: collection.id,
        evaluatedDocumentCount: 0,
        evaluatedLinkCount: 0,
      },
    });
    await expect(
      lintResult(token, "lint_wiki", { collectionId: collection.id })
    ).resolves.toEqual({
      ...notEvaluated,
      scope: {
        kind: "collection",
        collectionId: collection.id,
        evaluatedDocumentCount: 0,
        evaluatedLinkCount: 0,
        completedChecks: [],
      },
    });
  });

  it("fails a readable sentinel with one System Failure and its invalid identity", async () => {
    const user = await buildUser();
    const {
      collection,
      documents: [document],
    } = await buildCollectionOf(user, [VALID]);
    const set = restart({ [collection.id]: sentinelPolicy });
    const token = await oauthToken(user, ["read"]);

    const failed = {
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
      policies: [identityOf(set, collection.id)],
    };
    expect(identityOf(set, collection.id).status).toBe("invalid");
    await expect(
      lintResult(token, "lint_document", { id: document.id })
    ).resolves.toEqual({
      ...failed,
      scope: {
        kind: "document",
        documentId: document.id,
        collectionId: collection.id,
        evaluatedDocumentCount: 0,
        evaluatedLinkCount: 0,
      },
    });
    await expect(
      lintResult(token, "lint_wiki", { collectionId: collection.id })
    ).resolves.toEqual({
      ...failed,
      scope: {
        kind: "collection",
        collectionId: collection.id,
        evaluatedDocumentCount: 0,
        evaluatedLinkCount: 0,
        completedChecks: [],
      },
    });
  });

  it.each([
    [
      "a runtime failure",
      () => new Error("raw detail"),
      "VALIDATION_RUNTIME_FAILED",
    ],
    ["a timeout", () => new DeadlineFloorError(), "VALIDATION_TIMEOUT"],
  ])(
    "models %s of the snapshot reader on both tools",
    async (_name, failure, code) => {
      const user = await buildUser();
      const {
        collection,
        documents: [document],
      } = await buildCollectionOf(user, [VALID]);
      const set = restart({ [collection.id]: documentPolicy });
      const token = await oauthToken(user, ["read"]);
      vi.spyOn(
        defaultLintDocumentReader,
        "readDocumentSnapshot"
      ).mockRejectedValue(failure());
      vi.spyOn(defaultLintWikiReader, "readWikiSnapshot").mockRejectedValue(
        failure()
      );

      const failed = {
        state: "failed",
        complete: false,
        clean: false,
        errors: [],
        warnings: [],
        policies: [identityOf(set, collection.id)],
      };
      await expect(
        lintResult(token, "lint_document", { id: document.id })
      ).resolves.toEqual({
        ...failed,
        systemFailures: [
          {
            code,
            message: expect.any(String),
            location: {
              kind: "scope",
              scopeKind: "document",
              documentId: document.id,
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
      });
      await expect(
        lintResult(token, "lint_wiki", { collectionId: collection.id })
      ).resolves.toEqual({
        ...failed,
        systemFailures: [
          {
            code,
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
      });
    }
  );

  it("fails lint_wiki at the resource limit while the scan slot is held, and completes once it is released", async () => {
    const user = await buildUser();
    const { collection } = await buildCollectionOf(user, [VALID]);
    const set = restart({ [collection.id]: documentPolicy });
    const token = await oauthToken(user, ["read"]);
    lease = lintWikiAdmission.lease();
    expect(lease.acquire()).toBe(true);

    await expect(
      lintResult(token, "lint_wiki", { collectionId: collection.id })
    ).resolves.toEqual({
      state: "failed",
      complete: false,
      clean: false,
      errors: [],
      warnings: [],
      systemFailures: [
        {
          code: "VALIDATION_RESOURCE_LIMIT_EXCEEDED",
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
      policies: [identityOf(set, collection.id)],
    });

    lease.release();
    await expect(
      lintResult(token, "lint_wiki", { collectionId: collection.id })
    ).resolves.toMatchObject({ state: "complete", clean: true });
  });

  it("reports an inaccessible link target exactly as a missing one", async () => {
    const owner = await buildUser();
    const {
      collection: privateCollection,
      documents: [target],
    } = await buildCollectionOf(owner, [VALID], { permission: null });
    const user = await buildUser({ teamId: owner.teamId });
    const {
      collection,
      documents: [document],
    } = await buildCollectionOf(user, [
      `${METADATA}\n\n## Body\n\n[a](/doc/${target.id})\n\n[a](/doc/${randomUUID()})`,
    ]);
    restart({
      [collection.id]: documentPolicy,
      [privateCollection.id]: documentPolicy,
    });
    const token = await oauthToken(user, ["read"]);

    for (const [name, args] of [
      ["lint_document", { id: document.id }],
      ["lint_wiki", { collectionId: collection.id }],
    ] as const) {
      const text = modeledText(await callTool(token, name, args));
      const { errors } = JSON.parse(text) as ReadOnlyResult;

      expect(errors.map((finding) => finding.code)).toEqual([
        "INTERNAL_LINK_TARGET_UNRESOLVED",
        "INTERNAL_LINK_TARGET_UNRESOLVED",
      ]);
      expect(
        errors.map((finding) => (finding.location as TextLocation).line)
      ).toEqual([8, 10]);
      /**
       * Drops the position of a Finding.
       *
       * @param finding - the Finding.
       * @returns the Finding without line and path.
       */
      const withoutPosition = (finding: Finding) => ({
        ...finding,
        location: { ...finding.location, line: 0, path: [] },
      });
      expect(withoutPosition(errors[0])).toEqual(withoutPosition(errors[1]));
      for (const hidden of [
        target.id,
        target.urlId,
        target.title,
        privateCollection.id,
      ]) {
        expect(text).not.toContain(hidden);
      }
    }
  });

  it("answers missing and denied targets with byte-identical authorization errors", async () => {
    const owner = await buildUser();
    const {
      collection: privateCollection,
      documents: [denied],
    } = await buildCollectionOf(owner, [VALID], { permission: null });
    restart({ [privateCollection.id]: documentPolicy });
    const token = await oauthToken(await buildUser({ teamId: owner.teamId }), [
      "read",
    ]);

    const responses = [
      await callTool(token, "lint_document", { id: randomUUID() }),
      await callTool(token, "lint_document", { id: denied.id }),
      await callTool(token, "lint_wiki", { collectionId: randomUUID() }),
      await callTool(token, "lint_wiki", {
        collectionId: privateCollection.id,
      }),
    ];

    for (const response of responses) {
      expect(response.error).toBeUndefined();
      expect(JSON.stringify(response.result)).toBe(
        JSON.stringify(AUTHORIZATION_ERROR)
      );
    }
  });

  it.each([
    ["a timeout", () => new DeadlineFloorError()],
    ["any other error", () => new Error("raw detail")],
  ])(
    "returns the fixed failure message when the target lookup fails with %s",
    async (_name, failure) => {
      const user = await buildUser();
      const {
        collection,
        documents: [document],
      } = await buildCollectionOf(user, [VALID]);
      restart({ [collection.id]: documentPolicy });
      const token = await oauthToken(user, ["read"]);
      vi.spyOn(
        defaultLintDocumentReader,
        "authorizeLintTarget"
      ).mockRejectedValue(failure());
      vi.spyOn(
        defaultLintWikiReader,
        "authorizeLintCollection"
      ).mockRejectedValue(failure());

      for (const [name, args] of [
        ["lint_document", { id: document.id }],
        ["lint_wiki", { collectionId: collection.id }],
      ] as const) {
        const response = await callTool(token, name, args);
        expect(response.error).toBeUndefined();
        expect(response.result).toEqual({
          content: [{ type: "text", text: OPERATION_FAILED }],
          isError: true,
        });
      }
    }
  );

  it.each([
    ["a missing id", {}],
    ["a non-string id", { id: 1 }],
  ])("returns an isError result for %s", async (_name, args) => {
    const token = await apiKeyToken(await buildUser());

    const response = await callTool(token, "lint_document", args);

    expect(response.error).toBeUndefined();
    expect(response.result?.isError).toBe(true);
  });
});

describe("sentinel matrix", () => {
  /**
   * Builds a team with a valid and a sentinel collection everyone can read,
   * plus a private sentinel and a private valid collection whose documents
   * are shared only with a document-only reader, and loads their policies.
   *
   * @returns the actors, collections, documents, and loaded set.
   */
  async function buildMatrix() {
    const owner = await buildUser();
    const actor = await buildUser({ teamId: owner.teamId });
    const reader = await buildUser({ teamId: owner.teamId });
    const {
      collection: valid,
      documents: [validDocument],
    } = await buildCollectionOf(owner, [VALID]);
    const {
      collection: sentinel,
      documents: [sentinelDocument],
    } = await buildCollectionOf(owner, [VALID]);
    const {
      collection: privateSentinel,
      documents: [privateSentinelDocument],
    } = await buildCollectionOf(owner, [VALID], { permission: null });
    const {
      collection: privateValid,
      documents: [privateValidDocument],
    } = await buildCollectionOf(owner, [VALID], { permission: null });
    for (const document of [privateSentinelDocument, privateValidDocument]) {
      await UserMembership.create({
        documentId: document.id,
        userId: reader.id,
        createdById: owner.id,
        permission: DocumentPermission.Read,
      });
    }
    const readable = {
      [valid.id]: documentPolicy,
      [sentinel.id]: sentinelPolicy,
    };
    return {
      actor,
      reader,
      valid,
      validDocument,
      sentinel,
      sentinelDocument,
      privateSentinel,
      privateSentinelDocument,
      privateValid,
      privateValidDocument,
      readable,
      set: restart({
        ...readable,
        [privateSentinel.id]: sentinelPolicy,
        [privateValid.id]: documentPolicy,
      }),
    };
  }

  /**
   * Runs one matrix cell over HTTP and through the handler for the same actor
   * and loaded set, and checks that their first texts are byte-equal.
   *
   * @param user - the actor.
   * @param token - the actor's bearer credential.
   * @param name - the lint tool.
   * @param args - the arguments.
   * @param set - the loaded set.
   * @returns the HTTP response and its first text.
   */
  async function cell(
    user: User,
    token: string,
    name: string,
    args: { id?: string; collectionId?: string },
    set: PolicySet
  ) {
    const response = await callTool(token, name, args);
    const text = response.result?.isError
      ? blockText(response.result)
      : modeledText(response);
    expect(text).toBe(await handlerText(user, name, args, set));
    return { response, text };
  }

  /**
   * Checks that a result with a readable sentinel in scope is neither clean
   * nor not evaluated, and reports the sentinel with its invalid identity.
   *
   * @param text - the result text.
   * @param set - the loaded set.
   * @param sentinelId - the readable sentinel.
   * @returns the parsed result.
   */
  function expectSentinelFailure(
    text: string,
    set: PolicySet,
    sentinelId: string
  ) {
    const result = JSON.parse(text) as ReadOnlyResult;
    expectAlgebra(result);
    expect(result.clean).toBe(false);
    expect(result.state).not.toBe("not_evaluated");
    expect(result).not.toHaveProperty("reason");
    expect(result.systemFailures).toContainEqual({
      code: "POLICY_CONFIGURATION_INVALID",
      message: expect.any(String),
      location: {
        kind: "scope",
        scopeKind: "collection",
        collectionId: sentinelId,
      },
    });
    expect(result.policies).toContainEqual(identityOf(set, sentinelId));
    return result;
  }

  it("fails a readable sentinel in document, collection, and default scope", async () => {
    const m = await buildMatrix();
    const token = await oauthToken(m.actor, ["read"]);

    const inDocument = await cell(
      m.actor,
      token,
      "lint_document",
      { id: m.sentinelDocument.id },
      m.set
    );
    const inCollection = await cell(
      m.actor,
      token,
      "lint_wiki",
      { collectionId: m.sentinel.id },
      m.set
    );
    const byDefault = await cell(m.actor, token, "lint_wiki", {}, m.set);

    for (const { text } of [inDocument, inCollection]) {
      expect(expectSentinelFailure(text, m.set, m.sentinel.id)).toMatchObject({
        state: "failed",
        errors: [],
        warnings: [],
        systemFailures: [expect.anything()],
        policies: [expect.anything()],
      });
    }
    const result = expectSentinelFailure(byDefault.text, m.set, m.sentinel.id);
    expect(result.policies).toEqual(
      [m.sentinel.id, m.valid.id]
        .sort()
        .map((collectionId) => identityOf(m.set, collectionId))
    );
  });

  it("denies an unreadable private sentinel, which adds nothing to the default scope", async () => {
    const m = await buildMatrix();
    const token = await oauthToken(m.actor, ["read"]);

    const inDocument = await cell(
      m.actor,
      token,
      "lint_document",
      { id: m.privateSentinelDocument.id },
      m.set
    );
    const inCollection = await cell(
      m.actor,
      token,
      "lint_wiki",
      { collectionId: m.privateSentinel.id },
      m.set
    );
    const byDefault = await cell(m.actor, token, "lint_wiki", {}, m.set);
    const withoutPrivate = await cell(
      m.actor,
      token,
      "lint_wiki",
      {},
      restart(m.readable)
    );

    for (const { response } of [inDocument, inCollection]) {
      expect(response.error).toBeUndefined();
      expect(response.result).toEqual(AUTHORIZATION_ERROR);
    }
    expect(byDefault.text).toBe(withoutPrivate.text);
    for (const hidden of [m.privateSentinel.id, m.privateValid.id]) {
      expect(byDefault.text).not.toContain(hidden);
    }
  });

  it("shows a document-only reader only the policy class of a sentinel", async () => {
    const m = await buildMatrix();
    const token = await oauthToken(m.reader, ["read"]);

    const { text } = await cell(
      m.reader,
      token,
      "lint_document",
      { id: m.privateSentinelDocument.id },
      m.set
    );

    const result = JSON.parse(text) as ReadOnlyResult;
    expectAlgebra(result);
    expect(result).toEqual({
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
            scopeKind: "document",
            documentId: m.privateSentinelDocument.id,
          },
        },
      ],
      scope: {
        kind: "document",
        documentId: m.privateSentinelDocument.id,
        evaluatedDocumentCount: 0,
        evaluatedLinkCount: 0,
      },
      policies: [],
    });
    expect(text).not.toContain("collectionId");
    expect(text).not.toContain(m.privateSentinel.id);
  });

  it("evaluates a document-only reader's document in a valid collection without collection identity", async () => {
    const m = await buildMatrix();
    const token = await oauthToken(m.reader, ["read"]);

    const { text } = await cell(
      m.reader,
      token,
      "lint_document",
      { id: m.privateValidDocument.id },
      m.set
    );

    const result = JSON.parse(text) as ReadOnlyResult;
    expectAlgebra(result);
    expect(result).toEqual({
      state: "complete",
      complete: true,
      clean: true,
      errors: [],
      warnings: [],
      systemFailures: [],
      scope: {
        kind: "document",
        documentId: m.privateValidDocument.id,
        evaluatedDocumentCount: 1,
        evaluatedLinkCount: 0,
      },
      policies: [],
    });
    expect(text).not.toContain("collectionId");
    expect(text).not.toContain(m.privateValid.id);
  });
});

describe("round trip", () => {
  it("keeps canonical visible metadata byte-identical and its Finding positions exact", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    restart({
      [collection.id]: { activation: "read_only", rules: metadataRules },
    });
    const token = await oauthToken(user, ["write"]);

    // Outline serializes every bullet marker as `*`, so `-` markers converge
    // on the canonical form, which then round-trips byte for byte.
    const dashed = await createDocument(
      token,
      collection.id,
      "## Document metadata\n\n- Status: Active\n- Last verified: 2026-09-20"
    );
    expect(await fetchMarkdown(token, dashed)).toBe(METADATA);
    const canonical = await createDocument(token, collection.id, METADATA);
    expect(await fetchMarkdown(token, canonical)).toBe(METADATA);
    for (const id of [dashed, canonical]) {
      await expect(
        lintResult(token, "lint_document", { id })
      ).resolves.toMatchObject({
        state: "complete",
        clean: true,
        errors: [],
        warnings: [],
      });
    }

    const invalid = await createDocument(token, collection.id, INVALID_DATE);
    const fetched = await fetchMarkdown(token, invalid);
    expect(fetched).toBe(INVALID_DATE);
    const lines = fetched.split("\n");
    const line = lines.findIndex((text) => text.includes("2026-13-01")) + 1;
    // Columns count code points.
    const column =
      Array.from(lines[line - 1].split("2026-13-01")[0]).length + 1;
    expect([line, column]).toEqual([4, 18]);
    const before = await lintResult(token, "lint_document", { id: invalid });
    expect(before.errors).toEqual([
      {
        code: "METADATA_FIELD_FORMAT_INVALID",
        severity: "error",
        message: expect.any(String),
        location: {
          kind: "text",
          documentId: invalid,
          line,
          column,
          path: [1, 1],
        },
      },
    ]);

    const resaved = await callTool(token, "update_document", {
      id: invalid,
      text: fetched,
      editMode: "replace",
    });
    expect(resaved.result?.isError).toBeUndefined();
    expect(await fetchMarkdown(token, invalid)).toBe(fetched);
    const after = await lintResult(token, "lint_document", { id: invalid });
    expect(JSON.stringify(after.errors[0].location)).toBe(
      JSON.stringify(before.errors[0].location)
    );
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));

    const frontMatter = await createDocument(
      token,
      collection.id,
      "---\nStatus: Active\nLast verified: 2026-09-20\n---\n\nBody"
    );
    const frontMatterMarkdown = await fetchMarkdown(token, frontMatter);
    expect(frontMatterMarkdown).toContain("Status: Active");
    expect(frontMatterMarkdown).toContain("Last verified: 2026-09-20");
    const result = await lintResult(token, "lint_document", {
      id: frontMatter,
    });
    expect(result.errors.map((finding) => finding.code)).toEqual([
      "REQUIRED_METADATA_FIELD_MISSING",
      "REQUIRED_METADATA_FIELD_MISSING",
    ]);
  });
});

describe("disclosure", () => {
  it("discloses no protected target, collection identity, or content to any actor", async () => {
    const MARKER = "confidential-marker";
    const owner = await buildUser();
    const teamId = owner.teamId;
    const {
      collection: privateCollection,
      documents: [target],
    } = await buildCollectionOf(owner, [`${VALID}\n\n${MARKER}`], {
      permission: null,
    });
    const {
      collection: readOnly,
      documents: [linking],
    } = await buildCollectionOf(
      owner,
      [`${METADATA}\n\n## Body\n\n[link](/doc/${target.id}) ${MARKER}`],
      { permission: CollectionPermission.Read }
    );
    const {
      collection: hidden,
      documents: [shared],
    } = await buildCollectionOf(owner, [`${VALID}\n\n${MARKER}`], {
      permission: null,
    });
    const member = await buildUser({ teamId });
    const reader = await buildUser({ teamId });
    await UserMembership.create({
      documentId: shared.id,
      userId: reader.id,
      createdById: owner.id,
      permission: DocumentPermission.Read,
    });
    const admin = await buildAdmin({ teamId });
    const foreignAdmin = await buildAdmin();
    const set = restart({
      [readOnly.id]: documentPolicy,
      [hidden.id]: documentPolicy,
      [privateCollection.id]: {
        activation: "read_only",
        rules: [...documentPolicy.rules, ...hierarchyRules],
      },
    });
    const memberToken = await oauthToken(member, ["read", "write"]);
    const readerToken = await oauthToken(reader, ["read"]);
    const adminToken = await oauthToken(admin, ["read"]);

    // A collection member, who is denied the link target.
    const memberDocument = await lintResult(memberToken, "lint_document", {
      id: linking.id,
    });
    const memberCollection = await lintResult(memberToken, "lint_wiki", {
      collectionId: readOnly.id,
    });
    const memberDefault = await lintResult(memberToken, "lint_wiki");
    // A document-only reader.
    const readerDocument = await lintResult(readerToken, "lint_document", {
      id: shared.id,
    });
    const readerDefault = await lintResult(readerToken, "lint_wiki");
    // An admin who can read the private collection but none of its documents.
    const adminCollection = await lintResult(adminToken, "lint_wiki", {
      collectionId: privateCollection.id,
    });
    const adminTarget = await callTool(adminToken, "lint_document", {
      id: target.id,
    });

    expect(memberDocument.errors).toEqual([
      expect.objectContaining({ code: "INTERNAL_LINK_TARGET_UNRESOLVED" }),
    ]);
    expectLocatedIn(memberDocument, [linking.id]);
    expectLocatedIn(memberCollection, [linking.id], [readOnly.id]);
    expectLocatedIn(memberDefault, [linking.id], [readOnly.id]);
    expectLocatedIn(readerDocument, [shared.id]);
    expectLocatedIn(readerDefault, [linking.id], [readOnly.id]);
    expect(adminCollection).toEqual({
      state: "incomplete",
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
            collectionId: privateCollection.id,
          },
        },
      ],
      scope: {
        kind: "collection",
        collectionId: privateCollection.id,
        evaluatedDocumentCount: 0,
        evaluatedLinkCount: 0,
        completedChecks: ["documents"],
      },
      policies: [identityOf(set, privateCollection.id)],
    });
    expect(adminTarget.result).toEqual(AUTHORIZATION_ERROR);

    // A read-only member who received Errors still cannot write.
    const states = await documentStates(teamId);
    const markdown = await fetchMarkdown(memberToken, linking.id);
    const write = await callTool(memberToken, "update_document", {
      id: linking.id,
      text: VALID,
      editMode: "replace",
    });
    expect(write.result?.isError).toBe(true);
    expect(await documentStates(teamId)).toEqual(states);
    expect(await fetchMarkdown(memberToken, linking.id)).toBe(markdown);

    // Audit retrieval: team admins only, and only their own team.
    for (const user of [member, reader]) {
      await expect(listAuditSummaries(user)).resolves.toMatchObject({
        status: 403,
      });
    }
    const listed = await listAuditSummaries(admin);
    expect(listed.status).toBe(200);
    expect(JSON.parse(listed.text).data).toHaveLength(6);
    const foreign = await listAuditSummaries(foreignAdmin);
    expect(foreign.status).toBe(200);
    expect(JSON.parse(foreign.text).data).toEqual([]);

    const protectedValues = [target.id, target.urlId, target.title, MARKER];
    for (const result of [
      memberDocument,
      memberCollection,
      memberDefault,
      readerDocument,
      readerDefault,
    ]) {
      const text = JSON.stringify(result);
      for (const value of [
        ...protectedValues,
        privateCollection.id,
        hidden.id,
      ]) {
        expect(text).not.toContain(value);
      }
    }
    for (const text of [
      JSON.stringify(adminCollection),
      JSON.stringify(adminTarget),
      listed.text,
      foreign.text,
    ]) {
      for (const value of protectedValues) {
        expect(text).not.toContain(value);
      }
    }
    expect(listed.text).not.toContain(hidden.id);
  });
});

describe("repair loop", () => {
  interface Conventions {
    /** The documented value of each metadata field. */
    fields: Record<string, string>;
    /** The collection's documented global index. */
    globalIndexId: string;
    /** The collection of the batch. */
    collectionId: string;
  }

  /**
   * Repairs one Error from its code and location plus the collection's
   * documented conventions, as an agent with a write token would.
   *
   * @param token - the agent's bearer credential.
   * @param finding - the Error.
   * @param conventions - the documented conventions.
   */
  async function repair(
    token: string,
    finding: Finding,
    conventions: Conventions
  ) {
    const { documentId } = finding.location as { documentId: string };
    /**
     * Splits the Finding's line at its column.
     *
     * @returns the text before the column, and from it on.
     */
    const atLocation = async () => {
      const { line, column } = finding.location as TextLocation;
      const source = Array.from(
        (await fetchMarkdown(token, documentId)).split("\n")[line - 1]
      );
      return {
        prefix: source.slice(0, column - 1).join(""),
        rest: source.slice(column - 1).join(""),
      };
    };

    let response: JsonRpcResponse;
    switch (finding.code) {
      case "METADATA_FIELD_FORMAT_INVALID": {
        const { prefix, rest } = await atLocation();
        const name = prefix.replace(/^\* /, "").replace(/:\s*$/, "");
        response = await callTool(token, "update_document", {
          id: documentId,
          editMode: "patch",
          findText: `${name}: ${rest}`,
          text: `${name}: ${conventions.fields[name]}`,
        });
        break;
      }
      case "INTERNAL_LINK_TARGET_UNRESOLVED": {
        const { rest } = await atLocation();
        const [link, label] = /^\[([^\]]*)\]\([^)]*\)/.exec(rest) ?? [];
        response = await callTool(token, "update_document", {
          id: documentId,
          editMode: "patch",
          findText: link,
          text: `[${label}](/doc/${conventions.globalIndexId})`,
        });
        break;
      }
      case "PUBLISHED_DOCUMENT_MISSING_FROM_STRUCTURE":
        response = await callTool(token, "move_document", {
          id: documentId,
          collectionId: conventions.collectionId,
        });
        break;
      case "GLOBAL_INDEX_LINK_MISSING":
        response = await callTool(token, "update_document", {
          id: documentId,
          editMode: "append",
          text: `[Global index](/doc/${conventions.globalIndexId})`,
        });
        break;
      default:
        throw new Error(`No repair for ${finding.code}`);
    }
    expect(response.result?.isError).toBeUndefined();
  }

  /**
   * Runs the bounded agent loop: lint the collection, repair each Error, and
   * lint again, for at most three rounds. An invalid policy is escalated
   * without any edit.
   *
   * @param token - the agent's bearer credential.
   * @param conventions - the documented conventions.
   * @returns each round's result, and whether the loop escalated.
   */
  async function repairLoop(token: string, conventions: Conventions) {
    const rounds: ReadOnlyResult[] = [];
    for (let round = 0; round < 3; round++) {
      const result = await lintResult(token, "lint_wiki", {
        collectionId: conventions.collectionId,
      });
      rounds.push(result);
      if (
        result.systemFailures.some(
          (failure) => failure.code === "POLICY_CONFIGURATION_INVALID"
        )
      ) {
        return { rounds, escalated: true };
      }
      if (result.clean) {
        break;
      }
      for (const finding of result.errors) {
        await repair(token, finding, conventions);
      }
    }
    return { rounds, escalated: false };
  }

  it("repairs every Error of its batch within three rounds and keeps the Warning", async () => {
    const agent = await buildUser();
    const { collection, documents } = await buildCollectionOf(agent, [
      VALID,
      VALID,
      `${INVALID_DATE}\n\n## Body\n\n> Quote`,
      `${METADATA}\n\n## Body\n\nSee ${MISSING_LINK} here.`,
      VALID,
    ]);
    const [index, surface, metadata, linking, orphan] = documents;
    const structure = await Collection.findByPk(collection.id, {
      includeDocumentStructure: true,
      rejectOnEmpty: true,
    });
    await structure.removeDocumentInStructure(orphan);
    const {
      documents: [outside],
    } = await buildCollectionOf(agent, [`${INVALID_DATE}\n\n${MISSING_LINK}`]);
    restart({ [collection.id]: fullPolicy(surface.id, index.id) });
    const token = await oauthToken(agent, ["write"]);
    const before = await documentStates(agent.teamId);

    const { rounds, escalated } = await repairLoop(token, {
      fields: { Status: "Active", "Last verified": "2026-09-20" },
      globalIndexId: index.id,
      collectionId: collection.id,
    });

    expect(escalated).toBe(false);
    expect(rounds).toHaveLength(2);
    expect(
      rounds[0].errors.map((finding) => [
        finding.code,
        finding.location.documentId,
      ])
    ).toEqual(
      expect.arrayContaining([
        ["METADATA_FIELD_FORMAT_INVALID", metadata.id],
        ["INTERNAL_LINK_TARGET_UNRESOLVED", linking.id],
        ["PUBLISHED_DOCUMENT_MISSING_FROM_STRUCTURE", orphan.id],
        ["GLOBAL_INDEX_LINK_MISSING", surface.id],
      ])
    );
    expect(rounds[0].errors).toHaveLength(4);
    const warning = {
      code: "DISCOURAGED_MARKDOWN_STRUCTURE",
      severity: "warning",
      message: expect.any(String),
      location: expect.objectContaining({ documentId: metadata.id }),
    };
    expect(rounds[0].warnings).toEqual([warning]);
    expect(rounds[rounds.length - 1]).toMatchObject({
      state: "complete",
      complete: true,
      clean: true,
      errors: [],
      warnings: [warning],
      systemFailures: [],
      scope: {
        completedChecks: ["documents", "hierarchy", "global_index"],
      },
    });
    const after = await documentStates(agent.teamId);
    const batch = [surface.id, metadata.id, linking.id, orphan.id];
    for (const [id, stored] of before) {
      if (!batch.includes(id)) {
        expect(after.get(id)).toBe(stored);
      }
    }
    expect(after.get(outside.id)).toBe(before.get(outside.id));
    expect(after.get(index.id)).toBe(before.get(index.id));
  });

  it("escalates a sentinel scope without an edit, and re-lints it clean after a corrected restart", async () => {
    const agent = await buildUser();
    const { collection } = await buildCollectionOf(agent, [VALID, VALID]);
    restart({ [collection.id]: sentinelPolicy });
    const token = await oauthToken(agent, ["write"]);
    const before = await documentStates(agent.teamId);

    const { rounds, escalated } = await repairLoop(token, {
      fields: { Status: "Active", "Last verified": "2026-09-20" },
      globalIndexId: randomUUID(),
      collectionId: collection.id,
    });

    expect(escalated).toBe(true);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({
      state: "failed",
      clean: false,
      errors: [],
      systemFailures: [{ code: "POLICY_CONFIGURATION_INVALID" }],
    });
    expect(await documentStates(agent.teamId)).toEqual(before);

    restart({
      [collection.id]: {
        activation: "read_only",
        rules: [...documentPolicy.rules, ...hierarchyRules],
      },
    });
    await expect(
      lintResult(token, "lint_wiki", { collectionId: collection.id })
    ).resolves.toMatchObject({
      state: "complete",
      clean: true,
      errors: [],
      systemFailures: [],
    });
    expect(await documentStates(agent.teamId)).toEqual(before);
  });
});

describe("determinism", () => {
  it("returns byte-identical results across clients, headers, ids, titles, languages, and updatedAt order", async () => {
    const user = await buildUser();
    const {
      collection,
      documents: [first, second],
    } = await buildCollectionOf(user, [
      `${INVALID_DATE}\n\n## Body\n\nSee ${MISSING_LINK} here.`,
      "## Document metadata\n\n* Status: Unknown\n\n> Quote",
    ]);
    restart({ [collection.id]: documentPolicy });
    const oauth = await oauthToken(user, ["read"]);
    const apiKey = await apiKeyToken(user);
    const ids: number[] = [];
    /**
     * Runs both tools in each scope, collecting each JSON-RPC result.
     *
     * @param token - the bearer credential.
     * @param headers - extra HTTP headers.
     * @returns the serialized results.
     */
    const run = async (token: string, headers?: Record<string, string>) => {
      const results: string[] = [];
      for (const [name, args] of [
        ["lint_document", { id: first.id }],
        ["lint_wiki", { collectionId: collection.id }],
        ["lint_wiki", {}],
      ] as const) {
        const response = await callTool(token, name, args, headers);
        modeledText(response);
        ids.push(response.id);
        results.push(JSON.stringify(response.result));
      }
      return results;
    };
    /**
     * Sets a document's `updatedAt` and nothing else.
     *
     * @param documentId - the document.
     * @param updatedAt - the timestamp.
     */
    const touch = (documentId: string, updatedAt: string) =>
      sequelize.query(`UPDATE documents SET "updatedAt" = $1 WHERE id = $2`, {
        bind: [updatedAt, documentId],
      });

    const baseline = await run(oauth);
    expect(
      JSON.parse(JSON.parse(baseline[1]).content[0].text).errors.length
    ).toBeGreaterThan(2);

    expect(await run(apiKey)).toEqual(baseline);
    expect(await run(oauth, { "User-Agent": "determinism-probe/2.0" })).toEqual(
      baseline
    );
    await Document.unscoped().update(
      { title: "Renamed" },
      { where: { id: first.id }, hooks: false }
    );
    expect(await run(oauth)).toEqual(baseline);
    await User.update(
      { language: "de_DE" },
      { where: { id: user.id }, hooks: false }
    );
    expect(await run(oauth)).toEqual(baseline);
    await touch(first.id, "2001-01-01T00:00:00.000Z");
    await touch(second.id, "2030-01-01T00:00:00.000Z");
    expect(await run(oauth)).toEqual(baseline);
    await touch(first.id, "2030-01-02T00:00:00.000Z");
    expect(await run(oauth)).toEqual(baseline);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("audit", () => {
  /**
   * Returns the summary counts of a lint result.
   *
   * @param result - the lint result.
   * @returns the expected summary counts.
   */
  function countsOf(result: ReadOnlyResult) {
    const byCode: Record<string, number> = {};
    for (const { code } of [
      ...result.errors,
      ...result.warnings,
      ...result.systemFailures,
    ]) {
      byCode[code] = (byCode[code] ?? 0) + 1;
    }
    return {
      errors: result.errors.length,
      warnings: result.warnings.length,
      systemFailures: result.systemFailures.length,
      byCode,
    };
  }

  it("lists exactly one summary per lint result to a team admin, and none for isError calls", async () => {
    const user = await buildUser();
    const admin = await buildAdmin({ teamId: user.teamId });
    const {
      collection,
      documents: [clean, findings],
    } = await buildCollectionOf(user, [
      VALID,
      `${INVALID_DATE}\n\n## Body\n\n> Quote`,
    ]);
    const { collection: unconfigured } = await buildCollectionOf(user, [VALID]);
    const { collection: sentinel } = await buildCollectionOf(user, [VALID]);
    const {
      collection: privateCollection,
      documents: [shared],
    } = await buildCollectionOf(user, [VALID], { permission: null });
    await UserMembership.create({
      documentId: shared.id,
      userId: admin.id,
      createdById: user.id,
      permission: DocumentPermission.Read,
    });
    restart({
      [collection.id]: documentPolicy,
      [sentinel.id]: sentinelPolicy,
      [privateCollection.id]: {
        activation: "read_only",
        rules: [
          ...documentPolicy.rules,
          { kind: "published_documents_in_structure" },
        ],
      },
    });
    const token = await oauthToken(user, ["read"]);
    const adminToken = await oauthToken(admin, ["read"]);
    const invocations = [
      {
        token,
        actor: user,
        name: "lint_document",
        args: { id: clean.id },
        outcome: "clean",
        policy: true,
      },
      {
        token,
        actor: user,
        name: "lint_document",
        args: { id: findings.id },
        outcome: "findings",
        policy: true,
      },
      {
        token,
        actor: user,
        name: "lint_wiki",
        args: { collectionId: unconfigured.id },
        outcome: "not_evaluated",
        policy: false,
      },
      // An admin without membership: documents complete, hierarchy fails.
      {
        token: adminToken,
        actor: admin,
        name: "lint_wiki",
        args: { collectionId: privateCollection.id },
        outcome: "incomplete",
        policy: true,
      },
      {
        token,
        actor: user,
        name: "lint_wiki",
        args: { collectionId: sentinel.id },
        outcome: "failed",
        policy: false,
      },
    ];

    const results: ReadOnlyResult[] = [];
    for (const invocation of invocations) {
      results.push(
        await lintResult(invocation.token, invocation.name, invocation.args)
      );
      for (const [name, args] of [
        ["lint_document", {}],
        ["lint_document", { id: randomUUID() }],
        ["lint_wiki", { collectionId: randomUUID() }],
      ] as const) {
        const response = await callTool(token, name, args);
        expect(response.result?.isError).toBe(true);
      }
    }

    const listed = await listAuditSummaries(admin);
    expect(listed.status).toBe(200);
    const rows = JSON.parse(listed.text).data;
    expect(rows).toHaveLength(invocations.length);
    await expect(auditCount(user.teamId)).resolves.toBe(invocations.length);
    invocations.forEach((invocation, index) => {
      const result = results[index];
      expect(
        result.state !== "complete"
          ? result.state
          : result.clean
            ? "clean"
            : "findings"
      ).toBe(invocation.outcome);
      expect(rows[index]).toMatchObject({
        name:
          invocation.name === "lint_document"
            ? "wikiLint.document"
            : "wikiLint.wiki",
        actorId: invocation.actor.id,
        data: {
          operation: invocation.name,
          outcome: invocation.outcome,
          complete: result.complete,
        },
      });
      expect(rows[index].data.counts).toStrictEqual(countsOf(result));
      // The closed AuditDataV1 keys; every token here is an OAuth token.
      expect(Object.keys(rows[index].data).sort()).toEqual(
        [
          "schemaVersion",
          "requestId",
          "operation",
          "outcome",
          "complete",
          "durationMs",
          "scopeKind",
          ...(invocation.policy
            ? ["policySchemaVersion", "policyFingerprint"]
            : []),
          "evaluatedDocumentCount",
          "evaluatedLinkCount",
          "counts",
          "runtimeFailOpenExercised",
          "credentialAuthType",
          "authenticatedClientId",
        ].sort()
      );
    });
  });

  it.each(["lint_document", "lint_wiki"])(
    "returns the unfailed %s result and logs one minimized warning when the audit write fails",
    async (name) => {
      const user = await buildUser();
      const {
        collection,
        documents: [document],
      } = await buildCollectionOf(user, [INVALID_DATE]);
      restart({ [collection.id]: documentPolicy });
      const token = await oauthToken(user, ["read"]);
      const args =
        name === "lint_document"
          ? { id: document.id }
          : { collectionId: collection.id };
      const unfailed = await callTool(token, name, args);
      const text = modeledText(unfailed);
      await expect(auditCount(user.teamId)).resolves.toBe(1);

      state.auditFails = true;
      const warn = vi.spyOn(Logger, "warn");
      const failed = await callTool(token, name, args);

      expect(JSON.stringify(failed.result)).toBe(
        JSON.stringify(unfailed.result)
      );
      expect(modeledText(failed)).toBe(text);
      expect(Object.keys(JSON.parse(text)).sort()).toEqual([
        "clean",
        "complete",
        "errors",
        "policies",
        "scope",
        "state",
        "systemFailures",
        "warnings",
      ]);
      await expect(auditCount(user.teamId)).resolves.toBe(1);
      expect(warn.mock.calls).toStrictEqual([
        [
          "Wiki lint audit write failed",
          {
            requestId: expect.stringMatching(UUID_PATTERN),
            invocationId: expect.stringMatching(UUID_PATTERN),
            reason: "error",
          },
        ],
      ]);
    }
  );
});

describe("without configuration and without enforcement", () => {
  it("lists both tools after a restart without configuration and evaluates nothing", async () => {
    const user = await buildUser();
    const {
      collection,
      documents: [document],
    } = await buildCollectionOf(user, [INVALID_DATE]);
    restart(null);
    const token = await apiKeyToken(user);

    const names = (await listTools(token)).map((tool) => tool.name);

    expect(names).toEqual(expect.arrayContaining(LINT_TOOLS));
    for (const [name, args] of [
      ["lint_document", { id: document.id }],
      ["lint_wiki", { collectionId: collection.id }],
      ["lint_wiki", {}],
    ] as const) {
      await expect(lintResult(token, name, args)).resolves.toMatchObject({
        state: "not_evaluated",
        reason: "POLICY_NOT_CONFIGURED",
        errors: [],
        warnings: [],
        systemFailures: [],
        policies: [],
      });
    }
  });

  it("keeps baseline create_document and update_document responses in unconfigured, read-only, sentinel, and enforced collections", async () => {
    const user = await buildUser();
    const withoutConfiguration = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const unconfigured = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const enforced = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const readOnly = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const sentinel = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const token = await oauthToken(user, ["write"]);
    const created = "Text without metadata\n\n> Quote";
    const updated = "Replaced text without metadata\n\n> Another quote";
    /**
     * Creates, then replaces, a policy-violating document.
     *
     * @param collectionId - the collection.
     * @returns the document, plus the response key sets and the persisted
     *   Markdown.
     */
    const write = async (collectionId: string) => {
      const create = await callTool(token, "create_document", {
        title: "Unvalidated",
        text: created,
        collectionId,
      });
      const { id } = JSON.parse(blockText(create.result));
      const createdMarkdown = await fetchMarkdown(token, id);
      const update = await callTool(token, "update_document", {
        id,
        text: updated,
        editMode: "replace",
      });
      for (const response of [create, update]) {
        expect(response.error).toBeUndefined();
        expect(response.result?.isError).toBeUndefined();
        expect(response.result?.content).toHaveLength(1);
        expect(JSON.stringify(response.result)).not.toContain("validation");
      }
      return {
        id,
        outcome: {
          createKeys: Object.keys(JSON.parse(blockText(create.result))),
          updateKeys: Object.keys(JSON.parse(blockText(update.result))),
          createdMarkdown,
          updatedMarkdown: await fetchMarkdown(token, id),
        },
      };
    };

    restart(null);
    const { outcome: baseline } = await write(withoutConfiguration.id);
    const set = restart({
      [readOnly.id]: documentPolicy,
      [sentinel.id]: sentinelPolicy,
      [enforced.id]: {
        activation: "enforced",
        rules: [
          ...metadataRules,
          {
            kind: "unsupported_markdown_structures",
            structures: ["blockquote"],
          },
        ],
      },
    });
    const writes = [
      await write(unconfigured.id),
      await write(readOnly.id),
      await write(sentinel.id),
      await write(enforced.id),
    ];

    expect(baseline).toEqual({
      createKeys: ["success", "id", "title", "url", "breadcrumb"],
      updateKeys: ["success", "id", "title", "url", "breadcrumb"],
      createdMarkdown: created,
      updatedMarkdown: updated,
    });
    for (const { outcome } of writes) {
      expect(outcome).toEqual(baseline);
    }
    expect(identityOf(set, sentinel.id).status).toBe("invalid");
    expect(identityOf(set, enforced.id).status).toBe("valid");
    const violations = await lintResult(token, "lint_document", {
      id: writes[3].id,
    });
    expect(violations).toMatchObject({ state: "complete", clean: false });
    expect(violations.errors.length).toBeGreaterThan(0);
  });
});
