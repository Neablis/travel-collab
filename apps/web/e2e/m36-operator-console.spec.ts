import { randomUUID } from "node:crypto";
import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { E2E_SUPER_CODE } from "./admission";
import { E2E_ADMIN_USERNAME } from "./adminBootstrap";

// **M36 link 6 — the operator console, walked** (exit gate: *"The e2e spec
// passes on `test:e2e:ci-like`"*).
//
// One journey an operator actually makes: every tab of the strip, then an
// account found by search and filter, opened, granted a plan, the grant
// revoked, and back to the table with the view kept. What each half proves
// that the component tests cannot:
//
//   * **The tab is URL state end to end.** `ConsoleTabs` pushes `?tab=`, the
//     server page reads it and renders that tab's body — a strip that pushed
//     the wrong value, or a page that ignored it, renders the wrong panel.
//   * **The view survives the round trip through the server.** The table writes
//     `q`/`filter` with `history.replaceState`, the row carries them into the
//     account link, the server builds *← All accounts* from them, and the table
//     re-seeds from that URL. Four hands; one dropped param breaks it.
//
// What `m20-entitlements.spec.ts` already proves — that the grant lands on the
// account that was clicked, and that the dialog names it rather than asking —
// is not re-asserted here beyond what the journey needs to keep going.
//
// **No ledger numbers are asserted.** CI's database may hold no assistant turns
// and no saved notebooks, so the AI models and Library tabs are each accepted
// in either of their two shapes — what is checked is that the tab rendered ITS
// body, not what the body counts.
//
// `test.slow()`: two sign-ins and a dozen server renders, m20's reason.

function newcomer(prefix: string): string {
  return `${prefix}${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/** Dev sign-in without the suite's shared storage state (m20's `signInAs`). */
async function signInAs(page: Page, username: string): Promise<void> {
  await page.goto("/signup");
  await page.getByLabel("Invite code").fill(E2E_SUPER_CODE);
  await page.getByLabel("Username", { exact: true }).fill(username);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/trips") && r.request().method() === "GET" && r.ok(),
    ),
    page.getByRole("button", { name: /sign in with dev login/i }).click(),
  ]);
  await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();
}

/** A second context, signed in as the configured operator. */
async function openOperator(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await signInAs(page, E2E_ADMIN_USERNAME);
  return page;
}

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("M36 — the operator console", () => {
  test.slow();

  test("an operator walks every tab, then opens, grants, revokes and comes back to the same view", async ({
    page,
    browser,
  }) => {
    // A fresh account, so it is on the first page of the table (newest first)
    // and holds `free` with nothing an earlier run granted it.
    const who = newcomer("m36walk");
    await signInAs(page, who);
    const userId = `dev-${who}`;
    const session = (await (await page.request.get("/api/auth/session")).json()) as {
      user?: { email?: string };
    };
    const address = session.user?.email ?? userId;

    const operator = await openOperator(browser);
    await operator.setViewportSize({ width: 1440, height: 900 });
    await operator.goto("/admin");
    const strip = operator.getByRole("tablist", { name: "Console sections" });

    // **Financial is the default**, and its tier panel is its landmark.
    await expect(strip.getByRole("tab", { name: "Financial" })).toHaveAttribute("aria-selected", "true");
    await expect(operator.getByRole("tablist", { name: "Tier" })).toBeVisible();

    // **Library**: Reports, then notebooks in whichever shape the DB allows.
    await strip.getByRole("tab", { name: "Library" }).click();
    await expect(operator).toHaveURL(/[?&]tab=library(&|$)/);
    await expect(operator.getByRole("heading", { name: "Reports", exact: true })).toBeVisible();
    await expect(
      operator
        .getByRole("region", { name: "Notebooks" })
        .or(operator.getByRole("heading", { name: "No notebooks saved yet" })),
    ).toBeVisible();
    await expect(operator.getByRole("tablist", { name: "Tier" })).toBeHidden();

    // **AI models**: the strip, or the no-usage box in its place.
    await strip.getByRole("tab", { name: "AI models" }).click();
    await expect(operator).toHaveURL(/[?&]tab=ai(&|$)/);
    await expect(
      operator
        .getByTestId("ai-turns")
        .or(operator.getByRole("heading", { name: /^No assistant turns in the last \d+ days$/ })),
    ).toBeVisible();
    await expect(operator.getByRole("heading", { name: "Reports", exact: true })).toBeHidden();

    // **Users**: the accounts table.
    await strip.getByRole("tab", { name: "Users" }).click();
    await expect(operator).toHaveURL(/[?&]tab=users(&|$)/);
    await expect(operator.getByTestId("accounts-table")).toBeVisible();

    // **Search and filter, written to the URL.** The fresh account holds a plan
    // that grants nothing, so *Free* contains it.
    const search = operator.getByRole("textbox", { name: "Find an account" });
    await search.fill(who);
    const free = operator.getByRole("button", { name: /^Free\s*\d+$/ });
    await free.click();
    await expect(free).toHaveAttribute("aria-pressed", "true");
    await expect(operator).toHaveURL(new RegExp(`[?&]q=${who}(&|$)`));
    await expect(operator).toHaveURL(/[?&]filter=unentitled(&|$)/);

    // **The row itself opens the account** — a cell that is not the link, so
    // this is the row's click and not the anchor m20 already follows.
    const row = operator.getByTestId(`account-${userId}`);
    // Matched by plan, not version: `free@v2` being published must not break the walk.
    await row.getByRole("cell", { name: /^free@v\d+$/ }).click();
    await expect(operator).toHaveURL(new RegExp(`[?&]account=${encodeURIComponent(userId)}(&|$)`));
    const account = operator.getByTestId("account-page");
    await expect(account.getByText(address, { exact: true })).toBeVisible();
    await expect(account.getByRole("heading", { name: "Plan and grants" })).toBeVisible();
    await expect(operator.getByTestId("accounts-table")).toBeHidden();

    // **Grant**, through the page's own dialog.
    await account.getByRole("button", { name: `Grant a plan to ${userId}` }).click();
    const dialog = operator.getByRole("dialog");
    await dialog.getByLabel("Plan", { exact: true }).selectOption("premium");
    await dialog.getByLabel("Reason", { exact: true }).fill("e2e: M36 console walk");
    await dialog.getByRole("button", { name: "Grant" }).click();
    await expect(dialog).toBeHidden();
    const card = account.getByRole("listitem").filter({ hasText: /^admin grant · premium v\d+/ });
    await expect(card).toBeVisible();

    // **Revoke, which asks first.** The card's own button only opens the
    // confirm; the confirm's *Revoke* is the write.
    await card.getByRole("button", { name: /^Revoke the admin grant of premium v\d+$/ }).click();
    await card.getByRole("button", { name: "Revoke", exact: true }).click();
    await expect(card).toHaveCount(0);
    // And the server agrees: the history is the re-read page's, not the
    // card's local hide.
    await expect(
      account.getByRole("list", { name: "Plan history" }).getByText(/^Revoked the admin grant of premium v\d+/),
    ).toBeVisible();

    // **← All accounts, with the view kept** — the URL, the input, the chip.
    await account.getByRole("link", { name: "← All accounts" }).click();
    await expect(operator.getByTestId("accounts-table")).toBeVisible();
    await expect(operator).not.toHaveURL(/[?&]account=/);
    await expect(operator).toHaveURL(new RegExp(`[?&]q=${who}(&|$)`));
    await expect(operator).toHaveURL(/[?&]filter=unentitled(&|$)/);
    await expect(search).toHaveValue(who);
    await expect(free).toHaveAttribute("aria-pressed", "true");
    await expect(row).toBeVisible();

    await operator.context().close();

    // **Every tab answers a non-admin 404, an account page included** — the
    // route group is not merely hidden, per tab (gate's [walk] box, held here).
    for (const tab of ["financial", "users", "library", "ai"]) {
      expect((await page.request.get(`/admin?tab=${tab}`)).status(), `?tab=${tab}`).toBe(404);
    }
    expect((await page.request.get(`/admin?tab=users&account=${encodeURIComponent(userId)}`)).status()).toBe(404);
  });
});
