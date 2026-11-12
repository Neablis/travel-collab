// **`POST /api/oauth/token`**, as a client calls it: form-encoded, against a
// real database. The grants' own refusals are `tokens.int.test.ts`'s; this is
// the wire: the body format, the grant types, and the RFC 6749 §5 answer shape.
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { registerClient, resolveClient } from "@/server/oauth/clients";
import { createGrant, issueCode } from "@/server/oauth/grants";
import { mcpResource } from "@/server/oauth/metadata";
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

// A switch for the store-failure test: `refresh` throws as `grantOf` did in
// production while migration 0075 was pending (KI-2026-11-11-a).
const store = vi.hoisted(() => ({ fail: false }));
vi.mock("@/server/oauth/tokens", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/oauth/tokens")>();
  return {
    ...real,
    refresh: (...args: Parameters<typeof real.refresh>) => {
      if (store.fail) throw new Error('column "token_endpoint_auth_method" does not exist');
      return real.refresh(...args);
    },
  };
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

const form = (fields: Record<string, string>, type = "application/x-www-form-urlencoded") =>
  POST(
    new Request("http://localhost/api/oauth/token", {
      method: "POST",
      headers: { "content-type": type },
      body: new URLSearchParams(fields).toString(),
    }),
  );

async function freshCode(): Promise<{ code: string; clientId: string }> {
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
  return { code, clientId: resolved.client.clientId };
}

describe("POST /api/oauth/token", () => {
  it("answers 503 temporarily_unavailable with a JSON body and Retry-After when the store throws, never an empty 500", async () => {
    store.fail = true;
    try {
      const res = await form({ grant_type: "refresh_token", refresh_token: "tc_oauth_r_x", client_id: randomUUID() });
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("30");
      expect(await res.json()).toEqual(expect.objectContaining({ error: "temporarily_unavailable" }));
    } finally {
      store.fail = false;
    }
  });

  it("exchanges a code and then refreshes, each answer uncacheable", async () => {
    const { code, clientId } = await freshCode();
    const exchanged = await form({
      grant_type: "authorization_code",
      code,
      code_verifier: VERIFIER,
      redirect_uri: REDIRECT,
      client_id: clientId,
      resource: mcpResource(),
    });
    expect(exchanged.status).toBe(200);
    expect(exchanged.headers.get("cache-control")).toBe("no-store");
    const body = await exchanged.json();
    expect(body).toEqual(expect.objectContaining({ token_type: "Bearer", scope: "trips:read" }));
    const refreshed = await form({ grant_type: "refresh_token", refresh_token: body.refresh_token, client_id: clientId });
    expect(refreshed.status).toBe(200);
  });

  it("answers unsupported_grant_type for any other grant", async () => {
    const res = await form({ grant_type: "client_credentials" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(expect.objectContaining({ error: "unsupported_grant_type" }));
  });

  // Each body below would get a different answer if its check were missing:
  // read as a form anyway, or by its first value, it names an unsupported grant.
  it("answers invalid_request for a body not sent as a form, for no grant_type, and for a repeated parameter", async () => {
    const notAForm = await form({ grant_type: "client_credentials" }, "application/json");
    expect((await notAForm.json()).error).toBe("invalid_request");
    expect((await (await form({})).json()).error).toBe("invalid_request");
    const repeated = await POST(
      new Request("http://localhost/api/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials&grant_type=authorization_code",
      }),
    );
    expect((await repeated.json()).error).toBe("invalid_request");
  });

  it("answers invalid_grant with RFC 6749's error body for a code that does not verify", async () => {
    const { code, clientId } = await freshCode();
    const res = await form({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_grant", error_description: expect.any(String) });
  });
});

describe("POST /api/oauth/token for a Personal Agent", () => {
  it("answers 401 invalid_client without its client_assertion, and 200 with one", async () => {
    const { agent, code, redirectUri } = await agentGrant();
    const fields = { grant_type: "authorization_code", code, code_verifier: VERIFIER, redirect_uri: redirectUri, client_id: agent.clientId };
    const refused = await form(fields);
    expect(refused.status).toBe(401);
    expect(await refused.json()).toMatchObject({ error: "invalid_client" });
    const accepted = await form({
      ...fields,
      client_assertion: await agent.assertion(),
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    });
    expect(accepted.status).toBe(200);
  });
});

