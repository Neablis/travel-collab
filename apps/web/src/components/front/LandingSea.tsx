"use client";

import { type ComponentProps, Fragment, type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { LandingFeaturePanel } from "@/components/front/LandingFeaturePanel";
import { DiscoverCard } from "@/components/playbooks/DiscoverCard";
import { Heading } from "@/components/ui/heading";
import { cn } from "@/lib/cn";
import { LANDING_SEA, SEA_ACCENTS, SEA_DAYS, type SeaAccent, type SeaCell, type SeaCellSize } from "@/lib/landingSea";

/** A cell as the sea draws it: linked to its day page, or (a Japan day) to nothing. */
type SeaDoor = SeaCell & { href: string | null };
/** What a background cell holds: a day, or an accent. */
type Ground = { cell: SeaDoor; accent?: never } | { accent: SeaAccent; cell?: never };

// The front door's sea of notebooks (M51, the C2 prototype), as the desktop
// draws it; the phone lays the same sea on two columns through the same
// packer and placing (`PhoneFrontDoor`, `SeaShape`). Every public day in the
// library as the Discover card it is, each on its region's coloured mat,
// packed edge to edge on one grid of square units. The moments,
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
export type StoryId = MomentId | "pricing" | "closing";

/** Each moment's own day, which none of its lit days repeats; the notebook's are the Japan demo's, which the sea does not hold. */
export const MOMENT_DAY: Record<MomentId, string | null> = {
  "sea-find": BANNER.day.savedDayId,
  "sea-assistant": BANNER.day.savedDayId,
  "sea-crew": NAXOS.day.savedDayId,
  "sea-notebook": null,
};
const LIT: Record<MomentId, SeaDoor[]> = {
  "sea-find": ITALY,
  "sea-assistant": ITALIAN_CITIES,
  "sea-crew": GREEK.slice(0, 3),
  "sea-notebook": LANDING_SEA.japan,
};

/** The days a moment raises or lights, which the background leaves out so none shows twice beside its moment. */
const shown = new Set([...Object.values(MOMENT_DAY), ...Object.values(LIT).flatMap((lit) => lit.map((cell) => cell.day.savedDayId))]);
/** The background: every library day no moment shows, in the snapshot's shuffled order. */
const POOL = SEA_DAYS.filter((cell) => !shown.has(cell.day.savedDayId));

// One accent to about every ten cells of background (Mitchell's third walk:
// *"we are missing this nice accent full color cards"*), and never two
// touching, so they read as a scattering and not a band.
const ACCENT_EVERY = 10;

// Enough cells to fill the first screen's eight rows at 20 columns around the
// hero (about 140 units), the last of them single units, so `dense` fills the
// gaps the bigger ones leave. At a narrower width most of them find no room
// above the packed grid and are clipped past its foot.
const FIRST_SCREEN_SIZED = 56;
const FIRST_SCREEN_SINGLE = 36;

/** An area of the sea's grid in whole units: 0-based row and column, and how many of each it spans. */
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
const meet = (a: SeaArea, b: SeaArea, margin = 0) =>
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
const heroAt = (cols: number) => HERO[Math.min(20, Math.max(6, cols))]!;

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

/** Each column count's first-screen accents, where CSS puts them: what the packed background's keep clear of. */
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
    if (since >= ACCENT_EVERY - 1 && SEA_ACCENTS.length > 0) {
      const next = SEA_ACCENTS[(i - days) % SEA_ACCENTS.length]!;
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
const FIRST_SCREEN_ACCENTS = FIRST_SCREEN.filter((ground) => ground.accent !== undefined).length;
const FIRST_SCREEN_DAYS = FIRST_SCREEN.length - FIRST_SCREEN_ACCENTS;
/** The first screen's accents at this many columns, where CSS puts them. */
export const firstScreenAccents = (cols: number): readonly SeaArea[] => FIRST_ACCENTS[Math.min(20, Math.max(6, cols))]!;
// The grid's gap and side padding in px (`--sea-gap`, `--sea-pad`).
export const GAP = 8;
export const PAD = 16;
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
 * What differs between the desktop's grid and the phone's, which share one
 * packer. The desktop's first screen is CSS's, around a hero CSS places, at a
 * column count the server cannot know; the phone's is always two columns, so
 * the packer lays all of it, the hero too (`PHONE_SEA` in `PhoneFrontDoor`).
 */
export type SeaShape = {
  /** The rows above the packed sea, which CSS packs; none where the packer lays the whole grid. */
  firstRows: number;
  /** The hero's area where the packer places it, or null where CSS does (`--hero-*`). */
  hero: SeaArea | null;
  /** Each story's content height in px, which sets its rows. */
  heights: Record<StoryId, number>;
  /** Whether every story takes the grid's full width. */
  fullWidth: boolean;
  /** A lit day's span each way, in units, and how many days each moment lights. */
  litSize: number;
  litCount: number;
  /** The most rows a background cell spans. */
  tallest: number;
};
const DESKTOP_SEA: SeaShape = {
  firstRows: FIRST_SCREEN_ROWS,
  hero: null,
  heights: Object.fromEntries(STORIES.map((story) => [story.id, story.height])) as Record<StoryId, number>,
  fullWidth: false,
  litSize: 2,
  litCount: 3,
  tallest: 3,
};

/**
 * **The sea below the first screen, packed** (the prototype's layout): the
 * story cells in page order, each the next as soon as the last is fading, the
 * days each moment lights around it, and every unit left a library day or an
 * accent, each as big as the snapshot sizes it or as big as still fits. Pure
 * and whole: every area is whole units, no two overlap, and no unit from the
 * first screen's foot to the last row is left empty.
 */
export function layoutSea({ cols, unit, viewport }: SeaMetrics, shape: SeaShape = DESKTOP_SEA): SeaLayout {
  const { firstRows, hero, litSize } = shape;
  const step = unit + GAP;
  // A longer stretch after the hero, so the colourful first screen holds
  // before it dims (the prototype's G0).
  const opening = Math.max(3, Math.ceil((1.35 * viewport) / step));
  const base = cols >= 16 ? 6 : cols >= 12 ? 5 : 4;
  // The hero starts at the second row.
  const heroEnd = hero === null ? 1 + heroAt(cols)[2] : hero.row + hero.h;
  const inset = Math.round(cols * 0.1);

  // Rows are added as the stories reach them.
  const taken: boolean[][] = [];
  const rowAt = (r: number) => (taken[r] ??= new Array<boolean>(cols).fill(false));
  const free = ({ row: r, col: c, w, h }: SeaArea) => {
    if (r < firstRows || c < 0 || c + w > cols) return false;
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) if (rowAt(y)[x]) return false;
    return true;
  };
  const take = ({ row: r, col: c, w, h }: SeaArea) => {
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) rowAt(y)[x] = true;
  };

  if (hero !== null) take(hero);

  const stories = {} as Record<StoryId, SeaArea>;
  const lit: SeaLayout["lit"] = [];
  /** Every story placed so far, with the days it lights: what the next group keeps a unit clear of. */
  const groups: SeaArea[][] = [];
  // Room above the first moment for a day it lights there.
  let row = Math.max(firstRows + litSize, heroEnd + opening);
  for (const story of STORIES) {
    const centred = story.align === "center" || (cols >= WIDE && story.extra !== null);
    // A moment leaves a lit day's width beside it, so its days need not
    // stack above and below it and hold the next moment a screen away.
    let w = story.extra === null || shape.fullWidth ? cols : Math.min(story.id in LIT ? cols - litSize : cols, base + story.extra);
    // Centred to the unit: as many columns spare on each side.
    if (centred && (cols - w) % 2 === 1) w += w < cols ? 1 : -1;
    const h = Math.max(2, Math.ceil((shape.heights[story.id] + GAP) / step));
    const at = centred ? (cols - w) / 2 : story.align === "left" ? inset : cols - w - inset;
    const days = story.id in LIT ? LIT[story.id as MomentId].slice(0, shape.litCount) : [];
    // Lit days apart, and each touching its moment along an edge (Mitchell's
    // walk of PR 510 at 7260011: *"always be touching the banner element"*),
    // clear of the group above, and reaching as few rows past the moment's
    // own as they can, so the next moment can follow close.
    const litAround = (box: SeaArea): SeaArea[] => {
      const edges: SeaArea[] = [];
      for (let c = box.col - litSize + 1; c < box.col + box.w; c++) {
        edges.push({ row: box.row - litSize, col: c, w: litSize, h: litSize }, { row: box.row + box.h, col: c, w: litSize, h: litSize });
      }
      for (let r = box.row - litSize + 1; r < box.row + box.h; r++) {
        edges.push({ row: r, col: box.col - litSize, w: litSize, h: litSize }, { row: r, col: box.col + box.w, w: litSize, h: litSize });
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
    if (days.length > 0 && col < litSize && cols - col - w < litSize) col = story.align === "right" ? cols - w : 0;
    const box: SeaArea = { row, col, w, h };
    while (groups.some((group) => group.some((area) => meet(box, area, 1)))) box.row += 1;
    let spots = litAround(box);
    for (let tries = 0; spots.length < days.length && tries < 2 * litSize + 1; tries++) {
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
  // Carrying on from the first screen's accents and days, where CSS packed one.
  const cssFirst = firstRows > 0;
  const accents: SeaArea[] = cssFirst ? [...firstScreenAccents(cols)] : [];
  let days = cssFirst ? FIRST_SCREEN_DAYS : 0;
  let accentsUsed = cssFirst ? FIRST_SCREEN_ACCENTS : 0;
  let since = 0;
  const largest = (r: number, c: number, [w0, h0]: readonly [number, number]) => {
    for (let h = Math.min(h0, shape.tallest, rows - r); h >= 1; h--) for (let w = w0; w >= 1; w--) if (free({ row: r, col: c, w, h })) return { row: r, col: c, w, h };
    return { row: r, col: c, w: 1, h: 1 };
  };
  for (let r = firstRows; r < rows; r++) {
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

/** An area as an inline grid placement, 1-based: geometry the packer computed, which no token can express. */
export const place = (at: SeaArea) => ({ gridRow: `${at.row + 1} / span ${at.h}`, gridColumn: `${at.col + 1} / span ${at.w}` });

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
export const styleNumber = (n: number) => String(Number(n.toFixed(3)));

/**
 * Whether an element is within a screen of the viewport yet, or of `root`, the
 * scroller it is in; true once and then for good. Without an
 * `IntersectionObserver` nothing below the first screen mounts, which is the
 * server's HTML. A nested scroller clips what the window's observer sees, so
 * the window's margin of a screen would not reach into it: the phone watches
 * its own scroller.
 */
function useNear<T extends Element>(root?: RefObject<Element | null>) {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (near || el === null || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { root: root?.current ?? null, rootMargin: "100% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [near, root]);
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
function Accent({ accent, at }: { accent: SeaAccent; at?: SeaArea }) {
  return (
    <div
      data-testid="sea-accent"
      data-region={accent.group}
      aria-hidden
      // eslint-disable-next-line no-restricted-syntax -- the cell's area on the sea's grid, computed by `layoutSea`; a first-screen cell has none, and CSS places it
      style={at === undefined ? undefined : place(at)}
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
function GroundCell({ ground, at }: { ground: Ground; at?: SeaArea }) {
  return ground.accent !== undefined ? <Accent accent={ground.accent} at={at} /> : <Cell cell={ground.cell} at={at} background />;
}

/**
 * Rows of background, mounted once the reader is near them, or at once where
 * they are the first screen (`eager`). The empty marker spans every column of
 * its rows, so the first screen's cells never flow into them, mounted or not.
 */
function Band({ from, to, cells, root, eager = false }: { from: number; to: number; cells: SeaLayout["background"]; root?: RefObject<Element | null>; eager?: boolean }) {
  const [ref, seen] = useNear<HTMLDivElement>(root);
  const near = eager || seen;
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
      {near && cells.map(({ at, ...ground }) => <GroundCell key={`${at.row}-${at.col}`} ground={ground} at={at} />)}
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
  inset,
  children,
}: {
  id: MomentId;
  heading: string;
  at: SeaArea;
  /** Its content runs to the cell's foot, with no padding under it, for a page that fades out at the cell's real edge. */
  bleed?: boolean;
  /** The panel's padding and gaps where the grid's unit is a phone's, not the desktop's. */
  inset?: string;
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
        className={cn("absolute inset-0 flex flex-col gap-4 overflow-hidden rounded-2xl bg-paper p-7 shadow-lifted", inset, bleed && "pb-0")}
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
function Story({ at, closing = false, inset, children }: { at: SeaArea; closing?: boolean; inset?: string; children: ReactNode }) {
  return (
    <div
      data-testid="sea-story"
      // eslint-disable-next-line no-restricted-syntax -- the cell's area on the sea's grid, computed by `layoutSea`
      style={place(at)}
      className={cn(
        "landing-sea-story min-h-0 overflow-hidden rounded-2xl bg-paper p-7 shadow-lifted",
        closing ? "landing-sea-closing" : "flex flex-col",
        inset,
      )}
    >
      {children}
    </div>
  );
}

/** Held to the moment's room while its real panel's chunk loads, so the page does not jump when it lands. */
const PANEL_PENDING = <div className="min-h-0 flex-1 rounded-lg border border-hairline bg-surface" />;

/** What `grid` measures in a screen `viewport` tall, or null while it is not laid out (the hidden tree, or jsdom). */
export function measureSea(grid: HTMLElement, viewport: number): SeaMetrics | null {
  const cols = Number.parseInt(getComputedStyle(grid).getPropertyValue("--cols"), 10);
  if (!(cols > 0) || grid.clientWidth === 0) return null;
  return { cols, unit: (grid.clientWidth - 2 * PAD - (cols - 1) * GAP) / cols, viewport };
}

/** Whether a sea packed for `was` is the one `now` packs: the same columns and screen, the unit within half a px. */
export const packedFor = (was: SeaMetrics, now: SeaMetrics) => was.cols === now.cols && Math.abs(was.unit - now.unit) < 0.5 && was.viewport === now.viewport;

/**
 * The grid's columns as CSS chose them (`--cols`), its unit, and how tall the
 * screen it scrolls in is (`viewport`): `server` until mounted. React state,
 * not a DOM write: it changes what is mounted, and only on mount and resize,
 * never on scroll.
 */
export function useSeaMetrics(gridRef: RefObject<HTMLElement | null>, server: SeaMetrics, viewport: () => number = () => window.innerHeight) {
  const [metrics, setMetrics] = useState(server);
  const viewportOf = useRef(viewport);
  useEffect(() => {
    const grid = gridRef.current;
    if (grid === null) return;
    const measure = () => {
      const now = measureSea(grid, viewportOf.current());
      if (now !== null) setMetrics((was) => (packedFor(was, now) ? was : now));
    };
    measure();
    window.addEventListener("resize", measure, { passive: true });
    return () => window.removeEventListener("resize", measure);
  }, [gridRef]);
  return metrics;
}

/**
 * Raises each moment in `root` out of its ghost, and its lit days with it,
 * for a screen `viewport` tall whose top is `top` px down the window, the sea
 * `dim` dimmed. Written to the DOM, on the panels, veils and rings alone,
 * which hold no card: no card is restyled.
 */
export function paintMoments(root: HTMLElement, { viewport, top, dim, still }: { viewport: number; top: number; dim: number; still: boolean }) {
  for (const moment of root.querySelectorAll<HTMLElement>("[data-moment]")) {
    const box = moment.getBoundingClientRect();
    const { opacity, dy, lift } = momentRise(box.top - top, box.height, viewport);
    const panel = moment.querySelector<HTMLElement>("[data-rise]")!;
    panel.style.opacity = styleNumber(opacity);
    panel.style.transform = still || dy === 0 ? "" : `translate3d(0,${dy}px,0)`;
    for (const cell of root.querySelectorAll<HTMLElement>(`[data-lit-for="${moment.getAttribute("aria-labelledby")}"]`)) {
      cell.querySelector<HTMLElement>(".landing-sea-veil")!.style.opacity = styleNumber(SCRIM * dim * (1 - lift));
      cell.querySelector<HTMLElement>(".landing-sea-ring")!.style.opacity = styleNumber(lift);
    }
  }
}

/** The moments' headings and panels, in page order. */
const MOMENTS: { id: MomentId; heading: string; panel: ComponentProps<typeof LandingFeaturePanel>["panel"]; bleed?: boolean }[] = [
  { id: "sea-find", heading: "Find a day worth borrowing.", panel: "find-a-day" },
  { id: "sea-assistant", heading: "Ask for more, keep what fits.", panel: "assistant" },
  { id: "sea-crew", heading: "Everyone going, one plan.", panel: "crew" },
  { id: "sea-notebook", heading: "Keep the notebook afterwards.", panel: "notebook-page", bleed: true },
];

/**
 * Everything the packer places, in the DOM in the order the eye meets it down
 * the page: each band of background where it starts, each moment followed by
 * the days it lights, then the pricing and the closing cell. `root` is the
 * scroller the bands watch, `eager` the rows mounted at once (the first
 * screen, where the packer lays it), `inset` a story's padding on a phone,
 * `aboveFirst` the phone's lit days above a moment placed before it.
 */
export function SeaPlaced({
  layout,
  firstRows,
  pricing,
  closing,
  root,
  eager = 0,
  inset,
  aboveFirst = false,
}: {
  layout: SeaLayout;
  firstRows: number;
  pricing?: ReactNode;
  closing?: ReactNode;
  root?: RefObject<Element | null>;
  eager?: number;
  inset?: string;
  aboveFirst?: boolean;
}) {
  const { stories, lit, background, rows } = layout;
  // In reading order, row then column: the packer places them beside, above,
  // then below the moment. With `aboveFirst`, the days wholly above it come
  // before it, so Tab never jumps back up the page (PR 516's review).
  const litFor = (moment: MomentId, above: boolean | null) =>
    lit
      .filter((day) => day.moment === moment && (above === null || day.at.row + day.at.h <= stories[moment].row === above))
      .sort((a, b) => a.at.row - b.at.row || a.at.col - b.at.col)
      .map(({ cell, at }) => <Cell key={cell.day.savedDayId} cell={cell} at={at} background={false} litFor={moment} />);
  const bands = Array.from({ length: Math.ceil((rows - firstRows) / 6) }, (_, i) => {
    const from = firstRows + i * 6;
    const to = Math.min(rows, from + 6);
    const cells = background.filter(({ at }) => at.row >= from && at.row < to);
    return { row: from, order: 0, node: <Band key={`band-${i}`} from={from} to={to} cells={cells} root={root} eager={from < eager} /> };
  });
  const placed = [
    ...bands,
    ...MOMENTS.map(({ id, heading, panel, bleed }) => ({
      row: stories[id].row,
      order: 1,
      node: (
        <Fragment key={id}>
          {aboveFirst && litFor(id, true)}
          <Moment id={id} heading={heading} at={stories[id]} bleed={bleed} inset={inset}>
            <LandingFeaturePanel panel={panel}>{PANEL_PENDING}</LandingFeaturePanel>
          </Moment>
          {litFor(id, aboveFirst ? false : null)}
        </Fragment>
      ),
    })),
    {
      row: stories.pricing.row,
      order: 1,
      node: (
        <Story key="pricing" at={stories.pricing} inset={inset}>
          {pricing}
        </Story>
      ),
    },
    {
      row: stories.closing.row,
      order: 1,
      node: (
        <Story key="closing" at={stories.closing} closing inset={inset}>
          {closing}
        </Story>
      ),
    },
  ].sort((a, b) => a.row - b.row || a.order - b.order);
  return placed.map(({ node }) => node);
}

/**
 * The sea, from the first screen to the end of the page: `hero` in the first
 * screen's middle, `pricing` and `closing` as its last two cells, the closing
 * one the full width of the grid and the last thing in it.
 */
export function LandingSea({ hero, pricing, closing }: { hero?: ReactNode; pricing?: ReactNode; closing?: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // Packs the sea again for the columns CSS chose and the screen it is on.
  const metrics = useSeaMetrics(gridRef, SERVER_METRICS);
  const layout = useMemo(() => layoutSea(metrics), [metrics]);

  useEffect(() => {
    const root = rootRef.current;
    const scrim = scrimRef.current;
    if (root === null || scrim === null) return;
    // Read live in `paint`, as the board reads it: the preference can change mid-session.
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let dim = 0;
    const paint = () => {
      const still = motion?.matches ?? false;
      const viewport = window.innerHeight;
      dim = seaDim(window.scrollY, viewport);
      // On the scrim, its one reader, which holds no card: set on an ancestor
      // of the cells, this inherited property restyled every mounted card on
      // every scroll event, 115ms a frame with 650 mounted (PR 510 r4).
      scrim.style.setProperty("--sea-dim", styleNumber(dim));
      paintMoments(root, { viewport, top: 0, dim, still });
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
    // Once on mount too: a restored scroll position paints before the first
    // scroll event, or the page would jump on it.
    paint();
    window.addEventListener("scroll", paint, { passive: true });
    window.addEventListener("resize", paint, { passive: true });
    root.addEventListener("pointerover", surface, { passive: true });
    return () => {
      window.removeEventListener("scroll", paint);
      window.removeEventListener("resize", paint);
      root.removeEventListener("pointerover", surface);
    };
  }, []);

  return (
    <div ref={rootRef} data-testid="landing-sea" className="landing-sea bg-hairline">
      <div
        ref={gridRef}
        data-testid="sea-grid"
        data-cols={metrics.cols}
        // eslint-disable-next-line no-restricted-syntax -- the packed grid's row count, computed by `layoutSea`, which `.landing-sea-grid` sizes itself to
        style={{ "--sea-rows": layout.rows } as React.CSSProperties}
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
        {FIRST_SCREEN.map((ground, i) => (
          <GroundCell key={i} ground={ground} />
        ))}
        <SeaPlaced layout={layout} firstRows={FIRST_SCREEN_ROWS} pricing={pricing} closing={closing} />
      </div>
    </div>
  );
}
