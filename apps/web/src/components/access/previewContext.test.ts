import { describe, expect, it } from "vitest";
import type { TripPreview } from "@tc/contracts";
import { renderMacro, type RenderOutcome, type Rendered, type Seg } from "@tc/pages";
import { previewContext } from "./previewContext";

// The invite page draws the trip with the notebook's own widgets (M38 D6), so
// what this file proves is that the context the adapter builds makes THOSE
// widgets — through the registry, not a copy of them — say what the preview
// says, and that the widgets about money per person say nothing (D4).

const preview: TripPreview = {
  name: "Japan in June",
  startDate: "2027-06-01",
  endDate: "2027-06-04",
  days: [
    {
      date: "2027-06-01",
      city: "Tokyo",
      stops: [
        { title: "Senso-ji", location: { name: "Senso-ji", city: "Tokyo", lat: 35.7148, lng: 139.7967 } },
        { title: "Dinner", location: null },
      ],
    },
    {
      date: "2027-06-02",
      city: "Tokyo",
      stops: [{ title: "Shibuya Sky", location: { name: "Shibuya Sky", city: "Tokyo", lat: 35.6585, lng: 139.7023 } }],
    },
    {
      date: "2027-06-03",
      city: "Kyoto",
      stops: [
        { title: "Shinkansen", location: { name: "Tokyo Station", city: "Tokyo" } },
        { title: "Fushimi Inari", location: { name: "Fushimi Inari", city: "Kyoto", lat: 34.9671, lng: 135.7727 } },
      ],
    },
    // A day the server named by a stop's AREA (`dayCity`'s fallback). The
    // preview's place has no `area`, so the adapter has to carry the day's
    // name onto the stop for the strip to read it.
    { date: "2027-06-04", city: "Higashiyama", stops: [{ title: "Kiyomizu-dera", location: { name: "Kiyomizu-dera" } }] },
  ],
  people: [
    { name: "Mitchell", avatar: null, color: null, colorShifted: false, travelling: true },
    { name: "Priya", avatar: null, color: null, colorShifted: false, travelling: true },
    { name: "Sam", avatar: null, color: null, colorShifted: false, travelling: false },
  ],
  total: { amountMinor: 123_450, currency: "USD" },
};

const TODAY = "2027-05-27";
const ctx = previewContext(preview, TODAY);

function rendered(outcome: RenderOutcome): Rendered {
  if (outcome.status !== "ok") throw new Error(`expected a rendered widget, got ${JSON.stringify(outcome)}`);
  return outcome.rendered;
}

const textOf = (segs: readonly Seg[]) => segs.map((s) => s.text).join("");

function inlineText(name: string, params: Record<string, unknown> = {}): string {
  const out = rendered(renderMacro(ctx, name, params));
  if (out.kind !== "inline") throw new Error(`expected inline, got ${out.kind}`);
  return textOf(out.segs);
}

describe("previewContext — the fixed widget set (D5) reads the preview", () => {
  it("dates: the trip's range, and the countdown against the reader's today", () => {
    expect(inlineText("dates")).toBe("Jun 1, 2027 – Jun 4, 2027");
    expect(inlineText("attribute", { field: "trip.countdown" })).toBe("in 5 days");
  });

  it("trip.strip: one run per stay, named as the preview names each day", () => {
    const out = rendered(renderMacro(ctx, "trip.strip", {}));
    if (out.kind !== "block" || out.block.kind !== "trip-strip") throw new Error(`expected the strip, got ${out.kind}`);
    const runs = out.block.runs.map((run) => [run.city, run.days.map((d) => d.ordinal)]);
    expect(runs).toEqual([
      ["Tokyo", [1, 2]],
      ["Kyoto", [3]],
      ["Higashiyama", [4]],
    ]);
    // Every run's name is the preview's own day city, read off the same days.
    expect(runs.flatMap(([city, days]) => (days as number[]).map(() => city))).toEqual(preview.days.map((d) => d.city));
  });

  it("city.rows: a line per city with its days and its stops, in arrival order", () => {
    const out = rendered(renderMacro(ctx, "city.rows", {}));
    if (out.kind !== "rows") throw new Error(`expected rows, got ${out.kind}`);
    expect(out.rows.map((row) => [textOf(row.lead), ...row.cells.map(textOf)])).toEqual([
      // Day 3's train leaves from Tokyo, so day 3 touches Tokyo too — the
      // board's `citiesOfDay` rule, by the stop's own city.
      ["Tokyo", "Day 1, Day 2, Day 3", "3 stops"],
      ["Kyoto", "Day 3", "1 stop"],
    ]);
  });

  it("cost: the trip's total and exactly that", () => {
    expect(inlineText("cost")).toBe("$1,234.50");
  });

  it("names the people by the preview's names, in join order, with no user id", () => {
    expect(ctx.trip?.members.map((m) => m.userId)).toEqual(["p0", "p1", "p2"]);
    expect(ctx.people).toEqual({ p0: "Mitchell", p1: "Priya", p2: "Sam" });
  });

  // Every synthesized member is `travelling: false` (below), so who is going
  // has to come from the preview's own people.
  it("trip.people: who the preview says is going, with the owner, and not who only plans", () => {
    const out = rendered(renderMacro(ctx, "trip.people", {}));
    if (out.kind !== "block" || out.block.kind !== "trip-people") throw new Error(`expected who's going, got ${out.kind}`);
    expect(out.block.sentence).toBe("Priya is going with Mitchell.");
  });
});

describe("previewContext — what D4 hides stays hidden", () => {
  it("no widget about one person's money has an amount to show", () => {
    for (const who of ["p0", "p1", "p2"]) {
      expect(renderMacro(ctx, "person.share", { who }).status).toBe("empty");
    }
    expect(renderMacro(ctx, "cost.balances", {}).status).toBe("empty");
  });

  it("no day, city or stop has a cost — only the whole trip does", () => {
    expect(renderMacro(ctx, "cost", { day: { kind: "index", index: 0 } }).status).toBe("empty");
    expect(renderMacro(ctx, "cost", { city: "Tokyo" }).status).toBe("empty");
    expect(renderMacro(ctx, "cost", { dates: { from: "2027-06-01", through: "2027-06-04" } }).status).toBe("empty");
  });

  it("a trip nobody has priced has no total, as on the board", () => {
    const unpriced = previewContext({ ...preview, total: { amountMinor: 0, currency: "USD" } }, TODAY);
    expect(renderMacro(unpriced, "cost", {}).status).toBe("empty");
  });
});
