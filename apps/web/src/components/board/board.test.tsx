import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

// A conflict kind the overlap warning does not cover, so its subjects still
// earn the generic triangle. Same shape the domain emits
// (packages/domain/src/trip/conflicts.ts geographyRule).
function geographyConflict() {
  return {
    id: `impossible-geography:${DAY}:${A1}:${A2}`,
    kind: "impossible-geography",
    severity: "warn" as const,
    subjects: [A1, A2],
    description: '"Colosseum" (Rome) and "Vatican Museums" (Tokyo) are ~9800 km apart on the same day.',
    resolutions: ["Move one activity to another day", "Fix a mistyped coordinate"],
  };
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

  // The bare triangle still covers every conflict kind the board has nothing
  // richer for (geography, anchors, budget) — both subjects of this pair get
  // one, and the banner lists the conflicts either way.
  it("marks conflict subjects with badges and shows the banner", () => {
    const trip = fixture();
    renderBoard({ ...trip, conflicts: [...trip.conflicts, geographyConflict()] }, noopCallbacks());
    expect(screen.getAllByRole("img", { name: "conflict" })).toHaveLength(2);
    expect(screen.getByText(/km apart on the same day/)).toBeTruthy();
    expect(screen.getByText(/overlap in time on the same day/)).toBeTruthy();
  });

  // M10 Phase 5: ...but a time-overlap on its own gets the compact chip
  // instead, never a triangle *and* a chip saying the same thing about the
  // same pair (mirrors TimelineLens.test.tsx's "does not also badge the pair").
  it("leaves a time-overlap to the compact chip rather than also badging it", () => {
    renderBoard(fixture(), noopCallbacks());
    expect(screen.queryAllByRole("img", { name: "conflict" })).toHaveLength(0);
    expect(screen.getByTestId(`overlap-chip-${A2}`)).toBeTruthy();
    expect(screen.getByText(/overlap in time on the same day/)).toBeTruthy();
  });

  // M10 Phase 5: the day columns' compact form of the timeline's overlap
  // warning — on the later stop only (A2 starts 10:00, A1 09:00), naming the
  // other one, with a dismiss that goes through the same per-pair
  // DismissConflict the banner uses.
  it("shows the compact overlap chip on the later stop only, and dismisses the pair", () => {
    const callbacks = noopCallbacks();
    renderBoard(fixture(), callbacks);

    const chip = screen.getByTestId(`overlap-chip-${A2}`);
    expect(within(chip).getByText("Overlaps Colosseum")).toBeTruthy();
    expect(screen.queryByTestId(`overlap-chip-${A1}`)).toBeNull();

    fireEvent.click(within(chip).getByRole("button", { name: "Dismiss overlap warning" }));
    expect(callbacks.onDismissConflict).toHaveBeenCalledWith(`time-overlap:${DAY}:${A1}:${A2}`);
  });

  it("hides the compact overlap chip once the pair is dismissed", () => {
    const trip = fixture();
    renderBoard({ ...trip, dismissedConflictIds: [trip.conflicts[0]!.id] }, noopCallbacks());
    expect(screen.queryByTestId(`overlap-chip-${A2}`)).toBeNull();
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

  // Phase 6 replaced the loose "+ Add day" button that used to trail the row
  // with the "One more day?" column; the real action inside it is the same
  // onAddDay callback.
  it("add-day and remove-day buttons invoke callbacks", () => {
    const callbacks = noopCallbacks();
    renderBoard(fixture(), callbacks);
    fireEvent.click(screen.getByRole("button", { name: "Add a day" }));
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
  // (rounded-2xl), tinted per-day via dayAccents — same city derivation as
  // Tasks 8/10's chipModel, so the day column agrees with its Timeline
  // header/chip color. This fixture's activities carry no location, so the
  // day's city is null and dayAccents (Task 8.2, KI-18) resolves it to the
  // explicit "neutral" family — moss, not a spent semantic bucket.
  it("a day column is 268px wide, rounded-2xl, and tinted by dayAccents", () => {
    renderBoard(fixture(), noopCallbacks());
    const day = screen.getAllByTestId("day-column")[0]!;
    expect(day.className).toContain("rounded-2xl");
    expect(day.className).toContain("bg-moss");
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

  // ---------------------------------------------------------------------
  // Phase 6: the trailing "One more day?" column, and the day column's
  // rack hint.
  // ---------------------------------------------------------------------

  // The loose "+ Add day" button is gone entirely — the phase file deletes it
  // rather than keeping both affordances.
  it("replaces the loose + Add day button with the One more day? column", () => {
    renderBoard(fixture(), noopCallbacks());
    expect(screen.queryByRole("button", { name: "+ Add day" })).toBeNull();
    expect(screen.getByTestId("one-more-day-column")).toBeTruthy();
    expect(screen.getByText("One more day?")).toBeTruthy();
  });

  // Design values from the phase file: 15px/600 --color-ink title in a dashed
  // column matching the day columns' own 268px width.
  it("shapes the trailing column like a day column, dashed, with a 15px/600 title", () => {
    renderBoard(fixture(), noopCallbacks());
    const column = screen.getByTestId("one-more-day-column");
    expect(column.style.width).toBe("268px");
    expect(screen.getAllByTestId("day-column")[0]!.style.width).toBe("268px");
    expect(column.className).toContain("border-dashed");

    const title = screen.getByText("One more day?");
    expect(title.style.fontSize).toBe("15px");
    expect(title.className).toContain("font-semibold");
    expect(title.className).toContain("text-ink");
  });

  // The same two actions EndOfTrip carries: a real "Add a day", and an inert
  // "Add a saved day" inside the existing insert-playbook Preview region.
  it("carries a real Add a day and an inert Add a saved day", async () => {
    const callbacks = noopCallbacks();
    renderBoard(fixture(), callbacks);
    const column = screen.getByTestId("one-more-day-column");

    await userEvent.click(within(column).getByRole("button", { name: "Add a day" }));
    expect(callbacks.onAddDay).toHaveBeenCalledOnce();

    const region = column.querySelector('[data-preview-id="insert-playbook"]');
    expect(region).not.toBeNull();
    expect(within(region as HTMLElement).getByRole("button", { name: "Add a saved day" })).toBeTruthy();
    // The Preview shield swallows the click, so the saved-day half cannot fire.
    await expect(
      userEvent.click(screen.getByRole("button", { name: "Add a saved day" })),
    ).rejects.toThrow();
  });

  // Playwright's getByRole name match is substring by default, so an e2e spec
  // asking for "Add a day" would otherwise also match "Add a saved day". The
  // two are distinguishable by exact name; this pins that they stay so.
  it("has exactly one button named Add a day, distinct from Add a saved day", () => {
    renderBoard(fixture(), noopCallbacks());
    expect(screen.getAllByRole("button", { name: "Add a day" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Add a saved day" })).toHaveLength(1);
  });

  // A trip with no days at all: the row is nothing but the trailing column,
  // which is the only way back to a non-empty trip, so it has to be there.
  it("still offers the trailing column on a trip with no days", () => {
    renderBoard(tripDetailFixture({ days: [], activities: {} }), noopCallbacks());
    expect(screen.queryAllByTestId("day-column")).toHaveLength(0);
    expect(screen.getByTestId("one-more-day-column")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add a day" })).toBeTruthy();
  });

  // The copy table lists no Board-specific empty-day string, so an empty day
  // column's honest treatment is exactly this: the dashed "+ Add" it already
  // renders — nothing invented.
  it("gives an empty day column a dashed + Add affordance", () => {
    const emptyDay = tripDetailFixture({
      days: [{ dayId: DAY, activityIds: [], date: null, costSubtotal: 0 }],
      activities: {},
    });
    renderBoard(emptyDay, noopCallbacks());
    const column = screen.getAllByTestId("day-column")[0]!;
    const addButton = within(column).getByRole("button", { name: "Add activity to Day 1" });
    expect(addButton.textContent).toContain("+ Add");
    expect(addButton.className).toContain("border-dashed");
  });

  it("gives every day of an all-empty trip its own + Add", () => {
    const d2 = "44444444-4444-4444-8444-444444444444";
    const d3 = "55555555-5555-4555-8555-555555555555";
    renderBoard(
      tripDetailFixture({
        days: [DAY, d2, d3].map((dayId) => ({ dayId, activityIds: [], date: null, costSubtotal: 0 })),
        activities: {},
      }),
      noopCallbacks(),
    );
    expect(screen.getAllByTestId("day-column")).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: /^Add activity to/ })).toHaveLength(3);
    expect(screen.getByTestId("one-more-day-column")).toBeTruthy();
  });

  it("renders a day column holding many stops without dropping any", () => {
    const ids = Array.from({ length: 9 }, (_, i) => `66666666-6666-4666-8666-${String(i).padStart(12, "0")}`);
    renderBoard(
      tripDetailFixture({
        days: [{ dayId: DAY, activityIds: ids, date: null, costSubtotal: 0 }],
        activities: Object.fromEntries(
          ids.map((id, i) => [
            id,
            { activityId: id, title: `Stop ${i + 1}`, timeWindow: null, location: null, notes: null, anchors: [], cost: null },
          ]),
        ),
      }),
      noopCallbacks(),
    );
    const column = screen.getAllByTestId("day-column")[0]!;
    expect(column.querySelectorAll('[data-testid^="activity-card-"]')).toHaveLength(9);
    expect(within(column).getByText("Stop 1")).toBeTruthy();
    expect(within(column).getByText("Stop 9")).toBeTruthy();
    // The add affordance stays below the ninth card.
    expect(within(column).getByRole("button", { name: "Add activity to Day 1" })).toBeTruthy();
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
