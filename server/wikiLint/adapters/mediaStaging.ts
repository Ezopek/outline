import { randomUUID } from "node:crypto";
import { chunk, escapeRegExp } from "es-toolkit/compat";
import { Fragment, Node } from "prosemirror-model";
import { AttachmentPreset } from "@shared/types";
import { isInternalUrl } from "@shared/utils/urls";
import { schema } from "@server/editor";
import env from "@server/env";
import Logger from "@server/logging/Logger";
import type { User } from "@server/models";
import { Attachment } from "@server/models";
import AttachmentHelper from "@server/models/helpers/AttachmentHelper";
import { ProsemirrorHelper } from "@server/models/helpers/ProsemirrorHelper";
import type BaseStorage from "@server/storage/files/BaseStorage";
import FileStorage from "@server/storage/files";
import parseImages from "@server/utils/parseImages";
import type { Deadline } from "../application/deadline";
import { STAGED_MEDIA_CLEANUP_BOUND_MS, within } from "../application/deadline";

/**
 * A blob staged at its final storage key, with the values of the Attachment
 * row that materializes it (AD-7). It is Outline-inaccessible until that row
 * commits.
 */
export type StagedAttachment = Readonly<{
  /** The pre-allocated Attachment ID. */
  id: string;
  key: string;
  acl: string;
  size: number;
  contentType: string;
}>;

/** The file storage calls of the stager; `FileStorage` by default. */
export type MediaStorage = Pick<BaseStorage, "storeFromUrl" | "deleteFile">;

/**
 * Thrown when the stager refuses a new source, because the preparation bound
 * has expired, the stager is sealed, or its cleanup has begun, and when a
 * storage call outlives the preparation bound. It names no source, so the
 * attempt ends in AD-20 row 3 with the fixed message.
 */
export class MediaStagingRefusedError extends Error {
  name = "MediaStagingRefusedError";

  constructor() {
    super("Media staging was refused");
  }
}

/** A media source and the name its Attachment would get. */
interface MediaSource {
  src: string;
  name: string;
}

const EXPIRED = Symbol("expired");

/**
 * Whether the baseline importers would import a source: it parses as a URL
 * and is not internal.
 *
 * @param src - the source.
 * @returns whether it is importable.
 */
function importable(src: string): boolean {
  try {
    new URL(src);
  } catch {
    return false;
  }
  return !isInternalUrl(src);
}

/**
 * The per-attempt media stager of an enforced write (AD-7). In P2 it selects
 * and rewrites media exactly as the baseline importer of the write's path,
 * and writes each blob with `storeFromUrl` at its final key under a
 * pre-allocated Attachment ID, creating no row. It never logs a source, key,
 * name, or content.
 */
export class MediaStager {
  private readonly invocationId: string;

  private readonly attemptId: string;

  private readonly actor: Pick<User, "id" | "teamId">;

  private readonly preparation: Deadline;

  private readonly requestId: string | undefined;

  private readonly storage: MediaStorage;

  /** Every key this stager owns, by Attachment ID, in staging order. */
  private readonly owned = new Map<string, string>();

  private readonly handles: StagedAttachment[] = [];

  private sealed = false;

  private cleaning: Promise<void> | undefined;

  /**
   * Builds the stager of one attempt.
   *
   * @param args.invocationId - the attempt's correlation ID.
   * @param args.attemptId - the attempt, unique to it.
   * @param args.actor - the acting user, who owns the keys and the rows.
   * @param args.preparation - the attempt's preparation bound.
   * @param args.requestId - the request ID, for the operator diagnostic.
   * @param args.storage - the storage seam; defaults to `FileStorage`.
   */
  constructor(args: {
    invocationId: string;
    attemptId: string;
    actor: Pick<User, "id" | "teamId">;
    preparation: Deadline;
    requestId?: string;
    storage?: MediaStorage;
  }) {
    this.invocationId = args.invocationId;
    this.attemptId = args.attemptId;
    this.actor = args.actor;
    this.preparation = args.preparation;
    this.requestId = args.requestId;
    this.storage = args.storage ?? FileStorage;
  }

  /**
   * The handles staged so far, in source order: what P7 materializes.
   *
   * @returns the handles.
   */
  get attachments(): readonly StagedAttachment[] {
    return [...this.handles];
  }

  /** Refuses every new source from now on; called before `BEGIN`. */
  seal(): void {
    this.sealed = true;
  }

  /**
   * Stages the images of Markdown update text that `documentUpdater` would
   * import (`TextHelper.replaceImagesWithAttachments` with `base64Only`),
   * then rewrites every staged source to its redirect URL.
   *
   * @param text - the update text.
   * @returns the rewritten text.
   * @throws MediaStagingRefusedError when a source is refused.
   */
  async stageMarkdown(text: string): Promise<string> {
    const images = parseImages(text);
    const redirects = await this.stageSources(
      images
        .filter((image) => image.src.startsWith("data:"))
        .map((image) => ({ src: image.src, name: image.alt ?? "image" })),
      images.length
    );
    let output = text;
    for (const image of images) {
      const redirectUrl = redirects.get(image.src);
      if (redirectUrl !== undefined) {
        output = output.replace(
          new RegExp(escapeRegExp(image.src), "g"),
          redirectUrl
        );
      }
    }
    return output;
  }

  /**
   * The `documentImporter` media step of an enforced HTML create. It mirrors
   * `ProsemirrorHelper.replaceImagesWithAttachments`: it stages images, then
   * videos, then `data:` link hrefs, and rewrites them with the same walk.
   *
   * @param doc - the converted document.
   * @returns the rewritten document; the same one when it holds no media.
   * @throws MediaStagingRefusedError when a source is refused.
   */
  async stageProsemirror(doc: Node): Promise<Node> {
    const nodes = [
      ...ProsemirrorHelper.getImages(doc),
      ...ProsemirrorHelper.getVideos(doc),
    ];
    const links: MediaSource[] = [];
    doc.descendants((node) => {
      const link = node.marks.find((mark) => mark.type.name === "link");
      const href = String(link?.attrs.href ?? "");
      if (href.startsWith("data:")) {
        links.push({ src: href, name: node.textContent || "file" });
      }
      return true;
    });
    if (!nodes.length && !links.length) {
      return doc;
    }
    const sources = [
      ...nodes.map((node) => ({
        src: String(node.attrs.src ?? ""),
        name: String(node.attrs.alt ?? node.type.name),
      })),
      ...links,
    ];
    const redirects = await this.stageSources(sources, sources.length);

    /**
     * Rewrites the image and video sources and the link hrefs that were
     * staged, as the baseline does.
     *
     * @param fragment - the fragment.
     * @returns the rewritten fragment.
     */
    const transformFragment = (fragment: Fragment): Fragment => {
      const transformedNodes: Node[] = [];
      fragment.forEach((node) => {
        if (node.type.name === "image" || node.type.name === "video") {
          const redirectUrl = redirects.get(String(node.attrs.src ?? ""));
          if (redirectUrl !== undefined) {
            const json = node.toJSON();
            json.attrs = { ...json.attrs, src: redirectUrl };
            transformedNodes.push(Node.fromJSON(schema, json));
          } else {
            transformedNodes.push(node);
          }
        } else {
          const marks = node.marks.map((mark) => {
            const redirectUrl =
              mark.type.name === "link"
                ? redirects.get(String(mark.attrs.href ?? ""))
                : undefined;
            return redirectUrl !== undefined
              ? mark.type.create({ ...mark.attrs, href: redirectUrl })
              : mark;
          });
          const content =
            node.content.size > 0 ? transformFragment(node.content) : undefined;
          transformedNodes.push(
            (content ? node.copy(content) : node).mark(marks)
          );
        }
      });
      return Fragment.fromArray(transformedNodes);
    };

    return doc.copy(transformFragment(doc.content));
  }

  /**
   * Deletes every key this stager owns, concurrently and at most once,
   * within the cleanup bound. A deletion that rejects or does not settle in
   * time is reported once, by Attachment ID only, and never changes the
   * outcome. From its start, every new source is refused.
   *
   * @returns a promise that never rejects.
   */
  cleanup(): Promise<void> {
    this.cleaning ??= this.deleteOwned();
    return this.cleaning;
  }

  /**
   * Deletes the owned keys; see `cleanup`.
   *
   * @returns a promise that never rejects.
   */
  private async deleteOwned(): Promise<void> {
    const owned = [...this.owned];
    if (owned.length === 0) {
      return;
    }
    const pending = new Set(owned.map(([id]) => id));
    await within(
      Promise.all(
        owned.map(([id, key]) =>
          Promise.resolve()
            .then(() => this.storage.deleteFile(key))
            .then(
              () => {
                pending.delete(id);
              },
              () => undefined
            )
        )
      ),
      STAGED_MEDIA_CLEANUP_BOUND_MS,
      undefined
    );
    if (pending.size > 0) {
      this.reportFailure(
        owned.map(([id]) => id).filter((id) => pending.has(id))
      );
    }
  }

  /**
   * Reports deletions that rejected or did not settle in time, by
   * Attachment ID only; the report never changes the outcome.
   *
   * @param attachmentIds - the IDs of the blobs left behind.
   */
  private reportFailure(attachmentIds: string[]): void {
    try {
      Logger.warn("Enforced write staged media cleanup failed", {
        requestId: this.requestId,
        invocationId: this.invocationId,
        attemptId: this.attemptId,
        attachmentIds,
      });
    } catch {
      // The diagnostic never changes the outcome.
    }
  }

  /**
   * Deletes the key of a blob that landed after cleanup began, within the
   * cleanup bound; a deletion that rejects or does not settle is reported.
   *
   * @param id - the blob's Attachment ID.
   * @param key - its key.
   */
  private deleteLate(id: string, key: string): void {
    void within(
      Promise.resolve()
        .then(() => this.storage.deleteFile(key))
        .then(
          () => true,
          () => false
        ),
      STAGED_MEDIA_CLEANUP_BOUND_MS,
      false
    ).then((deleted) => {
      if (!deleted) {
        this.reportFailure([id]);
      }
    });
  }

  /**
   * Stages each distinct importable source once, under its first
   * occurrence's name, ten at a time.
   *
   * @param sources - the candidate sources, in baseline order.
   * @param count - the baseline's source count, which divides the timeout.
   * @returns the redirect URL of each staged source.
   * @throws MediaStagingRefusedError when a source is refused.
   */
  private async stageSources(
    sources: readonly MediaSource[],
    count: number
  ): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    for (const { src, name } of sources) {
      if (!names.has(src) && importable(src)) {
        names.set(src, name);
      }
    }
    const timeoutMs = Math.floor(Math.min(env.REQUEST_TIMEOUT / count, 10000));
    const staged = new Map<string, StagedAttachment>();
    for (const part of chunk([...names], 10)) {
      await Promise.all(
        part.map(async ([src, name]) => {
          const handle = await this.stageOne(src, name, timeoutMs);
          if (handle) {
            staged.set(src, handle);
          }
        })
      );
    }
    const redirects = new Map<string, string>();
    for (const src of names.keys()) {
      const handle = staged.get(src);
      if (handle) {
        this.handles.push(handle);
        redirects.set(src, Attachment.getRedirectUrl(handle.id));
      }
    }
    return redirects;
  }

  /**
   * Stages one source at its final key. A failed import, as the baseline
   * would see it, keeps the source: undefined, a rejection, or row values
   * the Attachment model would refuse.
   *
   * @param src - the source.
   * @param name - the Attachment name.
   * @param timeoutMs - the baseline's per-source fetch timeout.
   * @returns the handle, or undefined when the import failed.
   * @throws MediaStagingRefusedError when the source is refused or the
   *   storage call outlives the preparation bound.
   */
  private async stageOne(
    src: string,
    name: string,
    timeoutMs: number
  ): Promise<StagedAttachment | undefined> {
    if (this.sealed || this.cleaning || this.preparation.expired()) {
      throw new MediaStagingRefusedError();
    }
    const id = randomUUID();
    const key = AttachmentHelper.getKey({ id, name, userId: this.actor.id });
    const acl = AttachmentHelper.presetToAcl(
      AttachmentPreset.DocumentAttachment
    );
    this.owned.set(id, key);
    const remainingMs = this.preparation.remainingMs();
    const store = Promise.resolve().then(() =>
      this.storage.storeFromUrl(src, key, acl, {
        // Never 0, which the fetch reads as no timeout.
        timeout: Math.min(timeoutMs, Math.max(1, Math.floor(remainingMs))),
      })
    );
    const settled = store.then(
      (result) => result,
      () => undefined
    );
    void settled.then(() => {
      if (this.cleaning) {
        this.deleteLate(id, key);
      }
    });
    const result = await within(settled, remainingMs, EXPIRED);
    if (result === EXPIRED) {
      throw new MediaStagingRefusedError();
    }
    if (!result) {
      return undefined;
    }
    const handle = {
      id,
      key,
      acl,
      size: result.contentLength,
      contentType: result.contentType,
    };
    try {
      await Attachment.build({
        ...handle,
        teamId: this.actor.teamId,
        userId: this.actor.id,
      }).validate();
    } catch {
      return undefined;
    }
    return Object.freeze(handle);
  }
}
