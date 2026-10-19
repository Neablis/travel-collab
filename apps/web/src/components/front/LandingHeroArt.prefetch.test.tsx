import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setViewportMatches } from "../../../vitest.setup";

// The hero is rendered on a phone too, hidden inside `LandingScreen`'s
// `hidden md:flex` desktop tree, so its mount-time prefetch of the real panels
// (~80 KB gzip) must look at the width itself: a phone only ever sees
// `PhoneFrontDoor`. Counted at the module's factory, which runs when — and only
// when — something imports it. Modules are reset and the mock re-registered
// per test (`doMock`, not a hoisted `mock`, whose factory result outlives
// `resetModules`), so each test starts with nothing imported.
let imported = 0;

beforeEach(() => {
  vi.resetModules();
  imported = 0;
  vi.doMock("./LandingHeroPanels", () => {
    imported += 1;
    return { TimelinePanel: () => null, NotebookPanel: () => null };
  });
});

afterEach(() => {
  cleanup();
  setViewportMatches({});
});

async function renderHero() {
  const { LandingHeroArt } = await import("./LandingHeroArt");
  render(<LandingHeroArt />);
  // Let the mount effect's import start and settle.
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

describe("LandingHeroArt's prefetch of the real panels", () => {
  it("does not download them at a phone's width, where the hero is hidden", async () => {
    setViewportMatches({ "(min-width: 768px)": false });
    await renderHero();
    expect(imported).toBe(0);
  });

  it("downloads them once the page is up at a desktop width", async () => {
    setViewportMatches({ "(min-width: 768px)": true });
    await renderHero();
    expect(imported).toBe(1);
  });

  // A blip during the prefetch must not pin both views to the static art for
  // the session: the view that later asks for its panel imports it again.
  it("tries again for a view that is shown after a failed prefetch", async () => {
    vi.resetModules();
    let attempts = 0;
    vi.doMock("./LandingHeroPanels", () => {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new Error("Failed to fetch dynamically imported module"));
      return { TimelinePanel: () => <ol aria-label="Real timeline" />, NotebookPanel: () => null };
    });
    setViewportMatches({ "(min-width: 768px)": true });
    await renderHero();
    expect(attempts).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Day 7" }));
    expect(await screen.findByRole("list", { name: "Real timeline" })).toBeDefined();
  });

  // Both panels' lazies share one import: two concurrent imports of a mocked
  // module can resolve to the real one under vitest (`LandingFeaturePanel.tsx`).
  it("hands every caller the same import", async () => {
    const { loadHeroPanels } = await import("./LandingHeroArt");
    expect(loadHeroPanels()).toBe(loadHeroPanels());
  });
});
