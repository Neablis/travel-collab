// **What a plan is** — the Entitlements module's first store (ADR-045 rule 1).
//
// A committed file, not a table. Mitchell, 2026-09-02: *"Lets keep entitlements
// being a static file thats commited to change with versioning, but the admin
// ui just shows whats currently live."* The audit trail is git, and mutating a
// published entry shows up in a diff — a stronger immutability guarantee than a
// table with a convention, because review is guaranteed to see it.
//
// **Immutable and append-only.** Changing an entitlement or a ceiling PUBLISHES
// A NEW VERSION; it never edits a published one. "What did `premium` grant on
// 2026-10-01" therefore stays answerable forever, and a change cannot
// retroactively rewrite what anyone was sold. Nothing in the codebase has a
// write path to this file: the only way an entry changes is a pull request, and
// `planVersions.immutability.test.ts` fails if a published entry's shape is
// mutated at runtime or if any code path can update one.
//
// **Prices arrived with M21 link 2, on these same entries**, as this file's
// M20 header said they would. Three things about that, because the first one
// looks like a breach of the paragraph above and is not:
//
//   1. **Naming a price for the first time is not editing one.** The rule the
//      gate box states is *"no published plan version's price is ever edited"*,
//      and its reason is that a change must not retroactively rewrite what
//      anyone was sold. Nothing had been sold: M21 is the milestone that
//      creates the first subscription, and until it shipped there was no
//      `price` field to hold a different value. From here the rule binds
//      absolutely, and it binds mechanically: `planVersions.noExtension.test.ts`
//      pins every published v1 entry field by field, price included, so
//      changing $9 to $10 in place fails a test in the same diff that does it.
//      The way to change $9 to $10 is to publish `plus@v2`.
//   2. **A price change is a NEW VERSION and affects new purchases only.** A
//      subscription pins `planId@vN` (M21 link 1) and reads its terms from that
//      entry forever. There is no mechanism to move an existing subscriber, and
//      there deliberately is not one — M21 link 2's *what you bought is what
//      you get*.
//   3. **`price: null` means this version is not sold for money**, which is a
//      different fact from `$0`. `studio` carries `null` because it ships
//      disabled and nothing sells it; `free` carries a real zero, because `free`
//      is a plan someone genuinely holds at no charge. Collapsing the two would
//      make "not for sale" and "free" the same shape at every call site.
//
// **No plan is defined in terms of another** (ADR-045 rule 4, and M20's single
// most load-bearing rule). `premium` enumerates its own entitlements in full;
// it is never `[...PLUS, "trip.collaborators"]`. The three launch plans happen
// to nest and **nothing in code may know that** — a spread, an `extends`, a
// base-plan constant or a rank comparison each bakes the ladder into the data,
// and the first non-nested plan then cannot be expressed without unpicking
// every one of them. `planVersions.noExtension.test.ts` walks this file's AST
// and fails on any of them.
import { Entitlement, PlanId, PlanVersionRef } from "@tc/contracts";
import type { EntitlementCeilings } from "@/server/assistant/entitlements";

/**
 * **What this version costs**, or `null` when it is not sold for money at all
 * (M21 link 2).
 *
 * The three fields M21 link 2 names — `price_minor`, `currency` and
 * `stripe_price_id` — as one record rather than three siblings, because the
 * invariant between them is *all or none*: a currency with no amount, or an
 * amount with no currency, is a state no caller can act on. A nullable record
 * makes that unrepresentable; three nullable fields make it a test.
 */
export interface PlanPrice {
  /**
   * Integer minor units of `currency` — 900 is $9.00.
   *
   * **Deliberately not `Money`** (ADR-008), which is the repo's shape for a
   * cost inside a trip. Borrowing it here would put a plan's price on the same
   * type as a hotel booking and invite the arithmetic that goes with it; a plan
   * price is never added to anything, never converted, and crosses no boundary
   * `Money` is validated at. The distance is the point — the same reasoning
   * `PlanSection`'s `Meter` gives for not being `BudgetMeter`.
   */
  minor: number;
  /**
   * One currency, lowercase, as Stripe spells it.
   *
   * Lowercase because every value that reaches Stripe is lowercase and a
   * round trip through an uppercase ISO-4217 code is a conversion that can be
   * forgotten in one direction. Multi-currency is in M21's *Deliberately not
   * here*; a second member of this union is the change that opens it.
   */
  currency: "usd";
  /**
   * The Stripe Price this version is sold as, once one exists.
   *
   * **`null` is the ordinary state of a newly published price, not an
   * omission.** M21 link 2 asks for a committed `stripe_price_id` and names
   * the hazard in the same breath: *"a committed `stripe_price_id` that names
   * a Price nobody created is a checkout that fails at the till"*, because
   * creating the Price is a runtime act against an external service and there
   * is no publish step left to hang it off. An id cannot honestly be committed
   * before the Price exists.
   *
   * So the committed pairing is the **lookup key** (`priceLookupKey` below),
   * which is a pure function of the two fields above and therefore cannot
   * drift from them. `server/billing/prices.ts` resolves a key to a Price
   * idempotently — find by key, create if absent, and refuse if the Price it
   * finds disagrees about amount or currency. Filling this field in afterwards
   * is an optimisation (one fewer API call) and a second reviewable record of
   * the pairing; leaving it `null` is correct and is what every entry below
   * does today.
   */
  stripePriceId: string | null;
}

/**
 * One published version of one plan.
 *
 * The same fields the `plan_versions` row would have carried before the
 * 2026-09-02 amendment removed the table. `publishedBy` is git authorship and
 * is deliberately not a field.
 */
export interface PlanVersion {
  planId: PlanId;
  /** Monotonic per plan, starting at 1. `planId` + `version` is the identity. */
  version: number;
  /**
   * Exactly what this version grants, enumerated. Typed against the contracts
   * enum, so an entitlement string outside the vocabulary **fails to compile**
   * rather than being caught at publish time — strictly earlier, and strictly
   * harder to bypass (M20's gate box; ADR-045 rule 6).
   */
  entitlements: readonly Entitlement[];
  /**
   * The per-user ceilings this version SELLS. `null` means this version names
   * no ceiling and the environment's default stands (`quota.ts`'s `envCeiling`).
   *
   * Per-user only. A global ceiling is a deployment-wide abuse bound that
   * protects the operator's bill and was never sold to anyone, so it stays in
   * the environment and republishing a plan does not move it.
   */
  ceilings: EntitlementCeilings;
  /**
   * **What this version costs** (M21 link 2), or `null` when it is not sold.
   *
   * No authorisation path may read this either — for the same reason
   * `displayOrder` below carries that rule, and more sharply. `$19 > $9` is
   * the most natural-looking rank in this whole file and it is exactly the one
   * M21's *Prerequisites* forbids: *"nothing in code may treat $19 > $9 as
   * meaning `premium` ⊇ `plus`"*. `premium` is a little over twice `plus`
   * because it sells a different thing, not more of the same thing. A plan is
   * a set, and this is a number on a price list.
   */
  price: PlanPrice | null;
  /**
   * Where this plan sits on a pricing page. **Presentation only.**
   *
   * No authorisation path may read this — not `can()`, not the resolver, not a
   * gate. The ladder a buyer sees is copy ("Everything in Plus"); the data does
   * not nest and no screen may read this number as authority.
   * `planVersions.noExtension.test.ts` sweeps for a read of it outside
   * rendering.
   */
  displayOrder: number;
  /** ISO date this version was committed. Never edited once published. */
  publishedAt: string;
  /**
   * Whether this plan may be sold or granted today.
   *
   * A plan can exist, be typed, be resolvable and still be off — which is what
   * lets a non-nested fourth plan ship as proof that the split architecture is
   * real without offering it to anyone. The gates never read this: it bounds
   * what an operator may hand out, not what a holder may do.
   */
  enabled: boolean;
}

/**
 * Every version ever published, oldest first, append-only.
 *
 * **Read the comment above before editing.** Adding an entry is publishing.
 * Changing one is rewriting history and the tests will say so.
 */
export const PLAN_VERSIONS: readonly PlanVersion[] = [
  {
    planId: "free",
    version: 1,
    // `free` entitles trip planning IN FULL — trips, days, activities, map,
    // timeline, calendar, cost, saved days and publishing to Discover
    // (Mitchell, 2026-09-01). None of that is an entitlement string, and that
    // absence is the point: nothing gates it, so nothing needs to name it. What
    // `free` does not get is every `ai.*` capability and `trip.collaborators`.
    entitlements: [],
    // Explicitly zero rather than `null`. `free` holds no `ai.ask`, so the
    // ceiling is never reached — but a version that named no ceiling would fall
    // through to the environment's 100/day, and a later refactor that moved the
    // capability check would silently hand a free account the default budget.
    ceilings: { perUserRequestsPerDay: 0, perUserStepsPerDay: 0, maxTier: null },
    // **A real zero, and no Stripe Price.** `free` is a plan someone holds at
    // no charge, which is a different fact from `studio`'s `price: null` —
    // not sold at all. There is no Stripe Price because moving TO `free` is a
    // cancellation, never a purchase: M21 link 5's *cancelling sets
    // `cancel_at_period_end`*, and a checkout for $0 would be a second
    // downgrade path wearing a payment.
    price: { minor: 0, currency: "usd", stripePriceId: null },
    displayOrder: 1,
    publishedAt: "2026-09-13",
    enabled: true,
  },
  {
    planId: "plus",
    version: 1,
    entitlements: ["ai.ask", "ai.command"],
    // 50 requests · 400 steps a day. Half of today's environment defaults
    // (100 · 800), which M20 link 5 measured as already affordable: at the one
    // live record's ~$0.0045 for an eight-step request, a maxed-out `plus`
    // account is on the order of $7 a month. The ceilings are an abuse bound,
    // not a margin defence — what the split buys is the two tiers feeling
    // different, which is what link 5 actually owed.
    //
    // `maxTier: null` — no plan sells a model cap. Capping `plus` at `mid`
    // would be inventing a ceiling nobody decided, which is the one thing
    // ADR-043 says this work must not do.
    ceilings: { perUserRequestsPerDay: 50, perUserStepsPerDay: 400, maxTier: null },
    // **$9 a month** (Mitchell, 2026-09-13). A positioning call, not a margin
    // one: M20 link 5 measured a ceiling-consuming account at ~$2-$14 a month
    // against the models actually configured, so $9 covers a typical account
    // comfortably and a genuinely heavy one thinly. **That thin case is the
    // point of link 7's underwater list**, which is built to find it rather
    // than to be reassured by it.
    //
    // It is priced where the trial lands: M20 grants the trial `plus`, so the
    // week someone samples is the plan they are then asked to buy. Pricing
    // above what the trial demonstrates would make the trial an advert for a
    // different product.
    price: { minor: 900, currency: "usd", stripePriceId: null },
    displayOrder: 2,
    publishedAt: "2026-09-13",
    enabled: true,
  },
  {
    planId: "premium",
    version: 1,
    // Enumerated in full, deliberately repeating `plus`'s two strings. This is
    // the rule, not an oversight: see the header. The day a plan grants
    // `trip.collaborators` WITHOUT `ai.command`, this list is what makes that
    // expressible.
    entitlements: ["ai.ask", "ai.command", "trip.collaborators"],
    // 200 requests · 1600 steps a day — twice today's environment defaults.
    // ~$27 a month at the ceiling on the measured rate.
    ceilings: { perUserRequestsPerDay: 200, perUserStepsPerDay: 1600, maxTier: null },
    // **$19 a month** (Mitchell, 2026-09-13). A little over twice `plus`
    // because it sells a DIFFERENT thing — collaborators, not more assistant.
    // The ladder a buyer reads is presentation; see the `price` field's own
    // comment for the rule this number is most likely to break.
    price: { minor: 1900, currency: "usd", stripePriceId: null },
    displayOrder: 3,
    publishedAt: "2026-09-13",
    enabled: true,
  },
  {
    // **`premium@v2` — the API tokens version** (M22 Phase 1, 2026-09-16).
    //
    // **Published rather than editing `v1` in place, and that was a decision
    // rather than a habit.** Mitchell's first answer was *"just assign it to
    // v1, its unused atm"*, and its premise is correct — `premium@v1` has never
    // been purchased, so nobody is stranded under either option. But between two
    // options that strand nobody, the one that edits a published entry is the
    // more expensive: it falsifies a ticked M20 gate box (*"`v1`'s entry is
    // byte-identical afterwards"*) and requires rewriting
    // `noExtension.test.ts`'s `V1_AS_PUBLISHED`, which exists to fail in the
    // same diff that edits a published entry. Shown that, he closed it:
    // **"Just do v2 then."**
    //
    // **Publishing costs nothing anywhere else.** `livePlanVersion` returns the
    // newest entry for a plan and consults no flag, so this entry becomes what
    // every new purchase and every new admin grant pins, automatically, with no
    // other edit in the codebase. `v1` is simply never selected again.
    //
    // **Enumerated in full, never as a spread of `v1`.** Four strings, repeating
    // three, because that is the rule the header states and the one
    // `noExtension.test.ts` walks the AST to enforce.
    planId: "premium",
    version: 2,
    entitlements: ["ai.ask", "ai.command", "trip.collaborators", "api.tokens"],
    // **Unchanged from `v1`.** This version sells one more capability at the
    // same price; the ceilings are the assistant's and the API does not spend
    // model budget, so nothing here moves. A token's cost bound is
    // `consumeQuota`'s, which is environment-configured and not a plan ceiling.
    ceilings: { perUserRequestsPerDay: 200, perUserStepsPerDay: 1600, maxTier: null },
    // **The same $19, and a NEW Stripe Price all the same.** `priceLookupKey` is
    // derived from the version ref, so `premium@v2` resolves to its own Price,
    // created on its first checkout. That is the design working rather than a
    // duplication: Stripe Prices are immutable, and a version pinning a Price
    // created for a different version is how the catalogue and the card
    // statement start to disagree.
    price: { minor: 1900, currency: "usd", stripePriceId: null },
    displayOrder: 3,
    publishedAt: "2026-09-16",
    enabled: true,
  },
  {
    // **The fourth-plan proof** (M20's gate box). A plan that is not a subset
    // of any other: `trip.collaborators` WITHOUT `ai.command`. No rank can
    // express it — it is above `premium` on one axis and below `plus` on
    // another — and that is exactly why it exists.
    //
    // **It ships disabled.** Nothing sells it and nobody holds it. Adding it
    // cost one member of the contracts enum and this entry, and no change to
    // any gate, resolver or authorisation path. `planVersions.fourthPlan.test.ts`
    // proves that rather than asserting it.
    //
    // Do not delete it because nothing ships it. The claim *"the split
    // architecture is real rather than asserted"* is only worth something while
    // something unprovable-by-a-ladder is actually expressed.
    planId: "studio",
    version: 1,
    entitlements: ["ai.ask", "trip.collaborators"],
    ceilings: { perUserRequestsPerDay: 50, perUserStepsPerDay: 400, maxTier: null },
    // **`null`, not `0`.** Nothing sells this plan, so it has no price rather
    // than a price of nothing — and `priceOf` refusing to check out an
    // unpriced version is one of the two ways this entry stays unsellable,
    // the other being `enabled: false`. Two independent refusals for a plan
    // whose whole job is to exist without being had.
    price: null,
    displayOrder: 4,
    publishedAt: "2026-09-13",
    enabled: false,
  },
];

// **Frozen at module load, so immutability is enforced rather than conventional.**
// `readonly` is a compile-time promise and M20's gate box asks for more than
// one: *"a test fails if any code path can update a published entry."* A
// `readonly` array is still mutable through an `any`, a JSON round-trip or a
// stray `sort()` — and `sort()` in particular would silently reorder a list
// whose order is its publication history. Freezing makes the attempt throw in
// strict mode (every module here is one) instead of succeeding quietly.
for (const entry of PLAN_VERSIONS) {
  Object.freeze(entry.entitlements);
  Object.freeze(entry.ceilings);
  // The price is a nested record and freezing the entry does not reach it —
  // `Object.freeze` is shallow, so an unfrozen `price` would be the one
  // mutable thing left on an entry whose immutability is the whole point, and
  // the one it would cost the most to mutate.
  if (entry.price !== null) Object.freeze(entry.price);
  Object.freeze(entry);
}
Object.freeze(PLAN_VERSIONS);

/** The reference a holding stores for a version: `"premium@v1"`. */
export function planVersionRefOf(entry: PlanVersion): PlanVersionRef {
  return `${entry.planId}@v${entry.version}`;
}

/**
 * Thrown when a stored reference names a version this deploy does not have.
 *
 * **Loudly, and never a fall back to the newest** (ADR-045 rule 3). This is the
 * one failure mode the 2026-09-02 move introduces: a table with a foreign key
 * cannot lose the row a holding points at, and a file someone tidied can.
 * Silently resolving to the newest entry would hand an account terms it never
 * bought; silently resolving to nothing would look like a downgrade nobody
 * ordered. Both are worse than an error with the reference in it.
 */
export class UnknownPlanVersionError extends Error {
  constructor(readonly ref: string) {
    super(
      `Plan version "${ref}" is not published in this deploy. A pinned version must resolve ` +
        `(ADR-045 rule 3) — published entries are append-only and are never removed.`,
    );
    this.name = "UnknownPlanVersionError";
  }
}

/** Every published version of one plan, oldest first. */
export function versionsOf(planId: PlanId): readonly PlanVersion[] {
  return PLAN_VERSIONS.filter((entry) => entry.planId === planId);
}

/**
 * The newest published version of a plan — what a NEW holding pins.
 *
 * Nothing re-reads this for an EXISTING holding. *What you bought is what you
 * get* is absolute: there is no union with the latest, no "highest wins", and
 * no mechanism to move an account onto a newer entry (M20's amended-out gate
 * box). This function answers "what would someone signing up today get", and
 * it is called at the moment a holding is created and never again.
 */
export function livePlanVersion(planId: PlanId): PlanVersion {
  const published = versionsOf(planId);
  const newest = published[published.length - 1];
  if (!newest) throw new UnknownPlanVersionError(`${planId}@v?`);
  return newest;
}

/**
 * Resolve a stored reference to the entry it pins, or throw.
 *
 * The pair to `planVersionRefOf`. Every read of an account's terms goes through
 * here, which is what makes rule 3 a single chokepoint rather than a
 * convention.
 */
export function planVersionFromRef(ref: string): PlanVersion {
  const found = PLAN_VERSIONS.find((entry) => planVersionRefOf(entry) === ref);
  if (!found) throw new UnknownPlanVersionError(ref);
  return found;
}

/** Whether a reference names a version this deploy has, without throwing. */
export function isPublishedRef(ref: string): boolean {
  return PLAN_VERSIONS.some((entry) => planVersionRefOf(entry) === ref);
}

/**
 * **The committed pairing between a plan version and the Stripe Price it is
 * sold as** (M21 link 2), as a pure function of the price itself.
 *
 * Stripe Prices carry a `lookup_key`: a caller-chosen string, unique per
 * account, that a Price can be found by. This builds one from the four facts
 * that identify what is being sold — plan, version, currency, amount — so that
 * the key and the price cannot disagree. A hand-written key could name `900`
 * beside an entry reading `1900`; a derived one cannot, and that is the whole
 * reason it is derived rather than a fifth committed field.
 *
 * The consequence worth stating: **changing the amount changes the key**, so it
 * resolves to a different Stripe Price rather than silently reusing the old
 * one. Stripe Prices are themselves immutable, which is the other half of the
 * same guarantee — the two now agree by construction instead of by a check.
 * (The check in `server/billing/prices.ts` still runs, because "by
 * construction" describes this deploy and not the Stripe account's history.)
 */
export function priceLookupKey(entry: PlanVersion): string | null {
  if (entry.price === null || entry.price.minor === 0) return null;
  return `${entry.planId}_v${entry.version}_${entry.price.currency}_${entry.price.minor}`;
}

/**
 * Every plan version that can be BOUGHT — enabled, priced, and priced above
 * zero.
 *
 * Three conditions rather than one because they refuse three different
 * mistakes: `enabled` bounds what may be sold or granted at all, `price !== null`
 * refuses a version nobody set a price for, and `minor > 0` refuses a checkout
 * for nothing, which `free` would otherwise be. Any of the three failing means
 * no checkout session is created, and that is a 400 rather than a session Stripe
 * would reject at the till.
 */
export function isPurchasable(entry: PlanVersion): boolean {
  return entry.enabled && entry.price !== null && entry.price.minor > 0;
}
