import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { PersonaGraphResponse } from "@/lib/askDebug";
import { executeTripCommand } from "@/server/commands";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { upsertUser } from "@/server/users";

// The Debug strip's graph (M57 part 5). Two things it must not get wrong: a
// non-operator reaches it at all (404, decision D7), and the graph is the one
// the caller's caps leave, not the page's best case.
const RUN = randomUUID().slice(0, 8);
const ADMIN = `pg-admin-${RUN}`;
const MEMBER = `pg-member-${RUN}`;

let currentUserId: string | null = ADMIN;
vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { GET } = await import("./route");

await upsertUser({ id: ADMIN, email: `${ADMIN}@example.test`, name: null, image: null });
await upsertUser({ id: MEMBER, email: `${MEMBER}@example.test`, name: null, image: null });
await db.update(users).set({ isAdmin: true }).where(eq(users.id, ADMIN));

const get = (query: string) => GET(new Request(`http://test.local/api/admin/assistant/personas?${query}`));
const reachOf = (graph: PersonaGraphResponse) => Object.fromEntries(graph.personas.map((p) => [p.id, p.reach]));

describe("GET /api/admin/assistant/personas", () => {
  it("is a 404 to a member who is not an operator, and to nobody signed in", async () => {
    currentUserId = MEMBER;
    expect((await get("surface=trip")).status).toBe(404);
    currentUserId = null;
    expect((await get("surface=trip")).status).toBe(404);
  });

  it("answers an operator the trip page's graph under an editor's caps", async () => {
    const tripId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Debug" }, ADMIN);
    currentUserId = ADMIN;
    const res = await get(`surface=trip&tripId=${tripId}`);
    expect(res.status).toBe(200);
    const graph = (await res.json()) as PersonaGraphResponse;
    expect(graph.entry).toBe("schedule");
    expect(reachOf(graph)).toEqual({ schedule: "entry", discover: "switch", "page-writer": "hand-off", account: "never", "playbook-editor": "never", explorer: "never" });
    expect(graph.personas[0]?.id).toBe("schedule");
    expect(graph.edges.some((e) => e.via === "switch_persona" && e.to === "discover" && e.guard.includes("role=propose"))).toBe(true);
    expect(graph.personas.find((p) => p.id === "schedule")?.tools.map((t) => t.name)).toContain("switch_persona");
  });

  it("narrows the graph to a read-only caller's caps when no trip is named", async () => {
    currentUserId = ADMIN;
    const graph = (await (await get("surface=trip")).json()) as PersonaGraphResponse;
    expect(graph.caps.role).toBe("read");
    expect(reachOf(graph).discover).toBe("never");
  });

  it("rejects a surface that is not a page kind", async () => {
    currentUserId = ADMIN;
    const res = await get("surface=admin");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid-surface" });
  });

  it("names the trip id, not the surface, when the trip id is malformed", async () => {
    currentUserId = ADMIN;
    const res = await get("surface=day&tripId=not-a-guid");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid-trip-id" });
  });
});
