import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "./db/client";
import { tripDetails } from "./db/schema";
import { executeTripCommand } from "./commands";
import { getTripDetail } from "./projections";
import { getTripDetails } from "./tripDetailsMany";

// `getTripDetails` replaces a `getTripDetail` per trip (Sentry's N+1 on the
// assistant's account read), so it is held to that function's answer for each
// trip, and to the one statement that was the point.

async function seedTrip(name: string) {
  const tripId = randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name }, "user-1");
  await executeTripCommand({ type: "AddDay", tripId, dayId: randomUUID() }, "user-1");
  return tripId;
}

describe("getTripDetails", () => {
  it("answers each trip as getTripDetail does, in one select, leaving out what getTripDetail calls null", async () => {
    const [rome, kyoto] = [await seedTrip("Rome 2027"), await seedTrip("Kyoto 2027")];
    const select = vi.spyOn(db, "select");
    const details = await getTripDetails([rome, kyoto, randomUUID(), "not-a-uuid", rome]);
    expect(select).toHaveBeenCalledOnce();
    select.mockRestore();

    expect([...details.keys()].sort()).toEqual([rome, kyoto].sort());
    expect(details.get(rome)).toEqual(await getTripDetail(rome));
    expect(details.get(kyoto)).toEqual(await getTripDetail(kyoto));
    expect(await getTripDetails([])).toEqual(new Map());
  });

  it("throws, as getTripDetail does, for a stored doc that no longer parses", async () => {
    const tripId = randomUUID();
    await db.insert(tripDetails).values({ tripId, doc: { shape: "from an older build" } } as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(getTripDetail(tripId)).rejects.toThrow();
    await expect(getTripDetails([tripId])).rejects.toThrow();
  });
});
