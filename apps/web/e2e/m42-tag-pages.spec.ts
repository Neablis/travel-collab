import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { forget, stranger } from "./helpers";
import { e2eTripName } from "./tripNames";

// M42 part 5, signed out: a tag page, a city's tag page, and Discover's tag
// filter and its next page. A day belongs to a tag when its description names
// the tag (ADR-070 §4), so the city holds one day of meals with a bar on it,
// which carries a Nightlife stop and is no nightlife day.
//
// The city is minted per run: the published library is global to the run's
// database (`m12-discover.spec.ts`).

/** One past Discover's page of 24, so there is a next page. */
const LATE_DAYS = 25;

/** A trip day in `city` with one stop per entry of `tags`, each tagged with it. */
async function tripDay(page: Page, city: string, tags: string[]): Promise<{ tripId: string; dayId: string }> {
  const post = async (path: string, data: unknown) => {
    const res = await page.request.post(path, { data });
    expect(res.ok(), `${path} -> ${res.status()}`).toBe(true);
    return res;
  };
  const { tripId } = (await (await post("/api/trips", { name: e2eTripName("Tag pages") })).json()) as { tripId: string };
  const dayId = randomUUID();
  await post(`/api/trips/${tripId}/commands`, { type: "AddDay", tripId, dayId });
  for (const [i, tag] of tags.entries()) {
    await post(`/api/trips/${tripId}/commands`, {
      type: "AddActivity",
      tripId,
      activityId: randomUUID(),
      dayId,
      title: `${tag} ${i}`,
      tags: [tag],
      location: { name: `Somewhere in ${city}`, city },
    });
  }
  return { tripId, dayId };
}

/** Keep that day as a playbook named `name`, and publish it. */
async function publish(page: Page, day: { tripId: string; dayId: string }, name: string): Promise<string> {
  const kept = await page.request.post("/api/saved-days", { data: { name, tripId: day.tripId, dayIds: [day.dayId] } });
  expect(kept.ok(), `keep -> ${kept.status()}`).toBe(true);
  const { savedDayId } = ((await kept.json()) as { savedDay: { savedDayId: string } }).savedDay;
  const published = await page.request.post(`/api/saved-days/${savedDayId}/publish`);
  expect(published.ok(), `publish -> ${published.status()}`).toBe(true);
  return savedDayId;
}

test("signed out: a tag page, a city's tag page, and Discover's tag filter and next page", async ({ page, browser }) => {
  test.slow();
  const city = `Tagcity${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const slug = city.toLowerCase();
  const ids: string[] = [];
  try {
    const late = await tripDay(page, city, ["nightlife", "nightlife", "nightlife", "nightlife"]);
    for (let i = 0; i < LATE_DAYS; i += 1) ids.push(await publish(page, late, `Late night ${city} ${i}`));
    const food = await tripDay(page, city, ["meal", "meal", "meal", "meal", "nightlife"]);
    ids.push(await publish(page, food, `Dinner ${city}`));

    const visitor = await stranger(browser);
    const dinner = visitor.getByRole("link", { name: `Dinner ${city}` });

    // The library's nightlife page lists the late nights, and not the dinner.
    await visitor.goto("/playbooks/tag/nightlife");
    await expect(visitor.getByRole("heading", { level: 1, name: "Nightlife playbooks" })).toBeVisible();
    await expect(visitor.getByRole("link", { name: new RegExp(`^Late night ${city} `) }).first()).toBeVisible();
    await expect(dinner).toHaveCount(0);

    // The city's nightlife page: its 25 days over two pages, the dinner on neither.
    await visitor.goto(`/playbooks/city/${slug}/nightlife`);
    await expect(visitor.getByRole("heading", { level: 1, name: `${city} nightlife playbooks` })).toBeVisible();
    await expect(visitor.getByText(`${LATE_DAYS} nightlife days other travelers planned in ${city}.`)).toBeVisible();
    await expect(dinner).toHaveCount(0);
    await visitor.getByRole("link", { name: "Next", exact: true }).click();
    await expect(visitor).toHaveURL(new RegExp(`/playbooks/city/${slug}/nightlife\\?page=2$`));
    await expect(visitor.getByTestId("place-days").getByTestId("discover-card")).toHaveCount(1);

    // Discover: the city's 26 days, then its 25 nightlife days, then their second page.
    await visitor.goto(`/playbooks?city=${city}`);
    const results = visitor.getByTestId("discover-results-line");
    await expect(results).toHaveText(`24 of ${LATE_DAYS + 1} shared days`);
    await visitor.getByTestId("filter-more").click();
    await visitor.getByTestId("filter-more-tag-nightlife").click();
    await expect(results).toHaveText(`24 of ${LATE_DAYS} shared days`);
    await expect(visitor).toHaveURL(/[?&]tag=nightlife/);
    await visitor.keyboard.press("Escape");
    await visitor.getByRole("link", { name: "Next page" }).click();
    await expect(visitor).toHaveURL(/[?&]after=[0-9a-f-]{36}/);
    await expect(results).toHaveText(`1 of ${LATE_DAYS} shared days`);
    await expect(visitor.getByTestId("discover-results").getByTestId("discover-card")).toHaveCount(1);
    await expect(dinner).toHaveCount(0);
    await expect(visitor.getByRole("link", { name: "First page" })).toBeVisible();
    await visitor.context().close();
  } finally {
    await Promise.all(ids.map((id) => forget(page, id)));
  }
});
