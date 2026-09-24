import { randomUUID } from "node:crypto";
import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { E2E_SUPER_CODE } from "./admission";
import { E2E_ADMIN_USERNAME } from "./adminBootstrap";
import { e2eTripName } from "./tripNames";

// **M12 link 6's gate box, walked** — *"A reported day is removed from
// Discover, the board and profiles by one action, the author still has their
// copy, and the operator path is walked end to end."*
//
// Three actors, three contexts: alice publishes (the suite's shared session,
// as in `m11b-playbooks.spec.ts`), a stranger reports, and the configured
// operator (`adminBootstrap.ts`) hides it from the console. The one action is
// the console's button; everything around it is set up through shipped
// endpoints.
//
// **The report is filed through `POST /api/reports`, not a button.** The
// report control on a shared day is another link's surface; what this spec
// owns is what happens after a report exists. The endpoint is the same one the
// button calls, so the queue row is the row a person would have produced.
//
// **The city is minted per run**, for m11b's reason: the published library is
// global and cumulative, and an absence asserted against a shared city would
// be an assertion about the rest of the suite.
//
// `test.slow()`: three sign-ins and a dozen page loads do not fit CI's 30s
// default, and a budget failure is fixed with the budget, not a retry.

function newcomer(prefix: string): string {
  return `${prefix}${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/** A second person in their own context, admitted on the super code (m11b's `signedInAs`). */
async function signedInAs(browser: Browser, username: string): Promise<Page> {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  await page.goto("/signup");
  await page.getByLabel("Invite code").fill(E2E_SUPER_CODE);
  // eslint-disable-next-line playwright/prefer-locator -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
  await page.fill('input[name="username"]', username);
  await Promise.all([
    page.waitForURL((url) => !/^\/sign(in|up)$/.test(url.pathname)),
    page.getByRole("button", { name: /sign in with dev login/i }).click(),
  ]);
  return page;
}

/** A published one-stop day in `city`, owned by whoever `page` is signed in as. */
async function publishedDay(page: Page, city: string, dayName: string): Promise<string> {
  const post = async (path: string, data?: unknown) => {
    const res = await page.request.post(path, data === undefined ? {} : { data });
    expect(res.ok(), `${path} -> ${res.status()}`).toBe(true);
    return res;
  };
  const { tripId } = (await (await post("/api/trips", { name: e2eTripName("Moderation") })).json()) as {
    tripId: string;
  };
  const dayId = randomUUID();
  await post(`/api/trips/${tripId}/commands`, { type: "AddDay", tripId, dayId });
  await post(`/api/trips/${tripId}/commands`, {
    type: "AddActivity",
    tripId,
    activityId: randomUUID(),
    dayId,
    title: `Stop in ${city}`,
    timeWindow: { start: "09:00", end: "10:00" },
    location: { name: `Somewhere in ${city}`, city },
    cost: { amountMinor: 1_500, currency: "USD" },
  });
  const kept = await post("/api/saved-days", { name: dayName, tripId, dayIds: [dayId] });
  const { savedDay } = (await kept.json()) as { savedDay: { savedDayId: string } };
  await post(`/api/saved-days/${savedDay.savedDayId}/publish`);
  return savedDay.savedDayId;
}

/**
 * Discover, filtered to `city` by URL — with the seed asserted FIRST, for the
 * reason m11b records (CodeRabbit, PR 102): if `?city=` stopped seeding the
 * search, the page would be an unfiltered slice of a cumulative library and
 * the day would be absent from it for the wrong reason.
 */
async function discoverIn(page: Page, city: string) {
  await page.goto(`/playbooks?city=${encodeURIComponent(city)}`);
  await expect(page.getByTestId("selected-cities").getByRole("button", { name: `Remove ${city}` })).toBeVisible();
}

test("a reported day is hidden from the console, leaves the library, and the author keeps it", async ({
  page,
  browser,
}) => {
  test.slow();

  const city = `Naraemod${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const dayName = `Deer park at dusk ${randomUUID().slice(0, 8)}`;
  const moderationNote = "Every stop links to one tour operator.";

  // ── alice publishes ───────────────────────────────────────────────────────
  const savedDayId = await publishedDay(page, city, dayName);

  // ── a stranger finds it, and reports it ───────────────────────────────────
  const reporter = await signedInAs(browser, newcomer("m12reporter"));
  await discoverIn(reporter, city);
  // Present before, so its absence after is the hide and not a bad query.
  await expect(reporter.getByTestId("discover-card").filter({ hasText: dayName })).toBeVisible();
  await reporter.goto("/playbooks/profile/dev-alice");
  await expect(reporter.getByTestId("profile-days").getByText(dayName)).toBeVisible();

  const filed = await reporter.request.post("/api/reports", {
    data: { target: { kind: "saved_day", savedDayId }, reason: "spam", note: "It is an advert." },
  });
  expect(filed.status(), await filed.text()).toBe(201);

  // ── the operator hides it, from the console ───────────────────────────────
  const operator = await signedInAs(browser, E2E_ADMIN_USERNAME);
  await operator.goto("/admin");
  await expect(operator.getByRole("heading", { name: "Reports", exact: true })).toBeVisible();
  const row = operator.getByTestId(/^report-/).filter({ hasText: dayName });
  await expect(row).toBeVisible();
  await expect(row.getByText("It is an advert.")).toBeVisible();
  await expect(row.getByRole("link", { name: dayName })).toHaveAttribute("href", `/playbooks/day/${savedDayId}`);

  await row.getByRole("button", { name: "Hide from the library" }).click();
  await row.getByLabel(/Note to the author/).fill(moderationNote);
  await Promise.all([
    operator.waitForResponse(
      (r) => r.url().includes("/api/admin/reports/") && r.request().method() === "POST" && r.ok(),
    ),
    row.getByRole("button", { name: "Hide it" }).click(),
  ]);

  // It left Open and is on Actioned, carrying the state and the note it wrote.
  await expect(row).toHaveCount(0);
  await operator.getByRole("button", { name: /^Actioned/ }).click();
  const actioned = operator.getByTestId(/^report-/).filter({ hasText: dayName });
  await expect(actioned.getByText(/Hidden from the library since/)).toBeVisible();
  await expect(actioned.getByText(moderationNote, { exact: false })).toBeVisible();
  await expect(actioned.getByRole("button", { name: "Restore to the library" })).toBeVisible();

  // ── gone from Discover, the day's own page, and the profile ───────────────
  await discoverIn(reporter, city);
  await expect(reporter.getByTestId("discover-card").filter({ hasText: dayName })).toHaveCount(0);
  await reporter.goto(`/playbooks/day/${savedDayId}`);
  await expect(reporter.getByText("This day is not in the library")).toBeVisible();
  await reporter.goto("/playbooks/profile/dev-alice");
  await expect(reporter.getByRole("heading", { name: "Alice", level: 1 })).toBeVisible();
  await expect(reporter.getByTestId("profile-days").getByText(dayName)).toHaveCount(0);

  // ── …and alice still has her copy ─────────────────────────────────────────
  await page.goto("/playbooks?scope=yours");
  await page.getByRole("tab", { name: "Yours" }).click();
  await expect(page.getByTestId("discover-card").filter({ hasText: dayName })).toBeVisible();
  await page.goto(`/playbooks/day/${savedDayId}`);
  await expect(page.getByRole("heading", { name: dayName, level: 1 })).toBeVisible();

  // Cleanup, m11b's two steps: unpublish, then delete. A saved day is not a
  // trip, so `global.teardown.ts` will not sweep it.
  await page.request.delete(`/api/saved-days/${savedDayId}/publish`);
  const forgot = await page.request.delete(`/api/saved-days/${savedDayId}`);
  expect(forgot.ok(), `forget -> ${forgot.status()}`).toBe(true);
  await reporter.context().close();
  await operator.context().close();
});
