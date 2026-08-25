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
  it("prefixes a well-known currency's symbol onto a grouped amount", () => {
    expect(formatMoney(111110600, "USD")).toBe("$1,111,106.00");
  });

  it("keeps the sign in front of the symbol", () => {
    expect(formatMoney(-111110600, "USD")).toBe("-$1,111,106.00");
  });

  // Mitchell: "map USD to $ to save space" — scoped to the app's real
  // currency list (TripMoneySettings' select). CAD/AUD disambiguate from
  // USD's bare `$` since the select offers all three dollar currencies.
  it.each([
    ["USD", "$1.00"],
    ["EUR", "€1.00"],
    ["GBP", "£1.00"],
    ["JPY", "¥1.00"],
    ["CAD", "CA$1.00"],
    ["AUD", "A$1.00"],
  ])("renders %s as its symbol", (currency, expected) => {
    expect(formatMoney(100, currency)).toBe(expected);
  });

  it("falls back to the code, as a trailing suffix, for a currency with no well-known symbol", () => {
    expect(formatMoney(100, "CHF")).toBe("1.00 CHF");
  });

  it("never renders an empty string for an unrecognized currency", () => {
    expect(formatMoney(100, "XYZ")).toBe("1.00 XYZ");
  });
});
