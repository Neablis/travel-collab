import { describe, expect, it } from "vitest";
import { formatMoney, formatDate } from "./format";

describe("format helpers", () => {
  it("formats minor units to 2 decimals with currency", () => {
    expect(formatMoney(123456, "USD")).toBe("$1,234.56");
    expect(formatMoney(0, "USD")).toBe("$0.00");
  });
  it("formats a plain non-USD currency by code", () => {
    expect(formatMoney(5000, "EUR")).toContain("50.00");
  });
  it("formats an ISO date; passes through null as an em dash", () => {
    expect(formatDate("2026-08-01")).toBe("Aug 1, 2026");
    expect(formatDate(null)).toBe("—");
  });
});
