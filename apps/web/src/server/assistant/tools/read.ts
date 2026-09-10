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
//      `discoverDays({ scope: "everyone" })` IS that clause.
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
import { ActivityKind, Money, TimeWindow, type TripDetail } from "@tc/contracts";
import { citiesOfDay, findFreeGaps, minutesOf } from "@tc/domain";
import { needsBooking } from "@/lib/needsBooking";
import { activeConflicts, conflictsOnDay, type AiConflictSummary, type AskScope } from "@/server/ai/context";
import { discoverDays } from "@/server/playbooks";
import { defineTool } from "@/server/assistant/defineTool";

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

export interface StopReadout {
  title: string;
  /** `null` when the stop is not scheduled to a time — which is what makes free-time answers real. */
  timeWindow: { start: string; end: string } | null;
  location: { name: string; city: string | null; countryCode: string | null } | null;
  notes: string | null;
  kind: ActivityKind;
  tags: string[];
  cost: { amountMinor: number; currency: string } | null;
}

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
// three of `Location`'s fields, with the coordinates the model must never see
// left behind — so it is written out.
export const DayReadoutSchema: z.ZodType<DayReadout> = z.object({
  day: z.number(),
  date: z.string().nullable(),
  costSubtotal: z.number(),
  stops: z.array(
    z.object({
      title: z.string(),
      timeWindow: TimeWindow.nullable(),
      location: z
        .object({
          name: z.string(),
          city: z.string().nullable(),
          countryCode: z.string().nullable(),
        })
        .nullable(),
      notes: z.string().nullable(),
      kind: ActivityKind,
      tags: z.array(z.string()),
      cost: Money.nullable(),
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

export const DayBatchReadoutSchema: z.ZodType<DayBatchReadout> = z.object({
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
 */
export function readDays(detail: TripDetail, days: readonly number[]): DayBatchReadout {
  const seen = new Set<number>();
  const unique: number[] = [];
  for (const day of days) {
    if (seen.has(day)) continue;
    seen.add(day);
    unique.push(day);
  }
  return { days: unique.map((day) => readDay(detail, day)) };
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

export const FreeTimeReadoutSchema: z.ZodType<FreeTimeReadout> = z.object({
  searched: z.string(),
  window: z.object({ after: z.string(), before: z.string() }),
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
  /** The day's total across its priced stops, or null when nothing is priced. */
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
 * **`discoverDays({ scope: "everyone" })`, not a third copy of the visibility
 * clause.** `scopePredicate` (playbooks.ts) spells `everyone` as *"published,
 * or mine"* — which is exactly `readableSavedDay`'s WHERE clause, the one the
 * apply door will re-run per day. A separate query here would agree with it
 * only until somebody edited one of them, and the two directions that
 * disagreement can go are both bad: narrower proposes days that 404 on
 * approval, wider enumerates other people's private days.
 *
 * It costs one extra `count(*)` (`publishedDayCount`) that this caller does not
 * read. That is the price of the shared query, and it is one indexed count over
 * a small table — cheap next to a second predicate to keep in step.
 */
export async function searchPlaybooks(
  readerId: string,
  input: SearchPlaybooksInput,
): Promise<PlaybookSearchReadout> {
  const cities = input.cities ?? [];
  const found = await discoverDays({
    cities,
    scope: "everyone",
    // Most-added first: the ledger is the library's own answer to "which of
    // these is worth taking", and it is the ranking Discover offers a person
    // making the same choice.
    sort: "most-added",
    budget: "any",
    season: null,
    readerId,
  });
  return {
    searched: cities.length === 0 ? "the whole library" : cities.join(", "),
    days: found.days.slice(0, input.limit ?? MAX_PLAYBOOK_RESULTS).map((day) => ({
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
  after: z.string().regex(HHMM).optional().describe('Earliest time to consider, 24-hour "HH:mm" (e.g. "21:00").'),
  before: z.string().regex(HHMM).optional().describe('Latest time to consider, 24-hour "HH:mm" (e.g. "23:00").'),
  minMinutes: z.number().int().min(1).optional().describe("Ignore gaps shorter than this many minutes."),
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

/**
 * The four definitions, wired to the four functions above.
 *
 * `needs` is the whole of what each may reach, and the three answers differ:
 * `read_trip` reads the trip and nothing else; `read_day` and `find_free_time`
 * also read the turn's scope, which is where the day-number fallback comes
 * from; `search_playbooks` reads NEITHER — the library is not the trip, and
 * the only thing it takes is who is asking. That asymmetry used to be invisible
 * (one ambient context under every tool name) and is now three lines.
 */
export const readTripTool = defineTool({
  name: "read_trip",
  description:
    "Read this trip's shape: name, currency, start date, how many days, each day's date, which city (or cities, on a travel day) it touches, stop count, how many of its stops still need booking and cost subtotal, the trip cost total, and any active conflicts. Start here — the `cities` field is how you find which days are near a place without reading every day.",
  domain: "itinerary",
  effect: "read",
  spend: "none",
  input: ReadTripInput,
  output: TripReadoutSchema,
  needs: ["trip"] as const,
  minimumRole: "viewer",
  run: (_input, deps) => readTrip(deps.trip),
});

export const readDayTool = defineTool({
  name: "read_day",
  description: `Read one or MORE days in full: every stop with its time window, location, notes, kind, tags and cost, plus the active conflicts that touch each day. Pass \`days\` as a single number or a list (up to ${MAX_READ_DAYS}) — if a question needs several days, put them all in ONE call rather than calling this once per day. Use this whenever the question is about what happens on a day, when a stop's time matters, or when the question is about a day's conflicts or what it still needs booked.`,
  domain: "itinerary",
  effect: "read",
  spend: "none",
  input: ReadDayInput,
  output: z.union([DayReadoutSchema, ReadToolProblemSchema, DayBatchReadoutSchema]),
  needs: ["trip", "scope"] as const,
  minimumRole: "viewer",
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
    // shape `readDays` returns.
    return days.length === 1 ? readDay(deps.trip, days[0]!) : readDays(deps.trip, days);
  },
});

export const findFreeTimeTool = defineTool({
  name: "find_free_time",
  description:
    "Find the unscheduled gaps in a day or across the trip, optionally within a time window or above a minimum length. Use this rather than working times out from read_day yourself.",
  domain: "itinerary",
  effect: "read",
  spend: "none",
  input: FindFreeTimeInputSchema,
  output: z.union([FreeTimeReadoutSchema, ReadToolProblemSchema]),
  needs: ["trip", "scope"] as const,
  minimumRole: "viewer",
  run: (input, deps) => findFreeTime(deps.trip, deps.scope, input),
});

export const searchPlaybooksTool = defineTool({
  name: "search_playbooks",
  description:
    "Search the playbook library — ready-made days somebody has written and published, plus your own saved ones — by city. Returns each day's savedDayId, name, cities, stop count, total cost and how many trips have taken it. This is the ONLY way to find a day to add with insert_playbook_day, and the savedDayId must come from here: there is no other way to name one.",
  // `library`, not `itinerary`: the corpus it reads is outside the trip, which
  // is the capability boundary that earned the tool (ADR-042 Decision 2).
  domain: "library",
  effect: "read",
  spend: "none",
  input: SearchPlaybooksInputSchema,
  output: PlaybookSearchReadoutSchema,
  needs: ["actor"] as const,
  minimumRole: "viewer",
  run: (input, deps) => searchPlaybooks(deps.actor.userId, input),
});

export const READ_TOOLS = [readTripTool, readDayTool, findFreeTimeTool, searchPlaybooksTool] as const;
