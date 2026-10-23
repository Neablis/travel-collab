import { z } from "zod";
import type { MacroDef, NowStop, TripNowPayload, WidgetContext } from "../../registry-types";
import { blockOf } from "../../registry-types";
import { ok, empty, needsTrip, type MacroResult } from "../../result";
import { formatTimeUntil, pickNowNext, timedStops, tripNow } from "../../now";
import { readerClock, toClockRange } from "../../clockLabel";
import { hasDirections, leadingMode, NOTHING_MORE_TODAY, NOTHING_TODAY } from "./directions";

// `trip.now` — *Now and next* (M52 decision 15): the stop under way, the next
// one and the time until it, each with Directions.
//
// **The one widget that reads `ctx.now`** (decision 12), as `trip.countdown`
// alone reads `today`. The resolver hands over every stop not yet over, as
// instants, and the block re-picks the two with `nowAndNext` on the page's
// minute clock. The pick is `tripNow`'s own (`pickNowNext`), so the two agree.
//
// A registered widget, not a primitive, for `trip.people`'s reason: *now* is
// the trip's, and a filter cannot narrow it.

const NowParams = z.object({});
type NowParams = z.infer<typeof NowParams>;

/**
 * The stop under way at `at` (the latest to begin when two overlap, as
 * `tripNow` picks) and the first still to begin, with the time until it.
 */
export function nowAndNext(
  payload: Pick<TripNowPayload, "stops">,
  at: number,
): { current: NowStop | null; next: (NowStop & { until: string }) | null } {
  const { current, next } = pickNowNext(payload.stops, at);
  return { current, next: next === null ? null : { ...next, until: formatTimeUntil(next.start - at) } };
}

export const tripNowWidget: MacroDef<NowParams, TripNowPayload> = {
  name: "trip.now", title: "Now and next", shape: "block",
  params: NowParams, inputs: [], selection: undefined,
  description:
    "While the trip is under way: the stop happening now, the next one and how long until it, each with directions. Before and after the trip it says nothing is planned today.",
  emptyText: "shows what is on now while the trip is under way",
  preview: "the stop you are at, and how long until the next",
  resolve: ({ trip, globals, now, user }: WidgetContext): MacroResult<TripNowPayload> => {
    if (!trip) return needsTrip();
    // No reader's clock (the server, the assistant): nothing to say about now.
    if (now == null) return empty();
    if (tripNow(trip, globals, now).phase !== "underway") return empty(NOTHING_TODAY);
    const ahead = timedStops(trip, globals, now.deviceZone).filter((s) => s.end > now.at);
    if (ahead.length === 0) return empty(NOTHING_MORE_TODAY);
    const clock = readerClock(user);
    return ok({
      kind: "trip-now",
      stops: ahead.map(({ activityId, dayId, start, end }) => {
        const activity = trip.activities[activityId]!;
        const window = activity.timeWindow!;
        return {
          activityId, title: activity.title, start, end,
          time: toClockRange(window.start, window.end, clock),
          place: hasDirections(activity.location) ? activity.location : null,
          mode: leadingMode(trip, dayId, activityId),
        };
      }),
    });
  },
  render: blockOf,
};
