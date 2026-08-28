// Populates the local dev DB with a couple of realistic trips, entirely
// through the real command API (POST /api/trips/:id/commands, and its batch
// sibling /commands/batch — see `batch` below) — never a direct DB write.
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
// Env overrides: BASE_URL (default http://localhost:3001), SEED_USER
// (default "alice" — any string works, AUTH_DEV_LOGIN mints a user for it).
//
// --- Preventing drift (why this script won't silently rot) ---
// `cmd()`'s command parameter is typed against @tc/contracts's TripCommand
// (below), so a renamed/removed/retyped command field fails `tsc --noEmit`
// (part of `pnpm check`) before this script ever runs, not just at seed
// time. This directory's other scripts stay dependency-free ESM (see
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
//   2. `api()` below throws on any non-OK response, including the server's
//      own validation error message — a renamed/removed/retyped field fails
//      the very next time this script runs, loudly, not silently. One caveat
//      since batching (`batch` below): a rejected batch reports the first
//      command that failed, and the whole batch is rolled back with it, so
//      the error names one command out of a day's worth rather than being
//      the only command in flight. Still loud, slightly less precise.
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
import type { ActivityKind, ActivityTag, BatchableCommand, TripCommand } from "@tc/contracts";
import { JAPAN_TRIP_NAME, japanTripCommandGroups } from "@tc/fixtures";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3001";
const DEV_USER = process.env.SEED_USER ?? "alice";

// Every trip this script creates is tagged with this prefix so re-running it
// is idempotent (deletePriorSeedTrips below) instead of piling up duplicates
// — and so it's obvious in the UI which trips are seed data, not something a
// person was actually working on.
const SEED_PREFIX = "[Seed] ";

// ---- auth: dev-login without a browser -------------------------------
// AUTH_DEV_LOGIN's Credentials provider (apps/web/src/server/auth.ts) is
// normally driven by a real browser (e2e/helpers.ts's signInAsDevUser),
// which handles CSRF + cookies for you. Replicated by hand here: NextAuth
// v5's CSRF dance is (1) GET /api/auth/csrf for a token + csrf cookie, (2)
// POST that token + username to the provider's own callback URL with the
// csrf cookie attached, (3) the response sets a session cookie, used for
// every request after. If this step starts failing, check first whether a
// NextAuth major-version bump renamed its cookies (currently the `authjs.*`
// prefix, v5's convention — v4 used `next-auth.*`) before assuming the rest
// of this script is broken.
async function devSignIn(baseUrl: string, username: string): Promise<string> {
  const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
  const csrfCookie = readSetCookie(csrfRes, "authjs.csrf-token");
  if (!csrfCookie) {
    throw new Error(
      "no authjs.csrf-token cookie in /api/auth/csrf response — is the dev server running with AUTH_DEV_LOGIN=true?",
    );
  }
  const { csrfToken } = await csrfRes.json();

  const callbackRes = await fetch(`${baseUrl}/api/auth/callback/dev-login`, {
    method: "POST",
    redirect: "manual", // a successful sign-in 302s; we only need its Set-Cookie
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: csrfCookie },
    body: new URLSearchParams({ username, csrfToken, callbackUrl: baseUrl, json: "true" }),
  });
  const sessionCookie = readSetCookie(callbackRes, "authjs.session-token");
  if (!sessionCookie) {
    throw new Error(
      `dev-login didn't return a session cookie (status ${callbackRes.status}) — check AUTH_DEV_LOGIN is "true" on the running server`,
    );
  }
  return sessionCookie;
}

function readSetCookie(res: Response, name: string): string | undefined {
  // Node's fetch (undici) exposes multiple Set-Cookie headers via
  // getSetCookie() — a plain res.headers.get("set-cookie") would only see
  // the first one, and dev-login's response sets several.
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  const match = cookies.find((c) => c.startsWith(`${name}=`));
  return match?.split(";")[0];
}

// ---- thin API helpers --------------------------------------------------

async function api(cookie: string, method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

const createTrip = (cookie: string, name: string) => api(cookie, "POST", "/api/trips", { name: `${SEED_PREFIX}${name}` });

// Plain Omit<Union, K> collapses a discriminated union to its members'
// common fields, which is not what excess-property-checking against a
// literal needs here — distribute it over each member instead.
type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;

// The real command endpoint mints tripId server-side on CreateTrip but every
// other command needs it supplied — matches every TripCommand's own shape.
const cmd = (cookie: string, tripId: string, command: DistributiveOmit<TripCommand, "tripId">) =>
  api(cookie, "POST", `/api/trips/${tripId}/commands`, { ...command, tripId });

// The same command vocabulary, sent as ONE request through the batch endpoint
// (`/commands/batch` -> executeTripCommandBatch), which decides each command in
// order against the state the previous one produced. Only BatchableCommand
// members are accepted — notably NOT CreateTrip or DeleteTrip, which is why
// those two still go through `cmd`/`createTrip` above.
//
// Why this exists: the seed used to send ~200 single-command POSTs and took
// 56.5s end to end (measured 2026-08-26). Each request re-reads and re-folds
// the whole event stream, so the cost grew with every stop already seeded.
//
// GRANULARITY IS DELIBERATE, and is the reason this isn't one batch per trip.
// One batch == one history entry (commands.ts:179 appends everything under a
// single batchId), and a batch's description is every event's description
// joined with "; " (packages/domain/src/trip/history.ts's describeUserBatch).
// Seeding a whole trip in one call would therefore leave the History popover —
// a real designed surface, and one the demo data exists to exercise — showing
// a single entry with two hundred semicolon-joined clauses. Batching per day
// keeps each entry readable ("Added Coffee at Onibus; Moved Coffee at Onibus
// to Day 2; ...") and arguably more lifelike than 200 atomic entries: it reads
// as someone planning a day at a time.
const batch = (cookie: string, tripId: string, commands: DistributiveOmit<BatchableCommand, "tripId">[]) =>
  commands.length === 0
    ? Promise.resolve(undefined)
    : api(cookie, "POST", `/api/trips/${tripId}/commands/batch`, {
        commands: commands.map((c) => ({ ...c, tripId })),
      });

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
// see `batch` above on why that decision matters.
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
  console.log(
    "Seeded 3 trips: \"Japan: Tokyo → Kyoto → Osaka\" (14 days, 68 stops, 4 backlog items), " +
      "\"Rochester to Niagara\" (4 days, one intentionally empty), and \"Portland Weekend\" (2 days).",
  );
}

main().catch((err) => {
  console.error(`\nseed failed: ${err.message}`);
  process.exit(1);
});
