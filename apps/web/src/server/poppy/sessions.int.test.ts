// **A Personal Agent's Session** (Poppy 5.3 step 4, 5.4, 5.5), against a real
// database: the row the first verified request writes, the 30 days that end
// it, the account it may not change, and `poppyGate`, which is what `route()`
// and `/api/mcp` call for a request that carries the header.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { createMemoryClient } from "@/server/cache/memory";
import { createRedisCache } from "@/server/cache/redis";
import { db } from "@/server/db/client";
import { agentSessions } from "@/server/db/schema";
import { resolveClient } from "@/server/oauth/clients";
import { createGrant, issueCode } from "@/server/oauth/grants";
import { mcpResource, oauthIssuer } from "@/server/oauth/metadata";
import { exchangeCode } from "@/server/oauth/tokens";
import { connectForTest } from "@/server/test-support/oauthConnection";
import { upsertUser } from "@/server/users";
import { openOrContinueSession, poppyGate, SESSION_IDLE_MS } from "./sessions";
import { publicResolve, makeTestAgent } from "./testAgent";

// `poppyGate` reads the bearer through `actor.ts`, which imports the session auth.
vi.mock("@/server/auth", () => ({ auth: vi.fn(async () => null) }));

const CLAIMS = { clientId: "https://agent.test/agent.json", sid: "sid-1", userId: "usr_1", agentId: null as string | null };
const T0 = new Date("2026-11-09T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const DAY = 24 * 60 * 60 * 1000;

/** Claims no other test shares, since the table keeps one row per (client, sid, user). */
const fresh = (over: Partial<typeof CLAIMS> = {}) => ({ ...CLAIMS, clientId: `https://agent-${randomUUID()}.test/agent.json`, ...over });
const rowsOf = (clientId: string) => db.select().from(agentSessions).where(eq(agentSessions.clientId, clientId));

describe("openOrContinueSession", () => {
  it("writes the row on the first request with a new sid, and continues it after", async () => {
    const claims = fresh({ agentId: "agt_1" });
    const first = await openOrContinueSession({ claims, accountId: null, now: T0 });
    const second = await openOrContinueSession({ claims, accountId: null, now: at(10 * 60 * 1000) });
    expect(first.ok && second.ok && first.id === second.id).toBe(true);
    const rows = await rowsOf(claims.clientId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sid: "sid-1", agentUserId: "usr_1", agentId: "agt_1", accountId: null, endedAt: null, createdAt: T0, lastSeenAt: at(10 * 60 * 1000) });
  });

  it("keeps one row when two first requests race", async () => {
    const claims = fresh();
    const both = await Promise.all([1, 2].map(() => openOrContinueSession({ claims, accountId: null, now: T0 })));
    expect(both.every((outcome) => outcome.ok)).toBe(true);
    expect(await rowsOf(claims.clientId)).toHaveLength(1);
  });

  it("is a different Session for another User ID, or another sid, under one client", async () => {
    const claims = fresh();
    await openOrContinueSession({ claims, accountId: null, now: T0 });
    await openOrContinueSession({ claims: { ...claims, userId: "usr_2" }, accountId: null, now: T0 });
    await openOrContinueSession({ claims: { ...claims, sid: "sid-2" }, accountId: null, now: T0 });
    expect(await rowsOf(claims.clientId)).toHaveLength(3);
  });

  it("ends after 30 idle days, and stays ended", async () => {
    const claims = fresh();
    await openOrContinueSession({ claims, accountId: null, now: T0 });
    expect((await openOrContinueSession({ claims, accountId: null, now: at(SESSION_IDLE_MS - DAY) })).ok).toBe(true);
    // Idle is measured from the last request, which the line above just was.
    const lastSeen = at(SESSION_IDLE_MS - DAY);
    expect(await openOrContinueSession({ claims, accountId: null, now: new Date(lastSeen.getTime() + SESSION_IDLE_MS + 1) })).toEqual({ ok: false });
    // Ended is remembered: a request moments later is refused, not started afresh.
    expect(await openOrContinueSession({ claims, accountId: null, now: new Date(lastSeen.getTime() + SESSION_IDLE_MS + 2000) })).toEqual({ ok: false });
    expect((await rowsOf(claims.clientId))[0]!.endedAt).not.toBeNull();
  });

  it("refuses a row that was ended", async () => {
    const claims = fresh();
    await openOrContinueSession({ claims, accountId: null, now: T0 });
    await db.update(agentSessions).set({ endedAt: T0 }).where(eq(agentSessions.clientId, claims.clientId));
    expect(await openOrContinueSession({ claims, accountId: null, now: at(1000) })).toEqual({ ok: false });
  });

  it("records the account on the first signed-in request, and ends on another account's", async () => {
    const claims = fresh();
    await openOrContinueSession({ claims, accountId: null, now: T0 });
    expect((await openOrContinueSession({ claims, accountId: "acct-a", now: at(1000) })).ok).toBe(true);
    expect((await rowsOf(claims.clientId))[0]!.accountId).toBe("acct-a");
    expect((await openOrContinueSession({ claims, accountId: "acct-a", now: at(2000) })).ok).toBe(true);
    expect(await openOrContinueSession({ claims, accountId: "acct-b", now: at(3000) })).toEqual({ ok: false });
    // Signed out again is the same account's Session continuing (5.5), not a change.
    expect((await openOrContinueSession({ claims, accountId: null, now: at(4000) })).ok).toBe(true);
  });
});

describe("poppyGate", () => {
  const URL_ = "https://caesura.test/api/v1/discover/playbooks";

  async function agentGate() {
    const agent = await makeTestAgent({ issuer: oauthIssuer() });
    const cache = createRedisCache(createMemoryClient());
    // The origin is the deployment's, so `htu` is what `deploymentOrigin()` says.
    const { deploymentOrigin } = await import("@/lib/deploymentOrigin");
    const htu = `${deploymentOrigin()}/api/v1/discover/playbooks`;
    const deps = { cache, clientDeps: { fetch: agent.fetch, resolve: publicResolve, cache }, now: new Date() };
    const request = async (
      over: Partial<Parameters<typeof agent.session>[0]> = {},
      headers: Record<string, string | null> = {},
      token?: string,
    ) => {
      const jwt = await agent.session({ htu, ...over, ...(token === undefined ? {} : { accessToken: token }) });
      const all: Record<string, string | null> = { "poppy-session": jwt, "poppy-version": "0.4", ...headers };
      if (token !== undefined) all.authorization = `Bearer ${token}`;
      const clean = Object.fromEntries(Object.entries(all).filter((entry): entry is [string, string] => entry[1] !== null));
      return new Request(URL_, { headers: clean });
    };
    return { agent, deps, request };
  }

  it("lets a request without the header through untouched, and writes nothing", async () => {
    expect(await poppyGate(new Request(URL_))).toBeNull();
    expect(await poppyGate(new Request(URL_, { headers: { "poppy-version": "9.9" } }))).toBeNull();
  });

  it("verifies a signed-out request against the agent's real document, and opens its Session", async () => {
    const { agent, deps, request } = await agentGate();
    expect(await poppyGate(await request({ sid: "sid-gate" }), deps)).toBeNull();
    expect(await rowsOf(agent.clientId)).toHaveLength(1);
  });

  it("answers invalid_session, as a 400 with the bare error, for a header that fails", async () => {
    const { deps, request } = await agentGate();
    const res = (await poppyGate(await request({ aud: "https://other.test" }), deps))!;
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_session" });
  });

  it("answers version_unsupported for a missing Poppy-Version or an incompatible one, and takes 0.4", async () => {
    const { deps, request } = await agentGate();
    for (const version of [null, "0.3", "1.4", "0.4.1", "four"]) {
      const res = (await poppyGate(await request({}, { "poppy-version": version }), deps))!;
      expect(res.status, String(version)).toBe(400);
      expect(await res.json()).toEqual({ error: "version_unsupported" });
    }
    expect(await poppyGate(await request({}, { "poppy-version": "0.4" }), deps)).toBeNull();
  });

  it("answers session_ended for an ended Session", async () => {
    const { agent, deps, request } = await agentGate();
    await poppyGate(await request({ sid: "sid-end" }), deps);
    await db.update(agentSessions).set({ endedAt: new Date() }).where(eq(agentSessions.clientId, agent.clientId));
    const res = (await poppyGate(await request({ sid: "sid-end" }), deps))!;
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "session_ended" });
  });

  it("takes the access token the agent was issued, and refuses one another client holds", async () => {
    const { agent, deps, request } = await agentGate();
    const owner = `gate-${randomUUID()}`;
    await upsertUser({ id: owner, email: `${owner}@example.test`, name: null, image: null });
    const mine = await agentToken(agent, owner);
    expect(await poppyGate(await request({ sid: "sid-tok" }, {}, mine), deps)).toBeNull();
    expect((await rowsOf(agent.clientId))[0]!.accountId).toBe(owner);

    const other = await connectForTest(owner);
    const res = (await poppyGate(await request({ sid: "sid-tok-2" }, {}, other.access), deps))!;
    expect(await res.json()).toMatchObject({ error: "invalid_session" });
  });
});

/** An access token issued to `agent`, by the same exchange a real one uses. */
async function agentToken(agent: Awaited<ReturnType<typeof makeTestAgent>>, ownerId: string): Promise<string> {
  const cache = createRedisCache(createMemoryClient());
  const deps = { fetch: agent.fetch, resolve: publicResolve, userId: ownerId, cache };
  const resolved = await resolveClient(agent.clientId, deps);
  if (!resolved.ok) throw new Error("agent did not resolve");
  const now = new Date();
  const redirectUri = (agent.document.redirect_uris as string[])[0]!;
  const grant = await createGrant({ ownerId, client: resolved.client, redirectUri, scopes: ["trips:read"], resource: mcpResource(), now });
  const code = await issueCode({
    grantId: grant.id,
    codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    redirectUri,
    resource: mcpResource(),
    now,
  });
  const tokens = await exchangeCode(
    {
      code,
      codeVerifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
      redirectUri,
      clientId: agent.clientId,
      clientAssertion: await agent.assertion(),
      clientAssertionType: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    },
    now,
    deps,
  );
  if (!tokens.ok) throw new Error(tokens.description);
  return tokens.body.access_token;
}
