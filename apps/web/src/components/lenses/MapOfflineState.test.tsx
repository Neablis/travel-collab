import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MapOfflineState } from "./MapOfflineState";

// SPEC §13: the phone's Map tab owes an offline state — a titled panel, the
// stops-are-still-readable message, Try again and Open Plan. `MapLens` had zero
// failure UI of any kind before M26 link 14.
describe("MapOfflineState", () => {
  it("is announced, titled, and says the stops are safe", () => {
    render(<MapOfflineState onRetry={vi.fn()} openPlanHref="/trips/t1?view=Plan" />);
    const panel = screen.getByRole("status");
    expect(screen.getByRole("heading", { name: "The map could not load" })).toBeTruthy();
    // The load-bearing sentence: what a reader fears when a screen goes blank
    // is that the thing itself is gone, not that a picture of it is.
    expect(panel.textContent).toMatch(/stops are safe/i);
    expect(panel.textContent).toMatch(/still readable in Plan/i);
  });

  it("offers both ways out, because either alone strands somebody", () => {
    const onRetry = vi.fn();
    render(<MapOfflineState onRetry={onRetry} openPlanHref="/trips/t1?view=Plan" />);
    fireEvent.click(screen.getByTestId("map-offline-retry"));
    expect(onRetry).toHaveBeenCalledOnce();

    // **A real anchor, not a button with a handler.** The first cut took an
    // `onOpenPlan` callback, which made `MapLens` reach for `useRouter` — a
    // hard router dependency for one overlay button, and it broke 43 of that
    // lens's own tests that had never needed one. An href is also simply
    // correct for a navigation: middle-click, open-in-new-tab and every
    // assistive technology that reads links as links all work.
    const openPlan = screen.getByTestId("map-offline-open-plan");
    expect(openPlan.tagName).toBe("A");
    expect(openPlan.getAttribute("href")).toBe("/trips/t1?view=Plan");
  });

  // The shared day has no Plan to open (link 4 will mount this panel there), so
  // the second action is optional rather than a dead control.
  it("omits Open Plan where there is no Plan", () => {
    render(<MapOfflineState onRetry={vi.fn()} />);
    expect(screen.queryByTestId("map-offline-open-plan")).toBeNull();
    expect(screen.getByTestId("map-offline-retry")).toBeTruthy();
  });

  // A retry that can be pressed five times while the first is in flight is five
  // map rebuilds.
  it("refuses a second retry while one is running, and says which state it is in", () => {
    const onRetry = vi.fn();
    render(<MapOfflineState onRetry={onRetry} retrying />);
    const retry = screen.getByTestId("map-offline-retry");
    expect(retry.textContent).toBe("Trying…");
    expect((retry as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(retry);
    expect(onRetry).not.toHaveBeenCalled();
  });
});
