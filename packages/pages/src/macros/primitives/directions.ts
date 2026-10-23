import { z } from "zod";
import type { ActivityMode, FilterDimension, TripDetail } from "@tc/contracts";
import type { MacroDef, StopDirectionsPayload, WidgetContext, WidgetScope } from "../../registry-types";
import { blockOf } from "../../registry-types";
import { ok, empty, needsTrip, type MacroResult } from "../../result";
import { filterInputs, filterParams } from "../../filters";
import { narrow } from "../../select";
import { timedStops } from "../../now";
import { readerClock, toClockRange } from "../../clockLabel";

// `stop.directions` — *Directions* (M52 decisions 15, 16): a link to one place.
//
// **A stop primitive whose selection is read as a route, not a list.** On a
// *for each stop* line it is that stop; anywhere else it is the first selected
// stop with a place that has not ended by the reader's clock, so under a
// page's Today scope it is the next place to go to today. The link itself is
// built in `apps/web` (`directionsUrl`), which owns the maps app's URL.

/** What a day-of widget says on a date that is not a trip day (M52 decision 10). */
export const NOTHING_TODAY = "Nothing planned today";
/** What it says once today's last stop is over. */
export const NOTHING_MORE_TODAY = "Nothing more planned today";

const DIRECTIONS_FILTERS = ["day", "city", "tag", "kind", "dates"] as const satisfies readonly FilterDimension[];
const DirectionsParams = filterParams(DIRECTIONS_FILTERS, {});
type DirectionsParams = z.infer<typeof DirectionsParams>;

/**
 * The mode of the transit stop just before this one on its day, which is how
 * the traveller is getting there — the stop sheet's rule (M52 decision 16).
 */
export function leadingMode(trip: Pick<TripDetail, "days" | "activities">, dayId: string | null, activityId: string): ActivityMode | null {
  const ids = trip.days.find((day) => day.dayId === dayId)?.activityIds ?? [];
  const before = trip.activities[ids[ids.indexOf(activityId) - 1] ?? ""];
  return before?.kind === "transit" ? before.mode : null;
}

/** A page scoped to today, read on a date that is no trip day (`resolveDateScope`). */
export function isNoDay(item: WidgetScope | undefined): boolean {
  return item?.kind === "no-day" || (item?.kind === "city-in-scope" && item.page.kind === "no-day");
}

export const stopDirections: MacroDef<DirectionsParams, StopDirectionsPayload> = {
  name: "stop.directions", title: "Directions", shape: "block",
  params: DirectionsParams, inputs: filterInputs(DIRECTIONS_FILTERS),
  selection: { entity: "stop", filters: DIRECTIONS_FILTERS },
  description:
    "A link that opens directions in Google Maps to one stop: the stop on its line, or the next place still ahead among the stops it is filtered to. On a page that follows today, that is the next place to go today.",
  emptyText: "add a place to a stop to see this",
  preview: "directions to the next place on your plan",
  resolve: ({ trip, globals, now, user }: WidgetContext, params, item): MacroResult<StopDirectionsPayload> => {
    if (!trip) return needsTrip();
    const selection = narrow(trip, globals, params, item);
    if (selection.status !== "ok") return selection;
    const { stops } = selection.value;
    if (stops.length === 0) return empty(isNoDay(item) ? NOTHING_TODAY : "no stops here yet");
    // Only what has ended is behind the reader; an untimed stop never has. A
    // stop's own line goes to it whatever the time.
    const ended = new Set(
      now == null || item?.kind === "stop"
        ? []
        : timedStops(trip, globals, now.deviceZone).filter((s) => s.end <= now.at).map((s) => s.activityId),
    );
    const ahead = stops.filter((s) => !ended.has(s.activityId));
    if (ahead.length === 0) return empty(NOTHING_MORE_TODAY);
    const stop = ahead.find((s) => s.activity.location != null);
    if (!stop) return empty("add a place to a stop to see this");
    const { activity } = stop;
    const dayId = stop.dayIndex === null ? null : trip.days[stop.dayIndex]!.dayId;
    return ok({
      kind: "stop-directions",
      activityId: stop.activityId,
      title: activity.title,
      time: activity.timeWindow ? toClockRange(activity.timeWindow.start, activity.timeWindow.end, readerClock(user)) : null,
      place: activity.location!,
      mode: leadingMode(trip, dayId, stop.activityId),
    });
  },
  render: blockOf,
};
