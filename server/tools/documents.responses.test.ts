import { createHash, randomUUID } from "node:crypto";
import { Op } from "sequelize";
import * as Y from "yjs";
import { DocumentPermission, Scope, TextEditMode } from "@shared/types";
import { sleep } from "@shared/utils/timers";
import { APIUpdateExtension } from "@server/collaboration/APIUpdateExtension";
import Logger from "@server/logging/Logger";
import {
  type Collection,
  Document,
  Event,
  Team,
  type User,
  UserMembership,
} from "@server/models";
import { ProsemirrorHelper } from "@server/models/helpers/ProsemirrorHelper";
import type * as Presenters from "@server/presenters";
import { sequelize } from "@server/storage/database";
import {
  buildApiKey,
  buildCollection,
  buildDocument,
  buildOAuthAuthentication,
  buildShare,
  buildUser,
} from "@server/test/factories";
import {
  buildOAuthUser,
  callMcpTool,
  mcpHeaders,
  mcpRequest,
  parseMcpResponse,
} from "@server/test/McpHelper";
import { getTestServer } from "@server/test/support";
import type * as PolicyConfig from "@server/wikiLint/adapters/policyConfig";
import { POST_COMMIT_ASSEMBLY_BOUND_MS } from "@server/wikiLint/application/deadline";
import type { PolicySet } from "@server/wikiLint/core/policySet";
import { buildPolicySet } from "@server/wikiLint/core/policySet";
import {
  OPERATION_FAILED,
  createSystemFailure,
} from "@server/wikiLint/core/registry";
import type * as Util from "./util";

/** What the replaced seams serve; each passes through while unset. */
const seams = vi.hoisted(() => ({
  policySet: undefined as PolicySet | undefined,
  breadcrumb: undefined as typeof Util.getDocumentBreadcrumb | undefined,
  shareUrl: undefined as typeof Util.getPublicShareUrlForDocument | undefined,
  pathToUrl: undefined as typeof Util.pathToUrl | undefined,
  presentDocument: undefined as typeof Presenters.presentDocument | undefined,
}));

vi.mock("@server/wikiLint/adapters/policyConfig", async (importOriginal) => {
  const actual = await importOriginal<typeof PolicyConfig>();
  return {
    ...actual,
    getPolicySet: () => seams.policySet ?? actual.getPolicySet(),
  };
});

vi.mock("./util", async (importOriginal) => {
  const actual = await importOriginal<typeof Util>();
  return {
    ...actual,
    getDocumentBreadcrumb: (
      ...args: Parameters<typeof actual.getDocumentBreadcrumb>
    ) => (seams.breadcrumb ?? actual.getDocumentBreadcrumb)(...args),
    getPublicShareUrlForDocument: (
      ...args: Parameters<typeof actual.getPublicShareUrlForDocument>
    ) => (seams.shareUrl ?? actual.getPublicShareUrlForDocument)(...args),
    pathToUrl: (...args: Parameters<typeof actual.pathToUrl>) =>
      (seams.pathToUrl ?? actual.pathToUrl)(...args),
  };
});

vi.mock("@server/presenters", async (importOriginal) => {
  const actual = await importOriginal<typeof Presenters>();
  return {
    ...actual,
    presentDocument: (...args: Parameters<typeof actual.presentDocument>) =>
      (seams.presentDocument ?? actual.presentDocument)(...args),
  };
});

const server = getTestServer();

const sha256Hex = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** Requires an Overview section. */
const REQUIRED = {
  kind: "required_sections",
  headingLevel: 2,
  headings: ["Overview"],
};

/** Discourages block quotes: a Warning. */
const DISCOURAGED = {
  kind: "discouraged_markdown_structures",
  structures: ["blockquote"],
};

/** Forbids tables: an Error. */
const UNSUPPORTED = {
  kind: "unsupported_markdown_structures",
  structures: ["table"],
};

const LINKS = { kind: "internal_links" };

/** Every rule kind, none of which a response may name. */
const RULE_KINDS = [
  "required_sections",
  "discouraged_markdown_structures",
  "unsupported_markdown_structures",
  "internal_links",
];

/** Policy terms that no response may contain. */
const POLICY_TERMS = [
  "activation",
  "runtimeFailureMode",
  "invalidFingerprint",
  ...RULE_KINDS,
];

/** What a response to an actor who cannot read the collection never names. */
const IDENTITY_TERMS = [
  "policySchemaVersion",
  "policyFingerprint",
  "collectionId",
  "detail",
];

const ENFORCED = { activation: "enforced", rules: [REQUIRED] };

/** Fails open on runtime failures, and warns on block quotes. */
const OPEN = {
  activation: "enforced",
  runtimeFailureMode: "open",
  rules: [REQUIRED, DISCOURAGED, LINKS],
};

/** Two required sections, a forbidden table, and a discouraged quote. */
const STRICT = {
  activation: "enforced",
  rules: [
    { ...REQUIRED, headings: ["Overview", "Usage"] },
    UNSUPPORTED,
    DISCOURAGED,
  ],
};

/** A policy that is never the post-operation collection's. */
const DECOY = { activation: "enforced", rules: [UNSUPPORTED] };

const READ_ONLY = { activation: "read_only", rules: [REQUIRED] };

/** A body that satisfies `REQUIRED`. */
const VALID = "## Overview\n\nAll good.";

/** A valid body with a discouraged block quote. */
const QUOTED = `${VALID}\n\n> quoted`;

/**
 * Builds a valid body with a block quote and an internal link, whose target
 * read a test can make fail.
 *
 * @returns the body.
 */
const linkedBody = () => `${QUOTED}\n\n[target](/doc/${randomUUID()})`;

/** A body that violates `STRICT` three times and warns once. */
const STRICT_VIOLATION = "Intro\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n> quoted";

const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

const TIMESTAMP_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;

/** Slack for scheduling and transport on top of the assembly bound. */
const SCHEDULING_SLACK_MS = 700;

type McpResponse = Awaited<ReturnType<typeof callMcpTool>>;

/** The tool result of a JSON-RPC response. */
interface ToolResult {
  content?: { type?: string; text?: string }[];
  isError?: boolean;
}

/**
 * Serves a policy set with the given entries.
 *
 * @param entries - each collection and its policy.
 * @returns the served set.
 */
function configure(entries: [Collection, object][]): PolicySet {
  const collections = Object.fromEntries(
    entries.map(([collection, policy]) => [collection.id, policy])
  );
  const result = buildPolicySet(
    Buffer.from(JSON.stringify({ schemaVersion: 1, collections }), "utf8"),
    sha256Hex
  );
  if (!result.ok) {
    throw new Error("The test configuration must load");
  }
  seams.policySet = result.policySet;
  return result.policySet;
}

/**
 * Returns the fingerprint of a configured collection's policy.
 *
 * @param set - the served set.
 * @param collectionId - the collection.
 * @returns its policy or invalid fingerprint.
 */
function fingerprintOf(set: PolicySet, collectionId: string): string {
  const entry = set.entries.find((item) => item.collectionId === collectionId);
  if (!entry) {
    throw new Error("Expected a configured collection");
  }
  return entry.status === "valid"
    ? entry.policyFingerprint
    : entry.invalidFingerprint;
}

/**
 * Lists what an actor who cannot read a collection must never see of it.
 *
 * @param set - the served set.
 * @param collection - the classified collection.
 * @returns the forbidden substrings.
 */
const hiddenFrom = (set: PolicySet, collection: Collection) => [
  collection.id,
  fingerprintOf(set, collection.id),
  ...IDENTITY_TERMS,
];

/**
 * Asserts that a response names no policy term and none of the extra
 * values.
 *
 * @param response - the response.
 * @param extra - the other forbidden substrings.
 */
function expectNoLeak(response: unknown, ...extra: string[]) {
  const text = JSON.stringify(response);
  for (const value of [...POLICY_TERMS, ...extra]) {
    expect(text, value).not.toContain(value);
  }
}

/**
 * Checks a committed or rejected response: no `isError`, and a first block
 * whose `validation.status` is present.
 *
 * @param response - the response.
 * @returns the parsed first block.
 */
function validatedBlock(response: McpResponse) {
  expect(response?.error).toBeUndefined();
  expect(response?.result?.isError).toBeUndefined();
  const first = JSON.parse(response?.result?.content?.[0]?.text ?? "{}");
  expect(Object.keys(first).slice(-1)).toEqual(["validation"]);
  expect(first.validation.status).toEqual(expect.any(String));
  return first;
}

/**
 * Parses the first block of a successful baseline response.
 *
 * @param response - the response.
 * @returns the parsed first block.
 */
function baselineBlock(response: McpResponse) {
  expect(response?.result?.isError).toBeUndefined();
  return JSON.parse(response?.result?.content?.[0]?.text ?? "{}");
}

/**
 * Asserts that a response identifies the stored document: its ID, title,
 * and absolute URL.
 *
 * @param identity - the identity fields of the response.
 * @param documentId - the written document.
 */
async function expectIdentity(
  identity: { id: string; title: string; url: string },
  documentId: string
) {
  const stored = await Document.unscoped().findByPk(documentId, {
    rejectOnEmpty: true,
  });
  const team = await Team.findByPk(stored.teamId, { rejectOnEmpty: true });
  expect(identity.id).toBe(stored.id);
  expect(identity.title).toBe(stored.title);
  expect(identity.url).toBe(new URL(stored.url, team.url).href);
}

/** One intercepted `sequelize.query` call. */
type QueryHandler = (
  sql: string,
  args: unknown[],
  next: () => Promise<unknown>,
  original: (...args: unknown[]) => Promise<unknown>
) => Promise<unknown>;

/**
 * Replaces `sequelize.query` with handlers around the real query, the first
 * outermost.
 *
 * @param handlers - the handlers.
 */
function interceptQueries(...handlers: QueryHandler[]) {
  const original = sequelize.query.bind(sequelize) as unknown as (
    ...args: unknown[]
  ) => Promise<unknown>;
  vi.spyOn(sequelize, "query").mockImplementation(((...args: unknown[]) => {
    const [first] = args;
    const sql =
      typeof first === "string" ? first : (first as { query: string }).query;
    return handlers.reduceRight<() => Promise<unknown>>(
      (next, handler) => () => handler(sql, args, next, original),
      () => original(...args)
    )();
  }) as unknown as typeof sequelize.query);
}

/**
 * Reads the transaction a query runs in.
 *
 * @param args - the query arguments.
 * @returns the transaction, if any.
 */
const transactionOf = (args: unknown[]) =>
  (args[1] as { transaction?: unknown } | undefined)?.transaction;

/**
 * Makes every read inside a shell savepoint fail with a server error, which
 * the savepoint contains.
 *
 * @returns the handler.
 */
function failSavepointReads(): QueryHandler {
  let pending: unknown;
  return (sql, args, next, original) => {
    if (sql.startsWith("SAVEPOINT wiki_lint_read_")) {
      pending = transactionOf(args);
      return next();
    }
    if (pending !== undefined && transactionOf(args) === pending) {
      pending = undefined;
      return original("SELECT 1/0", args[1]);
    }
    return next();
  };
}

/**
 * Tracks the enforcement transaction: the one that sets local timeouts.
 *
 * @param onCommit - runs before that transaction's `COMMIT;`.
 * @param onCommitted - runs once that `COMMIT;` resolved.
 * @returns the handler.
 */
function atEnforcementCommit(
  onCommit: (args: unknown[]) => void,
  onCommitted: () => void = () => undefined
): QueryHandler {
  let enforcement: unknown;
  return async (sql, args, next) => {
    if (sql.startsWith("SET LOCAL lock_timeout")) {
      enforcement = transactionOf(args);
    }
    const commit = sql === "COMMIT;" && transactionOf(args) === enforcement;
    if (commit) {
      onCommit(args);
    }
    const result = await next();
    if (commit) {
      onCommitted();
    }
    return result;
  };
}

/**
 * Builds an OAuth access token with the scopes of `buildOAuthUser`.
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
) {
  const { body } = mcpRequest(method, params);
  const res = await server.post("/mcp/", {
    headers: { ...mcpHeaders(token), ...headers },
    body,
  });
  expect(res.status).toBe(200);
  return (await parseMcpResponse(res)) as {
    result?: Record<string, unknown>;
    error?: unknown;
  };
}

/**
 * Builds a published document with the given body.
 *
 * @param user - the author.
 * @param collection - the collection.
 * @param overrides - other attributes.
 * @returns the document.
 */
const documentIn = (
  user: User,
  collection: Collection,
  overrides: Parameters<typeof buildDocument>[0] = {}
) =>
  buildDocument({
    teamId: user.teamId,
    userId: user.id,
    collectionId: collection.id,
    title: "Target",
    text: VALID,
    ...overrides,
  });

/** The `patch` arguments that turn `VALID` into another valid body. */
const patchOf = (id: string) => ({
  id,
  editMode: TextEditMode.Patch,
  findText: "All good.",
  text: "Patched.",
});

afterEach(() => {
  seams.policySet = undefined;
  seams.breadcrumb = undefined;
  seams.shareUrl = undefined;
  seams.pathToUrl = undefined;
  seams.presentDocument = undefined;
  vi.restoreAllMocks();
});

describe("committed writes by readers and non-readers", () => {
  const WRITES = [
    {
      status: "validated",
      body: () => VALID,
      warnings: [] as string[],
      degraded: false,
    },
    {
      status: "validated_with_warnings",
      body: () => QUOTED,
      warnings: ["DISCOURAGED_MARKDOWN_STRUCTURE"],
      degraded: false,
    },
    {
      status: "degraded_validation",
      body: linkedBody,
      warnings: ["DISCOURAGED_MARKDOWN_STRUCTURE"],
      degraded: true,
    },
  ];

  describe.each([
    { actor: "a collection member", readable: true },
    { actor: "a document-membership editor", readable: false },
  ])("by $actor", ({ readable }) => {
    it.each(WRITES)(
      "returns the baseline fields, then a $status validation",
      async ({ status, body, warnings, degraded }) => {
        const member = await buildOAuthUser();
        const { teamId } = member.user;
        const editor = await actorOf(await buildUser({ teamId }));
        const actor = readable ? member : editor;
        const collection = await buildCollection({
          teamId,
          userId: member.user.id,
          permission: null,
        });
        const decoy = await buildCollection({ teamId, userId: member.user.id });
        const [document, twin] = [
          await documentIn(member.user, collection),
          await documentIn(member.user, collection),
        ];
        for (const { id } of [document, twin]) {
          await UserMembership.create({
            documentId: id,
            userId: editor.user.id,
            createdById: member.user.id,
            permission: DocumentPermission.ReadWrite,
          });
        }
        if (degraded) {
          interceptQueries(failSavepointReads());
        }
        const text = body();

        configure([]);
        const baseline = await callMcpTool(
          server,
          actor.accessToken,
          "update_document",
          { id: twin.id, text }
        );
        const set = configure([
          [collection, OPEN],
          [decoy, DECOY],
        ]);
        const response = await callMcpTool(
          server,
          actor.accessToken,
          "update_document",
          { id: document.id, text }
        );

        expect(response?.result?.content).toHaveLength(1);
        const first = validatedBlock(response);
        expect(Object.keys(first)).toEqual([
          ...Object.keys(baselineBlock(baseline)),
          "validation",
        ]);
        expect(first.success).toBe(true);
        expect("breadcrumb" in first).toBe(readable);
        expect(first.breadcrumb).toBe(baselineBlock(baseline).breadcrumb);
        await expectIdentity(first, document.id);
        expect(first.validation).toEqual({
          status,
          ...(readable && {
            policySchemaVersion: 1,
            policyFingerprint: fingerprintOf(set, collection.id),
          }),
          errors: [],
          warnings: warnings.map((code) => ({
            code,
            severity: "warning",
            message: expect.any(String),
            location: expect.objectContaining({
              kind: "text",
              documentId: document.id,
            }),
          })),
          systemFailures: degraded
            ? [
                createSystemFailure("VALIDATION_RUNTIME_FAILED", {
                  kind: "scope",
                  scopeKind: "collection",
                  ...(readable && { collectionId: collection.id }),
                }),
              ]
            : [],
        });
        expectNoLeak(
          response,
          decoy.id,
          fingerprintOf(set, decoy.id),
          ...(readable ? [] : hiddenFrom(set, collection))
        );
        const stored = await Document.unscoped().findByPk(document.id, {
          rejectOnEmpty: true,
        });
        expect(stored.revisionCount).toBeGreaterThan(document.revisionCount);
      }
    );
  });
});

describe("failed enrichments", () => {
  type Seam = "breadcrumb" | "shareUrl" | "presentDocument" | "pathToUrl";

  const CASES: {
    name: string;
    patch: boolean;
    seam: Seam;
    keys: string[];
    /** Whether the identity cannot be assembled. */
    fallback?: boolean;
    echo: boolean;
  }[] = [
    {
      name: "the breadcrumb throws on a replace",
      patch: false,
      seam: "breadcrumb",
      keys: ["success", "id", "title", "url", "validation"],
      echo: false,
    },
    {
      name: "the breadcrumb throws on a patch",
      patch: true,
      seam: "breadcrumb",
      keys: ["document", "shareUrl", "validation"],
      echo: true,
    },
    {
      name: "the share URL throws on a patch",
      patch: true,
      seam: "shareUrl",
      keys: ["document", "breadcrumb", "validation"],
      echo: true,
    },
    {
      name: "the presentation throws on a patch",
      patch: true,
      seam: "presentDocument",
      keys: ["success", "id", "validation"],
      fallback: true,
      echo: false,
    },
    {
      name: "pathToUrl throws on a replace",
      patch: false,
      seam: "pathToUrl",
      keys: ["success", "id", "validation"],
      fallback: true,
      echo: false,
    },
    {
      name: "pathToUrl throws on a patch",
      patch: true,
      seam: "pathToUrl",
      keys: ["success", "id", "validation"],
      fallback: true,
      echo: true,
    },
  ];

  it.each(CASES)(
    "omits only the failed part when $name",
    async ({ patch, seam, keys, fallback, echo }) => {
      const { user, accessToken } = await buildOAuthUser();
      const collection = await buildCollection({
        teamId: user.teamId,
        userId: user.id,
      });
      const sharedDocument = async () => {
        const document = await documentIn(user, collection);
        await buildShare({
          teamId: user.teamId,
          userId: user.id,
          documentId: document.id,
          published: true,
        });
        return document;
      };
      const [document, twin] = [await sharedDocument(), await sharedDocument()];
      const args = (id: string) =>
        patch ? patchOf(id) : { id, text: "## Overview\n\nReplaced." };

      configure([]);
      const baseline = await callMcpTool(
        server,
        accessToken,
        "update_document",
        args(twin.id)
      );
      const set = configure([[collection, ENFORCED]]);
      const armed = vi.fn(() => {
        throw new Error("The armed enrichment failed");
      });
      (seams as Record<Seam, unknown>)[seam] = armed;
      const response = await callMcpTool(
        server,
        accessToken,
        "update_document",
        args(document.id)
      );

      expect(armed).toHaveBeenCalled();
      expect(response?.result?.content).toHaveLength(echo ? 2 : 1);
      const first = validatedBlock(response);
      const baselineFirst = baselineBlock(baseline);
      // The baseline has every enrichment.
      expect(Object.keys(baselineFirst)).toEqual(
        patch
          ? ["document", "breadcrumb", "shareUrl"]
          : ["success", "id", "title", "url", "breadcrumb"]
      );
      expect(Object.keys(first)).toEqual(keys);
      const validation = {
        status: "validated",
        policySchemaVersion: 1,
        policyFingerprint: fingerprintOf(set, collection.id),
        errors: [],
        warnings: [],
        systemFailures: [],
      };
      if (fallback) {
        expect(first).toEqual({ success: true, id: document.id, validation });
      } else {
        expect(first.validation).toEqual(validation);
        if (patch) {
          expect(Object.keys(first.document)).toEqual(
            Object.keys(baselineFirst.document)
          );
          await expectIdentity(first.document, document.id);
        } else {
          await expectIdentity(first, document.id);
        }
      }
      if (echo) {
        expect(response?.result?.content?.[1]).toEqual(
          baseline?.result?.content?.[1]
        );
      }
      expectNoLeak(response);
      const stored = await Document.unscoped().findByPk(document.id, {
        rejectOnEmpty: true,
      });
      expect(stored.text).toBe(
        patch ? "## Overview\n\nPatched." : "## Overview\n\nReplaced."
      );
    }
  );
});

describe("the post-commit assembly bound", () => {
  it("omits an enrichment that settles after the deadline before its timer runs", async () => {
    const { user, accessToken } = await buildOAuthUser();
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const document = await documentIn(user, collection);
    configure([[collection, ENFORCED]]);
    seams.breadcrumb = async () => {
      const until = performance.now() + POST_COMMIT_ASSEMBLY_BOUND_MS + 25;
      while (performance.now() < until) {
        // The resolved promise wins the race before its queued timer can run.
      }
      return "Late breadcrumb";
    };

    const response = await callMcpTool(server, accessToken, "update_document", {
      id: document.id,
      text: "## Overview\n\nChanged.",
    });

    const first = validatedBlock(response);
    expect(Object.keys(first)).toEqual([
      "success",
      "id",
      "title",
      "url",
      "validation",
    ]);
    expect(first.success).toBe(true);
    await expectIdentity(first, document.id);
  }, 15000);

  /**
   * Builds a publicly shared Y.js-state document in an enforced collection,
   * whose patch notifies the collaboration server after a delay.
   *
   * @param notifyMs - how long the collaboration notify takes.
   * @returns the document, its expected validation, and a patch that checks
   *   the deadline ended its wait and returns the response.
   */
  async function slowAssembly(notifyMs: number) {
    const { user, accessToken } = await buildOAuthUser();
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const document = await documentIn(user, collection);
    document.state = Buffer.from(
      Y.encodeStateAsUpdate(ProsemirrorHelper.toYDoc(document.content!))
    );
    await document.save();
    await buildShare({
      teamId: user.teamId,
      userId: user.id,
      documentId: document.id,
      published: true,
    });
    const set = configure([[collection, ENFORCED]]);
    const notify = vi
      .spyOn(APIUpdateExtension, "notifyUpdate")
      .mockImplementation(async () => {
        await sleep(notifyMs);
      });
    let committedAt = Number.NaN;
    interceptQueries(
      atEnforcementCommit(
        () => undefined,
        () => {
          committedAt = performance.now();
        }
      )
    );
    const patch = async () => {
      const response = await callMcpTool(
        server,
        accessToken,
        "update_document",
        patchOf(document.id)
      );
      const elapsed = performance.now() - committedAt;

      expect(notify).toHaveBeenCalledTimes(1);
      expect(elapsed).toBeGreaterThanOrEqual(
        POST_COMMIT_ASSEMBLY_BOUND_MS - 50
      );
      expect(elapsed).toBeLessThanOrEqual(
        POST_COMMIT_ASSEMBLY_BOUND_MS + SCHEDULING_SLACK_MS
      );
      const stored = await Document.unscoped().findByPk(document.id, {
        rejectOnEmpty: true,
      });
      expect(stored.text).toBe("## Overview\n\nPatched.");
      return response;
    };
    const validation = {
      status: "validated",
      policySchemaVersion: 1,
      policyFingerprint: fingerprintOf(set, collection.id),
      errors: [],
      warnings: [],
      systemFailures: [],
    };
    return { document, validation, patch };
  }

  it.each([
    { notifyMs: 1200, breadcrumb: false },
    { notifyMs: 0, breadcrumb: true },
  ])(
    "answers within the bound of COMMIT when the collaboration notify takes $notifyMs ms",
    async ({ notifyMs, breadcrumb }) => {
      const { patch } = await slowAssembly(notifyMs);
      seams.breadcrumb = () => sleep(1000).then(() => "Late breadcrumb");
      seams.shareUrl = () => new Promise<string | undefined>(() => undefined);

      const response = await patch();

      expect(response?.result?.content).toHaveLength(2);
      const first = validatedBlock(response);
      expect(Object.keys(first)).toEqual([
        "document",
        ...(breadcrumb ? ["breadcrumb"] : []),
        "validation",
      ]);
      if (breadcrumb) {
        expect(first.breadcrumb).toBe("Late breadcrumb");
      }
    },
    15000
  );

  it("falls back to the bare identity when the presentation outlasts the bound", async () => {
    const { document, validation, patch } = await slowAssembly(0);
    seams.presentDocument = () => new Promise<never>(() => undefined);

    const response = await patch();

    expect(response?.result?.content).toHaveLength(1);
    expect(validatedBlock(response)).toEqual({
      success: true,
      id: document.id,
      validation,
    });
  }, 15000);

  it("starts no enrichment once the callbacks have used up the bound", async () => {
    const { document, validation, patch } = await slowAssembly(2500);
    const enrichment = vi.fn(() => new Promise<never>(() => undefined));
    seams.breadcrumb = enrichment;
    seams.shareUrl = enrichment;
    seams.presentDocument = enrichment;
    // A timer may fire a millisecond before the monotonic deadline, so
    // reporting the expired callback bound takes 20 ms: the deadline has
    // surely passed when the handler checks it.
    const warn = vi.spyOn(Logger, "warn").mockImplementation((_, extra) => {
      if (extra?.reason === "bound_expired") {
        const until = performance.now() + 20;
        while (performance.now() < until) {
          // Busy-waits so that no timer runs in between.
        }
      }
    });

    const response = await patch();

    expect(warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reason: "bound_expired" })
    );
    expect(enrichment).not.toHaveBeenCalled();
    expect(response?.result?.content).toHaveLength(1);
    expect(validatedBlock(response)).toEqual({
      success: true,
      id: document.id,
      validation,
    });
  }, 15000);
});

describe("an unestablished commit", () => {
  it("returns only OPERATION_FAILED for a degraded create whose socket is destroyed at COMMIT", async () => {
    const { user, accessToken } = await buildOAuthUser();
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    configure([[collection, OPEN]]);
    const documents = () =>
      Document.unscoped().count({
        where: { teamId: user.teamId },
        paranoid: false,
      });
    const before = await documents();
    let destroyed = false;
    interceptQueries(
      failSavepointReads(),
      atEnforcementCommit((args) => {
        destroyed = true;
        (
          transactionOf(args) as {
            connection: { connection: { stream: { destroy(): void } } };
          }
        ).connection.connection.stream.destroy();
      })
    );

    const response = await callMcpTool(server, accessToken, "create_document", {
      title: "Unestablished",
      text: linkedBody(),
      collectionId: collection.id,
    });

    expect(destroyed).toBe(true);
    expect(response?.result).toEqual({
      content: [{ type: "text", text: OPERATION_FAILED }],
      isError: true,
    });
    vi.restoreAllMocks();
    await expect(documents()).resolves.toBe(before);
  });
});

describe("unchanged scopes", () => {
  const CALLS: {
    name: string;
    tool: "create_document" | "update_document";
    child?: boolean;
    failure?: boolean;
    args: (target: Document, collection: Collection) => Record<string, unknown>;
  }[] = [
    {
      name: "a create",
      tool: "create_document",
      args: (_target, collection) => ({
        title: "Written",
        text: STRICT_VIOLATION,
        collectionId: collection.id,
      }),
    },
    {
      name: "a replace",
      tool: "update_document",
      args: (target) => ({ id: target.id, text: STRICT_VIOLATION }),
    },
    {
      name: "a patch",
      tool: "update_document",
      args: (target) => patchOf(target.id),
    },
    {
      name: "a patch whose findText is absent",
      tool: "update_document",
      failure: true,
      args: (target) => ({
        id: target.id,
        editMode: TextEditMode.Patch,
        findText: "absent text",
        text: "x",
      }),
    },
    {
      name: "an unchanged update",
      tool: "update_document",
      failure: true,
      args: (target) => ({ id: target.id, title: target.title }),
    },
    {
      name: "an unpublish of a parent",
      tool: "update_document",
      child: true,
      failure: true,
      args: (target) => ({ id: target.id, publish: false }),
    },
  ];

  /**
   * Normalizes a result: the team's document `urlId`s, every UUID, and every
   * timestamp.
   *
   * @param response - the response.
   * @param teamId - the team.
   * @returns the normalized result text.
   */
  async function normalized(response: McpResponse, teamId: string) {
    const documents = await Document.unscoped().findAll({
      where: { teamId },
      attributes: ["urlId"],
      paranoid: false,
    });
    let text = JSON.stringify(response?.result);
    for (const { urlId } of documents) {
      text = text.split(urlId).join("<urlId>");
    }
    return text
      .replace(UUID_PATTERN, "<id>")
      .replace(TIMESTAMP_PATTERN, "<timestamp>");
  }

  describe.each(["read_only", "absent"] as const)(
    "in a collection whose policy is %s",
    (scope) => {
      it.each(CALLS)(
        "keeps the unconfigured result of $name",
        async ({ tool, child, failure, args }) => {
          const { user, accessToken } = await buildOAuthUser();
          const collection = await buildCollection({
            teamId: user.teamId,
            userId: user.id,
          });
          const other = await buildCollection({
            teamId: user.teamId,
            userId: user.id,
          });
          const target = async () => {
            const document = await documentIn(user, collection);
            if (child) {
              await documentIn(user, collection, {
                title: "Child",
                parentDocumentId: document.id,
              });
            }
            return document;
          };
          const [configuredTarget, plainTarget] = [
            await target(),
            await target(),
          ];

          const set = configure([
            ...(scope === "read_only"
              ? [[collection, READ_ONLY] as [Collection, object]]
              : []),
            [other, OPEN],
          ]);
          const configured = await callMcpTool(
            server,
            accessToken,
            tool,
            args(configuredTarget, collection)
          );
          configure([]);
          const plain = await callMcpTool(
            server,
            accessToken,
            tool,
            args(plainTarget, collection)
          );

          expect(JSON.stringify(configured)).not.toContain("validation");
          if (failure) {
            expect(configured?.result?.isError).toBe(true);
            expect(configured?.result).toEqual(plain?.result);
          } else {
            expect(configured?.result?.isError).toBeUndefined();
            expect(await normalized(configured, user.teamId)).toBe(
              await normalized(plain, user.teamId)
            );
          }
          await expect(
            Event.count({
              where: { teamId: user.teamId, name: { [Op.like]: "wikiLint.%" } },
            })
          ).resolves.toBe(0);
          expectNoLeak(
            configured,
            other.id,
            fingerprintOf(set, other.id),
            ...(scope === "read_only"
              ? [fingerprintOf(set, collection.id)]
              : [])
          );
        }
      );
    }
  );
});

describe("repeated writes", () => {
  it("returns byte-identical rejections across credentials and clients", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const decoy = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const document = await documentIn(user, collection);
    const set = configure([
      [collection, STRICT],
      [decoy, DECOY],
    ]);
    const { accessToken: oauth } = await actorOf(user);
    const apiKey = (await buildApiKey({ userId: user.id })).value!;
    const params = {
      name: "update_document",
      arguments: { id: document.id, text: STRICT_VIOLATION },
    };

    const responses = [
      await rpc(oauth, "tools/call", params),
      await rpc(apiKey, "tools/call", params),
      await rpc(oauth, "tools/call", params, {
        "User-Agent": "another-mcp-client/2.0",
      }),
    ];

    const results = responses.map((response) => response.result as ToolResult);
    expect(results[0].content).toHaveLength(1);
    expect(JSON.stringify(results[1])).toBe(JSON.stringify(results[0]));
    expect(JSON.stringify(results[2])).toBe(JSON.stringify(results[0]));
    const first = validatedBlock({ result: results[0] });
    expect(first.success).toBe(false);
    expect(first.validation.status).toBe("rejected");
    expect(
      first.validation.errors
        .map((finding: { code: string }) => finding.code)
        .sort()
    ).toEqual([
      "MARKDOWN_STRUCTURE_UNSUPPORTED",
      "REQUIRED_SECTION_MISSING",
      "REQUIRED_SECTION_MISSING",
    ]);
    expect(
      first.validation.warnings.map((finding: { code: string }) => finding.code)
    ).toEqual(["DISCOURAGED_MARKDOWN_STRUCTURE"]);
    expectNoLeak(responses, decoy.id, fingerprintOf(set, decoy.id));
    const stored = await Document.unscoped().findByPk(document.id, {
      rejectOnEmpty: true,
    });
    expect(stored.revisionCount).toBe(document.revisionCount);
  });

  it("returns identical degraded creates after normalizing the allocated document", async () => {
    const { user, accessToken } = await buildOAuthUser();
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    configure([[collection, OPEN]]);
    interceptQueries(failSavepointReads());
    const args = {
      title: "Degraded",
      text: linkedBody(),
      collectionId: collection.id,
    };

    const responses = [
      await callMcpTool(server, accessToken, "create_document", args),
      await callMcpTool(server, accessToken, "create_document", args),
    ];

    const texts = await Promise.all(
      responses.map(async (response) => {
        const first = validatedBlock(response);
        expect(first.validation.status).toBe("degraded_validation");
        const stored = await Document.unscoped().findByPk(first.id, {
          rejectOnEmpty: true,
        });
        return JSON.stringify(response?.result)
          .split(stored.id)
          .join("<allocated>")
          .split(stored.urlId)
          .join("<urlId>");
      })
    );
    expect(texts[1]).toBe(texts[0]);
    expect(texts[0]).toContain("<allocated>");
  });
});

describe("tool discovery", () => {
  const PROPERTIES = {
    create_document: [
      "title",
      "text",
      "format",
      "sourceFileName",
      "collectionId",
      "parentDocumentId",
      "templateId",
      "icon",
      "color",
      "publish",
      "fullWidth",
    ],
    update_document: [
      "id",
      "title",
      "text",
      "editMode",
      "findText",
      "collectionId",
      "icon",
      "color",
      "publish",
      "fullWidth",
    ],
  };

  it("lists identical write tools with and without an enforced configuration", async () => {
    const { user, accessToken } = await buildOAuthUser();
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    /**
     * Lists the write tools a token discovers.
     *
     * @returns each write tool by name.
     */
    const writeTools = async () => {
      const response = await rpc(accessToken, "tools/list");
      expect(response.error).toBeUndefined();
      const tools = (response.result?.tools ?? []) as {
        name: string;
        inputSchema: { properties: Record<string, unknown> };
      }[];
      return Object.keys(PROPERTIES).map((name) =>
        tools.find((tool) => tool.name === name)
      );
    };

    configure([]);
    const unconfigured = await writeTools();
    configure([[collection, ENFORCED]]);
    const enforced = await writeTools();

    expect(enforced).toEqual(unconfigured);
    expect(
      unconfigured.map((tool) => Object.keys(tool!.inputSchema.properties))
    ).toEqual(Object.values(PROPERTIES));
  });
});
