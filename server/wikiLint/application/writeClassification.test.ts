import { createHash, randomUUID } from "node:crypto";
import { DocumentPermission } from "@shared/types";
import { Collection, UserMembership } from "@server/models";
import {
  buildCollection,
  buildDocument,
  buildUser,
} from "@server/test/factories";
import type { PolicySet } from "../core/policySet";
import { buildPolicySet } from "../core/policySet";
import type { WriteClassification } from "./writeClassification";
import {
  ENFORCED_PRE_WRITE_BOUND_MS,
  classifyWrite,
  rejectInvalidPolicyWrite,
} from "./writeClassification";

const sha256Hex = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const rules = [
  { kind: "required_sections", headingLevel: 2, headings: ["Overview"] },
];

/** A lowercase v4 UUID. */
const V4_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Builds a policy set over factory collection IDs.
 *
 * @param collections - the policy entry of each collection ID.
 * @returns the policy set.
 */
function policySetFor(collections: Record<string, unknown>): PolicySet {
  const result = buildPolicySet(
    Buffer.from(JSON.stringify({ schemaVersion: 1, collections }), "utf8"),
    sha256Hex
  );
  if (!result.ok) {
    throw new Error("The test configuration must load");
  }
  return result.policySet;
}

/**
 * Builds a private collection in each policy state, its member, and a user
 * who can read only one document of each collection.
 *
 * @returns the fixture.
 */
async function buildFixture() {
  const member = await buildUser();
  const documentReader = await buildUser({ teamId: member.teamId });
  const collections: Record<string, Collection> = {};
  for (const name of ["enforced", "sentinel", "readOnly", "unconfigured"]) {
    const collection = await buildCollection({
      teamId: member.teamId,
      userId: member.id,
      permission: null,
    });
    const document = await buildDocument({
      teamId: member.teamId,
      userId: member.id,
      collectionId: collection.id,
    });
    await UserMembership.create({
      documentId: document.id,
      userId: documentReader.id,
      createdById: member.id,
      permission: DocumentPermission.ReadWrite,
    });
    collections[name] = collection;
  }
  const policySet = policySetFor({
    [collections.enforced.id]: { activation: "enforced", rules },
    [collections.sentinel.id]: { activation: "read_only", rules: [] },
    [collections.readOnly.id]: { activation: "read_only", rules },
  });
  return { member, documentReader, collections, policySet };
}

/**
 * Returns a clock that reads `elapsed` milliseconds after handler entry at 0.
 *
 * @param elapsed - the elapsed time.
 * @returns the clock.
 */
const clockAt = (elapsed: number) => () => elapsed;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("classifyWrite", () => {
  it("classifies each policy state of the post-operation collection", async () => {
    const { member, collections, policySet } = await buildFixture();
    /**
     * Classifies an update at handler entry.
     *
     * @param collectionId - the post-operation collection.
     * @returns the classification.
     */
    const classify = (collectionId: string | null | undefined) =>
      classifyWrite({
        collectionId,
        actor: member,
        create: false,
        enteredAt: 0,
        policySet,
        clock: clockAt(0),
      });
    const entryOf = (collectionId: string) =>
      policySet.entries.find((entry) => entry.collectionId === collectionId);

    await expect(classify(collections.enforced.id)).resolves.toEqual({
      kind: "enforced",
      entry: entryOf(collections.enforced.id),
      readable: true,
    });
    await expect(classify(collections.sentinel.id)).resolves.toEqual({
      kind: "sentinel",
      entry: entryOf(collections.sentinel.id),
      readable: true,
    });
    for (const collectionId of [
      collections.readOnly.id,
      collections.unconfigured.id,
      null,
      undefined,
    ]) {
      await expect(classify(collectionId)).resolves.toEqual({
        kind: "baseline",
      });
    }
  });

  it("reads nothing and checks no time for a read_only or unconfigured collection", async () => {
    const { member, collections, policySet } = await buildFixture();
    const findByPk = vi.spyOn(Collection, "findByPk");
    const clock = vi.fn(clockAt(ENFORCED_PRE_WRITE_BOUND_MS + 1));

    for (const collectionId of [
      collections.readOnly.id,
      collections.unconfigured.id,
      null,
    ]) {
      await expect(
        classifyWrite({
          collectionId,
          actor: member,
          create: true,
          enteredAt: 0,
          policySet,
          clock,
        })
      ).resolves.toEqual({ kind: "baseline" });
    }
    expect(findByPk).not.toHaveBeenCalled();
    expect(clock).not.toHaveBeenCalled();
  });

  it("computes readable once from the classified collection, never from document access", async () => {
    const { member, documentReader, collections, policySet } =
      await buildFixture();
    const findByPk = vi.spyOn(Collection, "findByPk");

    for (const [actor, readable] of [
      [member, true],
      [documentReader, false],
    ] as const) {
      for (const name of ["enforced", "sentinel"]) {
        findByPk.mockClear();
        const classification = await classifyWrite({
          collectionId: collections[name].id,
          actor,
          create: false,
          enteredAt: 0,
          policySet,
          clock: clockAt(0),
        });

        expect(classification).toMatchObject({ readable });
        expect(findByPk).toHaveBeenCalledTimes(1);
        expect(findByPk).toHaveBeenCalledWith(collections[name].id, {
          userId: actor.id,
        });
      }
    }
  });

  it("pre-allocates a lowercase v4 document ID for a create only", async () => {
    const { member, collections, policySet } = await buildFixture();
    const classify = (create: boolean, collectionId: string) =>
      classifyWrite({
        collectionId,
        actor: member,
        create,
        enteredAt: 0,
        policySet,
        clock: clockAt(0),
      });

    for (const collectionId of [
      collections.enforced.id,
      collections.sentinel.id,
    ]) {
      const created = await classify(true, collectionId);
      const other = await classify(true, collectionId);
      const updated = await classify(false, collectionId);

      expect(created).toMatchObject({
        documentId: expect.stringMatching(V4_UUID),
      });
      expect((created as { documentId: string }).documentId).not.toBe(
        (other as { documentId: string }).documentId
      );
      expect(updated).not.toHaveProperty("documentId");
    }
  });

  it("returns a frozen classification", async () => {
    const { member, collections, policySet } = await buildFixture();
    const classifications: WriteClassification[] = [];
    for (const collectionId of [
      collections.enforced.id,
      collections.sentinel.id,
      collections.readOnly.id,
    ]) {
      classifications.push(
        await classifyWrite({
          collectionId,
          actor: member,
          create: true,
          enteredAt: 0,
          policySet,
          clock: clockAt(0),
        })
      );
    }
    classifications.push(
      await classifyWrite({
        collectionId: collections.enforced.id,
        actor: member,
        create: true,
        enteredAt: 0,
        policySet,
        clock: clockAt(ENFORCED_PRE_WRITE_BOUND_MS + 1),
      })
    );

    expect(classifications.map((item) => item.kind)).toEqual([
      "enforced",
      "sentinel",
      "baseline",
      "failed",
    ]);
    for (const classification of classifications) {
      expect(Object.isFrozen(classification)).toBe(true);
    }
  });

  it("fails P1 when the readability lookup rejects", async () => {
    const { member, collections, policySet } = await buildFixture();
    vi.spyOn(Collection, "findByPk").mockRejectedValue(
      new Error("The lookup failed")
    );

    for (const collectionId of [
      collections.enforced.id,
      collections.sentinel.id,
    ]) {
      await expect(
        classifyWrite({
          collectionId,
          actor: member,
          create: true,
          enteredAt: 0,
          policySet,
          clock: clockAt(0),
        })
      ).resolves.toEqual({ kind: "failed" });
    }
  });

  it("fails P1 when the policy set cannot be loaded", async () => {
    const { member, collections } = await buildFixture();
    const throwing = {
      policySetFingerprint: "",
      get entries(): PolicySet["entries"] {
        throw new Error("The policy set could not be loaded");
      },
    };

    await expect(
      classifyWrite({
        collectionId: collections.unconfigured.id,
        actor: member,
        create: false,
        enteredAt: 0,
        policySet: throwing,
        clock: clockAt(0),
      })
    ).resolves.toEqual({ kind: "failed" });
  });

  it("fails P1 only once P0 and P1 exceed the 2-second bound", async () => {
    const { member, collections, policySet } = await buildFixture();
    expect(ENFORCED_PRE_WRITE_BOUND_MS).toBe(2000);

    for (const collectionId of [
      collections.enforced.id,
      collections.sentinel.id,
    ]) {
      const classify = (enteredAt: number, now: number) =>
        classifyWrite({
          collectionId,
          actor: member,
          create: true,
          enteredAt,
          policySet,
          clock: clockAt(now),
        });

      await expect(classify(0, 2000)).resolves.not.toEqual({
        kind: "failed",
      });
      await expect(classify(500, 2500)).resolves.not.toEqual({
        kind: "failed",
      });
      await expect(classify(0, 2001)).resolves.toEqual({ kind: "failed" });
      await expect(classify(500, 2500.5)).resolves.toEqual({
        kind: "failed",
      });
    }
  });
});

describe("rejectInvalidPolicyWrite", () => {
  const collectionId = randomUUID();
  const policySet = policySetFor({
    [collectionId]: { activation: "read_only", rules: [] },
  });
  const entry = policySet.entries[0];
  if (entry.status !== "invalid") {
    throw new Error("The test entry must be a sentinel");
  }

  it("rejects with the sentinel identity for a reader of the collection", () => {
    expect(
      JSON.stringify(
        rejectInvalidPolicyWrite({ kind: "sentinel", entry, readable: true })
      )
    ).toBe(
      JSON.stringify({
        success: false,
        validation: {
          status: "rejected",
          invalidFingerprint: entry.invalidFingerprint,
          errors: [],
          warnings: [],
          systemFailures: [
            {
              code: "POLICY_CONFIGURATION_INVALID",
              message: "The collection lint policy is invalid.",
              location: {
                kind: "scope",
                scopeKind: "collection",
                collectionId,
              },
            },
          ],
        },
      })
    );
  });

  it("rejects without any identity for an actor who cannot read the collection", () => {
    const rejection = rejectInvalidPolicyWrite({
      kind: "sentinel",
      entry,
      readable: false,
      documentId: randomUUID(),
    });

    expect(JSON.stringify(rejection)).toBe(
      JSON.stringify({
        success: false,
        validation: {
          status: "rejected",
          errors: [],
          warnings: [],
          systemFailures: [
            {
              code: "POLICY_CONFIGURATION_INVALID",
              message: "The collection lint policy is invalid.",
              location: { kind: "scope", scopeKind: "collection" },
            },
          ],
        },
      })
    );
    expect(JSON.stringify(rejection)).not.toContain(collectionId);
    expect(JSON.stringify(rejection)).not.toContain(entry.invalidFingerprint);
  });
});
