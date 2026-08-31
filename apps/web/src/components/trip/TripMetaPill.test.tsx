import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { tripDetailFixture } from "@tc/factories";
import { TripMetaPill } from "./TripMetaPill";

function fixture(): TripDetail {
  const day1 = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
  const day2 = "2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e";
  const a1 = "3d4e5f60-7182-4c9d-0e1f-2a3b4c5d6e7f";
  const a2 = "4e5f6071-8293-4d0e-1f2a-3b4c5d6e7f80";

  return tripDetailFixture({
    startDate: "2027-06-01",
    days: [
      { dayId: day1, activityIds: [a1], date: "2027-06-01", costSubtotal: 0 },
      { dayId: day2, activityIds: [a2], date: "2027-06-02", costSubtotal: 0 },
    ],
    activities: {
      [a1]: {
        activityId: a1,
        title: "Colosseum tour",
        timeWindow: null,
        location: { name: "Colosseum, Rome", lat: 41.89, lng: 12.49, city: "Rome" },
        notes: null,
        anchors: [],
        kind: "planned" as const,
        tags: [],
        cost: null,
      },
      [a2]: {
        activityId: a2,
        title: "Trevi Fountain",
        timeWindow: null,
        location: { name: "Trevi Fountain, Rome", lat: 41.9, lng: 12.48, city: "Naples" },
        notes: null,
        anchors: [],
        kind: "planned" as const,
        tags: [],
        cost: null,
      },
    },
    members: [
      { userId: "dev-alice", role: "owner" },
      { userId: "dev-bob", role: "owner" },
    ],
  });
}

afterEach(cleanup);

describe("TripMetaPill", () => {
  it("renders the date range and the day/stop/city counts", () => {
    render(<TripMetaPill detail={fixture()} />);

    expect(screen.getByText(/Jun 1/)).toBeTruthy();
    expect(screen.getByText(/Jun 2/)).toBeTruthy();
    expect(screen.getByText("2 days")).toBeTruthy();
    expect(screen.getByText("2 stops")).toBeTruthy();
    expect(screen.getByText("2 cities")).toBeTruthy();
  });

  // Mitchell, 2026-08-30 design pass: "Can we drop this ownership tile all
  // togther? DA?" The pill carried stacked member avatars that doubled as a
  // third way into Trip settings. Who is on the trip is answered in the
  // Travellers panel; this pill answers what the trip *is*.
  it("shows no member avatars and no crew control", () => {
    render(<TripMetaPill detail={fixture()} />);

    expect(screen.queryByText("DA")).toBeNull();
    expect(screen.queryByText("DB")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
