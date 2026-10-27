// **The OAuth actor, through `route()`** (ADR-083 §7), as real HTTP against a
// real database: a `tco_` token resolves only inside an MCP dispatch, honours
// its grant's scopes there, reaches the owner's trips, and lapses and returns
// with the owner's plan exactly as a `tc_` token does.
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ApiScope } from "@tc/contracts";
import { executeTripCommand } from "@/server/commands";
import { allGrantsFor, issueGrant, revokeGrant } from "@/server/entitlements/grants";
import { livePlanVersion } from "@/server/entitlements/planVersions";
import { registerClient, resolveClient } from "@/server/oauth/clients";
import { runInMcpDispatch } from "@/server/oauth/dispatchContext";
import { createGrant, grantOf, issueCode } from "@/server/oauth/grants";
import { mcpResource } from "@/server/oauth/metadata";
import { exchangeCode } from "@/server/oauth/tokens";
import { upsertUser } from "@/server/users";

vi.mock("@/server/auth", () => ({ auth: vi.fn(async () => null) }));

const { GET: ACCOUNT } = await import("@/app/api/v1/account/route");
const { GET: GET_TRIP } = await import("@/app/api/v1/trips/[tripId]/route");

const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const REDIRECT = "https://example.com/cb";

async function entitle(userId: string) {
  const premium = livePlanVersion("premium");
  await issueGrant({
    userId,
    planId: premium.planId,
    planVersion: premium.version,
    source: "admin",
    grantedBy: "dev-operator",
    reason: "M55 OAuth actor fixture.",
    expiresAt: null,
  });
}

async function entitled(): Promise<string> {
  const id = `oauth-actor-${randomUUID().slice(0, 8)}`;
  await upsertUser({ id, email: `${id}@example.test`, name: null, image: null });
  await entitle(id);
  return id;
}

/** Consent, a code and its exchange: the access token a connected client holds. */
async function connect(ownerId: string, scopes: ApiScope[]) {
  const registered = await registerClient({ client_name: "Test app", redirect_uris: [REDIRECT] }, randomUUID());
  const resolved = await resolveClient(registered.ok ? String(registered.body.client_id) : "");
  if (!resolved.ok) throw new Error("no client");
  const now = new Date();
  const grant = await createGrant({ ownerId, client: resolved.client, redirectUri: REDIRECT, scopes, resource: mcpResource(), now });
  const code = await issueCode({ grantId: grant.id, codeChallenge: CHALLENGE, redirectUri: REDIRECT, resource: mcpResource(), now });
  const tokens = await exchangeCode({ code, codeVerifier: VERIFIER, redirectUri: REDIRECT, clientId: resolved.client.clientId }, now);
  if (!tokens.ok) throw new Error(tokens.description);
  return { grantId: grant.id, access: tokens.body.access_token };
}

const bearer = (secret: string) => new Request("http://localhost/x", { headers: { authorization: `Bearer ${secret}` } });
const NO_PARAMS = { params: Promise.resolve({} as Record<string, string>) };
const account = (secret: string) => ACCOUNT(bearer(secret), NO_PARAMS);
const inDispatch = <T>(fn: () => Promise<T>) => runInMcpDispatch(fn);

describe("a tco_ token outside an MCP dispatch", () => {
  // The audience binding: the token is minted for /api/mcp (RFC 8707), and the
  // tools reach the very handlers this calls, so only the dispatch marker
  // tells the two apart.
  it("is 401 on a bare /v1/account call, with the resource_metadata challenge, though it is valid", async () => {
    const { access } = await connect(await entitled(), ["account:read"]);
    const res = await account(access);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthenticated");
    expect(res.headers.get("WWW-Authenticate")).toMatch(
      /^Bearer resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource\/api\/mcp", error="invalid_token"$/,
    );
    expect((await inDispatch(() => account(access))).status).toBe(200);
  });
});

describe("a tco_ token inside an MCP dispatch", () => {
  it("holds its grant's scopes and no others", async () => {
    const owner = await entitled();
    const narrow = await connect(owner, ["trips:read"]);
    const refused = await inDispatch(() => account(narrow.access));
    expect(refused.status).toBe(403);
    expect((await refused.json()).error).toEqual(expect.objectContaining({ code: "insufficient-scope", details: { required: "account:read" } }));

    const wide = await connect(owner, ["account:read"]);
    const allowed = await inDispatch(() => account(wide.access));
    expect(allowed.status).toBe(200);
    expect((await allowed.json()).userId).toBe(owner);
  });

  it("reaches any trip its owner can, and records the grant as used", async () => {
    const owner = await entitled();
    const tripId = randomUUID();
    expect((await executeTripCommand({ type: "CreateTrip", tripId, name: "Kyoto" }, owner)).ok).toBe(true);
    const { grantId, access } = await connect(owner, ["trips:read"]);
    const res = await inDispatch(() => GET_TRIP(bearer(access), { params: Promise.resolve({ tripId }) }));
    expect(res.status).toBe(200);
    await vi.waitFor(async () => expect((await grantOf(grantId))!.lastUsedAt).not.toBeNull());
  });

  // A lapse disables rather than revokes: the grant stays, and the same access
  // token works again once the plan is back, with nothing written to it.
  it("answers 402 while the owner's plan has lapsed, and 200 once they re-subscribe", async () => {
    const owner = await entitled();
    const { access } = await connect(owner, ["account:read"]);
    expect((await inDispatch(() => account(access))).status).toBe(200);

    const [plan] = await allGrantsFor(owner);
    expect(await revokeGrant(plan!.id, "dev-operator")).toBe(true);
    const lapsed = await inDispatch(() => account(access));
    expect(lapsed.status).toBe(402);
    expect((await lapsed.json()).error.code).toBe("not-entitled");
    expect(lapsed.headers.get("WWW-Authenticate")).toMatch(/^Bearer resource_metadata="[^"]+"$/);

    await entitle(owner);
    expect((await inDispatch(() => account(access))).status).toBe(200);
  });
});
