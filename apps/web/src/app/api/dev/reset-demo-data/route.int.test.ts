import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commandsFor } from "@tc/factories";
import type { TripCommand } from "@tc/contracts";
import { executeTripCommand } from "@/server/commands";
import { getTripDetail, listTripSummaries } from "@/server/projections";

const ACTOR_ID = "user-1";
const OUTSIDER_ID = "user-2";

let currentUserId: string | null = ACTOR_ID;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

// Overridden per-test (undefined = pass through to the real importer) so one
// test can force the seed batch to reject partway through without needing a
// fixture of its own — @/lib/japanTripImporter's real importJapanTripSeed
// always produces a valid ~74-command batch, so a forced rejection needs a
// seam here.
let seedCommandsOverride: ((tripId: string) => TripCommand[]) | undefined;
vi.mock("@/lib/japanTripImporter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/japanTripImporter")>();
  return {
    ...actual,
    importJapanTripSeed: (seed: unknown, tripId: string) =>
      seedCommandsOverride ? seedCommandsOverride(tripId) : actual.importJapanTripSeed(seed as never, tripId),
  };
});

// Import after the mocks so the route picks up mocked `auth` and
// `importJapanTripSeed` — same pattern as every other *.int.test.ts under
// src/app/api.
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
  // "unscheduledHeavy" is now an ordinary choice: these tests only need an
  // owned trip that carries *some* content, and this scenario is the cheapest
  // one that has both scheduled and backlog activities. It was originally
  // picked to dodge KI-37 (commandsFor emitted an invalid "010:00" for a day's
  // second activity); that is fixed, and since KI-41 `commandsFor` takes
  // overrides, so any scenario here could state its own windows.
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
    seedCommandsOverride = undefined;
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

  it("leaves no partially-seeded trip when a command mid-batch is rejected", async () => {
    openGate();
    await seedOwnedTrip(ACTOR_ID, "Caller's old trip");

    // A valid AddActivity followed by one referencing a day that will never
    // exist (`day-not-found`, packages/domain/src/trip/decide.ts). Before
    // the batch fix this ran as ~74 separate executeTripCommand calls, so
    // the valid AddActivity — and SetTripDates/SetTripBudget before it —
    // would already be committed by the time this one failed, leaving a
    // half-built trip. executeTripCommandBatch decides the whole list
    // in-memory before appending anything, so a rejection here must leave
    // the trip exactly as CreateTrip left it: no dates, no budget, no
    // activities.
    seedCommandsOverride = (tripId) => {
      const dayId = randomUUID();
      return [
        { type: "SetTripDates", tripId, startDate: "2027-01-01", endDate: "2027-01-01", newDayIds: [dayId] },
        { type: "SetTripBudget", tripId, budget: { amountMinor: 100000, currency: "USD" } },
        {
          type: "AddActivity",
          tripId,
          activityId: randomUUID(),
          dayId,
          title: "Valid stop",
          timeWindow: { start: "09:00", end: "10:00" },
        },
        {
          type: "AddActivity",
          tripId,
          activityId: randomUUID(),
          dayId: randomUUID(), // never created by SetTripDates above
          title: "Orphaned stop",
        },
      ];
    };

    const res = await POST(new Request("http://test/api/dev/reset-demo-data", { method: "POST" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("day-not-found");

    // The prior trip was already deleted before the batch ran (deletes are
    // DeleteTrip, not BatchableCommand, so they aren't and can't be part of
    // this batch) — that step is unaffected by this rejection. Exactly one
    // trip remains: the bare one CreateTrip minted, still bare.
    const callerTripIds = await activeTripIdsFor(ACTOR_ID);
    expect(callerTripIds).toHaveLength(1);
    const detail = await getTripDetail(callerTripIds[0]!);
    expect(detail?.days).toEqual([]);
    expect(detail?.activities).toEqual({});
    expect(detail?.budget).toBeNull();
  });
});
