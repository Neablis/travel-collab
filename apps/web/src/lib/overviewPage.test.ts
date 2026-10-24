import { describe, expect, it } from "vitest";
import type { PageSummary } from "@tc/contracts";
import { instantiateDefaults } from "@tc/pages";
import { pickOverviewPage } from "./overviewPage";

// M52 decision 11, as amended at scoping (2026-10-23): the Overview tab shows
// Today from *soon* (three days before the start) through the end date, and
// the Overview notebook otherwise. One pick, read by the lens and the server.

const TRIP = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
let n = 0;
// A new trip's notebooks, as the seeder makes them.
const seeded: PageSummary[] = instantiateDefaults(TRIP, () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`).map((p) => ({
  id: p.id, tripId: TRIP, title: p.title, context: p.context, seedKey: p.seedKey,
  createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", actorId: "system",
}));
const keyOf = (pick: ReturnType<typeof pickOverviewPage>) => (pick.ok ? pick.page.seedKey : pick.message);

describe("pickOverviewPage", () => {
  it("shows the Overview while planning and once the trip has ended, and Today when it is soon and under way", () => {
    expect(keyOf(pickOverviewPage(seeded, null, "planning"))).toBe("overview");
    expect(keyOf(pickOverviewPage(seeded, null, "soon"))).toBe("today");
    expect(keyOf(pickOverviewPage(seeded, null, "underway"))).toBe("today");
    expect(keyOf(pickOverviewPage(seeded, null, "ended"))).toBe("overview");
  });

  it("shows the Overview when the phase is not known yet, or the trip has no Today", () => {
    expect(keyOf(pickOverviewPage(seeded, null, null))).toBe("overview");
    expect(keyOf(pickOverviewPage(seeded.filter((p) => p.seedKey !== "today"), null, "underway"))).toBe("overview");
  });

  // *Whole trip →* is a link to the Overview by id, so it must win over the swap.
  it("shows a linked notebook whatever the phase", () => {
    const overview = seeded.find((p) => p.seedKey === "overview")!;
    expect(keyOf(pickOverviewPage(seeded, overview.id, "underway"))).toBe("overview");
  });
});
