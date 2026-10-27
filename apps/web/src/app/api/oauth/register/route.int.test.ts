// **`POST /api/oauth/register`**, against a real database and the real
// counter table. Open registration is bounded only by the per-IP limit, so the
// 429 is the test that matters most here.
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

afterEach(() => vi.unstubAllEnvs());

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
