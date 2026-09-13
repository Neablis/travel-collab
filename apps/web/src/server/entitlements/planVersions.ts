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
// **No prices.** M20 publishes versions that are free by construction; M21 link
// 2 adds `priceMinor`, `currency` and `stripePriceId` to these same entries. A
// price string in this file today means the M20/M21 split failed.
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
    displayOrder: 3,
    publishedAt: "2026-09-13",
    enabled: true,
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
