import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiResult, BoardCommand, CommandOutcome } from "@/lib/apiClient";
import { NewTripWizard } from "./NewTripWizard";

// THE SHEET IS A TRANSCRIPT NOW (SPEC §30.1, design §3), and since §32.3 its
// question list is DERIVED: "do you have a start date" inserts a day-picker
// turn when it is answered Yes, so the flow is five turns or six. Nothing here
// may count them, which is why every walk below names the turns it answers.
//
// **Where the four retry tests went.** This file used to carry the regression
// cover for CodeRabbit PR #32, KI-2026-09-08-a and CodeRabbit PR #165, driven
// by typing into the budget and currency fields. A four-turn script has no turn
// for either, so that sequence moved to `newTripSubmit.ts` and is tested
// directly in `newTripSubmit.test.ts` — ten cases where there were four. They
// are not deleted; they are somewhere they can still be reached.
//
// What belongs here is what only a rendered sheet can show: that a question is
// asked, that an answer commits and appears as the reader's own words, that
// Change goes back without losing what came after, and that nothing reaches the
// network until an exit is pressed.
afterEach(cleanup);

const user = userEvent.setup({ delay: null });

type NewTripCreate = (input: {
  name: string;
  tripId?: string;
}) => Promise<ApiResult<{ tripId: string }>>;

function renderWizard(overrides: { createTrip?: NewTripCreate } = {}) {
  // `tripId` is optional on the prop because the CLIENT mints it now
  // (KI-2026-09-12-e) — the mock has to accept what the component really sends.
  const createTrip =
    vi.fn<(input: { name: string; tripId?: string }) => Promise<ApiResult<{ tripId: string }>>>();
  createTrip.mockImplementation(
    overrides.createTrip ??
      (async (input) => ({ ok: true, value: { tripId: input.tripId ?? "trip-1" } })),
  );
  const dispatch = vi
    .fn<(command: BoardCommand) => Promise<ApiResult<CommandOutcome>>>()
    .mockResolvedValue({ ok: true, value: {} as CommandOutcome });
  const onOpenChange = vi.fn();
  const onCreated = vi.fn();
  render(
    <NewTripWizard
      open
      onOpenChange={onOpenChange}
      createTrip={createTrip}
      dispatch={dispatch}
      onCreated={onCreated}
    />,
  );
  return { createTrip, dispatch, onOpenChange, onCreated };
}

/** Walk to the last turn by clicking one chip per question, undated. */
async function answerThroughToFeel() {
  await user.click(screen.getByRole("button", { name: "Lisbon" }));
  await user.click(screen.getByRole("button", { name: "Not yet" }));
  await user.click(screen.getByRole("button", { name: "A week" }));
  await user.click(screen.getByRole("button", { name: "Slow" }));
}

/** The same walk, with a real arrival: Yes, then the picker, then a length. */
async function answerThroughToFeelDated(iso: string) {
  await user.click(screen.getByRole("button", { name: "Lisbon" }));
  await user.click(screen.getByRole("button", { name: "Yes" }));
  await user.type(screen.getByLabelText("Arrive"), iso);
  await user.click(screen.getByRole("button", { name: "Use this date" }));
  await user.click(screen.getByRole("button", { name: "A week" }));
  await user.click(screen.getByRole("button", { name: "Slow" }));
}

describe("NewTripWizard — the turns", () => {
  it("opens on turn one and asks where, with chips and a composer both live", () => {
    renderWizard();
    const log = screen.getByRole("log", { name: "Conversation" });
    expect(log.textContent).toContain("Where are you going?");
    // The composer's accessible name IS the question. "Trip name" is gone, and
    // that rename is why the e2e suite grew one seam onto this sheet first.
    expect(screen.getByLabelText("Where are you going?")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Lisbon" })).not.toBeNull();
    // D-A: no "Recent and nearby" label over the chips — nothing stores a
    // destination, so the claim had no data behind it.
    expect(screen.queryByText("Recent and nearby")).toBeNull();
  });

  it("commits a chip on click and shows the answer as the reader's own words", async () => {
    renderWizard();
    await user.click(screen.getByRole("button", { name: "Seoul" }));

    const log = screen.getByRole("log", { name: "Conversation" });
    expect(log.textContent).toContain("Seoul");
    // And it moves on: turn two is asked.
    expect(log.textContent).toContain("Do you have a start date in mind?");
  });

  it("commits the composer on Enter, and refuses an empty or whitespace answer", async () => {
    renderWizard();
    const composer = screen.getByLabelText("Where are you going?");

    await user.type(composer, "   {Enter}");
    // Still on turn one: a space bar is not a destination.
    expect(screen.getByRole("log").textContent).not.toContain("Do you have a start date");

    await user.clear(composer);
    await user.type(composer, "  Porto  {Enter}");
    const log = screen.getByRole("log");
    // Trimmed on the way in.
    expect(log.textContent).toContain("Porto");
    expect(log.textContent).toContain("Do you have a start date in mind?");
  });

  // SPEC §30.1: "Later answers are kept, not cleared — you re-answer forward."
  //
  // **"Kept" is a claim about the data, not the transcript**, and the first
  // version of this test got that wrong: it asserted the later answer was still
  // ON SCREEN after going back, and it is not — you are being re-asked that
  // turn, so it has no committed user turn until you answer it again. What
  // survives is the answer itself, which is observable in what gets created.
  it("offers Change under an answered turn, returns to it, and keeps the later answers", async () => {
    const { dispatch } = renderWizard();
    await user.click(screen.getByRole("button", { name: "Lisbon" }));
    await user.click(screen.getByRole("button", { name: "Yes" }));
    await user.type(screen.getByLabelText("Arrive"), "2026-10-03");
    await user.click(screen.getByRole("button", { name: "Use this date" }));
    await user.click(screen.getByRole("button", { name: "A week" }));

    const changes = screen.getAllByRole("button", { name: "Change" });
    expect(changes.length).toBeGreaterThan(0);
    await user.click(changes[0]!);

    // Back on turn one, being asked again, with the old answer replaced…
    expect(screen.getByLabelText("Where are you going?")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Seoul" }));
    const log = screen.getByRole("log");
    expect(log.textContent).toContain("Seoul");
    expect(log.textContent).not.toContain("Lisbon");

    // …and the date and length answered AFTER it were never lost: finishing now
    // still applies seven days from 3 Oct, which only the kept `start` and
    // `len` answers could supply.
    await user.click(screen.getByRole("button", { name: "Create with this" }));
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "SetTripDates",
          startDate: "2026-10-03",
          endDate: "2026-10-09",
        }),
      ),
    );
  });

  it("commits feel as the default when nothing is picked", async () => {
    const { createTrip } = renderWizard();
    await answerThroughToFeel();

    // Nothing picked: the button says so, and says what it will do anyway.
    await user.click(screen.getByRole("button", { name: "Nothing in particular" }));

    await waitFor(() => expect(createTrip).toHaveBeenCalled());
    expect(screen.getByRole("log").textContent).toContain("A bit of everything");
  });

  it("names the picked chips together once some are picked", async () => {
    renderWizard();
    await answerThroughToFeel();
    await user.click(screen.getByRole("button", { name: "Food" }));
    await user.click(screen.getByRole("button", { name: "Markets" }));

    expect(screen.getByRole("button", { name: "That is it — build it" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Nothing in particular" })).toBeNull();
  });

  it("offers Create empty from turn one and Create with this from the first answer", async () => {
    renderWizard();
    const createEmpty = screen.getByRole("button", { name: "Create empty" });
    // Present but inert until there is a name to use: `CreateTrip.name` is
    // `z.string().min(1)`, so an unnamed trip is a request the domain refuses.
    expect(createEmpty.hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Create with this" })).toBeNull();

    await user.type(screen.getByLabelText("Where are you going?"), "Porto");
    // The uncommitted composer text is a usable name — this is what preserves
    // "type a name, press Create empty" from the old single-field dialog.
    expect(screen.getByRole("button", { name: "Create empty" }).hasAttribute("disabled")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Lisbon" }));
    expect(screen.getByRole("button", { name: "Create with this" })).not.toBeNull();
  });

  // **A failed create used to print the opposite of what happened**
  // (CodeRabbit, PR #188). `finish()` set the phase to "made" and only then
  // awaited `submit`, so the closing line claimed the trip existed while the
  // error sat underneath it, and the footer swapped the retry controls for
  // "Open the trip" — which, with no `progress` latched, closed the sheet
  // without ever calling `onCreated`. The trip was nowhere.
  it("says nothing was created, and keeps the retry controls, when the create fails", async () => {
    const { createTrip, onCreated, onOpenChange } = renderWizard({
      // `status: 0` is this repo's shape for "the request never produced a
      // response" — the offline case, which is the one that made the old
      // ordering worst: no trip, and a sheet saying there was one.
      createTrip: async () => ({ ok: false, error: { status: 0, message: "Network is down" } }),
    });
    await answerThroughToFeel();
    await user.click(screen.getByRole("button", { name: "Nothing in particular" }));

    await waitFor(() => expect(createTrip).toHaveBeenCalled());
    const log = screen.getByRole("log");
    expect(log.textContent).not.toContain("is created");
    expect(screen.queryByRole("button", { name: "Open the trip" })).toBeNull();
    expect(onCreated).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  // Only a LENGTH CHIP sets `days`; free text cannot, because parsing it is the
  // model call §30.2 forbids. The closing line used to fall back to `days ?? 0`
  // and announce "0 days" (CodeRabbit, PR #188).
  it("names no day count in the closing line when no length chip was picked", async () => {
    const { createTrip } = renderWizard();
    await user.click(screen.getByRole("button", { name: "Lisbon" }));
    await user.click(screen.getByRole("button", { name: "Not yet" }));
    await user.type(screen.getByLabelText("How long, roughly?"), "nine nights in April{Enter}");
    await user.click(screen.getByRole("button", { name: "Slow" }));
    await user.click(screen.getByRole("button", { name: "Nothing in particular" }));

    await waitFor(() => expect(createTrip).toHaveBeenCalled());
    const log = screen.getByRole("log");
    expect(log.textContent).toContain("Lisbon is created.");
    expect(log.textContent).not.toContain("0 days");
  });

  // **§31.2 — the thread opens with one line before any question.** It states
  // §30.2's contract in the reader's own reading order, and it means turn one
  // is never an empty pane above a dock.
  //
  // **And it never counts the questions** (§32.3: *"Nothing may hardcode the
  // count — including the copy"*). It used to say "Four quick questions", which
  // was true of a fixed four-turn script and became a lie the moment the list
  // started depending on the answers. This asserts the absence, because the
  // tempting fix — updating the number — is the one that breaks again.
  it("opens the thread by saying nothing is generated until the end", () => {
    renderWizard();
    const log = screen.getByRole("log", { name: "Conversation" });
    const text = log.textContent ?? "";
    expect(text).toContain("A few quick questions");
    expect(text).toContain("Nothing is generated until the last answer lands");
    expect(text).not.toMatch(/\b(three|four|five|six|3|4|5|6) quick questions\b/i);
  });

  // **§32.3 — one question became two.** The old `when` turn carried a length
  // chip row AND an arrive→leave range AND a "Use these dates" button: three
  // controls for one answer, and the busiest thing in the flow. It also
  // modelled a trip as a date range while every other surface in this app
  // models it as a start date plus a length.
  it("asks about a date before asking for one, and inserts the picker only on Yes", async () => {
    renderWizard();
    await user.click(screen.getByRole("button", { name: "Lisbon" }));

    // The date question itself offers no date control — it is a plain question.
    expect(screen.getByRole("log").textContent).toContain("Do you have a start date in mind?");
    expect(screen.queryByLabelText("Arrive")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Yes" }));
    // …and now the picker turn exists, with one input rather than a range.
    expect(screen.getByRole("log").textContent).toContain("When do you arrive?");
    expect(screen.getByLabelText("Arrive")).not.toBeNull();
    expect(screen.queryByLabelText("Depart")).toBeNull();
  });

  it("skips straight to the length when there is no date yet", async () => {
    renderWizard();
    await user.click(screen.getByRole("button", { name: "Lisbon" }));
    await user.click(screen.getByRole("button", { name: "Not yet" }));

    const log = screen.getByRole("log");
    expect(log.textContent).toContain("How long, roughly?");
    expect(log.textContent).not.toContain("When do you arrive?");
    // And the length turn carries no date control of its own — §32.3 put the
    // one date input on the arrival turn and nowhere else.
    expect(screen.queryByLabelText("Arrive")).toBeNull();
  });

  // §32.3: the length turn reads differently once a day is fixed. "How long,
  // roughly?" is the wrong thing to ask somebody who just named the exact day.
  it("asks the length differently once an arrival is fixed", async () => {
    renderWizard();
    await user.click(screen.getByRole("button", { name: "Lisbon" }));
    await user.click(screen.getByRole("button", { name: "Yes" }));
    await user.type(screen.getByLabelText("Arrive"), "2026-10-03");
    await user.click(screen.getByRole("button", { name: "Use this date" }));

    expect(screen.getByRole("log").textContent).toContain("And how long are you staying?");
    expect(screen.getByLabelText("And how long are you staying?")).not.toBeNull();
  });

  // **§32.3 — "Dates are formatted at commit, never passed through raw."** The
  // picker's value is ISO; a conversational surface printing `2026-10-03` reads
  // machine-generated and drifts from every other date in the product. The raw
  // value must reach the trip and nothing else.
  it("puts the arrival in the app's date style, never the picker's ISO", async () => {
    const { dispatch } = renderWizard();
    await answerThroughToFeelDated("2026-10-03");
    await user.click(screen.getByRole("button", { name: "Nothing in particular" }));

    const log = screen.getByRole("log").textContent ?? "";
    expect(log).toContain("Oct 3, 2026");
    expect(log).not.toContain("2026-10-03");

    // The ISO still reaches the domain, which is the half that must stay exact.
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "SetTripDates",
          startDate: "2026-10-03",
          // Inclusive: seven days from 3 Oct ends on the 9th, not the 10th.
          endDate: "2026-10-09",
        }),
      ),
    );
  });

  // **§32.3: "Revising the date question back to *Not yet* must drop the picked
  // day with it, or the summary keeps a date the user just removed."**
  //
  // Two halves, one behaviour. `commitAnswer` drops `answers.start`; `dated`
  // requires it before the ISO still sitting in component state may date
  // anything. Dropping either half of `dated` turns this red — which is what
  // makes the guard, rather than a defensive `setArrive("")`, the thing worth
  // owning here.
  it("dates nothing once the arrival is taken back", async () => {
    const { dispatch, createTrip } = renderWizard();
    await user.click(screen.getByRole("button", { name: "Lisbon" }));
    await user.click(screen.getByRole("button", { name: "Yes" }));
    await user.type(screen.getByLabelText("Arrive"), "2026-10-03");
    await user.click(screen.getByRole("button", { name: "Use this date" }));
    await user.click(screen.getByRole("button", { name: "A week" }));

    // Back to the date question, and change the answer.
    await user.click(screen.getAllByRole("button", { name: "Change" })[1]!);
    await user.click(screen.getByRole("button", { name: "Not yet" }));

    await user.click(screen.getByRole("button", { name: "Create with this" }));
    await waitFor(() => expect(createTrip).toHaveBeenCalled());
    // The day is gone. **The other half — that the length survives — is NOT
    // assertable here** and this comment used to claim it anyway (CodeRabbit,
    // PR #188): dropping the date shrinks the question list, so `len` is being
    // re-asked and has no committed user turn on screen to look at. It is a
    // reducer property, and `newTripScript.test.ts` asserts it directly.
    expect(screen.getByRole("log").textContent).not.toContain("Oct 3");
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "SetTripDates" }),
    );
  });

  // The same rule, reached the other way: typing over the arrival replaces a
  // fixed day with prose. The prose cannot date a trip, and the day it replaced
  // must not go on doing it silently.
  it("dates nothing once the arrival is typed over in words", async () => {
    const { dispatch, createTrip } = renderWizard();
    await user.click(screen.getByRole("button", { name: "Lisbon" }));
    await user.click(screen.getByRole("button", { name: "Yes" }));
    await user.type(screen.getByLabelText("Arrive"), "2026-10-03");
    await user.click(screen.getByRole("button", { name: "Use this date" }));
    await user.click(screen.getAllByRole("button", { name: "Change" })[2]!);

    await user.type(screen.getByLabelText("When do you arrive?"), "early October{Enter}");
    await user.click(screen.getByRole("button", { name: "A week" }));
    await user.click(screen.getByRole("button", { name: "Create with this" }));

    await waitFor(() => expect(createTrip).toHaveBeenCalled());
    expect(screen.getByRole("log").textContent).toContain("early October");
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "SetTripDates" }),
    );
  });

  // **`changeTo` keeps the answers, so the old destination outlived the edit**
  // (CodeRabbit, PR #188). Going back to turn one and typing a different city
  // left `answers.where` committed, and `name` preferred it — so Create empty
  // made a trip named the thing on screen a moment ago rather than the thing in
  // the field. An uncommitted edit to the question being ASKED is the more
  // recent intent.
  it("creates from the composer when turn one is being re-answered", async () => {
    const { createTrip } = renderWizard();
    await user.click(screen.getByRole("button", { name: "Lisbon" }));
    await user.click(screen.getAllByRole("button", { name: "Change" })[0]!);

    // Typed, deliberately not committed — this is the state the bug lived in.
    await user.type(screen.getByLabelText("Where are you going?"), "Porto");
    await user.click(screen.getByRole("button", { name: "Create empty" }));

    await waitFor(() => expect(createTrip).toHaveBeenCalled());
    expect(createTrip.mock.calls[0]![0]).toMatchObject({ name: "Porto" });
  });

  it("makes the footer's primary Open the trip once the trip exists", async () => {
    const { createTrip } = renderWizard();
    await answerThroughToFeel();
    await user.click(screen.getByRole("button", { name: "Nothing in particular" }));

    await waitFor(() => expect(createTrip).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Open the trip" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Create empty" })).toBeNull();
  });

  // **D-C, answered 2026-09-16.** The design's closing copy claims the trip was
  // laid out around the `feel` answer. Nothing stores `pace` or `feel`, so that
  // sentence would describe something that did not happen.
  it("closes by saying what was made, and what was not", async () => {
    const { createTrip } = renderWizard();
    await answerThroughToFeel();
    await user.click(screen.getByRole("button", { name: "Nothing in particular" }));
    await waitFor(() => expect(createTrip).toHaveBeenCalled());

    const log = screen.getByRole("log").textContent ?? "";
    expect(log).toContain("is created");
    expect(log).toContain("The days are empty and yours to fill");
    expect(log).toMatch(/pace and what the trip is about is not built in yet/);
    // The design's own wording, which is the thing not to ship.
    expect(log).not.toContain("laid out as Day 1");
  });

  it("never renders a typing indicator or a step rail", async () => {
    renderWizard();
    // §30.1: the stepper is not replaced with a progress bar — a transcript
    // shows its own progress, and the rail was what made the sheet grow.
    expect(screen.queryAllByTestId("wizard-step")).toHaveLength(0);
    // §30.2: there is nothing to wait for, so a typing indicator would be an
    // animation pretending to be latency.
    expect(screen.queryByText(/thinking/i)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Lisbon" }));
    expect(screen.queryByText(/thinking/i)).toBeNull();
    expect(screen.queryByText(/still writing/i)).toBeNull();
  });

  // The §30.2 property, asserted where it can actually be held — and now over
  // the LONGER walk, the one with the day picker in it, because that is the
  // path §32.3 added and the one where a date control could plausibly reach for
  // a geocoder.
  it("sends nothing to the network while the turns are being answered", async () => {
    const { createTrip, dispatch } = renderWizard();
    await answerThroughToFeelDated("2026-10-03");
    await user.click(screen.getByRole("button", { name: "Food" }));

    expect(createTrip).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  // A length alone is not a dated trip — there is nothing to count from — and
  // an arrival alone has no end. `SetTripDates` needs both, which is exactly
  // why §32.3 asks for them as two turns instead of one crowded control.
  it("applies the dates only when an arrival anchors a chosen length", async () => {
    const { dispatch, createTrip } = renderWizard();
    await answerThroughToFeel();
    await user.click(screen.getByRole("button", { name: "Nothing in particular" }));
    await waitFor(() => expect(createTrip).toHaveBeenCalled());
    // A length, no arrival: nothing to date from.
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "SetTripDates" }));

    cleanup();
    const second = renderWizard();
    await answerThroughToFeelDated("2026-10-03");
    await user.click(screen.getByRole("button", { name: "Nothing in particular" }));

    await waitFor(() =>
      expect(second.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "SetTripDates",
          startDate: "2026-10-03",
          endDate: "2026-10-09",
        }),
      ),
    );
  });

  it("shows the create-trip error inline and keeps the sheet open on failure", async () => {
    const { createTrip, onOpenChange } = renderWizard();
    createTrip.mockResolvedValue({ ok: false, error: { status: 500, message: "server exploded" } });

    await user.type(screen.getByLabelText("Where are you going?"), "Porto");
    await user.click(screen.getByRole("button", { name: "Create empty" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/server exploded/i);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("dispatches nothing when creating an empty trip from the name alone", async () => {
    const { createTrip, dispatch, onCreated } = renderWizard();
    await user.type(screen.getByLabelText("Where are you going?"), "Porto");
    await user.click(screen.getByRole("button", { name: "Create empty" }));

    await waitFor(() =>
      expect(createTrip).toHaveBeenCalledWith(expect.objectContaining({ name: "Porto" })),
    );
    expect(dispatch).not.toHaveBeenCalled();
    // **The id is minted by the client** (KI-2026-09-12-e), so it is random
    // rather than a fixture — and the claim worth making is that the id handed
    // back is the SAME one that was sent, not that it equals some literal.
    const sent = createTrip.mock.calls[0]?.[0]?.tripId;
    expect(sent).toMatch(/^[0-9a-f-]{36}$/);
    // `navigate: false` — the old dialog closed and left you on the trip list
    // to open the card yourself, and every pre-Phase-7 e2e spec is built on it.
    expect(onCreated).toHaveBeenCalledWith(sent, { navigate: false });
  });
});
