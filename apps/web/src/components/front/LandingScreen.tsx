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
// The hero's fake map. Mitchell, 2026-08-30 design pass: "Could we create a
// more real 'Fake' Map background that better reflects Kyoto? It has a very
// iconic city style, and this just looks like a random river. Still keep this
// stripped down esthetic though."
//
// What it was: six lines, every one of them slightly skewed off-axis
// ("M-6 30 L 166 24"), plus one thick curve. Skew is what made it read as
// random — a handful of drifting lines around a river could be anywhere.
//
// What makes Kyoto legible from above is the opposite of skew. Heian-kyō was
// laid out on a strict Chinese-style lattice in 794 and the modern city still
// follows it, which is unusual enough among Japanese cities to carry the
// identity on its own. So the grid is now exactly orthogonal, and dense enough
// to read as city blocks rather than as ruling. The two things that break the
// lattice — the Kamo running north-south, and the Higashiyama ridge east of it
// — are what stop a grid from looking like graph paper.
//
// Still stripped down, which was the other half of the ask: hairlines for the
// blocks, one weight up for four arterials, no labels and no landmarks. It is
// a ground for LandingHeroArt's route and pins, not an illustration competing
// with them.
//
// Geometry is in the SVG's own 0-160 x 0-100 space. `xMidYMid slice` (on the
// element below) means it is cropped rather than stretched, so the blocks stay
// square-ish at every viewport instead of shearing on a wide one.
const HERO_BLOCK_SPACING = 10;
const HERO_GRID_LINES = [
  // Verticals then horizontals, strictly axis-aligned. Extended past the
  // viewBox on both ends so no line appears to stop short of the crop.
  ...Array.from({ length: 17 }, (_, i) => `M${(i + 1) * HERO_BLOCK_SPACING} -6 V 106`),
  ...Array.from({ length: 9 }, (_, i) => `M-6 ${(i + 1) * HERO_BLOCK_SPACING} H 166`),
] as const;

// Everything below is placed against one constraint that is easy to miss:
// `xMidYMid slice` crops rather than stretches, so a tall narrow viewport sees
// only a slice of this 160-wide box. Measured at 402x1014, the visible band is
// x 60-100 — a quarter of the width, centred. Anything that carries the
// identity therefore has to live near x=80 or it simply is not there on a
// phone, which is what happened to the first attempt: the river and the ridge
// sat out at x 113-152 and mobile got a bare lattice.

// Karasuma and Kawaramachi north-south, Shijō and Gojō east-west: the four a
// visitor actually navigates by. Heavier, so the lattice has a hierarchy — and
// two of the four sit inside the phone band so that hierarchy survives there.
const HERO_ARTERIALS = ["M70 -6 V 106", "M95 -6 V 106", "M-6 40 H 166", "M-6 70 H 166"] as const;

// The Kamo, with the slight south-west lean the real river has. It is the one
// element allowed to ignore the grid — which is the whole reason it is here —
// and it is inside the phone band, because a grid alone reads as ruled paper.
const HERO_RIVER = "M92 -6 C 88 22, 84 44, 81 62 S 76 86, 73 106";

// Higashiyama, east of the river. Two contour arcs, no fill — the hills are
// why the grid stops where it does on that side. These are the one identity
// element left outside the phone band: three features in a 40-unit slice would
// crowd it, and the hills are the most readily spared.
const HERO_RIDGE = ["M112 6 C 120 20, 122 36, 117 50", "M109 58 C 118 72, 120 86, 115 100"] as const;

// Translucent blocks, aligned to the lattice rather than scattered over it
// (`dc.html:1867-1869` had them free-floating). On the grid they read as city
// blocks; off it they read as stray rectangles.
const HERO_PLOTS = [
  { x: 60, y: 20, width: 10, height: 20, opacity: 0.5 },
  { x: 30, y: 50, width: 20, height: 10, opacity: 0.4 },
  { x: 120, y: 70, width: 20, height: 20, opacity: 0.45 },
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
            {/* Blocks first, so the river and the route above it read as
                crossing the city rather than being fenced in by it. */}
            {HERO_GRID_LINES.map((d) => (
              <path key={d} d={d} strokeWidth="0.4" className="fill-none stroke-hairline" />
            ))}
            {HERO_PLOTS.map((plot) => (
              <rect key={`${plot.x}-${plot.y}`} {...plot} className="fill-surface" />
            ))}
            {HERO_ARTERIALS.map((d) => (
              <path key={d} d={d} strokeWidth="0.9" className="fill-none stroke-hairline" />
            ))}
            {HERO_RIDGE.map((d) => (
              <path key={d} d={d} strokeWidth="0.5" className="fill-none stroke-hairline" />
            ))}
            {/* `non-scaling-stroke`, unlike everything above it, because the
                river is the one element whose weight has to read the same at
                every viewport. `slice` scales user units by the larger of the
                two axis ratios, which is ~9x on a desktop hero but ~10x on a
                tall phone — and 402px is a quarter the width, so the same
                stroke went from 1.4% of the screen to 5.5% and turned back
                into the band this was replacing. In screen pixels it is 9px
                everywhere. (The grid keeps user units on purpose: hairlines
                pinned to 1px would vanish on desktop.) */}
            <path
              d={HERO_RIVER}
              strokeWidth="9"
              vectorEffect="non-scaling-stroke"
              className="fill-none stroke-info-tint"
            />
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
