import { ActivityTag } from "@tc/contracts";
import type { SpendSeriesKey } from "../../chartPayloads";
import type { SelectedStop } from "../../select";
import { TAG_LABEL } from "../../enumLabels";

// **Which tag a stop's money is counted under, for every chart that splits
// spend by tag** — "Spend by day"'s stacks (`cost.chart`) and "Spend by tag"'s
// slices (`cost.breakdown{by: "tag"}`). One rule in one place, so a pie and a
// bar chart of the same trip can never file the same dinner under two tags
// (Mitchell, 2026-09-26: the pie must agree with the day chart).

/** The order a chart lists tags in: the contract's own tag order, then untagged. */
export const SPEND_SERIES: readonly SpendSeriesKey[] = [...ActivityTag.options, "untagged"];

/** The word a reader sees for each: the board's tag words, and "Untagged". */
export const SPEND_SERIES_LABEL: Record<SpendSeriesKey, string> = { ...TAG_LABEL, untagged: "Untagged" };

/**
 * The ONE series a stop's cost goes on.
 *
 * A stop can carry several tags, and the parts of a chart must add up to what
 * the stops cost — so a stop is counted once, under one tag, never once per
 * tag: the first in the contract's order, or "untagged" when it has none.
 */
export function seriesOf(stop: SelectedStop): SpendSeriesKey {
  // `?? []`: the contract defaults `tags` on parse, and a trip that reached
  // here without that parse (`registry.property.test.ts` builds its own) must
  // still chart as untagged rather than throw.
  const tags: readonly ActivityTag[] = stop.activity.tags ?? [];
  return ActivityTag.options.find((tag) => tags.includes(tag)) ?? "untagged";
}
