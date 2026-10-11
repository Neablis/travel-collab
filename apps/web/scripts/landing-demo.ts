// Writes one snapshot per demo trip — the slice of `/demo/<slug>` the front
// door draws with real components — and the `/demo` picker's cards, or, with
// `--check`, fails if any committed file differs from a fresh generation.
// Japan's slice is `src/lib/landingDemo.generated.json`, the one the hero reads
// today; every other demo's is `src/lib/landingDemo.<slug>.generated.json`
// (M42 D2); the cards are `src/lib/demoTripCards.generated.json` (D1).
//
//   pnpm --filter web landing:generate   # rewrite the snapshots
//   pnpm landing:verify                  # the drift check CI runs (also inside `pnpm test`)
//
// **Why a script and not an import.** The landing may not fetch (SPEC §14), and
// it and the picker sit behind the lint wall, so neither can reach
// `@/server/demoTrip` or `@tc/domain`. Scripts are outside the wall, as `db-seed.ts` is. This one
// reimplements nothing: the trip is `demoTripDetailFor`, the fold `/demo/<slug>`
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

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { TripDetail } from "@tc/contracts";
import { REFERENCE_START_DATE } from "@tc/fixtures";
import { renderMacro, type BlockPayload, type WidgetContext } from "@tc/pages";
import { cityAccents } from "@/components/pages/cityAccents";
import { DEMO_TRIPS, demoTripBySlug } from "@/lib/demoTrip";
import type { LandingDemo } from "@/lib/landingDemo";
import { demoTripCards, demoTripDetailFor } from "@/server/demoTrip";
import { buildTripGlobals } from "@/server/tripGlobals";

/** Where demo `slug`'s snapshot is committed. Japan's keeps the name it had before there were others. */
export function snapshotPath(slug: string): string {
  const file = slug === "japan" ? "landingDemo.generated.json" : `landingDemo.${slug}.generated.json`;
  return fileURLToPath(new URL(`../src/lib/${file}`, import.meta.url));
}

/**
 * Japan's days, chosen by hand. The Timeline panel's is fixture Day 7, the
 * arrival in Kyoto: the hero's pill for that panel already reads "Day 7", and
 * the day carries every way a block can look on the river — a train leg,
 * planned stops, a check-in and a dinner still marked Maybe. The Notebook
 * panel's day card is fixture Day 5, which its pill already names.
 */
const JAPAN_DAYS = { river: 6, notebook: 4 };

/**
 * Any other demo's days, by a rule so a new bundle needs no entry here: the
 * river is the fullest day after the first that has a city and no conflict
 * (the first is usually an arrival), and the notebook card is the earliest
 * other such day.
 */
function chooseDays(trip: TripDetail, globals: ReturnType<typeof buildTripGlobals>): { river: number; notebook: number } {
  const usable = trip.days
    .map((day, index) => ({ index, stops: day.activityIds.length }))
    .filter(({ index }) => index > 0 && globals.days[index]!.cities.length > 0 && conflictsOn(trip, index).length === 0);
  const river = usable.reduce<(typeof usable)[number] | undefined>((best, day) => (best === undefined || day.stops > best.stops ? day : best), undefined);
  const notebook = usable.find(({ index }) => index !== river?.index);
  if (river === undefined || notebook === undefined) throw new Error(`landing demo: ${trip.name} has no two days the hero can draw`);
  return { river: river.index, notebook: notebook.index };
}

function conflictsOn(trip: TripDetail, dayIndex: number) {
  const day = trip.days[dayIndex]!;
  return trip.conflicts.filter((c) => c.subjects.some((id) => day.activityIds.includes(id)));
}

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

/** Demo `slug`'s slice, folded and resolved exactly as `/demo/<slug>` and a notebook would, with no calendar dates. */
export function buildLandingDemo(slug: string): LandingDemo {
  const demo = demoTripBySlug(slug);
  if (demo === undefined) throw new Error(`landing demo: ${slug} is not a demo`);
  const folded = demoTripDetailFor(demo.tripId, REFERENCE_START_DATE);
  const trip: TripDetail = { ...folded, days: folded.days.map((day) => ({ ...day, date: null })) };
  const globals = buildTripGlobals(trip);
  const accents = cityAccents(trip);
  const { river: riverIndex, notebook: notebookIndex } = slug === "japan" ? JAPAN_DAYS : chooseDays(trip, globals);

  const day = trip.days[riverIndex]!;
  // The hero draws no conflict marks. If this day ever gains one, the panel
  // would be hiding something the board shows, so stop here and make whoever
  // changed the fixture decide what the landing should say.
  const conflicted = conflictsOn(trip, riverIndex);
  if (conflicted.length > 0) {
    throw new Error(`landing demo: Day ${riverIndex + 1} has conflicts the hero does not draw: ${conflicted.map((c) => c.id).join(", ")}`);
  }
  // The city the day ends in: a travel day's cities are in time order, and the
  // panel is about where the group is for the rest of it.
  const city = globals.days[riverIndex]!.cities.at(-1);
  if (city === undefined) throw new Error(`landing demo: Day ${riverIndex + 1} names no city`);

  const ctx: WidgetContext = { trip, page: { tripId: demo.tripId }, user: null, globals, today: null };

  return {
    currency: trip.currency,
    accents: Object.fromEntries(trip.days.map((d) => [d.dayId, accents.ofDayId(d.dayId)])),
    river: {
      dayId: day.dayId,
      ordinal: riverIndex + 1,
      city,
      activityIds: day.activityIds,
      activities: Object.fromEntries(day.activityIds.map((id) => [id, trip.activities[id]!])),
    },
    notebook: {
      strip: resolveBlock(ctx, "trip.strip", {}, "trip-strip"),
      day: resolveBlock(ctx, "day.detail", { day: { kind: "index", index: notebookIndex } }, "itinerary-day"),
    },
  };
}

/** A snapshot file's exact bytes: what the generator writes and what the verify step compares. */
export function serializeLandingDemo(demo: unknown): string {
  return `${JSON.stringify(demo, null, 2)}\n`;
}

/** Where the `/demo` picker's cards are committed. */
export const CARDS_PATH = fileURLToPath(new URL("../src/lib/demoTripCards.generated.json", import.meta.url));

/** Every file this script owns, with the bytes a fresh generation gives it. */
export function generatedFiles(): { path: string; fresh: string }[] {
  return [
    ...DEMO_TRIPS.map(({ slug }) => ({ path: snapshotPath(slug), fresh: serializeLandingDemo(buildLandingDemo(slug)) })),
    { path: CARDS_PATH, fresh: serializeLandingDemo(demoTripCards()) },
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  let stale = false;
  for (const { path, fresh } of generatedFiles()) {
    if (!check) {
      writeFileSync(path, fresh);
      console.log(`wrote ${path} (${Buffer.byteLength(fresh)} bytes)`);
    } else if (!existsSync(path) || readFileSync(path, "utf8") !== fresh) {
      console.error(`landing:verify — ${path} is missing or stale: a demo trip or a resolver changed what it holds.`);
      stale = true;
    } else {
      console.log(`landing:verify OK ${path} (${Buffer.byteLength(fresh)} bytes)`);
    }
  }
  if (stale) {
    console.error("Regenerate with `pnpm --filter web landing:generate` and commit the result.");
    process.exit(1);
  }
}
