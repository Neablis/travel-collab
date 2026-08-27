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

  it("does not let an unlocated stop split the day", () => {
    // A flight home with no location does not mean the day left the city — it
    // means nobody geocoded it. Splitting there handed the day's card to a
    // nameless group and demoted the real city to a strip.
    const { day, activities } = dayOf([
      stop("a", "Rome", { start: "09:00", end: "11:00" }),
      stop("b", "Rome", { start: "11:30", end: "12:30" }),
      stop("c", null, { start: "17:00", end: "17:30" }),
    ]);

    const cards = calendarCityCards(day, activities);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ city: "Rome", stops: 3, window: { start: "09:00", end: "17:30" } });
  });

  it("adopts the first city it learns about when a day opens unlocated", () => {
    const { day, activities } = dayOf([
      stop("a", null, { start: "08:00", end: "09:00" }),
      stop("b", "Kyoto", { start: "10:00", end: "11:00" }),
    ]);

    expect(calendarCityCards(day, activities)).toHaveLength(1);
    expect(calendarCityCards(day, activities)[0]!.city).toBe("Kyoto");
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
