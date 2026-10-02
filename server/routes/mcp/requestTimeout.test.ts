import http from "node:http";
import type { AddressInfo } from "node:net";
import Koa from "koa";
import mount from "koa-mount";
// oxlint-disable-next-line no-restricted-imports
import nodeFetch from "node-fetch";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import env from "@server/env";
import {
  buildOAuthUser,
  mcpHeaders,
  mcpRequest,
  parseMcpResponse,
} from "@server/test/McpHelper";
import { AUDIT_WRITE_BOUND_MS } from "@server/wikiLint/application/deadline";
import { LINT_WIKI_DEADLINE_MS } from "@server/wikiLint/application/lintWiki";
import mcp, { MCP_REQUEST_TIMEOUT_MS } from "./index";

/**
 * Waits past the global request timeout.
 *
 * @returns a promise that resolves after `REQUEST_TIMEOUT + 1000` ms.
 */
const outlastRequestTimeout = () =>
  new Promise((resolve) => setTimeout(resolve, env.REQUEST_TIMEOUT + 1000));

vi.mock("@server/tools/users", () => ({
  userTools: (server: McpServer) => {
    server.registerTool(
      "slow_probe",
      { description: "Answers late." },
      async () => {
        await outlastRequestTimeout();
        return { content: [{ type: "text" as const, text: "finished" }] };
      }
    );
  },
}));

describe("/mcp request timeout", () => {
  it(
    "outlives the global socket timeout only for /mcp requests",
    { timeout: 60000 },
    async () => {
      const requestTimeout = env.REQUEST_TIMEOUT;
      let controlSocketDestroyed: (destroyed: boolean) => void = () =>
        undefined;
      const controlHandled = new Promise<boolean>((resolve) => {
        controlSocketDestroyed = resolve;
      });
      const app = new Koa();
      app.use(mount("/mcp", mcp));
      app.use(async (ctx) => {
        await outlastRequestTimeout();
        controlSocketDestroyed(ctx.req.socket.destroyed);
        ctx.body = "late";
      });
      const server = http.createServer(app.callback());
      server.setTimeout(env.REQUEST_TIMEOUT);
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

      try {
        const { accessToken } = await buildOAuthUser();
        const { body } = mcpRequest("tools/call", {
          name: "slow_probe",
          arguments: {},
        });
        const started = performance.now();

        const [response, control] = await Promise.all([
          nodeFetch(`${origin}/mcp/`, {
            method: "POST",
            headers: {
              ...mcpHeaders(accessToken),
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          }).then(async (res) => ({
            status: res.status,
            parsed: await parseMcpResponse(res),
            elapsedMs: performance.now() - started,
          })),
          nodeFetch(`${origin}/slow`).then(
            () => "answered",
            () => "destroyed"
          ),
        ]);

        expect(response.status).toBe(200);
        expect(response.parsed).toMatchObject({
          result: { content: [{ type: "text", text: "finished" }] },
        });
        expect(response.elapsedMs).toBeGreaterThan(requestTimeout);
        expect(control).toBe("destroyed");
        await expect(controlHandled).resolves.toBe(true);
        expect(env.REQUEST_TIMEOUT).toBe(requestTimeout);
        expect(server.timeout).toBe(requestTimeout);
      } finally {
        server.closeAllConnections();
        server.close();
      }
    }
  );

  it("keeps a larger or disabled global socket timeout", async () => {
    const requestTimeout = env.REQUEST_TIMEOUT;
    const socketTimeout = vi.spyOn(
      http.IncomingMessage.prototype,
      "setTimeout"
    );
    const server = http.createServer(
      new Koa().use(mount("/mcp", mcp)).callback()
    );
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    try {
      const timeouts: unknown[][] = [];
      for (const configured of [120000, 0]) {
        env.REQUEST_TIMEOUT = configured;
        socketTimeout.mockClear();
        const response = await nodeFetch(`${origin}/mcp/`, {
          method: "POST",
          headers: { Accept: "application/json, text/event-stream" },
          body: "{}",
        });
        expect(response.status).toBe(401);
        timeouts.push(socketTimeout.mock.calls.map(([ms]) => ms));
      }
      expect(timeouts).toEqual([[120000], [0]]);
    } finally {
      env.REQUEST_TIMEOUT = requestTimeout;
      socketTimeout.mockRestore();
      server.closeAllConnections();
      server.close();
    }
  });

  it("keeps the lint_wiki bounds under the /mcp socket timeout", () => {
    expect(LINT_WIKI_DEADLINE_MS + AUDIT_WRITE_BOUND_MS).toBeLessThanOrEqual(
      63000
    );
    expect(63000).toBeLessThan(MCP_REQUEST_TIMEOUT_MS);
    expect(env.REQUEST_TIMEOUT).toBeLessThan(MCP_REQUEST_TIMEOUT_MS);
  });
});
