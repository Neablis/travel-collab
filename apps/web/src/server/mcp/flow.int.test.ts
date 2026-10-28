// **The connector end to end, through every real route** (ADR-083, M55 gate
// *The flow end to end*): register, consent as a signed-in premium user, the
// token exchange, a tool call, a refresh and another call; then Disconnect,
// after which the call is 401 and the refresh `invalid_grant`. Both ways a
// client names itself (CIMD first, DCR as the fallback; amendment E), and a
// grant made for another resource refused on the call (amendment C).
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/server/db/client";
import { oauthGrants } from "@/server/db/schema";
import { issueGrant } from "@/server/entitlements/grants";
import { livePlanVersion } from "@/server/entitlements/planVersions";
import { listGrants, revokeGrant } from "@/server/oauth/grants";
import { mcpResource, oauthIssuer } from "@/server/oauth/metadata";
import { upsertUser } from "@/server/users";

let sessionUserId: string | null = null;
vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (sessionUserId === null ? null : { user: { id: sessionUserId } })),
}));

// A client metadata document, served without a network: the guarded fetcher
// and its address check are what reach out, so they are what is replaced.
const CIMD_URL = "https://client.example/oauth/metadata.json";
const CIMD_REDIRECT = "http://127.0.0.1:43123/callback";
vi.mock("@/server/external/remoteImage/fetchImage", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  guardedHttpsFetcher: () => async (url: URL) =>
    String(url) === CIMD_URL
      ? Response.json({ client_id: CIMD_URL, client_name: "Inspector", redirect_uris: [CIMD_REDIRECT] })
      : new Response(null, { status: 404 }),
}));
vi.mock("@/server/external/remoteImage/guard", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  assertPublicAddress: async () => undefined,
}));

const { POST: register } = await import("@/app/api/oauth/register/route");
const { POST: decide } = await import("@/app/api/oauth/authorize/route");
const { POST: token } = await import("@/app/api/oauth/token/route");
const { POST: mcp } = await import("@/app/api/mcp/route");

const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const WRONG_VERIFIER = "x".repeat(43);
const DCR_REDIRECT = "https://example.com/cb";

async function premiumUser(): Promise<string> {
  const id = `mcp-flow-${randomUUID().slice(0, 8)}`;
  await upsertUser({ id, email: `${id}@example.test`, name: null, image: null });
  const premium = livePlanVersion("premium");
  await issueGrant({
    userId: id,
    planId: premium.planId,
    planVersion: premium.version,
    source: "admin",
    grantedBy: "dev-operator",
    reason: "M55 flow fixture.",
    expiresAt: null,
  });
  return id;
}

/** RFC 7591, as a client that only registers does it. */
async function registerByDcr(): Promise<string> {
  const res = await register(
    new Request(`${oauthIssuer()}/api/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250)}` },
      body: JSON.stringify({ client_name: "Test app", redirect_uris: [DCR_REDIRECT] }),
    }),
  );
  expect(res.status).toBe(201);
  return (await res.json()).client_id;
}

/** The consent page's Allow, as the signed-in owner, sending back the name the page showed: the code the redirect carries. */
async function consent(clientId: string, redirectUri: string, clientName: string): Promise<string> {
  const res = await decide(
    new Request(`${oauthIssuer()}/api/oauth/authorize`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: oauthIssuer() },
      body: JSON.stringify({
        decision: "allow",
        scopes: ["account:read"],
        clientName,
        params: {
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: "code",
          code_challenge: CHALLENGE,
          code_challenge_method: "S256",
          state: "flow",
          scope: "account:read offline_access",
          resource: mcpResource(),
        },
      }),
    }),
  );
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
  const back = new URL((await res.json()).redirectTo);
  expect(back.searchParams.get("iss")).toBe(oauthIssuer());
  return back.searchParams.get("code")!;
}

function tokenCall(form: Record<string, string>): Promise<Response> {
  return token(
    new Request(`${oauthIssuer()}/api/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    }),
  );
}

function whoami(access: string): Promise<Response> {
  return mcp(
    new Request(mcpResource(), {
      method: "POST",
      headers: {
        authorization: `Bearer ${access}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-11-25",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "whoami", arguments: {} } }),
    }),
  );
}

async function whoamiUserId(access: string): Promise<string> {
  const res = await whoami(access);
  expect(res.status).toBe(200);
  // A 2025-11-25 call is answered as one SSE event.
  const data = (await res.text()).split("\n").find((line) => line.startsWith("data: "))!;
  const { result } = JSON.parse(data.slice("data: ".length));
  expect(result.isError, result.content[0].text).toBeUndefined();
  return JSON.parse(result.content[0].text).userId;
}

/** Consent and the code exchange, after a wrong verifier is refused: the tokens a connected client holds. */
async function connect(clientId: string, redirectUri: string, clientName: string) {
  const code = await consent(clientId, redirectUri, clientName);
  const exchange = { grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, resource: mcpResource() };
  // PKCE is what makes a stolen code useless; checked before the code is spent.
  const stolen = await tokenCall({ ...exchange, code_verifier: WRONG_VERIFIER });
  expect(stolen.status).toBe(400);
  expect((await stolen.json()).error).toBe("invalid_grant");
  const res = await tokenCall({ ...exchange, code_verifier: VERIFIER });
  expect(res.status).toBe(200);
  const body = await res.json();
  return { access: body.access_token as string, refresh: body.refresh_token as string };
}

const refreshCall = (refresh: string, clientId: string) =>
  tokenCall({ grant_type: "refresh_token", refresh_token: refresh, client_id: clientId, resource: mcpResource() });

describe("connecting through DCR", () => {
  it("registers, consents, exchanges, calls, refreshes and calls again; Disconnect then ends both", async () => {
    const owner = await premiumUser();
    sessionUserId = owner;
    const clientId = await registerByDcr();
    const first = await connect(clientId, DCR_REDIRECT, "Test app");
    sessionUserId = null;
    expect(await whoamiUserId(first.access)).toBe(owner);

    const refreshed = await refreshCall(first.refresh, clientId);
    expect(refreshed.status).toBe(200);
    const second = await refreshed.json();
    expect(await whoamiUserId(second.access_token)).toBe(owner);

    const [grant] = await listGrants(owner);
    expect(await revokeGrant(owner, grant!.id, "owner")).toBe(true);
    const cut = await whoami(second.access_token);
    expect(cut.status).toBe(401);
    expect(cut.headers.get("WWW-Authenticate")).toMatch(/^Bearer resource_metadata="[^"]+\/api\/mcp", error="invalid_token"$/);
    const dead = await refreshCall(second.refresh_token, clientId);
    expect(dead.status).toBe(400);
    expect((await dead.json()).error).toBe("invalid_grant");
  });
});

describe("connecting through a client metadata document", () => {
  it("needs no registration, and calls as the owner", async () => {
    const owner = await premiumUser();
    sessionUserId = owner;
    const { access, refresh } = await connect(CIMD_URL, CIMD_REDIRECT, "Inspector");
    sessionUserId = null;
    expect(await whoamiUserId(access)).toBe(owner);
    expect((await refreshCall(refresh, CIMD_URL)).status).toBe(200);
  });
});

describe("a grant made for another resource", () => {
  // The audience is checked against the grant's own record on every call, not
  // inferred from where the call arrived (amendment C).
  it("is refused on the call with the resource_metadata challenge", async () => {
    const owner = await premiumUser();
    sessionUserId = owner;
    const { access } = await connect(await registerByDcr(), DCR_REDIRECT, "Test app");
    sessionUserId = null;
    const [grant] = await listGrants(owner);
    await db.update(oauthGrants).set({ resource: "https://elsewhere.example/api/mcp" }).where(eq(oauthGrants.id, grant!.id));
    const res = await whoami(access);
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toMatch(/^Bearer resource_metadata="[^"]+", error="invalid_token"$/);
  });
});
