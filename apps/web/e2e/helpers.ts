import { expect, type Locator, type Page } from "@playwright/test";

// @atlaskit/pragmatic-drag-and-drop is built on the browser's native HTML5
// Drag and Drop API. Locator.dragTo() drives it with a single mouse-down /
// one-jump mouse-move / mouse-up sequence, and relies on Chromium to
// translate that into dragstart/dragover/drop — a translation that requires
// recognizing drag intent from pointer movement within a timing window.
// Under CI's single-worker, resource-constrained runs that window is
// sometimes missed and the drop silently never registers (never reproduced
// locally, where the window is comfortably met). Firing the mouse sequence
// ourselves with several intermediate move steps gives Chromium's native
// drag recognition enough events to register reliably.
export async function dragCardTo(source: Locator, target: Locator): Promise<void> {
  // The board refetches and re-lays-out after every command (a new day pushes
  // the "+ Add day" button, a new card grows its column), so a drag fired
  // immediately after a prior mutation can read a box that's about to move or
  // start before pragmatic-drag-and-drop's monitor has re-registered. Wait for
  // both ends to be present and let layout settle before measuring.
  await source.waitFor({ state: "visible" });
  await target.waitFor({ state: "visible" });
  await source.scrollIntoViewIfNeeded();
  await source.page().waitForTimeout(300);
  const sourceBox = await source.boundingBox();
  if (!sourceBox) throw new Error("dragCardTo: source has no bounding box");

  const page = source.page();
  const viewport = page.viewportSize();
  const sx = sourceBox.x + sourceBox.width / 2;
  const sy = sourceBox.y + sourceBox.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  // A small initial move off the press point is what Chromium treats as
  // "drag intent" and turns into `dragstart` — without it, a single long jump
  // can be classified as a click and the whole HTML5 drag never begins (this
  // is the recognition window the taller time-windowed cards + wrapped grid
  // make easier to miss).
  await page.mouse.move(sx + 6, sy + 6, { steps: 3 });

  // A real cursor can never move past the visible viewport, so a target
  // whose box currently sits (partly) outside it — a day column pushed below
  // the fold by page content above the board — has to be reached by hovering
  // near the clamped edge and letting the window's drag-triggered auto-scroll
  // (Board.tsx's autoScrollWindowForElements) bring it into view, the same
  // way a real drag would. Jumping straight to an off-screen box center (the
  // prior approach) lands the pointer somewhere document.elementFromPoint
  // can't resolve to anything, so pragmatic-drag-and-drop never sees a drop
  // target and the drop silently no-ops.
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 4), max - 4);
  const pointAt = (box: { x: number; y: number; width: number; height: number }) => ({
    x: viewport ? clamp(box.x + box.width / 2, viewport.width) : box.x + box.width / 2,
    y: viewport ? clamp(box.y + box.height / 2, viewport.height) : box.y + box.height / 2,
  });
  const inViewport = (box: { y: number; height: number }) =>
    viewport === null || (box.y >= 0 && box.y + box.height <= viewport.height);

  let targetBox = await target.boundingBox();
  if (!targetBox) throw new Error("dragCardTo: target has no bounding box");
  let point = pointAt(targetBox);
  await page.mouse.move(point.x, point.y, { steps: 25 });

  // Hold near the edge and poll until auto-scroll has brought the target
  // fully into view, re-aiming at its updated (now on-screen) position.
  const deadline = Date.now() + 5000;
  while (!inViewport(targetBox) && Date.now() < deadline) {
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(100);
    const box = await target.boundingBox();
    if (!box) break;
    targetBox = box;
    point = pointAt(targetBox);
  }

  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(200);
  await page.mouse.up();
}

export async function signInAsDevUser(page: Page, username: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in" }).click();
  await page.fill('input[name="username"]', username);
  // Wait for the post-sign-in page's first authenticated /api/trips fetch —
  // it only fires after React hydrates, so the form's onSubmit is attached.
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/trips") && r.request().method() === "GET" && r.ok(),
    ),
    page.getByRole("button", { name: /sign in with dev login/i }).click(),
  ]);
  await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();
}

/**
 * Creates a trip with `dayCount` days, each carrying one located activity, via
 * the app's own command API. `page.request` shares the browser context's
 * cookies, so this runs as the already-signed-in dev user.
 *
 * The map rail only gears once its content overflows its viewport, which needs
 * more days than are practical to build through the UI. Same command shapes as
 * scripts/db-seed.mjs.
 */
export async function createMappedTrip(page: Page, name: string, dayCount: number): Promise<string> {
  const post = async (path: string, body: unknown) => {
    const response = await page.request.post(path, { data: body });
    if (!response.ok()) {
      throw new Error(`POST ${path} -> ${response.status()}: ${await response.text()}`);
    }
    return response.json();
  };

  const { tripId } = await post("/api/trips", { name });
  const cmd = (command: Record<string, unknown>) => post(`/api/trips/${tripId}/commands`, { ...command, tripId });

  const start = new Date();
  start.setDate(start.getDate() + 10);
  const end = new Date(start);
  end.setDate(end.getDate() + dayCount - 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const newDayIds = Array.from({ length: dayCount }, () => crypto.randomUUID());
  const { detail } = await cmd({
    type: "SetTripDates",
    startDate: iso(start),
    endDate: iso(end),
    newDayIds,
  });

  for (const [i, day] of detail.days.entries()) {
    const activityId = crypto.randomUUID();
    await cmd({
      type: "AddActivity",
      activityId,
      title: `Stop on day ${i + 1}`,
      timeWindow: { start: "09:00", end: "10:00" },
      // Spread apart so each day's fitBounds lands somewhere distinct.
      location: { name: `Place ${i + 1}`, city: `City ${i + 1}`, lat: 35 + i * 0.4, lng: 139 + i * 0.4, countryCode: "JP" },
    });
    await cmd({ type: "MoveActivity", activityId, toDayId: day.dayId, position: 0 });
  }

  return tripId as string;
}
