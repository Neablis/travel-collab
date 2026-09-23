import { describe, expect, it } from "vitest";
import { mapPanel, mapTitle, minutesLabel } from "./sharedDayFacts";
import type { DayGeometry, MapPoint } from "./sharedDayGeometry";

// Kyoto, roughly. Latitudes near 35 keep a degree of longitude ~91km, so the
// distances below are chosen to land either side of the 1.6km ride threshold
// rather than to be pretty.
/** A located stop at a given number and position. */
const p = (number: number, lat: number, lng: number): MapPoint => ({ number, title: `stop ${number}`, lat, lng, dayIndex: 0 });

/** A day whose legs are all real. `skip` marks a leg as spanning an unlocated stop. */
function day(points: MapPoint[], skip: readonly number[] = []): DayGeometry {
  const legs = points.slice(0, -1).map((from, i) => ({ from, to: points[i + 1]!, contiguous: !skip.includes(i) }));
  return { dayIndex: 0, points, legs };
}

describe("minutesLabel", () => {
  it("keeps minutes under an hour and switches to hours above it", () => {
    expect(minutesLabel(45)).toBe("45 min");
    expect(minutesLabel(59)).toBe("59 min");
    expect(minutesLabel(60)).toBe("1h");
    expect(minutesLabel(95)).toBe("1h 35m");
  });
});

describe("mapPanel", () => {
  // 1.6km is the artboard's own discriminator (dc.html:7497) and link 5c's
  // answer. Both sides of it, because one side alone cannot show it is a line.
  it("calls a short hop a walk and a long one a ride", () => {
    const walk = mapPanel([day([p(1, 35.0, 135.0), p(2, 35.0, 135.01)])], "km");
    expect(walk.facts.map((f) => f.key)).toContain("On foot");
    expect(walk.facts.map((f) => f.key)).not.toContain("By train or taxi");

    const ride = mapPanel([day([p(1, 35.0, 135.0), p(2, 35.0, 135.1)])], "km");
    expect(ride.facts.map((f) => f.key)).toContain("By train or taxi");
    expect(ride.facts.map((f) => f.key)).not.toContain("On foot");
  });

  it("always reports the widest point to point, which is not the longest leg", () => {
    // Out and back: the route is long, the span is half of it.
    const panel = mapPanel([day([p(1, 35.0, 135.0), p(2, 35.0, 135.02), p(3, 35.0, 135.0)])], "km");
    const widest = panel.facts.find((f) => f.key === "Widest point to point");
    expect(widest).toBeDefined();
    // ~1.8km apart at the far point, and the route covers ~3.6km.
    expect(widest!.value).toMatch(/1\.8 km|1,8 km|18\d\d m/);
  });

  it("labels the gap under the stop the leg leaves from", () => {
    const panel = mapPanel([day([p(1, 35.0, 135.0), p(2, 35.0, 135.01)])], "km");
    expect(panel.gaps.get(1)).toMatch(/walk · /);
    // Nothing hangs off the last stop — there is no leg leaving it.
    expect(panel.gaps.get(2)).toBeUndefined();
  });

  it("reads a there-and-back as a loop and a straight run as a line", () => {
    const line = mapPanel([day([p(1, 35.0, 135.0), p(2, 35.0, 135.01), p(3, 35.0, 135.02)])], "km");
    expect(line.note).toBe("One clean line. It never doubles back on itself.");

    const loop = mapPanel([day([p(1, 35.0, 135.0), p(2, 35.0, 135.01), p(3, 35.0, 135.0)])], "km");
    expect(loop.note).toBe("A loop — it ends near where it started.");
  });

  it("calls a long lopsided day mostly transit, and says how long", () => {
    // **The 90-minute floor is real and this test found it.** A first draft
    // used 1 degree of longitude per leg — ~91km, 41 min at the long-ride pace
    // — so `transitShare` was 1.0 but `rideMins` came to 82 and the day was
    // correctly NOT called mostly transit. Two degrees per leg clears it.
    const panel = mapPanel([day([p(1, 35.0, 135.0), p(2, 35.0, 137.0), p(3, 35.0, 139.0)])], "km");
    expect(panel.note).toMatch(/^Mostly transit — about .+ of the day is spent moving\.$/);
  });

  it("honours the reader's unit", () => {
    const panel = mapPanel([day([p(1, 35.0, 135.0), p(2, 35.0, 135.1)])], "mi");
    expect(panel.facts.find((f) => f.key === "By train or taxi")!.value).toMatch(/mi/);
  });
});

describe("mapTitle", () => {
  it("joins the day's cities in order, without repeating one", () => {
    expect(mapTitle(["Kyoto", "Kyoto", "Osaka"])).toBe("Kyoto → Osaka");
    expect(mapTitle(["Kyoto"])).toBe("Kyoto");
    expect(mapTitle(["", ""])).toBe("");
  });
});

describe("mapPanel and the legs it refuses to count", () => {
  // `contiguous: false` means one or more stops with NO location sit between
  // these two, so the straight line skips whatever happened in between. Its
  // distance understates the real one and its minutes come from that
  // understatement (CodeRabbit, PR #197).
  it("leaves a non-contiguous leg out of the totals and out of the gaps", () => {
    const points = [p(1, 35.0, 135.0), p(2, 35.0, 135.01), p(3, 35.0, 135.02)];
    const whole = mapPanel([day(points)], "km");
    const skipped = mapPanel([day(points, [1])], "km");

    const onFoot = (panel: ReturnType<typeof mapPanel>) => panel.facts.find((f) => f.key === "On foot")?.value;
    expect(onFoot(whole)).toBeDefined();
    // Two legs counted vs one: the walked distance must actually drop.
    expect(onFoot(skipped)).not.toBe(onFoot(whole));

    // Stop 1's leg is real and still labelled; stop 2's spans the gap and is not.
    expect(skipped.gaps.get(1)).toBeDefined();
    expect(skipped.gaps.get(2)).toBeUndefined();
    expect(whole.gaps.get(2)).toBeDefined();
  });

  // The floor is 90 minutes and it is a `>`, so 90 itself is NOT mostly
  // transit. The above-threshold case alone could not show where the line is.
  it("does not call a long ride mostly transit below the minutes floor", () => {
    // One ~91km leg: 41 min at the long-ride pace, well under the floor, with
    // a transit share of 1.0 — so only the minutes keep it out.
    const panel = mapPanel([day([p(1, 35.0, 135.0), p(2, 35.0, 136.0)])], "km");
    expect(panel.facts.map((f) => f.key)).toContain("By train or taxi");
    expect(panel.note).not.toMatch(/^Mostly transit/);
  });
});
