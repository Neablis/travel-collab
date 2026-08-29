import { expect, test } from "@playwright/test";
import { createMappedTrip, openHistory } from "./helpers";
import { e2eTripName } from "./tripNames";

// This spec's own webServer runs with AI_LIVE=false (playwright.config.ts's
// webServer.env — see the note there), so `selectAiModel` hands back
// simulatedModel.ts instead of contacting a real provider: no token cost, and
// the answer is deterministic by construction. This is the only AI path e2e is
// ever allowed to exercise, per Mitchell's hard constraint (no e2e test may
// make a real call to the Vercel AI Gateway or any model provider).
//
// M16 Wave 2 moved the rail's ask box from POST /trips/:id/ai (the command
// endpoint, which applies a batch and answers with a derived receipt) to POST
// /trips/:id/ask (the streaming read-only agent). This spec follows it.
//
// The half that left with the endpoint — "…and still really changes the trip"
// — is BACK, as the second and third tests below, through M9's write tools and
// propose → review → approve. It is a stronger statement than the original:
// the first assertion is that the assistant's turn changed nothing, and only
// then that clicking Approve did.
test("a simulated AI answer streams into the rail and is badged as simulated", async ({ page }) => {
  // Distinct prefix from other specs' trip names — parallel workers share the
  // "alice" dev user's trip list (m1/m3/m6/m7/m8's comment). Deliberately
  // avoids the word "Simulated" itself: Playwright's getByText matches
  // substrings by default, and the trip name shows up both in TripHeader's
  // <h2> and in the assistant rail's "Looking at {name}" context line, either
  // of which would make the later getByText("Simulated") assertion for the
  // rail's Badge ambiguous (3-way strict-mode violation, caught while writing
  // the first version of this spec).
  const tripName = e2eTripName("AI Kill Switch");
  // page.request shares the context's cookies, and the context needs an
  // origin before a relative request URL means anything.
  await page.goto("/");
  const tripId = await createMappedTrip(page, tripName, 2);
  await page.goto(`/trips/${tripId}`);
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();

  // The Assistant rail is closed until asked for, at every width
  // (TripBoardScreen.tsx's useAssistantVisibility), so open it first.
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await page.getByPlaceholder("Ask about this trip…").fill("how is the trip looking?");
  const [response] = await Promise.all([
    page.waitForResponse((r) => /\/api\/trips\/[^/]+\/ask$/.test(new URL(r.url()).pathname)),
    page.keyboard.press("Enter"),
  ]);

  // The success shape is an SSE stream, not JSON — asserted on the headers
  // because a client that stopped streaming would still pass every text
  // assertion below while having lost the whole point.
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/event-stream");

  // The kill switch itself. This sentence is emitted ONLY by
  // simulatedModel.ts's ask branch — a real provider cannot produce it — so
  // its presence is direct proof that no model was called, stronger than the
  // `simulated: true` body flag the /ai version of this spec asserted (that
  // flag was a claim the server made about itself).
  const log = page.getByRole("log", { name: "Conversation" });
  await expect(log).toContainText("AI is switched off on this deployment");
  await expect(log).toContainText("how is the trip looking?");
  await expect(page.getByText("Simulated")).toBeVisible();
});

// M9 (Ruling A): browser-level proof that an AI plan reaches the board — and,
// first, that it does not until a human says so.
//
// The prompt has to carry a change VERB ("add"): the simulated model proposes
// only for an imperative, so that "What's the plan for day 2?" — which the
// derived suggestion chips ask verbatim — stays a question. That rule is unit
// tested in simulatedModel.test.ts; here it is just what a user would type.
test("an AI plan reaches the board only once it is approved", async ({ page }) => {
  const tripName = e2eTripName("AI Yes");
  await page.goto("/");
  const tripId = await createMappedTrip(page, tripName, 2);
  await page.goto(`/trips/${tripId}`);
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();

  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await page.getByPlaceholder("Ask about this trip…").fill("add a coffee stop to day 1");
  // Deliberately the BUTTON, not Enter. The Ask control has been covered by
  // the fixed unscheduled rack before, and every keyboard-driven test missed
  // it — a defect only a real click can catch.
  await page.getByRole("button", { name: "Ask" }).click();

  // Every "is it on the board?" assertion is scoped to the plan column. The
  // proposal card names the same stops ("Add “Sample: coffee stop” to day 1")
  // and `getByText` matches substrings, so an unscoped locator would find the
  // proposal and report the trip as already changed.
  const board = page.locator(".trip-board-content");

  const card = page.getByRole("region", { name: "Proposed change" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Not applied yet");
  await expect(card).toContainText("Add “Sample: coffee stop” to day 1");
  await expect(card).toContainText("Add “Sample: evening stroll” to day 1");
  // The prose above it does not claim an edit either.
  const log = page.getByRole("log", { name: "Conversation" });
  await expect(log).toContainText("Nothing is applied yet");
  // …and the board really is untouched while the card sits there.
  await expect(board.getByText("Sample: coffee stop")).toHaveCount(0);

  const [applied] = await Promise.all([
    page.waitForResponse((r) => /\/api\/trips\/[^/]+\/ask\/apply$/.test(new URL(r.url()).pathname)),
    card.getByRole("button", { name: "Approve" }).click(),
  ]);
  expect(applied.status()).toBe(200);

  // The assertion M10's gate once made, restored: the plan is on the board.
  await expect(board.getByText("Sample: coffee stop")).toBeVisible();
  await expect(board.getByText("Sample: evening stroll")).toBeVisible();
  await expect(card).toContainText("Applied");
  await expect(card).toContainText("Done — added “Sample: coffee stop” to day 1");

  // ONE atomic batch, so ONE undo takes the whole plan back off (ADR-013).
  // Two commands committed separately would need two.
  await openHistory(page);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(board.getByText("Sample: coffee stop")).toHaveCount(0);
  await expect(board.getByText("Sample: evening stroll")).toHaveCount(0);
});

test("rejecting an AI plan leaves the trip exactly as it was", async ({ page }) => {
  const tripName = e2eTripName("AI No");
  await page.goto("/");
  const tripId = await createMappedTrip(page, tripName, 2);
  await page.goto(`/trips/${tripId}`);
  await expect(page.getByRole("heading", { name: tripName, level: 2 })).toBeVisible();

  // Read the trip through the API before and after, so "unchanged" is the
  // whole projection rather than whatever happens to be on screen.
  const before = await (await page.request.get(`/api/trips/${tripId}`)).text();

  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await page.getByPlaceholder("Ask about this trip…").fill("add a coffee stop to day 1");
  await page.getByRole("button", { name: "Ask" }).click();

  const card = page.getByRole("region", { name: "Proposed change" });
  await expect(card).toBeVisible();
  const board = page.locator(".trip-board-content");

  // No request is expected at all: rejecting is the apply endpoint not being
  // called, which is what makes "byte-identical" a property of the shape.
  let applyCalls = 0;
  page.on("request", (r) => {
    if (/\/ask\/apply$/.test(new URL(r.url()).pathname)) applyCalls += 1;
  });
  await card.getByRole("button", { name: "Reject" }).click();

  await expect(card).toContainText("Rejected");
  await expect(card).toContainText("Discarded — nothing on the trip changed.");
  await expect(board.getByText("Sample: coffee stop")).toHaveCount(0);
  expect(applyCalls).toBe(0);
  expect(await (await page.request.get(`/api/trips/${tripId}`)).text()).toBe(before);
});
