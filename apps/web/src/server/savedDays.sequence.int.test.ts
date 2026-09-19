import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { SavedStop } from "@tc/contracts";

import { db } from "./db/client";
import { savedDays } from "./db/schema";
import { executeTripCommand } from "./commands";
import { getTripDetail } from "./projections";
import { getSavedDay, insertSavedDay, saveDay, setSavedDayVisibility } from "./savedDays";
import { discoverDays } from "./playbooks";

// M23 — a Playbook is a sequence of days. The gate boxes that can only be
// answered against a real database live here: both read boundaries over a
// pre-migration row, a three-day round trip, and the insert holding its "one
// batch, one undo" property over N days rather than over one day's stops.

let OWNER = "";
beforeEach(() => {
  OWNER = `m23-owner-${randomUUID().slice(0, 8)}`;
});

/** A trip with `days` days; day N holds `stopsPerDay[N]` stops. */
async function tripWith(stopsPerDay: string[][]): Promise<{ tripId: string; dayIds: string[] }> {
  const tripId = randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Kansai" }, OWNER);
  const dayIds: string[] = [];
  for (const [index, titles] of stopsPerDay.entries()) {
    const dayId = randomUUID();
    dayIds.push(dayId);
    await executeTripCommand({ type: "AddDay", tripId, dayId }, OWNER);
    for (const [i, title] of titles.entries()) {
      await executeTripCommand(
        {
          type: "AddActivity",
          tripId,
          activityId: randomUUID(),
          dayId,
          title,
          // Zero-padded properly: `0${8 + i}` gives "010:00" from the third
          // stop on, which `TimeWindow` rejects — and a rejected AddActivity
          // makes this helper quietly build a smaller trip than it claims.
          timeWindow: { start: `${String(8 + i).padStart(2, "0")}:00`, end: `${String(9 + i).padStart(2, "0")}:00` },
          location: { name: title, city: index === 0 ? "Kyoto" : "Osaka" },
        },
        OWNER,
      );
    }
  }
  return { tripId, dayIds };
}

describe("a Playbook written before M23 still reads, through BOTH parse sites", () => {
  /**
   * A row exactly as the write path left it before this milestone: stops with
   * no `dayIndex`, and no `day_count` column value of its own.
   *
   * The cast is the honest spelling of "these are the old bytes" —
   * `jsonb("stops").$type<SavedStop[]>()` is a compile-time claim about what
   * the write path intends, never about what is stored (KI-71).
   */
  async function rowInThePreMigrationShape(): Promise<string> {
    const id = randomUUID();
    await db.insert(savedDays).values({
      id,
      ownerId: OWNER,
      name: "Kept before M23",
      stops: [
        { title: "Fushimi Inari", timeWindow: { start: "09:00", end: "11:00" }, location: { name: "Fushimi Inari", city: "Kyoto" }, notes: null, anchors: [], kind: "planned", tags: [], cost: null },
        { title: "Nishiki", timeWindow: { start: "13:00", end: "14:00" }, location: { name: "Nishiki", city: "Kyoto" }, notes: null, anchors: [], kind: "planned", tags: [], cost: null },
      ] as unknown as SavedStop[],
      cities: ["Kyoto"],
      visibility: "public",
      sourceTripId: randomUUID(),
      sourceTripName: "Kansai",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
    });
    return id;
  }

  // `fromRow` — the library read.
  it("reads unchanged through the library, on one day and in the stored order", async () => {
    const id = await rowInThePreMigrationShape();
    const day = await getSavedDay(id, OWNER);
    expect(day).not.toBeNull();
    expect(day!.stops.map((s) => s.title)).toEqual(["Fushimi Inari", "Nishiki"]);
    expect(day!.stops.map((s) => s.dayIndex)).toEqual([0, 0]);
    expect(day!.dayCount).toBe(1);
  });

  // `toDiscoverDay` — the Discover read. A DIFFERENT function over the same
  // bytes, which is exactly why the milestone names both: a row that reads as
  // one day here and something else there is worse than either answer.
  it("reads unchanged on its Discover card, as one day", async () => {
    const id = await rowInThePreMigrationShape();
    const found = await discoverDays({
      cities: ["Kyoto"],
      scope: "everyone",
      sort: "newest",
      budget: "any",
      length: "any",
      readerId: OWNER,
    });
    const card = found.days.find((d) => d.savedDayId === id);
    expect(card).toBeDefined();
    expect(card!.dayCount).toBe(1);
    expect(card!.stopCount).toBe(2);
  });

  // The whole point of the migration being additive: it is still findable, and
  // it lands in the band a one-day Playbook belongs in.
  it("is still found by the new length filter, as a one-day Playbook", async () => {
    const id = await rowInThePreMigrationShape();
    const one = await discoverDays({
      cities: ["Kyoto"], scope: "everyone", sort: "newest", budget: "any", length: "one", readerId: OWNER,
    });
    expect(one.days.map((d) => d.savedDayId)).toContain(id);

    const longer = await discoverDays({
      cities: ["Kyoto"], scope: "everyone", sort: "newest", budget: "any", length: "four-six", readerId: OWNER,
    });
    expect(longer.days.map((d) => d.savedDayId)).not.toContain(id);
  });
});

describe("a three-day Playbook round-trips with its day boundaries intact", () => {
  it("keeps the days the author picked, in order, with each day's stops on it", async () => {
    const { tripId, dayIds } = await tripWith([["A1", "A2"], ["B1"], ["C1", "C2", "C3"]]);
    const detail = (await getTripDetail(tripId))!;
    const saved = await saveDay({ name: "Three in Kansai", dayIds }, detail, OWNER);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const read = (await getSavedDay(saved.value.savedDayId, OWNER))!;
    expect(read.dayCount).toBe(3);
    expect(read.stops.map((s) => [s.dayIndex, s.title])).toEqual([
      [0, "A1"], [0, "A2"],
      [1, "B1"],
      [2, "C1"], [2, "C2"], [2, "C3"],
    ]);
  });

  // **Non-contiguous, which is the model** (Mitchell, 2026-09-19: "you aren't
  // selecting a range"). Trip days 1 and 3 make a TWO-day Playbook, not a
  // three-day one with a hole: the day you skipped is not in it, and the
  // Playbook renumbers from one.
  it("renumbers a non-contiguous selection from one, rather than carrying the trip's numbering", async () => {
    const { tripId, dayIds } = await tripWith([["A1"], ["B1"], ["C1"]]);
    const detail = (await getTripDetail(tripId))!;
    const saved = await saveDay({ name: "First and third", dayIds: [dayIds[0]!, dayIds[2]!] }, detail, OWNER);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const read = (await getSavedDay(saved.value.savedDayId, OWNER))!;
    expect(read.dayCount).toBe(2);
    expect(read.stops.map((s) => [s.dayIndex, s.title])).toEqual([[0, "A1"], [1, "C1"]]);
  });

  // ADR-048 decision 2, asserted against the DECISION rather than against
  // whatever the implementation happens to do. An interior empty day is a gap
  // in `dayIndex`; a trailing one exists only in `dayCount`. Both survive.
  it("keeps an INTERIOR empty day as a gap in the index", async () => {
    const { tripId, dayIds } = await tripWith([["A1"], [], ["C1"]]);
    const detail = (await getTripDetail(tripId))!;
    const saved = await saveDay({ name: "With a rest day", dayIds }, detail, OWNER);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const read = (await getSavedDay(saved.value.savedDayId, OWNER))!;
    expect(read.dayCount).toBe(3);
    expect(read.stops.map((s) => s.dayIndex)).toEqual([0, 2]);
  });

  it("keeps a TRAILING empty day, which only the stored count can hold", async () => {
    const { tripId, dayIds } = await tripWith([["A1"], ["B1"], []]);
    const detail = (await getTripDetail(tripId))!;
    const saved = await saveDay({ name: "Departure day free", dayIds }, detail, OWNER);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const read = (await getSavedDay(saved.value.savedDayId, OWNER))!;
    // The stops reach only day 1. A derived count would say two here, and the
    // author kept three.
    expect(read.stops.map((s) => s.dayIndex)).toEqual([0, 1]);
    expect(read.dayCount).toBe(3);
  });

  // `cities` is folded PER DAY (ADR-048 decision 4). Day 1 is Kyoto and the
  // rest are Osaka; `citiesOfStops` over the flat array would sort by clock
  // across days and can put Osaka first.
  it("stores cities in the sequence's own day order", async () => {
    const { tripId, dayIds } = await tripWith([["Late in Kyoto"], ["Early in Osaka"]]);
    const detail = (await getTripDetail(tripId))!;
    const saved = await saveDay({ name: "Kyoto then Osaka", dayIds }, detail, OWNER);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect((await getSavedDay(saved.value.savedDayId, OWNER))!.cities).toEqual(["Kyoto", "Osaka"]);
  });

  it("refuses a selection that names the same day twice", async () => {
    const { tripId, dayIds } = await tripWith([["A1"], ["B1"]]);
    const detail = (await getTripDetail(tripId))!;
    const saved = await saveDay({ name: "Twice", dayIds: [dayIds[0]!, dayIds[0]!] }, detail, OWNER);
    expect(saved.ok).toBe(false);
  });
});

describe("adding an N-day Playbook to a trip", () => {
  async function threeDayPlaybook(): Promise<string> {
    const { tripId, dayIds } = await tripWith([["A1", "A2"], ["B1"], ["C1"]]);
    const detail = (await getTripDetail(tripId))!;
    const saved = await saveDay({ name: "Three in Kansai", dayIds }, detail, OWNER);
    if (!saved.ok) throw new Error(saved.error.message);
    await setSavedDayVisibility(saved.value.savedDayId, OWNER, "public");
    return saved.value.savedDayId;
  }

  // The gate box: N days, appended, as ONE batch undone by ONE undo.
  it("appends N days at the end, and one undo removes all of them", async () => {
    const savedDayId = await threeDayPlaybook();
    const target = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId: target, name: "New trip" }, OWNER);
    const existing = randomUUID();
    await executeTripCommand({ type: "AddDay", tripId: target, dayId: existing }, OWNER);

    const before = (await getTripDetail(target))!;
    expect(before.days).toHaveLength(1);

    const result = await insertSavedDay(savedDayId, target, OWNER);
    expect(result.ok).toBe(true);

    const after = (await getTripDetail(target))!;
    // 1 + 3 — the trip's own day, then the Playbook's three, in its order.
    expect(after.days).toHaveLength(4);
    expect(after.days[0]!.dayId).toBe(existing);
    expect(after.days.slice(1).map((d) => d.activityIds.length)).toEqual([2, 1, 1]);

    // ADR-029's "half an inserted day is not a state anyone should be able to
    // land in", now read over a sequence: one batch, one history entry, one
    // undo. Three days appended by three undos would be exactly that half
    // state.
    const undone = await executeTripCommand({ type: "UndoLastChange", tripId: target }, OWNER);
    expect(undone.ok).toBe(true);
    const restored = (await getTripDetail(target))!;
    expect(restored.days).toHaveLength(1);
    expect(restored.days[0]!.dayId).toBe(existing);
  });

  // "A 3 day bundle becomes days 6, 7, 8" has to be true of EVERY 3-day
  // bundle, including one whose last day is blank — which is the whole reason
  // `dayCount` is stored rather than derived.
  it("appends the Playbook's empty days too", async () => {
    const { tripId, dayIds } = await tripWith([["A1"], [], []]);
    const detail = (await getTripDetail(tripId))!;
    const saved = await saveDay({ name: "One day then two free", dayIds }, detail, OWNER);
    if (!saved.ok) throw new Error(saved.error.message);

    const target = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId: target, name: "Fresh" }, OWNER);
    expect((await insertSavedDay(saved.value.savedDayId, target, OWNER)).ok).toBe(true);

    const after = (await getTripDetail(target))!;
    expect(after.days).toHaveLength(3);
    expect(after.days.map((d) => d.activityIds.length)).toEqual([1, 0, 0]);
  });

  // Link 3's third caller. `AddToTripDialog` creates the trip and then calls
  // the SAME primitive, so this is that path's server half: a fresh trip whose
  // days 1..N are the Playbook's.
  it("fills a brand-new trip's days 1..N when the trip starts empty", async () => {
    const savedDayId = await threeDayPlaybook();
    const target = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId: target, name: "Three in Kansai" }, OWNER);

    expect((await insertSavedDay(savedDayId, target, OWNER)).ok).toBe(true);
    const after = (await getTripDetail(target))!;
    expect(after.days).toHaveLength(3);
    expect(after.days.map((d) => d.activityIds.length)).toEqual([2, 1, 1]);
  });

  // A one-day Playbook is still one day. The ordinary case has to stay
  // ordinary, and this is the regression that would say it had not.
  it("still appends exactly one day for a one-day Playbook", async () => {
    const { tripId, dayIds } = await tripWith([["Only"]]);
    const detail = (await getTripDetail(tripId))!;
    const saved = await saveDay({ name: "Just the one", dayIds }, detail, OWNER);
    if (!saved.ok) throw new Error(saved.error.message);

    const target = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId: target, name: "Fresh" }, OWNER);
    expect((await insertSavedDay(saved.value.savedDayId, target, OWNER)).ok).toBe(true);
    expect((await getTripDetail(target))!.days).toHaveLength(1);
  });

  // The adds ledger keys on the SEQUENCE (ADR-048 decision 5): taking a
  // three-day Playbook is one add, not three. A count that scaled with how many
  // days an author bundled together is the gaming the ledger exists to refuse.
  it("counts a multi-day add once", async () => {
    const savedDayId = await threeDayPlaybook();
    const target = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId: target, name: "Taker" }, `taker-${randomUUID().slice(0, 8)}`);
    const taker = `taker-${randomUUID().slice(0, 8)}`;
    const own = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId: own, name: "Theirs" }, taker);
    expect((await insertSavedDay(savedDayId, own, taker)).ok).toBe(true);
    expect((await getSavedDay(savedDayId, OWNER))!.adds).toBe(1);
  });
});

describe("Discover's length filter", () => {
  it("bands a Playbook by its day count, and the bands do not overlap", async () => {
    const city = `Bandtown-${randomUUID().slice(0, 6)}`;
    async function playbookOf(days: number): Promise<string> {
      const tripId = randomUUID();
      await executeTripCommand({ type: "CreateTrip", tripId, name: "Bands" }, OWNER);
      const dayIds: string[] = [];
      for (let i = 0; i < days; i += 1) {
        const dayId = randomUUID();
        dayIds.push(dayId);
        await executeTripCommand({ type: "AddDay", tripId, dayId }, OWNER);
        await executeTripCommand(
          { type: "AddActivity", tripId, activityId: randomUUID(), dayId, title: `d${i}`, location: { name: "x", city } },
          OWNER,
        );
      }
      const saved = await saveDay({ name: `${days} days`, dayIds }, (await getTripDetail(tripId))!, OWNER);
      if (!saved.ok) throw new Error(saved.error.message);
      await setSavedDayVisibility(saved.value.savedDayId, OWNER, "public");
      return saved.value.savedDayId;
    }

    const ids = { one: await playbookOf(1), three: await playbookOf(3), five: await playbookOf(5), eight: await playbookOf(8) };
    async function inBand(length: "any" | "one" | "two-three" | "four-six" | "seven-plus") {
      const r = await discoverDays({
        cities: [city], scope: "everyone", sort: "newest", budget: "any", length, readerId: OWNER,
      });
      return r.days.map((d) => d.savedDayId).sort();
    }

    expect(await inBand("one")).toEqual([ids.one]);
    expect(await inBand("two-three")).toEqual([ids.three]);
    expect(await inBand("four-six")).toEqual([ids.five]);
    expect(await inBand("seven-plus")).toEqual([ids.eight]);
    // Every Playbook lands in exactly one band, which is the property that made
    // "1 / 2-3 / 4-6 / 7+" the reading rather than four overlapping thresholds.
    expect((await inBand("any")).length).toBe(4);
  });
});
