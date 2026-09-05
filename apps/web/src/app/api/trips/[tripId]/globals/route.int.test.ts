import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TripGlobals } from "@tc/contracts";
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

// Found by Copilot on PR 134. `buildTripGlobals` had unit tests, but nothing
// exercised the ROUTE — so the viewer guard and the response contract were
// asserted nowhere, and a regression in either would have shipped green. This
// mirrors the trip-detail and pages suites next door rather than inventing a
// shape: the guard is the same `requireTripAccess(tripId, "viewer")`, so the
// same four cases are what "behind the same guard as the detail route" means.
//
// No DB truncation: each test seeds its own randomUUID() trip, per
// eventStore.int.test.ts's note. `currentUserId` resets because it is mock
// auth state, not DB state.
describe("/api/trips/:id/globals", () => {
  beforeEach(() => {
    currentUserId = ACTOR_ID;
  });

  it("401s when unauthenticated", async () => {
    const tripId = await seedTrip();
    currentUserId = "";
    const res = await GET(new Request(`http://test/api/trips/${tripId}/globals`), {
      params: Promise.resolve({ tripId }),
    });
    expect(res.status).toBe(401);
  });

  it("403s for a non-member", async () => {
    const tripId = await seedTrip();
    currentUserId = OUTSIDER_ID;
    const res = await GET(new Request(`http://test/api/trips/${tripId}/globals`), {
      params: Promise.resolve({ tripId }),
    });
    expect(res.status).toBe(403);
  });

  it("404s for a trip that does not exist", async () => {
    const tripId = randomUUID();
    const res = await GET(new Request(`http://test/api/trips/${tripId}/globals`), {
      params: Promise.resolve({ tripId }),
    });
    expect(res.status).toBe(404);
  });

  it("returns a contract-valid TripGlobals to a member", async () => {
    const tripId = await seedTrip();
    const res = await GET(new Request(`http://test/api/trips/${tripId}/globals`), {
      params: Promise.resolve({ tripId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { globals: unknown };
    // Parsed rather than eyeballed: the route promises a `TripGlobals`, and
    // this is the assertion that the promise is kept end to end.
    const globals = TripGlobals.parse(body.globals);
    expect(globals.days).toEqual([]);
    expect(globals.cities).toEqual([]);
    expect(globals.tags).toEqual([]);
    expect(globals.bookedCount).toBe(0);
  });
});
