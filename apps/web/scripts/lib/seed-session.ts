// The seeding session: dev-login without a browser, plus the three calls every
// seeding script makes against the running server.
//
// **Extracted from `db-seed.ts` on 2026-09-06, when `import-content.ts`
// arrived and needed the same session.** The NextAuth v5 CSRF dance below is
// exactly the kind of thing that must not exist twice: it is replicated by hand
// against a provider whose cookie names change with a major-version bump, and
// two copies would agree only until the first one was fixed. `db-seed.ts` keeps
// its own content and its own idempotency rule; this is the transport under
// both scripts.
//
// Not under `src/`: `scripts/` is deliberately outside the app (see
// `geocode-japan-seed.mts`'s note on that trade — `eslint src` never sees this
// directory, KI-2026-08-30-b).

import type { BatchableCommand, TripCommand } from "@tc/contracts";

// WEB_BASE_URL first: that is the name src/config.ts reads, because `BASE_URL`
// is owned by Vite (KI-72). These scripts run as plain Node processes where
// Vite never assigns anything, so reading BASE_URL here was never broken — but
// two different names for "the base URL" would be, so the app's name wins and
// the old one keeps working.
export const BASE_URL = process.env.WEB_BASE_URL ?? process.env.BASE_URL ?? "http://localhost:3001";

// Every trip a seeding script creates is tagged with this prefix so re-running
// is idempotent instead of piling up duplicates — and so it is obvious in the
// UI which trips are seed data rather than something a person was working on.
// Shared, because `import-content.ts` clears the same trips `db-seed.ts` does:
// two prefixes would mean each script leaving the other's trips behind.
export const SEED_PREFIX = "[Seed] ";

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
//
// SINCE M11a, this needs one more thing: the invite gate. `recordSignIn`
// evaluates admission for anyone with no `users` row, and `db:reset` truncates
// `users` — it derives its table list from the schema, so every table lands
// there the day it does. The very first sign-in after a reset is therefore a
// brand-new account every time, and it is refused with `MISSING_INVITE_CODE`
// unless a credential is presented. A browser carries one in the
// `pending_admission` cookie across the OAuth round trip (`server/admission.ts`);
// there is no round trip here, so the cookie is simply sent with the callback
// POST. Same cookie, same name, same reader — deliberately NOT a
// seeding-only path through the gate, which would be a second admission rule
// nothing tests.
const PENDING_ADMISSION_COOKIE = "pending_admission";
const SUPER_CODE = process.env.INVITE_SUPER_CODE;

export async function devSignIn(baseUrl: string, username: string): Promise<string> {
  const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
  const csrfCookie = readSetCookie(csrfRes, "authjs.csrf-token");
  if (!csrfCookie) {
    throw new Error(
      "no authjs.csrf-token cookie in /api/auth/csrf response — is the dev server running with AUTH_DEV_LOGIN=true?",
    );
  }
  const { csrfToken } = await csrfRes.json();

  const cookies = [csrfCookie];
  if (SUPER_CODE) cookies.push(`${PENDING_ADMISSION_COOKIE}=${encodeURIComponent(SUPER_CODE)}`);

  const callbackRes = await fetch(`${baseUrl}/api/auth/callback/dev-login`, {
    method: "POST",
    redirect: "manual", // a successful sign-in 302s; we only need its Set-Cookie
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookies.join("; ") },
    body: new URLSearchParams({ username, csrfToken, callbackUrl: baseUrl, json: "true" }),
  });
  const sessionCookie = readSetCookie(callbackRes, "authjs.session-token");
  if (!sessionCookie) {
    // The gate's refusal is a redirect carrying a typed code, so it can be told
    // apart from "dev login is off" — worth the extra branch, because the two
    // need completely different fixes and both present as "no cookie".
    const refusal = callbackRes.headers.get("location")?.match(/error=([A-Z_]+)/)?.[1];
    if (refusal) {
      throw new Error(
        `the invite gate refused dev-login as "${username}" (${refusal}). ` +
          `db:reset truncates \`users\`, so the seed user is a brand-new account every time. ` +
          `Set INVITE_SUPER_CODE in apps/web/.env.local (any value; it is compared against the ` +
          `server's own, so the dev server must be restarted after adding it) and re-run.`,
      );
    }
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

export async function api(cookie: string, method: string, path: string, body?: unknown): Promise<any> {
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

export const createTrip = (cookie: string, name: string) => api(cookie, "POST", "/api/trips", { name: `${SEED_PREFIX}${name}` });

// Plain Omit<Union, K> collapses a discriminated union to its members'
// common fields, which is not what excess-property-checking against a
// literal needs here — distribute it over each member instead.
export type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;

// The real command endpoint mints tripId server-side on CreateTrip but every
// other command needs it supplied — matches every TripCommand's own shape.
export const cmd = (cookie: string, tripId: string, command: DistributiveOmit<TripCommand, "tripId">) =>
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
export const batch = (cookie: string, tripId: string, commands: DistributiveOmit<BatchableCommand, "tripId">[]) =>
  commands.length === 0
    ? Promise.resolve(undefined)
    : api(cookie, "POST", `/api/trips/${tripId}/commands/batch`, {
        commands: commands.map((c) => ({ ...c, tripId })),
      });
