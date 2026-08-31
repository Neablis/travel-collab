import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Cookie, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { AdmissionRefusal } from "@tc/contracts";
import { errorMessage } from "../src/components/front/authCopy";
import {
  PENDING_ADMISSION_COOKIE,
  PENDING_ADMISSION_MAX_AGE_SECONDS,
} from "../src/lib/pendingAdmission";
import { DATABASE_URL } from "../src/server/config";
import { inviteCodes, users } from "../src/server/db/schema";

// M11a's own e2e script (AGENTS.md: one happy-path script per milestone, kept
// green forever after its gate). The three admission paths and the single-use
// race are proven against the row in `server/admission.int.test.ts`; what only
// a browser can prove is the part that leaves the site and comes back — the
// credential surviving a sign-in round trip in a cookie, the refusal landing
// on a designed screen, and the cookie not outliving either answer.
//
// **Refusal codes are never spelled as literals here.** They come from
// `AdmissionRefusal.enum`, and the copy each one must produce comes from
// `errorMessage()` — the same function the screen calls. So this spec asserts
// that the enum member reaches its designed sentence, and stays true when that
// sentence is reworded (`ADMISSION_FIELD_COPY` is still awaiting design
// sign-off), while failing loudly if a refusal silently degrades to FALLBACK.
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

/**
 * Where a refusal lands. Built from the enum, never from a string, so a code
 * renamed in `packages/contracts` fails typecheck here rather than leaving a
 * spec that waits for a URL nothing produces any more.
 */
function refusalUrl(reason: AdmissionRefusal): RegExp {
  return new RegExp(`/signup\\?error=${reason}$`);
}

/** The exact sentence the screen owes this refusal — from the copy map itself. */
function refusalCopy(reason: AdmissionRefusal): string {
  const copy = errorMessage(reason);
  // `errorMessage` returns `string | null`, and a null here would mean a
  // refusal with no copy at all — the blank state link 6 exists to prevent.
  expect(copy, `no copy is registered for ${reason}`).not.toBeNull();
  return copy!;
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
 * Waits only for the screen to change, because both outcomes are legitimate
 * results of this walk — Home if admitted, `/signup?error=` if not. Asserting
 * which one is each test's job.
 */
async function signUp(page: Page, username: string, code?: string): Promise<void> {
  await page.goto("/signup");
  if (code !== undefined) await page.getByLabel("Invite code").fill(code);
  await page.fill('input[name="username"]', username);
  await Promise.all([
    // Wait for the sign-in ATTEMPT to settle, which is not the same as leaving
    // `/signup`. Since refusals redirect back to `/signup?error=` — so the
    // person lands on the one screen with a code box to correct — "the
    // pathname changed" is true for an admission and false for a refusal, and
    // waiting on it hangs the refusal walk for 30s. Wait for either outcome:
    // somewhere else entirely (admitted), or the same screen now carrying an
    // error (refused).
    page.waitForURL((url) => url.pathname !== "/signup" || url.searchParams.has("error")),
    page.getByRole("button", { name: /sign in with dev login/i }).click(),
  ]);
}

test("a brand-new account with no invite is refused, and leaves no users row behind", async ({
  page,
}) => {
  const username = freshUsername();

  await signUp(page, username);

  await expect(page).toHaveURL(refusalUrl(AdmissionRefusal.enum.MISSING_INVITE_CODE));
  await expect(
    page.getByText(refusalCopy(AdmissionRefusal.enum.MISSING_INVITE_CODE)),
  ).toBeVisible();
  // The raw code is never shown to the person — it is a routing token, and the
  // screen owes them a sentence instead.
  await expect(page.getByText(AdmissionRefusal.enum.MISSING_INVITE_CODE)).toHaveCount(0);
  // The refusal has to be ACTIONABLE, not merely correct. Everything above
  // passes just as well on a screen with no way to try again — which is what
  // shipped: refusals landed on `/signin`, whose form has no invite-code box,
  // so the message told you what was wrong on a page that could not take the
  // answer. Mitchell found it walking the preview on 2026-08-31; no assertion
  // here could, because they all read text rather than asking whether the
  // person can act.
  await expect(page.getByLabel("Invite code")).toBeVisible();
  await expect(page.getByLabel("Invite code")).toBeEditable();

  // "…and leaves no `users` row behind": the gate runs before `upsertUser`, so
  // a refused sign-in must create nothing at all.
  expect(await hasUserRow(`dev-${username}`)).toBe(false);
});

test("a single-use code admits exactly one person, and is refused the second time", async ({
  browser,
}) => {
  // Two full sign-in walks in two contexts, like m11-invites.spec.ts — CI's
  // 30s default is a budget for one.
  test.slow();
  const code = await mintInviteCode("dev-alice");
  const first = freshUsername();
  const second = freshUsername();

  const admitted = await browser.newContext();
  try {
    const page = await admitted.newPage();
    await signUp(page, first, code);
    await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();
    // Proven against the row, not the UI (the exit gate's own words).
    expect(await redeemerOf(code)).toBe(`dev-${first}`);
    // "No admission credential outlives the sign-in that used it" — cleared on
    // the success path, not only the refusal one.
    expect(await pendingAdmissionCookie(admitted)).toBeUndefined();
  } finally {
    await admitted.close();
  }

  const refused = await browser.newContext();
  try {
    const page = await refused.newPage();
    await signUp(page, second, code);
    await expect(page).toHaveURL(refusalUrl(AdmissionRefusal.enum.SPENT_INVITE_CODE));
    await expect(
      page.getByText(refusalCopy(AdmissionRefusal.enum.SPENT_INVITE_CODE)),
    ).toBeVisible();
    // Still exactly one redeemer: the second attempt neither admitted anyone
    // nor rewrote the row it lost.
    expect(await redeemerOf(code)).toBe(`dev-${first}`);
    expect(await hasUserRow(`dev-${second}`)).toBe(false);
    expect(await pendingAdmissionCookie(refused)).toBeUndefined();
  } finally {
    await refused.close();
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

  await page.fill('input[name="username"]', "alice");
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/trips") && r.request().method() === "GET" && r.ok(),
    ),
    page.getByRole("button", { name: /sign in with dev login/i }).click(),
  ]);

  await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();
});

test("the proxy banks an invite token in a short-lived httpOnly cookie, and a refusal clears it", async ({
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

  await page.goto(`/invite/${token}`);
  await expect(page).toHaveURL(/\/signin\?callbackUrl=/);

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
  await page.fill('input[name="username"]', username);
  await Promise.all([
    page.waitForURL(refusalUrl(AdmissionRefusal.enum.INVALID_INVITE_CODE)),
    page.getByRole("button", { name: /sign in with dev login/i }).click(),
  ]);
  await expect(
    page.getByText(refusalCopy(AdmissionRefusal.enum.INVALID_INVITE_CODE)),
  ).toBeVisible();

  // Cleared on the refusal path too, so the rejected credential cannot be
  // replayed by the next attempt from this browser.
  expect(await pendingAdmissionCookie(context)).toBeUndefined();
  expect(await hasUserRow(`dev-${username}`)).toBe(false);

  // The other half of this path — a *pending* token admitting a brand-new
  // person with no code — is walked in m11-invites.spec.ts, where there is a
  // real trip and a real invite to hand out.
});
