import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TripSummary } from "@tc/contracts";
import { tripDetailFixture } from "@/mocks/fixtures";

const fetchTripDetailMock = vi.fn();

vi.mock("@/lib/apiClient", async (orig) => {
  const actual = await orig<typeof import("@/lib/apiClient")>();
  return {
    ...actual,
    fetchTripDetail: (...args: unknown[]) => fetchTripDetailMock(...args),
  };
});

import { NextTripHero } from "./NextTripHero";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  fetchTripDetailMock.mockReset();
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

// Two days, three stops on day 1 and one on day 2 — real per-day activity
// counts the Sparkline should render, straight from TripDetail.days, not any
// fabricated/hashed placeholder.
function tripDetailWithDays(tripId: string) {
  return tripDetailFixture({
    tripId,
    name: "Japan: Tokyo to Kyoto",
    startDate: "2027-04-01",
    days: [
      {
        dayId: "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d",
        activityIds: [
          "2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e",
          "3d4e5f60-7182-4c9d-0e1f-2a3b4c5d6e7f",
          "4e5f6071-8293-4d0e-1f2a-3b4c5d6e7f80",
        ],
        date: "2027-04-01",
        costSubtotal: 0,
      },
      {
        dayId: "5f607182-93a4-4e1f-2a3b-4c5d6e7f8091",
        activityIds: ["6071829a-3b4c-4f5d-6e7f-8091a2b3c4d5"],
        date: "2027-04-02",
        costSubtotal: 0,
      },
    ],
  });
}

describe("NextTripHero", () => {
  it("renders the brand badge, trip name heading, stat tiles, open control and a sparkline sourced from real TripDetail data", async () => {
    const trip = tripSummaryFixture();
    fetchTripDetailMock.mockResolvedValue({ ok: true, value: tripDetailWithDays(trip.tripId) });
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

    expect(fetchTripDetailMock).toHaveBeenCalledWith(trip.tripId);

    // Sparkline, queried by its per-day buttons inside the "Shape of the
    // trip" group (Sparkline's own accessible group, Task 5) — asserting the
    // exact stop counts derived from the mocked TripDetail.days, not just
    // "some buttons exist", is what proves this isn't fabricated data.
    const sparklineGroup = await screen.findByRole("group", { name: /shape of the trip/i });
    const dayButtons = within(sparklineGroup).getAllByRole("button");
    expect(dayButtons.length).toBe(2);
    expect(dayButtons[0]!.getAttribute("aria-label")).toBe("Day 1, 3 stops");
    expect(dayButtons[1]!.getAttribute("aria-label")).toBe("Day 2, 1 stop");
  });

  it("shows a loading placeholder, never fabricated bars, before the TripDetail fetch resolves", async () => {
    let resolveFetch: (value: { ok: true; value: ReturnType<typeof tripDetailWithDays> }) => void;
    fetchTripDetailMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const trip = tripSummaryFixture();
    render(<NextTripHero trip={trip} />);

    // No sparkline group yet — the placeholder renders in its slot instead.
    expect(screen.queryByRole("group", { name: /shape of the trip/i })).toBeNull();
    const placeholder = screen.getByRole("status", { name: /shape of the trip/i });
    expect(placeholder.textContent).toMatch(/loading/i);

    resolveFetch!({ ok: true, value: tripDetailWithDays(trip.tripId) });
    await screen.findByRole("group", { name: /shape of the trip/i });
  });

  it("shows an honest unavailable placeholder, not fabricated bars, when the TripDetail fetch fails", async () => {
    fetchTripDetailMock.mockResolvedValue({ ok: false, error: { status: 500, message: "boom" } });
    const trip = tripSummaryFixture();
    render(<NextTripHero trip={trip} />);

    const placeholder = await screen.findByRole("status", { name: /shape of the trip/i });
    expect(placeholder.textContent).toMatch(/unavailable/i);
    expect(screen.queryByRole("group", { name: /shape of the trip/i })).toBeNull();
  });

  it("shows an honest empty placeholder, not a blank box, when every day has zero stops", async () => {
    const trip = tripSummaryFixture();
    fetchTripDetailMock.mockResolvedValue({
      ok: true,
      value: tripDetailFixture({
        tripId: trip.tripId,
        startDate: "2027-04-01",
        days: [
          { dayId: "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d", activityIds: [], date: "2027-04-01", costSubtotal: 0 },
        ],
      }),
    });
    render(<NextTripHero trip={trip} />);

    const placeholder = await screen.findByRole("status", { name: /shape of the trip/i });
    expect(placeholder.textContent).toMatch(/no stops planned yet/i);
    expect(screen.queryByRole("group", { name: /shape of the trip/i })).toBeNull();
  });

  // Regression: dayAccentFor used to be keyed by day index inside Sparkline,
  // so the same real city landed on two different colors depending on which
  // day it fell on (e.g. a 3-day Rochester trip). This exercises the real
  // wiring (chipModel's cityFor, sourced from each day's first located
  // activity) end to end, not just Sparkline's own hashing in isolation.
  it("gives two days in the same real city the same sparkline bar color", async () => {
    const trip = tripSummaryFixture();
    fetchTripDetailMock.mockResolvedValue({
      ok: true,
      value: tripDetailFixture({
        tripId: trip.tripId,
        startDate: "2027-04-01",
        days: [
          {
            dayId: "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d",
            activityIds: ["2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e"],
            date: "2027-04-01",
            costSubtotal: 0,
          },
          {
            dayId: "5f607182-93a4-4e1f-2a3b-4c5d6e7f8091",
            activityIds: ["6071829a-3b4c-4f5d-6e7f-8091a2b3c4d5"],
            date: "2027-04-02",
            costSubtotal: 0,
          },
        ],
        activities: {
          "2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e": {
            activityId: "2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e",
            title: "Coffee",
            timeWindow: null,
            location: { name: "Rochester", lat: 43.1566, lng: -77.6088, countryCode: "US" },
            notes: null,
            anchors: [],
            cost: null,
          },
          "6071829a-3b4c-4f5d-6e7f-8091a2b3c4d5": {
            activityId: "6071829a-3b4c-4f5d-6e7f-8091a2b3c4d5",
            title: "Lunch",
            timeWindow: null,
            location: { name: "Rochester", lat: 43.1566, lng: -77.6088, countryCode: "US" },
            notes: null,
            anchors: [],
            cost: null,
          },
        },
      }),
    });
    render(<NextTripHero trip={trip} />);

    const sparklineGroup = await screen.findByRole("group", { name: /shape of the trip/i });
    const [day1, day2] = within(sparklineGroup).getAllByRole("button");
    const day1Bar = day1!.querySelector("span")!.className;
    const day2Bar = day2!.querySelector("span")!.className;
    const bgClass = day1Bar.split(" ").find((c) => c.startsWith("bg-"));
    expect(bgClass).toBeDefined();
    expect(day2Bar).toContain(bgClass);
  });

  it("does not render an Open plan link to any other trip", async () => {
    const trip = tripSummaryFixture({ tripId: "9f8e7d6c-5b4a-3928-1716-0f1e2d3c4b5a", name: "Rome" });
    fetchTripDetailMock.mockResolvedValue({ ok: true, value: tripDetailWithDays(trip.tripId) });
    render(<NextTripHero trip={trip} />);
    const openLink = screen.getByRole("link", { name: /open plan/i });
    expect(openLink.getAttribute("href")).toBe("/trips/9f8e7d6c-5b4a-3928-1716-0f1e2d3c4b5a");
    await waitFor(() => expect(fetchTripDetailMock).toHaveBeenCalledWith(trip.tripId));
  });
});
