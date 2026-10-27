// **The consent decision**, against a real database. The two gates (a session
// on this origin, and the `api.tokens` entitlement) and amendment A: every
// answer that goes back to the client carries `iss`, Allow and Deny alike.
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { issueGrant } from "@/server/entitlements/grants";
import { livePlanVersion } from "@/server/entitlements/planVersions";
import { registerClient, resolveClient } from "@/server/oauth/clients";
import { listGrants } from "@/server/oauth/grants";
import { mcpResource, oauthIssuer } from "@/server/oauth/metadata";
import { upsertUser } from "@/server/users";

let currentUserId: string | null = null;
vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId === null ? null : { user: { id: currentUserId } })),
}));
// Real, except where a test has a metadata document change between the page and the click.
vi.mock("@/server/oauth/clients", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/oauth/clients")>();
  return { ...actual, resolveClient: vi.fn(actual.resolveClient) };
});

const { POST } = await import("./route");

const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const REDIRECT = "https://example.com/cb";

async function account(premium: boolean): Promise<string> {
  const id = `oauth-${randomUUID()}`;
  await upsertUser({ id, email: `${id}@example.test`, name: null, image: null });
  if (premium) {
    const plan = livePlanVersion("premium");
    await issueGrant({
      userId: id,
      planId: plan.planId,
      planVersion: plan.version,
      source: "admin",
      grantedBy: "dev-operator",
      reason: "M55 part 2 fixture.",
      expiresAt: null,
    });
  }
  return id;
}

async function authorizeParams(): Promise<Record<string, string>> {
  const registered = await registerClient({ client_name: "Test", redirect_uris: [REDIRECT] }, randomUUID());
  return {
    client_id: registered.ok ? String(registered.body.client_id) : "",
    redirect_uri: REDIRECT,
    response_type: "code",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "s-1",
    scope: "trips:read notebook:write",
    resource: mcpResource(),
  };
}

const decide = (body: unknown, origin: string | null = oauthIssuer()) =>
  POST(
    new Request(`${oauthIssuer()}/api/oauth/authorize`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(origin === null ? {} : { origin }) },
      body: JSON.stringify(body),
    }),
  );

describe("POST /api/oauth/authorize", () => {
  it("answers Allow with a code, the state and iss", async () => {
    currentUserId = await account(true);
    const res = await decide({
      params: await authorizeParams(),
      decision: "allow",
      scopes: ["trips:read"],
      clientName: "Test",
    });
    expect(res.status).toBe(200);
    const target = new URL((await res.json()).redirectTo);
    expect(`${target.origin}${target.pathname}`).toBe(REDIRECT);
    expect(target.searchParams.get("code")).toMatch(/^tcc_/);
    expect(target.searchParams.get("state")).toBe("s-1");
    expect(target.searchParams.get("iss")).toBe(oauthIssuer());
  });

  it("answers Deny with access_denied, the state and iss", async () => {
    currentUserId = await account(true);
    const res = await decide({ params: await authorizeParams(), decision: "deny" });
    const target = new URL((await res.json()).redirectTo);
    expect(target.searchParams.get("error")).toBe("access_denied");
    expect(target.searchParams.get("state")).toBe("s-1");
    expect(target.searchParams.get("iss")).toBe(oauthIssuer());
    expect(target.searchParams.has("code")).toBe(false);
  });

  it("refuses a free account with 402 and issues nothing", async () => {
    currentUserId = await account(false);
    const res = await decide({ params: await authorizeParams(), decision: "allow", scopes: ["trips:read"] });
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "api-not-entitled" });
    // Codes hang off a grant, so no grant means no code either.
    expect(await listGrants(currentUserId)).toEqual([]);
  });

  it("refuses another origin, and a request with none", async () => {
    currentUserId = await account(true);
    const body = { params: await authorizeParams(), decision: "allow", scopes: ["trips:read"] };
    expect((await decide(body, "https://evil.example")).status).toBe(403);
    expect((await decide(body, null)).status).toBe(403);
  });

  it("refuses with no session", async () => {
    currentUserId = null;
    expect((await decide({ params: await authorizeParams(), decision: "deny" })).status).toBe(401);
  });

  it("refuses a scope the client did not ask for, and an empty choice", async () => {
    currentUserId = await account(true);
    const params = await authorizeParams();
    expect((await decide({ params, decision: "allow", scopes: ["library:write"] })).status).toBe(400);
    expect((await decide({ params, decision: "allow", scopes: [] })).status).toBe(400);
  });

  // The grant keeps the name, and connected apps show it: it must be the one
  // the person read, not whatever the document says by the time they click.
  it("refuses Allow when a metadata document's name changed after the page showed it", async () => {
    currentUserId = await account(true);
    const url = `https://app.example/oauth/${randomUUID()}.json`;
    vi.mocked(resolveClient).mockResolvedValue({
      ok: true,
      client: { id: null, clientId: url, kind: "cimd", clientName: "Claude", redirectUris: [REDIRECT], cimdHost: "app.example" },
    });
    const params = { ...(await authorizeParams()), client_id: url };
    try {
      const res = await decide({ params, decision: "allow", scopes: ["trips:read"], clientName: "Some App" });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "client-changed" });
      expect(await listGrants(currentUserId)).toEqual([]);
      const same = await decide({ params, decision: "allow", scopes: ["trips:read"], clientName: "Claude" });
      expect(same.status).toBe(200);
    } finally {
      vi.mocked(resolveClient).mockReset();
    }
  });

  it("shows an unknown client rather than redirecting to the redirect it names", async () => {
    currentUserId = await account(true);
    const params = { ...(await authorizeParams()), client_id: randomUUID(), redirect_uri: "https://evil.example/cb" };
    const res = await decide({ params, decision: "allow", scopes: ["trips:read"] });
    expect(res.status).toBe(400);
    expect(await res.json()).not.toHaveProperty("redirectTo");
  });
});
