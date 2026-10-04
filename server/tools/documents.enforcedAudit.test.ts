import { createHash, randomUUID } from "node:crypto";
import { Op, QueryTypes } from "sequelize";
import { DocumentPermission, Scope, TextEditMode } from "@shared/types";
import Logger from "@server/logging/Logger";
import { Event, UserMembership } from "@server/models";
import type { Collection, Document, User } from "@server/models";
import { globalEventQueue } from "@server/queues";
import { sequelize } from "@server/storage/database";
import {
  buildAdmin,
  buildCollection,
  buildDocument,
  buildOAuthAuthentication,
  buildOAuthClient,
  buildUser,
} from "@server/test/factories";
import { buildOAuthUser, callMcpTool } from "@server/test/McpHelper";
import { getTestServer } from "@server/test/support";
import type { AuditDataV1 } from "@server/wikiLint/adapters/auditEvents";
import type * as PolicyConfig from "@server/wikiLint/adapters/policyConfig";
import type * as DeadlineModule from "@server/wikiLint/application/deadline";
import {
  AUDIT_WRITE_BOUND_MS,
  POST_COMMIT_ASSEMBLY_BOUND_MS,
} from "@server/wikiLint/application/deadline";
import type { PolicySet } from "@server/wikiLint/core/policySet";
import { buildPolicySet } from "@server/wikiLint/core/policySet";
import {
  COLLECTION_CONFLICT,
  OPERATION_FAILED,
} from "@server/wikiLint/core/registry";

/** What the replaced seams serve; each passes through while unset. */
const state = vi.hoisted(() => ({
  policySet: undefined as PolicySet | undefined,
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

const REQUIRED = {
  kind: "required_sections",
  headingLevel: 2,
  headings: ["Overview"],
};

const DISCOURAGED = {
  kind: "discouraged_markdown_structures",
  structures: ["blockquote"],
};

const LINKS = { kind: "internal_links" };

/** Requires an Overview, warns on block quotes, and checks links. */
const ENFORCED = {
  activation: "enforced",
  rules: [REQUIRED, DISCOURAGED, LINKS],
};

/** `ENFORCED`, failing open on runtime failures. */
const OPEN = { ...ENFORCED, runtimeFailureMode: "open" };

const READ_ONLY = { activation: "read_only", rules: [REQUIRED] };

/** An empty rule list fails validation, so the entry becomes a sentinel. */
const SENTINEL = { activation: "read_only", rules: [] };

/** A body that satisfies `ENFORCED`. */
const VALID = "## Overview\n\nAll good.";

/** A valid body with a discouraged block quote. */
const QUOTED = `${VALID}\n\n> quoted`;

/** A body without the required section. */
const BODY = "Text without the required section";

/** An HTML body that satisfies `ENFORCED`. */
const VALID_HTML = "<h1>T</h1><h2>Overview</h2><p>ok</p>";

/**
 * Builds a valid body with one internal link.
 *
 * @param ref - the linked document reference.
 * @returns the body.
 */
const linked = (ref: string) => `${VALID}\n\n[target](/doc/${ref})`;

const WRITE_SUMMARY = "wikiLint.write_validation";

/** Every key closed `AuditDataV1` allows. */
const AUDIT_KEYS = [
  "schemaVersion",
  "requestId",
  "operation",
  "outcome",
  "complete",
  "durationMs",
  "scopeKind",
  "policySchemaVersion",
  "policyFingerprint",
  "evaluatedDocumentCount",
  "evaluatedLinkCount",
  "counts",
  "runtimeFailOpenExercised",
  "credentialAuthType",
  "authenticatedClientId",
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The counts of a summary without any issue. */
const NO_COUNTS = { errors: 0, warnings: 0, systemFailures: 0, byCode: {} };

/** The aggregate fields of an aborted summary. */
const ABORTED = {
  complete: false,
  evaluatedDocumentCount: 0,
  counts: NO_COUNTS,
};

/** The aggregate fields of a summary rejected by one missing section. */
const MISSING_SECTION = {
  outcome: "rejected",
  complete: true,
  counts: {
    errors: 1,
    warnings: 0,
    systemFailures: 0,
    byCode: { REQUIRED_SECTION_MISSING: 1 },
  },
};

/**
 * Builds the aggregate fields of a summary with one System Failure and no
 * evaluated document: a fail-closed or invalid-policy rejection.
 *
 * @param code - the System Failure code.
 * @returns the fields.
 */
const failureRejection = (code: string) => ({
  outcome: "rejected",
  complete: false,
  evaluatedDocumentCount: 0,
  counts: { errors: 0, warnings: 0, systemFailures: 1, byCode: { [code]: 1 } },
});

type McpResponse = Awaited<ReturnType<typeof callMcpTool>>;

/** One stored write summary. */
type Summary = Event & { data: AuditDataV1 };

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
  state.policySet = result.policySet;
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
 * @returns a function that restores the real query.
 */
function interceptQueries(...handlers: QueryHandler[]): () => void {
  const original = sequelize.query.bind(sequelize) as unknown as (
    ...args: unknown[]
  ) => Promise<unknown>;
  const spy = vi.spyOn(sequelize, "query").mockImplementation(((
    ...args: unknown[]
  ) => {
    const [first] = args;
    const sql =
      typeof first === "string" ? first : (first as { query: string }).query;
    return handlers.reduceRight<() => Promise<unknown>>(
      (next, handler) => () => handler(sql, args, next, original),
      () => original(...args)
    )();
  }) as unknown as typeof sequelize.query);
  return () => spy.mockRestore();
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
 * Reads the bound values of a query.
 *
 * @param args - the query arguments.
 * @returns the values.
 */
const bindOf = (args: unknown[]) =>
  (args[1] as { bind?: unknown[] } | undefined)?.bind ?? [];

/**
 * Whether a statement is the write summary's insert; model inserts quote
 * the table name.
 *
 * @param sql - the statement.
 * @returns whether it inserts a summary.
 */
const isSummaryInsert = (sql: string) => sql.startsWith("INSERT INTO events (");

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
 * Builds an actor with an OAuth token and a collection under a policy.
 *
 * @param policy - the collection's policy; unconfigured when omitted.
 * @returns the fixture.
 */
async function fixture(policy?: object) {
  const actor = await buildOAuthUser();
  const collection = await buildCollection({
    teamId: actor.user.teamId,
    userId: actor.user.id,
  });
  const set = configure(policy ? [[collection, policy]] : []);
  // Settles the throttled authentication activity writes first.
  await callMcpTool(server, actor.accessToken, "list_collections");
  return { ...actor, collection, set };
}

/**
 * Builds a document of an actor.
 *
 * @param user - the actor.
 * @param collectionId - its collection.
 * @param overrides - other attributes.
 * @returns the document.
 */
const documentIn = (
  user: User,
  collectionId: string | null,
  overrides: Parameters<typeof buildDocument>[0] = {}
) =>
  buildDocument({
    teamId: user.teamId,
    userId: user.id,
    collectionId,
    title: "Target",
    text: VALID,
    ...overrides,
  });

/**
 * Reads a team's stored write summaries, oldest first, and checks that each
 * is closed, collection-scoped `AuditDataV1`.
 *
 * @param teamId - the team.
 * @returns the summaries.
 */
async function summariesOf(teamId: string): Promise<Summary[]> {
  const events = (await Event.findAll({
    where: { teamId, name: WRITE_SUMMARY },
    order: [["createdAt", "ASC"]],
    raw: true,
  })) as Summary[];
  for (const { data } of events) {
    expect(AUDIT_KEYS).toEqual(expect.arrayContaining(Object.keys(data)));
    expect(data.scopeKind).toBe("collection");
  }
  return events;
}

/**
 * Builds the expected data of a summary written through `/mcp` with an OAuth
 * token; fields not given are those of a clean committed write.
 *
 * @param input.operation - the write operation.
 * @param input.policyFingerprint - the valid policy fingerprint; omitted
 *   for a sentinel.
 * @param input.data - the fields that differ.
 * @returns the matcher.
 */
const expectedData = (input: {
  operation: AuditDataV1["operation"];
  policyFingerprint?: string;
  data?: Record<string, unknown>;
}) => ({
  schemaVersion: 1,
  requestId: expect.stringMatching(UUID),
  operation: input.operation,
  outcome: "validated",
  complete: true,
  durationMs: expect.any(Number),
  scopeKind: "collection",
  ...(input.policyFingerprint !== undefined && {
    policySchemaVersion: 1,
    policyFingerprint: input.policyFingerprint,
  }),
  evaluatedDocumentCount: 1,
  evaluatedLinkCount: 0,
  counts: NO_COUNTS,
  runtimeFailOpenExercised: false,
  credentialAuthType: "oauth",
  authenticatedClientId: expect.any(String),
  ...input.data,
});

/**
 * Parses the first content block of a response.
 *
 * @param response - the response.
 * @returns the parsed block.
 */
const firstBlock = (response: McpResponse) =>
  JSON.parse(response?.result?.content?.[0]?.text ?? "{}");

/**
 * Records every global-queue enqueue from now on.
 *
 * @returns the enqueued Event names.
 */
function recordEnqueues(): string[] {
  const names: string[] = [];
  const queue = globalEventQueue();
  const add = queue.add.bind(queue);
  vi.spyOn(queue, "add").mockImplementation(((
    event: { name?: string },
    ...rest: unknown[]
  ) => {
    names.push(String(event?.name));
    return (add as (...args: unknown[]) => unknown)(event, ...rest);
  }) as never);
  return names;
}

afterEach(() => {
  state.policySet = undefined;
  state.clock = undefined;
  vi.restoreAllMocks();
});

describe("a committed Markdown create", () => {
  it("records its summary after COMMIT in its own bounded transaction, before any enqueue, correlated with every mutation Event", async () => {
    const { user, accessToken, collection, set } = await fixture(ENFORCED);
    const plain = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const log: { sql?: string; transaction?: unknown; enqueued?: string }[] =
      [];
    let enforcement: unknown;
    const queue = globalEventQueue();
    const add = queue.add.bind(queue);
    vi.spyOn(queue, "add").mockImplementation(((
      event: { name?: string },
      ...rest: unknown[]
    ) => {
      log.push({ enqueued: String(event?.name) });
      return (add as (...args: unknown[]) => unknown)(event, ...rest);
    }) as never);
    interceptQueries((sql, args, next) => {
      const transaction = transactionOf(args);
      if (sql.startsWith("SET LOCAL lock_timeout")) {
        enforcement = transaction;
      }
      log.push({ sql, transaction });
      return next();
    });

    const response = await callMcpTool(server, accessToken, "create_document", {
      title: "Written",
      text: VALID,
      collectionId: collection.id,
    });
    vi.restoreAllMocks();
    const baseline = await callMcpTool(server, accessToken, "create_document", {
      title: "Written",
      text: VALID,
      collectionId: plain.id,
    });

    // The baseline response, with validation appended.
    const first = firstBlock(response);
    expect(response?.result?.isError).toBeUndefined();
    expect(Object.keys(first)).toEqual([
      ...Object.keys(firstBlock(baseline)),
      "validation",
    ]);
    expect(first.validation.status).toBe("validated");

    const commit = log.findIndex(
      (entry) => entry.sql === "COMMIT;" && entry.transaction === enforcement
    );
    const inserts = log.filter((entry) => isSummaryInsert(entry.sql ?? ""));
    expect(inserts).toHaveLength(1);
    const insert = log.indexOf(inserts[0]);
    const audit = inserts[0].transaction;
    expect(commit).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(commit);
    expect(audit).toBeDefined();
    expect(audit).not.toBe(enforcement);
    const audited = log
      .filter((entry) => entry.transaction === audit)
      .map((entry) => entry.sql);
    const timeout = audited.indexOf(
      `SET LOCAL statement_timeout = ${AUDIT_WRITE_BOUND_MS}`
    );
    expect(timeout).toBeGreaterThan(-1);
    expect(timeout).toBeLessThan(audited.indexOf(inserts[0].sql));
    const firstEnqueue = log.findIndex((entry) => entry.enqueued);
    expect(firstEnqueue).toBeGreaterThan(insert);
    expect(log.map((entry) => entry.enqueued ?? "")).not.toContainEqual(
      expect.stringMatching(/^wikiLint\./)
    );

    const [summary, ...others] = await summariesOf(user.teamId);
    expect(others).toEqual([]);
    expect(summary).toMatchObject({
      collectionId: collection.id,
      documentId: first.id,
      actorId: user.id,
    });
    expect(summary.data).toEqual(
      expectedData({
        operation: "create_document",
        policyFingerprint: fingerprintOf(set, collection.id),
      })
    );

    // Every mutation Event is correlated and keeps its baseline keys.
    const keysOf = async (documentId: string) =>
      Object.fromEntries(
        (await Event.findAll({ where: { documentId }, raw: true }))
          .filter((event) => event.name.startsWith("documents."))
          .map((event) => [event.name, event.data])
      ) as Record<string, Record<string, unknown>>;
    const enforced = await keysOf(first.id);
    const plainEvents = await keysOf(firstBlock(baseline).id);
    expect(Object.keys(enforced)).toContain("documents.create");
    expect(Object.keys(enforced).sort()).toEqual(
      Object.keys(plainEvents).sort()
    );
    for (const [name, data] of Object.entries(enforced)) {
      const { validationCorrelationId, ...rest } = data;
      expect(validationCorrelationId).toBe(summary.id);
      expect(Object.keys(rest).sort()).toEqual(
        Object.keys(plainEvents[name] ?? {}).sort()
      );
    }
  });
});

describe("each recorded AD-20 row", () => {
  /** One write that records a summary. */
  interface RecordedWrite {
    name: string;
    policy: object;
    tool: "create_document" | "update_document";
    /** Whether the update target has a child document. */
    child?: boolean;
    failReads?: boolean;
    args: (fixture: {
      collection: Collection;
      target: Document;
    }) => Record<string, unknown>;
    /** The `isError` text, for an abort. */
    error?: string;
    status?: string;
    data: Record<string, unknown>;
  }

  const WRITES: RecordedWrite[] = [
    {
      name: "a warning-only update",
      policy: ENFORCED,
      tool: "update_document",
      args: ({ target }) => ({ id: target.id, text: QUOTED }),
      status: "validated_with_warnings",
      data: {
        outcome: "validated_with_warnings",
        counts: {
          errors: 0,
          warnings: 1,
          systemFailures: 0,
          byCode: { DISCOURAGED_MARKDOWN_STRUCTURE: 1 },
        },
      },
    },
    {
      name: "a degraded create",
      policy: OPEN,
      tool: "create_document",
      failReads: true,
      args: ({ collection }) => ({
        title: "Degraded",
        text: linked(randomUUID()),
        collectionId: collection.id,
      }),
      status: "degraded_validation",
      data: {
        ...failureRejection("VALIDATION_RUNTIME_FAILED"),
        outcome: "degraded_validation",
        runtimeFailOpenExercised: true,
      },
    },
    {
      name: "an Error-rejected create",
      policy: ENFORCED,
      tool: "create_document",
      args: ({ collection }) => ({
        title: "Rejected",
        text: BODY,
        collectionId: collection.id,
      }),
      status: "rejected",
      data: MISSING_SECTION,
    },
    {
      name: "an Error-rejected update",
      policy: ENFORCED,
      tool: "update_document",
      args: ({ target }) => ({ id: target.id, text: BODY }),
      status: "rejected",
      data: MISSING_SECTION,
    },
    {
      name: "a fail-closed create",
      policy: ENFORCED,
      tool: "create_document",
      failReads: true,
      args: ({ collection }) => ({
        title: "Closed",
        text: linked(randomUUID()),
        collectionId: collection.id,
      }),
      status: "rejected",
      data: failureRejection("VALIDATION_RUNTIME_FAILED"),
    },
    {
      name: "a patch whose findText is absent",
      policy: ENFORCED,
      tool: "update_document",
      args: ({ target }) => ({
        id: target.id,
        text: "x",
        editMode: TextEditMode.Patch,
        findText: "absent text",
      }),
      error: "The specified text was not found in the document",
      data: { ...ABORTED, outcome: "aborted_before_decision" },
    },
    {
      name: "an unchanged update",
      policy: ENFORCED,
      tool: "update_document",
      args: ({ target }) => ({ id: target.id, title: "Target" }),
      error: OPERATION_FAILED,
      data: { ...ABORTED, outcome: "aborted_after_decision" },
    },
    {
      name: "an unpublish of a parent",
      policy: ENFORCED,
      tool: "update_document",
      child: true,
      args: ({ target }) => ({ id: target.id, publish: false }),
      error: "Cannot unpublish document with child documents",
      data: { ...ABORTED, outcome: "aborted_after_decision" },
    },
  ];

  it.each(WRITES)(
    "records exactly one summary for $name",
    async ({ policy, tool, child, failReads, args, error, status, data }) => {
      const { user, accessToken, collection, set } = await fixture(policy);
      const target = await documentIn(user, collection.id);
      if (child) {
        await documentIn(user, collection.id, { parentDocumentId: target.id });
      }
      const enqueued = recordEnqueues();
      if (failReads) {
        interceptQueries(failSavepointReads());
      }

      const response = await callMcpTool(
        server,
        accessToken,
        tool,
        args({ collection, target })
      );

      if (error) {
        expect(response?.result).toEqual({
          content: [{ type: "text", text: error }],
          isError: true,
        });
      } else {
        expect(response?.result?.isError).toBeUndefined();
        expect(firstBlock(response).validation.status).toBe(status);
      }
      const committed = status && status !== "rejected";
      const documentId =
        tool === "update_document"
          ? target.id
          : committed
            ? firstBlock(response).id
            : null;
      const [summary, ...others] = await summariesOf(user.teamId);
      expect(others).toEqual([]);
      expect(summary).toMatchObject({
        name: WRITE_SUMMARY,
        actorId: user.id,
        collectionId: collection.id,
        documentId,
        ip: expect.any(String),
      });
      expect(summary.data).toEqual(
        expectedData({
          operation: tool,
          policyFingerprint: fingerprintOf(set, collection.id),
          data,
        })
      );
      expect(enqueued.filter((name) => name.startsWith("wikiLint."))).toEqual(
        []
      );
      if (committed) {
        const events = await Event.findAll({
          where: { documentId, name: { [Op.ne]: WRITE_SUMMARY } },
        });
        expect(events.length).toBeGreaterThan(0);
        for (const event of events) {
          expect(event.data?.validationCorrelationId).toBe(summary.id);
        }
      } else {
        expect(
          await sequelize.query(
            `SELECT id FROM events WHERE data->>'validationCorrelationId' = :id`,
            { replacements: { id: summary.id }, type: QueryTypes.SELECT }
          )
        ).toEqual([]);
      }
    }
  );

  it.each([
    {
      name: "row 3",
      args: (id: string) => ({
        id,
        text: "x",
        editMode: TextEditMode.Patch,
        findText: "absent text",
      }),
    },
    { name: "row 4", args: (id: string) => ({ id, text: BODY }) },
    {
      name: "row 5",
      child: true,
      args: (id: string) => ({ id, publish: false }),
    },
  ])(
    "inserts the $name summary while no correlated Event exists and the target is unchanged",
    async ({ child, args }) => {
      const { user, accessToken, collection } = await fixture(ENFORCED);
      const target = await documentIn(user, collection.id);
      if (child) {
        await documentIn(user, collection.id, { parentDocumentId: target.id });
      }
      const seen: unknown[] = [];
      interceptQueries(async (sql, queryArgs, next, original) => {
        if (isSummaryInsert(sql)) {
          // Fresh connections, outside every transaction of the write.
          const [id] = bindOf(queryArgs);
          const correlated = await original(
            `SELECT id FROM events WHERE data->>'validationCorrelationId' = :id`,
            { replacements: { id }, type: QueryTypes.SELECT }
          );
          const [stored] = (await original(
            `SELECT "revisionCount" FROM documents WHERE id = :id`,
            { replacements: { id: target.id }, type: QueryTypes.SELECT }
          )) as { revisionCount: number }[];
          seen.push({ id, correlated, revisionCount: stored.revisionCount });
        }
        return next();
      });

      await callMcpTool(
        server,
        accessToken,
        "update_document",
        args(target.id)
      );

      const [summary] = await summariesOf(user.teamId);
      expect(seen).toEqual([
        {
          id: summary.id,
          correlated: [],
          revisionCount: target.revisionCount,
        },
      ]);
    }
  );
});

describe("the summary duration", () => {
  it("measures from the handler's first monotonic clock reading", async () => {
    const { user, accessToken, collection } = await fixture(ENFORCED);
    const sentinel = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    configure([
      [collection, ENFORCED],
      [sentinel, SENTINEL],
    ]);
    const target = await documentIn(user, collection.id);

    for (const [tool, args] of [
      [
        "create_document",
        { title: "Timed", text: VALID, collectionId: collection.id },
      ],
      ["update_document", { id: target.id, text: "## Overview\n\nTimed." }],
      [
        "create_document",
        { title: "Timed", text: VALID, collectionId: sentinel.id },
      ],
    ] as const) {
      // Handler entry reads 5000; every later reading, 5012.
      let readings = 0;
      state.clock = () => (readings++ === 0 ? 5000 : 5012);
      const response = await callMcpTool(server, accessToken, tool, args);
      expect(response?.result?.isError).toBeUndefined();
    }

    expect(
      (await summariesOf(user.teamId)).map(({ data }) => [
        data.operation,
        data.outcome,
        data.durationMs,
      ])
    ).toEqual([
      ["create_document", "validated", 12],
      ["update_document", "validated", 12],
      ["create_document", "rejected", 12],
    ]);
  });
});

describe("an invalid-policy sentinel", () => {
  /**
   * Builds the modeled invalid-policy rejection for a collection reader.
   *
   * @param set - the served set.
   * @param collectionId - the sentinel collection.
   * @returns the exact text of the first content block.
   */
  const sentinelRejection = (set: PolicySet, collectionId: string) =>
    JSON.stringify({
      success: false,
      validation: {
        status: "rejected",
        invalidFingerprint: fingerprintOf(set, collectionId),
        errors: [],
        warnings: [],
        systemFailures: [
          {
            code: "POLICY_CONFIGURATION_INVALID",
            message: "The collection lint policy is invalid.",
            location: { kind: "scope", scopeKind: "collection", collectionId },
          },
        ],
      },
    });

  it.each([
    {
      name: "a Markdown create",
      tool: "create_document" as const,
      args: (collection: Collection) => ({
        title: "Written",
        text: VALID,
        collectionId: collection.id,
      }),
    },
    {
      name: "an HTML create",
      tool: "create_document" as const,
      args: (collection: Collection) => ({
        title: "Written",
        text: VALID_HTML,
        format: "html",
        collectionId: collection.id,
      }),
    },
    {
      name: "an update",
      tool: "update_document" as const,
      args: (_collection: Collection, target: Document) => ({
        id: target.id,
        text: VALID,
      }),
    },
  ])(
    "records $name rejection without policy fields, in its only transaction",
    async ({ tool, args }) => {
      const { user, accessToken, collection, set } = await fixture(SENTINEL);
      const target = await documentIn(user, collection.id);
      const transaction = vi.spyOn(sequelize, "transaction");

      const response = await callMcpTool(
        server,
        accessToken,
        tool,
        args(collection, target)
      );

      expect(response?.result?.isError).toBeUndefined();
      expect(response?.result?.content).toHaveLength(1);
      expect(response?.result?.content?.[0]?.text).toBe(
        sentinelRejection(set, collection.id)
      );
      expect(transaction).toHaveBeenCalledTimes(1);
      const [summary, ...others] = await summariesOf(user.teamId);
      expect(others).toEqual([]);
      expect(summary).toMatchObject({
        collectionId: collection.id,
        documentId: tool === "update_document" ? target.id : null,
        actorId: user.id,
      });
      expect(summary.data).toEqual(
        expectedData({
          operation: tool,
          data: failureRejection("POLICY_CONFIGURATION_INVALID"),
        })
      );
      expect(JSON.stringify(summary)).not.toContain(
        fingerprintOf(set, collection.id)
      );
    }
  );
});

describe("rows 1, 2, and 7", () => {
  it.each([
    ["an unconfigured", undefined],
    ["a read_only", READ_ONLY],
  ])(
    "records nothing for a write into %s collection",
    async (_name, policy) => {
      const { user, accessToken, collection } = await fixture(policy);
      const target = await documentIn(user, collection.id);

      const created = await callMcpTool(
        server,
        accessToken,
        "create_document",
        { title: "Written", text: BODY, collectionId: collection.id }
      );
      const updated = await callMcpTool(
        server,
        accessToken,
        "update_document",
        { id: target.id, text: BODY }
      );

      for (const response of [created, updated]) {
        expect(response?.result?.isError).toBeUndefined();
        expect(JSON.stringify(response)).not.toContain("validation");
      }
      expect(await summariesOf(user.teamId)).toEqual([]);
    }
  );

  it("records nothing for a write whose post-operation collection is null", async () => {
    const { user, accessToken } = await fixture(ENFORCED);
    const draft = await documentIn(user, null, { publishedAt: null });

    const created = await callMcpTool(server, accessToken, "create_document", {
      title: "Draft",
      text: BODY,
      publish: false,
    });
    const updated = await callMcpTool(server, accessToken, "update_document", {
      id: draft.id,
      text: BODY,
    });

    for (const response of [created, updated]) {
      expect(response?.result?.isError).toBeUndefined();
      expect(firstBlock(response).success).toBe(true);
      expect(JSON.stringify(response)).not.toContain("validation");
    }
    expect(await summariesOf(user.teamId)).toEqual([]);
  });

  it("records nothing past the P0 and P1 bound", async () => {
    const { user, accessToken, collection } = await fixture(ENFORCED);
    const target = await documentIn(user, collection.id);

    for (const [tool, args] of [
      [
        "create_document",
        { title: "Late", text: VALID, collectionId: collection.id },
      ],
      ["update_document", { id: target.id, text: VALID }],
    ] as const) {
      let readings = 0;
      state.clock = () => (readings++ === 0 ? 0 : 2001);
      expect(
        (await callMcpTool(server, accessToken, tool, args))?.result
      ).toEqual({
        content: [{ type: "text", text: OPERATION_FAILED }],
        isError: true,
      });
    }
    expect(await summariesOf(user.teamId)).toEqual([]);
  });

  it("records nothing for a collection conflict", async () => {
    const { user, accessToken, collection } = await fixture(ENFORCED);
    const other = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const parent = await documentIn(user, collection.id);
    let moved = false;
    interceptQueries(async (sql, _args, next, original) => {
      if (
        !moved &&
        /FROM collections WHERE id = .* FOR NO KEY UPDATE/.test(sql)
      ) {
        moved = true;
        await original(
          `UPDATE documents SET "collectionId" = '${other.id}' WHERE id = '${parent.id}'`
        );
      }
      return next();
    });

    const response = await callMcpTool(server, accessToken, "create_document", {
      title: "Child",
      text: VALID,
      parentDocumentId: parent.id,
    });

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
    expect(await summariesOf(user.teamId)).toEqual([]);
  });

  it("records nothing when the COMMIT outcome cannot be established", async () => {
    const { user, accessToken, collection } = await fixture(ENFORCED);
    let enforcement: unknown;
    let destroyed = false;
    interceptQueries((sql, args, next) => {
      const transaction = transactionOf(args);
      if (sql.startsWith("SET LOCAL lock_timeout")) {
        enforcement = transaction;
      }
      if (sql === "COMMIT;" && transaction === enforcement) {
        destroyed = true;
        (
          transaction as {
            connection: { connection: { stream: { destroy(): void } } };
          }
        ).connection.connection.stream.destroy();
      }
      return next();
    });

    const response = await callMcpTool(server, accessToken, "create_document", {
      title: "Unestablished",
      text: VALID,
      collectionId: collection.id,
    });

    expect(destroyed).toBe(true);
    expect(response?.result).toEqual({
      content: [{ type: "text", text: OPERATION_FAILED }],
      isError: true,
    });
    vi.restoreAllMocks();
    expect(await summariesOf(user.teamId)).toEqual([]);
  });
});

describe("an audit failure", () => {
  /**
   * Normalizes a response's written document identity.
   *
   * @param response - the response.
   * @param document - the written document.
   * @returns the normalized result.
   */
  const normalized = (response: McpResponse, document: Document) =>
    JSON.parse(
      JSON.stringify(response?.result)
        .split(document.id)
        .join("<id>")
        .split(document.urlId)
        .join("<urlId>")
    );

  it.each([
    { reason: "error", outcome: "a committed", text: "## Overview\n\nNew." },
    { reason: "error", outcome: "a rejected", text: BODY },
    { reason: "timeout", outcome: "a committed", text: "## Overview\n\nNew." },
  ] as const)(
    "returns $outcome update's healthy response and logs one minimized $reason warning",
    async ({ reason, text }) => {
      const { user, accessToken, collection } = await fixture(ENFORCED);
      const [healthyTarget, failingTarget] = [
        await documentIn(user, collection.id),
        await documentIn(user, collection.id),
      ];
      const healthy = await callMcpTool(
        server,
        accessToken,
        "update_document",
        {
          id: healthyTarget.id,
          text,
        }
      );
      const warn = vi.spyOn(Logger, "warn");
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let insert: Promise<unknown> | undefined;
      let auditStarted: number | undefined;
      let invocationId: unknown;
      interceptQueries((sql, args, next) => {
        if (isSummaryInsert(sql)) {
          auditStarted = performance.now();
          [invocationId] = bindOf(args);
          if (reason === "error") {
            return Promise.reject(new Error(`refused ${failingTarget.id}`));
          }
          insert = held.then(next);
          return insert;
        }
        return next();
      });

      const failing = await callMcpTool(
        server,
        accessToken,
        "update_document",
        {
          id: failingTarget.id,
          text,
        }
      );
      const elapsed = performance.now() - auditStarted!;
      release();
      await insert;

      expect(normalized(failing, failingTarget)).toEqual(
        normalized(healthy, healthyTarget)
      );
      if (text !== BODY) {
        expect(Object.keys(firstBlock(failing))).toContain("breadcrumb");
      }
      if (reason === "timeout") {
        expect(elapsed).toBeGreaterThanOrEqual(AUDIT_WRITE_BOUND_MS - 50);
        expect(elapsed).toBeLessThan(
          AUDIT_WRITE_BOUND_MS + POST_COMMIT_ASSEMBLY_BOUND_MS
        );
        // The held summary still lands, once, after the response.
        await vi.waitFor(async () =>
          expect(
            (await summariesOf(user.teamId))
              .filter((summary) => summary.id === invocationId)
              .map((summary) => summary.data.outcome)
          ).toEqual(["validated"])
        );
      }
      const warnings = warn.mock.calls.filter(
        ([message]) => message === "Wiki lint audit write failed"
      );
      expect(warnings).toEqual([
        [
          "Wiki lint audit write failed",
          { requestId: expect.stringMatching(UUID), invocationId, reason },
        ],
      ]);
      expect(Object.keys(warnings[0][1] as object)).toEqual([
        "requestId",
        "invocationId",
        "reason",
      ]);
      expect(JSON.stringify(warn.mock.calls)).not.toContain(failingTarget.id);
    },
    15000
  );
});

describe("actor independence", () => {
  it("records equal data and columns for a non-reader and a reader", async () => {
    const owner = await buildUser();
    const client = await buildOAuthClient({ teamId: owner.teamId });
    /**
     * Builds an OAuth actor of the shared client.
     *
     * @param user - the user.
     * @returns the actor and their token.
     */
    const actorOf = async (user: User) => {
      const auth = await buildOAuthAuthentication({
        user,
        oauthClientId: client.id,
        scope: [Scope.Read, Scope.Write, Scope.Create],
      });
      return { user, accessToken: auth.accessToken! };
    };
    const member = await actorOf(owner);
    const documentEditor = await actorOf(
      await buildUser({ teamId: owner.teamId })
    );
    const collection = await buildCollection({
      teamId: owner.teamId,
      userId: owner.id,
      permission: null,
    });
    const document = await documentIn(owner, collection.id, {
      title: "Shared",
    });
    await UserMembership.create({
      documentId: document.id,
      userId: documentEditor.user.id,
      createdById: owner.id,
      permission: DocumentPermission.ReadWrite,
    });
    const set = configure([[collection, ENFORCED]]);

    const responses = [];
    for (const actor of [documentEditor, member]) {
      await callMcpTool(server, actor.accessToken, "list_collections");
      responses.push(
        await callMcpTool(server, actor.accessToken, "update_document", {
          id: document.id,
          text: BODY,
        })
      );
    }

    // The responses differ by readability; the summaries do not.
    const [hidden, visible] = responses.map(firstBlock);
    expect(hidden.validation).not.toHaveProperty("policyFingerprint");
    expect(visible.validation).toHaveProperty("policyFingerprint");
    const summaries = await summariesOf(owner.teamId);
    expect(summaries).toHaveLength(2);
    const editorSummary = summaries.find(
      (summary) => summary.actorId === documentEditor.user.id
    )!;
    const memberSummary = summaries.find(
      (summary) => summary.actorId === member.user.id
    )!;
    /**
     * Strips the request-specific fields of a summary.
     *
     * @param summary - the summary.
     * @returns the comparable columns and data.
     */
    const comparable = ({ collectionId, documentId, data }: Summary) => {
      const { requestId: _requestId, durationMs: _durationMs, ...rest } = data;
      return { collectionId, documentId, data: rest };
    };
    expect(comparable(editorSummary)).toEqual(comparable(memberSummary));
    expect(comparable(editorSummary)).toEqual({
      collectionId: collection.id,
      documentId: document.id,
      data: expect.objectContaining({
        outcome: "rejected",
        policySchemaVersion: 1,
        policyFingerprint: fingerprintOf(set, collection.id),
      }),
    });
  });
});

describe("the operator audit surface", () => {
  it("lets a same-team admin compute every aggregate from minimized summaries, and nobody else see them", async () => {
    const admin = await buildAdmin();
    const writer = await buildOAuthUser({ teamId: admin.teamId });
    const editor = await buildOAuthUser({ teamId: admin.teamId });
    const outsider = await buildUser({ teamId: admin.teamId });
    const build = (overrides: Parameters<typeof buildCollection>[0] = {}) =>
      buildCollection({
        teamId: admin.teamId,
        userId: writer.user.id,
        ...overrides,
      });
    const strict = await build();
    const open = await build();
    const sentinel = await build();
    const hidden = await buildCollection({
      teamId: admin.teamId,
      userId: outsider.id,
      permission: null,
    });
    const unreadable = await documentIn(outsider, hidden.id, {
      title: "Protected target title",
    });
    const missing = randomUUID();
    const set = configure([
      [strict, ENFORCED],
      [open, OPEN],
      [sentinel, SENTINEL],
    ]);
    const [warned, rejected, absent, unchanged] = [
      await documentIn(editor.user, strict.id),
      await documentIn(editor.user, strict.id),
      await documentIn(editor.user, strict.id),
      await documentIn(editor.user, strict.id),
    ];
    for (const actor of [writer, editor]) {
      await callMcpTool(server, actor.accessToken, "list_collections");
    }
    const enqueued = recordEnqueues();
    const responses: McpResponse[] = [];
    /**
     * Writes through `/mcp`, optionally with failing link reads.
     *
     * @param actor - the actor.
     * @param tool - the tool.
     * @param args - the arguments.
     * @param failReads - whether savepoint reads fail.
     * @returns the response.
     */
    const write = async (
      actor: { accessToken: string },
      tool: string,
      args: Record<string, unknown>,
      failReads = false
    ) => {
      const restore = failReads
        ? interceptQueries(failSavepointReads())
        : () => undefined;
      try {
        const response = await callMcpTool(
          server,
          actor.accessToken,
          tool,
          args
        );
        responses.push(response);
        return response;
      } finally {
        restore();
      }
    };

    const created = await write(writer, "create_document", {
      title: "Valid",
      text: VALID,
      collectionId: strict.id,
    });
    await write(editor, "update_document", { id: warned.id, text: QUOTED });
    await write(
      writer,
      "create_document",
      { title: "Degraded", text: linked(randomUUID()), collectionId: open.id },
      true
    );
    await write(editor, "update_document", { id: rejected.id, text: BODY });
    await write(
      writer,
      "create_document",
      { title: "Closed", text: linked(randomUUID()), collectionId: strict.id },
      true
    );
    await write(writer, "create_document", {
      title: "Sentinel",
      text: VALID,
      collectionId: sentinel.id,
    });
    await write(editor, "update_document", {
      id: absent.id,
      text: "x",
      editMode: TextEditMode.Patch,
      findText: "absent text",
    });
    await write(editor, "update_document", {
      id: unchanged.id,
      title: "Target",
    });
    await write(writer, "create_document", {
      title: "Imported",
      text: VALID_HTML,
      format: "html",
      collectionId: strict.id,
    });
    const linkRejections = [
      await write(writer, "create_document", {
        title: "Unreadable",
        text: linked(unreadable.id),
        collectionId: strict.id,
      }),
      await write(writer, "create_document", {
        title: "Missing",
        text: linked(missing),
        collectionId: strict.id,
      }),
    ];
    for (const response of linkRejections) {
      expect(firstBlock(response).validation.errors).toEqual([
        expect.objectContaining({ code: "INTERNAL_LINK_TARGET_UNRESOLVED" }),
      ]);
    }

    // No summary reaches the global queue, and none holds content.
    expect(enqueued.filter((name) => name.startsWith("wikiLint."))).toEqual([]);
    const stored = await summariesOf(admin.teamId);
    expect(stored).toHaveLength(11);
    const messages = responses.flatMap((response) => {
      const validation = (!response?.result?.isError &&
        firstBlock(response).validation) || {
        errors: [],
        warnings: [],
        systemFailures: [],
      };
      return [
        ...validation.errors,
        ...validation.warnings,
        ...validation.systemFailures,
      ].map((issue: { message: string }) => issue.message);
    });
    expect(messages.length).toBeGreaterThan(0);
    const storedText = JSON.stringify(stored.map((summary) => summary.data));
    for (const forbidden of [
      "All good",
      BODY,
      "quoted",
      "Overview",
      "Protected target title",
      unreadable.id,
      unreadable.urlId,
      missing,
      fingerprintOf(set, sentinel.id),
      "invalidFingerprint",
      "detail",
      "location",
      "message",
      ...messages,
    ]) {
      expect(storedText, forbidden).not.toContain(forbidden);
    }
    const [unreadableSummary, missingSummary] = stored.slice(-2);
    expect(unreadableSummary.data.counts).toEqual(missingSummary.data.counts);
    expect(unreadableSummary.data.counts.byCode).toEqual({
      INTERNAL_LINK_TARGET_UNRESOLVED: 1,
    });

    // The admin computes every aggregate from the listing alone.
    const res = await server.post("/api/events.list", admin, {
      body: { auditWikiLint: true, limit: 100 },
    });
    expect(res.status).toBe(200);
    const listing: { id: string; name: string; data: AuditDataV1 }[] = (
      await res.json()
    ).data;
    expect(listing.map((event) => event.id).sort()).toEqual(
      stored.map((summary) => summary.id).sort()
    );
    const listed = listing.map((event) => event.data);
    /**
     * Counts the listed summaries by a key.
     *
     * @param key - the key.
     * @returns the counts.
     */
    const countBy = (key: (data: AuditDataV1) => string) =>
      listed.reduce<Record<string, number>>((counts, data) => {
        counts[key(data)] = (counts[key(data)] ?? 0) + 1;
        return counts;
      }, {});
    const byCode: Record<string, number> = {};
    for (const data of listed) {
      for (const [code, count] of Object.entries(data.counts.byCode)) {
        byCode[code] = (byCode[code] ?? 0) + (count ?? 0);
      }
    }
    const total = (key: "errors" | "warnings" | "systemFailures") =>
      listed.reduce((sum, data) => sum + data.counts[key], 0);
    expect({
      operation: countBy((data) => data.operation),
      outcome: countBy((data) => data.outcome),
      complete: countBy((data) => String(data.complete)),
      errors: total("errors"),
      warnings: total("warnings"),
      systemFailures: total("systemFailures"),
      byCode,
      aborted: listed.filter((data) => data.outcome.startsWith("aborted_"))
        .length,
      degraded: listed.filter((data) => data.runtimeFailOpenExercised).length,
    }).toEqual({
      operation: { create_document: 7, update_document: 4 },
      outcome: {
        validated: 2,
        validated_with_warnings: 1,
        degraded_validation: 1,
        rejected: 5,
        aborted_before_decision: 1,
        aborted_after_decision: 1,
      },
      complete: { true: 6, false: 5 },
      errors: 3,
      warnings: 1,
      systemFailures: 3,
      byCode: {
        DISCOURAGED_MARKDOWN_STRUCTURE: 1,
        INTERNAL_LINK_TARGET_UNRESOLVED: 2,
        POLICY_CONFIGURATION_INVALID: 1,
        REQUIRED_SECTION_MISSING: 1,
        VALIDATION_RUNTIME_FAILED: 2,
      },
      aborted: 2,
      degraded: 1,
    });
    for (const data of listed) {
      expect(Number.isInteger(data.durationMs)).toBe(true);
      expect(data.durationMs).toBeGreaterThanOrEqual(0);
    }
    const listingText = JSON.stringify(listing);
    for (const forbidden of [unreadable.id, unreadable.urlId, missing]) {
      expect(listingText).not.toContain(forbidden);
    }

    // A member cannot use the surface, nor find a summary in activity.
    const denied = await server.post("/api/events.list", writer.user, {
      body: { auditWikiLint: true },
    });
    expect(denied.status).toBe(403);
    for (const documentId of [firstBlock(created).id, rejected.id]) {
      const activity = await server.post("/api/events.list", writer.user, {
        body: { documentId },
      });
      expect(activity.status).toBe(200);
      const names = (await activity.json()).data.map(
        (event: { name: string }) => event.name
      );
      expect(
        names.filter((name: string) => name.startsWith("wikiLint."))
      ).toEqual([]);
    }

    // Another team's admin sees none of them.
    const otherAdmin = await buildAdmin();
    const other = await server.post("/api/events.list", otherAdmin, {
      body: { auditWikiLint: true, limit: 100 },
    });
    expect(other.status).toBe(200);
    const otherIds = (await other.json()).data.map(
      (event: { id: string }) => event.id
    );
    for (const summary of stored) {
      expect(otherIds).not.toContain(summary.id);
    }
  }, 30000);
});
