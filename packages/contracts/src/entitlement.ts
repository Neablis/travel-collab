import { z } from "zod";

/**
 * The Entitlements module's cross-boundary vocabulary (AGENTS.md module map,
 * ADR-045).
 *
 * **This file owns the words and nothing else.** ADR-045 rule 6 splits the
 * module in two: `packages/contracts` owns the entitlement strings, because a
 * capability no code checks is meaningless and a check for a capability that
 * does not exist must fail to compile. Which entitlements and which numbers a
 * *plan version* bundles is the committed plan file's
 * (`apps/web/src/server/entitlements/planVersions.ts`), not this one's.
 *
 * **Entitlements does not know what a trip is** (ADR-045 rule 5). `TripRole`
 * lives in `trip.ts` and this file never imports it. `trip.collaborators` is an
 * opaque token here: the *caller* — Access & Membership — knows it is about
 * invites. That boundary is what keeps M20 link 6 from being a module
 * violation, and it is the one this module is most likely to be tempted to
 * break.
 *
 * Nothing here is event-sourced. ADR-003 scopes the log to planning; holding a
 * plan is not trip state.
 */

/**
 * What an account may do. A capability, never a tier.
 *
 * Three members, and the vocabulary is deliberately small: every string here is
 * checked by real code (M20 links 4 and 6), and a fourth would be a word with
 * no reader. Adding one is a contracts change with a changelog entry, which is
 * the protocol invariant 5 requires.
 *
 * **`ai.ask` and `ai.command` are the effect axis** the assistant kernel
 * already gates on — spec §7c maps `ai.ask` onto `read` and `ai.command` onto
 * `propose`, so the plan gate is a third input to the kernel's existing
 * `min(surface, role, plan, classifier)` filter rather than a second mechanism.
 * `AiCapability` in `apps/web/src/server/assistant/entitlements.ts` is an
 * indexed access into this enum, which is what makes the kernel's subset
 * provably a subset rather than a second copy.
 *
 * **Trip planning is absent on purpose and that absence is load-bearing.**
 * Trips, days, stops, lenses, costs, saved days and publishing to Discover are
 * entitled to every account including `free` (M20 link 1, Mitchell
 * 2026-09-01). There is no `trip.plan` string because nothing may ever gate on
 * one — a capability that exists is a capability someone will eventually check.
 */
export const Entitlement = z.enum(["ai.ask", "ai.command", "trip.collaborators"]);
export type Entitlement = z.infer<typeof Entitlement>;

/** Every entitlement, for exhaustiveness at a call site that must handle all of them. */
export const ENTITLEMENTS: readonly Entitlement[] = Entitlement.options;

/**
 * A plan's stable identity, and *only* its identity.
 *
 * **This is not a rank and there is deliberately no ordering export beside it**
 * (ADR-045 rule 4). `accessPolicy.ts:11`'s `RANK = { viewer: 0, editor: 1,
 * owner: 2 }` is the right shape for roles inside one trip and the wrong shape
 * here: Mitchell's requirement is that tiers are *"not necessarily subsets —
 * each have their own access and functionality."* A comparison operator
 * anywhere near a plan forces every later tier to be a superset of an earlier
 * one, permanently and quietly. `z.enum` preserves declaration order in
 * `.options`, so this constant's own ordering is an artifact of how it is
 * written and **is not authority** — the display order a pricing page reads is
 * a field on a plan version, and no authorisation path may read even that.
 *
 * What a plan *contains* is a plan-version entry, not a constant here. This
 * enum answers "is `premium` a plan we sell" and nothing further.
 *
 * **`studio` is the fourth-plan proof** (M20's gate box), and it is here rather
 * than in a comment because the box asks for a plan that can be **added**, not
 * one that could be. It grants `trip.collaborators` WITHOUT `ai.command`, so it
 * is a subset of nothing: no rank can express it, and every reader that asked
 * `plan >= "plus"` would have to be unpicked to add it.
 *
 * It ships **disabled** — `enabled: false` on its version entry — so nothing
 * sells it and nobody holds it. That is the point: adding it cost one member
 * here and one entry in the plan file, and **no change to any gate, resolver or
 * authorisation path**. `planVersions.fourthPlan.test.ts` is what proves that
 * claim rather than asserting it.
 */
export const PlanId = z.enum(["free", "plus", "premium", "studio"]);
export type PlanId = z.infer<typeof PlanId>;

/** Every plan id we sell today. Order is declaration order and means nothing. */
export const PLAN_IDS: readonly PlanId[] = PlanId.options;

/**
 * Which published entry a holding pins, as stored and as passed across a
 * boundary: `"<planId>@v<n>"`, e.g. `"premium@v1"`.
 *
 * **A reference, not a description.** A grant, a `users` row and (at M21) a
 * subscription row each carry one of these, and ADR-045 rule 3 requires it to
 * resolve against the committed plan file or fail loudly — never a silent fall
 * back to the newest version and never an empty entitlement set. It is a
 * string rather than a `{ planId, version }` pair because it is stored in one
 * column and compared for equality far more often than it is taken apart.
 *
 * Validated here so a malformed reference cannot be written; *resolved* in the
 * Entitlements module, which is the only place that knows which entries exist.
 * This package validates and never transforms, by convention.
 */
export const PlanVersionRef = z
  .string()
  .regex(
    // Built from `PlanId.options` rather than spelled out, so adding a plan id
    // is one edit and not two. A second hand-written list of the same three
    // strings is exactly the drift invariant 5 exists to stop.
    new RegExp(`^(${PlanId.options.join("|")})@v[1-9][0-9]*$`),
    'Use "<planId>@v<n>", like "premium@v1" — v0 and leading zeros are not versions.',
  );
export type PlanVersionRef = z.infer<typeof PlanVersionRef>;

/**
 * Where an entitlement grant came from. One time-bounded grant with four
 * values, not four features — the collapse M20's *The shape* rests on.
 *
 * - `trial` — issued once ever per account when its `users` row is created.
 * - `referral` — minted when someone redeems a code this account issued.
 * - `admin` — the hand-grant path: comps, trial extensions, billing disputes.
 * - `founder` — every account that existed when M20's migration ran.
 */
export const GrantSource = z.enum(["trial", "referral", "admin", "founder"]);
export type GrantSource = z.infer<typeof GrantSource>;

/**
 * What an operator hands out (M20 link 7).
 *
 * **No version field**, and that is deliberate: a grant pins the version that
 * is live when it is issued, resolved server-side. An operator typing a version
 * number is an operator who can type one that does not exist, and the failure
 * would be a silent entitlement hole rather than a 400.
 *
 * **No price field either.** M20 never learns what a plan costs.
 */
export const AdminGrantInput = z.object({
  userId: z.string().min(1),
  planId: PlanId,
  /**
   * ISO timestamp, or `null` for permanent.
   *
   * Nullable rather than optional: "forever" is a decision an operator makes,
   * and an omitted field would let one be made by accident. The design says
   * *"grant a plan at a version with an expiry and a reason"* — all three are
   * present in the request, and one of them may be `null` on purpose.
   */
  expiresAt: z.string().datetime().nullable(),
  /**
   * Why, in the operator's words. A comp nobody can explain six months later
   * is a billing dispute with no evidence, so it is required and non-empty.
   */
  reason: z
    .string()
    .max(500)
    // `.min(1)` accepted `"   "`, which is a grant with no audit evidence
    // wearing the shape of one — and this package validates without
    // transforming, so the value is checked trimmed and STORED as typed.
    // Caught by CodeRabbit on PR #174.
    .refine((reason) => reason.trim().length > 0, "Give a reason — a blank one is not an audit trail."),
});
export type AdminGrantInput = z.infer<typeof AdminGrantInput>;
