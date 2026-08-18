import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TripSummary } from "@tc/contracts";
import { TripCard } from "./TripCard";

afterEach(() => {
  cleanup();
});

function tripSummaryFixture(overrides: Partial<TripSummary> = {}): TripSummary {
  return {
    tripId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f",
    name: "Iceland Ring Road",
    status: "active",
    members: [{ userId: "dev-alice", role: "owner" }],
    createdAt: "2026-07-08T12:00:00.000Z",
    ...overrides,
  };
}

// Two members instead of the single-member default fixture, so the "one
// avatar per member" assertion below is actually meaningful (not vacuously
// true for a length-1 array).
const twoMemberTrip = () =>
  tripSummaryFixture({
    members: [
      { userId: "dev-alice", role: "owner" },
      { userId: "dev-bob", role: "owner" },
    ],
  });

describe("TripCard", () => {
  it("renders the trip name as a display heading, a state badge, an accent bar, and the actions menu with Duplicate/Delete", () => {
    const trip = tripSummaryFixture();
    render(
      <TripCard
        trip={trip}
        menuSlot={
          <div role="menu">
            <button role="menuitem">Duplicate</button>
            <button role="menuitem">Delete</button>
          </div>
        }
      />,
    );

    expect(screen.getByRole("heading", { name: trip.name })).toBeTruthy();
    expect(screen.getByText(/active/i)).toBeTruthy(); // state badge
    expect(screen.getByTestId("accent-bar")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /duplicate/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /delete/i })).toBeTruthy();
  });

  it("shows a human-readable created date, not the raw ISO timestamp", () => {
    const trip = tripSummaryFixture({ createdAt: "2026-07-08T12:00:00.000Z" });
    render(<TripCard trip={trip} />);

    expect(screen.queryByText(trip.createdAt)).toBeNull();
    expect(screen.getByText(/jul(y)? 8, 2026/i)).toBeTruthy();
  });

  it("keys the accent bar off a stable field of the trip (same trip -> same accent across renders)", () => {
    const trip = tripSummaryFixture();
    const { unmount } = render(<TripCard trip={trip} />);
    const firstClass = screen.getByTestId("accent-bar").className;
    unmount();

    render(<TripCard trip={trip} />);
    expect(screen.getByTestId("accent-bar").className).toBe(firstClass);
  });

  it("renders a footer avatar stack with one avatar per member, alongside the state badge", () => {
    const trip = twoMemberTrip();
    render(<TripCard trip={trip} />);

    const group = screen.getByRole("group", { name: /2 travelers/i });
    expect(group.children.length).toBe(trip.members.length);

    // Still shows the state badge next to the avatars, not in place of it.
    expect(screen.getByText(/active/i)).toBeTruthy();
  });
});
