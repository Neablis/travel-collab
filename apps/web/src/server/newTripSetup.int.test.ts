import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { BoardCommand } from "@/lib/apiClient";
import { createTripWithSetup } from "@/components/home/newTripSubmit";
import { db } from "./db/client";
import { tripDetails } from "./db/schema";
import { executeTripCommand } from "./commands";
import { getTripDetail, rebuildProjections } from "./projections";

const ACTOR = `new-trip-setup-${randomUUID().slice(0, 8)}`;

// M56 gate, "Every answer reaches the trip": the picker's answers, sent as the
// commands `createTripWithSetup` sends, through the real pipeline. The stubs
// stand in for the two HTTP routes and nothing else, so a command the route
// would refuse is refused here too.
describe("a trip created with a start, a length, a pace and tags", () => {
  it("holds all four in its detail, and a rebuild reproduces them", async () => {
    const tripId = randomUUID();
    const result = await createTripWithSetup({
      setup: {
        name: "Lisbon",
        arrive: "2027-04-10",
        days: 4,
        budget: null,
        currency: "USD",
        pace: "slow",
        tags: ["beach", "museum"],
      },
      applySetup: true,
      latch: null,
      newTripId: () => tripId,
      newDayId: () => randomUUID(),
      createTrip: async ({ name, tripId: id }) => {
        const created = await executeTripCommand({ type: "CreateTrip", tripId: id, name }, ACTOR);
        return created.ok
          ? { ok: true, value: { tripId: created.tripId } }
          : { ok: false, error: { status: 400, message: created.error.message, code: created.error.code } };
      },
      dispatch: async (command: BoardCommand) => {
        const applied = await executeTripCommand(command, ACTOR);
        return applied.ok
          ? { ok: true, value: { detail: applied.detail, history: applied.history } }
          : { ok: false, error: { status: 400, message: applied.error.message, code: applied.error.code } };
      },
    });
    expect(result.ok).toBe(true);

    const detail = await getTripDetail(tripId);
    expect(detail?.startDate).toBe("2027-04-10");
    expect(detail?.days).toHaveLength(4);
    expect(detail?.pace).toBe("slow");
    expect(detail?.tags).toEqual(["beach", "museum"]);

    const where = eq(tripDetails.tripId, tripId);
    const live = await db.select().from(tripDetails).where(where);
    expect(live).toHaveLength(1);
    await rebuildProjections();
    expect(await db.select().from(tripDetails).where(where)).toEqual(live);
  });
});
