import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { tripDetailFixture } from "@tc/factories";
import { TripMetaPill, tripDateRange } from "./TripMetaPill";

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

// `tripDateRange` gained a second reader on PR #148 — SPEC §23's phone date
// line — and its undated branch was asserted nowhere, by either reader. That
// gap is what let CodeRabbit read the `??` on a nullable `days[0].date` as a
// trip borrowing `startDate` and printing a date it should not have.
//
// The borrow is not producible: `deriveDayDates`
// (`packages/domain/src/trip/dates.ts:86`) returns all-null when `startDate` is
// null and a date for EVERY day when it is not, so an undated day 0 implies an
// undated trip. These pin the two states that ARE producible, which is what was
// missing.
describe("tripDateRange", () => {
  it("says the trip has no dates when the trip has no start date", () => {
    const detail = fixture();
    // The producible undated shape, and the only one: `deriveDayDates` nulls
    // every day together with the trip. A fixture with a null `startDate` but
    // dated days would be testing a state the domain cannot emit.
    const undated: TripDetail = {
      ...detail,
      startDate: null,
      days: detail.days.map((d) => ({ ...d, date: null })),
    };
    expect(tripDateRange(undated)).toBe("No dates set");
  });

  it("reads the range off the days, not off startDate", () => {
    // Deliberately disagreeing: if the helper read `startDate` first this would
    // open on Jun 1. The days are what the trip actually shows.
    const detail = fixture();
    const shifted: TripDetail = {
      ...detail,
      startDate: "2027-06-01",
      days: detail.days.map((d, i) => ({ ...d, date: i === 0 ? "2027-07-04" : "2027-07-05" })),
    };
    expect(tripDateRange(shifted)).toContain("Jul 4");
    expect(tripDateRange(shifted)).not.toContain("Jun 1");
  });
});
