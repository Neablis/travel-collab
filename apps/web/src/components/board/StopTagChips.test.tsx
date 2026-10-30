import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StopTagChips } from "./StopTagChips";

// The chips' words, order and links are pinned where they are drawn
// (DiscoverCard, SharedDayScreen, LandingFeaturePanels). What is pinned here is
// M56 D8's "the chips render it": the icon is aria-hidden, so no name-based
// assertion would notice it gone.
describe("StopTagChips", () => {
  it("draws each chip with its tag's icon", () => {
    render(<StopTagChips activityId="a-1" tags={["outdoors", "meal"]} focusedTag={null} />);
    expect(screen.getByTestId("tag-chip-outdoors").innerHTML).toContain("lucide-trees");
    expect(screen.getByTestId("tag-chip-meal").innerHTML).toContain("lucide-utensils-crossed");
  });
});
