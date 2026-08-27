import { z } from "zod";
import { ActivityView } from "./detail";
import { Money } from "./money";

// Pinned read-only shares (M11 link 4, ADR-027).
//
// A share stores the trip's event `seq` at the moment it was created, and the
// read REPLAYS `seq <= n` rather than serving the materialized `trip_details`
// projection. That is the whole feature: click Share, keep planning, and the
// link still shows the trip as it was when you shared it. A snapshot would
// have been a copy, and a copy is not "share this point in history".

/** The owner's view of a share they created — includes the token to re-copy. */
export const TripShare = z.object({
  shareId: z.string().uuid(),
  tripId: z.string().uuid(),
  token: z.string().min(1),
  // The pin. 1-based, matching `events.seq`: a share at seq N replays the
  // first N events. Never mutated — re-pinning is a new share, so a link you
  // handed out cannot change under you.
  seq: z.number().int().min(1),
  createdBy: z.string().min(1),
  createdAt: z.string(),
  revokedAt: z.string().nullable(),
});
export type TripShare = z.infer<typeof TripShare>;

/**
 * What a stranger holding the link is served.
 *
 * Deliberately NOT `TripDetail`. Three things are dropped rather than
 * filtered downstream, because a public read is the one place a field leaks
 * to people the trip's owner never chose:
 *
 * - `members` — actor ids identify real people. `travellerCount` says the one
 *   thing the view actually needs ("4 travellers") without naming anyone.
 * - `conflicts` / `dismissedConflictIds` — planning advice for whoever is
 *   editing. A shared plan is finished as far as its reader is concerned.
 * - `status` — a deleted trip's share is refused outright, so there is no
 *   status a served view could be in other than active.
 */
export const SharedTripView = z.object({
  tripId: z.string().uuid(),
  name: z.string(),
  startDate: z.string().nullable(),
  currency: z.string(),
  budget: Money.nullable(),
  days: z.array(
    z.object({
      dayId: z.string().uuid(),
      activityIds: z.array(z.string().uuid()),
      date: z.string().nullable(),
      costSubtotal: z.number().int(),
    }),
  ),
  backlog: z.array(z.string().uuid()),
  activities: z.record(ActivityView),
  unscheduledCostSubtotal: z.number().int(),
  tripCostTotal: z.number().int(),
  travellerCount: z.number().int().min(1),
  // The pin, surfaced so the page can say what it is showing. `sharedAt` is
  // when the link was created; `seq` is the point in history it is pinned to.
  seq: z.number().int().min(1),
  sharedAt: z.string(),
  // True when the trip has moved on since the link was created — the page
  // says so, because a reader who is also a traveller should know the plan
  // they are looking at is not the current one.
  stale: z.boolean(),
});
export type SharedTripView = z.infer<typeof SharedTripView>;
