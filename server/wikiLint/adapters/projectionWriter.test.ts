import { randomUUID } from "node:crypto";
import { yDocToProsemirrorJSON } from "y-prosemirror";
import * as Y from "yjs";
import type { NavigationNode } from "@shared/types";
import { TextEditMode } from "@shared/types";
import type { Template, User } from "@server/models";
import { Attachment, Collection, Document, Event } from "@server/models";
import { ProsemirrorHelper } from "@server/models/helpers/ProsemirrorHelper";
import { sequelize } from "@server/storage/database";
import FileStorage from "@server/storage/files";
import {
  buildCollection,
  buildDocument,
  buildTeam,
  buildTemplate,
  buildUser,
} from "@server/test/factories";
import { withAPIContext } from "@server/test/support";
import { Deadline } from "../application/deadline";
import { toCanonicalMarkdown } from "./canonicalSyntax";
import type {
  MarkdownCreateInput,
  MarkdownUpdateInput,
  ProjectedDocument,
} from "./documentProjection";
import {
  prepareMarkdownCreate,
  prepareMarkdownUpdate,
  projectMarkdownCreate,
  projectMarkdownUpdate,
} from "./documentProjection";
import type { StagedAttachment } from "./mediaStaging";
import { MediaStager } from "./mediaStaging";
import {
  UnchangedUpdateError,
  materializeAttachments,
  persistProjectedCreate,
  persistProjectedUpdate,
} from "./projectionWriter";

/** The base body of the update fixtures. */
const BASE_BODY = "Alpha paragraph\n\n## Middle\n\nOmega paragraph";

/**
 * Decodes collaborative state to ProseMirror JSON.
 *
 * @param state - the state, if any.
 * @returns the decoded document, or null.
 */
function decodeState(state: Uint8Array | null | undefined) {
  if (!state) {
    return null;
  }
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, state);
  return yDocToProsemirrorJSON(ydoc, "default");
}

/**
 * Finds the parent a document sits under in a collection structure.
 *
 * @param nodes - the structure.
 * @param documentId - the document.
 * @param parentDocumentId - the parent of `nodes`.
 * @returns the parent, or undefined when the document is absent.
 */
function structureParent(
  nodes: readonly NavigationNode[],
  documentId: string,
  parentDocumentId: string | null = null
): { parentDocumentId: string | null } | undefined {
  for (const node of nodes) {
    if (node.id === documentId) {
      return { parentDocumentId };
    }
    const found = structureParent(node.children, documentId, node.id);
    if (found) {
      return found;
    }
  }
  return undefined;
}

/**
 * Asserts that the stored document is exactly the projection: title,
 * content, text, decoded state, publication, placement, and structure.
 *
 * @param projection - the persisted projection.
 */
async function expectStored(projection: ProjectedDocument) {
  const stored = await Document.unscoped().findOne({
    where: { id: projection.documentId },
    paranoid: false,
    rejectOnEmpty: true,
  });
  const { state, attachments, ...fields } = projection;
  // Only media-free projections are checked here.
  expect(attachments).toEqual([]);
  expect(fields).toEqual({
    documentId: stored.id,
    title: stored.title,
    content: stored.content,
    text: stored.text,
    collectionId: stored.collectionId,
    parentDocumentId: stored.parentDocumentId,
    published: !!stored.publishedAt,
    icon: stored.icon,
    color: stored.color,
    fullWidth: stored.fullWidth,
    templateId: stored.templateId,
    sourceMetadata: stored.sourceMetadata,
  });
  expect(await toCanonicalMarkdown(stored)).toBe(
    await toCanonicalMarkdown(projection.content)
  );
  expect(state === null).toBe(!stored.state);
  if (state) {
    expect(Buffer.from(stored.state!)).toEqual(Buffer.from(state));
    expect(decodeState(stored.state)).toEqual(projection.content);
  }

  const collection = await Collection.findByPk(projection.collectionId, {
    includeDocumentStructure: true,
    rejectOnEmpty: true,
  });
  expect(
    structureParent(collection.documentStructure ?? [], projection.documentId)
  ).toEqual(
    projection.published
      ? { parentDocumentId: projection.parentDocumentId }
      : undefined
  );
}

/**
 * Records the SQL issued during a step and asserts that no `FOR UPDATE` row
 * lock was taken.
 *
 * @param step - the step.
 * @returns the step's result.
 */
async function withoutForUpdate<T>(step: () => Promise<T>): Promise<T> {
  const query = vi.spyOn(sequelize, "query");
  try {
    return await step();
  } finally {
    const statements = query.mock.calls.map(([sql]) =>
      typeof sql === "string" ? sql : sql.query
    );
    query.mockRestore();
    expect(statements.filter((sql) => /\bFOR UPDATE\b/i.test(sql))).toEqual([]);
  }
}

/**
 * Projects and persists a create in one transaction.
 *
 * @param args.actor - the acting user.
 * @param args.collectionId - the post-operation collection.
 * @param args.input - the create arguments.
 * @param args.template - the template, if any.
 * @returns the projection and the returned document.
 */
async function createAndPersist(args: {
  actor: User;
  collectionId: string;
  input: MarkdownCreateInput;
  template?: Template;
}) {
  const { actor, collectionId, input, template } = args;
  return withoutForUpdate(() =>
    withAPIContext(actor, async (ctx) => {
      const projection = await projectMarkdownCreate({
        prepared: prepareMarkdownCreate(input),
        documentId: randomUUID(),
        collectionId,
        actor,
        template,
      });
      const document = await persistProjectedCreate(ctx, projection, template);
      return { projection, document };
    })
  );
}

/**
 * Projects and persists an update in one transaction, from the document as
 * the enforced shell re-fetches it.
 *
 * @param args.actor - the acting user.
 * @param args.documentId - the document.
 * @param args.collectionId - the post-operation collection.
 * @param args.input - the update arguments.
 * @returns the projection and the returned document.
 */
async function updateAndPersist(args: {
  actor: User;
  documentId: string;
  collectionId: string;
  input: MarkdownUpdateInput;
}) {
  const { actor, documentId, collectionId, input } = args;
  return withoutForUpdate(() =>
    withAPIContext(actor, async (ctx) => {
      const document = await Document.findByPk(documentId, {
        userId: actor.id,
        includeState: true,
        rejectOnEmpty: true,
        transaction: ctx.state.transaction,
      });
      const prepared = prepareMarkdownUpdate(input);
      const projection = await projectMarkdownUpdate({
        prepared,
        document,
        collectionId,
      });
      const persisted = await persistProjectedUpdate(ctx, {
        document,
        projection,
        input: prepared.input,
      });
      return { projection, document: persisted };
    })
  );
}

/**
 * Builds an actor, its team, and a collection.
 *
 * @returns the fixture.
 */
async function fixture() {
  const team = await buildTeam();
  const actor = await buildUser({ teamId: team.id, name: "Ada Lovelace" });
  const collection = await buildCollection({
    teamId: team.id,
    userId: actor.id,
  });
  return { team, actor, collection };
}

/**
 * Stores collaborative state matching a document's content.
 *
 * @param document - the document.
 */
async function giveState(document: Document) {
  const ydoc = ProsemirrorHelper.toYDoc(document.content!);
  document.state = Buffer.from(Y.encodeStateAsUpdate(ydoc));
  await document.save();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("persistProjectedCreate", () => {
  it("persists a published create exactly as projected", async () => {
    const { actor, collection } = await fixture();
    const { projection, document } = await createAndPersist({
      actor,
      collectionId: collection.id,
      input: {
        title: "Runbook",
        text: "## Purpose\n\nKeep **things** running.\n\n- one\n- two",
        icon: "🚀",
        color: "#FF0000",
        fullWidth: true,
        publish: true,
        sourceMetadata: { fileName: "runbook.md", mimeType: "text/markdown" },
      },
    });

    expect(document.id).toBe(projection.documentId);
    expect(projection.published).toBe(true);
    await expectStored(projection);
  });

  it("persists a draft exactly as projected", async () => {
    const { actor, collection } = await fixture();
    const { projection } = await createAndPersist({
      actor,
      collectionId: collection.id,
      input: { title: "Draft", text: "Not yet", publish: false },
    });

    expect(projection.published).toBe(false);
    await expectStored(projection);
  });

  it("persists a template create exactly as projected", async () => {
    const { team, actor, collection } = await fixture();
    const template = await buildTemplate({
      teamId: team.id,
      userId: actor.id,
      collectionId: collection.id,
      title: "Note by {author}",
      text: "## Owner\n\nWritten by {author}\n\n## Body\n\nFill in",
      icon: "📝",
      color: "#00FF00",
      fullWidth: true,
    });
    const { projection } = await createAndPersist({
      actor,
      collectionId: collection.id,
      input: { publish: true },
      template,
    });

    expect(projection.title).toBe("Note by Ada Lovelace");
    expect(projection.templateId).toBe(template.id);
    await expectStored(projection);
  });

  it("persists a nested create under its parent", async () => {
    const { actor, collection } = await fixture();
    const parent = await buildDocument({
      teamId: actor.teamId,
      userId: actor.id,
      collectionId: collection.id,
    });
    const { projection } = await createAndPersist({
      actor,
      collectionId: collection.id,
      input: {
        title: "Child",
        text: "Nested",
        publish: true,
        parentDocumentId: parent.id,
      },
    });

    expect(projection.parentDocumentId).toBe(parent.id);
    await expectStored(projection);
  });
});

describe("persistProjectedUpdate", () => {
  /**
   * Builds a published document with the base body.
   *
   * @param withState - whether it has collaborative state.
   * @returns the fixture and the document.
   */
  async function updateFixture(withState: boolean) {
    const fixed = await fixture();
    const document = await buildDocument({
      teamId: fixed.actor.teamId,
      userId: fixed.actor.id,
      collectionId: fixed.collection.id,
      title: "Original",
      text: BASE_BODY,
    });
    if (withState) {
      await giveState(document);
    }
    return { ...fixed, document };
  }

  const MODES: { name: string; input: MarkdownUpdateInput }[] = [
    {
      name: "replace",
      input: {
        text: "## Replaced\n\nWhole body",
        editMode: TextEditMode.Replace,
      },
    },
    {
      name: "append",
      input: { text: "Appended tail", editMode: TextEditMode.Append },
    },
    {
      name: "prepend",
      input: { text: "Prepended head", editMode: TextEditMode.Prepend },
    },
    {
      name: "patch",
      input: {
        text: "Patched paragraph",
        editMode: TextEditMode.Patch,
        findText: "Omega paragraph",
      },
    },
    { name: "title-only", input: { title: "  Retitled  " } },
    {
      name: "display fields",
      input: { icon: "🔥", color: "#123456", fullWidth: true },
    },
    { name: "republish", input: { publish: true, text: "Republished" } },
  ];

  describe.each([false, true])("with prior state: %s", (withState) => {
    it.each(MODES)("persists $name exactly as projected", async ({ input }) => {
      const { actor, collection, document } = await updateFixture(withState);

      const { projection, document: persisted } = await updateAndPersist({
        actor,
        documentId: document.id,
        collectionId: collection.id,
        input,
      });

      expect(persisted.revisionCount).toBeGreaterThan(document.revisionCount);
      expect(projection.state === null).toBe(!withState);
      await expectStored(projection);
    });
  });

  it("persists the appended content in the decoded state", async () => {
    const { actor, collection, document } = await updateFixture(true);

    const { projection } = await updateAndPersist({
      actor,
      documentId: document.id,
      collectionId: collection.id,
      input: { text: "\n\nAppended block", editMode: TextEditMode.Append },
    });

    // `findByPk` applies its own content scope, so the row is read directly.
    const stored = await Document.unscoped().findOne({
      where: { id: document.id },
      rejectOnEmpty: true,
    });
    expect(JSON.stringify(decodeState(stored.state))).toContain(
      "Appended block"
    );
    await expectStored(projection);
  });

  it("publishes a collected draft", async () => {
    const { actor, collection } = await fixture();
    const draft = await buildDocument({
      teamId: actor.teamId,
      userId: actor.id,
      collectionId: collection.id,
      publishedAt: null,
      text: BASE_BODY,
    });

    const { projection } = await updateAndPersist({
      actor,
      documentId: draft.id,
      collectionId: collection.id,
      input: { publish: true },
    });

    expect(projection.published).toBe(true);
    await expectStored(projection);
  });

  it("publishes a collectionless draft into the classified collection", async () => {
    const { actor, collection } = await fixture();
    const draft = await buildDocument({
      teamId: actor.teamId,
      userId: actor.id,
      collectionId: null,
      publishedAt: null,
      text: BASE_BODY,
    });

    const { projection } = await updateAndPersist({
      actor,
      documentId: draft.id,
      collectionId: collection.id,
      input: { publish: true, text: "Published body" },
    });

    expect(projection.collectionId).toBe(collection.id);
    await expectStored(projection);
  });

  it("unpublishes, keeping the collection and ignoring every other field", async () => {
    const { actor, collection, document } = await updateFixture(false);

    const { projection } = await updateAndPersist({
      actor,
      documentId: document.id,
      collectionId: collection.id,
      input: { publish: false, title: "Ignored", text: "Ignored" },
    });

    expect(projection.published).toBe(false);
    expect(projection.title).toBe("Original");
    await expectStored(projection);
    const names = (
      await Event.findAll({ where: { documentId: document.id } })
    ).map((event) => event.name);
    expect(names).toContain("documents.unpublish");
  });

  it("throws on an unchanged update and persists nothing", async () => {
    const { actor, collection, document } = await updateFixture(false);
    const before = await Document.unscoped().findOne({
      where: { id: document.id },
      raw: true,
    });

    for (const input of [{}, { title: "Original" }, { title: " Original " }]) {
      await expect(
        updateAndPersist({
          actor,
          documentId: document.id,
          collectionId: collection.id,
          input,
        })
      ).rejects.toThrow(UnchangedUpdateError);
    }
    await expect(
      Document.unscoped().findOne({ where: { id: document.id }, raw: true })
    ).resolves.toEqual(before);
  });
});

describe("materializeAttachments", () => {
  /** A one-pixel PNG, as a Markdown image `documentUpdater` would import. */
  const DATA_IMAGE =
    "![pixel](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=)";

  /**
   * Stages Markdown text as an enforced attempt's P2 would.
   *
   * @param actor - the acting user.
   * @param text - the text.
   * @returns the rewritten text and the handles.
   */
  async function stage(actor: User, text: string) {
    const stager = new MediaStager({
      invocationId: randomUUID(),
      attemptId: randomUUID(),
      actor,
      preparation: new Deadline(30000),
    });
    const staged = await stager.stageMarkdown(text);
    return { text: staged, attachments: stager.attachments };
  }

  /**
   * Reads the Attachment rows of a team.
   *
   * @param teamId - the team.
   * @returns the rows.
   */
  const rowsOf = (teamId: string) =>
    Attachment.findAll({ where: { teamId }, order: [["createdAt", "ASC"]] });

  /**
   * Records the mutating statements and every storage call of a step.
   *
   * @param step - the step.
   * @returns the step's result, the statements, and the storage calls.
   */
  async function recorded<T>(step: () => Promise<T>) {
    const query = vi.spyOn(sequelize, "query");
    const storage = (
      ["store", "storeFromUrl", "deleteFile", "getFileBuffer"] as const
    ).map((method) => vi.spyOn(FileStorage, method));
    try {
      const result = await step();
      const statements = query.mock.calls
        .map(([sql]) => (typeof sql === "string" ? sql : sql.query))
        .filter((sql) => /^\s*INSERT INTO "(attachments|documents)"/.test(sql));
      const storageCalls = storage.reduce(
        (total, spy) => total + spy.mock.calls.length,
        0
      );
      return { result, statements, storageCalls };
    } finally {
      query.mockRestore();
      for (const spy of storage) {
        spy.mockRestore();
      }
    }
  }

  /**
   * Checks the rows and Events of materialized handles.
   *
   * @param actor - the acting user.
   * @param attachments - the handles.
   */
  async function expectMaterialized(
    actor: User,
    attachments: readonly StagedAttachment[]
  ) {
    const rows = await rowsOf(actor.teamId);
    expect(
      rows.map((row) => ({
        id: row.id,
        key: row.key,
        acl: row.acl,
        size: Number(row.size),
        contentType: row.contentType,
        teamId: row.teamId,
        userId: row.userId,
        documentId: row.documentId,
      }))
    ).toEqual(
      attachments.map((handle) => ({
        ...handle,
        teamId: actor.teamId,
        userId: actor.id,
        documentId: null,
      }))
    );
    const events = await Event.findAll({
      where: { name: "attachments.create", teamId: actor.teamId },
    });
    expect(new Set(events.map((event) => event.modelId))).toEqual(
      new Set(attachments.map((handle) => handle.id))
    );
    expect(events).toHaveLength(attachments.length);
    for (const event of events) {
      expect(event.actorId).toBe(actor.id);
    }
  }

  it("inserts the rows of a create before its document, with no storage call", async () => {
    const { actor, collection } = await fixture();
    const { text, attachments } = await stage(
      actor,
      `## Overview\n\n${DATA_IMAGE}`
    );

    const { statements, storageCalls } = await recorded(() =>
      withAPIContext(actor, async (ctx) => {
        const projection = await projectMarkdownCreate({
          prepared: {
            ...prepareMarkdownCreate({ text, publish: true }),
            attachments,
          },
          documentId: randomUUID(),
          collectionId: collection.id,
          actor,
        });
        return persistProjectedCreate(ctx, projection, null);
      })
    );

    expect(attachments).toHaveLength(1);
    expect(storageCalls).toBe(0);
    expect(statements.map((sql) => sql.slice(0, 25))).toEqual([
      'INSERT INTO "attachments"',
      'INSERT INTO "documents" (',
    ]);
    await expectMaterialized(actor, attachments);
  });

  it("materializes an update's rows and leaves an unpublish without any", async () => {
    const { actor, collection } = await fixture();
    const document = await buildDocument({
      teamId: actor.teamId,
      userId: actor.id,
      collectionId: collection.id,
      text: BASE_BODY,
    });
    const { text, attachments } = await stage(actor, DATA_IMAGE);

    /**
     * Persists an update whose projection carries the staged handles.
     *
     * @param input - the update arguments.
     * @returns the recorded statements and storage calls.
     */
    const persist = (input: MarkdownUpdateInput) =>
      recorded(() =>
        withAPIContext(actor, async (ctx) => {
          const loaded = await Document.findByPk(document.id, {
            userId: actor.id,
            includeState: true,
            rejectOnEmpty: true,
            transaction: ctx.state.transaction,
          });
          const prepared = prepareMarkdownUpdate(input, attachments);
          const projection = await projectMarkdownUpdate({
            prepared,
            document: loaded,
            collectionId: collection.id,
          });
          return persistProjectedUpdate(ctx, {
            document: loaded,
            projection,
            input: prepared.input,
          });
        })
      );

    const unpublished = await persist({ publish: false });
    expect(unpublished.statements).toEqual([]);
    expect(await rowsOf(actor.teamId)).toEqual([]);

    const updated = await persist({ text, publish: true });
    expect(updated.storageCalls).toBe(0);
    expect(updated.statements).toEqual([
      expect.stringMatching(/^INSERT INTO "attachments"/),
    ]);
    expect(updated.result.text).toContain(
      `/api/attachments.redirect?id=${attachments[0].id}`
    );
    await expectMaterialized(actor, attachments);
  });

  it("inserts nothing for no handles", async () => {
    const { actor } = await fixture();

    await withAPIContext(actor, (ctx) => materializeAttachments(ctx, []));

    expect(await rowsOf(actor.teamId)).toEqual([]);
  });
});
