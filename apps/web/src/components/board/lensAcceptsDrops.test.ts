import { describe, expect, it } from "vitest";
import { LENSES } from "@/components/trip/context/LensRouter";
import { lensAcceptsDrops } from "./lensAcceptsDrops";

describe("lensAcceptsDrops", () => {
  it("is true only for Board, which is the only lens with drop targets today", () => {
    expect(lensAcceptsDrops("Board")).toBe(true);
    expect(lensAcceptsDrops("Schedule")).toBe(false);
    expect(lensAcceptsDrops("Map")).toBe(false);
  });

  // Guards the rule rather than the current answer. RULES.md 2 gates the
  // Unscheduled drawer on whether a stop can be dropped onto the page, and the
  // whole reason this is a function is so that adding a drop target to
  // Timeline/Calendar brings the drawer back by changing one thing. A new lens
  // that nobody classifies would silently inherit "no drawer" — which is the
  // safe default, but it should be a decision, not an accident.
  it("has an answer for every lens the router can produce", () => {
    for (const lens of LENSES) {
      expect(typeof lensAcceptsDrops(lens)).toBe("boolean");
    }
  });
});
