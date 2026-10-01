import { describe, expect, it } from "vitest";
import type { SunAxis, SunRow } from "@tc/pages";
import { ribbonOf } from "./SunGraphic";

// The ribbon's geometry, which no component test can read: a ribbon is drawn
// from inline percentages, and a test may not assert presentation. The numbers
// it is drawn FROM are a pure function of a row and the axis.

const axis = (startMinute: number, endMinute: number): SunAxis => ({ startMinute, endMinute, ticks: [] });

const row = (over: Partial<SunRow>): SunRow => ({
  key: "0", label: "Day 1", city: "Tokyo", state: "normal", words: null,
  sunriseMinute: 360, sunsetMinute: 1020, sunrise: "6 am", sunset: "5 pm", daylight: "11h",
  goldenMorningEndMinute: 390, goldenEveningStartMinute: 990,
  ...over,
});

describe("ribbonOf", () => {
  it("places a day's ribbon on the axis, and its golden hours as shares of the ribbon", () => {
    // 5 am to 6 pm is 780 minutes; the sun is up for 660 of them, from an hour in.
    const ribbon = ribbonOf(row({}), axis(300, 1080))!;
    expect(ribbon.left).toBeCloseTo((60 / 780) * 100);
    expect(ribbon.width).toBeCloseTo((660 / 780) * 100);
    expect(ribbon.morning).toBeCloseTo((30 / 660) * 100);
    expect(ribbon.evening).toBeCloseTo((30 / 660) * 100);
  });

  // Reykjavik in June: the sun sets three minutes into the next day, and its
  // evening golden hour starts at 11 pm. The ribbon stops where the axis does,
  // and the golden hour is what is left of it before that.
  it("stops a sunset past the axis's end at the end, and its golden hour with it", () => {
    const ribbon = ribbonOf(
      row({ sunriseMinute: 180, sunsetMinute: 1443, goldenMorningEndMinute: 300, goldenEveningStartMinute: 1380 }),
      axis(0, 1440),
    )!;
    expect(ribbon.left).toBeCloseTo(12.5);
    expect(ribbon.left + ribbon.width).toBeCloseTo(100);
    expect(ribbon.morning).toBeCloseTo((120 / 1260) * 100);
    expect(ribbon.evening).toBeCloseTo((60 / 1260) * 100);
  });

  it("draws a sun that is up all day across the whole axis with no golden ends, and one that is down not at all", () => {
    const none = { sunriseMinute: null, sunsetMinute: null, sunrise: null, sunset: null };
    // The midnight sun still dips under six degrees, so the row carries the minutes; there is no end to draw them at.
    const up = row({ ...none, state: "up-all-day", words: "sun up all day", daylight: "24h", goldenMorningEndMinute: 200, goldenEveningStartMinute: 1300 });
    expect(ribbonOf(up, axis(0, 1440))).toEqual({ left: 0, width: 100, morning: 0, evening: 0 });
    const down = row({ ...none, state: "down-all-day", words: "sun down all day", daylight: "0h" });
    expect(ribbonOf(down, axis(300, 1080))).toBeNull();
  });
});
