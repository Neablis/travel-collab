import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { TripAccess } from "@tc/contracts";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { tripAccessFixture, tripDetailFactory, tripMemberProfileFactory } from "@tc/factories";
import { MacroView } from "./MacroView";
import { PeopleProvider, peopleNamesOf, usePersonas } from "./people";

// The names "Who owes what" and "What one person is in for" print (M19 part 2)
// come from the People section's access read, through `PeopleProvider`, into the
// widget's context. Each test takes its own trip id: the read goes through the
// shared cache, which would otherwise carry one test's members into the next.

// What `useOptionalTrip` answers: `null` (no trip around this notebook) unless
// a test puts a `TripProvider`'s live access in place.
let liveTrip: { tripId: string; access: TripAccess | null } | null = null;
vi.mock("@/components/trip/context/TripProvider", () => ({ useOptionalTrip: () => liveTrip }));

const server = setupServer(
  http.get("/api/trips/:tripId/access", ({ params }) =>
    HttpResponse.json({
      access: {
        tripId: params.tripId,
        myRole: "owner",
        members: [
          { userId: "u-ana", role: "owner", name: "Ana Lima", email: "ana@example.com", image: null, displayName: null, avatar: null, color: null },
          // No name: the one member whose only identifier is an address.
          { userId: "u-ben-4f2a91", role: "editor", name: null, email: "ben@example.com", image: null, displayName: null, avatar: null, color: null },
        ],
        invites: [],
        collaboratorsEntitled: true,
      },
    }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  liveTrip = null;
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

/** A trip of those two members with one $30-a-head stop for both, booked by Ana. */
function tripOf() {
  const base = tripDetailFactory.build({}, { transient: { dayCount: 1, activitiesPerDay: 1, unscheduledCount: 0 } });
  const trip = {
    ...base,
    tripId: crypto.randomUUID(),
    currency: "USD",
    members: [{ userId: "u-ana", role: "owner" as const }, { userId: "u-ben-4f2a91", role: "editor" as const }],
  };
  const id = trip.days[0]!.activityIds[0]!;
  trip.activities = {
    ...trip.activities,
    [id]: { ...trip.activities[id]!, cost: { amountMinor: 30_00, currency: "USD" }, participants: [], bookedBy: "u-ana" },
  };
  return trip;
}

describe("PeopleProvider", () => {
  it("hands a notebook widget each member's name", async () => {
    const trip = tripOf();
    render(
      <PeopleProvider tripId={trip.tripId}>
        <MacroView detail={trip} context={{ tripId: trip.tripId }} name="person.share" params={{ who: "u-ana" }} />
      </PeopleProvider>,
    );
    expect(await screen.findByText("Ana Lima")).toBeTruthy();
  });

  it("never prints a member's email into a page, and never their raw id", () => {
    // A notebook is shared with every collaborator; the address is not theirs to read.
    expect(peopleNamesOf([
      { userId: "u-ana", role: "owner", name: "Ana Lima", email: "ana@example.com", image: null, displayName: null, avatar: null, color: null, colorShifted: false },
      { userId: "u-ben-4f2a91", role: "editor", name: null, email: "ben@example.com", image: null, displayName: null, avatar: null, color: null, colorShifted: false },
    ])).toEqual({ "u-ana": "Ana Lima", "u-ben-4f2a91": "Traveler 4f2a91" });
  });

  // M38: a trip names a person by what they chose, ahead of the name their
  // sign-in provider overwrites on every sign-in.
  it("names a member by the name they chose, ahead of their sign-in name", () => {
    expect(peopleNamesOf([
      tripMemberProfileFactory.build({ userId: "u-ana", name: "Ana Lima", displayName: "Nana" }),
    ])).toEqual({ "u-ana": "Nana" });
  });

  // M38: what a person chip will draw — the name, the avatar, and the colour
  // this trip shows them in, with whether it was shifted — by userId, from the
  // same read the names come from. No address.
  it("hands each member's persona to whoever asks for it", async () => {
    const tripId = crypto.randomUUID();
    server.use(
      http.get("/api/trips/:tripId/access", () =>
        HttpResponse.json({
          access: tripAccessFixture({
            tripId,
            members: [
              tripMemberProfileFactory.build({ userId: "u-ana", role: "owner", name: "Ana Lima", email: "ana@example.com", displayName: "Nana", avatar: "compass", color: "plum", colorShifted: true }),
              tripMemberProfileFactory.build({ userId: "u-ben-4f2a91", email: "ben@example.com" }),
            ],
          }),
        }),
      ),
    );
    let seen: ReturnType<typeof usePersonas> = null;
    function Probe() {
      seen = usePersonas();
      return seen === null ? null : <p>ready</p>;
    }
    render(
      <PeopleProvider tripId={tripId}>
        <Probe />
      </PeopleProvider>,
    );
    await screen.findByText("ready");
    expect(seen).toEqual({
      "u-ana": { name: "Nana", avatar: "compass", color: "plum", colorShifted: true, travelling: true },
      "u-ben-4f2a91": { name: "Traveler 4f2a91", avatar: null, color: null, colorShifted: false, travelling: true },
    });
  });

  // Inside the trip's own `TripProvider`, which re-reads access whenever the
  // poll's `accessRev` moves: a name changed since this provider's own cached
  // read reaches History and the suggestion chips along with everything else.
  it("follows the trip's live access when it is newer than its own read", async () => {
    const tripId = crypto.randomUUID();
    const read = (accessRev: string, name: string) =>
      tripAccessFixture({ tripId, accessRev, members: [tripMemberProfileFactory.build({ userId: "u-ana", role: "owner", name })] });
    server.use(http.get("/api/trips/:tripId/access", () => HttpResponse.json({ access: read("1", "Ana Lima") })));
    function Probe() {
      const personas = usePersonas();
      return <p>{personas?.["u-ana"]?.name ?? "loading"}</p>;
    }
    liveTrip = { tripId, access: null };
    const view = render(
      <PeopleProvider tripId={tripId}>
        <Probe />
      </PeopleProvider>,
    );
    expect(await screen.findByText("Ana Lima")).toBeTruthy();

    liveTrip = { tripId, access: read("2", "Nana") };
    view.rerender(
      <PeopleProvider tripId={tripId}>
        <Probe />
      </PeopleProvider>,
    );
    expect(await screen.findByText("Nana")).toBeTruthy();
  });
});
