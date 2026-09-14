// **The only question this module answers** (ADR-045 rule 4).
//
// `can(ent, "ai.ask")`. Never `plan >= "paid"`, never `PLAN_RANK[a] > PLAN_RANK[b]`,
// never a read of a display order. There is no `atLeast`, no ordering and
// deliberately nothing shaped like `accessPolicy.ts`'s `RANK` — that table is
// the right shape for roles inside one trip, where `owner` genuinely contains
// `editor`, and the wrong shape here, where Mitchell's requirement is that
// tiers are *"not necessarily subsets — each have their own access and
// functionality."*
//
// **And this module does not know what a trip is** (ADR-045 rule 5). It answers
// `can(account, "trip.collaborators")`; the *caller* — Access & Membership —
// knows that capability is about invites. No trip type is imported here or
// anywhere under `server/entitlements/`, and a test enforces it.
import type { Entitlement } from "@tc/contracts";

/**
 * What one account may do, as a set.
 *
 * A `Set` rather than an array because every reader asks membership and none
 * asks order — and because an array invites `indexOf`, which is one keystroke
 * from a comparison.
 */
export type EntitlementSet = ReadonlySet<Entitlement>;

/**
 * May this account do this.
 *
 * Trivial by construction, and that triviality is the design: the interesting
 * work is deciding what goes INTO the set (the resolver's union of a pinned
 * plan version and active grants), never how it is read. A one-line predicate
 * with a name is what gives every call site the same shape, so a sweep for
 * "every place a plan gates something" is a grep for one identifier.
 */
export function can(ent: EntitlementSet, capability: Entitlement): boolean {
  return ent.has(capability);
}

/** Build a set from a version's or a grant's enumerated list. */
export function entitlementSet(entitlements: Iterable<Entitlement>): EntitlementSet {
  return new Set(entitlements);
}

/**
 * The union of several enumerated lists — a pinned plan version plus every
 * active grant (M20's *Effective entitlements = base plan ∪ active grants*).
 *
 * A union, with no precedence and no "highest wins": a `premium` referrer who
 * downgrades to `plus` holds both until the grant expires, and that is the
 * resolver behaving correctly rather than an edge case to special-case.
 */
export function unionEntitlements(
  lists: Iterable<Iterable<Entitlement>>,
): EntitlementSet {
  const out = new Set<Entitlement>();
  for (const list of lists) for (const entitlement of list) out.add(entitlement);
  return out;
}
