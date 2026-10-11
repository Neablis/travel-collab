import { describe, expect, it } from "vitest";
import { ActivityTag, ActivityTagCategory, ActivityTagModifier } from "@tc/contracts";
import { SPEND_SERIES_COLOR } from "@/components/pages/blocks/spendColors";
import { TAG_CHIP_CLASS, TAG_GROUPS, TAG_LABEL, toggleTag } from "./activityTags";

// ADR-070: every tag the contract carries can be read, seen and picked. The
// `Record<ActivityTag, …>` maps fail to compile on a missing key, but the
// picker's groups are a hand-ordered list that compiles with a tag left out,
// and a tag missing from it is a tag nobody can set.
describe("the tag vocabulary", () => {
  it("splits every tag into exactly one of category or modifier", () => {
    const categories: readonly string[] = ActivityTagCategory.options;
    const modifiers: readonly string[] = ActivityTagModifier.options;
    expect(categories.filter((tag) => modifiers.includes(tag))).toEqual([]);
    expect([...categories, ...modifiers].sort()).toEqual([...ActivityTag.options].sort());
    expect(modifiers).toEqual(["ticketed"]);
  });

  it.each(ActivityTag.options)("gives %s a label, a chip colour and exactly one picker group", (tag) => {
    expect(TAG_LABEL[tag], `label for ${tag}`).toMatch(/\S/);
    expect(TAG_CHIP_CLASS[tag], `chip class for ${tag}`).toMatch(/\S/);
    const groups = TAG_GROUPS.filter((group) => group.tags.includes(tag)).map((group) => group.label);
    expect(groups, `picker groups holding ${tag}`).toHaveLength(1);
    const isModifier = (ActivityTagModifier.options as readonly string[]).includes(tag);
    expect(groups[0]).toBe(isModifier ? "Needs" : "What it is");
  });

  it("paints no two tags' chips, and no two spend series, alike", () => {
    const chips = Object.values(TAG_CHIP_CLASS);
    expect(new Set(chips).size).toBe(chips.length);
    const series = Object.values(SPEND_SERIES_COLOR);
    expect(new Set(series).size).toBe(series.length);
  });

  // `sameTags` compares in order, so a toggle that returned picker order would
  // turn one set of tags into two arrays and write an event for a reorder.
  it("toggles into contract order, not the picker's", () => {
    expect(toggleTag(["wellness"], "lodging")).toEqual(["lodging", "wellness"]);
    expect(toggleTag(["drinks", "tour"], "outdoors")).toEqual(["outdoors", "drinks", "tour"]);
    expect(toggleTag(["meal", "ticketed", "museum"], "ticketed")).toEqual(["meal", "museum"]);
  });
});
