// `tripNow` (ADR-080 decisions 1-3): where a trip is right now, read with every
// stop's `HH:MM` local to its day's zone and the device's zone where a day has
// none. The examples pin each phase and the badge's words; the properties hold
// the zone rule for any mix of day zones, device zone and instant, checked
// against the wall clocks themselves (`clockIn`, instant → wall time) rather
// than the wall time → instant arithmetic `now.ts` does, so a slip in that
// arithmetic cannot agree with itself.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ActivityView, TripDetail, TripGlobals, TripGlobalsDay } from "@tc/contracts";
import { activityFactory, tripDetailFixture, uuidFrom } from "@tc/factories";
import { clockIn, noonIn } from "./clock";
import { witness } from "./test-support/witness";
import { formatTimeUntil, nextFlight, SOON_DAYS, tripNow } from "./now";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

type DaySpec = { date: string | null; zone: string | null; stops: Partial<ActivityView>[] };

/** A trip and its globals from one spec per day; the globals carry only what `tripNow` reads. */
function tripOf(days: DaySpec[]): { trip: TripDetail; globals: Pick<TripGlobals, "days"> } {
  const activities: Record<string, ActivityView> = {};
  const tripDays = days.map((day, d) => {
    const activityIds = day.stops.map((stop, s) => {
      const activityId = uuidFrom(d + 1, s + 1);
      activities[activityId] = activityFactory.build({ ...stop, activityId });
      return activityId;
    });
    return { dayId: uuidFrom(d + 1), activityIds, date: day.date, costSubtotal: 0 };
  });
  const globalsDays = days.map(
    (day, index): TripGlobalsDay => ({
      index,
      date: day.date,
      cities: [],
      activityCount: day.stops.length,
      costSubtotal: 0,
      place: day.zone === null ? null : { lat: 0, lng: 0, city: null },
      timeZone: day.zone,
    }),
  );
  return {
    trip: tripDetailFixture({ startDate: days[0]?.date ?? null, days: tripDays, activities }),
    globals: { days: globalsDays },
  };
}

/** The instant a wall clock in `zone` reads `time` on `date` (June: no zone below changes clocks). */
const wallAt = (zone: string, date: string, time: string): number => {
  const [h, m] = time.split(":").map(Number);
  return noonIn(zone, date) + ((h! - 12) * 60 + m!) * MINUTE;
};

const window = (start: string, end: string) => ({ timeWindow: { start, end } });

describe("tripNow — phases", () => {
  const twoDays = tripOf([
    { date: "2026-06-10", zone: "Europe/Lisbon", stops: [window("09:00", "10:00")] },
    { date: "2026-06-11", zone: "Europe/Lisbon", stops: [] },
  ]);
  const at = (date: string, time = "12:00") => ({ at: wallAt("Europe/Lisbon", date, time), deviceZone: "Europe/Lisbon" });

  it("is planning for an undated trip, with nothing current", () => {
    const { trip, globals } = tripOf([{ date: null, zone: null, stops: [window("09:00", "10:00")] }]);
    expect(tripNow(trip, globals, at("2026-06-10"))).toEqual({ phase: "planning", dayId: null, current: null, next: null, firstDayToday: null });
  });

  it("is planning more than three days out, and soon from three days before the start", () => {
    expect(SOON_DAYS).toBe(3);
    expect(tripNow(twoDays.trip, twoDays.globals, at("2026-06-06")).phase).toBe("planning");
    expect(tripNow(twoDays.trip, twoDays.globals, at("2026-06-07")).phase).toBe("soon");
    expect(tripNow(twoDays.trip, twoDays.globals, at("2026-06-09", "23:59")).phase).toBe("soon");
  });

  it("is under way from the first day to the last, on that day, and ended after", () => {
    const first = tripNow(twoDays.trip, twoDays.globals, at("2026-06-10", "00:00"));
    expect(first).toMatchObject({ phase: "underway", dayId: twoDays.trip.days[0]!.dayId });
    expect(tripNow(twoDays.trip, twoDays.globals, at("2026-06-11", "23:59"))).toMatchObject({
      phase: "underway",
      dayId: twoDays.trip.days[1]!.dayId,
    });
    expect(tripNow(twoDays.trip, twoDays.globals, at("2026-06-12", "00:00"))).toMatchObject({ phase: "ended", dayId: null });
  });

  it("turns the day at midnight in the day's zone, not the device's", () => {
    const { trip, globals } = tripOf([
      { date: "2026-06-10", zone: "Asia/Tokyo", stops: [] },
      { date: "2026-06-11", zone: "Asia/Tokyo", stops: [] },
    ]);
    // 00:10 on the 11th in Tokyo is still the 10th in Los Angeles.
    const now = { at: wallAt("Asia/Tokyo", "2026-06-11", "00:10"), deviceZone: "America/Los_Angeles" };
    expect(tripNow(trip, globals, now).dayId).toBe(trip.days[1]!.dayId);
  });

  it("keeps a day until it ends on its own clock, after a flight east and after one west", () => {
    const east = tripOf([
      { date: "2026-06-10", zone: "Europe/Lisbon", stops: [window("19:00", "21:00")] },
      { date: "2026-06-11", zone: "Asia/Tokyo", stops: [] },
    ]);
    // 17:00 in Lisbon is already the 11th in Tokyo, but dinner in Lisbon is still to come.
    const afternoon = { at: wallAt("Europe/Lisbon", "2026-06-10", "17:00"), deviceZone: "Europe/Lisbon" };
    expect(tripNow(east.trip, east.globals, afternoon)).toMatchObject({
      dayId: east.trip.days[0]!.dayId,
      next: { activityId: east.trip.days[0]!.activityIds[0] },
    });
    const lisbonMidnight = { ...afternoon, at: wallAt("Europe/Lisbon", "2026-06-11", "00:00") };
    expect(tripNow(east.trip, east.globals, lisbonMidnight).dayId).toBe(east.trip.days[1]!.dayId);

    const west = tripOf([
      { date: "2026-06-10", zone: "Asia/Tokyo", stops: [] },
      { date: "2026-06-11", zone: "Europe/Lisbon", stops: [] },
    ]);
    // 02:00 on the 11th in Tokyo is still the 10th in Lisbon: day 1 has ended and day 2 not begun.
    const between = { at: wallAt("Asia/Tokyo", "2026-06-11", "02:00"), deviceZone: "Asia/Tokyo" };
    expect(tripNow(west.trip, west.globals, between).dayId).toBe(west.trip.days[0]!.dayId);
  });

  it("reads a day with no zone on the device's clock", () => {
    const { trip, globals } = tripOf([{ date: "2026-06-10", zone: null, stops: [window("09:00", "10:00")] }]);
    const now = { at: wallAt("Asia/Kolkata", "2026-06-10", "09:30"), deviceZone: "Asia/Kolkata" };
    expect(tripNow(trip, globals, now).current?.activityId).toBe(trip.days[0]!.activityIds[0]);
    // The same instant on a London phone is 05:00, before the stop.
    expect(tripNow(trip, globals, { ...now, deviceZone: "Europe/London" }).current).toBeNull();
  });

  it("runs on the device's zone while the globals have not loaded", () => {
    const { trip } = tripOf([{ date: "2026-06-10", zone: "Asia/Tokyo", stops: [window("09:00", "10:00")] }]);
    const now = { at: wallAt("Europe/Lisbon", "2026-06-10", "09:30"), deviceZone: "Europe/Lisbon" };
    expect(tripNow(trip, null, now).current?.activityId).toBe(trip.days[0]!.activityIds[0]);
  });
});

describe("tripNow — now and next", () => {
  const flight = { kind: "transit" as const, mode: "flight" as const };
  // Lisbon to Tokyo: the flight leaves at 10:00 Lisbon time on day 1, and day 2
  // is in Tokyo, eight hours ahead.
  const { trip, globals } = tripOf([
    { date: "2026-06-10", zone: "Europe/Lisbon", stops: [window("08:00", "09:00"), { ...window("10:00", "23:00"), ...flight }] },
    { date: "2026-06-11", zone: "Asia/Tokyo", stops: [window("09:00", "11:00")] },
  ]);
  const [breakfast, departure] = trip.days[0]!.activityIds;
  const [temple] = trip.days[1]!.activityIds;

  it("names the stop under way and the one after it, each in its own day's zone", () => {
    const now = { at: wallAt("Europe/Lisbon", "2026-06-10", "08:30"), deviceZone: "Europe/Lisbon" };
    const result = tripNow(trip, globals, now);
    expect(result.current).toMatchObject({ activityId: breakfast, start: wallAt("Europe/Lisbon", "2026-06-10", "08:00") });
    expect(result.next).toMatchObject({ activityId: departure, start: wallAt("Europe/Lisbon", "2026-06-10", "10:00") });
  });

  it("finds the next stop on a day in another zone", () => {
    // 01:00 Lisbon on the 11th is 09:00 in Tokyo, when the temple opens.
    const now = { at: wallAt("Asia/Tokyo", "2026-06-11", "08:59"), deviceZone: "Europe/Lisbon" };
    expect(tripNow(trip, globals, now).next).toMatchObject({ activityId: temple, start: wallAt("Asia/Tokyo", "2026-06-11", "09:00") });
  });

  it("finds the first flight that has not left, and none once it has", () => {
    const before = { at: wallAt("Europe/Lisbon", "2026-06-08", "07:00"), deviceZone: "America/New_York" };
    expect(nextFlight(trip, globals, before)).toMatchObject({ activityId: departure });
    expect(nextFlight(trip, globals, before)!.start - before.at).toBe(2 * DAY + 3 * HOUR);
    const after = { at: wallAt("Europe/Lisbon", "2026-06-10", "10:01"), deviceZone: "Europe/Lisbon" };
    expect(nextFlight(trip, globals, after)).toBeNull();
  });
});

describe("formatTimeUntil", () => {
  it("says days and hours, hours alone, or minutes", () => {
    expect(formatTimeUntil(2 * DAY + 7 * HOUR + 59 * MINUTE)).toBe("2 days, 7 h");
    expect(formatTimeUntil(1 * DAY + 30 * MINUTE)).toBe("1 day");
    expect(formatTimeUntil(5 * HOUR)).toBe("5 h");
    expect(formatTimeUntil(42 * MINUTE)).toBe("42 min");
    expect(formatTimeUntil(0)).toBe("0 min");
  });
});

// ---- Properties ----

const RUNS = 300;
// Half- and quarter-hour offsets, both sides of the date line, and UTC. June
// dates only: none of these changes its clocks in June, so a wall time always
// exists exactly once and `wallAt` above is exact.
const ZONES = [
  "Europe/Lisbon", "Asia/Tokyo", "America/Los_Angeles", "Pacific/Auckland", "Asia/Kolkata",
  "Asia/Kathmandu", "America/Sao_Paulo", "Pacific/Kiritimati", "Pacific/Pago_Pago", "UTC",
];
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const dateAfter = (start: string, days: number) => new Date(Date.parse(start) + days * DAY).toISOString().slice(0, 10);

// A window that starts at midnight a quarter of the time, so the day boundary
// is where many stops begin.
const windowArb = fc
  .tuple(fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 1438 })), fc.integer({ min: 1, max: 600 }))
  .map(([start, length]) => window(hhmm(start), hhmm(Math.min(start + length, 1439))));
const stopArb = fc.tuple(windowArb, fc.boolean()).map(([w, flies]) =>
  flies ? { ...w, kind: "transit" as const, mode: "flight" as const } : w,
);
// A day with no zone a third of the time; consecutive days in different zones
// are a flight landing somewhere else.
const zoneArb = fc.oneof(fc.constant(null), fc.constantFrom(...ZONES), fc.constantFrom(...ZONES));

const caseArb = fc
  .record({
    start: fc.integer({ min: 0, max: 15 }).map((n) => dateAfter("2026-06-01", n)),
    days: fc.array(fc.record({ zone: zoneArb, stops: fc.array(stopArb, { maxLength: 3 }) }), { minLength: 1, maxLength: 4 }),
    deviceZone: fc.constantFrom(...ZONES),
    // The reader's wall clock, in one of the zones in play: a day from the
    // trip's range or just outside it, at midnight, a minute before it, or
    // any minute; or, half the time, a minute inside one of the stops on that
    // stop's own day's clock, so a stop under way is common rather than rare.
    aim: fc.option(fc.tuple(fc.nat(), fc.nat()), { nil: null }),
    dayOffset: fc.integer({ min: -5, max: 5 }),
    clockZone: fc.constantFrom(...ZONES),
    minute: fc.oneof(fc.constant(0), fc.constant(1439), fc.integer({ min: 0, max: 1439 })),
  })
  .map(({ start, days, deviceZone, aim, dayOffset, clockZone, minute }) => {
    const specs = days.map((d, i) => ({ ...d, date: dateAfter(start, i) }));
    const { trip, globals } = tripOf(specs);
    const stops = specs.flatMap((d) => d.stops.map((stop) => ({ ...stop.timeWindow, zone: d.zone ?? deviceZone, date: d.date })));
    const target = aim === null || stops.length === 0 ? null : stops[aim[0] % stops.length]!;
    const at =
      target === null
        ? wallAt(clockZone, dateAfter(start, dayOffset), hhmm(minute))
        : wallAt(target.zone, target.date, target.start) + (aim![1] % 600) * MINUTE;
    return { specs, trip, globals, now: { at, deviceZone } };
  });

describe("tripNow — properties", () => {
  it("is under way exactly while the first day has begun and the last has not ended, each in its own zone", () => {
    const w = witness("under way, with a day");
    // What a flight east makes: the next day's midnight has come and today holds.
    const held = witness("a day held past the next day's midnight");
    fc.assert(
      fc.property(caseArb, ({ specs, trip, globals, now }) => {
        const zoneOf = (i: number) => specs[i]!.zone ?? now.deviceZone;
        const todayIn = (i: number) => clockIn(zoneOf(i), now.at).date;
        const last = specs.length - 1;
        const result = tripNow(trip, globals, now);
        const days = (Date.parse(specs[0]!.date) - Date.parse(todayIn(0))) / DAY;
        const expected =
          days > SOON_DAYS ? "planning" : days > 0 ? "soon" : todayIn(last) > specs[last]!.date ? "ended" : "underway";
        expect(result.phase).toBe(expected);
        if (expected !== "underway") {
          expect(result.dayId).toBeNull();
          return;
        }
        // Days hand over in order: today has begun on its own clock, every day
        // before it has ended on its own, and it gives way only once it has
        // ended and the next has begun. No more than one day meets all three.
        w.tick();
        const i = trip.days.findIndex((d) => d.dayId === result.dayId);
        const begun = (j: number) => specs[j]!.date <= todayIn(j);
        const ended = (j: number) => specs[j]!.date < todayIn(j);
        expect(begun(i)).toBe(true);
        for (let j = 0; j < i; j++) expect(ended(j)).toBe(true);
        if (i < last) expect(ended(i) && begun(i + 1)).toBe(false);
        if (i < last && begun(i + 1)) held.tick();
      }),
      { numRuns: RUNS },
    );
    w.atLeast(110); // observed 222-241 of 300
    held.atLeast(12); // observed 25-43 of 300
  });

  it("calls a stop current exactly when its day's wall clock is inside its window, and next is the first still to start", () => {
    const w = witness("a stop under way");
    fc.assert(
      fc.property(caseArb, ({ specs, trip, globals, now }) => {
        const result = tripNow(trip, globals, now);
        const zoneOf = (i: number) => specs[i]!.zone ?? now.deviceZone;
        const stops = trip.days.flatMap((day, i) =>
          day.activityIds.map((activityId) => ({ activityId, i, tw: trip.activities[activityId]!.timeWindow! })),
        );
        const inside = stops.filter(({ i, tw }) => {
          const wall = clockIn(zoneOf(i), now.at);
          return wall.date === specs[i]!.date && tw.start <= wall.time && wall.time < tw.end;
        });
        expect(result.current === null).toBe(inside.length === 0);
        if (result.current !== null) {
          w.tick();
          expect(inside.map((s) => s.activityId)).toContain(result.current.activityId);
        }
        if (result.next !== null) {
          const { i, tw } = stops.find((s) => s.activityId === result.next!.activityId)!;
          expect(result.next.start).toBeGreaterThan(now.at);
          // Its instant reads as its own start on its own day's clock.
          expect(clockIn(zoneOf(i), result.next.start)).toEqual({ date: specs[i]!.date, time: tw.start });
        }
      }),
      { numRuns: RUNS },
    );
    w.atLeast(65); // observed 136-167 of 300
  });
});
