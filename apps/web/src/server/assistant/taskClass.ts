// **What a turn is FOR, and which model slot answers it** (ADR-043 decision 4,
// spec §5 and §5b).
//
// Two vocabularies and one table between them. Keeping them apart is the whole
// point: a task class is a fact about the REQUEST, a tier is a name for a SLOT
// in the deployment's configuration, and the model id filling that slot is an
// input nobody in the kernel is allowed to know.
import type { LanguageModel } from "ai";

/**
 * What this turn is for.
 *
 * Three of the four come from the classifier (askIntent.ts). `compose` does
 * not, and that asymmetry is load-bearing rather than an accident of where the
 * code sits:
 *
 *   * `question` — asks about the trip as it already is.
 *   * `edit`     — a bounded change to a trip that exists.
 *   * `plan`     — "plan me a 6 day trip": multi-day generation.
 *   * `compose`  — a page turn, decided by **the surface**.
 *
 * A page turn is `compose` **by construction and is not classified at all**,
 * which is today's behaviour and stays it. Its tool set comes from a scope the
 * server verified (`resolveSurface`), not from what the sentence sounds like,
 * so a classification round-trip would be spend with nothing to buy.
 */
export type TaskClass = "question" | "edit" | "plan" | "compose";

/** Every task class, for exhaustiveness in tests and in a generator. */
export const TASK_CLASSES: readonly TaskClass[] = ["question", "edit", "plan", "compose"];

/**
 * **A tier is the name of a slot, not a model.**
 *
 * Mitchell, 2026-09-10: *"that cost is not forever, and the model we use might
 * change, so that needs to be a variable input in the system."* So no model id
 * is ever a literal in kernel code — these three names resolve through
 * configuration (`serverConfig.aiModelTiers`), through `selectAiModel()`, which
 * stays ADR-019's single chokepoint and keeps its lint wall and its kill
 * switch. Swapping a model is a configuration change plus a rate entry; no
 * kernel code moves.
 */
export type ModelTier = "cheap" | "mid" | "strong";

export const MODEL_TIERS: readonly ModelTier[] = ["cheap", "mid", "strong"];

/**
 * The whole of §5's routing table, as data.
 *
 * `compose` is `mid` for the same reason `edit` is: a page turn writes a
 * bounded amount into one page. It is a decision about the surface, not about
 * the sentence, which is why it is a row here and not a classifier verdict.
 */
const TIER_FOR: Readonly<Record<TaskClass, ModelTier>> = {
  question: "cheap",
  edit: "mid",
  plan: "strong",
  compose: "mid",
};

/**
 * The tier a task class proposes.
 *
 * Spec §7e calls this a **proposal**, not a decision: M20's entitlements may
 * cap it (`capTier` below), the same cap-an-upper-bound shape as §2's surface
 * grant and §7c's effect intersection.
 */
export function tierFor(taskClass: TaskClass): ModelTier {
  return TIER_FOR[taskClass];
}

const TIER_RANK: Readonly<Record<ModelTier, number>> = { cheap: 0, mid: 1, strong: 2 };

/**
 * **Uncertainty resolves UPWARD**, toward the stronger model — the same bias
 * `askIntent` already applies, for the same reason stated one level up: a
 * question wrongly given a strong model costs tokens, and a `plan` wrongly
 * given a cheap one answers badly. Only one of those two is recoverable by
 * asking again.
 *
 * So this is `max`, not `min`. It is here rather than inlined because it is the
 * one arithmetic in this file that would read as harmless spelled the other
 * way round.
 */
export function strongerTier(a: ModelTier, b: ModelTier): ModelTier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}

/**
 * A ceiling on the tier a turn may reach.
 *
 * `null` means **no cap** — which is what the default resolver answers, so
 * today every turn gets the tier its class proposes and behaviour is unchanged.
 * M20 is where a plan starts capping it; nothing here invents a tier, a plan or
 * a price (spec §7e, "not decided here").
 *
 * Deliberately a `min` against a ceiling and NOT a rank comparison between
 * plans: the ordering here is over MODEL SLOTS, which really are ordered by
 * capability, and it must never be mistaken for an ordering over plans. M20's
 * rule — *"a plan is a set, not a rank"* — is enforced on the other side of the
 * port, in `ResolvedEntitlements`, which exposes `has()` and no comparison at
 * all (entitlements.ts).
 */
export function capTier(proposed: ModelTier, ceiling: ModelTier | null): ModelTier {
  if (ceiling === null) return proposed;
  return TIER_RANK[proposed] <= TIER_RANK[ceiling] ? proposed : ceiling;
}

/**
 * One model per tier, resolved — what `selectModel` hands the pipeline.
 *
 * **Why the whole map rather than the one model the turn needs.** The tier a
 * turn needs is a function of its task class, and the class is not known until
 * `classifyTask`, which is the LAST stage; `selectModel` is the sixth, and that
 * order is a recorded incident rather than a preference. Handing back every
 * slot resolves the tension without moving a stage: selection still owns the
 * entitlement check, the kill switch and the single gateway chokepoint, and
 * `grantTools` picks a slot out of what selection already decided.
 *
 * The kernel holds `LanguageModel` handles it never constructs and model ids it
 * never spells — the slot names above are the whole of its vocabulary.
 */
export type TierModels = Readonly<Record<ModelTier, LanguageModel>>;
