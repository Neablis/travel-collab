import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { DataText } from "@/components/ui/data-text";
import { Preview } from "@/components/ui/preview";
import { FrontDoorHeader } from "@/components/front/FrontDoorHeader";
import { LandingHeroArt } from "@/components/front/LandingHeroArt";
import { LandingFeatureBlocks } from "@/components/front/LandingFeatureBlocks";
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
const HERO_GRID_LINES = [
  "M-6 30 L 166 24",
  "M-6 58 L 166 54",
  "M-6 84 L 166 79",
  "M64 -6 L 70 106",
  "M124 -6 L 130 106",
  "M148 -6 L 152 106",
] as const;

// `dc.html:1867-1869` — translucent plots scattered over the grid.
const HERO_PLOTS = [
  { x: 70, y: 24, width: 18, height: 14, opacity: 0.5 },
  { x: 132, y: 54, width: 16, height: 25, opacity: 0.4 },
  { x: 106, y: 79, width: 22, height: 18, opacity: 0.45 },
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
            <path
              d="M96 -6 C 92 22, 104 40, 99 62 S 108 88, 104 106"
              strokeWidth="4.4"
              className="fill-none stroke-info-tint"
            />
            {HERO_GRID_LINES.map((d) => (
              <path key={d} d={d} strokeWidth="0.55" className="fill-none stroke-hairline" />
            ))}
            {HERO_PLOTS.map((plot) => (
              <rect key={`${plot.x}-${plot.y}`} {...plot} className="fill-surface" />
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
                {/* M11 owns unauthenticated read of a real trip (share links).
                    Shipping the button as a Preview shell keeps the design's
                    shape and is honest about it — M15's gate requires exactly
                    this, and forbids building a bespoke public-read path. */}
                <Preview id="landing-peek-trip" size="compact">
                  <Button type="button" variant="secondary">
                    Look around a real trip
                  </Button>
                </Preview>
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
              {/* Its own id, not a second `landing-peek-trip`: Preview writes
                  the id to `data-preview-id` and the e2e spec locates by it,
                  so a reused id would match two nodes and trip Playwright's
                  strict mode (preview-registry.ts says the same). */}
              <Preview id="landing-see-finished" size="compact">
                <Button type="button" variant="ghost">
                  See a finished one
                </Button>
              </Preview>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
