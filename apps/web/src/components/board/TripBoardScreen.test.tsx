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
    expect(await screen.findByText("Ancient Rome")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Revert to here" }));
    await waitFor(() =>
      expect(onCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: "RevertToState", toSeq: 2 }),
      ),
    );
    await waitFor(() => expect(screen.queryByText(/Viewing version/)).toBeNull());
  });

  it("switches between Board, Map and Schedule (Timeline + Calendar) lenses", async () => {
    // Task L1: Schedule is now a real ScheduleLens with a Timeline/Calendar
    // SegmentedControl toggle — only one inner view renders at a time
    // (previously, pre-L1, both were rendered stacked as an interim measure).
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    renderScreen(fixture.tripId);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    expect(screen.getByTestId("backlog-column")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Map" }));
    expect(await screen.findByText(/No located activities yet/)).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Schedule" }));
    expect(await screen.findByText("No days yet.")).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "Calendar" }));
    expect(await screen.findByText("Set a start date to see the calendar.")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Board" }));
    expect(await screen.findByTestId("backlog-column")).toBeTruthy();
  });

  it("posts a SetTripDates command from the Calendar lens's TripDateControl", async () => {
    const fixture = tripDetailFixture();
    const onCommand = vi.fn<(command: TripCommand) => void>();
    server.use(...makeTripHandlers(fixture, { onCommand }));
    renderScreen(fixture.tripId);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Schedule" }));
    fireEvent.click(screen.getByRole("radio", { name: "Calendar" }));
    await screen.findByText("Set a start date to see the calendar.");

    // P2 surface move: TripDateControl re-homed into SettingsSheet (#15) —
    // open it via the header's gear button first.
    fireEvent.click(screen.getByRole("button", { name: "Trip settings" }));

    // M3 debt paydown: only the single canonical TripDateControl renders, not
    // a duplicate (the old inline StartDateControl + CalendarLens's own copy).
    expect(await screen.findAllByLabelText("Start date")).toHaveLength(1);

    const dateInput = screen.getAllByLabelText("Start date")[0]!;
    fireEvent.change(dateInput, { target: { value: "2027-06-01" } });
    // A14: TripDateControl is now a date-RANGE control (start + end), so
    // committing a value requires the explicit "Set dates" button rather
    // than dispatching on every keystroke — the button click also lets the
    // control decide whether the range needs a shrink-confirm first.
    fireEvent.click(screen.getByRole("button", { name: /set dates/i }));

    await waitFor(() =>
      expect(onCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: "SetTripDates", startDate: "2027-06-01", endDate: null }),
      ),
    );
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
        if (command.type === "SetTripStartDate") detail = resolved;
        return HttpResponse.json({
          ok: true,
          tripId: detail.tripId,
          detail,
          history: { tripId: detail.tripId, entries: [], canUndo: false, canRedo: false },
        });
      }),
      http.get("/api/trips/:tripId/history", () =>
        HttpResponse.json({ history: { tripId: withConflict.tripId, entries: [], canUndo: false, canRedo: false } }),
      ),
    );

    renderScreen(withConflict.tripId);

    expect(await screen.findByText("Weekday Market")).toBeTruthy();
    expect(screen.getByRole("img", { name: "conflict" })).toBeTruthy();

    // P2 surface move: TripDateControl re-homed into SettingsSheet (#15).
    fireEvent.click(screen.getByRole("button", { name: "Trip settings" }));
    const dateInput = (await screen.findAllByLabelText("Start date"))[0]!;
    fireEvent.change(dateInput, { target: { value: "2027-06-08" } });

    await waitFor(() => expect(screen.queryByRole("img", { name: "conflict" })).toBeNull());
  });

  it("switches to the Itinerary, Daily, and Trip lenses", async () => {
    const fixture = costedTripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    renderScreen(fixture.tripId);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Itinerary" }));
    expect(await screen.findByTestId("itinerary-lens")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Daily" }));
    expect(await screen.findByTestId("daily-overview-lens")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Trip" }));
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
    await userEvent.type(await screen.findByLabelText(/cost|budget/i), "500");
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
    fireEvent.click(screen.getByRole("tab", { name: "Itinerary" }));
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
});
