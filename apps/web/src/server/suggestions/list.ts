import { and, asc, eq, type SQL } from "drizzle-orm";
import type { TripRole, TripSuggestionsResponse } from "@tc/contracts";
import { roleAtLeast } from "../accessPolicy";
import { db } from "../db/client";
import { tripSuggestionChanges, tripSuggestions } from "../db/schema";
import { refuse, revOf, roleOn, toChange, type SuggestionResult } from "./shared";

/**
 * Which changes a member may see (spec §4): a suggester their own, an editor
 * or the owner everyone's, a viewer none — null, so the caller answers as if
 * there were no trip. Shared by the list and the poll's revision so the two can
 * never disagree about scope.
 */
export function visibleTo(userId: string, role: TripRole | null): SQL | undefined | null {
  if (role === null || !roleAtLeast(role, "suggester")) return null;
  return roleAtLeast(role, "editor") ? undefined : eq(tripSuggestions.authorId, userId);
}

/**
 * Every change this reader may see, every status, oldest first — in the order
 * they were sent, then their order in the draft. `rev` is the value the events
 * poll carries for the same reader (`rev.ts`).
 */
export async function listSuggestionChanges(
  tripId: string,
  userId: string,
): Promise<SuggestionResult<TripSuggestionsResponse>> {
  const scope = visibleTo(userId, await roleOn(tripId, userId));
  if (scope === null) return refuse("not-found", "This trip does not exist.");
  const rows = await db
    .select({ change: tripSuggestionChanges, suggestion: tripSuggestions })
    .from(tripSuggestionChanges)
    .innerJoin(tripSuggestions, eq(tripSuggestions.id, tripSuggestionChanges.suggestionId))
    .where(and(eq(tripSuggestionChanges.tripId, tripId), scope))
    .orderBy(
      asc(tripSuggestionChanges.createdAt),
      asc(tripSuggestionChanges.suggestionId),
      asc(tripSuggestionChanges.position),
    );
  const changes = rows.map((r) => toChange(r.change, r.suggestion));
  return { ok: true, value: { changes, rev: revOf(changes) } };
}
