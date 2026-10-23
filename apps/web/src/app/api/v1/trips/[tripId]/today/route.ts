import { z } from "zod";
import { ActivityView } from "@tc/contracts";
import { isKnownZone, type TripPhase } from "@tc/pages";
import { turnNowOf } from "@/server/assistant/context";
import { route } from "@/server/public-api/route";
import { buildTripGlobals } from "@/server/tripGlobals";

// Where a trip is today (M52 decision 21): the phase, today's day and its
// stops, and the stop under way and the next one. Every part of it is
// `tripNow`'s, read through `turnNowOf` for the server's zone fallback
// (ADR-080), so the API, the *Now and next* widget and the assistant agree.

// A record, not a tuple, so the published enum is `TripPhase` both ways: a
// phase missing here or one `TripPhase` lacks fails the typecheck, where a new
// phase would otherwise be a 500 from the response check on every such trip.
const PHASES: Record<TripPhase, true> = { planning: true, soon: true, underway: true, ended: true };
const TripPhaseSchema = z.enum(Object.keys(PHASES) as [TripPhase, ...TripPhase[]]);

const TripToday = z.object({
  date: z.string().describe("Today's date (`YYYY-MM-DD`) on the trip's clock."),
  timeZone: z.string().describe("The IANA zone `date` is read in: the day's own (the first day's off the trip), else the asker's, else the trip's, else UTC."),
  phase: TripPhaseSchema,
  dayId: z.string().uuid().nullable().describe("Today's day while the trip is under way; null otherwise."),
  stops: z.array(ActivityView).describe("Today's stops in the day's order; empty off the trip's days."),
  now: z.string().uuid().nullable().describe("The stop under way, while the trip is."),
  next: z.string().uuid().nullable().describe("The next stop to begin, while the trip is under way."),
});

export const { GET } = route({
  GET: {
    summary: "Get where a trip is today: its phase, today's stops, and the stop under way and the next one",
    scope: "trips:read",
    trip: "path",
    role: "viewer",
    query: z.object({
      timeZone: z
        .string()
        .refine(isKnownZone, "Not a known IANA time zone.")
        .optional()
        .describe("Your IANA zone, for a day whose stops have no place yet. Read for this answer only, never stored."),
    }),
    response: TripToday,
    handle: ({ trip, query }) => {
      const detail = trip!;
      const asker = (query as { timeZone?: string }).timeZone ?? null;
      const now = turnNowOf(detail, buildTripGlobals(detail), Date.now(), asker);
      const day = now.dayIndex === null ? undefined : detail.days[now.dayIndex];
      // Before and after the trip the widget says nothing is on, and so does
      // this: `tripNow`'s next would otherwise be the first stop of the trip.
      const underway = now.phase === "underway";
      return {
        date: now.local.date,
        timeZone: now.local.timeZone,
        phase: now.phase,
        dayId: day?.dayId ?? null,
        stops: day?.activityIds.flatMap((id) => detail.activities[id] ?? []) ?? [],
        now: underway ? (now.current?.activityId ?? null) : null,
        next: underway ? (now.next?.activityId ?? null) : null,
      };
    },
  },
});
