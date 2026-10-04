import { randomUUID } from "node:crypto";
import type { Node } from "prosemirror-model";
import { AttachmentPreset } from "@shared/types";
import { createContext } from "@server/context";
import { schema as editorSchema } from "@server/editor";
import env from "@server/env";
import Logger from "@server/logging/Logger";
import type { User } from "@server/models";
import AttachmentHelper from "@server/models/helpers/AttachmentHelper";
import { ProsemirrorHelper } from "@server/models/helpers/ProsemirrorHelper";
import { TextHelper } from "@server/models/helpers/TextHelper";
import { sequelize } from "@server/storage/database";
import FileStorage from "@server/storage/files";
import { buildUser } from "@server/test/factories";
import {
  Deadline,
  STAGED_MEDIA_CLEANUP_BOUND_MS,
} from "../application/deadline";
import type { MediaStorage } from "./mediaStaging";
import { MediaStager, MediaStagingRefusedError } from "./mediaStaging";

/** A one-pixel PNG. */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/**
 * Builds a distinct `data:` image source; none is a prefix of another.
 *
 * @param n - the distinguishing number.
 * @returns the source.
 */
const dataSrc = (n: number) =>
  `data:image/png;base64,${"A".repeat(4 * (n + 1))}${PNG_BASE64}`;

/** What a stored blob reports, as `storeFromUrl` returns it. */
const STORED = { url: "/stored", contentType: "image/png", contentLength: 3 };

/** Matches a UUID. */
const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/**
 * Serializes a value with every UUID other than the known ones replaced by
 * its order of first appearance, so that two runs with fresh IDs compare.
 *
 * @param value - the value.
 * @param known - the IDs to keep.
 * @returns the normalized JSON.
 */
function normalized(value: unknown, known: readonly string[]): string {
  const seen = new Map<string, string>();
  return JSON.stringify(value).replace(UUID_PATTERN, (id) => {
    if (known.includes(id)) {
      return id;
    }
    if (!seen.has(id)) {
      seen.set(id, `<id ${seen.size}>`);
    }
    return seen.get(id)!;
  });
}

/**
 * Builds a fake storage whose stores succeed at once.
 *
 * @returns the storage and its spies.
 */
function fakeStorage() {
  const storeFromUrl = vi.fn(
    (_url: string, _key: string, _acl: string, _init?: { timeout?: number }) =>
      Promise.resolve<typeof STORED | undefined>(STORED)
  );
  const deleteFile = vi.fn((_key: string) => Promise.resolve());
  return {
    storage: { storeFromUrl, deleteFile } as unknown as MediaStorage,
    storeFromUrl,
    deleteFile,
  };
}

/**
 * Builds a stager.
 *
 * @param actor - the acting user.
 * @param options.storage - the storage seam; `FileStorage` when omitted.
 * @param options.preparation - the preparation bound; 30 seconds by default.
 * @returns the stager and its identifiers.
 */
function stagerOf(
  actor: Pick<User, "id" | "teamId">,
  options: { storage?: MediaStorage; preparation?: Deadline } = {}
) {
  const ids = {
    invocationId: randomUUID(),
    attemptId: randomUUID(),
    requestId: randomUUID(),
  };
  const stager = new MediaStager({
    ...ids,
    actor,
    preparation: options.preparation ?? new Deadline(30000),
    storage: options.storage,
  });
  return { stager, ...ids };
}

/** A fixture actor that is never stored. */
const actorStub = () => ({ id: randomUUID(), teamId: randomUUID() });

/**
 * Builds a document of top-level nodes.
 *
 * @param content - the nodes, as JSON.
 * @returns the document.
 */
const docOf = (content: unknown[]) =>
  editorSchema.nodeFromJSON({ type: "doc", content });

/**
 * Builds a paragraph holding one image.
 *
 * @param src - its source.
 * @param alt - its alternative text.
 * @returns the paragraph JSON.
 */
const imageParagraph = (src: string, alt?: string) => ({
  type: "paragraph",
  content: [{ type: "image", attrs: { src, ...(alt && { alt }) } }],
});

/**
 * Builds a paragraph holding one linked text.
 *
 * @param href - the link.
 * @param text - the text.
 * @returns the paragraph JSON.
 */
const linkParagraph = (href: string, text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text, marks: [{ type: "link", attrs: { href } }] }],
});

/**
 * Waits for queued promise callbacks and timers to run.
 *
 * @param ms - the wait.
 */
const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Markdown staging", () => {
  it("stages exactly what documentUpdater imports and rewrites the text as it does", async () => {
    const actor = await buildUser();
    const text = [
      `![pixel](${dataSrc(0)})`,
      `![](${dataSrc(1)})`,
      "![external](https://example.com/a.png)",
      "![internal](/api/attachments.redirect?id=1)",
      `![again](${dataSrc(0)})`,
      `Inline ![second](${dataSrc(2)}) image`,
    ].join("\n\n");
    const storeFromUrl = vi
      .spyOn(FileStorage, "storeFromUrl")
      .mockResolvedValue(STORED);

    const baseline = await TextHelper.replaceImagesWithAttachments(
      createContext({ user: actor }),
      text,
      actor,
      { base64Only: true }
    );
    const baselineCalls = storeFromUrl.mock.calls.slice();
    storeFromUrl.mockClear();
    const query = vi.spyOn(sequelize, "query");
    const { stager } = stagerOf(actor);
    const staged = await stager.stageMarkdown(text);

    expect(query).not.toHaveBeenCalled();
    expect(normalized(storeFromUrl.mock.calls, [actor.id])).toEqual(
      normalized(baselineCalls, [actor.id])
    );
    expect(normalized(staged, [])).toEqual(normalized(baseline, []));
    expect(staged).not.toContain("data:");
    expect(staged).toContain("https://example.com/a.png");
    expect(stager.attachments).toHaveLength(3);
    for (const [i, handle] of stager.attachments.entries()) {
      const [src, key, acl, init] = storeFromUrl.mock.calls[i];
      expect(src).toBe([dataSrc(0), dataSrc(1), dataSrc(2)][i]);
      expect(handle).toEqual({
        id: AttachmentHelper.parseKey(key).id,
        key,
        acl: AttachmentHelper.presetToAcl(AttachmentPreset.DocumentAttachment),
        size: STORED.contentLength,
        contentType: STORED.contentType,
      });
      expect(acl).toBe(handle.acl);
      expect(init).toEqual({
        timeout: Math.floor(Math.min(env.REQUEST_TIMEOUT / 5, 10000)),
      });
      expect(staged).toContain(`/api/attachments.redirect?id=${handle.id}`);
    }
    expect(stager.attachments[0].key).toBe(
      `uploads/${actor.id}/${stager.attachments[0].id}/pixel`
    );
  });

  it("stores the decoded blob at its final key and deletes it on cleanup", async () => {
    const actor = actorStub();
    const { stager } = stagerOf(actor);

    const staged = await stager.stageMarkdown(`![pixel](${dataSrc(0)})`);

    const [handle] = stager.attachments;
    expect(staged).toBe(`![pixel](/api/attachments.redirect?id=${handle.id})`);
    expect(handle).toEqual({
      id: handle.id,
      key: `uploads/${actor.id}/${handle.id}/pixel`,
      acl: AttachmentHelper.presetToAcl(AttachmentPreset.DocumentAttachment),
      size: Buffer.from(dataSrc(0).split(",")[1], "base64").length,
      contentType: "image/png",
    });
    expect(Object.isFrozen(handle)).toBe(true);
    await expect(FileStorage.getFileBuffer(handle.key)).resolves.toEqual(
      Buffer.from(dataSrc(0).split(",")[1], "base64")
    );

    await stager.cleanup();
    await expect(FileStorage.getFileExists(handle.key)).resolves.toBe(false);
  });

  it("keeps a source whose import fails, as the baseline does, owns a failed store's key, and deletes a refused blob at once", async () => {
    const actor = actorStub();
    const { storage, storeFromUrl, deleteFile } = fakeStorage();
    storeFromUrl
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("store failed"))
      .mockResolvedValueOnce({
        ...STORED,
        contentType: `image/${"x".repeat(250)}`,
      });
    const { stager } = stagerOf(actor, { storage });
    const text = [0, 1, 2].map((n) => `![f${n}](${dataSrc(n)})`).join("\n\n");

    expect(await stager.stageMarkdown(text)).toBe(text);
    expect(stager.attachments).toEqual([]);
    const [unstoredKey, rejectedKey, refusedKey] = storeFromUrl.mock.calls.map(
      ([, key]) => key
    );
    await settle();
    expect(deleteFile.mock.calls.map(([key]) => key)).toEqual([refusedKey]);

    await stager.cleanup();
    expect(deleteFile.mock.calls.map(([key]) => key)).toEqual([
      refusedKey,
      unstoredKey,
      rejectedKey,
    ]);
  });

  it.each([
    {
      outcome: "rejects",
      deletion: () => Promise.reject(new Error("delete failed for a key")),
      settles: true,
    },
    {
      outcome: "does not settle",
      deletion: () => new Promise<void>(() => undefined),
      settles: false,
    },
  ])(
    "reports a refused blob's deletion that $outcome, by Attachment ID only",
    async ({ deletion, settles }) => {
      const { storage, storeFromUrl, deleteFile } = fakeStorage();
      storeFromUrl.mockResolvedValueOnce({
        ...STORED,
        contentType: `image/${"x".repeat(250)}`,
      });
      deleteFile.mockImplementationOnce(deletion);
      const warn = vi.spyOn(Logger, "warn");
      const { stager, requestId, invocationId, attemptId } = stagerOf(
        actorStub(),
        { storage }
      );
      const text = `![refused](${dataSrc(0)})`;

      expect(await stager.stageMarkdown(text)).toBe(text);
      if (!settles) {
        // Staging does not wait for the deletion, so nothing is reported yet.
        expect(warn).not.toHaveBeenCalled();
      }
      await vi.waitFor(() => expect(warn).toHaveBeenCalled(), {
        timeout: STAGED_MEDIA_CLEANUP_BOUND_MS + 1000,
      });

      const [[src, key]] = storeFromUrl.mock.calls;
      expect(deleteFile.mock.calls.map(([deleted]) => deleted)).toEqual([key]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        "Enforced write staged media cleanup failed",
        {
          requestId,
          invocationId,
          attemptId,
          attachmentIds: [AttachmentHelper.parseKey(key).id],
        }
      );
      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).not.toContain(src);
      expect(logged).not.toContain(key);
      expect(logged).not.toMatch(/uploads|refused|data:|delete failed/);

      await stager.cleanup();
      expect(deleteFile).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
    }
  );
});

describe("ProseMirror staging", () => {
  it("stages and rewrites exactly as replaceImagesWithAttachments", async () => {
    const actor = await buildUser();
    const doc = docOf([
      imageParagraph(dataSrc(0), "pixel"),
      imageParagraph("https://example.com/a.png"),
      imageParagraph("/api/attachments.redirect?id=1", "internal"),
      imageParagraph("not a url", "bad"),
      {
        type: "video",
        attrs: { src: "https://example.com/v.mp4", title: "v" },
      },
      linkParagraph(dataSrc(1), "report"),
      linkParagraph("https://example.com/page", "page"),
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "bold",
            marks: [
              { type: "strong" },
              { type: "link", attrs: { href: dataSrc(2) } },
            ],
          },
        ],
      },
    ]);
    const storeFromUrl = vi
      .spyOn(FileStorage, "storeFromUrl")
      .mockResolvedValue(STORED);

    const baseline = await ProsemirrorHelper.replaceImagesWithAttachments(
      createContext({ user: actor }),
      doc,
      actor
    );
    const baselineCalls = storeFromUrl.mock.calls.slice();
    storeFromUrl.mockClear();
    const { stager } = stagerOf(actor);
    const staged = await stager.stageProsemirror(doc);

    expect(normalized(storeFromUrl.mock.calls, [actor.id])).toEqual(
      normalized(baselineCalls, [actor.id])
    );
    expect(normalized(staged.toJSON(), [])).toEqual(
      normalized(baseline.toJSON(), [])
    );
    expect(storeFromUrl.mock.calls.map(([src, key]) => [src, key])).toEqual([
      [dataSrc(0), expect.stringMatching(/\/pixel$/)],
      ["https://example.com/a.png", expect.stringMatching(/\/image$/)],
      ["https://example.com/v.mp4", expect.stringMatching(/\/video$/)],
      [dataSrc(1), expect.stringMatching(/\/report$/)],
      [dataSrc(2), expect.stringMatching(/\/bold$/)],
    ]);
    expect(stager.attachments).toHaveLength(5);
    expect(JSON.stringify(staged.toJSON())).not.toContain("data:");
  });

  it("returns the same document when it holds no media", async () => {
    const { storage, storeFromUrl } = fakeStorage();
    const { stager } = stagerOf(actorStub(), { storage });
    const doc = docOf([linkParagraph("https://example.com/page", "page")]);

    expect(await stager.stageProsemirror(doc)).toBe(doc);
    expect(storeFromUrl).not.toHaveBeenCalled();
  });

  it("stages a repeated source once, under its first name, and rewrites every use", async () => {
    const { storage, storeFromUrl } = fakeStorage();
    const { stager } = stagerOf(actorStub(), { storage });
    const doc = docOf([
      imageParagraph(dataSrc(0), "first"),
      linkParagraph(dataSrc(0), "second"),
      imageParagraph(dataSrc(0), "third"),
    ]);

    const staged = await stager.stageProsemirror(doc);

    expect(storeFromUrl).toHaveBeenCalledTimes(1);
    expect(storeFromUrl.mock.calls[0][1]).toMatch(/\/first$/);
    const [handle] = stager.attachments;
    const redirect = `/api/attachments.redirect?id=${handle.id}`;
    const json = JSON.stringify(staged.toJSON());
    expect(json.split(redirect)).toHaveLength(4);
    expect(json).not.toContain("data:");
  });

  it("stages ten sources at a time", async () => {
    const { storage, storeFromUrl } = fakeStorage();
    const release: (() => void)[] = [];
    storeFromUrl.mockImplementation(
      () =>
        new Promise((resolve) => {
          release.push(() => resolve(STORED));
        })
    );
    const { stager } = stagerOf(actorStub(), { storage });
    const doc = docOf(
      Array.from({ length: 12 }, (_, n) => imageParagraph(dataSrc(n), `i${n}`))
    );

    const staging = stager.stageProsemirror(doc);
    await settle();
    expect(storeFromUrl).toHaveBeenCalledTimes(10);
    release.splice(0, 9).forEach((resolve) => resolve());
    await settle();
    expect(storeFromUrl).toHaveBeenCalledTimes(10);
    release.splice(0).forEach((resolve) => resolve());
    await settle();
    expect(storeFromUrl).toHaveBeenCalledTimes(12);
    release.splice(0).forEach((resolve) => resolve());
    await staging;

    expect(stager.attachments).toHaveLength(12);
    for (const [, , , init] of storeFromUrl.mock.calls) {
      expect(init).toEqual({
        timeout: Math.floor(Math.min(env.REQUEST_TIMEOUT / 12, 10000)),
      });
    }
  });

  it("caps the fetch timeout at the preparation remainder", async () => {
    const { storage, storeFromUrl } = fakeStorage();
    let now = 0;
    const preparation = new Deadline(30000, () => now);
    now = 30000 - 700.5;
    const { stager } = stagerOf(actorStub(), { storage, preparation });

    await stager.stageProsemirror(
      docOf([imageParagraph("https://example.com/a.png")])
    );

    expect(storeFromUrl.mock.calls[0][3]).toEqual({ timeout: 700 });
  });

  it("never passes a zero timeout, which the fetch reads as none", async () => {
    const { storage, storeFromUrl } = fakeStorage();
    let now = 0;
    const preparation = new Deadline(30000, () => now);
    now = 30000 - 0.5;
    const { stager } = stagerOf(actorStub(), { storage, preparation });

    await stager.stageProsemirror(
      docOf([imageParagraph("https://example.com/a.png")])
    );

    expect(storeFromUrl.mock.calls[0][3]).toEqual({ timeout: 1 });
  });
});

describe("refusal", () => {
  it.each([
    ["after the preparation bound", () => new Deadline(-1), () => undefined],
    [
      "once sealed",
      () => new Deadline(30000),
      (stager: MediaStager) => stager.seal(),
    ],
    [
      "once cleanup has begun",
      () => new Deadline(30000),
      (stager: MediaStager) => void stager.cleanup(),
    ],
  ])("refuses a new source %s", async (_name, preparation, before) => {
    const { storage, storeFromUrl } = fakeStorage();
    const { stager } = stagerOf(actorStub(), {
      storage,
      preparation: preparation(),
    });
    before(stager);

    await expect(
      stager.stageMarkdown(`![pixel](${dataSrc(0)})`)
    ).rejects.toBeInstanceOf(MediaStagingRefusedError);
    await expect(
      stager.stageProsemirror(docOf([imageParagraph(dataSrc(0))]))
    ).rejects.toBeInstanceOf(MediaStagingRefusedError);
    expect(storeFromUrl).not.toHaveBeenCalled();
  });

  it("still converts text without importable media once sealed", async () => {
    const { storage } = fakeStorage();
    const { stager } = stagerOf(actorStub(), { storage });
    stager.seal();
    const text = "![external](https://example.com/a.png)";

    expect(await stager.stageMarkdown(text)).toBe(text);
  });

  it("refuses a store that outlives the bound, and deletes it once it lands after cleanup", async () => {
    const { storage, storeFromUrl, deleteFile } = fakeStorage();
    let land: (() => void) | undefined;
    storeFromUrl.mockResolvedValueOnce(STORED).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          land = () => resolve(STORED);
        })
    );
    // The bound leaves 100 ms to every store until the clock is advanced.
    let now = 0;
    const { stager } = stagerOf(actorStub(), {
      storage,
      preparation: new Deadline(100, () => now),
    });
    const text = `![a](${dataSrc(0)}) ![b](${dataSrc(1)})`;

    await expect(stager.stageMarkdown(text)).rejects.toBeInstanceOf(
      MediaStagingRefusedError
    );
    const [first, late] = storeFromUrl.mock.calls.map(([, key]) => key);
    now = 100;
    await expect(
      stager.stageMarkdown(`![c](${dataSrc(2)})`)
    ).rejects.toBeInstanceOf(MediaStagingRefusedError);
    expect(storeFromUrl).toHaveBeenCalledTimes(2);

    await stager.cleanup();
    expect(deleteFile.mock.calls.map(([key]) => key)).toEqual([first, late]);
    land!();
    await settle();
    expect(deleteFile.mock.calls.map(([key]) => key)).toEqual([
      first,
      late,
      late,
    ]);
  });

  it("reports a late deletion that fails, by Attachment ID only", async () => {
    const { storage, storeFromUrl, deleteFile } = fakeStorage();
    let land: (() => void) | undefined;
    storeFromUrl.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          land = () => resolve(STORED);
        })
    );
    // Cleanup's deletion succeeds; the late one rejects.
    deleteFile
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("delete failed for a key"));
    const warn = vi.spyOn(Logger, "warn");
    const { stager, requestId, invocationId, attemptId } = stagerOf(
      actorStub(),
      { storage, preparation: new Deadline(50, () => 0) }
    );

    await expect(
      stager.stageMarkdown(`![late](${dataSrc(0)})`)
    ).rejects.toBeInstanceOf(MediaStagingRefusedError);
    await stager.cleanup();
    expect(warn).not.toHaveBeenCalled();
    land!();
    await settle();

    const [[, key]] = storeFromUrl.mock.calls;
    expect(deleteFile.mock.calls.map(([deleted]) => deleted)).toEqual([
      key,
      key,
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "Enforced write staged media cleanup failed",
      {
        requestId,
        invocationId,
        attemptId,
        attachmentIds: [AttachmentHelper.parseKey(key).id],
      }
    );
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(
      /uploads|late|data:|delete failed/
    );
  });

  it("deletes nothing when a slow store lands before cleanup", async () => {
    const { storage, storeFromUrl, deleteFile } = fakeStorage();
    let land: (() => void) | undefined;
    storeFromUrl.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          land = () => resolve(STORED);
        })
    );
    const { stager } = stagerOf(actorStub(), {
      storage,
      preparation: new Deadline(50, () => 0),
    });

    await expect(
      stager.stageMarkdown(`![a](${dataSrc(0)})`)
    ).rejects.toBeInstanceOf(MediaStagingRefusedError);
    land!();
    await settle();

    expect(deleteFile).not.toHaveBeenCalled();
  });
});

describe("cleanup", () => {
  it("deletes only its own keys, once, however often it is called", async () => {
    const { storage, storeFromUrl, deleteFile } = fakeStorage();
    const actor = actorStub();
    const { stager } = stagerOf(actor, { storage });
    const other = stagerOf(actor, { storage }).stager;
    await stager.stageMarkdown(`![a](${dataSrc(0)}) ![b](${dataSrc(1)})`);
    await other.stageMarkdown(`![c](${dataSrc(2)})`);
    const own = storeFromUrl.mock.calls.slice(0, 2).map(([, key]) => key);

    const first = stager.cleanup();
    expect(stager.cleanup()).toBe(first);
    await first;
    await stager.cleanup();

    expect(deleteFile.mock.calls.map(([key]) => key)).toEqual(own);
  });

  it("does nothing for a stager that staged nothing", async () => {
    const { storage, deleteFile } = fakeStorage();
    const warn = vi.spyOn(Logger, "warn");
    const { stager } = stagerOf(actorStub(), { storage });

    await stager.cleanup();

    expect(deleteFile).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("reports a rejected or unsettled deletion once, by Attachment ID only", async () => {
    const { storage, storeFromUrl, deleteFile } = fakeStorage();
    deleteFile
      .mockRejectedValueOnce(new Error("delete failed for a key"))
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockResolvedValueOnce(undefined);
    const warn = vi.spyOn(Logger, "warn");
    const actor = actorStub();
    const { stager, requestId, invocationId, attemptId } = stagerOf(actor, {
      storage,
    });
    await stager.stageMarkdown(
      [0, 1, 2].map((n) => `![name${n}](${dataSrc(n)})`).join("\n\n")
    );
    const [rejected, unsettled] = stager.attachments;
    const started = performance.now();

    await stager.cleanup();
    await stager.cleanup();

    const elapsed = performance.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(STAGED_MEDIA_CLEANUP_BOUND_MS - 50);
    expect(elapsed).toBeLessThan(STAGED_MEDIA_CLEANUP_BOUND_MS + 1000);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "Enforced write staged media cleanup failed",
      {
        requestId,
        invocationId,
        attemptId,
        attachmentIds: [rejected.id, unsettled.id],
      }
    );
    const logged = JSON.stringify(warn.mock.calls);
    for (const [src, key] of storeFromUrl.mock.calls) {
      expect(logged).not.toContain(src);
      expect(logged).not.toContain(key);
    }
    expect(logged).not.toMatch(/name\d|delete failed|uploads/);
  });

  it("never logs a source, key, name, or content while staging", async () => {
    const { storage, storeFromUrl } = fakeStorage();
    storeFromUrl
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("store failed"));
    const spies = (["debug", "info", "warn", "error"] as const).map((level) =>
      vi.spyOn(Logger, level)
    );
    const { stager } = stagerOf(actorStub(), { storage });

    await stager.stageProsemirror(
      docOf([
        imageParagraph(dataSrc(0), "a"),
        imageParagraph(dataSrc(1), "b"),
        imageParagraph(dataSrc(2), "c"),
      ])
    );
    await stager.cleanup();

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("returns a copy of its handles in source order", async () => {
    const { storage } = fakeStorage();
    const { stager } = stagerOf(actorStub(), { storage });
    const doc: Node = docOf([
      imageParagraph(dataSrc(0), "a"),
      imageParagraph(dataSrc(1), "b"),
    ]);
    await stager.stageProsemirror(doc);

    const attachments = stager.attachments as unknown[];
    attachments.pop();

    expect(stager.attachments.map((handle) => handle.key)).toEqual([
      expect.stringMatching(/\/a$/),
      expect.stringMatching(/\/b$/),
    ]);
  });
});
