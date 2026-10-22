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

  it("inlines the description with the tag chips", () => {
    render(<FindADayPanel />);
    const row = screen.getByTestId("find-a-day-tags");
    expect(within(row).getByText("Sightseeing")).toBeTruthy();
    expect(within(row).getAllByTestId(/^tag-chip-/)).toHaveLength(5);
  });

  it("numbers the timeline stops like the day page", () => {
    render(<FindADayPanel />);
    expect(screen.getAllByTestId("stop-number")).toHaveLength(6);
  });
});
