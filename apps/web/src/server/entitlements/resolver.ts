// **The module's one entry point for reading** (ADR-045 rule 2).
//
// `entitlementsFor(userId)` resolves the account's pinned version out of the
// committed file, unions the active grants out of the table, and returns the
// effective set — **per request, never from the JWT and never in the proxy.**
//
// That is a correctness requirement rather than an implementation detail. A
// plan claim baked into a token lets a downgraded account keep paid access
// until the token refreshes, which is an entitlement bug that reads as a
// billing bug. Sessions are JWT-only (ADR-025) and carry an id and nothing
// else; the Edge proxy has no database (ADR-024) and its matcher covers no
// `/api` path. So this is the only implementation available anyway — stating it
// is what stops a later "optimisation" from reintroducing the defect.
//
// Resolved ONCE per request and passed down. Never re-queried per check.
import type { Entitlement } from "@tc/contracts";
import type {
  EntitlementCeilings,
  EntitlementResolver,
  ResolvedEntitlements,
} from "@/server/assistant/entitlements";
import type { ModelTier } from "@/server/assistant/taskClass";
import { MODEL_TIERS } from "@/server/assistant/taskClass";
import { can, entitlementSet, unionEntitlements, type EntitlementSet } from "./capability";
import { activeGrantsFor, heldPlanFor, type GrantRow, type HeldPlan } from "./grants";
import { livePlanVersion, planVersionFromRef, planVersionRefOf, type PlanVersion } from "./planVersions";

/**
 * What an account holds, as a whole answer.
 *
 * Wider than the assistant kernel's `ResolvedEntitlements`, which asks only
 * about `ai.*`. `toAiEntitlements` below narrows it at that boundary; nothing
 * else needs to.
 */
export interface AccountEntitlements {
  /** The effective set: pinned plan version ∪ every active grant's version. */
  entitlements: EntitlementSet;
  /** The version the ACCOUNT holds — what it bought, not what it was granted. */
  held: PlanVersion;
  /** The most generous ceilings among every source contributing above. */
  ceilings: EntitlementCeilings;
  /** Every active grant, for the console and for the copy that explains a lapse. */
  grants: readonly GrantRow[];
}

/**
 * The plan version an account with no row holds.
 *
 * **A missing row is not an error.** Sessions outlive rows (ADR-025): a
 * database restored from before the account existed, or a row removed by hand,
 * leaves a perfectly valid session pointing at nothing. `readPreferences`
 * already takes this position for the same reason. The answer is the live
 * `free` version — the least an account can hold, which is also exactly what a
 * brand-new row would have said.
 */
function fallbackHeldPlan(): PlanVersion {
  return livePlanVersion("free");
}

/**
 * Resolve a held plan to its published entry, or throw (ADR-045 rule 3).
 *
 * Never a silent fall back to the newest and never an empty set. Both look like
 * a downgrade nobody ordered; the error names the reference.
 */
function versionOf(held: HeldPlan): PlanVersion {
  return planVersionFromRef(`${held.planId}@v${held.planVersion}`);
}

/**
 * The most generous ceiling among the versions an account is drawing on.
 *
 * **The rule exists because entitlements union and ceilings have to agree with
 * that.** A `free` account holding a `plus` trial would otherwise be entitled
 * to `ai.ask` and capped at `free`'s zero requests a day — entitled to
 * something it could never do, which is the least useful shape this could take.
 *
 * `null` means *this version names no ceiling*, and the environment's default
 * stands (`quota.ts`'s `envCeiling`). That is the MOST generous answer a
 * version can give, so a single `null` wins over any number: a version that
 * sells no cap cannot be tightened by one that does. No launch version names
 * `null` for the daily pair, so this branch is dormant today and stated anyway,
 * because the alternative reading — treating `null` as zero — would silently
 * zero an account the day a version stops naming a ceiling.
 */
export function mostGenerousCeilings(
  ceilings: readonly EntitlementCeilings[],
): EntitlementCeilings {
  if (ceilings.length === 0) return { perUserRequestsPerDay: null, perUserStepsPerDay: null, maxTier: null };
  const widest = (pick: (c: EntitlementCeilings) => number | null): number | null => {
    let best = 0;
    for (const ceiling of ceilings) {
      const value = pick(ceiling);
      if (value === null) return null;
      if (value > best) best = value;
    }
    return best;
  };
  return {
    perUserRequestsPerDay: widest((c) => c.perUserRequestsPerDay),
    perUserStepsPerDay: widest((c) => c.perUserStepsPerDay),
    maxTier: widestTier(ceilings.map((c) => c.maxTier)),
  };
}

/**
 * The strongest model slot any contributing version allows.
 *
 * `MODEL_TIERS` is an ordering over MODEL CAPABILITY, not over plans — the
 * distinction ADR-045 rule 4 draws. `null` is no cap, and is therefore the most
 * generous.
 */
function widestTier(tiers: readonly (ModelTier | null)[]): ModelTier | null {
  let best = -1;
  for (const tier of tiers) {
    if (tier === null) return null;
    best = Math.max(best, MODEL_TIERS.indexOf(tier));
  }
  return best < 0 ? null : (MODEL_TIERS[best] ?? null);
}

/**
 * **Effective entitlements = base plan ∪ active grants** (M20's *The shape*).
 *
 * A union with no precedence and no "highest wins". A `premium` referrer who
 * later downgrades to `plus` holds both until the grant expires, and that is
 * the resolver behaving correctly rather than an edge case to special-case.
 *
 * Pure over its inputs — no clock read, no I/O — so the expiry boundaries are
 * unit-testable without a database. `entitlementsFor` below is the one I/O
 * wrapper.
 */
export function resolveEntitlements(
  held: PlanVersion,
  grants: readonly GrantRow[],
): AccountEntitlements {
  // **At the version each grant was granted at**, never the newest version of
  // anything (M20 rule 4). A founder grant issued against `v1` still confers
  // `v1` after `v3` is published — the gate box, stated as one line of code.
  const grantedVersions = grants.map((grant) =>
    planVersionFromRef(`${grant.planId}@v${grant.planVersion}`),
  );
  const sources = [held, ...grantedVersions];
  return {
    entitlements: unionEntitlements(sources.map((version) => version.entitlements)),
    held,
    ceilings: mostGenerousCeilings(sources.map((version) => version.ceilings)),
    grants,
  };
}

/**
 * One account's entitlements, as at this request. The I/O wrapper.
 *
 * Two reads — the `users` row and the account's active grants — and then the
 * pure function above. Grants are few per account and the plan file is in
 * memory, so this is one round trip's worth of work on an authenticated
 * request's path. If that ever stops being cheap the fix is a request-scoped
 * cache, **never a token claim**: ADR-045 rule 2 is about correctness, not cost.
 */
export async function entitlementsFor(
  userId: string,
  now: Date = new Date(),
): Promise<AccountEntitlements> {
  const [held, grants] = await Promise.all([heldPlanFor(userId), activeGrantsFor(userId, now)]);
  return resolveEntitlements(held === null ? fallbackHeldPlan() : versionOf(held), grants);
}

/** Does this account hold this capability, right now. The one-question form. */
export async function accountCan(
  userId: string,
  capability: Entitlement,
  now: Date = new Date(),
): Promise<boolean> {
  return can((await entitlementsFor(userId, now)).entitlements, capability);
}

/**
 * Narrow a whole account answer to the assistant kernel's port.
 *
 * The kernel asks about two capabilities and reads two ceilings; it has no
 * business seeing grant rows. `planVersionRef` is the **held** version — what
 * the account bought — because that is the term a per-user ceiling was sold
 * under and what the cost ledger has to record.
 */
export function toAiEntitlements(account: AccountEntitlements): ResolvedEntitlements {
  return {
    has: (capability) => can(account.entitlements, capability),
    ceilings: account.ceilings,
    planVersionRef: planVersionRefOf(account.held),
  };
}

/**
 * The real resolver behind `AiEntitlementCheck` — what M20 link 4 fills the
 * stub with.
 *
 * `modelSelection.ts`'s comment: *"the day a pro-tier check exists it lands
 * inside `isEntitled` below, not as a signature change."* It did.
 */
export const resolveAiEntitlements: EntitlementResolver = async (actor) =>
  toAiEntitlements(await entitlementsFor(actor.userId));

/** Re-exported so a caller needs one import to ask the only question. */
export { can, entitlementSet };
