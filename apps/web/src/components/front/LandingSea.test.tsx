import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LANDING_FEATURES } from "@/lib/landingDemo";
import { LANDING_SEA } from "@/lib/landingSea";
import { dayPath, parseDaySegment } from "@/lib/playbookUrls";
import { LandingSea, SEA_BANDS, momentRise, seaDim } from "./LandingSea";

// The real moment panels resolve from the warm module cache, for the reason
// `LandingScreen.test.tsx` gives.
beforeAll(async () => {
  await import("./LandingFeaturePanels");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** An `IntersectionObserver` the test drives: `near(i)` reports the i-th observed screen near. */
function watchScreens() {
  const watched: { el: Element; callback: IntersectionObserverCallback; observer: IntersectionObserver }[] = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      callback: IntersectionObserverCallback;
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
      }
      observe(el: Element) {
        watched.push({ el, callback: this.callback, observer: this as never });
      }
      disconnect() {}
    },
  );
  return {
    nearAll: () =>
      act(() => {
        for (const w of watched) w.callback([{ isIntersecting: true, target: w.el } as never], w.observer);
      }),
  };
}

const savedDayIds = () => screen.getAllByTestId("discover-card").map((card) => card.getAttribute("data-saved-day-id"));

// A whole sea mounted is some three hundred cards: seconds of jsdom, not a hang.
describe("the landing's sea", { timeout: 30_000 }, () => {
  // The first screen is what a cold load paints, before any JavaScript: it is
  // in the server's HTML. Everything further down waits until the reader is
  // within a screen of it, so 148 cards are not 148 mounts.
  it("puts the first screen in the server's HTML, and no far cell", () => {
    const html = renderToString(<LandingSea />);
    const [first, ...rest] = SEA_BANDS;
    const near = new Set(first!.map((cell) => cell.day.savedDayId));
    for (const id of near) expect(html).toContain(`data-saved-day-id="${id}"`);
    const far = rest.flat().filter((cell) => !near.has(cell.day.savedDayId));
    expect(far.length).toBeGreaterThan(0);
    for (const cell of far) expect(html).not.toContain(`data-saved-day-id="${cell.day.savedDayId}"`);
    for (const cell of LANDING_SEA.japan) expect(html).not.toContain(`data-saved-day-id="${cell.day.savedDayId}"`);
  });

  it("mounts a far screen's cells once the reader is near it", () => {
    const screens = watchScreens();
    render(<LandingSea />);
    const far = SEA_BANDS.at(-1)!.find((cell) => !SEA_BANDS[0]!.includes(cell))!;
    expect(savedDayIds()).not.toContain(far.day.savedDayId);
    screens.nearAll();
    expect(savedDayIds()).toContain(far.day.savedDayId);
  });

  // ADR-063's cache serves a signed-out day page only to a query-less URL, and
  // a prefetch of every card would read the library 148 times. So each linked
  // cell opens its canonical day page with nothing after it, and the Japan
  // cells, whose days live only in the dev fixtures, open nothing (decision 10).
  it("links every cell to its canonical day page, with no query, and the Japan cells nowhere", () => {
    const screens = watchScreens();
    render(<LandingSea />);
    screens.nearAll();
    const sea = within(screen.getByTestId("landing-sea"));
    const dayLinks = sea.getAllByRole("link").filter((link) => link.getAttribute("href")!.startsWith("/playbooks"));
    expect(dayLinks.length).toBeGreaterThan(SEA_BANDS[0]!.length);
    const canonical = new Set(LANDING_SEA.cells.map((cell) => cell.href));
    for (const link of dayLinks) {
      const href = link.getAttribute("href")!;
      expect(href).toMatch(/^\/playbooks\/day\/[^?#]+$/);
      expect(canonical.has(href)).toBe(true);
      expect(parseDaySegment(href.slice("/playbooks/day/".length)).id).not.toBeNull();
    }
    for (const cell of LANDING_SEA.japan) {
      expect(sea.getByRole("heading", { name: cell.day.name })).toBeDefined();
      expect(sea.queryByRole("link", { name: cell.day.name })).toBeNull();
    }
  });

  it("lets a keyboard skip the background, but not the moments", () => {
    const screens = watchScreens();
    render(<LandingSea />);
    screens.nearAll();
    const sea = within(screen.getByTestId("landing-sea"));
    const background = SEA_BANDS[1]![0]!;
    for (const link of sea.getAllByRole("link", { name: background.day.name })) {
      expect(link.getAttribute("tabindex")).toBe("-1");
    }
    const find = within(sea.getByRole("region", { name: "Find a day worth borrowing." }));
    for (const link of find.getAllByRole("link", { name: LANDING_FEATURES.shelf.name })) {
      expect(link.getAttribute("tabindex")).toBeNull();
    }
  });
});

describe("the sea's moments", { timeout: 30_000 }, () => {
  it("finds a day: the Railay day as a big card and a small one, both opening its page", async () => {
    render(<LandingSea />);
    const find = within(screen.getByRole("region", { name: "Find a day worth borrowing." }));
    const links = await find.findAllByRole("link", { name: LANDING_FEATURES.shelf.name });
    expect(links.map((link) => link.getAttribute("href"))).toEqual([dayPath(LANDING_FEATURES.shelf), dayPath(LANDING_FEATURES.shelf)]);
  });

  it("makes it your trip, under the heading Mitchell gave it", () => {
    render(<LandingSea />);
    const make = within(
      screen.getByRole("region", { name: "Start a trip using someone else’s Thailand day, or add it to an existing plan." }),
    );
    expect(make.getByRole("link", { name: "Make this your trip" }).getAttribute("href")).toBe(dayPath(LANDING_FEATURES.shelf));
  });

  it("puts the crew on the Greek trip's borrowed Day 2, with the Greek days lit around it", async () => {
    const screens = watchScreens();
    render(<LandingSea />);
    screens.nearAll();
    const crew = within(screen.getByRole("region", { name: "Plan the rest with the crew." }));
    const river = await crew.findByRole("list", { name: "Day 2 timeline" });
    expect(within(river).getAllByRole("listitem").length).toBe(LANDING_FEATURES.crew.river.activityIds.length);
    expect(crew.getByText(LANDING_FEATURES.crew.people.sentence)).toBeDefined();
    // Each stop names the crew member who added it (M51 decision 8a), not
    // nobody and not an id's handle.
    const adders = within(river)
      .getAllByText(/, added by /)
      .map((said) => /, added by (\w+)/.exec(said.textContent!)![1]);
    expect(adders).toHaveLength(LANDING_FEATURES.crew.river.activityIds.length);
    expect(adders.filter((name) => !Object.keys(LANDING_FEATURES.crew.personas).includes(name!))).toEqual([]);
    const lit = LANDING_SEA.cells.filter((cell) => cell.group === "greek-islands");
    expect(crew.getAllByTestId("discover-card").map((card) => card.getAttribute("data-saved-day-id"))).toEqual(
      expect.arrayContaining(lit.map((cell) => cell.day.savedDayId)),
    );
  });

  it("keeps the notebook afterwards, with the Japan days lit around it", async () => {
    const screens = watchScreens();
    render(<LandingSea />);
    screens.nearAll();
    const notebook = within(screen.getByRole("region", { name: "Keep the notebook afterwards." }));
    expect(await notebook.findByTestId("notebook-page")).toBeDefined();
    for (const cell of LANDING_SEA.japan) expect(notebook.getByRole("heading", { name: cell.day.name })).toBeDefined();
  });
});

// SPEC §28's notes, which the phone's pin paid for: progress is scroll
// position, not time; no `requestAnimationFrame`; the rest state is in the
// markup, so a cold load paints the first screen as it is meant to look.
describe("the rise and the dim", () => {
  it("holds the first screen in full colour, then dims the sea behind what follows", () => {
    expect(seaDim(0, 1000)).toBe(0);
    expect(seaDim(500, 1000)).toBe(0);
    expect(seaDim(900, 1000)).toBeGreaterThan(0);
    expect(seaDim(900, 1000)).toBeLessThan(1);
    expect(seaDim(2000, 1000)).toBe(1);
  });

  it("raises a moment as it comes up the screen", () => {
    expect(momentRise(1000, 1000)).toEqual({ opacity: 0, dy: expect.any(Number) });
    expect(momentRise(1000, 1000).dy).toBeGreaterThan(0);
    expect(momentRise(200, 1000)).toEqual({ opacity: 1, dy: 0 });
  });

  it("starts from the rest state in the markup, and follows the scroll", () => {
    render(<LandingSea />);
    const sea = screen.getByTestId("landing-sea");
    expect(sea.style.getPropertyValue("--sea-dim")).toBe("0");

    const moment = screen.getByRole("region", { name: "Plan the rest with the crew." });
    vi.spyOn(moment, "getBoundingClientRect").mockReturnValue({ top: window.innerHeight } as DOMRect);
    vi.spyOn(window, "scrollY", "get").mockReturnValue(window.innerHeight * 3);
    fireEvent.scroll(window);
    expect(sea.style.getPropertyValue("--sea-dim")).toBe("1");
    expect(moment.style.opacity).toBe("0");
  });
});
