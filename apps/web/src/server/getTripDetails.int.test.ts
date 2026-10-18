import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "./db/client";
import { tripDetails } from "./db/schema";
import { executeTripCommand } from "./commands";
import { getTripDetail, getTripDetails } from "./projections";

// `getTripDetails` replaces a `getTripDetail` per trip (Sentry's N+1 on the
// assistant's account read, and Home's per-card detail fetch), so it is held
// to that function's answer for each trip, to the one statement that was the
// point, and to each caller's answer for a doc that no longer parses.

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
    const details = await getTripDetails([rome, kyoto, randomUUID(), "not-a-uuid", rome], "throw");
    expect(select).toHaveBeenCalledOnce();
    select.mockRestore();

    expect([...details.keys()].sort()).toEqual([rome, kyoto].sort());
    expect(details.get(rome)).toEqual(await getTripDetail(rome));
    expect(details.get(kyoto)).toEqual(await getTripDetail(kyoto));
    expect(await getTripDetails([], "throw")).toEqual(new Map());
  });

  it("throws, as getTripDetail does, for a stored doc that no longer parses, when asked to", async () => {
    const tripId = randomUUID();
    await db.insert(tripDetails).values({ tripId, doc: { shape: "from an older build" } } as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(getTripDetail(tripId)).rejects.toThrow();
    await expect(getTripDetails([tripId], "throw")).rejects.toThrow();
  });

  it("leaves a doc that no longer parses out, and keeps the rest, when asked to omit it", async () => {
    const rome = await seedTrip("Rome 2027");
    const broken = randomUUID();
    await db.insert(tripDetails).values({ tripId: broken, doc: { shape: "from an older build" } } as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const details = await getTripDetails([rome, broken], "omit");
    expect([...details.keys()]).toEqual([rome]);
  });
});
