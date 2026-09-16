import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiResult, BoardCommand, CommandOutcome } from "@/lib/apiClient";
import { NewTripWizard } from "./NewTripWizard";

// THE SHEET IS A TRANSCRIPT NOW (SPEC §30.1, design §3).
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

function renderWizard() {
  const createTrip = vi.fn<(input: { name: string }) => Promise<ApiResult<{ tripId: string }>>>();
  createTrip.mockResolvedValue({ ok: true, value: { tripId: "trip-1" } });
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

/** Walk to the last turn by clicking one chip per question. */
async function answerThroughToFeel() {
  await user.click(screen.getByRole("button", { name: "Lisbon" }));
  await user.click(screen.getByRole("button", { name: "A week" }));
  await user.click(screen.getByRole("button", { name: "Slow" }));
}

describe("NewTripWizard — the four turns", () => {
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
    expect(log.textContent).toContain("How long, roughly?");
  });

  it("commits the composer on Enter, and refuses an empty or whitespace answer", async () => {
    renderWizard();
    const composer = screen.getByLabelText("Where are you going?");

    await user.type(composer, "   {Enter}");
    // Still on turn one: a space bar is not a destination.
    expect(screen.getByRole("log").textContent).not.toContain("How long, roughly?");

    await user.clear(composer);
    await user.type(composer, "  Porto  {Enter}");
    const log = screen.getByRole("log");
    // Trimmed on the way in.
    expect(log.textContent).toContain("Porto");
    expect(log.textContent).toContain("How long, roughly?");
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
    await user.type(screen.getByLabelText("Arrive"), "2026-10-03");
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

    // …and the length answered AFTER it was never lost: finishing now still
    // applies seven days, which only the kept `when` answer could supply.
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

  // The §30.2 property, asserted where it can actually be held.
  it("sends nothing to the network while the four turns are being answered", async () => {
    const { createTrip, dispatch } = renderWizard();
    await answerThroughToFeel();
    await user.click(screen.getByRole("button", { name: "Food" }));

    expect(createTrip).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  // **Found by a mutation that stayed green.** Breaking the component's `dated`
  // guard changed nothing any test could see: the real gate on `SetTripDates`
  // is in `newTripSubmit.ts` and is covered there, so `dated` turned out to
  // drive only this confirmation line — and nothing asserted it. The line is
  // the reader's one chance to notice the trip is about to be dated wrongly,
  // which makes it worth its own test rather than a shrug.
  it("confirms the computed span only once both a length and an arrival exist", async () => {
    renderWizard();
    await user.click(screen.getByRole("button", { name: "Lisbon" }));
    await user.click(screen.getByRole("button", { name: "A week" }));
    // A length alone is not a dated trip — there is nothing to count from.
    expect(screen.queryByText(/7 days —/)).toBeNull();

    // Back to the length turn, and give it an arrival this time.
    await user.click(screen.getAllByRole("button", { name: "Change" })[1]!);
    await user.type(screen.getByLabelText("Arrive"), "2026-10-03");
    await user.click(screen.getByRole("button", { name: "A week" }));

    // Re-asked at the pace turn now, so go back once more to read the line.
    await user.click(screen.getAllByRole("button", { name: "Change" })[1]!);
    expect(screen.getByText(/7 days —/)).not.toBeNull();
  });

  it("applies the dates only when an arrival anchors a chosen length", async () => {
    const { dispatch } = renderWizard();
    await user.click(screen.getByRole("button", { name: "Lisbon" }));
    await user.type(screen.getByLabelText("Arrive"), "2026-10-03");
    await user.click(screen.getByRole("button", { name: "A week" }));
    await user.click(screen.getByRole("button", { name: "Slow" }));
    await user.click(screen.getByRole("button", { name: "Nothing in particular" }));

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

    await waitFor(() => expect(createTrip).toHaveBeenCalledWith({ name: "Porto" }));
    expect(dispatch).not.toHaveBeenCalled();
    // `navigate: false` — the old dialog closed and left you on the trip list
    // to open the card yourself, and every pre-Phase-7 e2e spec is built on it.
    expect(onCreated).toHaveBeenCalledWith("trip-1", { navigate: false });
  });
});
