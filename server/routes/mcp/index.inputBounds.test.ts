import { CommentStatusFilter, Scope } from "@shared/types";
import { Comment, Document, Event } from "@server/models";
import {
  buildCollection,
  buildDocument,
  buildOAuthAuthentication,
} from "@server/test/factories";
import {
  buildOAuthUser,
  callMcpTool,
  mcpHeaders,
  mcpRequest,
  parseMcpResponse,
} from "@server/test/McpHelper";
import { getTestServer } from "@server/test/support";
import { MCP_MAX_TOOL_INPUT_ELEMENTS } from "./index";

const server = getTestServer();
const CAP = MCP_MAX_TOOL_INPUT_ELEMENTS;
const STATUS_FILTER_MAX = Object.values(CommentStatusFilter).length;

// Vitest ignores unhandled errors here (`dangerouslyIgnoreUnhandledErrors`), so
// a refusal that crashed an async path would still be green. Collect them.
const asyncErrors: unknown[] = [];
const onAsyncError = (err: unknown) => {
  asyncErrors.push(err);
};

beforeAll(() => {
  process.on("unhandledRejection", onAsyncError);
  process.on("uncaughtException", onAsyncError);
});

afterAll(() => {
  process.off("unhandledRejection", onAsyncError);
  process.off("uncaughtException", onAsyncError);
  expect(asyncErrors).toEqual([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Names n distinct filler members, which the tool schema strips. */
const filler = (n: number, from = 0) =>
  Object.fromEntries(
    Array.from({ length: n }, (_, i) => [`filler${from + i}`, "x"])
  );

const post = async (accessToken: string | undefined, body: unknown) => {
  const res = await server.post("/mcp/", {
    headers: accessToken
      ? mcpHeaders(accessToken)
      : { Accept: "application/json, text/event-stream" },
    body,
  });
  return {
    res,
    parsed: res.status === 200 ? await parseMcpResponse(res) : undefined,
  };
};

const callRaw = (accessToken: string | undefined, args: unknown) =>
  post(
    accessToken,
    mcpRequest("tools/call", { name: "list_comments", arguments: args }).body
  );

const isBudgetRefusal = (parsed: unknown) => {
  const text = JSON.stringify(parsed);
  return text.includes("-32602") && text.includes("maximum of");
};

describe("tool input element budget", () => {
  it("is a finite limit with headroom over the widest supported tool", async () => {
    const { accessToken } = await buildOAuthUser();
    const { body } = mcpRequest("tools/list");
    const { parsed } = await post(accessToken, body);
    const tools = (
      parsed as {
        result: {
          tools: { inputSchema: { properties?: Record<string, unknown> } }[];
        };
      }
    ).result.tools;

    const widest = Math.max(
      ...tools.map((t) => Object.keys(t.inputSchema.properties ?? {}).length)
    );

    expect(tools.length).toBeGreaterThan(20);
    expect(Number.isFinite(CAP)).toBe(true);
    // Every member of the widest tool plus the longest collection it accepts
    expect(CAP).toBeGreaterThanOrEqual(2 * (widest + STATUS_FILTER_MAX));
    expect(CAP).toBeLessThanOrEqual(1000);
  });

  it("accepts exactly the limit and refuses one more before the callback", async () => {
    const { user, accessToken } = await buildOAuthUser();
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const document = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
    });
    const findAll = vi.spyOn(Comment, "findAll");

    const atCap = await callRaw(accessToken, {
      documentId: document.id,
      ...filler(CAP - 1),
    });
    expect(atCap.parsed).toMatchObject({
      result: { content: expect.any(Array) },
    });
    expect(isBudgetRefusal(atCap.parsed)).toBe(false);
    expect(findAll).toHaveBeenCalledTimes(1);

    const overCap = await callRaw(accessToken, {
      documentId: document.id,
      ...filler(CAP),
    });
    expect(isBudgetRefusal(overCap.parsed)).toBe(true);
    expect(findAll).toHaveBeenCalledTimes(1);
  });

  it("counts nested members of a value of the wrong type", async () => {
    const { accessToken } = await buildOAuthUser();
    const findAll = vi.spyOn(Comment, "findAll");

    const nested = await callRaw(accessToken, {
      documentId: { a: { b: { c: Array(CAP).fill(0) } } },
    });
    const aggregate = await callRaw(accessToken, {
      documentId: Array(CAP / 2).fill([1]),
      collectionId: Array(CAP / 2).fill([1]),
    });

    expect(isBudgetRefusal(nested.parsed)).toBe(true);
    expect(isBudgetRefusal(aggregate.parsed)).toBe(true);
    expect(findAll).not.toHaveBeenCalled();
  });

  it("does not echo the refused input", async () => {
    const { accessToken } = await buildOAuthUser();
    const secret = "marker-should-not-be-reflected";

    const { parsed } = await callRaw(accessToken, {
      ...filler(CAP),
      documentId: secret,
    });

    expect(JSON.stringify(parsed)).not.toContain(secret);
  });

  it("writes nothing when a write tool's arguments are refused", async () => {
    const { user, accessToken } = await buildOAuthUser();
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const documents = await Document.count({ where: { teamId: user.teamId } });
    const events = await Event.count({ where: { teamId: user.teamId } });

    const { parsed } = await post(
      accessToken,
      mcpRequest("tools/call", {
        name: "create_document",
        arguments: {
          title: "refused",
          text: "body",
          collectionId: collection.id,
          publish: true,
          ...filler(CAP),
        },
      }).body
    );

    expect(isBudgetRefusal(parsed)).toBe(true);
    expect(await Document.count({ where: { teamId: user.teamId } })).toEqual(
      documents
    );
    expect(await Event.count({ where: { teamId: user.teamId } })).toEqual(
      events
    );
  });

  it("keeps ordinary calls and large document strings working", async () => {
    const { user, accessToken } = await buildOAuthUser();
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    // Far more characters than the limit: strings are not collections
    const text = `${"A paragraph of ordinary document text.\n\n".repeat(
      12_000
    )}`;
    expect(text.length).toBeGreaterThan(400_000);
    expect(text.length).toBeLessThan(900_000);

    const created = await callMcpTool(server, accessToken, "create_document", {
      title: "A large document",
      text,
      collectionId: collection.id,
      publish: true,
    });
    expect(created?.error).toBeUndefined();
    expect(created?.result?.isError).toBeFalsy();
    expect(
      await Document.count({
        where: { teamId: user.teamId, title: "A large document" },
      })
    ).toEqual(1);

    const listed = await callMcpTool(
      server,
      accessToken,
      "list_collections",
      {}
    );
    expect(listed?.result?.isError).toBeFalsy();
  });

  it("answers the request after a refused one", async () => {
    const { accessToken } = await buildOAuthUser();

    const refused = await callRaw(accessToken, filler(CAP + 1));
    const next = await callMcpTool(server, accessToken, "list_collections", {});

    expect(isBudgetRefusal(refused.parsed)).toBe(true);
    expect(next?.result?.isError).toBeFalsy();
  });
});

describe("list_comments statusFilter", () => {
  it("accepts every distinct status and refuses a longer list before the callback", async () => {
    const { user, accessToken } = await buildOAuthUser();
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const document = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
    });
    const findAll = vi.spyOn(Comment, "findAll");
    const statuses = Object.values(CommentStatusFilter);

    const ok = await callRaw(accessToken, {
      documentId: document.id,
      statusFilter: statuses,
    });
    expect(ok.parsed).toMatchObject({ result: { content: expect.any(Array) } });
    expect(findAll).toHaveBeenCalledTimes(1);

    const over = await callRaw(accessToken, {
      documentId: document.id,
      statusFilter: [...statuses, statuses[0]],
    });
    expect(JSON.stringify(over.parsed)).toContain("-32602");
    expect(findAll).toHaveBeenCalledTimes(1);
  });

  it("refuses a statusFilter within the element budget but over its own bound", async () => {
    const { accessToken } = await buildOAuthUser();
    const findAll = vi.spyOn(Comment, "findAll");

    const { parsed } = await callRaw(accessToken, {
      statusFilter: Array(CAP / 2).fill(CommentStatusFilter.Resolved),
    });

    expect(JSON.stringify(parsed)).toContain("-32602");
    expect(isBudgetRefusal(parsed)).toBe(false);
    expect(findAll).not.toHaveBeenCalled();
  });
});

describe("credentials are checked before any argument", () => {
  const huge = () => ({
    ...filler(CAP * 5),
    statusFilter: Array(CAP * 5).fill(1),
  });

  it("answers 401 without a credential", async () => {
    const findAll = vi.spyOn(Comment, "findAll");

    const { res } = await callRaw(undefined, huge());

    expect(res.status).toEqual(401);
    expect(findAll).not.toHaveBeenCalled();
  });

  it("answers 401 for an invalid token", async () => {
    const findAll = vi.spyOn(Comment, "findAll");

    const { res } = await callRaw("ol_at_not_a_token", huge());

    expect(res.status).toEqual(401);
    expect(findAll).not.toHaveBeenCalled();
  });

  it("does not expose a tool outside the token's scopes", async () => {
    const { user } = await buildOAuthUser();
    const narrow = await buildOAuthAuthentication({
      user,
      scope: [Scope.Create],
    });
    const findAll = vi.spyOn(Comment, "findAll");

    const { parsed } = await callRaw(narrow.accessToken!, huge());

    expect(JSON.stringify(parsed)).toContain("not found");
    expect(findAll).not.toHaveBeenCalled();
  });
});

describe("batches", () => {
  it("accepts a batch at the SDK limit and refuses one more", async () => {
    const { accessToken } = await buildOAuthUser();
    const item = () => mcpRequest("tools/list").body;

    const atLimit = await post(accessToken, Array.from({ length: 100 }, item));
    const over = await post(accessToken, Array.from({ length: 101 }, item));

    expect(atLimit.res.status).toEqual(200);
    expect(over.res.status).toEqual(400);
  });

  it("applies the element budget to every call of a batch", async () => {
    const { accessToken } = await buildOAuthUser();
    const findAll = vi.spyOn(Comment, "findAll");
    const call = (args: unknown) =>
      mcpRequest("tools/call", { name: "list_comments", arguments: args }).body;

    const { res } = await post(accessToken, [
      call(filler(CAP + 1)),
      call(filler(CAP + 1, 1000)),
    ]);

    expect(res.status).toEqual(200);
    expect(findAll).not.toHaveBeenCalled();
  });
});
