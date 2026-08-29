import { describe, expect, it } from "vitest";
import { JAPAN_TRIP_DAY_COUNT, JAPAN_TRIP_NAME } from "@tc/fixtures";
import type { TripDetail } from "@tc/contracts";
import { demoTripDetail } from "@/server/demoTrip";
import {
  buildReadTools,
  findFreeTime,
  readDay,
  readTrip,
  FindFreeTimeInputSchema,
  READ_TOOL_INPUT_SCHEMAS,
  READ_TOOL_NAMES,
  type DayReadout,
  type FreeTimeReadout,
} from "@/server/ai/readTools";

// The canonical fixture (ADR-030) — the 14-day Japan trip, folded through the
// real domain by `demoTripDetail()`. Not a hand-built TripDetail: a fixture
// that can drift from what the product actually renders is a fixture that
// stops catching anything, and this one is verified by `pnpm seed:verify`.
const japan: TripDetail = demoTripDetail();

// A day that carries real time windows, so the free-time assertions are about
// arithmetic rather than about an empty trip.
const firstScheduledDayIndex = japan.days.findIndex((day) =>
  day.activityIds.some((id) => japan.activities[id]?.timeWindow),
);

describe("read_trip", () => {
  it("reports the trip's shape with 1-based day numbers", () => {
    const readout = readTrip(japan);
    expect(readout.name).toBe(JAPAN_TRIP_NAME);
    expect(readout.dayCount).toBe(JAPAN_TRIP_DAY_COUNT);
    expect(readout.currency).toBe(japan.currency);
    expect(readout.tripCostTotal).toBe(japan.tripCostTotal);
    expect(readout.days).toHaveLength(JAPAN_TRIP_DAY_COUNT);
    expect(readout.days[0]!.day).toBe(1);
    expect(readout.days.at(-1)!.day).toBe(JAPAN_TRIP_DAY_COUNT);
  });

  it("carries each day's stop count and cost subtotal from the projection", () => {
    const readout = readTrip(japan);
    for (const [index, day] of japan.days.entries()) {
      expect(readout.days[index]).toMatchObject({
        day: index + 1,
        date: day.date,
        stopCount: day.activityIds.length,
        costSubtotal: day.costSubtotal,
      });
    }
  });

  // The raw Conflict id embeds UUIDs the model must never copy — the same rule
  // the command envelope follows (context.ts).
  it("exposes conflicts by ref, never by raw id", () => {
    for (const conflict of readTrip(japan).conflicts) {
      expect(conflict).toHaveProperty("ref");
      expect(conflict).not.toHaveProperty("id");
    }
  });
});

describe("read_day", () => {
  it("carries the time windows the command envelope never did", () => {
    const readout = readDay(japan, firstScheduledDayIndex + 1) as DayReadout;
    expect(readout.day).toBe(firstScheduledDayIndex + 1);
    const scheduled = readout.stops.filter((stop) => stop.timeWindow !== null);
    expect(scheduled.length).toBeGreaterThan(0);
    for (const stop of scheduled) {
      expect(stop.timeWindow!.start).toMatch(/^\d{2}:\d{2}$/);
      expect(stop.timeWindow!.end).toMatch(/^\d{2}:\d{2}$/);
    }
  });

  it("carries location, notes, kind, tags and cost for every stop", () => {
    const readout = readDay(japan, firstScheduledDayIndex + 1) as DayReadout;
    for (const stop of readout.stops) {
      expect(stop).toHaveProperty("location");
      expect(stop).toHaveProperty("notes");
      expect(stop).toHaveProperty("kind");
      expect(Array.isArray(stop.tags)).toBe(true);
      expect(stop).toHaveProperty("cost");
    }
    // Money stays integer minor units all the way to the model.
    for (const stop of readout.stops) {
      if (stop.cost) expect(Number.isInteger(stop.cost.amountMinor)).toBe(true);
    }
  });

  it("never hands the model an activity UUID", () => {
    const readout = readDay(japan, 1) as DayReadout;
    const serialized = JSON.stringify(readout);
    for (const id of Object.keys(japan.activities)) {
      expect(serialized).not.toContain(id);
    }
  });

  it("says how many days there are rather than throwing on an out-of-range day", () => {
    expect(readDay(japan, JAPAN_TRIP_DAY_COUNT + 1)).toEqual({
      error: `This trip has ${JAPAN_TRIP_DAY_COUNT} days, so there is no day ${JAPAN_TRIP_DAY_COUNT + 1}.`,
    });
    expect(readDay(japan, 0)).toHaveProperty("error");
  });
});

describe("find_free_time", () => {
  const wholeTrip = { kind: "trip" } as const;

  it("searches the whole trip when nothing narrows it", () => {
    const readout = findFreeTime(japan, wholeTrip, {}) as FreeTimeReadout;
    expect(readout.searched).toBe("the whole trip");
    expect(readout.window).toEqual({ after: "00:00", before: "24:00" });
    expect(new Set(readout.gaps.map((gap) => gap.day)).size).toBeGreaterThan(1);
  });

  it("returns 1-based day numbers and HH:mm boundaries, not the domain's minutes", () => {
    const readout = findFreeTime(japan, wholeTrip, {}) as FreeTimeReadout;
    for (const gap of readout.gaps) {
      expect(gap.day).toBeGreaterThanOrEqual(1);
      expect(gap.day).toBeLessThanOrEqual(JAPAN_TRIP_DAY_COUNT);
      expect(gap.start).toMatch(/^\d{2}:\d{2}$/);
      expect(gap.end).toMatch(/^\d{2}:\d{2}$/);
      expect(gap.durationMinutes).toBeGreaterThan(0);
    }
  });

  // The translation this tool exists to own: the user says "after 9pm", the
  // domain speaks minutes from midnight. Getting this wrong is silent — the
  // answer is still well-formed, just about the wrong part of the day.
  it('translates "21:00" to 1260 minutes before asking the domain', () => {
    const readout = findFreeTime(japan, wholeTrip, { after: "21:00" }) as FreeTimeReadout;
    expect(readout.window.after).toBe("21:00");
    for (const gap of readout.gaps) {
      const startMinutes = Number(gap.start.slice(0, 2)) * 60 + Number(gap.start.slice(3));
      expect(startMinutes).toBeGreaterThanOrEqual(21 * 60);
    }
  });

  it("clips to a before-time and renders end-of-day as 24:00, never 00:00", () => {
    const bounded = findFreeTime(japan, wholeTrip, { after: "09:00", before: "12:00" }) as FreeTimeReadout;
    expect(bounded.window).toEqual({ after: "09:00", before: "12:00" });
    for (const gap of bounded.gaps) {
      expect(gap.end <= "12:00").toBe(true);
    }
    const openEnded = findFreeTime(japan, wholeTrip, { after: "23:00" }) as FreeTimeReadout;
    for (const gap of openEnded.gaps) expect(gap.end).toBe("24:00");
  });

  // The emitter says "24:00"; the schema must accept it back. A model that
  // reads `end: "24:00"` and passes `before: "24:00"` was getting a validation
  // failure for using the tool's own vocabulary, which costs it a step and
  // reads like the model's mistake.
  it("accepts back every boundary it emits, 24:00 included", () => {
    const emitted = new Set(
      (findFreeTime(japan, wholeTrip, {}) as FreeTimeReadout).gaps.flatMap((gap) => [gap.start, gap.end]),
    );
    expect(emitted.has("24:00")).toBe(true);
    for (const time of emitted) {
      expect(FindFreeTimeInputSchema.safeParse({ before: time }).success, `before: ${time}`).toBe(true);
      expect(FindFreeTimeInputSchema.safeParse({ after: time }).success, `after: ${time}`).toBe(true);
    }
    // And it means end-of-day, not the start of one.
    const wholeDay = findFreeTime(japan, wholeTrip, { before: "24:00" }) as FreeTimeReadout;
    expect(wholeDay.window.before).toBe("24:00");
    expect(wholeDay.gaps.length).toBeGreaterThan(0);
  });

  // A malformed time used to yield `window: { after: "NaN:NaN" }` and zero
  // gaps — a confidently well-formed wrong answer, which is the failure class
  // this milestone exists to remove.
  it("refuses a malformed time out loud instead of answering NaN", () => {
    for (const bad of ["9pm", "25:00", "09:60", "9:00", "", "0900", "24:01"]) {
      const readout = findFreeTime(japan, wholeTrip, { after: bad });
      expect(readout, `after: ${JSON.stringify(bad)}`).toHaveProperty("error");
      expect(JSON.stringify(readout)).not.toContain("NaN");
      expect(FindFreeTimeInputSchema.safeParse({ after: bad }).success, `schema: ${bad}`).toBe(false);
    }
    expect(findFreeTime(japan, wholeTrip, { before: "half past nine" })).toHaveProperty("error");
  });

  it("drops gaps shorter than minMinutes", () => {
    const readout = findFreeTime(japan, wholeTrip, { minMinutes: 120 }) as FreeTimeReadout;
    for (const gap of readout.gaps) expect(gap.durationMinutes).toBeGreaterThanOrEqual(120);
  });

  // Scope narrowing is a DEFAULT, not a lie: omitting `day` on a day-scoped
  // turn means that day, and naming another day still works.
  it("defaults to the scoped day, and still answers about a day the model names", () => {
    const scope = { kind: "day", dayIndex: 2 } as const;
    const defaulted = findFreeTime(japan, scope, {}) as FreeTimeReadout;
    expect(defaulted.searched).toBe("day 3");
    expect(new Set(defaulted.gaps.map((gap) => gap.day))).toEqual(new Set([3]));

    const named = findFreeTime(japan, scope, { day: 5 }) as FreeTimeReadout;
    expect(named.searched).toBe("day 5");
    expect(new Set(named.gaps.map((gap) => gap.day))).toEqual(new Set([5]));
  });

  it("reports an out-of-range day instead of silently widening to the trip", () => {
    const readout = findFreeTime(japan, wholeTrip, { day: JAPAN_TRIP_DAY_COUNT + 1 });
    expect(readout).toHaveProperty("error");
  });
});

describe("the tool schemas", () => {
  const { tools } = buildReadTools();

  it("offers exactly the three tools ADR-022 opens with", () => {
    expect(Object.keys(tools).sort()).toEqual([...READ_TOOL_NAMES].sort());
  });

  // ADR-022 §3, asserted STRUCTURALLY rather than by reading the prompt: trip
  // and actor identity arrive through `toolsContext`, so "read a different
  // trip" must not be expressible in any tool's input schema. Walking the
  // schemas rather than naming the three tools is what makes a fourth tool
  // inherit the check instead of dodging it.
  it("declares no tripId — nor any other id — in any tool's input schema", () => {
    for (const [name, schema] of Object.entries(READ_TOOL_INPUT_SCHEMAS)) {
      const keys = Object.keys(schema.shape);
      expect(keys, `${name} input keys`).not.toContain("tripId");
      expect(keys.filter((key) => /id$/i.test(key)), `${name} id-shaped keys`).toEqual([]);
    }
  });

  it("keeps every offered tool's schema covered by that assertion", () => {
    expect(Object.keys(READ_TOOL_INPUT_SCHEMAS).sort()).toEqual(Object.keys(tools).sort());
  });

  it("gives every tool a context schema, so identity can only come from context", () => {
    for (const [name, tool] of Object.entries(tools)) {
      expect((tool as { contextSchema?: unknown }).contextSchema, `${name} contextSchema`).toBeDefined();
    }
  });
});
