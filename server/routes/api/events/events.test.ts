import sharedEnv from "@shared/env";
import env from "@server/env";
import {
  buildAdmin,
  buildCollection,
  buildDocument,
  buildEvent,
  buildUser,
} from "@server/test/factories";
import { getTestServer } from "@server/test/support";
import { WIKI_LINT_AUDIT_EVENTS } from "@server/wikiLint/adapters/auditEvents";

const server = getTestServer();

describe("#events.list", () => {
  it("should only return activity events", async () => {
    const user = await buildUser();
    const admin = await buildAdmin({ teamId: user.teamId });
    const collection = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });
    const document = await buildDocument({
      userId: user.id,
      collectionId: collection.id,
      teamId: user.teamId,
    });
    // audit event
    await buildEvent({
      name: "users.promote",
      teamId: user.teamId,
      actorId: admin.id,
      userId: user.id,
    });
    // event viewable in activity stream
    const event = await buildEvent({
      name: "documents.publish",
      collectionId: collection.id,
      documentId: document.id,
      teamId: user.teamId,
      actorId: admin.id,
    });
    const res = await server.post("/api/events.list", user, {
      body: {
        collectionId: collection.id,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.length).toEqual(1);
    expect(body.data[0].id).toEqual(event.id);
  });

  it("should return audit events", async () => {
    const user = await buildUser();
    const admin = await buildAdmin({ teamId: user.teamId });
    const collection = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });
    const document = await buildDocument({
      userId: user.id,
      collectionId: collection.id,
      teamId: user.teamId,
    });
    // audit event
    const auditEvent = await buildEvent({
      name: "users.promote",
      teamId: user.teamId,
      actorId: admin.id,
      userId: user.id,
    });
    // event viewable in activity stream
    const event = await buildEvent({
      name: "documents.publish",
      collectionId: collection.id,
      documentId: document.id,
      teamId: user.teamId,
      actorId: admin.id,
    });
    const res = await server.post("/api/events.list", admin, {
      body: {
        auditLog: true,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.length).toEqual(2);
    expect(body.data[0].id).toEqual(event.id);
    expect(body.data[1].id).toEqual(auditEvent.id);
  });

  it("should allow filtering by actorId", async () => {
    const user = await buildUser();
    const admin = await buildAdmin({ teamId: user.teamId });
    const collection = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });
    const document = await buildDocument({
      userId: user.id,
      collectionId: collection.id,
      teamId: user.teamId,
    });
    // audit event
    const auditEvent = await buildEvent({
      name: "users.promote",
      teamId: user.teamId,
      actorId: admin.id,
      userId: user.id,
    });
    // event viewable in activity stream
    await buildEvent({
      name: "documents.publish",
      collectionId: collection.id,
      documentId: document.id,
      teamId: user.teamId,
      actorId: user.id,
    });
    const res = await server.post("/api/events.list", admin, {
      body: {
        auditLog: true,
        actorId: admin.id,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.length).toEqual(1);
    expect(body.data[0].id).toEqual(auditEvent.id);
  });

  it("should not allow members to filter by actorId", async () => {
    const user = await buildUser();
    const admin = await buildAdmin({ teamId: user.teamId });
    const collection = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });
    const document = await buildDocument({
      userId: user.id,
      collectionId: collection.id,
      teamId: user.teamId,
    });
    // audit event
    await buildEvent({
      name: "users.promote",
      teamId: user.teamId,
      actorId: admin.id,
      userId: user.id,
    });
    // event viewable in activity stream
    await buildEvent({
      name: "documents.publish",
      collectionId: collection.id,
      documentId: document.id,
      teamId: user.teamId,
      actorId: user.id,
    });
    const res = await server.post("/api/events.list", user, {
      body: {
        actorId: admin.id,
      },
    });
    expect(res.status).toEqual(403);
  });

  it("should allow filtering by actorId when it's the current user", async () => {
    const user = await buildUser();
    const admin = await buildAdmin({ teamId: user.teamId });
    const collection = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });
    const document = await buildDocument({
      userId: user.id,
      collectionId: collection.id,
      teamId: user.teamId,
    });
    // event by admin
    await buildEvent({
      name: "documents.create",
      collectionId: collection.id,
      documentId: document.id,
      teamId: user.teamId,
      actorId: admin.id,
    });
    // event by user
    const userEvent = await buildEvent({
      name: "documents.publish",
      collectionId: collection.id,
      documentId: document.id,
      teamId: user.teamId,
      actorId: user.id,
    });
    const res = await server.post("/api/events.list", user, {
      body: {
        actorId: user.id,
        collectionId: collection.id,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.length).toEqual(1);
    expect(body.data[0].id).toEqual(userEvent.id);
  });

  it("should allow filtering by documentId", async () => {
    const user = await buildUser();
    const admin = await buildAdmin({ teamId: user.teamId });
    const collection = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });
    const document = await buildDocument({
      userId: user.id,
      collectionId: collection.id,
      teamId: user.teamId,
    });
    const event = await buildEvent({
      name: "documents.publish",
      collectionId: collection.id,
      documentId: document.id,
      teamId: user.teamId,
      actorId: user.id,
    });
    const res = await server.post("/api/events.list", admin, {
      body: {
        documentId: document.id,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.length).toEqual(1);
    expect(body.data[0].id).toEqual(event.id);
  });

  it("should not return events for documentId without authorization", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });
    const document = await buildDocument({
      userId: user.id,
      collectionId: collection.id,
      teamId: user.teamId,
    });
    const actor = await buildUser();
    await buildEvent({
      name: "documents.publish",
      collectionId: collection.id,
      documentId: document.id,
      teamId: user.teamId,
      actorId: user.id,
    });
    const res = await server.post("/api/events.list", actor, {
      body: {
        documentId: document.id,
      },
    });
    expect(res.status).toEqual(403);
  });

  it("should allow filtering by event name", async () => {
    const user = await buildUser();
    const admin = await buildAdmin({ teamId: user.teamId });
    const collection = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });
    const document = await buildDocument({
      userId: user.id,
      collectionId: collection.id,
      teamId: user.teamId,
    });
    // audit event
    await buildEvent({
      name: "users.promote",
      teamId: user.teamId,
      actorId: admin.id,
      userId: user.id,
    });
    // event viewable in activity stream
    const event = await buildEvent({
      name: "documents.publish",
      collectionId: collection.id,
      documentId: document.id,
      teamId: user.teamId,
      actorId: user.id,
    });
    const res = await server.post("/api/events.list", user, {
      body: {
        name: "documents.publish",
        collectionId: collection.id,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.length).toEqual(1);
    expect(body.data[0].id).toEqual(event.id);
  });

  it("should allow filtering by events param", async () => {
    const user = await buildUser();
    const admin = await buildAdmin({ teamId: user.teamId });
    const collection = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });
    const document = await buildDocument({
      userId: user.id,
      collectionId: collection.id,
      teamId: user.teamId,
    });
    // audit event
    await buildEvent({
      name: "users.promote",
      teamId: user.teamId,
      actorId: admin.id,
      userId: user.id,
    });
    // event viewable in activity stream
    const event = await buildEvent({
      name: "documents.publish",
      collectionId: collection.id,
      documentId: document.id,
      teamId: user.teamId,
      actorId: user.id,
    });
    const res = await server.post("/api/events.list", user, {
      body: {
        events: ["documents.publish"],
        collectionId: collection.id,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.length).toEqual(1);
    expect(body.data[0].id).toEqual(event.id);
  });

  it("should return events with deleted actors", async () => {
    const user = await buildUser();
    const admin = await buildAdmin({ teamId: user.teamId });
    const collection = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });
    const document = await buildDocument({
      userId: user.id,
      collectionId: collection.id,
      teamId: user.teamId,
    });
    // event viewable in activity stream
    const event = await buildEvent({
      name: "documents.publish",
      collectionId: collection.id,
      documentId: document.id,
      teamId: user.teamId,
      actorId: user.id,
    });
    await user.destroy({ hooks: false });
    const res = await server.post("/api/events.list", admin);
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.length).toEqual(1);
    expect(body.data[0].id).toEqual(event.id);
  });

  it("should require authorization for audit events", async () => {
    const user = await buildUser();
    const res = await server.post("/api/events.list", user, {
      body: {
        auditLog: true,
      },
    });
    expect(res.status).toEqual(403);
  });

  it("should require authentication", async () => {
    const res = await server.post("/api/events.list");
    const body = await res.json();
    expect(res.status).toEqual(401);
    expect(body).toMatchSnapshot();
  });

  it("should not return events for private drafts created by other users", async () => {
    const user1 = await buildUser();
    const user2 = await buildUser({ teamId: user1.teamId });

    // user1 creates a private draft (no collection, not published)
    const privateDraft = await buildDocument({
      userId: user1.id,
      teamId: user1.teamId,
      collectionId: null,
      publishedAt: null,
    });

    // Verify the draft has no collection
    expect(privateDraft.collectionId).toBeNull();
    expect(privateDraft.publishedAt).toBeNull();

    // Event for the private draft (using an ACTIVITY event)
    await buildEvent({
      name: "documents.delete",
      documentId: privateDraft.id,
      collectionId: null,
      teamId: user1.teamId,
      actorId: user1.id,
    });

    // user2 tries to list events without specifying documentId/collectionId
    const res = await server.post("/api/events.list", user2);

    // Non-admins cannot list events without documentId or collectionId
    expect(res.status).toEqual(403);

    // Also verify user2 cannot see the draft when filtering by documentId
    const res2 = await server.post("/api/events.list", user2, {
      body: {
        documentId: privateDraft.id,
      },
    });
    expect(res2.status).toEqual(403);
  });

  it("should return events without collection for admins", async () => {
    const user = await buildUser();
    const admin = await buildAdmin({ teamId: user.teamId });

    // user creates a private draft (no collection, not published)
    const privateDraft = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
      collectionId: null,
      publishedAt: null,
    });

    // Event for the private draft
    const draftEvent = await buildEvent({
      name: "documents.delete",
      documentId: privateDraft.id,
      collectionId: null,
      teamId: user.teamId,
      actorId: user.id,
    });

    // admin lists events
    const res = await server.post("/api/events.list", admin);

    const body = await res.json();
    expect(res.status).toEqual(200);

    // admin SHOULD see events for documents without a collection
    const eventIds = body.data.map((e: { id: string }) => e.id);
    expect(eventIds).toContain(draftEvent.id);
  });

  it("should allow non-admins to list events when collectionId is specified", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });
    const document = await buildDocument({
      userId: user.id,
      collectionId: collection.id,
      teamId: user.teamId,
    });

    const event = await buildEvent({
      name: "documents.publish",
      documentId: document.id,
      collectionId: collection.id,
      teamId: user.teamId,
      actorId: user.id,
    });

    // user lists events for their collection
    const res = await server.post("/api/events.list", user, {
      body: {
        collectionId: collection.id,
      },
    });

    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.length).toEqual(1);
    expect(body.data[0].id).toEqual(event.id);
  });
});

describe("#events.list auditWikiLint", () => {
  /** A self-hosted URL, on which the full audit log is unavailable. */
  const SELF_HOSTED_URL = "https://wiki.example.test";

  /**
   * Builds a team with Wiki lint, audit, and activity Events, and another
   * team with Wiki lint Events.
   *
   * @returns the team's admin, member, document, and Events.
   */
  async function buildFixture() {
    const admin = await buildAdmin();
    const member = await buildUser({ teamId: admin.teamId });
    const collection = await buildCollection({
      teamId: admin.teamId,
      userId: member.id,
    });
    const document = await buildDocument({
      teamId: admin.teamId,
      userId: member.id,
      collectionId: collection.id,
    });
    const wikiLint = [];
    for (const name of WIKI_LINT_AUDIT_EVENTS) {
      wikiLint.push(
        await buildEvent({
          name,
          teamId: admin.teamId,
          actorId: member.id,
          documentId: document.id,
          data: { schemaVersion: 1 },
        })
      );
    }
    await buildEvent({
      name: "users.promote",
      teamId: admin.teamId,
      actorId: admin.id,
      userId: member.id,
    });
    await buildEvent({
      name: "documents.publish",
      teamId: admin.teamId,
      actorId: member.id,
      documentId: document.id,
      collectionId: collection.id,
    });
    const other = await buildAdmin();
    for (const name of WIKI_LINT_AUDIT_EVENTS) {
      await buildEvent({ name, teamId: other.teamId, actorId: other.id });
    }
    return { admin, member, document, wikiLint };
  }

  /**
   * Returns the sorted IDs of listed Events.
   *
   * @param body - the response body.
   * @returns the IDs.
   */
  const idsOf = (body: { data: { id: string }[] }) =>
    body.data.map((event) => event.id).sort();

  it.each([
    ["a cloud", undefined],
    ["a self-hosted", SELF_HOSTED_URL],
  ])(
    "lists only the team's summaries to an admin on %s URL",
    async (_name, url) => {
      const { admin, wikiLint } = await buildFixture();
      if (url) {
        env.URL = sharedEnv.URL = url;
      }

      const res = await server.post("/api/events.list", admin, {
        body: { auditWikiLint: true },
      });
      const body = await res.json();

      expect(res.status).toEqual(200);
      expect(idsOf(body)).toEqual(wikiLint.map((event) => event.id).sort());
      expect(body.data[0].actorIpAddress).toEqual("127.0.0.1");
    }
  );

  it.each([
    ["a cloud", undefined],
    ["a self-hosted", SELF_HOSTED_URL],
  ])("takes precedence over the audit log on %s URL", async (_name, url) => {
    const { admin, wikiLint } = await buildFixture();
    if (url) {
      env.URL = sharedEnv.URL = url;
    }

    const res = await server.post("/api/events.list", admin, {
      body: { auditWikiLint: true, auditLog: true },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(idsOf(body)).toEqual(wikiLint.map((event) => event.id).sort());
  });

  it("intersects the requested names with the summaries", async () => {
    const { admin, wikiLint } = await buildFixture();

    const res = await server.post("/api/events.list", admin, {
      body: {
        auditWikiLint: true,
        events: ["wikiLint.document", "documents.publish"],
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(idsOf(body)).toEqual([wikiLint[0].id]);
  });

  it.each([
    ["without", false],
    ["with", true],
  ])("forbids a member %s a document", async (_name, withDocument) => {
    const { member, document } = await buildFixture();

    const res = await server.post("/api/events.list", member, {
      body: {
        auditWikiLint: true,
        ...(withDocument ? { documentId: document.id } : {}),
      },
    });

    expect(res.status).toEqual(403);
  });

  it("keeps the summaries out of the audit log and activity listings", async () => {
    const { admin, member, document } = await buildFixture();

    const listings = [
      await server.post("/api/events.list", admin, {
        body: { auditLog: true },
      }),
      await server.post("/api/events.list", admin),
      await server.post("/api/events.list", admin, {
        body: { events: ["wikiLint.document", "documents.publish"] },
      }),
      await server.post("/api/events.list", member, {
        body: { documentId: document.id },
      }),
    ];

    for (const res of listings) {
      const body = await res.json();
      expect(res.status).toEqual(200);
      expect(body.data.length).toBeGreaterThan(0);
      expect(
        body.data.filter((event: { name: string }) =>
          event.name.startsWith("wikiLint.")
        )
      ).toEqual([]);
    }
  });

  it("keeps the audit log forbidden on a self-hosted URL", async () => {
    const { admin } = await buildFixture();
    env.URL = sharedEnv.URL = SELF_HOSTED_URL;

    const res = await server.post("/api/events.list", admin, {
      body: { auditLog: true },
    });

    expect(res.status).toEqual(403);
  });
});
