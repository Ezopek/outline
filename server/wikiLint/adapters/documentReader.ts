import { DatabaseError, Op, Transaction, type WhereOptions } from "sequelize";
import { Collection, Document, type User } from "@server/models";
import { can } from "@server/policies";
import { isQueryCanceledError, sequelize } from "@server/storage/database";
import type { Deadline } from "../application/deadline";
import { DeadlineFloorError, within } from "../application/deadline";
import type {
  CanonicalSyntax,
  LinkTargetState,
  ResolvedLinks,
} from "../core/contracts";
import type { LinkLookupKey } from "../core/internalLinks";
import { extractInternalLinks, linkLookupBatches } from "../core/internalLinks";
import { parseCanonicalMarkdown, toCanonicalMarkdown } from "./canonicalSyntax";

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

/** One point-in-time snapshot of a document, ready for evaluation. */
export interface DocumentSnapshot {
  /** The canonical syntax of the document. */
  syntax: CanonicalSyntax;
  /** The resolved internal links; null when they were not requested. */
  links: ResolvedLinks | null;
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
 * Runs a transaction on the primary database that is made read-only by its
 * first statement. Sequelize's `readOnly` option is never used, because it
 * selects the replica pool. Opening it, connection acquisition and `BEGIN`
 * included, is charged to the request deadline: it is bounded by the floored
 * remainder, and a transaction that opens after the bound expired is rolled
 * back when it resolves. When the work fails, the transaction is rolled back
 * and the work's error is rethrown; otherwise it commits before returning.
 *
 * @param options.isolationLevel - the isolation level, if any.
 * @param options.deadline - the request deadline.
 * @param run - the work to run inside the transaction.
 * @returns the work's result, after commit.
 * @throws DeadlineFloorError when the remainder is below the floor, so no
 *   connection is requested, or when the transaction does not open within it.
 * @throws the error of a failed acquisition, `BEGIN`, work, or commit.
 */
export async function readOnlyTransaction<T>(
  options: {
    isolationLevel?: Transaction.ISOLATION_LEVELS;
    deadline: Deadline;
  },
  run: (transaction: Transaction) => Promise<T>
): Promise<T> {
  const { deadline, ...transactionOptions } = options;
  const boundMs = deadline.batchTimeoutMs();
  const opening = sequelize.transaction(transactionOptions);
  const transaction = await within(opening, boundMs, null);
  if (transaction === null) {
    opening.then(
      (late) => late.rollback().catch(() => undefined),
      () => undefined
    );
    throw new DeadlineFloorError();
  }

  let result: T;
  try {
    await sequelize.query("SET TRANSACTION READ ONLY", { transaction });
    result = await run(transaction);
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
  await transaction.commit();
  return result;
}

/**
 * Bounds the next database batch by the remaining time, or refuses it.
 *
 * @param transaction - the transaction the batch runs in.
 * @param deadline - the request deadline.
 * @throws DeadlineFloorError when the remainder is below the floor; no
 *   statement is sent.
 */
export async function boundBatch(
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
 * Whether the actor can read a collection, as enforced-write classification
 * computes its `readable` flag. Unlike the read-side check, it is neither
 * transaction-bound nor tri-state: a failed lookup propagates.
 *
 * @param actor - the acting user.
 * @param collectionId - the classified collection.
 * @returns whether `can(actor, "read", collection)` holds.
 */
export async function canReadCollection(
  actor: User,
  collectionId: string
): Promise<boolean> {
  return !!can(
    actor,
    "read",
    await Collection.findByPk(collectionId, { userId: actor.id })
  );
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
  return readOnlyTransaction({ deadline }, async (transaction) => {
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
 * Finds the documents matching a condition that the actor can read, with one
 * membership-aware `findAll` within the actor's team, whose separate
 * membership includes may add statements. Drafts and archived documents are
 * included; deleted documents are not. The caller bounds the batch.
 *
 * @param input.where - the condition, ANDed with the actor's team.
 * @param input.actor - the acting user.
 * @param input.transaction - the transaction the query runs in.
 * @returns the matching rows that pass `can(actor, "read", row)`, without
 *   content.
 */
export async function findReadableDocuments(input: {
  where: WhereOptions<Document>;
  actor: User;
  transaction: Transaction;
}): Promise<Document[]> {
  const { where, actor, transaction } = input;
  const rows = await Document.scope([
    "withDrafts",
    "withoutContent",
    { method: ["withMembership", actor.id] },
  ]).findAll({
    where: { teamId: actor.teamId, [Op.and]: [where] },
    transaction,
  });
  return rows.filter((row) => can(actor, "read", row));
}

/**
 * Resolves internal-link lookup keys for an actor inside a snapshot
 * transaction. Each batch is bounded, then resolved by one membership-aware
 * `findAll` within the actor's team, whose separate membership includes may
 * add statements. A key is `resolved` only when a returned row with that `id`
 * or `urlId` passes `can(actor, "read", row)`; a missing, deleted, or
 * inaccessible target is `unresolved`, and nothing else about it is kept.
 *
 * @param input.batches - the lookup batches, in sorted order.
 * @param input.actor - the acting user.
 * @param input.transaction - the snapshot transaction.
 * @param input.deadline - the request deadline.
 * @param input.read - wraps each batch's read, after the batch is bounded;
 *   for example in a savepoint. By default the read runs as is.
 * @returns the state of each key.
 * @throws DeadlineFloorError when the remainder is below the floor before a
 *   batch, or the error of a batch's read.
 */
export async function resolveLinkTargets(input: {
  batches: readonly (readonly LinkLookupKey[])[];
  actor: User;
  transaction: Transaction;
  deadline: Deadline;
  read?: <T>(run: () => Promise<T>) => Promise<T>;
}): Promise<Map<string, LinkTargetState>> {
  const { batches, actor, transaction, deadline } = input;
  const read = input.read ?? (<T>(run: () => Promise<T>) => run());
  const targets = new Map<string, LinkTargetState>();
  for (const batch of batches) {
    const ids = batch
      .filter((key) => key.keyKind === "id")
      .map((key) => key.key);
    const urlIds = batch
      .filter((key) => key.keyKind === "urlId")
      .map((key) => key.key);

    await boundBatch(transaction, deadline);
    const readable = await read(() =>
      findReadableDocuments({
        where: {
          [Op.or]: [
            ...(ids.length ? [{ id: ids }] : []),
            ...(urlIds.length ? [{ urlId: urlIds }] : []),
          ],
        },
        actor,
        transaction,
      })
    );
    const readableIds = new Set(readable.map((row) => row.id));
    const readableUrlIds = new Set(readable.map((row) => row.urlId));
    for (const { key, keyKind } of batch) {
      const found =
        keyKind === "id" ? readableIds.has(key) : readableUrlIds.has(key);
      targets.set(key, found ? "resolved" : "unresolved");
    }
  }
  return targets;
}

/**
 * Reads one point-in-time snapshot of an authorized document, in a
 * `REPEATABLE READ` read-only transaction: one bounded re-read batch, then the
 * canonical Markdown is serialized and parsed. With an instance origin, the
 * internal links are extracted and resolved before commit, in bounded
 * batches. `Document.text` is never read.
 *
 * @param input.documentId - the authorized document.
 * @param input.collectionId - the collection it was authorized in.
 * @param input.deadline - the request deadline.
 * @param input.actor - the acting user, who resolves link targets.
 * @param input.instanceOrigin - the instance origin; links are resolved only
 *   when it is given.
 * @returns the snapshot.
 * @throws DocumentSnapshotError when the document is gone or has moved.
 * @throws CanonicalMarkdownError when canonical Markdown cannot be produced.
 */
export function readDocumentSnapshot(input: {
  documentId: string;
  collectionId: string;
  deadline: Deadline;
  actor: User;
  instanceOrigin?: string;
}): Promise<DocumentSnapshot> {
  const { documentId, collectionId, deadline, actor, instanceOrigin } = input;
  return readOnlyTransaction(
    { isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ, deadline },
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
      const syntax = parseCanonicalMarkdown(
        await toCanonicalMarkdown(document)
      );
      if (instanceOrigin === undefined) {
        return { syntax, links: null };
      }

      const references = extractInternalLinks(syntax.links, instanceOrigin);
      const targets = await resolveLinkTargets({
        batches: linkLookupBatches(references),
        actor,
        transaction,
        deadline,
      });
      return { syntax, links: { references, targets } };
    }
  );
}
