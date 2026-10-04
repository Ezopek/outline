import { UniqueConstraintError } from "sequelize";
import documentCreator from "@server/commands/documentCreator";
import type { Template } from "@server/models";
import { Attachment, Document } from "@server/models";
import type { APIContext } from "@server/types";
import type {
  MarkdownUpdateInput,
  ProjectedDocument,
} from "./documentProjection";
import type { StagedAttachment } from "./mediaStaging";

/**
 * Thrown in P7 when an update persisted nothing: the `revisionCount` read
 * after the lock is unchanged after the save. It has no stable identifier.
 */
export class UnchangedUpdateError extends Error {
  name = "UnchangedUpdateError";

  constructor() {
    super("The update resulted in no changes to the document");
  }
}

/**
 * Whether a P7 failure is a unique violation of the documents primary key:
 * another attempt already inserted the pre-allocated document ID.
 *
 * @param error - the failure.
 * @returns whether it is such a violation.
 */
export function isPreallocatedIdConflict(error: unknown): boolean {
  if (!(error instanceof UniqueConstraintError)) {
    return false;
  }
  const parent = error.parent as { table?: unknown; constraint?: unknown };
  return parent.table === "documents" && parent.constraint === "documents_pkey";
}

/**
 * Materializes staged media in P7, before the document write: it inserts
 * each handle's Attachment row, in order, with the values and the
 * `attachments.create` Event of `attachmentCreator`, and makes no storage
 * call (AD-7).
 *
 * @param ctx - the API context, bound to the enforcement transaction.
 * @param attachments - the validated projection's staged media.
 */
export async function materializeAttachments(
  ctx: APIContext,
  attachments: readonly StagedAttachment[]
): Promise<void> {
  const { user } = ctx.state.auth;
  for (const { id, key, acl, size, contentType } of attachments) {
    await Attachment.createWithCtx(ctx, {
      id,
      key,
      acl,
      size,
      contentType,
      teamId: user.teamId,
      userId: user.id,
    });
  }
}

/**
 * Persists the projection of a create in P7 through the baseline writer,
 * which stores the given content as is: it neither parses nor substitutes
 * it. An imported collaborative state is stored with it, and the staged
 * media are materialized first.
 *
 * @param ctx - the API context, bound to the enforcement transaction.
 * @param projection - the validated projection.
 * @param template - the template re-fetched in P3, if any.
 * @returns the document as re-fetched inside the transaction.
 */
export async function persistProjectedCreate(
  ctx: APIContext,
  projection: ProjectedDocument,
  template: Template | null | undefined
): Promise<Document> {
  await materializeAttachments(ctx, projection.attachments);
  return documentCreator(ctx, {
    id: projection.documentId,
    title: projection.title,
    content: structuredClone(projection.content),
    icon: projection.icon,
    color: projection.color,
    fullWidth: projection.fullWidth,
    parentDocumentId: projection.parentDocumentId,
    publish: projection.published,
    collectionId: projection.collectionId,
    sourceMetadata: projection.sourceMetadata
      ? structuredClone(projection.sourceMetadata)
      : undefined,
    ...(projection.state && { state: Buffer.from(projection.state) }),
    template,
  });
}

/**
 * Persists the projection of a Markdown update in P7 on the locked,
 * re-fetched document, replaying only the tail of `documentUpdater`: no edit
 * is re-applied and no row is re-locked. An unpublish goes through the
 * baseline unpublish; any other update materializes the staged media, assigns
 * only the fields the input names, from the projection, then publishes or
 * saves.
 *
 * @param ctx - the API context, bound to the enforcement transaction.
 * @param args.document - the document re-fetched after the lock.
 * @param args.projection - the validated projection.
 * @param args.input - the update arguments.
 * @returns the document as re-fetched inside the transaction.
 * @throws UnchangedUpdateError when an update other than an unpublish
 *   persisted nothing.
 * @throws the baseline error of a failed save, publish, or unpublish.
 */
export async function persistProjectedUpdate(
  ctx: APIContext,
  args: {
    document: Document;
    projection: ProjectedDocument;
    input: Readonly<MarkdownUpdateInput>;
  }
): Promise<Document> {
  const { document, projection, input } = args;
  const { user } = ctx.state.auth;
  const { transaction } = ctx.state;
  /**
   * Re-fetches the document inside the transaction.
   *
   * @returns the document.
   */
  const refetch = () =>
    Document.findByPk(document.id, {
      userId: user.id,
      rejectOnEmpty: true,
      transaction,
    });

  if (input.publish === false) {
    await document.unpublishWithCtx(ctx, { detach: false });
    return refetch();
  }

  await materializeAttachments(ctx, projection.attachments);
  const { revisionCount } = document;
  if (input.title !== undefined) {
    document.title = projection.title;
  }
  if (input.icon !== undefined) {
    document.icon = projection.icon;
  }
  if (input.color !== undefined) {
    document.color = projection.color;
  }
  if (input.fullWidth !== undefined) {
    document.fullWidth = projection.fullWidth;
  }
  if (input.text !== undefined) {
    document.content = structuredClone(projection.content);
    document.text = projection.text;
    document.state = projection.state ? Buffer.from(projection.state) : null;
    if (projection.state) {
      document.changed("state", true);
    }
  }

  if (input.publish === true) {
    if (!document.collectionId) {
      document.collectionId = projection.collectionId;
    }
    await document.publish(ctx, { collectionId: projection.collectionId });
  } else if (document.changed()) {
    document.lastModifiedById = user.id;
    document.updatedBy = user;
    await document.saveWithCtx(ctx);
  }

  const updated = await refetch();
  if (updated.revisionCount === revisionCount) {
    throw new UnchangedUpdateError();
  }
  return updated;
}
