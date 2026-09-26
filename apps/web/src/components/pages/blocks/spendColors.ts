import type { SpendSeriesKey } from "@tc/pages";
import type { ChartToken } from "@/components/ui/chart";

// **The colour of each tag in every chart of spend** — "Spend by day"'s stacks
// and "Spend by tag"'s slices. One map, so a meal is the same colour in the
// bars and in the pie, and both are the colour of its chip on the board.
//
// The tag chips' own families (`lib/activityTags.ts`'s `TAG_CHIP_CLASS`), as
// solids. Untagged is the quiet neutral: it is the remainder, not a category.
// `border-input` rather than `border-strong` because a bar or a slice is a
// non-text mark and needs 3:1 against the surface (design-system.md's contrast
// table has 3.16 for it).
export const SPEND_SERIES_COLOR: Record<SpendSeriesKey, ChartToken> = {
  meal: "--color-warning",
  lodging: "--color-info",
  ticketed: "--color-success",
  outdoors: "--color-slate",
  untagged: "--color-border-input",
};
