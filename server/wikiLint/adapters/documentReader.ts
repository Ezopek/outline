import { DatabaseError, Transaction } from "sequelize";
import { Collection, Document, type User } from "@server/models";
import { can } from "@server/policies";
import { isQueryCanceledError, sequelize } from "@server/storage/database";
import type { Deadline } from "../application/deadline";
import { toCanonicalMarkdown } from "./canonicalSyntax";

/** Postgres error code for `lock_not_available`, raised by `lock_timeout`. */
const LockNotAvailableErrorCode = "55P03";

/**
 * Whether the actor's `read` permission on the document's collection holds.
 * `unestablished` means the check could not be completed.
 */
export type CollectionReadability = "readable" | "unreadable" | "unestablished";

/** A document the actor may read, identified for linting. */
export interface LintTarget {
  documentId: string;
  /** The document's collection, or null when it has none. */
  collectionId: string | null;
  collectionReadability: CollectionReadability;
}

/**
 * Thrown when the snapshot re-read no longer finds the authorized document in
 * the same collection. Its message is fixed.
 */
export class DocumentSnapshotError extends Error {
  name = "DocumentSnapshotError";

  constructor() {
    super("The document snapshot could not be read");
  }
}

/**
 * Whether an error was caused by a database timeout: a canceled statement or
 * a lock wait that exceeded `lock_timeout`.
 *
 * @param error - the error to inspect.
 * @returns whether the error is a database timeout.
 */
export function isDatabaseTimeout(error: unknown): boolean {
  return (
    isQueryCanceledError(error) ||
    (error instanceof DatabaseError &&
      !!error.parent &&
      "code" in error.parent &&
      error.parent.code === LockNotAvailableErrorCode)
  );
}

/**
 * Runs a managed transaction on the primary database that is made read-only
 * by its first statement. Sequelize's `readOnly` option is never used, because
 * it selects the replica pool.
 *
 * @param options - the isolation level, if any.
 * @param run - the work to run inside the transaction.
 * @returns the work's result, after commit.
 */
function readOnlyTransaction<T>(
  options: { isolationLevel?: Transaction.ISOLATION_LEVELS },
  run: (transaction: Transaction) => Promise<T>
): Promise<T> {
  return sequelize.transaction(options, async (transaction) => {
    await sequelize.query("SET TRANSACTION READ ONLY", { transaction });
    return run(transaction);
  });
}

/**
 * Bounds the next database batch by the remaining time, or refuses it.
 *
 * @param transaction - the transaction the batch runs in.
 * @param deadline - the request deadline.
 * @throws DeadlineFloorError when the remainder is below the floor; no
 *   statement is sent.
 */
async function boundBatch(
  transaction: Transaction,
  deadline: Deadline
): Promise<void> {
  const timeoutMs = deadline.batchTimeoutMs();
  await sequelize.query(`SET LOCAL lock_timeout = ${timeoutMs}`, {
    transaction,
  });
  await sequelize.query(`SET LOCAL statement_timeout = ${timeoutMs}`, {
    transaction,
  });
}

/**
 * Establishes whether the actor can read a collection, in its own bounded
 * batch. Any failure, including a refused batch, leaves it unestablished.
 *
 * @param actor - the acting user.
 * @param collectionId - the collection.
 * @param transaction - the pre-snapshot transaction.
 * @param deadline - the request deadline.
 * @returns the collection readability.
 */
async function readCollectionReadability(
  actor: User,
  collectionId: string,
  transaction: Transaction,
  deadline: Deadline
): Promise<CollectionReadability> {
  try {
    await boundBatch(transaction, deadline);
    const collection = await Collection.findByPk(collectionId, {
      userId: actor.id,
      transaction,
    });
    return can(actor, "read", collection) ? "readable" : "unreadable";
  } catch {
    return "unestablished";
  }
}

/**
 * Authorizes the lint target in a short read-only transaction: the document
 * must resolve and the actor must be able to read it. Collection readability
 * is established separately and never affects the document outcome.
 *
 * @param input.id - a document UUID or URL identifier.
 * @param input.actor - the acting user.
 * @param input.deadline - the request deadline.
 * @returns the target, or null when the document is missing or not readable.
 * @throws when the document lookup or its `read` check fails.
 */
export function authorizeLintTarget(input: {
  id: string;
  actor: User;
  deadline: Deadline;
}): Promise<LintTarget | null> {
  const { id, actor, deadline } = input;
  return readOnlyTransaction({}, async (transaction) => {
    await boundBatch(transaction, deadline);
    const document = await Document.findByPk(id, {
      userId: actor.id,
      includeContent: false,
      includeViews: false,
      transaction,
    });
    if (!document || !can(actor, "read", document)) {
      return null;
    }

    const collectionId = document.collectionId ?? null;
    return {
      documentId: document.id,
      collectionId,
      collectionReadability:
        collectionId === null
          ? "unreadable"
          : await readCollectionReadability(
              actor,
              collectionId,
              transaction,
              deadline
            ),
    };
  });
}

/**
 * Reads one point-in-time snapshot of an authorized document and serializes
 * it to canonical Markdown, in a `REPEATABLE READ` read-only transaction with
 * one bounded re-read batch. `Document.text` is never read.
 *
 * @param input.documentId - the authorized document.
 * @param input.collectionId - the collection it was authorized in.
 * @param input.deadline - the request deadline.
 * @returns the canonical Markdown.
 * @throws DocumentSnapshotError when the document is gone or has moved.
 */
export function readDocumentSnapshot(input: {
  documentId: string;
  collectionId: string;
  deadline: Deadline;
}): Promise<string> {
  const { documentId, collectionId, deadline } = input;
  return readOnlyTransaction(
    { isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ },
    async (transaction) => {
      await boundBatch(transaction, deadline);
      const document = await Document.unscoped().findOne({
        attributes: ["id", "collectionId", "deletedAt", "content", "state"],
        where: { id: documentId },
        paranoid: false,
        transaction,
      });
      if (
        !document ||
        document.deletedAt !== null ||
        document.collectionId !== collectionId
      ) {
        throw new DocumentSnapshotError();
      }
      return toCanonicalMarkdown(document);
    }
  );
}
