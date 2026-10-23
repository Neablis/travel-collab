import { z } from "zod";
import type { ActivityMode, FilterDimension, Location, TripDetail } from "@tc/contracts";
import type { MacroDef, StopDirectionsPayload, WidgetContext } from "../../registry-types";
import { blockOf } from "../../registry-types";
import { ok, empty, needsTrip, type MacroResult } from "../../result";
import { filterInputs, filterParams } from "../../filters";
import { isNoDay, narrow } from "../../select";
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

/**
 * Whether Directions can be offered to `location`: only with coordinates, as
 * the stop sheet offers it (M52 decision 16), since a bare typed name gives
 * Maps nothing to find. The one rule for the sheet and the widgets alike.
 */
export function hasDirections(location: Location | null | undefined): location is Location {
  return location?.lat !== undefined && location.lng !== undefined;
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
    // What has ended is behind the reader, and so is an untimed stop that
    // comes before one that has: an untimed stop has no time of its own, so
    // its place in the day says when it is. A stop's own line goes to it
    // whatever the time.
    const ended = new Set(
      now == null || item?.kind === "stop"
        ? []
        : timedStops(trip, globals, now.deviceZone).filter((s) => s.end <= now.at).map((s) => s.activityId),
    );
    const lastEnded = stops.reduce((last, s, i) => (ended.has(s.activityId) ? i : last), -1);
    const ahead = stops.filter((s, i) => !ended.has(s.activityId) && (s.activity.timeWindow != null || i > lastEnded));
    if (ahead.length === 0) return empty(NOTHING_MORE_TODAY);
    const stop = ahead.find((s) => hasDirections(s.activity.location));
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
