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
  // is never an empty pane above a dock. "Four", not the spec's "Five": `who`
  // was dropped 2026-09-15 and copy that miscounts its own flow is worse than
  // copy that disagrees with a stale spec line.
  it("opens the thread by saying nothing is generated until the end", () => {
    renderWizard();
    const log = screen.getByRole("log", { name: "Conversation" });
    expect(log.textContent).toContain("Four quick questions");
    expect(log.textContent).toContain("Nothing is generated until the last answer lands");
  });

  // **Exact dates are a legitimate answer to "how long"** (SPEC §30.1), and
  // until now they were not: the sheet took an arrival only, so `days` stayed
  // null unless a chip was picked, `SetTripDates` was never built, and the date
  // silently did not apply. The label was rewritten to stop promising it
  // (CodeRabbit, PR #188); §31.3's dock makes the promise true instead.
  it("takes the two date inputs as the length answer, and sends that range", async () => {
    const { dispatch } = renderWizard();
    await user.click(screen.getByRole("button", { name: "Lisbon" }));

    // No length chip is touched anywhere in this test.
    await user.type(screen.getByLabelText("Arrive"), "2026-10-03");
    await user.type(screen.getByLabelText("Depart"), "2026-10-09");
    await user.click(screen.getByRole("button", { name: "Use these dates" }));

    // It lands in the transcript as what the reader actually said — the range,
    // not a day count they never typed.
    expect(screen.getByRole("log").textContent).toMatch(/Oct 3.*Oct 9/);

    await user.click(screen.getByRole("button", { name: "Create with this" }));
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "SetTripDates",
          startDate: "2026-10-03",
          // Inclusive: 3 Oct to 9 Oct is seven days, not six.
          endDate: "2026-10-09",
        }),
      ),
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

    // **Back to the length turn BEFORE asserting the line is absent**
    // (CodeRabbit, PR #188). Committing a length advances to `pace`, and only
    // `when` carries `dates: true` — so asserting from there passed because the
    // whole dates block was unrendered, never because `dated` was false. The
    // assertion said nothing about the guard it is named for. Standing on the
    // turn that draws the block is what makes `dated` the only reason it is
    // missing; the Arrive field is checked to prove the block really is here.
    await user.click(screen.getAllByRole("button", { name: "Change" })[1]!);
    expect(screen.getByLabelText("Arrive")).not.toBeNull();
    // A length alone is not a dated trip — there is nothing to count from.
    expect(screen.queryByText(/7 days —/)).toBeNull();

    // Same turn, now with an arrival: the line appears.
    await user.type(screen.getByLabelText("Arrive"), "2026-10-03");
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
