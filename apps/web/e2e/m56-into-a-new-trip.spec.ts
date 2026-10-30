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
    await expect(rail(page)).toBeVisible();
    expect(askedText(await asked)).toBe(kickoff);
    await expect(rail(page).getByRole("log", { name: "Conversation" })).toContainText(kickoff);
  });
});

test("a hand-off opens New trip prefilled, and its carried ask is a chip on the new trip until pressed", async ({ page }) => {
  // A Home with trips, whose New trip is the sheet rather than the first run.
  // Banked from a page that takes no hand-off: a Home already open would take
  // it as soon as its list showed the new trip.
  await page.goto("/playbooks");
  await createMappedTrip(page, e2eTripName("M56Carry seed"), 1);

  // What an assistant's hand-off banks (`rememberNewTripHandOff`), as it banks it.
  const place = e2eTripName("M56Carry");
  const mezcal = "add a mezcal tasting";
  await page.evaluate(
    ({ place, mezcal }) =>
      window.localStorage.setItem(
        "pending_new_trip_hand_off",
        JSON.stringify({ prefill: { place, days: 14, tags: ["meal"] }, asks: [{ said: mezcal, kind: "itinerary" }], at: Date.now() }),
      ),
    { place, mezcal },
  );
  await page.route(/\/api\/places\?/, (route) =>
    route.fulfill({
      json: { places: [{ kind: "world", id: `e2e-${place}`, name: place, detail: "Test place", lat: 0, lng: 0, hasPlaybooks: false }] },
    }),
  );
  await page.goto("/home");

  // The place is searched for, not picked: Where still takes only a result.
  const sheet = page.getByRole("dialog", { name: "New trip" });
  await expect(sheet.getByLabel("Where are you going?")).toHaveValue(place);
  await sheet.getByRole("button", { name: `${place}, Test place`, exact: true }).click();
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

  const chips = rail(page).getByRole("list", { name: "You also asked" });
  const chip = chips.getByRole("button", { name: mezcal });
  await expect(chip).toBeVisible();
  // Nothing runs unasked (D5): the chip is there and no turn has been sent.
  expect(asks).toEqual([]);

  await chip.click();
  await expect(rail(page).getByRole("log", { name: "Conversation" })).toContainText(mezcal);
  expect(asks).toEqual([mezcal]);
  await expect(chips).toBeHidden();
});
