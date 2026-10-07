import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TripSummary } from "@tc/contracts";
import { costedTripDetailFixture, tripCoverFactory, tripDetailFixture, tripSummaryFactory } from "@tc/factories";

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

/** A `TripSummary` from `tripSummaryFactory`, planned unless `overrides` say otherwise. */
function tripSummaryFixture(overrides: Partial<TripSummary> = {}): TripSummary {
  return tripSummaryFactory.build({
    tripId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f",
    name: "Japan: Tokyo to Kyoto",
    members: [
      { userId: "dev-alice", role: "owner" },
      { userId: "dev-bob", role: "owner" },
    ],
    // A planned trip, as `tripDetailWithDays` below is: every test here but
    // the unplanned ones is about a trip with something on it.
    dayCount: 2,
    stopCount: 4,
    ...overrides,
  });
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
  it("renders the brand badge, trip name heading, open control and a sparkline sourced from real TripDetail data", async () => {
    const trip = tripSummaryFixture();
    fetchTripDetailMock.mockResolvedValue({ ok: true, value: tripDetailWithDays(trip.tripId) });
    render(<NextTripHero trip={trip} />);

    // Brand "Next trip" badge.
    expect(screen.getByText("Next trip")).toBeTruthy();

    // Trip name as a level-2 heading.
    const heading = screen.getByRole("heading", { level: 2, name: trip.name });
    expect(heading).toBeTruthy();

    // "Open trip" control, linking to the trip route.
    const openLink = screen.getByRole("link", { name: /open trip/i });
    expect(openLink.getAttribute("href")).toBe(`/trips/${trip.tripId}`);

    expect(fetchTripDetailMock).toHaveBeenCalledWith(trip.tripId);

    // Sparkline: one block per stop across both days (3 + 1 = 4), asserting
    // the exact count derived from the mocked TripDetail.days/activityIds,
    // not just "some blocks exist" — what proves this isn't fabricated data.
    // Plus a day-number label per day (the trip's day 1 and day 2).
    const sparklineGroup = await screen.findByRole("group", { name: /shape of the trip/i });
    // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    const blocks = sparklineGroup.querySelectorAll('[aria-hidden="true"]');
    expect(blocks.length).toBe(4);
    // Scoped to the sparkline: "1"/"2" are day numbers here, and a bare
    // number anywhere else on the hero must not satisfy this.
    expect(within(sparklineGroup).getByText("1")).toBeTruthy();
    expect(within(sparklineGroup).getByText("2")).toBeTruthy();
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
    // A skeleton now (KI-2026-09-23-e), so no visible "Loading…": what a
    // screen reader is told is the region's name and that it is busy.
    const placeholder = screen.getByRole("status", { name: /loading the shape of the trip/i });
    expect(placeholder.getAttribute("aria-busy")).toBe("true");

    resolveFetch!({ ok: true, value: tripDetailWithDays(trip.tripId) });
    await screen.findByRole("group", { name: /shape of the trip/i });
  });

  it("shows an honest unavailable placeholder, not fabricated bars, when the TripDetail fetch fails", async () => {
    fetchTripDetailMock.mockResolvedValue({ ok: false, error: { status: 500, message: "boom" } });
    const trip = tripSummaryFixture();
    render(<NextTripHero trip={trip} />);

    const placeholder = await screen.findByRole("status", { name: "Shape of the trip" });
    expect(placeholder.textContent).toMatch(/unavailable/i);
    expect(screen.queryByRole("group", { name: /shape of the trip/i })).toBeNull();
  });

  it("shows an honest 'No days yet' placeholder only when the trip has no days at all", async () => {
    const trip = tripSummaryFixture();
    fetchTripDetailMock.mockResolvedValue({
      ok: true,
      value: tripDetailFixture({ tripId: trip.tripId, days: [] }),
    });
    render(<NextTripHero trip={trip} />);

    const placeholder = await screen.findByRole("status", { name: "Shape of the trip" });
    expect(placeholder.textContent).toMatch(/no days yet/i);
    expect(screen.queryByRole("group", { name: /shape of the trip/i })).toBeNull();
  });

  // Regression: a day with zero stops used to make the whole sparkline fall
  // back to a "No stops planned yet" placeholder (or, for a multi-day trip,
  // silently drop that one day's group entirely) — a real 4-day trip whose
  // 4th day had no activities yet only ever showed 3 groups. It must render
  // the sparkline with an empty (but still day-numbered) slot for that day.
  it("still renders the sparkline group, with an empty day-numbered slot, when a day has zero stops", async () => {
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
          { dayId: "5f607182-93a4-4e1f-2a3b-4c5d6e7f8091", activityIds: [], date: "2027-04-02", costSubtotal: 0 },
        ],
        activities: {
          "2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e": {
            activityId: "2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e",
            title: "Coffee",
            timeWindow: null,
            location: null,
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
      }),
    });
    render(<NextTripHero trip={trip} />);

    const sparklineGroup = await screen.findByRole("group", { name: /shape of the trip/i });
    // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(sparklineGroup.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1); // only day 1 has a stop
    expect(within(sparklineGroup).getByText("1")).toBeTruthy(); // day 1's number
    expect(within(sparklineGroup).getByText("2")).toBeTruthy(); // day 2's number, even though it's empty
  });

  // Regression: Sparkline used to key its accent by day index, so the same
  // real city landed on two different colors depending on which day it fell
  // on (e.g. a 3-day Rochester trip). This exercises the real wiring
  // (cityFor, sourced from each day's LAST located activity) end to end,
  // not just Sparkline's own color assignment in isolation.
  it("gives two days in the same real city the same sparkline block color", async () => {
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
            location: { name: "Rochester", city: "Rochester", lat: 43.1566, lng: -77.6088, countryCode: "US" },
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
          "6071829a-3b4c-4f5d-6e7f-8091a2b3c4d5": {
            activityId: "6071829a-3b4c-4f5d-6e7f-8091a2b3c4d5",
            title: "Lunch",
            timeWindow: null,
            location: { name: "Rochester", city: "Rochester", lat: 43.1566, lng: -77.6088, countryCode: "US" },
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
      }),
    });
    render(<NextTripHero trip={trip} />);

    const sparklineGroup = await screen.findByRole("group", { name: /shape of the trip/i });
    // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    const bars = sparklineGroup.querySelectorAll('[aria-hidden="true"]');
    expect(bars).toHaveLength(2);
    // Color now comes from a dayAccents family token class, not an inline
    // hex — same class both days, since both resolve to the same city.
    // eslint-disable-next-line no-restricted-syntax -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect((bars[0] as HTMLElement).className).toMatch(/\bbg-(brand|info|success|warning|danger)\b/);
    // eslint-disable-next-line no-restricted-syntax -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect((bars[0] as HTMLElement).className).toBe((bars[1] as HTMLElement).className);
  });

  // The other half of the real algorithm: a column's height is that day's
  // real stop COUNT, so every block is the same size no matter how long the
  // stop itself runs. A 20-minute coffee and a 4-hour museum visit are two
  // equal blocks — duration deliberately does not size them (it used to,
  // which made one long stop out-rank a packed day of short ones).
  //
  // Same fixture also pins the day label to the day's 1-indexed position in
  // the trip, not its calendar date: this day is April 15, and it must still
  // read "1".
  it("stacks equal blocks by stop count, ignoring duration, and labels the day by trip position not date", async () => {
    const trip = tripSummaryFixture();
    fetchTripDetailMock.mockResolvedValue({
      ok: true,
      value: tripDetailFixture({
        tripId: trip.tripId,
        startDate: "2027-04-15",
        days: [
          {
            dayId: "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d",
            activityIds: ["2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e", "3d4e5f60-7182-4c9d-0e1f-2a3b4c5d6e7f"],
            date: "2027-04-15",
            costSubtotal: 0,
          },
        ],
        activities: {
          "2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e": {
            activityId: "2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e",
            title: "Coffee",
            timeWindow: { start: "09:00", end: "09:20" }, // 20 minutes
            location: null,
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
          "3d4e5f60-7182-4c9d-0e1f-2a3b4c5d6e7f": {
            activityId: "3d4e5f60-7182-4c9d-0e1f-2a3b4c5d6e7f",
            title: "Museum",
            timeWindow: { start: "10:00", end: "14:00" }, // 240 minutes — 12x the coffee, same block
            location: null,
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
      }),
    });
    render(<NextTripHero trip={trip} />);

    const sparklineGroup = await screen.findByRole("group", { name: /shape of the trip/i });
    // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    const blocks = sparklineGroup.querySelectorAll('[aria-hidden="true"]');
    expect(blocks).toHaveLength(2);
    expect((blocks[0] as HTMLElement).style.height).toBe((blocks[1] as HTMLElement).style.height);
    expect(within(sparklineGroup).getByText("1")).toBeTruthy(); // trip day 1, not April "15"
    expect(within(sparklineGroup).queryByText("15")).toBeNull();
  });

  // SPEC §35.2: the three stat tiles became one actionable line. The decision
  // half is the trip's real, live TripDetail.conflicts count (it was a
  // hardcoded `value="2"` behind a Preview shell once, Task 8.5), and it is a
  // way into the trip's Plan view — the place those decisions get made. Overview,
  // where a bare trip URL lands, shows none of them (Mitchell, PR #269 preview).
  it("says how many decisions the trip needs, from its real conflicts, as a way into the trip's Plan view", async () => {
    const trip = tripSummaryFixture();
    fetchTripDetailMock.mockResolvedValue({
      ok: true,
      value: tripDetailFixture({
        tripId: trip.tripId,
        conflicts: [
          { id: "c1", kind: "overlap", severity: "warn", subjects: ["a", "b"], description: "Overlap", resolutions: [] },
          { id: "c2", kind: "overlap", severity: "warn", subjects: ["c", "d"], description: "Overlap", resolutions: [] },
          { id: "c3", kind: "budget", severity: "error", subjects: [], description: "Over budget", resolutions: [] },
        ],
      }),
    });
    render(<NextTripHero trip={trip} />);

    const decisions = await screen.findByRole("link", { name: "3 need a decision" });
    expect(decisions.getAttribute("href")).toBe(`/trips/${trip.tripId}?view=Plan`);
    // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(document.querySelector('[data-preview-id="home-decisions"]')).toBeNull();
  });

  it("says one decision in the singular", async () => {
    const trip = tripSummaryFixture();
    fetchTripDetailMock.mockResolvedValue({
      ok: true,
      value: tripDetailFixture({
        tripId: trip.tripId,
        conflicts: [
          { id: "c1", kind: "overlap", severity: "warn", subjects: ["a", "b"], description: "Overlap", resolutions: [] },
        ],
      }),
    });
    render(<NextTripHero trip={trip} />);

    expect(await screen.findByRole("link", { name: "1 needs a decision" })).toBeTruthy();
  });

  // **Zero is not a task.** The tiles showed "0"; a line reading "0 need a
  // decision" would be a to-do with nothing to do. Waited on the budget line,
  // which lands in the same state update as both counts, so this cannot pass
  // merely by asserting before the fetch has resolved.
  it("says nothing about decisions or bookings when there are none", async () => {
    const trip = tripSummaryFixture();
    fetchTripDetailMock.mockResolvedValue({
      ok: true,
      value: tripDetailFixture({ tripId: trip.tripId, conflicts: [], activities: {}, days: [] }),
    });
    render(<NextTripHero trip={trip} />);

    await screen.findByText(/No budget yet|planned of/);
    expect(screen.queryByText(/a decision/)).toBeNull();
    expect(screen.queryByText(/not booked/)).toBeNull();
  });

  // It counts the `pending` stops — the same predicate the Calendar's `N to
  // book` flag uses (`needsBooking`), so the hero and the Calendar can never
  // disagree about one trip (M18; the rule is "pending" since M28).
  it("counts the trip's unbooked stops in the actionable line", async () => {
    const trip = tripSummaryFixture();
    const stop = (id: string, kind: "planned" | "pending" | "transit", tags: ("meal" | "lodging" | "ticketed" | "outdoors")[] = []) => ({
      activityId: id,
      title: id,
      timeWindow: null,
      location: null,
      notes: null,
      anchors: [],
      kind,
      tags,
      cost: null,
      bookedBy: null,
      participants: [],
      mode: null,
      endLocation: null,
      pendingReason: null,
    });
    fetchTripDetailMock.mockResolvedValue({
      ok: true,
      value: tripDetailFixture({
        tripId: trip.tripId,
        // Every one of the three kinds, twice for `pending`, so a regression
        // that counts one pending stop and not another fails here.
        days: [{ dayId: "d1", activityIds: ["a", "b", "c", "d", "e", "f"], date: "2027-06-01", costSubtotal: 0 }],
        activities: {
          a: stop("a", "planned"),
          b: stop("b", "transit"),
          c: stop("c", "pending"),
          // A plain `planned` stop does NOT count — the default is not a
          // decision. Nor, since M28, does a ticketed one (ADR-054).
          d: stop("d", "planned"),
          e: stop("e", "pending"),
          f: stop("f", "planned", ["ticketed"]),
        },
      }),
    });
    render(<NextTripHero trip={trip} />);

    // c and e (pending). Not a, d or f (planned, ticketed or not), and not b
    // (transit).
    expect(await screen.findByText("2 not booked yet")).toBeTruthy();
  });

  // The tiles read "—" here rather than a confident 0. The line has no dash to
  // show, so it shows nothing — "— need a decision" would be worse than both.
  it("says nothing about decisions or bookings before the trip detail has loaded", () => {
    const trip = tripSummaryFixture();
    fetchTripDetailMock.mockReturnValue(new Promise(() => {}));
    render(<NextTripHero trip={trip} />);

    expect(screen.getByRole("link", { name: /open trip/i })).toBeTruthy();
    expect(screen.queryByText(/a decision/)).toBeNull();
    expect(screen.queryByText(/not booked/)).toBeNull();
  });

  // KI-034: the meta row used to say "Created …" until the detail landed,
  // because the summary had no start date to show. It has one now, so the
  // hero shows the real date from its first frame.
  it("shows the trip's start date before the trip detail has loaded", () => {
    const trip = tripSummaryFixture({ startDate: "2026-10-01" });
    fetchTripDetailMock.mockReturnValue(new Promise(() => {}));
    render(<NextTripHero trip={trip} />);

    expect(screen.getByText(/^Thu, Oct 1\b/)).toBeTruthy();
    expect(screen.queryByText(/^Created /)).toBeNull();
  });

  // Task 8.5: the traveler count used to say "travelers" unconditionally,
  // even for a solo trip. It is the avatar stack's name now that the tile
  // that printed it is gone (§35.2).
  it("says one traveler, not one travelers", async () => {
    const trip = tripSummaryFixture({ members: [{ userId: "dev-alice", role: "owner" }] });
    fetchTripDetailMock.mockResolvedValue({ ok: true, value: tripDetailWithDays(trip.tripId) });
    render(<NextTripHero trip={trip} />);

    expect(await screen.findByRole("group", { name: "1 traveler" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: /travelers/ })).toBeNull();
  });

  // Travellers spec §5: an adviser who is not going is not a traveler here.
  it("counts and shows the travelers, not every member", async () => {
    const trip = tripSummaryFixture({
      members: [{ userId: "dev-alice", role: "owner" }, { userId: "dev-bob", role: "suggester", travelling: false }],
    });
    fetchTripDetailMock.mockResolvedValue({ ok: true, value: tripDetailWithDays(trip.tripId) });
    render(<NextTripHero trip={trip} />);

    // The avatars are aria-hidden, so what a reader sees is their initials.
    const group = await screen.findByRole("group", { name: "1 traveler" });
    expect(within(group).getByText("AL")).toBeTruthy();
    expect(within(group).queryByText("BO")).toBeNull();
  });

  // Since §35.2 filters the hero out of *Other trips*, this is the only place
  // on Home its name appears — and on a card the name is the way in.
  it("makes the trip's name a way into the trip", async () => {
    const trip = tripSummaryFixture();
    fetchTripDetailMock.mockResolvedValue({ ok: true, value: tripDetailWithDays(trip.tripId) });
    render(<NextTripHero trip={trip} />);

    const byName = screen.getByRole("link", { name: trip.name });
    expect(byName.getAttribute("href")).toBe(`/trips/${trip.tripId}`);
    await waitFor(() => expect(fetchTripDetailMock).toHaveBeenCalledWith(trip.tripId));
  });

  // M27 D3: the hero is not in the grid any more, so it carries the grid
  // card's lifecycle menu — or a one-trip account has no Delete on Home.
  it("renders the lifecycle menu it is given", async () => {
    const trip = tripSummaryFixture();
    fetchTripDetailMock.mockResolvedValue({ ok: true, value: tripDetailWithDays(trip.tripId) });
    render(<NextTripHero trip={trip} menuSlot={<span>trip menu here</span>} />);

    expect(screen.getByText("trip menu here")).toBeTruthy();
    await waitFor(() => expect(fetchTripDetailMock).toHaveBeenCalledWith(trip.tripId));
  });

  it("does not render an Open trip link to any other trip", async () => {
    const trip = tripSummaryFixture({ tripId: "9f8e7d6c-5b4a-3928-1716-0f1e2d3c4b5a", name: "Rome" });
    fetchTripDetailMock.mockResolvedValue({ ok: true, value: tripDetailWithDays(trip.tripId) });
    render(<NextTripHero trip={trip} />);
    const openLink = screen.getByRole("link", { name: /open trip/i });
    expect(openLink.getAttribute("href")).toBe("/trips/9f8e7d6c-5b4a-3928-1716-0f1e2d3c4b5a");
    await waitFor(() => expect(fetchTripDetailMock).toHaveBeenCalledWith(trip.tripId));
  });

  // Task 4.1 (M10 Phase 4): the "planned of budget" line derived from the real
  // TripDetail this component already fetches (tripSpend + formatMoney —
  // never a hand-rolled string; #46 has formatMoney itself prefix a "$" for
  // USD).
  it("shows planned spend against the budget once the real TripDetail loads", async () => {
    const trip = tripSummaryFixture();
    // costedTripDetailFixture: tripCostTotal 49100 minor, budget 100000 minor, USD.
    fetchTripDetailMock.mockResolvedValue({ ok: true, value: costedTripDetailFixture() });
    render(<NextTripHero trip={trip} />);

    expect(await screen.findByText("$491.00 planned of $1,000.00")).toBeTruthy();
  });

  it("shows an honest 'No budget yet' only once it knows the loaded trip truly has none", async () => {
    const trip = tripSummaryFixture();
    fetchTripDetailMock.mockResolvedValue({ ok: true, value: tripDetailWithDays(trip.tripId) }); // budget: null
    render(<NextTripHero trip={trip} />);

    expect(await screen.findByText("No budget yet")).toBeTruthy();
  });

  it("renders no planned-spend line while the TripDetail fetch is still loading or has failed", async () => {
    fetchTripDetailMock.mockResolvedValue({ ok: false, error: { status: 500, message: "boom" } });
    const trip = tripSummaryFixture();
    render(<NextTripHero trip={trip} />);

    await screen.findByRole("status", { name: "Shape of the trip" });
    expect(screen.queryByText(/planned of/)).toBeNull();
    expect(screen.queryByText("No budget yet")).toBeNull();
  });

  // Preview review fix: the "stops per day" label next to the sparkline
  // heading was flagged as unneeded and removed. Asserted once the sparkline
  // itself has real data, since the label only ever rendered in that state.
  it("does not render a 'stops per day' label next to the sparkline heading", async () => {
    const trip = tripSummaryFixture();
    fetchTripDetailMock.mockResolvedValue({ ok: true, value: tripDetailWithDays(trip.tripId) });
    render(<NextTripHero trip={trip} />);

    await screen.findByRole("group", { name: /shape of the trip/i });
    expect(screen.queryByText("stops per day")).toBeNull();
  });
});

// DRIFT D6, M26 link 9d: "Upcoming-by-date hero + 'in 47 days' countdown".
//
// WHICH trip is the hero is Home's choice, by start date (`orderHomeTrips`,
// KI-034); this block covers the countdown to the date of whichever it is.
describe("NextTripHero — the countdown", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function heroStartingOn(startDate: string | null) {
    const trip = tripSummaryFixture();
    fetchTripDetailMock.mockResolvedValue({
      ok: true,
      value: { ...tripDetailWithDays(trip.tripId), startDate },
    });
    render(<NextTripHero trip={trip} />);
    return trip;
  }

  it("counts the days to a trip that has not started", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 7, 4));
    heroStartingOn("2026-09-20");

    // The handoff's own numbers (dc.html:9486): TODAY 2026-08-04,
    // NEXT_TRIP_START 2026-09-20, "in 47 days".
    expect(await screen.findByText("in 47 days")).toBeTruthy();
  });

  // **Honest about a trip that has already gone.** Home still lands the hero
  // on one when every trip is past, or when a trip is under way (a summary has
  // no end date). A countdown that only counted down would print nothing — or
  // a negative — in exactly that case.
  it("says how long ago a trip that has passed was", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 7, 4));
    heroStartingOn("2026-07-23");

    expect(await screen.findByText("12 days ago")).toBeTruthy();
  });

  it("says today and tomorrow in words", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 7, 4));
    heroStartingOn("2026-08-04");
    expect(await screen.findByText("today")).toBeTruthy();
  });

  // The hero never invents a date it has not been given: a trip with no start
  // date gets its created line and no countdown, rather than a countdown to
  // when somebody made the trip.
  it("shows no countdown at all for a trip with no start date", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 7, 4));
    const trip = heroStartingOn(null);

    await screen.findByRole("heading", { level: 2, name: trip.name });
    expect(screen.queryByText(/days ago|in \d+ days|^today$|^tomorrow$/)).toBeNull();
  });
});

// M37: the hero is usually where a NEW trip lands (it is the newest undated
// trip), so the unplanned state has to be here as well as on the card.
describe("NextTripHero — length, stops and the unplanned trip", () => {
  const unplanned = (overrides: Partial<TripSummary> = {}) =>
    tripSummaryFixture({
      members: [{ userId: "dev-alice", role: "owner" }],
      dayCount: 0,
      stopCount: 0,
      ideaCount: 0,
      ...overrides,
    });

  // With the year, as a range and as the card say it.
  it("says the trip's dates, length and stops", () => {
    fetchTripDetailMock.mockReturnValue(new Promise(() => {}));
    render(<NextTripHero trip={tripSummaryFixture({ startDate: "2026-10-01", dayCount: 1, stopCount: 3 })} />);
    expect(screen.getByText("Thu, Oct 1, 2026 · 1 day · 3 stops")).toBeTruthy();
  });

  // The header's *Add stop* parks a stop in the backlog (PR #351 review).
  it("reads a trip with ideas but no stops as started: its ideas, and Open trip", () => {
    fetchTripDetailMock.mockReturnValue(new Promise(() => {}));
    render(<NextTripHero trip={unplanned({ ideaCount: 4 })} viewerId="dev-alice" />);

    expect(screen.getByText(/· 4 ideas, none on a day yet$/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /open trip/i })).toBeTruthy();
    expect(screen.queryByText(/A blank trip/)).toBeNull();
    expect(screen.queryByRole("link", { name: /Add the first|Invite who's coming/ })).toBeNull();
  });

  // From the summary, on the first frame: the detail is still loading here,
  // and the next steps do not wait for it.
  it("gives an owner planning alone the first day and the invite before the detail loads", () => {
    fetchTripDetailMock.mockReturnValue(new Promise(() => {}));
    const trip = unplanned();
    render(<NextTripHero trip={trip} viewerId="dev-alice" />);

    expect(screen.getByText("No dates yet · nothing planned yet")).toBeTruthy();
    expect(
      screen.getByText(
        "A blank trip. Start with the first day, or bring in the people you're going with so they can plan alongside you.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Add the first day" }).getAttribute("href")).toBe(
      `/trips/${trip.tripId}?view=Plan`,
    );
    expect(screen.getByRole("link", { name: "Invite who's coming" }).getAttribute("href")).toBe(
      `/trips/${trip.tripId}?settings=people`,
    );
    expect(screen.getByRole("link", { name: "Choose a cover photo" }).getAttribute("href")).toBe(
      `/trips/${trip.tripId}?settings=cover`,
    );
    expect(screen.queryByRole("link", { name: /open trip/i })).toBeNull();
    // Undated: the panel says what fills it, with no rows to fill.
    expect(screen.getByText("Each day fills in as you add stops.")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Days with nothing planned" })).toBeNull();
  });

  it("draws an empty row per dated day, and offers the first stop", () => {
    fetchTripDetailMock.mockReturnValue(new Promise(() => {}));
    render(
      <NextTripHero
        trip={unplanned({ startDate: "2026-10-30", endDate: "2026-11-01", dayCount: 3 })}
        viewerId="dev-alice"
      />,
    );
    const rows = within(screen.getByRole("list", { name: "Days with nothing planned" })).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual(["Fri, Oct 30", "Sat, Oct 31", "Sun, Nov 1"]);
    expect(screen.getByText("Oct 30 – Nov 1, 2026 · 3 days · nothing planned yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Add the first stop/ })).toBeTruthy();
  });

  // The rows date from the start the hero shows, which is the detail's once
  // it lands — not a summary start the meta row above has already replaced.
  it("dates the empty rows from the detail's start once it lands", async () => {
    const trip = unplanned({ startDate: "2026-10-30", endDate: "2026-11-01", dayCount: 3 });
    fetchTripDetailMock.mockResolvedValue({
      ok: true,
      value: tripDetailFixture({ tripId: trip.tripId, startDate: "2026-11-05" }),
    });
    render(<NextTripHero trip={trip} viewerId="dev-alice" />);

    await screen.findByText(/^Thu, Nov 5, 2026 ·/);
    const rows = within(screen.getByRole("list", { name: "Days with nothing planned" })).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual(["Thu, Nov 5", "Fri, Nov 6", "Sat, Nov 7"]);
  });

  it("does not nudge an owner who is not alone", () => {
    fetchTripDetailMock.mockReturnValue(new Promise(() => {}));
    const trip = unplanned({
      members: [
        { userId: "dev-alice", role: "owner" },
        { userId: "dev-bob", role: "viewer" },
      ],
    });
    render(<NextTripHero trip={trip} viewerId="dev-alice" />);
    expect(screen.getByText("A blank trip. Start with the first day.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Add the first day/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Invite who's coming/ })).toBeNull();
  });

  it("tells a reader it was shared with that nothing is planned, and only opens the trip", () => {
    fetchTripDetailMock.mockReturnValue(new Promise(() => {}));
    const trip = unplanned();
    render(<NextTripHero trip={trip} viewerId="dev-bob" />);
    expect(screen.getByText("Nothing planned yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /open trip/i })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Add the first|Invite who's coming/ })).toBeNull();
  });

  // The cover is an editor's call, where planning actions are the owner's.
  it.each([
    ["an editor", "editor", true],
    ["a suggester", "suggester", false],
    ["a viewer", "viewer", false],
  ] as const)("offers %s it was shared with a cover photo only if they may set one", (_label, role, offered) => {
    fetchTripDetailMock.mockReturnValue(new Promise(() => {}));
    const trip = unplanned({
      members: [
        { userId: "dev-alice", role: "owner" },
        { userId: "dev-bob", role },
      ],
    });
    render(<NextTripHero trip={trip} viewerId="dev-bob" />);
    // Witness: this is the shared reader's state, whatever their role.
    expect(screen.getByText("Nothing planned yet.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Choose a cover photo" }) !== null).toBe(offered);
  });

  it("stops offering a cover photo once the trip has one", () => {
    fetchTripDetailMock.mockReturnValue(new Promise(() => {}));
    render(<NextTripHero trip={unplanned({ cover: tripCoverFactory.build() })} viewerId="dev-alice" />);
    expect(screen.getByRole("link", { name: "Add the first day" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Choose a cover photo" })).toBeNull();
  });

  // The session probe still in flight: neither the reader's line nor the
  // owner's actions, so neither one is replaced by the other a moment later.
  it("says and offers nothing while the reader is not yet known", () => {
    fetchTripDetailMock.mockReturnValue(new Promise(() => {}));
    render(<NextTripHero trip={unplanned()} viewerId={undefined} />);
    expect(screen.queryByText("Nothing planned yet.")).toBeNull();
    expect(screen.queryByRole("link", { name: /Add the first|Invite who's coming|open trip|cover photo/i })).toBeNull();
  });

  // A backlog over budget is a decision on a trip with no stops.
  it("still says what an unplanned trip needs decided, once the detail lands", async () => {
    const trip = unplanned();
    fetchTripDetailMock.mockResolvedValue({
      ok: true,
      value: tripDetailFixture({
        tripId: trip.tripId,
        conflicts: [{ id: "c1", kind: "budget", severity: "error", subjects: [], description: "Over budget", resolutions: [] }],
      }),
    });
    render(<NextTripHero trip={trip} viewerId="dev-alice" />);

    expect(await screen.findByRole("link", { name: "1 needs a decision" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Add the first day/ })).toBeTruthy();
  });

  it("offers a planned trip no next step", async () => {
    const trip = tripSummaryFixture();
    fetchTripDetailMock.mockResolvedValue({ ok: true, value: tripDetailWithDays(trip.tripId) });
    render(<NextTripHero trip={trip} viewerId="dev-alice" />);

    await screen.findByText(/No budget yet|planned of/);
    expect(screen.queryByRole("link", { name: /Add the first|Invite who's coming/ })).toBeNull();
    expect(screen.queryByText(/nothing planned/i)).toBeNull();
  });
});

// M37 part 4: the approved canvas's hero with a cover — the photo as a band,
// credited, and the hero unchanged without one.
describe("NextTripHero — a cover", () => {
  it("shows the cover eagerly, with its alt text and a linked credit", () => {
    fetchTripDetailMock.mockReturnValue(new Promise(() => {}));
    const cover = tripCoverFactory.build({ alt: "Maples over a temple roof", photographerName: "Aiko Tanaka" });
    const trip = tripSummaryFixture({ cover });
    render(<NextTripHero trip={trip} />);

    const hero = screen.getByTestId("next-trip-hero");
    const photo = within(hero).getByRole("img", { name: "Maples over a temple roof" });
    // The top of Home: never lazy, or it pops in after the page has painted.
    expect(photo.getAttribute("loading")).toBe("eager");
    expect(within(hero).getByText((_, el) => el?.tagName === "P" && el.textContent === "Photo by Aiko Tanaka on Unsplash")).toBeTruthy();
    expect(within(hero).getByRole("link", { name: "Aiko Tanaka" }).getAttribute("href")).toBe(
      `${cover.photographerUrl}?utm_source=caesura&utm_medium=referral`,
    );
    // The name is still the way in, over the fade.
    expect(within(hero).getByRole("link", { name: trip.name }).getAttribute("href")).toBe(`/trips/${trip.tripId}`);
  });

  it("draws no photo and no credit without a cover", () => {
    fetchTripDetailMock.mockReturnValue(new Promise(() => {}));
    render(<NextTripHero trip={tripSummaryFixture()} />);
    const hero = screen.getByTestId("next-trip-hero");
    // Witness: the hero rendered.
    expect(within(hero).getByText("Next trip")).toBeTruthy();
    expect(within(hero).queryByRole("img")).toBeNull();
    expect(within(hero).queryByText(/Photo by/)).toBeNull();
  });
});
