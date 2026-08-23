import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Board, type BoardCallbacks } from "@/components/board/Board";
import { EditorHost, useEditor } from "@/components/trip/context/EditorHost";
import { tripDetailFixture } from "@tc/factories";

const A1 = "11111111-1111-4111-8111-111111111111";
const A2 = "22222222-2222-4222-8222-222222222222";
const DAY = "33333333-3333-4333-8333-333333333333";

function fixture() {
  return tripDetailFixture({
    days: [{ dayId: DAY, activityIds: [A1, A2], date: null, costSubtotal: 0 }],
    activities: {
      [A1]: { activityId: A1, title: "Colosseum", timeWindow: { start: "09:00", end: "11:00" }, location: null, notes: null, anchors: [], cost: null },
      [A2]: { activityId: A2, title: "Vatican Museums", timeWindow: { start: "10:00", end: "12:00" }, location: null, notes: null, anchors: [], cost: null },
    },
    conflicts: [
      {
        id: `time-overlap:${DAY}:${A1}:${A2}`,
        kind: "time-overlap",
        severity: "warn",
        subjects: [A1, A2],
        description: '"Colosseum" and "Vatican Museums" overlap in time on the same day.',
        resolutions: ["Change one activity's time window", "Move one activity to another day or the backlog"],
      },
    ],
  });
}

// Board now raises the portable editor via useEditor().openCreate rather than
// rendering an inline create form itself (E2, ADR-011 R2) — every render
// needs an EditorHost ancestor, and tests that assert on the trigger observe
// EditorHost's state through this small consumer (same pattern as E1's
// TripBoardScreen.test.tsx OpenCreateButton / context.test.tsx Consumer).
function renderBoard(trip: ReturnType<typeof fixture>, callbacks: BoardCallbacks) {
  let editorState: ReturnType<typeof useEditor>["state"] | undefined;
  function StateSpy() {
    editorState = useEditor().state;
    return null;
  }
  const utils = render(
    <EditorHost>
      <StateSpy />
      <Board trip={trip} callbacks={callbacks} />
    </EditorHost>,
  );
  return { ...utils, getEditorState: () => editorState };
}

function noopCallbacks(): BoardCallbacks {
  return {
    onMove: vi.fn(),
    onUnschedule: vi.fn(),
    onDragStart: vi.fn(),
    onDragEnd: vi.fn(),
    onAddDay: vi.fn(),
    onRemoveDay: vi.fn(),
    onAddActivity: vi.fn(),
    onUpdateActivity: vi.fn(),
    onRemoveActivity: vi.fn(),
    onDismissConflict: vi.fn(),
  };
}

afterEach(cleanup);

describe("Board", () => {
  // Task 3.3: the board is day columns only — the full-width Backlog column
  // is gone, replaced by the Unscheduled drawer (UnscheduledRack), which
  // TripBoardScreen mounts outside the lens switch and covers with its own
  // tests.
  it("renders day columns with activity cards, and no backlog column", () => {
    renderBoard(fixture(), noopCallbacks());
    expect(screen.queryByTestId("backlog-column")).toBeNull();
    expect(screen.getAllByTestId("day-column")).toHaveLength(1);
    expect(screen.getByText("Colosseum")).toBeTruthy();
    expect(screen.getByText("Vatican Museums")).toBeTruthy();
  });

  it("marks conflict subjects with badges and shows the banner", () => {
    renderBoard(fixture(), noopCallbacks());
    expect(screen.getAllByRole("img", { name: "conflict" })).toHaveLength(2);
    expect(screen.getByText(/overlap in time on the same day/)).toBeTruthy();
  });

  it("dismissing a conflict calls onDismissConflict; dismissedConflictIds hides it from the banner", () => {
    const callbacks = noopCallbacks();
    const { rerender } = renderBoard(fixture(), callbacks);
    const conflictId = fixture().conflicts[0]!.id;
    fireEvent.click(screen.getByRole("button", { name: /^Dismiss:/ }));
    expect(callbacks.onDismissConflict).toHaveBeenCalledWith(conflictId);

    rerender(
      <EditorHost>
        <Board trip={{ ...fixture(), dismissedConflictIds: [conflictId] }} callbacks={callbacks} />
      </EditorHost>,
    );
    expect(screen.queryByText(/overlap in time on the same day/)).toBeNull();
  });

  it("add-day and remove-day buttons invoke callbacks", () => {
    const callbacks = noopCallbacks();
    renderBoard(fixture(), callbacks);
    fireEvent.click(screen.getByRole("button", { name: "+ Add day" }));
    expect(callbacks.onAddDay).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Remove Day 1" }));
    expect(callbacks.onRemoveDay).toHaveBeenCalledWith(DAY);
  });

  // Board no longer owns an inline create form (E2, ADR-011 R2): each
  // column's foot "+" raises the portable editor via
  // useEditor().openCreate(prefill), with the prefill sourced at the
  // trigger's own position. The board-level "no dayId" trigger is the
  // header's "Add stop" now (Task 3.3 deleted the Backlog column's "+ Add
  // activity" along with the column) — TripHeader.test.tsx covers it. The
  // sheet itself (seeding, save, dispatch) is covered by
  // ActivityEditorSheet's own tests in TripBoardScreen.test.tsx; this only
  // asserts the trigger wiring.
  it("a column's foot + opens the editor prefilled with that column's dayId", () => {
    const { getEditorState } = renderBoard(fixture(), noopCallbacks());
    fireEvent.click(screen.getByRole("button", { name: "Add activity to Day 1" }));
    expect(getEditorState()).toEqual({ mode: "create", prefill: { dayId: DAY } });
  });

  // #29: an activity card's Edit raises the SAME portable editor (openEdit) the
  // other lenses use, instead of Board's old inline bottom form — so editing is
  // consistent everywhere (right-side sheet). Board only owns the trigger wiring;
  // the sheet's seeding/save/dispatch and its `key`-based form reset are covered
  // by ActivityEditorSheet's tests in TripBoardScreen.test.tsx.
  it("Edit on a card opens the portable editor in edit mode with that activityId", () => {
    const { getEditorState } = renderBoard(fixture(), noopCallbacks());
    fireEvent.click(screen.getByRole("button", { name: "Edit Colosseum" }));
    expect(getEditorState()).toEqual({ mode: "edit", activityId: A1 });

    fireEvent.click(screen.getByRole("button", { name: "Edit Vatican Museums" }));
    expect(getEditorState()).toEqual({ mode: "edit", activityId: A2 });
  });

  // Handoff README §"Day columns view": day columns scroll horizontally in a
  // single row (268px each) instead of wrapping — no pager, no edge-shadow,
  // no stack/scroll breakpoint, just an overflow-x-auto row.
  it("day columns lay out in a horizontally scrolling row", () => {
    renderBoard(fixture(), noopCallbacks());
    const dayRow = screen.getAllByTestId("day-column")[0]!.parentElement;
    expect(dayRow?.className).toContain("overflow-x-auto");
    expect(dayRow?.className).not.toContain("flex-wrap");
    expect(screen.queryByLabelText("Jump to day")).toBeNull();
  });

  it("a day column's drop area fills the card with a minimum height", () => {
    renderBoard(fixture(), noopCallbacks());
    const day = screen.getAllByTestId("day-column")[0]!;
    const dropList = day.querySelector("ul");
    expect(dropList?.className).toContain("flex-1");
    expect(dropList?.className).toMatch(/min-h-/);
  });

  // Handoff README §"Day columns view": 268px columns, 16px radius
  // (rounded-2xl), tinted per-day via dayAccentFor — same city derivation as
  // Tasks 8/10's chipModel, so the day column agrees with its Timeline
  // header/chip color. This fixture's activities carry no location, so
  // dayAccentFor(null) resolves deterministically to the "info" family.
  it("a day column is 268px wide, rounded-2xl, and tinted by dayAccentFor", () => {
    renderBoard(fixture(), noopCallbacks());
    const day = screen.getAllByTestId("day-column")[0]!;
    expect(day.className).toContain("rounded-2xl");
    expect(day.className).toContain("bg-info-tint");
    expect((day as HTMLElement).style.width).toBe("268px");
  });

  // Task 3.3: the Phase 3 design keeps only the insertion line and the
  // floating time chip as drag feedback, so a day column no longer tints
  // itself while a card hovers over it.
  it("a day column's drop area carries no hover highlight", () => {
    renderBoard(fixture(), noopCallbacks());
    const dropList = screen.getAllByTestId("day-column")[0]!.querySelector("ul");
    expect(dropList?.className).not.toContain("bg-brand-tint");
  });

  // Handoff README §"Day columns view": "a dashed '+ Add' button per
  // column" — the dashed affordance is consistent regardless of whether the
  // day already has cards (this fixture's Day 1 has two), not collapsed to a
  // bare "+" once populated.
  it("a populated day column still shows the dashed + Add affordance", () => {
    renderBoard(fixture(), noopCallbacks());
    const addButton = screen.getByRole("button", { name: "Add activity to Day 1" });
    expect(addButton.textContent).toContain("+ Add");
    expect(addButton.className).toContain("border-dashed");
  });

  // Handoff README §"Day columns view": compact cards (12px padding).
  it("activity cards use 12px padding", () => {
    renderBoard(fixture(), noopCallbacks());
    const card = screen.getByTestId(`activity-card-${A1}`);
    expect(card.className).toContain("p-3");
  });

  // Task 4.1 (M10 Phase 4): the board's per-stop cost, using the trip's own
  // currency (threaded Board -> Column -> ActivityCard) through formatMoney
  // (KI-2) — same "N,NNN.NN CCC" convention every other money surface uses.
  it("shows a card's cost through formatMoney, using the trip's own currency", () => {
    const trip = fixture();
    trip.currency = "EUR";
    trip.activities[A1]!.cost = { amountMinor: 4200, currency: "EUR" };
    renderBoard(trip, noopCallbacks());
    const card = screen.getByTestId(`activity-card-${A1}`);
    expect(within(card).getByText("42.00 EUR")).toBeTruthy();
  });

  it("says so honestly when a card's activity has no cost", () => {
    renderBoard(fixture(), noopCallbacks()); // fixture()'s activities both have cost: null
    const card = screen.getByTestId(`activity-card-${A1}`);
    expect(within(card).getByText("No cost yet")).toBeTruthy();
  });
});
