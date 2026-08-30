import type { ActivityTag } from "@tc/contracts";

/**
 * The four tags the contract carries, in the order the picker offers them and
 * the order `toggleTag` normalises to. Never the handoff's six — `considering`
 * and `travel` restate `kind: idea` and `kind: transit`, and synthesising them
 * here would put two settable fields in a position to disagree about one fact
 * (KI-52, and `packages/contracts/src/activity.ts`'s own note).
 */
export const TAG_ORDER: readonly ActivityTag[] = ["meal", "lodging", "ticketed", "outdoors"];

export const TAG_LABEL: Record<ActivityTag, string> = {
  meal: "Meal",
  lodging: "Lodging",
  ticketed: "Ticketed",
  outdoors: "Outdoors",
};

/**
 * Chip colours, from the handoff's `TAGS` array (`Trip Planner
 * Redesign.dc.html:3703`), with one deviation: `outdoors` is given there as
 * `--color-surface` on `--color-slate`, and a stop card's own background IS
 * surface, so that chip would be invisible on it. It falls back to moss —
 * which is the handoff's own `TAG()` default background for a tag it cannot
 * find, so the deviation stays inside the design's vocabulary.
 */
export const TAG_CHIP_CLASS: Record<ActivityTag, string> = {
  meal: "bg-warning-tint text-warning-ink",
  lodging: "bg-info-tint text-info-ink",
  ticketed: "bg-success-tint text-success-ink",
  outdoors: "bg-moss text-slate",
};

/**
 * Add or drop one tag, always returning the whole set in `TAG_ORDER`.
 *
 * Whole-array, because `UpdateActivity.tags` is a whole-array replace, not a
 * delta; canonical order, because otherwise the same four tags picked in two
 * orders are two different arrays, and `activityStatesEqual` would call a
 * reorder a real change and write an event for it.
 */
export function toggleTag(tags: readonly ActivityTag[], tag: ActivityTag): ActivityTag[] {
  const next = new Set(tags);
  if (!next.delete(tag)) next.add(tag);
  return TAG_ORDER.filter((t) => next.has(t));
}
