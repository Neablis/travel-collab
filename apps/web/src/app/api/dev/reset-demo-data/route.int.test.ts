import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commandsFor } from "@tc/factories";
import { executeTripCommand } from "@/server/commands";
import { listTripSummaries } from "@/server/projections";

const ACTOR_ID = "user-1";
const OUTSIDER_ID = "user-2";

let currentUserId: string | null = ACTOR_ID;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

// Import after the mock so the route picks up the mocked `auth` — same
// pattern as every other *.int.test.ts under src/app/api.
const { POST } = await import("./route");

const ORIGINAL_ENV = { ...process.env };

function openGate() {
  process.env.VERCEL_ENV = "preview";
  process.env.SEED_DEMO_DATA = "true";
}

function closeGate() {
  delete process.env.VERCEL_ENV;
  delete process.env.SEED_DEMO_DATA;
}

async function seedOwnedTrip(userId: string, name: string): Promise<string> {
  const tripId = randomUUID();
  const created = await executeTripCommand({ type: "CreateTrip", tripId, name }, userId);
  if (!created.ok) throw new Error("failed to seed trip");
  // "unscheduledHeavy" (not "threeDayTrip"): activitiesPerDay 1, not 2 —
  // avoids a real bug in commandsFor's per-scenario AddActivity time window
  // for the second activity on a day (`0${9 + i}:00` produces "010:00" for
  // i=1, which fails TimeWindow's HHMM regex). Out of scope here
  // (packages/factories, and this task's file scope excludes packages/) —
  // filed as a known issue instead of fixed inline.
  for (const command of commandsFor("unscheduledHeavy", tripId)) {
    const result = await executeTripCommand(command, userId);
    if (!result.ok) throw new Error(`failed to seed trip content: ${result.error.message}`);
  }
  return tripId;
}

async function activeTripIdsFor(userId: string): Promise<string[]> {
  const rows = await listTripSummaries();
  return rows.filter((r) => r.members.some((m) => m.userId === userId)).map((r) => r.tripId);
}

describe("POST /api/dev/reset-demo-data", () => {
  beforeEach(() => {
    currentUserId = ACTOR_ID;
    closeGate();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("404s when the gate is closed, even for an authenticated caller", async () => {
    const res = await POST(new Request("http://test/api/dev/reset-demo-data", { method: "POST" }));
    expect(res.status).toBe(404);
  });

  it("404s when the gate is closed and the caller isn't authenticated either", async () => {
    currentUserId = null;
    const res = await POST(new Request("http://test/api/dev/reset-demo-data", { method: "POST" }));
    expect(res.status).toBe(404);
  });

  it("401s when the gate is open but the caller isn't authenticated", async () => {
    openGate();
    currentUserId = null;
    const res = await POST(new Request("http://test/api/dev/reset-demo-data", { method: "POST" }));
    expect(res.status).toBe(401);
  });

  it("clears only the caller's own trips and seeds the 14-day Japan trip", async () => {
    openGate();
    const ownTripId = await seedOwnedTrip(ACTOR_ID, "Caller's old trip");
    const outsiderTripId = await seedOwnedTrip(OUTSIDER_ID, "Outsider's trip");

    const res = await POST(new Request("http://test/api/dev/reset-demo-data", { method: "POST" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.tripId).toBe("string");
    expect(body.tripId).not.toBe(ownTripId);

    // The caller's prior trip is gone (DeleteTrip'd, not hard-deleted — it's
    // just no longer "active"); the caller's active trips are exactly the
    // freshly seeded one.
    const callerTrips = await activeTripIdsFor(ACTOR_ID);
    expect(callerTrips).toEqual([body.tripId]);

    // Never touched the outsider's trip.
    const outsiderTrips = await activeTripIdsFor(OUTSIDER_ID);
    expect(outsiderTrips).toEqual([outsiderTripId]);

    // The real 14-day / 68-stop / 4-unscheduled Japan seed, not a stub.
    expect(body.days).toBe(14);
    expect(body.activities).toBe(68 + 4);
  });
});
