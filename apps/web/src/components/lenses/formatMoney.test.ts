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

  // CodeRabbit (PR #46 final review): a plain `{}`-shaped lookup table finds
  // inherited Object.prototype members too — `CURRENCY_SYMBOLS["constructor"]`
  // resolves to `Object`'s constructor function rather than `undefined`, so
  // the unknown-currency fallback below never triggers for these names.
  it.each(["constructor", "toString", "hasOwnProperty", "__proto__"])(
    "treats %s as an unrecognized currency, not an inherited Object.prototype member",
    (currency) => {
      expect(formatMoney(100, currency)).toBe(`1.00 ${currency}`);
    },
  );
});
