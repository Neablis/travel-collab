import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Board, type BoardCallbacks } from "@/components/board/Board";
import { EditorHost, useEditor } from "@/components/trip/context/EditorHost";
import { tripDetailFixture } from "@/mocks/fixtures";

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
  it("renders backlog and day columns with activity cards", () => {
    renderBoard(fixture(), noopCallbacks());
    expect(screen.getByTestId("backlog-column")).toBeTruthy();
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

  // Board no longer owns an inline create form (E2, ADR-011 R2): "+ Add
  // activity" and each column's foot "+" now raise the portable editor via
  // useEditor().openCreate(prefill), with the prefill sourced at the
  // trigger's own position — no dayId for the board-level button, the
  // column's own dayId for a per-column "+". The sheet itself (seeding,
  // save, dispatch) is covered by ActivityEditorSheet's own tests in
  // TripBoardScreen.test.tsx; this only asserts the trigger wiring.
  it("+ Add activity opens the editor with no dayId prefill", () => {
    const { getEditorState } = renderBoard(fixture(), noopCallbacks());
    fireEvent.click(screen.getByRole("button", { name: "+ Add activity" }));
    expect(getEditorState()).toEqual({ mode: "create", prefill: undefined });
  });

  it("a column's foot + opens the editor prefilled with that column's dayId", () => {
    const { getEditorState } = renderBoard(fixture(), noopCallbacks());
    fireEvent.click(screen.getByRole("button", { name: "Add activity to Day 1" }));
    expect(getEditorState()).toEqual({ mode: "create", prefill: { dayId: DAY } });
  });

  it("switching which activity is being edited resets the form, not the previous activity's stale fields", () => {
    renderBoard(fixture(), noopCallbacks());
    fireEvent.click(screen.getByRole("button", { name: "Edit Colosseum" }));
    expect((screen.getByLabelText("Activity title") as HTMLInputElement).value).toBe("Colosseum");

    // Click Edit on a different activity without cancelling or saving first —
    // the form must show Vatican Museums' fields, not Colosseum's leftover
    // state (a missing `key` on ActivityEditor previously left it stale).
    fireEvent.click(screen.getByRole("button", { name: "Edit Vatican Museums" }));
    expect((screen.getByLabelText("Activity title") as HTMLInputElement).value).toBe("Vatican Museums");
  });
});
