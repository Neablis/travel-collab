import { describe, expect, it } from "vitest";
import { formatDuration, toClockLabel, toMinutes, toTimeString } from "./time";

describe("toClockLabel", () => {
  it("drops the minutes on the hour", () => {
    expect(toClockLabel("13:00")).toBe("1 pm");
  });

  it("keeps the minutes otherwise, zero-padded", () => {
    expect(toClockLabel("10:30")).toBe("10:30 am");
    expect(toClockLabel("09:05")).toBe("9:05 am");
  });

  // The two hours where `h % 12` is 0 and a naive formatter renders "0".
  it("renders midnight and noon as 12", () => {
    expect(toClockLabel("00:00")).toBe("12 am");
    expect(toClockLabel("12:00")).toBe("12 pm");
    expect(toClockLabel("00:45")).toBe("12:45 am");
  });
});

describe("formatDuration", () => {
  it("omits the empty half of the pair", () => {
    expect(formatDuration(30, "on top of each other.")).toBe("30m on top of each other.");
    expect(formatDuration(120, "out")).toBe("2h out");
    expect(formatDuration(90, "gap")).toBe("1h 30m gap");
  });
});

describe("toMinutes / toTimeString", () => {
  it("round-trips a wall-clock time", () => {
    expect(toTimeString(toMinutes("14:05"))).toBe("14:05");
  });

  it("clamps a computed minute count that overruns the day", () => {
    expect(toTimeString(24 * 60 + 30)).toBe("23:59");
  });
});
