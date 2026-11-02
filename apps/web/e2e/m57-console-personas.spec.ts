import { expect, test } from "./fixtures/test";
import { signInAsOperator } from "./adminBootstrap";

// **M57 part 6 — the console's Personas tab** (ADR-085, decision D7: operators
// only). An operator reads the persona map and moves its window; anyone else
// gets the same 404 every other console tab gives.
//
// No turn is seeded: the simulated model's turns are left out of the report
// (`turn_model` `simulated/…`), so on this deployment the window is empty. What
// the page proves is the map, which is drawn from `personas.ts` and not from
// the ledger, and the empty window reading zeros rather than NaN. The numbers
// themselves are `personaReport.int.test.ts`'s.

test("an operator reads the persona map and changes its window", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const page = await signInAsOperator(context);
    await page.goto("/admin?tab=personas");

    await expect(page.getByRole("tab", { name: "Personas" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: "30 days" })).toHaveAttribute("aria-selected", "true");

    const personas = page.getByRole("table", { name: "Personas" });
    await expect(personas.getByTestId("persona-schedule")).toContainText("trip, day");
    await expect(personas.getByTestId("persona-discover")).toContainText("a switch only");
    await expect(page.getByTestId("edge-schedule-switch_persona")).toContainText("role=propose and plan=propose");
    await expect(page.getByTestId("edge-schedule-nowhere")).toContainText("to nowhere");

    await page.getByRole("tab", { name: "7 days" }).click();
    await expect(page).toHaveURL(/tab=personas&days=7/);
    await expect(page.getByTestId("personas-window")).toContainText("Last 7 days");
    await expect(page.getByTestId("personas-window")).not.toContainText("NaN");
  } finally {
    await context.close();
  }
});

test("a member who is not an operator gets a 404 for the Personas tab", async ({ page }) => {
  await page.goto("/home");
  expect((await page.request.get("/admin?tab=personas")).status()).toBe(404);
});
