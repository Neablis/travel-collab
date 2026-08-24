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

  // Task 4.1 (M10 Phase 4): TripSummary carries no cost fields at all, so
  // TripCard can't derive this line itself — it only ever renders whatever
  // already-formatted string the caller (page.tsx, which fetches each
  // visible trip's own TripDetail and computes this line itself) hands it.
  it("shows planned spend against the budget", () => {
    const trip = tripSummaryFixture();
    render(<TripCard trip={trip} plannedOfBudget="$908.50 planned of $1,640.00" />);
    expect(screen.getByText("$908.50 planned of $1,640.00")).toBeTruthy();
  });

  it("renders no planned-spend line when the caller has no line to give it (honest absence, not a fabricated one)", () => {
    const trip = tripSummaryFixture();
    render(<TripCard trip={trip} />);
    expect(screen.queryByText(/planned of/)).toBeNull();
  });

  // Task 8.5 / phase-8-polish.md's own verbatim test: "shows the trip's
  // dates rather than its creation date". Deliberately skipped, not
  // implemented — TripSummary (packages/contracts/src/trip.ts) carries no
  // start/end date field at all, only createdAt, and this plan is
  // presentational-only (no `packages/contracts` growth). There is no real
  // date for TripCard to show instead of "Created …" without a contract
  // change that's out of scope here; forcing this test green would mean
  // either adding a schema field (against the plan's own rule) or
  // fabricating a fake date on the card (exactly what Task 8.5's "honesty
  // points" section says not to do). See the test just above — "shows a
  // human-readable created date, not the raw ISO timestamp" — which is the
  // accurate, currently-correct behavior this card actually has, and
  // docs/known-issues.md KI-34, which records this as a known, accepted gap
  // with its fix path (add a start date to TripSummary) out of scope.
  it.skip("shows the trip's dates rather than its creation date", () => {
    const trip = tripSummaryFixture();
    render(<TripCard trip={trip} />);
    expect(screen.queryByText(/^Created /)).toBeNull();
  });
});
