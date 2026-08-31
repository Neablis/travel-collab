import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { DataText } from "@/components/ui/data-text";
import { FrontDoorHeader } from "@/components/front/FrontDoorHeader";
import { LandingHeroArt } from "@/components/front/LandingHeroArt";
import { LandingFeatureBlocks } from "@/components/front/LandingFeatureBlocks";
import { DEMO_PATH } from "@/lib/demoTrip";
import { cn } from "@/lib/cn";

// Every string here is transcribed from the design source
// `.design-sync/handoff/design/Trip Planner Redesign.dc.html:1840-2214`.
//
// SPEC §14's copy rules are load-bearing, not stylistic: no "free", no "open
// source", no "no credit card" — Caesura is a product for groups, not a tool —
// and the only footnote is "Early access". The previous build shipped all
// three of those words plus a "twelve group chats" hero; they were removed
// deliberately on this pass. `LandingScreen.test.tsx` guards the rule so they
// cannot creep back. Reopen it in SPEC §14 first, not here.
//
// The page runs on nothing (SPEC §14): no session, no fetch, no backend, every
// value a fixture in this file. A data-model change must never be able to break
// the front door.

// `dc.html:1861-1866` — the hero's decorative contour grid. Kept as data
// because six near-identical <path> elements read as noise inline.
// The hero's fake map: the Kamo river where it runs through central Kyoto,
// with its bridges.
//
// Two rounds of feedback got here. First: "Could we create a more real 'Fake'
// Map background that better reflects Kyoto? ... this just looks like a random
// river." What was there then was six lines, every one skewed slightly
// off-axis, plus one thick curve — a meandering line on empty ground can only
// read as a river, so that is what it read as.
//
// The first answer was a city-wide Heian-kyō lattice, on the reasoning that
// the 794 grid is what makes Kyoto legible from above. Mitchell's follow-up
// corrected it: "more what i meant as iconic section in kyoto thats
// recognizable — the river with the bridges." A whole-city grid is an
// abstraction of anywhere gridded; what is recognisable is a *place*. So this
// is zoomed in on one: the Kamo, the Takase canal running parallel a block
// west, the bridges crossing at the big east-west streets, and the grid
// stopping dead at both banks.
//
// The bridges are the load-bearing detail. An east-west street that simply
// runs across a river reads as a line drawn over a line; one that stops at the
// bank everywhere *except* where a heavier bar carries it over is what makes
// the water look like water. That is why the rows below are drawn as two
// segments with hardcoded endpoints rather than as full-width lines.
//
// Style stays as asked — hairlines and tokens, no labels, no landmarks, no
// illustration. Mitchell sent an illustrated tourist map as a reference for
// the *idea* and said explicitly it is not the style he wants.
//
// Geometry is in the SVG's own 0-160 x 0-100 space, and placed against one
// constraint that is easy to miss: `xMidYMid slice` crops rather than
// stretches, so a tall narrow viewport sees only a slice. Measured at
// 402x1014 the visible band is x 60-100 — a quarter of the width, centred.
// The river, the canal and the bridges all sit inside it, because on a phone
// they are the whole subject.

// The river, leaning south-west as the real Kamo does. Taking it as a function
// of a horizontal offset gives the centreline and both banks from one shape,
// so they cannot drift apart when the curve is tuned. (A true parallel offset
// would be a different curve; over a lean this gentle a horizontal shift is
// within a fraction of a unit of it, and this is scenery.)
const kamoAt = (dx: number) =>
  `M${79 + dx} -6 C ${77 + dx} 24, ${75 + dx} 50, ${73 + dx} 78 S ${71 + dx} 96, ${70 + dx} 106`;
const KAMO = kamoAt(0);
// Half the channel width, in user units — how far each bank sits from centre.
const KAMO_HALF_WIDTH = 2.6;

// The Takase canal, a block west and parallel. Kyoto has two waterways
// through this stretch, not one, and the narrow second one is a large part of
// why the area looks like itself — so it is drawn in `info` rather than the
// river's `info-tint`: at tint weight and 0.6 units wide it was invisible.
const TAKASE = "M70 -6 C 68 24, 66 50, 64 78 S 62 96, 61 106";

// East-west streets, as (y, centre-of-river-at-that-y) pairs. The centre is
// sampled off KAMO so each row stops exactly at the bank.
const CROSS_STREETS = [
  { y: 10, cx: 77.7 },
  { y: 20, cx: 76.9 },
  { y: 30, cx: 76.1 },
  { y: 40, cx: 75.3 },
  { y: 50, cx: 74.5 },
  { y: 60, cx: 73.7 },
  { y: 70, cx: 72.9 },
  { y: 80, cx: 72.1 },
  { y: 90, cx: 71.3 },
] as const;

// Which of those cross the water. Three, spaced out, the way Sanjō, Shijō and
// Gojō are — not every street gets a bridge, and that is the point.
const BRIDGE_ROWS = new Set([20, 50, 80]);

// North-south streets, which run parallel to the river and so never need to
// stop for it. Kept clear of the channel on both sides: the west bank sits at
// x 67.8 at its furthest and the east bank at 81.2, so 60 and 90 are the
// innermost safe columns.
const NORTH_SOUTH = [10, 20, 30, 40, 50, 60, 90, 100, 110, 120, 130, 140, 150] as const;

// Blocks, on the grid rather than scattered over it, and only on the west
// bank — the built-up side.
const HERO_PLOTS = [
  { x: 30, y: 20, width: 20, height: 20, opacity: 0.5 },
  { x: 40, y: 60, width: 20, height: 10, opacity: 0.4 },
  { x: 10, y: 40, width: 10, height: 20, opacity: 0.45 },
] as const;

export function LandingScreen() {
  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <FrontDoorHeader
        actions={
          <>
            <Link href="/signin" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "no-underline")}>
              Sign in
            </Link>
            <Link href="/signup" className={cn(buttonVariants({ variant: "primary", size: "sm" }), "no-underline")}>
              Start a trip
            </Link>
          </>
        }
      />

      <main className="flex flex-1 flex-col items-center">
        <section className="relative w-full overflow-hidden border-b border-hairline bg-moss">
          {/* Decorative only, and `pointer-events-none` on every layer is what
              keeps the day pills inside LandingHeroArt clickable (DRIFT §2). */}
          <svg
            viewBox="0 0 160 100"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            {/* The water first, so everything else reads as sitting on it,
                then its two banks — without an edge it is a pale column
                rather than a river. */}
            <path d={KAMO} strokeWidth={KAMO_HALF_WIDTH * 2} className="fill-none stroke-info-tint" />
            <path d={kamoAt(-KAMO_HALF_WIDTH)} strokeWidth="0.35" className="fill-none stroke-info" />
            <path d={kamoAt(KAMO_HALF_WIDTH)} strokeWidth="0.35" className="fill-none stroke-info" />

            {NORTH_SOUTH.map((x) => (
              <path key={`ns${x}`} d={`M${x} -6 V 106`} strokeWidth="0.55" className="fill-none stroke-hairline" />
            ))}

            {/* Each cross street in two pieces, stopping at the banks. */}
            {CROSS_STREETS.map(({ y, cx }) => (
              <g key={`ew${y}`} className="fill-none stroke-hairline">
                <path d={`M-6 ${y} H ${cx - KAMO_HALF_WIDTH}`} strokeWidth="0.55" />
                <path d={`M${cx + KAMO_HALF_WIDTH} ${y} H 166`} strokeWidth="0.55" />
              </g>
            ))}

            <path d={TAKASE} strokeWidth="0.6" className="fill-none stroke-info" />

            {HERO_PLOTS.map((plot) => (
              <rect key={`${plot.x}-${plot.y}`} {...plot} className="fill-surface" />
            ))}

            {/* The bridges, last so they sit over the water rather than under
                it. Only a step heavier than a street and in the same family as
                one: they are a street continuing, not a separate object, and
                heavy enough to be darker than the water — at `border-strong`
                they were lighter than it and read as three gaps, not three
                crossings. Each overhangs the bank by 2 units so it lands on
                solid ground instead of stopping at the edge. */}
            {CROSS_STREETS.filter(({ y }) => BRIDGE_ROWS.has(y)).map(({ y, cx }) => (
              <path
                key={`bridge${y}`}
                d={`M${cx - KAMO_HALF_WIDTH - 2} ${y} H ${cx + KAMO_HALF_WIDTH + 2}`}
                strokeWidth="0.9"
                className="fill-none stroke-slate"
              />
            ))}
          </svg>
          <div className="landing-hero-veil pointer-events-none absolute inset-0" />

          <div className="relative mx-auto grid w-full max-w-285 items-center gap-12 px-7 pt-13.5 pb-17 lg:grid-cols-2">
            <div className="flex flex-col gap-5.5">
              <DataText size="xs" className="text-2xs tracking-widest uppercase">
                Trips, planned together
              </DataText>

              <Heading level={1} className="text-4xl text-pretty">
                The trip everyone actually helped plan.
              </Heading>

              <Text as="p" variant="secondary" className="max-w-115 text-md text-pretty">
                One shared plan your whole group can move around — days, times, costs, who&rsquo;s in. The
                good days get saved, and they drop straight into the next trip.
              </Text>

              <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
                <Link href="/signup" className={cn(buttonVariants({ variant: "primary" }), "no-underline")}>
                  Continue with Google
                </Link>
                {/* Real as of M11 link 4, and still a plain link: SPEC §14
                    says this page runs on nothing — no session, no fetch, no
                    backend — so the CTA does not go looking for a trip to
                    peek at. `/demo` is the real trip board, read-only, running
                    the real lenses against the Japan fixture folded in memory
                    (ADR-031, superseding ADR-027's `DEMO_SHARE_TOKEN`). So
                    this link works on every deploy, every preview branch and
                    a fresh clone, and a data-model change still cannot break
                    the front door — which is the rule this shell was parked
                    behind. */}
                <Link
                  href={DEMO_PATH}
                  className={cn(buttonVariants({ variant: "secondary" }), "no-underline")}
                >
                  Look around a real trip
                </Link>
              </div>

              <Text as="p" variant="muted">
                Early access — invite the group by link, nothing to install.
              </Text>
            </div>

            <LandingHeroArt />
          </div>
        </section>

        <div className="mx-auto flex w-full max-w-285 flex-col gap-7.5 px-7 pt-13.5 pb-2.5">
          <Heading level={2} className="max-w-155 text-3xl text-pretty">
            Planning is the trip, three times over.
          </Heading>
          <LandingFeatureBlocks />
        </div>

        <div className="mx-auto w-full max-w-285 px-7 pt-14 pb-19.5">
          <div className="flex flex-wrap items-center justify-between gap-5 rounded-2xl border border-hairline bg-moss p-7.5">
            <div className="flex flex-col gap-1.5">
              <Text as="span" className="font-display text-xl font-semibold tracking-tight">
                Start the plan, then send the link.
              </Text>
              <Text as="span" variant="secondary" className="text-base text-pretty">
                A trip takes about a minute to set up. Everything after that is easier with company.
              </Text>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Link href="/signup" className={cn(buttonVariants({ variant: "primary" }), "no-underline")}>
                Start a trip
              </Link>
              {/* The closing CTA band asks the same thing the hero does
                  (`dc.html:1880`, `:2211`), so it now goes to the same place.
                  The two ids this replaced existed only because `Preview`
                  writes its id to `data-preview-id` and two shells could not
                  share one; two links to one href have no such problem. */}
              <Link
                href={DEMO_PATH}
                className={cn(buttonVariants({ variant: "ghost" }), "no-underline")}
              >
                See a finished one
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
