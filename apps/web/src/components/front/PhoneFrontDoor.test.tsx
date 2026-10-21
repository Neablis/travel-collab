import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SEA_DAYS } from "@/lib/landingSea";
import { layoutSea, type SeaArea } from "./LandingSea";
import { PHONE_SEA, PhoneFrontDoor } from "./PhoneFrontDoor";

// The moments' real panels are `lazy()`-loaded; loaded here first so a cold
// worker's transform does not outrun `findBy*` (`LandingScreen.test.tsx`).
beforeAll(async () => {
  await import("./LandingFeaturePanels");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** An `IntersectionObserver` the test drives, which keeps the root each one watches against. */
function watchScreens() {
  const watched: { el: Element; root: Element | Document | null; callback: IntersectionObserverCallback; observer: IntersectionObserver }[] = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      callback: IntersectionObserverCallback;
      root: Element | Document | null;
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        this.callback = callback;
        this.root = options?.root ?? null;
      }
      observe(el: Element) {
        watched.push({ el, root: this.root, callback: this.callback, observer: this as never });
      }
      disconnect() {}
    },
  );
  return {
    roots: () => watched.map((w) => w.root),
    nearAll: () =>
      act(() => {
        for (const w of watched) w.callback([{ isIntersecting: true, target: w.el } as never], w.observer);
      }),
  };
}

/** A grid item's area from its inline placement (`grid-row: 9 / span 2`), 0-based like `SeaArea`, or null when it has none. */
function areaOf(el: HTMLElement): SeaArea | null {
  const row = /^(\d+) \/ span (\d+)$/.exec(el.style.gridRow);
  const col = /^(\d+) \/ span (\d+)$/.exec(el.style.gridColumn);
  return row && col ? { row: Number(row[1]) - 1, h: Number(row[2]), col: Number(col[1]) - 1, w: Number(col[2]) } : null;
}
const meet = (a: SeaArea, b: SeaArea, margin = 0) =>
  a.row < b.row + b.h + margin && b.row < a.row + a.h + margin && a.col < b.col + b.w + margin && b.col < a.col + a.w + margin;
/** Whether two areas that do not overlap share a stretch of edge, not just a corner. */
const touch = (a: SeaArea, b: SeaArea) =>
  ((a.row + a.h === b.row || b.row + b.h === a.row) && a.col < b.col + b.w && b.col < a.col + a.w) ||
  ((a.col + a.w === b.col || b.col + b.w === a.col) && a.row < b.row + b.h && b.row < a.row + a.h);

const savedDayIds = (scope: HTMLElement) => within(scope).queryAllByTestId("discover-card").map((card) => card.getAttribute("data-saved-day-id")!);

const MOMENTS = ["Find a day worth borrowing.", "Ask for more, keep what fits.", "Everyone going, one plan.", "Keep the notebook afterwards."];

/** The phone's scroller with the geometry jsdom lacks: `viewport` tall, scrolled to `scrollTop`, its top at the window's. */
function scrollTo(scrollTop: number, viewport = 800) {
  const scroller = screen.getByTestId("phone-front-door");
  Object.defineProperty(scroller, "clientHeight", { value: viewport, configurable: true });
  vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
  scroller.scrollTop = scrollTop;
  fireEvent.scroll(scroller);
}

// M51 decision 11: *"Could we keep the tiled background, and the embedded
// cards from the elements as i suggested in the mobile version?"* The phone
// is the desktop's sea on a grid of two columns, not a pinned sequence.
describe("the phone sea", () => {
  it("tiles its first screen from the snapshot, on whole units of two columns, in the server's HTML", () => {
    const html = renderToString(<PhoneFrontDoor />);
    render(<PhoneFrontDoor />);
    const sea = screen.getByTestId("phone-sea");
    const cells = within(sea).getAllByTestId("sea-cell");
    expect(cells.length).toBeGreaterThan(4);
    const library = new Set(SEA_DAYS.map((cell) => cell.day.savedDayId));
    const ground = cells.filter((cell) => cell.getAttribute("aria-hidden") === "true");
    expect(ground.length).toBeGreaterThan(4);
    for (const cell of ground) {
      const id = within(cell).getByTestId("discover-card").getAttribute("data-saved-day-id")!;
      expect(library.has(id)).toBe(true);
      expect(html).toContain(`data-saved-day-id="${id}"`);
    }
    const placed = [screen.getByTestId("sea-hero"), ...cells, ...within(sea).queryAllByTestId("sea-accent"), ...within(sea).getAllByTestId("sea-story")].map(
      (el) => areaOf(el),
    );
    expect(placed).not.toContain(null);
    const areas = placed as SeaArea[];
    for (const at of areas) expect(at.col + at.w).toBeLessThanOrEqual(2);
    expect(areas.flatMap((a, i) => areas.slice(i + 1).filter((b) => meet(a, b)))).toEqual([]);
    // The headline is the first screen's: in the hero, the second row.
    expect(areaOf(screen.getByTestId("sea-hero"))).toEqual({ row: 1, col: 0, w: 2, h: PHONE_SEA.hero!.h });
  });

  // Mitchell's walks of PR 510, met on a phone: whole units with no hole, the
  // moments full width and no taller than a short phone's screen, two lit
  // days touching each and apart, and no column three tall.
  it("packs a phone's grid whole at every phone size, its moments full width with two lit days touching each", () => {
    for (const width of [360, 390, 430]) {
      for (const viewport of [640, 844, 932]) {
        const unit = (width - 2 * 16 - 8) / 2;
        const layout = layoutSea({ cols: 2, unit, viewport }, PHONE_SEA);
        const at = { width, viewport };
        const taken = Array.from({ length: layout.rows }, () => [0, 0]);
        const areas = [PHONE_SEA.hero!, ...Object.values(layout.stories), ...layout.lit.map((lit) => lit.at), ...layout.background.map((cell) => cell.at)];
        for (const area of areas) for (let r = area.row; r < area.row + area.h; r++) for (let c = area.col; c < area.col + area.w; c++) taken[r]![c]! += 1;
        expect({ ...at, holes: taken.flat().filter((n) => n === 0).length, overlaps: taken.flat().filter((n) => n > 1).length }).toEqual({ ...at, holes: 0, overlaps: 0 });
        expect({ ...at, tall: layout.background.filter((cell) => cell.at.h > 2).length }).toEqual({ ...at, tall: 0 });
        for (const [id, story] of Object.entries(layout.stories)) {
          expect({ ...at, id, w: story.w }).toEqual({ ...at, id, w: 2 });
        }
        for (const moment of ["sea-find", "sea-assistant", "sea-crew", "sea-notebook"] as const) {
          const box = layout.stories[moment];
          expect({ ...at, moment, rows: box.h <= 3 }).toEqual({ ...at, moment, rows: true });
          const lit = layout.lit.filter((day) => day.moment === moment).map((day) => day.at);
          expect({ ...at, moment, lit: lit.length, touching: lit.every((day) => touch(day, box)) }).toEqual({ ...at, moment, lit: 2, touching: true });
          expect(meet(lit[0]!, lit[1]!, 1)).toBe(false);
        }
      }
    }
  });

  it("raises each moment out of its ghost by the scroller's position, and dims the sea behind it", () => {
    render(<PhoneFrontDoor />);
    const moment = screen.getByRole("region", { name: "Everyone going, one plan." });
    const panel = within(moment).getByTestId("moment-panel");
    const at = (top: number) => {
      vi.spyOn(moment, "getBoundingClientRect").mockReturnValue({ top, height: 500 } as DOMRect);
      scrollTo(4000);
      return Number(panel.style.opacity);
    };
    // Coming up from the scroller's foot: a ghost of the real panel.
    const below = at(760);
    expect(below).toBeGreaterThan(0);
    expect(below).toBeLessThan(1);
    // At the screen's middle, wholly risen; leaving at the top, a ghost again.
    expect(at(150)).toBe(1);
    const leaving = at(-300);
    expect(leaving).toBeGreaterThan(0);
    expect(leaving).toBeLessThan(1);
    // Off the scroller's screen, not drawn.
    expect(at(-600)).toBe(0);
    expect(screen.getByTestId("sea-scrim").style.getPropertyValue("--sea-dim")).toBe("1");
    scrollTo(0);
    expect(screen.getByTestId("sea-scrim").style.getPropertyValue("--sea-dim")).toBe("0");
  });

  // iOS momentum scroll stutters inside an `overflow-y-auto` scroller with
  // many cards mounted. The scroller, not the window, is what the reader is
  // near: the window never scrolls here.
  it("mounts a far screen's cells only once the reader is near it in the scroller", () => {
    const screens = watchScreens();
    render(<PhoneFrontDoor />);
    const sea = screen.getByTestId("phone-sea");
    const before = new Set(savedDayIds(sea));
    expect(before.size).toBeLessThan(40);
    expect(screens.roots().length).toBeGreaterThan(0);
    for (const root of screens.roots()) expect(root).toBe(screen.getByTestId("phone-front-door"));
    screens.nearAll();
    expect(savedDayIds(sea).filter((id) => !before.has(id)).length).toBeGreaterThan(10);
  });

  it("reads the headline, then the moments, then pricing and the closing cell, with no background card in the accessibility tree", async () => {
    render(<PhoneFrontDoor />);
    const main = within(within(screen.getByTestId("phone-front-door")).getByRole("main"));
    const headings = main.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(main.getByRole("heading", { level: 1 }).textContent).toBe("Plan the trip together.");
    expect(headings.filter((heading) => [...MOMENTS, "Start the plan, then bring everyone."].includes(heading!))).toEqual([
      ...MOMENTS,
      "Start the plan, then bring everyone.",
    ]);
    const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    const pricing = main.getByRole("region", { name: "Pricing" });
    expect(before(main.getByRole("region", { name: MOMENTS[3]! }), pricing)).toBe(true);
    expect(before(pricing, main.getByRole("region", { name: "Start the plan, then bring everyone." }))).toBe(true);
    // The background is ground: the only day links a reader meets are the moments' and their lit days'.
    const lit = within(screen.getByTestId("phone-sea"))
      .getAllByTestId("sea-cell")
      .filter((cell) => cell.hasAttribute("data-lit-for"));
    expect(lit.length).toBe(8);
    const find = main.getByRole("region", { name: MOMENTS[0]! });
    expect(await within(find).findAllByRole("link")).not.toEqual([]);
    const doors = main.getAllByRole("link").filter((link) => link.getAttribute("href")!.startsWith("/playbooks/day/"));
    expect(doors.filter((door) => !find.contains(door) && !lit.some((cell) => cell.contains(door)))).toEqual([]);
  });

  // WCAG 2.4.3, PR 516's review: each moment lights a day above it and one
  // below, and Tab meets them as the eye does, never jumping back up the page.
  it("tabs through the moments and their lit days from the top of the sea down", async () => {
    render(<PhoneFrontDoor />);
    const sea = within(screen.getByTestId("phone-sea"));
    expect(await within(screen.getByRole("region", { name: MOMENTS[0]! })).findAllByRole("link")).not.toEqual([]);
    const placed = [screen.getByTestId("sea-hero"), ...sea.getAllByTestId("sea-story"), ...sea.getAllByTestId("sea-cell").filter((cell) => cell.hasAttribute("data-lit-for"))];
    const rows = sea.getAllByRole("link").map((link) => areaOf(placed.find((item) => item.contains(link))!)!.row);
    expect(rows.length).toBeGreaterThan(8);
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
  });
});

// The shell the pinned sequence had, kept: its own scroller under a sticky
// bar, the hash answered by the scroller, and the footer.
describe("the phone front door's shell", () => {
  it("holds the headline and the calls to action in a main landmark, between the banner and the footer", () => {
    render(<PhoneFrontDoor />);
    const main = within(within(screen.getByTestId("phone-front-door")).getByRole("main"));
    expect(main.getByRole("heading", { level: 1, name: "Plan the trip together." })).toBeTruthy();
    const hero = within(screen.getByTestId("sea-hero"));
    expect(hero.getByRole("link", { name: "Start a trip" }).getAttribute("href")).toBe("/signup");
    expect(hero.getByRole("link", { name: "Look around a real trip" }).getAttribute("href")).toBe("/demo");
  });

  // M42 D3. The desktop tree owns the `pricing` id — two elements cannot share
  // one — and comes second in the document, so a browser following
  // `/#pricing` at phone width finds the hidden desktop section and scrolls
  // nowhere. The phone front door answers the hash itself, by scrolling its
  // own scroller and nothing else.
  describe("#pricing", () => {
    const scrolled: { el: Element; top: number | undefined }[] = [];
    beforeEach(() => {
      scrolled.length = 0;
      // jsdom implements no scrolling, so the call is recorded instead.
      Element.prototype.scrollTo = function (this: Element, options?: ScrollToOptions | number) {
        scrolled.push({ el: this, top: typeof options === "object" ? options.top : undefined });
      } as Element["scrollTo"];
    });
    afterEach(() => {
      window.history.replaceState(null, "", window.location.pathname);
      delete (Element.prototype as Partial<Element>).scrollTo;
    });

    it("scrolls its own scroller when the page is opened at #pricing", () => {
      window.history.replaceState(null, "", "#pricing");
      render(<PhoneFrontDoor />);
      expect(scrolled.map(({ el }) => el)).toEqual([screen.getByTestId("phone-front-door")]);
    });

    // Pricing is a cell of the sea, second to last as on the desktop (M51
    // decision 10), and the hash lands its "Pricing" line just under the
    // sticky bar (PR 516's review).
    it("lands the sea's pricing just under the sticky bar when the hash changes to #pricing", () => {
      render(<PhoneFrontDoor />);
      const door = screen.getByTestId("phone-front-door");
      const stories = within(screen.getByTestId("phone-sea")).getAllByTestId("sea-story");
      const pricing = within(stories.at(-2)!).getByRole("region", { name: "Pricing" });
      door.scrollTop = 100;
      vi.spyOn(door, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
      vi.spyOn(pricing, "getBoundingClientRect").mockReturnValue({ top: 5000 } as DOMRect);
      Object.defineProperty(within(door).getByRole("banner"), "offsetHeight", { value: 64 });

      window.history.replaceState(null, "", "#pricing");
      fireEvent(window, new HashChangeEvent("hashchange"));

      expect(scrolled).toEqual([{ el: door, top: 100 + 5000 - 64 }]);
    });

    // Mitchell, 2026-10-11: the front door summarises the plans and leaves
    // the specifics to `/plans`.
    it("summarises the plans and sends the specifics to /plans", () => {
      render(<PhoneFrontDoor />);
      const door = within(screen.getByTestId("phone-front-door"));
      const pricing = within(door.getByRole("region", { name: "Pricing" }));
      expect(pricing.queryByRole("table")).toBeNull();
      expect(pricing.getAllByTestId("plan-step")).toHaveLength(2);
      expect(pricing.getByRole("link", { name: "Compare plans" }).getAttribute("href")).toBe("/signin?callbackUrl=%2Fplans");
      expect(door.queryByRole("link", { name: "Sign up" })).toBeNull();
    });
  });

  it("links the playbook library and sign-in from the header", () => {
    render(<PhoneFrontDoor />);
    const header = within(within(screen.getByTestId("phone-front-door")).getByRole("banner"));
    expect(header.getByRole("link", { name: "Playbooks" }).getAttribute("href")).toBe("/playbooks");
    expect(header.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/signin");
  });

  it("ends the sea on the closing cell's two ways in", () => {
    render(<PhoneFrontDoor />);
    const closing = within(within(screen.getByTestId("phone-front-door")).getByRole("region", { name: "Start the plan, then bring everyone." }));
    expect(closing.getByRole("link", { name: "Start a trip" }).getAttribute("href")).toBe("/signup");
    expect(closing.getByRole("link", { name: "Find a day to start with" }).getAttribute("href")).toBe("/playbooks");
  });

  it("ends on the same footer as the desktop landing", () => {
    render(<PhoneFrontDoor />);
    const footer = within(within(screen.getByTestId("phone-front-door")).getByRole("contentinfo"));
    expect(footer.getByRole("link", { name: "mitchell@demarcosoftware.com" }).getAttribute("href")).toBe("mailto:mitchell@demarcosoftware.com");
    expect(footer.getByRole("link", { name: "Developers" }).getAttribute("href")).toBe("/developers");
  });
});
