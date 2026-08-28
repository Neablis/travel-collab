import { describe, expect, it } from "vitest";
import type { ActivityView, TripDetail } from "@tc/contracts";
import { calendarCityCards, SPAN_TRACK_START_MIN, SPAN_TRACK_END_MIN } from "./calendarCityCards";

function stop(
  id: string,
  city: string | null,
  window: { start: string; end: string } | null,
  costMinor?: number,
): ActivityView {
  return {
    activityId: id,
    title: id,
    timeWindow: window,
    location: city === null ? null : { name: city, city, lat: 0, lng: 0 },
    notes: null,
    anchors: [],
    kind: "planned" as const,
    tags: [],
    cost: costMinor === undefined ? null : { amountMinor: costMinor, currency: "USD" },
  };
}

function dayOf(stops: ActivityView[]): {
  day: TripDetail["days"][number];
  activities: TripDetail["activities"];
} {
  return {
    day: { dayId: "d1", activityIds: stops.map((s) => s.activityId), date: "2027-06-01", costSubtotal: 0 },
    activities: Object.fromEntries(stops.map((s) => [s.activityId, s])),
  };
}

describe("calendarCityCards", () => {
  it("summarises a single-city day as one card", () => {
    const { day, activities } = dayOf([
      stop("a", "Tokyo", { start: "09:00", end: "11:00" }, 1000),
      stop("b", "Tokyo", { start: "13:00", end: "14:30" }, 500),
    ]);

    expect(calendarCityCards(day, activities)).toEqual([
      {
        city: "Tokyo",
        stops: 2,
        costMinor: 1500,
        window: { start: "09:00", end: "14:30" },
        span: { from: expect.closeTo(0.125, 3), to: expect.closeTo(0.469, 3) },
        firstStart: "09:00",
      },
    ]);
  });

  // The shape M18 will refine. Until a stop has a `kind`, the split comes from
  // the city changing rather than from the last `transit` stop — so this covers
  // the ordering and the "last group is where you end up" rule, which are what
  // the presentation depends on either way.
  it("splits a day that moves between cities, in the order it moved", () => {
    const { day, activities } = dayOf([
      stop("a", "Tokyo", { start: "08:20", end: "08:50" }),
      stop("b", "Hakone", { start: "11:00", end: "12:00" }),
      stop("c", "Hakone", { start: "15:00", end: "16:00" }),
    ]);

    const cards = calendarCityCards(day, activities);
    expect(cards.map((c) => c.city)).toEqual(["Tokyo", "Hakone"]);
    expect(cards[0]!.stops).toBe(1);
    expect(cards[0]!.firstStart).toBe("08:20");
    // The last group is the one that gets the full card — where the day ends.
    expect(cards[1]!.stops).toBe(2);
    expect(cards[1]!.window).toEqual({ start: "11:00", end: "16:00" });
  });

  it("groups consecutively, so returning to a city is a third card, not a merge", () => {
    const { day, activities } = dayOf([
      stop("a", "Tokyo", { start: "09:00", end: "10:00" }),
      stop("b", "Nikkō", { start: "12:00", end: "13:00" }),
      stop("c", "Tokyo", { start: "20:00", end: "21:00" }),
    ]);

    expect(calendarCityCards(day, activities).map((c) => c.city)).toEqual(["Tokyo", "Nikkō", "Tokyo"]);
  });

  it("clamps the span bar to the 7am–11pm track rather than overflowing it", () => {
    const { day, activities } = dayOf([stop("a", "Tokyo", { start: "05:30", end: "23:50" })]);
    const [card] = calendarCityCards(day, activities);

    expect(card!.span).toEqual({ from: 0, to: 1 });
    // The window itself is still the truth — only the bar is clamped.
    expect(card!.window).toEqual({ start: "05:30", end: "23:50" });
  });

  it("puts a stop exactly on each end of the track at the ends of the bar", () => {
    const at = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
    const { day, activities } = dayOf([
      stop("a", "Tokyo", { start: at(SPAN_TRACK_START_MIN), end: at(SPAN_TRACK_END_MIN) }),
    ]);

    expect(calendarCityCards(day, activities)[0]!.span).toEqual({ from: 0, to: 1 });
  });

  it("carries no window or span for a day whose stops have no times", () => {
    const { day, activities } = dayOf([stop("a", "Tokyo", null), stop("b", "Tokyo", null)]);
    const [card] = calendarCityCards(day, activities);

    expect(card).toMatchObject({ city: "Tokyo", stops: 2, window: null, span: null, firstStart: null });
  });

  it("reports no cost rather than zero when nothing on the day is priced", () => {
    // Zero and "unpriced" are different answers; a card showing $0.00 for a day
    // nobody has costed would be a fabricated one.
    const { day, activities } = dayOf([stop("a", "Tokyo", { start: "09:00", end: "10:00" })]);
    expect(calendarCityCards(day, activities)[0]!.costMinor).toBeNull();
  });

  it("sums only the priced stops when a group is partly costed", () => {
    const { day, activities } = dayOf([
      stop("a", "Tokyo", { start: "09:00", end: "10:00" }, 700),
      stop("b", "Tokyo", { start: "11:00", end: "12:00" }),
    ]);
    expect(calendarCityCards(day, activities)[0]!.costMinor).toBe(700);
  });

  // These two have been round the houses, so the reasoning is worth keeping.
  //
  // Originally an unlocated stop was folded into whatever group was in
  // progress, and a day that opened unlocated adopted the first city it later
  // learned about — a guess, and the one that let a venue NAME become a city
  // heading. `d2a8627` stopped that: no city means no city, and such stops went
  // into a `city: null` group of their own.
  //
  // That over-corrected. CalendarLens renders every group but the arriving one
  // as a one-line "<city> <time>" strip, so a nameless group rendered an empty
  // label and a naked timestamp floating above the card — Mitchell, walking the
  // #71 preview: "Whats with the time above the card?"
  //
  // They now fold into the day's LAST city. The distinction that makes this
  // right rather than a return to the guess: folding does not *label* the stop
  // or claim it happened in Rome — nothing renders its location. It only counts
  // it in the day the user actually put it on, which is true by construction.
  // The thing `d2a8627` forbade — inventing a place name from a venue — is
  // still forbidden, and `cityFor`/`shortPlace` still never fall back to name.
  it("folds an unlocated stop into the day's last city rather than opening a nameless group", () => {
    const { day, activities } = dayOf([
      stop("a", "Rome", { start: "09:00", end: "11:00" }, 1000),
      stop("b", "Rome", { start: "11:30", end: "12:30" }, 500),
      // Priced on purpose: `costMinor` is the third thing folding is supposed
      // to carry, and asserting only count and window would leave that claim
      // enforced by a comment alone (CodeRabbit, #71). 1750 vs 1500 is what
      // separates "folded" from "counted but its money dropped".
      stop("c", null, { start: "17:00", end: "17:30" }, 250),
    ]);

    const cards = calendarCityCards(day, activities);
    expect(cards).toHaveLength(1);
    // Rome carries all three: the stop happened on this day, so its count, its
    // cost and its time belong in the day's numbers rather than a ghost group.
    expect(cards[0]).toMatchObject({
      city: "Rome",
      stops: 3,
      costMinor: 1750,
      window: { start: "09:00", end: "17:30" },
    });
  });

  it("folds unlocated stops on both sides of a city into that city, not into groups of their own", () => {
    const { day, activities } = dayOf([
      stop("a", null, { start: "08:00", end: "09:00" }),
      stop("b", "Kyoto", { start: "10:00", end: "11:00" }),
      stop("c", null, { start: "12:00", end: "13:00" }),
    ]);

    const cards = calendarCityCards(day, activities);
    // Two unlocated stops on either side of Kyoto: neither opens a group, and
    // the day does not fragment into anonymous places. Kyoto is the day's only
    // city, so it is the day, and it counts all three.
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ city: "Kyoto", stops: 3, window: { start: "08:00", end: "13:00" } });
  });

  it("groups stops with no location at all under a null city", () => {
    const { day, activities } = dayOf([stop("a", null, { start: "09:00", end: "10:00" })]);
    expect(calendarCityCards(day, activities)[0]!.city).toBeNull();
  });

  it("is empty for a day with nothing on it", () => {
    const { day, activities } = dayOf([]);
    expect(calendarCityCards(day, activities)).toEqual([]);
  });

  it("skips an id the trip no longer has rather than throwing", () => {
    const { day, activities } = dayOf([stop("a", "Tokyo", { start: "09:00", end: "10:00" })]);
    const withGhost = { ...day, activityIds: [...day.activityIds, "deleted-since"] };

    expect(calendarCityCards(withGhost, activities)).toHaveLength(1);
  });
});
