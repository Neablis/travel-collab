import { randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { SavedStop } from "@tc/contracts";
import type { GeocodeResult, Geocoder } from "@/server/geocoding";
import { db } from "./db/client";
import { savedDays } from "./db/schema";
import { readableSavedDay } from "./savedDays";
import { backfillSavedDayPins, schedulePinBackfill } from "./savedDayPinBackfill";
import { MAX_PIN_LOOKUPS_PER_READ } from "./savedDayPins";

// M27 link 10 against a real `saved_days` row: what a read's backfill writes,
// that it writes it once, and what it does without a key. The vendor is a stub
// — the rules for what it may accept are `savedDayPins.test.ts`'s; this file is
// about the row.
//
// Rows are inserted directly under a random owner and removed afterwards, with
// no truncation, for `savedDays.stops.int.test.ts`'s reason (KI-69).

const OWNER_PREFIX = `pins-${randomUUID()}`;
const KYOTO = { lat: 35.0116, lng: 135.7681 };

function stop(name: string, dayIndex = 0): SavedStop {
  return {
    title: name,
    timeWindow: null,
    location: { name, city: "Kyoto" },
    notes: null,
    anchors: [],
    kind: "planned",
    tags: [],
    cost: null,
    dayIndex,
  };
}

async function insertDay(stops: SavedStop[]): Promise<{ savedDayId: string; ownerId: string }> {
  const savedDayId = randomUUID();
  const ownerId = `${OWNER_PREFIX}-${randomUUID()}`;
  await db.insert(savedDays).values({
    id: savedDayId,
    ownerId,
    name: "M23 three-day walk",
    stops,
    dayCount: 3,
    cities: ["Kyoto"],
    sourceTripId: randomUUID(),
    sourceTripName: "Kyoto",
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
  });
  return { savedDayId, ownerId };
}

/** Every city centre is Kyoto's; every venue comes back empty, so stops pin at city level. */
function stubVendor() {
  const calls: string[] = [];
  const geocoder: Geocoder = {
    async forward(query): Promise<GeocodeResult[]> {
      calls.push(query);
      return query === "Kyoto" ? [{ ...KYOTO, canonicalName: "Kyoto" }] : [];
    },
    forwardAddress: async () => [],
  };
  return { geocoder: () => geocoder, calls };
}

const deps = (vendor: ReturnType<typeof stubVendor>) => ({
  configured: true,
  geocoder: vendor.geocoder,
  charge: () => async () => true,
  sleep: async () => {},
});

afterAll(async () => {
  await db.delete(savedDays).where(like(savedDays.ownerId, `${OWNER_PREFIX}%`));
});

describe("backfillSavedDayPins", () => {
  // Mitchell's Playbook: fourteen stops over three days, each `{ name, city }`
  // and nothing else.
  const walk = () => Array.from({ length: 14 }, (_, i) => stop(`Stop ${i + 1}`, Math.floor(i / 5)));

  it("persists what it found, and a read after it finds nothing left to look up", async () => {
    const { savedDayId, ownerId } = await insertDay(walk().slice(0, 4));
    const vendor = stubVendor();

    expect(await backfillSavedDayPins(savedDayId, "reader", deps(vendor))).toBe("written");
    expect(vendor.calls).toEqual(["Kyoto", "Stop 1, Kyoto", "Stop 2, Kyoto", "Stop 3, Kyoto", "Stop 4, Kyoto"]);

    // Through the ordinary read, so the written shape is proven to survive the
    // strict parse that would otherwise drop the whole row (KI-71).
    const day = await readableSavedDay(savedDayId, ownerId);
    expect(day?.stops).toHaveLength(4);
    for (const s of day!.stops) {
      expect(s.location).toEqual({ name: s.title, city: "Kyoto", ...KYOTO, precision: "city" });
    }

    const again = stubVendor();
    expect(await backfillSavedDayPins(savedDayId, "reader", deps(again))).toBe("nothing-to-do");
    expect(again.calls).toEqual([]);
  });

  it("spends no more than the cap on one read, and the next read finishes the day", async () => {
    const { savedDayId, ownerId } = await insertDay(walk());

    const first = stubVendor();
    expect(await backfillSavedDayPins(savedDayId, "reader", deps(first))).toBe("written");
    expect(first.calls).toHaveLength(MAX_PIN_LOOKUPS_PER_READ);
    const partway = await readableSavedDay(savedDayId, ownerId);
    expect(partway!.stops.filter((s) => s.location?.lat !== undefined)).toHaveLength(MAX_PIN_LOOKUPS_PER_READ - 1);

    const second = stubVendor();
    expect(await backfillSavedDayPins(savedDayId, "reader", deps(second))).toBe("written");
    // The centre was stored on the stops pinned last time, so it is not bought again.
    expect(second.calls).toEqual(["Stop 12, Kyoto", "Stop 13, Kyoto", "Stop 14, Kyoto"]);
    const done = await readableSavedDay(savedDayId, ownerId);
    expect(done!.stops.every((s) => s.location?.lat !== undefined)).toBe(true);
    // Order and days are the author's, untouched.
    expect(done!.stops.map((s) => [s.title, s.dayIndex])).toEqual(walk().map((s) => [s.title, s.dayIndex]));
  });

  it("does nothing at all without a key, and never builds a geocoder", async () => {
    const stops = walk().slice(0, 2);
    const { savedDayId } = await insertDay(stops);
    const outcome = await backfillSavedDayPins(savedDayId, "reader", {
      configured: false,
      geocoder: () => {
        throw new Error("must not construct");
      },
    });
    expect(outcome).toBe("unconfigured");
    const [row] = await db.select().from(savedDays).where(eq(savedDays.id, savedDayId));
    expect(row!.stops).toEqual(stops);
  });

  it("writes nothing over a day that moved while it was looking", async () => {
    const { savedDayId } = await insertDay(walk().slice(0, 2));
    const moved = [stop("Rewritten")];
    const vendor = stubVendor();
    const racing: Geocoder = {
      async forward(query, opts) {
        // Somebody else's pass lands first, between this one's read and write.
        if (query === "Kyoto") await db.update(savedDays).set({ stops: moved }).where(eq(savedDays.id, savedDayId));
        return vendor.geocoder().forward(query, opts);
      },
      forwardAddress: async () => [],
    };
    expect(await backfillSavedDayPins(savedDayId, "reader", { ...deps(vendor), geocoder: () => racing })).toBe("raced");
    const [row] = await db.select().from(savedDays).where(eq(savedDays.id, savedDayId));
    expect(row!.stops).toEqual(moved);
  });
});

describe("schedulePinBackfill", () => {
  it("schedules nothing without a key, so the page is never told to wait", async () => {
    const { savedDayId, ownerId } = await insertDay([stop("Stop 1"), stop("Stop 2")]);
    const day = (await readableSavedDay(savedDayId, ownerId))!;
    expect(schedulePinBackfill(day, ownerId, { configured: false })).toBe(false);
  });

  it("schedules nothing for a day with nothing left to place", async () => {
    const { savedDayId, ownerId } = await insertDay([
      { ...stop("Placed"), location: { name: "Placed", city: "Kyoto", ...KYOTO } },
      { ...stop("Nowhere"), location: null },
    ]);
    const day = (await readableSavedDay(savedDayId, ownerId))!;
    expect(schedulePinBackfill(day, ownerId, { configured: true })).toBe(false);
  });

  // A route handler called directly — as every integration test here does — is
  // outside a request scope, where `after` throws. That must read as "not
  // scheduled" rather than a 500, and must not leave the day marked in flight.
  it("reports not-scheduled outside a request scope, and can be scheduled again later", async () => {
    const { savedDayId, ownerId } = await insertDay([stop("Stop 1")]);
    const day = (await readableSavedDay(savedDayId, ownerId))!;
    expect(schedulePinBackfill(day, ownerId, { configured: true })).toBe(false);
    expect(schedulePinBackfill(day, ownerId, { configured: true })).toBe(false);
  });
});
