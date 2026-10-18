import { withListedMembers } from "@/server/access/members";
import { db } from "@/server/db/client";
import { unreadByTrip } from "@/server/chat/messages";
import { getTripDetails, listTripSummariesVisibleTo } from "@/server/projections";
import { listGuestsByTrip } from "@/server/access/guests";
import { listedSpend } from "@/server/access/overlay";

/**
 * Home's trip list for one reader: every trip `userId` can see, each with its
 * effective members, the reader's unread chat count and the budget line's
 * figures — the body of `GET /api/trips`, and what `(app)/page.tsx` renders on
 * the server, so the two cannot drift.
 *
 * The unread count and the spend figures degrade on their own (zero, `null`)
 * when their reads fail; the visibility read and the member overlay throw.
 *
 * Rows, not `ListedTripSummary`s: a column such as `status` is typed `string`
 * here, so every reader parses the result through the contract — the client's
 * `fetchTrips()` after the route, and the page before it hands the list down.
 */
export async function listedTripsFor(userId: string) {
  // M11 exit gate: "Trips shared with me appear in the Home grid" — SPEC R4
  // deleted the "1 shared with you" label as duplicated information, so they
  // simply appear, in the same grid, indistinguishable except by the avatars.
  // The query decides that, not this handler: it used to load every trip on
  // the instance and narrow them here, which cost the whole instance per
  // request and put the tenant boundary one deleted `.filter()` away from a
  // cross-tenant dump (project review L3, PR 71 review §6).
  const rows = await listTripSummariesVisibleTo(userId);
  // The avatar stack on a card counts travellers and names them, so each
  // summary carries the effective member list rather than the projection's
  // owner-only one, with who is travelling (travellers spec W17) and each
  // person's persona (M38) on it. One batched read of each for all of them —
  // this was an `effectiveMembers` per trip. The stored projection is
  // untouched (invariant 2): this is a read overlay and nothing writes back.
  const tripIds = rows.map((r) => r.tripId);
  const [trips, unread, details, guests] = await Promise.all([
    withListedMembers(db, rows),
    // A badge must not take the trip list down with it: on failure every card
    // reads zero, as `chatRevFor` costs the events poll one poll.
    unreadByTrip(userId, tripIds).catch((error: unknown) => {
      console.error("trips list: unread chat query failed", { error });
      return new Map<string, number>();
    }),
    // Each card's "planned of budget" line, which Home used to fetch as one
    // `GET /api/trips/:id` per card: one read of every stored detail and one
    // of every trip's guests, recosted below the way the single read recosts.
    // A budget line must not take the trip list down either (PR 481 review):
    // if either read fails, every card's `spend` is null, which Home draws as
    // no line. Both, not just the one that failed: a total recosted without
    // its guests would be a wrong figure, not a missing one.
    getTripDetails(tripIds, "omit").catch((error: unknown) => {
      console.error("trips list: trip detail read for spend failed", { error });
      return null;
    }),
    listGuestsByTrip(tripIds).catch((error: unknown) => {
      console.error("trips list: guests read for spend failed", { error });
      return null;
    }),
  ]);
  const spendable = details !== null && guests !== null;
  // Home's own list, so a `ListedTripSummary`: the unread chat count (M46 D5)
  // and the budget line's figures stay off `TripSummary`, which `/v1/trips`
  // serves too.
  return trips.map((t) => ({
    ...t,
    unreadChat: unread.get(t.tripId) ?? 0,
    spend: spendable ? listedSpend(details.get(t.tripId), t.members, guests.get(t.tripId)) : null,
  }));
}
