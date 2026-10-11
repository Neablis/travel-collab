import { randomUUID } from "node:crypto";
import type { ActivityView } from "@tc/contracts";
import { expect, test } from "./fixtures/test";
import { forget, publishedDay, signInAsDevUser, openNewParkedStop } from "./helpers";
import { e2eTripName } from "./tripNames";

// M34: the add-stop sheet lists what other travellers did in the trip's city,
// and a pick fills the form. Walked against the real route and the real
// library: a newcomer publishes a day, alice adds a stop from it.
//
// **The city is minted per run**, for `m12-discover.spec.ts`'s reason: the
// published library is global to the run's database, so a shared city name
// would make this an assertion about every other spec's days.
//
// **The header's "Add stop" opens the sheet with no day**, so the route falls
// back to the trip's cities (D1). That is the path a person takes most, and the
// one a river double-click narrows to a day; the day path is the integration
// test's.

test("adding a stop lists a published stop in the trip's city, and a pick fills the form", async ({ page, browser }) => {
  // Two contexts, two sign-ins and a publish: past CI's 30s default.
  test.slow();
  const city = `Nearbyville${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const playbookName = `M34 day ${city}`;

  // A newcomer publishes a one-stop day in the city: "Stop in <city>", 09:00–10:00.
  const publisherContext = await browser.newContext({ storageState: undefined });
  const publisher = await publisherContext.newPage();
  await signInAsDevUser(publisher, `m34pub${randomUUID().replace(/-/g, "").slice(0, 8)}`);
  const savedDayId = await publishedDay(publisher, city, playbookName);

  try {
    // alice's trip has one day with one stop in the same city.
    const post = async (path: string, data: unknown) => {
      const res = await page.request.post(path, { data });
      expect(res.ok(), `${path} -> ${res.status()}`).toBe(true);
      return res;
    };
    const created = await post("/api/trips", { name: e2eTripName("M34 nearby") });
    const { tripId } = (await created.json()) as { tripId: string };
    const dayId = randomUUID();
    await post(`/api/trips/${tripId}/commands`, { type: "AddDay", tripId, dayId });
    await post(`/api/trips/${tripId}/commands`, {
      type: "AddActivity",
      tripId,
      activityId: randomUUID(),
      dayId,
      title: "Check in",
      timeWindow: { start: "15:00", end: "16:00" },
      location: { name: `Hotel in ${city}`, city },
    });

    await page.goto(`/trips/${tripId}?view=Plan`);
    await openNewParkedStop(page);

    // Before typing: the newcomer's stop, saying which playbook it came from.
    const list = page.getByRole("list", { name: "Nearby stops from the library" });
    const pick = list.getByRole("button", { name: new RegExp(`Stop in ${city}`) });
    await expect(pick).toBeVisible();
    await expect(pick).toContainText(playbookName);

    // Typing narrows: something that matches nothing empties the list away.
    await page.getByLabel("What or where").fill("zzz-matches-nothing");
    await expect(list).toBeHidden();
    await page.getByLabel("What or where").fill("stop in");
    await expect(pick).toBeVisible();

    // A pick fills the name and the length, and the list steps aside.
    await pick.click();
    await expect(page.getByLabel("What or where")).toHaveValue(`Stop in ${city}`);
    await expect(page.getByLabel("How long")).toHaveValue("1 hour");
    await expect(list).toBeHidden();
    await page.getByRole("button", { name: "Add stop" }).last().click();

    // The saved stop carries the published stop's place, not just its name.
    await expect
      .poll(async () => {
        const res = await page.request.get(`/api/trips/${tripId}`);
        const body = (await res.json()) as { trip: { activities: Record<string, ActivityView> } };
        return Object.values(body.trip.activities)
          .filter((a) => a.title === `Stop in ${city}`)
          .map((a) => a.location?.name ?? null);
      })
      .toEqual([`Somewhere in ${city}`]);
  } finally {
    await forget(publisher, savedDayId);
    await publisherContext.close();
  }
});
