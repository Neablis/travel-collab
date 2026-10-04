import { and, asc, eq, type SQL } from "drizzle-orm";
import type { TripRole, TripSuggestionsResponse } from "@tc/contracts";
import { roleAtLeast } from "../accessPolicy";
import { db } from "../db/client";
import { tripSuggestionChanges, tripSuggestions } from "../db/schema";
import { openAt, refuse, revOf, roleOn, toChange, type SuggestionResult } from "./shared";

/**
 * Which changes a member may see (spec §4): a suggester their own, an editor
 * or the owner everyone's, a viewer none — null, so the caller answers as if
 * there were no trip. Pending ones only (W53): the list is re-read whenever the
 * revision moves, and a trip's resolved history would grow every read of it
 * for nothing anyone can still decide — nor one past `SUGGESTION_TTL_DAYS`,
 * recorded expired or not yet. Shared by the list and the poll's revision so
 * the two can never disagree about scope.
 *
 * `byAuthor` says whether `where` names `trip_suggestions.author_id`, so the
 * query must join it. Only a suggester's does; the poll skips the join for
 * everyone else (review of #308).
 */
export function visibleTo(
  userId: string,
  role: TripRole | null,
  now: Date,
): { where: SQL; byAuthor: boolean } | null {
  if (role === null || !roleAtLeast(role, "suggester")) return null;
  const open = openAt(now);
  return roleAtLeast(role, "editor")
    ? { where: open, byAuthor: false }
    : { where: and(open, eq(tripSuggestions.authorId, userId))!, byAuthor: true };
}

/**
 * Every pending change this reader may see, oldest first — in the order they
 * were sent, then their order in the draft. `rev` is the value the events poll
 * carries for the same reader (`rev.ts`).
 */
export async function listSuggestionChanges(
  tripId: string,
  userId: string,
  now: string = new Date().toISOString(),
): Promise<SuggestionResult<TripSuggestionsResponse>> {
  const role = await roleOn(tripId, userId);
  if (!role.ok) return role;
  const scope = visibleTo(userId, role.value, new Date(now));
  if (scope === null) return refuse("not-found", "This trip does not exist.");
  const rows = await db
    .select({ change: tripSuggestionChanges, suggestion: tripSuggestions })
    .from(tripSuggestionChanges)
    .innerJoin(tripSuggestions, eq(tripSuggestions.id, tripSuggestionChanges.suggestionId))
    .where(and(eq(tripSuggestionChanges.tripId, tripId), scope.where))
    .orderBy(
      asc(tripSuggestionChanges.createdAt),
      asc(tripSuggestionChanges.suggestionId),
      asc(tripSuggestionChanges.position),
    );
  const changes = rows.flatMap((r) => toChange(r.change, r.suggestion) ?? []);
  return { ok: true, value: { changes, rev: revOf(rows.map((r) => r.change)) } };
}
