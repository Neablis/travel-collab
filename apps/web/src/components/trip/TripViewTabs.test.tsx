import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Lens, ScheduleView } from "./context/LensRouter";

// M10 redesign-feedback follow-up: TripViewTabs went from 3 primary tabs + a
// "More" popover (6 lenses total) down to exactly 4 peer tabs; the three lenses
// that popover carried were then retired outright (KI-20, docs/known-issues.md).
// Mocking useLens directly (rather than driving it through LensRouter's real
// URL-search-param plumbing, as this file used to) lets each test set an
// arbitrary lens/view and assert on setLens/setLensAndView calls directly —
// simpler than round-tripping through router.replace for a component this
// thin. Only `useLens` is stubbed: the real `LENSES` list is kept so the
// coverage test at the bottom compares tabs against the actual lens set rather
// than a copy of it that could drift.
const useLensMock = vi.fn();
vi.mock("./context/LensRouter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./context/LensRouter")>()),
  useLens: () => useLensMock(),
}));

// Import after the mock so TripViewTabs picks it up.
import { LENSES, SCHEDULE_VIEWS } from "./context/LensRouter";
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

  // KI-20's regression guard, and the reason the entry could be closed by
  // retirement rather than by a fifth tab: every lens LensRouter accepts is
  // reachable from this strip, and no tab-less lens is left to re-introduce.
  // This replaces a test asserting the old "no tab selected on Itinerary"
  // behaviour — a state that is now unreachable by design.
  //
  // Driven off the real LENSES x SCHEDULE_VIEWS product rather than a copied
  // list, so a lens added without a tab of its own is caught rather than
  // silently skipped: it would fall through to whatever tab `primaryValue`
  // defaults to, colliding with the lens that legitimately owns it, and the
  // disjointness assertion below turns red.
  it("gives every lens LensRouter accepts its own tab, and no tab is dead (KI-20)", () => {
    const tabsPerLens = new Map<Lens, Set<string>>();
    for (const lens of LENSES) {
      const owned = new Set<string>();
      for (const view of SCHEDULE_VIEWS) {
        cleanup();
        renderTabs({ lens, view });
        const selected = screen.getAllByRole("tab").filter((t) => t.getAttribute("aria-selected") === "true");
        // Exactly one — never zero (a tab-less lens) and never two.
        expect(selected.map((t) => t.textContent)).toHaveLength(1);
        owned.add(selected[0]!.textContent ?? "");
      }
      tabsPerLens.set(lens, owned);
    }

    // No two lenses select the same tab: each lens owns its own corner of the
    // strip. Board/Map ignore `view` and own one tab each; Schedule owns two.
    const claimed = [...tabsPerLens.values()].flatMap((s) => [...s]);
    expect(new Set(claimed).size).toBe(claimed.length);

    // …and together they cover the whole strip, so no tab is dead either.
    cleanup();
    renderTabs();
    expect([...claimed].sort()).toEqual(
      screen
        .getAllByRole("tab")
        .map((t) => t.textContent ?? "")
        .sort(),
    );

    // Last, and only as documentation of what KI-20 retired — the two
    // assertions above are the ones that actually bite.
    expect([...LENSES]).toEqual(["Board", "Map", "Schedule"]);
  });
});
