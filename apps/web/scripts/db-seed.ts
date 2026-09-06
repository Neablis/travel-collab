// Populates the local dev DB with a couple of realistic trips, entirely
// through the real command API (POST /api/trips/:id/commands, and its batch
// sibling /commands/batch — see `batch` in ./lib/seed-session.ts) — never a
// direct DB write.
// This is deliberate, not a shortcut: the app is
// event-sourced (packages/domain), so a row inserted straight into
// `trip_details`/`trip_summaries` wouldn't have a matching event and would
// silently diverge from what replay would produce. Going through the API
// means seed data is exactly as valid as anything a real user could create.
//
// Usage:
//   pnpm --filter web dev            # in one terminal
//   pnpm --filter web db:seed        # in another, once the server is up
//
// Env overrides: WEB_BASE_URL, or the older BASE_URL (default
// http://localhost:3001), and SEED_USER (default "alice" — any string works,
// AUTH_DEV_LOGIN mints a user for it).
//
// --- Preventing drift (why this script won't silently rot) ---
// `cmd()`'s command parameter is typed against @tc/contracts's TripCommand
// (in ./lib/seed-session.ts), so a renamed/removed/retyped command field fails
// `tsc --noEmit` (part of `pnpm check`) before this script ever runs, not just
// at seed time. This directory's other scripts stay dependency-free ESM (see
// db-reset.mjs) on purpose; this one is a plain `.ts` file run directly —
// Node's native type-stripping (unflagged since Node 22.18.0 — the repo's
// engines.node floor, root package.json — flagged via
// --experimental-strip-types on older 22.x)
// erases the annotations at load time, so this adds zero new dependencies
// and zero build step, only compile-time checking. Runtime drift protection
// is unchanged and still does the real work:
//   1. Every command is POSTed to the REAL running server, which validates
//      it against the REAL, current @tc/contracts Zod schemas before
//      accepting it — the exact same validation a real user's request goes
//      through. There is no separate copy of the rules to fall out of sync.
//   2. `api()` (./lib/seed-session.ts) throws on any non-OK response,
//      including the server's own validation error message — a
//      renamed/removed/retyped field fails the very next time this script
//      runs, loudly, not silently. One caveat since batching: a rejected batch
//      reports the first command that failed, and the whole batch is rolled
//      back with it, so the error names one command out of a day's worth
//      rather than being the only command in flight. Still loud, slightly less
//      precise.
//   3. If you add or change a command in packages/contracts, re-run this
//      script as part of that change (docs/guidelines/connecting-the-parts.md
//      "Changing a contract" says the same) — it's the cheapest smoke test
//      available for "does this still work end to end."
// What neither catches: a new field the schema still accepts but that a
// feature now depends on for realistic data (e.g. a future required-looking
// field seeded here as absent). That's a content gap, not a schema
// mismatch — no automated check can substitute for updating the seed data
// itself when a new feature needs new kinds of fixtures.
//
// This script's curated content (three named, realistic demo trips — Japan,
// Rochester, Portland) is intentionally NOT routed through `@tc/factories`'s
// `commandsFor` (ADR-020): `commandsFor`'s generic named scenarios (emptyTrip,
// overBudgetTrip, ...) exist for tests and e2e, where "a" over-budget trip is
// the point; these demo trips are specific, narratively real content that no
// generic scenario name could capture without flattening it into placeholder
// data. Both draw on the same TripCommand vocabulary; only the content differs.
//
// The JAPAN trip is no longer written out here at all. It lives in
// `@tc/fixtures` (ADR-030) because three surfaces need the identical trip: this
// script, the preview branch's reset route, and the `japanTrip` factory
// scenario. It used to be duplicated between the first two, which is a drift
// bug that had not gone off yet. Rochester and Portland stay here — nothing
// else consumes them, and they exist to cover shapes Japan does not (an empty
// day, a two-day trip, a non-Japan country code).

import { randomUUID } from "node:crypto";
import type { ActivityKind, ActivityTag, BatchableCommand } from "@tc/contracts";
import { JAPAN_TRIP_NAME, japanTripCommandGroups } from "@tc/fixtures";
// The session and the three calls every seeding script makes, extracted on
// 2026-09-06 so `import-content.ts` shares them rather than replicating the
// NextAuth CSRF dance. See that file's header.
import {
  api,
  batch,
  BASE_URL,
  cmd,
  createTrip,
  devSignIn,
  SEED_PREFIX,
  type DistributiveOmit,
} from "./lib/seed-session.ts";

const DEV_USER = process.env.SEED_USER ?? "alice";

// ---- idempotency: clear out any trips this script created before ------

async function deletePriorSeedTrips(cookie: string): Promise<void> {
  const { trips } = await api(cookie, "GET", "/api/trips");
  const prior = trips.filter((t: { name: string }) => t.name.startsWith(SEED_PREFIX));
  for (const trip of prior) {
    await cmd(cookie, trip.tripId, { type: "DeleteTrip" });
  }
  if (prior.length > 0) console.log(`cleared ${prior.length} trip(s) from a previous run`);
}

// ---- date helpers --------------------------------------------------
// Offsets from "today" (not fixed calendar dates) so the seeded trips always
// read as upcoming, however long it's been since this script was last run.

function isoDateInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---- seed content --------------------------------------------------

type SeedStop = {
  day: string;
  title: string;
  start: string;
  end: string;
  place: string;
  city: string;
  // Sub-settlement locality, straight onto Location.area (KI-35). Optional
  // because the Rochester and Portland stops have no neighbourhood worth
  // naming. (The Japan trip's rows all carry one, but they come from
  // @tc/fixtures now and never pass through this type.)
  area?: string;
  lat: number;
  lng: number;
  country: string;
  kind?: ActivityKind; // omitted = "planned"
  tags?: ActivityTag[]; // omitted = none
  costMinor?: number;
  notes?: string;
};

/**
 * Seeds the Japan demo trip.
 *
 * Its content is NOT here any more: it lives in `@tc/fixtures` (ADR-030),
 * which is also what the preview branch's reset route and the `@tc/factories`
 * japan scenario use. This file used to carry its own copy of the same 68
 * stops; the two agreed only by luck, and only the copy here ever had tags or
 * a full set of coordinates.
 *
 * Seeded first and with the soonest start date so it is the trip
 * `GET /api/trips` returns first — the homepage hero picks `trips[0]` with no
 * sort of its own (`app/(app)/page.tsx`), so insertion order is what decides
 * "next trip" today (KI-34).
 */
async function seedJapanTrip(cookie: string): Promise<void> {
  const { tripId } = await createTrip(cookie, JAPAN_TRIP_NAME);
  // Group by group, not one flat batch: one batch is one History entry, and the
  // grouping (dates+budget, then a day at a time, then the backlog) is defined
  // alongside the fixture itself. See japanTripCommandGroups' own comment.
  for (const group of japanTripCommandGroups(tripId, { startDate: isoDateInDays(10) })) {
    await batch(cookie, tripId, group.map(({ tripId: _tripId, ...command }) => command as DistributiveOmit<BatchableCommand, "tripId">));
  }
}

async function seedRochesterTrip(cookie: string): Promise<void> {
  const { tripId } = await createTrip(cookie, "Rochester to Niagara");
  const newDayIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const [day1, day2, , day4] = newDayIds; // day3 is left empty on purpose (exercises that sparkline case)

  // Currency defaults to USD already (packages/domain/src/trip/evolve.ts) —
  // no SetTripCurrency needed for a USD trip; the domain rejects a same-
  // value command as a no-op (exactly the drift-detection this script
  // relies on: this exact line 400'd until the redundant call was removed).
  await batch(cookie, tripId, [
    { type: "SetTripDates", startDate: isoDateInDays(21), endDate: isoDateInDays(24), newDayIds },
    { type: "SetTripBudget", budget: { amountMinor: 40000, currency: "USD" } },
  ]);

  const activities = [
    {
      day: day1!,
      title: "Coffee at Ugly Duck",
      start: "07:00",
      end: "07:20",
      place: "Ugly Duck Coffee, Rochester, NY, USA",
      city: "Rochester",
      lat: 43.1566,
      lng: -77.6088,
      country: "US",
    },
    {
      day: day1!,
      title: "The Strong Museum of Play",
      start: "09:00",
      end: "12:30",
      place: "The Strong National Museum of Play, Rochester, Monroe County, New York, USA",
      city: "Rochester",
      lat: 43.152643,
      lng: -77.60098,
      country: "US",
      costMinor: 2200,
    },
    {
      day: day2!,
      title: "Lunch at Highland Park Diner",
      start: "12:00",
      end: "13:00",
      place: "Highland Park Diner, Rochester, NY, USA",
      city: "Rochester",
      lat: 43.1339,
      lng: -77.6069,
      country: "US",
      costMinor: 1850,
    },
    {
      day: day4!,
      title: "Niagara Falls day trip",
      start: "08:00",
      end: "16:00",
      place: "Niagara Falls, City of Niagara Falls, Ontario, Canada",
      city: "Niagara Falls",
      lat: 43.0896,
      lng: -79.0849,
      country: "CA",
      costMinor: 4500,
    },
  ];
  await addActivities(cookie, tripId, activities);

  // One unscheduled item left in the backlog — real trips rarely have every
  // stop assigned to a day immediately.
  await batch(cookie, tripId, [
    { type: "AddActivity", activityId: randomUUID(), title: "Souvenir shopping" },
  ]);
}

async function seedPortlandTrip(cookie: string): Promise<void> {
  const { tripId } = await createTrip(cookie, "Portland Weekend");
  const newDayIds = [randomUUID(), randomUUID()];
  const [day1, day2] = newDayIds;
  await batch(cookie, tripId, [
    { type: "SetTripDates", startDate: isoDateInDays(60), endDate: isoDateInDays(61), newDayIds },
  ]);

  const activities = [
    {
      day: day1!,
      title: "Powell's City of Books",
      start: "10:00",
      end: "12:00",
      place: "Powell's City of Books, Portland, Oregon, USA",
      city: "Portland",
      lat: 45.5228,
      lng: -122.6819,
      country: "US",
    },
    {
      day: day1!,
      title: "Pioneer Courthouse Square",
      start: "13:00",
      end: "14:00",
      place: "Pioneer Courthouse Square, Portland, Oregon, USA",
      city: "Portland",
      lat: 45.5189,
      lng: -122.6788,
      country: "US",
    },
    {
      day: day2!,
      title: "Forest Park hike",
      start: "09:00",
      end: "11:30",
      place: "Forest Park, Portland, Oregon, USA",
      city: "Portland",
      lat: 45.5484,
      lng: -122.7278,
      country: "US",
    },
  ];
  await addActivities(cookie, tripId, activities);
}

// The two commands that place one stop on one day: create it (AddActivity with
// no dayId lands it in the backlog), then move it to its day at `position`.
// A pure builder, so a caller can decide how many of these travel together —
// see `batch` in ./lib/seed-session.ts on why that decision matters.
function activityCommands(a: SeedStop, position: number): DistributiveOmit<BatchableCommand, "tripId">[] {
  const activityId = randomUUID();
  return [
    {
      type: "AddActivity",
      activityId,
      title: a.title,
      timeWindow: { start: a.start, end: a.end },
      location: { name: a.place, city: a.city, ...(a.area ? { area: a.area } : {}), lat: a.lat, lng: a.lng, countryCode: a.country },
      kind: a.kind ?? "planned",
      ...(a.tags !== undefined && a.tags.length > 0 ? { tags: a.tags } : {}),
      ...(a.costMinor !== undefined ? { cost: { amountMinor: a.costMinor, currency: "USD" } } : {}),
      ...(a.notes ? { notes: a.notes } : {}),
    },
    { type: "MoveActivity", activityId, toDayId: a.day, position },
  ];
}

/**
 * Places a day's stops in the order they are written above — which, in every
 * list in this file, is chronological.
 *
 * Every call used to pass `position: 0`, so each stop was inserted *before* the
 * one seeded ahead of it and each day ended up reversed. Timeline hid it
 * (`timelineData.ts` sorts by start time), but the Day-columns lens and the
 * calendar cells render `day.activityIds` verbatim — `Column.tsx:121`,
 * `calendarData.ts:104` — so both read a day backwards, 9 pm first.
 * See docs/design-feedback/2026-08-26-design-sync-ui-audit.md (A1).
 *
 * Counting per day rather than passing a large index keeps the emitted
 * commands honest: `position` is the real index the stop lands at, not a value
 * that only works because `insertAt` happens to clamp (`evolve.ts:15-19`).
 */
async function addActivities(cookie: string, tripId: string, stops: SeedStop[]): Promise<void> {
  const byDay = new Map<string, DistributiveOmit<BatchableCommand, "tripId">[]>();
  for (const a of stops) {
    const commands = byDay.get(a.day) ?? [];
    // `commands.length / 2` is the count of stops already queued for this day:
    // activityCommands emits exactly two per stop.
    byDay.set(a.day, [...commands, ...activityCommands(a, commands.length / 2)]);
  }
  // Sequential, not Promise.all: every batch appends to the same event stream
  // at an expected sequence number, so two in flight at once would make one of
  // them lose the optimistic-concurrency check and 409 (commands.ts:181).
  for (const commands of byDay.values()) await batch(cookie, tripId, commands);
}

// ---- the demo library (M11b) -------------------------------------------

/**
 * Seeds the saved days in `@tc/fixtures` — five days across two owners, with
 * their adds ledger.
 *
 * One POST, not a per-day loop, and it deliberately does NOT go through
 * `POST /api/saved-days`. That endpoint takes `{ name, tripId, dayId }` and
 * reads the stops off a trip the caller can see, which is exactly right for a
 * person keeping a day out of their own plan and exactly wrong here: these days
 * belong to two different accounts, and their `source_trip_id` is a snapshot of
 * a trip that is deliberately not in the database (see the fixture's note). So
 * the write is a dev-gated route that reads the fixture SERVER-side and goes
 * through `newSavedDayRow` and `recordAdd` — the same derivation and the same
 * ledger-plus-counter pair a real save and a real add use.
 *
 * Nothing about it needs `SEED_USER`: the fixture names its own owners
 * (`dev-alice`, `dev-bob`), because M11b's gate box wants two people whose
 * numbers could disagree.
 */
async function seedSavedDays(cookie: string): Promise<{ savedDays: number; adds: number }> {
  return api(cookie, "POST", "/api/dev/saved-days");
}

// ---- run --------------------------------------------------------------

async function main() {
  console.log(`Seeding ${BASE_URL} as "${DEV_USER}"...`);
  const cookie = await devSignIn(BASE_URL, DEV_USER);
  await deletePriorSeedTrips(cookie);
  // Japan is seeded first (and dated soonest) so it lands as trips[0] from
  // GET /api/trips — see the comment on seedJapanTrip for why that's what
  // the homepage hero currently keys off of.
  await seedJapanTrip(cookie);
  await seedRochesterTrip(cookie);
  await seedPortlandTrip(cookie);
  const library = await seedSavedDays(cookie);
  console.log(
    "Seeded 3 trips: \"Japan: Tokyo → Kyoto → Osaka\" (14 days, 68 stops, 4 backlog items), " +
      "\"Rochester to Niagara\" (4 days, one intentionally empty), and \"Portland Weekend\" (2 days).",
  );
  console.log(
    `Seeded the library: ${library.savedDays} saved days across five owners ` +
      `(the M11b gate's Japan set plus the starter days — Lisbon, Sintra, ` +
      `Mexico City, Glen Coe, New York, Porto — spread across all four seasons), ` +
      `${library.adds} adds-ledger rows.`,
  );
}

main().catch((err) => {
  console.error(`\nseed failed: ${err.message}`);
  process.exit(1);
});
