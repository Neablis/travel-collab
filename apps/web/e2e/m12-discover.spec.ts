import { randomUUID } from "node:crypto";
import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { signInAsDevUser } from "./helpers";
import { e2eTripName } from "./tripNames";

// M12 links 5 and 7, walked against the real endpoints: Discover's two
// rating-based sorts and its rating floor over reviews that were really posted,
// and the place search telling the country Mexico from a city whose name
// starts the same way.
//
// **Every city is minted per run**, for `m11b-playbooks.spec.ts`'s reason: the
// published library is global to the run's database, so an assertion about a
// shared name is an assertion about every other spec. Each walk seeds Discover
// with its own minted city (or country, below) and asserts on its own days by
// name.
//
// **Reviews go in through `PUT /api/saved-days/:id/reviews`**, as two
// newcomers — an author cannot review their own day (403 `own-day`), and one
// reviewer can only hold one review per day, so two distinct review counts
// need two people. The review UI is the shared day's, and its own spec's; this
// one is about what Discover does with the counters those reviews maintain.
//
// `test.slow()` throughout: two extra contexts and sign-ins do not fit CI's
// 30s default (see `m11-invites.spec.ts`).

/** A name no other test, and no previous run, can have published into. */
function mint(stem: string): string {
  return `${stem}${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

/** A brand-new person in their own context — never alice's saved session. */
async function newcomer(browser: Browser, prefix: string): Promise<Page> {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  await signInAsDevUser(page, mint(prefix));
  return page;
}

/**
 * Keeps and publishes a one-stop day in `city` as the page's user, returning
 * its id. Built through the command API and the saved-days routes, the same
 * way `m11b-playbooks.spec.ts` builds its days.
 */
async function publishDay(
  page: Page,
  name: string,
  city: string,
  countryCode?: string,
): Promise<string> {
  const post = async (path: string, data: unknown) => {
    const res = await page.request.post(path, { data });
    expect(res.ok(), `${path} -> ${res.status()}`).toBe(true);
    return res;
  };
  const created = await post("/api/trips", { name: e2eTripName("M12 Discover") });
  const { tripId } = (await created.json()) as { tripId: string };
  const dayId = randomUUID();
  await post(`/api/trips/${tripId}/commands`, { type: "AddDay", tripId, dayId });
  await post(`/api/trips/${tripId}/commands`, {
    type: "AddActivity",
    tripId,
    activityId: randomUUID(),
    dayId,
    title: `Stop in ${city}`,
    timeWindow: { start: "09:00", end: "10:00" },
    // `countryCode` is what `countriesOfStops` reads when the day is kept, and
    // so what `saved_days.countries` — and a `?country=` search — holds.
    location: { name: `Somewhere in ${city}`, city, ...(countryCode ? { countryCode } : {}) },
  });
  const kept = await post("/api/saved-days", { name, tripId, dayIds: [dayId] });
  const { savedDay } = (await kept.json()) as { savedDay: { savedDayId: string } };
  const published = await page.request.post(`/api/saved-days/${savedDay.savedDayId}/publish`);
  expect(published.ok(), `publish -> ${published.status()}`).toBe(true);
  return savedDay.savedDayId;
}

async function review(page: Page, savedDayId: string, stars: number): Promise<void> {
  const res = await page.request.put(`/api/saved-days/${savedDayId}/reviews`, { data: { stars } });
  expect(res.ok(), `review -> ${res.status()}`).toBe(true);
}

/** Unpublish then delete — the two steps a person takes (see m11b's `forgetDay`). */
async function forget(page: Page, savedDayId: string): Promise<void> {
  await page.request.delete(`/api/saved-days/${savedDayId}/publish`);
  const res = await page.request.delete(`/api/saved-days/${savedDayId}`);
  expect(res.ok(), `forget -> ${res.status()}`).toBe(true);
}

/** The card titles in the order Discover shows them. */
const cardTitles = (page: Page) => page.getByTestId("discover-results").getByRole("heading", { level: 4 });

test("highest rated and most reviewed order by the reviews, and the floor narrows by them", async ({
  page,
  browser,
}) => {
  test.slow();

  const city = mint("Ratede2e");
  const tag = randomUUID().slice(0, 8);
  const high = `One five-star review ${tag}`;
  const low = `Two middling reviews ${tag}`;
  const unrated = `Nobody has rated this ${tag}`;

  const ids = [
    await publishDay(page, high, city),
    await publishDay(page, low, city),
    await publishDay(page, unrated, city),
  ];
  const [highId, lowId] = ids;

  // high: one review, 5.0. low: two reviews, 2.5. unrated: none.
  const bob = await newcomer(browser, "m12rater");
  const carol = await newcomer(browser, "m12rater");
  await review(bob, highId!, 5);
  await review(bob, lowId!, 2);
  await review(carol, lowId!, 3);

  // Seeded by URL, and the seed asserted first — an unseeded Discover would
  // show the whole cumulative library and every order below would be about it.
  await bob.goto(`/playbooks?city=${encodeURIComponent(city)}`);
  await expect(bob.getByTestId("selected-cities").getByRole("button", { name: `Remove ${city} (city)` })).toBeVisible();
  // Most added is the default and none of the three has an add, so its order
  // falls to recency and is not this spec's to assert — only that all three
  // are here.
  await expect(cardTitles(bob)).toHaveCount(3);

  // The cards state what the sort is about to order on.
  const card = (name: string) => bob.getByTestId("discover-card").filter({ hasText: name });
  await expect(card(high).getByTestId("card-rating")).toHaveText("★ 5.0 · 1 review");
  await expect(card(low).getByTestId("card-rating")).toHaveText("★ 2.5 · 2 reviews");
  await expect(card(unrated).getByTestId("card-rating")).toHaveText("No reviews yet");

  // Highest rated: 5.0, then 2.5, and the unrated day LAST rather than gone —
  // a sort orders and never hides.
  await bob.getByTestId("discover-sort").click();
  await bob.getByRole("button", { name: "Highest rated" }).click();
  await expect(cardTitles(bob)).toHaveText([high, low, unrated]);
  await expect(bob).toHaveURL(/[?&]sort=highest-rated/);

  // Most reviewed turns the first two round: two reviews beat one.
  await bob.getByTestId("discover-sort").click();
  await bob.getByRole("button", { name: "Most reviewed" }).click();
  await expect(cardTitles(bob)).toHaveText([low, high, unrated]);

  // The floor is a filter, not an order: 4+ keeps the 5.0 and drops both the
  // 2.5 and the day with no rating to be above anything.
  await bob.getByTestId("filter-more").click();
  await bob.getByTestId("filter-more-rating-4").click();
  await bob.keyboard.press("Escape");
  await expect(cardTitles(bob)).toHaveText([high]);
  await expect(bob.getByTestId("filter-chip-rating")).toContainText("4+ stars");
  await expect(bob).toHaveURL(/[?&]rating=4(&|$)/);

  // It survives a reload — the URL is the state, not a copy of it.
  await bob.reload();
  await expect(cardTitles(bob)).toHaveText([high]);

  await bob.getByTestId("discover-clear-filters").click();
  await expect(cardTitles(bob)).toHaveCount(3);
  await expect(bob.getByTestId("filter-chip-rating")).toHaveCount(0);

  for (const id of ids) await forget(page, id);
  await bob.context().close();
  await carol.context().close();
});

// M12 link 7's collision: `Mexic` must offer the country Mexico and a city
// whose name starts the same way as two distinguishable things, and picking
// each has to ask a different question. The city is minted (`Mexicoe2e…`) so
// its day count is exactly this spec's; the country cannot be — `MX` is a real
// code, because a country's name is `Intl.DisplayNames` over it — so the
// country half asserts on this spec's days by name rather than on a count.
test("the search box tells the country Mexico from a city that starts the same way", async ({ page }) => {
  test.slow();

  const mexicoCity = mint("Mexicoe2e");
  const otherMexicanCity = mint("Pueblae2e");
  const tag = randomUUID().slice(0, 8);
  const inTheCity = `A day in the capital ${tag}`;
  const elsewhereInMexico = `A day elsewhere in Mexico ${tag}`;

  const ids = [
    await publishDay(page, inTheCity, mexicoCity, "MX"),
    await publishDay(page, elsewhereInMexico, otherMexicanCity, "MX"),
  ];

  await page.goto("/playbooks");
  const box = page.getByLabel("Search cities and countries");
  const results = page.getByTestId("city-search-results");
  await box.fill("Mexic");
  const countryRow = results.getByRole("button", { name: /^Mexico · \d+ \(country\)$/ });
  const cityRow = results.getByRole("button", { name: `${mexicoCity} · 1 (city)`, exact: true });
  await expect(countryRow).toBeVisible();
  await expect(cityRow).toBeVisible();

  // The country: both Mexican days, and no card claims a CITY matched — the
  // card's match line is about cities, and none was asked for.
  await countryRow.click();
  await expect(page.getByTestId("selected-cities").getByRole("button", { name: "Remove Mexico (country)" })).toBeVisible();
  await expect(page).toHaveURL(/[?&]country=MX(&|$)/);
  const card = (name: string) => page.getByTestId("discover-card").filter({ hasText: name });
  await expect(card(inTheCity)).toBeVisible();
  await expect(card(elsewhereInMexico)).toBeVisible();
  await expect(card(elsewhereInMexico).getByTestId("match-line")).toHaveCount(0);

  // Swap the country for the city: the capital day stays, the other goes.
  await page.getByRole("button", { name: "Remove Mexico (country)" }).click();
  await box.fill("Mexic");
  await cityRow.click();
  await expect(
    page.getByTestId("selected-cities").getByRole("button", { name: `Remove ${mexicoCity} (city)` }),
  ).toBeVisible();
  await expect(card(inTheCity)).toBeVisible();
  await expect(card(inTheCity).getByTestId("match-line")).toHaveText(`${mexicoCity} matched`);
  await expect(card(elsewhereInMexico)).toHaveCount(0);

  for (const id of ids) await forget(page, id);
});
