// The read tool family (ADR-022 §1) — the third family, after the planning
// tools derived from command schemas and the page tools derived from the macro
// registry. These are hand-written, which ADR-015's "no hand-written tool
// manifests" forbade for the other two and ADR-022 amends for this one: a read
// tool executes no command, so there is no command schema for it to drift from.
//
// What binds it instead is a narrower rule:
//
//   > A new tool is earned by a new computation or a new capability boundary —
//   > never by a new phrasing of a question.
//
// So there are four, and new questions land on them as typed parameters.
// "Where is there free time after 9pm?" is `find_free_time({ after })`, not a
// fifth tool. `search_playbooks` is the one earned since (ADR-042 Decision 2),
// and it is earned as a CAPABILITY BOUNDARY rather than a phrasing: it reads a
// corpus outside the trip, which the other three cannot reach by construction.
// `find_days` is the other (2026-10-10), earned as a COMPUTATION: once a long
// trip's `read_trip` stops listing every day, "which days match?" has no
// answer short of reading them, which the per-turn read cap now refuses.
//
// Two structural rules run through the whole file:
//
//   1. **No tool takes a `tripId`.** Trip and actor identity arrive through
//      `AssistantDeps` (`needs: ["trip"]`, `needs: ["actor"]`), so "read a
//      different trip" is not expressible in any tool's schema (ADR-022 §3).
//      This is layered defense in the same sense `idFields.ts` is: the
//      constraint is structural, not prompted. `readTools.test.ts` asserts it
//      over every schema, so a fourth tool cannot quietly reintroduce one.
//   1b. **No tool takes an `ownerId` either**, and `search_playbooks`'s
//      visibility set is exactly `readableSavedDay`'s — your own days plus
//      anybody's published one. Narrower and the model proposes days the apply
//      door then 404s on; wider and the tool is a way to enumerate what people
//      have kept private, which is the exact attack that WHERE clause is
//      written to defeat (ADR-042 Decision 2). It is reused, never restated:
//      the `playbooks` port resolves to `discoverDays({ scope: "everyone" })`,
//      which IS that clause.
//   2. **The computation lives in the domain.** `find_free_time` is a wrapper
//      over `findFreeGaps` (packages/domain/src/trip/freeTime.ts) and owns
//      nothing but the translation between what a user says ("after 9pm") and
//      what the domain speaks (minutes from midnight). ADR-022 §2.
//
// Numbers the model sees are 1-BASED day numbers, everywhere, in both
// directions. `TripDetail.days` and `FreeGap.dayIndex` are 0-based; the
// conversion happens here and only here. Handing a model both an `index` and a
// `day` for the same row is how off-by-one answers get written.
import { z } from "zod";
import { ActivityKind, ActivityMode, ActivityTag, LocationPrecision, Money, PendingReason, TimeWindow, stopHeadcount, travellerIds, type Location, type TripDetail } from "@tc/contracts";
import { DAYTIME_END_MINUTES, DAYTIME_START_MINUTES, citiesOfDay, citiesOfStops, findFreeGaps, minutesOf, stopsInTimeOrder, summarizeFreeDays } from "@tc/domain";
import { needsBooking } from "@/lib/needsBooking";
import { activeConflicts, conflictsOnDay, type AiConflictSummary, type AskScope } from "@/server/assistant/context";
import { defineTool } from "@/server/assistant/defineTool";
import type { DayReadBudget, PlaybookLibrary } from "@/server/assistant/deps";
import type { TaskClass } from "@/server/assistant/taskClass";
import { plain, untrusted, untrustedAll, untrustedOrNull } from "@/server/assistant/prompt";

// The times this boundary accepts and emits: 00:00-23:59, PLUS "24:00".
//
// 24:00 is load-bearing in both directions and the schema and the emitter have
// to agree on it. `hhmmOf(1440)` renders end-of-day as "24:00" rather than
// "00:00" so a model told a gap runs "18:30-24:00" does not have to guess
// which midnight — and a model that then passes that same string straight back
// as `before` must not get a validation failure for its trouble, which is a
// wasted step and an error message that reads like its fault.
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;

// The conversion itself is `@tc/domain`'s `minutesOf` — the one
// minutes-since-midnight parser in the repo (KI-73). It does not validate, so
// everything that reaches it here has been through `HHMM` first: `parseTime`
// below is the only door.
//
// The inverse, for gap boundaries on the way out.
function hhmmOf(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** The conflict shape every readout carries, as `activeConflicts` mints it. */
const ConflictSummarySchema: z.ZodType<AiConflictSummary> = z.object({
  ref: z.number(),
  kind: z.string(),
  description: z.string(),
});

export interface TripDayReadout {
  /** 1-based, matching `read_day`'s input. */
  day: number;
  date: string | null;
  /**
   * The city (or cities, on a travel day) this day's located stops touch —
   * `citiesOfDay` (`@tc/domain`), in arrival order. `[]` when nothing on the
   * day is located, or nothing carries a city.
   *
   * The reason this tool is earned in the first place (2026-08-29 live run):
   * without it, "which day is near Nara?" has no answer this readout can give,
   * so the model's only move was a `read_day` roll call of the WHOLE trip, one
   * day at a time. A handful of short strings per day replaces that.
   */
  cities: string[];
  stopCount: number;
  /**
   * How many of those stops still need booking, by `@/lib/needsBooking`'s rule
   * (narrower than "kind neither `booked` nor `transit`" — see KI-86).
   *
   * Here, and not left for the model to work out from `read_day`, because a
   * TRIP-scoped question about booking has no day to read: the rail offers
   * "3 stops still need booking — which should I sort out first?" from the
   * whole trip, and without this the only honest answer was "I can't see".
   */
  toBook: number;
  /** Integer minor units, same convention as `TripDetail.days[].costSubtotal`. */
  costSubtotal: number;
}

export interface TripReadout {
  name: string;
  currency: string;
  startDate: string | null;
  dayCount: number;
  /**
   * How many people are on the trip, and how many of them are travelling
   * (travellers spec D1). Counts, not people: the readout names nobody. The
   * totals price a stop nobody picked for `travellers`, so a model dividing a
   * total by `members` would hand an adviser a share of the hotel.
   */
  members: number;
  travellers: number;
  tripCostTotal: number;
  days: TripDayReadout[];
  /** Active (non-dismissed) conflicts, by the same 1-based `ref` the command envelope uses. */
  conflicts: AiConflictSummary[];
}

export const TripReadoutSchema: z.ZodType<TripReadout> = z.object({
  name: z.string(),
  currency: z.string(),
  startDate: z.string().nullable(),
  dayCount: z.number(),
  members: z.number(),
  travellers: z.number(),
  tripCostTotal: z.number(),
  days: z.array(
    z.object({
      day: z.number(),
      date: z.string().nullable(),
      cities: z.array(z.string()),
      stopCount: z.number(),
      toBook: z.number(),
      costSubtotal: z.number(),
    }),
  ),
  conflicts: z.array(ConflictSummarySchema),
});

/**
 * The trip noun. No computation — ADR-022 records this tool as earned by the
 * NOUN, not by arithmetic, and the model's own reading of a day list is fine.
 *
 * Per-day stop counts and cost subtotals rather than stop titles: the point of
 * a separate `read_day` is that a 14-day trip's every stop does not have to be
 * re-sent to answer "how long is this trip?".
 *
 * This is the per-day readout at every length; what the TOOL returns past
 * `OVERVIEW_ABOVE_DAYS` is `readTripForModel`'s choice, not this function's.
 */
export function readTrip(detail: TripDetail): TripReadout {
  return {
    name: detail.name,
    currency: detail.currency,
    startDate: detail.startDate,
    dayCount: detail.days.length,
    members: detail.members.length,
    travellers: travellerIds(detail.members).length,
    tripCostTotal: detail.tripCostTotal,
    days: detail.days.map((day, index) => ({
      day: index + 1,
      date: day.date,
      cities: citiesOfDay(detail, index),
      stopCount: day.activityIds.length,
      toBook: day.activityIds.filter((id) => {
        const activity = detail.activities[id];
        return activity !== undefined && needsBooking(activity);
      }).length,
      costSubtotal: day.costSubtotal,
    })),
    // The raw content-derived `id` embeds UUIDs and is stripped for the same
    // reason the command envelope strips it — see context.ts.
    conflicts: activeConflicts(detail).map(({ id: _id, ...rest }) => rest),
  };
}

// ---------------------------------------------------------------------------
// The overview: `read_trip` on a trip too long for a row per day
// ---------------------------------------------------------------------------
//
// `read_trip`'s per-day rows are the part of its answer that grows with the
// trip: ~450 tokens at 16 days, ~2.6k at 100, ~9.5k at 366 (`tripDetailFactory`,
// 6 stops a day, measured 2026-10-10). And it is the FIRST call of nearly every
// turn, so whatever it returns is re-sent on every step after it. Past
// `OVERVIEW_ABOVE_DAYS` the tool answers with this instead: the same trip-level
// fields, and a body whose size follows how many places and categories the trip
// has rather than how many days.
//
// A model that needs a particular day then LOCATES it with `find_days` and reads
// only that one. The overview is deliberately not a way to answer a stop-level
// question — it carries no titles at all — so the honest path for "what do we
// do in Osaka?" is overview → `find_days({ city })` → `read_day`.

/**
 * Above this many days, `read_trip` returns the overview rather than a row per
 * day. At or below it the readout is byte-identical to what it always was.
 *
 * Twenty because the per-day rows cost about as much as the overview's fixed
 * fields at that length (~550 tokens), and because the trips this product is
 * mostly used for — the canonical Japan fixture is 14 days (ADR-030) — sit
 * under it, so the common case is untouched.
 */
export const OVERVIEW_ABOVE_DAYS = 20;

// The two lists the overview could still grow without bound on a pathological
// trip — a city change every day, or every other day empty. Capped and SAID to
// be capped (`segmentsOmitted`, the trailing "…"), never silently cut, so a
// model reading a cut list knows to ask `find_days` rather than concluding
// there is nothing more.
const MAX_OVERVIEW_SEGMENTS = 40;
const MAX_OVERVIEW_RANGES = 30;

/**
 * One run of consecutive days that end in the same city.
 *
 * **The travel-day rule: a day belongs to the city it ENDS in** — the city of
 * its last located stop in time order, a transit stop counting by its
 * destination (`endingCityOf`). So a Kyoto → Osaka day opens the Osaka
 * segment, and a day trip to Nara that comes back to Kyoto for dinner stays
 * inside the Kyoto one. A day therefore sits in exactly ONE segment, which is
 * what lets `stops`, `toBook` and `costSubtotal` add up to the trip's own
 * totals (less the backlog) instead of counting a travel day twice. The other
 * cities a segment's days touch — the city a travel day left, the Nara of a day
 * trip — are in `alsoTouches`, so no city the trip visits drops out of sight.
 *
 * A repeat visit is a second segment: Tokyo 1–5, Kyoto 6–9, Tokyo 10–12 is
 * three. A day with no city-bearing stop (an empty day, or one whose stops
 * carry no city) has `city: null` and splits a run, because "we don't know
 * where this day is" is not evidence that it is in the city either side.
 */
export interface TripSegmentReadout {
  /** 1-based and inclusive: "1–12", or "7" for one day. */
  days: string;
  city: string | null;
  alsoTouches: string[];
  stops: number;
  /** By `@/lib/needsBooking`'s rule, the same count `read_trip`'s per-day rows carry. */
  toBook: number;
  /** Integer minor units: the segment's days' `costSubtotal`s, summed. */
  costSubtotal: number;
}

export interface TripOverviewReadout {
  /**
   * Our own sentence, never the user's: what this readout is and what to call
   * next. Here rather than only in the tool description because the model
   * reading the result is the one that has to act on it.
   */
  overview: string;
  name: string;
  currency: string;
  startDate: string | null;
  /** The last day's date — with `startDate`, the trip's date range. */
  endDate: string | null;
  dayCount: number;
  members: number;
  travellers: number;
  tripCostTotal: number;
  /** Stops on days, the backlog excluded. */
  stopCount: number;
  toBook: number;
  segments: TripSegmentReadout[];
  /** How many segments past `MAX_OVERVIEW_SEGMENTS` were left out; `find_days` reaches them. */
  segmentsOmitted: number;
  /** The days with no stops, as ranges: "40–60, 75". Empty string when there are none. */
  emptyDays: string;
  /** How many stops on days carry each tag (`ActivityTag`), and are of each kind. */
  stopTags: Record<string, number>;
  stopKinds: Record<string, number>;
  /** Stops in the backlog, on no day. */
  backlog: number;
  /** Active conflicts by kind. Those on a day are on that day's `read_day`. */
  conflicts: Record<string, number>;
  /**
   * The active conflicts that touch no day, in full — over-budget, whose
   * subject is the trip, and any whose stops sit in the backlog. No `read_day`
   * carries them (`conflictsOnDay`), so without this a long trip's "am I over
   * budget?" had a count and nothing to say.
   */
  tripWideConflicts: AiConflictSummary[];
}

export const TripOverviewReadoutSchema: z.ZodType<TripOverviewReadout> = z.object({
  overview: z.string(),
  name: z.string(),
  currency: z.string(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  dayCount: z.number(),
  members: z.number(),
  travellers: z.number(),
  tripCostTotal: z.number(),
  stopCount: z.number(),
  toBook: z.number(),
  segments: z.array(
    z.object({
      days: z.string(),
      city: z.string().nullable(),
      alsoTouches: z.array(z.string()),
      stops: z.number(),
      toBook: z.number(),
      costSubtotal: z.number(),
    }),
  ),
  segmentsOmitted: z.number(),
  emptyDays: z.string(),
  stopTags: z.record(z.string(), z.number()),
  stopKinds: z.record(z.string(), z.number()),
  backlog: z.number(),
  conflicts: z.record(z.string(), z.number()),
  tripWideConflicts: z.array(ConflictSummarySchema),
});

/**
 * The city day `index` ends in: the last city-bearing stop's city, in the time
 * order `citiesOfDay` reads (`stopsInTimeOrder`), with a transit stop counted
 * by its destination. `citiesOfStops` on that one stop IS the city rule, so
 * there is no second reading of `location.city` here to drift from it.
 *
 * Not `citiesOfDay(...).at(-1)`: that list collapses a duplicate to its FIRST
 * occurrence, so a Kyoto → Nara → Kyoto day reports `["Kyoto", "Nara"]` and
 * its last entry is the one city the day did not end in.
 */
export function endingCityOf(detail: TripDetail, index: number): string | null {
  const day = detail.days[index];
  if (!day) return null;
  const stops = day.activityIds.flatMap((id) => {
    const activity = detail.activities[id];
    return activity ? [activity] : [];
  });
  const ordered = stopsInTimeOrder(stops);
  for (let i = ordered.length - 1; i >= 0; i--) {
    const city = citiesOfStops([ordered[i]!]).at(-1);
    if (city !== undefined) return city;
  }
  return null;
}

/** "1–12" for a run, "7" for one day. */
function dayRange(from: number, to: number): string {
  return from === to ? `${from}` : `${from}–${to}`;
}

/** Ascending day numbers as ranges, "3–5, 9", capped at `MAX_OVERVIEW_RANGES` with a trailing "…". */
function rangesOf(days: readonly number[]): string {
  const ranges: string[] = [];
  for (let i = 0; i < days.length; ) {
    let j = i;
    while (j + 1 < days.length && days[j + 1] === days[j]! + 1) j++;
    ranges.push(dayRange(days[i]!, days[j]!));
    i = j + 1;
  }
  return ranges.length > MAX_OVERVIEW_RANGES ? `${ranges.slice(0, MAX_OVERVIEW_RANGES).join(", ")}, …` : ranges.join(", ");
}

function countInto(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

/**
 * The overview `read_trip` returns past `OVERVIEW_ABOVE_DAYS`. Deterministic
 * and pure, like `readTrip`: every count is read off the projection, and the
 * per-day numbers it sums are the ones `readTrip` would have printed.
 */
export function readTripOverview(detail: TripDetail): TripOverviewReadout {
  const rows = readTrip(detail).days;
  const segments: TripSegmentReadout[] = [];
  let open: { from: number; to: number; city: string | null; touched: string[] } | null = null;
  const totals = { stops: 0, toBook: 0, costSubtotal: 0 };
  const close = () => {
    if (open === null) return;
    const { from, to, city, touched } = open;
    segments.push({
      days: dayRange(from, to),
      city,
      alsoTouches: touched.filter((other) => other !== city),
      stops: totals.stops,
      toBook: totals.toBook,
      costSubtotal: totals.costSubtotal,
    });
    Object.assign(totals, { stops: 0, toBook: 0, costSubtotal: 0 });
  };
  rows.forEach((row, index) => {
    const city = endingCityOf(detail, index);
    if (open === null || open.city !== city) {
      close();
      open = { from: row.day, to: row.day, city, touched: [] };
    }
    open.to = row.day;
    for (const touched of row.cities) if (!open.touched.includes(touched)) open.touched.push(touched);
    totals.stops += row.stopCount;
    totals.toBook += row.toBook;
    totals.costSubtotal += row.costSubtotal;
  });
  close();

  const stopTags: Record<string, number> = {};
  const stopKinds: Record<string, number> = {};
  for (const day of detail.days) {
    for (const id of day.activityIds) {
      const activity = detail.activities[id];
      if (!activity) continue;
      for (const tag of activity.tags) countInto(stopTags, tag);
      countInto(stopKinds, activity.kind);
    }
  }
  const conflicts: Record<string, number> = {};
  const onSomeDay = new Set(detail.days.flatMap((day) => day.activityIds));
  const subjectsById = new Map(detail.conflicts.map((c) => [c.id, c.subjects]));
  const tripWideConflicts: AiConflictSummary[] = [];
  for (const { id, ...conflict } of activeConflicts(detail)) {
    countInto(conflicts, conflict.kind);
    if (!(subjectsById.get(id) ?? []).some((subject) => onSomeDay.has(subject))) tripWideConflicts.push(conflict);
  }

  return {
    // Worded for both kinds of turn: a viewer's is not handed `find_days`, and
    // the segments' day ranges are its way to a day number.
    overview: `This trip has ${rows.length} days, so this is an overview rather than a row per day. To answer about particular days, get their day numbers first (each segment lists its days; find_days filters further), then read_day for those days only.`,
    name: detail.name,
    currency: detail.currency,
    startDate: detail.startDate,
    endDate: detail.days.at(-1)?.date ?? null,
    dayCount: rows.length,
    members: detail.members.length,
    travellers: travellerIds(detail.members).length,
    tripCostTotal: detail.tripCostTotal,
    stopCount: rows.reduce((sum, row) => sum + row.stopCount, 0),
    toBook: rows.reduce((sum, row) => sum + row.toBook, 0),
    segments: segments.slice(0, MAX_OVERVIEW_SEGMENTS),
    segmentsOmitted: Math.max(0, segments.length - MAX_OVERVIEW_SEGMENTS),
    emptyDays: rangesOf(rows.filter((row) => row.stopCount === 0).map((row) => row.day)),
    stopTags,
    stopKinds,
    backlog: detail.backlog.length,
    conflicts,
    tripWideConflicts,
  };
}

/**
 * What the `read_trip` TOOL returns: the per-day readout up to
 * `OVERVIEW_ABOVE_DAYS`, the overview past it. Kept apart from `readTrip` so
 * the pure readout, and everything that reads it as one (the simulated model,
 * the overview's own sums), keeps a single shape.
 */
export function readTripForModel(detail: TripDetail): TripReadout | TripOverviewReadout {
  return detail.days.length > OVERVIEW_ABOVE_DAYS ? readTripOverview(detail) : readTrip(detail);
}

// `LocationPrecision` is imported from the contract rather than respelled here.
// A respelling is the hand-written duplicate ADR-015 invariant 5 forbids, and it
// would fail in the quietest possible way: a tier added to the contract would be
// STRIPPED by this tool's output parse (`defineTool` parses every result), so the
// model would simply never hear about it. A test pins exactly that.


export interface StopReadout {
  title: string;
  /** `null` when the stop is not scheduled to a time — which is what makes free-time answers real. */
  timeWindow: { start: string; end: string } | null;
  /**
   * `precision` is what the coordinates DESCRIBE, and the model needs it to
   * describe them honestly. Runtime enrichment pins a stop at its city's
   * centroid when the vendor cannot corroborate the venue — the common case,
   * not the rare one (KI-2026-08-30-f) — and without this field the assistant
   * would tell a user it had placed the stop, which is a claim about a pin it
   * did not make. `null` is UNKNOWN and never "venue": every location written
   * before the field existed carries none (contracts/src/activity.ts).
   *
   * The coordinates themselves are still absent by design. Knowing a stop is
   * city-level is a fact the model can SAY; a lat/lng is a fact it would be
   * tempted to invent a near-miss of.
   */
  location: PlaceReadout | null;
  notes: string | null;
  kind: ActivityKind;
  tags: string[];
  cost: { amountMinor: number; currency: string } | null;
  /**
   * How many people `cost` is multiplied by in every total: `stopHeadcount`,
   * the one place that rule lives. Without it the model rebuilt the multiplier
   * as `cost × travellers`, which is wrong for any stop with picks — including
   * a picked non-traveller, who counts (travellers spec D6). `null` only on a
   * result produced before the field existed.
   */
  headcount: number | null;
  /**
   * A transit stop's leg (M24): by what, and where it arrives — `location` is
   * where it leaves. Narrowed like `location`. The model needs both to say what
   * a travel stop IS. Moving one off `transit` clears them: the write edge
   * adds the `null`s (`clearDetailFieldsForKind`), and the tool description
   * says so.
   */
  mode: ActivityMode | null;
  endLocation: PlaceReadout | null;
  /**
   * Why a pending stop is pending (ADR-055): `book` still has to be booked,
   * `maybe` may not happen at all. The model needs it to answer "what still
   * needs booking?" without calling a maybe a to-do. Moving a stop off
   * `pending` clears it, the same way.
   */
  pendingReason: PendingReason | null;
}

type PlaceReadout = {
  name: string;
  city: string | null;
  countryCode: string | null;
  precision: LocationPrecision | null;
};

function placeReadout(location: Location | null): PlaceReadout | null {
  return location
    ? {
        name: location.name,
        city: location.city ?? null,
        countryCode: location.countryCode ?? null,
        precision: location.precision ?? null,
      }
    : null;
}

const PlaceReadoutSchema = z.object({
  name: z.string(),
  city: z.string().nullable(),
  countryCode: z.string().nullable(),
  precision: LocationPrecision.nullable(),
});

export interface DayReadout {
  day: number;
  date: string | null;
  costSubtotal: number;
  stops: StopReadout[];
  /**
   * The active conflicts that touch this day, by the same trip-wide `ref`
   * `read_trip` reports (`conflictsOnDay`).
   *
   * On the day rather than left to a cross-reference against `read_trip`:
   * `TripReadout.conflicts` carries no day, so "how should I fix the conflict
   * on day 3?" was answerable only by matching stop titles out of a
   * description — which is guesswork for a real model and was nothing at all
   * for the simulated one.
   */
  conflicts: AiConflictSummary[];
}

/** What a tool hands back when the model asked something the trip cannot answer. */
export interface ReadToolProblem {
  error: string;
}

export const ReadToolProblemSchema: z.ZodType<ReadToolProblem> = z.object({ error: z.string() });

// The stop's own fields are the CONTRACT's, reused rather than restated:
// `timeWindow` and `cost` are passed straight through from a parsed
// `TripDetail`, so a second spelling of either here would be the hand-written
// duplicate ADR-015 invariant 5 forbids. `location` is a genuine narrowing —
// four of `Location`'s fields, with the coordinates the model must never see
// left behind — so it is written out, and `precision` is still the contract's
// own enum rather than a respelling of it.
export const DayReadoutSchema: z.ZodType<DayReadout, z.ZodTypeDef, unknown> = z.object({
  day: z.number(),
  date: z.string().nullable(),
  costSubtotal: z.number(),
  stops: z.array(
    z.object({
      title: z.string(),
      timeWindow: TimeWindow.nullable(),
      location: PlaceReadoutSchema.nullable(),
      notes: z.string().nullable(),
      kind: ActivityKind,
      tags: z.array(z.string()),
      cost: Money.nullable(),
      // Defaulted, not required: a `read_day` result produced before M24 has
      // neither key, and the simulated model re-parses results it is handed.
      mode: ActivityMode.nullable().default(null),
      endLocation: PlaceReadoutSchema.nullable().default(null),
      // Defaulted for the same reason, for a result produced before ADR-055.
      pendingReason: PendingReason.nullable().default(null),
      // And for one produced before the travellers spec.
      headcount: z.number().nullable().default(null),
    }),
  ),
  conflicts: z.array(ConflictSummarySchema),
});

/**
 * The day noun, WITH the time windows the command envelope never carried.
 *
 * That omission is the whole reason this tool is earned: `summarizeTrip` gives
 * the model `{ id, title }` per activity, so every free-time question was
 * unanswerable twice over — no channel to answer through, and no times in the
 * data to answer from (ADR-022's Context). A `read_day` without `timeWindow`
 * would reproduce the bug it exists to fix.
 *
 * Activity UUIDs are deliberately absent. A read-only turn references stops by
 * title, exactly as the planning tools' `activityRef` does, and a UUID the
 * model has seen is a UUID it can later invent a near-miss of (KI-15's shape).
 */
export function readDay(detail: TripDetail, day: number): DayReadout | ReadToolProblem {
  const travellers = travellerIds(detail.members).length;
  const index = day - 1;
  const record = detail.days[index];
  if (!record) {
    return {
      error: `This trip has ${detail.days.length} day${detail.days.length === 1 ? "" : "s"}, so there is no day ${day}.`,
    };
  }
  return {
    day,
    date: record.date,
    costSubtotal: record.costSubtotal,
    conflicts: conflictsOnDay(detail, index),
    // An id listed on the day but missing from `detail.activities` is dropped
    // rather than rendered as a placeholder stop — the same rule
    // `busyIntervalsFor` applies in the domain, so the two never disagree
    // about how many stops a day has.
    stops: record.activityIds.flatMap((id) => {
      const activity = detail.activities[id];
      if (!activity) return [];
      return [
        {
          title: activity.title,
          timeWindow: activity.timeWindow,
          location: placeReadout(activity.location),
          notes: activity.notes,
          kind: activity.kind,
          tags: [...activity.tags],
          cost: activity.cost,
          headcount: stopHeadcount(activity, travellers),
          mode: activity.mode,
          endLocation: placeReadout(activity.endLocation),
          pendingReason: activity.pendingReason,
        },
      ];
    }),
  };
}

// How many days `read_day` will read in one call. The Nara case this exists
// for — "which days are near Nara?" — is a handful of candidates, not the
// trip: a cap that let the model ask for the whole thing back through this
// door would recreate the exact roll-call this batching was built to remove,
// just moved into one call instead of fourteen. Chosen well below the Japan
// fixture's 14 days (ADR-030) so a genuinely trip-wide question stays routed
// to `read_trip`, while a real multi-day comparison ("days 8 through 10", "the
// day before and after this one") fits in one call. `ReadDayInput` enforces
// this at the SCHEMA — asking for more fails validation before `run` ever
// runs, rather than silently reading the first `MAX_READ_DAYS` and dropping
// the rest.
export const MAX_READ_DAYS = 5;

export interface DayBatchReadout {
  /** One entry per requested day, in the same (deduplicated) order asked. */
  days: (DayReadout | ReadToolProblem)[];
}

export const DayBatchReadoutSchema: z.ZodType<DayBatchReadout, z.ZodTypeDef, unknown> = z.object({
  days: z.array(z.union([DayReadoutSchema, ReadToolProblemSchema])),
});

/**
 * `read_day`, batched. One entry per requested day, IN THE ORDER ASKED, after
 * collapsing a day asked for more than once to its first occurrence — the same
 * "duplicates collapse" rule `citiesOfDay` uses, for the same reason: a model
 * that names day 9 twice should not pay for day 9's stops twice.
 *
 * Each entry is independently a `DayReadout` or a `ReadToolProblem`: one day
 * out of range does not fail the whole batch, because the other requested days
 * are still answerable.
 *
 * `budget` is the turn's `MAX_DAYS_READ_PER_TURN` ledger. Omitted, nothing is
 * capped — the pure readout, as the unit tests read it. Given, a day past the
 * cap comes back as its own `ReadToolProblem` entry, exactly as an
 * out-of-range day does, and the days that still fit are read: the same
 * "one bad entry does not fail the batch" rule. An out-of-range day returns no
 * stops, so it is checked first and costs the budget nothing.
 */
export function readDays(detail: TripDetail, days: readonly number[], budget?: DayReadBudget): DayBatchReadout {
  const seen = new Set<number>();
  const unique: number[] = [];
  for (const day of days) {
    if (seen.has(day)) continue;
    seen.add(day);
    unique.push(day);
  }
  return {
    days: unique.map((day) => {
      const readout = readDay(detail, day);
      if ("error" in readout || budget === undefined || budget.admit(day)) return readout;
      return {
        error: `Day ${day} was not read: this turn has already read ${budget.cap} days in full, the most one turn may. Answer from read_trip (and find_days, if this turn has it), or ask the user to narrow the question to fewer days.`,
      };
    }),
  };
}

export interface FreeTimeGapReadout {
  day: number;
  date: string | null;
  start: string;
  end: string;
  durationMinutes: number;
}

/**
 * One searched day's free time, as `summarizeFreeDays` ranks it (M32). The
 * answer to "which day is most free?" is `days[0]`, in one call: Mitchell's
 * live turn of 2026-10-04 called this tool once per day to add the gaps up
 * itself, ten calls for nine days, and still named the wrong day.
 */
export interface FreeDayReadout {
  day: number;
  date: string | null;
  freeMinutes: number;
  /** Free minutes 08:00-12:00, 12:00-17:00 and 17:00-22:00, clipped to the window searched. */
  morningMinutes: number;
  afternoonMinutes: number;
  eveningMinutes: number;
  longestGap: { start: string; end: string; durationMinutes: number } | null;
  /** Stops with no time on this day. They occupy none, so a day can look free only because of them. */
  untimedStops: number;
}

export interface FreeTimeReadout {
  /** Which days were searched — "day N" or "the whole trip" — so the answer can say so. */
  searched: string;
  window: { after: string; before: string };
  /** Every searched day, most free first. */
  days: FreeDayReadout[];
  gaps: FreeTimeGapReadout[];
}

export const FreeTimeReadoutSchema: z.ZodType<FreeTimeReadout> = z.object({
  searched: z.string(),
  window: z.object({ after: z.string(), before: z.string() }),
  days: z.array(
    z.object({
      day: z.number(),
      date: z.string().nullable(),
      freeMinutes: z.number(),
      morningMinutes: z.number(),
      afternoonMinutes: z.number(),
      eveningMinutes: z.number(),
      longestGap: z.object({ start: z.string(), end: z.string(), durationMinutes: z.number() }).nullable(),
      untimedStops: z.number(),
    }),
  ),
  gaps: z.array(
    z.object({
      day: z.number(),
      date: z.string().nullable(),
      start: z.string(),
      end: z.string(),
      durationMinutes: z.number(),
    }),
  ),
});

export interface FindFreeTimeInput {
  day?: number;
  wholeTrip?: boolean;
  after?: string;
  before?: string;
  minMinutes?: number;
}

function parseTime(value: string | undefined, fallback: number | null): number | null {
  if (value === undefined) return fallback;
  return HHMM.test(value) ? minutesOf(value) : null;
}

/**
 * A thin wrapper over the domain's `findFreeGaps` and `summarizeFreeDays`.
 * Everything here is translation: 1-based day → 0-based index, "21:00" → 1260,
 * and back again.
 * Not one minute of arithmetic — that is the computation ADR-022 §2 puts in
 * `packages/domain` so it is unit-tested with no server, DB or model in the
 * way, and so it survives whether or not a model ever calls it.
 *
 * `day` omitted falls back to the turn's scope, not to "every day": a
 * day-scoped question that forgot to repeat the day number is still about that
 * day. See `scopeNarrowing` in handleAskRequest.ts. `wholeTrip` is the way
 * out of that fallback: "which day is most free?" asked from a day's chat is
 * a question about every day, and without it `days[0]` could only be the
 * scoped day.
 */
export function findFreeTime(
  detail: TripDetail,
  scope: AskScope,
  input: FindFreeTimeInput,
): FreeTimeReadout | ReadToolProblem {
  const dayIndex =
    input.day !== undefined
      ? input.day - 1
      : input.wholeTrip !== true && scope.kind === "day"
        ? scope.dayIndex
        : undefined;
  if (dayIndex !== undefined && !detail.days[dayIndex]) {
    return {
      error: `This trip has ${detail.days.length} day${detail.days.length === 1 ? "" : "s"}, so there is no day ${dayIndex + 1}.`,
    };
  }
  // Checked, not assumed. The tool schema enforces `HHMM` for a MODEL's call,
  // but this function is exported and unit-tested directly, and `minutesOf`
  // answers nonsense with NaN — which propagated silently into
  // `window: { after: "NaN:NaN" }` and an empty gap list. A confidently
  // well-formed wrong answer is the exact failure class this milestone exists
  // to remove, so a bad time is refused out loud instead.
  //
  // The window defaults to the waking day, 08:00-22:00 (M32), not the clock:
  // from midnight, sleep is free time and an empty day scores 24 hours. A
  // bound the model names past one edge opens that edge to the clock, so
  // "anything after 11pm?" runs to 24:00 rather than to an empty 23:00-22:00.
  const explicitAfter = parseTime(input.after, null);
  if (explicitAfter === null && input.after !== undefined) {
    return { error: `"${input.after}" is not a 24-hour time like "09:00" or "21:30".` };
  }
  const explicitBefore = parseTime(input.before, null);
  if (explicitBefore === null && input.before !== undefined) {
    return { error: `"${input.before}" is not a 24-hour time like "09:00" or "21:30".` };
  }
  const afterMinutes =
    explicitAfter ?? (explicitBefore !== null && explicitBefore <= DAYTIME_START_MINUTES ? 0 : DAYTIME_START_MINUTES);
  const beforeMinutes =
    explicitBefore ?? (explicitAfter !== null && explicitAfter >= DAYTIME_END_MINUTES ? 1440 : DAYTIME_END_MINUTES);
  const options = { dayIndex, afterMinutes, beforeMinutes, minMinutes: input.minMinutes };
  const gaps = findFreeGaps(detail, options);
  return {
    searched: dayIndex === undefined ? "the whole trip" : `day ${dayIndex + 1}`,
    window: { after: hhmmOf(afterMinutes), before: hhmmOf(beforeMinutes) },
    days: summarizeFreeDays(detail, options).map((row) => ({
      day: row.dayIndex + 1,
      date: detail.days[row.dayIndex]?.date ?? null,
      freeMinutes: row.freeMinutes,
      morningMinutes: row.parts.morning,
      afternoonMinutes: row.parts.afternoon,
      eveningMinutes: row.parts.evening,
      longestGap:
        row.longestGap === null
          ? null
          : {
              start: hhmmOf(row.longestGap.startMinutes),
              end: hhmmOf(row.longestGap.endMinutes),
              durationMinutes: row.longestGap.durationMinutes,
            },
      untimedStops: row.untimedStops,
    })),
    gaps: gaps.map((gap) => ({
      day: gap.dayIndex + 1,
      date: detail.days[gap.dayIndex]?.date ?? null,
      start: hhmmOf(gap.startMinutes),
      end: hhmmOf(gap.endMinutes),
      durationMinutes: gap.durationMinutes,
    })),
  };
}

// How many day numbers `find_days` hands back. Numbers are a few characters
// each, so this is not about their cost: it is that a list longer than the
// per-turn read cap (`MAX_DAYS_READ_PER_TURN`, 15) cannot all be read anyway,
// and `count` still says how many matched. A model with 200 matches has a
// question to narrow, not a list to walk.
export const MAX_FOUND_DAYS = 50;

export interface FindDaysInput {
  city?: string;
  tag?: ActivityTag;
  fromDay?: number;
  toDay?: number;
  fromDate?: string;
  toDate?: string;
  empty?: boolean;
  toBook?: boolean;
  hasConflicts?: boolean;
}

export interface FoundDaysReadout {
  /** Every matching day, however many `days` shows. */
  count: number;
  /** 1-based, ascending, the first `MAX_FOUND_DAYS` of them. */
  days: number[];
}

export const FoundDaysReadoutSchema: z.ZodType<FoundDaysReadout> = z.object({
  count: z.number(),
  days: z.array(z.number()),
});

/**
 * `find_days`: which days match, as day NUMBERS and nothing else.
 *
 * Earned as a new computation (ADR-022's rule), not a phrasing: on a trip past
 * `OVERVIEW_ABOVE_DAYS` the per-day rows `read_trip` used to carry are gone,
 * and without a locator the model's only move for "which days are in Osaka?"
 * is reading days until it finds them — the roll call `read_trip`'s `cities`
 * field was added to end (2026-08-29), and one the per-turn read cap now
 * refuses past fifteen days.
 *
 * Every filter is optional and they AND together. Each reads the projection
 * through the rule that already owns it — `citiesOfDay` for a city (a travel
 * day matches BOTH its cities, unlike the overview's one-segment-per-day rule:
 * "which days touch Osaka?" includes the day you arrive), `needsBooking` for
 * `toBook`, `conflictsOnDay` for `hasConflicts` — so a day `find_days` names is
 * a day `read_day` agrees about.
 *
 * Returns no stop contents and echoes no input: a number is the whole of what
 * it says, which is why it declares no `taint`.
 */
export function findDays(detail: TripDetail, input: FindDaysInput): FoundDaysReadout {
  // Unfenced on the way in, for `search_playbooks`' reason: the model is told
  // to spell a city as `read_trip` spells it, and `read_trip` fences it.
  const city = input.city === undefined ? undefined : plain(input.city).trim().toLowerCase();
  const matches: number[] = [];
  detail.days.forEach((day, index) => {
    const number = index + 1;
    if (input.fromDay !== undefined && number < input.fromDay) return;
    if (input.toDay !== undefined && number > input.toDay) return;
    // A day with no date matches no date bound: "in May" cannot be said of it.
    if (input.fromDate !== undefined && (day.date === null || day.date < input.fromDate)) return;
    if (input.toDate !== undefined && (day.date === null || day.date > input.toDate)) return;
    if (input.empty !== undefined && (day.activityIds.length === 0) !== input.empty) return;
    if (city !== undefined && !citiesOfDay(detail, index).some((touched) => touched.toLowerCase() === city)) return;
    const stops = day.activityIds.flatMap((id) => {
      const activity = detail.activities[id];
      return activity ? [activity] : [];
    });
    if (input.tag !== undefined && !stops.some((stop) => stop.tags.includes(input.tag!))) return;
    if (input.toBook !== undefined && stops.some((stop) => needsBooking(stop)) !== input.toBook) return;
    if (input.hasConflicts !== undefined && (conflictsOnDay(detail, index).length > 0) !== input.hasConflicts) return;
    matches.push(number);
  });
  return { count: matches.length, days: matches.slice(0, MAX_FOUND_DAYS) };
}

// How many library days `search_playbooks` will name in one call, and how many
// cities it will match on. `MAX_READ_DAYS`' reasoning, applied to the other
// corpus: a cap the model could raise to "the whole library" would put 148
// days' worth of names and cities into a step's context to pick one of them.
// Eight is a shortlist a model can choose from and a person can be told about.
// Both are enforced at the SCHEMA — asking for more fails validation before
// `run` runs, rather than silently truncating.
export const MAX_PLAYBOOK_RESULTS = 8;
export const MAX_SEARCH_CITIES = 5;

export interface PlaybookDayReadout {
  /**
   * The one id the assistant is ever given, and the only reason it can be: the
   * whole of ADR-042 is that the model names a ROW and the server reads it.
   * `read_day` withholds activity UUIDs precisely because a UUID the model has
   * seen is one it can invent a near-miss of (KI-15's shape) — that hazard is
   * unchanged here, and it is answered instead of avoided: every id comes back
   * through `readableSavedDay` at propose time and again at apply time, so a
   * near-miss fails closed at both doors rather than becoming a stop.
   */
  savedDayId: string;
  name: string;
  /** Every city the day touches, in its own time order (`citiesOfStops`). */
  cities: string[];
  stopCount: number;
  /** The day's sum across its priced stops — for ONE person, since every price is (ADR-060) — or null when nothing is priced. */
  totalCost: { amountMinor: number; currency: string } | null;
  /** How many trips have taken this day — the adds ledger's count (M11b). */
  adds: number;
  /** Whether the caller wrote it, so the answer can say "your own". */
  mine: boolean;
}

export interface PlaybookSearchReadout {
  /** What was searched for, so the answer can say so. */
  searched: string;
  days: PlaybookDayReadout[];
}

export const PlaybookSearchReadoutSchema: z.ZodType<PlaybookSearchReadout> = z.object({
  searched: z.string(),
  days: z.array(
    z.object({
      savedDayId: z.string(),
      name: z.string(),
      cities: z.array(z.string()),
      stopCount: z.number(),
      totalCost: Money.nullable(),
      adds: z.number(),
      mine: z.boolean(),
    }),
  ),
});

export interface SearchPlaybooksInput {
  cities?: string[];
  limit?: number;
}

/**
 * The playbook library, filtered to what this reader may see.
 *
 * **The visibility clause is the adapter's, and there is still only one of
 * it.** `playbooks.discover` is `discoverDays({ scope: "everyone" })`
 * (`server/ai/assistantPorts.ts`), and `scopePredicate` spells `everyone` as
 * *"published, or mine"* — exactly `readableSavedDay`'s WHERE clause, the one
 * the apply door will re-run per day. A query written here instead would agree
 * with it only until somebody edited one of them, and the two directions that
 * disagreement can go are both bad: narrower proposes days that 404 on
 * approval, wider enumerates other people's private days. The port is narrow
 * precisely so that clause cannot be restated on this side of it.
 */
export async function searchPlaybooks(
  library: PlaybookLibrary,
  readerId: string,
  input: SearchPlaybooksInput,
): Promise<PlaybookSearchReadout> {
  // **Unfenced on the way IN.** `read_trip` fences the city names it returns
  // and this tool's own schema tells the model to spell a city *"exactly as
  // read_trip spells them"* — so the one round trip the fence could break is
  // this one. The instruction asks a model not to repeat the marks and a good
  // one will not; `plain` is what makes the answer the same either way, rather
  // than a silent zero-result search when it does.
  const cities = (input.cities ?? []).map(plain);
  const found = await library.discover({ cities, readerId });
  return {
    searched: cities.length === 0 ? "the whole library" : cities.join(", "),
    days: found.slice(0, input.limit ?? MAX_PLAYBOOK_RESULTS).map((day) => ({
      savedDayId: day.savedDayId,
      name: day.name,
      cities: day.cities,
      stopCount: day.stopCount,
      totalCost: day.totalCost,
      adds: day.adds,
      mine: day.isMine,
    })),
  };
}

// Input schemas, exported so the no-`tripId` assertion can walk them
// structurally rather than by reading the tool descriptions.
export const ReadTripInput = z.object({});

// One field, two shapes: a bare day number (the common case, and what a
// day-scoped turn's default still fills in unasked) or a list of up to
// `MAX_READ_DAYS` of them. This is what "read days 8, 9 and 10" was missing —
// the live run this whole change answers spent 75 seconds and 17 tool calls
// because the ONLY door here took one day, so the model walked the trip one
// `read_day` at a time to find the days near Nara. A model that reads
// `read_trip`'s new `cities` field can now name the candidates and read all of
// them in the ONE call this schema exists to make possible.
export const ReadDayInput = z.object({
  days: z
    .union([
      z.number().int().min(1),
      z
        .array(z.number().int().min(1))
        .min(1)
        .max(MAX_READ_DAYS, `Ask for at most ${MAX_READ_DAYS} days per call.`),
    ])
    .optional()
    .describe(
      `One or more 1-based day numbers — a single number, or a list like [8, 9, 10] (up to ${MAX_READ_DAYS} at once). ALWAYS batch every day the question needs into ONE call rather than calling this once per day. Omit to read the day this question is about.`,
    ),
});

export const FindFreeTimeInputSchema = z.object({
  day: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("1-based day number. Omit to search the day this question is about, or the whole trip."),
  wholeTrip: z
    .boolean()
    .optional()
    .describe("true searches every day, even when this question is about one day. Ignored when `day` is set."),
  after: z.string().regex(HHMM).optional().describe('Earliest time to consider, 24-hour "HH:mm" (e.g. "21:00"). Default 08:00.'),
  before: z.string().regex(HHMM).optional().describe('Latest time to consider, 24-hour "HH:mm" (e.g. "23:00"). Default 22:00.'),
  minMinutes: z.number().int().min(1).optional().describe("Ignore gaps shorter than this many minutes."),
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Every field optional and ANDed. Described only where the name does not say
// it: this schema rides on every step of every turn that holds the tool, and
// "fromDay" needs no sentence (contextBudget.test.ts measures each one).
export const FindDaysInputSchema = z.object({
  city: z.string().min(1).max(200).optional().describe("As read_trip spells it. A travel day matches both its cities."),
  tag: ActivityTag.optional(),
  fromDay: z.number().int().min(1).optional(),
  toDay: z.number().int().min(1).optional(),
  fromDate: z.string().regex(ISO_DATE).optional().describe("YYYY-MM-DD"),
  toDate: z.string().regex(ISO_DATE).optional().describe("YYYY-MM-DD"),
  empty: z.boolean().optional().describe("true: no stops; false: at least one."),
  toBook: z.boolean().optional().describe("Has a stop still to book."),
  hasConflicts: z.boolean().optional(),
});

// No `ownerId`, and no `visibility` either: both would be ways to ask the
// library a question about somebody else, and neither is expressible. The set
// of rows this can reach is decided by `readerId`, which arrives as the turn's
// `actor` and by nothing a model can type (ADR-042 Decision 2).
export const SearchPlaybooksInputSchema = z.object({
  cities: z
    .array(z.string().min(1).max(200))
    .max(MAX_SEARCH_CITIES, `Name at most ${MAX_SEARCH_CITIES} cities per call.`)
    .optional()
    .describe(
      'City names, spelled exactly as read_trip spells them (e.g. ["Kyoto", "Osaka"]). A day matches if it touches ANY of them. Omit to browse the most-added days.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_PLAYBOOK_RESULTS, `Ask for at most ${MAX_PLAYBOOK_RESULTS} days per call.`)
    .optional()
    .describe(`How many days to return, up to ${MAX_PLAYBOOK_RESULTS}. Omit for all of them.`),
});

// ---------------------------------------------------------------------------
// The fence (spec §4, ADR-043 decision 1's tool-result tainting)
// ---------------------------------------------------------------------------
//
// **Three of these four tools return text somebody else wrote.** A trip is
// shared by link and edited by several people, so an activity title, a stop's
// notes, a tag, a city and a Playbook day's name are all attacker-influenceable
// relative to whoever is asking — that is the threat this product actually has,
// rather than a generic one it inherits. `untrusted()` fences each of those,
// and the standing rule in the system instruction (`UNTRUSTED_DATA_RULE`) says
// once what the fence means.
//
// Declared as `taint` on the definition and applied by `invoke`, NOT inside
// `readTrip`/`readDay`/`searchPlaybooks`: those are pure readouts and are unit
// tested as such, and fencing is a property of crossing to a model. Anything
// that reads a readout without going through a tool — the simulated model does,
// through the agent's own message history — sees the fence and undoes it
// (`plain`), which is what a real model does with the prose it writes back.
//
// `find_free_time` and `find_days` declare no `taint`, and that is the point
// of the asymmetry: day numbers, clock times and durations are ours. A fence on a field nobody
// wrote teaches a reader — and a model — that the mark means nothing.

/**
 * A conflict, fenced.
 *
 * **`description` is server-authored prose with user-authored titles
 * interpolated into it** — `"X" and "Y" overlap in time on the same day.`
 * (`detectConflicts`, packages/domain). So the whole sentence is
 * attacker-influenceable even though we wrote its frame, and fencing the frame
 * along with the titles is the conservative reading. `kind` is a closed set of
 * ours and `ref` is a number, so neither is fenced.
 */
function fencedConflicts(conflicts: readonly AiConflictSummary[]): AiConflictSummary[] {
  return conflicts.map((conflict) => ({ ...conflict, description: untrusted(conflict.description) }));
}

/**
 * A trip readout, fenced: the trip's name, and each day's cities — or, for the
 * overview, each segment's city and the cities it also touches. The overview's
 * other strings are ours: `overview` is our sentence, `days` and `emptyDays`
 * are day numbers, and the keys of `stopTags`, `stopKinds` and `conflicts` are
 * closed enums (`ActivityTag`, `ActivityKind`, the conflict kinds), which is
 * why `tags` goes unfenced on `read_day` too.
 */
function fencedTrip(readout: TripReadout | TripOverviewReadout): TripReadout | TripOverviewReadout {
  if ("segments" in readout) {
    return {
      ...readout,
      name: untrusted(readout.name),
      segments: readout.segments.map((segment) => ({
        ...segment,
        city: untrustedOrNull(segment.city),
        alsoTouches: untrustedAll(segment.alsoTouches),
      })),
      tripWideConflicts: fencedConflicts(readout.tripWideConflicts),
    };
  }
  return {
    ...readout,
    name: untrusted(readout.name),
    // `currency` is an ISO code from the contract's own enum, and every other
    // field on a day is a count, a cost or a date. `cities` is the one that
    // comes from `Location.city`, which a person typed.
    days: readout.days.map((day) => ({ ...day, cities: untrustedAll(day.cities) })),
    conflicts: fencedConflicts(readout.conflicts),
  };
}

function fencedPlace(place: PlaceReadout | null): PlaceReadout | null {
  return place ? { ...place, name: untrusted(place.name), city: untrustedOrNull(place.city) } : null;
}

/** A day readout, fenced: each stop's title, notes, and its places' names and cities. */
function fencedDay(readout: DayReadout): DayReadout {
  return {
    ...readout,
    stops: readout.stops.map((stop) => ({
      ...stop,
      title: untrusted(stop.title),
      notes: untrustedOrNull(stop.notes),
      // `kind` is the contract's own enum and `timeWindow`/`cost` are numbers
      // and clock times. `countryCode` is a two-letter code the geocoder
      // returns, not prose — left alone so the fence keeps meaning "a person
      // wrote this". `location.precision` is the same: a closed enum this
      // server writes, which nobody can type into.
      //
      // **`tags` is NOT fenced, and spec §4 has it wrong.** It reads as free
      // text here because `StopReadout` widens it to `string[]`, but the source
      // is `ActivityTag` — a four-value enum in `@tc/contracts`. Nobody can type
      // into it, so there is nothing to fence, and fencing it would have broken
      // the one consumer that MATCHES on the values (`needsBooking`, through
      // the simulated model) for no security gain at all.
      location: fencedPlace(stop.location),
      // M24: a leg's destination is typed by a person exactly as its origin
      // is, so it is fenced the same way. `mode` is a closed enum.
      endLocation: fencedPlace(stop.endLocation),
    })),
    conflicts: fencedConflicts(readout.conflicts),
  };
}

/** One `read_day` entry: a day, a batch of them, or the tool's own problem. */
function fencedDayResult(result: DayReadout | ReadToolProblem | DayBatchReadout): typeof result {
  if ("error" in result) return result;
  if ("days" in result) return { days: result.days.map((entry) => ("error" in entry ? entry : fencedDay(entry))) };
  return fencedDay(result);
}

/**
 * **The intents that read below the trip's shape** (ADR-058): every one except
 * `compose`. A notebook is built from widgets whose filters select the data
 * when the page is READ, so what a stop says today is no input to what the page
 * should hold — on 2026-09-26 a compose turn read all fourteen days, baked
 * "four meals still pending" into prose that was stale the next edit, and ran
 * out the clock. `read_trip` stays on every intent: which tags, kinds and
 * cities exist is the shape a filter is chosen from.
 */
const STOP_LEVEL_CLASSES = ["question", "edit", "plan"] as const satisfies readonly TaskClass[];

/**
 * The five definitions, wired to the functions above.
 *
 * `needs` is the whole of what each may reach, and the answers differ:
 * `read_trip` and `find_days` read the trip and nothing else; `read_day` and
 * `find_free_time` also read the turn's scope, which is where the day-number
 * fallback comes from, and `read_day` the turn's read budget;
 * `search_playbooks` reads NEITHER — the library is not the trip, and
 * the only thing it takes is who is asking. That asymmetry used to be invisible
 * (one ambient context under every tool name) and is now three lines.
 */
export const readTripTool = defineTool({
  name: "read_trip",
  description:
    `Read this trip's shape: name, currency, start date, how many days, how many members and how many of them are travelling (a member can be on the trip and not travelling; a stop nobody is picked for is priced for the travellers, and for at least one person when nobody is travelling), each day's date, which city (or cities, on a travel day) it touches, stop count, how many of its stops still need booking and cost subtotal, the trip cost total, and any active conflicts. Start here — the \`cities\` field is how you find which days are near a place without reading every day. Past ${OVERVIEW_ABOVE_DAYS} days it returns an overview instead (city segments with their days, and counts): find the days you need there (or with find_days, if you have it), then read only those.`,
  domain: "itinerary",
  effect: "read",
  spend: "none",
  input: ReadTripInput,
  // The overview second: `z.union` keeps the first schema that parses, and an
  // overview has no `days` array, so a per-day readout is never read as one.
  output: z.union([TripReadoutSchema, TripOverviewReadoutSchema]),
  needs: ["trip"] as const,
  minimumRole: "viewer",
  taint: fencedTrip,
  run: (_input, deps) => readTripForModel(deps.trip),
});

export const readDayTool = defineTool({
  name: "read_day",
  description: `Read one or MORE days in full: every stop with its time window, location, notes, kind, tags, cost (the price for one person) and headcount (how many people that price is multiplied by: the people picked for the stop, or every traveller when nobody is picked). The day's costSubtotal and read_trip's tripCostTotal already apply each stop's headcount — quote them; never recompute a total as cost times the travellers. Plus the active conflicts that touch each day. Pass \`days\` as a single number or a list (up to ${MAX_READ_DAYS}) — if a question needs several days, put them all in ONE call rather than calling this once per day. Use this whenever the question is about what happens on a day, when a stop's time matters, or when the question is about a day's conflicts or what it still needs booked.`,
  domain: "itinerary",
  effect: "read",
  spend: "none",
  input: ReadDayInput,
  output: z.union([DayReadoutSchema, ReadToolProblemSchema, DayBatchReadoutSchema]),
  // `readBudget`: the turn's `MAX_DAYS_READ_PER_TURN` ledger, minted per turn
  // like the collectors and shared by every `read_day` call in it.
  needs: ["trip", "scope", "readBudget"] as const,
  minimumRole: "viewer",
  taskClasses: STOP_LEVEL_CLASSES,
  taint: fencedDayResult,
  run: (input, deps) => {
    const days =
      input.days !== undefined
        ? Array.isArray(input.days)
          ? input.days
          : [input.days]
        : deps.scope.kind === "day"
          ? [deps.scope.dayIndex + 1]
          : undefined;
    if (days === undefined) {
      return {
        error: "Say which day: read_day takes a 1-based day number, or a list of them.",
      } satisfies ReadToolProblem;
    }
    // The single-day shape stays exactly what it was — a bare `DayReadout` —
    // so the one-day form this tool has always answered is unchanged for the
    // common case. Only a genuine batch takes the wrapped `{ days: [...] }`
    // shape `readDays` returns. Both go through the turn's read budget: one
    // day past the cap is a bare refusal, exactly as one day out of range is.
    const read = readDays(deps.trip, days, deps.readBudget);
    return days.length === 1 ? read.days[0]! : read;
  },
});

export const findDaysTool = defineTool({
  name: "find_days",
  description: `Find which days match, as 1-based day numbers only (how many matched, and the first ${MAX_FOUND_DAYS}) — never their stops. Every filter is optional and they combine. On a long trip, where read_trip returns an overview, use it to locate the days a question needs, then read only those with read_day.`,
  domain: "itinerary",
  effect: "read",
  spend: "none",
  input: FindDaysInputSchema,
  output: FoundDaysReadoutSchema,
  // The trip and nothing else. No day-scope fallback: a locator that quietly
  // narrowed to the scoped day would answer "which days are in Osaka?" with
  // one day.
  needs: ["trip"] as const,
  minimumRole: "viewer",
  // `read_day`'s classes, because it exists to point `read_day` somewhere.
  taskClasses: STOP_LEVEL_CLASSES,
  // Off a viewer's turn, like `find_free_time`: that turn is held to
  // `read_trip` and `read_day` on purpose (ADR-058 decision 9, *"minimize the
  // tool call as small as possible"*), and it is not this tool's place to
  // widen it. A viewer still locates a city's days on a long trip — the
  // overview's segments carry their day ranges — and is told so
  // (`instructionBlocks`' long-trip line).
  onReadOnlyTurns: false,
  run: (input, deps) => findDays(deps.trip, input),
});

export const findFreeTimeTool = defineTool({
  name: "find_free_time",
  description:
    "Find free time in one day or across the whole trip. Omit `day` and pass `wholeTrip: true` to search every day in ONE call: `days` comes back ranked most free first, each with its morning, afternoon and evening free minutes and its longest gap, so `days[0]` answers \"which day is most free?\". Never call this once per day. Searches 08:00-22:00 unless you pass after/before. Use this rather than working times out from read_day yourself.",
  domain: "itinerary",
  effect: "read",
  spend: "none",
  input: FindFreeTimeInputSchema,
  output: z.union([FreeTimeReadoutSchema, ReadToolProblemSchema]),
  needs: ["trip", "scope"] as const,
  minimumRole: "viewer",
  taskClasses: STOP_LEVEL_CLASSES,
  onReadOnlyTurns: false,
  run: (input, deps) => findFreeTime(deps.trip, deps.scope, input),
});

export const searchPlaybooksTool = defineTool({
  name: "search_playbooks",
  description:
    "Search the playbook library — ready-made days somebody has written and published, plus your own saved ones — by city. Returns each day's savedDayId, name, cities, stop count, what the day costs for one person (the sum of its stops' per-person prices) and how many trips have taken it. This is the ONLY way to find a day to add with insert_playbook_day, and the savedDayId must come from here: there is no other way to name one.",
  // `library`, not `itinerary`: the corpus it reads is outside the trip, which
  // is the capability boundary that earned the tool (ADR-042 Decision 2).
  domain: "library",
  effect: "read",
  spend: "none",
  input: SearchPlaybooksInputSchema,
  output: PlaybookSearchReadoutSchema,
  // `searched` is the model's own `cities` argument echoed back, or our own
  // "the whole library" — not another person's text, so not fenced. `name` and
  // `cities` are the library day's author's, and the author is a stranger.
  taint: (readout: PlaybookSearchReadout) => ({
    ...readout,
    days: readout.days.map((day) => ({ ...day, name: untrusted(day.name), cities: untrustedAll(day.cities) })),
  }),
  // WHO it reads the library as, and WHERE the library is. The second key is
  // what the audit property was missing: the corpus read used to arrive by
  // import, so "what can this tool touch?" did not mention Postgres.
  needs: ["actor", "playbooks"] as const,
  minimumRole: "viewer",
  taskClasses: STOP_LEVEL_CLASSES,
  onReadOnlyTurns: false,
  run: (input, deps) => searchPlaybooks(deps.playbooks, deps.actor.userId, input),
});

// `find_days` beside the `read_day` it points: registry order is the order the
// model reads the tools in.
export const READ_TOOLS = [readTripTool, readDayTool, findDaysTool, findFreeTimeTool, searchPlaybooksTool] as const;
