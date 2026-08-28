import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JAPAN_TRIP_NAME } from "@tc/fixtures";
import { db } from "@/server/db/client";
import { events, tripDetails, tripMemberships, tripSummaries } from "@/server/db/schema";
import { getTripDetail } from "@/server/projections";
import { DEMO_TRIP_ID } from "@/server/demoTrip";

const ACTOR_ID = "demo-cloner";

let currentUserId: string | null = ACTOR_ID;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

// After the mock, like every other *.int.test.ts under src/app/api.
const { POST } = await import("./route");

beforeEach(async () => {
  currentUserId = ACTOR_ID;
  await db.delete(tripMemberships);
  await db.delete(tripDetails);
  await db.delete(tripSummaries);
  await db.delete(events);
});

afterEach(() => {
  currentUserId = ACTOR_ID;
});

describe("POST /api/shares/featured/clone", () => {
  it("turns the in-memory demo into a real, owned, editable trip", async () => {
    const response = await POST();
    expect(response.status).toBe(201);
    const { tripId } = (await response.json()) as { tripId: string };

    // A real stream, built by the real command pipeline — not a copied row.
    const detail = await getTripDetail(tripId);
    expect(detail).not.toBeNull();
    expect(detail!.name).toBe(`${JAPAN_TRIP_NAME} (copy)`);
    expect(detail!.days).toHaveLength(14);
    expect(Object.keys(detail!.activities)).toHaveLength(72);
    expect(detail!.members).toEqual([{ userId: ACTOR_ID, role: "owner" }]);
    expect(detail!.status).toBe("active");
  });

  it("records the demo as its lineage, with fresh ids of its own", async () => {
    const response = await POST();
    const { tripId } = (await response.json()) as { tripId: string };
    const detail = await getTripDetail(tripId);

    // Display-only text ("Copied from …, as it was at change N"). The pointer
    // names the demo's synthetic id, which is a real UUID naming no row —
    // see the note on DEMO_TRIP_ID.
    expect(detail!.forkedFrom?.tripId).toBe(DEMO_TRIP_ID);
    expect(detail!.forkedFrom?.name).toBe(JAPAN_TRIP_NAME);
    expect(detail!.forkedFrom!.atSeq).toBeGreaterThan(0);

    // Every day and activity id is remapped (KI-1): the copy shares no id
    // with the demo, and the demo's are all-zeros-prefixed anyway.
    for (const day of detail!.days) expect(day.dayId).not.toMatch(/^00000000-0000-4000-8000-/);
    for (const id of Object.keys(detail!.activities)) {
      expect(id).not.toMatch(/^00000000-0000-4000-8000-/);
    }
  });

  it("two visitors get two independent trips", async () => {
    const first = (await (await POST()).json()) as { tripId: string };
    currentUserId = "demo-cloner-2";
    const second = (await (await POST()).json()) as { tripId: string };
    expect(second.tripId).not.toBe(first.tripId);
    const a = await getTripDetail(first.tripId);
    const b = await getTripDetail(second.tripId);
    expect(a!.members).toEqual([{ userId: ACTOR_ID, role: "owner" }]);
    expect(b!.members).toEqual([{ userId: "demo-cloner-2", role: "owner" }]);
  });

  it("401s a signed-out visitor — the screen turns that into a trip to /signin", async () => {
    currentUserId = null;
    const response = await POST();
    expect(response.status).toBe(401);
  });
});
