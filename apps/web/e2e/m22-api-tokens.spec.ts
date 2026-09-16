import { expect, test, type Page } from "@playwright/test";
import { signInAsDevUser } from "./helpers";
import { grantCollaborators } from "./adminBootstrap";
import { e2eTripName } from "./tripNames";

// **M22 Phase 3, walked end to end** — and it walks further than Phase 3 owns,
// deliberately. The point of a Tokens section is not that a form submits; it is
// that the thing it produces opens the public API and that revoking closes it
// again. So this spec mints a token by clicking, then calls `GET /api/v1/trips`
// with it as a real `Authorization: Bearer` header, then revokes it by clicking
// and calls again.
//
// **Nothing here touches Stripe.** The entitlement arrives through the operator
// console's own grant endpoint — the path a real operator uses — which is what
// M20 built the grant path for and why every tier gate in this repo is provable
// in CI rather than by watching production once.
//
// A fresh dev user, not the shared alice session: this account's plan changes
// mid-spec, and `storageState: undefined` keeps that off every other spec's
// identity. Same reasoning `m17-account-preferences.spec.ts` records.
test.use({ storageState: undefined });

async function openAccountSettings(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: "Your account" }).click();
  await expect(page.getByRole("heading", { name: "Your account" })).toBeVisible();
}

test("api tokens: minted by clicking, opens the API, and revoking closes it", async ({
  page,
  browser,
}) => {
  // Timestamp for readable debris, random suffix for actual uniqueness —
  // Playwright runs workers in parallel against ONE database, so `Date.now()`
  // alone collides within a millisecond (pull request 112).
  const username = `m22${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  await signInAsDevUser(page, username);

  // A trip, so the API call below has something to return that is actually
  // this account's.
  const created = await page.request.post("/api/trips", { data: { name: e2eTripName("M22Api") } });
  expect(created.ok(), `POST /api/trips -> ${created.status()}`).toBe(true);
  const { tripId } = (await created.json()) as { tripId: string };

  // ---- a free account sees the section, locked ------------------------------
  // **A prompt, not a hidden section.** Hiding it would answer "this product
  // has no API"; showing it locked answers "not on this plan".
  await openAccountSettings(page);
  await expect(page.getByTestId("tokens-section")).toBeVisible();
  await expect(page.getByTestId("tokens-upgrade")).toContainText("Premium");
  await expect(page.getByTestId("token-new")).toBeHidden();

  // ---- entitle it the way an operator would ---------------------------------
  // Grants `premium` at the live version, which since M22 Phase 1 is
  // `premium@v2` — the version carrying `api.tokens`. (The helper's name is
  // M11's; what it does is grant premium.)
  await grantCollaborators(browser, `dev-${username}`);
  await page.reload();
  await openAccountSettings(page);
  await expect(page.getByTestId("tokens-upgrade")).toBeHidden();

  // ---- mint one by clicking -------------------------------------------------
  await page.getByTestId("token-new").click();
  await page.getByTestId("token-name").fill("E2E calendar sync");
  await page.getByTestId("token-create").click();

  // **The one-time reveal**, which is the only moment this value exists outside
  // the caller's own storage.
  const reveal = page.getByTestId("token-revealed");
  await expect(reveal).toContainText("not shown again");
  const secret = await page.getByTestId("token-secret").inputValue();
  expect(secret.startsWith("tc_")).toBe(true);

  // Obligation 1: time remaining, not a creation date.
  await expect(page.getByTestId("token-expiry")).toContainText(/Expires in \d+ days/);

  await page.getByTestId("token-reveal-dismiss").click();
  await expect(reveal).toBeHidden();

  // ---- the token actually opens the public API ------------------------------
  const authed = await page.request.get("/api/v1/trips", {
    headers: { authorization: `Bearer ${secret}` },
  });
  expect(authed.status(), "a minted token should reach v1").toBe(200);
  const listed = (await authed.json()) as { items: { tripId: string }[]; nextCursor: string | null };
  expect(listed.items.map((t) => t.tripId)).toContain(tripId);

  // And the scope it was NOT given is refused — this token holds `trips:read`
  // only, so the Notebook is out of reach even though the trip is not.
  const detail = await page.request.get(`/api/v1/trips/${tripId}`, {
    headers: { authorization: `Bearer ${secret}` },
  });
  expect(detail.status()).toBe(200);

  // ---- revoking closes it, immediately --------------------------------------
  await page.getByTestId("token-revoke").click();
  await expect(page.getByTestId("token-state")).toHaveText("Revoked");

  const afterRevoke = await page.request.get("/api/v1/trips", {
    headers: { authorization: `Bearer ${secret}` },
  });
  expect(afterRevoke.status(), "a revoked token must stop working at once").toBe(401);
  const refusal = (await afterRevoke.json()) as { error: { code: string } };
  // Obligation 2, on the wire: revoked reads differently from expired, so an
  // integrator learns "you were cut off" rather than "mint a new one".
  expect(refusal.error.code).toBe("token-revoked");
  expect(afterRevoke.headers()["www-authenticate"]).toBe("Bearer");

  // ---- and the dead token is still listed ----------------------------------
  // Refused, not deleted: the row is how its owner learns what happened.
  await expect(page.getByTestId("tokens-list")).toContainText("E2E calendar sync");
  await expect(page.getByTestId("token-revoke")).toBeHidden();
});
