import { describe, expect, it } from "vitest";
import { closestDurationLabel, durationMinutes } from "./activityDuration";

describe("closestDurationLabel", () => {
  it("maps an exact option straight through", () => {
    expect(closestDurationLabel(90)).toBe("1.5 hours");
  });

  it("rounds a between-options duration to the nearer option", () => {
    expect(closestDurationLabel(50)).toBe("1 hour"); // 20 away from 30, 10 away from 60
    expect(closestDurationLabel(100)).toBe("1.5 hours"); // 10 away from 90, 20 away from 120
  });

  it("breaks an exact tie toward the shorter option", () => {
    expect(closestDurationLabel(45)).toBe("30 min"); // exactly between 30 and 60
    expect(closestDurationLabel(75)).toBe("1 hour"); // exactly between 60 and 90
    expect(closestDurationLabel(180)).toBe("2 hours"); // exactly between 120 and 240
  });

  it("clamps below the shortest and above the longest option", () => {
    expect(closestDurationLabel(0)).toBe("30 min");
    expect(closestDurationLabel(1000)).toBe("Half day");
  });
});

describe("durationMinutes", () => {
  it("treats Half day as four hours", () => {
    expect(durationMinutes("Half day")).toBe(240);
  });
});
