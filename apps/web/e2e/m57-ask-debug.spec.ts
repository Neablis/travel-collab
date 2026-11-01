import { expect, test } from "./fixtures/test";
import { signInAsOperator } from "./adminBootstrap";
import { createMappedTrip, openAssistantRail } from "./helpers";
import { e2eTripName } from "./tripNames";

// **M57 part 5 — the Ask panel's Debug view** (ADR-085, decision D7: operators
// only). Two halves of one claim, and the second is the one that matters if the
// first regresses:
//
//   * an operator sees a Debug toggle; on, the page's persona graph and tools,
//     and under an answer a breakdown that reads the turn's ledger row;
//   * anyone else sees no toggle, and the endpoints behind it answer 404.
//
// The answer is the simulated model's (`AI_LIVE=false`, m10-simulated-ai's
// note), so no number from the ledger is asserted: the turn is real, its tokens
// are not.

test("an operator toggles Debug, reads the graph and expands a turn's breakdown", async ({ browser }) => {
  test.slow();
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const page = await signInAsOperator(context);
    const tripName = e2eTripName("Ask Debug");
    const tripId = await createMappedTrip(page, tripName, 2);
    await page.goto(`/trips/${tripId}?view=Plan`);
    await expect(page.getByRole("heading", { name: tripName, level: 1 })).toBeVisible();

    await openAssistantRail(page);
    const rail = page.getByRole("complementary", { name: "Assistant" });
    const toggle = rail.getByRole("button", { name: "Debug", exact: true });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();

    // The trip page enters Schedule; an operator on their own trip holds an
    // editor's caps, so Discover is a switch away and the page writer a hand-off.
    const strip = rail.getByRole("region", { name: "Debug" });
    const personas = strip.getByRole("list", { name: "Personas" });
    await expect(personas.getByRole("listitem").filter({ hasText: "Schedule" })).toContainText("entry for this page");
    await expect(personas.getByRole("listitem").filter({ hasText: "Discover" })).toContainText("reachable by a switch");
    await expect(personas.getByRole("listitem").filter({ hasText: "Explorer" })).toContainText("never reachable from here");
    await expect(strip.getByRole("list", { name: "Edges from Schedule" })).toContainText("switch via switch_persona to Discover");

    await strip.getByText("Tools", { exact: true }).click();
    await expect(strip.getByRole("list", { name: "Discover tools" })).toContainText("search_places");

    // Remembered per browser: it is still on after a reload.
    await page.reload();
    await openAssistantRail(page);
    await expect(rail.getByRole("button", { name: "Debug", exact: true })).toHaveAttribute("aria-pressed", "true");

    await page.getByPlaceholder("Ask about this trip…").fill("how is the trip looking?");
    await page.getByRole("button", { name: "Ask the assistant" }).click();
    await expect(page.getByRole("log", { name: "Conversation" })).toContainText("AI is switched off on this deployment");

    await rail.getByRole("button", { name: "Breakdown" }).click();
    await expect(rail.getByRole("list", { name: "Steps" })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("a member who is not an operator sees no Debug toggle, and the endpoints are 404", async ({ page }) => {
  const tripName = e2eTripName("Ask No Debug");
  await page.goto("/home");
  const tripId = await createMappedTrip(page, tripName, 2);
  await page.goto(`/trips/${tripId}?view=Plan`);
  await expect(page.getByRole("heading", { name: tripName, level: 1 })).toBeVisible();

  await openAssistantRail(page);
  const rail = page.getByRole("complementary", { name: "Assistant" });
  await expect(rail.getByRole("button", { name: "Hide" })).toBeVisible();
  await expect(rail.getByRole("button", { name: "Debug", exact: true })).toHaveCount(0);

  expect((await page.request.get("/api/admin/assistant/personas?surface=trip")).status()).toBe(404);
  expect((await page.request.get("/api/admin/assistant/turns/00000000-0000-4000-8000-000000000000")).status()).toBe(404);
});
