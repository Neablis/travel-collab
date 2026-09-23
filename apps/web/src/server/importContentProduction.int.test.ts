// KI-2026-09-23-e: the production importer against a real database. The
// failure mode it pins — a stop's coordinates are corrected in `content/`, the
// trip was imported before the correction, and re-importing silently leaves
// the old pin in production because the trip "already exists".
//
// Lives here rather than beside the script because the integration lane only
// collects `src/**/*.int.test.ts`; it imports the script's own `importTrips`,
// so what runs is the importer and not a re-creation of it.
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { locationFactory } from "@tc/factories";
import { parseBundle, tripIdFor, type ContentBundleV1 } from "@tc/fixtures";
import type { Location } from "@tc/contracts";
import { db } from "./db/client";
import { events } from "./db/schema";
import { getTripDetail } from "./projections";
import { importTrips } from "../../scripts/import-content-production";

const owner = "user-content-import";

// Where the 2026-09-23 audit moved Yaowarat Road: the same place, re-pinned.
const WRONG = { lat: 13.881591, lng: 100.644533 };
const RIGHT = { lat: 13.741152, lng: 100.508311 };

/**
 * A two-day bundle whose first stop is at `yaowarat`. Its id is fresh per call
 * site so the derived trip id is too — the lane's database is shared by every
 * suite in the run.
 */
function bundleWith(id: string, yaowarat: Location): ContentBundleV1 {
  return parseBundle({
    $schema: "travel-collab/content-bundle/v1",
    bundle: { id, name: "Location reconcile", origin: "ai" },
    trips: [
      {
        key: "bangkok",
        name: "Bangkok",
        startDate: "2027-03-01",
        days: [
          {
            label: "Arrive",
            stops: [
              { title: "Yaowarat after dark", location: yaowarat },
              { title: "Sarnies breakfast", location: locationFactory.build() },
            ],
          },
          { label: "Temples", stops: [{ title: "Wat Pho", location: locationFactory.build() }] },
        ],
      },
    ],
  });
}

async function eventTypes(tripId: string): Promise<string[]> {
  const rows = await db
    .select({ type: events.type })
    .from(events)
    .where(eq(events.streamId, tripId))
    .orderBy(asc(events.seq));
  return rows.map((r) => r.type);
}

async function yaowaratLocation(tripId: string) {
  const detail = await getTripDetail(tripId);
  return Object.values(detail!.activities).find((a) => a.title === "Yaowarat after dark")!.location;
}

describe("importTrips — an existing trip's stop locations (KI-2026-09-23-e)", () => {
  it("takes a corrected coordinate as one ActivityUpdated, and a re-run with no change appends nothing", async () => {
    const id = `reconcile-${randomUUID().slice(0, 8)}`;
    const base = locationFactory.build({ name: "Yaowarat Road", city: "Bangkok", countryCode: "TH" });
    // One bundle object per state of the file, so the unchanged stops carry
    // the identical location across runs, as a real file would.
    const before = bundleWith(id, { ...base, ...WRONG });
    const after: ContentBundleV1 = structuredClone(before);
    after.trips[0]!.days[0]!.stops[0]!.location = { ...base, ...RIGHT };
    const tripId = tripIdFor(id, "bangkok");

    await importTrips(before, owner);
    expect(await yaowaratLocation(tripId)).toMatchObject(WRONG);
    const imported = await eventTypes(tripId);

    const second = await importTrips(after, owner);
    expect(await yaowaratLocation(tripId)).toEqual({ ...base, ...RIGHT });
    expect((await eventTypes(tripId)).slice(imported.length)).toEqual(["ActivityUpdated"]);
    expect(second).toMatchObject({ created: 0, skipped: 1, reconciled: 1 });

    const third = await importTrips(after, owner);
    expect((await eventTypes(tripId)).length).toBe(imported.length + 1);
    expect(third).toMatchObject({ skipped: 1, reconciled: 0 });
  });

  it("plans the correction on a dry run, old → new, and writes nothing", async () => {
    const id = `reconcile-${randomUUID().slice(0, 8)}`;
    const base = locationFactory.build({ name: "Yaowarat Road", city: "Bangkok", countryCode: "TH" });
    const before = bundleWith(id, { ...base, ...WRONG });
    const after: ContentBundleV1 = structuredClone(before);
    after.trips[0]!.days[0]!.stops[0]!.location = { ...base, ...RIGHT };
    const tripId = tripIdFor(id, "bangkok");
    await importTrips(before, owner);
    const imported = await eventTypes(tripId);

    const dry = await importTrips(after, owner, { dryRun: true });

    expect(dry.planned).toEqual([
      expect.objectContaining({
        title: "Yaowarat after dark",
        from: expect.objectContaining(WRONG),
        to: expect.objectContaining(RIGHT),
      }),
    ]);
    expect(await eventTypes(tripId)).toEqual(imported);
    expect(await yaowaratLocation(tripId)).toMatchObject(WRONG);
  });

  // Title is the only thing a stop and its activity share (activity ids are
  // minted fresh at import), so a retitled stop has no partner. Pairing it by
  // position instead would move a pin onto whatever stop now sits there.
  it("reports a stop it cannot pair with an activity, and changes nothing", async () => {
    const id = `reconcile-${randomUUID().slice(0, 8)}`;
    const before = bundleWith(id, { ...locationFactory.build(), ...WRONG });
    const tripId = tripIdFor(id, "bangkok");
    await importTrips(before, owner);
    const imported = await eventTypes(tripId);

    const retitled = structuredClone(before);
    retitled.trips[0]!.days[0]!.stops[1]!.title = "Sarnies, Charoen Krung";
    retitled.trips[0]!.days[0]!.stops[1]!.location = { ...locationFactory.build(), lat: 1, lng: 1 };
    const r = await importTrips(retitled, owner);

    expect(r.unmatched).toEqual([
      "bangkok: stop in the file with no activity — day 1: Sarnies, Charoen Krung",
      "bangkok: activity with no stop in the file — day 1: Sarnies breakfast",
    ]);
    expect(r.reconciled).toBe(0);
    expect(await eventTypes(tripId)).toEqual(imported);
  });
});
