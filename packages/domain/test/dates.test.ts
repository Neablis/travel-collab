import { describe, expect, it } from "vitest";
import { daySpan } from "../src/trip/dates";

describe("daySpan", () => {
  it("counts inclusively", () => {
    expect(daySpan("2026-07-07", "2026-07-07")).toBe(1);
    expect(daySpan("2026-07-07", "2026-07-13")).toBe(7);
  });
  it("crosses a month boundary", () => {
    expect(daySpan("2026-07-30", "2026-08-02")).toBe(4);
  });
  it("returns a non-positive number when end precedes start", () => {
    expect(daySpan("2026-07-07", "2026-07-06")).toBe(0);
  });
});
