import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

// No DB truncation: every test seeds its own randomUUID() tripId and every
// assertion reads back through that trip's response body — see
// eventStore.int.test.ts's comment and docs/testing-baseline.md (Phase 2
// Task 2.6). currentUserId still resets every test — that's mock auth state,
// not DB state.
describe("GET /api/trips/:id", () => {
  beforeEach(() => {
    currentUserId = ACTOR_ID;
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
