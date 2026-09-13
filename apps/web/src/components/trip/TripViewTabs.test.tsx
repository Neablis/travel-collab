import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VIEWS, dayScopeFor, resolveView, type View } from "./context/LensRouter";
import { TripViewTabs } from "./TripViewTabs";

const setView = vi.fn();
const current: View = "Overview";

vi.mock("./context/LensRouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./context/LensRouter")>();
  return { ...actual, useLens: () => ({ view: current, dayScope: actual.dayScopeFor(current), setView }) };
});

const q = (s: string) => new URLSearchParams(s);

describe("TripViewTabs", () => {
  // SPEC §24. The four labels are the design's own words, in the design's own
  // order, and the strip renders one per `View` — so a view added to the router
  // without a tab is impossible rather than merely discouraged.
  it("renders exactly the four designed tabs, in order", () => {
    render(<TripViewTabs />);
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Overview", "Plan", "Calendar", "Map"]);
  });

  it("has a tab for every view the router can produce, and no others", () => {
    render(<TripViewTabs />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([...VIEWS]);
  });

  // Timeline is deleted, not hidden (§24), so the word should be gone from the
  // strip entirely rather than surviving as a fifth tab nobody routes to.
  it("offers no Timeline and no Day columns", () => {
    render(<TripViewTabs />);
    const labels = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(labels).not.toContain("Timeline");
    expect(labels).not.toContain("Day columns");
  });

  it("sets the view it was clicked on", () => {
    render(<TripViewTabs />);
    fireEvent.click(screen.getByRole("tab", { name: "Map" }));
    expect(setView).toHaveBeenCalledWith("Map");
  });
});

describe("dayScopeFor — §24's scope table", () => {
  // The load-bearing half of §24: *"`dayScope` is now `view === 'columns' ||
  // view === 'map'`"*. Calendar and Map had their scopes BACKWARDS before this
  // — Calendar kept day focus and Map cleared it — so asserting both directions
  // is asserting the correction, not the obvious.
  it("is a day scope for Plan and Map, and a trip scope for Overview and Calendar", () => {
    expect(dayScopeFor("Plan")).toBe(true);
    expect(dayScopeFor("Map")).toBe(true);
    expect(dayScopeFor("Overview")).toBe(false);
    expect(dayScopeFor("Calendar")).toBe(false);
  });
});

describe("resolveView — the URL, including every shape it had before §24", () => {
  it("lands a bare trip URL on Overview", () => {
    expect(resolveView(q(""))).toBe("Overview");
  });

  it("reads the four new values", () => {
    for (const view of VIEWS) expect(resolveView(q(`view=${view}`))).toBe(view);
  });

  // A share link, a bookmark and `m10-growth.spec.ts` all carry the old
  // two-param form. None of them may silently land on the wrong tab.
  it("maps every legacy lens/view pair onto its new view", () => {
    expect(resolveView(q("lens=Board"))).toBe("Plan");
    expect(resolveView(q("lens=Schedule&view=Timeline"))).toBe("Plan");
    expect(resolveView(q("lens=Schedule&view=Calendar"))).toBe("Calendar");
    expect(resolveView(q("lens=Schedule"))).toBe("Plan");
    expect(resolveView(q("lens=Map"))).toBe("Map");
    expect(resolveView(q("view=Timeline"))).toBe("Plan");
    expect(resolveView(q("view=Calendar"))).toBe("Calendar");
  });

  // Timeline's editing behaviours "were always Day columns' job" (§24), so a
  // link into the timeline is a link into Plan — never into the read-only
  // Overview, which would drop somebody mid-edit onto a page that cannot edit.
  it("never sends a legacy editing URL to a read-only view", () => {
    for (const legacy of ["lens=Board", "lens=Schedule&view=Timeline", "view=Timeline"]) {
      expect(dayScopeFor(resolveView(q(legacy)))).toBe(true);
    }
  });

  it("falls back to Overview for a value it does not recognise", () => {
    expect(resolveView(q("lens=Itinerary"))).toBe("Overview");
    expect(resolveView(q("view=Nonsense"))).toBe("Overview");
  });
});
