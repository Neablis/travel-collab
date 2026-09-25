import { expect, test } from "./fixtures/test";
import { openPlan, createEmptyTripViaWizard } from "./helpers";
import { e2eTripName } from "./tripNames";

// KI-5: several edits made quickly, then a reload before the send queue has
// drained. The sender persists one unit at a time, so everything queued behind
// the unit in flight used to live only in memory and die with the page — the
// server kept the first edit and silently lost the rest.
//
// The single-command endpoint's RESPONSES are slowed by 400ms so the queue is
// still full when the page goes, which is the only way to make "before the
// queue drains" deterministic. The request itself reaches the server at once,
// as it does in a real browser: holding the request inside Playwright instead
// makes the unit in flight die with the page before it was ever sent, which no
// real network does to a request this small. The batch endpoint is left alone;
// it is what the unload flush uses.
test("edits still queued when the page reloads are not lost", async ({ page }) => {
  const tripName = e2eTripName("Tromso");
  await page.goto("/");
  await createEmptyTripViaWizard(page, tripName);
  await page.getByRole("link", { name: tripName }).click();
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();
  await openPlan(page);

  const days = page.getByTestId("day-column");
  const before = await days.count();

  await page.route("**/api/trips/*/commands", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    await new Promise((r) => setTimeout(r, 400));
    // The page that sent it may be gone by now; that is the point of the test.
    await route.fulfill({ response }).catch(() => {});
  });

  const addDay = page.getByRole("button", { name: "Add a day", exact: true });
  for (let i = 0; i < 4; i++) await addDay.click();
  await expect(days).toHaveCount(before + 4);

  const tripId = new URL(page.url()).pathname.split("/")[2];
  await page.reload();

  // Asked of the server, and polled: the flush is a request the old page left
  // behind, and nothing orders it before the reloaded page's own reads.
  const persistedDays = async () => {
    const res = await page.request.get(`/api/trips/${tripId}`);
    return ((await res.json()) as { trip: { days: unknown[] } }).trip.days.length;
  };
  await expect.poll(persistedDays).toBe(before + 4);
  // And the board says so, which also shows nothing was applied twice.
  await page.reload();
  await expect(days).toHaveCount(before + 4);
});

// The same queue, left by an IN-APP navigation instead of a reload: the page
// lives on, so the queue is drained after the unit in flight, one unit at a
// time — four edits, four history entries, where the reload's single keepalive
// batch makes two (the unit in flight, then everything behind it).
test("edits still queued when you navigate away inside the app are each saved on their own", async ({ page }) => {
  const tripName = e2eTripName("Bodo");
  await page.goto("/");
  await createEmptyTripViaWizard(page, tripName);
  await page.getByRole("link", { name: tripName }).click();
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();
  await openPlan(page);

  const days = page.getByTestId("day-column");
  const before = await days.count();

  await page.route("**/api/trips/*/commands", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    await new Promise((r) => setTimeout(r, 400));
    await route.fulfill({ response }).catch(() => {});
  });

  const addDay = page.getByRole("button", { name: "Add a day", exact: true });
  for (let i = 0; i < 4; i++) await addDay.click();
  await expect(days).toHaveCount(before + 4);

  const tripId = new URL(page.url()).pathname.split("/")[2];
  await page.getByRole("link", { name: "Trips", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();

  const addedDayEntries = async () => {
    const res = await page.request.get(`/api/trips/${tripId}/history`);
    const { history } = (await res.json()) as { history: { entries: { description: string }[] } };
    return history.entries.map((e) => e.description).filter((d) => d.startsWith("Added Day"));
  };
  await expect.poll(async () => (await addedDayEntries()).length).toBe(4);
  expect((await addedDayEntries()).filter((d) => d.includes(";"))).toEqual([]);
});
