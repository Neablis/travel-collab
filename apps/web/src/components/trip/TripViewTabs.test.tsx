import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Lens, ScheduleView } from "./context/LensRouter";

// M10 redesign-feedback follow-up: TripViewTabs went from 3 primary tabs + a
// "More" popover (6 lenses total) down to exactly 4 peer tabs, dropping
// Itinerary/Daily/Full-trip from the nav entirely (docs/known-issues.md).
// Mocking useLens directly (rather than driving it through LensRouter's real
// URL-search-param plumbing, as this file used to) lets each test set an
// arbitrary lens/view and assert on setLens/setLensAndView calls directly —
// simpler than round-tripping through router.replace for a component this
// thin.
const useLensMock = vi.fn();
vi.mock("./context/LensRouter", () => ({
  useLens: () => useLensMock(),
}));

// Import after the mock so TripViewTabs picks it up.
import { TripViewTabs } from "./TripViewTabs";

afterEach(cleanup);

function renderTabs(
  overrides: Partial<{
    lens: Lens;
    view: ScheduleView;
    setLens: (l: Lens) => void;
    setLensAndView: (l: Lens, v: ScheduleView) => void;
  }> = {},
) {
  useLensMock.mockReturnValue({
    lens: "Board",
    view: "Timeline",
    setLens: vi.fn(),
    setLensAndView: vi.fn(),
    ...overrides,
  });
  return render(<TripViewTabs />);
}

describe("TripViewTabs", () => {
  it("offers exactly the four design tabs and no More menu", () => {
    renderTabs();

    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Timeline", "Day columns", "Calendar", "Map"]);
    expect(screen.queryByRole("button", { name: /more/i })).toBeNull();
  });

  it("selects Day columns by default (Board is LensRouter's own default lens)", () => {
    renderTabs();
    expect(screen.getByRole("tab", { name: "Day columns" }).getAttribute("aria-selected")).toBe("true");
  });

  it("selects Timeline when lens=Schedule and view=Timeline", () => {
    renderTabs({ lens: "Schedule", view: "Timeline" });
    expect(screen.getByRole("tab", { name: "Timeline" }).getAttribute("aria-selected")).toBe("true");
  });

  it("selects Calendar when lens=Schedule and view=Calendar", () => {
    renderTabs({ lens: "Schedule", view: "Calendar" });
    expect(screen.getByRole("tab", { name: "Calendar" }).getAttribute("aria-selected")).toBe("true");
  });

  it("selects the Map tab when the Map lens is active", () => {
    renderTabs({ lens: "Map" });
    expect(screen.getByRole("tab", { name: "Map" }).getAttribute("aria-selected")).toBe("true");
  });

  it("switches to the Map lens when the Map tab is clicked", async () => {
    const setLens = vi.fn();
    renderTabs({ setLens });

    await userEvent.click(screen.getByRole("tab", { name: "Map" }));

    expect(setLens).toHaveBeenCalledWith("Map");
  });

  it("clicking Day columns calls setLens with Board", async () => {
    const setLens = vi.fn();
    renderTabs({ lens: "Map", setLens });

    await userEvent.click(screen.getByRole("tab", { name: "Day columns" }));

    expect(setLens).toHaveBeenCalledWith("Board");
  });

  it("clicking Calendar calls setLensAndView with Schedule, Calendar", async () => {
    const setLensAndView = vi.fn();
    renderTabs({ setLensAndView });

    await userEvent.click(screen.getByRole("tab", { name: "Calendar" }));

    expect(setLensAndView).toHaveBeenCalledWith("Schedule", "Calendar");
  });

  it("clicking Timeline calls setLensAndView with Schedule, Timeline", async () => {
    const setLensAndView = vi.fn();
    renderTabs({ lens: "Map", setLensAndView });

    await userEvent.click(screen.getByRole("tab", { name: "Timeline" }));

    expect(setLensAndView).toHaveBeenCalledWith("Schedule", "Timeline");
  });

  it("none of the four tabs is selected while on a lens with no tab (e.g. Itinerary)", () => {
    renderTabs({ lens: "Itinerary" });
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab.getAttribute("aria-selected")).toBe("false");
    }
  });
});
