import { expect, type Locator, type Page } from "@playwright/test";
import { commandsFor } from "@tc/factories";

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
  // immediately after a prior mutation can read a box that's about to move.
  // waitFor({ state: "visible" }) plus scrollIntoViewIfNeeded's own
  // actionability checks (Playwright waits for the element to stop moving
  // before scrolling to it) are what stand in for the wall-clock sleep this
  // used to need — see KI-13's "no sleeps" principle.
  await source.waitFor({ state: "visible" });
  await target.waitFor({ state: "visible" });
  await source.scrollIntoViewIfNeeded();

  const sourceBox = await source.boundingBox();
  if (!sourceBox) throw new Error("dragCardTo: source has no bounding box");

  const page = source.page();
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

  // KI-21's traced root cause: a target whose box sat (partly) outside the
  // viewport — a day column pushed below the fold — depended on
  // drag-triggered auto-scroll (Board.tsx's autoScrollWindowForElements) to
  // finish inside a hand-rolled 5s polling budget, which a loaded machine
  // sometimes missed. Scrolling the target into view *after the drag has
  // already started* (rather than before, which could scroll a distant
  // source out of view before mouse.down ever fires at it) removes that
  // race entirely instead of widening the window: by the time the mouse
  // moves toward the target, it's already on screen. Re-read the target's
  // box after scrolling — its viewport-relative coordinates change with it.
  await target.scrollIntoViewIfNeeded();
  const targetBox = await target.boundingBox();
  if (!targetBox) throw new Error("dragCardTo: target has no bounding box");
  const tx = targetBox.x + targetBox.width / 2;
  const ty = targetBox.y + targetBox.height / 2;

  await page.mouse.move(tx, ty, { steps: 25 });
  await page.mouse.up();

  // No wait here for the drop to "register": the caller asserts the moved
  // card is where it expects (a web-first assertion, e.g. `toBeVisible()`),
  // and Playwright's own auto-waiting retries that until it's true or the
  // test's timeout expires. A helper-internal poll can only guess when the
  // drop landed; the app's own rendered state is the real signal.
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
 * more days than are practical to build through the UI. A thin wrapper over
 * `@tc/factories`'s `commandsFor("mappedTrip", ...)` — the same command
 * vocabulary unit tests, other e2e specs, and `db:seed` all share (ADR-020).
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
  for (const command of commandsFor("mappedTrip", tripId, { dayCount })) {
    await post(`/api/trips/${tripId}/commands`, command);
  }

  return tripId as string;
}
