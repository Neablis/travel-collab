import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditorHost } from "@/components/trip/context/EditorHost";
import { tripDetailFixture } from "@/mocks/fixtures";
import { TimelineLens } from "./TimelineLens";

function detailFixture() {
  return tripDetailFixture({
    days: [{ dayId: "d1", activityIds: ["timed1"], date: "2027-06-01", costSubtotal: 0 }],
    backlog: [],
    activities: {
      timed1: {
        activityId: "timed1",
        title: "Colosseum tour",
        timeWindow: { start: "09:00", end: "11:00" },
        location: null,
        notes: null,
        anchors: [],
        cost: null,
      },
    },
  });
}

describe("TimelineLens", () => {
  it("renders an hour axis so block times are readable (#28)", () => {
    render(
      <EditorHost>
        <TimelineLens detail={detailFixture()} onSelectActivity={vi.fn()} />
      </EditorHost>,
    );
    expect(screen.getAllByText("6a").length).toBeGreaterThan(0);
    expect(screen.getAllByText("12p").length).toBeGreaterThan(0);
    expect(screen.getAllByText("9p").length).toBeGreaterThan(0);
  });
});
