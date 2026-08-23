import { useSyncExternalStore } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { TripCommand, type TripDetail } from "@tc/contracts";
import { TripBoardScreen } from "@/components/board/TripBoardScreen";
import { TripProvider } from "@/components/trip/context/TripProvider";
import { EditorHost, useEditor } from "@/components/trip/context/EditorHost";
import { FocusProvider } from "@/components/trip/context/FocusProvider";
import { LensRouter } from "@/components/trip/context/LensRouter";
import { costedTripDetailFixture, historyFixture, tripDetailFixture } from "@/mocks/fixtures";
import { makeTripHandlers } from "@/mocks/handlers";
import { setViewportMatches } from "../../../vitest.setup";

// The Assistant rail's real Ask box calls composeAiPlan directly (M10
// redesign-feedback follow-up) — mocked the same way ComposePanel.test.tsx
// mocks it, rather than adding a real /api/trips/:id/ai MSW handler this
// file otherwise has no use for.
const composeAiPlanMock = vi.fn();
vi.mock("@/lib/apiClient", async (orig) => {
  const actual = await orig<typeof import("@/lib/apiClient")>();
  return {
    ...actual,
    composeAiPlan: (...args: unknown[]) => composeAiPlanMock(...args),
  };
});

// LensRouter derives lens/view from the URL via next/navigation — mock it the
// same way F5's context.test.tsx does, with the URL as the store. Unlike that
// test (which only asserts the router.replace call), TripBoardScreen's tests
// click a tab and then assert on newly-rendered content, so the mock needs to
// actually trigger a re-render — wire it through useSyncExternalStore.
let search = new URLSearchParams("");
const listeners = new Set<() => void>();
const replaceSpy = vi.fn((url: string) => {
  search = new URLSearchParams(url.split("?")[1] ?? "");
  listeners.forEach((l) => l());
});
vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    useSyncExternalStore(
      (onStoreChange) => {
        listeners.add(onStoreChange);
        return () => listeners.delete(onStoreChange);
      },
      () => search,
    ),
  usePathname: () => "/trips/x",
  useRouter: () => ({ replace: replaceSpy }),
}));

// Itinerary/Daily/Trip lost their nav entry in M10 Wave 2's four-tab strip
// (TripViewTabs.tsx, Task 1.2 — KI-20) but kept their LensRouter entries and
// `?lens=` URLs, so tests that need one of them navigate the same way a real
// URL change would: mutate the mocked search and notify the listeners
// `replaceSpy` itself notifies above.
function navigateToLens(lens: string) {
  search = new URLSearchParams(`lens=${lens}`);
  listeners.forEach((l) => l());
}

function renderScreen(tripId: string) {
  return render(
    <TripProvider tripId={tripId}>
      <FocusProvider>
        <EditorHost>
          <LensRouter>
            <TripBoardScreen tripId={tripId} />
          </LensRouter>
        </EditorHost>
      </FocusProvider>
    </TripProvider>,
  );
}

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  search = new URLSearchParams("");
  replaceSpy.mockClear();
  composeAiPlanMock.mockReset();
  setViewportMatches({ "(min-width: 1180px)": true });
});
afterEach(() => {
  server.resetHandlers();
  cleanup();
  listeners.clear();
});
afterAll(() => server.close());

describe("TripBoardScreen", () => {
  it("loads the trip and adds a day through the command endpoint", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    renderScreen(fixture.tripId);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "+ Add day" }));
    await waitFor(() => expect(screen.getAllByTestId("day-column")).toHaveLength(1));
  });

  it("shows an error state for a missing trip", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    renderScreen("00000000-0000-4000-8000-000000000000");
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("history panel previews a past version read-only, and reverts to it", async () => {
    const ancientId = "55555555-5555-4555-8555-555555555555";
    const fixture = tripDetailFixture();
    const history = historyFixture(fixture.tripId);
    const pastFixture = tripDetailFixture({
      backlog: [ancientId],
      activities: {
        [ancientId]: { activityId: ancientId, title: "Ancient Rome", timeWindow: null, location: null, notes: null, anchors: [], cost: null },
      },
    });
    const onCommand = vi.fn<(command: TripCommand) => void>();
    server.use(...makeTripHandlers(fixture, { history, detailAt: { 2: pastFixture }, onCommand }));
    renderScreen(fixture.tripId);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    // P2 surface move: History is now a Popover trigger in TripHeader (#13),
    // not an inline toggle — the click opens the popover the same way.
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    fireEvent.click(await screen.findByRole("button", { name: /Undid: Added "Colosseum" to the backlog/ }));

    await screen.findByText("Viewing version 2 (read-only)");
    // The previewed version's parked stop shows in the Unscheduled drawer now
    // (Task 3.3 deleted the Backlog column that used to render it), collapsed
    // by default. The rack is itself wrapped in the same inert treatment as
    // the rest of the board while previewing (its "Add to day" dispatches
    // real, persisted commands with no other guard) — but jsdom's fireEvent
    // doesn't implement the browser behavior `inert` actually relies on
    // (blocking pointer events/focus at the rendering layer), so this click
    // still "succeeds" here regardless of the wrapper. That real-browser
    // guarantee isn't unit-testable; this assertion only proves the preview
    // fixture's rack contents render correctly, not that the rack is inert.
    fireEvent.click(screen.getByRole("button", { name: /unscheduled/i }));
    expect(await screen.findByText("Ancient Rome")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Revert to here" }));
    await waitFor(() =>
      expect(onCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: "RevertToState", toSeq: 2 }),
      ),
    );
    await waitFor(() => expect(screen.queryByText(/Viewing version/)).toBeNull());
  });

  it("switches between Day columns, Map and Timeline/Calendar lenses", async () => {
    // TripViewTabs.tsx (M10 Wave 2, Task 1.2): the top-level strip now shows
    // exactly 4 peer tabs (Timeline / Day columns / Calendar / Map) per the
    // design handoff, with Timeline/Calendar driving ScheduleLens's `view`
    // directly instead of routing through a nested SegmentedControl. Map is a
    // peer tab again, not behind a "More" menu; Itinerary/Daily/Trip have no
    // nav entry at all (KI-20).
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    renderScreen(fixture.tripId);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    // Board's own "+ Add day" stands in for "the Board lens is showing": Task
    // 3.3 deleted the backlog column this used to look for, and this fixture
    // has no days, so there is no `day-column` to look for either.
    expect(screen.getByRole("button", { name: "+ Add day" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Map" }));
    expect(await screen.findByText(/No located activities yet/)).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Timeline" }));
    expect(await screen.findByText("No days yet.")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Calendar" }));
    expect(await screen.findByText("Set a start date to see the calendar.")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Day columns" }));
    expect(await screen.findByRole("button", { name: "+ Add day" })).toBeTruthy();
  });

  it("opens TripDateControl from the clickable Dates row in Trip settings (restored, M10 Phase 4)", async () => {
    // Task 4.2's redesign shipped the sheet's Dates row read-only, leaving
    // TripDateControl (the only way to actually change a trip's dates) with
    // no mount point anywhere in the app — an unintentional capability loss
    // (product-owner ruling, 2026-08-22; see docs/known-issues.md's former
    // D-2 entry). This test confirms the real integration once restored:
    // opening Trip settings and clicking the Dates row opens a Popover
    // containing TripDateControl, pre-filled with the trip's real dates.
    // TripDateControl's own dispatch logic (SetTripDates/SetTripStartDate,
    // shrink-confirm) stays covered directly in TripDateControl.test.tsx; the
    // sheet's onCommand pass-through is covered in SettingsSheet.test.tsx.
    const fixture = tripDetailFixture({ startDate: "2027-06-01" });
    server.use(...makeTripHandlers(fixture));
    renderScreen(fixture.tripId);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Trip settings" }));

    const datesRow = await screen.findByRole("button", { name: "Dates" });
    expect(screen.queryByLabelText("Start date")).toBeNull();

    fireEvent.click(datesRow);

    const startInput = (await screen.findByLabelText("Start date")) as HTMLInputElement;
    expect(startInput.value).toBe("2027-06-01");
  });

  it("shows the conflict badge for an anchor-violating activity and clears it once the trip date resolves the conflict", async () => {
    const activityId = "44444444-4444-4444-8444-444444444444";
    const dayId = "66666666-6666-4666-8666-666666666666";

    const withConflict = tripDetailFixture({
      startDate: "2027-06-07", // a Monday
      days: [{ dayId, activityIds: [activityId], date: "2027-06-07", costSubtotal: 0 }],
      activities: {
        [activityId]: {
          activityId,
          title: "Weekday Market",
          timeWindow: null,
          location: null,
          notes: null,
          anchors: [{ kind: "dayOfWeek", days: ["tue", "wed"] }],
          cost: null,
        },
      },
      conflicts: [
        {
          id: `anchor-violation:${activityId}:dayOfWeek`,
          kind: "anchor-violation",
          severity: "warn",
          subjects: [activityId],
          description: '"Weekday Market" has an anchor its current placement does not satisfy.',
          resolutions: ["Shift the trip's dates", "Move the activity to a different day", "Edit or remove the anchor"],
        },
      ],
    });
    const resolved: TripDetail = { ...withConflict, startDate: "2027-06-08", conflicts: [] };

    let detail = withConflict;
    server.use(
      http.get("/api/trips/:tripId", () => HttpResponse.json({ trip: detail })),
      http.post("/api/trips/:tripId/commands", async ({ request }) => {
        const command = TripCommand.parse(await request.json());
        // Task 4.2: the settings sheet's Dates row is read-only now, and
        // TripDateControl (the only UI that used to resolve this conflict by
        // changing the start date) no longer mounts anywhere in the app —
        // see docs/known-issues.md. What this test actually verifies (a
        // conflict badge clearing once the server-confirmed detail resolves
        // it) doesn't depend on which command triggered that refetch, so
        // this drives it through Undo, a still-real, always-present control,
        // instead of the removed date input.
        if (command.type === "UndoLastChange") detail = resolved;
        return HttpResponse.json({
          ok: true,
          tripId: detail.tripId,
          detail,
          history: { tripId: detail.tripId, entries: [], canUndo: false, canRedo: false },
        });
      }),
      http.get("/api/trips/:tripId/history", () =>
        HttpResponse.json({ history: { tripId: withConflict.tripId, entries: [], canUndo: true, canRedo: false } }),
      ),
    );

    renderScreen(withConflict.tripId);

    expect(await screen.findByText("Weekday Market")).toBeTruthy();
    expect(screen.getByRole("img", { name: "conflict" })).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));

    await waitFor(() => expect(screen.queryByRole("img", { name: "conflict" })).toBeNull());
  });

  it("renders the Itinerary, Daily, and Trip lenses, reachable only by URL (KI-20 — no nav entry)", async () => {
    // TripViewTabs.tsx (M10 Wave 2, Task 1.2) dropped the "More" menu these
    // three lenses used to be reachable through; they kept their LensRouter
    // entries and `?lens=` URLs (KI-20), so this drives navigation the same
    // way a real URL change would — through the mocked search/listeners
    // this file's top-level `next/navigation` mock uses for `replaceSpy`.
    const fixture = costedTripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    renderScreen(fixture.tripId);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();

    navigateToLens("Itinerary");
    expect(await screen.findByTestId("itinerary-lens")).toBeTruthy();

    navigateToLens("Daily");
    expect(await screen.findByTestId("daily-overview-lens")).toBeTruthy();

    navigateToLens("Trip");
    expect(await screen.findByRole("region", { name: "Full trip overview" })).toBeTruthy();
  });

  it("posts a SetTripBudget command from TripMoneySettings", async () => {
    const fixture = tripDetailFixture();
    const onCommand = vi.fn<(command: TripCommand) => void>();
    server.use(...makeTripHandlers(fixture, { onCommand }));
    renderScreen(fixture.tripId);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    // P2 surface move: TripMoneySettings re-homed into SettingsSheet (comment 12b) —
    // open it via the header's gear button first.
    fireEvent.click(screen.getByRole("button", { name: "Trip settings" }));
    // Task 4.2 relabeled the field "Total for the trip" (was "Trip budget").
    await userEvent.type(await screen.findByLabelText(/cost|total for the trip/i), "500");
    await userEvent.tab();

    await waitFor(() =>
      expect(onCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: "SetTripBudget", tripId: fixture.tripId }),
      ),
    );
  });

  it("shows the over-budget warning in the conflict banner", async () => {
    const fixture = tripDetailFixture({
      budget: { amountMinor: 1000, currency: "USD" },
      tripCostTotal: 5000,
      budgetRemaining: -4000,
      conflicts: [
        {
          id: "over-budget:trip",
          kind: "over-budget",
          severity: "warn",
          subjects: [],
          description: "Trip total (50.00 USD) exceeds the budget (10.00 USD) by 40.00 USD.",
          resolutions: ["Raise the budget", "Remove or reduce a cost"],
        },
      ],
    });
    server.use(...makeTripHandlers(fixture));
    renderScreen(fixture.tripId);

    expect(await screen.findByText(/exceeds the budget/)).toBeTruthy();
  });

  // E1 review finding: the ActivityEditorSheet (portable Sheet raised via
  // EditorHost) had zero coverage of its open/seed/dispatch/close cycle.
  // Edit-mode is reachable through a real UI trigger today: ItineraryLens's
  // ActivityRow renders each activity as a clickable button wired to
  // onSelectActivity -> useEditor().openEdit (see TripBoardScreen.tsx).
  it("opens the activity editor from the Itinerary lens, edits, and dispatches UpdateActivity", async () => {
    const fixture = costedTripDetailFixture();
    const colosseumId = "2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e";
    const onCommand = vi.fn<(command: TripCommand) => void>();
    server.use(...makeTripHandlers(fixture, { onCommand }));
    renderScreen(fixture.tripId);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    navigateToLens("Itinerary");
    await screen.findByTestId("itinerary-lens");

    // The row label is "<place> · <title>" — click the activity to openEdit.
    fireEvent.click(screen.getByRole("button", { name: /Colosseum tour/ }));

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Edit activity" })).toBeTruthy();

    // Seeded from the existing activity's data.
    const titleInput = screen.getByLabelText("Activity title") as HTMLInputElement;
    expect(titleInput.value).toBe("Colosseum tour");

    fireEvent.change(titleInput, { target: { value: "Colosseum night tour" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "UpdateActivity",
          activityId: colosseumId,
          title: "Colosseum night tour",
        }),
      ),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  // E1 review finding, continued: E2 hasn't wired any UI trigger to
  // openCreate yet (confirmed by review), so create-mode is exercised via a
  // direct useEditor() consumer rendered inside the same provider stack —
  // same pattern as F5's context.test.tsx Consumer.
  it("opens the activity editor via useEditor().openCreate, seeds the prefill, and dispatches AddActivity", async () => {
    const dayId = "77777777-7777-4777-8777-777777777777";
    const fixture = tripDetailFixture({
      days: [{ dayId, activityIds: [], date: null, costSubtotal: 0 }],
    });
    const onCommand = vi.fn<(command: TripCommand) => void>();
    server.use(...makeTripHandlers(fixture, { onCommand }));

    function OpenCreateButton() {
      const { openCreate } = useEditor();
      return <button onClick={() => openCreate({ dayId })}>trigger create</button>;
    }

    render(
      <TripProvider tripId={fixture.tripId}>
        <FocusProvider>
          <EditorHost>
            <LensRouter>
              <TripBoardScreen tripId={fixture.tripId} />
              <OpenCreateButton />
            </LensRouter>
          </EditorHost>
        </FocusProvider>
      </TripProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "trigger create" }));

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "New activity" })).toBeTruthy();

    const titleInput = screen.getByLabelText("Activity title") as HTMLInputElement;
    expect(titleInput.value).toBe("");

    fireEvent.change(titleInput, { target: { value: "Vatican tour" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "AddActivity",
          dayId,
          title: "Vatican tour",
        }),
      ),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  // M10 redesign-feedback follow-up: the standalone board-level "Ask AI to
  // plan" box (ComposePanel) is removed — the Assistant rail's own Ask box
  // covers the same real feature now, and having both on screen at once was
  // exactly the "which one is real" confusion this removal fixes.
  it("does not render the standalone board-level AI compose box", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    renderScreen(fixture.tripId);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    expect(screen.queryByLabelText(/ask ai to plan/i)).toBeNull();
  });

  it("the Assistant rail's Ask box submits a real composeAiPlan call and reconciles the board", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    composeAiPlanMock.mockResolvedValue({
      ok: true,
      value: {
        detail: tripDetailFixture({
          tripId: fixture.tripId,
          days: [{ dayId: "new-day", activityIds: [], date: null, costSubtotal: 0 }],
        }),
        history: historyFixture(fixture.tripId),
        message: "Added a day.",
        simulated: false,
      },
    });
    renderScreen(fixture.tripId);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    expect(screen.queryAllByTestId("day-column")).toHaveLength(0);

    fireEvent.change(screen.getByPlaceholderText(/ask about this day/i), { target: { value: "Add a day" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect(composeAiPlanMock).toHaveBeenCalledWith(fixture.tripId, "Add a day", "board");
    await waitFor(() => expect(screen.getAllByTestId("day-column")).toHaveLength(1));
  });

  it("clears a stale Simulated badge when a follow-up ask fails", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    composeAiPlanMock.mockResolvedValueOnce({
      ok: true,
      value: {
        detail: tripDetailFixture({ tripId: fixture.tripId }),
        history: historyFixture(fixture.tripId),
        message: "Did a thing.",
        simulated: true,
      },
    });
    renderScreen(fixture.tripId);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText(/ask about this day/i), { target: { value: "First ask" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(screen.getByText("Simulated")).not.toBeNull());

    // A second ask that fails must not leave the previous answer's Simulated
    // badge on screen next to the new error — that would misattribute a
    // request that never produced a new answer at all.
    composeAiPlanMock.mockResolvedValueOnce({
      ok: false,
      error: { status: 500, message: "The model is unavailable right now." },
    });
    fireEvent.change(screen.getByPlaceholderText(/ask about this day/i), { target: { value: "Second ask" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("The model is unavailable right now."));
    expect(screen.queryByText("Simulated")).toBeNull();
  });

  it("the Assistant rail can be hidden and shown again, reclaiming the reserved layout width", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    renderScreen(fixture.tripId);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Assistant" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByRole("complementary", { name: "Assistant" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    expect(screen.getByRole("complementary", { name: "Assistant" })).toBeTruthy();
  });
});

describe("map view hides the day-chips row", () => {
  it("hides the day-chips row in map view", async () => {
    setViewportMatches({ "(min-width: 1180px)": true });
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    renderScreen(fixture.tripId);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Days" })).toBeTruthy();

    await userEvent.click(await screen.findByRole("tab", { name: "Map" }));

    expect(screen.queryByRole("group", { name: "Days" })).toBeNull();

    await userEvent.click(screen.getByRole("tab", { name: "Day columns" }));
    expect(screen.getByRole("group", { name: "Days" })).toBeTruthy();
  });
});

describe("assistant rail visibility", () => {
  it("starts hidden below the 1180px overlay breakpoint", async () => {
    setViewportMatches({ "(min-width: 1180px)": false });
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    renderScreen(fixture.tripId);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Assistant" })).toBeNull();
    expect(screen.getByRole("button", { name: /assistant/i })).toBeTruthy();
  });

  it("starts shown at or above the breakpoint", async () => {
    setViewportMatches({ "(min-width: 1180px)": true });
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    renderScreen(fixture.tripId);

    await waitFor(() => expect(screen.getByRole("complementary", { name: "Assistant" })).toBeTruthy());
  });

  it("keeps the rail hidden after the user hides it, even at a wide viewport", async () => {
    setViewportMatches({ "(min-width: 1180px)": true });
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    renderScreen(fixture.tripId);

    await waitFor(() => expect(screen.getByRole("complementary", { name: "Assistant" })).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "Hide" }));

    expect(screen.queryByRole("complementary", { name: "Assistant" })).toBeNull();
  });
});
