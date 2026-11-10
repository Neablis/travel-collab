// **`GET /api/poppy/tasks`** (Poppy 9, ADR-089 decision 11), against a real
// database: a Session header that is sent is verified before anything is
// answered, and the body is the same for every Session, so it is marked cacheable.
import { describe, expect, it, vi } from "vitest";
import { deploymentOrigin } from "@/lib/deploymentOrigin";
import { createMemoryClient } from "@/server/cache/memory";
import { createRedisCache } from "@/server/cache/redis";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { agentSessions } from "@/server/db/schema";
import { resolveClient, storeClient } from "@/server/oauth/clients";
import { oauthIssuer } from "@/server/oauth/metadata";
import { tasksResponse } from "@/server/poppy/tasks";
import { makeTestAgent, publicResolve, type TestAgent } from "@/server/poppy/testAgent";

// Nothing here is a person's: the route reads no cookie, and the module only has to load.
vi.mock("@/server/auth", () => ({ auth: vi.fn(async () => null) }));

// The route calls `poppyGate` with the real network; the agent's documents are
// served from memory here, as `sessions.int.test.ts` serves them.
let poppyDeps: import("@/server/poppy/sessionHeader").SessionDeps = {};
vi.mock("@/server/poppy/sessions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/poppy/sessions")>();
  return { ...actual, poppyGate: (request: Request, deps?: object) => actual.poppyGate(request, { ...deps, ...poppyDeps }) };
});

const { GET } = await import("./route");

const PATH = "/api/poppy/tasks";

async function tasksRequest(over: { session?: Record<string, unknown>; header?: boolean; agent?: TestAgent; allowed?: boolean } = {}) {
  const agent = over.agent ?? (await makeTestAgent({ issuer: oauthIssuer() }));
  const cache = createRedisCache(createMemoryClient());
  if (over.allowed === true) {
    // Someone has allowed it: it has a stored client row, so its Session is recorded.
    const resolved = await resolveClient(agent.clientId, { fetch: agent.fetch, resolve: publicResolve, cache, userId: "tasks-owner" });
    if (!resolved.ok) throw new Error("agent did not resolve");
    await storeClient(resolved.client, new Date());
  }
  poppyDeps = { cache, clientDeps: { fetch: agent.fetch, resolve: publicResolve, cache } };
  const headers: Record<string, string> = {
    "poppy-version": "0.4",
    // An address of its own, so no other suite shares this one's signed-out fetch share.
    "x-forwarded-for": `203.0.113.${1 + Math.floor(Math.random() * 250)}`,
  };
  if (over.header !== false) headers["poppy-session"] = await agent.session({ htu: `${deploymentOrigin()}${PATH}`, ...over.session });
  return new Request(`http://localhost${PATH}`, { headers });
}

describe("GET /api/poppy/tasks", () => {
  it("answers a verified Session with the excluded tasks and the feedback endpoint, cacheable", async () => {
    const res = await GET(await tasksRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(tasksResponse());
    expect(res.headers.get("cache-control")).toMatch(/\bpublic\b.*max-age=\d+/);
  });

  it("refuses a Session header that fails as invalid_session, not the tasks", async () => {
    const res = await GET(await tasksRequest({ session: { aud: "https://other.test" } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_session" });
  });

  it("refuses a Session that has ended as session_ended, like every other route", async () => {
    const agent = await makeTestAgent({ issuer: oauthIssuer() });
    const session = { sid: "sid-ends" };
    expect((await GET(await tasksRequest({ agent, session, allowed: true }))).status).toBe(200);
    await db.update(agentSessions).set({ endedAt: new Date() }).where(eq(agentSessions.clientId, agent.clientId));
    const res = await GET(await tasksRequest({ agent, session }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "session_ended" });
  });

  // tasks is a read: a stranger's made-up client_id must not become a row in the operator's Agents tab.
  it("serves an agent nobody has allowed and records no Session row for it", async () => {
    const agent = await makeTestAgent({ issuer: oauthIssuer() });
    expect((await GET(await tasksRequest({ agent }))).status).toBe(200);
    expect(await db.select().from(agentSessions).where(eq(agentSessions.clientId, agent.clientId))).toHaveLength(0);
  });

  it("records the Session of an agent someone has allowed", async () => {
    const agent = await makeTestAgent({ issuer: oauthIssuer() });
    expect((await GET(await tasksRequest({ agent, allowed: true }))).status).toBe(200);
    expect(await db.select().from(agentSessions).where(eq(agentSessions.clientId, agent.clientId))).toHaveLength(1);
  });

  it("gives every Session the same body, with or without a header", async () => {
    // One at a time: each request installs its own agent's documents for the gate.
    const bodies: string[] = [];
    for (const over of [{}, { session: { sub: "someone-else", sid: "another" } }, { header: false }]) {
      const res = await GET(await tasksRequest(over));
      expect(res.status).toBe(200);
      bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1);
  });
});
