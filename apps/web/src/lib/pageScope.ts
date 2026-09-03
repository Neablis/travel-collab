import { SYSTEM_ACTOR_ID, type PageContext, type PageSummary } from "@tc/contracts";

/**
 * How a notebook's binding reads: "Trip-wide" or "Day 6" (SPEC §7 — "every page
 * has a scope").
 *
 * Extracted out of `NotebookScreen`'s private `describeBinding` because the
 * Notebooks menu (SPEC §11) lists the same notebooks with the same binding, and
 * two copies of this would drift the moment the `dayId` branch below gets a
 * real answer.
 *
 * The `dayId` branch says "One day" rather than resolving an ordinal, and that
 * is a limit rather than a choice: mapping a `dayId` to its position needs the
 * trip's day list, and neither surface that calls this loads `TripDetail`.
 * Nothing produces that form yet either — `contracts/pages.ts` describes it as
 * reserved for a later "pin to a specific day" affordance — so the string is
 * reached only by data this app cannot currently write. When something does
 * write it, this takes a `TripDetail` and both callers already have a fetch to
 * hang it on. It previously read "Day binding", which named the mechanism
 * instead of the day.
 */
export function scopeLabel(context: PageContext): string {
  if (context.dayRef === undefined) return "Trip-wide";
  if (context.dayRef.kind === "index") return `Day ${context.dayRef.index + 1}`;
  return "One day";
}

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
