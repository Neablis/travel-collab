// **`POST /api/oauth/register`**, against a real database and the real
// counter table. Open registration is bounded only by the per-IP limit, so the
// 429 is the test that matters most here.
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

// A switch for the store-failure test: `registerClient` throws as the insert did
// in production while migration 0075 was pending (KI-2026-11-11-a).
const store = vi.hoisted(() => ({ fail: false }));
vi.mock("@/server/oauth/clients", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/oauth/clients")>();
  return {
    ...real,
    registerClient: (...args: Parameters<typeof real.registerClient>) => {
      if (store.fail) throw new Error('column "logo_uri" of relation "oauth_clients" does not exist');
      return real.registerClient(...args);
    },
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  store.fail = false;
});

/** A registration from `ip`, which no other test (or run) shares. */
const register = (body: unknown, ip: string = randomUUID()) =>
  POST(
    new Request("http://localhost/api/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );

describe("POST /api/oauth/register", () => {
  it("answers 201 with RFC 7591 client information, uncacheable", async () => {
    const res = await register({ client_name: "Test", redirect_uris: ["https://example.com/cb"] });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(
      expect.objectContaining({
        client_id: expect.any(String),
        client_name: "Test",
        redirect_uris: ["https://example.com/cb"],
        token_endpoint_auth_method: "none",
      }),
    );
  });

  // Three of the four shapes the fresh-agent test sent on 2026-11-11 (KI-2026-11-11-a), each of which got an empty 500; the fourth, an https redirect, is the 201 test above.
  it.each([
    [
      "the full body",
      {
        client_name: "Fresh agent",
        redirect_uris: ["http://127.0.0.1:8976/callback"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope: "trips:read",
      },
    ],
    ["the minimal body", { client_name: "Fresh agent", redirect_uris: ["http://127.0.0.1:8976/callback"] }],
    ["a code-only grant with no scope", { redirect_uris: ["http://127.0.0.1:8976/callback"], grant_types: ["authorization_code"] }],
  ])("answers 201 for %s", async (_case, body) => {
    const res = await register(body);
    expect(res.status).toBe(201);
    expect((await res.json()).client_id).toEqual(expect.any(String));
  });

  it("answers 500 server_error with a JSON body and no Retry-After when the store throws, never an empty 500", async () => {
    store.fail = true;
    const res = await register({ client_name: "Fresh agent", redirect_uris: ["http://127.0.0.1:8976/callback"] });
    expect(res.status).toBe(500);
    expect(res.headers.get("retry-after")).toBeNull();
    expect(await res.json()).toEqual(expect.objectContaining({ error: "server_error" }));
  });

  it.each([
    ["http on a public host", "http://example.com/cb"],
    ["a fragment", "https://example.com/cb#x"],
    ["a custom scheme", "myapp://cb"],
    ["something that does not parse", "not a url"],
  ])("answers 400 invalid_redirect_uri for %s", async (_case, uri) => {
    const res = await register({ client_name: "Test", redirect_uris: [uri] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(expect.objectContaining({ error: "invalid_redirect_uri" }));
  });

  it("answers 400 invalid_redirect_uri for no redirects, and for a body that is not JSON", async () => {
    expect((await (await register({ client_name: "Test" })).json()).error).toBe("invalid_redirect_uri");
    const garbled = await POST(
      new Request("http://localhost/api/oauth/register", {
        method: "POST",
        headers: { "x-forwarded-for": randomUUID() },
        body: "{",
      }),
    );
    expect(garbled.status).toBe(400);
  });

  it("answers 429 past the per-IP limit, with Retry-After, and another IP is unaffected", async () => {
    vi.stubEnv("OAUTH_REGISTER_RATE_LIMIT_PER_IP_HOURLY", "2");
    const ip = randomUUID();
    const body = { redirect_uris: ["https://example.com/cb"] };
    expect((await register(body, ip)).status).toBe(201);
    expect((await register(body, ip)).status).toBe(201);
    const refused = await register(body, ip);
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await register(body)).status).toBe(201);
  });

  it("counts every address in one IPv6 /64 against one limit", async () => {
    vi.stubEnv("OAUTH_REGISTER_RATE_LIMIT_PER_IP_HOURLY", "2");
    const group = () => Math.floor(Math.random() * 0xffff).toString(16);
    const prefix = `2001:db8:${group()}:${group()}`;
    const body = { redirect_uris: ["https://example.com/cb"] };
    expect((await register(body, `${prefix}::1`)).status).toBe(201);
    expect((await register(body, `${prefix}::2`)).status).toBe(201);
    expect((await register(body, `${prefix}:ffff:1:2:3`)).status).toBe(429);
  });
});
