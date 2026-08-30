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
  // Day 2 is focused, so the composer says so — it used to say "this day"
  // in every scope, contradicting the context line above it.
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

  // …and back at trip scope it follows.
  await page.getByPlaceholder("Ask about this trip…").fill("how is the trip looking?");
  const [tripAsk] = await Promise.all([
    page.waitForRequest((r) => /\/api\/trips\/[^/]+\/ask$/.test(new URL(r.url()).pathname)),
    page.keyboard.press("Enter"),
  ]);
  expect((JSON.parse(tripAsk.postData() ?? "{}") as { scope: unknown }).scope).toEqual({ kind: "trip" });
  await expect(log).toContainText("runs to 3 days");
});

// The four chips the final branch review found were dead ends. Every one is
// derived from real trip state, and every one used to be answered by something
// that ignored the question — on the ONLY path a deployment runs, since
// `ai-live` is off in every Vercel environment.
//
// `askChipCoverage.test.ts` enumerates the chips and pins the answers. What only
// a browser can add is that the chip is a control you can CLICK: the Ask button
// has been covered by the fixed unscheduled rack before, and every test that
// used the keyboard missed it.
test("the chips that used to be dead ends are clickable and answered", async ({ page }) => {
  const tripName = e2eTripName("Chips");
  await page.goto("/");
  // Zero days: the empty-trip chip is the whole of the rail's opening offer,
  // and it is literally the first step of "plan a trip from start to finish".
  const tripId = await createMappedTrip(page, tripName, 0);
  await page.goto(`/trips/${tripId}`);
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();

  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  const rail = page.getByRole("complementary", { name: "Assistant" });
  const suggestions = rail.getByRole("list", { name: "Suggested questions" });
  const log = page.getByRole("log", { name: "Conversation" });

  await suggestions
    .getByRole("button", { name: "There are no days yet — how should I start planning this trip?" })
    .click();
  // A draft, not "the trip runs to 0 days and has no open time" — which is what
  // it said before, and which is the assistant refusing the question it offered.
  await expect(log).toContainText("Nothing is applied yet");
  const card = page.getByRole("region", { name: "Proposed change" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Sample: coffee stop");
  // The trip starts at 0 days — day 1 only exists once /ask/apply has landed
  // and the board has taken the new state. Without waiting for the response,
  // clicking "New conversation" then the first day chip is a race: the Days
  // group can still be empty and `.first().click()` times out (m10-simulated-
  // ai.spec.ts's Approve already waits for this response for the same reason).
  const [applied] = await Promise.all([
    page.waitForResponse((r) => /\/api\/trips\/[^/]+\/ask\/apply$/.test(new URL(r.url()).pathname)),
    page.getByRole("button", { name: "Approve" }).click(),
  ]);
  expect(applied.status()).toBe(200);
  await expect(card).toContainText("Applied");

  // M18 landed on `main` while this spec was in flight: a freshly-added
  // stop's default `kind` is `planned`, and `needsBooking` (KI-86) does not
  // count a `planned`/untagged stop as outstanding — only `hold`/`idea`, or a
  // `ticketed` `planned` one. So the AI's own "Sample: coffee stop" no longer
  // offers the booking chip on its own; mark it `hold` (a user setting it
  // deliberately "not settled yet") so the chip below has something real to
  // answer.
  await page.getByRole("button", { name: "Edit Sample: coffee stop" }).click();
  await page.getByLabel("Kind").selectOption("hold");
  await page.getByRole("button", { name: "Save" }).click();

  // Now the trip has a day with stops on it. Focus it, and the day-scoped chips
  // are the other three.
  await page.getByRole("button", { name: "New conversation" }).click();
  await page.getByRole("group", { name: "Days" }).getByRole("button").first().click();
  await expect(rail).toContainText("Looking at Day 1");

  await suggestions.getByRole("button", { name: "What on day 1 still needs booking?" }).click();
  // Names the stops, from their own `kind` — the answer used to list times and
  // never mention booking at all.
  await expect(log).toContainText("Still to book:");
  await expect(log).toContainText("Sample: coffee stop");
});
