import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { tripDetailFixture } from "@/mocks/fixtures";
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
        cost: null,
      },
      [a2]: {
        activityId: a2,
        title: "Trevi Fountain",
        timeWindow: null,
        location: { name: "Trevi Fountain, Rome", lat: 41.9, lng: 12.48, city: "Naples" },
        notes: null,
        anchors: [],
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
  it("renders the date range, day/stop/city counts, and a member avatar per member", () => {
    render(<TripMetaPill detail={fixture()} onOpenSettings={() => {}} />);

    expect(screen.getByText(/Jun 1/)).toBeTruthy();
    expect(screen.getByText(/Jun 2/)).toBeTruthy();
    expect(screen.getByText("2 days")).toBeTruthy();
    expect(screen.getByText("2 stops")).toBeTruthy();
    expect(screen.getByText("2 cities")).toBeTruthy();
    expect(screen.getByText("DA")).toBeTruthy();
    expect(screen.getByText("DB")).toBeTruthy();
  });

  it("opens settings when the crew control is clicked", async () => {
    const onOpenSettings = vi.fn();
    render(<TripMetaPill detail={fixture()} onOpenSettings={onOpenSettings} />);

    await userEvent.click(screen.getByRole("button", { name: /crew|travellers|2 travellers/i }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
