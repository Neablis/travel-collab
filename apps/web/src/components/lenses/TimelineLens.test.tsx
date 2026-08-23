import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorHost } from "@/components/trip/context/EditorHost";
import { FocusProvider, useFocus } from "@/components/trip/context/FocusProvider";
import type { TripDetail } from "@tc/contracts";
import { tripDetailFixture } from "@tc/factories";
import { TimelineLens } from "./TimelineLens";

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
    expect(screen.getByText("2h out")).not.toBeNull();
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

  it("shows a real gap leg (not a fabricated travel time) between two timed activities, and a straight-line distance only when both have coordinates", () => {
    const detail = tripDetailFixture({
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
    renderLens(detail);
    const leg = screen.getByTestId("timeline-leg");
    expect(within(leg).getByText(/1h gap/)).not.toBeNull();
    expect(within(leg).getByText(/km direct/)).not.toBeNull();
    // 60 minutes > the 30-minute warning threshold.
    expect(within(leg).getByText("Long gap")).not.toBeNull();
  });

  it("omits the leg's distance (never fabricates one) when either activity has no coordinates", () => {
    const detail = tripDetailFixture({
      days: [{ dayId: "d1", activityIds: ["a1", "a2"], date: "2027-06-01", costSubtotal: 0 }],
      activities: {
        a1: {
          activityId: "a1",
          title: "Colosseum tour",
          timeWindow: { start: "09:00", end: "10:00" },
          location: null,
          notes: null,
          anchors: [],
          cost: null,
        },
        a2: {
          activityId: "a2",
          title: "Roman Forum",
          timeWindow: { start: "10:10", end: "11:00" },
          location: { name: "Roman Forum", lat: 41.8925, lng: 12.4853 },
          notes: null,
          anchors: [],
          cost: null,
        },
      },
    });
    renderLens(detail);
    const leg = screen.getByTestId("timeline-leg");
    expect(within(leg).getByText("10m gap")).not.toBeNull();
    expect(within(leg).queryByText(/km direct/)).toBeNull();
    // 10 minutes is under the warning threshold.
    expect(within(leg).queryByText("Long gap")).toBeNull();
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
  // "$"-prefixed string — so this asserts the same "N,NNN.NN CCC" convention
  // BudgetChip/DailyOverviewLens/ItineraryLens already use, not a currency
  // symbol.
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
    // The day-header cost chip also totals to the same "42.00 USD" here
    // (this fixture's one activity is the whole day's cost) — scope to the
    // activity row so this asserts the stop's own cost specifically.
    const row = screen.getByTestId("timeline-item-timed1");
    expect(within(row).getByText("42.00 USD")).toBeTruthy();
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
    expect(screen.getByTestId("day-cost-day-1").textContent).toContain("99.99 USD");
  });

  // M10 Phase 5 — the overlap warning, its one-click fix and its dismissal.
  it("attaches the warning to the stop that starts later, not to both", () => {
    renderTimelineWithOverlap();
    expect(screen.getByTestId("overlap-warning-b")).toBeTruthy();
    expect(screen.queryByTestId("overlap-warning-a")).toBeNull();
    expect(screen.getByText("Overlaps Nezu Museum, 10:30 am – 1 pm — 30m on top of each other.")).toBeTruthy();
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
});
