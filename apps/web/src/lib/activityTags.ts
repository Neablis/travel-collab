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

/**
 * The opacity an off-tag stop renders at while a tag is focused (SPEC §11).
 *
 * **Dim, never hide.** The filter row this replaced removed non-matching
 * stops, and the whole argument for replacing it was that the shape of a day
 * has to survive the filter — a day with one matching stop still shows all its
 * stops, just faint. Anything that returns `display: none` here is rebuilding
 * the filter row (M18b, "Explicitly not in scope").
 *
 * A number rather than an opacity class because it is applied through an
 * inline style in several places (a maplibre Marker takes a string, not a
 * class) and one constant is what keeps those agreeing.
 */
export const TAG_DIM_OPACITY = 0.32;

/**
 * SPEC §12's Calendar rule is a different number on purpose: a city card is a
 * bigger, tinted surface than a stop row, so the same 0.32 left it reading as
 * "slightly quieter" rather than "not what you asked for".
 */
export const CALENDAR_DIM_OPACITY = 0.28;

/** True when this stop should be dimmed — i.e. a tag is focused and it lacks it. */
export function isOffTag(tags: readonly ActivityTag[], focusedTag: ActivityTag | null): boolean {
  return focusedTag !== null && !tags.includes(focusedTag);
}

/**
 * The opacity to render a stop at: 1 unless a tag is focused and this stop
 * does not carry it. Written as a function rather than a ternary at each call
 * site so "dim, never hide" has exactly one implementation to audit.
 */
export function tagFocusOpacity(tags: readonly ActivityTag[], focusedTag: ActivityTag | null): number {
  return isOffTag(tags, focusedTag) ? TAG_DIM_OPACITY : 1;
}

/**
 * The chip's hover hint, from M18b's scope ("the hover hint the handoff
 * writes"). It names the raw tag, not `TAG_LABEL` — the handoff's copy is
 * `Dim everything that is not meal`, lowercase, reading as the tag rather than
 * as a proper noun.
 */
export function tagFocusHint(tag: ActivityTag, isFocused: boolean): string {
  return isFocused ? `Stop focusing on ${tag}` : `Dim everything that is not ${tag}`;
}
