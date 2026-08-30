import { describe, expect, it } from "vitest";
import type { ActivityView, TripDetail } from "@tc/contracts";
import { calendarCityCards, SPAN_TRACK_START_MIN, SPAN_TRACK_END_MIN } from "./calendarCityCards";

function stop(
  id: string,
  city: string | null,
  window: { start: string; end: string } | null,
  costMinor?: number,
  kind: ActivityView["kind"] = "planned",
  tags: ActivityView["tags"] = [],
): ActivityView {
  return {
    activityId: id,
    title: id,
    timeWindow: window,
    location: city === null ? null : { name: city, city, lat: 0, lng: 0 },
    notes: null,
    anchors: [],
    kind,
    tags,
    cost: costMinor === undefined ? null : { amountMinor: costMinor, currency: "USD" },
  };
}

/** A transit stop, filed under the city it travels TO — as the fixture does. */
function transit(id: string, toCity: string, window: { start: string; end: string }): ActivityView {
  return stop(id, toCity, window, undefined, "transit");
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
        matches: null,
        toBook: 0,
      },
    ]);
  });

  // M18b. The Calendar's focus rule is a COUNT, not a per-stop dim: at a
  // month's zoom the card is the unit, so it reports how many of its stops
  // carry the focused tag and `CalendarLens` dims the card that carries none.
  describe("the focused-tag match count", () => {
    it("is null on every card when no tag is focused", () => {
      const { day, activities } = dayOf([
        stop("a", "Tokyo", { start: "09:00", end: "10:00" }, undefined, "planned", ["meal"]),
        stop("b", "Kyoto", { start: "13:00", end: "14:00" }),
      ]);

      // Null rather than the stop count, so the lens can tell "nothing is
      // focused" from "a focus everything happens to match" without being
      // handed the focus a second time.
      expect(calendarCityCards(day, activities).map((c) => c.matches)).toEqual([null, null]);
      expect(calendarCityCards(day, activities, null).map((c) => c.matches)).toEqual([null, null]);
    });

    it("counts only the stops carrying the focused tag, per card", () => {
      const { day, activities } = dayOf([
        stop("a", "Tokyo", { start: "09:00", end: "10:00" }, undefined, "planned", ["meal"]),
        stop("b", "Tokyo", { start: "11:00", end: "12:00" }, undefined, "planned", ["meal", "outdoors"]),
        stop("c", "Tokyo", { start: "13:00", end: "14:00" }, undefined, "planned", ["outdoors"]),
        stop("d", "Kyoto", { start: "18:00", end: "19:00" }, undefined, "planned", ["outdoors"]),
      ]);

      const cards = calendarCityCards(day, activities, "meal");
      expect(cards.map((c) => [c.city, c.matches, c.stops])).toEqual([
        ["Tokyo", 2, 3],
        // Zero, not null — this is the card CalendarLens drops to 0.28.
        ["Kyoto", 0, 1],
      ]);
    });

    it("counts the untitled bucket like any other card", () => {
      const { day, activities } = dayOf([
        stop("a", "Tokyo", { start: "09:00", end: "10:00" }, undefined, "planned", ["meal"]),
        stop("b", null, null, undefined, "planned", ["meal"]),
        stop("c", null, null),
      ]);

      const cards = calendarCityCards(day, activities, "meal");
      expect(cards[cards.length - 1]!.city).toBeNull();
      expect(cards[cards.length - 1]!.matches).toBe(1);
      expect(cards[cards.length - 1]!.stops).toBe(2);
    });

    // Focus never regroups: the same day yields the same cards in the same
    // order whether or not a tag is focused. Dim, never hide — a card that
    // matches nothing still exists, still carries its stop count, its cost and
    // its window, and still occupies its place in the day.
    it("changes no other field, and drops no card", () => {
      const { day, activities } = dayOf([
        stop("a", "Tokyo", { start: "09:00", end: "10:00" }, 1000, "planned", ["meal"]),
        stop("b", "Kyoto", { start: "13:00", end: "14:00" }, 500),
      ]);

      const unfocused = calendarCityCards(day, activities);
      const focused = calendarCityCards(day, activities, "meal");
      expect(focused).toHaveLength(unfocused.length);
      expect(focused.map(({ matches: _m, ...rest }) => rest)).toEqual(
        unfocused.map(({ matches: _m, ...rest }) => rest),
      );
    });
  });

  // The Calendar groups purely by city — Mitchell, 2026-08-29: "I kinda always
  // pictured the calendar page a zoomed out trip, what cities are on what days
  // of the week, it doesn't really concern itself with the day of activities,
  // which is what transit is about. Timeline view and map view is how I zoom in
  // and see a specific day." So `kind` never reaches this function's grouping.
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

  // The `N to book` rule, narrower than SPEC §12's literal "every stop whose
  // kind is neither `booked` nor `transit`" — that wording flagged 50 of the
  // Japan fixture's 72 stops, including every coffee and every free shrine.
  // Mitchell, 2026-08-29. See `lib/needsBooking.ts` for the full reasoning.
  describe("the unbooked count", () => {
    it("counts hold and idea, which a user set deliberately to mean unsettled", () => {
      const { day, activities } = dayOf([
        stop("hotel", "Kyoto", { start: "15:00", end: "16:00" }, undefined, "booked"),
        stop("maybe", "Kyoto", { start: "17:00", end: "18:00" }, undefined, "idea"),
        stop("dinner", "Kyoto", { start: "19:00", end: "21:00" }, undefined, "hold"),
      ]);

      expect(calendarCityCards(day, activities)[0]!.toBook).toBe(2);
    });

    it("does NOT count a plain `planned` stop — the default is not a decision", () => {
      // A morning coffee and a walk through a shrine are `planned` because
      // nothing said otherwise. Neither owes anyone a booking.
      const { day, activities } = dayOf([
        stop("coffee", "Kyoto", { start: "08:00", end: "08:30" }),
        stop("shrine", "Kyoto", { start: "09:00", end: "11:00" }, undefined, "planned", ["outdoors"]),
      ]);

      expect(calendarCityCards(day, activities)[0]!.toBook).toBe(0);
    });

    it("DOES count a `planned` stop tagged `ticketed` — the tag's own designed power", () => {
      // The handoff's TAGS table: "Ticketed — Wants a booking date. The
      // assistant keeps asking until there is one."
      const { day, activities } = dayOf([
        stop("museum", "Kyoto", { start: "10:00", end: "12:00" }, undefined, "planned", ["ticketed"]),
        stop("coffee", "Kyoto", { start: "13:00", end: "13:30" }, undefined, "planned", ["meal"]),
      ]);

      expect(calendarCityCards(day, activities)[0]!.toBook).toBe(1);
    });

    it("does not count a ticketed stop that is already booked", () => {
      const { day, activities } = dayOf([
        stop("museum", "Kyoto", { start: "10:00", end: "12:00" }, undefined, "booked", ["ticketed"]),
      ]);

      expect(calendarCityCards(day, activities)[0]!.toBook).toBe(0);
    });

    it("is zero, not null, when nothing on the day needs booking", () => {
      const { day, activities } = dayOf([
        stop("hotel", "Kyoto", { start: "15:00", end: "16:00" }, undefined, "booked"),
        transit("bus", "Kyoto", { start: "14:00", end: "14:40" }),
      ]);

      expect(calendarCityCards(day, activities)[0]!.toBook).toBe(0);
    });

    it("counts per card, so a travel day's two cities each carry their own", () => {
      const { day, activities } = dayOf([
        stop("breakfast", "Tokyo", { start: "07:00", end: "07:40" }, undefined, "idea"),
        transit("shinkansen", "Kyoto", { start: "08:20", end: "10:35" }),
        stop("lunch", "Kyoto", { start: "12:00", end: "13:00" }, undefined, "booked"),
        stop("temple", "Kyoto", { start: "15:00", end: "17:00" }, undefined, "hold"),
      ]);

      const cards = calendarCityCards(day, activities);
      expect(cards[0]!.toBook).toBe(1);
      expect(cards[1]!.toBook).toBe(1);
    });
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

  // Round the houses three times now, so the whole arc is worth keeping.
  //
  // Originally an unlocated stop was folded into whatever group was in
  // progress, and a day that opened unlocated adopted the first city it later
  // learned about — a guess, and the one that let a venue NAME become a city
  // heading. `d2a8627` stopped that: no city means no city, and such stops went
  // into a `city: null` group of their own.
  //
  // That over-corrected, because CalendarLens then rendered every group but the
  // arriving one as a one-line "<city> <time>" strip — so a nameless group
  // rendered an empty label and a naked timestamp floating above the card
  // (Mitchell, walking the #71 preview: "Whats with the time above the card?").
  // The fix at the time was to fold them into the day's last city.
  //
  // **Now they get their own card again (Mitchell, 2026-08-29)** — which is his
  // standing instruction from that same #71 preview, restored: "Never fall back
  // to name, if you have absolutely no city, then make a new bucket with no city
  // in title." What makes it work this time is the presentation, not the
  // grouping: M18 dropped strips entirely, so every group renders as a full
  // card. A bucket with no city in its header is a legible card; it was only
  // ever illegible as a strip.
  //
  // One bucket per day, not one per stop, and it sorts last — a day never
  // fragments into several anonymous places.
  it("gives unlocated stops their own bucket card rather than folding them into a city", () => {
    const { day, activities } = dayOf([
      stop("a", "Rome", { start: "09:00", end: "11:00" }, 1000),
      stop("b", "Rome", { start: "11:30", end: "12:30" }, 500),
      stop("c", null, { start: "17:00", end: "17:30" }, 250),
    ]);

    const cards = calendarCityCards(day, activities);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ city: "Rome", stops: 2, costMinor: 1500 });
    // The bucket keeps its own count, cost and window rather than donating them
    // to a city it was never in.
    expect(cards[1]).toMatchObject({
      city: null,
      stops: 1,
      costMinor: 250,
      window: { start: "17:00", end: "17:30" },
    });
  });

  it("collects unlocated stops from both sides of a city into ONE bucket, not two", () => {
    const { day, activities } = dayOf([
      stop("a", null, { start: "08:00", end: "09:00" }),
      stop("b", "Kyoto", { start: "10:00", end: "11:00" }),
      stop("c", null, { start: "12:00", end: "13:00" }),
    ]);

    const cards = calendarCityCards(day, activities);
    expect(cards.map((c) => c.city)).toEqual(["Kyoto", null]);
    expect(cards[1]!.stops).toBe(2);
    // The bucket's window spans both, even though a city sat between them in
    // the day's order — it is one bucket of "we don't know where", not a
    // sequence.
    expect(cards[1]!.window).toEqual({ start: "08:00", end: "13:00" });
  });

  // Mitchell's own worked example, 2026-08-29: "if I have 5 activities, 3 in
  // Tokyo, 1 in Kyoto and 1 with no place/city/address, I would expect 3 cards".
  it("renders Mitchell's worked example as three cards", () => {
    const { day, activities } = dayOf([
      stop("a", "Tokyo", { start: "09:00", end: "10:00" }),
      stop("b", "Tokyo", { start: "10:30", end: "11:30" }),
      stop("c", "Tokyo", { start: "12:00", end: "13:00" }),
      stop("d", "Kyoto", { start: "16:00", end: "17:00" }),
      stop("e", null, { start: "19:00", end: "20:00" }),
    ]);

    const cards = calendarCityCards(day, activities);
    expect(cards.map((c) => [c.city, c.stops])).toEqual([
      ["Tokyo", 3],
      ["Kyoto", 1],
      [null, 1],
    ]);
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
