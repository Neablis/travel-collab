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
  // `amountMinor` is hundredths for EVERY currency in this codebase — the money
  // input multiplies by 100, the AI prompt says to, and every reader divides by
  // 100 (ADR-008, amended 2026-09-07). `Intl` does not know that: left to
  // itself it applies ISO 4217's exponent, which is 0 for JPY, so it read
  // hundredths as whole yen and rendered 123456 as `¥1,235` while the board's
  // own formatter rendered the same field `¥1,234.56` on the next screen over
  // (KI-2026-09-05-y / F-G04). These expectations are the board's output
  // verbatim — the same values are pinned from the other side in
  // `apps/web/src/components/lenses/formatMoney.test.ts`, and the two files are
  // what make a notebook `cost` widget and the board agree.
  it("renders a zero-exponent currency in hundredths too, matching the board", () => {
    expect(formatMoney(123456, "JPY")).toBe("¥1,234.56");
    expect(formatMoney(100, "JPY")).toBe("¥1.00");
    expect(formatMoney(150, "JPY")).toBe("¥1.50");
  });
  it("formats an ISO date; passes through null as an em dash", () => {
    expect(formatDate("2026-08-01")).toBe("Aug 1, 2026");
    expect(formatDate(null)).toBe("—");
  });
});
