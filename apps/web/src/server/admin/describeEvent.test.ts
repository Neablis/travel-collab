// `describeEvent` labels and never interprets: a verb from the type, the trip's
// name, at most a title the payload carries as a string — and a fallback that
// is true of any event, so a type nobody listed still reads as a sentence.
import { describe, expect, it } from "vitest";
import { describeEvent } from "./describeEvent";

describe("describeEvent", () => {
  it("puts a verb on a known type and names the trip", () => {
    expect(describeEvent("TripCreated", {}, "Japan")).toBe("Created Japan");
    expect(describeEvent("ActivityMoved", { activityId: "a" }, "Japan")).toBe("Moved a stop in Japan");
  });

  it("quotes a title only when the payload carries one as a string", () => {
    expect(describeEvent("ActivityAdded", { title: "Gion at dusk" }, "Japan")).toBe("Added “Gion at dusk” to Japan");
    expect(describeEvent("ActivityAdded", { title: 7 }, "Japan")).toBe("Added a stop to Japan");
    expect(describeEvent("PageCreated", null, "Japan")).toBe("Started a page in Japan");
  });

  it("falls back to a sentence true of every event", () => {
    expect(describeEvent("SomethingNew", { anything: true }, "Japan")).toBe("Changed Japan");
    expect(describeEvent("SomethingNew", {}, null)).toBe("Changed a trip");
  });
});
