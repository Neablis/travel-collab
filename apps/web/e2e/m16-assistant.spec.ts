import { expect, test } from "@playwright/test";
import { createMappedTrip } from "./helpers";
import { e2eTripName } from "./tripNames";

// M16's happy path: a discussion you can see in the sidebar and continue.
// Runs against the simulated model (AI_LIVE=false in playwright.config.ts's
// webServer.env), which is what every Vercel environment runs too — so this is
// the deployed behaviour, not a stub.
//
// The kill-switch/badging half lives in m10-simulated-ai.spec.ts; this spec is
// about the conversation: the thread accumulating, the scope coming from the
// page, and the suggestions being derived from the trip rather than canned.
test("a multi-turn conversation, scoped by the focused day and started from a derived question", async ({
  page,
}) => {
  // Distinct prefix from other specs' trip names — parallel workers share the
  // "alice" dev user's trip list — and deliberately containing neither
  // "Assistant" nor "Simulated": the trip name is the accessible name of the
  // trip-settings button, and getByRole matches substrings, so a trip called
  // "Assistant …" makes the rail launcher ambiguous (strict-mode violation,
  // observed on the first ci-like run of this spec).
  const tripName = e2eTripName("Multiturn");
  // page.request shares the context's cookies, and the context needs an
  // origin before a relative request URL means anything.
  await page.goto("/");
  const tripId = await createMappedTrip(page, tripName, 3);
  await page.goto(`/trips/${tripId}`);
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();

  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  const rail = page.getByRole("complementary", { name: "Assistant" });
  await expect(rail).toContainText(`Looking at ${tripName}`);

  // Derived from the trip in front of you (suggestedQuestions.ts), and they
  // move with the focus. With no day focused they are trip-shaped.
  const suggestions = rail.getByRole("list", { name: "Suggested questions" });
  await expect(suggestions).toContainText("How is the trip looking?");
  await expect(suggestions).not.toContainText("day 2");

  // Focus day 2 from the day chips. Their accessible names are weekday/city
  // based, so this addresses them positionally — what matters here is which
  // chip, not what it is called.
  await page.getByRole("group", { name: "Days" }).getByRole("button").nth(1).click();
  await expect(rail).toContainText("Looking at Day 2");
  await expect(suggestions).toContainText("What's the plan for day 2?");
  await expect(suggestions).not.toContainText("How is the trip looking?");

  // Turn 1, started by clicking a suggestion. The request body is asserted
  // directly: the rail saying "Looking at Day 2" while asking about the whole
  // trip is the exact failure this pins.
  const [firstAsk] = await Promise.all([
    page.waitForRequest((r) => /\/api\/trips\/[^/]+\/ask$/.test(new URL(r.url()).pathname)),
    suggestions.getByRole("button", { name: "What's the plan for day 2?" }).click(),
  ]);
  const firstBody = JSON.parse(firstAsk.postData() ?? "{}") as {
    messages: { role: string; parts: { text: string }[] }[];
    scope: unknown;
  };
  // 0-based on the wire, 1-based everywhere a human reads it.
  expect(firstBody.scope).toEqual({ kind: "day", dayIndex: 1 });
  expect(firstBody.messages).toHaveLength(1);

  const log = page.getByRole("log", { name: "Conversation" });
  await expect(log).toContainText("What's the plan for day 2?");
  // Tool calls are visible but quiet — one line, never the raw readout.
  await expect(log).toContainText("Checked day 2");
  await expect(log).toContainText("Day 2");
  await expect(log).not.toContainText("{");

  // Turn 2. The whole thread goes back up, which is what gives a follow-up
  // something to refine (Ruling R1 — conversation state is client-held).
  await page.getByPlaceholder("Ask about this day…").fill("and where is the free time?");
  // Deliberately the BUTTON, not Enter. The unscheduled rack is `position:
  // fixed` across the bottom of the viewport and its right-inset compensation
  // silently matched nothing, so its bar covered the Ask button while the
  // keyboard path kept working — a defect only a real click can catch.
  const [secondAsk] = await Promise.all([
    page.waitForRequest((r) => /\/api\/trips\/[^/]+\/ask$/.test(new URL(r.url()).pathname)),
    page.getByRole("button", { name: "Ask" }).click(),
  ]);
  const secondBody = JSON.parse(secondAsk.postData() ?? "{}") as {
    messages: { role: string; parts: { text: string }[] }[];
  };
  expect(secondBody.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  expect(secondBody.messages[0]!.parts[0]!.text).toBe("What's the plan for day 2?");
  expect(secondBody.messages[2]!.parts[0]!.text).toBe("and where is the free time?");

  await expect(log).toContainText("and where is the free time?");
  await expect(log).toContainText("The biggest open stretch between");

  // And it can be put down.
  await page.getByRole("button", { name: "New conversation" }).click();
  await expect(page.getByRole("log", { name: "Conversation" })).toHaveCount(0);
  await expect(suggestions).toContainText("What's the plan for day 2?");

  // Back to the whole trip. Half of M16's gate is "no day selected, same
  // question", so this has to be reachable from the UI and not only on a fresh
  // load — clicking the already-focused chip clears it.
  const dayTwoChip = page.getByRole("group", { name: "Days" }).getByRole("button").nth(1);
  await expect(dayTwoChip).toHaveAttribute("aria-pressed", "true");
  await dayTwoChip.click();
  await expect(dayTwoChip).toHaveAttribute("aria-pressed", "false");
  await expect(rail).toContainText(`Looking at ${tripName}`);
  await expect(suggestions).toContainText("How is the trip looking?");

  await page.getByPlaceholder("Ask about this day…").fill("how is the trip looking?");
  const [tripAsk] = await Promise.all([
    page.waitForRequest((r) => /\/api\/trips\/[^/]+\/ask$/.test(new URL(r.url()).pathname)),
    page.keyboard.press("Enter"),
  ]);
  expect((JSON.parse(tripAsk.postData() ?? "{}") as { scope: unknown }).scope).toEqual({ kind: "trip" });
  await expect(log).toContainText("runs to 3 days");
});
