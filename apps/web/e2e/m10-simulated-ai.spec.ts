import { expect, type Page, test } from "@playwright/test";
import { signInAsDevUser } from "./helpers";

// This spec's own webServer runs with AI_LIVE=false (playwright.config.ts's
// webServer.env — see the note there), so handleAiRequest.ts's flag check
// selects simulatedModel.ts instead of contacting a real provider: no token
// cost, and the plan is deterministic by construction (simulatedModel.ts's
// planCalls()). This is the "no test-mode seam" gap m7-solo-delight.spec.ts's
// file-header note describes for the board's AI compose — now closed for the
// simulated path specifically, which is the only path e2e is ever allowed to
// exercise per Mitchell's hard constraint (no e2e test may make a real call
// to the Vercel AI Gateway or any model provider).
function waitForAiResponse(page: Page) {
  return page.waitForResponse(
    (r) => /\/api\/trips\/[^/]+\/ai$/.test(new URL(r.url()).pathname) && r.request().method() === "POST" && r.ok(),
  );
}

test("a simulated AI answer is badged and still really changes the trip", async ({ page }) => {
  // Distinct prefix from other specs' trip names — parallel workers share the
  // "alice" dev user's trip list (m1/m3/m6/m7/m8's comment). Deliberately
  // avoids the word "Simulated" itself: Playwright's getByText matches
  // substrings by default, and the trip name shows up both in TripHeader's
  // <h2> and in the assistant rail's "Looking at {name}" context line, either
  // of which would make the later getByText("Simulated") assertion for the
  // rail's Badge ambiguous (3-way strict-mode violation, caught while writing
  // this spec).
  const tripName = `AI Kill Switch ${Date.now()}`;
  await signInAsDevUser(page, "alice");

  await page.getByRole("button", { name: "New trip" }).click();
  await page.getByLabel("Trip name").fill(tripName);
  await page.getByRole("button", { name: "Create trip" }).click();
  await page.getByRole("link", { name: tripName }).click();
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();

  // The Assistant rail (AssistantRail.tsx) is mounted open by default at
  // desktop widths (TripBoardScreen.tsx's useAssistantVisibility) — its ask
  // box fires the same composeAiPlan(tripId, text, "board") call the old
  // standalone ComposePanel used to make directly.
  await page.getByPlaceholder("Ask about this day…").fill("plan me a couple of days");
  await Promise.all([waitForAiResponse(page), page.keyboard.press("Enter")]);

  // Marked as simulated: AssistantRail.tsx only renders this Badge when the
  // rail's last composeAiPlan response came back with simulated: true.
  await expect(page.getByText("Simulated")).toBeVisible();

  // …and genuinely applied, not just labeled: simulatedModel.ts's planCalls()
  // emits exactly two AddDay calls and three AddActivity calls, executed as
  // one atomic batch (Task 5.3) and reconciled onto the board the same way a
  // real model's plan would be (same day-column/activity-text assertion
  // conventions as m7/m8-make-it-real.spec.ts).
  await expect(page.getByTestId("day-column")).toHaveCount(2);
  await expect(page.getByText("Sample: morning walk")).toBeVisible();
  await expect(page.getByText("Sample: long lunch")).toBeVisible();
  await expect(page.getByText("Sample: museum in the afternoon")).toBeVisible();
});
