import { createServer, request, type Server as HttpServer } from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { Socket as EngineSocket } from "engine.io";
import { Socket as EngineClient } from "engine.io-client";
import { Server } from "socket.io";

const requirePackage = createRequire(import.meta.url);
const socketIoRequire = createRequire(requirePackage.resolve("socket.io"));
let http: HttpServer;
let io: Server;
let origin: string;
let errors: Error[];
let sessions: Map<string, EngineSocket>;
const clients: EngineClient[] = [];

beforeEach(async () => {
  errors = [];
  sessions = new Map();
  http = createServer();
  // Exercise Socket.IO's actual Engine.IO edge at the shipped realtime path,
  // before application authentication. All traffic stays on test loopback.
  io = new Server(http, {
    path: "/realtime",
    serveClient: false,
    cookie: false,
  });
  http.on("error", (error) => errors.push(error));
  io.engine.on("connection", (socket) => {
    sessions.set(socket.id, socket);
    socket.on("error", (error: Error) => errors.push(error));
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const client of clients.splice(0)) {
    client.close();
  }
  await new Promise<void>((resolve) => io.close(() => resolve()));
  expect(errors).toEqual([]);
});

async function handshake() {
  const response = await fetch(`${origin}/realtime/?EIO=4&transport=polling`, {
    signal: AbortSignal.timeout(2000),
  });
  expect(response.status).toBe(200);
  const packet = await response.text();
  expect(packet[0]).toBe("0");
  return JSON.parse(packet.slice(1)) as { sid: string; upgrades: string[] };
}

function upgradeStatus(query: URLSearchParams): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const req = request(`${origin}/realtime/?${query}`, {
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": Buffer.alloc(16, 1).toString("base64"),
      },
    });
    req.on("upgrade", (response, socket) => {
      socket.destroy();
      resolve(response.statusCode);
    });
    req.on("response", (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    req.on("error", reject);
    req.setTimeout(2000, () =>
      req.destroy(new Error("Loopback upgrade timed out"))
    );
    req.end();
  });
}

describe("Engine.IO protocol security backport", () => {
  it("resolves the exact patched Engine.IO through Socket.IO", () => {
    const manifest = path.join(
      path.dirname(socketIoRequire.resolve("engine.io")),
      "../package.json"
    );
    expect(JSON.parse(readFileSync(manifest, "utf8")).version).toBe("6.6.10");
  });

  it.each([undefined, "3", "2"])(
    "rejects a session upgrade with EIO=%s",
    async (revision) => {
      const { sid, upgrades } = await handshake();
      expect(upgrades).toContain("websocket");
      const query = new URLSearchParams({ transport: "websocket", sid });
      if (revision !== undefined) {
        query.set("EIO", revision);
      }
      expect(await upgradeStatus(query)).toBe(400);
      // A refused upgrade must not destroy the otherwise valid v4 session.
      expect(sessions.get(sid)?.protocol).toBe(4);
      expect(sessions.get(sid)?.transport.name).toBe("polling");
    }
  );

  it.each([
    "EIO=3&transport=polling",
    "EIO=4&transport=unknown",
    "EIO=4&transport=polling&sid=missing",
  ])("rejects an invalid handshake: %s", async (query) => {
    const response = await fetch(`${origin}/realtime/?${query}`, {
      signal: AbortSignal.timeout(2000),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty("code");
  });

  it("performs a real polling-to-WebSocket upgrade and opens a fresh session after disconnect", async () => {
    const connect = () => {
      const client = new EngineClient(origin, {
        path: "/realtime/",
        transports: ["polling", "websocket"],
      });
      clients.push(client);
      return client;
    };
    const first = connect();
    const upgraded = new Promise<void>((resolve, reject) => {
      first.once("upgrade", () => resolve());
      first.once("error", reject);
    });
    await new Promise<void>((resolve, reject) => {
      first.once("open", resolve);
      first.once("error", reject);
    });
    const previousId = first.id;
    await upgraded;
    expect(first.transport.name).toBe("websocket");
    first.close();
    const second = connect();
    await new Promise<void>((resolve, reject) => {
      second.once("open", resolve);
      second.once("error", reject);
    });
    expect(second.id).not.toBe(previousId);
    expect(sessions.get(second.id)?.protocol).toBe(4);
  }, 10000);
});
