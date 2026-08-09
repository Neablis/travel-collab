import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorHost } from "@/components/trip/context/EditorHost";
import { FocusProvider } from "@/components/trip/context/FocusProvider";
import { tripDetailFixture } from "@/mocks/fixtures";
import { TimelineLens } from "./TimelineLens";

afterEach(cleanup);

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
});
