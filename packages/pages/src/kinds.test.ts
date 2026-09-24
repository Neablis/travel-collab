import { describe, expect, it } from "vitest";
import { VALUE_KINDS } from "@tc/contracts";
import { formatDate, formatMoney } from "./format";
import { VALUE_KIND_FORMATS, collapseKind, formatKind, formatKindList, type KindValues } from "./kinds";

const ctx = { currency: "USD" };
const place = (name: string) => ({ name });

describe("VALUE_KIND_FORMATS", () => {
  it("has an entry for every value kind and nothing else", () => {
    expect(Object.keys(VALUE_KIND_FORMATS).sort()).toEqual([...VALUE_KINDS].sort());
  });

  // The framework spec's ghost rule: shape-true, never value-true. A ghost that
  // parsed as a number or a date would be a claim about the trip.
  it("gives every kind a ghost that is not a value", () => {
    for (const kind of VALUE_KINDS) {
      const ghost = VALUE_KIND_FORMATS[kind].ghost;
      expect(ghost, kind).not.toBe("");
      expect(ghost, kind).not.toMatch(/\d/);
    }
    expect(VALUE_KIND_FORMATS.money.ghost).toBe("$XXX");
    expect(VALUE_KIND_FORMATS.count.ghost).toBe("NN");
    expect(VALUE_KIND_FORMATS.text.ghost).toBe("———");
  });
});

describe("formatKind", () => {
  it("formats money given as a Money object, through formatMoney", () => {
    expect(formatKind("money", { amountMinor: 123456, currency: "EUR" }, ctx)).toBe(formatMoney(123456, "EUR"));
  });

  // `costSubtotal` and friends are bare integers in the trip's currency.
  it("formats a bare integer amount in the trip currency", () => {
    expect(formatKind("money", 4500, { currency: "JPY" })).toBe("¥45.00");
  });

  it("formats a date through formatDate", () => {
    expect(formatKind("date", "2026-08-01", ctx)).toBe(formatDate("2026-08-01"));
  });

  it("formats counts with grouping", () => {
    expect(formatKind("count", 1234, ctx)).toBe("1,234");
  });

  it("formats a duration in minutes as hours and minutes", () => {
    expect(formatKind("duration", 45, ctx)).toBe("45m");
    expect(formatKind("duration", 120, ctx)).toBe("2h");
    expect(formatKind("duration", 150, ctx)).toBe("2h 30m");
    expect(formatKind("duration", 0, ctx)).toBe("0m");
  });

  it("prints text verbatim, an enum value as its label, and a location as its name", () => {
    expect(formatKind("text", "Kyoto", ctx)).toBe("Kyoto");
    expect(formatKind("enum", "meal", ctx)).toBe("Meal");
    expect(formatKind("enum", "hold", ctx)).toBe("Holding");
    expect(formatKind("location", { name: "Fushimi Inari", lat: 34.97, lng: 135.77 }, ctx)).toBe("Fushimi Inari");
  });
});

describe("formatKindList", () => {
  it("joins the element formats", () => {
    expect(formatKindList("text", ["Kyoto", "Osaka"], ctx)).toBe("Kyoto, Osaka");
    expect(formatKindList("count", [0, 1200], ctx)).toBe("0, 1,200");
  });
});

describe("collapseKind — the 'All' rule", () => {
  it("has nothing to say about no values", () => {
    for (const kind of VALUE_KINDS) expect(collapseKind(kind, [], ctx), kind).toBeNull();
  });

  it("sums money in one currency, bare integers counting as trip currency", () => {
    expect(collapseKind("money", [{ amountMinor: 1000, currency: "USD" }, 250], ctx)).toBe("$12.50");
  });

  // No exchange rates here (Invariant 4: no network), and adding yen to
  // dollars is a wrong number. Each currency is summed on its own; the trip's
  // currency leads and the rest follow by code, so the order of stops does not
  // change what the page says.
  it("sums mixed currencies separately, trip currency first", () => {
    const values = [
      { amountMinor: 500, currency: "JPY" },
      { amountMinor: 100, currency: "EUR" },
      { amountMinor: 1000, currency: "USD" },
      { amountMinor: 200, currency: "EUR" },
    ];
    expect(collapseKind("money", values, ctx)).toBe(
      `${formatMoney(1000, "USD")} + ${formatMoney(300, "EUR")} + ${formatMoney(500, "JPY")}`,
    );
  });

  it("sums counts and durations", () => {
    expect(collapseKind("count", [2, 3, 5], ctx)).toBe("10");
    expect(collapseKind("duration", [45, 45, 30], ctx)).toBe("2h");
  });

  it("gives dates as a span from earliest to latest, or one date when they agree", () => {
    expect(collapseKind("date", ["2026-10-03", "2026-10-01", "2026-10-02"], ctx)).toBe(
      `${formatDate("2026-10-01")} – ${formatDate("2026-10-03")}`,
    );
    expect(collapseKind("date", ["2026-10-01", "2026-10-01"], ctx)).toBe(formatDate("2026-10-01"));
  });

  it("lists every text, enum and location value in order, duplicates included", () => {
    expect(collapseKind("text", ["Kyoto", "Osaka", "Kyoto"], ctx)).toBe("Kyoto, Osaka, Kyoto");
    expect(collapseKind("enum", ["meal", "meal"], ctx)).toBe("Meal, Meal");
    expect(collapseKind("location", [place("Gion"), place("Gion")], ctx)).toBe("Gion, Gion");
  });

  // `distinct` on a kind is what decides whether the editor offers "Remove
  // duplicates" for a field of that kind, so the flag must say what the
  // collapse actually does: for EVERY kind, a repeated value collapses
  // differently under `distinct` exactly when the kind claims it does.
  it("declares `distinct` on exactly the kinds whose collapse it changes", () => {
    const sample: KindValues = {
      money: 100, date: "2026-10-01", count: 2, text: "Kyoto", duration: 30, enum: "meal", location: place("Gion"),
    };
    for (const kind of VALUE_KINDS) {
      const twice = [sample[kind], sample[kind]] as never[];
      const changes = collapseKind(kind, twice, ctx, { distinct: true }) !== collapseKind(kind, twice, ctx);
      expect(changes, kind).toBe(VALUE_KIND_FORMATS[kind].distinct);
    }
    expect(VALUE_KINDS.filter((kind) => VALUE_KIND_FORMATS[kind].distinct).sort()).toEqual(["enum", "location", "text"]);
  });

  it("drops repeats under `distinct`, keeping first appearance", () => {
    expect(collapseKind("text", ["Kyoto", "Osaka", "Kyoto"], ctx, { distinct: true })).toBe("Kyoto, Osaka");
    // Two stops at one place with different pins read the same on the page, so
    // they are the same value to a reader.
    expect(
      collapseKind("location", [{ name: "Gion", lat: 35, lng: 135 }, { name: "Gion" }], ctx, { distinct: true }),
    ).toBe("Gion");
  });
});
