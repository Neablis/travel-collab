import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Lens, ScheduleView } from "./context/LensRouter";

// M10 redesign-feedback follow-up: TripViewTabs went from 3 primary tabs + a
// "More" popover (6 lenses total) down to exactly 4 peer tabs; the three lenses
// that popover carried were then retired outright (KI-20, docs/known-issues/).
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

  // One table rather than four near-identical renders: the assertion is the
  // same in each, only the (lens, view) input changes. It also pins which tab
  // each lens owns, which the KI-20 test below deliberately does not — that one
  // proves the selection is disjoint and covers the strip, not that Board maps
  // to "Day columns" specifically.
  it.each([
    ["Board", "Timeline", "Day columns"],
    ["Schedule", "Timeline", "Timeline"],
    ["Schedule", "Calendar", "Calendar"],
    ["Map", "Timeline", "Map"],
  ] as const)("lens=%s view=%s selects the %s tab", (lens, view, tab) => {
    renderTabs({ lens, view });
    expect(screen.getByRole("tab", { name: tab }).getAttribute("aria-selected")).toBe("true");
  });

  // The four "clicking X calls setLens/setLensAndView with Y" tests that used
  // to sit here were removed 2026-08-30. They asserted that a mock had been
  // called; `e2e/m10-growth.spec.ts` clicks all four tabs for real and asserts
  // the lens that actually renders — timeline rows, day columns, calendar
  // cells, the map rail — which proves the same wiring end to end and cannot
  // pass against a mock that drifted from the real `useLens`. `m11-demo.spec.ts`
  // walks three of the four again on the demo trip. See
  // docs/plans/test-overhaul/phase-5-inventory-2026-08-30.md §3, the one
  // cross-layer duplicate that survived reading.

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
