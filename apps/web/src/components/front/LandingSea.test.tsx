import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LANDING_FEATURES } from "@/lib/landingDemo";
import { LANDING_SEA } from "@/lib/landingSea";
import { dayPath, parseDaySegment } from "@/lib/playbookUrls";
import { FIRST_SCREEN, FIRST_SCREEN_ROWS, LandingSea, SEA_REGIONS, layoutSea, momentRise, seaDim } from "./LandingSea";

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

/** An `IntersectionObserver` the test drives: `near(el)` reports one observed element near, `nearAll()` every one. */
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
  const report = (which: typeof watched) =>
    act(() => {
      for (const w of which) w.callback([{ isIntersecting: true, target: w.el } as never], w.observer);
    });
  return {
    near: (el: Element) => report(watched.filter((w) => w.el === el)),
    nearAll: () => report(watched),
  };
}

const savedDayIds = () => screen.getAllByTestId("discover-card").map((card) => card.getAttribute("data-saved-day-id"));
/** The cells the moments light, as rendered: always mounted, wherever the reader is. */
const litCells = () => screen.getAllByTestId("sea-cell").filter((cell) => cell.hasAttribute("data-lit-for"));
const dayOf = (cell: HTMLElement) => within(cell).getByTestId("discover-card").getAttribute("data-saved-day-id")!;
/** The background's days, which no moment lights and the Railay day is not among. */
const backgroundNames = (lit: Set<string>) =>
  [...new Set(FIRST_SCREEN.filter((cell) => !lit.has(cell.day.savedDayId)).map((cell) => cell.day.name))].filter(
    (name) => name !== LANDING_FEATURES.shelf.name,
  );

// A whole sea mounted is some three hundred cards: seconds of jsdom, not a
// hang, so only the two tests that need every screen mount them all.
const WHOLE_SEA = { timeout: 15_000 };

describe("the landing's sea", () => {
  // The first screen is what a cold load paints, before any JavaScript: it is
  // in the server's HTML. Everything further down waits until the reader is
  // within a screen of it, so 148 cards are not 148 mounts. A moment's lit
  // days are the exception: they are doors, and one mounted only once focus
  // had scrolled to the moment's button would sit before it in the DOM, where
  // Tab had already passed.
  it("puts the first screen and the moments' lit days in the server's HTML, and no far cell", () => {
    const html = renderToString(<LandingSea />);
    render(<LandingSea />);
    const lit = new Set(litCells().map(dayOf));
    expect(lit.size).toBeGreaterThan(0);
    const near = new Set([...FIRST_SCREEN.map((cell) => cell.day.savedDayId), ...lit]);
    for (const id of near) expect(html).toContain(`data-saved-day-id="${id}"`);
    const far = LANDING_SEA.cells.filter((cell) => !near.has(cell.day.savedDayId));
    expect(far.length).toBeGreaterThan(0);
    for (const cell of far) expect(html).not.toContain(`data-saved-day-id="${cell.day.savedDayId}"`);
  });

  // The background is ground, not content: a screen reader moving by heading
  // or by link meets the h1 and then the first moment, not the library's 148
  // titles, while the moments' lit days stay doors it can open.
  it("reads the hero, then the moments: no background card is in the accessibility tree", WHOLE_SEA, () => {
    const screens = watchScreens();
    render(<LandingSea hero={<h1>Plan the trip together.</h1>} />);
    screens.nearAll();
    const sea = within(screen.getByTestId("landing-sea"));
    const headings = sea.getAllByRole("heading").map((heading) => heading.textContent);
    expect(headings.slice(0, 2)).toEqual(["Plan the trip together.", "Find a day worth borrowing."]);
    const exposed = new Set([...headings, ...sea.getAllByRole("link").map((link) => link.textContent)]);
    const lit = litCells();
    expect(backgroundNames(new Set(lit.map(dayOf))).filter((name) => exposed.has(name))).toEqual([]);
    // The lit days that are doors are tab stops; the Railay day's small card is the one that is not.
    const doors = lit.filter((cell) => cell.getAttribute("aria-hidden") === null);
    expect(doors.length).toBe(lit.length - 1);
    for (const cell of doors) {
      for (const link of within(cell).queryAllByRole("link")) expect(link.getAttribute("tabindex")).toBeNull();
    }
  });

  it("mounts a far screen's cells once the reader is near it", WHOLE_SEA, () => {
    const screens = watchScreens();
    render(<LandingSea />);
    const before = screen.getAllByTestId("sea-cell").length;
    const known = new Set([...FIRST_SCREEN.map((cell) => cell.day.savedDayId), ...litCells().map(dayOf)]);
    const far = () => savedDayIds().filter((id) => !known.has(id!));
    expect(far()).toEqual([]);
    screens.nearAll();
    expect(screen.getAllByTestId("sea-cell").length).toBeGreaterThan(before);
    expect(far().length).toBeGreaterThan(0);
  });

  // ADR-063's cache serves a signed-out day page only to a query-less URL, and
  // a prefetch of every card would read the library 148 times. So each linked
  // cell opens its canonical day page with nothing after it, and the Japan
  // cells, whose days live only in the dev fixtures, open nothing (decision 10).
  it("links every cell to its canonical day page, with no query, and the Japan cells nowhere", WHOLE_SEA, () => {
    const screens = watchScreens();
    render(<LandingSea />);
    screens.nearAll();
    const sea = within(screen.getByTestId("landing-sea"));
    const dayLinks = sea.getAllByRole("link", { hidden: true }).filter((link) => link.getAttribute("href")!.startsWith("/playbooks"));
    expect(dayLinks.length).toBeGreaterThan(FIRST_SCREEN.length);
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

  it("lets a keyboard skip the background, but not the moments", async () => {
    render(<LandingSea />);
    const sea = within(screen.getByTestId("landing-sea"));
    const background = FIRST_SCREEN[0]!;
    for (const link of sea.getAllByRole("link", { name: background.day.name, hidden: true })) {
      expect(link.getAttribute("tabindex")).toBe("-1");
    }
    const find = within(sea.getByRole("region", { name: "Find a day worth borrowing." }));
    for (const link of await find.findAllByRole("link", { name: LANDING_FEATURES.shelf.name })) {
      expect(link.getAttribute("tabindex")).toBeNull();
    }
  });
});

describe("the sea's moments", () => {
  // The small card is the same day again, so it is drawn but is not a second
  // door: a keyboard or a screen reader meets the Railay day once.
  it("finds a day: the Railay day as a big card and a small one beside it, one door to its page", async () => {
    render(<LandingSea />);
    const find = within(screen.getByRole("region", { name: "Find a day worth borrowing." }));
    expect(await find.findAllByRole("link", { name: LANDING_FEATURES.shelf.name })).toHaveLength(1);
    const links = screen.getAllByRole("link", { name: LANDING_FEATURES.shelf.name });
    expect(links.map((link) => link.getAttribute("href"))).toEqual([dayPath(LANDING_FEATURES.shelf)]);
    const small = litCells().filter((cell) => cell.getAttribute("data-lit-for") === "sea-find" && dayOf(cell) === LANDING_FEATURES.shelf.savedDayId);
    expect(small).toHaveLength(1);
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
    const region = screen.getByRole("region", { name: "Plan the rest with the crew." });
    screens.near(region);
    const crew = within(region);
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
    const lit = litCells().filter((cell) => cell.getAttribute("data-lit-for") === "sea-crew");
    expect(lit.map((cell) => cell.getAttribute("data-region"))).toEqual(lit.map(() => "greek-islands"));
    // Elena's Naxos day, the one the crew borrowed, among them.
    expect(lit.map((cell) => within(cell).getByRole("heading").textContent)).toContainEqual(expect.stringMatching(/^Naxos/));
  });

  it("keeps the notebook afterwards, with the Japan days lit around it", async () => {
    const screens = watchScreens();
    render(<LandingSea />);
    const region = screen.getByRole("region", { name: "Keep the notebook afterwards." });
    screens.near(region);
    const notebook = within(region);
    expect(await notebook.findByTestId("notebook-page")).toBeDefined();
    const lit = litCells().filter((cell) => cell.getAttribute("data-lit-for") === "sea-notebook");
    expect(lit.map(dayOf).sort()).toEqual(LANDING_SEA.japan.map((cell) => cell.day.savedDayId).sort());
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

  it("raises a moment as it comes up the screen, and keeps it risen past the middle", () => {
    expect(momentRise(1000, 400, 1000)).toEqual({ opacity: 0, dy: expect.any(Number) });
    expect(momentRise(1000, 400, 1000).dy).toBeGreaterThan(0);
    expect(momentRise(200, 400, 1000)).toEqual({ opacity: 1, dy: 0 });
    expect(momentRise(-900, 400, 1000)).toEqual({ opacity: 1, dy: 0 });
  });

  it("starts from the rest state in the markup, and follows the scroll", () => {
    // The server's HTML, which no effect has painted: the sea undimmed and
    // every moment risen, with no opacity of its own.
    const html = renderToString(<LandingSea />);
    expect(html).toContain("--sea-dim:0");
    expect(html).not.toMatch(/data-rise[^>]*opacity/);
    expect(html).not.toMatch(/opacity[^>]*data-rise/);

    render(<LandingSea />);
    const sea = screen.getByTestId("landing-sea");

    const moment = screen.getByRole("region", { name: "Plan the rest with the crew." });
    vi.spyOn(moment, "getBoundingClientRect").mockReturnValue({ top: window.innerHeight, height: 400 } as DOMRect);
    vi.spyOn(window, "scrollY", "get").mockReturnValue(window.innerHeight * 3);
    fireEvent.scroll(window);
    expect(sea.style.getPropertyValue("--sea-dim")).toBe("1");
    expect(within(moment).getByTestId("moment-panel").style.opacity).toBe("0");
  });
});

/** A grid item's area from its inline placement (`grid-row: 9 / span 2`), or null when it is not placed on the grid. */
function areaOf(el: HTMLElement) {
  const row = /^(\d+) \/ span (\d+)$/.exec(el.style.gridRow);
  const col = /^(\d+) \/ span (\d+)$/.exec(el.style.gridColumn);
  return row && col ? { row: Number(row[1]), h: Number(row[2]), col: Number(col[1]), w: Number(col[2]) } : null;
}
type Area = NonNullable<ReturnType<typeof areaOf>>;
/** Whether two areas share a grid cell, or with `margin` 1, touch along an edge or at a corner. */
const meet = (a: Area, b: Area, margin = 0) =>
  a.row < b.row + b.h + margin && b.row < a.row + a.h + margin && a.col < b.col + b.w + margin && b.col < a.col + a.w + margin;

const MOMENTS = [
  "Find a day worth borrowing.",
  "Start a trip using someone else’s Thailand day, or add it to an existing plan.",
  "Plan the rest with the crew.",
  "Keep the notebook afterwards.",
];

/** The days lit around a moment: doors drawn beside its panel, or the cells the grid lights for it. */
function litAround(name: string) {
  const region = screen.getByRole("region", { name });
  const panel = within(region).queryByTestId("moment-panel");
  const inPanel = panel === null ? [] : within(panel).queryAllByTestId("discover-card");
  const beside = within(region)
    .queryAllByTestId("discover-card")
    .filter((card) => !inPanel.includes(card) && card.getAttribute("aria-hidden") === null);
  const around = screen
    .queryAllByTestId("sea-cell")
    .filter((cell) => cell.getAttribute("data-lit-for") === region.getAttribute("aria-labelledby"));
  return [...beside, ...around];
}

// Mitchell's walk of PR 510 at 6b6c841, against the C2 prototype.
describe("the sea's grid", () => {
  it("places every cell, the moments too, on whole grid units, with no two overlapping", WHOLE_SEA, () => {
    const screens = watchScreens();
    render(<LandingSea />);
    screens.nearAll();
    expect(areaOf(screen.getByRole("region", { name: "Plan the rest with the crew." }))).not.toBeNull();
    const placed = [...screen.getAllByTestId("sea-story"), ...screen.getAllByTestId("sea-cell")]
      .map((el) => areaOf(el))
      .filter((area) => area !== null);
    const cols = Number(screen.getByTestId("sea-grid").getAttribute("data-cols"));
    for (const area of placed) {
      expect(area.row).toBeGreaterThanOrEqual(1);
      expect(area.col + area.w - 1).toBeLessThanOrEqual(cols);
    }
    const overlaps = placed.flatMap((a, i) => placed.slice(i + 1).filter((b) => meet(a, b)).map((b) => [a, b]));
    expect(overlaps).toEqual([]);
  });

  it("packs the grid at every column count, whole, with no hole and no overlap", () => {
    for (let cols = 6; cols <= 20; cols++) {
      for (const viewport of [800, 1440]) {
        const layout = layoutSea({ cols, unit: 170, viewport });
        // Every day a moment lights finds its place, however narrow the grid.
        expect({ cols, viewport, lit: layout.lit.length }).toEqual({ cols, viewport, lit: 11 });
        const taken = Array.from({ length: layout.rows }, () => new Array<number>(cols).fill(0));
        const areas = [...Object.values(layout.stories), ...layout.lit.map((lit) => lit.at), ...layout.background.map((cell) => cell.at)];
        for (const at of areas) {
          for (const n of [at.row, at.col, at.w, at.h]) expect(Number.isInteger(n)).toBe(true);
          for (let r = at.row; r < at.row + at.h; r++) for (let c = at.col; c < at.col + at.w; c++) taken[r]![c]! += 1;
        }
        // The rows above are the first screen's, which CSS packs around the hero.
        const packed = taken.slice(FIRST_SCREEN_ROWS).flat();
        expect({ cols, viewport, holes: packed.filter((n) => n === 0).length, overlaps: packed.filter((n) => n > 1).length }).toEqual({
          cols,
          viewport,
          holes: 0,
          overlaps: 0,
        });
      }
    }
  });

  it("sets every day on its region's coloured mat, under the region's name", WHOLE_SEA, () => {
    const screens = watchScreens();
    render(<LandingSea />);
    screens.nearAll();
    const cells = screen.getAllByTestId("sea-cell");
    expect(cells.length).toBeGreaterThan(48);
    for (const cell of cells) {
      const region = SEA_REGIONS[cell.getAttribute("data-region")!];
      expect(region).toBeDefined();
      expect(cell.className.split(" ")).toContain(region!.mat);
      expect(within(cell).getByText(region!.label)).toBeDefined();
    }
  });

  it("draws 'Find a day worth borrowing.' as a cell of the grid, which stays risen once past the middle", () => {
    render(<LandingSea />);
    const find = screen.getByRole("region", { name: "Find a day worth borrowing." });
    expect(areaOf(find)).not.toBeNull();
    // Its middle a quarter of a screen above the screen's own: passed, and settled.
    vi.spyOn(find, "getBoundingClientRect").mockReturnValue({ top: -window.innerHeight / 2, height: window.innerHeight / 2 } as DOMRect);
    fireEvent.scroll(window);
    expect(within(find).getByTestId("moment-panel").style.opacity).toBe("1");
  });

  it("lights two or three days around each moment, apart from one another", () => {
    render(<LandingSea />);
    const counts = MOMENTS.map((name) => [name, litAround(name).length] as const);
    expect(counts.filter(([, n]) => n < 2 || n > 3)).toEqual([]);
    for (const name of MOMENTS) {
      const areas = litAround(name).map((cell) => areaOf(cell)!);
      expect(areas.flatMap((a, i) => areas.slice(i + 1).filter((b) => meet(a, b, 1)))).toEqual([]);
    }
  });
});
