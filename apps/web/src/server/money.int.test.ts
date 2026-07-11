import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "./db/client";
import { events, tripDetails, tripSummaries } from "./db/schema";
import { executeTripCommand } from "./commands";
import { getTripDetail, rebuildProjections } from "./projections";

const exec = (command: object, actorId = "user-1") => executeTripCommand(command, actorId);

describe("money rollups + over-budget projection + rebuild", () => {
  beforeEach(async () => {
    await db.delete(tripDetails);
    await db.delete(tripSummaries);
    await db.delete(events);
  });

  it("rollups recompute and over-budget appears, and survive rebuild", async () => {
    const tripId = randomUUID();
    const dayId = randomUUID();
    const flight = randomUUID();
    const museum = randomUUID();

    await exec({ type: "CreateTrip", tripId, name: "Rome 2027" });
    await exec({ type: "SetTripCurrency", tripId, currency: "EUR" });
    await exec({ type: "AddDay", tripId, dayId });
    await exec({
      type: "AddActivity",
      tripId,
      activityId: flight,
      dayId,
      title: "Flight to Rome",
      cost: { amountMinor: 4200, currency: "EUR" },
    });
    await exec({
      type: "AddActivity",
      tripId,
      activityId: museum,
      dayId,
      title: "Colosseum",
      cost: { amountMinor: 9900, currency: "EUR" },
    });

    let detail = await getTripDetail(tripId);
    expect(detail?.currency).toBe("EUR");
    expect(detail?.days).toEqual([
      { dayId, activityIds: [flight, museum], date: null, costSubtotal: 14100 },
    ]);
    expect(detail?.tripCostTotal).toBe(14100);
    expect(detail?.unscheduledCostSubtotal).toBe(0);

    // below the total: over-budget conflict appears
    await exec({ type: "SetTripBudget", tripId, budget: { amountMinor: 10000, currency: "EUR" } });
    detail = await getTripDetail(tripId);
    expect(detail?.budgetRemaining).toBe(-4100);
    const overBudget = detail?.conflicts.find((c) => c.kind === "over-budget");
    expect(overBudget).toBeDefined();
    expect(overBudget?.severity).toBe("warn");

    // above the total: over-budget conflict clears
    await exec({ type: "SetTripBudget", tripId, budget: { amountMinor: 20000, currency: "EUR" } });
    detail = await getTripDetail(tripId);
    expect(detail?.budgetRemaining).toBe(5900);
    expect(detail?.conflicts.some((c) => c.kind === "over-budget")).toBe(false);

    // rebuild from the log reproduces the live projection exactly, conflicts included
    const live = await getTripDetail(tripId);
    await rebuildProjections();
    const rebuilt = await getTripDetail(tripId);
    expect(rebuilt).toEqual(live);
  });
});
