// **The token endpoint's grants**, against a real database, because the two
// races below only exist there: a parallel code redemption and a parallel
// refresh rotation, each of which must have exactly one winner (ADR-083
// amendment D). Each RFC error code is here once, and so is each named attack
// from the 2026-10-27 review: the PKCE downgrade and a lost rotation response.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db/client";
import { oauthCodes, oauthTokens } from "@/server/db/schema";
import { createMemoryClient } from "@/server/cache/memory";
import { createRedisCache } from "@/server/cache/redis";
import type { Fetcher } from "@/server/external/remoteImage/fetchImage";
import { makeTestAgent, publicResolve } from "@/server/poppy/testAgent";
import { keyedDigest } from "@/server/secrets/keyedDigest";
import { registerClient, resolveClient, storeClient, type OAuthClient } from "./clients";
import { createGrant, grantOf, issueCode, mintSecret } from "./grants";
import { mcpResource, oauthIssuer } from "./metadata";
import { exchangeCode, refresh, revokeSecret, type TokenOutcome } from "./tokens";

// The real `storedClientRowId`, behind a gate the race tests close.
const race = vi.hoisted(() => ({ gate: null as { wait: () => Promise<void> } | null }));
vi.mock("./clients", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./clients")>();
  return {
    ...actual,
    storedClientRowId: async (clientId: string) => {
      await race.gate?.wait();
      return actual.storedClientRowId(clientId);
    },
  };
});
afterEach(() => {
  race.gate = null;
});

// RFC 7636 appendix B.
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const REDIRECT = "https://example.com/cb";

async function client(): Promise<OAuthClient> {
  const registered = await registerClient({ client_name: "Test", redirect_uris: [REDIRECT] }, randomUUID());
  if (!registered.ok) throw new Error("registration failed");
  const resolved = await resolveClient(String(registered.body.client_id));
  if (!resolved.ok) throw new Error("resolve failed");
  return resolved.client;
}

/** A consented grant and one fresh code for it, as the consent decision leaves them. */
async function consented(over: { codeChallenge?: string; resource?: string } = {}) {
  const app = await client();
  const now = new Date();
  const grant = await createGrant({
    ownerId: `dev-${randomUUID()}`,
    client: app,
    redirectUri: REDIRECT,
    scopes: ["trips:read", "library:write"],
    resource: over.resource ?? mcpResource(),
    now,
  });
  const code = await issueCode({
    grantId: grant.id,
    codeChallenge: over.codeChallenge ?? CHALLENGE,
    redirectUri: REDIRECT,
    resource: over.resource ?? mcpResource(),
    now,
  });
  const exchange = (input: Partial<Parameters<typeof exchangeCode>[0]> = {}) =>
    exchangeCode({ code, codeVerifier: VERIFIER, redirectUri: REDIRECT, clientId: app.clientId, ...input });
  return { app, grant, code, exchange };
}

/**
 * Hold both calls at `storedClientRowId`, which each reaches after reading its
 * code or token unspent and before the guarded UPDATE, until both are there.
 * The race is then made rather than hoped for: with only a warmed pool, a run
 * where the calls did not overlap passed through the SELECT's own refusal and
 * looked the same. The wait gives up after two seconds, so a call that never
 * arrives fails the `arrived` assertion instead of hanging.
 */
function holdBothAtTheUpdate(): { arrived: () => number } {
  let release = () => {};
  const open = new Promise<void>((done) => {
    release = done;
  });
  const gate = { arrived: 0, wait: async () => {} };
  gate.wait = async () => {
    gate.arrived += 1;
    if (gate.arrived === 2) release();
    await Promise.race([open, new Promise((done) => setTimeout(done, 2_000))]);
  };
  race.gate = gate;
  return { arrived: () => gate.arrived };
}

const errorOf = (outcome: TokenOutcome) => (outcome.ok ? "ok" : outcome.error);
const tokensOf = (outcome: TokenOutcome) => {
  if (!outcome.ok) throw new Error(`expected tokens, got ${outcome.error}: ${outcome.description}`);
  return outcome.body;
};

describe("exchanging a code", () => {
  it("answers an access token, a refresh token and the grant's scopes, and stores neither secret", async () => {
    const { exchange, grant } = await consented();
    const body = tokensOf(await exchange());
    expect(body).toEqual(
      expect.objectContaining({ token_type: "Bearer", expires_in: 3600, scope: "trips:read library:write" }),
    );
    expect(body.access_token.startsWith("tco_")).toBe(true);
    expect(body.refresh_token.startsWith("tcr_")).toBe(true);
    const rows = await db.select().from(oauthTokens).where(eq(oauthTokens.grantId, grant.id));
    expect(rows.map((row) => row.tokenHash).sort()).toEqual(
      [keyedDigest(body.access_token).digest, keyedDigest(body.refresh_token).digest].sort(),
    );
    expect(rows.every((row) => row.keyVersion === keyedDigest(body.access_token).keyVersion)).toBe(true);
  });

  it("answers invalid_request without a code, a redirect_uri or a client_id", async () => {
    const { exchange } = await consented();
    expect(errorOf(await exchange({ code: undefined }))).toBe("invalid_request");
    expect(errorOf(await exchange({ redirectUri: undefined }))).toBe("invalid_request");
    expect(errorOf(await exchange({ clientId: undefined }))).toBe("invalid_request");
  });

  it("answers invalid_grant for a wrong redirect, another client, or an unknown code", async () => {
    const { exchange } = await consented();
    const other = await client();
    expect(errorOf(await exchange({ redirectUri: `${REDIRECT}/` }))).toBe("invalid_grant");
    expect(errorOf(await exchange({ clientId: other.clientId }))).toBe("invalid_grant");
    expect(errorOf(await exchange({ code: mintSecret("tcc_") }))).toBe("invalid_grant");
    // None of those spent it.
    expect(errorOf(await exchange())).toBe("ok");
  });

  it("answers invalid_target for a resource that is not this server's, at exchange and on the grant", async () => {
    const { exchange } = await consented();
    expect(errorOf(await exchange({ resource: "https://other.example/api/mcp" }))).toBe("invalid_target");
    const stale = await consented({ resource: "https://old-origin.example/api/mcp" });
    expect(errorOf(await stale.exchange())).toBe("invalid_target");
  });

  it("revokes the grant when a code is presented a second time", async () => {
    const { exchange, grant } = await consented();
    expect(errorOf(await exchange())).toBe("ok");
    expect(errorOf(await exchange())).toBe("invalid_grant");
    expect(await grantOf(grant.id)).toEqual(expect.objectContaining({ revokedReason: "code-reuse" }));
  });
});

describe("parallel code redemption", () => {
  it("lets exactly one of two simultaneous exchanges win, and revokes the grant", async () => {
    const { exchange, grant } = await consented();
    const held = holdBothAtTheUpdate();
    const outcomes = await Promise.all([exchange(), exchange()]);
    expect(held.arrived(), "both calls read the code unspent").toBe(2);
    expect(outcomes.map(errorOf).sort()).toEqual(["invalid_grant", "ok"]);
    expect(await grantOf(grant.id)).toEqual(expect.objectContaining({ revokedReason: "code-reuse" }));
  });
});

describe("the PKCE downgrade at the token endpoint", () => {
  it("refuses a normal code with no code_verifier, or the wrong one", async () => {
    const { exchange } = await consented();
    expect(errorOf(await exchange({ codeVerifier: undefined }))).toBe("invalid_grant");
    expect(errorOf(await exchange({ codeVerifier: `${VERIFIER.slice(0, -1)}A` }))).toBe("invalid_grant");
  });

  // The column is NOT NULL (amendment I), so an empty challenge is the nearest
  // a row can come to none: what a bug, or a hand-written row, would leave.
  it("never redeems a code row written with no challenge, with or without a verifier", async () => {
    const { exchange, code } = await consented();
    await db.update(oauthCodes).set({ codeChallenge: "" }).where(eq(oauthCodes.codeHash, keyedDigest(code).digest));
    expect(errorOf(await exchange({ codeVerifier: undefined }))).toBe("invalid_grant");
    expect(errorOf(await exchange())).toBe("invalid_grant");
  });
});

describe("refreshing", () => {
  it("rotates: a new pair, and the old refresh token is spent", async () => {
    const { exchange, app } = await consented();
    const first = tokensOf(await exchange());
    const second = tokensOf(await refresh({ refreshToken: first.refresh_token, clientId: app.clientId }));
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(errorOf(await refresh({ refreshToken: second.refresh_token, clientId: app.clientId }))).toBe("ok");
  });

  it("answers invalid_request without a token or a client_id", async () => {
    const { app } = await consented();
    expect(errorOf(await refresh({ clientId: app.clientId }))).toBe("invalid_request");
    expect(errorOf(await refresh({ refreshToken: "tcr_x" }))).toBe("invalid_request");
  });

  it("answers invalid_grant for an access token presented as a refresh token, or another client", async () => {
    const { exchange, app } = await consented();
    const body = tokensOf(await exchange());
    const other = await client();
    expect(errorOf(await refresh({ refreshToken: body.access_token, clientId: app.clientId }))).toBe("invalid_grant");
    expect(errorOf(await refresh({ refreshToken: body.refresh_token, clientId: other.clientId }))).toBe("invalid_grant");
  });

  // Amendment K: the documented cost of rotation with no grace window.
  it("revokes the grant when a lost rotation response makes the client present the old refresh token", async () => {
    const { exchange, app, grant } = await consented();
    const first = tokensOf(await exchange());
    tokensOf(await refresh({ refreshToken: first.refresh_token, clientId: app.clientId }));
    expect(errorOf(await refresh({ refreshToken: first.refresh_token, clientId: app.clientId }))).toBe("invalid_grant");
    expect(await grantOf(grant.id)).toEqual(expect.objectContaining({ revokedReason: "refresh-reuse" }));
  });
});

describe("parallel refresh rotation", () => {
  it("lets exactly one of two simultaneous refreshes win, and revokes the grant", async () => {
    const { exchange, app, grant } = await consented();
    const { refresh_token } = tokensOf(await exchange());
    const held = holdBothAtTheUpdate();
    const outcomes = await Promise.all([
      refresh({ refreshToken: refresh_token, clientId: app.clientId }),
      refresh({ refreshToken: refresh_token, clientId: app.clientId }),
    ]);
    expect(held.arrived(), "both calls read the token unrotated").toBe(2);
    expect(outcomes.map(errorOf).sort()).toEqual(["invalid_grant", "ok"]);
    expect(await grantOf(grant.id)).toEqual(expect.objectContaining({ revokedReason: "refresh-reuse" }));
  });
});

describe("revoking", () => {
  it("takes the grant with a refresh token, so nothing refreshes after", async () => {
    const { exchange, app, grant } = await consented();
    const body = tokensOf(await exchange());
    await revokeSecret(body.refresh_token);
    expect(await grantOf(grant.id)).toEqual(expect.objectContaining({ revokedReason: "owner" }));
    expect(errorOf(await refresh({ refreshToken: body.refresh_token, clientId: app.clientId }))).toBe("invalid_grant");
  });

  it("takes only itself with an access token, and ignores a secret it does not know", async () => {
    const { exchange, grant } = await consented();
    const body = tokensOf(await exchange());
    await revokeSecret(body.access_token);
    await revokeSecret("tco_not-a-real-token");
    const [access] = await db
      .select()
      .from(oauthTokens)
      .where(eq(oauthTokens.tokenHash, keyedDigest(body.access_token).digest));
    expect(access!.revokedAt).not.toBeNull();
    expect((await grantOf(grant.id))!.revokedAt).toBeNull();
  });
});

// **A Personal Agent signs in as itself** (Poppy 4.1, 4.2, 4.4, 4.6): a CIMD
// client whose document says `private_key_jwt` is only itself with an
// assertion, at the code exchange, at refresh and at revocation.
const ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

async function agentConsented(document?: Record<string, unknown>) {
  const agent = await makeTestAgent({ issuer: oauthIssuer(), document });
  const ownerId = `dev-${randomUUID()}`;
  // One cache per agent: a `jti` is spent in it, as in the shared one.
  const deps = { fetch: agent.fetch, resolve: publicResolve, userId: ownerId, cache: createRedisCache(createMemoryClient()) };
  const resolved = await resolveClient(agent.clientId, deps);
  if (!resolved.ok) throw new Error(`agent did not resolve: ${JSON.stringify(resolved)}`);
  const now = new Date();
  const grant = await createGrant({
    ownerId,
    client: resolved.client,
    redirectUri: String(agent.document.redirect_uris && (agent.document.redirect_uris as string[])[0]),
    scopes: ["trips:read"],
    resource: mcpResource(),
    now,
  });
  const redirectUri = grant.redirectUri;
  const code = async () =>
    issueCode({ grantId: grant.id, codeChallenge: CHALLENGE, redirectUri, resource: mcpResource(), now });
  const signed = async () => ({ clientAssertion: await agent.assertion(), clientAssertionType: ASSERTION_TYPE });
  const exchange = async (over: Partial<Parameters<typeof exchangeCode>[0]> = {}) =>
    exchangeCode(
      { code: await code(), codeVerifier: VERIFIER, redirectUri, clientId: agent.clientId, ...over },
      new Date(),
      deps,
    );
  return { agent, deps, grant, signed, exchange, redirectUri };
}

describe("a private_key_jwt client", () => {
  it("is refused at the code exchange without an assertion, and with one that is not its own", async () => {
    const { exchange, signed, agent } = await agentConsented();
    expect(errorOf(await exchange())).toBe("invalid_client");
    const stranger = await makeTestAgent({ issuer: oauthIssuer(), host: new URL(agent.clientId).host });
    const forged = { clientAssertion: await stranger.assertion(), clientAssertionType: ASSERTION_TYPE };
    expect(errorOf(await exchange(forged))).toBe("invalid_client");
    // A refusal spends nothing: the same client, signed properly, gets in.
    expect(errorOf(await exchange(await signed()))).toBe("ok");
  });

  it("is refused at refresh without an assertion, and an assertion works once", async () => {
    const { exchange, signed, agent, deps } = await agentConsented();
    const { refresh_token } = tokensOf(await exchange(await signed()));
    const again = (over: Partial<Parameters<typeof refresh>[0]> = {}) =>
      refresh({ refreshToken: refresh_token, clientId: agent.clientId, ...over }, new Date(), deps);
    expect(errorOf(await again())).toBe("invalid_client");
    const once = await signed();
    const rotated = tokensOf(await again(once));
    // The same assertion again, for the new token: a `jti` is single-use (RFC 7523).
    expect(errorOf(await again({ ...once, refreshToken: rotated.refresh_token }))).toBe("invalid_client");
  });

  // The kit's validator sends a made-up refresh token (and a made-up code) with the
  // assertion under test, and reads `invalid_grant` as "the assertion was accepted".
  it("is authenticated before any code or refresh token is looked up", async () => {
    const { agent, deps, signed } = await agentConsented();
    const stranger = await makeTestAgent({ issuer: oauthIssuer(), host: new URL(agent.clientId).host });
    const forged = { clientAssertion: await stranger.assertion(), clientAssertionType: ASSERTION_TYPE };
    const madeUp = (over: Partial<Parameters<typeof refresh>[0]>) =>
      refresh({ refreshToken: mintSecret("tcr_"), clientId: agent.clientId, ...over }, new Date(), deps);
    expect(errorOf(await madeUp(forged))).toBe("invalid_client");
    const code = (over: Partial<Parameters<typeof exchangeCode>[0]>) =>
      exchangeCode({ code: mintSecret("tcc_"), codeVerifier: VERIFIER, redirectUri: REDIRECT, clientId: agent.clientId, ...over }, new Date(), deps);
    expect(errorOf(await code(forged))).toBe("invalid_client");
    // The control: a good assertion gets past authentication to the token it does not find.
    expect(errorOf(await madeUp(await signed()))).toBe("invalid_grant");
  });

  it("is not signed out by a copied refresh token that has been rotated, presented without an assertion", async () => {
    const { exchange, signed, agent, deps, grant } = await agentConsented();
    const { refresh_token } = tokensOf(await exchange(await signed()));
    await refresh({ refreshToken: refresh_token, clientId: agent.clientId, ...(await signed()) }, new Date(), deps);
    const replay = await refresh({ refreshToken: refresh_token, clientId: agent.clientId }, new Date(), deps);
    expect(errorOf(replay)).toBe("invalid_client");
    expect((await grantOf(grant.id))!.revokedAt).toBeNull();
    // The agent itself presenting the old token is reuse, and cuts the grant off.
    const own = await refresh({ refreshToken: refresh_token, clientId: agent.clientId, ...(await signed()) }, new Date(), deps);
    expect(errorOf(own)).toBe("invalid_grant");
    expect((await grantOf(grant.id))!.revokedAt).not.toBeNull();
  });

  // Only authorize creates an `oauth_clients` row, under its own quota. A client_id with
  // none is answered without a fetch, so no address can spend a pool by inventing URLs.
  it("fetches nothing for a client_id that names no stored client, from any number of requests, and a known agent still connects", async () => {
    const { exchange, signed, deps } = await agentConsented();
    const fetch = vi.fn<Fetcher>(async () => new Response("{}", { status: 200 }));
    const cold = { ...deps, fetch, cache: createRedisCache(createMemoryClient()) };
    const junk = { clientAssertion: "a.b.c", clientAssertionType: ASSERTION_TYPE };
    for (let sent = 0; sent < 320; sent += 1) {
      const clientId = `https://made-up-${sent}.example.test/client.json`;
      const outcome = await refresh({ refreshToken: mintSecret("tcr_"), clientId, callerIp: "198.51.100.7", ...junk }, new Date(), cold);
      expect(errorOf(outcome)).toBe("invalid_client");
    }
    expect(fetch).not.toHaveBeenCalled();
    // The first code exchange of an agent whose key set is not cached yet needs a fetch of its own.
    expect(errorOf(await exchange(await signed()))).toBe("ok");
  });

  it("charges the fetches made before a grant is known to the caller's address, not to a client_id it names", async () => {
    const { exchange, signed, agent, deps } = await agentConsented();
    let token = tokensOf(await exchange(await signed())).refresh_token;
    vi.stubEnv("OAUTH_SIGNED_OUT_FETCH_RATE_LIMIT_PER_CALLER_HOURLY", "2");
    try {
      const noisy = randomUUID();
      const quiet = randomUUID();
      // Ten minutes apart, so the cached document and key set are stale each time and want a fetch (two units).
      const refreshAs = async (callerIp: string, minutes: number) => {
        const now = new Date(Date.now() + minutes * 60_000);
        const second = Math.floor(now.getTime() / 1000);
        const clientAssertion = await agent.assertion({ iat: second - 10, exp: second + 50 });
        const outcome = await refresh({ refreshToken: token, clientId: agent.clientId, callerIp, clientAssertion, clientAssertionType: ASSERTION_TYPE }, now, deps);
        if (outcome.ok) token = outcome.body.refresh_token;
        return errorOf(outcome);
      };
      expect(await refreshAs(noisy, 10)).toBe("ok");
      expect(await refreshAs(noisy, 20)).toBe("invalid_client");
      expect(await refreshAs(quiet, 20)).toBe("ok");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // The key set is a fallback for a host that is down, never for one that answered.
  describe("a key the agent has removed", () => {
    const later = (minutes: number) => {
      const now = new Date(Date.now() + minutes * 60_000);
      return { now, second: Math.floor(now.getTime() / 1000) };
    };
    /** The agent signs with its old key, `minutes` on, while its key-set URL answers `jwks`. */
    async function oldKeyAfter(minutes: number, jwks: () => Promise<Response>) {
      const { exchange, signed, agent, deps } = await agentConsented();
      const { refresh_token } = tokensOf(await exchange(await signed()));
      const { now, second } = later(minutes);
      const clientAssertion = await agent.assertion({ iat: second - 10, exp: second + 50 });
      const fetch: Fetcher = (url, init) => (url.href === agent.jwksUri ? jwks() : agent.fetch(url, init));
      return errorOf(
        await refresh({ refreshToken: refresh_token, clientId: agent.clientId, clientAssertion, clientAssertionType: ASSERTION_TYPE }, now, { ...deps, fetch }),
      );
    }

    it("is refused once its key-set URL serves a set without it, or answers 404 or 410", async () => {
      const successor = await makeTestAgent({ issuer: oauthIssuer() });
      expect(await oldKeyAfter(10, async () => new Response(JSON.stringify(successor.jwks), { status: 200 }))).toBe("invalid_client");
      expect(await oldKeyAfter(10, async () => new Response("", { status: 404 }))).toBe("invalid_client");
      expect(await oldKeyAfter(10, async () => new Response("", { status: 410 }))).toBe("invalid_client");
    });

    it("is still accepted while the host is down, for a day and no longer", async () => {
      expect(await oldKeyAfter(10, async () => new Response("", { status: 503 }))).toBe("ok");
      expect(await oldKeyAfter(10, async () => Promise.reject(new TypeError("connection refused")))).toBe("ok");
      expect(await oldKeyAfter(23 * 60, async () => new Response("", { status: 503 }))).toBe("ok");
      expect(await oldKeyAfter(25 * 60, async () => new Response("", { status: 503 }))).toBe("invalid_client");
    });
  });

  // Poppy 4.4: a grant that was a Personal Agent's is only that agent with its assertion.
  it("still wants an assertion for a grant stored as private_key_jwt after the document says none", async () => {
    const { exchange, signed, agent, deps } = await agentConsented();
    const { refresh_token } = tokensOf(await exchange(await signed()));
    const downgraded = { ...agent.document, token_endpoint_auth_method: "none" };
    const fetch: Fetcher = async (url, init) =>
      url.href === agent.clientId ? new Response(JSON.stringify(downgraded), { status: 200 }) : agent.fetch(url, init);
    const cold = { ...deps, fetch, cache: createRedisCache(createMemoryClient()) };
    expect(errorOf(await refresh({ refreshToken: refresh_token, clientId: agent.clientId }, new Date(), cold))).toBe("invalid_client");
    // A made-up assertion does not stand in for one: the document no longer asks for it, the grant does.
    const junk = { clientAssertion: "a.b.c", clientAssertionType: ASSERTION_TYPE };
    expect(errorOf(await refresh({ refreshToken: refresh_token, clientId: agent.clientId, ...junk }, new Date(), cold))).toBe("invalid_client");
  });

  it("leaves the grant live when a rotated refresh token is presented under another client_id", async () => {
    const { exchange, signed, agent, deps, grant } = await agentConsented();
    const { refresh_token } = tokensOf(await exchange(await signed()));
    await refresh({ refreshToken: refresh_token, clientId: agent.clientId, ...(await signed()) }, new Date(), deps);
    // A thief's own agent, signing properly as itself.
    const thief = await makeTestAgent({ issuer: oauthIssuer() });
    // A thief's agent has been allowed by someone, or its assertion is refused before any token is looked at.
    const thiefsClient = await resolveClient(thief.clientId, { fetch: thief.fetch, resolve: publicResolve, userId: `dev-${randomUUID()}`, cache: createRedisCache(createMemoryClient()) });
    if (!thiefsClient.ok) throw new Error("thief's agent did not resolve");
    await storeClient(thiefsClient.client, new Date());
    const both = {
      ...deps,
      fetch: ((url, init) => (url.host === new URL(thief.clientId).host ? thief.fetch(url, init) : agent.fetch(url, init))) as Fetcher,
    };
    const signedAsThief = { clientAssertion: await thief.assertion(), clientAssertionType: ASSERTION_TYPE };
    for (const as of [{ clientId: "x" }, { clientId: thief.clientId, ...signedAsThief }]) {
      const replay = await refresh({ refreshToken: refresh_token, ...as }, new Date(), both);
      expect(errorOf(replay)).toBe("invalid_grant");
      expect((await grantOf(grant.id))!.revokedAt).toBeNull();
    }
  });

  it("is read again, at most once a minute, when its assertion names a key not yet cached", async () => {
    const { exchange, signed, agent, deps } = await agentConsented();
    const { refresh_token } = tokensOf(await exchange(await signed()));
    const at = (seconds: number) => {
      const now = new Date(Date.now() + seconds * 1000);
      const second = Math.floor(now.getTime() / 1000);
      return { now, over: { alg: "PS384", iat: second - 10, exp: second + 50 } };
    };
    const rotatedIn = async (seconds: number) => {
      const { now, over } = at(seconds);
      const assertion = await agent.assertion(over);
      return refresh({ refreshToken: refresh_token, clientId: agent.clientId, clientAssertion: assertion, clientAssertionType: ASSERTION_TYPE }, now, deps);
    };
    expect(errorOf(await rotatedIn(20))).toBe("invalid_client");
    expect(errorOf(await rotatedIn(120))).toBe("ok");
  });

  it("is refused a scope beyond what the grant holds, and a refusal rotates nothing", async () => {
    const { exchange, signed, agent, deps } = await agentConsented();
    const { refresh_token } = tokensOf(await exchange(await signed()));
    const again = async (scope: string) =>
      refresh({ refreshToken: refresh_token, clientId: agent.clientId, scope, ...(await signed()) }, new Date(), deps);
    expect(errorOf(await again("trips:read library:write"))).toBe("invalid_scope");
    expect(errorOf(await again("no:such"))).toBe("invalid_scope");
    expect(errorOf(await again("trips:read"))).toBe("ok");
  });

  it("is not signed out by a revocation that carries no assertion", async () => {
    const { exchange, signed, agent, deps, grant } = await agentConsented();
    const { refresh_token } = tokensOf(await exchange(await signed()));
    expect(await revokeSecret(refresh_token, new Date(), {}, deps)).toMatchObject({ ok: true });
    expect((await grantOf(grant.id))!.revokedAt).toBeNull();
    expect(await revokeSecret(refresh_token, new Date(), { clientId: agent.clientId }, deps)).toMatchObject({ ok: false });
    expect((await grantOf(grant.id))!.revokedAt).toBeNull();
    expect(await revokeSecret(refresh_token, new Date(), { clientId: agent.clientId, ...(await signed()) }, deps)).toEqual({ ok: true });
    expect(await grantOf(grant.id)).toEqual(expect.objectContaining({ revokedReason: "owner" }));
  });
});

// A public CIMD client (`none`) is served as it was before Personal Agents: the
// token endpoint does not read its document again, so a host that is down, or a
// spent fetch quota, cannot sign people out of Claude Code.
describe("a public CIMD client", () => {
  const publicAgent = () => agentConsented({ token_endpoint_auth_method: "none", jwks_uri: undefined });
  const down = vi.fn<Fetcher>(async () => new Response("", { status: 503 }));
  const later = () => new Date(Date.now() + 10 * 60 * 1000);

  it("refreshes while its document cannot be fetched", async () => {
    const { exchange, agent, deps } = await publicAgent();
    const { refresh_token } = tokensOf(await exchange());
    // A cache that knows nothing of the exchange: what is stored on the grant, not remembered, says it is public.
    const outcome = await refresh(
      { refreshToken: refresh_token, clientId: agent.clientId },
      later(),
      { ...deps, fetch: down, cache: createRedisCache(createMemoryClient()) },
    );
    expect(errorOf(outcome)).toBe("ok");
  });

  it("is revoked by a request that names no client, with nothing cached and its document down", async () => {
    const { exchange, deps, grant } = await publicAgent();
    const { refresh_token } = tokensOf(await exchange());
    const cold = { ...deps, fetch: down, cache: createRedisCache(createMemoryClient()) };
    expect(await revokeSecret(refresh_token, new Date(), {}, cold)).toEqual({ ok: true });
    expect(await grantOf(grant.id)).toEqual(expect.objectContaining({ revokedReason: "owner" }));
  });

  it("is not held to the grant's exact scope on refresh, as before", async () => {
    const { exchange, agent, deps } = await publicAgent();
    const { refresh_token } = tokensOf(await exchange());
    const outcome = await refresh({ refreshToken: refresh_token, clientId: agent.clientId, scope: "trips:read library:write" }, new Date(), deps);
    expect(errorOf(outcome)).toBe("ok");
  });
});

describe("revoking a private_key_jwt client's token", () => {
  const spying = (fetch: Fetcher) => vi.fn<Fetcher>(fetch);

  it("fetches nothing for a client_id that is not the grant's", async () => {
    const { exchange, signed, deps, grant } = await agentConsented();
    const { refresh_token } = tokensOf(await exchange(await signed()));
    const fetch = spying(async () => new Response("{}", { status: 200 }));
    const outcome = await revokeSecret(
      refresh_token,
      new Date(),
      { clientId: `https://other-${randomUUID()}.test/client.json` },
      { ...deps, fetch, cache: createRedisCache(createMemoryClient()) },
    );
    expect(outcome).toEqual({ ok: true });
    expect(fetch).not.toHaveBeenCalled();
    expect((await grantOf(grant.id))!.revokedAt).toBeNull();
  });

  it("leaves the grant live when the document cannot be read and the request does not sign", async () => {
    const { exchange, signed, deps, grant } = await agentConsented();
    const { refresh_token } = tokensOf(await exchange(await signed()));
    const fetch = spying(async () => new Response("", { status: 503 }));
    expect(await revokeSecret(refresh_token, new Date(), {}, { ...deps, fetch, cache: createRedisCache(createMemoryClient()) })).toEqual({ ok: true });
    expect((await grantOf(grant.id))!.revokedAt).toBeNull();
  });
});
