import { expect, test } from "@playwright/test";
import { createMappedTrip } from "./helpers";
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
// /trips/:id/ask (the streaming read-only agent). This spec follows it. The
// half that is NOT here any more — "…and still really changes the trip" —
// left with the endpoint: nothing in the browser applies an AI plan between
// M16 Task 5 and Task 6, which returns it through /ask as write tools behind
// an explicit approval. The command endpoint keeps its own integration
// coverage in the meantime (app/api/trips/[tripId]/ai/route.int.test.ts).
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
  await page.getByPlaceholder("Ask about this day…").fill("how is the trip looking?");
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
