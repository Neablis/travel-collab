// Populates the local dev DB with a couple of realistic trips, entirely
// through the real command API (POST /api/trips/:id/commands) — never a
// direct DB write. This is deliberate, not a shortcut: the app is
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
// The seed payloads below are plain objects, not validated against
// @tc/contracts at authoring time (this directory's other scripts are all
// dependency-free ESM — see db-reset.mjs — and pulling in a TS/schema
// toolchain just for this felt like more machinery than a dev-convenience
// script warrants). Instead, drift protection is structural:
//   1. Every command is POSTed to the REAL running server, which validates
//      it against the REAL, current @tc/contracts Zod schemas before
//      accepting it — the exact same validation a real user's request goes
//      through. There is no separate copy of the rules to fall out of sync.
//   2. `api()` below throws on any non-OK response, including the server's
//      own validation error message — a renamed/removed/retyped field fails
//      the very next time this script runs, loudly, not silently.
//   3. If you add or change a command in packages/contracts, re-run this
//      script as part of that change (docs/guidelines/connecting-the-parts.md
//      "Changing a contract" says the same) — it's the cheapest smoke test
//      available for "does this still work end to end."
// What this does NOT catch: a new field the schema still accepts but that a
// feature now depends on for realistic data (e.g. a future required-looking
// field seeded here as absent). That's a content gap, not a schema
// mismatch — no automated check can substitute for updating the seed data
// itself when a new feature needs new kinds of fixtures.

import { randomUUID } from "node:crypto";

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
async function devSignIn(baseUrl, username) {
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

function readSetCookie(res, name) {
  // Node's fetch (undici) exposes multiple Set-Cookie headers via
  // getSetCookie() — a plain res.headers.get("set-cookie") would only see
  // the first one, and dev-login's response sets several.
  const cookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const match = cookies.find((c) => c.startsWith(`${name}=`));
  return match?.split(";")[0];
}

// ---- thin API helpers --------------------------------------------------

async function api(cookie, method, path, body) {
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

const createTrip = (cookie, name) => api(cookie, "POST", "/api/trips", { name: `${SEED_PREFIX}${name}` });
const cmd = (cookie, tripId, command) => api(cookie, "POST", `/api/trips/${tripId}/commands`, { ...command, tripId });

// ---- idempotency: clear out any trips this script created before ------

async function deletePriorSeedTrips(cookie) {
  const { trips } = await api(cookie, "GET", "/api/trips");
  const prior = trips.filter((t) => t.name.startsWith(SEED_PREFIX));
  for (const trip of prior) {
    await cmd(cookie, trip.tripId, { type: "DeleteTrip" });
  }
  if (prior.length > 0) console.log(`cleared ${prior.length} trip(s) from a previous run`);
}

// ---- date helpers --------------------------------------------------
// Offsets from "today" (not fixed calendar dates) so the seeded trips always
// read as upcoming, however long it's been since this script was last run.

function isoDateInDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---- seed content --------------------------------------------------

async function seedRochesterTrip(cookie) {
  const { tripId } = await createTrip(cookie, "Rochester to Niagara");
  const newDayIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const { detail } = await cmd(cookie, tripId, {
    type: "SetTripDates",
    startDate: isoDateInDays(21),
    endDate: isoDateInDays(24),
    newDayIds,
  });
  const [day1, day2, , day4] = detail.days; // day3 is left empty on purpose (exercises that sparkline case)

  // Currency defaults to USD already (packages/domain/src/trip/evolve.ts) —
  // no SetTripCurrency needed for a USD trip; the domain rejects a same-
  // value command as a no-op (exactly the drift-detection this script
  // relies on: this exact line 400'd until the redundant call was removed).
  await cmd(cookie, tripId, { type: "SetTripBudget", budget: { amountMinor: 40000, currency: "USD" } });

  const activities = [
    {
      day: day1.dayId,
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
      day: day1.dayId,
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
      day: day2.dayId,
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
      day: day4.dayId,
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
  for (const a of activities) await addActivity(cookie, tripId, a);

  // One unscheduled item left in the backlog — real trips rarely have every
  // stop assigned to a day immediately.
  await cmd(cookie, tripId, {
    type: "AddActivity",
    activityId: randomUUID(),
    title: "Souvenir shopping",
  });
}

async function seedPortlandTrip(cookie) {
  const { tripId } = await createTrip(cookie, "Portland Weekend");
  const newDayIds = [randomUUID(), randomUUID()];
  const { detail } = await cmd(cookie, tripId, {
    type: "SetTripDates",
    startDate: isoDateInDays(60),
    endDate: isoDateInDays(61),
    newDayIds,
  });
  const [day1, day2] = detail.days;

  const activities = [
    {
      day: day1.dayId,
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
      day: day1.dayId,
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
      day: day2.dayId,
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
  for (const a of activities) await addActivity(cookie, tripId, a);
}

async function addActivity(cookie, tripId, a) {
  const activityId = randomUUID();
  await cmd(cookie, tripId, {
    type: "AddActivity",
    activityId,
    title: a.title,
    timeWindow: { start: a.start, end: a.end },
    location: { name: a.place, city: a.city, lat: a.lat, lng: a.lng, countryCode: a.country },
    ...(a.costMinor !== undefined ? { cost: { amountMinor: a.costMinor, currency: "USD" } } : {}),
  });
  await cmd(cookie, tripId, { type: "MoveActivity", activityId, toDayId: a.day, position: 0 });
}

// ---- run --------------------------------------------------------------

async function main() {
  console.log(`Seeding ${BASE_URL} as "${DEV_USER}"...`);
  const cookie = await devSignIn(BASE_URL, DEV_USER);
  await deletePriorSeedTrips(cookie);
  await seedRochesterTrip(cookie);
  await seedPortlandTrip(cookie);
  console.log("Seeded 2 trips: \"Rochester to Niagara\" (4 days, one intentionally empty) and \"Portland Weekend\" (2 days).");
}

main().catch((err) => {
  console.error(`\nseed failed: ${err.message}`);
  process.exit(1);
});
