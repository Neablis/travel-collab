"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LandingFeaturePanel } from "@/components/front/LandingFeaturePanel";
import { DiscoverCard } from "@/components/playbooks/DiscoverCard";
import { buttonVariants } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { cn } from "@/lib/cn";
import { LANDING_SEA, type LandingSea as Sea, type SeaCell, type SeaCellSize } from "@/lib/landingSea";

/** A cell as the sea draws it: linked to its day page, or (a Japan day) to nothing. */
type SeaDoor = SeaCell & { href: string | null };

// The desktop front door's sea of notebooks (M51, the C2 prototype): every
// public day in the library as the Discover card it is, packed edge to edge.
// The first screen is all of it at full colour; scrolling dims it into ground,
// and four moments rise out of it, each the real component telling one step
// (find a day, make it your trip, the crew on it, the notebook afterwards),
// with one screen of sea between them.
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

/** A cell's footprint on the grid, by the snapshot's columns-by-rows size. */
const SPAN: Record<SeaCellSize, string> = {
  "1x1": "",
  "2x1": "col-span-2",
  "1x2": "row-span-2",
  "2x2": "col-span-2 row-span-2",
  "3x1": "col-span-3",
  "1x3": "row-span-3",
};

// The clusters the moments light: the Railay day's Thailand around "make it
// your trip", the crew's Greece around the crew (decision 10). They are kept
// out of the background, so a lit day is not also a dimmed one nearby.
const THAILAND = "thailand-beaches";
const GREECE = "greek-islands";
const lit = (group: string) => LANDING_SEA.cells.filter((cell) => cell.group === group);
const BACKGROUND = LANDING_SEA.cells.filter((cell) => cell.group !== THAILAND && cell.group !== GREECE);

// Enough cells to fill a screen of a 3440px monitor, which is more than the
// library divided by five: a wide band repeats days a band or two apart, which
// a reader scrolling dimmed ground does not notice, where a half-empty band
// would be the dead space this milestone exists to remove.
const BAND_SIZE = 48;
const SIDE_SIZE = 12;
const run = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => BACKGROUND[(from + i) % BACKGROUND.length]!);

/** The background's screens, top to bottom: the first under the headline, then one after each moment. */
export const SEA_BANDS: Sea["cells"][] = Array.from({ length: 5 }, (_, band) => run(band * BAND_SIZE, BAND_SIZE));
// A moment's sides are filled from halfway through the band before it, so
// they do not open on the same days that band just showed.
const sideFill = (band: number) => run(band * BAND_SIZE + BAND_SIZE / 2, SIDE_SIZE * 2);

// How long the first screen holds its colour, then how long the sea takes to
// dim, in screens of scroll (Mitchell, on C2: *"Keep the initial page
// colorful background a tad longer before fading out"*).
const HOLD = 0.6;
const FADE = 0.8;
// A moment rises over the bottom 45% of the screen, from 48px down.
const RISE = 0.45;
const RISE_PX = 48;

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/** How far the sea has dimmed, 0 to 1, at `scrollY` on a `viewport`-tall screen. */
export function seaDim(scrollY: number, viewport: number): number {
  return clamp((scrollY - HOLD * viewport) / (FADE * viewport));
}

/** A moment whose top is `top` px down a `viewport`-tall screen: how visible, and how far below its place. */
export function momentRise(top: number, viewport: number): { opacity: number; dy: number } {
  const t = clamp((viewport - top) / (RISE * viewport));
  return { opacity: t, dy: Math.round((1 - t) * RISE_PX) };
}

/** A number as a style value, `1` rather than `1.000`, so the authored rest state and a painted one read alike. */
const styleNumber = (n: number) => String(Number(n.toFixed(3)));

/**
 * Whether an element is within a screen of the viewport yet; true once and
 * then for good. Without an `IntersectionObserver` only the first screen
 * mounts, which is the server's HTML.
 */
function useNear<T extends Element>(initial: boolean) {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(initial);
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
 * One cell. A background cell is not a tab stop: the keyboard reaches the
 * moments and the calls to action without walking 148 cards, and a reader
 * after a particular day has the library itself.
 */
function Cell({
  cell,
  background,
  headingLevel,
  narrow = false,
}: {
  cell: SeaDoor;
  background: boolean;
  headingLevel: 2 | 3;
  /** Beside a moment, where a side may be one column wide: rows only, or a wide cell opens a sliver of a second column. */
  narrow?: boolean;
}) {
  const span = narrow ? SPAN[cell.size].replace(/col-span-\d ?/, "") : SPAN[cell.size];
  return (
    <DiscoverCard
      day={cell.day}
      origin={{ from: "sea", href: cell.href, background }}
      headingLevel={headingLevel}
      className={cn("overflow-hidden", span, background && "landing-sea-dim")}
    />
  );
}

/** A screen of background, its cells mounted once the reader is near it. */
function Band({ cells, first, children }: { cells: SeaDoor[]; first: boolean; children?: ReactNode }) {
  const [ref, near] = useNear<HTMLDivElement>(first);
  return (
    <div ref={ref} className="landing-sea-band relative">
      <ul aria-label="Days from the library" className="landing-sea-grid h-full">
        {near &&
          cells.map((cell, i) => (
            <Cell key={`${cell.day.savedDayId}-${i}`} cell={cell} background headingLevel={2} />
          ))}
      </ul>
      {children}
    </div>
  );
}

/** A side of a moment: its lit days first, then dimmed background to the edge. */
function Side({ lit, fill, near }: { lit: SeaDoor[]; fill: SeaDoor[]; near: boolean }) {
  return (
    <div className="relative hidden min-w-0 flex-1 lg:block">
      <ul aria-label="Days from the library" className="landing-sea-grid absolute inset-0">
        {near && lit.map((cell) => <Cell key={cell.day.savedDayId} cell={cell} background={false} headingLevel={3} narrow />)}
        {near &&
          fill.map((cell, i) => (
            <Cell key={`${cell.day.savedDayId}-${i}`} cell={cell} background headingLevel={3} narrow />
          ))}
      </ul>
    </div>
  );
}

/**
 * A moment risen out of the sea: its heading and the real component in the
 * middle, the days it lights on either side. `data-moment` is what the scroll
 * paints; its rest state is risen, since a moment is never on the first screen.
 */
function Moment({
  id,
  heading,
  lit = [],
  band,
  children,
}: {
  id: string;
  heading: string;
  lit?: SeaDoor[];
  /** The background band before it, which its sides continue from. */
  band: number;
  children: ReactNode;
}) {
  const [ref, near] = useNear<HTMLElement>(false);
  const fill = sideFill(band);
  const half = Math.ceil(lit.length / 2);
  return (
    <section ref={ref} aria-labelledby={id} data-moment className="flex gap-3">
      <Side lit={lit.slice(0, half)} fill={fill.slice(0, SIDE_SIZE)} near={near} />
      <div className="flex w-full max-w-2xl shrink-0 flex-col gap-5 py-10">
        <Heading level={2} id={id} className="text-xl text-pretty">
          {heading}
        </Heading>
        {children}
      </div>
      <Side lit={lit.slice(half)} fill={fill.slice(SIDE_SIZE)} near={near} />
    </section>
  );
}

/** Held to a moment's size while its real panel's chunk loads, so the page does not jump when it lands. */
const PANEL_PENDING = <div className="h-96 rounded-lg border border-hairline bg-surface" />;

/** The Railay day's page, where the day is added to a trip; part 6 makes this the onboarding itself. */
const RAILAY = LANDING_SEA.cells.find((cell) => cell.group === THAILAND && cell.day.name.startsWith("Railay"))!;

/**
 * The sea, from the first screen to the end of the page. `hero` sits on the
 * first screen; `children`, the pricing and the closing cell, come after the
 * last screen of sea, in the order given, so the closing cell is the last.
 */
export function LandingSea({ hero, children }: { hero?: ReactNode; children?: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const paint = () => {
      const viewport = window.innerHeight;
      root.style.setProperty("--sea-dim", styleNumber(seaDim(window.scrollY, viewport)));
      for (const moment of root.querySelectorAll<HTMLElement>("[data-moment]")) {
        const { opacity, dy } = momentRise(moment.getBoundingClientRect().top, viewport);
        moment.style.opacity = styleNumber(opacity);
        moment.style.transform = still || dy === 0 ? "" : `translate3d(0,${dy}px,0)`;
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

  return (
    <div
      ref={rootRef}
      data-testid="landing-sea"
      // eslint-disable-next-line no-restricted-syntax -- not a style but the scroll's one state value, authored at rest (SPEC §28's note 2) where `paint` writes it; `.landing-sea-dim` reads it.
      style={{ "--sea-dim": 0 } as React.CSSProperties}
      className="flex flex-col gap-3 px-3 pb-3"
    >
      <Band cells={SEA_BANDS[0]!} first>
        {hero}
      </Band>
      <Moment id="sea-find" heading="Find a day worth borrowing." band={0}>
        <LandingFeaturePanel panel="find-a-day">{PANEL_PENDING}</LandingFeaturePanel>
      </Moment>
      <Band cells={SEA_BANDS[1]!} first={false} />
      <Moment
        id="sea-make"
        heading="Start a trip using someone else’s Thailand day, or add it to an existing plan."
        lit={lit(THAILAND)}
        band={1}
      >
        <Link href={RAILAY.href} prefetch={false} className={cn(buttonVariants({ variant: "primary" }), "self-start no-underline")}>
          Make this your trip
        </Link>
      </Moment>
      <Band cells={SEA_BANDS[2]!} first={false} />
      <Moment id="sea-crew" heading="Plan the rest with the crew." lit={lit(GREECE)} band={2}>
        <LandingFeaturePanel panel="crew">{PANEL_PENDING}</LandingFeaturePanel>
      </Moment>
      <Band cells={SEA_BANDS[3]!} first={false} />
      <Moment id="sea-notebook" heading="Keep the notebook afterwards." lit={LANDING_SEA.japan} band={3}>
        <LandingFeaturePanel panel="notebook-page">{PANEL_PENDING}</LandingFeaturePanel>
      </Moment>
      <Band cells={SEA_BANDS[4]!} first={false} />
      {children}
    </div>
  );
}
