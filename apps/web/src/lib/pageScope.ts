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
 * seeder wrote, "Yours" for one a person did (SPEC §7's provenance line).
 *
 * **This tells you seeded-vs-authored, not who authored it**, and on a shared
 * trip "Yours" can therefore name a collaborator's notebook. That is a known
 * limit with an entry of its own (KI-2026-09-03-notebook-provenance) rather
 * than a hidden one: saying who wrote a notebook needs a `users` join that
 * `pages` has never had, which is the same shape of gap `displayName.ts`
 * describes for saved days. The seeded half — the half the design uses to
 * explain why two notebooks exist in a trip nobody has written in yet — is
 * exactly right, because `SYSTEM_ACTOR_ID` is a sentinel this app writes and
 * no person can hold.
 */
export function provenanceLabel(page: Pick<PageSummary, "actorId">): string {
  return page.actorId === SYSTEM_ACTOR_ID ? "Comes with your trip" : "Yours";
}
