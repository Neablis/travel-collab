import { TripSummary } from "@tc/contracts";
import { db } from "@/server/db/client";
import { grantedMembersByTrip, mergeMembers } from "@/server/access/members";
import { listTripSummariesPage } from "@/server/projections";
import { route } from "@/server/public-api/route";

// **Pilot endpoint 1 of 2** (M22 Phase 2) — a collection, so it is the one that
// exercises pagination, and the whole of its pagination cost is the `cursorOf`
// line below.
//
// Everything this file does NOT contain is the point: no `auth()`, no bearer
// parsing, no scope check, no 401 shape, no `WWW-Authenticate`, no rate limit,
// no `last_used_at`, no error envelope, no `?limit=` bounds, no cursor
// round-trip, no response validation. All of that is `route()`, once, for every
// endpoint that will ever exist.
export const { GET } = route({
  GET: {
    scope: "trips:read",
    collection: {
      item: TripSummary,
      // Keyset, matching `listTripSummariesPage`'s ORDER BY. `tripId` is in the
      // key because `createdAt` alone ties, and a tied order is a pager that
      // silently loses rows.
      cursorOf: (trip: TripSummary) => `${trip.createdAt}|${trip.tripId}`,
    },
    handle: async ({ actor, page }) => {
      const rows = await listTripSummariesPage(actor.userId, page);
      // **The member overlay is kept, deviating from the design.** The design
      // called for *"a reshaped `GET /v1/trips`"* on the grounds that today's
      // version overlays members *"purely so the Home avatar stack renders"* —
      // true about its motive, and not a reason to publish a members list that
      // omits real members. This query already returns trips someone reaches
      // through a `trip_memberships` row; answering those with an owner-only
      // `members` array would be a wrong answer rather than a lean one. It costs
      // one batched read for the whole page, not one per trip.
      const granted = await grantedMembersByTrip(db, rows.map((r) => r.tripId));
      return rows.map((r) => ({
        ...r,
        members: mergeMembers(r.members, granted.get(r.tripId) ?? []),
      }));
    },
  },
});
