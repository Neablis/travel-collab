import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeTripCommand } from "@/server/commands";
import { grantMembership } from "@/server/access/members";
import { db } from "@/server/db/client";
import { entitleAccounts } from "@/server/test-support/entitledAccount";

let currentUserId = "";

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

// Import after the mock so the routes pick up the mocked `auth`.
const { GET, POST } = await import("./route");
const { PATCH, DELETE } = await import("./[snapshotId]/route");
const { POST: RESTORE } = await import("./[snapshotId]/restore/route");

// The module's rules are proven in `server/snapshots/snapshots.int.test.ts`.
// This file proves that each verb reaches the wire with its status and shape.
let OWNER = "";
let SUGGESTER = "";
let tripId = "";

beforeEach(async () => {
  const run = randomUUID().slice(0, 8);
  OWNER = `snap-route-owner-${run}`;
  SUGGESTER = `snap-route-sam-${run}`;
  await entitleAccounts([OWNER]);
  tripId = randomUUID();
  expect((await executeTripCommand({ type: "CreateTrip", tripId, name: "Kyoto" }, OWNER)).ok).toBe(true);
  await grantMembership(db, { tripId, userId: SUGGESTER, role: "suggester", invitedBy: OWNER, now: new Date().toISOString() });
  currentUserId = OWNER;
});

const url = (path = "") => `http://test/api/trips/${tripId}/snapshots${path}`;
const json = (method: string, body: unknown) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: typeof body === "string" ? body : JSON.stringify(body),
});
const save = (body: unknown) => POST(new Request(url(), json("POST", body)), { params: Promise.resolve({ tripId }) });
const at = (snapshotId: string) => ({ params: Promise.resolve({ tripId, snapshotId }) });

describe("/api/trips/:id/snapshots", () => {
  it("saves (201), lists, renames, restores and deletes", async () => {
    const created = await save({ name: " Before the day " });
    expect(created.status).toBe(201);
    const { snapshot } = await created.json();
    expect(snapshot).toMatchObject({ tripId, name: "Before the day", seq: 1, createdBy: OWNER });

    const listed = await (await GET(new Request(url()), { params: Promise.resolve({ tripId }) })).json();
    expect(listed.snapshots.map((s: { id: string }) => s.id)).toEqual([snapshot.id]);

    const renamed = await PATCH(new Request(url(`/${snapshot.id}`), json("PATCH", { name: "Day zero" })), at(snapshot.id));
    expect((await renamed.json()).snapshot.name).toBe("Day zero");

    expect((await executeTripCommand({ type: "AddDay", tripId, dayId: randomUUID() }, OWNER)).ok).toBe(true);
    const restored = await RESTORE(new Request(url(`/${snapshot.id}/restore`), { method: "POST" }), at(snapshot.id));
    expect(restored.status).toBe(200);
    const outcome = await restored.json();
    expect(outcome.detail.days).toEqual([]);
    expect(outcome.history.entries[0].origin).toEqual({ kind: "revert", toSeq: 1 });

    const again = await RESTORE(new Request(url(`/${snapshot.id}/restore`), { method: "POST" }), at(snapshot.id));
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "no-op" });

    expect((await DELETE(new Request(url(`/${snapshot.id}`), { method: "DELETE" }), at(snapshot.id))).status).toBe(200);
    expect((await DELETE(new Request(url(`/${snapshot.id}`), { method: "DELETE" }), at(snapshot.id))).status).toBe(404);
  });

  it("401s without a session, 400s a blank or non-JSON name, 403s a suggester, 404s a malformed id", async () => {
    currentUserId = "";
    expect((await save({ name: "x" })).status).toBe(401);
    currentUserId = OWNER;
    expect((await save({ name: "   " })).status).toBe(400);
    expect((await save("{not json")).status).toBe(400);
    expect((await DELETE(new Request(url("/not-a-uuid"), { method: "DELETE" }), at("not-a-uuid"))).status).toBe(404);
    currentUserId = SUGGESTER;
    const refused = await save({ name: "Mine" });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "forbidden" });
  });
});
