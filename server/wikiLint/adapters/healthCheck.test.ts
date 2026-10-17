import http from "node:http";
import { Socket } from "node:net";
import Koa from "koa";
import Logger from "@server/logging/Logger";
import { createHealthHandler } from "./healthCheck";
import { POLICY_SET_FINGERPRINT_HEADER } from "./policyConfig";

const FINGERPRINT =
  "sha256:25d4e8ec86646fe465b938d352ab3973a46bef099e8ec712c5535c1a2609ecc2";

/**
 * Creates a Koa context for a `GET /_health` request.
 *
 * @returns the context.
 */
function healthContext() {
  const req = new http.IncomingMessage(new Socket());
  req.method = "GET";
  req.url = "/_health";
  return new Koa().createContext(req, new http.ServerResponse(req));
}

let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  error = vi.spyOn(Logger, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createHealthHandler", () => {
  it("answers 503 without a body or any dependency check when not ready", async () => {
    const checkDatabase = vi.fn(() => Promise.resolve());
    const checkRedis = vi.fn(() => Promise.resolve());
    const ctx = healthContext();

    await createHealthHandler({
      readiness: { ready: false, policySetFingerprint: FINGERPRINT },
      checkDatabase,
      checkRedis,
    })(ctx);

    expect(ctx.status).toBe(503);
    expect(ctx.body).toBeUndefined();
    expect(ctx.response.get(POLICY_SET_FINGERPRINT_HEADER)).toBe(FINGERPRINT);
    expect(checkDatabase).not.toHaveBeenCalled();
    expect(checkRedis).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("answers 200 OK when ready and both checks pass", async () => {
    const checkDatabase = vi.fn(() => Promise.resolve());
    const checkRedis = vi.fn(() => Promise.resolve());
    const ctx = healthContext();

    await createHealthHandler({
      readiness: { ready: true, policySetFingerprint: FINGERPRINT },
      checkDatabase,
      checkRedis,
    })(ctx);

    expect(ctx.status).toBe(200);
    expect(ctx.body).toBe("OK");
    expect(ctx.response.get(POLICY_SET_FINGERPRINT_HEADER)).toBe(FINGERPRINT);
    expect(checkDatabase).toHaveBeenCalledTimes(1);
    expect(checkRedis).toHaveBeenCalledTimes(1);
  });

  it("answers the baseline 500 when the database check fails", async () => {
    const failure = new Error("database down");
    const checkRedis = vi.fn(() => Promise.resolve());
    const ctx = healthContext();

    await createHealthHandler({
      readiness: { ready: true, policySetFingerprint: FINGERPRINT },
      checkDatabase: () => Promise.reject(failure),
      checkRedis,
    })(ctx);

    expect(ctx.status).toBe(500);
    expect(ctx.body).toBeUndefined();
    expect(ctx.response.get(POLICY_SET_FINGERPRINT_HEADER)).toBe(FINGERPRINT);
    expect(checkRedis).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("Database connection failed", failure);
  });

  it("answers the baseline 500 when the Redis check fails", async () => {
    const failure = new Error("redis down");
    const ctx = healthContext();

    await createHealthHandler({
      readiness: { ready: true, policySetFingerprint: FINGERPRINT },
      checkDatabase: () => Promise.resolve(),
      checkRedis: () => Promise.reject(failure),
    })(ctx);

    expect(ctx.status).toBe(500);
    expect(ctx.body).toBeUndefined();
    expect(ctx.response.get(POLICY_SET_FINGERPRINT_HEADER)).toBe(FINGERPRINT);
    expect(error).toHaveBeenCalledWith("Redis ping failed", failure);
  });
});
