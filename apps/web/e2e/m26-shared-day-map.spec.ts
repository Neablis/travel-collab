import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { watchMapWorker } from "./helpers";
import { e2eTripName } from "./tripNames";

// SPEC §16 — **a shared day is a map plus a list** — in the only lane that can
// say so.
//
// M26 link 4 built `SharedDayMap` and `SharedDayMap.test.tsx` covers its logic
// against a stubbed MapLibre. What no test anywhere covered is the thing the
// gate box actually asks: that a real browser, given a real shared day, paints
// a real map. That gap is not hypothetical here — `watchMapWorker`'s own
// comment records a build where "the map drew its chrome — rail, legend, focus
// card, every locator the Map specs assert on — over a basemap that never
// decoded a tile. The whole suite stayed green and it reached production."
//
// **And the box was walked on the preview on 2026-09-20 and failed**: three
// shared days, `canvas=0` on every one. The component was right and the SEED
// was empty — no saved-day stop in the repository carried a `lat`, so
// `worthDrawing`'s two-point floor was unreachable by construction
// (`KI-2026-09-20-d`). A spec that builds its own located day is what keeps the
// drawing half from going dark again without anybody noticing, because this
// lane migrates a fresh database and does not run `db:seed` — the fixtures'
// coordinates are held by `packages/fixtures/src/savedDayCoordinates.test.ts`
// instead, and the two assertions are deliberately not the same one.
//
// Real coordinates rather than invented ones, for the reason KI-39 exists:
// Fushimi Inari and Kiyomizu-dera, both from `coordinates.json`. They are ~3km
// apart, which is what makes a route line between them something a `fitBounds`
// can frame rather than a single point.
const FUSHIMI = { lat: 34.9675192, lng: 135.7797101 };
const KIYOMIZU = { lat: 34.994303, lng: 135.7844389 };

type Stop = { title: string; at: string; lat?: number; lng?: number };

/**
 * A trip with one day, whose stops carry exactly the coordinates given.
 *
 * `lat`/`lng` are passed through the ordinary `AddActivity` command — the same
 * vocabulary `db:seed` and every other spec use (ADR-020) — so this exercises
 * the real write path down to `saved_days.stops`, not a fixture shortcut.
 */
async function tripWithLocatedStops(page: Page, name: string, stops: readonly Stop[]) {
  const post = async (path: string, body: unknown) => {
    const res = await page.request.post(path, { data: body });
    expect(res.ok(), `POST ${path} -> ${res.status()}: ${await res.text()}`).toBe(true);
    return res.json();
  };
  const { tripId } = (await post("/api/trips", { name })) as { tripId: string };
  const dayId = randomUUID();
  await post(`/api/trips/${tripId}/commands`, { type: "AddDay", tripId, dayId });
  for (const stop of stops) {
    await post(`/api/trips/${tripId}/commands`, {
      type: "AddActivity",
      tripId,
      activityId: randomUUID(),
      dayId,
      title: stop.title,
      timeWindow: { start: stop.at, end: stop.at.replace(/^(\d\d)/, (h) => String(Number(h) + 1).padStart(2, "0")) },
      location: { name: stop.title, city: "Kyoto", lat: stop.lat, lng: stop.lng },
    });
  }
  return { tripId, dayId };
}

async function keepDay(page: Page, tripId: string, dayId: string, name: string): Promise<string> {
  const res = await page.request.post("/api/saved-days", { data: { name, tripId, dayIds: [dayId] } });
  expect(res.ok(), `keep -> ${res.status()}`).toBe(true);
  return ((await res.json()) as { savedDay: { savedDayId: string } }).savedDay.savedDayId;
}

test.describe("M26 — SPEC §16's shared day is a map plus a list", () => {
  test("draws the located stops, numbered as the list numbers them", async ({ page }) => {
    test.slow();
    const worker = watchMapWorker(page);
    const dayName = `Kyoto on foot ${randomUUID().slice(0, 8)}`;
    const trip = await tripWithLocatedStops(page, e2eTripName("SharedDayMap"), [
      { title: "Fushimi Inari at opening", at: "07:30", ...FUSHIMI },
      // Deliberately unlocated and in the MIDDLE: the day then has two points
      // with a gap between them, which is the case `sharedDayGeometry` draws a
      // gapped leg for and which no seeded day had ever produced.
      { title: "Lunch somewhere unrecorded", at: "12:30" },
      { title: "Kiyomizu-dera at dusk", at: "17:00", ...KIYOMIZU },
    ]);
    const savedDayId = await keepDay(page, trip.tripId, trip.dayId, dayName);

    await page.goto(`/playbooks/day/${savedDayId}`);
    await expect(page.getByRole("heading", { name: dayName, level: 1 })).toBeVisible();

    // The canvas first, because its absence is the failure this exists for.
    // MapLibre's own class, not a bare `canvas`: it says the element came from
    // the map rather than from anything else that might draw on this page.
    await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();

    // Then the pins, by the numbers the LIST is showing. Asserting the count
    // alone would pass against the defect CodeRabbit caught on this PR, where
    // the map numbered continuously while a scoped list restarted at 1.
    const pins = page.locator('[data-testid="shared-day-pin"]');
    await expect(pins).toHaveCount(2);
    await expect(pins.nth(0)).toHaveAttribute("data-stop-number", "1");
    // 3, not 2: the unlocated middle stop still holds its place in the list,
    // so the second PIN is the third STOP. A pin and its row always agree.
    await expect(pins.nth(1)).toHaveAttribute("data-stop-number", "3");

    // Chrome over a dead basemap is the failure mode this helper was written
    // for, and it is invisible to every locator above.
    //
    // **Polled, not read once.** The first version of this line was
    // `expect(worker.outcome()).toBe("loaded")`, which reads the helper's state
    // at one instant and raced the worker's response — one flake in the first
    // full lane run, on a spec whose own subject is a map that looks fine and
    // is not. The helper's doc says to poll it and `m10-map-rail.spec.ts`
    // already did; this did not, and the lane said so within a run.
    await expect.poll(worker.outcome, { timeout: 20_000 }).toBe("loaded");
  });

  test("degrades to list-only rather than an empty canvas when one stop is located", async ({ page }) => {
    test.slow();
    const dayName = `One pin only ${randomUUID().slice(0, 8)}`;
    const trip = await tripWithLocatedStops(page, e2eTripName("SharedDayNoMap"), [
      { title: "Fushimi Inari at opening", at: "07:30", ...FUSHIMI },
      { title: "Lunch somewhere unrecorded", at: "12:30" },
    ]);
    const savedDayId = await keepDay(page, trip.tripId, trip.dayId, dayName);

    await page.goto(`/playbooks/day/${savedDayId}`);
    await expect(page.getByRole("heading", { name: dayName, level: 1 })).toBeVisible();
    // The list is there — so this is a day that rendered, not a day that failed.
    await expect(page.getByTestId("stop-list")).toBeVisible();

    // **The absence is asserted on the CONTAINER, not on the canvas**, and that
    // is the whole difference between this test and one that asserts nothing.
    // `toHaveCount(0)` on a canvas is satisfied by "not yet": MapLibre creates
    // it in an effect, so the assertion resolves before the map has had a
    // chance to mount and passes whatever the component decided. Checked by
    // lowering `MIN_POINTS_TO_DRAW` to 1 — which makes this day drawable — and
    // watching the canvas version stay GREEN.
    //
    // `shared-day-map` is rendered in the same React commit as the list above,
    // so once the list is visible this element either exists or the component
    // returned `null`. That is §16's degrade-to-list-only, stated as a fact
    // about the DOM rather than about a race.
    await expect(page.getByTestId("shared-day-map")).toHaveCount(0);
    await expect(page.getByTestId("shared-day-map-offline")).toHaveCount(0);
    // And then the canvas, for the failure the container check cannot see: a
    // map mounted somewhere else on the page. Only meaningful after the line
    // above has established the component bailed.
    await expect(page.locator("canvas")).toHaveCount(0);
  });
});
