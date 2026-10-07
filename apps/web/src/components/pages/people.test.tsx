import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { tripDetailFactory } from "@tc/factories";
import { MacroView } from "./MacroView";
import { PeopleProvider, peopleNamesOf } from "./people";

// The names "Who owes what" and "What one person is in for" print (M19 part 2)
// come from the People section's access read, through `PeopleProvider`, into the
// widget's context. Each test takes its own trip id: the read goes through the
// shared cache, which would otherwise carry one test's members into the next.

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
      { userId: "u-ana", role: "owner", name: "Ana Lima", email: "ana@example.com", image: null, displayName: null, avatar: null, color: null },
      { userId: "u-ben-4f2a91", role: "editor", name: null, email: "ben@example.com", image: null, displayName: null, avatar: null, color: null },
    ])).toEqual({ "u-ana": "Ana Lima", "u-ben-4f2a91": "Traveler 4f2a91" });
  });
});
