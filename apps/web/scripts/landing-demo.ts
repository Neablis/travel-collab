// Writes `src/lib/landingDemo.generated.json` — the slice of the `/demo` trip
// the front door's hero draws with real components — or, with `--check`, fails
// if the committed file differs from a fresh generation.
//
//   pnpm --filter web landing:generate   # rewrite the snapshot
//   pnpm landing:verify                  # the drift check CI runs (also inside `pnpm test`)
//
// **Why a script and not an import.** The landing may not fetch (SPEC §14) and
// sits behind the lint wall, so it cannot reach `@/server/demoTrip` or
// `@tc/domain`. Scripts are outside the wall, as `db-seed.ts` is. This one
// reimplements nothing: the trip is `demoTripDetailFor`, the fold `/demo`
// serves; cities are `buildTripGlobals`; colours are `cityAccents`; the
// notebook payloads are `@tc/pages`' own resolvers through `renderMacro`.
//
// **Dates are removed before anything is resolved** (spec §3.2). `/demo` moves
// its dates to stay upcoming, so any date frozen here would go stale. Every
// resolver already has an undated form ("Day 5 · Tokyo · 5 stops"), so
// resolving against the undated trip is the whole of it. The fold still needs
// a start date, and it gets a fixed one so the output is reproducible.
//
// Run with `node --import ./scripts/lib/ts-resolve-register.mjs`, which lets
// Node follow `src/**`'s extensionless imports and the `@/` alias.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { TripDetail } from "@tc/contracts";
import { REFERENCE_START_DATE } from "@tc/fixtures";
import { renderMacro, type BlockPayload, type WidgetContext } from "@tc/pages";
import { cityAccents } from "@/components/pages/cityAccents";
import { DEMO_TRIP_ID } from "@/lib/demoTrip";
import type { LandingDemo } from "@/lib/landingDemo";
import { demoTripDetailFor } from "@/server/demoTrip";
import { buildTripGlobals } from "@/server/tripGlobals";

export const SNAPSHOT_PATH = fileURLToPath(new URL("../src/lib/landingDemo.generated.json", import.meta.url));

/**
 * The Timeline panel's day: fixture Day 7, the arrival in Kyoto. The hero's
 * pill for that panel already reads "Day 7", and the day carries every way a
 * block can look on the river — a train leg, planned stops, a check-in and a
 * dinner still marked Maybe.
 */
const RIVER_DAY_INDEX = 6;
/** The Notebook panel's day card: fixture Day 5, which its pill already names. */
const NOTEBOOK_DAY_INDEX = 4;

function resolveBlock<K extends BlockPayload["kind"]>(
  ctx: WidgetContext,
  name: string,
  params: unknown,
  kind: K,
): Extract<BlockPayload, { kind: K }> {
  const outcome = renderMacro(ctx, name, params);
  if (outcome.status !== "ok" || outcome.rendered.kind !== "block" || outcome.rendered.block.kind !== kind) {
    throw new Error(`landing demo: ${name} did not resolve to a ${kind} block (${JSON.stringify(outcome)})`);
  }
  return outcome.rendered.block as Extract<BlockPayload, { kind: K }>;
}

/** The hero's slice of the demo trip, folded and resolved exactly as `/demo` and a notebook would, with no calendar dates. */
export function buildLandingDemo(): LandingDemo {
  const folded = demoTripDetailFor(REFERENCE_START_DATE);
  const trip: TripDetail = { ...folded, days: folded.days.map((day) => ({ ...day, date: null })) };
  const globals = buildTripGlobals(trip);
  const accents = cityAccents(trip);

  const day = trip.days[RIVER_DAY_INDEX]!;
  // The hero draws no conflict marks. If this day ever gains one, the panel
  // would be hiding something the board shows, so stop here and make whoever
  // changed the fixture decide what the landing should say.
  const conflicted = trip.conflicts.filter((c) => c.subjects.some((id) => day.activityIds.includes(id)));
  if (conflicted.length > 0) {
    throw new Error(`landing demo: Day ${RIVER_DAY_INDEX + 1} has conflicts the hero does not draw: ${conflicted.map((c) => c.id).join(", ")}`);
  }
  // The city the day ends in: a travel day's cities are in time order, and the
  // panel is about where the group is for the rest of it.
  const city = globals.days[RIVER_DAY_INDEX]!.cities.at(-1);
  if (city === undefined) throw new Error(`landing demo: Day ${RIVER_DAY_INDEX + 1} names no city`);

  const ctx: WidgetContext = { trip, page: { tripId: DEMO_TRIP_ID }, user: null, globals, today: null };

  return {
    currency: trip.currency,
    accents: Object.fromEntries(trip.days.map((d) => [d.dayId, accents.ofDayId(d.dayId)])),
    river: {
      dayId: day.dayId,
      ordinal: RIVER_DAY_INDEX + 1,
      city,
      activityIds: day.activityIds,
      activities: Object.fromEntries(day.activityIds.map((id) => [id, trip.activities[id]!])),
    },
    notebook: {
      strip: resolveBlock(ctx, "trip.strip", {}, "trip-strip"),
      day: resolveBlock(ctx, "day.detail", { day: { kind: "index", index: NOTEBOOK_DAY_INDEX } }, "itinerary-day"),
    },
  };
}

/** The snapshot file's exact bytes: what the generator writes and what the verify step compares. */
export function serializeLandingDemo(demo: LandingDemo): string {
  return `${JSON.stringify(demo, null, 2)}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fresh = serializeLandingDemo(buildLandingDemo());
  if (process.argv.includes("--check")) {
    const committed = readFileSync(SNAPSHOT_PATH, "utf8");
    if (committed !== fresh) {
      console.error(
        "landing:verify — src/lib/landingDemo.generated.json is stale: the Japan fixture or a resolver changed what the hero draws.\n" +
          "Regenerate it with `pnpm --filter web landing:generate` and commit the result.",
      );
      process.exit(1);
    }
    console.log(`landing:verify OK (${Buffer.byteLength(fresh)} bytes)`);
  } else {
    writeFileSync(SNAPSHOT_PATH, fresh);
    console.log(`wrote ${SNAPSHOT_PATH} (${Buffer.byteLength(fresh)} bytes)`);
  }
}
