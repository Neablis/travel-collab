import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorHost, useEditor } from "@/components/trip/context/EditorHost";
import { FocusProvider, useFocus } from "@/components/trip/context/FocusProvider";
import type { TripDetail } from "@tc/contracts";
import { tripDetailFixture } from "@tc/factories";
import { toMinutes, toTimeString } from "@/lib/time";
import { TimelineLens, nextSlot } from "./TimelineLens";
import type { TimelineRow } from "./timelineData";

afterEach(cleanup);

// jsdom doesn't implement Element.scrollIntoView; TimelineLens's
// focus-scroll effect (unchanged by Task 15) calls it whenever focusedDay
// changes. No prior test ever actually changed focusedDay while mounted, so
// this gap was latent — Task 15's focus-control tests are the first to
// trigger it. Stub it locally rather than touching the shared
// vitest.setup.ts for a jsdom limitation this file's tests are the first to
// hit.
Element.prototype.scrollIntoView ??= () => {};

function detailFixture() {
  return tripDetailFixture({
    days: [{ dayId: "d1", activityIds: ["timed1"], date: "2027-06-01", costSubtotal: 0 }],
    backlog: [],
    activities: {
      timed1: {
        activityId: "timed1",
        title: "Colosseum tour",
        timeWindow: { start: "09:00", end: "11:00" },
        location: { name: "Colosseum, Rome, Italy", lat: 41.8902, lng: 12.4922 },
        notes: null,
        anchors: [],
        cost: null,
      },
    },
  });
}

function renderLens(detail = detailFixture(), onSelectActivity = vi.fn()) {
  return render(
    <FocusProvider>
      <EditorHost>
        <TimelineLens detail={detail} onSelectActivity={onSelectActivity} />
      </EditorHost>
    </FocusProvider>,
  );
}

// Task 15: focusedDay lives in FocusProvider, one level above TimelineLens,
// with no control inside TimelineLens itself that sets it (DayChips owns
// that in the real app) — this small harness exposes a button that calls
// setFocusedDay directly, the same shape as FocusProvider.test.tsx's own
// Probe, so the ghost-card-appears-when-focused behavior can be exercised
// without pulling DayChips into this test.
function renderLensWithFocusControl(detail = detailFixture()) {
  function Harness() {
    const { setFocusedDay } = useFocus();
    return (
      <>
        <button onClick={() => setFocusedDay(0)}>focus day 0</button>
        <TimelineLens detail={detail} />
      </>
    );
  }
  return render(
    <FocusProvider>
      <EditorHost>
        <Harness />
      </EditorHost>
    </FocusProvider>,
  );
}

// M10 Phase 5: the plan's worked overlap example — Nezu Museum 10:30–13:00
// and Lunch at Kagari 12:30–14:00 on one day, with the single `time-overlap`
// conflict the domain emits for that pair. `dispatch` is the onCommand seam
// TripBoardScreen fills with the real dispatch; the returned mock is what the
// warning's fix and dismiss land in.
function renderTimelineWithOverlap(over: Partial<TripDetail> = {}) {
  const dispatch = vi.fn();
  const detail = tripDetailFixture({
    days: [{ dayId: "d1", activityIds: ["a", "b"], date: "2027-06-01", costSubtotal: 0 }],
    activities: {
      a: { activityId: "a", title: "Nezu Museum", timeWindow: { start: "10:30", end: "13:00" }, location: null, notes: null, anchors: [], cost: null },
      b: { activityId: "b", title: "Lunch at Kagari", timeWindow: { start: "12:30", end: "14:00" }, location: null, notes: null, anchors: [], cost: null },
    },
    conflicts: [
      {
        id: "time-overlap:d1:a:b",
        kind: "time-overlap",
        severity: "warn",
        subjects: ["a", "b"],
        description: '"Nezu Museum" and "Lunch at Kagari" overlap in time on the same day.',
        resolutions: ["Change one activity's time window"],
      },
    ],
    ...over,
  });
  render(
    <FocusProvider>
      <EditorHost>
        <TimelineLens detail={detail} onCommand={dispatch} />
      </EditorHost>
    </FocusProvider>,
  );
  return dispatch;
}

// M10 Phase 6 fixtures. `timed` is what nextSlot and the add-row copy key
// off, so these are all shaped around one day's last end time.
function timedActivity(id: string, title: string, start: string, end: string) {
  return { activityId: id, title, timeWindow: { start, end }, location: null, notes: null, anchors: [], cost: null };
}

function detailWithDayEndingAt(end: string, start = "20:00") {
  return tripDetailFixture({
    days: [{ dayId: "d1", activityIds: ["a1"], date: "2027-06-01", costSubtotal: 0 }],
    activities: { a1: timedActivity("a1", "Dinner at Kagari", start, end) },
  });
}

function detailWithEmptyDay() {
  return tripDetailFixture({
    days: [{ dayId: "d1", activityIds: [], date: "2027-06-01", costSubtotal: 0 }],
    activities: {},
  });
}

function detailWithTwoDays() {
  return tripDetailFixture({
    days: [
      { dayId: "d1", activityIds: ["a1"], date: "2027-06-01", costSubtotal: 0 },
      { dayId: "d2", activityIds: ["a2"], date: "2027-06-02", costSubtotal: 0 },
    ],
    activities: {
      a1: timedActivity("a1", "Colosseum tour", "09:00", "11:00"),
      a2: timedActivity("a2", "Roman Forum", "09:00", "10:00"),
    },
  });
}

// The prefilled timeWindow only exists inside EditorHost's state, so a probe
// beside the lens is the honest way to read what the add row actually asked
// for — same shape as this file's own focus-control harness.
function renderTimelineWithEditorProbe(detail: TripDetail) {
  function Probe() {
    const { state } = useEditor();
    return <span data-testid="editor-state">{JSON.stringify(state)}</span>;
  }
  render(
    <FocusProvider>
      <EditorHost>
        <TimelineLens detail={detail} />
        <Probe />
      </EditorHost>
    </FocusProvider>,
  );
}

function editorPrefill(): { dayId?: string; timeWindow?: { start: string; end: string } } {
  return JSON.parse(screen.getByTestId("editor-state").textContent ?? "{}").prefill ?? {};
}

// The one branch of nextSlot the DOM can only show indirectly. It is exported
// for the same reason overlapData.ts's model is a module of its own: the rule
// about what the day has room for is worth stating once, in one place, with
// its own test.
describe("nextSlot (KI-30)", () => {
  const rowWith = (timed: { start: string; end: string }[]): TimelineRow => ({
    dayId: "d1",
    date: "2027-06-01",
    ordinal: 1,
    timed: timed.map((w, i) => ({ activityId: `a${i}`, title: `Stop ${i}`, ...w })),
    untimed: [],
  });

  it("prefills 09:00–10:00 on a day with nothing timed on it", () => {
    expect(nextSlot(rowWith([]))).toEqual({ start: "09:00", end: "10:00" });
  });

  it("starts at the day's last end and takes an hour when there is one", () => {
    expect(nextSlot(rowWith([{ start: "09:00", end: "11:00" }]))).toEqual({ start: "11:00", end: "12:00" });
  });

  // The end of the day is found from the LATEST end, not the last element:
  // row.timed is sorted by start, so a long stop can begin before a short one
  // and still finish after it.
  it("measures from the latest end, not the last-starting stop", () => {
    expect(
      nextSlot(rowWith([{ start: "09:00", end: "18:00" }, { start: "10:00", end: "11:00" }])),
    ).toEqual({ start: "18:00", end: "19:00" });
  });

  it("offers the shorter remainder rather than a clamped window near midnight", () => {
    // NOT { start: "23:30", end: "23:59" } by accident of the clamp — 23:30 +
    // 60 would be 00:30 tomorrow, and the pre-fix code turned that into a
    // 23:59/23:59 window contracts' TimeWindow (start < end) rejects.
    expect(nextSlot(rowWith([{ start: "22:00", end: "23:30" }]))).toEqual({ start: "23:30", end: "23:59" });
  });

  it("returns null when the day already runs to the last minute it has", () => {
    expect(nextSlot(rowWith([{ start: "22:00", end: "23:59" }]))).toBeNull();
  });
});

// Phase 8 Task 8.1: a two-timed-stop day (Colosseum tour 09:00–10:00, then
// Roman Forum) whose second stop starts `gapMinutes` after the first ends —
// the fixture the leg-line copy tests below need, built with the same
// `tripDetailFixture` pattern the rest of this file already uses rather than
// a `detailWithGap` helper this file never had. Times are derived through
// toMinutes/toTimeString (not string arithmetic) so the fixture stays honest
// about what "gap" means to the component under test.
function detailWithGap(gapMinutes: number): TripDetail {
  const a1End = "10:00";
  const a2Start = toTimeString(toMinutes(a1End) + gapMinutes);
  const a2End = toTimeString(toMinutes(a2Start) + 60);
  return tripDetailFixture({
    days: [{ dayId: "d1", activityIds: ["a1", "a2"], date: "2027-06-01", costSubtotal: 0 }],
    activities: {
      a1: {
        activityId: "a1",
        title: "Colosseum tour",
        timeWindow: { start: "09:00", end: a1End },
        location: null,
        notes: null,
        anchors: [],
        cost: null,
      },
      a2: {
        activityId: "a2",
        title: "Roman Forum",
        timeWindow: { start: a2Start, end: a2End },
        location: null,
        notes: null,
        anchors: [],
        cost: null,
      },
    },
  });
}

// Both stops carry real coordinates and a real positive gap — the case the
// old "~X.X km direct" suffix used to fire on. The leg line no longer shows
// any distance at all, invented or otherwise.
const detailWithCoordinatesOnBothStops = tripDetailFixture({
  days: [{ dayId: "d1", activityIds: ["a1", "a2"], date: "2027-06-01", costSubtotal: 0 }],
  activities: {
    a1: {
      activityId: "a1",
      title: "Colosseum tour",
      timeWindow: { start: "09:00", end: "10:00" },
      location: { name: "Colosseum", lat: 41.8902, lng: 12.4922 },
      notes: null,
      anchors: [],
      cost: null,
    },
    a2: {
      activityId: "a2",
      title: "Roman Forum",
      timeWindow: { start: "11:00", end: "12:00" },
      location: { name: "Roman Forum", lat: 41.8925, lng: 12.4853 },
      notes: null,
      anchors: [],
      cost: null,
    },
  },
});

// Phase 8 Task 8.7: a day whose one stop has no location at all, so
// routeSummary() has nothing to name and returns null — the case the
// day-meta row's "· {route}" half must not render for, leaving no dangling
// separator after "N stops". dayId is "day-1" (not this file's usual "d1")
// specifically to match the day-meta-day-1 testid the test below looks up.
const detailWithUnlocatedStops = tripDetailFixture({
  days: [{ dayId: "day-1", activityIds: ["a1"], date: "2027-06-01", costSubtotal: 0 }],
  activities: {
    a1: timedActivity("a1", "Wander", "09:00", "10:00"),
  },
});

describe("TimelineLens", () => {
  it("renders a day header with the day ordinal, stop count, and derived city (#28)", () => {
    renderLens();
    expect(screen.getByText("Day 1")).not.toBeNull();
    // "Colosseum, Rome, Italy" legitimately appears twice: once in the day
    // header's derived-city pill/route summary, once in the activity row's
    // place line — scope to the header to assert the former specifically.
    const header = screen.getByTestId("timeline-dayhead-d1");
    expect(within(header).getAllByText(/Colosseum, Rome, Italy/).length).toBeGreaterThan(0);
    // Stop-meter: real elapsed duration of the one 09:00–11:00 activity.
    expect(screen.getByText("2 h out")).not.toBeNull();
  });

  it("renders the activity's real start/end time and title as a row (not a percentage-positioned block)", () => {
    renderLens();
    const row = screen.getByTestId("timeline-item-timed1");
    expect(within(row).getByText("09:00")).not.toBeNull();
    expect(within(row).getByText("11:00")).not.toBeNull();
    expect(within(row).getByText("Colosseum tour")).not.toBeNull();
  });

  it("still calls onSelectActivity (Edit) with the activity id, unchanged behavior", async () => {
    const onSelectActivity = vi.fn();
    renderLens(detailFixture(), onSelectActivity);
    await userEvent.click(screen.getByTestId("timeline-edit-timed1"));
    expect(onSelectActivity).toHaveBeenCalledWith("timed1");
  });

  it("wires the Add stop trigger to openCreate without throwing (unchanged EditorHost call shape)", async () => {
    renderLens();
    await expect(userEvent.click(screen.getByTestId("timeline-add-d1"))).resolves.not.toThrow();
  });

  it("renders the keep-day flag inert, inside the keep-day-flag Preview region", () => {
    renderLens();
    const region = document.querySelector('[data-preview-id="keep-day-flag"]');
    expect(region).not.toBeNull();
    expect(within(region as HTMLElement).getByRole("button", { name: "Keep day 1" })).not.toBeNull();
  });

  it("renders the ghost Ask affordance inert, inside the timeline-ghost Preview region", () => {
    renderLens();
    const region = document.querySelector('[data-preview-id="timeline-ghost"]');
    expect(region).not.toBeNull();
    expect(within(region as HTMLElement).getByRole("button", { name: "Ask" })).not.toBeNull();
  });

  it("renders no ghost-proposal card when no day is focused (#15)", () => {
    renderLensWithFocusControl();
    expect(screen.queryByTestId("ghost-proposal-g1")).toBeNull();
  });

  it("renders the sample ghost-proposal card in the focused day, inside the timeline-ghost Preview region (#15)", async () => {
    renderLensWithFocusControl();
    await userEvent.click(screen.getByRole("button", { name: "focus day 0" }));
    const card = screen.getByTestId("ghost-proposal-g1");
    const region = card.closest('[data-preview-id="timeline-ghost"]');
    expect(region).not.toBeNull();
    expect(within(card).getByText("Add teamLab Planets")).not.toBeNull();
    expect(within(card).getByRole("button", { name: "Keep" })).not.toBeNull();
    expect(within(card).getByRole("button", { name: "Discard" })).not.toBeNull();
  });

  // Phase 8 Task 8.1 (`phase-8-polish.md` Step 1, copied verbatim): the leg
  // line stops inventing a straight-line distance and a 30-minute "Long gap"
  // pill, and instead names the real free time until the next stop.
  it("shows the free time before the next stop", () => {
    renderLens(detailWithGap(75));
    expect(screen.getByText("1 h 15 m until next stop")).toBeTruthy();
  });

  it("says back to back when there is no gap", () => {
    renderLens(detailWithGap(0));
    expect(screen.getByText("Back to back")).toBeTruthy();
  });

  it("flags a gap of two and a half hours or more", () => {
    renderLens(detailWithGap(150));
    expect(screen.getByText("Nothing planned")).toBeTruthy();
  });

  it("does not flag a gap just under the threshold", () => {
    renderLens(detailWithGap(149));
    expect(screen.queryByText("Nothing planned")).toBeNull();
  });

  it("no longer claims a straight-line distance", () => {
    renderLens(detailWithCoordinatesOnBothStops);
    expect(screen.queryByText(/km direct/)).toBeNull();
  });

  // Phase 8 Task 8.7: routeSummary() returns null for a day with no located
  // stop, and the day-meta row's "·" separator is only rendered alongside a
  // real route — so a day like this must not trail a dangling "· ".
  it("leaves no dangling separator when a day has no route", () => {
    renderLens(detailWithUnlocatedStops);
    expect(screen.getByTestId("day-meta-day-1").textContent).not.toMatch(/·\s*$/);
  });

  it("still renders untimed activities as rows the caller can select", async () => {
    const onSelectActivity = vi.fn();
    const detail = tripDetailFixture({
      days: [{ dayId: "d1", activityIds: ["u1"], date: "2027-06-01", costSubtotal: 0 }],
      activities: {
        u1: { activityId: "u1", title: "Wander", timeWindow: null, location: null, notes: null, anchors: [], cost: null },
      },
    });
    renderLens(detail, onSelectActivity);
    await userEvent.click(screen.getByTestId("timeline-edit-u1"));
    expect(onSelectActivity).toHaveBeenCalledWith("u1");
  });

  it("renders an empty state when the trip has no days", () => {
    renderLens(tripDetailFixture({ days: [] }));
    expect(screen.getByText("No days yet.")).not.toBeNull();
  });

  // Task 4.1 (M10 Phase 4): per-stop cost, right column, under the
  // attributee. Formatted through formatMoney (KI-2) — never a hand-rolled
  // string — so this asserts the same convention BudgetChip already uses
  // (#46: USD renders as its "$" symbol, not the code).
  it("shows a stop's cost in the card's right column", () => {
    const detail = tripDetailFixture({
      currency: "USD",
      days: [{ dayId: "d1", activityIds: ["timed1"], date: "2027-06-01", costSubtotal: 4200 }],
      activities: {
        timed1: {
          activityId: "timed1",
          title: "Colosseum tour",
          timeWindow: { start: "09:00", end: "11:00" },
          location: { name: "Colosseum, Rome, Italy", lat: 41.8902, lng: 12.4922 },
          notes: null,
          anchors: [],
          cost: { amountMinor: 4200, currency: "USD" },
        },
      },
    });
    renderLens(detail);
    // The day-header cost chip also totals to the same "$42.00" here (this
    // fixture's one activity is the whole day's cost) — scope to the
    // activity row so this asserts the stop's own cost specifically.
    const row = screen.getByTestId("timeline-item-timed1");
    expect(within(row).getByText("$42.00")).toBeTruthy();
  });

  it("says so honestly when a stop has no cost", () => {
    renderLens(detailFixture()); // detailFixture()'s one activity has cost: null
    expect(screen.getByText("No cost yet")).toBeTruthy();
  });

  it("totals the day's costs in the day header", () => {
    // costSubtotal (9999) is deliberately DIFFERENT from the sum of the two
    // activities' own costs below (3000 + 3700 = 6700): this proves the day
    // header renders the server-computed costSubtotal field rather than
    // silently re-summing the activities' costs client-side — the two would
    // be indistinguishable, and re-summing client-side is exactly the KI-2
    // bug class this phase (M10 Phase 4) exists to close.
    const detail = tripDetailFixture({
      currency: "USD",
      days: [{ dayId: "day-1", activityIds: ["a1", "a2"], date: "2027-06-01", costSubtotal: 9999 }],
      activities: {
        a1: {
          activityId: "a1",
          title: "Colosseum tour",
          timeWindow: { start: "09:00", end: "10:00" },
          location: null,
          notes: null,
          anchors: [],
          cost: { amountMinor: 3000, currency: "USD" },
        },
        a2: {
          activityId: "a2",
          title: "Roman Forum",
          timeWindow: { start: "11:00", end: "12:00" },
          location: null,
          notes: null,
          anchors: [],
          cost: { amountMinor: 3700, currency: "USD" },
        },
      },
    });
    renderLens(detail);
    expect(screen.getByTestId("day-cost-day-1").textContent).toContain("$99.99");
  });

  // M10 Phase 5 — the overlap warning, its one-click fix and its dismissal.
  it("attaches the warning to the stop that starts later, not to both", () => {
    renderTimelineWithOverlap();
    expect(screen.getByTestId("overlap-warning-b")).toBeTruthy();
    expect(screen.queryByTestId("overlap-warning-a")).toBeNull();
    expect(screen.getByText("Overlaps Nezu Museum, 10:30 am – 1 pm — 30 m on top of each other.")).toBeTruthy();
  });

  it("moves the later stop to start when the earlier one ends, keeping its duration", async () => {
    const dispatch = renderTimelineWithOverlap();

    await userEvent.click(screen.getByRole("button", { name: "Start 1 pm" }));

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "UpdateActivity",
      activityId: "b",
      timeWindow: { start: "13:00", end: "14:30" },   // was 12:30–14:00, a 90-minute stop
    }));
  });

  // The fix keeps the stop's duration or it is not offered at all: a stop
  // whose kept duration would run past 23:59 has nowhere in the day to land,
  // and shortening it to fit would quietly make the fix a lie.
  it("offers no fix when the move would push the later stop past midnight", async () => {
    const dispatch = renderTimelineWithOverlap({
      activities: {
        a: { activityId: "a", title: "Nezu Museum", timeWindow: { start: "20:00", end: "23:45" }, location: null, notes: null, anchors: [], cost: null },
        b: { activityId: "b", title: "Lunch at Kagari", timeWindow: { start: "23:30", end: "23:59" }, location: null, notes: null, anchors: [], cost: null },
      },
    });

    // The warning itself still shows, under the later stop.
    expect(screen.getByTestId("overlap-warning-b")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Start / })).toBeNull();

    // ...and the only command the row can still send is the dismissal.
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "DismissConflict" }));
  });

  it("shows an overlap count badge on the day header", () => {
    renderTimelineWithOverlap();
    expect(screen.getByText("1 overlap")).toBeTruthy();
  });

  // Dismissal is per conflict id, and the id encodes the pair — so this
  // changes no trip data, only what the day shows.
  it("dismisses the pair's warning with DismissConflict and nothing else", async () => {
    const dispatch = renderTimelineWithOverlap();

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "DismissConflict",
      conflictId: "time-overlap:d1:a:b",
    }));
  });

  // The rich warning replaces the bare triangle for this one kind, rather
  // than both firing on the same pair.
  it("does not also badge the pair with the generic conflict triangle", () => {
    renderTimelineWithOverlap();
    expect(screen.queryByRole("img", { name: "conflict" })).toBeNull();
  });

  it("still badges an activity for a conflict kind the warning does not cover", () => {
    const detail = tripDetailFixture({
      days: [{ dayId: "d1", activityIds: ["a"], date: "2027-06-01", costSubtotal: 0 }],
      activities: {
        a: { activityId: "a", title: "Nezu Museum", timeWindow: { start: "10:30", end: "13:00" }, location: null, notes: null, anchors: [], cost: null },
      },
      conflicts: [
        { id: "anchor-broken:a", kind: "anchor-broken", severity: "warn", subjects: ["a"], description: "", resolutions: [] },
      ],
    });
    renderLens(detail);
    expect(screen.getByRole("img", { name: "conflict" })).toBeTruthy();
  });

  // ---- M10 Phase 6: growing the trip -------------------------------------

  it("ends the plan with the end-of-trip block", () => {
    renderLens(detailWithTwoDays());
    expect(screen.getByText("End of the trip")).toBeTruthy();
  });

  it("renders an empty day honestly rather than as a gap", () => {
    renderLens(detailWithEmptyDay());
    expect(screen.getByText("No stops yet — add one, or drop a saved day onto it")).toBeTruthy();
    expect(screen.getByText("Nothing planned yet")).toBeTruthy();
  });

  it("offers to add a stop after the day's last one", () => {
    renderLens(detailWithDayEndingAt("21:00"));
    expect(screen.getByRole("button", { name: "Add a stop after 9 pm" })).toBeTruthy();
  });

  it("offers to add the first stop on an empty day", () => {
    renderLens(detailWithEmptyDay());
    expect(screen.getByRole("button", { name: "Add the first stop" })).toBeTruthy();
  });

  it("gives every day its own single add row, however many stops it holds", () => {
    const ids = Array.from({ length: 8 }, (_, i) => `a${i}`);
    const detail = tripDetailFixture({
      days: [{ dayId: "d1", activityIds: ids, date: "2027-06-01", costSubtotal: 0 }],
      activities: Object.fromEntries(
        // 08:00–08:30, 09:00–09:30, … 15:00–15:30: eight stops, no overlaps.
        ids.map((id, i) => [id, timedActivity(id, `Stop ${i}`, `${String(8 + i).padStart(2, "0")}:00`, `${String(8 + i).padStart(2, "0")}:30`)]),
      ),
    });
    renderLens(detail);
    expect(screen.getAllByTestId("timeline-add-row-d1")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Add a stop after 3:30 pm" })).toBeTruthy();
  });

  // KI-30's own worked example, in the DOM: the affordance is withheld, not
  // degraded — the same shape as a null suggestedEnd making the overlap fix
  // button disappear.
  it("withholds the add row and disables Add stop on a day that runs to 23:59", () => {
    renderLens(detailWithDayEndingAt("23:59"));
    expect(screen.queryByTestId("timeline-add-row-d1")).toBeNull();
    const headerAdd = screen.getByTestId("timeline-add-d1") as HTMLButtonElement;
    expect(headerAdd.disabled).toBe(true);
    expect(headerAdd.title).toBe(
      "This day already runs to midnight — there is no free time left to add a stop.",
    );
  });

  it("offers the real remaining 29 minutes on a day that ends at 23:30", async () => {
    renderTimelineWithEditorProbe(detailWithDayEndingAt("23:30"));
    const addRow = screen.getByRole("button", { name: "Add a stop after 11:30 pm" });
    expect((screen.getByTestId("timeline-add-d1") as HTMLButtonElement).disabled).toBe(false);

    await userEvent.click(addRow);
    expect(editorPrefill()).toEqual({ dayId: "d1", timeWindow: { start: "23:30", end: "23:59" } });
  });

  it("prefills 09:00–10:00 from an empty day's add row", async () => {
    renderTimelineWithEditorProbe(detailWithEmptyDay());
    await userEvent.click(screen.getByRole("button", { name: "Add the first stop" }));
    expect(editorPrefill()).toEqual({ dayId: "d1", timeWindow: { start: "09:00", end: "10:00" } });
  });

  it("raises a real AddDay through the same onCommand seam the overlap fix uses", async () => {
    const dispatch = vi.fn();
    render(
      <FocusProvider>
        <EditorHost>
          <TimelineLens detail={detailWithTwoDays()} onCommand={dispatch} />
        </EditorHost>
      </FocusProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Add a day" }));

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "AddDay", dayId: expect.any(String) }),
    );
  });

  // A trip with no days at all keeps the pre-existing empty state — there is
  // no "last day" for the end-of-trip block to sit after.
  it("keeps the no-days empty state, without an end-of-trip block", () => {
    renderLens(tripDetailFixture({ days: [] }));
    expect(screen.getByText("No days yet.")).toBeTruthy();
    expect(screen.queryByTestId("end-of-trip")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add a day" })).toBeNull();
  });
});
