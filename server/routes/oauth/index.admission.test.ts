import { faker } from "@faker-js/faker";
import { RateLimiterRes } from "rate-limiter-flexible";
import { TeamPreference } from "@shared/types";
import { OAuthClientValidation } from "@shared/validations";
import env from "@server/env";
import { OAuthClient } from "@server/models";
import { buildOAuthClient, buildTeam } from "@server/test/factories";
import RateLimiter from "@server/utils/RateLimiter";
import { getTestServer } from "@server/test/support";
import * as T from "./schema";

const server = getTestServer();

// The contract of the bounds, kept literal so that a change is a decision.
const MAX_METADATA_ITEMS = 10;
const HUGE = 20_000;

// A process-level failure is not reported by Vitest here, see
// `dangerouslyIgnoreUnhandledErrors`, so it is collected and asserted.
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

describe("registration schema bounds", () => {
  const base = { redirect_uris: ["https://example.com/callback"] };

  it.each([
    ["grant_types", "bogus"],
    ["response_types", "bogus"],
    ["contacts", "not-an-email"],
  ])(
    "rejects an oversized %s with one issue and no per-item validation",
    (field, invalidItem) => {
      const result = T.RegisterSchema.safeParse({
        body: { ...base, [field]: Array(HUGE).fill(invalidItem) },
        query: {},
      });

      expect(result.success).toBe(false);
      // Without the early bound every element reports its own issue
      expect(result.error?.issues).toHaveLength(1);
      expect(result.error?.issues[0].code).toEqual("too_big");
    }
  );

  it("rejects oversized redirect_uris with one issue and no per-item validation", () => {
    const result = T.RegisterSchema.safeParse({
      body: { redirect_uris: Array(HUGE).fill("not a url") },
      query: {},
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0].message).toEqual(
      `expected array to have <=${OAuthClientValidation.maxRedirectUris} items, received ${HUGE}`
    );
  });

  it("rejects an oversized redirect_uris in the update schema early", () => {
    const result = T.RegisterUpdateSchema.safeParse({
      body: { client_name: "x", redirect_uris: Array(HUGE).fill("not a url") },
      query: {},
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toHaveLength(1);
  });

  it("accepts exactly the maximum and rejects one more", () => {
    const grantTypes = (n: number) => Array(n).fill("authorization_code");
    const ok = T.RegisterSchema.safeParse({
      body: {
        ...base,
        grant_types: grantTypes(MAX_METADATA_ITEMS),
        response_types: Array(MAX_METADATA_ITEMS).fill("code"),
        contacts: Array(MAX_METADATA_ITEMS).fill("a@example.com"),
      },
      query: {},
    });
    expect(ok.success).toBe(true);

    for (const field of ["grant_types", "response_types", "contacts"]) {
      const item = field === "contacts" ? "a@example.com" : "code";
      const over = T.RegisterSchema.safeParse({
        body: { ...base, [field]: Array(MAX_METADATA_ITEMS + 1).fill(item) },
        query: {},
      });
      expect(over.success).toBe(false);
      expect(over.error?.issues[0].code).toEqual("too_big");
    }
  });

  it("keeps the defaults and the documented values for a minimal body", () => {
    const parsed = T.RegisterSchema.parse({ body: base, query: {} });
    expect(parsed.body.grant_types).toEqual(["authorization_code"]);
    expect(parsed.body.response_types).toEqual(["code"]);
    expect(parsed.body.token_endpoint_auth_method).toEqual("none");
  });
});

describe("POST /oauth/register admission order", () => {
  const originalDcr = env.OAUTH_DISABLE_DCR;
  const originalRateLimiter = env.RATE_LIMITER_ENABLED;
  let subdomain: string;
  let team: Awaited<ReturnType<typeof buildTeam>>;

  const oversized = () => ({
    client_name: "Test Client",
    redirect_uris: ["https://example.com/callback"],
    grant_types: Array(HUGE).fill("bogus"),
  });

  const register = (body: Record<string, unknown>) =>
    server.post("/oauth/register", {
      body,
      headers: { host: `${subdomain}.outline.dev` },
    });

  const clientCount = () => OAuthClient.count({ where: { teamId: team.id } });

  beforeEach(async () => {
    subdomain = faker.internet.domainWord();
    team = await buildTeam({ subdomain });
  });

  afterEach(() => {
    env.OAUTH_DISABLE_DCR = originalDcr;
    env.RATE_LIMITER_ENABLED = originalRateLimiter;
    vi.restoreAllMocks();
  });

  it("answers 404 before validating when dynamic registration is disabled", async () => {
    env.OAUTH_DISABLE_DCR = true;

    const res = await register(oversized());

    expect(res.status).toEqual(404);
    expect(await clientCount()).toEqual(0);
  });

  it("answers 404 before validating when the team has MCP disabled", async () => {
    team.setPreference(TeamPreference.MCP, false);
    await team.save();

    const res = await register(oversized());

    expect(res.status).toEqual(404);
    expect(await clientCount()).toEqual(0);
  });

  it("answers 404 before validating when no team matches the host", async () => {
    const res = await server.post("/oauth/register", {
      body: oversized(),
      headers: { host: `invalid-${subdomain}.outline.dev` },
    });

    expect(res.status).toEqual(404);
  });

  it("applies the route rate limiter before validating", async () => {
    env.RATE_LIMITER_ENABLED = true;
    const consume = vi
      .fn()
      .mockRejectedValue(new RateLimiterRes(0, 1000, 0, false));
    vi.spyOn(RateLimiter, "getRateLimiter").mockReturnValue({
      consume,
      points: 5,
    } as unknown as ReturnType<typeof RateLimiter.getRateLimiter>);

    const res = await register(oversized());

    expect(consume).toHaveBeenCalled();
    expect(res.status).toEqual(429);
    expect(await clientCount()).toEqual(0);
  });

  it("still validates a body once the checks pass", async () => {
    const invalid = await register({
      ...oversized(),
      grant_types: ["client_credentials"],
    });
    expect(invalid.status).toEqual(400);

    const res = await register(oversized());
    expect(res.status).toEqual(400);
    const body = await res.json();
    expect(body.error).toEqual("invalid_request");
    expect(body.error_description).toContain("grant_types");
    expect(await clientCount()).toEqual(0);
  });

  it("accepts a normal registration with a maximal valid body", async () => {
    const res = await register({
      client_name: "Test Client",
      redirect_uris: Array.from(
        { length: OAuthClientValidation.maxRedirectUris },
        (_, index) => `https://example.com/callback/${index}`
      ),
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      contacts: ["owner@example.com"],
    });

    expect(res.status).toEqual(201);
    expect(await clientCount()).toEqual(1);
  });
});

describe("PUT /oauth/register/:clientId admission order", () => {
  let subdomain: string;
  let registered: {
    client_id: string;
    registration_access_token: string;
  };

  const oversized = () => ({
    client_name: "Updated",
    redirect_uris: Array(HUGE).fill("not a url"),
  });

  beforeEach(async () => {
    subdomain = faker.internet.domainWord();
    await buildTeam({ subdomain });
    const res = await server.post("/oauth/register", {
      body: {
        client_name: "Test Client",
        redirect_uris: ["https://example.com/callback"],
      },
      headers: { host: `${subdomain}.outline.dev` },
    });
    registered = await res.json();
  });

  const unchanged = async () => {
    const client = await OAuthClient.findByClientId(registered.client_id);
    expect(client?.name).toEqual("Test Client");
    expect(client?.redirectUris).toEqual(["https://example.com/callback"]);
    // A refused update must not rotate the registration access token
    expect(
      await OAuthClient.findByRegistrationAccessToken(
        registered.registration_access_token
      )
    ).toBeTruthy();
  };

  it("answers 401 before validating without an Authorization header", async () => {
    const res = await server.put(`/oauth/register/${registered.client_id}`, {
      body: oversized(),
    });

    expect(res.status).toEqual(401);
    await unchanged();
  });

  it("answers 401 before validating for an invalid token", async () => {
    const res = await server.put(`/oauth/register/${registered.client_id}`, {
      body: oversized(),
      headers: { Authorization: "Bearer not-the-token" },
    });

    expect(res.status).toEqual(401);
    await unchanged();
  });

  it("answers 401 before validating when the token belongs to another client", async () => {
    const other = await buildOAuthClient();
    const res = await server.put(`/oauth/register/${other.clientId}`, {
      body: oversized(),
      headers: {
        Authorization: `Bearer ${registered.registration_access_token}`,
      },
    });

    expect(res.status).toEqual(401);
    await unchanged();
  });

  it("answers 400 for an oversized body with a valid token and changes nothing", async () => {
    const res = await server.put(`/oauth/register/${registered.client_id}`, {
      body: oversized(),
      headers: {
        Authorization: `Bearer ${registered.registration_access_token}`,
      },
    });

    expect(res.status).toEqual(400);
    const body = await res.json();
    expect(body.error).toEqual("invalid_request");
    await unchanged();
  });
});
