import type { PersonColor } from "@tc/contracts";
import { resolveTripColors } from "@tc/domain";

/**
 * One trip's members with the colour to render each in ON THAT TRIP (M38 D3):
 * `resolveTripColors` over the list as given, which must be join order, owner
 * first — the order `mergeMembers` produces. `color` goes in as the stored
 * choice and comes out resolved, never null; `colorShifted` says the choice
 * lost a clash to someone earlier on the trip.
 *
 * On the server, not in the UI: invariant 6 keeps the domain out of components,
 * and the invite preview drops the ids a client would resolve by. The stored
 * choice is read, never written — a trip changes how it shows a person, not
 * what they chose.
 *
 * Pure, and its own module for `overlay.ts`'s reason: `demoTrip.ts` resolves
 * its roster too, and must never import `db/client`, which `members.ts` does.
 */
export function withTripColors<M extends { userId: string; color: PersonColor | null }>(
  members: readonly M[],
): (M & { color: PersonColor; colorShifted: boolean })[] {
  const resolved = resolveTripColors(members);
  return members.map((m) => {
    const color = resolved.get(m.userId)!;
    return { ...m, color, colorShifted: m.color !== null && m.color !== color };
  });
}
