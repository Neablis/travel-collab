import type { TripDetail } from "@tc/contracts";
import { addDaysIso, parseIsoDateUtc } from "@/lib/dates";

/** What a city card carries when it is dragged (M41 D2). */
export type CityCardDragData = { kind: "city-card"; activityIds: string[]; fromDayIndex: number };

/** What a Calendar cell offers to a drop: a trip day, or a date after the trip's last. */
export type CalendarDropData = { kind: "calendar-day"; dayIndex: number } | { kind: "calendar-after"; date: string };

/**
 * What a drop in the Calendar does, or `null` when it does nothing.
 *
 * - **A city card onto another day** moves the card's stops there (`stops`).
 *   Onto its own day it does nothing.
 * - **A city card onto a date after the trip's end** grows the trip to that
 *   date and moves the stops onto it: `newDays` is how many days to add. The
 *   start date never moves (Mitchell), so nothing before the trip is a target.
 * - **A rack card** (`{ activityId }`, the same payload Plan's drag carries)
 *   onto a trip day is `rack`, so the board places it the way a Plan drop
 *   does. Past the end it is refused: a rack card is one stop, and growing the
 *   trip for it is a decision the Calendar does not make by itself.
 *
 * A pure function, for the reason Plan's `resolveDrop` is one: a native drag
 * cannot be driven in jsdom, so the decision is tested here and the drag that
 * delivers it in a real browser.
 */
export function resolveCalendarDrop(
  trip: Pick<TripDetail, "startDate" | "days">,
  source: Record<string | symbol, unknown>,
  target: Record<string | symbol, unknown> | undefined,
):
  | { kind: "stops"; activityIds: string[]; toDayId: string; newDays: 0 }
  | { kind: "stops"; activityIds: string[]; toDayId: null; newDays: number }
  | { kind: "rack"; activityId: string; toDayId: string }
  | null {
  if (target === undefined) return null;
  const drop = target as CalendarDropData;

  if (source.kind === "city-card") {
    const card = source as unknown as CityCardDragData;
    if (drop.kind === "calendar-day") {
      if (drop.dayIndex === card.fromDayIndex) return null;
      const day = trip.days[drop.dayIndex];
      return day === undefined ? null : { kind: "stops", activityIds: card.activityIds, toDayId: day.dayId, newDays: 0 };
    }
    if (drop.kind === "calendar-after") {
      const newDays = daysAfterEnd(trip, drop.date);
      return newDays > 0 ? { kind: "stops", activityIds: card.activityIds, toDayId: null, newDays } : null;
    }
    return null;
  }

  if (typeof source.activityId === "string" && drop.kind === "calendar-day") {
    const day = trip.days[drop.dayIndex];
    return day === undefined ? null : { kind: "rack", activityId: source.activityId, toDayId: day.dayId };
  }
  return null;
}

/** How many days `date` lies after the trip's last day; 0 for none, or for a trip with no start date. */
export function daysAfterEnd(trip: Pick<TripDetail, "startDate" | "days">, date: string): number {
  if (trip.startDate === null || trip.days.length === 0) return 0;
  const last = parseIsoDateUtc(addDaysIso(trip.startDate, trip.days.length - 1)).getTime();
  const days = Math.round((parseIsoDateUtc(date).getTime() - last) / 86_400_000);
  return Math.max(0, days);
}
