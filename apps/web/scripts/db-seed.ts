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
// This script's own curated content (three named, realistic demo trips —
// Japan, Rochester, Portland) is intentionally NOT routed through
// `@tc/factories`'s `commandsFor` (ADR-020): `commandsFor`'s generic named
// scenarios (emptyTrip, overBudgetTrip, ...) exist for tests and e2e, where
// "a" over-budget trip is the point; this script's demo trips are specific,
// narratively real content ("Japan: Tokyo -> Kyoto -> Osaka", 68 stops) that
// no generic scenario name could capture without flattening it into
// placeholder data. Both draw on the same TripCommand vocabulary; only the
// content differs.

import { randomUUID } from "node:crypto";
import type { ActivityKind, ActivityTag, BatchableCommand, TripCommand } from "@tc/contracts";

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

// Folds `who` into the notes field. It is the last piece of stop metadata the
// domain doesn't model — Access & Membership's data, not an activity field
// (see japanTripImporter.ts's DROPPED_SEED_FIELDS) — and "all" is the
// uninteresting default, omitted so notes stay quiet for the common case.
//
// `status` used to be folded in here too, which is why cards read "(transit)"
// and "(idea)". M18 gave it a real home: AddActivity.kind. Do not put it back.
function buildNotes(note?: string, who?: string | string[]): string | undefined {
  const parts: string[] = [];
  if (note) parts.push(note);
  if (who && who !== "all") parts.push(`(${Array.isArray(who) ? who.join(" + ") : who})`);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

type SeedStop = {
  day: string;
  title: string;
  start: string;
  end: string;
  place: string;
  city: string;
  // Sub-settlement locality, straight onto Location.area (KI-35). Optional
  // because the Rochester trip's stops have no neighbourhood worth naming;
  // the Japan rows all carry one.
  area?: string;
  lat: number;
  lng: number;
  country: string;
  kind?: ActivityKind; // omitted = "planned"
  tags?: ActivityTag[]; // omitted = none
  costMinor?: number;
  notes?: string;
};

// A longer, denser trip: 14 days, 6 cities, 68 stops plus a backlog, adapted
// from a JSON export of the Trip Planner redesign prototype. Costs are the
// export's derived seed values (whole USD, converted to minor units below).
// Coordinates aren't in the export — added here from general knowledge of
// these (real, well-known) landmarks, since MapLens/TimelineLens need them.
// Seeded first and with the soonest start date so it's the trip GET
// /api/trips returns first — the homepage hero picks trips[0] with no
// sort of its own (apps/web/src/app/page.tsx), so insertion order is what
// decides "next trip" today.
async function seedJapanTrip(cookie: string): Promise<void> {
  const { tripId } = await createTrip(cookie, "Japan: Tokyo → Kyoto → Osaka");
  const dayIds = Array.from({ length: 14 }, () => randomUUID());
  // `newDayIds` is consumed in order (decide.ts:170 emits one DayAdded per id,
  // evolve.ts:60 appends each to `days`), and this trip has no days yet — so
  // dayIds[i] IS day i+1, and there is no need to round-trip the response just
  // to read back ids this script minted.
  await batch(cookie, tripId, [
    { type: "SetTripDates", startDate: isoDateInDays(10), endDate: isoDateInDays(23), newDayIds: dayIds },
    { type: "SetTripBudget", budget: { amountMinor: 1_640_000, currency: "USD" } },
  ]);

  const stops = [
    // Day 1 — Tokyo
    { day: 1, title: "Land at Haneda", tags: [], place: "HND Terminal 3", area: "Ōta", city: "Tokyo", lat: 35.5494, lng: 139.7798, start: "14:30", end: "16:00", status: "transit", cost: 310 },
    { day: 1, title: "Check in at Trunk Hotel", tags: ["lodging"], place: "Trunk Hotel", area: "Shibuya", city: "Tokyo", lat: 35.6684, lng: 139.704, start: "17:00", end: "17:30", status: "booked", note: "Bags to the room, then straight out — nobody sleeps yet.", cost: 385 },
    { day: 1, title: "Dinner at Gonpachi", tags: ["meal"], place: "Gonpachi Nishiazabu", area: "Nishi-Azabu", city: "Tokyo", lat: 35.6564, lng: 139.7238, start: "19:00", end: "20:30", status: "hold", cost: 295 },
    { day: 1, title: "Nightcap at Bar Trench", tags: ["meal"], place: "Bar Trench", area: "Ebisu", city: "Tokyo", lat: 35.6467, lng: 139.7133, start: "21:00", end: "22:30", status: "idea", who: ["Sam K", "Jonah M"] },

    // Day 2 — Tokyo
    { day: 2, title: "Coffee at Onibus", tags: ["meal"], place: "Onibus Coffee", area: "Nakameguro", city: "Tokyo", lat: 35.6435, lng: 139.6987, start: "07:30", end: "08:15", cost: 70 },
    { day: 2, title: "teamLab Planets", tags: ["ticketed"], place: "teamLab Planets", area: "Toyosu", city: "Tokyo", lat: 35.6469, lng: 139.793, start: "09:00", end: "11:00", status: "booked", note: "Timed entry 9 am. Barefoot — no tights.", cost: 355 },
    { day: 2, title: "Lunch at Tsukiji Outer Market", tags: ["meal"], place: "Tsukiji Outer Market", area: "Tsukiji", city: "Tokyo", lat: 35.6654, lng: 139.7707, start: "12:00", end: "13:00", cost: 10 },
    { day: 2, title: "Hama-rikyū Gardens", tags: ["outdoors"], place: "Hama-rikyū Gardens", area: "Hamamatsuchō", city: "Tokyo", lat: 35.6597, lng: 139.7633, start: "14:00", end: "16:00", who: ["Priya R", "Mei T"], cost: 15 },
    { day: 2, title: "Yakitori at Torishiki", tags: ["meal"], place: "Torishiki", area: "Meguro", city: "Tokyo", lat: 35.6339, lng: 139.7157, start: "19:00", end: "21:00", status: "hold", cost: 315 },

    // Day 3 — Tokyo
    { day: 3, title: "Breakfast at Bread & Espresso", tags: ["meal"], place: "Bread & Espresso", area: "Omotesandō", city: "Tokyo", lat: 35.6658, lng: 139.7128, start: "08:00", end: "09:00", cost: 85 },
    { day: 3, title: "Meiji Jingū", tags: ["outdoors"], place: "Meiji Jingū", area: "Yoyogi", city: "Tokyo", lat: 35.6764, lng: 139.6993, start: "09:30", end: "11:30", cost: 5 },
    { day: 3, title: "Lunch at Afuri", tags: ["meal"], place: "Afuri", area: "Harajuku", city: "Tokyo", lat: 35.6702, lng: 139.7026, start: "12:30", end: "14:00", cost: 90 },
    { day: 3, title: "Shimokitazawa record shops", tags: [], place: "Shimokitazawa", area: "Setagaya", city: "Tokyo", lat: 35.6613, lng: 139.6674, start: "15:00", end: "17:30", who: ["Jonah M"], cost: 20 },
    { day: 3, title: "Dinner at Den", tags: ["meal"], place: "Den", area: "Jingūmae", city: "Tokyo", lat: 35.6688, lng: 139.7096, start: "19:30", end: "21:30", status: "booked", note: "Held with a card. 48h cancellation.", cost: 260 },

    // Day 4 — Nikkō (day trip from Tokyo)
    { day: 4, title: "Limited Express to Nikkō", tags: [], place: "Tobu Asakusa Station", area: "Asakusa", city: "Nikkō", lat: 35.7107, lng: 139.8017, start: "07:10", end: "09:10", status: "transit", cost: 100 },
    { day: 4, title: "Tōshō-gū Shrine", tags: ["outdoors"], place: "Tōshō-gū", area: "Nikkō", city: "Nikkō", lat: 36.7581, lng: 139.5994, start: "10:00", end: "12:30", cost: 20 },
    { day: 4, title: "Lunch at Hippari Dako", tags: ["meal"], place: "Hippari Dako", area: "Nikkō", city: "Nikkō", lat: 36.7508, lng: 139.5989, start: "13:00", end: "14:00", cost: 65 },
    { day: 4, title: "Kegon Falls", tags: ["outdoors"], place: "Kegon Falls", area: "Chūzenji", city: "Nikkō", lat: 36.7383, lng: 139.4994, start: "15:00", end: "16:30", cost: 15 },
    { day: 4, title: "Train back to Tokyo", tags: [], place: "Tobu Nikkō Station", area: "Nikkō", city: "Nikkō", lat: 36.7578, lng: 139.6122, start: "18:30", end: "20:30", status: "transit", cost: 135 },

    // Day 5 — Tokyo
    { day: 5, title: "Coffee at Koffee Mameya", tags: ["meal"], place: "Koffee Mameya", area: "Omotesandō", city: "Tokyo", lat: 35.6674, lng: 139.7104, start: "09:00", end: "10:00", cost: 65 },
    { day: 5, title: "Nezu Museum", tags: ["ticketed"], place: "Nezu Museum", area: "Minami-Aoyama", city: "Tokyo", lat: 35.6641, lng: 139.7168, start: "10:30", end: "13:00", who: ["Priya R", "Mei T"], cost: 95 },
    { day: 5, title: "Lunch at Kagari", tags: ["meal"], place: "Kagari", area: "Ginza", city: "Tokyo", lat: 35.6717, lng: 139.765, start: "12:30", end: "14:00", cost: 45 },
    { day: 5, title: "Itoya and Ginza Six", tags: [], place: "Itoya", area: "Ginza", city: "Tokyo", lat: 35.6733, lng: 139.7644, start: "16:00", end: "18:00", cost: 125 },
    { day: 5, title: "Omakase at Sushi Yoshitake", tags: ["meal"], place: "Sushi Yoshitake", area: "Ginza", city: "Tokyo", lat: 35.671, lng: 139.7638, start: "20:00", end: "22:00", status: "hold", note: "Concierge is chasing this one.", cost: 155 },

    // Day 6 — Hakone (day trip / overnight from Tokyo)
    { day: 6, title: "Romancecar to Hakone-Yumoto", tags: [], place: "Shinjuku Station", area: "Shinjuku", city: "Hakone", lat: 35.6896, lng: 139.7006, start: "08:20", end: "09:55", status: "transit", cost: 35 },
    { day: 6, title: "Hakone Open-Air Museum", tags: ["ticketed", "outdoors"], place: "Open-Air Museum", area: "Ninotaira", city: "Hakone", lat: 35.2444, lng: 139.0464, start: "10:30", end: "12:30", status: "booked", cost: 475 },
    { day: 6, title: "Lunch at Bakery & Table", tags: ["meal"], place: "Bakery & Table", area: "Motohakone", city: "Hakone", lat: 35.201, lng: 139.0269, start: "13:00", end: "14:00", cost: 95 },
    { day: 6, title: "Check in at Gora Kadan", tags: ["lodging"], place: "Gora Kadan", area: "Gōra", city: "Hakone", lat: 35.2379, lng: 139.0561, start: "16:40", end: "17:10", status: "booked", note: "Check-in closes at 16:00 — this is the conflict the assistant flagged.", cost: 250 },
    { day: 6, title: "Kaiseki dinner at the ryokan", tags: ["meal"], place: "Gora Kadan", area: "Gōra", city: "Hakone", lat: 35.2379, lng: 139.0561, start: "18:30", end: "20:30", status: "booked", cost: 320 },

    // Day 7 — Kyoto (arrival from Hakone; 4-night stay begins)
    { day: 7, title: "Shinkansen Odawara → Kyoto", tags: [], place: "Odawara Station", area: "Odawara", city: "Kyoto", lat: 35.2547, lng: 139.1546, start: "09:30", end: "11:45", status: "transit", cost: 30 },
    { day: 7, title: "Lunch at Honke Owariya", tags: ["meal"], place: "Honke Owariya", area: "Nakagyō", city: "Kyoto", lat: 35.0149, lng: 135.7592, start: "12:30", end: "13:30", cost: 20 },
    { day: 7, title: "Nijō Castle", tags: ["ticketed"], place: "Nijō Castle", area: "Nakagyō", city: "Kyoto", lat: 35.0142, lng: 135.7481, start: "14:30", end: "16:30", cost: 75 },
    { day: 7, title: "Check in at Nazuna Gosho", tags: ["lodging"], place: "Nazuna Kyoto Gosho", area: "Kamigyō", city: "Kyoto", lat: 35.0246, lng: 135.7601, start: "17:00", end: "17:30", status: "booked", cost: 305 },
    { day: 7, title: "Dinner at Gion Nanba", tags: ["meal"], place: "Gion Nanba", area: "Gion", city: "Kyoto", lat: 35.0037, lng: 135.7756, start: "19:00", end: "21:00", status: "idea", note: "No reservation yet. Priya wants kaiseki here." },

    // Day 8 — Kyoto
    { day: 8, title: "Fushimi Inari at dawn", tags: ["outdoors"], place: "Fushimi Inari Taisha", area: "Fushimi", city: "Kyoto", lat: 34.9671, lng: 135.7727, start: "06:30", end: "08:00", note: "Go before 7 am or the gates are shoulder to shoulder.", cost: 65 },
    { day: 8, title: "Breakfast at % Arabica", tags: ["meal"], place: "% Arabica", area: "Higashiyama", city: "Kyoto", lat: 34.9998, lng: 135.7801, start: "09:00", end: "10:00", cost: 70 },
    { day: 8, title: "Kiyomizu-dera and Sannenzaka", tags: ["outdoors"], place: "Kiyomizu-dera", area: "Higashiyama", city: "Kyoto", lat: 34.9949, lng: 135.785, start: "10:30", end: "12:30", cost: 80 },
    { day: 8, title: "Lunch at Omen Kodaiji", tags: ["meal"], place: "Omen Kodaiji", area: "Higashiyama", city: "Kyoto", lat: 35.0013, lng: 135.7809, start: "12:00", end: "13:15", cost: 30 },
    { day: 8, title: "Nishiki Market", tags: ["meal"], place: "Nishiki Market", area: "Nakagyō", city: "Kyoto", lat: 35.005, lng: 135.765, start: "16:00", end: "17:30", who: ["Jonah M", "Mei T"], cost: 20 },
    { day: 8, title: "Dinner at Giro Giro Hitoshina", tags: ["meal"], place: "Giro Giro Hitoshina", area: "Shimogyō", city: "Kyoto", lat: 35.0028, lng: 135.7683, start: "19:30", end: "21:30", status: "hold", cost: 90 },

    // Day 9 — Kyoto
    { day: 9, title: "Breakfast at Walden Woods", tags: ["meal"], place: "Walden Woods", area: "Shimogyō", city: "Kyoto", lat: 34.9925, lng: 135.7423, start: "08:00", end: "09:00", cost: 30 },
    { day: 9, title: "Arashiyama and Tenryū-ji", tags: ["outdoors"], place: "Tenryū-ji", area: "Arashiyama", city: "Kyoto", lat: 35.0159, lng: 135.6742, start: "09:45", end: "12:00", cost: 85 },
    { day: 9, title: "Lunch at Yoshida-ya", tags: ["meal"], place: "Yoshida-ya", area: "Arashiyama", city: "Kyoto", lat: 35.0116, lng: 135.6786, start: "12:30", end: "13:30", cost: 55 },
    { day: 9, title: "Tea at Ippodo Kaboku", tags: ["meal"], place: "Ippodo Kaboku", area: "Nakagyō", city: "Kyoto", lat: 35.0107, lng: 135.7601, start: "15:00", end: "16:30", who: ["Priya R"], cost: 80 },
    { day: 9, title: "Dinner at Kichi Kichi", tags: ["meal"], place: "Kichi Kichi", area: "Pontochō", city: "Kyoto", lat: 35.0069, lng: 135.771, start: "18:00", end: "19:30", status: "booked", cost: 495 },

    // Day 10 — Kyoto
    { day: 10, title: "Ginkaku-ji and the Philosopher's Path", tags: ["outdoors"], place: "Ginkaku-ji", area: "Sakyō", city: "Kyoto", lat: 35.027, lng: 135.7982, start: "09:00", end: "11:00", cost: 5 },
    { day: 10, title: "Lunch at Monk", tags: ["meal"], place: "Monk", area: "Sakyō", city: "Kyoto", lat: 35.0271, lng: 135.7936, start: "11:30", end: "12:30", status: "booked", cost: 500 },
    { day: 10, title: "Pottery at Kyoto Handicraft Center", tags: [], place: "Handicraft Center", area: "Sakyō", city: "Kyoto", lat: 35.0202, lng: 135.7784, start: "14:00", end: "16:00", who: ["Mei T"], cost: 30 },

    // Day 11 — Osaka (arrival from Kyoto; 2-night stay begins)
    { day: 11, title: "Train Kyoto → Osaka", tags: [], place: "Kyoto Station", area: "Shimogyō", city: "Osaka", lat: 34.9858, lng: 135.7588, start: "10:00", end: "10:40", status: "transit", cost: 190 },
    { day: 11, title: "Check in at Zentis Osaka", tags: ["lodging"], place: "Zentis Osaka", area: "Kita", city: "Osaka", lat: 34.6971, lng: 135.4938, start: "11:30", end: "12:00", status: "booked", cost: 465 },
    { day: 11, title: "Lunch at Harukoma Sushi", tags: ["meal"], place: "Harukoma Sushi", area: "Nakazakichō", city: "Osaka", lat: 34.7043, lng: 135.5064, start: "12:30", end: "14:00", cost: 30 },
    { day: 11, title: "Osaka Castle Park", tags: ["outdoors"], place: "Osaka Castle", area: "Chūō", city: "Osaka", lat: 34.6873, lng: 135.5262, start: "15:00", end: "17:00", cost: 10 },
    { day: 11, title: "Dōtonbori food crawl", tags: ["meal"], place: "Dōtonbori", area: "Chūō", city: "Osaka", lat: 34.6687, lng: 135.5013, start: "19:00", end: "21:30", note: "Five stops, one bite each. Jonah is picking.", cost: 15 },

    // Day 12 — Osaka
    { day: 12, title: "Breakfast at Mel Coffee", tags: ["meal"], place: "Mel Coffee Roasters", area: "Nishi", city: "Osaka", lat: 34.6811, lng: 135.4894, start: "08:30", end: "09:30", cost: 75 },
    { day: 12, title: "Nakanoshima Museum", tags: ["ticketed"], place: "Nakanoshima Museum", area: "Kita", city: "Osaka", lat: 34.6937, lng: 135.4934, start: "10:00", end: "12:00", who: ["Priya R", "Mei T"], cost: 100 },
    { day: 12, title: "Lunch at Kuromon Market", tags: ["meal"], place: "Kuromon Ichiba", area: "Chūō", city: "Osaka", lat: 34.6656, lng: 135.5064, start: "13:00", end: "14:30", cost: 20 },
    { day: 12, title: "Shinsekai and Tsūtenkaku", tags: [], place: "Tsūtenkaku", area: "Naniwa", city: "Osaka", lat: 34.6524, lng: 135.5063, start: "16:00", end: "18:00", cost: 120 },
    { day: 12, title: "Kushikatsu at Yaekatsu", tags: ["meal"], place: "Yaekatsu", area: "Naniwa", city: "Osaka", lat: 34.6529, lng: 135.5083, start: "20:00", end: "22:00", status: "hold", cost: 370 },

    // Day 13 — Naoshima (day trip from Osaka)
    { day: 13, title: "Train and ferry to Naoshima", tags: [], place: "Uno Port", area: "Tamano", city: "Naoshima", lat: 34.4903, lng: 133.9491, start: "07:00", end: "10:00", status: "transit", cost: 130 },
    { day: 13, title: "Chichū Art Museum", tags: ["ticketed"], place: "Chichū Art Museum", area: "Naoshima", city: "Naoshima", lat: 34.459, lng: 133.995, start: "10:30", end: "12:30", status: "booked", note: "Timed ticket 10:30 am. Late arrivals are turned away.", cost: 340 },
    { day: 13, title: "Lunch at Aisunao", tags: ["meal"], place: "Aisunao", area: "Honmura", city: "Naoshima", lat: 34.4565, lng: 134.008, start: "13:00", end: "14:00", cost: 95 },
    { day: 13, title: "Benesse House and Yellow Pumpkin", tags: ["ticketed", "outdoors"], place: "Benesse House", area: "Naoshima", city: "Naoshima", lat: 34.4551, lng: 133.9945, start: "14:30", end: "16:30", cost: 130 },
    { day: 13, title: "Ferry and train back to Osaka", tags: [], place: "Miyanoura Port", area: "Naoshima", city: "Naoshima", lat: 34.4614, lng: 133.9782, start: "17:30", end: "20:30", status: "transit", cost: 180 },

    // Day 14 — Osaka → Tokyo → home. Tagged Tokyo throughout (the day's
    // destination city), matching how days 7 and 11 (the other city-
    // transition days) are tagged with their arrival city rather than
    // split — splitting this one triggered a pile of "same day, ~400km
    // apart" distance warnings between the Osaka-morning and Tokyo-evening
    // stops, which is accurate but noisy for a fixture.
    { day: 14, title: "Breakfast at the hotel", tags: ["meal"], place: "Zentis Osaka", area: "Kita", city: "Tokyo", lat: 34.6971, lng: 135.4938, start: "08:00", end: "08:45", cost: 25 },
    { day: 14, title: "Shinkansen to Tokyo", tags: [], place: "Shin-Osaka Station", area: "Yodogawa", city: "Tokyo", lat: 34.7333, lng: 135.5002, start: "09:30", end: "11:45", status: "transit", cost: 140 },
    { day: 14, title: "Last lunch at Maisen", tags: ["meal"], place: "Tonkatsu Maisen", area: "Omotesandō", city: "Tokyo", lat: 35.6659, lng: 139.7123, start: "12:30", end: "14:00", cost: 40 },
    { day: 14, title: "Transfer to Haneda", tags: [], place: "HND Terminal 3", area: "Ōta", city: "Tokyo", lat: 35.5494, lng: 139.7798, start: "16:30", end: "18:00", status: "booked", cost: 175 },
    { day: 14, title: "Flight home", tags: [], place: "HND Terminal 3", area: "Ōta", city: "Tokyo", lat: 35.5494, lng: 139.7798, start: "20:10", end: "21:00", status: "booked", note: "Check-in opens 5:10 pm.", cost: 160 },
  ];

  await addActivities(
    cookie,
    tripId,
    stops.map((s) => ({
      day: dayIds[s.day - 1]!,
      title: s.title,
      start: s.start,
      end: s.end,
      place: `${s.place}, ${s.area}, ${s.city}, Japan`,
      city: s.city,
      area: s.area,
      lat: s.lat,
      lng: s.lng,
      country: "JP",
      // The seed literals omit `status` for the common case, which is exactly
      // what ActivityKind's "planned" means.
      kind: (s.status ?? "planned") as ActivityKind,
      tags: s.tags as ActivityTag[],
      costMinor: s.cost !== undefined ? Math.round(s.cost * 100) : undefined,
      notes: buildNotes(s.note, s.who),
    })),
  );

  // Unscheduled backlog — ideas raised but not yet placed on a day.
  const backlog = [
    { title: "Kiyomizu-dera at golden hour", place: "Kiyomizu-dera", area: "Higashiyama", city: "Kyoto", lat: 34.9949, lng: 135.785, note: "Priya added it" },
    { title: "Kōenji vintage crawl", place: "Kōenji", area: "Suginami", city: "Tokyo", lat: 35.7057, lng: 139.6497, who: ["Jonah M"], note: "Jonah added it" },
    { title: "Nishiki Market", place: "Nishiki Market", area: "Nakagyō", city: "Kyoto", lat: 35.005, lng: 135.765, note: "From a saved day" },
    { title: "Ghibli Museum, if tickets appear", place: "Ghibli Museum", area: "Mitaka", city: "Tokyo", lat: 35.696, lng: 139.5704, note: "Mei added it", tags: ["ticketed" as const] },
  ];
  // One batch, so the four parked ideas read as one "someone dumped their
  // wishlist in" entry in History rather than four separate ones.
  await batch(
    cookie,
    tripId,
    backlog.map((b) => {
      const notes = buildNotes(b.note, b.who);
      return {
        type: "AddActivity" as const,
        activityId: randomUUID(),
        title: b.title,
        location: { name: `${b.place}, ${b.area}, ${b.city}, Japan`, city: b.city, area: b.area, lat: b.lat, lng: b.lng, countryCode: "JP" },
        kind: "idea" as const,
        ...(b.tags && b.tags.length > 0 ? { tags: b.tags } : {}),
        ...(notes ? { notes } : {}),
      };
    }),
  );
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
