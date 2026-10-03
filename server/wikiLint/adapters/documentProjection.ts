import type {
  ProsemirrorData,
  SourceMetadata,
  TextEditMode,
} from "@shared/types";
import { TextHelper } from "@shared/utils/TextHelper";
import { isInternalUrl } from "@shared/utils/urls";
import type { Template, User } from "@server/models";
import { Document } from "@server/models";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";
import { ProsemirrorHelper } from "@server/models/helpers/ProsemirrorHelper";
import parseImages from "@server/utils/parseImages";
import { WikiLintContractError } from "../core/contracts";

/**
 * The one complete document an enforced MCP write would persist. The object,
 * `content`, and `sourceMetadata` are deep-frozen; `state` is a private copy,
 * since a TypedArray cannot be frozen.
 */
export type ProjectedDocument = Readonly<{
  documentId: string;
  title: string;
  /** The canonical ProseMirror JSON. */
  content: ProsemirrorData;
  /** The deprecated Markdown column, exactly as the writer sets it. */
  text: string;
  /** The collaborative Y.js update, or null when the document has none. */
  state: Buffer | null;
  collectionId: string;
  parentDocumentId: string | null;
  published: boolean;
  icon: string | null;
  color: string | null;
  fullWidth: boolean;
  templateId: string | null;
  sourceMetadata: SourceMetadata | null;
}>;

/** The Markdown create arguments, as the MCP handler maps them. */
export interface MarkdownCreateInput {
  title?: string;
  text?: string;
  icon?: string | null;
  color?: string | null;
  fullWidth?: boolean;
  publish: boolean;
  parentDocumentId?: string | null;
  sourceMetadata?: SourceMetadata;
}

/** The Markdown update arguments, as the MCP handler maps them. */
export interface MarkdownUpdateInput {
  title?: string;
  text?: string;
  editMode?: TextEditMode;
  findText?: string;
  icon?: string | null;
  color?: string | null;
  fullWidth?: boolean;
  publish?: boolean;
}

/**
 * The input-only P2 preparation of a create. `content` is the converted body,
 * or null when the input has no text.
 */
export type PreparedMarkdownCreate = Readonly<{
  input: Readonly<Omit<MarkdownCreateInput, "text">>;
  content: ProsemirrorData | null;
}>;

/** The input-only P2 preparation of an update. */
export type PreparedMarkdownUpdate = Readonly<{
  input: Readonly<MarkdownUpdateInput>;
}>;

/**
 * Thrown in P2 when update text holds an image the baseline would import as
 * an Attachment. Enforced writes refuse such media until it can be staged.
 */
export class UnstagedMediaError extends Error {
  name = "UnstagedMediaError";

  constructor() {
    super("Media import is not supported for this write");
  }
}

/**
 * Freezes a value and everything reachable from it, leaving TypedArrays,
 * which cannot be frozen, untouched.
 *
 * @param value - the value, which must not be shared with any caller.
 * @returns the same value, frozen.
 */
function deepFreeze<T>(value: T): T {
  if (
    value === null ||
    typeof value !== "object" ||
    ArrayBuffer.isView(value)
  ) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

/**
 * Copies collaborative state so that the projection never shares it.
 *
 * @param state - the state, if any.
 * @returns a private copy, or null.
 */
const copyState = (state: Uint8Array | null | undefined) =>
  state ? Buffer.from(state) : null;

/**
 * Prepares a Markdown create in P2. It reads no stored state and issues no
 * query: it only converts the input text, as `documentCreator` does.
 *
 * @param input - the create arguments.
 * @returns the frozen prepared value.
 */
export function prepareMarkdownCreate(
  input: MarkdownCreateInput
): PreparedMarkdownCreate {
  const { text, ...rest } = structuredClone(input);
  return deepFreeze({
    input: rest,
    content: text ? ProsemirrorHelper.toProsemirror(text).toJSON() : null,
  });
}

/**
 * Prepares a Markdown update in P2. It reads no stored state and issues no
 * query. Update text holding an image the baseline would import is refused
 * until media can be staged; an unpublish ignores the text and is not.
 *
 * @param input - the update arguments.
 * @returns the frozen prepared value.
 * @throws UnstagedMediaError when the text holds an importable image.
 */
export function prepareMarkdownUpdate(
  input: MarkdownUpdateInput
): PreparedMarkdownUpdate {
  if (input.publish !== false && input.text !== undefined) {
    // Mirrors TextHelper.replaceImagesWithAttachments with `base64Only`.
    for (const image of parseImages(input.text)) {
      try {
        new URL(image.src);
      } catch {
        continue;
      }
      if (!isInternalUrl(image.src) && image.src.startsWith("data:")) {
        throw new UnstagedMediaError();
      }
    }
  }
  return deepFreeze({ input: structuredClone(input) });
}

/**
 * Projects a Markdown create in P4 with the exact `documentCreator`
 * semantics, persisting nothing and leaving the template untouched.
 *
 * @param args.prepared - the P2 preparation.
 * @param args.documentId - the ID pre-allocated at classification.
 * @param args.collectionId - the classified post-operation collection.
 * @param args.actor - the acting user, for template variables.
 * @param args.template - the selected template, if any.
 * @returns the frozen projection.
 */
export async function projectMarkdownCreate(args: {
  prepared: PreparedMarkdownCreate;
  documentId: string;
  collectionId: string;
  actor: User;
  template?: Template | null;
}): Promise<ProjectedDocument> {
  const { prepared, documentId, collectionId, actor, template } = args;
  const { input } = prepared;
  const content =
    prepared.content ??
    (template
      ? ProsemirrorHelper.replaceTemplateVariables(
          structuredClone(await DocumentHelper.toJSON(template)),
          actor
        )
      : ProsemirrorHelper.toProsemirror("").toJSON());
  const title =
    input.title ??
    (template
      ? TextHelper.replaceTemplateVariables(template.title, actor)
      : "");

  return deepFreeze({
    documentId,
    title: title || "",
    content,
    text: await DocumentHelper.toMarkdown(content, { includeTitle: false }),
    state: null,
    collectionId,
    parentDocumentId: input.parentDocumentId ?? null,
    published: input.publish,
    icon: input.icon ?? template?.icon ?? null,
    color: input.color ?? template?.color ?? null,
    fullWidth: input.fullWidth ?? template?.fullWidth ?? false,
    templateId: template ? template.id : null,
    sourceMetadata: structuredClone(input.sourceMetadata) ?? null,
  });
}

/**
 * Projects a Markdown update in P4 from the re-fetched, locked document, with
 * the exact MCP `update_document` semantics: an unpublish ignores every other
 * field, and anything else follows `documentUpdater`. The edit is applied by
 * the baseline helper to a scratch copy, so nothing is persisted and the
 * document is left untouched.
 *
 * @param args.prepared - the P2 preparation.
 * @param args.document - the re-fetched document, which must be loaded with
 *   `includeState: true`.
 * @param args.collectionId - the classified post-operation collection.
 * @returns the frozen projection.
 * @throws WikiLintContractError when the `state` attribute was omitted from
 *   the load (`undefined`), or the final collection is not the classified
 *   one. A default-scope load reads `state` as null whenever `content` is
 *   set, which cannot be detected here.
 * @throws the baseline `ValidationError` of a failed edit.
 */
export async function projectMarkdownUpdate(args: {
  prepared: PreparedMarkdownUpdate;
  document: Document;
  collectionId: string;
}): Promise<ProjectedDocument> {
  const { prepared, document, collectionId } = args;
  const { input } = prepared;
  // Detects only an omitted attribute: undefined here, while its accessor
  // would throw. A default-scope load reads null and passes undetected.
  if (document.dataValues.state === undefined) {
    throw new WikiLintContractError("The document must be loaded with state");
  }
  const finalCollectionId =
    document.collectionId ?? (input.publish === true ? collectionId : null);
  if (finalCollectionId !== collectionId) {
    throw new WikiLintContractError(
      "The final collection is not the classified one"
    );
  }

  const unpublish = input.publish === false;
  const edit: Readonly<MarkdownUpdateInput> = unpublish ? {} : input;
  let content: ProsemirrorData;
  let text = document.text;
  let state = document.state;

  if (edit.text !== undefined) {
    const scratch = Document.build({
      id: document.id,
      content: document.content,
      state: document.state,
      text: document.text,
    });
    DocumentHelper.applyMarkdownToDocument(
      scratch,
      edit.text,
      edit.editMode,
      edit.findText
    );
    content = structuredClone(scratch.content!);
    text = scratch.text;
    state = scratch.state;
  } else {
    content = structuredClone(await DocumentHelper.toJSON(document));
  }

  const title = edit.title !== undefined ? edit.title.trim() : document.title;

  return deepFreeze({
    documentId: document.id,
    title: title || "",
    content,
    text,
    state: copyState(state),
    collectionId,
    parentDocumentId: document.parentDocumentId ?? null,
    published: unpublish
      ? false
      : input.publish === true || !!document.publishedAt,
    icon: edit.icon !== undefined ? edit.icon : document.icon,
    color: edit.color !== undefined ? edit.color : document.color,
    fullWidth:
      edit.fullWidth !== undefined ? edit.fullWidth : document.fullWidth,
    templateId: document.templateId ?? null,
    sourceMetadata: structuredClone(document.sourceMetadata) ?? null,
  });
}
