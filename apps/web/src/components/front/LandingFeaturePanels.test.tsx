import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { dayBlockOverflows, FindADayPanel } from "./LandingFeaturePanels";

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
 * the activities on a narrow phone moment). Mitchell's follow-up: the
 * reviews block is pinned at the panel's foot and the day block flexes
 * between header and footer, with its bottom fade appearing exactly when
 * the timeline runs past the height the moment leaves it.
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

  // Test-pruning lock: the m42 story-cell clip check excludes line-clamped
  // elements permanently, so the blurb's clamp is load-bearing for that
  // exclusion — if the clamp were dropped, the 1440 variant would fail
  // again on the blurb's third line. Pin the clamp here, next to the
  // review quote's, so a future edit cannot silently remove it.
  it("clamps the find blurb to two lines", () => {
    render(<FindADayPanel />);
    const blurb = screen.getByText(/Rome as a city built on top of itself/);
    expect(blurb.classList.contains("line-clamp-2")).toBe(true);
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

  it("pins the reviews at the panel foot and flexes the day block", () => {
    render(<FindADayPanel />);
    const footer = screen.getByTestId("find-a-day-footer");
    expect(footer.classList.contains("mt-auto")).toBe(true);
    expect(footer.classList.contains("shrink-0")).toBe(true);
    const day = screen.getByTestId("find-a-day-day");
    expect(day.classList.contains("flex-1")).toBe(true);
    expect(day.classList.contains("min-h-0")).toBe(true);
    expect(day.classList.contains("overflow-hidden")).toBe(true);
  });

  it("fades the day block only when its timeline overflows", () => {
    render(<FindADayPanel />);
    const day = screen.getByTestId("find-a-day-day");
    // jsdom reports no real layout (0x0), so the fade starts off.
    expect(day.classList.contains("landing-find-day-fade")).toBe(false);
    Object.defineProperty(day, "scrollHeight", { configurable: true, value: 500 });
    Object.defineProperty(day, "clientHeight", { configurable: true, value: 300 });
    fireEvent(window, new Event("resize"));
    expect(day.classList.contains("landing-find-day-fade")).toBe(true);
    Object.defineProperty(day, "clientHeight", { configurable: true, value: 500 });
    fireEvent(window, new Event("resize"));
    expect(day.classList.contains("landing-find-day-fade")).toBe(false);
  });

  it("detects day-block overflow with a 1px rounding tolerance", () => {
    expect(dayBlockOverflows(300, 400)).toBe(false);
    expect(dayBlockOverflows(401, 400)).toBe(false);
    expect(dayBlockOverflows(402, 400)).toBe(true);
  });
});
