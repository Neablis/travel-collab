import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { playbookIdFor } from "@tc/fixtures";
import { LANDING_FEATURES } from "@/lib/landingDemo";
import { LANDING_SEA, SEA_ACCENTS, SEA_DAYS } from "@/lib/landingSea";
import { dayPath, parseDaySegment } from "@/lib/playbookUrls";
import { FIRST_SCREEN, FIRST_SCREEN_ROWS, HERO, LandingSea, SEA_REGIONS, firstScreenAccents, layoutSea, momentRise, seaDim, type SeaArea } from "./LandingSea";

/** The first screen's days, without its accents. */
const FIRST_DAYS = FIRST_SCREEN.flatMap((ground) => (ground.cell === undefined ? [] : [ground.cell]));

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
/** The background's days, which no moment lights or raises. */
const backgroundNames = (lit: Set<string>) =>
  [...new Set(FIRST_DAYS.filter((cell) => !lit.has(cell.day.savedDayId)).map((cell) => cell.day.name))].filter(
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
    const near = new Set([...FIRST_DAYS.map((cell) => cell.day.savedDayId), ...lit]);
    for (const id of near) expect(html).toContain(`data-saved-day-id="${id}"`);
    const far = SEA_DAYS.filter((cell) => !near.has(cell.day.savedDayId));
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
    // Every lit day is a door, and a tab stop.
    const doors = lit.filter((cell) => cell.getAttribute("aria-hidden") === null);
    expect(doors.length).toBe(lit.length);
    for (const cell of doors) {
      for (const link of within(cell).queryAllByRole("link")) expect(link.getAttribute("tabindex")).toBeNull();
    }
  });

  it("mounts a far screen's cells once the reader is near it", WHOLE_SEA, () => {
    const screens = watchScreens();
    render(<LandingSea />);
    const before = screen.getAllByTestId("sea-cell").length;
    const known = new Set([...FIRST_DAYS.map((cell) => cell.day.savedDayId), ...litCells().map(dayOf), LANDING_FEATURES.shelf.savedDayId]);
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
    const dayLinks = sea.getAllByRole("link", { hidden: true }).filter((link) => link.getAttribute("href")!.startsWith("/playbooks/day/"));
    expect(dayLinks.length).toBeGreaterThan(FIRST_DAYS.length);
    const canonical = new Set(SEA_DAYS.map((cell) => cell.href));
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
    const background = FIRST_DAYS[0]!;
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
  it("finds a day: the banner day as a big card, one door to its page", async () => {
    render(<LandingSea />);
    const find = within(screen.getByRole("region", { name: "Find a day worth borrowing." }));
    expect(await find.findAllByRole("link", { name: LANDING_FEATURES.shelf.name })).toHaveLength(1);
    const links = screen.getAllByRole("link", { name: LANDING_FEATURES.shelf.name });
    expect(links.map((link) => link.getAttribute("href"))).toEqual([dayPath(LANDING_FEATURES.shelf)]);
  });

  // Mitchell's fourth walk of PR 510: "Lets use these rome days for the card
  // and the accent cards around it". The banner is his Rome playbook, the one
  // whose day 1 is the Colosseum, and the days lit beside it are his
  // Florence, Amalfi and Bologna ones.
  it("finds his Rome day, with his Florence, Amalfi and Bologna days lit around it", async () => {
    render(<LandingSea />);
    const rome = "3-days-in-rome-emperors-gladiators-the-layers-beneath";
    const find = within(screen.getByRole("region", { name: "Find a day worth borrowing." }));
    expect((await find.findByRole("link", { name: LANDING_FEATURES.shelf.name })).getAttribute("href")).toBe(
      SEA_DAYS.find((cell) => cell.day.savedDayId === playbookIdFor(rome, rome))?.href,
    );
    const lit = litCells().filter((cell) => cell.getAttribute("data-lit-for") === "sea-find");
    expect(lit.map((cell) => cell.getAttribute("data-region")).sort()).toEqual([
      "3-days-in-bologna-tortellini-mortadella-market-mornings",
      "3-days-in-florence-renaissance-art-workshops-the-oltrarno",
      "3-days-on-the-amalfi-coast-cliff-towns-lemon-groves-the-path-of-the-gods",
    ]);
  });

  // Mitchell's third walk of PR 510: "The banner to left is the same activity
  // to right, use different activities". A lit day is another day of the
  // moment's region, never the one the moment itself shows, nor one named
  // like it; and no day is lit for two moments.
  it("lights no moment with its own day again", () => {
    render(<LandingSea />);
    const make = screen.getByRole("region", { name: /^Start a trip using someone else’s Thailand day/ });
    const railay = parseDaySegment(within(make).getByRole("link", { name: "Make this your trip" }).getAttribute("href")!.slice("/playbooks/day/".length)).id;
    const own: Record<string, string> = {
      "sea-find": LANDING_FEATURES.shelf.savedDayId,
      "sea-make": railay!,
      "sea-crew": LANDING_FEATURES.crew.borrowed.savedDayId,
    };
    const nameOf = (id: string) => SEA_DAYS.find((cell) => cell.day.savedDayId === id)!.day.name;
    const repeats = litCells()
      .filter((cell) => own[cell.getAttribute("data-lit-for")!] !== undefined)
      .map((cell) => ({ moment: cell.getAttribute("data-lit-for")!, id: dayOf(cell) }))
      .filter(({ moment, id }) => id === own[moment] || nameOf(id) === nameOf(own[moment]!));
    expect(repeats).toEqual([]);
    const ids = litCells().map(dayOf);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Mitchell's third walk of PR 510: "This card is still too empty". The
  // make moment shows "Add to a trip"'s own fields for the Railay day, landing
  // it on Day 1 of a trip the reader has: one "Which trip", one sentence that
  // agrees with it (PR 510 r6: two forms named alike, and "appended at the
  // end" under "this day is day 1").
  it("makes it your trip, under the heading Mitchell gave it, with the add-to-trip choice worked through", async () => {
    render(<LandingSea />);
    const make = within(
      screen.getByRole("region", { name: "Start a trip using someone else’s Thailand day, or add it to an existing plan." }),
    );
    const href = make.getByRole("link", { name: "Make this your trip" }).getAttribute("href")!;
    expect(SEA_DAYS.find((cell) => cell.href === href)!.day.name).toMatch(/^Railay/);
    const trips = await make.findAllByRole("combobox", { name: "Which trip" });
    expect(trips.map((select) => (select as HTMLSelectElement).selectedOptions[0]!.textContent)).toEqual([LANDING_FEATURES.make.trip.name]);
    expect((make.getByRole("combobox", { name: "Which day" }) as HTMLSelectElement).selectedOptions[0]!.textContent).toBe("Day 1");
    expect(make.getByText(/The day lands on Day 1/)).toBeDefined();
    expect(make.queryByText(/appended at the end/)).toBeNull();
  });

  // The example submits nothing, so a keyboard passes over it to the
  // moment's one way in (PR 510 r6: seven tab stops that did nothing).
  it("keeps the make moment's worked example out of the tab order", WHOLE_SEA, async () => {
    render(<LandingSea />);
    const region = screen.getByRole("region", { name: "Start a trip using someone else’s Thailand day, or add it to an existing plan." });
    await within(region).findByRole("combobox", { name: "Which day" });
    // Every stop Tab lands on inside the moment, once round the whole sea
    // (Tab wraps, so the count only needs to be past the sea's stops).
    const stops = new Set<string>();
    region.addEventListener("focusin", (event) => {
      const at = event.target as HTMLElement;
      stops.add(at.getAttribute("aria-label") ?? at.textContent ?? at.tagName);
    });
    for (let i = 0; i < 60; i++) await userEvent.tab();
    expect([...stops]).toEqual(["Make this your trip"]);
  });

  it("puts the crew on the Greek trip's borrowed Day 2, with the Greek days lit around it", async () => {
    const screens = watchScreens();
    render(<LandingSea />);
    const region = screen.getByRole("region", { name: "Everyone going, one plan." });
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
  });

  // Mitchell's walk of PR 510 at 7260011: "i dont like crew here". The names
  // on each stop carry the together; the heading leads with the shared plan.
  // Read once the real panel has landed, and in its labels as well as its
  // text (PR 510 r5: the placeholder alone passed).
  it("says who is going without the word crew", async () => {
    const screens = watchScreens();
    render(<LandingSea />);
    const region = screen.getByRole("region", { name: "Everyone going, one plan." });
    screens.near(region);
    await within(region).findByRole("list", { name: "Day 2 timeline" });
    expect(region.textContent).not.toMatch(/crew/i);
    const labels = [region, ...within(region).queryAllByLabelText(/./)].flatMap((el) =>
      ["aria-label", "aria-description", "title"].map((name) => el.getAttribute(name) ?? ""),
    );
    expect(labels.filter((label) => /crew/i.test(label))).toEqual([]);
  });

  // Mitchell's third walk of PR 510: "looks too fake, not lived in enough …
  // clip it at bottom so it fades out at the real edge", and "the 3 people
  // going as icons at bottom doesnt make sense". The page runs past its cell
  // under a fade, and no list of names signs it.
  it("keeps the notebook afterwards, a long page faded out at the cell's foot, with the Japan days lit around it", async () => {
    const screens = watchScreens();
    render(<LandingSea />);
    const region = screen.getByRole("region", { name: "Keep the notebook afterwards." });
    screens.near(region);
    const page = await within(region).findByTestId("notebook-page");
    expect(page.className.split(" ")).toEqual(expect.arrayContaining(["landing-sea-fade", "overflow-hidden"]));
    const people = Object.values(LANDING_FEATURES.crew.personas).map((persona) => persona.name);
    const signed = within(page)
      .queryAllByRole("listitem")
      .filter((item) => [...people, "Priya", "Jonah", "Mei", "Sam"].includes(item.textContent!.trim()));
    expect(signed).toEqual([]);
    expect(within(page).getAllByRole("heading").length).toBeGreaterThanOrEqual(3);
    // Mitchell's fourth walk: *"add a header to the sunrise sunset widget, its
    // not clear thats what it is"*, in the widget's own title from the picker.
    expect(within(page).getAllByRole("heading", { name: "Sunrise and sunset" })).toHaveLength(1);
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

  // Mitchell's walk of PR 510 at 7260011: a moment at rest is "a ghostly
  // faded out version of the full thing", which fades in as it enters and
  // out again as it leaves, at the top edge as at the bottom.
  it("raises a moment from its ghost as it comes up the screen, and lowers it again as it leaves at the top", () => {
    const below = momentRise(950, 400, 1000);
    expect(below.opacity).toBeGreaterThan(0);
    expect(below.opacity).toBeLessThan(1);
    expect(below.dy).toBeGreaterThan(0);
    expect(momentRise(300, 400, 1000)).toEqual({ opacity: 1, dy: 0, lift: 1 });
    const leaving = momentRise(-150, 400, 1000);
    expect(leaving.opacity).toBeGreaterThan(below.opacity);
    expect(leaving.opacity).toBeLessThan(1);
    expect(momentRise(-350, 400, 1000).opacity).toBe(below.opacity);
    // Wholly off the screen, at either edge, it is not drawn at all.
    expect([momentRise(1000, 400, 1000).opacity, momentRise(-400, 400, 1000).opacity]).toEqual([0, 0]);
  });

  it("starts from the rest state in the markup, and follows the scroll", () => {
    // The server's HTML, which no effect has painted: the sea undimmed and
    // every moment risen, with no opacity of its own.
    const html = renderToString(<LandingSea />);
    expect(html).toContain("--sea-dim:0");
    expect(html).not.toMatch(/data-rise[^>]*opacity/);
    expect(html).not.toMatch(/opacity[^>]*data-rise/);

    render(<LandingSea />);
    const scrim = screen.getByTestId("sea-scrim");

    const moment = screen.getByRole("region", { name: "Everyone going, one plan." });
    vi.spyOn(moment, "getBoundingClientRect").mockReturnValue({ top: window.innerHeight - 40, height: 400 } as DOMRect);
    vi.spyOn(window, "scrollY", "get").mockReturnValue(window.innerHeight * 3);
    fireEvent.scroll(window);
    expect(scrim.style.getPropertyValue("--sea-dim")).toBe("1");
    // Written on the scrim, which holds no card: an inherited property set on
    // an ancestor of the cells restyles every mounted card on every scroll
    // event (115ms a frame with 650 mounted at 3440, PR 510 r4).
    expect(within(scrim).queryAllByTestId("sea-cell")).toEqual([]);
    for (const ancestor of [screen.getByTestId("landing-sea"), screen.getByTestId("sea-grid")]) {
      expect(ancestor.style.getPropertyValue("--sea-dim")).toBe("");
    }
    // A ghost of the real panel with nothing laid over it: no stamp of the
    // heading in white on the region's mat, which read as a colour cover.
    const ghost = Number(within(moment).getByTestId("moment-panel").style.opacity);
    expect(ghost).toBeGreaterThan(0);
    expect(ghost).toBeLessThan(1);
    expect(within(moment).getAllByText("Everyone going, one plan.")).toHaveLength(1);
    expect(moment.className.split(" ")).not.toContain(SEA_REGIONS["greek-islands"]!.mat);
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
/** Whether two areas that do not overlap share a stretch of edge, not just a corner. */
const touch = (a: SeaArea, b: SeaArea) =>
  ((a.row + a.h === b.row || b.row + b.h === a.row) && a.col < b.col + b.w && b.col < a.col + a.w) ||
  ((a.col + a.w === b.col || b.col + b.w === a.col) && a.row < b.row + b.h && b.row < a.row + a.h);

const MOMENTS = [
  "Find a day worth borrowing.",
  "Start a trip using someone else’s Thailand day, or add it to an existing plan.",
  "Everyone going, one plan.",
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
    expect(areaOf(screen.getByRole("region", { name: "Everyone going, one plan." }))).not.toBeNull();
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
        expect({ cols, viewport, lit: layout.lit.length }).toEqual({ cols, viewport, lit: 12 });
        const taken = Array.from({ length: layout.rows }, () => new Array<number>(cols).fill(0));
        const areas = [...Object.values(layout.stories), ...layout.lit.map((lit) => lit.at), ...layout.background.map((cell) => cell.at)];
        for (const at of areas) {
          for (const n of [at.row, at.col, at.w, at.h]) expect(Number.isInteger(n)).toBe(true);
          for (let r = at.row; r < at.row + at.h; r++) for (let c = at.col; c < at.col + at.w; c++) taken[r]![c]! += 1;
        }
        // The rows above are the first screen's, which CSS packs around the hero.
        // Every lit day shares an edge with its own moment, never rows off
        // (Mitchell's walk of PR 510 at 7260011).
        const loose = layout.lit.filter(({ moment, at }) => !touch(at, layout.stories[moment])).map(({ moment, at }) => `${moment} ${at.row},${at.col}`);
        expect({ cols, viewport, loose }).toEqual({ cols, viewport, loose: [] });
        // And no story or lit day touches another story's group, so no day
        // reads as the wrong moment's.
        const groups = Object.entries(layout.stories).map(([id, at]) => [at, ...layout.lit.filter((lit) => lit.moment === id).map((lit) => lit.at)]);
        const touching = groups.flatMap((group, i) =>
          groups.slice(i + 1).flatMap((other) => group.flatMap((a) => other.filter((b) => meet(a, b, 1)).map((b) => `${a.row},${a.col} ${b.row},${b.col}`))),
        );
        expect({ cols, viewport, touching }).toEqual({ cols, viewport, touching: [] });
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

  it("draws 'Find a day worth borrowing.' as a cell of the grid, risen at the screen's middle, its lit days with it", () => {
    render(<LandingSea />);
    const find = screen.getByRole("region", { name: "Find a day worth borrowing." });
    expect(areaOf(find)).not.toBeNull();
    const panel = within(find).getByTestId("moment-panel");
    const veils = () =>
      litCells()
        .filter((cell) => cell.getAttribute("data-lit-for") === "sea-find")
        .map((cell) => Number(within(cell).getByTestId("lit-veil").style.opacity));
    vi.spyOn(window, "scrollY", "get").mockReturnValue(window.innerHeight * 3);
    // Its middle at the screen's: risen, and its days lit.
    vi.spyOn(find, "getBoundingClientRect").mockReturnValue({ top: window.innerHeight / 4, height: window.innerHeight / 2 } as DOMRect);
    fireEvent.scroll(window);
    expect(panel.style.opacity).toBe("1");
    expect(veils()).toEqual([0, 0, 0]);
    // All but gone past the top: a ghost again, and its days dimmed with the sea.
    vi.spyOn(find, "getBoundingClientRect").mockReturnValue({ top: 40 - window.innerHeight / 2, height: window.innerHeight / 2 } as DOMRect);
    fireEvent.scroll(window);
    expect(Number(panel.style.opacity)).toBeLessThan(1);
    expect(veils().map((veil) => veil > 0)).toEqual([true, true, true]);
  });

  it("lights two or three days around each moment, apart from one another, and tabs through them down the page", () => {
    render(<LandingSea />);
    const counts = MOMENTS.map((name) => [name, litAround(name).length] as const);
    expect(counts.filter(([, n]) => n < 2 || n > 3)).toEqual([]);
    for (const name of MOMENTS) {
      const areas = litAround(name).map((cell) => areaOf(cell)!);
      expect(areas.flatMap((a, i) => areas.slice(i + 1).filter((b) => meet(a, b, 1)))).toEqual([]);
      // In the DOM, and so in Tab order, as the eye reads them: a lit day
      // above the moment's foot is not reached after one below it (PR 510 r4).
      expect(areas).toEqual([...areas].sort((a, b) => a.row - b.row || a.col - b.col));
    }
  });
});

// Mitchell's third walk of PR 510, at 8a5c8fa, on 3440×1271 and 1718×1270.
describe("the sea at Mitchell's third walk", () => {
  /** The grid at a window this wide and tall, as `LandingSea` measures it: about one column per 180px. */
  const metricsAt = (width: number, viewport: number) => {
    const cols = Math.max(6, Math.round((width - 32) / 180));
    return { cols, unit: (width - 32 - (cols - 1) * 8) / cols, viewport };
  };
  const SCREENS = [metricsAt(1440, 900), metricsAt(1718, 1270), metricsAt(3440, 1271), metricsAt(3440, 1440), metricsAt(1100, 900)];
  const ORDER = ["sea-find", "sea-make", "sea-crew", "sea-notebook"] as const;

  // "you should just be seeing the last fading out when the next scrolls
  // in": as the next moment comes onto the screen at its foot, the last is
  // past the screen's middle and part way sunk, neither risen nor gone.
  // Not at six columns (1100px): there a four-row moment has room for two
  // lit days beside it, and its third, below it, holds the next a row back.
  it("brings each moment onto the screen while the last is still fading out", () => {
    for (const metrics of SCREENS.filter(({ cols }) => cols > 6)) {
      const layout = layoutSea(metrics);
      const step = metrics.unit + 8;
      const height = (at: SeaArea) => at.h * step - 8;
      const late = ORDER.slice(1).flatMap((id, i) => {
        const [last, next] = [layout.stories[ORDER[i]!], layout.stories[id]];
        // Scrolled so the next moment's top is one pixel onto the screen.
        const top = (last.row - next.row) * step + metrics.viewport - 1;
        const { lift } = momentRise(top, height(last), metrics.viewport);
        const sinking = top + height(last) / 2 < metrics.viewport / 2;
        return sinking && lift > 0 && lift < 1 ? [] : [`${ORDER[i]} at ${lift.toFixed(2)} as ${id} comes in`];
      });
      expect({ ...metrics, late }).toEqual({ ...metrics, late: [] });
    }
  });

  // "For the ultra wide display, can we try to always keep at least one
  // section in the middle? So for "Start a trip" its slightly too far to
  // left by 2 squares".
  it("centres every story on an ultra-wide grid", () => {
    for (let cols = 14; cols <= 20; cols++) {
      const { stories } = layoutSea({ cols, unit: 175, viewport: 1271 });
      const off = Object.entries(stories)
        .filter(([, at]) => 2 * at.col + at.w !== cols)
        .map(([id, at]) => `${id} at ${at.col}+${at.w}`);
      expect({ cols, off }).toEqual({ cols, off: [] });
    }
  });

  // "Two many of these 1x3, use 1x3 very sparringly, they look a bit ugly".
  it("draws one cell in forty at most as a column three tall", () => {
    for (const metrics of SCREENS) {
      const shapes = layoutSea(metrics).background.map(({ at }) => `${at.w}x${at.h}`);
      const tall = shapes.filter((shape) => shape === "1x3").length;
      expect({ ...metrics, capped: tall <= shapes.length / 40 }).toEqual({ ...metrics, capped: true });
    }
  });

  // "This card is too tall, Cut it one row shorter": four rows at 1440,
  // with or without a scrollbar taking its 15px.
  it("draws the crew moment four rows tall at 1440", () => {
    for (const width of [1440, 1425]) {
      expect({ width, rows: layoutSea(metricsAt(width, 900)).stories["sea-crew"].h }).toEqual({ width, rows: 4 });
    }
  });

  // Mitchell's fourth walk, at 1304×822: *"Too much dead space, shrink the
  // the whole container down 1 row"*. Three rows at every width, from the
  // narrowest unit (1202px, seven columns) to the widest (1201px, six).
  it("draws the pricing three rows tall, one fewer than its four, at every width", () => {
    for (const metrics of [...SCREENS, metricsAt(1304, 822), metricsAt(1201, 900), metricsAt(1202, 900)]) {
      expect({ ...metrics, rows: layoutSea(metrics).stories.pricing.h }).toEqual({ ...metrics, rows: 3 });
    }
  });

  // "we are missing this nice accent full color cards with Country - city
  // … link to those pages if you click there". About one cell in eight to
  // twelve, a single or a wide one, never two touching, and never lit.
  it("scatters accents through the background, about one cell in ten, apart from one another", () => {
    expect(SEA_ACCENTS.length).toBeGreaterThan(0);
    for (const metrics of SCREENS) {
      const { background } = layoutSea(metrics);
      const accents = background.filter((ground) => ground.accent !== undefined).map(({ at }) => at);
      const share = accents.length / background.length;
      expect({ ...metrics, share: share >= 1 / 12 && share <= 1 / 8 }).toEqual({ ...metrics, share: true });
      expect(accents.filter((at) => at.h !== 1 || at.w > 2)).toEqual([]);
      expect(accents.flatMap((a, i) => accents.slice(i + 1).filter((b) => meet(a, b, 1)))).toEqual([]);
    }
    const first = FIRST_SCREEN.filter((ground) => ground.accent !== undefined).length / FIRST_SCREEN.length;
    expect(first >= 1 / 12 && first <= 1 / 8).toBe(true);
  });

  // The first screen's accents, which CSS packs, and the background's, which
  // `layoutSea` packs below them, at every column count (PR 510 r6: at 3440,
  // France sat on Mexico). responsive.spec.ts checks the browser's packing.
  it("keeps every accent clear of every other, the first screen's too, at every column count", () => {
    for (let cols = 6; cols <= 20; cols++) {
      const below = layoutSea({ cols, unit: 175, viewport: 1271 })
        .background.filter((ground) => ground.accent !== undefined)
        .map(({ at }) => at);
      const accents = [...firstScreenAccents(cols), ...below];
      const touching = accents.flatMap((a, i) => accents.slice(i + 1).filter((b) => meet(a, b, 1)).map((b) => `${a.row},${a.col} ${b.row},${b.col}`));
      expect({ cols, touching }).toEqual({ cols, touching: [] });
    }
  });

  // `HERO` is the first screen's packing's copy of globals.css's `--hero-*`.
  it("places the hero where globals.css does, at every column count", () => {
    const css = readFileSync(resolve(__dirname, "../../app/globals.css"), "utf8");
    const blocks = [...css.matchAll(/--cols: (\d+);\s*(?:\/\*[^*]*\*\/\s*)?--hero-span: (\d+);\s*--hero-start: (\d+);\s*--hero-rows: (\d+);/g)];
    const fromCss = Object.fromEntries(blocks.map(([, cols, span, start, rows]) => [Number(cols), [Number(start), Number(span), Number(rows)]]));
    expect(fromCss).toEqual(HERO);
  });

  it("links every accent to its page, out of the tab order like the background around it", WHOLE_SEA, () => {
    const screens = watchScreens();
    render(<LandingSea />);
    screens.nearAll();
    const accents = screen.getAllByTestId("sea-accent");
    expect(accents.length).toBeGreaterThan(0);
    const pages = new Set(SEA_ACCENTS.map((accent) => accent.href));
    for (const accent of accents) {
      expect(accent.getAttribute("aria-hidden")).toBe("true");
      expect(accent.hasAttribute("data-lit-for")).toBe(false);
      const link = within(accent).getByRole("link", { hidden: true });
      expect(link.getAttribute("tabindex")).toBe("-1");
      expect(link.getAttribute("href")).toMatch(/^\/playbooks\/(country|city|tag)\/[a-z0-9-]+$/);
      expect(pages.has(link.getAttribute("href")!)).toBe(true);
    }
  });
});
