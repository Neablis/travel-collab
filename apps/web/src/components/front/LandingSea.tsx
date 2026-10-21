"use client";

import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LandingFeaturePanel } from "@/components/front/LandingFeaturePanel";
import { LandingSeaFirstScreen } from "@/components/front/LandingSeaFirstScreen";
import {
  ACCENT_EVERY,
  Cell,
  FIRST_SCREEN_ACCENTS,
  FIRST_SCREEN_DAYS,
  FIRST_SCREEN_ROWS,
  GAP,
  GroundCell,
  LIT,
  PAD,
  POOL,
  SEA_ACCENTS,
  SIZE,
  firstScreenAccents,
  heroAt,
  meet,
  place,
  type MomentId,
  type SeaArea,
  type SeaLayout,
  type SeaMetrics,
  type StoryId,
} from "./LandingSeaCells";
import { Heading } from "@/components/ui/heading";
import { cn } from "@/lib/cn";

// Re-exported for the tests and any reader that knew these from here before
// the split; their home is `LandingSeaCells.tsx` now.
export { FIRST_SCREEN, FIRST_SCREEN_ROWS, HERO, SEA_REGIONS, firstScreenAccents } from "./LandingSeaCells";
export type { SeaArea } from "./LandingSeaCells";

// The desktop front door's sea of notebooks (M51, the C2 prototype): every
// public day in the library as the Discover card it is, each on its region's
// coloured mat, packed edge to edge on one grid of square units. The moments,
// the pricing and the closing cell are larger cells of the same grid, each a
// whole number of units (Mitchell's walk of PR 510). The first screen is all
// colour; scrolling dims it into ground, and four moments rise out of it from
// a ghost of themselves and sink back as they leave, each the real component
// telling one step (find a day, ask the assistant, everyone on the plan, the
// notebook afterwards), each coming in as the last fades out, with two or
// three days lit around each, touching it and apart from one another. Here
// and there an accent, a cell of colour naming a country, a city or a kind of
// day, opens the library's page for it.
//
// **The grid decides every size** (Mitchell, on PR 510: *"the parent controls
// the size, and the content just fills that component using the flow rules
// given it"*). A cell's area comes from here; a card, a moment's panel and the
// pricing fill what they are given and keep what fits.
//
// **Two halves of one grid.** The first screen is in the server's HTML before
// any script runs, at a width the server cannot know, so CSS packs it: the
// column count is `--cols` (globals.css), the hero is placed by it, and the
// first screen's cells flow `dense` around the hero. Below it, `layoutSea`
// packs the rest from the same `--cols`, read back once mounted; the server
// packs it for six columns, the fewest. That packing is below the first
// screen's eight rows, so out of sight until the client packs again, on any
// screen up to about 1440px tall; on a taller one (a portrait monitor) its
// rows show, and move, at hydration — within the container, whose height is
// floored at the server pack (`--sea-rows-floor`), so the footer does not
// move with them.
//
// **The first screen is a server component.** The cells and their geometry
// live in `LandingSeaCells.tsx`, which has no hooks, so `LandingScreen`
// renders the first screen on the server and passes it in as a prop: it is
// in the server's HTML and is never hydrated. The packed bands below stay
// client — their cells depend on the measured column count — and the cards
// inside every cell still hydrate as client leaves (`DiscoverCard` reads
// the time-format context), so this split hydrates less, it does not
// hydrate nothing. The snapshot still ships in the client chunk because
// the packer needs it; it is not handed down as raw data as well, which
// would put it in the page twice.
//
// The motion follows SPEC §28's notes for the phone's pin: progress is scroll
// position, not time; no `requestAnimationFrame`, whose callback a hidden
// frame never runs; DOM writes on the scroll event, never React state; and
// the rest state is in the markup, so a cold load paints the first screen as
// it is meant to look before any script runs.

/**
 * What the server packs for: the fewest columns CSS ever draws, at 1100×900.
 * Never more: an area past the real last column would open columns the grid
 * does not have and squeeze the first screen until the client packed again.
 */
const SERVER_METRICS: SeaMetrics = { cols: 6, unit: (1100 - 2 * PAD - 5 * GAP) / 6, viewport: 900 };

// Each story cell in page order: its width past the prototype's base (four
// columns, five from 12, six from 16), or the full width, how tall its
// content is drawn in px, which sets its rows, and where it sits. The crew's
// 680px is four rows at 1440 (Mitchell's third walk: *"Cut it one row
// shorter"*), as is the assistant's 690, which its day from nine to ten
// fills (PR 514 r1: at 600, four rows left the river 90px short of its
// panel's foot). The pricing's
// 480 is three rows at every unit, one fewer than it had (his fourth: *"Too
// much dead space, shrink the whole container down 1 row"*).
const STORIES: { id: StoryId; extra: number | null; height: number; align: "left" | "right" | "center" }[] = [
  { id: "sea-find", extra: 1, height: 480, align: "left" },
  { id: "sea-assistant", extra: 1, height: 690, align: "right" },
  { id: "sea-crew", extra: 1, height: 680, align: "center" },
  { id: "sea-notebook", extra: 2, height: 640, align: "left" },
  { id: "pricing", extra: 2, height: 480, align: "center" },
  { id: "closing", extra: null, height: 380, align: "center" },
];
const LIT_SIZE = 2;
/** From this many columns, an ultra-wide screen, every story is centred (Mitchell's third walk: *"always keep at least one section in the middle"*). */
const WIDE = 14;
/**
 * How far below a story's middle the next one starts, in screens: when the
 * next comes in at the screen's foot, the last is a quarter of a screen from
 * the top, fading out (Mitchell's third walk: *"you should just be seeing the
 * last fading out when the next scrolls in"*).
 */
const NEXT_AT = 0.75;

/**
 * **The sea below the first screen, packed** (the prototype's layout): the
 * story cells in page order, each the next as soon as the last is fading, the
 * days each moment lights around it, and every unit left a library day or an
 * accent, each as big as the snapshot sizes it or as big as still fits. Pure
 * and whole: every area is whole units, no two overlap, and no unit from the
 * first screen's foot to the last row is left empty.
 */
export function layoutSea({ cols, unit, viewport }: SeaMetrics): SeaLayout {
  const step = unit + GAP;
  // A longer stretch after the hero, so the colourful first screen holds
  // before it dims (the prototype's G0).
  const opening = Math.max(3, Math.ceil((1.35 * viewport) / step));
  const base = cols >= 16 ? 6 : cols >= 12 ? 5 : 4;
  // The hero starts at the second row.
  const heroEnd = 1 + heroAt(cols)[2];
  const inset = Math.round(cols * 0.1);

  // Rows are added as the stories reach them.
  const taken: boolean[][] = [];
  const rowAt = (r: number) => (taken[r] ??= new Array<boolean>(cols).fill(false));
  const free = ({ row: r, col: c, w, h }: SeaArea) => {
    if (r < FIRST_SCREEN_ROWS || c < 0 || c + w > cols) return false;
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) if (rowAt(y)[x]) return false;
    return true;
  };
  const take = ({ row: r, col: c, w, h }: SeaArea) => {
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) rowAt(y)[x] = true;
  };

  const stories = {} as Record<StoryId, SeaArea>;
  const lit: SeaLayout["lit"] = [];
  /** Every story placed so far, with the days it lights: what the next group keeps a unit clear of. */
  const groups: SeaArea[][] = [];
  // Room above the first moment for a day it lights there.
  let row = Math.max(FIRST_SCREEN_ROWS + LIT_SIZE, heroEnd + opening);
  for (const story of STORIES) {
    const centred = story.align === "center" || (cols >= WIDE && story.extra !== null);
    // A moment leaves a lit day's width beside it, so its days need not
    // stack above and below it and hold the next moment a screen away.
    let w = story.extra === null ? cols : Math.min(story.id in LIT ? cols - LIT_SIZE : cols, base + story.extra);
    // Centred to the unit: as many columns spare on each side.
    if (centred && (cols - w) % 2 === 1) w += w < cols ? 1 : -1;
    const h = Math.max(2, Math.ceil((story.height + GAP) / step));
    const at = centred ? (cols - w) / 2 : story.align === "left" ? inset : cols - w - inset;
    const days = story.id in LIT ? LIT[story.id as MomentId] : [];
    // Lit days apart, and each touching its moment along an edge (Mitchell's
    // walk of PR 510 at 7260011: *"always be touching the banner element"*),
    // clear of the group above, and reaching as few rows past the moment's
    // own as they can, so the next moment can follow close.
    const litAround = (box: SeaArea): SeaArea[] => {
      const edges: SeaArea[] = [];
      for (let c = box.col - LIT_SIZE + 1; c < box.col + box.w; c++) {
        edges.push({ row: box.row - LIT_SIZE, col: c, w: LIT_SIZE, h: LIT_SIZE }, { row: box.row + box.h, col: c, w: LIT_SIZE, h: LIT_SIZE });
      }
      for (let r = box.row - LIT_SIZE + 1; r < box.row + box.h; r++) {
        edges.push({ row: r, col: box.col - LIT_SIZE, w: LIT_SIZE, h: LIT_SIZE }, { row: r, col: box.col + box.w, w: LIT_SIZE, h: LIT_SIZE });
      }
      const past = (at: SeaArea) => Math.max(0, box.row - at.row) + Math.max(0, at.row + at.h - box.row - box.h);
      // Then the side the story leaves room on, from its top down.
      const lean = (at: SeaArea) => (story.align === "right" ? at.col : -at.col) * 0.01 + at.row * 0.001;
      const spots: SeaArea[] = [];
      for (let i = 0; i < days.length; i++) {
        const spot = edges
          .filter((at) => free(at) && spots.every((other) => !meet(at, other, 1)))
          .filter((at) => groups.every((other) => other.every((area) => !meet(at, area, 1))))
          .sort((a, b) => past(a) - past(b) || lean(a) - lean(b))[0];
        if (spot !== undefined) spots.push(spot);
      }
      return spots;
    };
    // Clear of every group above, by a unit, so no day reads as the wrong
    // moment's; and lower still while its days do not all find room.
    let col = Math.min(Math.max(0, at), cols - w);
    // Against one edge rather than an inset that leaves neither side room for a lit day.
    if (days.length > 0 && col < LIT_SIZE && cols - col - w < LIT_SIZE) col = story.align === "right" ? cols - w : 0;
    const box: SeaArea = { row, col, w, h };
    while (groups.some((group) => group.some((area) => meet(box, area, 1)))) box.row += 1;
    let spots = litAround(box);
    for (let tries = 0; spots.length < days.length && tries < 2 * LIT_SIZE + 1; tries++) {
      box.row += 1;
      spots = litAround(box);
    }
    stories[story.id] = box;
    take(box);
    spots.forEach((spot, i) => {
      take(spot);
      lit.push({ moment: story.id as MomentId, cell: days[i]!, at: spot });
    });
    groups.push([box, ...spots]);
    // The next story's top, `NEXT_AT` of a screen below the place this one
    // starts to sink from: its middle, or for one taller than the screen,
    // half a screen above its foot (`momentRise`).
    const sinks = box.h * step - Math.min(box.h * step, viewport) / 2;
    row = box.row + Math.max(box.h + 1, Math.round((sinks + NEXT_AT * viewport) / step));
  }
  const closing = stories.closing;
  const rows = closing.row + closing.h;

  // Every unit left, row by row, from where the first screen's cells end: a
  // library day, or once ten have gone by, an accent where it touches no
  // other accent, the first screen's too.
  const background: SeaLayout["background"] = [];
  const accents: SeaArea[] = [...firstScreenAccents(cols)];
  let days = FIRST_SCREEN_DAYS;
  let accentsUsed = FIRST_SCREEN_ACCENTS;
  let since = 0;
  const largest = (r: number, c: number, [w0, h0]: readonly [number, number]) => {
    for (let h = Math.min(h0, rows - r); h >= 1; h--) for (let w = w0; w >= 1; w--) if (free({ row: r, col: c, w, h })) return { row: r, col: c, w, h };
    return { row: r, col: c, w: 1, h: 1 };
  };
  for (let r = FIRST_SCREEN_ROWS; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (rowAt(r)[c]) continue;
      if (since >= ACCENT_EVERY - 1 && SEA_ACCENTS.length > 0) {
        const accent = SEA_ACCENTS[accentsUsed % SEA_ACCENTS.length]!;
        const at = largest(r, c, SIZE[accent.size]);
        if (accents.every((other) => !meet(at, other, 1))) {
          take(at);
          accents.push(at);
          background.push({ accent, at });
          accentsUsed += 1;
          since = 0;
          continue;
        }
      }
      const cell = POOL[days++ % POOL.length]!;
      const at = largest(r, c, SIZE[cell.size]);
      take(at);
      background.push({ cell, at });
      since += 1;
    }
  }
  return { rows, stories, lit, background };
}

/** The server pack's row count: the grid height's floor, computed once from the same metrics the server renders. */
const SERVER_ROWS = layoutSea(SERVER_METRICS).rows;

/**
 * The grid's row floor for a pack of `rows`: the server pack's rows, or the
 * pack's own rows when taller. The container never shrinks below its first
 * paint, so a repack that packs shorter rearranges cells within the
 * container instead of pulling the footer up; a taller pack still grows it
 * once, which no floor can avoid without clipping real content.
 */
export function seaRowsFloor(rows: number): number {
  return Math.max(SERVER_ROWS, rows);
}

// How long the first screen holds its colour, then how long the sea takes to
// dim, in screens of scroll (Mitchell, on C2: *"Keep the initial page
// colorful background a tad longer before fading out"*).
const HOLD = 0.6;
const FADE = 0.8;
// A moment is wholly risen while its middle is within 15% of a screen of the
// screen's own, and sinks back to its ghost over the next 35%, so it fades in
// as it comes up the screen and out as it leaves at the top (Mitchell's walk
// of PR 510 at 7260011). The ghost is the real panel, faint: never gone, and
// never a cover over it.
const RISEN = 0.15;
const RISE = 0.35;
// No further than the grid's gap: a lit day touches its moment's foot across
// that gap, and a panel lowered past it slid under the day, its rounded foot
// and shadow lost (PR 510 r5).
const RISE_PX = GAP;
const GHOST = 0.22;
/** How dark the scrim is at its darkest (`.landing-sea-scrim`), which a lit day's veil matches. */
const SCRIM = 0.55;

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/** How far the sea has dimmed, 0 to 1, at `scrollY` on a `viewport`-tall screen. */
export function seaDim(scrollY: number, viewport: number): number {
  return clamp((scrollY - HOLD * viewport) / (FADE * viewport));
}

/**
 * A moment `height` tall whose top is `top` px down a `viewport`-tall screen:
 * how risen, 0 to 1 (`lift`), its panel's opacity, and how far below its place.
 */
export function momentRise(top: number, height: number, viewport: number): { opacity: number; dy: number; lift: number } {
  // Where its middle may be for it to be at the screen's middle: one place,
  // or for a moment taller than the screen, a stretch.
  const half = Math.min(height, viewport) / 2;
  const centre = viewport / 2;
  const off = Math.max(0, top + half - centre, centre - (top + height - half)) / viewport;
  const lift = clamp((RISEN + RISE - off) / RISE);
  // Wholly off the screen it is drawn at nothing, which no one can tell from
  // a ghost, and which an accessibility checker does not read as faint text.
  const seen = top < viewport && top + height > 0;
  return { opacity: seen ? GHOST + (1 - GHOST) * lift : 0, dy: Math.round((1 - lift) * RISE_PX), lift };
}

/** A number as a style value, `1` rather than `1.000`, so the authored rest state and a painted one read alike. */
const styleNumber = (n: number) => String(Number(n.toFixed(3)));

/**
 * Whether an element is within a screen of the viewport yet; true once and
 * then for good. Without an `IntersectionObserver` nothing below the first
 * screen mounts, which is the server's HTML.
 */
function useNear<T extends Element>() {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (near || el === null || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: "100% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [near]);
  return [ref, near] as const;
}


/**
 * Rows of background, mounted once the reader is near them. The empty marker
 * spans every column of its rows, so the first screen's cells never flow into
 * them, mounted or not.
 */
function Band({
  from,
  to,
  cells,
  unit,
}: {
  from: number;
  to: number;
  cells: SeaLayout["background"];
  /** The grid's unit in px, for deferred cells' intrinsic sizes. */
  unit: number;
}) {
  const [ref, near] = useNear<HTMLDivElement>();
  return (
    <>
      <div
        ref={ref}
        aria-hidden
        data-testid="sea-band"
        // eslint-disable-next-line no-restricted-syntax -- the band's rows on the sea's grid, computed by `layoutSea`
        style={{ gridRow: `${from + 1} / span ${to - from}`, gridColumn: "1 / -1" }}
        className="pointer-events-none"
      />
      {near && cells.map(({ at, ...ground }) => <GroundCell key={`${at.row}-${at.col}`} ground={ground} at={at} defer unit={unit} />)}
    </>
  );
}

/**
 * A moment risen out of the sea: a cell of the grid holding its panel, the
 * heading and the real component, which the scroll raises from a ghost of
 * itself (`data-rise`). Nothing lies under or over the panel: a stamp of the
 * heading in white on the region's mat showed through the rising panel as
 * white on white (Mitchell's walk of PR 510 at 7260011). Its rest state in
 * the markup is risen, since a moment is never on the first screen.
 */
function Moment({
  id,
  heading,
  at,
  bleed = false,
  children,
}: {
  id: MomentId;
  heading: string;
  at: SeaArea;
  /** Its content runs to the cell's foot, with no padding under it, for a page that fades out at the cell's real edge. */
  bleed?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      data-moment
      data-testid="sea-story"
      // eslint-disable-next-line no-restricted-syntax -- the moment's area on the sea's grid, computed by `layoutSea`
      style={place(at)}
      className="landing-sea-story relative rounded-2xl"
    >
      <div
        data-rise
        data-testid="moment-panel"
        className={cn("absolute inset-0 flex flex-col gap-4 overflow-hidden rounded-2xl bg-paper p-7 shadow-lifted", bleed && "pb-0")}
      >
        <Heading level={2} id={id} className="text-xl text-pretty">
          {heading}
        </Heading>
        <div className="flex min-h-0 flex-1 flex-col gap-5">{children}</div>
      </div>
    </section>
  );
}

/**
 * A story cell that does not rise: the pricing, the closing cell. It fills its
 * area; what it holds fills it. The closing cell is the grid's full width, so
 * it holds its words to a centred track (`.landing-sea-closing`) rather than
 * leave them to cap their own width.
 */
function Story({ at, closing = false, children }: { at: SeaArea; closing?: boolean; children: ReactNode }) {
  return (
    <div
      data-testid="sea-story"
      // eslint-disable-next-line no-restricted-syntax -- the cell's area on the sea's grid, computed by `layoutSea`
      style={place(at)}
      className={cn(
        "landing-sea-story min-h-0 overflow-hidden rounded-2xl bg-paper p-7 shadow-lifted",
        closing ? "landing-sea-closing" : "flex flex-col",
      )}
    >
      {children}
    </div>
  );
}

/** Held to the moment's room while its real panel's chunk loads, so the page does not jump when it lands. */
const PANEL_PENDING = <div className="min-h-0 flex-1 rounded-lg border border-hairline bg-surface" />;

/**
 * The sea, from the first screen to the end of the page: `hero` in the first
 * screen's middle, `pricing` and `closing` as its last two cells, the closing
 * one the full width of the grid and the last thing in it. `firstScreen` is
 * the first screen's cells, rendered on the server by `LandingScreen` and
 * passed in so they are never hydrated; when it is absent (tests, mostly)
 * the sea renders its own server-shaped copy.
 */
export function LandingSea({
  hero,
  pricing,
  closing,
  firstScreen,
}: {
  hero?: ReactNode;
  pricing?: ReactNode;
  closing?: ReactNode;
  /** The first screen's cells, server-rendered by the page. Absent, the sea renders them itself. */
  firstScreen?: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState(SERVER_METRICS);
  const layout = useMemo(() => layoutSea(metrics), [metrics]);

  // Packs the sea again for the columns CSS chose and the screen it is on.
  // React state, not a DOM write: it changes what is mounted, and only on
  // mount and resize, never on scroll.
  useEffect(() => {
    const grid = gridRef.current;
    if (grid === null) return;
    const measure = () => {
      const cols = Number.parseInt(getComputedStyle(grid).getPropertyValue("--cols"), 10);
      if (!(cols > 0) || grid.clientWidth === 0) return;
      const unit = (grid.clientWidth - 2 * PAD - (cols - 1) * GAP) / cols;
      const viewport = window.innerHeight;
      setMetrics((was) => (was.cols === cols && Math.abs(was.unit - unit) < 0.5 && was.viewport === viewport ? was : { cols, unit, viewport }));
    };
    measure();
    window.addEventListener("resize", measure, { passive: true });
    return () => window.removeEventListener("resize", measure);
  }, []);

  // The moments' document positions, read once per pack and per resize —
  // never on scroll, where a read after the previous moment's writes forced
  // a synchronous layout per moment. A moment only moves when the packer
  // packs again, which is a layout change, so the cache cannot go stale
  // between paints; the live read in `paint` is only the fallback for a
  // moment the cache has not seen.
  const topsRef = useRef(new Map<string, { top: number; height: number }>());
  const refreshTops = useCallback(() => {
    const root = rootRef.current;
    if (root === null) return;
    const next = new Map<string, { top: number; height: number }>();
    for (const moment of root.querySelectorAll<HTMLElement>("[data-moment]")) {
      const box = moment.getBoundingClientRect();
      next.set(moment.getAttribute("aria-labelledby")!, { top: box.top + window.scrollY, height: box.height });
    }
    topsRef.current = next;
  }, []);

  // Refresh after every repack, before any paint can use the new places.
  useEffect(() => {
    refreshTops();
  }, [layout, refreshTops]);

  useEffect(() => {
    const root = rootRef.current;
    const scrim = scrimRef.current;
    if (root === null || scrim === null) return;
    // Read live in `paint`, as the board reads it: the preference can change mid-session.
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    // The sea is `display: none` below the desktop breakpoint (the phone
    // door is the page there), so a scroll listener on a hidden sea is dead
    // work on the very devices that can least afford it. The listener lives
    // only while the sea is displayed; unknown (no `matchMedia`) paints as
    // before rather than guessing hidden.
    const desktop = window.matchMedia?.("(min-width: 768px)");
    let dim = 0;
    const paint = () => {
      if (desktop !== undefined && !desktop.matches) return;
      const still = motion?.matches ?? false;
      const viewport = window.innerHeight;
      dim = seaDim(window.scrollY, viewport);
      // On the scrim, its one reader, which holds no card: set on an ancestor
      // of the cells, this inherited property restyled every mounted card on
      // every scroll event, 115ms a frame with 650 mounted (PR 510 r4).
      scrim.style.setProperty("--sea-dim", styleNumber(dim));
      for (const moment of root.querySelectorAll<HTMLElement>("[data-moment]")) {
        const id = moment.getAttribute("aria-labelledby")!;
        const cached = topsRef.current.get(id);
        const top = cached === undefined ? moment.getBoundingClientRect().top : cached.top - window.scrollY;
        const height = cached === undefined ? moment.getBoundingClientRect().height : cached.height;
        const { opacity, dy, lift } = momentRise(top, height, viewport);
        const panel = moment.querySelector<HTMLElement>("[data-rise]")!;
        panel.style.opacity = styleNumber(opacity);
        panel.style.transform = still || dy === 0 ? "" : `translate3d(0,${dy}px,0)`;
        // Its two or three lit days with it, on their veil and ring alone,
        // which hold no card: no card is restyled.
        for (const cell of root.querySelectorAll<HTMLElement>(`[data-lit-for="${id}"]`)) {
          cell.querySelector<HTMLElement>(".landing-sea-veil")!.style.opacity = styleNumber(SCRIM * dim * (1 - lift));
          cell.querySelector<HTMLElement>(".landing-sea-ring")!.style.opacity = styleNumber(lift);
        }
      }
      // The card under the pointer sinks back from the sea as it is now, not
      // as it was when the pointer came onto it (PR 510 r5): one cell at most.
      root.querySelector<HTMLElement>(".landing-sea-cell[data-lifted]:hover")?.style.setProperty("--veil", styleNumber(SCRIM * dim));
    };
    // A background card the pointer is on rises out of the sea, as a lit
    // one does (Mitchell's walk of PR 510 at 7260011). CSS runs it; this
    // hands it, once per entry and on that one card, how dark the sea is now.
    const surface = (event: PointerEvent) => {
      const cell = (event.target as Element).closest<HTMLElement>(".landing-sea-cell[aria-hidden]:not([data-lit-for])");
      if (cell === null || cell.contains(event.relatedTarget as Node | null)) return;
      cell.style.setProperty("--veil", styleNumber(SCRIM * dim));
      cell.dataset.lifted = "";
    };
    const onResize = () => {
      refreshTops();
      paint();
    };
    const onDesktop = () => {
      if (desktop?.matches ?? true) {
        refreshTops();
        window.addEventListener("scroll", paint, { passive: true });
        paint();
      } else {
        window.removeEventListener("scroll", paint);
      }
    };
    // Once on mount too: a restored scroll position paints before the first
    // scroll event, or the page would jump on it.
    paint();
    if (desktop === undefined || desktop.matches) window.addEventListener("scroll", paint, { passive: true });
    desktop?.addEventListener("change", onDesktop);
    window.addEventListener("resize", onResize, { passive: true });
    root.addEventListener("pointerover", surface, { passive: true });
    return () => {
      window.removeEventListener("scroll", paint);
      desktop?.removeEventListener("change", onDesktop);
      window.removeEventListener("resize", onResize);
      root.removeEventListener("pointerover", surface);
    };
  }, [refreshTops]);

  const { stories, lit, background, rows } = layout;
  // In reading order, row then column, so Tab never jumps back up the page:
  // the packer places them beside, above, then below the moment.
  const litFor = (moment: MomentId) =>
    lit
      .filter((day) => day.moment === moment)
      .sort((a, b) => a.at.row - b.at.row || a.at.col - b.at.col)
      .map(({ cell, at }) => <Cell key={cell.day.savedDayId} cell={cell} at={at} background={false} litFor={moment} />);
  const moments: Record<MomentId, ReactNode> = {
    "sea-find": (
      <Moment key="sea-find" id="sea-find" heading="Find a day worth borrowing." at={stories["sea-find"]}>
        <LandingFeaturePanel panel="find-a-day">{PANEL_PENDING}</LandingFeaturePanel>
      </Moment>
    ),
    "sea-assistant": (
      <Moment key="sea-assistant" id="sea-assistant" heading="Ask for more, keep what fits." at={stories["sea-assistant"]}>
        <LandingFeaturePanel panel="assistant">{PANEL_PENDING}</LandingFeaturePanel>
      </Moment>
    ),
    "sea-crew": (
      <Moment key="sea-crew" id="sea-crew" heading="Everyone going, one plan." at={stories["sea-crew"]}>
        <LandingFeaturePanel panel="crew">{PANEL_PENDING}</LandingFeaturePanel>
      </Moment>
    ),
    "sea-notebook": (
      <Moment key="sea-notebook" id="sea-notebook" heading="Keep the notebook afterwards." at={stories["sea-notebook"]} bleed>
        <LandingFeaturePanel panel="notebook-page">{PANEL_PENDING}</LandingFeaturePanel>
      </Moment>
    ),
  };

  // In the DOM in the order the eye meets them down the page: each band of
  // background where it starts, each moment followed by the days it lights.
  const bands = Array.from({ length: Math.ceil((rows - FIRST_SCREEN_ROWS) / 6) }, (_, i) => {
    const from = FIRST_SCREEN_ROWS + i * 6;
    const to = Math.min(rows, from + 6);
    const cells = background.filter(({ at }) => at.row >= from && at.row < to);
    return { row: from, order: 0, node: <Band key={`band-${i}`} from={from} to={to} cells={cells} unit={metrics.unit} /> };
  });
  const placed = [
    ...bands,
    ...(Object.keys(moments) as MomentId[]).map((id) => ({
      row: stories[id].row,
      order: 1,
      node: (
        <Fragment key={id}>
          {moments[id]}
          {litFor(id)}
        </Fragment>
      ),
    })),
    { row: stories.pricing.row, order: 1, node: <Story key="pricing" at={stories.pricing}>{pricing}</Story> },
    { row: stories.closing.row, order: 1, node: <Story key="closing" at={stories.closing} closing>{closing}</Story> },
  ].sort((a, b) => a.row - b.row || a.order - b.order);

  return (
    <div ref={rootRef} data-testid="landing-sea" className="landing-sea bg-hairline">
      <div
        ref={gridRef}
        data-testid="sea-grid"
        data-cols={metrics.cols}
        // eslint-disable-next-line no-restricted-syntax -- the packed grid's row count, computed by `layoutSea`, which `.landing-sea-grid` sizes itself to; the floor is the server pack's rows, so the repack rearranges cells within the container instead of pulling the footer up
        style={{ "--sea-rows": rows, "--sea-rows-floor": seaRowsFloor(rows) } as React.CSSProperties}
        className="landing-sea-grid"
      >
        <div
          ref={scrimRef}
          aria-hidden
          data-testid="sea-scrim"
          // eslint-disable-next-line no-restricted-syntax -- not a style but the scroll's one state value, authored at rest (SPEC §28's note 2) where `paint` writes it
          style={{ "--sea-dim": 0 } as React.CSSProperties}
          className="landing-sea-scrim"
        />
        {/* First in the DOM, so a screen reader meets the page's h1 first. */}
        <div data-testid="sea-hero" className="landing-sea-hero flex min-h-0 flex-col justify-center overflow-hidden rounded-2xl bg-paper p-9">
          {hero}
        </div>
        {firstScreen ?? <LandingSeaFirstScreen />}
        {placed.map(({ node }) => node)}
      </div>
    </div>
  );
}
