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

// ADR-066, KI-5 residual 2: the unit in flight never reaches the server. Its
// request is held inside Playwright and dies with the page, as a fetch the
// browser had not transmitted yet would. The flush carries that unit too,
// under its key, so it lands first and the edits behind it land after it.
// Before keys the flush could not carry it (it might already have been
// applied), and the trip persisted the last three edits without the first.
test("an edit whose request never left the page is still saved, ahead of the ones behind it", async ({ page }) => {
  const tripName = e2eTripName("Narvik");
  await page.goto("/");
  await createEmptyTripViaWizard(page, tripName);
  await page.getByRole("link", { name: tripName }).click();
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();
  await openPlan(page);

  const days = page.getByTestId("day-column");
  const before = await days.count();

  // Held, never forwarded: the server never sees the single-command send.
  await page.route("**/api/trips/*/commands", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await new Promise(() => {});
  });

  const addDay = page.getByRole("button", { name: "Add a day", exact: true });
  for (let i = 0; i < 4; i++) await addDay.click();
  await expect(days).toHaveCount(before + 4);

  const tripId = new URL(page.url()).pathname.split("/")[2];
  // The route stays: removing it hands the held request on to the server,
  // which is the case above, not this one. The flush goes to `/commands/batch`,
  // which this pattern does not match.
  await page.reload();

  const persistedDays = async () => {
    const res = await page.request.get(`/api/trips/${tripId}`);
    return ((await res.json()) as { trip: { days: unknown[] } }).trip.days.length;
  };
  await expect.poll(persistedDays).toBe(before + 4);
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

// KI-2026-10-09-e: the unload flush with the service worker in control and no
// Playwright route anywhere. M39's worker had a `fetch` listener, and a listener
// that declines a request still pulls every request through the worker — the
// flush included. During unload the worker's fall-back to the network often ran
// after the page was gone, and the batch never reached the server (13 of 20
// reloads lost edits; 0 of 20 with the worker blocked). The other tests here
// route `/commands`, which Playwright serves before any worker sees it, so none
// of them could show it.
//
// The slow network is the browser's own (CDP latency), so the queue is still
// full at the reload exactly as on a slow phone connection.
test("edits queued at a reload reach the server with the service worker in control", async ({ page }) => {
  const created = await page.request.post("/api/trips", { data: { name: e2eTripName("Alta") } });
  const tripId = ((await created.json()) as { tripId: string }).tripId;

  // Production builds register the worker after hydration, and `claim()` on
  // activate hands it the open page; the trip page is then loaded under it.
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.goto(`/trips/${tripId}?view=Plan`);
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  const days = page.getByTestId("day-column");
  await expect(page.getByRole("button", { name: "Add a day", exact: true })).toBeVisible();
  const before = await days.count();

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 400,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });

  const addDay = page.getByRole("button", { name: "Add a day", exact: true });
  for (let i = 0; i < 6; i++) await addDay.click();
  await expect(days).toHaveCount(before + 6);

  const persistedDays = async () => {
    // `page.request` is not the page's network, so the CDP latency above does
    // not slow this read.
    const res = await page.request.get(`/api/trips/${tripId}`);
    return ((await res.json()) as { trip: { days: unknown[] } }).trip.days.length;
  };
  // The witness: had the queue drained before the reload, the poll below would
  // pass with no flush at all. Something must still be unsent on the client
  // AND missing on the server, or this run proves nothing. The server read is
  // the one that bites — with the latency removed the light still read
  // "Saving…" while the server already held all six.
  await expect(page.getByRole("status")).toHaveAttribute("aria-label", "Saving…");
  expect(await persistedDays()).toBeLessThan(before + 6);
  await page.reload();

  await expect.poll(persistedDays).toBe(before + 6);
});
