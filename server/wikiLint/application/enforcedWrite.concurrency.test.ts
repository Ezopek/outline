import { createHash, randomUUID } from "node:crypto";
import type { Transaction } from "sequelize";
import { QueryTypes } from "sequelize";
import { APIUpdateExtension } from "@server/collaboration/APIUpdateExtension";
import {
  authorizeDocumentCreate,
  authorizeDocumentPublish,
} from "@server/commands/documentCreator";
import { createContext } from "@server/context";
import { Document, Event } from "@server/models";
import type { User } from "@server/models";
import { authorize } from "@server/policies";
import { globalEventQueue } from "@server/queues";
import { sequelize } from "@server/storage/database";
import {
  buildCollection,
  buildDocument,
  buildUser,
} from "@server/test/factories";
import { getTestServer } from "@server/test/support";
import { lintWikiTool } from "@server/tools/wikiLint";
import type { APIContext } from "@server/types";
import { AuthenticationType } from "@server/types";
import type {
  MarkdownCreateInput,
  MarkdownUpdateInput,
} from "../adapters/documentProjection";
import type { PolicySet } from "../core/policySet";
import { buildPolicySet } from "../core/policySet";
import { OPERATION_FAILED } from "../core/registry";
import type * as DeadlineModule from "./deadline";
import {
  COMMIT_PROBE_BOUND_MS,
  SET_LOCAL_FLOOR_MS,
  VALIDATION_DEADLINE_MS,
  WRITE_PERSISTENCE_BUDGET_MS,
} from "./deadline";
import type {
  EnforcedClassification,
  EnforcedWriteOutcome,
} from "./enforcedWrite";
import { enforceMarkdownCreate, enforceMarkdownUpdate } from "./enforcedWrite";

/** The served monotonic clock; the real clock serves when unset. */
const state = vi.hoisted(() => ({
  clock: undefined as (() => number) | undefined,
}));

vi.mock("@server/wikiLint/application/deadline", async (importOriginal) => {
  const actual = await importOriginal<typeof DeadlineModule>();
  return {
    ...actual,
    monotonicClock: () => (state.clock ?? actual.monotonicClock)(),
  };
});

const server = getTestServer();

const ORIGIN = "https://wiki.example.test";

/** The audit inputs of the helpers' writes, with a no-op summary writer. */
const audit = {
  extra: {
    requestId: "00000000-0000-4000-8000-00000000a001",
    credentialAuthType: "api",
  },
  enteredAt: 0,
  write: async () => undefined,
};

const sha256Hex = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const REQUIRED = {
  kind: "required_sections",
  headingLevel: 2,
  headings: ["Overview"],
};

const VALID_BODY = "## Overview\n\nAll good.";

/** A transaction's pg client, as the socket fixtures reach it. */
type PgClient = { connection: { stream: { destroy(): void } } };

/**
 * Builds a policy set with one enforced collection.
 *
 * @param collectionId - the collection.
 * @param rules - its rules.
 * @param open - whether runtime failures may fail open.
 * @returns the set and the enforced classification of a write into it.
 */
function enforcedPolicy(
  collectionId: string,
  rules: unknown[],
  open = false
): {
  policySet: PolicySet;
  classify: (create?: boolean) => EnforcedClassification;
} {
  const result = buildPolicySet(
    Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        collections: {
          [collectionId]: {
            activation: "enforced",
            ...(open && { runtimeFailureMode: "open" }),
            rules,
          },
        },
      }),
      "utf8"
    ),
    sha256Hex
  );
  if (!result.ok || result.policySet.entries[0].status !== "valid") {
    throw new Error("The test policy must be valid");
  }
  const entry = result.policySet.entries[0];
  return {
    policySet: result.policySet,
    classify: (create = false) =>
      Object.freeze({
        kind: "enforced" as const,
        entry,
        readable: true,
        ...(create && { documentId: randomUUID() }),
      }),
  };
}

/**
 * Builds the MCP-style API context of an actor.
 *
 * @param user - the actor.
 * @returns the context.
 */
const contextOf = (user: User) =>
  createContext({ user, ip: "127.0.0.1", authType: AuthenticationType.MCP });

/**
 * Runs an enforced create with the MCP handler's P0 as its re-authorization.
 *
 * @param ctx - the context.
 * @param classification - the classification.
 * @param input - the create arguments, with the location.
 * @returns the outcome.
 */
function create(
  ctx: APIContext,
  classification: EnforcedClassification,
  input: MarkdownCreateInput & { collectionId?: string }
): Promise<EnforcedWriteOutcome> {
  const { collectionId, ...mapped } = input;
  return enforceMarkdownCreate({
    ctx,
    classification,
    input: mapped,
    reauthorize: async () => {
      const { collection } = await authorizeDocumentCreate(ctx, {
        collectionId,
        parentDocumentId: mapped.parentDocumentId,
      });
      return { collectionId: collection?.id };
    },
    audit,
    instanceOrigin: ORIGIN,
  });
}

/**
 * Runs an enforced update with the MCP handler's P0 as its
 * re-authorization.
 *
 * @param ctx - the context.
 * @param classification - the classification.
 * @param input - the update arguments, with the target.
 * @returns the outcome.
 */
function update(
  ctx: APIContext,
  classification: EnforcedClassification,
  input: MarkdownUpdateInput & { id: string }
): Promise<EnforcedWriteOutcome> {
  const { id, ...mapped } = input;
  return enforceMarkdownUpdate({
    ctx,
    classification,
    documentId: id,
    input: mapped,
    reauthorize: async () => {
      const { user } = ctx.state.auth;
      const document = await Document.findByPk(id, {
        userId: user.id,
        includeState: true,
        rejectOnEmpty: true,
        transaction: ctx.state.transaction,
      });
      let collectionId = document.collectionId;
      if (mapped.publish === false) {
        authorize(user, "unpublish", document);
      } else {
        authorize(user, "update", document);
        if (mapped.publish) {
          collectionId = (await authorizeDocumentPublish(ctx, document))?.id;
        }
      }
      return { document, collectionId };
    },
    audit,
    instanceOrigin: ORIGIN,
  });
}

type QueryHandler = (
  sql: string,
  options: { transaction?: Transaction } | undefined,
  next: () => Promise<unknown>
) => Promise<unknown>;

/**
 * Replaces `sequelize.query` with handlers around the real query.
 *
 * @returns a way to add handlers.
 */
function interceptQueries() {
  const original = sequelize.query.bind(sequelize) as unknown as (
    ...args: unknown[]
  ) => Promise<unknown>;
  const handlers: QueryHandler[] = [];
  vi.spyOn(sequelize, "query").mockImplementation(((...args: unknown[]) => {
    const [first, options] = args;
    const sql =
      typeof first === "string" ? first : (first as { query: string }).query;
    const run = handlers.reduceRight<() => Promise<unknown>>(
      (next, handler) => () =>
        handler(sql, options as { transaction?: Transaction }, next),
      () => original(...args)
    );
    return run();
  }) as unknown as typeof sequelize.query);
  return { use: (handler: QueryHandler) => handlers.push(handler) };
}

/**
 * Holds the statement after the n-th `SET LOCAL lock_timeout` until
 * released.
 *
 * @param queries - the interceptor.
 * @param n - the one-based statement count.
 * @returns a promise for the hold, and the release.
 */
function holdAfterSetLocal(
  queries: ReturnType<typeof interceptQueries>,
  n: number
) {
  let seen = 0;
  let reached: () => void = () => undefined;
  let release: () => void = () => undefined;
  const atHold = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  queries.use(async (sql, _options, next) => {
    const result = await next();
    if (sql.startsWith("SET LOCAL lock_timeout") && ++seen === n) {
      reached();
      await released;
    }
    return result;
  });
  return { atHold, release };
}

/**
 * Waits until some backend waits on a lock while running a matching query.
 *
 * @param fragment - a fragment of the waiting query.
 */
async function waitForLockWait(fragment: string): Promise<void> {
  await vi.waitFor(
    async () => {
      const rows = await sequelize.query(
        "SELECT pid FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE :pattern",
        {
          replacements: { pattern: `%${fragment}%` },
          type: QueryTypes.SELECT,
        }
      );
      expect(rows.length).toBeGreaterThan(0);
    },
    { timeout: 5000, interval: 10 }
  );
}

/**
 * Builds an actor, a collection, and the actor's API context.
 *
 * @returns the fixture.
 */
async function fixture() {
  const user = await buildUser();
  const collection = await buildCollection({
    teamId: user.teamId,
    userId: user.id,
  });
  return { user, collection, ctx: contextOf(user) };
}

/**
 * Reads a document row as stored, if it exists.
 *
 * @param id - the document.
 * @returns the row, or null.
 */
const storedDocument = (id: string) =>
  Document.unscoped().findOne({ where: { id }, paranoid: false });

/**
 * Lists the names of the Events of a document.
 *
 * @param documentId - the document.
 * @returns the names.
 */
const eventNames = async (documentId: string) =>
  (await Event.findAll({ where: { documentId } })).map((event) => event.name);

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

afterEach(() => {
  state.clock = undefined;
  vi.restoreAllMocks();
});

describe("concurrent writers", () => {
  it("lets an enforced update of a parent and a baseline child create both commit", async () => {
    const { user, collection, ctx } = await fixture();
    const parent = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
      text: VALID_BODY,
    });
    const { classify } = enforcedPolicy(collection.id, [REQUIRED]);
    const queries = interceptQueries();
    // Held at P7 entry, with both rows locked.
    const hold = holdAfterSetLocal(queries, 4);

    const enforced = update(ctx, classify(), {
      id: parent.id,
      title: "Updated parent",
    });
    await hold.atHold;
    const child = server.post("/api/documents.create", user, {
      body: {
        title: "Child",
        text: "Child body",
        collectionId: collection.id,
        parentDocumentId: parent.id,
        publish: true,
      },
    });
    await waitForLockWait(`"collection"."id" = '${collection.id}'`);
    hold.release();

    const [outcome, response] = await Promise.all([enforced, child]);
    expect(outcome.row).toBe(6);
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.parentDocumentId).toBe(parent.id);
    expect((await storedDocument(parent.id))?.title).toBe("Updated parent");
  });

  it("ends the enforced victim of a document-first deadlock in row 3, and the baseline commits", async () => {
    const { user, collection, ctx } = await fixture();
    const document = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
      text: VALID_BODY,
      title: "Original",
    });
    const { classify } = enforcedPolicy(collection.id, [REQUIRED]);
    const enqueue = vi.spyOn(globalEventQueue(), "add");
    const events = await eventNames(document.id);

    const baseline = await sequelize.transaction();
    await sequelize.query(
      "SELECT id FROM documents WHERE id = :id FOR UPDATE",
      {
        replacements: { id: document.id },
        transaction: baseline,
      }
    );
    const enforced = update(ctx, classify(), {
      id: document.id,
      title: "Enforced",
    });
    await waitForLockWait(
      `FROM documents WHERE id = '${document.id}' FOR NO KEY UPDATE`
    );
    await sequelize.query(
      "SELECT id FROM collections WHERE id = :id FOR NO KEY UPDATE",
      { replacements: { id: collection.id }, transaction: baseline }
    );
    await Document.unscoped().update(
      { title: "Baseline" },
      { where: { id: document.id }, hooks: false, transaction: baseline }
    );
    await baseline.commit();

    await expect(enforced).resolves.toEqual({
      row: 3,
      message: OPERATION_FAILED,
    });
    expect((await storedDocument(document.id))?.title).toBe("Baseline");
    expect(await eventNames(document.id)).toEqual(events);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("rejects a lock-queued write that enters P5 below half of its deadline and then times out", async () => {
    const { user, collection, ctx } = await fixture();
    const target = randomUUID();
    const document = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
      text: `${VALID_BODY}\n\n[link](/doc/${target})`,
    });
    const { classify } = enforcedPolicy(
      collection.id,
      [REQUIRED, { kind: "internal_links" }],
      true
    );
    let now = 0;
    state.clock = () => now;
    const queries = interceptQueries();
    let setLocals = 0;
    queries.use(async (sql, _options, next) => {
      const result = await next();
      // At P5 entry, the link batch is left below the floor.
      if (sql.startsWith("SET LOCAL lock_timeout") && ++setLocals === 3) {
        now += VALIDATION_DEADLINE_MS / 2 - 50;
      }
      return result;
    });

    const holder = await sequelize.transaction();
    await sequelize.query(
      "SELECT id FROM collections WHERE id = :id FOR UPDATE",
      {
        replacements: { id: collection.id },
        transaction: holder,
      }
    );
    const enforced = update(ctx, classify(), {
      id: document.id,
      title: "Queued",
    });
    await waitForLockWait(
      `FROM collections WHERE id = '${collection.id}' FOR NO KEY UPDATE`
    );
    // Queued past half of the validation deadline.
    now += VALIDATION_DEADLINE_MS / 2 + 1;
    await holder.rollback();

    const outcome = await enforced;
    expect(outcome.row).toBe(4);
    const { validation } = outcome as Extract<EnforcedWriteOutcome, { row: 4 }>;
    expect(validation.status).toBe("rejected");
    expect(validation.systemFailures.map((failure) => failure.code)).toEqual([
      "VALIDATION_TIMEOUT",
    ]);
    expect((await storedDocument(document.id))?.title).not.toBe("Queued");
  });

  it("does not prevent a parent move between the re-fetch and the commit of a create, which lint_wiki detects", async () => {
    const { user, collection, ctx } = await fixture();
    const other = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const parent = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
      text: VALID_BODY,
    });
    const { policySet, classify } = enforcedPolicy(collection.id, [
      REQUIRED,
      { kind: "parent_collection_consistent" },
    ]);
    const classification = classify(true);
    const queries = interceptQueries();
    // Held at P5 entry, after the re-fetch.
    const hold = holdAfterSetLocal(queries, 3);

    const enforced = create(ctx, classification, {
      title: "Child",
      text: VALID_BODY,
      publish: true,
      parentDocumentId: parent.id,
    });
    await hold.atHold;
    await Document.unscoped().update(
      { collectionId: other.id },
      { where: { id: parent.id }, hooks: false }
    );
    hold.release();

    const outcome = await enforced;
    expect(outcome.row).toBe(6);
    const child = await storedDocument(classification.documentId!);
    expect(child?.collectionId).toBe(collection.id);
    expect(child?.parentDocumentId).toBe(parent.id);

    vi.restoreAllMocks();
    const linted = await lintWikiTool(
      { collectionId: collection.id },
      {
        authInfo: {
          token: "",
          clientId: "",
          scopes: [],
          extra: { user },
        },
      },
      { policySet }
    );
    const result = JSON.parse((linted.content[0] as { text: string }).text) as {
      errors: { code: string; location: { documentId?: string } }[];
    };
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "PARENT_COLLECTION_MISMATCH",
          location: expect.objectContaining({
            documentId: classification.documentId,
          }),
        }),
      ])
    );
  });
});

describe("COMMIT outcomes", () => {
  /**
   * Builds a create fixture with spies on the post-commit effects.
   *
   * @returns the fixture.
   */
  async function commitFixture() {
    const built = await fixture();
    const { classify } = enforcedPolicy(built.collection.id, [REQUIRED]);
    const classification = classify(true);
    const enqueue = vi.spyOn(globalEventQueue(), "add");
    const notify = vi.spyOn(APIUpdateExtension, "notifyUpdate");
    return {
      ...built,
      classification,
      enqueue,
      notify,
      run: () =>
        create(built.ctx, classification, {
          title: "Committed",
          text: VALID_BODY,
          publish: true,
          collectionId: built.collection.id,
        }),
    };
  }

  it("ends in row 6 with its callbacks when COMMIT resolves", async () => {
    const { classification, enqueue, run } = await commitFixture();

    const outcome = await run();

    expect(outcome.row).toBe(6);
    expect(await storedDocument(classification.documentId!)).not.toBeNull();
    expect(enqueue).toHaveBeenCalled();
  });

  /**
   * Leaves a persistence remainder of the probe reserve plus 500 ms at P7
   * entry, so COMMIT's timer is about 500 ms, holds the enforcement COMMIT
   * until released, and records the probe: the statement timeout of its
   * transaction, its rows, and the persistence remainder when it is sent.
   *
   * @param landed - whether the COMMIT reaches the database and only its
   *   reply is held.
   * @returns the probe's records, if any, and the release.
   */
  function holdCommit(landed: boolean) {
    const remainderMs = COMMIT_PROBE_BOUND_MS + 500;
    let offset = 0;
    state.clock = () => performance.now() + offset;
    const queries = interceptQueries();
    let setLocals = 0;
    let enforcement: Transaction | undefined;
    const timeouts = new Map<Transaction | undefined, number>();
    let probeTimeoutMs: number | undefined;
    let probeRows: unknown;
    let p7At = Number.NaN;
    let probeAt = Number.NaN;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    queries.use(async (sql, options, next) => {
      const transaction = options?.transaction;
      const commit = sql === "COMMIT;" && transaction === enforcement;
      const probe = sql === "SELECT id FROM documents WHERE id = :id";
      const timeout = /^SET LOCAL statement_timeout = (\d+)$/.exec(sql);
      if (timeout) {
        timeouts.set(transaction, Number(timeout[1]));
      }
      if (probe) {
        probeAt = performance.now();
        probeTimeoutMs = timeouts.get(transaction);
      }
      if (commit && !landed) {
        await held;
      }
      const result = await next();
      if (probe) {
        probeRows = result;
      }
      if (commit && landed) {
        await held;
      }
      // At P7 entry, leave the persistence remainder.
      if (sql.startsWith("SET LOCAL lock_timeout") && ++setLocals === 4) {
        enforcement = transaction;
        offset += WRITE_PERSISTENCE_BUDGET_MS - remainderMs;
        p7At = performance.now();
      }
      return result;
    });
    return {
      probeTimeoutMs: () => probeTimeoutMs,
      probeRows: () => probeRows,
      remainderAtProbeMs: () => remainderMs - (probeAt - p7At),
      release,
    };
  }

  it("ends in row 7 when COMMIT hangs past its timer and the probe finds no row, and never runs the callbacks", async () => {
    const { classification, enqueue, run } = await commitFixture();
    const hold = holdCommit(false);

    try {
      const outcome = await run();
      expect(outcome).toEqual({ row: 7 });
      expect(hold.remainderAtProbeMs()).toBeGreaterThan(
        COMMIT_PROBE_BOUND_MS - SET_LOCAL_FLOOR_MS
      );
      expect(hold.remainderAtProbeMs()).toBeLessThan(
        COMMIT_PROBE_BOUND_MS + SET_LOCAL_FLOOR_MS
      );
      expect(hold.probeTimeoutMs()).toBeGreaterThan(
        COMMIT_PROBE_BOUND_MS - SET_LOCAL_FLOOR_MS
      );
      expect(hold.probeTimeoutMs()).toBeLessThanOrEqual(COMMIT_PROBE_BOUND_MS);
      expect(hold.probeRows()).toEqual([]);
      expect(await storedDocument(classification.documentId!)).toBeNull();
    } finally {
      hold.release();
    }

    await vi.waitFor(
      async () =>
        expect(await storedDocument(classification.documentId!)).not.toBeNull(),
      { timeout: 5000 }
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("ends in row 6 with its callbacks when COMMIT lands but its reply outlives the timer", async () => {
    const { classification, enqueue, run } = await commitFixture();
    const hold = holdCommit(true);

    try {
      const outcome = await run();
      expect(outcome.row).toBe(6);
      expect(hold.remainderAtProbeMs()).toBeGreaterThan(
        COMMIT_PROBE_BOUND_MS - SET_LOCAL_FLOOR_MS
      );
      expect(hold.remainderAtProbeMs()).toBeLessThan(
        COMMIT_PROBE_BOUND_MS + SET_LOCAL_FLOOR_MS
      );
      expect(hold.probeTimeoutMs()).toBeGreaterThan(
        COMMIT_PROBE_BOUND_MS - SET_LOCAL_FLOOR_MS
      );
      expect(hold.probeTimeoutMs()).toBeLessThanOrEqual(COMMIT_PROBE_BOUND_MS);
      expect(await storedDocument(classification.documentId!)).not.toBeNull();
      expect(enqueue).toHaveBeenCalled();
    } finally {
      hold.release();
    }
  });

  it("ends in row 5 on a server-reported COMMIT error with no row", async () => {
    const { user, collection, ctx, enqueue, notify } = await commitFixture();
    const document = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
      text: VALID_BODY,
      title: "Original",
    });
    const { classify } = enforcedPolicy(collection.id, [REQUIRED]);
    const name = `wiki_lint_test_${randomUUID().replace(/-/g, "")}`;
    await sequelize.query(
      `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'rejected at commit'; END $$`
    );
    await sequelize.query(
      `CREATE CONSTRAINT TRIGGER ${name} AFTER UPDATE ON documents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.id = '${document.id}') EXECUTE FUNCTION ${name}()`
    );
    const events = await eventNames(document.id);
    try {
      const outcome = await update(ctx, classify(), {
        id: document.id,
        title: "Rejected at commit",
      });

      expect(outcome).toEqual({ row: 5, message: OPERATION_FAILED });
    } finally {
      await sequelize.query(`DROP TRIGGER IF EXISTS ${name} ON documents`);
      await sequelize.query(`DROP FUNCTION IF EXISTS ${name}()`);
    }
    expect((await storedDocument(document.id))?.title).toBe("Original");
    expect(await eventNames(document.id)).toEqual(events);
    expect(enqueue).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("ends in row 7 when the socket is destroyed before COMMIT", async () => {
    const { classification, enqueue, run } = await commitFixture();
    const queries = interceptQueries();
    queries.use((sql, options, next) => {
      if (sql === "COMMIT;") {
        const client = (
          options!.transaction as unknown as {
            connection: PgClient;
          }
        ).connection;
        client.connection.stream.destroy();
      }
      return next();
    });

    const outcome = await run();

    expect(outcome).toEqual({ row: 7 });
    expect(await storedDocument(classification.documentId!)).toBeNull();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it.each([
    { name: "create", input: undefined, draft: false },
    { name: "title-only update", input: { title: "Renamed" }, draft: false },
    { name: "publish update", input: { publish: true }, draft: true },
    { name: "unpublish update", input: { publish: false }, draft: false },
  ])(
    "ends a $name in row 6 with its callbacks on a socket error after a real COMMIT",
    async ({ input, draft }) => {
      const { user, collection, ctx, classification, enqueue, run } =
        await commitFixture();
      // An update's probe finds its mutation Event by correlation ID.
      const document = input
        ? await buildDocument({
            teamId: user.teamId,
            userId: user.id,
            collectionId: collection.id,
            text: VALID_BODY,
            ...(draft && { publishedAt: null }),
          })
        : undefined;
      const { classify } = enforcedPolicy(collection.id, [REQUIRED]);
      const queries = interceptQueries();
      queries.use(async (sql, options, next) => {
        const result = await next();
        if (sql === "COMMIT;") {
          const client = (
            options!.transaction as unknown as {
              connection: PgClient;
            }
          ).connection;
          client.connection.stream.destroy();
          throw socketError();
        }
        return result;
      });

      const outcome =
        input && document
          ? await update(ctx, classify(), { id: document.id, ...input })
          : await run();

      expect(outcome.row).toBe(6);
      const stored = await storedDocument(
        document?.id ?? classification.documentId!
      );
      expect(stored).not.toBeNull();
      if (input?.title) {
        expect(stored?.title).toBe(input.title);
      }
      if (input?.publish !== undefined) {
        expect(!!stored?.publishedAt).toBe(input.publish);
      }
      expect(enqueue).toHaveBeenCalled();
    }
  );
});
