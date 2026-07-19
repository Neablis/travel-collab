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
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("dragCardTo: source or target has no bounding box");

  const page = source.page();
  const sx = sourceBox.x + sourceBox.width / 2;
  const sy = sourceBox.y + sourceBox.height / 2;
  const tx = targetBox.x + targetBox.width / 2;
  const ty = targetBox.y + targetBox.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  // A small initial move off the press point is what Chromium treats as
  // "drag intent" and turns into `dragstart` — without it, a single long jump
  // can be classified as a click and the whole HTML5 drag never begins (this
  // is the recognition window the taller time-windowed cards + wrapped grid
  // make easier to miss). Nudge first, then travel in many small steps, then
  // settle on the target for a beat so its onDragEnter/onDragOver hit-test
  // fires before the drop.
  await page.mouse.move(sx + 6, sy + 6, { steps: 3 });
  await page.mouse.move(tx, ty, { steps: 25 });
  await page.mouse.move(tx, ty);
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
