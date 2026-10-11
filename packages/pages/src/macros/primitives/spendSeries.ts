import { ActivityTagCategory, type ActivityTag } from "@tc/contracts";
import type { SpendSeriesKey } from "../../chartPayloads";
import type { SelectedStop } from "../../select";
import { TAG_LABEL } from "../../enumLabels";

// **Which tag a stop's money is counted under, for every chart that splits
// spend by tag** — "Spend by day"'s stacks (`cost.chart`) and "Spend by tag"'s
// slices (`cost.breakdown{by: "tag"}`). One rule in one place, so a pie and a
// bar chart of the same trip can never file the same dinner under two tags
// (Mitchell, 2026-09-26: the pie must agree with the day chart).

// Categories only (ADR-070 decision 2): Ticketed says what a stop needs, not
// what it is, so it is never a slice or a stack, and a stop tagged only
// Ticketed is charted as untagged.

/** The order a chart lists tags in: the contract's own category order, then untagged. */
export const SPEND_SERIES: readonly SpendSeriesKey[] = [...ActivityTagCategory.options, "untagged"];

/** The word a reader sees for each: the board's tag words, and "Untagged". */
export const SPEND_SERIES_LABEL = Object.fromEntries(
  SPEND_SERIES.map((key) => [key, key === "untagged" ? "Untagged" : TAG_LABEL[key]]),
) as Record<SpendSeriesKey, string>;

/** True for a tag that is a spend series of its own — every tag but a modifier. */
export function isSpendSeries(tag: ActivityTag): tag is ActivityTagCategory {
  return (SPEND_SERIES as readonly string[]).includes(tag);
}

/**
 * The ONE series a stop's cost goes on.
 *
 * A stop can carry several tags, and the parts of a chart must add up to what
 * the stops cost — so a stop is counted once, under one tag, never once per
 * tag: the first category in the contract's order, or "untagged" when it has
 * none.
 */
export function seriesOf(stop: SelectedStop): SpendSeriesKey {
  // `?? []`: the contract defaults `tags` on parse, and a trip that reached
  // here without that parse (`registry.property.test.ts` builds its own) must
  // still chart as untagged rather than throw.
  const tags: readonly ActivityTag[] = stop.activity.tags ?? [];
  return ActivityTagCategory.options.find((tag) => tags.includes(tag)) ?? "untagged";
}
