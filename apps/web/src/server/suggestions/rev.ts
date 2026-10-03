import { and, eq } from "drizzle-orm";
import type { TripRole } from "@tc/contracts";
import { db } from "../db/client";
import { tripSuggestionChanges, tripSuggestions } from "../db/schema";
import { visibleTo } from "./list";
import { revOf } from "./shared";

/**
 * The events poll's `suggestionsRev` (spec W6): a short hash over the (id,
 * status) of the pending changes this reader may see, so the client refetches
 * the list exactly when something it can see changed — a resolution takes a
 * change out of the set, which moves the hash too (W53). Role-scoped by the
 * same rule as the list, and `undefined` for anyone the list would refuse — a
 * viewer, which is also what the events route resolves an invite-token or
 * demo reader to — so the field's mere presence leaks nothing.
 *
 * It takes the reader's effective role rather than looking it up: the events
 * route already holds it from `requireTripAccess`, whose role is `memberRole`
 * over the same `effectiveMembers` `roleOn` reads. The poll runs every 2s;
 * re-reading the trip, its memberships and the owner's entitlements here would
 * triple its cost, so this adds only the changes query.
 */
export async function suggestionsRevForRole(
  tripId: string,
  userId: string,
  role: TripRole | null,
): Promise<string | undefined> {
  const scope = visibleTo(userId, role);
  if (scope === null) return undefined;
  const rows = await db
    .select({ id: tripSuggestionChanges.id, status: tripSuggestionChanges.status })
    .from(tripSuggestionChanges)
    .innerJoin(tripSuggestions, eq(tripSuggestions.id, tripSuggestionChanges.suggestionId))
    .where(and(eq(tripSuggestionChanges.tripId, tripId), scope));
  return revOf(rows);
}
