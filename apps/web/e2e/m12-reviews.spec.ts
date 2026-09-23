import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { E2E_SUPER_CODE } from "./admission";
import { e2eTripName } from "./tripNames";

// M12's milestone script for the shared day: **rate it, watch the average move
// without a reload, reload and find it kept, change it, report the day.**
//
// Two actors, for M11b's reason (`m11b-playbooks.spec.ts`): alice authors and
// publishes; somebody who is not alice reviews, because the author cannot —
// the server refuses her (403 `own-day`) and the page offers her no form.
//
// **Every day is minted per run and forgotten at the end.** The library is
// global and cumulative, and a day's rating is the aggregate of everyone who
// ever reviewed it, so a shared fixture day would make "the average is 4.0" an
// assertion about previous runs.
//
// The offline and conflict states are the component suite's
// (`ReviewsSection.test.tsx`): the conflict needs the author to republish
// between a held review and its flush, and nothing about that is better proved
// by a browser.
//
// `test.slow()`: two contexts and several page loads, `m11-invites.spec.ts`'s
// reason.

function newcomer(prefix: string): string {
  return `${prefix}${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/** A brand-new second person in their own context — `m11b-playbooks.spec.ts`'s `signedInAs`. */
async function signedInAs(browser: Browser, username: string): Promise<Page> {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  await page.goto("/signup");
  await page.getByLabel("Invite code").fill(E2E_SUPER_CODE);
  await page.getByLabel("Username").fill(username);
  await Promise.all([
    page.waitForURL((url) => !/^\/sign(in|up)$/.test(url.pathname)),
    page.getByRole("button", { name: /sign in with dev login/i }).click(),
  ]);
  return page;
}

/** Alice keeps a one-stop day out of a fresh trip and publishes it. Returns its id. */
async function publishedDay(page: Page, name: string): Promise<string> {
  const post = async (path: string, data: unknown) => {
    const res = await page.request.post(path, { data });
    expect(res.ok(), `${path} -> ${res.status()}`).toBe(true);
    return res;
  };
  const created = await post("/api/trips", { name: e2eTripName("Reviews") });
  const { tripId } = (await created.json()) as { tripId: string };
  const dayId = randomUUID();
  await post(`/api/trips/${tripId}/commands`, { type: "AddDay", tripId, dayId });
  await post(`/api/trips/${tripId}/commands`, {
    type: "AddActivity",
    tripId,
    activityId: randomUUID(),
    dayId,
    title: "Morning market",
    timeWindow: { start: "08:00", end: "09:30" },
    location: { name: "The market", city: `Revieworth${randomUUID().slice(0, 8)}` },
  });
  const kept = await post("/api/saved-days", { name, tripId, dayIds: [dayId] });
  const savedDayId = ((await kept.json()) as { savedDay: { savedDayId: string } }).savedDay.savedDayId;
  const published = await page.request.post(`/api/saved-days/${savedDayId}/publish`);
  expect(published.ok(), `publish -> ${published.status()}`).toBe(true);
  return savedDayId;
}

/** Unpublish, then delete — the two steps a person takes (`m11b-playbooks.spec.ts`'s `forgetDay`). */
async function forgetDay(page: Page, savedDayId: string): Promise<void> {
  await page.request.delete(`/api/saved-days/${savedDayId}/publish`);
  const res = await page.request.delete(`/api/saved-days/${savedDayId}`);
  expect(res.ok(), `forget -> ${res.status()}`).toBe(true);
}

/** Resolves once the review PUT for `savedDayId` has answered 200. */
function reviewSaved(page: Page, savedDayId: string) {
  return page.waitForResponse(
    (r) => r.url().includes(`/api/saved-days/${savedDayId}/reviews`) && r.request().method() === "PUT" && r.ok(),
  );
}

test("rate a shared day, see it live, keep it across a reload, change it, and report the day", async ({
  page,
  browser,
}) => {
  test.slow();
  const dayName = `A day to rate ${randomUUID().slice(0, 8)}`;
  const savedDayId = await publishedDay(page, dayName);
  const bob = await signedInAs(browser, newcomer("reviewer"));

  try {
    // ── Empty: nobody has rated it ──────────────────────────────────────────
    await bob.goto(`/playbooks/day/${savedDayId}`);
    await expect(bob.getByRole("heading", { name: dayName, level: 1 })).toBeVisible();
    const rail = bob.getByTestId("day-facts");
    await expect(rail.getByText("Unrated so far — nobody has run it and come back.")).toBeVisible();
    await expect(bob.getByTestId("reviews-empty")).toBeVisible();

    // ── Rate it; the average moves without a reload ──────────────────────────
    await bob.getByRole("button", { name: "4 stars" }).click();
    await expect(bob.getByTestId("star-word")).toHaveText("Very good");
    await bob.getByLabel("Your note").fill("Get there before nine.");
    await Promise.all([reviewSaved(bob, savedDayId), bob.getByRole("button", { name: "Post" }).click()]);
    await expect(rail.getByTestId("rating-average")).toHaveText("4.0");
    await expect(rail.getByTestId("review-count")).toHaveText("1 review");
    await expect(bob.getByTestId("review-done")).toHaveText("You rated this 4 stars.");
    await expect(bob.getByTestId("review-row").filter({ hasText: "Get there before nine." })).toBeVisible();

    // ── A reload reads it back from the server ──────────────────────────────
    await bob.reload();
    await expect(rail.getByTestId("rating-average")).toHaveText("4.0");
    await expect(bob.getByTestId("review-done")).toHaveText("You rated this 4 stars.");

    // ── Change it: an update to the same review, not a second one ───────────
    await bob.getByRole("button", { name: "Change it" }).click();
    await expect(bob.getByLabel("Your note")).toHaveValue("Get there before nine.");
    await bob.getByRole("button", { name: "2 stars" }).click();
    await Promise.all([reviewSaved(bob, savedDayId), bob.getByRole("button", { name: "Post" }).click()]);
    await expect(rail.getByTestId("rating-average")).toHaveText("2.0");
    await expect(rail.getByTestId("review-count")).toHaveText("1 review");
    await expect(bob.getByTestId("review-row")).toHaveCount(1);

    // ── Report the day ──────────────────────────────────────────────────────
    await bob.getByRole("button", { name: "Report this day" }).click();
    await bob.getByRole("radio", { name: "Wrong or misleading" }).click();
    await Promise.all([
      bob.waitForResponse((r) => r.url().endsWith("/api/reports") && r.request().method() === "POST" && r.ok()),
      bob.getByRole("button", { name: "Send" }).click(),
    ]);
    await expect(bob.getByText("Thanks — an operator will look at it.")).toBeVisible();

    // ── The author sees the rating, and neither control ─────────────────────
    await page.goto(`/playbooks/day/${savedDayId}`);
    await expect(page.getByTestId("day-facts").getByTestId("rating-average")).toHaveText("2.0");
    await expect(page.getByTestId("review-row")).toHaveCount(1);
    await expect(page.getByTestId("review-form")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Report this day" })).toHaveCount(0);
  } finally {
    await forgetDay(page, savedDayId);
    await bob.context().close();
  }
});
