import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import { MacroView } from "../MacroView";
import { FixedPeopleProvider, type Persona } from "../people";

afterEach(cleanup);

// "Who's going" through the notebook's own renderer: `MacroView` reads the
// personas from the people context and `BlockView` hands the payload here.
// What the resolver decides (who, in what words) is `tripPeople.test.ts`'s;
// this holds that the chips and the sentence reach the screen.

function tripOf(ids: readonly string[]): TripDetail {
  return tripDetailFactory.build(
    { members: ids.map((userId, i) => ({ userId, role: i === 0 ? "owner" : "editor" })) },
    { transient: { dayCount: 1, activitiesPerDay: 0, unscheduledCount: 0 } },
  );
}

const persona = (name: string, extra: Partial<Persona> = {}): Persona => ({
  name, avatar: null, color: null, colorShifted: false, travelling: true, ...extra,
});

describe("TripPeopleBlock", () => {
  it("draws a chip for each person the sentence names, then the sentence", () => {
    const trip = tripOf(["o", "a", "b", "c"]);
    render(
      <FixedPeopleProvider
        personas={{
          o: persona("Dana Reyes"),
          a: persona("Sam Okafor", { color: "plum" }),
          b: persona("Priya Nair"),
          // Travelling by `trip.members`, planning by her persona: the persona
          // is what `MacroView` must hand the widget.
          c: persona("Mei Lin", { travelling: false }),
        }}
      >
        <MacroView detail={trip} context={{ tripId: trip.tripId }} name="trip.people" params={{}} />
      </FixedPeopleProvider>,
    );
    expect(screen.getByText("Sam and Priya are going with Dana.")).toBeTruthy();
    // The chips are decorative (the names are in the sentence); their full
    // names ride as titles, for a pointer.
    expect(screen.getAllByTitle(/.+/).map((chip) => chip.getAttribute("title"))).toEqual(["Sam Okafor", "Priya Nair"]);
  });
});
