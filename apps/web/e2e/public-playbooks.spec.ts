import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { E2E_SUPER_CODE } from "./admission";
import { forget, publishedDay, stranger } from "./helpers";

// ADR-061: the playbook library is readable without an account. alice
// publishes a day, a stranger with no cookies opens its link, browses, and
// presses Add — which asks them to sign in or make an account, and opens the
// add dialog once they come back signed in.
//
// The city is minted per run for `m11b-playbooks.spec.ts`'s reason: the
// published library is global and cumulative across runs.

function mint(stem: string): string {
  return `${stem}${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

// A day page prefetches the links on it, the author's profile among them, and
// a browser that leaves mid-prefetch aborts the request: the server then logs
// "The destination stream closed early" for a render nobody is waiting for.
// Measured (2026-10-02): every such line was the profile's prefetch, so this
// watches only that one and returns a wait for "none in flight", called before
// each step that LEAVES a day page. Watching every prefetch flaked: one that is
// never reported finished held the wait open. Clean server output is what lets
// a real error stand out.
function prefetchesOf(page: Page): () => Promise<void> {
  const inFlight = new Set<unknown>();
  page.on("request", (request) => {
    if (request.url().includes("/playbooks/profile/") && request.url().includes("_rsc=")) inFlight.add(request);
  });
  page.on("requestfinished", (request) => inFlight.delete(request));
  page.on("requestfailed", (request) => inFlight.delete(request));
  // A new document cannot finish the last one's requests.
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) inFlight.clear();
  });
  return () => expect.poll(() => inFlight.size, { message: "prefetches still in flight" }).toBe(0);
}

test("a stranger opens a shared playbook, browses, and is asked to sign in to add it", async ({ page, browser }) => {
  test.slow();
  const city = mint("Lisbone2e");
  const dayName = `Tiles and tarts ${randomUUID().slice(0, 8)}`;
  const savedDayId = await publishedDay(page, city, dayName);

  try {
    const visitor = await stranger(browser);
    const settled = prefetchesOf(visitor);

    // The shared link opens — no bounce to /signin.
    // The bare id is the link as it was shared before days had slugs; it
    // lands on the day's current URL, `<slug>-<id>`.
    await visitor.goto(`/playbooks/day/${savedDayId}`);
    await expect(visitor).toHaveURL(new RegExp(`/playbooks/day/[a-z0-9-]*${savedDayId}$`));
    await expect(visitor.getByRole("heading", { name: dayName, level: 1 })).toBeVisible();

    // Its preview card is the day's, not the site's. The FIRST og:image is
    // what an unfurler draws; `pageMetadata` lists the site image after it as
    // the fallback, so there are two.
    await expect(visitor.locator('meta[property="og:title"]')).toHaveAttribute("content", dayName);
    await expect(visitor.locator('meta[property="og:image"]').first()).toHaveAttribute(
      "content",
      new RegExp(`/api/og/playbooks/day/${savedDayId}$`),
    );

    // The header offers the way in, and nothing a stranger could only fail at.
    const header = visitor.getByRole("banner");
    await expect(header.getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(header.getByRole("link", { name: "Create an account" })).toBeVisible();
    await expect(visitor.getByRole("button", { name: /^Report/ })).toHaveCount(0);

    // Add asks them to sign in or sign up, and both come back here.
    await visitor.getByRole("button", { name: "Add to a trip" }).click();
    const prompt = visitor.getByRole("dialog", { name: "Sign in to add this day" });
    await expect(prompt).toBeVisible();
    const back = encodeURIComponent(`/playbooks/day/${savedDayId}`);
    await expect(prompt.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", `/signin?callbackUrl=${back}`);
    await expect(prompt.getByRole("link", { name: "Create an account" })).toHaveAttribute(
      "href",
      `/signup?callbackUrl=${back}`,
    );

    // Browsing the rest of the library works too, without the scopes that
    // only mean something to an account.
    await settled();
    await visitor.goto(`/playbooks?city=${encodeURIComponent(city)}`);
    await expect(visitor.getByTestId("discover-card").filter({ hasText: dayName })).toBeVisible();
    await expect(visitor.getByRole("tab", { name: "Yours" })).toHaveCount(0);

    // Making the account brings them back to the day with the add dialog open.
    await visitor.goto(`/playbooks/day/${savedDayId}`);
    await visitor.getByRole("button", { name: "Add to a trip" }).click();
    await settled();
    await visitor.getByRole("dialog", { name: "Sign in to add this day" }).getByRole("link", { name: "Create an account" }).click();
    await expect(visitor).toHaveURL(/\/signup\?callbackUrl=/);
    await visitor.getByLabel("Invite code").fill(E2E_SUPER_CODE);
    await visitor.fill('input[name="username"]', mint("pubreader"));
    await visitor.getByRole("button", { name: /sign in with dev login/i }).click();
    await expect(visitor).toHaveURL(new RegExp(`/playbooks/day/[a-z0-9-]*${savedDayId}$`));
    await expect(visitor.getByRole("dialog", { name: `Add “${dayName}” to a trip` })).toBeVisible();

    await settled();
    await visitor.context().close();
  } finally {
    await forget(page, savedDayId);
  }
});

test("a private day is the same not-found to a stranger as one that never existed", async ({ page, browser }) => {
  test.slow();
  const city = mint("Portoe2e");
  const dayName = `Kept to myself ${randomUUID().slice(0, 8)}`;
  const savedDayId = await publishedDay(page, city, dayName);
  await page.request.delete(`/api/saved-days/${savedDayId}/publish`);

  try {
    const visitor = await stranger(browser);
    const day = await visitor.request.get(`/api/saved-days/${savedDayId}`);
    expect(day.status()).toBe(404);
    const unknown = await visitor.request.get(`/api/saved-days/${randomUUID()}`);
    expect(unknown.status()).toBe(404);
    // Writes still need an account.
    const review = await visitor.request.put(`/api/saved-days/${savedDayId}/reviews`, { data: { rating: 5 } });
    expect(review.status()).toBe(401);
    // And its preview says nothing about it.
    await visitor.goto(`/playbooks/day/${savedDayId}`);
    await expect(visitor.locator('meta[property="og:title"]')).not.toHaveAttribute("content", dayName);
    await visitor.context().close();
  } finally {
    await forget(page, savedDayId);
  }
});

// The FIRST paint, before any script runs: the server HTML. With no session
// cookie the layout knows nobody is signed in (`lib/sessionHint.ts`), so the
// shell arrives signed out instead of as a signed-in skeleton that changes its
// mind. With alice's cookie it arrives as it always has.
test("the server paints the signed-out shell for a stranger, and the signed-in one for alice", async ({ page, browser }) => {
  const visitor = await stranger(browser);
  const strangerHtml = await (await visitor.request.get("/playbooks")).text();
  expect(strangerHtml).toContain("Create an account");
  expect(strangerHtml).not.toContain('aria-label="Phone navigation"');
  await visitor.context().close();

  const aliceHtml = await (await page.request.get("/playbooks")).text();
  expect(aliceHtml).not.toContain("Create an account");
  expect(aliceHtml).toContain('aria-label="Phone navigation"');
});
