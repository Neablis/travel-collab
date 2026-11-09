// **The Agents tab's list** (ADR-089 decision 3), against a real database: an
// operator reads one row per `client_id` with its counts, and anyone else finds
// no route.
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { AdminAgentList } from "@tc/contracts";
import { db } from "@/server/db/client";
import { agentFeedback, agentSessions, oauthClientBlocks, users } from "@/server/db/schema";
import { upsertUser } from "@/server/users";

let currentUserId = "";
vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { GET } = await import("./route");

async function account(admin: boolean): Promise<string> {
  const id = `dev-${randomUUID()}`;
  await upsertUser({ id, email: `${id}@example.test`, name: null, image: null });
  await db.update(users).set({ isAdmin: admin }).where(eq(users.id, id));
  return id;
}

const DAY = 24 * 60 * 60 * 1000;
async function session(clientId: string, over: { accountId?: string | null; ageDays?: number } = {}) {
  const at = new Date(Date.now() - (over.ageDays ?? 0) * DAY);
  await db.insert(agentSessions).values({
    id: randomUUID(),
    clientId,
    sid: randomUUID(),
    agentUserId: randomUUID(),
    agentId: null,
    accountId: over.accountId ?? null,
    createdAt: at,
    lastSeenAt: at,
  });
}

afterEach(() => {
  currentUserId = "";
});

describe("GET /api/admin/agents", () => {
  it("is a missing route to a signed-out caller and to a signed-in non-operator", async () => {
    expect((await GET()).status).toBe(404);
    currentUserId = await account(false);
    const res = await GET();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not-found" });
  });

  it("lists each agent once, with its Sessions in the last 30 days, its accounts, and whether it is blocked", async () => {
    const seen = `https://${randomUUID()}.agent.test/poppy-client.json`;
    const stale = `https://${randomUUID()}.agent.test/poppy-client.json`;
    const cut = `https://${randomUUID()}.agent.test/poppy-client.json`;
    await session(seen, { accountId: "dev-a" });
    await session(seen, { accountId: "dev-a" });
    await session(seen, { accountId: "dev-b" });
    await session(seen);
    await session(seen, { ageDays: 31, accountId: "dev-c" });
    await session(stale, { ageDays: 40 });
    await db.insert(oauthClientBlocks).values({ clientId: cut, blockedAt: new Date(), blockedBy: "dev-operator" });
    currentUserId = await account(true);

    const res = await GET();
    expect(res.status).toBe(200);
    const { agents } = AdminAgentList.parse(await res.json());
    const row = (clientId: string) => agents.find((agent) => agent.clientId === clientId);
    expect(row(seen)).toMatchObject({ domain: new URL(seen).host, sessions30d: 4, accounts: 2, blocked: false, name: null });
    // Older than the window and not blocked: not seen. Blocked with no Session: listed, so it can be undone.
    expect(row(stale)).toBeUndefined();
    expect(row(cut)).toMatchObject({ blocked: true, sessions30d: 0, accounts: 0 });
  });

  it("lists the reports newest first, each with its agent's domain when no name was seen, the text untouched", async () => {
    const clientId = `https://${randomUUID()}.agent.test/poppy-client.json`;
    const at = Date.now();
    const text = "**bold** <b>markup</b>";
    await db.insert(agentFeedback).values([
      { id: randomUUID(), clientId, task: "older task", description: "older", createdAt: new Date(at - 2000) },
      { id: randomUUID(), clientId, task: "newer task", description: text, createdAt: new Date(at - 1000) },
    ]);
    currentUserId = await account(true);

    const { reports } = AdminAgentList.parse(await (await GET()).json());
    const ours = reports.filter((report) => report.clientId === clientId);
    expect(ours.map((report) => report.task)).toEqual(["newer task", "older task"]);
    expect(ours[0]).toMatchObject({ agentName: new URL(clientId).host, description: text });
    // Newest first across every agent, not only this one.
    expect(reports.map((r) => r.createdAt)).toEqual([...reports.map((r) => r.createdAt)].sort().reverse());
  });
});
