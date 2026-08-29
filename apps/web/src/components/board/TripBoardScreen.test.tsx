import { useSyncExternalStore, type ComponentProps } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { TripCommand, type TripDetail } from "@tc/contracts";
import { TripBoardScreen } from "@/components/board/TripBoardScreen";
import { TripProvider } from "@/components/trip/context/TripProvider";
import { EditorHost, useEditor } from "@/components/trip/context/EditorHost";
import { FocusProvider } from "@/components/trip/context/FocusProvider";
import { LensRouter } from "@/components/trip/context/LensRouter";
import { costedTripDetailFixture, historyFixture, tripDetailFixture } from "@tc/factories";
import { makeTripHandlers } from "@/mocks/handlers";
import { setViewportMatches, triggerResize } from "../../../vitest.setup";

// The Assistant rail holds a real streaming conversation against
// /api/trips/:id/ask (M16 Wave 2). Mocked at the client seam rather than with
// an MSW handler this file otherwise has no use for — an SSE handler would
// only re-test apiClient.test.ts's own parser, and what this file is for is
// the thread, the scope and the refusals.
type AskArgs = Parameters<typeof import("@/lib/apiClient").askAssistant>;
const askAssistantMock = vi.fn();
vi.mock("@/lib/apiClient", async (orig) => {
  const actual = await orig<typeof import("@/lib/apiClient")>();
  return {
    ...actual,
    askAssistant: (...args: unknown[]) => askAssistantMock(...args),
  };
});

/** An answer that streams `text` in one delta, after one tool call. */
function answers(text: string, toolName = "read_trip", input: unknown = {}) {
  return async (...args: AskArgs) => {
    const onEvent = args[3]!;
    onEvent({ type: "tool", toolCallId: "t1", toolName, input });
    onEvent({ type: "text", delta: text });
    return { ok: true as const, value: { text } };
  };
}

/** The scope of the nth (0-based) ask, and the thread it carried. */
function askCall(n: number) {
  const [, messages, scope] = askAssistantMock.mock.calls[n] as AskArgs;
  return { messages, scope };
}

// The Map lens's own viewer gate — no double-click-to-create — is
// MapLens.test.tsx's subject. What only this file can state is that the screen
// hands it the same `readOnly` the Board and Schedule lenses get: without this
// spy, deleting that one prop at the call site breaks nothing anywhere.
// A pass-through rather than a stub, so the Map-lens tests below (tab
// switching, `.full-bleed`, the day-chips row) still render the real lens.
const mapLensProps = vi.fn();
vi.mock("@/components/lenses/MapLens", async (orig) => {
  const actual = await orig<typeof import("@/components/lenses/MapLens")>();
  return {
    MapLens: (props: ComponentProps<typeof actual.MapLens>) => {
      mapLensProps(props);
      return <actual.MapLens {...props} />;
    },
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

// Navigates by `?lens=` the same way a real URL change would: mutate the
// mocked search and notify the listeners `replaceSpy` itself notifies above.
// Used where a test needs a specific lens without going through the tab strip
// (whose own selection logic is TripViewTabs.test.tsx's subject).
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
  askAssistantMock.mockReset();
  mapLensProps.mockClear();
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
    fireEvent.click(screen.getByRole("button", { name: "Add a day" }));
    await waitFor(() => expect(screen.getAllByTestId("day-column")).toHaveLength(1));
  });

  it("shows an error state for a missing trip", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    renderScreen("00000000-0000-4000-8000-000000000000");
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  // I3 (final review): this used to render a bare `<Heading>Caesura</Heading>`
  // plus a link to Auth.js's default `/api/auth/signin` — exactly the
  // bare-front-door pattern M15 exists to eliminate, and it dropped
  // `callbackUrl` (Auth.js's default page honoured it; our own /signin screen
  // does too — see AuthScreen.test.tsx — but this one hardcoded it away).
  // Signed-out now routes through our own /signin, carrying the trip as the
  // callback target so signing in returns here instead of the trip list.
  it("prompts a signed-out visitor to sign in at our own /signin, carrying the trip as the callback target", async () => {
    const fixture = tripDetailFixture();
    server.use(
      http.get("/api/trips/:tripId", () => HttpResponse.json({ error: "unauthenticated" }, { status: 401 })),
      http.get("/api/trips/:tripId/history", () => HttpResponse.json({ error: "unauthenticated" }, { status: 401 })),
    );
    renderScreen(fixture.tripId);

    expect(await screen.findByRole("heading", { name: "Sign in to see this trip" })).toBeTruthy();
    const link = screen.getByRole("link", { name: "Sign in" });
    expect(link.getAttribute("href")).toBe(`/signin?callbackUrl=${encodeURIComponent(`/trips/${fixture.tripId}`)}`);
  });

  it("history panel previews a past version read-only, and reverts to it", async () => {
    const ancientId = "55555555-5555-4555-8555-555555555555";
    const fixture = tripDetailFixture();
    const history = historyFixture(fixture.tripId);
    const pastFixture = tripDetailFixture({
      backlog: [ancientId],
      activities: {
        [ancientId]: { activityId: ancientId, title: "Ancient Rome", timeWindow: null, location: null, notes: null, anchors: [], kind: "planned" as const, tags: [], cost: null },
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
    // peer tab again, not behind a "More" menu; the Itinerary/Daily/Trip
    // lenses that menu used to carry are retired (KI-20).
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    renderScreen(fixture.tripId);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    // Board's own trailing "One more day?" column stands in for "the Board
    // lens is showing": Task 3.3 deleted the backlog column this used to look
    // for, and this fixture has no days, so there is no `day-column` to look
    // for either. (Phase 6 replaced the loose "+ Add day" button this used to
    // key off with that column.)
    expect(screen.getByTestId("one-more-day-column")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Map" }));
    expect(await screen.findByText(/No located activities yet/)).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Timeline" }));
    expect(await screen.findByText("No days yet.")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Calendar" }));
    expect(await screen.findByText("Set a start date to see the calendar.")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Day columns" }));
    expect(await screen.findByTestId("one-more-day-column")).toBeTruthy();
  });

  it("opens TripDateControl from the clickable Dates row in Trip settings (restored, M10 Phase 4)", async () => {
    // Task 4.2's redesign shipped the sheet's Dates row read-only, leaving
    // TripDateControl (the only way to actually change a trip's dates) with
    // no mount point anywhere in the app — an unintentional capability loss
    // (product-owner ruling, 2026-08-22; see docs/known-issues.md's former
    // D-2 entry). This test confirms the real integration once restored:
    // opening Trip settings and clicking the Dates row opens a Popover
    // containing TripDateControl, pre-filled with the trip's real dates.
    // TripDateControl's own dispatch logic (SetTripStartDate, clearing)
    // stays covered directly in TripDateControl.test.tsx; the sheet's
    // onCommand pass-through is covered in SettingsSheet.test.tsx.
    const fixture = tripDetailFixture({ startDate: "2027-06-01" });
    server.use(...makeTripHandlers(fixture));
    renderScreen(fixture.tripId);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /trip settings/i }));

    const datesRow = await screen.findByRole("button", { name: "Dates" });
    expect(screen.queryByLabelText("Trip start date")).toBeNull();

    fireEvent.click(datesRow);

    const startInput = (await screen.findByLabelText("Trip start date")) as HTMLInputElement;
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
          kind: "planned" as const,
          tags: [],
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

    // Undo moved inside the History popover (PR #55 preview feedback), so it
    // has to be opened first — it is no longer a bare header button.
    fireEvent.click(await screen.findByRole("button", { name: /history/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));

    await waitFor(() => expect(screen.queryByRole("img", { name: "conflict" })).toBeNull());
  });

  // KI-20: Itinerary/Daily/Trip are retired, not merely nav-less. An old
  // bookmarked `?lens=Itinerary` must not throw or render a blank screen — it
  // falls back to the default Board lens (LensRouter.tsx).
  it("falls back to the Board lens for a retired ?lens= value", async () => {
    const fixture = costedTripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    renderScreen(fixture.tripId);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();

    navigateToLens("Itinerary");

    // Board's trailing "One more day?" column stands in for "the Board lens is
    // showing", same as the lens-switching test above.
    expect(await screen.findByTestId("one-more-day-column")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Day columns" }).getAttribute("aria-selected")).toBe("true");
  });

  it("posts a SetTripBudget command from TripMoneySettings", async () => {
    const fixture = tripDetailFixture();
    const onCommand = vi.fn<(command: TripCommand) => void>();
    server.use(...makeTripHandlers(fixture, { onCommand }));
    renderScreen(fixture.tripId);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    // P2 surface move: TripMoneySettings re-homed into SettingsSheet (comment 12b) —
    // open it via the header's gear button first.
    fireEvent.click(screen.getByRole("button", { name: /trip settings/i }));
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
  // Edit-mode is reachable through a real UI trigger today: the Schedule
  // lens's Timeline view renders a per-activity "Edit" button wired to
  // onSelectActivity -> useEditor().openEdit (see TripBoardScreen.tsx). This
  // drove the same seam through ItineraryLens until KI-20 retired it.
  it("opens the activity editor from the Schedule lens, edits, and dispatches UpdateActivity", async () => {
    const fixture = costedTripDetailFixture();
    const colosseumId = "2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e";
    const onCommand = vi.fn<(command: TripCommand) => void>();
    server.use(...makeTripHandlers(fixture, { onCommand }));
    renderScreen(fixture.tripId);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    navigateToLens("Schedule");

    // TimelineLens's per-activity "Edit" button raises openEdit.
    fireEvent.click(await screen.findByTestId(`timeline-edit-${colosseumId}`));

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Edit activity" })).toBeTruthy();

    // Seeded from the existing activity's data.
    const titleInput = screen.getByLabelText("What or where") as HTMLInputElement;
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
    expect(await screen.findByRole("heading", { name: "Add a stop" })).toBeTruthy();

    const titleInput = screen.getByLabelText("What or where") as HTMLInputElement;
    expect(titleInput.value).toBe("");

    fireEvent.change(titleInput, { target: { value: "Vatican tour" } });
    // Create mode's submit is "Add stop" (Phase 7), same label as
    // TripHeader's own trigger that's still rendered behind the open dialog
    // — `.at(-1)` picks the sheet's own footer button (portalled last in the
    // DOM), same disambiguation the Phase 7 e2e specs needed.
    fireEvent.click(screen.getAllByRole("button", { name: "Add stop" }).at(-1)!);

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

  it("the Ask box holds a real conversation: the question, the tool call and the streamed answer all land in the transcript", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    askAssistantMock.mockImplementation(answers("Rome 2027 runs to 0 days.", "read_trip", {}));
    renderScreen(fixture.tripId);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();

    // The rail is closed until asked for now, so open it before reaching for
    // anything inside it.
    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    fireEvent.change(screen.getByPlaceholderText(/ask about this day/i), { target: { value: "How is it looking?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    const log = await screen.findByRole("log", { name: "Conversation" });
    await waitFor(() => expect(log.textContent).toContain("Rome 2027 runs to 0 days."));
    expect(log.textContent).toContain("How is it looking?");
    // Visible, and quiet — a sentence, not the tool's JSON output.
    expect(log.textContent).toContain("Read the trip");
    expect(log.textContent).not.toContain("{");
  });

  // Ruling R1: conversation state is client-held, so turn 2 is the same POST
  // with a longer array. Without this the follow-up "what about the next day?"
  // has nothing to refine and the assistant answers a question nobody asked.
  it("accumulates the thread across turns and posts the whole of it", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    askAssistantMock.mockImplementation(answers("Five stops."));
    renderScreen(fixture.tripId);
    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    const box = screen.getByPlaceholderText(/ask about this day/i);
    fireEvent.change(box, { target: { value: "What's planned?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Ask" })).toBeTruthy());

    askAssistantMock.mockImplementation(answers("Four stops."));
    fireEvent.change(box, { target: { value: "What about the next day?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(askAssistantMock).toHaveBeenCalledTimes(2));

    expect(askCall(0).messages.map((m) => [m.role, m.parts[0]!.text])).toEqual([["user", "What's planned?"]]);
    expect(askCall(1).messages.map((m) => [m.role, m.parts[0]!.text])).toEqual([
      ["user", "What's planned?"],
      ["assistant", "Five stops."],
      ["user", "What about the next day?"],
    ]);
    // Every message carries a distinct non-empty id: the endpoint requires one
    // and `validateUIMessages` is the thing that rejects a thread without.
    const ids = askCall(1).messages.map((m) => m.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids.every((id) => id.length > 0)).toBe(true);
  });

  it("New conversation empties the thread and takes the transcript with it", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    askAssistantMock.mockImplementation(answers("Five stops."));
    renderScreen(fixture.tripId);
    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    fireEvent.change(screen.getByPlaceholderText(/ask about this day/i), { target: { value: "What's planned?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(screen.getByText("Five stops.")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    expect(screen.queryByRole("log", { name: "Conversation" })).toBeNull();

    fireEvent.change(screen.getByPlaceholderText(/ask about this day/i), { target: { value: "Fresh start" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(askAssistantMock).toHaveBeenCalledTimes(2));
    expect(askCall(1).messages.map((m) => m.parts[0]!.text)).toEqual(["Fresh start"]);
  });

  // The scope the server is told and the scope the rail claims are the same
  // value. A rail that says "Looking at Day 2" while asking about the whole
  // trip is the bug this is written against.
  it("sends the focused day as the scope, 0-based, and says so in the same words", async () => {
    const fixture = tripDetailFixture({
      days: [
        { dayId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", activityIds: [], date: null, costSubtotal: 0 },
        { dayId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", activityIds: [], date: null, costSubtotal: 0 },
      ],
    });
    server.use(...makeTripHandlers(fixture));
    askAssistantMock.mockImplementation(answers("Nothing yet."));
    renderScreen(fixture.tripId);
    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    expect(screen.getByText("Looking at Rome 2027")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/ask about this day/i), { target: { value: "What's planned?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(askAssistantMock).toHaveBeenCalledTimes(1));
    expect(askCall(0).scope).toEqual({ kind: "trip" });

    fireEvent.click(screen.getByRole("button", { name: "Day 2" }));
    expect(screen.getByText("Looking at Day 2")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/ask about this day/i), { target: { value: "And here?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(askAssistantMock).toHaveBeenCalledTimes(2));
    expect(askCall(1).scope).toEqual({ kind: "day", dayIndex: 1 });
  });

  // Derived, not canned (Ruling R5). suggestedQuestions.ts owns the rules;
  // what only this file can state is that the rail is actually re-fed them
  // when the focus moves.
  it("re-derives the suggested questions when the focused day changes, and asking one starts the conversation", async () => {
    const fixture = tripDetailFixture({
      days: [
        { dayId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", activityIds: [], date: null, costSubtotal: 0 },
        { dayId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", activityIds: [], date: null, costSubtotal: 0 },
      ],
    });
    server.use(...makeTripHandlers(fixture));
    askAssistantMock.mockImplementation(answers("Nothing yet."));
    renderScreen(fixture.tripId);
    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    const suggestions = () =>
      within(screen.getByRole("list", { name: "Suggested questions" }))
        .getAllByRole("button")
        .map((b) => b.textContent);
    expect(suggestions()).toContain("How is the trip looking?");

    fireEvent.click(screen.getByRole("button", { name: "Day 2" }));
    expect(suggestions()).toEqual(["Day 2 is empty — what could I do with it?"]);

    fireEvent.click(screen.getByRole("button", { name: "Day 2 is empty — what could I do with it?" }));
    await waitFor(() => expect(askAssistantMock).toHaveBeenCalledTimes(1));
    expect(askCall(0).messages[0]!.parts[0]!.text).toBe("Day 2 is empty — what could I do with it?");
  });

  it("clears a stale Simulated badge when a follow-up ask fails", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    askAssistantMock.mockImplementationOnce(
      answers("Rome 2027 runs to 0 days. AI is switched off on this deployment, so I answered from your trip data rather than from a model."),
    );
    renderScreen(fixture.tripId);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    fireEvent.change(screen.getByPlaceholderText(/ask about this day/i), { target: { value: "First ask" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(screen.getByText("Simulated")).not.toBeNull());

    // A second ask that fails must not leave the previous answer's Simulated
    // badge on screen next to the new error — that would misattribute a
    // request that never produced a new answer at all.
    askAssistantMock.mockResolvedValueOnce({
      ok: false,
      error: { status: 503, message: "The model is unavailable right now." },
    });
    fireEvent.change(screen.getByPlaceholderText(/ask about this day/i), { target: { value: "Second ask" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("The model is unavailable right now."));
    expect(screen.queryByText("Simulated")).toBeNull();
  });

  // A turn that produced nothing did not happen. Leaving the question in the
  // thread would post it again on the next turn, and the model would answer a
  // question the user watched fail.
  it("rolls the question back out of the thread when the turn produced no answer at all", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    askAssistantMock.mockResolvedValueOnce({
      ok: false,
      error: { status: 400, message: "this trip has 2 days, so day 9 is out of range" },
    });
    renderScreen(fixture.tripId);
    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    fireEvent.change(screen.getByPlaceholderText(/ask about this day/i), { target: { value: "Day nine?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    // The 400's own words, verbatim: they are the actionable part.
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("this trip has 2 days, so day 9 is out of range"),
    );
    expect(screen.queryByRole("log", { name: "Conversation" })).toBeNull();

    askAssistantMock.mockImplementationOnce(answers("Two days."));
    fireEvent.change(screen.getByPlaceholderText(/ask about this day/i), { target: { value: "How many days?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(askAssistantMock).toHaveBeenCalledTimes(2));
    expect(askCall(1).messages.map((m) => m.parts[0]!.text)).toEqual(["How many days?"]);
  });

  // A half-written answer stays: the words are on screen and deleting them
  // under the user is the worse lie. The failure arrived INSIDE a 200 stream,
  // which is the channel a `res.ok` check cannot see.
  it("keeps a partial answer when the stream fails half way, and still says what went wrong", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    askAssistantMock.mockImplementationOnce(async (...args: AskArgs) => {
      args[3]!({ type: "text", delta: "Rome 2027 runs to " });
      args[3]!({ type: "error", message: "model call failed: upstream 500" });
      return { ok: false as const, error: { status: 200, message: "model call failed: upstream 500", code: "ask-stream-error" } };
    });
    renderScreen(fixture.tripId);
    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    fireEvent.change(screen.getByPlaceholderText(/ask about this day/i), { target: { value: "How is it looking?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("model call failed: upstream 500"),
    );
    expect(screen.getByRole("log", { name: "Conversation" }).textContent).toContain("Rome 2027 runs to ");
  });

  // Branching on the CODE, not the prose — the one 403 a legitimate signed-in
  // user can provoke (KI-79).
  it("says the assistant is unavailable on the demo trip, from the code rather than the message", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    askAssistantMock.mockResolvedValueOnce({
      ok: false,
      error: { status: 403, message: "some other wording entirely", code: "demo-trip-unsupported" },
    });
    renderScreen(fixture.tripId);
    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    fireEvent.change(screen.getByPlaceholderText(/ask about this day/i), { target: { value: "Anything" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("The assistant isn't available on the demo trip."),
    );
  });

  it("the Assistant rail can be hidden and shown again, reclaiming the reserved layout width", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    renderScreen(fixture.tripId);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    // The rail is closed until asked for now, so open it before reaching for
    // anything inside it.
    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    expect(screen.getByRole("complementary", { name: "Assistant" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByRole("complementary", { name: "Assistant" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    expect(screen.getByRole("complementary", { name: "Assistant" })).toBeTruthy();
  });

  // Phase 9's gate walk found this in a real browser: the launcher's `bottom`
  // was stuck at the bare 24px at every width, so it sat over the unscheduled
  // rack it is measured to clear — 15px of it with the rack collapsed, 212px
  // with it open. The cause was not the arithmetic but the measurement never
  // happening: the rack's wrapper mounts *below* the `status === "loading"`
  // early return, so an effect keyed on `[lens]` ran once against a null ref
  // and registered no ResizeObserver, then never re-ran.
  //
  // This asserts the observer exists rather than the number: `triggerResize`
  // (vitest.setup.ts) is a no-op when nothing is observed, which is exactly
  // the broken state, and it hands the component no geometry — the component
  // reads the height installed below itself, the way a real one does.
  it("the assistant launcher clears the unscheduled rack it is measured against", async () => {
    setViewportMatches({ "(min-width: 1180px)": false });
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    renderScreen(fixture.tripId);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    const launcher = screen.getByRole("button", { name: "Assistant" });
    // Nothing has been measured yet, so the launcher sits at its bare offset.
    expect(launcher.style.bottom).toBe("24px");

    const rack = screen.getByTestId("unscheduled-rack");
    vi.spyOn(rack, "getBoundingClientRect").mockReturnValue({ height: 56 } as DOMRect);
    triggerResize();

    await waitFor(() => expect(launcher.style.bottom).toBe("80px"));
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

// Preview review fix: lens content gets a bottom margin against the page via
// `.trip-board-content`'s `padding-bottom` (globals.css), except on the Map
// lens, which is deliberately full-bleed (Task 2.3's "mapwrap") — exempted
// via the `.full-bleed` modifier class. jsdom doesn't apply real CSS, so this
// asserts the class toggle that drives the exemption, not the rendered pixels.
describe("lens bottom-margin exemption for the full-bleed Map lens", () => {
  it("carries .full-bleed only while the Map lens is active", async () => {
    setViewportMatches({ "(min-width: 1180px)": true });
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    const { container } = renderScreen(fixture.tripId);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    const content = container.querySelector(".trip-board-content");
    expect(content?.classList.contains("full-bleed")).toBe(false);

    await userEvent.click(screen.getByRole("tab", { name: "Map" }));
    expect(content?.classList.contains("full-bleed")).toBe(true);

    await userEvent.click(screen.getByRole("tab", { name: "Day columns" }));
    expect(content?.classList.contains("full-bleed")).toBe(false);
  });
});

// The rail is now closed until asked for, at EVERY width (Mitchell, walking
// the #71 preview). These used to assert the old per-width default — one for
// each side of the 1180px breakpoint, plus a third proving a user's "hide"
// survived the media query re-opening it. There is no automatic opening left
// to override, so what is worth pinning now is that width does not decide
// this and the launcher is always the way in.
describe("assistant rail visibility", () => {
  for (const [label, wide] of [["below", false], ["at or above", true]] as const) {
    it(`starts hidden ${label} the 1180px breakpoint, with the launcher offering it`, async () => {
      setViewportMatches({ "(min-width: 1180px)": wide });
      const fixture = tripDetailFixture();
      server.use(...makeTripHandlers(fixture));
      renderScreen(fixture.tripId);

      expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
      expect(screen.queryByRole("complementary", { name: "Assistant" })).toBeNull();
      expect(screen.getByRole("button", { name: /assistant/i })).toBeTruthy();
    });
  }

  // Both directions, so "hidden" is known to be a real default rather than a
  // rail that never opens at all.
  it("opens on the launcher and closes again on Hide, at a wide viewport", async () => {
    setViewportMatches({ "(min-width: 1180px)": true });
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    renderScreen(fixture.tripId);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /assistant/i }));
    await waitFor(() => expect(screen.getByRole("complementary", { name: "Assistant" })).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByRole("complementary", { name: "Assistant" })).toBeNull();
  });
});

// docs/reviews/2026-08-28-project-review.md §1.4. The AI batch is decided
// server-side against state that does not include anything still queued here,
// and `applyOutcome` clears `pending` to take its result — so drag a card and
// immediately ask, and the queued-but-unsent edit was discarded from the UI
// and the server both, with nothing said. History commands have guarded
// exactly this since M6 (`if (pending) return`); this path had no equivalent.
describe("assistant ask — unsent work blocks the ask", () => {
  it("refuses the ask, says why, and sends nothing while an edit is still unsent", async () => {
    const fixture = tripDetailFixture();
    server.use(
      // Never settles: the head stays in flight, so `pending` stays true for
      // the whole test rather than for the handful of microseconds a resolved
      // handler would give us. FIRST in the list on purpose — within one
      // `server.use` call MSW takes the earliest matching handler, so putting
      // this after the spread would silently lose to makeTripHandlers' own
      // commands handler and the ask would run with an empty queue.
      http.post("/api/trips/:tripId/commands", () => new Promise<never>(() => {})),
      ...makeTripHandlers(fixture),
    );
    renderScreen(fixture.tripId);
    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();

    // Queue an edit that will never be confirmed.
    fireEvent.click(screen.getByRole("button", { name: "Add a day" }));
    await waitFor(() => expect(screen.getAllByTestId("day-column")).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    fireEvent.change(screen.getByPlaceholderText(/ask about this day/i), {
      target: { value: "Plan my afternoon" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "Finish saving your changes before asking the assistant.",
      ),
    );
    expect(askAssistantMock).not.toHaveBeenCalled();
    // The optimistic day is still on the board — the whole point of refusing.
    expect(screen.getAllByTestId("day-column")).toHaveLength(1);
  });
});

// docs/reviews/2026-08-28-m11-pr71-review.md §5: TripHeader was thoroughly
// viewer-gated and this screen never read `readOnly` at all, so everything
// below the header stayed live for a viewer. The end-to-end statement — one
// real `myRole: "viewer"` access read, one real board — that the individual
// component tests (board.test.tsx, UnscheduledRack.test.tsx,
// ActivityEditorSheet.test.tsx) each make about their own surface.
//
// The server refuses each of these commands independently (accessPolicy.ts);
// this is defence in depth and a legible read-only board, never the boundary.
describe("TripBoardScreen — a viewer's board", () => {
  it("says View only and offers no way to change the trip", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture, { myRole: "viewer" }));
    renderScreen(fixture.tripId);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    expect(screen.getByText("View only")).toBeTruthy();

    expect(screen.queryByTestId("one-more-day-column")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add a day" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Add activity to / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove Day / })).toBeNull();
    // The rack's day-assign select is the drawer's non-drag write path.
    fireEvent.click(screen.getByRole("button", { name: /unscheduled/i }));
    expect(screen.queryAllByRole("combobox", { name: "Add to day" })).toHaveLength(0);
  });

  it("offers all of them to an owner", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    renderScreen(fixture.tripId);

    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    expect(screen.queryByText("View only")).toBeNull();
    expect(screen.getByTestId("one-more-day-column")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add a day" })).toBeTruthy();
  });

  // /ask itself admits a viewer and writes nothing, so this refusal is a
  // product call about who the assistant is offered to rather than a guard
  // against a batch the server would refuse (which is what it was on the
  // command path). Kept, with its copy, and reported through the rail's own
  // error surface — a control that silently does nothing is the failure mode
  // TripProvider's runDispatch comment was written about.
  it("refuses the assistant ask and says why", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture, { myRole: "viewer" }));
    renderScreen(fixture.tripId);
    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    fireEvent.change(screen.getByPlaceholderText(/ask about this day/i), {
      target: { value: "Plan my afternoon" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("You have view-only access to this trip."),
    );
    expect(askAssistantMock).not.toHaveBeenCalled();
  });
});

// CodeRabbit, PR #78: M11 link 3's commit claimed the trip surface but gated
// only the Board lens, so a viewer switching to Timeline got a per-day "Add
// stop", the dashed add row, and the overlap warning's own fix and dismiss —
// the last two dispatching UpdateActivity and DismissConflict through
// ScheduleLens's `onCommand` seam. The end-to-end statement, with one real
// `myRole: "viewer"` access read, that TimelineLens.test.tsx and
// OverlapWarning.test.tsx each make about their own surface.
//
// What a viewer must STILL get is asserted first, and deliberately: the
// schedule, its days, its stops and its overlap warnings are information about
// the trip. This withholds controls, never information.
describe("TripBoardScreen — a viewer's Schedule lens", () => {
  // The plan's worked overlap example, so the warning and both of its controls
  // are on screen for an editor and can be asserted absent for a viewer. Real
  // uuids, unlike the lens's own unit fixtures: these go over MSW, and
  // makeTripHandlers validates the payload against the TripDetail contract.
  const DAY = "11111111-1111-4111-8111-111111111111";
  const EARLIER = "22222222-2222-4222-8222-222222222222";
  const LATER = "33333333-3333-4333-8333-333333333333";

  function overlappingFixture() {
    return tripDetailFixture({
      startDate: "2027-06-01",
      days: [{ dayId: DAY, activityIds: [EARLIER, LATER], date: "2027-06-01", costSubtotal: 0 }],
      activities: {
        [EARLIER]: { activityId: EARLIER, title: "Nezu Museum", timeWindow: { start: "10:30", end: "13:00" }, location: null, notes: null, anchors: [], kind: "planned" as const, tags: [], cost: null },
        [LATER]: { activityId: LATER, title: "Lunch at Kagari", timeWindow: { start: "12:30", end: "14:00" }, location: null, notes: null, anchors: [], kind: "planned" as const, tags: [], cost: null },
      },
      conflicts: [
        {
          id: `time-overlap:${DAY}:${EARLIER}:${LATER}`,
          kind: "time-overlap",
          severity: "warn",
          subjects: [EARLIER, LATER],
          description: '"Nezu Museum" and "Lunch at Kagari" overlap in time on the same day.',
          resolutions: ["Change one activity's time window"],
        },
      ],
    });
  }

  it("shows the schedule and its overlap warning, and offers no way to change either", async () => {
    const fixture = overlappingFixture();
    server.use(...makeTripHandlers(fixture, { myRole: "viewer" }));
    renderScreen(fixture.tripId);
    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    navigateToLens("Schedule");

    const day = await screen.findByTestId(`timeline-row-${DAY}`);
    expect(within(day).getByText("Nezu Museum")).toBeTruthy();
    expect(within(day).getByText("Lunch at Kagari")).toBeTruthy();
    expect(within(day).getByTestId(`overlap-warning-${LATER}`)).toBeTruthy();
    expect(within(day).getByText("1 overlap")).toBeTruthy();

    expect(within(day).queryByTestId(`timeline-add-${DAY}`)).toBeNull();
    expect(within(day).queryByTestId(`timeline-add-row-${DAY}`)).toBeNull();
    expect(within(day).queryByRole("button", { name: /^Start / })).toBeNull();
    expect(within(day).queryByRole("button", { name: "Dismiss" })).toBeNull();
    // EndOfTrip gates itself off the same context read; asserted here because
    // it is the timeline's fourth command-raising affordance (AddDay).
    expect(screen.queryByTestId("end-of-trip")).toBeNull();
  });

  it("offers every one of them to an owner", async () => {
    const fixture = overlappingFixture();
    server.use(...makeTripHandlers(fixture));
    renderScreen(fixture.tripId);
    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    navigateToLens("Schedule");

    const day = await screen.findByTestId(`timeline-row-${DAY}`);
    expect(within(day).getByTestId(`timeline-add-${DAY}`)).toBeTruthy();
    expect(within(day).getByTestId(`timeline-add-row-${DAY}`)).toBeTruthy();
    expect(within(day).getByRole("button", { name: "Start 1 pm" })).toBeTruthy();
    expect(within(day).getByRole("button", { name: "Dismiss" })).toBeTruthy();
    expect(screen.getByTestId("end-of-trip")).toBeTruthy();
  });
});

// The Map lens's gate is one prop wide, and it is the prop — not the lens —
// that this file can lose without any other test noticing.
describe("TripBoardScreen — a viewer's Map lens", () => {
  it("hands the Map lens the same readOnly the Board and Schedule lenses get", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture, { myRole: "viewer" }));
    renderScreen(fixture.tripId);
    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    navigateToLens("Map");

    await waitFor(() =>
      expect(mapLensProps).toHaveBeenCalledWith(expect.objectContaining({ readOnly: true })),
    );
    expect(mapLensProps).not.toHaveBeenCalledWith(expect.objectContaining({ readOnly: false }));
  });

  it("leaves it false for an owner, so double-click-to-create stays", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    renderScreen(fixture.tripId);
    expect(await screen.findByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    navigateToLens("Map");

    await waitFor(() => expect(mapLensProps).toHaveBeenCalled());
    expect(mapLensProps).not.toHaveBeenCalledWith(expect.objectContaining({ readOnly: true }));
  });
});
