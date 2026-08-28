import { describe, expect, it } from "vitest";
import { addDaysIso, dayLabel } from "@/lib/dates";

describe("addDaysIso", () => {
  it("adds and subtracts whole days", () => {
    expect(addDaysIso("2026-03-10", 0)).toBe("2026-03-10");
    expect(addDaysIso("2026-03-10", 3)).toBe("2026-03-13");
    expect(addDaysIso("2026-03-10", -3)).toBe("2026-03-07");
  });

  it("crosses month, year and leap-day boundaries", () => {
    expect(addDaysIso("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysIso("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDaysIso("2028-02-28", 1)).toBe("2028-02-29"); // 2028 is a leap year
    expect(addDaysIso("2027-02-28", 1)).toBe("2027-03-01"); // 2027 is not
  });

  // The whole point of the `Z` and the UTC accessors: a host in a
  // behind-UTC zone must not shift the answer by a day. Review §1.8 found
  // exactly that defect in packages/factories, which builds the same value
  // with local `setDate` and then slices the UTC ISO string.
  it("is UTC regardless of the host zone", () => {
    const original = process.env.TZ;
    const localDayOf = (tz: string) => {
      process.env.TZ = tz;
      return new Date("2026-06-15T00:00:00Z").getDate();
    };
    try {
      // Guard, not decoration: if a future Node stops honouring a runtime TZ
      // change, every assertion below silently runs in one zone and this test
      // goes green having proved nothing.
      expect(localDayOf("Pacific/Midway")).not.toBe(localDayOf("Pacific/Kiritimati"));

      for (const tz of ["UTC", "Pacific/Kiritimati", "Pacific/Midway", "Asia/Kolkata"]) {
        process.env.TZ = tz;
        expect(addDaysIso("2026-06-15", 1)).toBe("2026-06-16");
        expect(addDaysIso("2026-01-01", -1)).toBe("2025-12-31");
      }
    } finally {
      process.env.TZ = original;
    }
  });

  // NewTripWizard gates every call on ISO_DATE.test() because of this: a
  // half-typed <input type="date"> value must fail loudly, not silently
  // produce a date nobody asked for.
  it("throws on an incomplete date rather than returning garbage", () => {
    expect(() => addDaysIso("2026-1", 1)).toThrow(RangeError);
    expect(() => addDaysIso("", 1)).toThrow(RangeError);
  });
});

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
