import { describe, expect, it } from "vitest";
import { costOfStops, dayIndexOf, narrow, type Narrowed } from "./select";
import { selectionTrip } from "./test-support/selectionTrip";

// `narrow` is the one place ADR-039's selection is implemented, so it is the one
// place these rules are worth pinning: eleven primitives read it, and a rule
// that is wrong here is wrong eleven times.

const titles = (n: Narrowed) => n.stops.map((s) => s.activity.title);

// Unwrap, loudly. `narrow` answers `MacroResult`, and a test that silently
// skipped a refusal would pass while asserting nothing about the selection.
function selected(...args: Parameters<typeof narrow>): Narrowed {
  const result = narrow(...args);
  if (result.status !== "ok") throw new Error(`expected a selection, got ${JSON.stringify(result)}`);
  return result.value;
}

describe("dayIndexOf", () => {
  it("resolves both shapes of DayRef", () => {
    const { trip } = selectionTrip();
    expect(dayIndexOf(trip, { kind: "index", index: 1 })).toBe(1);
    expect(dayIndexOf(trip, { kind: "dayId", dayId: trip.days[2]!.dayId })).toBe(2);
  });

  it("reports a stale binding as no binding, never as a guessed one", () => {
    const { trip } = selectionTrip();
    expect(dayIndexOf(trip, { kind: "index", index: 99 })).toBeNull();
    expect(dayIndexOf(trip, { kind: "dayId", dayId: trip.tripId })).toBeNull();
    expect(dayIndexOf(trip, undefined)).toBeNull();
  });
});

describe("narrow — what a filter selects (ADR-039 decisions 1 and 2)", () => {
  it("selects everything when nothing is bound", () => {
    // Decision 2: an absent filter is the widest true answer, not a waiting
    // one. Every day, every stop INCLUDING the backlog, every city.
    const { trip, globals } = selectionTrip();
    const wide = selected(trip, globals, {});
    expect(wide.days).toEqual([0, 1, 2]);
    expect(wide.stops).toHaveLength(7);
    expect(titles(wide)).toContain("Souvenirs");
    expect(wide.cities.map((c) => c.name)).toEqual(["Rome", "Kyoto"]);
    expect(wide.narrowed).toBe(false);
  });

  it("narrows to one day, and drops the backlog with it", () => {
    // An unscheduled stop is on no day. Counting it under `day: 1` would make
    // `cost{day: 1}` disagree with the board's own day subtotal.
    const { trip, globals } = selectionTrip();
    const day1 = selected(trip, globals, { day: { kind: "index", index: 0 } });
    expect(day1.days).toEqual([0]);
    expect(titles(day1)).toEqual(["Colosseum", "Lunch"]);
    expect(day1.narrowed).toBe(true);
  });

  it("narrows by date range, and an undated day is outside every range", () => {
    const { trip, globals } = selectionTrip();
    const june = selected(trip, globals, { dates: { from: "2027-06-01", through: "2027-06-02" } });
    expect(june.days).toEqual([0, 1]);
    // Day 3 has no date. It is not "before" or "after" a range; it is not in one.
    expect(june.days).not.toContain(2);
    expect(titles(june)).not.toContain("Souvenirs");
    const oneDay = selected(trip, globals, { dates: { from: "2027-06-02", through: "2027-06-02" } });
    expect(oneDay.days).toEqual([1]);
  });

  it("gives a stop its own city, and its day's when it has none", () => {
    // The rule that costs money if it is wrong in either direction. By the
    // stop's own location only, the unlocated "Lunch" on a Rome day would
    // vanish from `cost{city: Rome}` and UNDER-report; by its day's cities
    // only, the Kyoto ryokan booked on the Rome→Kyoto travel day would count as
    // Rome.
    const { trip, globals } = selectionTrip();
    const rome = selected(trip, globals, { city: "Rome" });
    expect(titles(rome)).toEqual(["Colosseum", "Lunch", "Train to Kyoto"]);
    const kyoto = selected(trip, globals, { city: "Kyoto" });
    expect(titles(kyoto)).toEqual(["Ryokan", "Souvenirs"]);
    // A located stop is where it says it is, even on a two-city day.
    expect(titles(rome)).not.toContain("Ryokan");
    // An unlocated stop on a day with no city is in no city at all.
    expect([...titles(rome), ...titles(kyoto)]).not.toContain("Free morning");
  });

  it("narrows by tag and by kind without touching which days exist", () => {
    // `tag` and `kind` are about a day's CONTENTS. `day.detail{kind: booked}`
    // needs the days to still be there so it can decide which to keep.
    const { trip, globals } = selectionTrip();
    const booked = selected(trip, globals, { kind: "booked" });
    expect(titles(booked)).toEqual(["Colosseum", "Ryokan"]);
    expect(booked.days).toEqual([0, 1, 2]);
    expect(booked.contentNarrowed).toBe(true);
    const meals = selected(trip, globals, { tag: "meal" });
    expect(titles(meals)).toEqual(["Lunch"]);
  });

  it("combines dimensions rather than letting the last one win", () => {
    const { trip, globals } = selectionTrip();
    const bookedInRome = selected(trip, globals, { city: "Rome", kind: "booked" });
    expect(titles(bookedInRome)).toEqual(["Colosseum"]);
  });

  it("selects cities through the days that match", () => {
    const { trip, globals } = selectionTrip();
    expect(selected(trip, globals, { day: { kind: "index", index: 0 } }).cities.map((c) => c.name)).toEqual(["Rome"]);
    expect(selected(trip, globals, { day: { kind: "index", index: 1 } }).cities.map((c) => c.name)).toEqual([
      "Rome",
      "Kyoto",
    ]);
    // Day 3 touches no city, so it selects none — not "all of them".
    expect(selected(trip, globals, { day: { kind: "index", index: 2 } }).cities).toEqual([]);
  });

  it("finds no cities at all without the globals projection", () => {
    // Cities are derived by `citiesOfDay` in `@tc/domain`, which this package
    // may not import, so they arrive through `globals` or not at all. Without
    // it a bound city matches nothing rather than matching everything — a
    // filter that quietly stops filtering is the worst of the three answers.
    const { trip } = selectionTrip();
    expect(selected(trip, null, {}).cities).toEqual([]);
    expect(selected(trip, null, { city: "Rome" }).stops).toEqual([]);
  });
});

describe("narrow — the two refusals", () => {
  it("refuses to narrow by person, because nothing carries one", () => {
    // ADR-039 decision 7. Not "ignore the filter": `TripMember` has no display
    // name and no stop has a person at all, so the honest answer is ADR-037
    // decision 7's "needs a field" state. A filter that silently stops
    // filtering would show every stop under a heading claiming they are one
    // person's.
    const { trip, globals } = selectionTrip();
    expect(narrow(trip, globals, { person: "dev-alice" })).toEqual({ status: "unbound", needs: "person" });
    expect(narrow(trip, globals, { person: "me" })).toEqual({ status: "unbound", needs: "person" });
  });

  it("tells an absent day apart from one aimed at a day that is gone", () => {
    // The whole content of ADR-039 decision 2's boundary. Absent is every day.
    // A ref pointing at a deleted day is a binding aimed at nothing, and
    // silently widening it to the whole trip would turn `cost{day: 100}` into
    // the trip total the moment day 100 was removed — a confident wrong answer.
    const { trip, globals } = selectionTrip();
    expect(narrow(trip, globals, {}).status).toBe("ok");
    expect(narrow(trip, globals, { day: { kind: "index", index: 99 } })).toEqual({
      status: "unbound",
      needs: "day",
    });
  });
});

describe("costOfStops — one number, one implementation", () => {
  it("sums a wide selection to the trip's own total", () => {
    // ADR-039's table: *"`cost` wide equals `cost.trip` exactly, because 'every
    // stop' includes the backlog, which is what `tripCostTotal` already
    // counts"*. The fixture's totals are computed by `@tc/domain`'s
    // `rollupCosts` inside `tripDetailFactory`, so this compares against the
    // board's arithmetic rather than against this file's.
    const { trip, globals } = selectionTrip();
    expect(costOfStops(selected(trip, globals, {}).stops)).toBe(trip.tripCostTotal);
    expect(trip.tripCostTotal).toBeGreaterThan(0);
  });

  it("sums a day-bound selection to that day's own subtotal", () => {
    const { trip, globals } = selectionTrip();
    for (const index of [0, 1, 2]) {
      const day = selected(trip, globals, { day: { kind: "index", index } });
      expect(costOfStops(day.stops), `day ${index + 1}`).toBe(trip.days[index]!.costSubtotal);
    }
  });

  it("leaves the unscheduled subtotal as the difference between the two", () => {
    const { trip, globals } = selectionTrip();
    const scheduled = trip.days.reduce((sum, day) => sum + day.costSubtotal, 0);
    expect(costOfStops(selected(trip, globals, {}).stops) - scheduled).toBe(trip.unscheduledCostSubtotal);
    expect(trip.unscheduledCostSubtotal).toBeGreaterThan(0);
  });
});
