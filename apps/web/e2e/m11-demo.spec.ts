import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { E2E_SUPER_CODE } from "./admission";

/**
 * A dev username nobody has used before, so the invite gate sees a genuinely
 * new account every run — which is the whole point of the sign-up walk below.
 *
 * Hex only and short, because `devLoginIdentity` bounds the charset to
 * `^[A-Za-z0-9_-]{1,32}$`; a name that failed it would fail the sign-in for the
 * wrong reason, and the refusal screen looks identical either way. Same shape
 * as `m11a-invite-gate.spec.ts`'s own `freshUsername`.
 */
function freshDemoUsername(): string {
  return `demo${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

// `/demo` is the real trip board, read-only, for someone with no account
// (ADR-031). The point of this spec is that it is the REAL board — the same
// four lenses, the same header, the same History popover, reading the same
// `/api/trips/:id` endpoints — and not a second, simpler page that only looks
// like the product.
//
// It is also what makes the landing page's second CTA provable at all. Before
// this, `/s/featured` resolved `DEMO_SHARE_TOKEN`, which was unset in CI and on
// every preview branch, so the only thing this suite could assert was that the
// CTA dead-ended in an empty state (KI-61).
//
// A genuinely signed-out browser context, not the "desktop" project's saved
// alice session: a demo that only works for people who already have an account
// is not a demo.
test.describe("the demo trip", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("both landing CTAs open the real board, read-only, with no account", async ({ page }) => {
    await page.goto("/welcome");
    for (const name of ["Look around a real trip", "See a finished one"]) {
      await expect(page.getByRole("link", { name })).toHaveAttribute("href", "/demo");
    }
    await page.getByRole("link", { name: "Look around a real trip" }).click();
    await expect(page).toHaveURL(/\/demo$/);

    // The real fixture through the real trip header.
    await expect(page.getByRole("heading", { name: "Japan: Tokyo → Kyoto → Osaka" })).toBeVisible();
    await expect(page.getByText("Viewer", { exact: true })).toBeVisible();
    await expect(page.getByText("This is an example trip — look around.")).toBeVisible();

    // The four lenses, each rendering the fixture's own content.
    await expect(page.getByRole("tab", { name: "Day columns" })).toBeVisible();
    await expect(page.getByText("Land at Haneda").first()).toBeVisible();

    await page.getByRole("tab", { name: "Timeline" }).click();
    await expect(page).toHaveURL(/view=Timeline/);
    await expect(page.getByText("Land at Haneda").first()).toBeVisible();

    await page.getByRole("tab", { name: "Calendar" }).click();
    await expect(page).toHaveURL(/view=Calendar/);
    // The calendar lays days out as dated cells, not stop titles, and a cell's
    // accessible name carries its ordinal, its date, and every card it renders
    // (M18; see CalendarLens's `cellLabel`). An aria-label REPLACES a button's
    // content for assistive technology, so anything missing from the name is
    // announced as nothing at all — which is why this asserts the whole string
    // rather than its head. A regex requiring only "Day 1," and "Tokyo" still
    // passes with the date, stop count, cost, window or booking count dropped.
    //
    // Only the date is a pattern: the fixture is dated relative to today
    // (ADR-030), so the weekday and month move while the rest is fixed.
    await expect(
      page.getByLabel(
        /^Day 1, \w{3}, \w{3} \d{1,2}\. Tokyo, 4 stops, \$990\.00, 2:30 pm to 10:30 pm, 2 to book$/,
      ),
    ).toBeVisible();
    // Day 14 is the trip's one two-city cell, and that is the point of
    // asserting it: the traveller wakes in Osaka (breakfast at the hotel, then
    // the Shinkansen out) and lands the last three stops in Tokyo, so the cell
    // renders a card per city in TIME order. Until KI-59 every stop on a
    // travel day carried the day's DESTINATION, so this read "Tokyo, 5 stops"
    // and the morning in Osaka was invisible.
    //
    // Pinning both cards and their counts, not just the first city: the whole
    // behaviour KI-59 changed is that this cell stopped being one card, and an
    // assertion on the head alone would pass again the moment it collapsed
    // back.
    await expect(
      page.getByLabel(/^Day 14, \w{3}, \w{3} \d{1,2}\. Osaka, 2 stops, .*\. Tokyo, 3 stops, /),
    ).toBeVisible();

    await page.getByRole("tab", { name: "Map" }).click();
    await expect(page).toHaveURL(/lens=Map/);

    await page.getByRole("tab", { name: "Day columns" }).click();
    await expect(page.getByText("Land at Haneda").first()).toBeVisible();
  });

  test("hides every control a signed-out visitor has no session for", async ({ page }) => {
    await page.goto("/demo");
    await expect(page.getByRole("heading", { name: "Japan: Tokyo → Kyoto → Osaka" })).toBeVisible();

    // Both go to `(app)` routes behind middleware — a trip to /signin.
    await expect(page.getByRole("link", { name: "← Your trips" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Notebook" })).toHaveCount(0);
    // A write, and owner-gated at that.
    await expect(page.getByRole("button", { name: "Share", exact: true })).toHaveCount(0);
    // Needs a session and is a write; it has no read-only half to fall back to.
    await expect(page.getByRole("button", { name: "Assistant" })).toHaveCount(0);
    // Withheld, exactly as it is for an invited viewer. This asserted
    // `toBeDisabled()` until KI-64: the header was the one place still
    // offering a greyed control on a board ADR-031 had otherwise gone quiet.
    await expect(page.getByRole("button", { name: "Add stop" })).toHaveCount(0);
  });

  test("shows the trip's own history, without offering to change it", async ({ page }) => {
    await page.goto("/demo");
    await expect(page.getByRole("heading", { name: "Japan: Tokyo → Kyoto → Osaka" })).toBeVisible();

    await page.getByRole("button", { name: /history/i }).click();
    // A real planning session, built from the fixture's own per-day command
    // groups — not an empty popover.
    await expect(page.getByText('Created trip "Japan: Tokyo → Kyoto → Osaka"')).toBeVisible();
    // Undo and redo are writes; the demo refuses every write, so it does not
    // advertise them.
    await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Redo" })).toHaveCount(0);
  });

  test("finishes the copy after sign-in, without a second click", async ({ page }) => {
    await page.goto("/demo");
    await page.getByRole("button", { name: "Make this trip mine" }).click();

    // The callbackUrl carries only the DESTINATION now. What tells the demo to
    // finish the job is the browser-local marker (`lib/pendingDemoClone.ts`) —
    // the `?clone=1` that used to ride along here is gone, because a URL is
    // shareable and a link should not be able to make a stranger take a copy
    // (Mitchell, 2026-09-01).
    await expect(page).toHaveURL(/\/signin\?callbackUrl=%2Fdemo$/);

    // No invite code, deliberately: M11a's gate only asks for one from someone
    // with no `users` row, and alice has had one since `auth.setup.ts` — which
    // every project here depends on. This is the returning-user path, and its
    // being unremarkable is the point.
    await page.fill('input[name="username"]', "alice");
    await page.getByRole("button", { name: /sign in with dev login/i }).click();

    // Straight through to their own copy — no second press of the button, and
    // the marker is gone from the URL on the way (Mitchell, 2026-08-28: "you
    // get redirected back to the sample board, and you need to click again").
    await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Japan: Tokyo → Kyoto → Osaka" })).toBeVisible();
    await expect(page.getByText("Viewer", { exact: true })).toHaveCount(0);
  });

  // The path Mitchell walked on 2026-09-01 and arrived from with no trip:
  // *"If you have never signed up, it askes you to sign up, and after you sign
  // up ... you dont have the trip from the demo you tried to clone."*
  //
  // It is a different walk from the one above in exactly the way that broke it.
  // The returning user goes `/demo` → `/signin` → back to `/demo`, where the
  // marker finishes the copy. Somebody with NO account has
  // to follow "Create an account" to reach the only screen with an invite-code
  // field — and that hop, plus the sign-up they then complete, is where the
  // callback was being dropped. So this asserts both carriers: the swap link
  // still holds the callbackUrl, and the copy happens even though a brand-new
  // account lands on the trip list rather than back on `/demo`.
  test("finishes the copy for somebody who had to make an account first", async ({ page }) => {
    test.slow();

    await page.goto("/demo");
    await page.getByRole("button", { name: "Make this trip mine" }).click();
    await expect(page).toHaveURL(/\/signin\?callbackUrl=%2Fdemo$/);

    // The hop that used to lose it. The link is built from the NORMALISED
    // callbackUrl, so this is also the assertion that a hostile one could not
    // ride across.
    const swap = page.getByRole("link", { name: "Create an account" });
    await expect(swap).toHaveAttribute("href", "/signup?callbackUrl=%2Fdemo");
    await swap.click();
    await expect(page).toHaveURL(/\/signup\?callbackUrl=/);

    // A genuinely new account: M11a's gate refuses anyone with no `users` row
    // and no credential, so this is the real sign-up, super code and all.
    await page.getByLabel("Invite code").fill(E2E_SUPER_CODE);
    await page.fill('input[name="username"]', freshDemoUsername());
    await page.getByRole("button", { name: /sign in with dev login/i }).click();

    // And they arrive holding the trip. Where they land on the way is
    // deliberately not asserted — the whole point of the browser-side marker is
    // that it does not depend on which of `/demo` or `/` the round trip chose.
    await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Japan: Tokyo → Kyoto → Osaka" })).toBeVisible();
    await expect(page.getByText("Viewer", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add stop" })).toBeEnabled();
  });
});

// The other half of the conversion, in the session it actually happens in: a
// signed-in visitor takes the demo home and it is a real, editable trip of
// their own.
// The already-signed-in half: one click, no detour.
test("a signed-in visitor makes the demo trip theirs, and can edit it", async ({ page }) => {
  test.slow();
  await page.goto("/demo");
  await expect(page.getByRole("heading", { name: "Japan: Tokyo → Kyoto → Osaka" })).toBeVisible();
  await expect(page.getByText("Viewer", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Make this trip mine" }).click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}/);

  // Now it is theirs: the same 14 days, and the read-only badge is gone.
  await expect(page.getByRole("heading", { name: "Japan: Tokyo → Kyoto → Osaka" })).toBeVisible();
  await expect(page.getByText("Viewer", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add stop" })).toBeEnabled();
});
