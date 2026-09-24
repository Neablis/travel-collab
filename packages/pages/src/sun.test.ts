import { describe, expect, it } from "vitest";
import { clockIn } from "./clock";
import { sunEvents, type SunTime } from "./sun";

// Known values: almanac figures (timeanddate.com's tables), cross-checked on
// 2026-09-24 against SunCalc, an independent implementation of a different
// formula set, which agreed with each to within two minutes. Two minutes is
// the tolerance: the equations' own accuracy away from the poles, plus the
// rounding to a whole minute on both sides.
const at = (value: SunTime, zone: string) => {
  if (typeof value !== "number") throw new Error(`expected a time, got ${value}`);
  return clockIn(zone, value);
};
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const near = (actual: string, expected: string) => {
  const gap = Math.abs(minutesOf(actual) - minutesOf(expected));
  expect(Math.min(gap, 1440 - gap), `${actual} vs ${expected}`).toBeLessThanOrEqual(2);
};

describe("sunEvents", () => {
  it("Tokyo at midsummer: up at 04:25, down at 19:00", () => {
    const sun = sunEvents("2026-06-21", 35.6812, 139.7671);
    near(at(sun.sunrise, "Asia/Tokyo").time, "04:25");
    near(at(sun.sunset, "Asia/Tokyo").time, "19:00");
    expect(at(sun.sunrise, "Asia/Tokyo").date).toBe("2026-06-21");
  });

  it("Sydney at its midsummer, across the date line and in daylight saving", () => {
    const sun = sunEvents("2026-12-21", -33.8688, 151.2093);
    near(at(sun.sunrise, "Australia/Sydney").time, "05:41");
    near(at(sun.sunset, "Australia/Sydney").time, "20:05");
  });

  // Reykjavik is BELOW the Arctic Circle: the sun does set at midsummer, a few
  // minutes after local midnight — so the sunset belongs to the next calendar
  // day, which is the case a formatter has to say out loud.
  it("Reykjavik at midsummer: the sun sets after midnight, on the next day", () => {
    const sun = sunEvents("2026-06-21", 64.1466, -21.9426);
    near(at(sun.sunrise, "Atlantic/Reykjavik").time, "02:55");
    near(at(sun.sunset, "Atlantic/Reykjavik").time, "00:03");
    expect(at(sun.sunset, "Atlantic/Reykjavik").date).toBe("2026-06-22");
  });

  it("Tromsø: midnight sun in June, polar night in December", () => {
    const june = sunEvents("2026-06-21", 69.6492, 18.9553);
    expect([june.sunrise, june.sunset]).toEqual(["up", "up"]);
    const december = sunEvents("2026-12-21", 69.6492, 18.9553);
    expect([december.sunrise, december.sunset]).toEqual(["down", "down"]);
    // Down all day, so it never climbs to the golden hour's six degrees either.
    expect([december.goldenMorningEnd, december.goldenEveningStart]).toEqual(["down", "down"]);
  });

  it("puts the golden hour inside the day: sunrise, then six degrees up, then six down, then sunset", () => {
    const sun = sunEvents("2026-06-21", 35.6812, 139.7671);
    const times = [sun.sunrise, sun.goldenMorningEnd, sun.goldenEveningStart, sun.sunset];
    expect(times.every((t) => typeof t === "number")).toBe(true);
    expect([...(times as number[])].sort((a, b) => a - b)).toEqual(times);
    // About forty minutes each side at Tokyo's latitude in June (SunCalc: 18:23).
    near(at(sun.goldenEveningStart, "Asia/Tokyo").time, "18:22");
  });
});

describe("clockIn", () => {
  it("reads an instant as a date and a 24-hour time in a zone, half-hour zones included", () => {
    const instant = Date.UTC(2026, 5, 21, 0, 0);
    expect(clockIn("Asia/Tokyo", instant)).toEqual({ date: "2026-06-21", time: "09:00" });
    expect(clockIn("Asia/Kolkata", instant)).toEqual({ date: "2026-06-21", time: "05:30" });
    expect(clockIn("America/Los_Angeles", instant)).toEqual({ date: "2026-06-20", time: "17:00" });
  });
});
