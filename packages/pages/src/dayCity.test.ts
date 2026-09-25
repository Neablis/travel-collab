import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { dayCity } from "./dayCity";

type Activity = TripDetail["activities"][string];

function stop(
  id: string,
  location: Activity["location"],
  endLocation: Activity["endLocation"] = null,
): Activity {
  return {
    activityId: id,
    title: id,
    timeWindow: null,
    location,
    notes: null,
    anchors: [],
    kind: endLocation ? "transit" : "planned",
    tags: [],
    cost: null,
    bookedBy: null,
    participants: [],
    mode: endLocation ? "train" : null,
    endLocation,
  };
}

const day = (activityIds: string[]) => ({ dayId: "d1", activityIds, date: null, costSubtotal: 0 });

// M24 (Mitchell, 2026-09-25). The day is named for where it ENDS, so a leg
// that ends the day names it by its destination, not the station it left.
describe("dayCity and a transit stop's destination (M24)", () => {
  it("names the day by the last leg's destination city", () => {
    const activities = {
      s: stop("s", { name: "Odawara Station", city: "Odawara" }, { name: "Kyoto Station", city: "Kyoto" }),
    };
    expect(dayCity(day(["s"]), activities)).toBe("Kyoto");
  });

  it("falls back to the destination's area, never its name", () => {
    const activities = {
      s: stop("s", { name: "Uno Port", city: "Tamano" }, { name: "Miyanoura Port", area: "Naoshima" }),
    };
    expect(dayCity(day(["s"]), activities)).toBe("Naoshima");
  });

  it("uses the origin when the destination names no city or area", () => {
    const activities = {
      s: stop("s", { name: "Uno Port", city: "Tamano" }, { name: "Somewhere at sea" }),
    };
    expect(dayCity(day(["s"]), activities)).toBe("Tamano");
  });

  it("skips a leg that returns to where the day started, so a day trip keeps its city", () => {
    const activities = {
      out: stop("out", { name: "Asakusa Station", city: "Tokyo" }, { name: "Tobu-Nikko Station", city: "Nikko" }),
      shrine: stop("shrine", { name: "Toshogu", city: "Nikko" }),
      back: stop("back", { name: "Tobu-Nikko Station", city: "Nikko" }, { name: "Asakusa Station", city: "Tokyo" }),
    };
    expect(dayCity(day(["out", "shrine", "back"]), activities)).toBe("Nikko");
  });
});
