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
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("dragCardTo: source or target has no bounding box");

  const page = source.page();
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
    steps: 15,
  });
  // Hold briefly over the drop target so its onDragEnter/onDragOver hit-test
  // registers before the drop — the same recognition window that a single
  // jump can miss.
  await page.waitForTimeout(100);
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
