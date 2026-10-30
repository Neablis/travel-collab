import type { Page, Request } from "@playwright/test";
import { expect, test } from "./fixtures/test";

// Mitchell, 2026-10-30, on production: "when clicking playbook, there's a
// delay and it seems like page doesn't work, then swaps over after data is
// loaded. It should swap instantly, then load in data." `/playbooks` reads the
// library on the server before it answers, and with no loading boundary a
// link there held the page it came from until that read was done.
//
// The navigation's own RSC request is held, the prefetch is not: the prefetch
// is what carries a loading boundary to the browser ahead of the tap, so
// holding it would hold the fix too. With nothing to show but the answer,
// the router stays on Home for as long as the answer is held.

/**
 * The router's prefetch of `/playbooks` down to its loading boundary, settled.
 * It comes after a `/_tree` prefetch, and the router aborts it once it has
 * read what it needs, so it ends as a failure as often as a finish.
 */
function prefetched(page: Page): Promise<unknown> {
  const isIt = (request: Request) => {
    const headers = request.headers();
    return (
      new URL(request.url()).pathname === "/playbooks" &&
      headers["next-router-prefetch"] === "1" &&
      !headers["next-router-segment-prefetch"]
    );
  };
  return Promise.race([page.waitForEvent("requestfinished", isIt), page.waitForEvent("requestfailed", isIt)]);
}

/** The router's request for the page itself, as opposed to a prefetch of it. */
function isNavigation(request: Request): boolean {
  const headers = request.headers();
  return headers.rsc === "1" && !headers["next-router-prefetch"] && !headers["next-router-segment-prefetch"];
}

test("Playbooks swaps in its shell the moment it is clicked, while its days are still on the way", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(
    (url) => url.pathname === "/playbooks",
    async (route) => {
      if (isNavigation(route.request())) await held;
      await route.continue();
    },
  );

  // A real tap comes after the link has been on screen a moment, which is
  // when the router prefetches it.
  const ready = prefetched(page);
  await page.goto("/home");
  await ready;

  const link = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Playbooks" });

  await link.click();
  // Short on purpose: the answer is held, so only the boundary can draw these.
  await expect(page.getByRole("heading", { level: 1, name: "Discover" })).toBeVisible({ timeout: 2_000 });
  await expect(page.getByRole("status", { name: "Loading days" })).toBeVisible({ timeout: 2_000 });

  release();
  await expect(page.getByRole("status", { name: "Loading days" })).toBeHidden();
  await expect(page.getByRole("tablist", { name: "Whose days" })).toBeVisible();
});

