import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { E2E_SUPER_CODE } from "./admission";
import { E2E_ADMIN_USERNAME } from "./adminBootstrap";
import { e2eTripName } from "./tripNames";

// **M20's exit gate, walked** — *"An account knows what it may do."*
//
// Five of the gate's boxes are only true end to end, and each is something a
// person does rather than a function that returns:
//
//   1. **A free account plans a whole trip with no gate anywhere.** The
//      milestone's most important negative, and the one this file exists for
//      most: everything else here is a gate, and a gate arriving on the
//      planning path is the failure M20 is most likely to cause.
//   2. A free account is refused `/ask` with **402** and `ai-not-entitled`, and
//      the refusal names the tier rather than reading as a permission error.
//   3. A free owner cannot invite: the *Invite someone* form is **not
//      rendered**, and a named-tier block takes its place.
//   4. **An admin grants premium and it bites on the next request — no
//      sign-out, no token refresh.** The session cookie is captured before and
//      compared after, so "the JWT is unchanged" is a fact rather than a claim.
//   5. A non-admin reaches **no admin route and no admin endpoint** — the route
//      group is not merely hidden.
//
// **Every write here goes through a shipped endpoint.** The operator actions
// are driven as a real signed-in admin against `/api/admin/grants`, not through
// a test-only door: the whole point of link 7 is that this milestone is
// provable without Stripe, and a bespoke e2e endpoint would prove something
// else. The admin exists because `playwright.config.ts` names it in
// `ADMIN_USER_IDS`, which is the same bootstrap a real deployment uses.
//
// **Fresh identities per test**, for the reason `m11-invites.spec.ts` mints
// them: M20 makes "has this account ever held a trial" a real question, so a
// fixed name would be new exactly once and every later run would be describing
// a different account than the assertions do.
//
// Each test drives at least one full sign-in, so `test.slow()` — a budget
// failure is fixed with the budget, not with a retry.

function newcomer(prefix: string): string {
  return `${prefix}${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/**
 * Sign in as a dev account, WITHOUT the suite's shared storage state.
 *
 * `auth.setup.ts` signs in as alice once and every other spec reuses it. This
 * spec cannot: alice has existed for many runs, and M20's questions are all
 * about what a particular account holds.
 */
async function signInAs(page: Page, username: string): Promise<void> {
  await page.goto("/signup");
  await page.getByLabel("Invite code").fill(E2E_SUPER_CODE);
  // eslint-disable-next-line playwright/prefer-locator -- matches signInAsDevUser's grandfathered selector
  await page.fill('input[name="username"]', username);
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

async function createTrip(page: Page, name: string): Promise<string> {
  const response = await page.request.post("/api/trips", { data: { name } });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { tripId: string }).tripId;
}

/** Every active grant the console reports for one account. */
async function grantsFor(operator: Page, userId: string) {
  const res = await operator.request.get("/api/admin/overview");
  expect(res.ok(), await res.text()).toBe(true);
  const { overview } = (await res.json()) as {
    overview: { accounts: { userId: string; grants: { id: string; source: string }[] }[] };
  };
  return overview.accounts.find((account) => account.userId === userId)?.grants ?? [];
}

// Storage state is per-test here, not the shared alice one.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("M20 — an account knows what it may do", () => {
  test.slow();

  test("a free account plans a whole trip, with no gate anywhere", async ({ page }) => {
    await signInAs(page, newcomer("m20planner"));
    const name = e2eTripName("M20 free planning");
    const tripId = await createTrip(page, name);

    await page.goto(`/trips/${tripId}?view=Plan`);
    await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();

    // Dates and days — planning commands the free plan entitles in full,
    // through the app's own API as the signed-in free account.
    // The bare command is the body — `POST /commands` parses it as a
    // `TripCommand`, not as `{ command }`.
    const dated = await page.request.post(`/api/trips/${tripId}/commands`, {
      data: {
        type: "SetTripDates",
        tripId,
        startDate: "2028-05-01",
        endDate: "2028-05-02",
        newDayIds: [randomUUID(), randomUUID()],
      },
    });
    expect(dated.ok(), await dated.text()).toBe(true);

    await page.reload();
    await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
  });

  test("a free owner meets the collaboration gate, and it names the tier", async ({ page }) => {
    await signInAs(page, newcomer("m20owner"));
    const tripId = await createTrip(page, e2eTripName("M20 collaboration"));

    await page.goto(`/trips/${tripId}?view=Plan`);
    await page.getByRole("button", { name: /trip settings/i }).click();

    const gate = page.getByTestId("collaborators-gate");
    await expect(gate).toContainText("Premium");
    await expect(gate).toContainText("always free");
    // Not disabled — ABSENT. A disabled button beside an explanation offers a
    // control that can never work.
    await expect(page.getByRole("button", { name: "Invite someone" })).toHaveCount(0);
  });

  test("a non-admin reaches neither the console nor its endpoint", async ({ page }) => {
    await signInAs(page, newcomer("m20nonadmin"));
    expect((await page.request.get("/api/admin/overview")).status()).toBe(404);
    expect((await page.request.get("/admin")).status()).toBe(404);
  });

  test("an operator sees the console, and a non-operator gets a 404", async ({ browser }) => {
    const operator = await openOperator(browser);
    await operator.goto("/admin");
    await expect(operator.getByRole("heading", { name: "Operator console", level: 1 })).toBeVisible();
    // Read-only over plans, and the three sold plans are on it.
    await expect(operator.getByTestId("plan-free")).toBeVisible();
    await expect(operator.getByTestId("plan-premium")).toBeVisible();
    // **The fourth-plan proof is published and disabled**, so the console shows
    // it and says so.
    await expect(operator.getByTestId("plan-studio")).toContainText("disabled");
    // **No revenue.** MRR, ARPU and margin are M21's.
    await expect(operator.locator("body")).not.toContainText("MRR");
    await expect(operator.locator("body")).not.toContainText("ARPU");
    await operator.context().close();
  });

  // **Granting happens in a dialog opened from the account's own row**
  // (Mitchell, on the #174 preview: *"Grants are spose to be a modal that is
  // triggered off a button here"*).
  //
  // This replaces a test that measured whether the old inline form's controls
  // shared a row. That form is gone, and a geometry assertion about a layout
  // that no longer exists is worse than no assertion — it passes, so it reads
  // as coverage. What is worth asserting now is the property the move was FOR:
  // the account is carried by the row rather than retyped, so the grant cannot
  // land on a different account than the one the operator clicked.
  test("an operator grants from an account's row, and the row updates", async ({ page, browser }) => {
    // A fresh account, so the row's before-state is known rather than whatever
    // the shared fixtures have accumulated. `adminAccounts` orders by
    // `createdAt` descending, so the newest account is on the first page of the
    // console's 100-row bound.
    const who = newcomer("m20modal");
    await signInAs(page, who);
    const userId = `dev-${who}`;

    const operator = await openOperator(browser);
    await operator.setViewportSize({ width: 1440, height: 900 });
    await operator.goto("/admin");

    const row = operator.getByTestId(`account-${userId}`);
    await expect(row).toContainText("free@v1");

    // The dialog is not open until the row's own button opens it.
    await expect(operator.getByRole("dialog")).toBeHidden();
    await row.getByRole("button", { name: `Grant a plan to ${userId}` }).click();

    const dialog = operator.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // **The account is shown, not typed** — the whole point of opening from the
    // row. A text box here would be the mistyped-id defect back again.
    await expect(dialog).toContainText(userId);
    await expect(dialog.getByRole("textbox", { name: "Account id" })).toBeHidden();

    await dialog.getByLabel("Plan", { exact: true }).selectOption("premium");
    await dialog.getByLabel("Reason", { exact: true }).fill("e2e: granted from the row");
    await dialog.getByRole("button", { name: "Grant" }).click();

    // Closing IS the confirmation, and the refreshed row is the evidence: the
    // console re-reads server-side after a write, so a stale row here would
    // mean an operator reissuing a grant that already landed.
    await expect(dialog).toBeHidden();
    await expect(row).toContainText("premium");
    await expect(row).toContainText("ai.ask");

    await operator.context().close();
  });

  // **There is a way out of the console** (Mitchell, #174 preview: *"Introduce a
  // navigation back to the account homepage here so i dont need to memorize
  // urls"*). The route group sits outside `(app)`, so it inherited none of the
  // app chrome and could only be left by typing a URL.
  //
  // The second assertion is the one that matters more than it looks. The header
  // is mounted under `PreferencesProvider`, and `AccountSettingsSheet` calls
  // `useAccountPreferences`, which THROWS outside that provider — so a header
  // mounted bare would look right and blow up when an operator opened the menu
  // item they came for. Clicking it is the only way to catch that.
  test("the console has a way back, and its account menu opens", async ({ browser }) => {
    const operator = await openOperator(browser);
    await operator.setViewportSize({ width: 1440, height: 900 });
    await operator.goto("/admin");

    await operator.getByRole("link", { name: "Trips" }).click();
    await expect(operator.getByRole("heading", { name: "Your trips" })).toBeVisible();

    // Back in, through the menu rather than the address bar — the round trip is
    // the thing being asserted, not either half of it.
    await operator.getByRole("button", { name: "Account menu" }).click();
    await operator.getByRole("link", { name: "Operator console" }).click();
    await expect(operator.getByRole("heading", { name: "Operator console", level: 1 })).toBeVisible();

    // The provider trap: this throws without `PreferencesProvider`.
    await operator.getByRole("button", { name: "Account menu" }).click();
    await operator.getByRole("button", { name: "Your account" }).click();
    await expect(operator.getByRole("dialog")).toBeVisible();

    await operator.context().close();
  });

  // **An account can see what it holds, and reach its referral code**
  // (M20 link 5's display half and link 8's missing half; gate boxes added
  // 2026-09-14). Before this the sheet had no plan surface at all, so every
  // entitlement the milestone built was invisible to the person holding it.
  test("the account sheet shows the plan, the meters and a referral code", async ({ page }) => {
    const who = newcomer("m20plan");
    await signInAs(page, who);

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Your account" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByTestId("plan-held")).toContainText("free");

    // **The meters read the ceilings actually in force, not the held
    // version's** — and this account proves why the distinction matters. It
    // holds `free`, which grants no assistant at all, and carries the one-week
    // `plus` trial every new account gets. `/ask` charges it against the
    // trial's 50, so 50 is what the meter must say; `0` would be the held
    // version's number and would contradict an assistant that answers.
    await expect(sheet.getByTestId("meter-questions")).toContainText("/ 50");

    // **Looking is not spending.** Re-opening must not move the used count —
    // a meter that charged the counter it reports would be a quota bug.
    const before = await sheet.getByTestId("meter-questions").textContent();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Your account" }).click();
    await expect(page.getByRole("dialog").getByTestId("meter-questions")).toHaveText(before ?? "");

    // Link 8's whole premise: a code you can actually issue.
    await page.getByRole("dialog").getByRole("button", { name: "Create a code" }).click();
    await expect(page.getByRole("dialog").getByTestId("referral-code")).not.toBeEmpty();
  });

  // **The plan chooser is shelled, and shelled means INERT.** It is drawn from
  // the committed plan file — real plans, real entitlements — and cannot charge
  // anyone, because paying is M21. `Preview` puts a shield over its children
  // that swallows pointer events, so this asserts the behaviour rather than the
  // presence of a badge.
  test("the plan chooser is real data behind a shell that cannot fire", async ({ page }) => {
    const who = newcomer("m20chooser");
    await signInAs(page, who);
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Your account" }).click();

    const chooser = page.getByRole("dialog").getByTestId("plan-chooser");
    const select = chooser.getByLabel("Change plan", { exact: true });
    // Real plans from the committed plan file, and the held one named as held
    // rather than offered for sale.
    await expect(select.locator("option", { hasText: "premium" })).toHaveCount(1);
    await expect(select.locator("option", { hasText: "free — what you hold" })).toHaveCount(1);
    // The disabled fourth-plan proof is published and NOT offered: `enabled`
    // bounds what can be handed out, which is what lets it ship unreachable.
    await expect(select.locator("option", { hasText: "studio" })).toHaveCount(0);

    // **No price anywhere on the screen.** M20 never learns what a plan costs.
    await expect(page.getByRole("dialog")).not.toContainText("$");

    // **Every enabled plan, readable by a person — not just on the wire.**
    // The gate box asks for "every enabled plan, its entitlements and its
    // ceilings", and the assertions above only prove the option LABELS exist.
    // A walk of the deployed preview (2026-09-14) found the description was
    // rendered for the selected plan alone and the steps ceiling for none —
    // and because the select is inside the shield asserted below, a person can
    // never move the selection to read another plan's line. So the catalogue
    // is rendered outside the shell, and this is the deployed-layer proof of
    // it; `PlanSection.test.tsx` carries the same claim at the component layer.
    const offers = page.getByRole("dialog").getByTestId("plan-catalogue");
    await expect(offers.getByTestId("plan-offer-premium")).toContainText("trip.collaborators");
    await expect(offers.getByTestId("plan-offer-premium")).toContainText(
      "200 questions and 1600 steps a day.",
    );
    await expect(offers.getByTestId("plan-offer-plus")).toContainText(
      "50 questions and 400 steps a day.",
    );

    // **The shield, asserted as a click that cannot land.** Asserting "the held
    // plan did not change" would have been worthless: these buttons carry no
    // handler, so that passes with or without the shell. What `Preview`
    // actually guarantees is that no control inside it is reachable — it lays a
    // pointer-event-swallowing layer over its children — so the honest test is
    // that Playwright's actionability wait never resolves.
    const pick = chooser.getByRole("button", { name: /^Change to |^This is your plan$/ });
    // **The witness first.** `click()` also rejects when the button does not
    // exist, so the rejection alone would keep passing after the control was
    // deleted — a test that proves "unreachable" by way of "absent" is the same
    // species as the one it replaced. CodeRabbit, PR #174.
    await expect(pick).toBeVisible();
    await expect(pick.click({ timeout: 2_000 })).rejects.toThrow();
  });

  // **The console is not on the phone at all, ENTRY POINT INCLUDED** — the
  // design says so, and `AccountMenu` renders the link `hidden md:block`.
  // Nothing asserted it: the component tests set no viewport, and the
  // responsive spec's account-menu walk checks *Your account* and *Sign out*
  // but not this. Flagged by CodeRabbit on PR #174, which suggested asserting
  // the class — this repo's lint forbids that ("assert behaviour, not
  // classes"), so it is asserted as what a person can actually see.
  test("the operator link is on the desktop menu and not the phone one", async ({ browser }) => {
    const operator = await openOperator(browser);

    await operator.setViewportSize({ width: 411, height: 823 });
    await operator.goto("/");
    await operator.getByRole("button", { name: "Account menu" }).click();
    await expect(operator.getByRole("button", { name: "Your account" })).toBeVisible();
    // Present in the DOM (the link is rendered, then hidden by the breakpoint)
    // and not VISIBLE, which is the thing a person experiences.
    await expect(operator.getByRole("link", { name: "Operator console" })).toBeHidden();

    // The same account, the same menu, one breakpoint wider.
    await operator.setViewportSize({ width: 1280, height: 800 });
    await operator.goto("/");
    await operator.getByRole("button", { name: "Account menu" }).click();
    await expect(operator.getByRole("link", { name: "Operator console" })).toBeVisible();

    await operator.context().close();
  });

  test("a grant bites on the next request, with the JWT unchanged", async ({ page, browser }) => {
    const who = newcomer("m20granted");
    await signInAs(page, who);
    const tripId = await createTrip(page, e2eTripName("M20 grant"));

    expect(
      (await page.context().cookies()).some((cookie) => cookie.name.includes("session-token")),
    ).toBe(true);

    await page.goto(`/trips/${tripId}?view=Plan`);
    await page.getByRole("button", { name: /trip settings/i }).click();
    await expect(page.getByTestId("collaborators-gate")).toBeVisible();

    // The operator grants, through the shipped endpoint, as a real admin.
    const operator = await openOperator(browser);
    const granted = await operator.request.post("/api/admin/grants", {
      data: {
        userId: `dev-${who}`,
        planId: "premium",
        expiresAt: null,
        reason: "M20 gate walk.",
      },
    });
    expect(granted.status(), await granted.text()).toBe(201);

    // **No sign-out and no token refresh**, asserted as what the browser
    // actually does rather than by comparing cookie bytes.
    //
    // The first version of this compared the session cookie before and after
    // and failed: Auth.js re-encrypts the JWE on every session read, so the
    // ciphertext differs while the claims are identical. That is not a token
    // refresh in the sense the gate box means — nothing re-authenticated — and
    // an assertion that cannot tell the two apart is worse than none.
    //
    // What it means is that the account never went back through the front
    // door. So: watch every request the reload makes and assert none of them
    // is a sign-in.
    // `/api/auth/session` is deliberately NOT in this list: it is a READ of
    // the session the browser already holds, made by the account menu on every
    // page, and counting it made the first version of this assertion fail
    // against correct behaviour. Nothing about it re-authenticates anybody.
    // What must not happen is the front door: a sign-in, a sign-out, or an
    // OAuth callback.
    const seenUrls: string[] = [];
    const watch = (request: { url: () => string }) => seenUrls.push(request.url());
    page.on("request", watch);
    await page.reload();
    await page.getByRole("button", { name: /trip settings/i }).click();
    await expect(page.getByRole("button", { name: "Invite someone" })).toBeVisible();
    await expect(page.getByTestId("collaborators-gate")).toHaveCount(0);
    page.off("request", watch);

    const frontDoor = seenUrls.filter((url) =>
      /\/signin|\/signup|\/api\/auth\/(signin|signout|callback)/.test(url),
    );
    expect(frontDoor, "the grant took effect without re-authenticating").toEqual([]);
    expect(
      (await page.context().cookies()).some((cookie) => cookie.name.includes("session-token")),
    ).toBe(true);
    // And it is still the SAME account: the claims did not move, only what the
    // database says that account may do.
    const session = await page.request.get("/api/auth/session");
    expect(((await session.json()) as { user?: { id?: string } }).user?.id).toBe(`dev-${who}`);
    await operator.context().close();
  });

  // **402 with the tier named**, reached by revoking the signup trial through
  // the console's own revoke path — so what is walked is a genuinely
  // unentitled account rather than one that was never offered anything.
  test("a free account is refused the assistant with 402, and the tier is named", async ({
    page,
    browser,
  }) => {
    const who = newcomer("m20free");
    await signInAs(page, who);
    const tripId = await createTrip(page, e2eTripName("M20 refusal"));

    const operator = await openOperator(browser);
    const trial = (await grantsFor(operator, `dev-${who}`)).find((g) => g.source === "trial");
    expect(trial, "a new account carries a signup trial").toBeDefined();

    const revoked = await operator.request.delete("/api/admin/grants", {
      data: { grantId: trial!.id },
    });
    expect(revoked.ok(), await revoked.text()).toBe(true);

    const refused = await page.request.post(`/api/trips/${tripId}/ask`, {
      data: {
        // `id` is required on a UI message — without it the body fails to
        // parse and the endpoint answers 400, which is a malformed request
        // rather than the refusal this test is about.
        messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "how long is this trip?" }] }],
        scope: { kind: "trip" },
      },
    });
    expect(refused.status()).toBe(402);
    const body = (await refused.json()) as { code: string; error: string };
    expect(body.code).toBe("ai-not-entitled");
    // Names the tier, not a permission — and carries no price.
    expect(body.error).toContain("Plus");
    expect(body.error).not.toMatch(/\$|permission/i);
    await operator.context().close();
  });
});
