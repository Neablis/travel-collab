import { describe, expect, it } from "vitest";
import type { UserPreferences } from "@tc/contracts";
import { readerClock, toClockLabel, toClockRange } from "./clockLabel";

// `lib/time` in the app re-exports these, and its own 12-hour tests still run
// there against the re-export.
describe("toClockLabel, 12-hour", () => {
  it("drops the minutes on the hour", () => {
    expect(toClockLabel("13:00", "12h")).toBe("1 pm");
  });

  it("keeps the minutes otherwise, zero-padded", () => {
    expect(toClockLabel("10:30", "12h")).toBe("10:30 am");
    expect(toClockLabel("09:05", "12h")).toBe("9:05 am");
  });

  // The two hours where `h % 12` is 0 and a naive formatter renders "0".
  it("renders midnight and noon as 12", () => {
    expect(toClockLabel("00:00", "12h")).toBe("12 am");
    expect(toClockLabel("12:00", "12h")).toBe("12 pm");
    expect(toClockLabel("00:45", "12h")).toBe("12:45 am");
    expect(toClockLabel("23:59", "12h")).toBe("11:59 pm");
  });
});

describe("toClockLabel, 24-hour", () => {
  // Midnight is "00:00", not "24:00" and not "0:00"; noon is "12:00", not "12".
  it("renders midnight and noon zero-padded, minutes kept", () => {
    expect(toClockLabel("00:00", "24h")).toBe("00:00");
    expect(toClockLabel("12:00", "24h")).toBe("12:00");
    expect(toClockLabel("00:45", "24h")).toBe("00:45");
  });

  it("zero-pads a morning hour and keeps an afternoon one", () => {
    expect(toClockLabel("09:05", "24h")).toBe("09:05");
    expect(toClockLabel("14:30", "24h")).toBe("14:30");
    expect(toClockLabel("23:59", "24h")).toBe("23:59");
  });

  it("pads an unpadded stored hour rather than echoing it", () => {
    expect(toClockLabel("9:00", "24h")).toBe("09:00");
  });
});

describe("toClockRange", () => {
  it("joins two 12-hour labels with a spaced en dash", () => {
    expect(toClockRange("09:00", "17:30", "12h")).toBe("9 am – 5:30 pm");
    expect(toClockRange("00:00", "12:00", "12h")).toBe("12 am – 12 pm");
  });

  it("joins two 24-hour labels the same way", () => {
    expect(toClockRange("09:00", "17:00", "24h")).toBe("09:00 – 17:00");
    expect(toClockRange("00:00", "12:00", "24h")).toBe("00:00 – 12:00");
  });
});

describe("readerClock", () => {
  const user: UserPreferences = { displayName: null, homeAirport: null, distanceUnit: "km", timeFormat: "24h" };

  it("is the reader's own clock", () => {
    expect(readerClock(user)).toBe("24h");
    expect(readerClock({ ...user, timeFormat: "12h" })).toBe("12h");
  });

  // No account to ask: a signed-out reader, or the preferences read in flight.
  it("is 12-hour with no reader", () => {
    expect(readerClock(null)).toBe("12h");
  });
});
