import { describe, expect, it } from "vitest";
import { SYSTEM_ACTOR_ID, newPageDoc, seedKeyOf } from "@tc/contracts";
import { DEFAULT_TEMPLATES } from "./templates";
import { instantiateMissingDefaults, seedTemplateOf } from "./defaultNotebooks";

const TRIP = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";

// `seedKeyOf` reads the key an event from before seed keys implies, off a
// frozen table in @tc/contracts that cannot import the templates. Every key it
// can produce must name a default template, or a trip that predates the key
// has a seed nothing recognises: no Reset, and "Add missing" plants a copy.
describe("the seed key an old PageCreated implies", () => {
  it("names a default template, for each title seeded when keys arrived and for the Overview", () => {
    const implied = ["Overview", "Before you go", "Bookings", "Money"].map((title) =>
      seedKeyOf({
        tripId: TRIP,
        pageId: TRIP,
        title,
        context: { tripId: TRIP, ...(title === "Overview" ? { kind: "overview" as const } : {}) },
        content: newPageDoc(),
        actorId: SYSTEM_ACTOR_ID,
      }).key,
    );
    expect(implied.map((key) => seedTemplateOf({ id: TRIP, seedKey: key })?.key)).toEqual(DEFAULT_TEMPLATES.map((t) => t.key));
  });
});

// A link card to a missing default adds the notebook it points at and no other
// (Mitchell, 2026-10-03), through the same builder the index's button uses.
describe("instantiateMissingDefaults, narrowed to one template", () => {
  const overview = { id: "00000000-0000-4000-8000-000000000001", seedKey: "overview" };

  it("builds only that template's seed, leaving the other missing ones missing", () => {
    const seeds = instantiateMissingDefaults(TRIP, [overview], () => crypto.randomUUID(), [], "money");
    expect(seeds.map((s) => s.seedKey)).toEqual(["money"]);
  });

  it("builds nothing for a default the trip already has, or a key no default has", () => {
    const money = { id: "00000000-0000-4000-8000-000000000002", seedKey: "money" };
    expect(instantiateMissingDefaults(TRIP, [overview, money], () => crypto.randomUUID(), [], "money")).toEqual([]);
    expect(instantiateMissingDefaults(TRIP, [overview], () => crypto.randomUUID(), [], "no-such-default")).toEqual([]);
  });
});
