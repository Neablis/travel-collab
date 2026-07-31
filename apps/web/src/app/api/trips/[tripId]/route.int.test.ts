import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db/client";
import { events, tripDetails, tripSummaries } from "@/server/db/schema";
import { executeTripCommand } from "@/server/commands";

const ACTOR_ID = "user-1";
const OUTSIDER_ID = "user-2";

let currentUserId = ACTOR_ID;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

// Import after the mock so the route picks up the mocked `auth`.
const { GET } = await import("./route");

async function seedTrip() {
  const tripId = randomUUID();
  const result = await executeTripCommand({ type: "CreateTrip", tripId, name: "Rome 2027" }, ACTOR_ID);
  if (!result.ok) throw new Error("failed to seed trip");
  return tripId;
}

describe("GET /api/trips/:id", () => {
  beforeEach(async () => {
    currentUserId = ACTOR_ID;
    await db.delete(tripDetails);
    await db.delete(tripSummaries);
    await db.delete(events);
  });

  it("401s when unauthenticated", async () => {
    const tripId = await seedTrip();
    currentUserId = "";
    const res = await GET(new Request(`http://x/api/trips/${tripId}`), { params: Promise.resolve({ tripId }) });
    expect(res.status).toBe(401);
  });

  it("403s for a non-member", async () => {
    const tripId = await seedTrip();
    currentUserId = OUTSIDER_ID;
    const res = await GET(new Request(`http://x/api/trips/${tripId}`), { params: Promise.resolve({ tripId }) });
    expect(res.status).toBe(403);
  });

  it("404s when the trip does not exist", async () => {
    const tripId = randomUUID();
    const res = await GET(new Request(`http://x/api/trips/${tripId}`), { params: Promise.resolve({ tripId }) });
    expect(res.status).toBe(404);
  });

  it("returns a trip detail for a member", async () => {
    const tripId = await seedTrip();
    const res = await GET(new Request(`http://x/api/trips/${tripId}`), { params: Promise.resolve({ tripId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trip.tripId).toBe(tripId);
    expect(body.trip.name).toBe("Rome 2027");
  });

  it("returns a deleted trip with status rather than 404", async () => {
    const tripId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Doomed" }, ACTOR_ID);
    await executeTripCommand({ type: "DeleteTrip", tripId }, ACTOR_ID);

    const res = await GET(new Request(`http://x/api/trips/${tripId}`), { params: Promise.resolve({ tripId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trip.status).toBe("deleted");
  });
});
