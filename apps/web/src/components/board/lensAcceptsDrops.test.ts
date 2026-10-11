import { describe, expect, it } from "vitest";
import { VIEWS } from "@/components/trip/context/LensRouter";
import { lensAcceptsDrops } from "./lensAcceptsDrops";

describe("lensAcceptsDrops", () => {
  // SPEC §24 renamed Board to Plan and deleted Timeline. M41 D2 gave Calendar
  // drop targets, so the drawer comes to it, as this function exists to make
  // happen by itself.
  it("is true for Plan and Calendar, the views with drop targets", () => {
    expect(lensAcceptsDrops("Plan")).toBe(true);
    expect(lensAcceptsDrops("Overview")).toBe(false);
    expect(lensAcceptsDrops("Calendar")).toBe(true);
    expect(lensAcceptsDrops("Map")).toBe(false);
  });

  // Guards the rule rather than the current answer. RULES.md 2 gates the
  // Unscheduled drawer on whether a stop can be dropped onto the page, and the
  // whole reason this is a function is so that adding a drop target to Calendar
  // brings the drawer back by changing one thing. A new view that nobody
  // classifies would silently inherit "no drawer" — which is the safe default,
  // but it should be a decision, not an accident.
  it("has an answer for every view the router can produce", () => {
    for (const view of VIEWS) {
      expect(typeof lensAcceptsDrops(view)).toBe("boolean");
    }
  });

  // Overview is read-only by definition (§24: "Read only — nothing on it
  // edits"), so it is the one view where a drawer would be wrong even if it
  // grew a drop target. Stated separately from the sweep above because it is a
  // design decision rather than a reflection of today's wiring.
  it("never offers the drawer on Overview, which does not edit at all", () => {
    expect(lensAcceptsDrops("Overview")).toBe(false);
  });
});
