import { randomUUID } from "node:crypto";
import type { BrowserContext, Cookie, Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { eq } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import {
  PENDING_ADMISSION_COOKIE,
  PENDING_ADMISSION_MAX_AGE_SECONDS,
} from "../src/lib/pendingAdmission";
import { DATABASE_URL } from "../src/server/config";
import { inviteCodes, users } from "../src/server/db/schema";

// M11a's own e2e script (AGENTS.md: one happy-path script per milestone, kept
// green forever after its gate), rewritten when signup opened (ADR-063). The
// code no longer keeps anyone out; what only a browser can prove is the part
// that leaves the site and comes back — the credential surviving a sign-in
// round trip in a cookie, being CLAIMED on the far side so who-invited-whom is
// recorded, and the cookie not outliving the sign-in either way.
//
// Signed out by default: the "desktop" project pins alice's saved session, and
// every person in this file except the returning-user test is meant to be
// someone the app has never seen.
test.use({ storageState: { cookies: [], origins: [] } });

/**
 * A dev username nobody has used before, so the gate sees a genuinely new
 * account every run.
 *
 * Hex only and 23 characters, because `devLoginIdentity` rejects anything
 * outside `^[A-Za-z0-9_-]{1,32}$` — a raw UUID's dashes are fine but a name
 * that fails the charset would fail the sign-in for the wrong reason, and the
 * refusal screen looks identical either way.
 */
function freshUsername(): string {
  return `e2e${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

// The suite has no way to mint a single-use code through the app — the
// milestone says so in as many words ("Codes are minted by hand for now"), and
// deliberately ships no administration UI and no endpoint. A short-lived
// client is the honest way to put one row in front of the browser; it is
// fixture setup, not a second write path into the planning domain (invariant 1
// scopes the event log to planning, and `invite_codes` is Access CRUD).
//
// A `Client` per query rather than the app's pooled `db`: importing that would
// leave an open pool holding the Playwright worker's event loop alive after
// the last test.
async function withDb<T>(run: (db: NodePgDatabase) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return await run(drizzle(client));
  } finally {
    await client.end();
  }
}

async function mintInviteCode(createdBy: string): Promise<string> {
  const code = `e2e-${randomUUID()}`;
  await withDb(async (db) => {
    await db.insert(inviteCodes).values({ code, createdBy, createdAt: new Date() });
  });
  return code;
}

/** Who spent the code, straight off the row — the exit gate asks for exactly this. */
async function redeemerOf(code: string): Promise<string | null> {
  return withDb(async (db) => {
    const [row] = await db.select().from(inviteCodes).where(eq(inviteCodes.code, code));
    return row?.redeemedBy ?? null;
  });
}

async function hasUserRow(id: string): Promise<boolean> {
  return withDb(async (db) => {
    const found = await db.select({ id: users.id }).from(users).where(eq(users.id, id));
    return found.length > 0;
  });
}

async function pendingAdmissionCookie(context: BrowserContext): Promise<Cookie | undefined> {
  return (await context.cookies()).find((cookie) => cookie.name === PENDING_ADMISSION_COOKIE);
}

/**
 * The front door as a new person meets it: `/signup`, a code (or not), a
 * username, and whatever the gate decides.
 *
 * Waits for the sign-in round trip to leave `/signup`; since ADR-063 every
 * walk is admitted, so where it lands is each test's job to assert.
 */
async function signUp(page: Page, username: string, code?: string): Promise<void> {
  await page.goto("/signup");
  if (code !== undefined) await page.getByLabel("Invite code").fill(code);
  // eslint-disable-next-line playwright/prefer-locator -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
  await page.fill('input[name="username"]', username);
  await Promise.all([
    // `?error=` too, so a regression back to a refusal fails on the assertion
    // that follows rather than hanging here for the full timeout.
    page.waitForURL((url) => url.pathname !== "/signup" || url.searchParams.has("error")),
    page.getByRole("button", { name: /sign in with dev login/i }).click(),
  ]);
}

test("a brand-new account with no invite code is admitted, and gets a users row", async ({
  page,
  context,
}) => {
  const username = freshUsername();

  await signUp(page, username);

  await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();
  expect(await hasUserRow(`dev-${username}`)).toBe(true);
  expect(await pendingAdmissionCookie(context)).toBeUndefined();
});

test("a single-use code records exactly one redeemer, and a second holder still gets in", async ({
  browser,
}) => {
  // Two full sign-in walks in two contexts, like m11-invites.spec.ts — CI's
  // 30s default is a budget for one.
  test.slow();
  const code = await mintInviteCode("dev-alice");
  const first = freshUsername();
  const second = freshUsername();

  const claimed = await browser.newContext();
  try {
    const page = await claimed.newPage();
    await signUp(page, first, code);
    await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();
    // Who-invited-whom, proven against the row: alice minted it, `first` spent it.
    expect(await redeemerOf(code)).toBe(`dev-${first}`);
    // "No admission credential outlives the sign-in that used it."
    expect(await pendingAdmissionCookie(claimed)).toBeUndefined();
  } finally {
    await claimed.close();
  }

  const spent = await browser.newContext();
  try {
    const page = await spent.newPage();
    await signUp(page, second, code);
    // A spent code no longer blocks anyone (ADR-063)…
    await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();
    expect(await hasUserRow(`dev-${second}`)).toBe(true);
    // …and does not rewrite who the code's referral belongs to.
    expect(await redeemerOf(code)).toBe(`dev-${first}`);
    expect(await pendingAdmissionCookie(spent)).toBeUndefined();
  } finally {
    await spent.close();
  }
});

test("someone who already has a users row signs in with no code at all", async ({ page }) => {
  // alice's row exists because `auth.setup.ts` signed her in, and every
  // project here depends on that one — so this is a genuinely returning
  // account, not an assumption about database state.
  expect(await hasUserRow("dev-alice")).toBe(true);

  await page.goto("/signin");
  // `/signin` carries no invite-code field: someone arriving here either has a
  // row already or is riding a token the proxy banked, and a field asking for
  // a code would read as a requirement to both.
  await expect(page.getByLabel("Invite code")).toHaveCount(0);

  // eslint-disable-next-line playwright/prefer-locator -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
  await page.fill('input[name="username"]', "alice");
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/trips") && r.request().method() === "GET" && r.ok(),
    ),
    page.getByRole("button", { name: /sign in with dev login/i }).click(),
  ]);

  await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();
});

test("the proxy banks an invite token in a short-lived httpOnly cookie, and the sign-in clears it", async ({
  page,
  context,
}) => {
  // Deliberately not a real token. `proxy.ts` runs in the Edge runtime with no
  // database (ADR-024): it stores what it is handed and validates nothing, so
  // a string that cannot possibly be an invite is the sharpest way to assert
  // that split — banked here, and rejected later by the one module that owns
  // the rule.
  const token = `e2e-not-a-token-${randomUUID()}`;
  const username = freshUsername();

  // Since M27 link 6 the invite page is PUBLIC — no redirect to /signin — and
  // the proxy banks the token as it serves it. An unknown token lands on the
  // landing's unavailable state, which is the landing validating (it has a
  // database) what the proxy only stored.
  await page.goto(`/invite/${token}`);
  await expect(page).toHaveURL(new RegExp(`/invite/${token}$`));
  await expect(page.getByRole("heading", { name: "This invite doesn't work", level: 1 })).toBeVisible();

  const banked = await pendingAdmissionCookie(context);
  // This assertion is also the guard for the `secure` flag being keyed on the
  // request host rather than NODE_ENV: `ci-like` serves a production build
  // over plain http, so a Secure cookie would be dropped by the browser and
  // `banked` would simply be undefined here (lib/pendingAdmission.ts).
  expect(banked?.value).toBe(token);
  expect(banked?.httpOnly).toBe(true);
  expect(banked?.sameSite).toBe("Lax");
  expect(banked?.path).toBe("/");
  // Short-lived, from the shared constant rather than a number repeated here.
  const secondsLeft = (banked?.expires ?? 0) - Date.now() / 1000;
  expect(secondsLeft).toBeGreaterThan(0);
  expect(secondsLeft).toBeLessThanOrEqual(PENDING_ADMISSION_MAX_AGE_SECONDS);

  // No code typed anywhere — the banked token is the whole credential, which
  // is what makes an invite link a one-step arrival for a new collaborator.
  // `/signin`, the screen with no code field, is where a landing's sign-in goes.
  await page.goto(`/signin?callbackUrl=${encodeURIComponent(`/invite/${token}`)}`);
  // eslint-disable-next-line playwright/prefer-locator -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
  await page.fill('input[name="username"]', username);
  await Promise.all([
    page.waitForURL((url) => url.pathname !== "/signin" || url.searchParams.has("error")),
    page.getByRole("button", { name: /sign in with dev login/i }).click(),
  ]);
  // An unknown token admits nobody to the trip, but no longer keeps the person
  // out of Caesura (ADR-063): back on the invite's landing, now signed in.
  await expect(page).toHaveURL(new RegExp(`/invite/${token}$`));

  // Cleared even though the token was useless, so it cannot be replayed by
  // the next attempt from this browser.
  expect(await pendingAdmissionCookie(context)).toBeUndefined();
  expect(await hasUserRow(`dev-${username}`)).toBe(true);

  // The other half of this path — a *pending* token admitting a brand-new
  // person with no code — is walked in m11-invites.spec.ts, where there is a
  // real trip and a real invite to hand out.
});
