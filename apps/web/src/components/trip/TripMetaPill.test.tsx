import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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
        bookedBy: null,
        participants: [],
        mode: null,
        endLocation: null,
        pendingReason: null,
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
        bookedBy: null,
        participants: [],
        mode: null,
        endLocation: null,
        pendingReason: null,
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
  // SPEC §35.3: the counts were the Overview's first sentence said a second
  // time. They live in Trip settings now (`tripCounts`, SettingsSheet).
  it("states the dates and nothing else", () => {
    render(<TripMetaPill detail={fixture()} readOnly={false} onCommand={() => {}} />);

    const pill = screen.getByRole("button", { name: /^Trip dates:/ });
    expect(pill.textContent).toMatch(/Jun 1.*Jun 2/);
    expect(pill.textContent).not.toMatch(/days|stops|cities/);
  });

  // Mitchell, 2026-08-30 design pass: "Can we drop this ownership tile all
  // togther? DA?" The pill carried stacked member avatars that doubled as a
  // third way into Trip settings. Who is on the trip is answered in the
  // Travellers panel; this pill answers what the trip *is*.
  it("shows no member avatars", () => {
    render(<TripMetaPill detail={fixture()} readOnly={false} onCommand={() => {}} />);

    expect(screen.queryByText("DA")).toBeNull();
    expect(screen.queryByText("DB")).toBeNull();
  });

  // M27 D5: the popover sends what Trip settings' Dates row sends. The end
  // beside the input follows the picked start, not the trip's current last
  // day, so it answers "and then I'm back when?" before the round-trip does.
  it("moves the trip's start from its popover, and shows where the end lands", async () => {
    const onCommand = vi.fn();
    const detail = fixture();
    render(<TripMetaPill detail={detail} readOnly={false} onCommand={onCommand} />);

    await userEvent.click(screen.getByRole("button", { name: /Change the start date/ }));
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2027-07-10" } });
    // Two days, so the end is the day after.
    expect(screen.getByText("→ Jul 11, 2027")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onCommand).toHaveBeenCalledExactlyOnceWith({
      type: "SetTripStartDate",
      tripId: detail.tripId,
      startDate: "2027-07-10",
    });
    expect(screen.queryByLabelText("Start date")).toBeNull();
  });

  // Typing a year into Chromium's date input emits a `change` per keystroke,
  // and every one of these is a real calendar day. Committing on change sent
  // four commands and moved the trip to the year 2 on the way.
  it("sends one command for a typed year, not one per keystroke", async () => {
    const onCommand = vi.fn();
    const detail = fixture();
    render(<TripMetaPill detail={detail} readOnly={false} onCommand={onCommand} />);

    await userEvent.click(screen.getByRole("button", { name: /Change the start date/ }));
    const input = screen.getByLabelText("Start date");
    for (const value of ["0002-07-10", "0020-07-10", "0202-07-10", "2027-07-10"]) {
      fireEvent.change(input, { target: { value } });
    }
    expect(onCommand).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommand).toHaveBeenCalledExactlyOnceWith({
      type: "SetTripStartDate",
      tripId: detail.tripId,
      startDate: "2027-07-10",
    });
  });

  it("commits when the input loses focus", async () => {
    const onCommand = vi.fn();
    render(<TripMetaPill detail={fixture()} readOnly={false} onCommand={onCommand} />);

    await userEvent.click(screen.getByRole("button", { name: /Change the start date/ }));
    const input = screen.getByLabelText("Start date");
    fireEvent.change(input, { target: { value: "2027-08-01" } });
    fireEvent.blur(input);

    expect(onCommand).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ startDate: "2027-08-01" }));
  });

  // A string of the right shape that is not a day. The native input will not
  // produce one, but the contract's regex accepts it, so the pill is what
  // stops it reaching the log. A year before 1900 is a half-typed one.
  it("sends nothing for a date that does not exist, a half-typed year, or the date it already has", async () => {
    const onCommand = vi.fn();
    render(<TripMetaPill detail={fixture()} readOnly={false} onCommand={onCommand} />);

    await userEvent.click(screen.getByRole("button", { name: /Change the start date/ }));
    const input = screen.getByLabelText("Start date");
    for (const value of ["2027-02-31", "0202-07-10", "2027-06-01"]) {
      fireEvent.change(input, { target: { value } });
      fireEvent.keyDown(input, { key: "Enter" });
    }
    fireEvent.change(input, { target: { value: "0202-07-10" } });
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(onCommand).not.toHaveBeenCalled();
  });

  // A viewer cannot move the trip, so nothing here may look as if it could:
  // no button, no caret, no popover — the dates as text.
  it("is plain text for a read-only trip", () => {
    render(<TripMetaPill detail={fixture()} readOnly onCommand={() => {}} />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/Jun 1.*Jun 2/)).toBeTruthy();
  });

  // An undated trip keeps the button: "No dates set" is the state the popover
  // exists to fix, and an empty input is where it starts.
  it("offers a start date to a trip that has none", async () => {
    const detail = fixture();
    const undated: TripDetail = { ...detail, startDate: null, days: detail.days.map((d) => ({ ...d, date: null })) };
    render(<TripMetaPill detail={undated} readOnly={false} onCommand={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: "Trip dates: No dates set. Change the start date" }));
    expect((screen.getByLabelText("Start date") as HTMLInputElement).value).toBe("");
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
