import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TripSummary } from "@tc/contracts";
import { NextTripHero } from "./NextTripHero";

afterEach(() => {
  cleanup();
});

function tripSummaryFixture(overrides: Partial<TripSummary> = {}): TripSummary {
  return {
    tripId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f",
    name: "Japan: Tokyo to Kyoto",
    status: "active",
    members: [
      { userId: "dev-alice", role: "owner" },
      { userId: "dev-bob", role: "owner" },
    ],
    createdAt: "2026-07-08T12:00:00.000Z",
    ...overrides,
  };
}

describe("NextTripHero", () => {
  it("renders the brand badge, trip name heading, stat tiles, open control and sparkline", () => {
    const trip = tripSummaryFixture();
    render(<NextTripHero trip={trip} />);

    // Brand "Next trip" badge.
    expect(screen.getByText("Next trip")).toBeTruthy();

    // Trip name as a level-2 heading.
    const heading = screen.getByRole("heading", { level: 2, name: trip.name });
    expect(heading).toBeTruthy();

    // Three stat tiles.
    const tiles = screen.getAllByTestId("stat-tile");
    expect(tiles.length).toBe(3);

    // "Open plan" control, linking to the trip route.
    const openLink = screen.getByRole("link", { name: /open plan/i });
    expect(openLink.getAttribute("href")).toBe(`/trips/${trip.tripId}`);

    // Sparkline, queried by its per-day buttons inside the "Shape of the
    // trip" group (Sparkline's own accessible group, Task 5).
    const sparklineGroup = screen.getByRole("group", { name: /shape of the trip/i });
    const dayButtons = within(sparklineGroup).getAllByRole("button");
    expect(dayButtons.length).toBeGreaterThan(0);
  });

  it("does not render an Open plan link to any other trip", () => {
    const trip = tripSummaryFixture({ tripId: "9f8e7d6c-5b4a-3928-1716-0f1e2d3c4b5a", name: "Rome" });
    render(<NextTripHero trip={trip} />);
    const openLink = screen.getByRole("link", { name: /open plan/i });
    expect(openLink.getAttribute("href")).toBe("/trips/9f8e7d6c-5b4a-3928-1716-0f1e2d3c4b5a");
  });
});
