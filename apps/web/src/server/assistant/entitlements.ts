// **What an account may do, resolved once per request** (ADR-043 decision 5,
// spec §7c). The PORT M20 fills — not the policy, which is M20's alone.
//
// Nothing here chooses a tier, a plan, a ceiling or a price. The default
// resolver below permits everything and names no ceiling, which is exactly
// today's behaviour: there is no account tier anywhere in the product yet.
import type { ModelTier } from "./taskClass";

/**
 * The capabilities the assistant gates on.
 *
 * **`ai.ask` and `ai.command` are the effect axis** (spec §7c): M20's
 * entitlement vocabulary maps onto §2's `effect`, where `ai.ask` is `read` and
 * `ai.command` is `propose`. So the plan gate is a THIRD input to the existing
 * `min(surface, role, plan, classifier)` filter rather than a second
 * mechanism — which is the single strongest reason §2 is (domain, effect) pairs
 * and not three named sets.
 *
 * **M20 link 1 owns the full vocabulary**, in `packages/contracts`, and it has
 * a third member (`trip.collaborators`) the assistant never asks about. This
 * union is deliberately the kernel's SUBSET — the two capabilities that gate a
 * turn — rather than a second copy of an enum that does not exist yet. When
 * link 1 lands, this alias becomes an indexed access into the contracts enum
 * and every `has()` call site is unchanged. A contracts change is its own
 * reviewed PR (AGENTS.md invariant 5), so it is not this one.
 */
export type AiCapability = "ai.ask" | "ai.command";

/**
 * The per-user ceilings a plan version sells.
 *
 * **`null` means the plan names no ceiling**, and `envCeiling`'s existing
 * default stands (quota.ts). That is not a placeholder: M20 splits these
 * deliberately — *"a per-user ceiling is a term that was sold… a global ceiling
 * is a deployment-wide abuse bound that protects the operator's bill and was
 * never sold to anyone"* — and until a plan sells one, there is nothing to
 * read. Spec §7c types these `number`, which would force the default resolver
 * to invent two numbers; inventing ceilings is the one thing ADR-043 says this
 * work must not do. Reported with P5.
 *
 * **Per DAY**, and the names say so. M20 link 5's table is *"AI requests · steps
 * per day"*, and `quota.ts` carries four per-user ceilings (requests and steps
 * × hourly and daily). The hourly pair is the abuse window and stays in the
 * environment; only the daily pair is a sold term. A field called
 * `perUserRequests` silently applied to one of two windows would be a field
 * asserting a semantic its arithmetic does not have, which is the defect class
 * this milestone has already been caught by three times.
 */
export interface EntitlementCeilings {
  perUserRequestsPerDay: number | null;
  perUserStepsPerDay: number | null;
  /**
   * The strongest model slot this account may reach (spec §7e). `null` is no
   * cap — the task class's proposal stands.
   */
  maxTier: ModelTier | null;
}

/**
 * One account's entitlements, as at this request.
 *
 * **`has()` and NO comparison operator at all.** M20's rule, and it is the
 * milestone's most load-bearing one: *"`premium` lists its own entitlements in
 * full; it is never `[...PLUS, 'trip.collaborators']`"* — a plan is a SET, not a
 * rank. So there is no `atLeast`, no ordering, and deliberately nothing shaped
 * like `accessPolicy.ts`'s `RANK`. Copying that rank table here is the obvious
 * move and the wrong one: it bakes the ladder into the data, and the first
 * non-nested plan then cannot be expressed without unpicking every reader.
 *
 * `planVersionRef` is emitted because a purchase **pins** a version, so which
 * per-user ceiling was in force is *not* derivable from a row's `created_at`
 * and two accounts billing on the same day can sit on different versions
 * (spec §7c-note). The kernel emits the field; M20 decides whether to store it.
 */
export interface ResolvedEntitlements {
  has(capability: AiCapability): boolean;
  ceilings: EntitlementCeilings;
  planVersionRef: string | null;
}

/**
 * **Async, per request, and that is a requirement rather than a convenience.**
 * M20: entitlements resolve *"per request from the database, never from the
 * JWT"*, because a downgrade must bite before a token refreshes. So this is a
 * `Promise`, and it is called inside the admission pipeline rather than read
 * off the session.
 *
 * Typed over the actor structurally rather than importing `AiActor`: that type
 * lives in `modelSelection.ts`, which reaches the gateway and is behind the
 * kernel's import wall. The adapter's assignment is what checks the two agree.
 */
export type EntitlementResolver = (actor: {
  userId: string;
}) => Promise<ResolvedEntitlements>;

/** No plan sells a ceiling today, so none of the four is named. */
export const NO_CEILINGS: EntitlementCeilings = {
  perUserRequestsPerDay: null,
  perUserStepsPerDay: null,
  maxTier: null,
};

/**
 * The default: everything permitted, nothing capped, no plan pinned.
 *
 * **Behaviour is unchanged** — this is `EVERYONE_IS_ENTITLED` widened, not a
 * policy. It is the same reasoning that stub carried: there is no account tier
 * anywhere in the product, so every actor is entitled until one exists, and the
 * branch that refuses stays real and exercised by a test while being
 * unreachable in production.
 */
export const PERMITS_EVERYTHING: ResolvedEntitlements = {
  has: () => true,
  ceilings: NO_CEILINGS,
  planVersionRef: null,
};

export const permitEverything: EntitlementResolver = async () => PERMITS_EVERYTHING;
