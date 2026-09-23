// KI-2026-09-23-e. A demo trip is imported once and is then an event stream:
// `CreateTrip` against its derived id is refused as `trip-already-exists`, so
// no later edit to the bundle reached it. That was right for the trip as a
// whole — rewriting a stream would discard real history — and wrong for one
// narrow, common case: a stop's coordinates corrected after the fact (the
// 2026-09-23 geocode audit moved two Thailand stops by 21 and 25 km).
//
// This plans the smallest honest repair: for each stop whose `location` in the
// file differs from the activity's location in the trip, one `UpdateActivity`
// carrying `location` and nothing else. The importer sends those through
// `executeTripCommand`, so the correction is new events appended to the
// existing stream (invariant 1) — history grows, it is never replaced.
//
// **How a stop finds its activity.** There is no derived activity id to key
// on: `bundleTripCommandGroups` mints every activity id with `randomUUID`, so
// the file and the stream share no identifier below the trip. What they do
// share is structure — the importer writes day N's stops into day N in order,
// and the file's backlog (the trip's own, then the bundle's loose
// `activities`) into the backlog — plus each stop's title. So a stop is
// matched within its own bucket (day N, or the backlog) by title, the k-th
// stop titled T to the k-th activity titled T. Anything that does not pair up
// — a stop renamed in the file, a stop added or removed, an activity somebody
// moved to another day — is REPORTED and left alone: adding, removing or
// retitling stops is not what this repairs, and guessing at a pairing would be
// how a correction lands on the wrong stop.
//
// Lives in `src/server` rather than in the script because it folds the stream
// and compares activity states, and `src/server/**` is the only code that may
// import `@tc/domain` (AGENTS.md, architecture map).
import type { Location, UpdateActivity } from "@tc/contracts";
import { activityStatesEqual, foldEnvelopes, type TripState } from "@tc/domain";
import type { BundleStop, BundleTrip } from "@tc/fixtures";
import { db } from "./db/client";
import { readStream } from "./eventStore";

/** One stop whose location the trip should take from the file, with what it replaces. */
export type PlannedLocationUpdate = {
  /** Where the stop sits, for the run summary: `day 3` or `backlog`. */
  bucket: string;
  title: string;
  from: Location | null;
  to: Location | null;
  command: UpdateActivity;
};

/** What reconciling one existing trip against its bundle would do. */
export type LocationReconcilePlan = {
  /** The trip is soft-deleted: somebody removed it on purpose, so nothing is planned. */
  deleted: boolean;
  updates: PlannedLocationUpdate[];
  /** Stops in the file with no activity to pair with, as `bucket: title`. */
  unmatchedStops: string[];
  /** Activities in the trip with no stop in the file, as `bucket: title`. */
  unmatchedActivities: string[];
};

type Bucket = { label: string; stops: BundleStop[]; activityIds: string[] };

/** The file's stops and the trip's activities, side by side, per day and then the backlog. */
function bucketsFor(state: TripState, trip: BundleTrip, looseStops: BundleStop[]): Bucket[] {
  const dayCount = Math.max(trip.days.length, state.days.length);
  const days = Array.from({ length: dayCount }, (_, i) => ({
    label: `day ${i + 1}`,
    stops: trip.days[i]?.stops ?? [],
    activityIds: state.days[i]?.activityIds ?? [],
  }));
  return [...days, { label: "backlog", stops: [...trip.backlog, ...looseStops], activityIds: state.backlog }];
}

/**
 * Pure half of the plan: pairs the file's stops with `state`'s activities and
 * returns an `UpdateActivity` for each pair whose locations differ. An absent
 * `location` in the file means "no location", so a stop the file stopped
 * locating is cleared rather than silently kept.
 */
export function planLocationReconcileFromState(
  state: TripState,
  trip: BundleTrip,
  looseStops: BundleStop[],
): LocationReconcilePlan {
  const plan: LocationReconcilePlan = { deleted: false, updates: [], unmatchedStops: [], unmatchedActivities: [] };
  if (state.status === "deleted") return { ...plan, deleted: true };

  for (const bucket of bucketsFor(state, trip, looseStops)) {
    // Title → this bucket's activities with that title, in stored order; each
    // stop takes the first one left, so repeated titles pair up in order.
    const byTitle = new Map<string, string[]>();
    for (const activityId of bucket.activityIds) {
      const activity = state.activities[activityId];
      if (activity === undefined) continue;
      byTitle.set(activity.title, [...(byTitle.get(activity.title) ?? []), activityId]);
    }

    for (const stop of bucket.stops) {
      const activityId = byTitle.get(stop.title)?.shift();
      const current = activityId === undefined ? undefined : state.activities[activityId];
      if (activityId === undefined || current === undefined) {
        plan.unmatchedStops.push(`${bucket.label}: ${stop.title}`);
        continue;
      }
      const to = stop.location ?? null;
      // The domain's own field-by-field comparison — the one `UpdateActivity`
      // uses to refuse a no-op — so "differs" here cannot drift from "would be
      // accepted" there, and every Location field the contract grows counts.
      if (activityStatesEqual(current, { ...current, location: to })) continue;
      plan.updates.push({
        bucket: bucket.label,
        title: stop.title,
        from: current.location,
        to,
        command: { type: "UpdateActivity", tripId: state.tripId, activityId, location: to },
      });
    }

    for (const leftover of byTitle.values()) {
      for (const activityId of leftover) {
        plan.unmatchedActivities.push(`${bucket.label}: ${state.activities[activityId]!.title}`);
      }
    }
  }
  return plan;
}

/**
 * Reads `tripId`'s stream and plans the location corrections its bundle asks
 * for. Writes nothing — the caller sends `updates[].command`, or prints them on
 * a dry run. `null` when the trip has no stream at all.
 */
export async function planBundleLocationReconcile(
  tripId: string,
  trip: BundleTrip,
  looseStops: BundleStop[],
): Promise<LocationReconcilePlan | null> {
  const state = foldEnvelopes(await readStream(db, tripId));
  return state === null ? null : planLocationReconcileFromState(state, trip, looseStops);
}
