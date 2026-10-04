import { Op, Transaction } from "sequelize";
import type { NavigationNode } from "@shared/types";
import { Collection, Document, type User } from "@server/models";
import { can } from "@server/policies";
import type { Deadline } from "../application/deadline";
import {
  SnapshotMeter,
  WIKI_SNAPSHOT_LIMITS,
} from "../application/snapshotLimits";
import type {
  CheckName,
  InternalLinkReference,
  WikiGlobalIndexInput,
  WikiParentEdge,
  WikiSnapshot,
  WikiSnapshotCollection,
  WikiSnapshotDocument,
} from "../core/contracts";
import {
  LINK_LOOKUP_BATCH_SIZE,
  extractInternalLinks,
  linkLookupBatches,
} from "../core/internalLinks";
import { compareUtf8 } from "../core/ordering";
import type { PolicySetEntry } from "../core/policySet";
import type { RuleConfig } from "../core/registry";
import { requiredChecks } from "../core/registry";
import { parseCanonicalMarkdown, toCanonicalMarkdown } from "./canonicalSyntax";
import {
  boundBatch,
  findReadableDocuments,
  readOnlyTransaction,
  resolveLinkTargets,
} from "./documentReader";

/** The number of evaluated documents read by one keyset batch. */
export const WIKI_DOCUMENT_BATCH_SIZE = 100;

/** The scope of a Wiki snapshot. */
export type WikiScope =
  | { kind: "collection"; collectionId: string }
  | { kind: "configured_collections" };

/**
 * The outcome of reading a Wiki snapshot. A failure carries the sentinels
 * whose readability was established before it.
 */
export type WikiSnapshotRead =
  | { ok: true; snapshot: WikiSnapshot }
  | { ok: false; error: unknown; sentinelCollectionIds: string[] };

/** An evaluated collection and the inputs its checks require. */
interface EvaluatedCollection {
  collectionId: string;
  rules: readonly RuleConfig[];
  checks: CheckName[];
  /** Whether `can(actor, "readDocument", collection)` held at snapshot time. */
  graphAuthorized: boolean;
}

/** An evaluated document while the snapshot is read. */
interface ReadDocument {
  documentId: string;
  collectionId: string;
  parentDocumentId: string | null;
  content: WikiSnapshotDocument["content"];
}

/**
 * Authorizes a lint collection in a short read-only transaction with the
 * baseline lookup, which accepts a UUID or a slug-prefixed URL identifier.
 *
 * @param input.id - the requested collection identifier.
 * @param input.actor - the acting user.
 * @param input.deadline - the request deadline.
 * @returns the resolved collection ID, or null when the collection is
 *   missing or the actor cannot read it.
 * @throws when the lookup or its batch fails.
 */
export function authorizeLintCollection(input: {
  id: string;
  actor: User;
  deadline: Deadline;
}): Promise<string | null> {
  const { id, actor, deadline } = input;
  return readOnlyTransaction({ deadline }, async (transaction) => {
    await boundBatch(transaction, deadline);
    const collection = await Collection.findByPk(id, {
      userId: actor.id,
      transaction,
    });
    return collection && can(actor, "read", collection) ? collection.id : null;
  });
}

/**
 * Walks the object nodes of a collection structure at any depth, skipping
 * other values.
 *
 * @param structure - the stored collection structure.
 * @param visit - called with each object node.
 */
function walkStructure(
  structure: NavigationNode[] | null,
  visit: (node: Partial<NavigationNode>) => void
): void {
  const stack: unknown[] = Array.isArray(structure) ? [...structure] : [];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node && typeof node === "object") {
      const { children } = node as Partial<NavigationNode>;
      visit(node as Partial<NavigationNode>);
      if (Array.isArray(children)) {
        for (const child of children) {
          stack.push(child);
        }
      }
    }
  }
}

/**
 * Flattens a collection structure to its document IDs, ignoring malformed
 * nodes.
 *
 * @param structure - the stored collection structure.
 * @returns the sorted unique document IDs.
 */
export function structureDocumentIds(
  structure: NavigationNode[] | null
): string[] {
  const ids = new Set<string>();
  walkStructure(structure, ({ id }) => {
    if (typeof id === "string") {
      ids.add(id);
    }
  });
  return [...ids].sort(compareUtf8);
}

/**
 * Counts the object nodes the flattening walk visits, malformed ones
 * included.
 *
 * @param structure - the stored collection structure.
 * @returns the number of object nodes.
 */
export function structureNodeCount(structure: NavigationNode[] | null): number {
  let count = 0;
  walkStructure(structure, () => {
    count++;
  });
  return count;
}

/**
 * Groups IDs into sorted unique batches of `LINK_LOOKUP_BATCH_SIZE`.
 *
 * @param ids - the IDs.
 * @returns the batches, in sorted order.
 */
function idBatches(ids: Iterable<string>): string[][] {
  const sorted = [...new Set(ids)].sort(compareUtf8);
  const batches: string[][] = [];
  for (let start = 0; start < sorted.length; start += LINK_LOOKUP_BATCH_SIZE) {
    batches.push(sorted.slice(start, start + LINK_LOOKUP_BATCH_SIZE));
  }
  return batches;
}

/**
 * Serializes and parses one document's authoritative content, metering the
 * Markdown after serialization and the links after extraction.
 *
 * @param row - the row holding `content` and `state`, if found.
 * @param instanceOrigin - the origin links are recognized against, or
 *   undefined when links are not needed.
 * @param meter - the snapshot meter.
 * @returns the syntax and links, or `unavailable` when either step throws.
 * @throws WikiResourceLimitError when a limit is exceeded; it is never
 *   reported as `unavailable`.
 */
async function canonicalContent(
  row: Document | undefined,
  instanceOrigin: string | undefined,
  meter: SnapshotMeter
): Promise<WikiSnapshotDocument["content"]> {
  if (!row) {
    return "unavailable";
  }
  let markdown: string;
  try {
    markdown = await toCanonicalMarkdown(row);
  } catch {
    return "unavailable";
  }
  meter.addMarkdown(markdown);
  let content: Exclude<WikiSnapshotDocument["content"], null | "unavailable">;
  try {
    const syntax = parseCanonicalMarkdown(markdown);
    content = {
      syntax,
      links:
        instanceOrigin === undefined
          ? null
          : extractInternalLinks(syntax.links, instanceOrigin),
    };
  } catch {
    return "unavailable";
  }
  meter.addLinkReferences(content.links?.length ?? 0);
  return content;
}

/**
 * Reads the authoritative content of documents in one bounded batch.
 *
 * @param ids - the document IDs.
 * @param transaction - the snapshot transaction.
 * @param deadline - the request deadline.
 * @returns the rows by ID.
 */
async function readContents(
  ids: string[],
  transaction: Transaction,
  deadline: Deadline
): Promise<Map<string, Document>> {
  await boundBatch(transaction, deadline);
  const rows = await Document.unscoped().findAll({
    attributes: ["id", "content", "state"],
    where: { id: ids },
    transaction,
  });
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * Reads one point-in-time snapshot of an authorized Wiki scope in a single
 * `REPEATABLE READ` read-only transaction, committed before it returns. Every
 * query call is preceded by its bounded batch and runs sequentially. Only the
 * inputs of required checks are loaded, `Document.text` is never read, and
 * `documentStructure` is read only for collections where the actor holds
 * `readDocument`. One meter checks everything the snapshot holds against
 * the AD-16 limits and fails it with `WikiResourceLimitError` as soon as one
 * is exceeded.
 *
 * @param input.scope - a collection scope, whose identity the pre-admission
 *   lookup fixed, or the default scope of every readable configured collection.
 * @param input.entries - the requested collection's valid entry, or every
 *   policy set entry for the default scope.
 * @param input.actor - the acting user.
 * @param input.deadline - the request deadline.
 * @param input.instanceOrigin - the origin internal links are recognized against.
 * @returns the snapshot, or the failure with the sentinels established
 *   before it.
 */
export async function readWikiSnapshot(input: {
  scope: WikiScope;
  entries: readonly PolicySetEntry[];
  actor: User;
  deadline: Deadline;
  instanceOrigin: string;
}): Promise<WikiSnapshotRead> {
  const { scope, entries, actor, deadline, instanceOrigin } = input;
  const sentinelCollectionIds: string[] = [];
  const meter = new SnapshotMeter(WIKI_SNAPSHOT_LIMITS);
  try {
    const snapshot = await readOnlyTransaction(
      {
        isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ,
        deadline,
      },
      async (transaction): Promise<WikiSnapshot> => {
        // The scope's collections: the default-scope enumeration, the
        // sentinel readability check, and the source of graph authorization.
        const sorted = [...entries].sort((a, b) =>
          compareUtf8(a.collectionId, b.collectionId)
        );
        await boundBatch(transaction, deadline);
        const rows = await Collection.scope([
          "defaultScope",
          { method: ["withMembership", actor.id] },
        ]).findAll({
          where: {
            id: sorted.map((entry) => entry.collectionId),
            teamId: actor.teamId,
          },
          transaction,
        });
        const rowById = new Map(rows.map((row) => [row.id, row]));

        const evaluated: EvaluatedCollection[] = [];
        for (const entry of sorted) {
          const row = rowById.get(entry.collectionId) ?? null;
          if (
            scope.kind === "configured_collections" &&
            !can(actor, "read", row)
          ) {
            continue;
          }
          if (entry.status === "invalid") {
            sentinelCollectionIds.push(entry.collectionId);
            continue;
          }
          evaluated.push({
            collectionId: entry.collectionId,
            rules: entry.policy.rules,
            checks: requiredChecks(entry.policy.rules),
            graphAuthorized: !!row && !!can(actor, "readDocument", row),
          });
        }
        const byId = new Map(
          evaluated.map((item) => [item.collectionId, item])
        );
        if (evaluated.length === 0) {
          return {
            collections: [],
            sentinelCollectionIds: [...sentinelCollectionIds],
            targets: new Map(),
          };
        }

        // The evaluated documents, in keyset batches, with the content of
        // those whose collection requires the `documents` check.
        const documents: ReadDocument[] = [];
        let last: Document | undefined;
        let fetched: number;
        do {
          await boundBatch(transaction, deadline);
          const batch = await Document.scope([
            "withoutContent",
            { method: ["withMembership", actor.id] },
          ]).findAll({
            where: {
              teamId: actor.teamId,
              collectionId: [...byId.keys()],
              publishedAt: { [Op.ne]: null },
              template: false,
              sourceMetadata: { trial: { [Op.is]: null } },
              archivedAt: null,
              ...(last
                ? {
                    [Op.or]: [
                      { collectionId: { [Op.gt]: last.collectionId } },
                      {
                        collectionId: last.collectionId,
                        id: { [Op.gt]: last.id },
                      },
                    ],
                  }
                : {}),
            },
            order: [
              ["collectionId", "ASC"],
              ["id", "ASC"],
            ],
            limit: WIKI_DOCUMENT_BATCH_SIZE,
            transaction,
          });
          fetched = batch.length;
          last = batch.at(-1);

          const kept = batch.filter((row) => can(actor, "read", row));
          meter.addDocuments(kept.length);
          const contentIds = kept
            .filter((row) =>
              byId.get(row.collectionId as string)?.checks.includes("documents")
            )
            .map((row) => row.id);
          const contents = contentIds.length
            ? await readContents(contentIds, transaction, deadline)
            : new Map<string, Document>();
          for (const row of kept) {
            const collection = byId.get(row.collectionId as string);
            if (!collection) {
              continue;
            }
            const linksEnabled = collection.rules.some(
              (rule) => rule.kind === "internal_links"
            );
            documents.push({
              documentId: row.id,
              collectionId: collection.collectionId,
              parentDocumentId: row.parentDocumentId ?? null,
              content: collection.checks.includes("documents")
                ? await canonicalContent(
                    contents.get(row.id),
                    linksEnabled ? instanceOrigin : undefined,
                    meter
                  )
                : null,
            });
          }
        } while (fetched === WIKI_DOCUMENT_BATCH_SIZE);

        const references: InternalLinkReference[] = [];
        for (const { content } of documents) {
          if (content && content !== "unavailable" && content.links) {
            references.push(...content.links);
          }
        }
        const targets = await resolveLinkTargets({
          batches: linkLookupBatches(references),
          actor,
          transaction,
          deadline,
        });

        // The graph inputs of collections where the actor holds
        // `readDocument` and a graph check is required.
        const graphs = evaluated.filter(
          (item) =>
            item.graphAuthorized &&
            (item.checks.includes("hierarchy") ||
              item.checks.includes("global_index"))
        );
        const structures = new Map<string, string[]>();
        const readable = new Map<string, Document>();
        const surfaces = new Map<string, WikiGlobalIndexInput["surface"]>();
        if (graphs.length > 0) {
          await boundBatch(transaction, deadline);
          const structureRows = await Collection.unscoped().findAll({
            attributes: ["id", "documentStructure"],
            where: { id: graphs.map((item) => item.collectionId) },
            transaction,
          });
          for (const row of structureRows) {
            meter.addStructureNodes(structureNodeCount(row.documentStructure));
            structures.set(row.id, structureDocumentIds(row.documentStructure));
          }

          const graphIds = new Set(graphs.map((item) => item.collectionId));
          const lookupIds: string[] = [];
          for (const document of documents) {
            if (
              graphIds.has(document.collectionId) &&
              document.parentDocumentId !== null
            ) {
              lookupIds.push(document.parentDocumentId);
            }
          }
          for (const rule of graphs.flatMap((item) => item.rules)) {
            if (rule.kind === "global_index_links") {
              lookupIds.push(
                rule.surfaceDocumentId,
                ...rule.globalIndexDocumentIds
              );
            }
          }
          for (const batch of idBatches(lookupIds)) {
            await boundBatch(transaction, deadline);
            for (const row of await findReadableDocuments({
              where: { id: batch },
              actor,
              transaction,
            })) {
              readable.set(row.id, row);
            }
          }

          const surfaceIds = graphs
            .flatMap((item) => item.rules)
            .flatMap((rule) =>
              rule.kind === "global_index_links" &&
              readable.has(rule.surfaceDocumentId)
                ? [rule.surfaceDocumentId]
                : []
            );
          for (const batch of idBatches(surfaceIds)) {
            const rows = await readContents(batch, transaction, deadline);
            for (const id of batch) {
              const content = await canonicalContent(
                rows.get(id),
                instanceOrigin,
                meter
              );
              surfaces.set(
                id,
                content && content !== "unavailable" && content.links
                  ? { documentId: id, links: content.links }
                  : null
              );
            }
          }
        }

        /**
         * Builds the parent edge of a document in an authorized graph.
         *
         * @param document - the evaluated document.
         * @returns the edge.
         */
        const parentEdge = (document: ReadDocument): WikiParentEdge => {
          if (document.parentDocumentId === null) {
            return { state: "none" };
          }
          const parent = readable.get(document.parentDocumentId);
          return parent
            ? {
                state: "resolved",
                documentId: parent.id,
                sameCollection: parent.collectionId === document.collectionId,
              }
            : { state: "unresolved" };
        };

        const collections = evaluated.map((item): WikiSnapshotCollection => {
          const graphRequired =
            item.checks.includes("hierarchy") ||
            item.checks.includes("global_index");
          const parentsRead = item.graphAuthorized && graphRequired;
          const rule = item.rules.find(
            (candidate) => candidate.kind === "global_index_links"
          );
          const globalIndex =
            rule?.kind === "global_index_links"
              ? {
                  surface: surfaces.get(rule.surfaceDocumentId) ?? null,
                  indexes: [...rule.globalIndexDocumentIds]
                    .sort(compareUtf8)
                    .flatMap((id) => {
                      const index = readable.get(id);
                      return index
                        ? [{ documentId: id, urlId: index.urlId }]
                        : [];
                    }),
                }
              : null;
          return {
            collectionId: item.collectionId,
            documents: documents
              .filter((document) => document.collectionId === item.collectionId)
              .sort((a, b) => compareUtf8(a.documentId, b.documentId))
              .map((document) => ({
                documentId: document.documentId,
                content: document.content,
                parent: parentsRead ? parentEdge(document) : null,
              })),
            graph: !graphRequired
              ? null
              : !item.graphAuthorized
                ? { authorized: false }
                : {
                    authorized: true,
                    structureDocumentIds:
                      structures.get(item.collectionId) ?? [],
                    globalIndex,
                  },
          };
        });

        return {
          collections,
          sentinelCollectionIds: [...sentinelCollectionIds],
          targets,
        };
      }
    );
    return { ok: true, snapshot };
  } catch (error) {
    return {
      ok: false,
      error,
      sentinelCollectionIds: [...sentinelCollectionIds],
    };
  }
}
