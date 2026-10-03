import { and, eq } from "drizzle-orm";
import type { TripRole } from "@tc/contracts";
import { db } from "../db/client";
import { tripSuggestionChanges, tripSuggestions } from "../db/schema";
import { visibleTo } from "./list";
import { revOf, roleOn } from "./shared";

/**
 * The events poll's `suggestionsRev` (spec W6): a short hash over the (id,
 * status) of the changes this reader may see, so the client refetches the list
 * exactly when something it can see changed. Role-scoped by the same rule as
 * the list, and `undefined` for anyone the list would refuse — a viewer, a
 * non-member, an anonymous or invite-token reader (`null`) — so the field's
 * mere presence leaks nothing.
 */
export async function suggestionsRevFor(tripId: string, viewerUserId: string | null): Promise<string | undefined> {
  if (viewerUserId === null) return undefined;
  return suggestionsRevForRole(tripId, viewerUserId, await roleOn(tripId, viewerUserId));
}

/**
 * The same revision for a caller that already holds the reader's effective
 * role — the events route, from `requireTripAccess`, whose role is `memberRole`
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
