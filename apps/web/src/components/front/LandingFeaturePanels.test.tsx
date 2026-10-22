import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FindADayPanel } from "./LandingFeaturePanels";

afterEach(() => {
  cleanup();
});

/**
 * The find moment's panel trims: one sample review (not two), the
 * description inline with the tag chips, and the timeline stops numbered
 * like the day page's rows. The panel's moment is 480px tall with an
 * overflow-hidden foot, so every row here is room the panel cannot spare.
 * Mitchell's preview feedback, on top of the trims: Day 1's four stops (not
 * Day 2's six), a hairline under the day line and dividers between the
 * rows, three displayed tags so the description sits on the tags' line,
 * and the attribution hidden on phones (the line that half-clipped below
 * the activities on a narrow phone moment).
 */
describe("FindADayPanel trims", () => {
  it("shows one sample review, not two", () => {
    render(<FindADayPanel />);
    expect(screen.getAllByTestId("find-a-day-review")).toHaveLength(1);
    expect(screen.queryByText("— Tom")).toBeNull();
    expect(screen.queryByText("— Priya")).toBeNull();
  });

  it("clamps the sample review quote to one line", () => {
    render(<FindADayPanel />);
    const review = screen.getByTestId("find-a-day-review");
    const quote = within(review).getByText(/arena floor first thing/);
    expect(quote.classList.contains("line-clamp-1")).toBe(true);
  });

  it("inlines the description with three tag chips, not five", () => {
    render(<FindADayPanel />);
    const row = screen.getByTestId("find-a-day-tags");
    expect(within(row).getByText("Sightseeing")).toBeTruthy();
    expect(within(row).getAllByTestId(/^tag-chip-/)).toHaveLength(3);
    expect(within(row).queryByTestId("tag-chip-shopping")).toBeNull();
    expect(within(row).queryByTestId("tag-chip-tour")).toBeNull();
  });

  it("numbers the timeline stops like the day page", () => {
    render(<FindADayPanel />);
    expect(screen.getAllByTestId("stop-number")).toHaveLength(4);
  });

  it("previews Day 1, not Day 2", () => {
    render(<FindADayPanel />);
    expect(screen.getByText("Day 1 · 4 stops")).toBeTruthy();
    expect(screen.getByText("The Colosseum, arena floor first")).toBeTruthy();
    expect(screen.queryByText("The Pantheon")).toBeNull();
  });

  it("separates the day line and divides the timeline rows", () => {
    render(<FindADayPanel />);
    const separator = screen.getByTestId("find-a-day-separator");
    expect(separator.classList.contains("bg-hairline")).toBe(true);
    const list = screen.getByTestId("find-a-day-timeline");
    expect(list.classList.contains("divide-y")).toBe(true);
    expect(list.classList.contains("divide-hairline")).toBe(true);
  });

  it("hides the attribution on phones", () => {
    render(<FindADayPanel />);
    expect(screen.getByText("By Marco").classList.contains("max-md:hidden")).toBe(true);
  });
});
