import { SYSTEM_ACTOR_ID, type PageSummary } from "@tc/contracts";

/**
 * Where a notebook came from: "Comes with your trip" for one the lazy template
 * seeder wrote, "Yours" for one the READER wrote, and "From another traveler"
 * for one somebody else on the trip wrote (SPEC §7's provenance line).
 *
 * **The third case is why `viewerId` is a parameter.** An earlier version chose
 * between the design's two strings on `actorId === SYSTEM_ACTOR_ID` alone,
 * which proves only that a *person* wrote the notebook — so on a shared trip
 * every collaborator's notebook read "Yours". That shipped as a known issue on
 * the assumption that naming the author needed a `users` join `pages` has never
 * had. It does not: the list route already resolves the reader from its own
 * guard, so the truthful answer costs nothing (Copilot, PR #126). Note the
 * distinction survives without ever naming the other person, which is the part
 * that would need the join.
 *
 * `viewerId` is `null` when the reader is not known — an older response, or a
 * caller that has not got one. The wording then stays author-neutral instead of
 * guessing, because "Yours" on somebody else's notebook is the exact error this
 * parameter exists to stop.
 */
export function provenanceLabel(page: Pick<PageSummary, "actorId">, viewerId: string | null): string {
  if (page.actorId === SYSTEM_ACTOR_ID) return "Comes with your trip";
  if (viewerId !== null && page.actorId === viewerId) return "Yours";
  return "From another traveler";
}
