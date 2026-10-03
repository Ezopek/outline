import { randomUUID } from "node:crypto";
import { yDocToProsemirrorJSON } from "y-prosemirror";
import * as Y from "yjs";
import type { NavigationNode, ProsemirrorData } from "@shared/types";
import { TextEditMode } from "@shared/types";
import attachmentCreator from "@server/commands/attachmentCreator";
import type * as AttachmentCreator from "@server/commands/attachmentCreator";
import documentCreator from "@server/commands/documentCreator";
import documentUpdater from "@server/commands/documentUpdater";
import type { Template, User } from "@server/models";
import { Collection, Document, Event } from "@server/models";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";
import { ProsemirrorHelper } from "@server/models/helpers/ProsemirrorHelper";
import { sequelize } from "@server/storage/database";
import FileStorage from "@server/storage/files";
import {
  buildCollection,
  buildDocument,
  buildDraftDocument,
  buildTeam,
  buildTemplate,
  buildUser,
} from "@server/test/factories";
import { withAPIContext } from "@server/test/support";
import { abortMessage } from "../application/writeDecision";
import { WikiLintContractError } from "../core/contracts";
import { OPERATION_FAILED } from "../core/registry";
import { toCanonicalMarkdown } from "./canonicalSyntax";
import type {
  MarkdownCreateInput,
  MarkdownUpdateInput,
  ProjectedDocument,
} from "./documentProjection";
import {
  UnstagedMediaError,
  prepareMarkdownCreate,
  prepareMarkdownUpdate,
  projectMarkdownCreate,
  projectMarkdownUpdate,
} from "./documentProjection";

vi.mock("@server/commands/attachmentCreator", async (importOriginal) => {
  const actual = await importOriginal<typeof AttachmentCreator>();
  return { ...actual, default: vi.fn(actual.default) };
});

/** A one-pixel PNG, as a Markdown image the baseline would import. */
const DATA_IMAGE =
  "![pixel](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==)";

/** The base body of the update fixtures: paragraphs at both ends. */
const BASE_BODY = "Alpha paragraph\n\n## Middle\n\nOmega paragraph";

/**
 * Runs a projection step and proves it had no effect: no SQL statement, no
 * transaction, no scheduled Event, no Attachment, and no stored blob, whether
 * it completes or throws.
 *
 * @param step - the step.
 * @returns the step's result.
 */
async function withoutEffect<T>(step: () => Promise<T> | T): Promise<T> {
  const query = vi.spyOn(sequelize, "query");
  const transaction = vi.spyOn(sequelize, "transaction");
  const schedule = vi.spyOn(Event, "schedule");
  const store = vi.spyOn(FileStorage, "store");
  const storeFromUrl = vi.spyOn(FileStorage, "storeFromUrl");
  vi.mocked(attachmentCreator).mockClear();
  try {
    return await step();
  } finally {
    const calls = {
      query: query.mock.calls.length,
      transaction: transaction.mock.calls.length,
      schedule: schedule.mock.calls.length,
      attachment: vi.mocked(attachmentCreator).mock.calls.length,
      store: store.mock.calls.length,
      storeFromUrl: storeFromUrl.mock.calls.length,
    };
    query.mockRestore();
    transaction.mockRestore();
    schedule.mockRestore();
    store.mockRestore();
    storeFromUrl.mockRestore();
    expect(calls).toEqual({
      query: 0,
      transaction: 0,
      schedule: 0,
      attachment: 0,
      store: 0,
      storeFromUrl: 0,
    });
  }
}

/**
 * Reads a persisted document row as stored, bypassing every scope.
 *
 * @param id - the document ID.
 * @returns the row, state included.
 */
const storedDocument = (id: string) =>
  Document.unscoped().findOne({
    where: { id },
    paranoid: false,
    rejectOnEmpty: true,
  });

/**
 * Reads the stored rows a projection must leave unchanged.
 *
 * @param documentId - the document, if it exists.
 * @param collectionId - its collection.
 * @returns the raw rows.
 */
const storedRows = async (documentId: string, collectionId: string) => ({
  document: await Document.unscoped().findOne({
    where: { id: documentId },
    paranoid: false,
    raw: true,
  }),
  collection: await Collection.unscoped().findOne({
    where: { id: collectionId },
    paranoid: false,
    raw: true,
  }),
});

/**
 * Decodes collaborative state to ProseMirror JSON. Two writers produce
 * different bytes for one edit, since every Y.Doc has its own client ID.
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
 * Finds a document in a collection structure.
 *
 * @param nodes - the structure.
 * @param documentId - the document.
 * @param parentDocumentId - the parent of `nodes`.
 * @returns the parent the document sits under, or undefined when absent.
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
 * Asserts that a projection equals what the baseline writer persisted.
 *
 * @param projection - the projection.
 */
async function expectParity(projection: ProjectedDocument) {
  const stored = await storedDocument(projection.documentId);
  const { state, ...fields } = projection;
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
  expect(await toCanonicalMarkdown(projection.content)).toBe(
    await toCanonicalMarkdown(stored)
  );
  expect(state === null).toBe(!stored.state);
  expect(decodeState(state)).toEqual(decodeState(stored.state));

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
 * Projects a create, then writes it with `documentCreator` and the MCP
 * argument mapping, and asserts parity and an untouched template.
 *
 * @param args.actor - the acting user.
 * @param args.collectionId - the post-operation collection.
 * @param args.input - the create arguments.
 * @param args.template - the selected template, if any.
 * @returns the projection.
 */
async function createWithParity(args: {
  actor: User;
  collectionId: string;
  input: MarkdownCreateInput;
  template?: Template;
}) {
  const { actor, collectionId, input, template } = args;
  const documentId = randomUUID();
  const templateContent = structuredClone(template?.content);
  const before = await storedRows(documentId, collectionId);

  const projection = await withoutEffect(async () =>
    projectMarkdownCreate({
      prepared: prepareMarkdownCreate(input),
      documentId,
      collectionId,
      actor,
      template,
    })
  );
  await expect(storedRows(documentId, collectionId)).resolves.toEqual(before);
  if (template) {
    expect(template.changed()).toBe(false);
    expect(template.content).toEqual(templateContent);
  }

  await withAPIContext(actor, (ctx) =>
    documentCreator(ctx, {
      id: documentId,
      title: input.title,
      text: input.text,
      icon: input.icon,
      color: input.color,
      parentDocumentId: input.parentDocumentId,
      publish: input.publish,
      collectionId,
      template,
      fullWidth: input.fullWidth,
      sourceMetadata: input.sourceMetadata,
    })
  );
  await expectParity(projection);
  return projection;
}

/**
 * Loads a document as the MCP update handler does.
 *
 * @param id - the document.
 * @param actor - the acting user.
 * @returns the document, state included.
 */
const loadForUpdate = (id: string, actor: User) =>
  Document.findByPk(id, {
    userId: actor.id,
    includeState: true,
    rejectOnEmpty: true,
  });

/**
 * Projects an update from a freshly loaded document, then writes it through
 * the MCP handler's baseline path, and asserts parity and an untouched
 * document instance.
 *
 * @param args.actor - the acting user.
 * @param args.documentId - the document.
 * @param args.collectionId - the post-operation collection.
 * @param args.input - the update arguments.
 * @param args.publishCollectionId - the `collectionId` argument of a publish.
 * @returns the projection.
 */
async function updateWithParity(args: {
  actor: User;
  documentId: string;
  collectionId: string;
  input: MarkdownUpdateInput;
  publishCollectionId?: string;
}) {
  const { actor, documentId, collectionId, input } = args;
  const document = await loadForUpdate(documentId, actor);
  const content = structuredClone(document.content);
  const before = await storedRows(documentId, collectionId);

  const projection = await withoutEffect(async () =>
    projectMarkdownUpdate({
      prepared: prepareMarkdownUpdate(input),
      document,
      collectionId,
    })
  );
  await expect(storedRows(documentId, collectionId)).resolves.toEqual(before);
  expect(document.changed()).toBe(false);
  expect(Object.isFrozen(document.content ?? {})).toBe(false);
  expect(document.content).toEqual(content);

  await withAPIContext(actor, (ctx) =>
    input.publish === false
      ? document.unpublishWithCtx(ctx, { detach: false })
      : documentUpdater(ctx, {
          document,
          ...input,
          collectionId: args.publishCollectionId,
        })
  );
  await expectParity(projection);
  return projection;
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

/**
 * Clears a document's stored content, bypassing the hook that backfills it,
 * so that only its state and text remain.
 *
 * @param document - the document.
 */
async function dropContent(document: Document) {
  await Document.update(
    { content: null },
    { where: { id: document.id }, hooks: false }
  );
}

/**
 * Checks that every object reachable from a value is frozen.
 *
 * @param value - the value.
 * @returns whether it is deep-frozen.
 */
function isDeepFrozen(value: unknown): boolean {
  if (value === null || typeof value !== "object") {
    return true;
  }
  return Object.isFrozen(value) && Object.values(value).every(isDeepFrozen);
}

/**
 * Builds an actor with a fixed name, its team, and a collection.
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

describe("projectMarkdownCreate", () => {
  it("matches documentCreator for a published create with explicit fields", async () => {
    const { actor, collection } = await fixture();
    const projection = await createWithParity({
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
    expect(projection.published).toBe(true);
    expect(projection.state).toBeNull();
  });

  it("matches documentCreator for a draft", async () => {
    const { actor, collection } = await fixture();
    const projection = await createWithParity({
      actor,
      collectionId: collection.id,
      input: { title: "Draft", text: "Not yet", publish: false },
    });
    expect(projection.published).toBe(false);
    expect(projection.icon).toBeNull();
    expect(projection.fullWidth).toBe(false);
  });

  it("matches documentCreator without text, title, or template", async () => {
    const { actor, collection } = await fixture();
    const projection = await createWithParity({
      actor,
      collectionId: collection.id,
      input: { publish: true },
    });
    expect(projection.title).toBe("");
  });

  it("projects the complete substituted template body and leaves the template untouched", async () => {
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
    const projection = await createWithParity({
      actor,
      collectionId: collection.id,
      input: { publish: true },
      template,
    });
    expect(projection.title).toBe("Note by Ada Lovelace");
    expect(await toCanonicalMarkdown(projection.content)).toBe(
      "## Owner\n\nWritten by Ada Lovelace\n\n## Body\n\nFill in"
    );
    expect(projection).toMatchObject({
      icon: "📝",
      color: "#00FF00",
      fullWidth: true,
      templateId: template.id,
    });
  });

  it("falls back to the template body for empty text", async () => {
    const { team, actor, collection } = await fixture();
    const template = await buildTemplate({
      teamId: team.id,
      userId: actor.id,
      collectionId: collection.id,
      text: "Written by {author}",
    });
    const projection = await createWithParity({
      actor,
      collectionId: collection.id,
      input: { text: "", publish: true },
      template,
    });
    expect(await toCanonicalMarkdown(projection.content)).toBe(
      "Written by Ada Lovelace"
    );
  });

  it("gives explicit fields precedence over the template", async () => {
    const { team, actor, collection } = await fixture();
    const template = await buildTemplate({
      teamId: team.id,
      userId: actor.id,
      collectionId: collection.id,
      title: "Template {author}",
      text: "Template body by {author}",
      icon: "📝",
      color: "#00FF00",
    });
    const projection = await createWithParity({
      actor,
      collectionId: collection.id,
      input: {
        title: "Explicit",
        text: "Explicit body",
        icon: "🚀",
        publish: true,
      },
      template,
    });
    expect(projection).toMatchObject({
      title: "Explicit",
      text: "Explicit body",
      icon: "🚀",
      color: "#00FF00",
      templateId: template.id,
    });
  });

  it("places a published child under its parent", async () => {
    const { team, actor, collection } = await fixture();
    const parent = await buildDocument({
      teamId: team.id,
      userId: actor.id,
      collectionId: collection.id,
    });
    const projection = await createWithParity({
      actor,
      collectionId: collection.id,
      input: {
        title: "Child",
        text: "Body",
        parentDocumentId: parent.id,
        publish: true,
      },
    });
    expect(projection.parentDocumentId).toBe(parent.id);
  });
});

describe("projectMarkdownUpdate", () => {
  const modes: [string, MarkdownUpdateInput][] = [
    ["replace", { text: "Replaced body\n\n- item" }],
    [
      "append",
      { text: " and more\n\n## Added", editMode: TextEditMode.Append },
    ],
    ["prepend", { text: "Intro text ", editMode: TextEditMode.Prepend }],
    [
      "patch",
      {
        text: "Alpha **patched**",
        editMode: TextEditMode.Patch,
        findText: "Alpha paragraph",
      },
    ],
    ["title-only", { title: "  Spaced title  " }],
    ["icon-only", { icon: "🎉" }],
    ["display fields", { icon: "🎉", color: "#123456", fullWidth: true }],
  ];

  describe.each([false, true])("with prior state: %s", (withState) => {
    it.each(modes)("matches documentUpdater for %s", async (_mode, input) => {
      const { team, actor, collection } = await fixture();
      const document = await buildDocument({
        teamId: team.id,
        userId: actor.id,
        collectionId: collection.id,
        text: BASE_BODY,
        icon: "📌",
        color: "#0000FF",
      });
      if (withState) {
        await giveState(document);
      }
      const projection = await updateWithParity({
        actor,
        documentId: document.id,
        collectionId: collection.id,
        input,
      });
      expect(projection.state === null).toBe(!withState);
    });
  });

  it("trims the title and keeps unchanged fields", async () => {
    const { team, actor, collection } = await fixture();
    const document = await buildDocument({
      teamId: team.id,
      userId: actor.id,
      collectionId: collection.id,
      text: BASE_BODY,
      icon: "📌",
    });
    const projection = await updateWithParity({
      actor,
      documentId: document.id,
      collectionId: collection.id,
      input: { title: "  Spaced title  ", color: null },
    });
    expect(projection).toMatchObject({
      title: "Spaced title",
      icon: "📌",
      color: null,
    });
    expect(await toCanonicalMarkdown(projection.content)).toBe(BASE_BODY);
  });

  it("matches the v1.10.1 container patch, which drops the rest of the table", async () => {
    const { team, actor, collection } = await fixture();
    const document = await buildDocument({
      teamId: team.id,
      userId: actor.id,
      collectionId: collection.id,
      text: "| Name |\n|------|\n| alpha |\n| beta |\n| gamma |",
    });
    const markdown = await DocumentHelper.toMarkdown(document.content!, {
      includeTitle: false,
    });
    const row = markdown.split("\n").find((line) => line.includes("beta"))!;
    const projection = await updateWithParity({
      actor,
      documentId: document.id,
      collectionId: collection.id,
      input: {
        text: `${row}\n\n## New`,
        editMode: TextEditMode.Patch,
        findText: row,
      },
    });
    expect(projection.text).toContain("beta");
    expect(projection.text).not.toContain("gamma");
    expect(projection.text).not.toContain("## New");
  });

  it("publishes a draft in its collection", async () => {
    const { team, actor, collection } = await fixture();
    const document = await buildDraftDocument({
      teamId: team.id,
      userId: actor.id,
      collectionId: collection.id,
    });
    const projection = await updateWithParity({
      actor,
      documentId: document.id,
      collectionId: collection.id,
      input: { publish: true, title: "Now public" },
    });
    expect(projection).toMatchObject({
      published: true,
      collectionId: collection.id,
      title: "Now public",
    });
  });

  it("publishes a collectionless draft into the given collection", async () => {
    const { team, actor, collection } = await fixture();
    const document = await buildDraftDocument({
      teamId: team.id,
      userId: actor.id,
      collectionId: null,
    });
    const projection = await updateWithParity({
      actor,
      documentId: document.id,
      collectionId: collection.id,
      input: { publish: true, text: "Published body" },
      publishCollectionId: collection.id,
    });
    expect(projection).toMatchObject({
      published: true,
      collectionId: collection.id,
    });
  });

  it.each([false, true])(
    "unpublishes and ignores every other field, with prior state: %s",
    async (withState) => {
      const { team, actor, collection } = await fixture();
      const document = await buildDocument({
        teamId: team.id,
        userId: actor.id,
        collectionId: collection.id,
        title: "Kept title",
        text: BASE_BODY,
      });
      if (withState) {
        await giveState(document);
      }
      const projection = await updateWithParity({
        actor,
        documentId: document.id,
        collectionId: collection.id,
        input: {
          publish: false,
          title: "Ignored",
          text: `Ignored\n\n${DATA_IMAGE}`,
          icon: "🎉",
        },
      });
      expect(projection).toMatchObject({
        published: false,
        title: "Kept title",
        icon: null,
        collectionId: collection.id,
      });
      expect(await toCanonicalMarkdown(projection.content)).toBe(BASE_BODY);
      expect(projection.state === null).toBe(!withState);
    }
  );

  it.each<[string, MarkdownUpdateInput]>([
    ["title-only", { title: "Backfilled" }],
    ["append", { text: "\n\nTail", editMode: TextEditMode.Append }],
  ])(
    "matches documentUpdater for %s on a document without stored content",
    async (_mode, input) => {
      const { team, actor, collection } = await fixture();
      const document = await buildDocument({
        teamId: team.id,
        userId: actor.id,
        collectionId: collection.id,
        text: BASE_BODY,
      });
      await giveState(document);
      await dropContent(document);
      expect((await storedDocument(document.id)).content).toBeNull();
      const projection = await updateWithParity({
        actor,
        documentId: document.id,
        collectionId: collection.id,
        input,
      });
      expect(await toCanonicalMarkdown(projection.content)).toContain(
        "Omega paragraph"
      );
    }
  );

  it("keeps a collection draft unpublished when updated without publish", async () => {
    const { team, actor, collection } = await fixture();
    const document = await buildDraftDocument({
      teamId: team.id,
      userId: actor.id,
      collectionId: collection.id,
    });
    const projection = await updateWithParity({
      actor,
      documentId: document.id,
      collectionId: collection.id,
      input: { title: "Still a draft", text: "Draft body" },
    });
    expect(projection).toMatchObject({
      published: false,
      title: "Still a draft",
      text: "Draft body",
    });
  });

  it("publishes a nested draft from a template under its parent", async () => {
    const { team, actor, collection } = await fixture();
    const parent = await buildDocument({
      teamId: team.id,
      userId: actor.id,
      collectionId: collection.id,
    });
    const template = await buildTemplate({
      teamId: team.id,
      userId: actor.id,
      collectionId: collection.id,
    });
    const document = await buildDraftDocument({
      teamId: team.id,
      userId: actor.id,
      collectionId: collection.id,
      parentDocumentId: parent.id,
      templateId: template.id,
    });
    const projection = await updateWithParity({
      actor,
      documentId: document.id,
      collectionId: collection.id,
      input: { publish: true },
    });
    expect(projection).toMatchObject({
      published: true,
      parentDocumentId: parent.id,
      templateId: template.id,
    });
  });

  it("republishes an already published document", async () => {
    const { team, actor, collection } = await fixture();
    const document = await buildDocument({
      teamId: team.id,
      userId: actor.id,
      collectionId: collection.id,
      text: BASE_BODY,
    });
    const projection = await updateWithParity({
      actor,
      documentId: document.id,
      collectionId: collection.id,
      input: { publish: true, title: "Republished" },
    });
    expect(projection).toMatchObject({
      published: true,
      title: "Republished",
    });
  });

  it("projects from the re-fetched state while the prepared value is reused", async () => {
    const { team, actor, collection } = await fixture();
    const document = await buildDocument({
      teamId: team.id,
      userId: actor.id,
      collectionId: collection.id,
      text: "Original body",
    });
    const prepared = prepareMarkdownUpdate({
      text: "\n\nTail",
      editMode: TextEditMode.Append,
    });
    const first = await projectMarkdownUpdate({
      prepared,
      document: await loadForUpdate(document.id, actor),
      collectionId: collection.id,
    });
    expect(first.text).toBe("Original body\n\nTail");

    await withAPIContext(actor, async (ctx) =>
      documentUpdater(ctx, {
        document: await loadForUpdate(document.id, actor),
        text: "Changed body",
      })
    );
    const locked = await loadForUpdate(document.id, actor);
    const second = await withoutEffect(() =>
      projectMarkdownUpdate({
        prepared,
        document: locked,
        collectionId: collection.id,
      })
    );
    expect(second.text).toBe("Changed body\n\nTail");

    await withAPIContext(actor, (ctx) =>
      documentUpdater(ctx, { document: locked, ...prepared.input })
    );
    await expectParity(second);
  });
});

describe("projection immutability", () => {
  it("deep-freezes the projection and copies the state", async () => {
    const { team, actor, collection } = await fixture();
    const document = await buildDocument({
      teamId: team.id,
      userId: actor.id,
      collectionId: collection.id,
      text: BASE_BODY,
      sourceMetadata: { fileName: "source.md" },
    });
    await giveState(document);
    const loaded = await loadForUpdate(document.id, actor);
    const state = Buffer.from(loaded.state!);
    const prepared = prepareMarkdownUpdate({
      text: "More",
      editMode: TextEditMode.Append,
    });
    const projection = await projectMarkdownUpdate({
      prepared,
      document: loaded,
      collectionId: collection.id,
    });

    expect(isDeepFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(projection)).toBe(true);
    expect(isDeepFrozen(projection.content)).toBe(true);
    expect(isDeepFrozen(projection.sourceMetadata)).toBe(true);
    expect(projection.sourceMetadata).toEqual({ fileName: "source.md" });
    expect(Object.isFrozen(loaded.content)).toBe(false);
    expect(Object.isFrozen(loaded.sourceMetadata)).toBe(false);
    expect(() => {
      (projection as { title: string }).title = "Changed";
    }).toThrow(TypeError);

    projection.state!.fill(0);
    expect(Buffer.from(loaded.state!)).toEqual(state);
    expect(loaded.changed()).toBe(false);
  });

  it("deep-freezes a create projection without freezing its inputs", async () => {
    const { team, actor, collection } = await fixture();
    const template = await buildTemplate({
      teamId: team.id,
      userId: actor.id,
      collectionId: collection.id,
      text: "Template body",
    });
    const sourceMetadata = { fileName: "source.md" };
    const input: MarkdownCreateInput = {
      title: "Title",
      publish: true,
      sourceMetadata,
    };
    const prepared = prepareMarkdownCreate(input);
    const projection = await projectMarkdownCreate({
      prepared,
      documentId: randomUUID(),
      collectionId: collection.id,
      actor,
      template,
    });

    expect(isDeepFrozen(prepared)).toBe(true);
    expect(isDeepFrozen(projection)).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(sourceMetadata)).toBe(false);
    expect(Object.isFrozen(template.content)).toBe(false);
    expect(template.changed()).toBe(false);
  });
});

describe("projection failures", () => {
  /**
   * Builds a document and loads it for update.
   *
   * @returns the fixture and the loaded document.
   */
  async function updateFixture() {
    const base = await fixture();
    const built = await buildDocument({
      teamId: base.team.id,
      userId: base.actor.id,
      collectionId: base.collection.id,
      text: BASE_BODY,
    });
    const document = await loadForUpdate(built.id, base.actor);
    const before = await storedRows(document.id, base.collection.id);
    return { ...base, document, before };
  }

  it.each([
    [
      "an absent findText target",
      { findText: "Nowhere", text: "x" },
      "The specified text was not found in the document",
    ],
    [
      "a patch without findText",
      { text: "x" },
      "findText is required when using patch edit mode",
    ],
  ])(
    "propagates the baseline ValidationError for %s",
    async (_case, patch, message) => {
      const { collection, document, before } = await updateFixture();
      const content = structuredClone(document.content);
      const failure = await withoutEffect(() =>
        projectMarkdownUpdate({
          prepared: prepareMarkdownUpdate({
            ...patch,
            editMode: TextEditMode.Patch,
          }),
          document,
          collectionId: collection.id,
        })
      ).catch((error: unknown) => error);

      expect(failure).toMatchObject({ id: "validation_error", message });
      expect(abortMessage(failure)).toBe(message);
      expect(document.changed()).toBe(false);
      expect(document.content).toEqual(content);
      await expect(storedRows(document.id, collection.id)).resolves.toEqual(
        before
      );
    }
  );

  it("refuses update text holding an importable image in P2", async () => {
    const { collection, document, before } = await updateFixture();
    const failure = await withoutEffect(() =>
      prepareMarkdownUpdate({ text: `Body\n\n${DATA_IMAGE}` })
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(UnstagedMediaError);
    expect((failure as Error).message).not.toContain("data:");
    expect(abortMessage(failure)).toBe(OPERATION_FAILED);
    await expect(storedRows(document.id, collection.id)).resolves.toEqual(
      before
    );
  });

  it("does not refuse images the baseline would not import", async () => {
    const prepared = await withoutEffect(() =>
      prepareMarkdownUpdate({
        text: "![a](https://example.com/a.png) ![b](/api/attachments.redirect?id=1) ![c](not a url)",
      })
    );
    expect(prepared.input.text).toContain("https://example.com/a.png");
  });

  it("rejects a final collection other than the classified one", async () => {
    const { document } = await updateFixture();
    const failure = await withoutEffect(() =>
      projectMarkdownUpdate({
        prepared: prepareMarkdownUpdate({ text: "x" }),
        document,
        collectionId: randomUUID(),
      })
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(WikiLintContractError);
    expect(document.changed()).toBe(false);
  });

  it("rejects a collectionless draft that is not being published", async () => {
    const { team, actor, collection } = await fixture();
    const draft = await buildDraftDocument({
      teamId: team.id,
      userId: actor.id,
      collectionId: null,
    });
    const document = await loadForUpdate(draft.id, actor);
    const failure = await withoutEffect(() =>
      projectMarkdownUpdate({
        prepared: prepareMarkdownUpdate({ text: "x" }),
        document,
        collectionId: collection.id,
      })
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(WikiLintContractError);
    expect(document.changed()).toBe(false);
  });

  it("rejects a document loaded without its state", async () => {
    const { collection, document } = await updateFixture();
    const stateless = await Document.unscoped().findOne({
      where: { id: document.id },
      attributes: { exclude: ["state"] },
      rejectOnEmpty: true,
    });
    const built = Document.build({
      id: document.id,
      collectionId: collection.id,
      content: document.content,
    });
    for (const target of [stateless, built]) {
      const failure = await withoutEffect(() =>
        projectMarkdownUpdate({
          prepared: prepareMarkdownUpdate({ title: "x" }),
          document: target,
          collectionId: collection.id,
        })
      ).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(WikiLintContractError);
    }
    expect(stateless.changed()).toBe(false);
  });
});

describe("prepareMarkdownCreate", () => {
  it("converts text input-only", async () => {
    const prepared = await withoutEffect(() =>
      prepareMarkdownCreate({ text: "## Heading\n\nBody", publish: true })
    );
    expect(prepared.content).toEqual(
      ProsemirrorHelper.toProsemirror(
        "## Heading\n\nBody"
      ).toJSON() as ProsemirrorData
    );
    expect(prepared.input).not.toHaveProperty("text");
  });
});
