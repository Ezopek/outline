import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Scope } from "@shared/types";
import { Event, OAuthClient, type User } from "@server/models";
import {
  buildApiKey,
  buildCollection,
  buildDocument,
  buildOAuthAuthentication,
  buildUser,
} from "@server/test/factories";
import {
  mcpHeaders,
  mcpRequest,
  parseMcpResponse,
} from "@server/test/McpHelper";
import { getTestServer } from "@server/test/support";
import { UUID_PATTERN } from "@server/wikiLint/core/registry";

vi.mock("@server/tools/users", async () => {
  const { lintDocumentInputSchema, lintDocumentTool } =
    await import("@server/tools/wikiLint");
  return {
    userTools: (server: McpServer) => {
      server.registerTool(
        "lint_document",
        { inputSchema: lintDocumentInputSchema },
        (input, extra) => lintDocumentTool(input, extra)
      );
    },
  };
});

const server = getTestServer();

/**
 * Builds a user with a readable document.
 *
 * @returns the user and the document.
 */
async function buildFixture() {
  const user = await buildUser();
  const collection = await buildCollection({
    teamId: user.teamId,
    userId: user.id,
  });
  const document = await buildDocument({
    teamId: user.teamId,
    userId: user.id,
    collectionId: collection.id,
  });
  return { user, document };
}

/**
 * Calls `lint_document` over `/mcp` with client-supplied identity claims that
 * must be ignored.
 *
 * @param token - the bearer credential.
 * @param documentId - the document.
 * @returns the JSON-RPC ID and the tool result.
 */
async function lintOverHttp(token: string, documentId: string) {
  const { body, resultId } = mcpRequest("tools/call", {
    name: "lint_document",
    arguments: { id: documentId, clientId: "spoof" },
    _meta: { clientId: "spoof" },
  });
  const res = await server.post("/mcp/", {
    headers: { ...mcpHeaders(token), "User-Agent": "spoof" },
    body,
  });
  expect(res.status).toEqual(200);
  const parsed = await parseMcpResponse(res);
  return {
    resultId,
    result: parsed?.result as { isError?: boolean } | undefined,
  };
}

/**
 * Reads the `lint_document` summaries of a user's team.
 *
 * @param user - the user.
 * @returns the Events, oldest first.
 */
const summariesOf = (user: User) =>
  Event.findAll({
    where: { teamId: user.teamId, name: "wikiLint.document" },
    order: [
      ["createdAt", "ASC"],
      ["id", "ASC"],
    ],
  });

describe("/mcp audit attribution", () => {
  it("records the OAuth client bound to the access token and ignores client claims", async () => {
    const { user, document } = await buildFixture();
    const authentication = await buildOAuthAuthentication({
      user,
      scope: [Scope.Read],
    });
    const { clientId } = await OAuthClient.findByPk(
      authentication.oauthClientId,
      { rejectOnEmpty: true }
    );

    const first = await lintOverHttp(authentication.accessToken!, document.id);
    const second = await lintOverHttp(authentication.accessToken!, document.id);

    expect(first.result?.isError).toBeUndefined();
    expect(second.result?.isError).toBeUndefined();
    const events = await summariesOf(user);
    expect(events).toHaveLength(2);
    for (const [event, call] of [
      [events[0], first],
      [events[1], second],
    ] as const) {
      expect(event.data).toMatchObject({
        credentialAuthType: "oauth",
        authenticatedClientId: clientId,
      });
      expect(event.data?.requestId).toMatch(UUID_PATTERN);
      expect(event.id).toMatch(UUID_PATTERN);
      expect(event.id).not.toBe(String(call.resultId));
      expect(event.authType).toBe("mcp");
      expect(event.actorId).toBe(user.id);
      expect(event.ip).toBe("127.0.0.1");
      expect(JSON.stringify(event.data)).not.toContain("spoof");
    }
    expect(clientId).not.toBe("spoof");
    expect(events[0].data?.requestId).not.toBe(events[1].data?.requestId);
  });

  it("records an API key without a client identity", async () => {
    const { user, document } = await buildFixture();
    const apiKey = await buildApiKey({ userId: user.id });

    const { result } = await lintOverHttp(apiKey.value!, document.id);

    expect(result?.isError).toBeUndefined();
    const events = await summariesOf(user);
    expect(events).toHaveLength(1);
    expect(events[0].data).toMatchObject({ credentialAuthType: "api" });
    expect(events[0].data).not.toHaveProperty("authenticatedClientId");
    expect(events[0].data?.requestId).toMatch(UUID_PATTERN);
    expect(events[0].authType).toBe("mcp");
  });
});
