"use client";

import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { LandingFeaturePanel } from "@/components/front/LandingFeaturePanel";
import { DiscoverCard } from "@/components/playbooks/DiscoverCard";
import { buttonVariants } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { cn } from "@/lib/cn";
import { LANDING_SEA, type SeaCell, type SeaCellSize } from "@/lib/landingSea";

/** A cell as the sea draws it: linked to its day page, or (a Japan day) to nothing. */
type SeaDoor = SeaCell & { href: string | null };

// The desktop front door's sea of notebooks (M51, the C2 prototype): every
// public day in the library as the Discover card it is, each on its region's
// coloured mat, packed edge to edge on one grid of square units. The moments,
// the pricing and the closing cell are larger cells of the same grid, each a
// whole number of units (Mitchell's walk of PR 510). The first screen is all
// colour; scrolling dims it into ground, and four moments rise out of it,
// each the real component telling one step (find a day, make it your trip,
// the crew on it, the notebook afterwards), with a screen of sea between them
// and two or three days lit, apart, around each.
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
// rows show, and move, at hydration.
//
// **The only module that imports the sea's snapshot.** It is not handed down
// as a server prop as well, which would put it in the page twice: once in the
// client chunk and again in the RSC payload.
//
// The motion follows SPEC §28's notes for the phone's pin: progress is scroll
// position, not time; no `requestAnimationFrame`, whose callback a hidden
// frame never runs; DOM writes on the scroll event, never React state; and
// the rest state is in the markup, so a cold load paints the first screen as
// it is meant to look before any script runs.

/** Each region's mat and the name on its strip (the prototype's `MAT` and `REGION`), by the snapshot's bundle. */
export const SEA_REGIONS: Record<string, { label: string; mat: string }> = {
  "alpine-summer": { label: "Alpine summer", mat: "bg-person-sky" },
  "andes-patagonia": { label: "Andes and Patagonia", mat: "bg-person-clay" },
  "australia-newzealand": { label: "Australia and NZ", mat: "bg-person-ochre" },
  "britain-ireland": { label: "Britain and Ireland", mat: "bg-person-slate" },
  "california-coast-and-wine": { label: "California", mat: "bg-person-rose" },
  "finger-lakes-upstate-ny": { label: "Upstate New York", mat: "bg-person-moss" },
  "france-cities": { label: "France", mat: "bg-person-plum" },
  "greek-islands": { label: "Greek islands", mat: "bg-person-teal" },
  "italy-cities": { label: "Italy", mat: "bg-mat-rust" },
  "italy-skiing": { label: "Dolomites and Alps", mat: "bg-mat-navy" },
  "korea-taiwan-hongkong": { label: "Korea and Taiwan", mat: "bg-mat-berry" },
  "medinas-and-deserts": { label: "Medinas and deserts", mat: "bg-mat-amber" },
  "mexico-central-america": { label: "Mexico", mat: "bg-mat-violet" },
  "nordic-landscapes": { label: "Nordic", mat: "bg-mat-night" },
  "spain-hiking": { label: "Spain", mat: "bg-mat-fern" },
  "thailand-beaches": { label: "Thailand", mat: "bg-person-teal" },
  "turkey-balkans": { label: "Turkey and Balkans", mat: "bg-person-rose" },
  "us-national-parks": { label: "US parks", mat: "bg-person-clay" },
  "vietnam-indonesia": { label: "Vietnam and Indonesia", mat: "bg-mat-leaf" },
  japan: { label: "Japan", mat: "bg-mat-brick" },
};

/** A cell's footprint as the snapshot sizes it, columns by rows. */
const SIZE: Record<SeaCellSize, [w: number, h: number]> = {
  "1x1": [1, 1],
  "2x1": [2, 1],
  "1x2": [1, 2],
  "2x2": [2, 2],
  "3x1": [3, 1],
  "1x3": [1, 3],
};
/** The same footprint as classes, for the first screen's cells, which CSS places. */
const SPAN: Record<SeaCellSize, string> = {
  "1x1": "",
  "2x1": "col-span-2",
  "1x2": "row-span-2",
  "2x2": "col-span-2 row-span-2",
  "3x1": "col-span-3",
  "1x3": "row-span-3",
};

// The days each moment lights: two or three, never a whole region (Mitchell,
// on PR 510: *"maybe like 2-3, not 6"*). Find a day lights the Railay day's
// small card, the same day again and so not a second door, and one more Thai
// day; make it your trip three Thai days; the crew Elena's Naxos day and two
// more Greek ones; the notebook the demo's three Japan days.
const THAILAND = LANDING_SEA.cells.filter((cell) => cell.group === "thailand-beaches");
const GREECE = LANDING_SEA.cells.filter((cell) => cell.group === "greek-islands");
/** The Railay day's page, where the day is added to a trip; part 6 makes this the onboarding itself. */
const RAILAY = THAILAND.find((cell) => cell.day.name.startsWith("Railay"))!;
const NAXOS = GREECE.find((cell) => cell.day.name.startsWith("Naxos"))!;
const THAI = THAILAND.filter((cell) => cell !== RAILAY);
const GREEK = GREECE.filter((cell) => cell !== NAXOS);

export type MomentId = "sea-find" | "sea-make" | "sea-crew" | "sea-notebook";
type StoryId = MomentId | "pricing" | "closing";

const door = (cell: SeaDoor) => ({ cell, door: true });
const LIT: Record<MomentId, { cell: SeaDoor; door: boolean }[]> = {
  "sea-find": [{ cell: RAILAY, door: false }, door(THAI[0]!)],
  "sea-make": THAI.slice(1, 4).map(door),
  "sea-crew": [NAXOS, ...GREEK.slice(0, 2)].map(door),
  "sea-notebook": LANDING_SEA.japan.map(door),
};

const litIds = new Set(Object.values(LIT).flatMap((lit) => lit.map(({ cell }) => cell.day.savedDayId)));
/** The background: every library day no moment lights, in the snapshot's shuffled order. */
const POOL = LANDING_SEA.cells.filter((cell) => !litIds.has(cell.day.savedDayId));

// Enough cells to fill the first screen's eight rows at 20 columns around the
// hero (about 140 units), the last of them single units, so `dense` fills the
// gaps the bigger ones leave. At a narrower width most of them find no room
// above the packed grid and are clipped past its foot.
const FIRST_SCREEN_SIZED = 56;
const FIRST_SCREEN_SINGLE = 36;
/** The first screen's cells, in the server's HTML, in the order CSS packs them. */
export const FIRST_SCREEN: SeaDoor[] = [
  ...POOL.slice(0, FIRST_SCREEN_SIZED),
  ...POOL.slice(FIRST_SCREEN_SIZED, FIRST_SCREEN_SIZED + FIRST_SCREEN_SINGLE).map((cell) => ({ ...cell, size: "1x1" as const })),
];

/** An area of the sea's grid in whole units: 0-based row and column, and how many of each it spans. */
export type SeaArea = { row: number; col: number; w: number; h: number };
export type SeaMetrics = { cols: number; unit: number; viewport: number };
export type SeaLayout = {
  rows: number;
  stories: Record<StoryId, SeaArea>;
  lit: { moment: MomentId; cell: SeaDoor; door: boolean; at: SeaArea }[];
  background: { cell: SeaDoor; at: SeaArea }[];
};

/** The first screen's rows, which CSS packs: eight 180px units cover a 1440px-tall screen under the header. */
export const FIRST_SCREEN_ROWS = 8;
// The grid's gap and side padding in px (`--sea-gap`, `--sea-pad`), and the
// header's height, which a screen of sea is measured under.
const GAP = 8;
const PAD = 16;
const HEADER = 56;
/**
 * What the server packs for: the fewest columns CSS ever draws, at 1100×900.
 * Never more: an area past the real last column would open columns the grid
 * does not have and squeeze the first screen until the client packed again.
 */
const SERVER_METRICS: SeaMetrics = { cols: 6, unit: (1100 - 2 * PAD - 5 * GAP) / 6, viewport: 900 };

// Each story cell in page order: its width past the prototype's base (four
// columns, five from 12, six from 16), or the full width, how tall its
// content is drawn in px, which sets its rows, and where it sits.
const STORIES: { id: StoryId; extra: number | null; height: number; align: "left" | "right" | "center" }[] = [
  { id: "sea-find", extra: 1, height: 480, align: "left" },
  { id: "sea-make", extra: 1, height: 230, align: "right" },
  { id: "sea-crew", extra: 1, height: 760, align: "center" },
  { id: "sea-notebook", extra: 2, height: 640, align: "left" },
  { id: "pricing", extra: 2, height: 620, align: "center" },
  { id: "closing", extra: null, height: 380, align: "center" },
];
const LIT_SIZE = 2;

/**
 * **The sea below the first screen, packed** (the prototype's layout): the
 * story cells a screen of sea apart, the days each moment lights scattered
 * around it, and every unit left a library day, each as big as the snapshot
 * sizes it or as big as still fits. Pure and whole: every area is whole units,
 * no two overlap, and no unit from the first screen's foot to the last row is
 * left empty.
 */
export function layoutSea({ cols, unit, viewport }: SeaMetrics): SeaLayout {
  const step = unit + GAP;
  // A screen of sea between stories, and a longer stretch after the hero, so
  // the colourful first screen holds before it dims (the prototype's G, G0).
  const screen = Math.max(2, Math.floor((viewport - HEADER) / step));
  const opening = Math.max(3, Math.ceil((1.35 * viewport) / step));
  const base = cols >= 16 ? 6 : cols >= 12 ? 5 : 4;
  // The hero starts at the second row and is `--hero-rows` tall (globals.css).
  const heroEnd = 1 + (cols < 8 ? 4 : 3);
  const inset = Math.round(cols * 0.1);

  const stories = {} as Record<StoryId, SeaArea>;
  let row = Math.max(FIRST_SCREEN_ROWS, heroEnd + opening);
  for (const story of STORIES) {
    const w = story.extra === null ? cols : Math.min(cols, base + story.extra);
    const h = Math.max(2, Math.ceil((story.height + GAP) / step));
    const at = story.align === "left" ? inset : story.align === "right" ? cols - w - inset : Math.floor((cols - w) / 2);
    stories[story.id] = { row, col: Math.min(Math.max(0, at), cols - w), w, h };
    row += h + screen;
  }
  const rows = row - screen;

  const taken = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  const free = ({ row: r, col: c, w, h }: SeaArea) => {
    if (r < FIRST_SCREEN_ROWS || c < 0 || r + h > rows || c + w > cols) return false;
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) if (taken[y]![x]) return false;
    return true;
  };
  const take = ({ row: r, col: c, w, h }: SeaArea) => {
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) taken[y]![x] = true;
  };
  for (const at of Object.values(stories)) take(at);

  // Lit days apart: one beside the moment, one above it towards its other
  // end, one below past its near end, each nudged to the nearest free spot
  // that touches no other day the same moment lights.
  const lit: SeaLayout["lit"] = [];
  for (const [moment, days] of Object.entries(LIT) as [MomentId, (typeof LIT)[MomentId]][]) {
    const box = stories[moment];
    const right = box.col + box.w + LIT_SIZE <= cols;
    const near = right ? box.col + box.w : box.col - LIT_SIZE;
    const far = right ? box.col - 1 : box.col + box.w - 1;
    const spots = [
      [box.row + 1, near],
      [box.row - LIT_SIZE - 1, far],
      [box.row + box.h + 1, right ? near + 1 : near - 1],
    ] as const;
    const mine: SeaArea[] = [];
    const apart = (at: SeaArea) =>
      mine.every((other) => at.row > other.row + other.h || other.row > at.row + at.h || at.col > other.col + other.w || other.col > at.col + at.w);
    days.forEach(({ cell, door }, i) => {
      const [r, c] = spots[i]!;
      // Outwards ring by ring: on a narrow grid a wide moment leaves its
      // spots little room, and the nearest free one may be a few rows off.
      for (let d = 0; d <= rows; d++) {
        for (let dr = -d; dr <= d; dr++) {
          for (let dc = -d; dc <= d; dc++) {
            if (Math.max(Math.abs(dr), Math.abs(dc)) !== d) continue;
            const at = { row: r + dr, col: c + dc, w: LIT_SIZE, h: LIT_SIZE };
            if (!free(at) || !apart(at)) continue;
            take(at);
            mine.push(at);
            lit.push({ moment, cell, door, at });
            return;
          }
        }
      }
    });
  }

  // Every unit left, row by row, from where the first screen's cells end.
  const background: SeaLayout["background"] = [];
  let next = FIRST_SCREEN.length;
  for (let r = FIRST_SCREEN_ROWS; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (taken[r]![c]) continue;
      const cell = POOL[next++ % POOL.length]!;
      const [w0, h0] = SIZE[cell.size];
      let at: SeaArea = { row: r, col: c, w: 1, h: 1 };
      search: for (let h = h0; h >= 1; h--) {
        for (let w = w0; w >= 1; w--) {
          if (free({ row: r, col: c, w, h })) {
            at = { row: r, col: c, w, h };
            break search;
          }
        }
      }
      take(at);
      background.push({ cell, at });
    }
  }
  return { rows, stories, lit, background };
}

/** An area as an inline grid placement, 1-based: geometry the packer computed, which no token can express. */
const place = (at: SeaArea) => ({ gridRow: `${at.row + 1} / span ${at.h}`, gridColumn: `${at.col + 1} / span ${at.w}` });

// How long the first screen holds its colour, then how long the sea takes to
// dim, in screens of scroll (Mitchell, on C2: *"Keep the initial page
// colorful background a tad longer before fading out"*).
const HOLD = 0.6;
const FADE = 0.8;
// A moment rises as its middle comes up the bottom 40% of the screen, from
// 28px down, and is settled from there on (Mitchell, on PR 510: it no longer
// fades out once it has passed the middle).
const RISE = 0.4;
const RISE_PX = 28;

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/** How far the sea has dimmed, 0 to 1, at `scrollY` on a `viewport`-tall screen. */
export function seaDim(scrollY: number, viewport: number): number {
  return clamp((scrollY - HOLD * viewport) / (FADE * viewport));
}

/** A moment `height` tall whose top is `top` px down a `viewport`-tall screen: how risen, and how far below its place. */
export function momentRise(top: number, height: number, viewport: number): { opacity: number; dy: number } {
  const middle = top + Math.min(height, viewport) / 2;
  const t = clamp((viewport - middle) / (RISE * viewport));
  return { opacity: t, dy: Math.round((1 - t) * RISE_PX) };
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
 * One day on its region's mat, under the region's name: the cell decides the
 * size, and the card fills it. A background cell is not a tab stop, nor in
 * the accessibility tree: the keyboard and a screen reader reach the moments
 * and the calls to action without walking the library, and a reader after a
 * particular day has the library itself.
 */
function Cell({ cell, at, background, litFor }: { cell: SeaDoor; at?: SeaArea; background: boolean; litFor?: MomentId }) {
  const region = SEA_REGIONS[cell.group]!;
  const compact = (at === undefined ? SIZE[cell.size][0] : at.w) === 1;
  return (
    <div
      data-testid="sea-cell"
      data-region={cell.group}
      data-lit-for={litFor}
      aria-hidden={background || undefined}
      // eslint-disable-next-line no-restricted-syntax -- the cell's area on the sea's grid, computed by `layoutSea`; a first-screen cell has none, and CSS places it
      style={at === undefined ? undefined : place(at)}
      className={cn(
        "landing-sea-cell relative flex min-h-0 min-w-0 flex-col rounded-xl",
        region.mat,
        at === undefined && SPAN[cell.size],
        litFor !== undefined && "landing-sea-lit",
      )}
    >
      <span aria-hidden className="landing-sea-label">
        {region.label}
      </span>
      {/* h3: a lit day sits after its moment's h2, and a background one is read by nobody. */}
      <DiscoverCard
        day={cell.day}
        origin={{ from: "sea", href: cell.href, background }}
        headingLevel={3}
        compact={compact}
        className={cn("mx-1.5 mb-1.5 min-h-0 flex-1", compact && "gap-2 p-3")}
      />
    </div>
  );
}

/**
 * Rows of background, mounted once the reader is near them. The empty marker
 * spans every column of its rows, so the first screen's cells never flow into
 * them, mounted or not.
 */
function Band({ from, to, cells }: { from: number; to: number; cells: SeaLayout["background"] }) {
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
      {near && cells.map(({ cell, at }) => <Cell key={`${cell.day.savedDayId}-${at.row}-${at.col}`} cell={cell} at={at} background />)}
    </>
  );
}

/**
 * A moment risen out of the sea: a cell of the grid on its region's mat, and
 * over the mat its panel, the heading and the real component, which the
 * scroll raises (`data-rise`). Its rest state is risen, since a moment is
 * never on the first screen.
 */
function Moment({ id, heading, region, at, children }: { id: MomentId; heading: string; region: string; at: SeaArea; children: ReactNode }) {
  return (
    <section
      aria-labelledby={id}
      data-moment
      data-testid="sea-story"
      // eslint-disable-next-line no-restricted-syntax -- the moment's area on the sea's grid, computed by `layoutSea`
      style={place(at)}
      className={cn("landing-sea-story relative rounded-2xl", SEA_REGIONS[region]!.mat)}
    >
      {/* What shows of the moment before it has risen: its mat and its words (the prototype's stamp). */}
      <div aria-hidden className="absolute inset-0 flex flex-col justify-end gap-1 p-5 text-person-on">
        <span className="font-mono text-2xs tracking-widest uppercase">{SEA_REGIONS[region]!.label}</span>
        <span className="font-display text-2xl leading-tight">{heading}</span>
      </div>
      <div
        data-rise
        data-testid="moment-panel"
        className="absolute inset-0 flex flex-col gap-4 overflow-hidden rounded-2xl bg-paper p-7 shadow-lifted"
      >
        <Heading level={2} id={id} className="text-xl text-pretty">
          {heading}
        </Heading>
        <div className="flex min-h-0 flex-1 flex-col gap-5">{children}</div>
      </div>
    </section>
  );
}

/** A story cell that does not rise: the pricing, the closing cell. It fills its area; what it holds fills it. */
function Story({ at, children }: { at: SeaArea; children: ReactNode }) {
  return (
    <div
      data-testid="sea-story"
      // eslint-disable-next-line no-restricted-syntax -- the cell's area on the sea's grid, computed by `layoutSea`
      style={place(at)}
      className="landing-sea-story flex min-h-0 flex-col overflow-hidden rounded-2xl bg-paper p-7 shadow-lifted"
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
 * one the full width of the grid and the last thing in it.
 */
export function LandingSea({ hero, pricing, closing }: { hero?: ReactNode; pricing?: ReactNode; closing?: ReactNode }) {
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

  useEffect(() => {
    const root = rootRef.current;
    const scrim = scrimRef.current;
    if (root === null || scrim === null) return;
    // Read live in `paint`, as the board reads it: the preference can change mid-session.
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const paint = () => {
      const still = motion?.matches ?? false;
      const viewport = window.innerHeight;
      // On the scrim, its one reader, which holds no card: set on an ancestor
      // of the cells, this inherited property restyled every mounted card on
      // every scroll event, 115ms a frame with 650 mounted (PR 510 r4).
      scrim.style.setProperty("--sea-dim", styleNumber(seaDim(window.scrollY, viewport)));
      for (const moment of root.querySelectorAll<HTMLElement>("[data-moment]")) {
        const box = moment.getBoundingClientRect();
        const { opacity, dy } = momentRise(box.top, box.height, viewport);
        const panel = moment.querySelector<HTMLElement>("[data-rise]")!;
        panel.style.opacity = styleNumber(opacity);
        panel.style.transform = still || dy === 0 ? "" : `translate3d(0,${dy}px,0)`;
      }
    };
    // Once on mount too: a restored scroll position paints before the first
    // scroll event, or the page would jump on it.
    paint();
    window.addEventListener("scroll", paint, { passive: true });
    window.addEventListener("resize", paint, { passive: true });
    return () => {
      window.removeEventListener("scroll", paint);
      window.removeEventListener("resize", paint);
    };
  }, []);

  const { stories, lit, background, rows } = layout;
  // In reading order, row then column, so Tab never jumps back up the page:
  // the packer places them beside, above, then below the moment.
  const litFor = (moment: MomentId) =>
    lit
      .filter((day) => day.moment === moment)
      .sort((a, b) => a.at.row - b.at.row || a.at.col - b.at.col)
      .map(({ cell, door, at }) => <Cell key={cell.day.savedDayId} cell={cell} at={at} background={!door} litFor={moment} />);
  const moments: Record<MomentId, ReactNode> = {
    "sea-find": (
      <Moment key="sea-find" id="sea-find" heading="Find a day worth borrowing." region="thailand-beaches" at={stories["sea-find"]}>
        <LandingFeaturePanel panel="find-a-day">{PANEL_PENDING}</LandingFeaturePanel>
      </Moment>
    ),
    "sea-make": (
      <Moment
        key="sea-make"
        id="sea-make"
        heading="Start a trip using someone else’s Thailand day, or add it to an existing plan."
        region="thailand-beaches"
        at={stories["sea-make"]}
      >
        <Link href={RAILAY.href} prefetch={false} className={cn(buttonVariants({ variant: "primary" }), "self-start no-underline")}>
          Make this your trip
        </Link>
      </Moment>
    ),
    "sea-crew": (
      <Moment key="sea-crew" id="sea-crew" heading="Plan the rest with the crew." region="greek-islands" at={stories["sea-crew"]}>
        <LandingFeaturePanel panel="crew">{PANEL_PENDING}</LandingFeaturePanel>
      </Moment>
    ),
    "sea-notebook": (
      <Moment key="sea-notebook" id="sea-notebook" heading="Keep the notebook afterwards." region="japan" at={stories["sea-notebook"]}>
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
    return { row: from, order: 0, node: <Band key={`band-${i}`} from={from} to={to} cells={cells} /> };
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
    { row: stories.closing.row, order: 1, node: <Story key="closing" at={stories.closing}>{closing}</Story> },
  ].sort((a, b) => a.row - b.row || a.order - b.order);

  return (
    <div ref={rootRef} data-testid="landing-sea" className="landing-sea bg-hairline">
      <div
        ref={gridRef}
        data-testid="sea-grid"
        data-cols={metrics.cols}
        // eslint-disable-next-line no-restricted-syntax -- the packed grid's row count, computed by `layoutSea`, which `.landing-sea-grid` sizes itself to
        style={{ "--sea-rows": rows } as React.CSSProperties}
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
        <div className="landing-sea-hero flex min-h-0 flex-col justify-center overflow-hidden rounded-2xl bg-paper p-9 shadow-lifted">
          {hero}
        </div>
        {FIRST_SCREEN.map((cell, i) => (
          <Cell key={`${cell.day.savedDayId}-${i}`} cell={cell} background />
        ))}
        {placed.map(({ node }) => node)}
      </div>
    </div>
  );
}
