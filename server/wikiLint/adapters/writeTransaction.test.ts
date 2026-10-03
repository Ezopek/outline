import { randomUUID } from "node:crypto";
import type { Transaction } from "sequelize";
import { ConnectionError, DatabaseError, QueryTypes } from "sequelize";
import documentCreator from "@server/commands/documentCreator";
import { createContext } from "@server/context";
import { Event } from "@server/models";
import type { User } from "@server/models";
import { sequelize } from "@server/storage/database";
import {
  buildCollection,
  buildDocument,
  buildUser,
} from "@server/test/factories";
import { withAPIContext } from "@server/test/support";
import {
  DeadlineFloorError,
  SET_LOCAL_FLOOR_MS,
} from "../application/deadline";
import { isDatabaseTimeout } from "./documentReader";
import {
  CommitTimeoutError,
  ContainedReadError,
  EnforcementTransaction,
  TransactionOpenTimeoutError,
  installCorrelationHook,
  isServerReported,
  probeCommit,
} from "./writeTransaction";

/** The internals of a Sequelize transaction that the tests inspect. */
type Internals = Transaction & {
  _afterCommitHooks: unknown[];
  connection: { processID: number };
};

/**
 * Opens an enforcement transaction with a generous bound.
 *
 * @param invocationId - the attempt's correlation ID.
 * @returns the transaction.
 */
const open = (invocationId = randomUUID()) =>
  EnforcementTransaction.open(invocationId, 5000);

/**
 * Builds an API context bound to a transaction.
 *
 * @param user - the actor.
 * @param transaction - the transaction.
 * @returns the context.
 */
const contextFor = (user: User, transaction: Transaction) =>
  createContext({ user, transaction, ip: "127.0.0.1" });

/**
 * Spies on `sequelize.query` and returns the statements it has seen.
 *
 * @returns a function that returns the recorded statements.
 */
function recordStatements() {
  const spy = vi.spyOn(sequelize, "query");
  return () =>
    spy.mock.calls.map(([sql]) => (typeof sql === "string" ? sql : sql.query));
}

/**
 * Waits for a number of milliseconds.
 *
 * @param ms - the delay.
 * @returns a promise that resolves after it.
 */
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("EnforcementTransaction.open", () => {
  it("records the wall-clock time before BEGIN", async () => {
    const before = Date.now();
    const statements = recordStatements();
    const enforcement = await open();
    try {
      expect(enforcement.startedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(enforcement.startedAt.getTime()).toBeLessThanOrEqual(Date.now());
      expect(statements()).toEqual(["START TRANSACTION;"]);
    } finally {
      await enforcement.rollback();
    }
  });

  it("refuses an exhausted bound without opening", async () => {
    const transaction = vi.spyOn(sequelize, "transaction");

    await expect(EnforcementTransaction.open(randomUUID(), 0)).rejects.toThrow(
      TransactionOpenTimeoutError
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rolls back a transaction that opens after its bound", async () => {
    const holders = await holdPool();
    const rollback = vi.fn();
    const transaction = sequelize.transaction.bind(sequelize);
    vi.spyOn(sequelize, "transaction").mockImplementation((async () => {
      const late = await transaction();
      const original = late.rollback.bind(late);
      late.rollback = async () => {
        rollback();
        return original();
      };
      return late;
    }) as typeof sequelize.transaction);
    try {
      await expect(
        EnforcementTransaction.open(randomUUID(), 200)
      ).rejects.toThrow(TransactionOpenTimeoutError);
    } finally {
      await releasePool(holders);
    }
    await vi.waitFor(() => expect(rollback).toHaveBeenCalledTimes(1));
  });
});

/**
 * Opens transactions until every pool connection is held.
 *
 * @returns the holding transactions.
 */
async function holdPool(): Promise<Transaction[]> {
  const max = sequelize.options.pool?.max ?? 5;
  const holders: Transaction[] = [];
  for (let index = 0; index < max; index++) {
    holders.push(await sequelize.transaction());
  }
  return holders;
}

/**
 * Releases transactions that hold the pool.
 *
 * @param holders - the transactions.
 */
async function releasePool(holders: Transaction[]): Promise<void> {
  await Promise.all(holders.map((holder) => holder.rollback()));
}

describe("afterCommit buffering", () => {
  it("buffers callbacks of the transaction and of every child, in registration order", async () => {
    const enforcement = await open();
    const { transaction } = enforcement;
    const calls: string[] = [];
    /**
     * Builds a callback that records its name.
     *
     * @param name - the name.
     * @returns the callback.
     */
    const record = (name: string) => () => {
      calls.push(name);
    };

    transaction.afterCommit(record("direct"));
    const child = await sequelize.transaction({ transaction });
    child.afterCommit(record("child"));
    const grandchild = await sequelize.transaction({ transaction: child });
    grandchild.afterCommit(record("grandchild"));
    // Event.enqueue and notifyCollaborationServer register through `parent`.
    (grandchild as Transaction & { parent: Transaction }).parent.afterCommit(
      record("grandchild.parent")
    );
    (child as Transaction & { parent: Transaction }).parent.afterCommit(
      record("child.parent")
    );
    // A child "commit" runs the child's own hook list at once.
    await grandchild.commit();
    await child.commit();

    const doomed = await sequelize.transaction({ transaction });
    doomed.afterCommit(record("doomed"));
    const underDoomed = await sequelize.transaction({ transaction: doomed });
    underDoomed.afterCommit(record("under doomed"));
    await underDoomed.commit();
    await doomed.rollback();
    transaction.afterCommit(record("last"));

    for (const tracked of [
      transaction,
      child,
      grandchild,
      doomed,
      underDoomed,
    ]) {
      expect((tracked as Internals)._afterCommitHooks).toEqual([]);
    }
    expect(calls).toEqual([]);

    await expect(enforcement.commit(5000)).resolves.toEqual({
      committed: true,
    });
    expect(calls).toEqual([]);

    const failures: string[] = [];
    await enforcement.runCallbacks(2000, (reason) => failures.push(reason));
    expect(calls).toEqual([
      "direct",
      "child",
      "grandchild",
      "grandchild.parent",
      "child.parent",
      "last",
    ]);
    expect(failures).toEqual([]);
  });

  it("starts each callback independently and reports failures within the bound", async () => {
    const enforcement = await open();
    const { transaction } = enforcement;
    const calls: string[] = [];
    transaction.afterCommit(() => {
      calls.push("first");
    });
    transaction.afterCommit(() => {
      calls.push("throws");
      throw new Error("callback threw");
    });
    transaction.afterCommit(async () => {
      calls.push("rejects");
      throw new Error("callback rejected");
    });
    transaction.afterCommit(() => {
      calls.push("hangs");
      return new Promise<void>(() => undefined);
    });
    transaction.afterCommit(async () => {
      calls.push("slow");
      await delay(20);
      calls.push("slow done");
    });
    await enforcement.commit(5000);

    const failures: string[] = [];
    const started = performance.now();
    await enforcement.runCallbacks(300, (reason) => failures.push(reason));
    const elapsed = performance.now() - started;

    expect(calls).toEqual([
      "first",
      "throws",
      "rejects",
      "hangs",
      "slow",
      "slow done",
    ]);
    expect(failures).toEqual([
      "callback_failed",
      "callback_failed",
      "bound_expired",
    ]);
    expect(elapsed).toBeGreaterThanOrEqual(290);
    expect(elapsed).toBeLessThan(2000);
  });

  it("never runs callbacks on a rejected commit, and discards them", async () => {
    const enforcement = await open();
    const { transaction } = enforcement;
    const calls: string[] = [];
    transaction.afterCommit(() => {
      calls.push("buffered");
    });
    const query = sequelize.query.bind(sequelize);
    const socketError = Object.assign(new Error("read ECONNRESET"), {
      code: "ECONNRESET",
    });
    vi.spyOn(sequelize, "query").mockImplementation(((
      ...args: Parameters<typeof query>
    ) =>
      args[0] === "COMMIT;"
        ? Promise.reject(socketError)
        : query(...args)) as typeof sequelize.query);

    const result = await enforcement.commit(5000);

    expect(result).toEqual({ committed: false, error: socketError });
    expect(calls).toEqual([]);
    enforcement.discard();
    await enforcement.runCallbacks(2000, () => undefined);
    expect(calls).toEqual([]);
  });

  it("rejects a commit that does not resolve within its timer", async () => {
    const enforcement = await open();
    const query = sequelize.query.bind(sequelize);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(sequelize, "query").mockImplementation((async (
      ...args: Parameters<typeof query>
    ) => {
      if (args[0] === "COMMIT;") {
        await held;
      }
      return query(...args);
    }) as typeof sequelize.query);

    const result = await enforcement.commit(150);

    expect(result.committed).toBe(false);
    expect(
      !result.committed && result.error instanceof CommitTimeoutError
    ).toBe(true);
    release();
  });

  it("discards the buffer on rollback", async () => {
    const enforcement = await open();
    const calls: string[] = [];
    enforcement.transaction.afterCommit(() => {
      calls.push("buffered");
    });

    await enforcement.rollback();
    await enforcement.rollback();
    await enforcement.runCallbacks(2000, () => undefined);

    expect(calls).toEqual([]);
  });
});

describe("SQL savepoints", () => {
  it("contains a failed read and keeps the transaction usable", async () => {
    const enforcement = await open();
    const { transaction } = enforcement;
    try {
      await enforcement.setLocalTimeouts(4321);
      const statements = recordStatements();

      const error = await enforcement
        .savepoint(() => sequelize.query("SELECT 1/0", { transaction }))
        .catch((caught: unknown) => caught);
      const value = await enforcement.savepoint(async () => 42);

      expect(error).toBeInstanceOf(ContainedReadError);
      expect((error as ContainedReadError).cause).toBeInstanceOf(DatabaseError);
      expect(value).toBe(42);
      expect(statements()).toEqual([
        "SAVEPOINT wiki_lint_read_1",
        "SELECT 1/0",
        "ROLLBACK TO SAVEPOINT wiki_lint_read_1",
        "SAVEPOINT wiki_lint_read_2",
        "RELEASE SAVEPOINT wiki_lint_read_2",
      ]);
      const [{ statement_timeout: timeout }] = await sequelize.query<{
        statement_timeout: string;
      }>("SHOW statement_timeout", { transaction, type: QueryTypes.SELECT });
      expect(timeout).toBe("4321ms");
    } finally {
      await enforcement.rollback();
    }
  });

  it("contains a statement timeout as a database timeout", async () => {
    const enforcement = await open();
    const { transaction } = enforcement;
    try {
      await enforcement.setLocalTimeouts(SET_LOCAL_FLOOR_MS);

      const error = await enforcement
        .savepoint(() => sequelize.query("SELECT pg_sleep(2)", { transaction }))
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ContainedReadError);
      expect(isDatabaseTimeout((error as ContainedReadError).cause)).toBe(true);
      await expect(
        sequelize.query("SELECT 1", { transaction })
      ).resolves.toBeDefined();
    } finally {
      await enforcement.rollback();
    }
  });

  it("does not contain a failure that leaves the transaction unusable", async () => {
    const enforcement = await open();
    const { transaction } = enforcement;
    const { processID } = (transaction as Internals).connection;

    const error = await enforcement
      .savepoint(async () => {
        await sequelize.query("SELECT pg_terminate_backend(:pid)", {
          replacements: { pid: processID },
        });
        return sequelize.query("SELECT 1", { transaction });
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ContainedReadError);
    await expect(enforcement.rollback()).resolves.toBeUndefined();
  });

  it("refuses timeouts below the floor or not whole", async () => {
    const enforcement = await open();
    try {
      const statements = recordStatements();
      for (const value of [SET_LOCAL_FLOOR_MS - 1, 0, -5, 150.5, Number.NaN]) {
        await expect(enforcement.setLocalTimeouts(value)).rejects.toThrow(
          DeadlineFloorError
        );
      }
      expect(statements()).toEqual([]);
    } finally {
      await enforcement.rollback();
    }
  });
});

describe("probeCommit", () => {
  it("finds a document whether or not it is deleted", async () => {
    const document = await buildDocument();
    await document.destroy();

    await expect(
      probeCommit({ kind: "document", documentId: document.id }, 2000)
    ).resolves.toBe("present");
    await expect(
      probeCommit({ kind: "document", documentId: randomUUID() }, 2000)
    ).resolves.toBe("absent");
  });

  it("finds only the attempt's own mutation Event", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
    });
    const since = new Date(Date.now() - 1000);
    const invocationId = randomUUID();
    await Event.create({
      name: "documents.update",
      documentId: document.id,
      teamId: user.teamId,
      actorId: user.id,
      data: { done: true, validationCorrelationId: invocationId },
    });
    const target = {
      kind: "event" as const,
      documentId: document.id,
      name: "documents.update",
      since,
      invocationId,
    };

    await expect(probeCommit(target, 2000)).resolves.toBe("present");
    for (const variant of [
      { invocationId: randomUUID() },
      { name: "documents.publish" },
      { documentId: randomUUID() },
      { since: new Date(Date.now() + 60_000) },
    ]) {
      await expect(probeCommit({ ...target, ...variant }, 2000)).resolves.toBe(
        "absent"
      );
    }
  });

  it("is unavailable below the floor without opening a transaction", async () => {
    const transaction = vi.spyOn(sequelize, "transaction");

    await expect(
      probeCommit(
        { kind: "document", documentId: randomUUID() },
        SET_LOCAL_FLOOR_MS - 1
      )
    ).resolves.toBe("unavailable");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("bounds its statement on a fresh connection", async () => {
    const statements = recordStatements();

    await probeCommit({ kind: "document", documentId: randomUUID() }, 1500);

    const recorded = statements();
    expect(recorded[0]).toBe("START TRANSACTION;");
    expect(recorded[1]).toMatch(/^SET LOCAL statement_timeout = (\d+)$/);
    const timeout = Number(/(\d+)$/.exec(recorded[1])?.[1]);
    expect(timeout).toBeLessThanOrEqual(1500);
    expect(timeout).toBeGreaterThanOrEqual(SET_LOCAL_FLOOR_MS);
    expect(recorded.at(-1)).toBe("ROLLBACK;");
  });

  it("is unavailable when acquisition stalls past the bound", async () => {
    const holders = await holdPool();
    try {
      const started = performance.now();
      await expect(
        probeCommit({ kind: "document", documentId: randomUUID() }, 250)
      ).resolves.toBe("unavailable");
      expect(performance.now() - started).toBeLessThan(2000);
    } finally {
      await releasePool(holders);
    }
  });

  it("is unavailable when its lookup fails", async () => {
    const query = sequelize.query.bind(sequelize);
    vi.spyOn(sequelize, "query").mockImplementation(((
      ...args: Parameters<typeof query>
    ) =>
      typeof args[0] === "string" && args[0].startsWith("SELECT id FROM")
        ? Promise.reject(new Error("lookup failed"))
        : query(...args)) as typeof sequelize.query);

    await expect(
      probeCommit({ kind: "document", documentId: randomUUID() }, 2000)
    ).resolves.toBe("unavailable");
  });
});

describe("isServerReported", () => {
  it("accepts only an error whose parent carries a server severity and code", async () => {
    const serverError = await sequelize
      .query("SELECT 1/0")
      .catch((caught: unknown) => caught);
    const socketError = Object.assign(new Error("read ECONNRESET"), {
      code: "ECONNRESET",
    });

    expect(isServerReported(serverError)).toBe(true);
    expect(isServerReported(new Error("plain"))).toBe(false);
    expect(isServerReported(socketError)).toBe(false);
    expect(isServerReported(new ConnectionError(socketError))).toBe(false);
    expect(isServerReported(new CommitTimeoutError())).toBe(false);
    expect(isServerReported({ parent: { code: "22012" } })).toBe(false);
    expect(isServerReported({ parent: { severity: "ERROR" } })).toBe(false);
    expect(isServerReported(null)).toBe(false);
  });
});

describe("mutation Event correlation", () => {
  it("tags every Event created inside the transaction or a child of it", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const invocationId = randomUUID();
    const enforcement = await open(invocationId);
    const ctx = contextFor(user, enforcement.transaction);

    const document = await documentCreator(ctx, {
      title: "Correlated",
      text: "Body",
      collectionId: collection.id,
      publish: false,
    });
    await document.publish(ctx, {
      collectionId: collection.id,
      data: { done: true },
    });
    document.title = "Renamed";
    await document.saveWithCtx(ctx);
    await document.unpublishWithCtx(ctx, { detach: false });
    const child = await sequelize.transaction({
      transaction: enforcement.transaction,
    });
    await Event.create(
      {
        name: "documents.child",
        documentId: document.id,
        teamId: user.teamId,
        actorId: user.id,
      },
      { transaction: child }
    );
    await child.commit();
    await enforcement.commit(5000);

    const events = await Event.findAll({
      where: { documentId: document.id },
      order: [["createdAt", "ASC"]],
    });
    expect(events.map((event) => event.name)).toEqual([
      "documents.create",
      "documents.publish",
      "documents.update",
      "documents.unpublish",
      "documents.child",
    ]);
    for (const event of events) {
      expect(event.data?.validationCorrelationId).toBe(invocationId);
    }
    expect(events[1].data).toEqual({
      done: true,
      validationCorrelationId: invocationId,
    });
  });

  it("tags nothing outside an enforcement transaction", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const enforcement = await open();
    try {
      const document = await withAPIContext(user, (ctx) =>
        documentCreator(ctx, {
          title: "Baseline",
          text: "Body",
          collectionId: collection.id,
          publish: true,
        })
      );

      const events = await Event.findAll({
        where: { documentId: document.id },
      });
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(event.data?.validationCorrelationId).toBeUndefined();
      }
    } finally {
      await enforcement.rollback();
    }
  });

  it("registers its hook once", async () => {
    installCorrelationHook();
    const first = await open();
    const second = await open();
    await first.rollback();
    await second.rollback();
    installCorrelationHook();

    const hooks = (
      Event as unknown as {
        options: { hooks: { beforeCreate?: { name?: string }[] } };
      }
    ).options.hooks.beforeCreate;
    expect(
      hooks?.filter((hook) => hook.name === "wikiLintValidationCorrelation")
    ).toHaveLength(1);
  });
});
