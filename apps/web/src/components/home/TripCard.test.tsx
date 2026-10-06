import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TripSummary } from "@tc/contracts";
import { tripCoverFactory, tripSummaryFactory } from "@tc/factories";
import { TripCard } from "./TripCard";

afterEach(() => {
  cleanup();
});

function tripSummaryFixture(overrides: Partial<TripSummary> = {}): TripSummary {
  return tripSummaryFactory.build({
    tripId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f",
    name: "Iceland Ring Road",
    // Planned, so the cost slot is the cost slot: an unplanned trip puts its
    // next steps there instead (M37), which would let the absence tests below
    // pass on a card that never had a cost line to show.
    dayCount: 3,
    stopCount: 5,
    ...overrides,
  });
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
    // eslint-disable-next-line no-restricted-syntax -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
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

  // Travellers spec §5: a member who joined to advise is on the trip, not on
  // the road, so the stack names and shows the travellers only.
  it("counts and shows the travellers, not every member", () => {
    const trip = tripSummaryFixture({
      members: [...twoMemberTrip().members, { userId: "dev-carol", role: "suggester", travelling: false }],
    });
    render(<TripCard trip={trip} />);

    // The avatars are aria-hidden, so what a reader sees is their initials.
    const group = screen.getByRole("group", { name: "2 travelers" });
    expect(within(group).getByText("AL")).toBeTruthy();
    expect(within(group).getByText("BO")).toBeTruthy();
    expect(within(group).queryByText("CA")).toBeNull();
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

  // Task 8.5's own verbatim test, skipped until KI-034 put a start date on
  // TripSummary. A trip with one shows it; a trip without one keeps the
  // honest "Created …" line (the test above) rather than a fabricated date.
  it("shows the trip's dates rather than its creation date", () => {
    const trip = tripSummaryFixture({ startDate: "2026-10-01" });
    render(<TripCard trip={trip} />);
    expect(screen.getByText(/^Thu, Oct 1, 2026/)).toBeTruthy();
    expect(screen.queryByText(/^Created /)).toBeNull();
  });
});

// M37: the card says the trip's length and stops, and a trip with nothing
// planned gets a designed state — its dates or "No dates yet", next steps for
// its owner, a nudge to invite while they plan alone — instead of reading like
// a full card with the facts missing (D6).
describe("TripCard — length, stops and the unplanned trip", () => {
  const unplanned = (overrides: Partial<TripSummary> = {}) =>
    tripSummaryFixture({ dayCount: 0, stopCount: 0, ...overrides });

  it("says the trip's dates, length and stops, in the singular for one", () => {
    const { unmount } = render(
      <TripCard trip={tripSummaryFixture({ startDate: "2026-10-01", endDate: "2026-10-05", dayCount: 5, stopCount: 12 })} />,
    );
    expect(screen.getByText("Oct 1 – Oct 5, 2026 · 5 days · 12 stops")).toBeTruthy();
    unmount();

    render(<TripCard trip={tripSummaryFixture({ startDate: "2026-10-01", endDate: "2026-10-01", dayCount: 1, stopCount: 1 })} />);
    expect(screen.getByText("Thu, Oct 1, 2026 · 1 day · 1 stop")).toBeTruthy();
  });

  it("gives an owner planning alone the first day and the invite, and no cost line or badge", () => {
    const trip = unplanned();
    render(<TripCard trip={trip} plannedOfBudget="$0.00 planned of $1,640.00" viewerId="dev-alice" />);

    expect(screen.getByText("No dates yet · nothing planned yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Add the first day" }).getAttribute("href")).toBe(
      `/trips/${trip.tripId}?view=Plan`,
    );
    expect(screen.getByRole("link", { name: "Invite who's coming" }).getAttribute("href")).toBe(
      `/trips/${trip.tripId}?settings=people`,
    );
    expect(screen.getByRole("link", { name: "Choose a cover photo" }).getAttribute("href")).toBe(
      `/trips/${trip.tripId}?settings=cover`,
    );
    expect(screen.queryByText(/planned of/)).toBeNull();
    expect(screen.queryByText("Active")).toBeNull();
  });

  // Setting dates makes days, so a dated trip with no stops has days to fill.
  it("offers a dated trip with days its first stop, not its first day", () => {
    render(
      <TripCard
        trip={unplanned({ startDate: "2026-10-01", endDate: "2026-10-05", dayCount: 5 })}
        viewerId="dev-alice"
      />,
    );
    expect(screen.getByText("Oct 1 – Oct 5, 2026 · 5 days · nothing planned yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Add the first stop" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Add the first day" })).toBeNull();
  });

  it("does not nudge an owner who is not alone", () => {
    const trip = unplanned({
      members: [
        { userId: "dev-alice", role: "owner" },
        { userId: "dev-bob", role: "editor" },
      ],
    });
    render(<TripCard trip={trip} viewerId="dev-alice" />);
    expect(screen.getByRole("link", { name: "Add the first day" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Invite who's coming" })).toBeNull();
  });

  it.each([
    ["a reader it was shared with", "dev-bob"],
    ["a reader not yet known", undefined],
  ] as const)("tells %s nothing is planned, with no actions", (_label, viewerId) => {
    render(<TripCard trip={unplanned()} viewerId={viewerId} />);
    expect(screen.getByText("Nothing planned yet.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Add the first|Invite who's coming/ })).toBeNull();
  });

  it("offers a planned trip no next step", () => {
    render(<TripCard trip={tripSummaryFixture()} viewerId="dev-alice" />);
    expect(screen.queryByRole("link", { name: /Add the first|Invite who's coming/ })).toBeNull();
    expect(screen.queryByText(/nothing planned/i)).toBeNull();
  });
});

// M37 part 4: the approved canvas's card with a cover — the photo as a strip,
// credited where the badge was — and part 2's card, unchanged, without one.
describe("TripCard — a cover", () => {
  it("leads with the cover, lazily, credited and linked, with its menu still there", () => {
    const cover = tripCoverFactory.build({ alt: null, photographerName: "Rui Matos" });
    const trip = tripSummaryFixture({ cover });
    render(<TripCard trip={trip} menuSlot={<button aria-label={`Trip actions for ${trip.name}`} />} />);

    // No alt from Unsplash: who took it, instead (plan rule 8).
    const photo = screen.getByRole("img", { name: "Photo by Rui Matos" });
    expect(photo.getAttribute("loading")).toBe("lazy");
    expect(screen.getByRole("link", { name: "Rui Matos" }).getAttribute("href")).toBe(
      `${cover.photographerUrl}?utm_source=caesura&utm_medium=referral`,
    );
    expect(screen.getByRole("link", { name: "Unsplash" }).getAttribute("href")).toBe(
      "https://unsplash.com/?utm_source=caesura&utm_medium=referral",
    );
    expect(screen.getByRole("link", { name: trip.name })).toBeTruthy();
    expect(screen.getByRole("button", { name: `Trip actions for ${trip.name}` })).toBeTruthy();
  });

  it("draws no photo and no credit without a cover", () => {
    render(<TripCard trip={tripSummaryFixture()} />);
    // Witness: part 2's card, accent bar and badge.
    expect(screen.getByTestId("accent-bar")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText(/Photo by/)).toBeNull();
  });
});
