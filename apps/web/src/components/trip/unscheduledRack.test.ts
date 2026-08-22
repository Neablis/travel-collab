import { describe, expect, it } from "vitest";
import { fitIntoDay } from "./unscheduledRack";

describe("fitIntoDay", () => {
  it("gives a full hour at the preferred start on an empty day", () => {
    expect(fitIntoDay([], "14:00")).toEqual({ start: "14:00", end: "15:00" });
  });

  it("defaults to 09:00 on an empty day with no preference", () => {
    expect(fitIntoDay([])).toEqual({ start: "09:00", end: "10:00" });
  });

  it("keeps a full hour with 30 minutes of air each side in a comfortable gap", () => {
    // 09:00-10:00 booked, then free until 20:00 — an 10h gap.
    const slot = fitIntoDay([{ start: "09:00", end: "10:00" }]);
    expect(slot.start).toBe("10:30");
    expect(slot.end).toBe("11:30");
  });

  it("shrinks toward the 15-minute floor when the gap is tight", () => {
    // 09:00-10:00 and 10:45-12:00 leaves a 45-minute gap.
    const slot = fitIntoDay([{ start: "09:00", end: "10:00" }, { start: "10:45", end: "12:00" }], "10:00");
    const minutes = Number(slot.end.slice(0, 2)) * 60 + Number(slot.end.slice(3)) -
                    (Number(slot.start.slice(0, 2)) * 60 + Number(slot.start.slice(3)));
    expect(minutes).toBeGreaterThanOrEqual(15);
    expect(slot.start >= "10:00").toBe(true);
    expect(slot.end <= "10:45").toBe(true);
  });

  it("never returns an inverted window on a fully booked day", () => {
    const packed = Array.from({ length: 12 }, (_, i) => ({
      start: `${String(8 + i).padStart(2, "0")}:00`,
      end: `${String(9 + i).padStart(2, "0")}:00`,
    }));
    const slot = fitIntoDay(packed);
    expect(slot.end > slot.start).toBe(true);
  });

  it("is unaffected by the order of the existing windows", () => {
    const a = fitIntoDay([{ start: "09:00", end: "10:00" }, { start: "14:00", end: "15:00" }]);
    const b = fitIntoDay([{ start: "14:00", end: "15:00" }, { start: "09:00", end: "10:00" }]);
    expect(a).toEqual(b);
  });
});
