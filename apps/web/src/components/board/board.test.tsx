import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Board, type BoardCallbacks } from "@/components/board/Board";
import { EditorHost, useEditor } from "@/components/trip/context/EditorHost";
import { tripDetailFixture } from "@tc/factories";

const A1 = "11111111-1111-4111-8111-111111111111";
const A2 = "22222222-2222-4222-8222-222222222222";
const A3 = "44444444-4444-4444-8444-444444444444";
const DAY = "33333333-3333-4333-8333-333333333333";

function fixture() {
  return tripDetailFixture({
    days: [{ dayId: DAY, activityIds: [A1, A2], date: null, costSubtotal: 0 }],
    activities: {
      [A1]: { activityId: A1, title: "Colosseum", timeWindow: { start: "09:00", end: "11:00" }, location: null, notes: null, anchors: [], kind: "planned" as const, tags: [], cost: null },
      [A2]: { activityId: A2, title: "Vatican Museums", timeWindow: { start: "10:00", end: "12:00" }, location: null, notes: null, anchors: [], kind: "planned" as const, tags: [], cost: null },
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

// KI-29: three mutually overlapping stops. The domain emits one
// `time-overlap` conflict per crossing pair, so this day carries three, and
// two of them name the latest stop (A3) as their later half. A column card
// has room for exactly one chip, so one pair gets no chip anywhere.
function threeWayOverlapFixture() {
  const conflict = (x: string, y: string, xTitle: string, yTitle: string) => ({
    id: `time-overlap:${DAY}:${x}:${y}`,
    kind: "time-overlap" as const,
    severity: "warn" as const,
    subjects: [x, y],
    description: `"${xTitle}" and "${yTitle}" overlap in time on the same day.`,
    resolutions: ["Change one activity's time window"],
  });
  return tripDetailFixture({
    days: [{ dayId: DAY, activityIds: [A1, A2, A3], date: null, costSubtotal: 0 }],
    activities: {
      [A1]: { activityId: A1, title: "Colosseum", timeWindow: { start: "09:00", end: "12:00" }, location: null, notes: null, anchors: [], kind: "planned" as const, tags: [], cost: null },
      [A2]: { activityId: A2, title: "Vatican Museums", timeWindow: { start: "10:00", end: "13:00" }, location: null, notes: null, anchors: [], kind: "planned" as const, tags: [], cost: null },
      [A3]: { activityId: A3, title: "Trastevere walk", timeWindow: { start: "11:00", end: "14:00" }, location: null, notes: null, anchors: [], kind: "planned" as const, tags: [], cost: null },
    },
    conflicts: [
      conflict(A1, A2, "Colosseum", "Vatican Museums"),
      conflict(A1, A3, "Colosseum", "Trastevere walk"),
      conflict(A2, A3, "Vatican Museums", "Trastevere walk"),
    ],
  });
}

// Board now raises the portable editor via useEditor().openCreate rather than
// rendering an inline create form itself (E2, ADR-011 R2) — every render
// needs an EditorHost ancestor, and tests that assert on the trigger observe
// EditorHost's state through this small consumer (same pattern as E1's
// TripBoardScreen.test.tsx OpenCreateButton / context.test.tsx Consumer).
function renderBoard(
  trip: ReturnType<typeof fixture>,
  callbacks: BoardCallbacks,
  focusedDay: number | null = null,
  readOnly = false,
) {
  let editorState: ReturnType<typeof useEditor>["state"] | undefined;
  function StateSpy() {
    editorState = useEditor().state;
    return null;
  }
  const utils = render(
    <EditorHost>
      <StateSpy />
      <Board trip={trip} callbacks={callbacks} focusedDay={focusedDay} readOnly={readOnly} />
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
    onSelectDay: vi.fn(),
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

  // KI-29: the one chip a card has room for cannot name both of the latest
  // stop's overlaps, so the dropped pair used to have no day-column surface at
  // all. The cheapest signal — the generic triangle the card already has —
  // stays on for exactly the overlaps no chip renders.
  it("still signals an overlap that no chip could render, with the generic triangle", () => {
    renderBoard(threeWayOverlapFixture(), noopCallbacks());

    // Each of the two later stops carries the one chip it has room for...
    expect(screen.getByTestId(`overlap-chip-${A2}`)).toBeTruthy();
    expect(screen.getByTestId(`overlap-chip-${A3}`)).toBeTruthy();

    // ...and the third pair (A2/A3), which no chip renders, is signalled on
    // both of its subjects rather than vanishing from the columns.
    const badged = (id: string) =>
      within(screen.getByTestId(`activity-card-${id}`)).queryAllByRole("img", { name: "conflict" });
    expect(badged(A2)).toHaveLength(1);
    expect(badged(A3)).toHaveLength(1);
    // The stop whose every overlap IS chipped keeps its clean card.
    expect(badged(A1)).toHaveLength(0);
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
    // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    const dayRow = screen.getAllByTestId("day-column")[0]!.parentElement;
    expect(dayRow?.className).toContain("overflow-x-auto");
    expect(dayRow?.className).not.toContain("flex-wrap");
    expect(screen.queryByLabelText("Jump to day")).toBeNull();
  });

  it("a day column's drop area fills the card with a minimum height", () => {
    renderBoard(fixture(), noopCallbacks());
    const day = screen.getAllByTestId("day-column")[0]!;
    // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
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
    // eslint-disable-next-line no-restricted-syntax -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(day.className).toContain("rounded-2xl");
    // eslint-disable-next-line no-restricted-syntax -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(day.className).toContain("bg-moss");
    expect((day as HTMLElement).style.width).toBe("268px");
  });

  // Task 3.3: the Phase 3 design keeps only the insertion line and the
  // floating time chip as drag feedback, so a day column no longer tints
  // itself while a card hovers over it.
  it("a day column's drop area carries no hover highlight", () => {
    renderBoard(fixture(), noopCallbacks());
    // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
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
    // eslint-disable-next-line no-restricted-syntax -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(addButton.className).toContain("border-dashed");
  });

  // Handoff README §"Day columns view": compact cards (12px padding).
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
  // Trimmed 2026-08-30: the title's `15px`/`font-semibold`/`text-ink` are pure
  // type tokens that break on any restyle and assert no behaviour. What is
  // load-bearing here is that the trailing column is the *same width* as a real
  // day column — a mismatch is a visible layout break — and that it stays
  // dashed, which is what marks it a placeholder rather than a real day.
  it("sizes the trailing column to match a day column, and keeps it dashed", () => {
    renderBoard(fixture(), noopCallbacks());
    const column = screen.getByTestId("one-more-day-column");
    expect(column.style.width).toBe(screen.getAllByTestId("day-column")[0]!.style.width);
    expect(column.style.width).toBe("268px");
    // eslint-disable-next-line no-restricted-syntax -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(column.className).toContain("border-dashed");
    expect(screen.getByText("One more day?")).toBeDefined();
  });

  // M11b deleted the inert `<Preview id="insert-playbook">` copy of "Add a
  // saved day" that used to live in this column. The real control reads
  // `useTrip()` and this component is rendered here with no provider, so what
  // replaced it is a link into the public library — and this test is what keeps
  // the shell from coming back.
  it("carries a real Add a day and a link into the library, and no Preview shell", async () => {
    const callbacks = noopCallbacks();
    renderBoard(fixture(), callbacks);
    const column = screen.getByTestId("one-more-day-column");

    await userEvent.click(within(column).getByRole("button", { name: "Add a day" }));
    expect(callbacks.onAddDay).toHaveBeenCalledOnce();

    // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(column.querySelector("[data-preview-id]")).toBeNull();
    expect(
      within(column).getByRole("link", { name: "Take a day from the library" }).getAttribute("href"),
    ).toBe("/playbooks");
  });

  // Playwright's getByRole name match is substring by default, so an e2e spec
  // asking for "Add a day" would otherwise also match a longer name. Kept after
  // M11b removed this column's "Add a saved day": the exactness claim is about
  // the day button, and the second control it could be confused with changed
  // rather than went away.
  it("has exactly one button named Add a day", () => {
    renderBoard(fixture(), noopCallbacks());
    expect(screen.getAllByRole("button", { name: "Add a day" })).toHaveLength(1);
    expect(screen.queryAllByRole("button", { name: /saved day/i })).toHaveLength(0);
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
    // eslint-disable-next-line no-restricted-syntax -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
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
            { activityId: id, title: `Stop ${i + 1}`, timeWindow: null, location: null, notes: null, anchors: [], kind: "planned" as const, tags: [], cost: null },
          ]),
        ),
      }),
      noopCallbacks(),
    );
    const column = screen.getAllByTestId("day-column")[0]!;
    // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(column.querySelectorAll('[data-testid^="activity-card-"]')).toHaveLength(9);
    expect(within(column).getByText("Stop 1")).toBeTruthy();
    expect(within(column).getByText("Stop 9")).toBeTruthy();
    // The add affordance stays below the ninth card.
    expect(within(column).getByRole("button", { name: "Add activity to Day 1" })).toBeTruthy();
  });

  // Task 4.1 (M10 Phase 4): the board's per-stop cost, using the trip's own
  // currency (threaded Board -> Column -> ActivityCard) through formatMoney
  // (KI-2) — same convention every other money surface uses (#46: EUR
  // renders as its "€" symbol).
  it("shows a card's cost through formatMoney, using the trip's own currency", () => {
    const trip = fixture();
    trip.currency = "EUR";
    trip.activities[A1]!.cost = { amountMinor: 4200, currency: "EUR" };
    renderBoard(trip, noopCallbacks());
    const card = screen.getByTestId(`activity-card-${A1}`);
    expect(within(card).getByText("€42.00")).toBeTruthy();
  });

  it("says so honestly when a card's activity has no cost", () => {
    renderBoard(fixture(), noopCallbacks()); // fixture()'s activities both have cost: null
    const card = screen.getByTestId(`activity-card-${A1}`);
    expect(within(card).getByText("No cost yet")).toBeTruthy();
  });
});

// Mitchell, preview feedback on PR #55: "You should also be able to select the
// day here, and it syncs to the day card above." Before this the day-chips row
// was the only way to focus a day.
describe("selecting a day from its column", () => {
  // The shared fixture has one day; selection is only interesting across two.
  function twoDays() {
    return tripDetailFixture({
      days: [
        { dayId: DAY, activityIds: [], date: null, costSubtotal: 0 },
        { dayId: "9f1c2b7e-5d3a-4c8b-9e2f-7a6d4b1c8e35", activityIds: [], date: null, costSubtotal: 0 },
      ],
      activities: {},
    });
  }
  const headerOf = (column: HTMLElement) => within(column).getByRole("button", { name: /^Day \d/ });

  it("selects by index, the same state the chips above drive", async () => {
    const callbacks = noopCallbacks();
    renderBoard(twoDays(), callbacks);

    await userEvent.click(headerOf(screen.getAllByTestId("day-column")[1]!));

    expect(callbacks.onSelectDay).toHaveBeenCalledWith(1);
  });

  // The chips gained a toggle-off in M16 Wave 2 because `focusedDay` is now
  // the assistant's scope; the column header follows them rather than becoming
  // a second selection idiom on the same state (Column.tsx's header comment).
  it("clears the focus when the already-focused column header is clicked again", async () => {
    const callbacks = noopCallbacks();
    renderBoard(twoDays(), callbacks, 1);

    await userEvent.click(headerOf(screen.getAllByTestId("day-column")[1]!));

    expect(callbacks.onSelectDay).toHaveBeenCalledWith(null);
  });

  it("rings the focused column and marks it pressed, so the two agree", () => {
    renderBoard(twoDays(), noopCallbacks(), 1);
    const columns = screen.getAllByTestId("day-column");

    // eslint-disable-next-line no-restricted-syntax -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(columns[1]!.className).toContain("ring-brand");
    // eslint-disable-next-line no-restricted-syntax -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(columns[0]!.className).not.toContain("ring-brand");
    expect(headerOf(columns[1]!).getAttribute("aria-pressed")).toBe("true");
    expect(headerOf(columns[0]!).getAttribute("aria-pressed")).toBe("false");
  });

  // CodeRabbit, reviewing this branch: the handler used to return before
  // `preventDefault()` whenever the index did not move, which is both boundaries
  // — ArrowLeft on day 1 and ArrowRight on the last day. The browser then
  // scrolled the columns row natively instead, and the scroll spy replaced day 1
  // with whatever landed on the reading line. So the arrow undid the selection
  // it was supposed to be holding still.
  //
  // `fireEvent` rather than `userEvent` because the assertion IS the event
  // object: `defaultPrevented` is what the browser reads, and userEvent hands
  // back nothing to inspect.
  it("claims the arrow key at both ends, where it changes nothing", () => {
    const callbacks = noopCallbacks();
    renderBoard(twoDays(), callbacks, 0);
    const row = screen.getByRole("group", { name: "Day columns" });

    const atStart = fireEvent.keyDown(row, { key: "ArrowLeft" });
    // fireEvent returns false when the event was defaultPrevented.
    expect(atStart).toBe(false);
    expect(callbacks.onSelectDay).not.toHaveBeenCalled();

    cleanup();
    renderBoard(twoDays(), callbacks, 1);
    expect(fireEvent.keyDown(screen.getByRole("group", { name: "Day columns" }), { key: "ArrowRight" })).toBe(false);
    expect(callbacks.onSelectDay).not.toHaveBeenCalled();
  });

  it("leaves an arrow it does not handle to the browser", () => {
    // The negative half: without it the test above passes against a handler
    // that preventDefaults every keystroke it sees.
    renderBoard(twoDays(), noopCallbacks(), 0);
    const row = screen.getByRole("group", { name: "Day columns" });
    expect(fireEvent.keyDown(row, { key: "ArrowDown" })).toBe(true);
    expect(fireEvent.keyDown(row, { key: "ArrowRight", altKey: true })).toBe(true);
  });

  it("selects the next day when the arrow actually moves", async () => {
    const callbacks = noopCallbacks();
    renderBoard(twoDays(), callbacks, 0);
    await userEvent.click(screen.getByRole("group", { name: "Day columns" }));
    await userEvent.keyboard("{ArrowRight}");
    expect(callbacks.onSelectDay).toHaveBeenCalledWith(1);
  });
});

// A viewer's board, and the public demo's (ADR-031). The rule is one line —
// show the plan, offer nothing that changes it — and the reason it is tested
// per control is that each one is dropped at a different level: the card's own
// buttons in ActivityCard, the day's two in Column (via props Board withholds),
// the trailing column and the banner's actions in Board itself. A control added
// at any of those levels without a `readOnly` clause reaches a reader.
describe("a read-only board", () => {
  it("shows every stop, and no control that would change one", () => {
    renderBoard(fixture(), noopCallbacks(), null, true);

    // The plan is all still here.
    expect(screen.getByText("Colosseum")).toBeTruthy();
    expect(screen.getByText("Vatican Museums")).toBeTruthy();
    // …and so is the conflict, which is the product noticing something.
    expect(screen.getByText(/overlap in time on the same day/)).toBeTruthy();

    for (const name of [
      /^Edit Colosseum$/,
      /^Remove Colosseum$/,
      /^Remove Day 1$/,
      /^Add activity to Day 1$/,
      /^Dismiss:/,
      /^Dismiss overlap warning$/,
    ]) {
      expect(screen.queryAllByRole("button", { name })).toHaveLength(0);
    }
    expect(screen.queryByTestId("one-more-day-column")).toBeNull();
  });

  it("does not make its cards draggable, so nothing can move and snap back", () => {
    renderBoard(fixture(), noopCallbacks(), null, true);
    const card = screen.getByTestId(`activity-card-${A1}`);
    // pragmatic-drag-and-drop marks what it has registered; an unregistered
    // card carries neither the attribute nor the grab cursor.
    expect(card.getAttribute("draggable")).not.toBe("true");
    // eslint-disable-next-line no-restricted-syntax -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(card.className).not.toContain("cursor-grab");
  });

  it("still offers all of it when it is not read-only", () => {
    // The negative half: without this the block above passes just as well
    // against a board that renders no controls at all.
    renderBoard(fixture(), noopCallbacks());
    expect(screen.getByRole("button", { name: "Edit Colosseum" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove Colosseum" })).toBeTruthy();
    expect(screen.getByTestId("one-more-day-column")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Dismiss:/ }).length).toBeGreaterThan(0);
  });
});
