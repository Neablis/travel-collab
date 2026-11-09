// **A Personal Agent's Session** (Poppy 5.3 step 4, 5.4, 5.5), against a real
// database: the row the first verified request writes, the 30 days that end
// it, the account it may not change, and `poppyGate`, which is what `route()`
// and `/api/mcp` call for a request that carries the header.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryClient } from "@/server/cache/memory";
import { createRedisCache } from "@/server/cache/redis";
import { db } from "@/server/db/client";
import { agentSessions, rateLimitCounters } from "@/server/db/schema";
import { resolveClient } from "@/server/oauth/clients";
import { createGrant, issueCode } from "@/server/oauth/grants";
import { mcpResource, oauthIssuer } from "@/server/oauth/metadata";
import { exchangeCode } from "@/server/oauth/tokens";
import { connectForTest } from "@/server/test-support/oauthConnection";
import { upsertUser } from "@/server/users";
import { openOrContinueSession, poppyGate, SESSION_IDLE_MS, SESSION_RETENTION_MS, sweepAgentSessions } from "./sessions";
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

afterEach(() => {
  vi.unstubAllEnvs();
});

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

  it("holds the account that lost a race to set it, rather than letting both in", async () => {
    // Both read a signed-out row before either writes; only one update matches `account_id IS NULL`.
    for (let round = 0; round < 15; round++) {
      const claims = fresh();
      await openOrContinueSession({ claims, accountId: null, now: T0 });
      const both = await Promise.all(["acct-a", "acct-b"].map((accountId) => openOrContinueSession({ claims, accountId, now: at(1000) })));
      expect(both.filter((outcome) => outcome.ok), `round ${round}`).toHaveLength(1);
    }
  });

  it("charges only a new row to the client, so invented sids stop at its share and a continuing Session does not", async () => {
    vi.stubEnv("AGENT_SESSION_OPEN_RATE_LIMIT_PER_CLIENT_HOURLY", "3");
    const claims = fresh();
    const opened = [];
    for (let i = 0; i < 5; i++) opened.push(await openOrContinueSession({ claims: { ...claims, sid: `sid-${i}` }, accountId: null, now: T0 }));
    expect(opened.map((outcome) => outcome.ok)).toEqual([true, true, true, false, false]);
    expect(await rowsOf(claims.clientId)).toHaveLength(3);
    const refused = opened[3]!;
    expect(!refused.ok && refused.limited?.status).toBe(429);
    expect((await openOrContinueSession({ claims: { ...claims, sid: "sid-0" }, accountId: null, now: at(1000) })).ok).toBe(true);
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

describe("sweepAgentSessions", () => {
  it("deletes rows idle past the retention, ended or not, and keeps the rest", async () => {
    const claims = fresh();
    for (const sid of ["old", "ended-old", "recent"]) await openOrContinueSession({ claims: { ...claims, sid }, accountId: null, now: T0 });
    const sweepAt = at(SESSION_RETENTION_MS + DAY);
    await db.update(agentSessions).set({ lastSeenAt: at(SESSION_RETENTION_MS) }).where(eq(agentSessions.sid, "recent"));
    await db.update(agentSessions).set({ endedAt: T0 }).where(eq(agentSessions.sid, "ended-old"));
    expect(await sweepAgentSessions(sweepAt)).toBeGreaterThanOrEqual(2);
    expect((await rowsOf(claims.clientId)).map((row) => row.sid)).toEqual(["recent"]);
  });
});

describe("poppyGate", () => {
  /** What `route()` does with it: verify, then, the credential accepted, open the Session as `accountId`. */
  const through = async (request: Request, deps: Parameters<typeof poppyGate>[1], accountId: string | null = null) => {
    const gate = await poppyGate(request, deps);
    return "refused" in gate ? gate.refused : gate.open(accountId);
  };

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
    expect(await through(new Request(URL_), {})).toBeNull();
    expect(await through(new Request(URL_, { headers: { "poppy-version": "9.9" } }), {})).toBeNull();
  });

  it("verifies a request against the agent's real document and writes nothing until its credential is accepted", async () => {
    const { agent, deps, request } = await agentGate();
    const gate = await poppyGate(await request({ sid: "sid-gate" }), deps);
    expect("open" in gate).toBe(true);
    // A request the actor refuses never calls `open`: no row for a sid anyone with a document can invent.
    expect(await rowsOf(agent.clientId)).toHaveLength(0);
    expect(await ("open" in gate ? gate.open("acct-1") : null)).toBeNull();
    expect(await rowsOf(agent.clientId)).toHaveLength(1);
  });

  it("charges the fetches of a caller with no account to a quota of its own, never the one authorize uses", async () => {
    const { deps, request } = await agentGate();
    const hits = async (policy: string) =>
      (await db.select({ hits: rateLimitCounters.hits }).from(rateLimitCounters).where(eq(rateLimitCounters.bucket, `${policy}:global`)))[0]?.hits ?? 0;
    const [cimdBefore, signedOutBefore] = [await hits("oauth-cimd-hourly"), await hits("oauth-signed-out-fetch-hourly")];
    // Throwaway issuers from many addresses: every one is fetched, and none is a client.
    const outcomes = [];
    for (let i = 0; i < 8; i++) {
      const gate = await poppyGate(
        await request({ iss: `https://flood-${randomUUID()}.test/agent.json` }, { "x-forwarded-for": `2001:db8::${i + 1}` }),
        deps,
      );
      outcomes.push("refused" in gate);
    }
    expect(outcomes.every(Boolean)).toBe(true);
    // The flood was counted against its own policy, and the share a person connecting Claude draws on was not touched.
    expect(await hits("oauth-signed-out-fetch-hourly")).toBeGreaterThan(signedOutBefore);
    expect(await hits("oauth-cimd-hourly")).toBe(cimdBefore);
  });

  it("answers invalid_session, as a 400 with the bare error, for a header that fails", async () => {
    const { deps, request } = await agentGate();
    const res = (await through(await request({ aud: "https://other.test" }), deps))!;
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_session" });
  });

  it("answers version_unsupported for a missing Poppy-Version or an incompatible one, and takes 0.4", async () => {
    const { deps, request } = await agentGate();
    for (const version of [null, "0.3", "1.4", "0.4.1", "four"]) {
      const res = (await through(await request({}, { "poppy-version": version }), deps))!;
      expect(res.status, String(version)).toBe(400);
      expect(await res.json()).toEqual({ error: "version_unsupported" });
    }
    expect(await through(await request({}, { "poppy-version": "0.4" }), deps)).toBeNull();
  });

  it("answers session_ended for an ended Session", async () => {
    const { agent, deps, request } = await agentGate();
    await through(await request({ sid: "sid-end" }), deps);
    await db.update(agentSessions).set({ endedAt: new Date() }).where(eq(agentSessions.clientId, agent.clientId));
    const res = (await through(await request({ sid: "sid-end" }), deps))!;
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "session_ended" });
  });

  it("takes the access token the agent was issued, and refuses one another client holds", async () => {
    const { agent, deps, request } = await agentGate();
    const owner = `gate-${randomUUID()}`;
    await upsertUser({ id: owner, email: `${owner}@example.test`, name: null, image: null });
    const mine = await agentToken(agent, owner);
    expect(await through(await request({ sid: "sid-tok" }, {}, mine), deps, owner)).toBeNull();
    expect((await rowsOf(agent.clientId))[0]!.accountId).toBe(owner);

    const other = await connectForTest(owner);
    const res = (await through(await request({ sid: "sid-tok-2" }, {}, other.access), deps))!;
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
