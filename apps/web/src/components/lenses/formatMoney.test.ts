import { describe, expect, it } from "vitest";
import { formatMoney, formatAmount } from "./formatMoney";

describe("formatAmount", () => {
  it("groups thousands with commas and keeps two decimals (#22)", () => {
    expect(formatAmount(111110600)).toBe("1,111,106.00");
  });

  it("formats small amounts without a separator", () => {
    expect(formatAmount(500)).toBe("5.00");
    expect(formatAmount(0)).toBe("0.00");
  });

  it("is negative-aware", () => {
    expect(formatAmount(-111110600)).toBe("-1,111,106.00");
  });
});

describe("formatMoney", () => {
  it("appends the currency to a grouped amount (#22)", () => {
    expect(formatMoney(111110600, "USD")).toBe("1,111,106.00 USD");
  });

  it("keeps the sign in front of the grouped amount", () => {
    expect(formatMoney(-111110600, "USD")).toBe("-1,111,106.00 USD");
  });
});
