import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { E2E_SUPER_CODE } from "./admission";
import { e2eTripName } from "./tripNames";

// M11b's milestone script: **publish → discover → add, as two actors.**
//
// The exit gate's own words: "publishing makes it findable by another
// signed-in account, and unpublishing removes it from that account's Discover
// results. Walked as two actors." Two real browser contexts is the only way to
// prove that — alice publishes a day, and somebody who is not alice finds it,
// takes it, and then watches it disappear when she takes it back.
//
// **Every city is minted per run.** The published library is global and
// cumulative: the same database carries every day this suite and every previous
// run left behind, so an assertion about "Kyoto" would be an assertion about
// the rest of the suite. A minted city makes the counts exact.
//
// **Saved days are not swept by `global.teardown.ts`** (it deletes `[e2e]`
// trips only, and a saved day is not a trip — see `m11-saved-days.spec.ts`).
// That is another reason the cities are minted rather than shared.
//
// `test.slow()` throughout, for `m11-invites.spec.ts`'s reason: two contexts,
// two sign-ins and several page loads apiece do not fit CI's 30s default, and
// the honest fix for a budget failure is the budget.

function newcomer(prefix: string): string {
  return `${prefix}${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/** A city name no other test, and no previous run, can have published into. */
function mintCity(stem: string): string {
  return `${stem}${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

/**
 * A second person, brand new to the app, in their own context.
 *
 * `storageState: undefined` is explicit: the "desktop" project pins alice's
 * saved session, and inheriting it would make this spec test alice finding
 * alice's day — which is exactly the case the whole milestone is not about.
 *
 * Admitted on the super code, the same way `m11-invites.spec.ts` admits `dan`:
 * a brand-new dev user has no `users` row and M11a's gate refuses them
 * otherwise.
 */
async function signedInAs(browser: Browser, username: string): Promise<Page> {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  await page.goto("/signup");
  await page.getByLabel("Invite code").fill(E2E_SUPER_CODE);
  await page.fill('input[name="username"]', username);
  await Promise.all([
    page.waitForURL((url) => !/^\/sign(in|up)$/.test(url.pathname)),
    page.getByRole("button", { name: /sign in with dev login/i }).click(),
  ]);
  return page;
}

/**
 * A one-day trip whose stops sit in `cities`, built through the app's own
 * command API rather than the wizard — the `createMappedTrip` idiom, with the
 * cities under this spec's control because Discover ranks on them.
 */
async function tripWithCities(
  page: Page,
  name: string,
  cities: string[],
  options: { dated?: boolean } = {},
): Promise<{ tripId: string; dayId: string }> {
  const post = async (path: string, data: unknown) => {
    const res = await page.request.post(path, { data });
    expect(res.ok(), `${path} -> ${res.status()}`).toBe(true);
    return res;
  };
  const created = await post("/api/trips", { name });
  const { tripId } = (await created.json()) as { tripId: string };
  const dayId = randomUUID();

  if (options.dated === true) {
    // A dated trip is what makes an add COUNT (link 4's rule). `newDayIds` is
    // required — SetTripDates mints the days and the domain cannot mint uuids.
    await post(`/api/trips/${tripId}/commands`, {
      type: "SetTripDates",
      tripId,
      startDate: "2027-04-01",
      endDate: "2027-04-02",
      newDayIds: [randomUUID(), randomUUID()],
    });
  }
  await post(`/api/trips/${tripId}/commands`, { type: "AddDay", tripId, dayId });
  for (const [index, city] of cities.entries()) {
    await post(`/api/trips/${tripId}/commands`, {
      type: "AddActivity",
      tripId,
      activityId: randomUUID(),
      dayId,
      title: `Stop in ${city}`,
      timeWindow: { start: `${String(index + 8).padStart(2, "0")}:00`, end: `${String(index + 9).padStart(2, "0")}:00` },
      location: { name: `Somewhere in ${city}`, city },
      cost: { amountMinor: 1_500, currency: "USD" },
    });
  }
  return { tripId, dayId };
}

/** Keeps a day into the library. The pennant flow itself is m11-saved-days'. */
async function keepDay(page: Page, tripId: string, dayId: string, name: string): Promise<string> {
  const res = await page.request.post("/api/saved-days", { data: { name, tripId, dayId } });
  expect(res.ok(), `keep -> ${res.status()}`).toBe(true);
  return ((await res.json()) as { savedDay: { savedDayId: string } }).savedDay.savedDayId;
}

/**
 * Puts a saved day back.
 *
 * `global.teardown.ts` sweeps `[e2e]` TRIPS and a saved day is not a trip, so
 * nothing else will — and a library that grows by three days a run is not a
 * tidiness problem. `SavedDaysDialog` lists the whole thing with no pagination,
 * and at nineteen days it made the dialog taller than the viewport; a centred
 * `fixed` box that tall puts its FIRST row above the top edge, where nothing
 * can scroll to it. That is what took `m11-saved-days.spec.ts` down, and
 * `ui/dialog.tsx` now caps the height — but a spec that leaks a row per run
 * until some other limit is reached is still a spec quietly loading a spring.
 */
async function forgetDay(page: Page, savedDayId: string): Promise<void> {
  const res = await page.request.delete(`/api/saved-days/${savedDayId}`);
  expect(res.ok(), `forget -> ${res.status()}`).toBe(true);
}

/** Types a city into Discover's real search box and taps the match. */
async function pickCity(page: Page, city: string): Promise<void> {
  await page.getByLabel("Search cities").fill(city);
  const chip = page.getByTestId("city-search-results").getByRole("button", { name: new RegExp(`^${city} · `) });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page.getByTestId("selected-cities").getByRole("button", { name: `Remove ${city}` })).toBeVisible();
}

test("publish, discover and add — two actors, and unpublish takes it back", async ({ page, browser }) => {
  test.slow();

  const city = mintCity("Kyotoe2e");
  const alsoCity = mintCity("Ujie2e");
  const dayName = `Two cities on foot ${randomUUID().slice(0, 8)}`;

  // ── Actor 1: alice keeps a two-city day and publishes it ──────────────────
  const source = await tripWithCities(page, e2eTripName("Publish"), [city, alsoCity]);
  const savedDayId = await keepDay(page, source.tripId, source.dayId, dayName);

  // A saved day is PRIVATE by default, so it is visible to alice only in her
  // own scope — which is the first half of the gate box.
  await page.goto("/playbooks?scope=yours");
  await page.getByRole("radio", { name: "Yours" }).click();
  const ownCard = page.getByTestId("discover-card").filter({ hasText: dayName });
  await expect(ownCard).toBeVisible();
  await expect(ownCard.getByText("Private")).toBeVisible();

  await page.goto(`/playbooks/day/${savedDayId}`);
  await expect(page.getByRole("heading", { name: dayName, level: 1 })).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes(`/api/saved-days/${savedDayId}/publish`) && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Publish" }).click(),
  ]);
  await expect(page.getByRole("button", { name: "Unpublish" })).toBeVisible();

  // ── Actor 2: somebody who is not alice finds it ───────────────────────────
  const bobName = newcomer("pbfinder");
  const bob = await signedInAs(browser, bobName);
  const target = await tripWithCities(bob, e2eTripName("Take"), [mintCity("Elsewhere")], { dated: true });

  await bob.goto("/playbooks");
  await pickCity(bob, city);

  const card = bob.getByTestId("discover-card").filter({ hasText: dayName });
  await expect(card).toBeVisible();
  // The exit-gate line: a query for ONE city returns a day that contains it
  // among others, matched filled and the rest outlined, with the per-card line.
  await expect(card.locator(`[data-city="${city}"]`)).toHaveAttribute("data-matched", "true");
  await expect(card.locator(`[data-city="${alsoCity}"]`)).toHaveAttribute("data-matched", "false");
  await expect(card.getByTestId("match-line")).toHaveText(`${city} matched · also ${alsoCity}`);

  // A sibling chip: the other city of this result set, one tap to add.
  await expect(
    bob.getByTestId("sibling-cities").getByRole("button", { name: `Add ${alsoCity}` }),
  ).toBeVisible();

  // ── …takes it into a dated trip of his own ────────────────────────────────
  await card.getByRole("link", { name: dayName }).click();
  await expect(bob.getByRole("heading", { name: dayName, level: 1 })).toBeVisible();
  // No rating, no histogram, no reviews — M12's, and their absence is the
  // milestone's decision rather than an oversight.
  await expect(bob.getByText(/rating/i)).toHaveCount(0);

  await bob.getByRole("button", { name: "Add to a trip" }).click();
  await bob.getByLabel("Which trip").selectOption(target.tripId);
  await Promise.all([
    bob.waitForURL(`**/trips/${target.tripId}`),
    bob.getByRole("button", { name: "Add to trip" }).click(),
  ]);
  // It arrived: the trip has the day's stop in it. Day columns is where a day
  // count is easiest to assert (m10-growth, m11-saved-days do the same).
  await bob.getByRole("tab", { name: "Day columns" }).click();
  await expect(bob.getByText(`Stop in ${city}`)).toBeVisible();

  // ── The add counted, on the ledger, and the board says so ─────────────────
  await bob.goto(`/playbooks/day/${savedDayId}`);
  await expect(bob.getByTestId("day-facts").getByText("1 trip")).toBeVisible();

  // The board is reachable from Discover and NOT from the top bar (project
  // rule 1). Walked as a link rather than a goto, which is what proves it.
  await bob.goto("/playbooks");
  await bob.getByRole("link", { name: /who shares the most/i }).click();
  await expect(bob).toHaveURL(/\/playbooks\/board$/);
  await expect(
    bob.getByText(/An add only counts once per trip, and only after the trip has dates/),
  ).toBeVisible();
  await expect(bob.getByTestId("board-row").filter({ hasText: "dev-alice" })).toBeVisible();

  // ── A profile, derived — and it agrees with Discover ──────────────────────
  await bob.goto("/playbooks/profile/dev-alice?from=board");
  await expect(bob.getByRole("heading", { name: "dev-alice", level: 1 })).toBeVisible();
  await expect(bob.getByTestId("profile-days").getByText(dayName)).toBeVisible();
  // Contextual back link: entered from the board, returns to the board.
  await expect(bob.getByRole("link", { name: "← Who shares the most" })).toBeVisible();

  // ── Unpublish removes it from the OTHER account's Discover ────────────────
  await page.goto(`/playbooks/day/${savedDayId}`);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes(`/api/saved-days/${savedDayId}/publish`) && r.request().method() === "DELETE" && r.ok(),
    ),
    page.getByRole("button", { name: "Unpublish" }).click(),
  ]);

  await bob.goto(`/playbooks?city=${encodeURIComponent(city)}`);
  await expect(bob.getByTestId("discover-card").filter({ hasText: dayName })).toHaveCount(0);
  // And the day itself is now the same 404 a private day has always been — a
  // withdrawn day and one that never existed are deliberately indistinguishable.
  await bob.goto(`/playbooks/day/${savedDayId}`);
  await expect(bob.getByText("This day is not in the library")).toBeVisible();

  await forgetDay(page, savedDayId);
  await bob.context().close();
});

// The exit gate names FOUR states for city search against the REAL endpoint.
// Two of them (results, no matches) are ordinary answers; the fourth needs the
// endpoint to fail, which is what `page.route` is for. The dropdown it replaced
// is asserted gone in the same walk.
test("city search shows all four states against the real endpoint", async ({ page }) => {
  test.slow();

  const city = mintCity("Statese2e");
  const source = await tripWithCities(page, e2eTripName("States"), [city]);
  const savedDayId = await keepDay(page, source.tripId, source.dayId, `States day ${randomUUID().slice(0, 8)}`);
  const published = await page.request.post(`/api/saved-days/${savedDayId}/publish`);
  expect(published.ok()).toBe(true);

  await page.goto("/playbooks");

  // (1) loading, then (2) results — the loading line is transient by design, so
  // it is asserted by holding the response rather than by racing it.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/cities?*", async (route) => {
    await held;
    await route.continue();
  });
  await page.getByLabel("Search cities").fill(city);
  await expect(page.getByTestId("city-search-loading")).toBeVisible();
  release();
  await expect(page.getByTestId("city-search-results").getByRole("button", { name: new RegExp(`^${city} · 1`) })).toBeVisible();
  await page.unroute("**/api/cities?*");

  // (3) "no city matches" — a real 200 with an empty list, rendered as an
  // answer rather than as a failure.
  await page.getByLabel("Search cities").fill(mintCity("Nowhere"));
  await expect(page.getByTestId("city-search-empty")).toBeVisible();
  await expect(page.getByTestId("city-search-failed")).toHaveCount(0);

  // (4) failure, with a Retry that re-runs the SAME query rather than clearing
  // the box.
  await page.route("**/api/cities?*", (route) => route.abort());
  await page.getByLabel("Search cities").fill(city);
  await expect(page.getByTestId("city-search-failed")).toBeVisible();
  await page.unroute("**/api/cities?*");
  await page.getByTestId("city-search-failed").getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("city-search-results")).toBeVisible();

  // The static `<option>` city list is gone and must not come back — the
  // handoff says so twice and the gate restates it.
  await expect(page.getByLabel("City")).toHaveCount(0);
  await expect(page.getByRole("option", { name: "All cities" })).toHaveCount(0);

  await forgetDay(page, savedDayId);
});
