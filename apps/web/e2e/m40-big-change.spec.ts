import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { createMappedTrip, openAssistantRail, openHistory } from "./helpers";
import { e2eTripName } from "./tripNames";

// M40 Part 3 (ADR-067): a big change is one change. Asked for a day, the
// assistant stores its several changes as ONE suggestion on the board, saves a
// snapshot first, and the chat says where to look. *Accept all* lands them as
// one History entry, and the snapshot puts the trip back in one step.
//
// The model is `simulatedModel.ts` — this lane's webServer runs with
// `AI_LIVE=false` (m10-simulated-ai.spec.ts says why), and "add a day …" is the
// request it answers with a new day and two stops.

async function dayCount(page: Page, tripId: string): Promise<number> {
  const { trip } = (await (await page.request.get(`/api/trips/${tripId}`)).json()) as { trip: { days: unknown[] } };
  return trip.days.length;
}

test("asked for a day, the assistant suggests it; Accept all lands it as one entry, and the snapshot takes it back", async ({
  page,
}) => {
  const tripName = e2eTripName("Big Change");
  await page.goto("/");
  const tripId = await createMappedTrip(page, tripName, 2);
  await page.goto(`/trips/${tripId}?view=Plan`);
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();

  await openAssistantRail(page);
  await page.getByPlaceholder("Ask about this trip…").fill("add a day in Kyoto");
  await page.getByRole("button", { name: "Ask the assistant" }).click();

  // The chat says where they went, and that a snapshot was saved — no card.
  const note = page.getByRole("group", { name: "Suggestions on the board" });
  await expect(note).toContainText("I put 3 suggestions on the board and saved a snapshot “Before: add a day in Kyoto”.");
  await expect(page.getByRole("group", { name: "Suggested change" })).toHaveCount(0);
  // Nothing is on the trip yet: a suggestion is not planning state (ADR-064).
  expect(await dayCount(page, tripId)).toBe(2);

  // On the board without a reload. A solo trip runs no poll (W73), so this is
  // the re-read the board makes when the turn's final chunk arrives.
  const chip = page.getByRole("button", { name: "3 suggestions", exact: true });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(chip).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText(/Suggested by .+, via the assistant/)).toHaveCount(3);

  const [accepted] = await Promise.all([
    page.waitForResponse((r) => /\/suggestions\/changes\/accept$/.test(new URL(r.url()).pathname)),
    page.getByRole("button", { name: "Accept all" }).click(),
  ]);
  expect(accepted.status()).toBe(200);
  await expect(page.getByRole("button", { name: /^\d+ suggestions?$/ })).toHaveCount(0);
  await expect(page.getByTestId("day-column")).toHaveCount(3);
  expect(await dayCount(page, tripId)).toBe(3);

  // One History entry for all three, saying who asked and how (M40 D1).
  await openHistory(page);
  const entry = page.getByTestId("history-entry").filter({ hasText: "via the assistant" });
  await expect(entry).toHaveCount(1);
  await expect(entry.getByTestId("history-entry-description")).toHaveText("Accepted 3 suggestions");

  // The snapshot the assistant saved puts the trip back as it was asked.
  const snapshots = page.getByRole("region", { name: "Snapshots" });
  const [restored] = await Promise.all([
    page.waitForResponse((r) => /\/snapshots\/[^/]+\/restore$/.test(new URL(r.url()).pathname)),
    snapshots.getByRole("button", { name: "Restore Before: add a day in Kyoto" }).click(),
  ]);
  expect(restored.status()).toBe(200);
  await expect(page.getByTestId("day-column")).toHaveCount(2);
  expect(await dayCount(page, tripId)).toBe(2);
});
