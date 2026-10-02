import { createHash, randomUUID } from "node:crypto";
import { DocumentPermission, type NavigationNode } from "@shared/types";
import { Collection, type User, UserMembership } from "@server/models";
import { sequelize } from "@server/storage/database";
import {
  buildAdmin,
  buildCollection,
  buildDocument,
  buildUser,
} from "@server/test/factories";
import { Deadline } from "../application/deadline";
import type * as SnapshotLimits from "../application/snapshotLimits";
import { WikiResourceLimitError } from "../application/snapshotLimits";
import type { PolicySetEntry } from "../core/policySet";
import { buildPolicySet } from "../core/policySet";
import { toCanonicalMarkdown } from "./canonicalSyntax";
import { readWikiSnapshot } from "./wikiReader";

/** The limits the reader sees; each test lowers one of them. */
const limits = vi.hoisted(() => ({
  documents: 0,
  documentMarkdownBytes: 0,
  totalMarkdownBytes: 0,
  linkReferences: 0,
  structureNodes: 0,
}));

vi.mock("../application/snapshotLimits", async (importOriginal) => ({
  ...(await importOriginal<typeof SnapshotLimits>()),
  WIKI_SNAPSHOT_LIMITS: limits,
}));

beforeEach(() => {
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
    limits[key] = Number.MAX_SAFE_INTEGER;
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

const sha256Hex = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** Document rules only. */
const documentPolicy = {
  activation: "read_only",
  rules: [{ kind: "allowed_heading_levels", levels: [2, 3] }],
};

/** A document rule plus `internal_links`. */
const linkPolicy = {
  activation: "read_only",
  rules: [...documentPolicy.rules, { kind: "internal_links" }],
};

/** Hierarchy rules only. */
const hierarchyPolicy = {
  activation: "read_only",
  rules: [{ kind: "hierarchy_acyclic" }],
};

/** An entry that fails validation, so it becomes a sentinel. */
const invalidPolicy = { activation: "read_only", rules: [] };

/**
 * Builds the policy set entries of factory collection IDs.
 *
 * @param collections - the policy entry of each collection ID.
 * @returns the sorted entries.
 */
function entriesFor(
  collections: Record<string, unknown>
): readonly PolicySetEntry[] {
  const result = buildPolicySet(
    Buffer.from(JSON.stringify({ schemaVersion: 1, collections }), "utf8"),
    sha256Hex
  );
  if (!result.ok) {
    throw new Error("The test configuration must load");
  }
  return result.policySet.entries;
}

/**
 * Reads a snapshot of the default scope with an ample deadline.
 *
 * @param entries - the policy set entries.
 * @param actor - the acting user.
 * @returns the snapshot read.
 */
const read = (entries: readonly PolicySetEntry[], actor: User) =>
  readWikiSnapshot({
    scope: { kind: "configured_collections" },
    entries,
    actor,
    deadline: new Deadline(60000, () => 0),
    instanceOrigin: "https://wiki.example.test",
  });

/**
 * Builds a user with a readable collection and published documents in it.
 *
 * @param texts - the Markdown of each document.
 * @returns the user, collection, and documents.
 */
async function buildCollectionWith(texts: string[]) {
  const user = await buildUser();
  const collection = await buildCollection({
    teamId: user.teamId,
    userId: user.id,
  });
  const documents = [];
  for (const text of texts) {
    documents.push(
      await buildDocument({
        teamId: user.teamId,
        userId: user.id,
        collectionId: collection.id,
        text,
      })
    );
  }
  return { user, collection, documents };
}

/** The failed read of an exceeded limit, without a sentinel. */
const exceeded = {
  ok: false,
  error: expect.any(WikiResourceLimitError),
  sentinelCollectionIds: [],
};

describe("readWikiSnapshot resource limits", () => {
  it("fails before reading content once the documents exceed their limit", async () => {
    const { user, collection } = await buildCollectionWith(["a", "b", "c"]);
    const query = vi.spyOn(sequelize, "query");
    limits.documents = 2;

    await expect(
      read(entriesFor({ [collection.id]: documentPolicy }), user)
    ).resolves.toEqual(exceeded);
    expect(
      query.mock.calls.filter(
        ([sql]) =>
          typeof sql === "string" &&
          sql.startsWith('SELECT "id", "content", "state"')
      )
    ).toEqual([]);
  });

  it("passes documents exactly at their limit", async () => {
    const { user, collection } = await buildCollectionWith(["a", "b", "c"]);
    limits.documents = 3;

    await expect(
      read(entriesFor({ [collection.id]: documentPolicy }), user)
    ).resolves.toMatchObject({ ok: true });
  });

  it("counts only the documents that pass the read filter", async () => {
    const admin = await buildAdmin();
    const owner = await buildUser({ teamId: admin.teamId });
    const collection = await buildCollection({
      teamId: owner.teamId,
      userId: owner.id,
      permission: null,
    });
    const published = () =>
      buildDocument({
        teamId: owner.teamId,
        userId: owner.id,
        collectionId: collection.id,
      });
    const shared = await published();
    await published();
    await published();
    await UserMembership.create({
      documentId: shared.id,
      userId: admin.id,
      createdById: owner.id,
      permission: DocumentPermission.Read,
    });
    const entries = entriesFor({ [collection.id]: documentPolicy });

    limits.documents = 1;
    await expect(read(entries, admin)).resolves.toMatchObject({ ok: true });
    limits.documents = 0;
    await expect(read(entries, admin)).resolves.toEqual(exceeded);
  });

  it("fails one document above the Markdown byte limit instead of marking it unavailable", async () => {
    const { user, collection, documents } = await buildCollectionWith([
      "Entrée",
    ]);
    const bytes = Buffer.byteLength(await toCanonicalMarkdown(documents[0]));
    const entries = entriesFor({ [collection.id]: documentPolicy });

    limits.documentMarkdownBytes = bytes;
    const atLimit = await read(entries, user);
    limits.documentMarkdownBytes = bytes - 1;
    const aboveLimit = await read(entries, user);

    expect(atLimit).toMatchObject({
      ok: true,
      snapshot: {
        collections: [{ documents: [{ content: { links: null } }] }],
      },
    });
    expect(aboveLimit).toEqual(exceeded);
  });

  it("fails when the total Markdown exceeds its limit", async () => {
    const { user, collection, documents } = await buildCollectionWith([
      "## One",
      "## Two",
    ]);
    let bytes = 0;
    for (const document of documents) {
      bytes += Buffer.byteLength(await toCanonicalMarkdown(document));
    }
    const entries = entriesFor({ [collection.id]: documentPolicy });

    limits.totalMarkdownBytes = bytes;
    await expect(read(entries, user)).resolves.toMatchObject({ ok: true });
    limits.totalMarkdownBytes = bytes - 1;
    await expect(read(entries, user)).resolves.toEqual(exceeded);
  });

  it("counts a surface that is also an evaluated document twice", async () => {
    const { user, collection, documents } = await buildCollectionWith([
      "## Surface",
    ]);
    const [surface] = documents;
    const bytes = Buffer.byteLength(await toCanonicalMarkdown(surface));
    const entries = entriesFor({
      [collection.id]: {
        activation: "read_only",
        rules: [
          ...documentPolicy.rules,
          {
            kind: "global_index_links",
            surfaceDocumentId: surface.id,
            globalIndexDocumentIds: [surface.id],
          },
        ],
      },
    });

    limits.totalMarkdownBytes = 2 * bytes;
    await expect(read(entries, user)).resolves.toMatchObject({ ok: true });
    limits.totalMarkdownBytes = 2 * bytes - 1;
    await expect(read(entries, user)).resolves.toEqual(exceeded);
  });

  it("fails when the extracted link references exceed their limit", async () => {
    const { user, collection } = await buildCollectionWith([
      "[a](/doc/00000000-0000-4000-8000-000000000001)\n\n[b](/doc/00000000-0000-4000-8000-000000000002)",
    ]);
    const entries = entriesFor({ [collection.id]: linkPolicy });

    limits.linkReferences = 2;
    await expect(read(entries, user)).resolves.toMatchObject({ ok: true });
    limits.linkReferences = 1;
    await expect(read(entries, user)).resolves.toEqual(exceeded);
  });

  it("fails when the structure nodes exceed their limit", async () => {
    const { user, collection } = await buildCollectionWith([]);
    const node = (children: NavigationNode[] = []): NavigationNode => ({
      id: randomUUID(),
      title: "",
      url: "",
      children,
    });
    await Collection.update(
      { documentStructure: [node([node(), node()])] },
      { where: { id: collection.id }, hooks: false }
    );
    const entries = entriesFor({ [collection.id]: hierarchyPolicy });

    limits.structureNodes = 3;
    await expect(read(entries, user)).resolves.toMatchObject({ ok: true });
    limits.structureNodes = 2;
    await expect(read(entries, user)).resolves.toEqual(exceeded);
  });

  it("keeps the readable sentinels established before the failure", async () => {
    const { user, collection } = await buildCollectionWith(["a", "b"]);
    const sentinel = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const owner = await buildUser({ teamId: user.teamId });
    const hidden = await buildCollection({
      teamId: owner.teamId,
      userId: owner.id,
      permission: null,
    });
    limits.documents = 1;

    const result = await read(
      entriesFor({
        [collection.id]: documentPolicy,
        [sentinel.id]: invalidPolicy,
        [hidden.id]: invalidPolicy,
      }),
      user
    );

    expect(result).toEqual({
      ...exceeded,
      sentinelCollectionIds: [sentinel.id],
    });
  });
});
