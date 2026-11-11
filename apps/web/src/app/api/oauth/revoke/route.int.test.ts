// **`POST /api/oauth/revoke`** (RFC 7009): 200 whatever is sent, and a real
// refresh token stops refreshing.
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { registerClient, resolveClient } from "@/server/oauth/clients";
import { createGrant, grantOf, issueCode } from "@/server/oauth/grants";
import { mcpResource } from "@/server/oauth/metadata";
import { CLIENT_ASSERTION_TYPE, exchangeCode } from "@/server/oauth/tokens";
import { makeTestAgent, publicResolve } from "@/server/poppy/testAgent";
import { fetchClientKeys } from "@/server/oauth/clients";
import { oauthIssuer } from "@/server/oauth/metadata";
import { POST } from "./route";

// A Personal Agent's documents come from the shared cache here, as they do for
// five minutes in production, so the real route runs with no network.
const shared = vi.hoisted(() => ({ cache: null as null | import("@/server/cache/redis").CachePort }));
vi.mock("@/server/cache/redis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/cache/redis")>();
  shared.cache = actual.createRedisCache((await import("@/server/cache/memory")).createMemoryClient());
  return { ...actual, getCache: () => shared.cache! };
});

async function agentGrant() {
  const agent = await makeTestAgent({ issuer: oauthIssuer() });
  const ownerId = `dev-${randomUUID()}`;
  const resolved = await resolveClient(agent.clientId, { fetch: agent.fetch, resolve: publicResolve, userId: ownerId });
  if (!resolved.ok) throw new Error("agent did not resolve");
  // The key set is read the same way once, which puts it in the cache too.
  await fetchClientKeys(resolved.client, { fetch: agent.fetch, resolve: publicResolve, userId: ownerId });
  const now = new Date();
  const redirectUri = (agent.document.redirect_uris as string[])[0]!;
  const grant = await createGrant({ ownerId, client: resolved.client, redirectUri, scopes: ["trips:read"], resource: mcpResource(), now });
  const code = await issueCode({ grantId: grant.id, codeChallenge: CHALLENGE, redirectUri, resource: mcpResource(), now });
  return { agent, grant, code, redirectUri };
}


const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const REDIRECT = "https://example.com/cb";

const revoke = (body: string) =>
  POST(
    new Request("http://localhost/api/oauth/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    }),
  );

describe("POST /api/oauth/revoke", () => {
  it("answers 200 for an unknown token, a malformed one and none at all", async () => {
    for (const body of ["token=tcr_not-real", "token=whatever", ""]) {
      expect((await revoke(body)).status).toBe(200);
    }
  });

  it("revokes a real refresh token's grant", async () => {
    const registered = await registerClient({ redirect_uris: [REDIRECT] }, randomUUID());
    const resolved = await resolveClient(registered.ok ? String(registered.body.client_id) : "");
    if (!resolved.ok) throw new Error("no client");
    const now = new Date();
    const grant = await createGrant({
      ownerId: `dev-${randomUUID()}`,
      client: resolved.client,
      redirectUri: REDIRECT,
      scopes: ["trips:read"],
      resource: mcpResource(),
      now,
    });
    const code = await issueCode({ grantId: grant.id, codeChallenge: CHALLENGE, redirectUri: REDIRECT, resource: mcpResource(), now });
    const outcome = await exchangeCode({ code, codeVerifier: VERIFIER, redirectUri: REDIRECT, clientId: resolved.client.clientId });
    if (!outcome.ok) throw new Error(outcome.description);
    expect((await revoke(`token=${outcome.body.refresh_token}&token_type_hint=refresh_token`)).status).toBe(200);
    expect((await grantOf(grant.id))!.revokedAt).not.toBeNull();
  });
});

describe("POST /api/oauth/revoke for a Personal Agent", () => {
  it("answers 401 to a client that does not sign, and revokes for one that does", async () => {
    const { agent, grant, code, redirectUri } = await agentGrant();
    const tokens = await exchangeCode(
      {
        code,
        codeVerifier: VERIFIER,
        redirectUri,
        clientId: agent.clientId,
        clientAssertion: await agent.assertion(),
        clientAssertionType: CLIENT_ASSERTION_TYPE,
      },
      new Date(),
      { cache: shared.cache! },
    );
    if (!tokens.ok) throw new Error(tokens.description);
    const named = `token=${tokens.body.refresh_token}&client_id=${encodeURIComponent(agent.clientId)}`;
    const refused = await revoke(named);
    expect(refused.status).toBe(401);
    expect((await grantOf(grant.id))!.revokedAt).toBeNull();
    const assertion = encodeURIComponent(await agent.assertion());
    const accepted = await revoke(`${named}&client_assertion_type=${encodeURIComponent(CLIENT_ASSERTION_TYPE)}&client_assertion=${assertion}`);
    expect(accepted.status).toBe(200);
    expect((await grantOf(grant.id))!.revokedAt).not.toBeNull();
  });

  it("revokes for an assertion that names the client and leaves client_id out, and refuses one that names nobody", async () => {
    const { agent, grant, code, redirectUri } = await agentGrant();
    const sign = async () => ({ clientAssertion: await agent.assertion(), clientAssertionType: CLIENT_ASSERTION_TYPE });
    const tokens = await exchangeCode(
      { code, codeVerifier: VERIFIER, redirectUri, clientId: agent.clientId, ...(await sign()) },
      new Date(),
      { cache: shared.cache! },
    );
    if (!tokens.ok) throw new Error(tokens.description);
    const form = async (assertion?: string) =>
      `token=${tokens.body.refresh_token}&client_assertion_type=${encodeURIComponent(CLIENT_ASSERTION_TYPE)}&client_assertion=${encodeURIComponent(assertion ?? (await sign()).clientAssertion)}`;
    // An assertion nobody can read is never a quiet 200 that revoked nothing.
    expect((await revoke(await form("not-a-jwt"))).status).toBe(401);
    expect((await grantOf(grant.id))!.revokedAt).toBeNull();
    expect((await revoke(await form())).status).toBe(200);
    expect((await grantOf(grant.id))!.revokedAt).not.toBeNull();
  });
});
