import { describe, expect, it } from "vitest";
import { dayLabel } from "@/lib/dates";

describe("dayLabel", () => {
  it("is ordinal-only without a start date", () => {
    expect(dayLabel(null, 0)).toBe("Day 1");
    expect(dayLabel(null, 4)).toBe("Day 5");
  });

  it("derives display dates from the start date", () => {
    expect(dayLabel("2027-05-01", 0)).toBe("Day 1 — May 1");
    expect(dayLabel("2027-05-01", 2)).toBe("Day 3 — May 3");
  });

  it("crosses month boundaries correctly", () => {
    expect(dayLabel("2027-05-30", 3)).toBe("Day 4 — Jun 2");
  });
});
