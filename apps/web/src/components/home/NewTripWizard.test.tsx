import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiResult, BoardCommand, CommandOutcome } from "@/lib/apiClient";
import type { DiscoverDay, DiscoverResponse } from "@/lib/playbooks";

// The Playbook-day turn's read and its insert (M27 D13) are the component's
// own imports, so they are replaced here. Every test starts with an empty
// library: the turn is skipped and the walk below is the one it always was.
const library = vi.hoisted(() => ({
  cities: vi.fn(),
  search: vi.fn(),
  insert: vi.fn(),
}));
vi.mock("@/lib/apiClient", async (orig) => ({
  ...(await orig<typeof import("@/lib/apiClient")>()),
  searchCities: library.cities,
  searchPlaybooks: library.search,
  insertSavedDay: library.insert,
}));
// §30.3's fork reads a capability, and every test below needs to say which
// answer it is testing. `null` is the default because that is what an
// unresolved or failed read gives, and `useAiEntitled`'s own note requires
// every caller to treat it as entitled — so the default here is also the
// behaviour every pre-existing test in this file was written against.
const aiEntitled = { value: null as boolean | null };
vi.mock("@/components/assistant/useAiEntitled", async (orig) => ({
  ...(await orig<typeof import("@/components/assistant/useAiEntitled")>()),
  useAiEntitled: () => aiEntitled.value,
}));

import { NewTripWizard } from "./NewTripWizard";
import { CASS_DRAFTING_MS, CASS_TYPING_MS } from "./newTripScript";

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
//
// **Cass types for a beat after every answer** (SPEC §35.8, M27 D14), and the
// dock is gone while she does. The clock is fake so that beat costs nothing
// here: `user` below lets it pass after every click and keystroke, and the
// tests that are ABOUT the beat drive `raw` and the clock themselves.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // The city index knows every city a test answers, under the name it was
  // answered with — so the resolve step is transparent unless a test says not.
  library.cities.mockImplementation(async (q: string) => ({ ok: true, value: [{ city: q, days: 1 }] }));
  library.search.mockResolvedValue(discover([]));
  library.insert.mockResolvedValue({ ok: true, value: {} as CommandOutcome });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  aiEntitled.value = null;
});

const raw = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });

/** Let the longest beat Cass takes run out. */
async function settle() {
  await act(() => vi.advanceTimersByTimeAsync(CASS_DRAFTING_MS));
}

const user = {
  click: async (element: Element) => {
    await raw.click(element);
    await settle();
  },
  type: async (element: Element, text: string) => {
    await raw.type(element, text);
    await settle();
  },
  clear: (element: Element) => raw.clear(element),
};

function discover(days: DiscoverDay[]): ApiResult<DiscoverResponse> {
  return {
    ok: true,
    value: {
      days,
      siblings: [],
      budgetCurrency: null,
      truncated: false,
      matchCount: days.length,
      matchCountExact: true,
      sharedPlaybookCount: days.length,
    },
  };
}

function published(overrides: Partial<DiscoverDay> & Pick<DiscoverDay, "savedDayId" | "name" | "adds">): DiscoverDay {
  return {
    ownerId: "dev-mei",
    cities: ["Lisbon"],
    matchedCities: ["Lisbon"],
    stopCount: 4,
    dayCount: 1,
    window: null,
    preview: [],
    totalCost: null,
    rating: null,
    reviewCount: 0,
    visibility: "public",
    authorKind: "human",
    sourceTripName: "Portugal",
    createdAt: "2026-09-01T00:00:00.000Z",
    publishedAt: "2026-09-02T00:00:00.000Z",
    isMine: false,
    ...overrides,
  };
}

type NewTripCreate = (input: {
  name: string;
  tripId?: string;
}) => Promise<ApiResult<{ tripId: string }>>;

function renderWizard(overrides: { createTrip?: NewTripCreate; onImportFile?: () => void } = {}) {
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
      {...(overrides.onImportFile === undefined ? {} : { onImportFile: overrides.onImportFile })}
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

  // SPEC §35.2: *Create empty* stopped being a footer button. It is a quiet
  // link, live from turn one, and the footer exists only once it has
  // *Create with this* to hold.
  it("offers create an empty one from turn one and Create with this from the first answer", async () => {
    renderWizard();
    expect(screen.getByRole("button", { name: "create an empty one" }).hasAttribute("disabled")).toBe(
      false,
    );
    expect(screen.queryByRole("button", { name: "Create with this" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Lisbon" }));
    expect(screen.getByRole("button", { name: "Create with this" })).not.toBeNull();
  });

  // **M27 D4.** The link is live before anything is typed, and
  // `CreateTrip.name` is `z.string().min(1)` — the domain refuses a nameless
  // trip. It was a disabled button until there was a name; a link that does
  // nothing when pressed is worse, so it sends one.
  it("names an empty trip nobody named Untitled trip", async () => {
    const { createTrip, onCreated } = renderWizard();
    await user.click(screen.getByRole("button", { name: "create an empty one" }));

    await waitFor(() => expect(createTrip).toHaveBeenCalled());
    expect(createTrip.mock.calls[0]![0]).toMatchObject({ name: "Untitled trip" });
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  // The uncommitted composer text is still a usable name — this is what
  // preserves "type a name, press create" from the old single-field dialog.
  it("names an empty trip from the composer when something is typed", async () => {
    const { createTrip } = renderWizard();
    await user.type(screen.getByLabelText("Where are you going?"), "Porto");
    await user.click(screen.getByRole("button", { name: "create an empty one" }));

    await waitFor(() => expect(createTrip).toHaveBeenCalled());
    expect(createTrip.mock.calls[0]![0]).toMatchObject({ name: "Porto" });
  });

  // §35.2's row: *start from a Playbook* and *import a trip file*. Both leave
  // the sheet, so both close it.
  it("goes to Discover from start from a Playbook, closing the sheet", async () => {
    const { onOpenChange } = renderWizard();
    const link = screen.getByRole("link", { name: "start from a Playbook" });
    expect(link.getAttribute("href")).toBe("/playbooks");

    await user.click(link);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // **Closed, THEN the page's picker, in the same click.** The page owns the
  // picker because closing the sheet unmounts everything in it; the order is
  // asserted because a picker opened under a still-open modal sheet would be
  // opened from behind its overlay.
  it("closes the sheet and hands import a trip file to the page, in that order", async () => {
    const calls: string[] = [];
    const onImportFile = vi.fn(() => calls.push("import"));
    const { onOpenChange } = renderWizard({ onImportFile });
    onOpenChange.mockImplementation((open: boolean) => calls.push(`open:${String(open)}`));

    await user.click(screen.getByRole("button", { name: "import a trip file" }));
    expect(calls).toEqual(["open:false", "import"]);
  });

  // No page to hand it to, no link — one that closed the sheet and did nothing
  // would be a dead end.
  it("offers no import link when the page has no picker to hand it to", () => {
    renderWizard();
    expect(screen.queryByRole("button", { name: "import a trip file" })).toBeNull();
    expect(screen.getByRole("link", { name: "start from a Playbook" })).not.toBeNull();
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
  //
  // §35.8 gives the line a speaker — Cass — and keeps both halves of the
  // contract: "a few", and nothing made until the last answer.
  it("opens the thread as Cass, saying nothing is made until the end", () => {
    renderWizard();
    const log = screen.getByRole("log", { name: "Conversation" });
    const text = log.textContent ?? "";
    expect(text).toContain(
      "Hi, it’s Cass. A few quick questions and I’ll draft the trip — nothing is made until your last answer.",
    );
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
  // left `answers.where` committed, and `name` preferred it — so an empty create
  // made a trip named the thing on screen a moment ago rather than the thing in
  // the field. An uncommitted edit to the question being ASKED is the more
  // recent intent.
  it("creates from the composer when turn one is being re-answered", async () => {
    const { createTrip } = renderWizard();
    await user.click(screen.getByRole("button", { name: "Lisbon" }));
    await user.click(screen.getAllByRole("button", { name: "Change" })[0]!);

    // Typed, deliberately not committed — this is the state the bug lived in.
    await user.type(screen.getByLabelText("Where are you going?"), "Porto");
    await user.click(screen.getByRole("button", { name: "create an empty one" }));

    await waitFor(() => expect(createTrip).toHaveBeenCalled());
    expect(createTrip.mock.calls[0]![0]).toMatchObject({ name: "Porto" });
  });

  it("makes the footer's primary Open the trip once the trip exists", async () => {
    const { createTrip } = renderWizard();
    await answerThroughToFeel();
    await user.click(screen.getByRole("button", { name: "Nothing in particular" }));

    await waitFor(() => expect(createTrip).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Open the trip" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "create an empty one" })).toBeNull();
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

  it("never renders a step rail", () => {
    renderWizard();
    // §30.1: the stepper is not replaced with a progress bar — a transcript
    // shows its own progress, and the rail was what made the sheet grow.
    expect(screen.queryAllByTestId("wizard-step")).toHaveLength(0);
  });

  // **M27 D14 supersedes §30.2's "no typing indicator".** §35.8 draws one: a
  // beat after each answer, in which everything after the reader's own words
  // waits — the acknowledgement, the next question AND the dock. This test
  // used to assert the opposite; it was rewritten, not worked around.
  it("types for a beat after each answer, with the next line and the dock held behind it", async () => {
    // A clock that moves ONLY when told to, for the one test that measures it:
    // `shouldAdvanceTime` lets real milliseconds leak in between two lines.
    // `fireEvent`, because user-event's own async wrapper waits on a timer
    // that this clock never runs.
    vi.useRealTimers();
    vi.useFakeTimers();
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: "Lisbon" }));

    const typingRow = screen.getByRole("status", { name: "Cass is typing" });
    expect(typingRow).not.toBeNull();
    const log = screen.getByRole("log");
    expect(log.textContent).toContain("Lisbon");
    expect(log.textContent).not.toContain("Do you have a start date in mind?");
    // Nothing to answer with until there is something to answer.
    expect(screen.queryByRole("button", { name: "Yes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(CASS_TYPING_MS - 1));
    expect(screen.getByRole("status", { name: "Cass is typing" })).not.toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.queryByRole("status", { name: "Cass is typing" })).toBeNull();
    // The reply lands whole: the acknowledgement, then the question.
    expect(log.textContent).toContain("Lisbon, good. Do you have a start date in mind?");
    expect(screen.getByRole("button", { name: "Yes" })).not.toBeNull();
  });

  // The longer beat before the draft, and the order that matters: the create
  // runs UNDER it — the pause is presentation and must add nothing to the wait
  // — but the closing line only arrives once the beat is over.
  it("drafts under a labelled beat, and describes the trip only after it", async () => {
    const { createTrip } = renderWizard();
    await answerThroughToFeel();
    await raw.click(screen.getByRole("button", { name: "Nothing in particular" }));

    const row = screen.getByRole("status", { name: "Cass is typing" });
    expect(row.textContent).toContain("Drafting the trip…");
    await waitFor(() => expect(createTrip).toHaveBeenCalled());
    expect(screen.getByRole("log").textContent).not.toContain("is created");

    await act(() => vi.advanceTimersByTimeAsync(CASS_DRAFTING_MS));
    expect(screen.queryByRole("status", { name: "Cass is typing" })).toBeNull();
    expect(screen.getByRole("log").textContent).toContain("Done. Lisbon is created, 7 days.");
  });

  it("acknowledges each answer in one clause before the next question", async () => {
    renderWizard();
    await user.click(screen.getByRole("button", { name: "Back to Kyoto" }));
    await user.click(screen.getByRole("button", { name: "Not yet" }));
    await user.click(screen.getByRole("button", { name: "A week" }));
    await user.click(screen.getByRole("button", { name: "Packed" }));

    const log = screen.getByRole("log").textContent ?? "";
    expect(log).toContain("Kyoto again — good. Do you have a start date in mind?");
    expect(log).toContain("No problem — dates can come later. How long, roughly?");
    expect(log).toContain("Got it. What pace do you want?");
    expect(log).toContain("Packed — I’ll keep the travel between stops tight. What is the trip about?");
  });

  // §35.9: the hint sits over chips and nowhere else — the arrival turn has a
  // day picker and no chips, and "tap one" there would point at nothing.
  it("hints at the chips only on a turn that has them", async () => {
    renderWizard();
    expect(screen.getByText("Tap one to answer — or type your own")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Lisbon" }));
    await user.click(screen.getByRole("button", { name: "Yes" }));
    expect(screen.queryByText(/— or type your own/)).toBeNull();
    await user.type(screen.getByLabelText("Arrive"), "2026-10-03");
    await user.click(screen.getByRole("button", { name: "Use this date" }));
    await user.click(screen.getByRole("button", { name: "A week" }));
    await user.click(screen.getByRole("button", { name: "Slow" }));
    expect(screen.getByText("Pick any that fit — or type your own")).not.toBeNull();
  });

  // A picked answer says so in something other than colour.
  it("marks a picked answer pressed, and leaves its name the answer itself", async () => {
    renderWizard();
    await answerThroughToFeel();
    const food = screen.getByRole("button", { name: "Food" });
    expect(food.getAttribute("aria-pressed")).toBe("false");
    await user.click(food);
    expect(screen.getByRole("button", { name: "Food" }).getAttribute("aria-pressed")).toBe("true");
  });

  // "Or type your own" is only honest if there is somewhere to type on the
  // last turn too — and a typed answer there ends the flow like the button.
  it("takes a typed answer on the last turn and makes the trip from it", async () => {
    const { createTrip } = renderWizard();
    await answerThroughToFeel();
    await user.type(screen.getByLabelText("What is the trip about?"), "Tiles and custard tarts{Enter}");

    await waitFor(() => expect(createTrip).toHaveBeenCalled());
    expect(screen.getByRole("log").textContent).toContain("Tiles and custard tarts");
  });

  // The §30.2 property, asserted where it can actually be held — and now over
  // the LONGER walk, the one with the day picker in it, because that is the
  // path §32.3 added and the one where a date control could plausibly reach for
  // a geocoder.
  //
  // M27 D13 added ONE lookup — the city's published days, by way of the city
  // index that names the city the way Discover stores it — and this is where
  // it is held to being only that: two reads, once each, for the city
  // answered, and no write until an exit is pressed.
  it("sends nothing to the network while the turns are being answered", async () => {
    const { createTrip, dispatch } = renderWizard();
    await answerThroughToFeelDated("2026-10-03");
    await user.click(screen.getByRole("button", { name: "Food" }));

    expect(createTrip).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(library.insert).not.toHaveBeenCalled();
    expect(library.cities).toHaveBeenCalledExactlyOnceWith("Lisbon");
    expect(library.search).toHaveBeenCalledTimes(1);
    expect(library.search).toHaveBeenCalledWith({ cities: ["Lisbon"], sort: "most-added" });
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
    await user.click(screen.getByRole("button", { name: "create an empty one" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/server exploded/i);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("dispatches nothing when creating an empty trip from the name alone", async () => {
    const { createTrip, dispatch, onCreated } = renderWizard();
    await user.type(screen.getByLabelText("Where are you going?"), "Porto");
    await user.click(screen.getByRole("button", { name: "create an empty one" }));

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

// SPEC §35.8 + M27 D13: after the city, published days people keep adding
// there — ranked by adds, since nothing is rated until M12.
describe("NewTripWizard — the Playbook-day turn", () => {
  const TRAM = "11111111-1111-4111-8111-111111111111";
  const ALFAMA = "22222222-2222-4222-8222-222222222222";
  const OFFERED = [
    published({ savedDayId: ALFAMA, name: "Alfama at dusk", adds: 3, dayCount: 2 }),
    published({ savedDayId: TRAM, name: "Tram 28 morning", adds: 12 }),
    // Never offered: nobody has added it yet, or it is the reader's own.
    published({ savedDayId: "33333333-3333-4333-8333-333333333333", name: "Unloved", adds: 0 }),
    published({ savedDayId: "44444444-4444-4444-8444-444444444444", name: "Mine", adds: 50, isMine: true }),
  ];

  it("offers the most-added days for the city, and none of the reader's own", async () => {
    library.search.mockResolvedValue(discover(OFFERED));
    renderWizard();
    await user.click(screen.getByRole("button", { name: "Lisbon" }));

    expect(screen.getByRole("log").textContent).toContain(
      "Lisbon, good. People planning Lisbon keep adding these days. Want me to build around any of them? Or skip, and I’ll plan it fresh.",
    );
    const cards = within(screen.getByRole("group", { name: "Popular days" })).getAllByRole("button");
    expect(cards.map((card) => card.textContent)).toEqual([
      "Tram 28 morningAdded to 12 trips · 1 day · by MeiAdd",
      "Alfama at duskAdded to 3 trips · 2 days · by MeiAdd",
    ]);
    // Nothing picked is a real answer, and the button says which.
    expect(screen.getByRole("button", { name: "Skip — plan it fresh" })).not.toBeNull();
  });

  it("builds around a picked day, and puts it in the trip once the trip exists", async () => {
    library.search.mockResolvedValue(discover(OFFERED));
    const { createTrip } = renderWizard();
    await user.click(screen.getByRole("button", { name: "Lisbon" }));
    const tram = screen.getByRole("button", { name: /^Tram 28 morning/ });
    await user.click(tram);
    expect(screen.getByRole("button", { name: /^Tram 28 morning/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /^Tram 28 morning/ }).textContent).toContain("✓ Added");
    await user.click(screen.getByRole("button", { name: "Build around this day" }));

    expect(screen.getByRole("log").textContent).toContain(
      "I’ll build the rest around that one. Do you have a start date in mind?",
    );
    // Picked, said, and still nothing sent: the trip does not exist yet.
    expect(library.insert).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Not yet" }));
    await user.click(screen.getByRole("button", { name: "A week" }));
    await user.click(screen.getByRole("button", { name: "Slow" }));
    await user.click(screen.getByRole("button", { name: "Nothing in particular" }));

    await waitFor(() => expect(library.insert).toHaveBeenCalledTimes(1));
    const tripId = createTrip.mock.calls[0]![0].tripId;
    expect(library.insert).toHaveBeenCalledWith(tripId, TRAM);
    expect(screen.getByRole("log").textContent).toContain("Tram 28 morning is already in place");
  });

  // Each chosen day is appended to the trip, so the closing line states the
  // length the trip really has: two 3-day Playbooks on a Long weekend (4) are
  // a 6-day trip, not a 4-day one — and not a 10-day one either.
  it("states the trip's real length when the chosen days outrun the answer", async () => {
    library.search.mockResolvedValue(
      discover([
        published({ savedDayId: TRAM, name: "Tram 28 morning", adds: 12, dayCount: 3 }),
        published({ savedDayId: ALFAMA, name: "Alfama at dusk", adds: 3, dayCount: 3 }),
      ]),
    );
    const { dispatch } = renderWizard();
    await user.click(screen.getByRole("button", { name: "Lisbon" }));
    await user.click(screen.getByRole("button", { name: /^Tram 28 morning/ }));
    await user.click(screen.getByRole("button", { name: /^Alfama at dusk/ }));
    await user.click(screen.getByRole("button", { name: "Build around these 2" }));
    await user.click(screen.getByRole("button", { name: "Yes" }));
    await user.type(screen.getByLabelText("Arrive"), "2026-10-03");
    await user.click(screen.getByRole("button", { name: "Use this date" }));
    await user.click(screen.getByRole("button", { name: "Long weekend" }));
    await user.click(screen.getByRole("button", { name: "Slow" }));
    await user.click(screen.getByRole("button", { name: "Nothing in particular" }));

    await waitFor(() => expect(library.insert).toHaveBeenCalledTimes(2));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "SetTripDates", newDayIds: [] }));
    expect(screen.getByRole("log").textContent).toContain("Done. Lisbon is created, 6 days from Oct 3, 2026.");
  });

  // Discover matches a city exactly, so the raw answer "lisbon, portugal"
  // found nothing and the turn was silently skipped. The city index resolves
  // it to the name Discover knows.
  it("looks the typed city up by the name the city index knows it by", async () => {
    library.cities.mockResolvedValue({ ok: true, value: [{ city: "Lisbon", days: 4 }, { city: "Lisbon Coast", days: 1 }] });
    library.search.mockResolvedValue(discover(OFFERED));
    renderWizard();
    await user.type(screen.getByLabelText("Where are you going?"), "lisbon, portugal{Enter}");

    expect(library.search).toHaveBeenCalledWith({ cities: ["Lisbon"], sort: "most-added" });
    expect(library.cities).toHaveBeenCalledWith("lisbon");
    expect(screen.getByRole("group", { name: "Popular days" })).not.toBeNull();
  });

  // A prefix hit is not an answer: "Lis" is not the reader saying Lisbon.
  it("skips the turn when the city index has no such city, or cannot be read", async () => {
    library.cities.mockResolvedValueOnce({ ok: true, value: [{ city: "Lisbon", days: 4 }] });
    library.search.mockResolvedValue(discover(OFFERED));
    renderWizard();
    await user.type(screen.getByLabelText("Where are you going?"), "Lis{Enter}");
    expect(screen.queryByRole("group", { name: "Popular days" })).toBeNull();

    cleanup();
    library.cities.mockResolvedValueOnce({ ok: false, error: { status: 500, message: "down" } });
    renderWizard();
    await user.type(screen.getByLabelText("Where are you going?"), "Lisbon{Enter}");
    expect(screen.queryByRole("group", { name: "Popular days" })).toBeNull();
    expect(library.search).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Not yet" })).not.toBeNull();
  });

  // "Never block the script": the read runs under the typing row, and when
  // the row ends without it the turn is simply not asked.
  it("skips the turn when the read has not come back by the end of the beat", async () => {
    library.search.mockReturnValue(new Promise(() => {}));
    renderWizard();
    await user.click(screen.getByRole("button", { name: "Lisbon" }));

    expect(screen.queryByRole("group", { name: "Popular days" })).toBeNull();
    expect(screen.getByRole("log").textContent).toContain("Lisbon, good. Do you have a start date in mind?");
  });

  it("skips the turn when the read fails", async () => {
    library.search.mockResolvedValue({ ok: false, error: { status: 500, message: "down" } });
    renderWizard();
    await user.click(screen.getByRole("button", { name: "Lisbon" }));

    expect(screen.queryByRole("group", { name: "Popular days" })).toBeNull();
    expect(screen.getByRole("button", { name: "Not yet" })).not.toBeNull();
  });

  // The trip is what the reader asked for; a day that did not land is
  // something they can add from Playbooks. So the trip stands, and the
  // conversation stays on screen long enough to say which day is missing.
  it("keeps the trip and says so when a picked day cannot be added", async () => {
    library.search.mockResolvedValue(discover(OFFERED));
    library.insert.mockResolvedValue({ ok: false, error: { status: 404, message: "gone" } });
    const { createTrip, onCreated } = renderWizard();
    await user.click(screen.getByRole("button", { name: "Lisbon" }));
    await user.click(screen.getByRole("button", { name: /^Alfama at dusk/ }));
    await user.click(screen.getByRole("button", { name: "Build around this day" }));
    await user.click(screen.getByRole("button", { name: "Not yet" }));
    await user.click(screen.getByRole("button", { name: "A week" }));
    await user.click(screen.getByRole("button", { name: "Slow" }));
    await user.click(screen.getByRole("button", { name: "Nothing in particular" }));

    await waitFor(() => expect(createTrip).toHaveBeenCalled());
    const log = screen.getByRole("log").textContent ?? "";
    expect(log).toContain("Done. Lisbon is created, 7 days.");
    expect(log).toContain("Alfama at dusk could not be added — it is still in Playbooks.");
    expect(log).not.toContain("already in place");
    expect(screen.queryByRole("alert")).toBeNull();
    // Not navigated past: the one line saying what is missing stays readable.
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Open the trip" })).not.toBeNull();
  });
});

// §30.3, M26 link 9a: "After the fifth answer the flow splits on whether the
// account has assistant access — resolved from entitlements, exactly as
// everywhere else, never from a plan name compared by rank."
describe("NewTripWizard — the fork at the end, on plan (§30.3)", () => {
  async function makeTheTrip() {
    await answerThroughToFeel();
    await user.click(screen.getByRole("button", { name: "Nothing in particular" }));
    await screen.findByRole("button", { name: "Open the trip" });
  }

  it("shows nothing about the fork until the trip is actually made", async () => {
    aiEntitled.value = false;
    renderWizard();
    await answerThroughToFeel();

    // On the LAST QUESTION, before it is answered. This used to render here,
    // which put a claim about the trip on screen before there was a trip.
    expect(screen.queryByText(/part of Plus/i)).toBeNull();
    expect(screen.queryByText(/Let the assistant draft it/i)).toBeNull();
  });

  it("gives a free account the finished trip, a quiet Plus note, and See plans", async () => {
    aiEntitled.value = false;
    renderWizard();
    await makeTheTrip();

    // The reassurance FIRST: the fear a paywall at the end of a flow creates
    // is that the work was for nothing.
    expect(screen.getByText(/finished and yours to edit/i)).toBeTruthy();
    expect(screen.getByText(/part of Plus/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "See plans" }).getAttribute("href")).toBe("/plans");
    // "No teaser, no disabled input" — and not a teaser of the paid half
    // either, which is what the `Preview` is.
    expect(screen.queryByText(/Let the assistant draft it/i)).toBeNull();
  });

  // §30.3: "The composer is gone, because there is nothing it could do. No
  // teaser, no disabled input."
  it("offers a free account no composer at all — not a disabled one", async () => {
    aiEntitled.value = false;
    renderWizard();
    await makeTheTrip();

    expect(screen.queryByLabelText("What is this trip about?")).toBeNull();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("keeps the paid half a Preview for an entitled account", async () => {
    aiEntitled.value = true;
    renderWizard();
    await makeTheTrip();

    expect(screen.getByText(/Let the assistant draft it/i)).toBeTruthy();
    expect(screen.queryByText(/part of Plus/i)).toBeNull();
  });

  // The asymmetry that matters: `null` is BOTH "not resolved yet" and "the read
  // failed", and `useAiEntitled` requires every caller to treat it as entitled.
  // Flashing a paywall at a subscriber is a worse failure than showing a free
  // account one optimistic frame — and here that frame is a `Preview`, which
  // promises nothing.
  it("takes the paid branch while the entitlement is unknown", async () => {
    aiEntitled.value = null;
    renderWizard();
    await makeTheTrip();

    expect(screen.queryByText(/part of Plus/i)).toBeNull();
    expect(screen.getByText(/Let the assistant draft it/i)).toBeTruthy();
  });
});
