import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { DataText } from "@/components/ui/data-text";
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
                {/* Real as of M11 link 4, and still a plain link: SPEC §14
                    says this page runs on nothing — no session, no fetch, no
                    backend — so the CTA does not go looking for a trip to
                    peek at. `/s/featured` is an ordinary share page reading
                    an ordinary share, whose token is deployment
                    configuration (ADR-027); where none is configured it says
                    so, in its own designed empty state. That keeps a
                    data-model change unable to break the front door, which
                    is the rule this shell was parked behind. */}
                <Link
                  href="/s/featured"
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
                href="/s/featured"
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
