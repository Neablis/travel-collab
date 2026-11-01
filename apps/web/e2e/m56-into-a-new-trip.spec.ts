import { randomUUID } from "node:crypto";
import type { Page, Request } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { createMappedTrip, pickNewTripPlace, signInAsDevUser } from "./helpers";
import { e2eTripName } from "./tripNames";

// M56 part 6, against the simulated model: *Plan with AI* lands on the new
// trip with the assistant open and a kickoff the client wrote from the answers
// (D1), and asks carried from a hand-off arrive as chips that run only when
// pressed (D5, ADR-084 §5).

const TRIP_ASK = /\/api\/trips\/[0-9a-f-]{36}\/ask$/;

function rail(page: Page) {
  return page.getByRole("complementary", { name: "Assistant" });
}

// Mitchell, 2026-10-30: a trip made from New trip opens on Plan, where it is
// planned, not on the read-only Overview a bare `/trips/<id>` lands on.
function planTab(page: Page) {
  return page.getByRole("tablist", { name: "Trip view" }).getByRole("tab", { name: "Plan" });
}

function askedText(request: Request): string | undefined {
  const body = JSON.parse(request.postData() ?? "{}") as { messages?: { role: string; parts: { type: string; text?: string }[] }[] };
  return body.messages?.at(-1)?.parts.find((part) => part.type === "text")?.text;
}

test.describe("Plan with AI", () => {
  // A new account is on the week's `plus` trial, so Review offers Plan with AI.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("lands on the new trip with the assistant open and a kickoff written from the answers", async ({ page }) => {
    await signInAsDevUser(page, `m56k${randomUUID().replace(/-/g, "").slice(0, 10)}`);
    const card = page.getByTestId("first-trip-start");
    const next = card.getByRole("button", { name: "Next" });
    const place = e2eTripName("M56Kickoff");
    await pickNewTripPlace(card, place);
    await next.click();
    await card.getByRole("radio", { name: "Not yet" }).click();
    await next.click();
    await card.getByRole("radio", { name: "A week" }).click();
    await next.click();
    await card.getByRole("radio", { name: "Balanced" }).click();
    await next.click();
    await card.getByRole("checkbox", { name: "Food" }).click();
    await card.getByRole("button", { name: "Review" }).click();

    const kickoff = `Plan this trip with me. Where: ${place}. Start date: Not yet. How long: A week. Pace: Balanced. What it is about: Food.`;
    const asked = page.waitForRequest((r) => TRIP_ASK.test(new URL(r.url()).pathname));
    await card.getByRole("button", { name: "Plan with AI" }).click();
    await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}/);
    await expect(planTab(page)).toHaveAttribute("aria-selected", "true");
    await expect(rail(page)).toBeVisible();
    expect(askedText(await asked)).toBe(kickoff);
    await expect(rail(page).getByRole("log", { name: "Conversation" })).toContainText(kickoff);
  });
});

// The writer end to end (PR 643): Home's rail hands the request to New trip
// with what it said of the trip, the picker opens with it, and the part only
// a trip can do waits on the new trip as a chip, past a reload, until pressed.
test("Home's rail hands a trip to New trip prefilled, and its other ask is a chip on the new trip until pressed", async ({ page }) => {
  // A Home with trips, whose New trip is the sheet rather than the first run.
  await page.goto("/home");
  await createMappedTrip(page, e2eTripName("M56Carry seed"), 1);
  await page.goto("/home");

  // What the presses reported (M57): a turn's outcomes join to it on the server.
  const outcomes: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/ask/outcome") outcomes.push((r.postDataJSON() as { kind: string }).kind);
  });

  const mezcal = "add a mezcal tasting";
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const composer = rail(page).getByPlaceholder("Ask about your trips…");
  await composer.fill(`plan me two weeks of food somewhere I haven't been, and ${mezcal}`);
  await composer.press("Enter");
  await rail(page).getByRole("group", { name: "Where this is done" }).getByRole("link", { name: "Start a new trip" }).click();

  // Length and tags are answers already; the place is still the person's pick.
  const sheet = page.getByRole("dialog", { name: "New trip" });
  await expect(sheet.getByLabel("Where are you going?")).toHaveValue("");
  const place = e2eTripName("M56Carry");
  await pickNewTripPlace(sheet, place);
  await expect(sheet.getByTestId("new-trip-decided")).toHaveText(`${place} · 2 weeks · Food`);
  const next = sheet.getByRole("button", { name: "Next" });
  await next.click();
  await sheet.getByRole("radio", { name: "Not yet" }).click();
  await next.click();
  await expect(sheet.getByRole("radio", { name: "2 weeks" })).toHaveAttribute("aria-checked", "true");
  await next.click();
  await sheet.getByRole("radio", { name: "Slow" }).click();
  await next.click();
  await sheet.getByRole("button", { name: "Review" }).click();

  const asks: string[] = [];
  page.on("request", (r) => {
    if (TRIP_ASK.test(new URL(r.url()).pathname)) asks.push(askedText(r) ?? "");
  });
  await sheet.getByRole("button", { name: "Just create it" }).click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}/);
  await expect(planTab(page)).toHaveAttribute("aria-selected", "true");

  const chips = rail(page).getByRole("list", { name: "You also asked" });
  const chip = chips.getByRole("button", { name: mezcal });
  await expect(chip).toBeVisible();
  // Kept beside the thread, so a reload offers it again.
  await page.reload();
  await page.getByTestId("ask-pill").click();
  await expect(chip).toBeVisible();

  await chip.click();
  await expect(rail(page).getByRole("log", { name: "Conversation" })).toContainText(mezcal);
  // Nothing ran unasked (D5): the one turn sent is the press.
  await expect.poll(() => asks).toEqual([mezcal]);
  await expect(chips).toBeHidden();
  await page.reload();
  await page.getByTestId("ask-pill").click();
  await expect(rail(page).getByRole("log", { name: "Conversation" })).toContainText(mezcal);
  await expect(chips).toBeHidden();
  // The turn id rode the hand-off, the new trip and the chip, across a reload.
  await expect.poll(() => outcomes).toEqual(["hand_off_pressed", "trip_created_from_hand_off", "carried_ask_pressed"]);
});
