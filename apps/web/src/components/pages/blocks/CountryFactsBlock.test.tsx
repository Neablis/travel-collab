import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderMacro } from "@tc/pages";
import { tripDetailFactory } from "@tc/factories";
import { CountryFactsBlock } from "./CountryFactsBlock";

afterEach(cleanup);

// The table says `null` where it is not sure of an emergency number, and the
// card must print a dash there. A blank cell under "Emergency" reads as a
// rendering fault at best, and at worst as "there is no number".
describe("CountryFactsBlock", () => {
  it("prints a dash for a fact the table is not sure of, and the number where it is", () => {
    const trip = tripDetailFactory.build({}, { transient: { dayCount: 1, activitiesPerDay: 2 } });
    const [first, second] = trip.days[0]!.activityIds as [string, string];
    trip.activities[first] = { ...trip.activities[first]!, location: { name: "Kyoto", countryCode: "JP" } };
    // Turkmenistan: the table carries `emergency: null`.
    trip.activities[second] = { ...trip.activities[second]!, location: { name: "Ashgabat", countryCode: "TM" } };
    const outcome = renderMacro({ trip, page: { tripId: trip.tripId }, user: null, globals: null, today: null }, "country.facts", {});
    if (outcome.status !== "ok" || outcome.rendered.kind !== "block" || outcome.rendered.block.kind !== "country-facts") {
      throw new Error(`expected a country-facts block, got ${outcome.status}`);
    }

    render(<CountryFactsBlock payload={outcome.rendered.block} />);

    const emergencyOf = (country: string) => {
      const card = within(screen.getByRole("listitem", { name: country }));
      const index = card.getAllByRole("term").findIndex((term) => term.textContent === "Emergency");
      return card.getAllByRole("definition")[index]!.textContent;
    };
    expect(emergencyOf("Japan")).toBe("110 · 119");
    expect(emergencyOf("Turkmenistan")).toBe("—");
  });
});
