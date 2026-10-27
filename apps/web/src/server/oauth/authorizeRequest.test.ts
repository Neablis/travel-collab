import { afterEach, describe, expect, it, vi } from "vitest";
import type { OAuthClient, ResolvedClient } from "./clients";

// The authorize request's checks, in their order. The order is the point:
// until the client and redirect are proven, an error is ours to show, and a
// redirect would hand the person to whatever URL the request named.

const resolveClient = vi.fn<(clientId: string) => Promise<ResolvedClient>>();
vi.mock("./clients", () => ({ resolveClient: (clientId: string) => resolveClient(clientId) }));

const { parseAuthorizeRequest } = await import("./authorizeRequest");
const { mcpResource, oauthIssuer } = await import("./metadata");

const CLIENT: OAuthClient = {
  id: "0b0e7c64-0000-4000-8000-000000000001",
  clientId: "0b0e7c64-0000-4000-8000-000000000001",
  kind: "dcr",
  clientName: "Test",
  redirectUris: ["https://example.com/cb"],
  cimdHost: null,
};
// RFC 7636 appendix B's challenge: the right shape for S256.
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

const valid = (over: Record<string, string | undefined> = {}) => ({
  client_id: CLIENT.clientId,
  redirect_uri: "https://example.com/cb",
  response_type: "code",
  code_challenge: CHALLENGE,
  code_challenge_method: "S256",
  state: "xyz",
  resource: mcpResource(),
  ...over,
});

/** The query the client gets back, or a failure naming what came instead. */
function backTo(parsed: Awaited<ReturnType<typeof parseAuthorizeRequest>>): URLSearchParams {
  if (!("redirectTo" in parsed)) throw new Error(`expected a redirect, got ${JSON.stringify(parsed)}`);
  return new URL(parsed.redirectTo).searchParams;
}

afterEach(() => resolveClient.mockReset());

describe("errors before the redirect is validated", () => {
  // Each case also carries a bad scope, which would be redirected if it were
  // checked first.
  const badScope = { scope: "admin:everything" };

  it("shows an unknown client, never redirecting", async () => {
    resolveClient.mockResolvedValue({ ok: false, reason: "unknown-client" });
    const parsed = await parseAuthorizeRequest(valid(badScope));
    expect(parsed).toEqual({ show: expect.objectContaining({ error: "invalid_client" }) });
    expect(parsed).not.toHaveProperty("redirectTo");
  });

  it("shows a CIMD that fails to fetch, never redirecting", async () => {
    resolveClient.mockResolvedValue({ ok: false, reason: "invalid-metadata-document", detail: "timeout" });
    const parsed = await parseAuthorizeRequest(valid({ ...badScope, client_id: "https://app.example/client.json" }));
    expect(parsed).toEqual({ show: expect.objectContaining({ error: "invalid_client" }) });
    expect(parsed).not.toHaveProperty("redirectTo");
  });

  it("shows a mismatched redirect, never redirecting", async () => {
    resolveClient.mockResolvedValue({ ok: true, client: CLIENT });
    const parsed = await parseAuthorizeRequest(valid({ ...badScope, redirect_uri: "https://evil.example/cb" }));
    expect(parsed).toEqual({ show: expect.objectContaining({ error: "invalid_redirect_uri" }) });
    expect(parsed).not.toHaveProperty("redirectTo");
  });

  it("shows a repeated redirect_uri, since it cannot know which to believe", async () => {
    resolveClient.mockResolvedValue({ ok: true, client: CLIENT });
    const parsed = await parseAuthorizeRequest({
      ...valid(),
      redirect_uri: ["https://example.com/cb", "https://evil.example/cb"],
    });
    expect(parsed).toEqual({ show: expect.objectContaining({ error: "invalid_request" }) });
  });
});

describe("the PKCE downgrade at authorize", () => {
  it.each([
    ["no code_challenge", { code_challenge: undefined }],
    ["plain", { code_challenge_method: "plain" }],
    ["no method, which RFC 7636 reads as plain", { code_challenge_method: undefined }],
  ])("refuses %s back to the client, with state and iss", async (_case, over) => {
    resolveClient.mockResolvedValue({ ok: true, client: CLIENT });
    const query = backTo(await parseAuthorizeRequest(valid(over)));
    expect(query.get("error")).toBe("invalid_request");
    expect(query.get("state")).toBe("xyz");
    expect(query.get("iss")).toBe(oauthIssuer());
  });
});

describe("after the redirect is proven", () => {
  it("answers a wrong resource with invalid_target", async () => {
    resolveClient.mockResolvedValue({ ok: true, client: CLIENT });
    const query = backTo(await parseAuthorizeRequest(valid({ resource: "https://other.example/api/mcp" })));
    expect(query.get("error")).toBe("invalid_target");
    expect(query.get("iss")).toBe(oauthIssuer());
  });

  it("answers an unknown scope with invalid_scope, and a wrong response_type with unsupported_response_type", async () => {
    resolveClient.mockResolvedValue({ ok: true, client: CLIENT });
    expect(backTo(await parseAuthorizeRequest(valid({ scope: "trips:read admin" }))).get("error")).toBe(
      "invalid_scope",
    );
    expect(backTo(await parseAuthorizeRequest(valid({ response_type: "token" }))).get("error")).toBe(
      "unsupported_response_type",
    );
  });

  it("takes a valid request, dropping offline_access from the scopes it asks consent for", async () => {
    resolveClient.mockResolvedValue({ ok: true, client: CLIENT });
    const parsed = await parseAuthorizeRequest(valid({ scope: "trips:read offline_access" }));
    expect(parsed).toEqual({
      request: expect.objectContaining({
        scopes: ["trips:read"],
        resource: mcpResource(),
        state: "xyz",
        marking: "unverified",
      }),
    });
  });

  it("matches a loopback redirect on another port, and keeps the port it was given", async () => {
    resolveClient.mockResolvedValue({
      ok: true,
      client: { ...CLIENT, redirectUris: ["http://127.0.0.1/callback"] },
    });
    const parsed = await parseAuthorizeRequest(valid({ redirect_uri: "http://127.0.0.1:61234/callback" }));
    expect(parsed).toEqual({
      request: expect.objectContaining({
        redirectUri: "http://127.0.0.1:61234/callback",
        marking: "localhost-warning",
      }),
    });
  });
});
