import type { SpendSeriesKey } from "@tc/pages";
import type { ChartToken } from "@/components/ui/chart";

// **The colour of each tag in every chart of spend** — "Spend by day"'s stacks
// and "Spend by tag"'s slices. One map, so a meal is the same colour in the
// bars and in the pie, and both are the colour of its chip on the board.
//
// The tag chips' own families (`lib/activityTags.ts`'s `TAG_CHIP_CLASS`), as
// solids, for the categories only: Ticketed is no series (ADR-070). Outdoors is
// the one exception: its chip is moss on slate, and a grey series reads as no
// colour at all, so its solid is green, the hue its moss tint leans toward. The
// twelve are validated as one categorical palette in contract order, so stacks
// that touch stay apart (design-system.md "Tag colours"). Untagged is the
// quiet neutral: it is the remainder, not a category. `border-input` rather
// than `border-strong` because a bar or a slice is a non-text mark and needs
// 3:1 against the surface (design-system.md's contrast table has 3.16 for it).
export const SPEND_SERIES_COLOR: Record<SpendSeriesKey, ChartToken> = {
  meal: "--color-warning",
  lodging: "--color-info",
  outdoors: "--color-success",
  drinks: "--color-tag-drinks",
  nightlife: "--color-tag-nightlife",
  museum: "--color-tag-museum",
  sight: "--color-tag-sight",
  beach: "--color-tag-beach",
  shopping: "--color-tag-shopping",
  show: "--color-tag-show",
  tour: "--color-tag-tour",
  wellness: "--color-tag-wellness",
  sports: "--color-tag-sports",
  untagged: "--color-border-input",
};
