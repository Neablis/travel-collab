import { describe, expect, it } from "vitest";
import { SYSTEM_ACTOR_ID, newPageDoc, seedKeyOf } from "@tc/contracts";
import { DEFAULT_TEMPLATES } from "./templates";
import { seedTemplateOf } from "./defaultNotebooks";

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
