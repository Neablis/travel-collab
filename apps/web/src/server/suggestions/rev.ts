import { and, eq } from "drizzle-orm";
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
  const scope = visibleTo(viewerUserId, await roleOn(tripId, viewerUserId));
  if (scope === null) return undefined;
  const rows = await db
    .select({ id: tripSuggestionChanges.id, status: tripSuggestionChanges.status })
    .from(tripSuggestionChanges)
    .innerJoin(tripSuggestions, eq(tripSuggestions.id, tripSuggestionChanges.suggestionId))
    .where(and(eq(tripSuggestionChanges.tripId, tripId), scope));
  return revOf(rows);
}
