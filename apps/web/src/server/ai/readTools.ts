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
// So there are exactly three, and new questions land on them as typed
// parameters. "Where is there free time after 9pm?" is `find_free_time({ after
// })`, not a fourth tool.
//
// Two structural rules run through the whole file:
//
//   1. **No tool takes a `tripId`.** Trip and actor identity arrive through
//      `contextSchema`/`toolsContext`, so "read a different trip" is not
//      expressible in any tool's schema (ADR-022 §3). This is layered defense
//      in the same sense `idFields.ts` is: the constraint is structural, not
//      prompted. `readTools.test.ts` asserts it over every schema, so a fourth
//      tool cannot quietly reintroduce one.
//   2. **The computation lives in the domain.** `find_free_time` is a wrapper
//      over `findFreeGaps` (packages/domain/src/trip/freeTime.ts) and owns
//      nothing but the translation between what a user says ("after 9pm") and
//      what the domain speaks (minutes from midnight). ADR-022 §2.
//
// Numbers the model sees are 1-BASED day numbers, everywhere, in both
// directions. `TripDetail.days` and `FreeGap.dayIndex` are 0-based; the
// conversion happens here and only here. Handing a model both an `index` and a
// `day` for the same row is how off-by-one answers get written.
import { tool } from "ai";
import { z } from "zod";
import type { TripDetail } from "@tc/contracts";
import { findFreeGaps, minutesOf } from "@tc/domain";
import { activeConflicts, type AiConflictSummary, type AskScope } from "@/server/ai/context";

export const READ_TOOL_NAMES = ["read_trip", "read_day", "find_free_time"] as const;
export type ReadToolName = (typeof READ_TOOL_NAMES)[number];

/**
 * What every read tool receives through `toolsContext`, and the only way trip
 * or actor identity reaches one.
 *
 * `detail` rides along rather than being re-fetched per tool call: `guard()`
 * has already read and PARSED it at the access seam, and a tool that fetched
 * its own copy could answer about a trip the guard never checked. `scope` is
 * here for the same reason — narrowing is a property of the turn, not
 * something the model should be able to talk its way out of by omitting a
 * parameter.
 */
export interface ReadToolContext {
  tripId: string;
  userId: string;
  detail: TripDetail;
  scope: AskScope;
}

// `contextSchema` is validated on EVERY tool call (ai/dist:
// validateToolContext), so re-running `TripDetail.parse` here would re-walk a
// 68-activity document per call to re-check something `requireTripAccess`
// already checked at the seam. The identity fields are checked because they
// are what ADR-022 §3 is about; `detail` and `scope` are passed through.
const ReadContextSchema = z.object({
  tripId: z.string().uuid(),
  userId: z.string().min(1),
  detail: z.custom<TripDetail>((v) => typeof v === "object" && v !== null),
  scope: z.custom<AskScope>((v) => typeof v === "object" && v !== null),
});

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

export interface TripDayReadout {
  /** 1-based, matching `read_day`'s input. */
  day: number;
  date: string | null;
  stopCount: number;
  /** Integer minor units, same convention as `TripDetail.days[].costSubtotal`. */
  costSubtotal: number;
}

export interface TripReadout {
  name: string;
  currency: string;
  startDate: string | null;
  dayCount: number;
  tripCostTotal: number;
  days: TripDayReadout[];
  /** Active (non-dismissed) conflicts, by the same 1-based `ref` the command envelope uses. */
  conflicts: AiConflictSummary[];
}

/**
 * The trip noun. No computation — ADR-022 records this tool as earned by the
 * NOUN, not by arithmetic, and the model's own reading of a day list is fine.
 *
 * Per-day stop counts and cost subtotals rather than stop titles: the point of
 * a separate `read_day` is that a 14-day trip's every stop does not have to be
 * re-sent to answer "how long is this trip?".
 */
export function readTrip(detail: TripDetail): TripReadout {
  return {
    name: detail.name,
    currency: detail.currency,
    startDate: detail.startDate,
    dayCount: detail.days.length,
    tripCostTotal: detail.tripCostTotal,
    days: detail.days.map((day, index) => ({
      day: index + 1,
      date: day.date,
      stopCount: day.activityIds.length,
      costSubtotal: day.costSubtotal,
    })),
    // The raw content-derived `id` embeds UUIDs and is stripped for the same
    // reason the command envelope strips it — see context.ts.
    conflicts: activeConflicts(detail).map(({ id: _id, ...rest }) => rest),
  };
}

export interface StopReadout {
  title: string;
  /** `null` when the stop is not scheduled to a time — which is what makes free-time answers real. */
  timeWindow: { start: string; end: string } | null;
  location: { name: string; city: string | null; countryCode: string | null } | null;
  notes: string | null;
  kind: string;
  tags: string[];
  cost: { amountMinor: number; currency: string } | null;
}

export interface DayReadout {
  day: number;
  date: string | null;
  costSubtotal: number;
  stops: StopReadout[];
}

/** What a tool hands back when the model asked something the trip cannot answer. */
export interface ReadToolProblem {
  error: string;
}

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
          location: activity.location
            ? {
                name: activity.location.name,
                city: activity.location.city ?? null,
                countryCode: activity.location.countryCode ?? null,
              }
            : null,
          notes: activity.notes,
          kind: activity.kind,
          tags: [...activity.tags],
          cost: activity.cost,
        },
      ];
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

export interface FreeTimeReadout {
  /** Which days were searched — "day N" or "the whole trip" — so the answer can say so. */
  searched: string;
  window: { after: string; before: string };
  gaps: FreeTimeGapReadout[];
}

export interface FindFreeTimeInput {
  day?: number;
  after?: string;
  before?: string;
  minMinutes?: number;
}

/**
 * A thin wrapper over the domain's `findFreeGaps`. Everything here is
 * translation: 1-based day → 0-based index, "21:00" → 1260, and back again.
 * Not one minute of arithmetic — that is the computation ADR-022 §2 puts in
 * `packages/domain` so it is unit-tested with no server, DB or model in the
 * way, and so it survives whether or not a model ever calls it.
 *
 * `day` omitted falls back to the turn's scope, not to "every day": a
 * day-scoped question that forgot to repeat the day number is still about that
 * day. See `scopeNarrowing` in handleAskRequest.ts.
 */
function parseTime(value: string | undefined, fallback: number): number | null {
  if (value === undefined) return fallback;
  return HHMM.test(value) ? minutesOf(value) : null;
}

export function findFreeTime(
  detail: TripDetail,
  scope: AskScope,
  input: FindFreeTimeInput,
): FreeTimeReadout | ReadToolProblem {
  const dayIndex = input.day !== undefined ? input.day - 1 : scope.kind === "day" ? scope.dayIndex : undefined;
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
  const after = parseTime(input.after, 0);
  if (after === null) return { error: `"${input.after}" is not a 24-hour time like "09:00" or "21:30".` };
  const before = parseTime(input.before, 1440);
  if (before === null) return { error: `"${input.before}" is not a 24-hour time like "09:00" or "21:30".` };
  const afterMinutes = after;
  const beforeMinutes = before;
  const gaps = findFreeGaps(detail, {
    dayIndex,
    afterMinutes,
    beforeMinutes,
    minMinutes: input.minMinutes,
  });
  return {
    searched: dayIndex === undefined ? "the whole trip" : `day ${dayIndex + 1}`,
    window: { after: hhmmOf(afterMinutes), before: hhmmOf(beforeMinutes) },
    gaps: gaps.map((gap) => ({
      day: gap.dayIndex + 1,
      date: detail.days[gap.dayIndex]?.date ?? null,
      start: hhmmOf(gap.startMinutes),
      end: hhmmOf(gap.endMinutes),
      durationMinutes: gap.durationMinutes,
    })),
  };
}

// Input schemas, exported so the no-`tripId` assertion can walk them
// structurally rather than by reading the tool descriptions.
export const ReadTripInput = z.object({});

export const ReadDayInput = z.object({
  day: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("1-based day number. Omit to read the day this question is about."),
});

export const FindFreeTimeInputSchema = z.object({
  day: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("1-based day number. Omit to search the day this question is about, or the whole trip."),
  after: z.string().regex(HHMM).optional().describe('Earliest time to consider, 24-hour "HH:mm" (e.g. "21:00").'),
  before: z.string().regex(HHMM).optional().describe('Latest time to consider, 24-hour "HH:mm" (e.g. "23:00").'),
  minMinutes: z.number().int().min(1).optional().describe("Ignore gaps shorter than this many minutes."),
});

export const READ_TOOL_INPUT_SCHEMAS: Record<ReadToolName, z.ZodObject<z.ZodRawShape>> = {
  read_trip: ReadTripInput,
  read_day: ReadDayInput,
  find_free_time: FindFreeTimeInputSchema,
};

/**
 * The three tools, wired to the three functions above.
 *
 * Argument-free like `buildPageTools()`: everything per-request arrives
 * through `toolsContext`, so the tool set itself is a constant and a test can
 * inspect its schemas without constructing a trip.
 *
 * The return type is INFERRED, not annotated `Record<ReadToolName, Tool>`:
 * `Tool`'s context parameter widens to `any` there, and `InferToolSetContext`
 * then resolves the whole tool set's context to `{}` — which makes
 * `toolsContext` typed `never` at the call site and silently deletes the one
 * guarantee ADR-022 §3 is about.
 */
export function buildReadTools() {
  return {
    tools: {
      read_trip: tool({
        description:
          "Read this trip's shape: name, currency, start date, how many days, each day's date, stop count and cost subtotal, the trip cost total, and any active conflicts.",
        inputSchema: ReadTripInput,
        contextSchema: ReadContextSchema,
        execute: async (_input, { context }) => readTrip(context.detail),
      }),
      read_day: tool({
        description:
          "Read one day in full: every stop with its time window, location, notes, kind, tags and cost. Use this whenever the question is about what happens on a day, or when a stop's time matters.",
        inputSchema: ReadDayInput,
        contextSchema: ReadContextSchema,
        execute: async (input, { context }) => {
          const day = input.day ?? (context.scope.kind === "day" ? context.scope.dayIndex + 1 : undefined);
          if (day === undefined) {
            return { error: "Say which day: read_day takes a 1-based day number." } satisfies ReadToolProblem;
          }
          return readDay(context.detail, day);
        },
      }),
      find_free_time: tool({
        description:
          "Find the unscheduled gaps in a day or across the trip, optionally within a time window or above a minimum length. Use this rather than working times out from read_day yourself.",
        inputSchema: FindFreeTimeInputSchema,
        contextSchema: ReadContextSchema,
        execute: async (input, { context }) => findFreeTime(context.detail, context.scope, input),
      }),
    },
  };
}

/**
 * The same context under every tool's name — `toolsContext` is keyed by tool,
 * and all three of these read the same trip as the same actor.
 */
export function readToolsContext(context: ReadToolContext): Record<ReadToolName, ReadToolContext> {
  return { read_trip: context, read_day: context, find_free_time: context };
}
