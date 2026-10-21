// The sea's cells and the pure geometry behind them, split out of
// `LandingSea.tsx` so the first screen can be a server component: this
// module has no `"use client"` directive and no hooks, so the same cell
// renders on the server (the first screen, passed into `LandingSea` as a
// prop and never hydrated) and on the client (the packed bands and the
// moments' lit days, which the client packer places). The cards inside the
// cells are still client leaves — `DiscoverCard` reads the time-format
// context — so this split hydrates less, it does not hydrate nothing.
import type { CSSProperties } from "react";
import Link from "next/link";
import { DiscoverCard } from "@/components/playbooks/DiscoverCard";
import { cn } from "@/lib/cn";
import { LANDING_SEA, SEA_ACCENTS, SEA_DAYS, type SeaAccent, type SeaCell, type SeaCellSize } from "@/lib/landingSea";

// Re-exported for the packer in `LandingSea.tsx`, which places accents among the background days.
export { SEA_ACCENTS };

/**
 * The accent rotation the packers draw from, led by Peru: Peru is in the
 * generated accents, but the rotation only reaches it deep in the background
 * (row 21–34 at wide widths) and never at 6–8 columns, where the background
 * runs out before its turn — so no Peru tile rendered there at all. Leading
 * with it puts one Peru tile on the first screen at every width, in the same
 * shape and to the same country page as every other country tile, and the
 * rotation carries on behind it in generated order, so no accent is skipped
 * or doubled. If Peru ever leaves the generated accents, the order falls back
 * to the generated one.
 */
const PERU_ACCENT = SEA_ACCENTS.find((accent) => accent.kind === "country" && accent.name === "Peru");
/** The accent order both packers draw from: Peru first, then the generated order without it. */
export const SEA_ACCENT_ORDER: SeaAccent[] =
  PERU_ACCENT === undefined ? SEA_ACCENTS : [PERU_ACCENT, ...SEA_ACCENTS.filter((accent) => accent !== PERU_ACCENT)];

type SeaDoor = SeaCell & { href: string | null };
/** What a background cell holds: a day, or an accent. */
type Ground = { cell: SeaDoor; accent?: never } | { accent: SeaAccent; cell?: never };

export const SEA_REGIONS: Record<string, { label: string; mat: string }> = {
  "3-days-in-bologna-tortellini-mortadella-market-mornings": { label: "Italy", mat: "bg-mat-rust" },
  "3-days-in-florence-renaissance-art-workshops-the-oltrarno": { label: "Italy", mat: "bg-mat-rust" },
  "3-days-in-rome-emperors-gladiators-the-layers-beneath": { label: "Italy", mat: "bg-mat-rust" },
  "3-days-on-the-amalfi-coast-cliff-towns-lemon-groves-the-path-of-the-gods": { label: "Italy", mat: "bg-mat-rust" },
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
/** A cell size's span in grid units: the square, the wide, and the tall. */
export const SIZE: Record<SeaCellSize, [w: number, h: number]> = {
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
// on PR 510: *"maybe like 2-3, not 6"*), and never the moment's own day
// (Mitchell's third walk: *"The banner to left is the same activity to
// right"*). Each is a day named here, not ranked (Mitchell's fourth walk:
// *"Let the rule go"*). Find a day raises Mitchell's Rome playbook and lights
// his Florence, Amalfi and Bologna ones (his fourth walk: *"use these rome days
// for the card and the accent cards around it"*); the assistant works on a trip
// borrowed from that Rome playbook, and lights three other Italian cities'
// days, none of them Rome's, whose Forum and Testaccio are the moment's own
// stops (PR 514 r1); the crew's river is Elena's Naxos day, and it lights
// three other Greek ones; the notebook lights the demo's three Japan days.
const GREECE = SEA_DAYS.filter((cell) => cell.group === "greek-islands");
const dayOf = (group: string) => SEA_DAYS.find((cell) => cell.group === group)!;
/** The find moment's banner, the day the generator names as `LANDING_FEATURES.shelf`. */
const BANNER = dayOf("3-days-in-rome-emperors-gladiators-the-layers-beneath");
const ITALY = [
  dayOf("3-days-in-florence-renaissance-art-workshops-the-oltrarno"),
  dayOf("3-days-on-the-amalfi-coast-cliff-towns-lemon-groves-the-path-of-the-gods"),
  dayOf("3-days-in-bologna-tortellini-mortadella-market-mornings"),
];
const ITALIAN_CITIES = ["Naples:", "Venice:", "Sicily's east:"].map((name) => SEA_DAYS.find((cell) => cell.group === "italy-cities" && cell.day.name.startsWith(name))!);
const NAXOS = GREECE.find((cell) => cell.day.name.startsWith("Naxos"))!;
const GREEK = GREECE.filter((cell) => cell !== NAXOS);

export type MomentId = "sea-find" | "sea-assistant" | "sea-crew" | "sea-notebook";
/** Every story cell the packer places, moments plus pricing and closing. */
export type StoryId = MomentId | "pricing" | "closing";

/** Each moment's own day, which none of its lit days repeats; the notebook's are the Japan demo's, which the sea does not hold. */
export const MOMENT_DAY: Record<MomentId, string | null> = {
  "sea-find": BANNER.day.savedDayId,
  "sea-assistant": BANNER.day.savedDayId,
  "sea-crew": NAXOS.day.savedDayId,
  "sea-notebook": null,
};
/** The days each moment lights, which the background leaves out so none shows twice beside its moment. */
export const LIT: Record<MomentId, SeaDoor[]> = {
  "sea-find": ITALY,
  "sea-assistant": ITALIAN_CITIES,
  "sea-crew": GREEK.slice(0, 3),
  "sea-notebook": LANDING_SEA.japan,
};

/** The days a moment raises or lights, which the background leaves out so none shows twice beside its moment. */
const shown = new Set([...Object.values(MOMENT_DAY), ...Object.values(LIT).flatMap((lit) => lit.map((cell) => cell.day.savedDayId))]);
/** The background: every library day no moment shows, in the snapshot's shuffled order. */
export const POOL = SEA_DAYS.filter((cell) => !shown.has(cell.day.savedDayId));

// One accent to about every ten cells of background (Mitchell's third walk:
// *"we are missing this nice accent full color cards"*), and never two
// touching, so they read as a scattering and not a band.
/** How many background days go by between accents in the packed background. */
export const ACCENT_EVERY = 10;

// Enough cells to fill the first screen's eight rows at 20 columns around the
// hero (about 140 units), the last of them single units, so `dense` fills the
// gaps the bigger ones leave. At a narrower width most of them find no room
// above the packed grid and are clipped past its foot.
const FIRST_SCREEN_SIZED = 56;
const FIRST_SCREEN_SINGLE = 36;

export type SeaArea = { row: number; col: number; w: number; h: number };
export type SeaMetrics = { cols: number; unit: number; viewport: number };
export type SeaLayout = {
  rows: number;
  stories: Record<StoryId, SeaArea>;
  lit: { moment: MomentId; cell: SeaDoor; at: SeaArea }[];
  background: (Ground & { at: SeaArea })[];
};

/** The first screen's rows, which CSS packs: eight 180px units cover a 1440px-tall screen under the header. */
export const FIRST_SCREEN_ROWS = 8;

/** Whether two areas share a unit, or with `margin` 1, touch at an edge or a corner. */
/** Whether two areas share a unit, or with `margin` 1, touch at an edge or a corner. */
export const meet = (a: SeaArea, b: SeaArea, margin = 0) =>
  a.row < b.row + b.h + margin && b.row < a.row + a.h + margin && a.col < b.col + b.w + margin && b.col < a.col + a.w + margin;

/** The hero at each column count `--cols` takes, as globals.css sets `--hero-start` (1-based), `--hero-span` and `--hero-rows`. */
export const HERO: Record<number, [start: number, span: number, rows: number]> = {
  6: [1, 5, 4],
  7: [2, 5, 4],
  8: [2, 5, 3],
  9: [3, 5, 3],
  10: [3, 5, 3],
  11: [4, 5, 3],
  12: [4, 6, 3],
  13: [4, 6, 3],
  14: [5, 6, 3],
  15: [5, 6, 3],
  16: [5, 7, 3],
  17: [6, 7, 3],
  18: [6, 7, 3],
  19: [7, 7, 3],
  20: [7, 7, 3],
};
/** The hero's placement at this many columns, clamped to the table's range. */
export const heroAt = (cols: number) => HERO[Math.min(20, Math.max(6, cols))]!;

/**
 * CSS's `row dense` flow over the first screen at this many columns: each
 * cell at the first unit, row by row, where it fits around the hero and the
 * cells before it. Rows below are the packed background's, so a cell with no
 * room in these rows falls past the grid's foot, clipped: `null`.
 */
function denseFlow(cols: number) {
  const [start, span, rows] = heroAt(cols);
  const taken = Array.from({ length: FIRST_SCREEN_ROWS }, (_, r) =>
    Array.from({ length: cols }, (_, c) => r >= 1 && r < 1 + rows && c >= start - 1 && c < start - 1 + span),
  );
  const fits = (r: number, c: number, w: number, h: number) => {
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) if (taken[y]![x]) return false;
    return true;
  };
  return {
    next: ([w, h]: readonly [number, number]): SeaArea | null => {
      for (let r = 0; r + h <= FIRST_SCREEN_ROWS; r++) for (let c = 0; c + w <= cols; c++) if (fits(r, c, w, h)) return { row: r, col: c, w, h };
      return null;
    },
    take: (at: SeaArea | null) => {
      if (at !== null) for (let y = at.row; y < at.row + at.h; y++) for (let x = at.col; x < at.col + at.w; x++) taken[y]![x] = true;
    },
  };
}

const FIRST_ACCENTS: Record<number, SeaArea[]> = {};
/**
 * The first screen's cells, in the server's HTML, in the order CSS packs them:
 * an accent once ten have gone by, at the first cell where, at every column
 * count, CSS puts it clear of every accent before it. The server cannot know
 * the width, so no other order would hold them apart (PR 510 r6: at 3440,
 * France sat on Mexico).
 */
export const FIRST_SCREEN: Ground[] = [];
{
  const flows = Object.keys(HERO).map((key) => {
    const cols = Number(key);
    FIRST_ACCENTS[cols] = [];
    return { flow: denseFlow(cols), accents: FIRST_ACCENTS[cols] };
  });
  let days = 0;
  let since = 0;
  for (let i = 0; i < FIRST_SCREEN_SIZED + FIRST_SCREEN_SINGLE; i++) {
    const single = i >= FIRST_SCREEN_SIZED;
    if (since >= ACCENT_EVERY - 1 && SEA_ACCENT_ORDER.length > 0) {
      const next = SEA_ACCENT_ORDER[(i - days) % SEA_ACCENT_ORDER.length]!;
      const accent: SeaAccent = single ? { ...next, size: "1x1" } : next;
      const spots = flows.map(({ flow }) => flow.next(SIZE[accent.size]));
      if (spots.every((at, k) => at === null || flows[k]!.accents.every((other) => !meet(at, other, 1)))) {
        spots.forEach((at, k) => {
          flows[k]!.flow.take(at);
          if (at !== null) flows[k]!.accents.push(at);
        });
        FIRST_SCREEN.push({ accent });
        since = 0;
        continue;
      }
    }
    const next = POOL[days++]!;
    const cell: SeaDoor = single ? { ...next, size: "1x1" } : next;
    for (const { flow } of flows) flow.take(flow.next(SIZE[cell.size]));
    FIRST_SCREEN.push({ cell });
    since += 1;
  }
}
/** How many of the pool's days and accents the first screen has used, where the packer below it carries on. */
export const FIRST_SCREEN_ACCENTS = FIRST_SCREEN.filter((ground) => ground.accent !== undefined).length;
export const FIRST_SCREEN_DAYS = FIRST_SCREEN.length - FIRST_SCREEN_ACCENTS;
/** The first screen's accents at this many columns, where CSS puts them. */
export const firstScreenAccents = (cols: number): readonly SeaArea[] => FIRST_ACCENTS[Math.min(20, Math.max(6, cols))]!;

// The grid's gap and side padding in px (`--sea-gap`, `--sea-pad`).
/** The sea grid's gap in px, matching `--sea-gap`. */
export const GAP = 8;
/** The sea grid's side padding in px, matching `--sea-pad`. */
export const PAD = 16;


/** An area as an inline grid placement, 1-based: geometry the packer computed, which no token can express. */
/** An area as an inline grid placement, 1-based: geometry the packer computed, which no token can express. */
export const place = (at: SeaArea) => ({ gridRow: `${at.row + 1} / span ${at.h}`, gridColumn: `${at.col + 1} / span ${at.w}` });

/**
 * A placed cell's style: its grid area, and for a deferred below-fold cell,
 * `content-visibility` so the browser skips its layout and paint until near,
 * with an intrinsic size from the same grid geometry so its slot never
 * collapses. Only background cells defer: a lit day is a tab stop, and a
 * deferred tab stop is a stranger thing than a skipped background card.
 */
function placedStyle(at: SeaArea | undefined, defer: boolean, unit: number | undefined): CSSProperties | undefined {
  if (at === undefined) return undefined;
  const style: CSSProperties = { ...place(at) };
  if (!defer) return style;
  style.contentVisibility = "auto";
  if (unit !== undefined) style.containIntrinsicSize = `${at.w * (unit + GAP) - GAP}px ${at.h * (unit + GAP) - GAP}px`;
  return style;
}

/**
 * One day on its region's mat, under the region's name: the cell decides the
 * size, and the card fills it. A background cell is not a tab stop, nor in
 * the accessibility tree: the keyboard and a screen reader reach the moments
 * and the calls to action without walking the library, and a reader after a
 * particular day has the library itself.
 */
export function Cell({
  cell,
  at,
  background,
  litFor,
  defer,
  unit,
}: {
  cell: SeaDoor;
  at?: SeaArea;
  background: boolean;
  litFor?: MomentId;
  /** Below the fold, skip layout/paint until near — background cells only, never a lit day (a tab stop). */
  defer?: boolean;
  /** The grid's unit in px, for a deferred cell's intrinsic size. */
  unit?: number;
}) {
  const region = SEA_REGIONS[cell.group]!;
  const compact = (at === undefined ? SIZE[cell.size][0] : at.w) === 1;
  return (
    <div
      data-testid="sea-cell"
      data-region={cell.group}
      data-lit-for={litFor}
      aria-hidden={background || undefined}
      // eslint-disable-next-line no-restricted-syntax -- the cell's area on the sea's grid, computed by `layoutSea`; a first-screen cell has none, and CSS places it; a deferred cell's intrinsic size is the same grid geometry
      style={placedStyle(at, defer === true, unit)}
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
      {/* A lit day rises and sinks with its moment: the veil dims it with the sea, the ring marks it lit. */}
      {litFor !== undefined && (
        <>
          <span aria-hidden data-testid="lit-veil" className="landing-sea-veil" />
          <span aria-hidden className="landing-sea-ring" />
        </>
      )}
    </div>
  );
}

/**
 * An accent: the region's colour edge to edge, a small mono line over a place
 * or a kind of day in large type (the prototype's `.stamp`), opening the
 * library's page for it. Background, so out of the tab order and the
 * accessibility tree as a background card is, and lifted under the pointer
 * as one is.
 */
export function Accent({
  accent,
  at,
  defer,
  unit,
}: {
  accent: SeaAccent;
  at?: SeaArea;
  /** Below the fold, skip layout/paint until near — accents are background, never tab stops. */
  defer?: boolean;
  /** The grid's unit in px, for a deferred accent's intrinsic size. */
  unit?: number;
}) {
  return (
    <div
      data-testid="sea-accent"
      data-region={accent.group}
      aria-hidden
      // eslint-disable-next-line no-restricted-syntax -- the cell's area on the sea's grid, computed by `layoutSea`; a first-screen cell has none, and CSS places it; a deferred cell's intrinsic size is the same grid geometry
      style={placedStyle(at, defer === true, unit)}
      className={cn("landing-sea-cell relative flex min-h-0 min-w-0 flex-col rounded-xl", SEA_REGIONS[accent.group]!.mat, at === undefined && SPAN[accent.size])}
    >
      <Link href={accent.href} prefetch={false} tabIndex={-1} className="landing-sea-door landing-sea-stamp no-underline">
        <span className="landing-sea-stamp-label">{accent.label}</span>
        <span
          // eslint-disable-next-line no-restricted-syntax -- the name's longest word in characters, which `.landing-sea-stamp-name` sizes its type to the cell by
          style={{ "--word": Math.max(...accent.name.split(" ").map((word) => word.length)) } as React.CSSProperties}
          className="landing-sea-stamp-name"
        >
          {accent.name}
        </span>
      </Link>
    </div>
  );
}

/** A background cell: a day's card, or an accent. */
export function GroundCell({
  ground,
  at,
  defer,
  unit,
}: {
  ground: Ground;
  at?: SeaArea;
  /** Below the fold, skip layout/paint until near — passed to the cell or accent. */
  defer?: boolean;
  /** The grid's unit in px, for a deferred cell's intrinsic size. */
  unit?: number;
}) {
  return ground.accent !== undefined ? (
    <Accent accent={ground.accent} at={at} defer={defer} unit={unit} />
  ) : (
    <Cell cell={ground.cell} at={at} background defer={defer} unit={unit} />
  );
}
