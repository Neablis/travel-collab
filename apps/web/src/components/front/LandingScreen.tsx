import Link from "next/link";
import { PhoneFrontDoor } from "@/components/front/PhoneFrontDoor";
import { buttonVariants } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { DataText } from "@/components/ui/data-text";
import { FrontDoorHeader } from "@/components/front/FrontDoorHeader";
import { LandingPricing } from "@/components/front/LandingPricing";
import { LandingSea } from "@/components/front/LandingSea";
import { LeaveLandingIfSignedIn } from "@/components/front/LeaveLandingIfSignedIn";
import { DEMO_PATH } from "@/lib/demoTrip";
import { LANDING_CLOSING_QUOTE } from "@/lib/landingDemo";
import { cn } from "@/lib/cn";

// The words are Mitchell's retro of 2026-09-28
// (`docs/design-feedback/2026-09-28-landing-retro-copy.md`, DRIFT D21): it
// sells the feeling of a day worth reliving and lets the mechanics ride
// along. The ground they sit on is M51's sea of notebooks (`LandingSea.tsx`).
//
// SPEC §14's copy rules hold: no "free", no "open source", no "no credit
// card" — Caesura is a product for groups, not a tool. The retro briefly put
// "Free during early access" under the hero and the closing CTA; Mitchell took
// it back out on the preview (2026-09-28): "there will always be a free" tier,
// so a line implying free ends with early access promised the wrong thing.
// And no exclamation mark anywhere (M51 decision 6: *"makes user feel like its
// a scam"*). `LandingScreen.test.tsx` guards them.
//
// The page runs on nothing (SPEC §14): no session, no fetch, no backend, every
// value a committed snapshot. A data-model change must never be able to break
// the front door.

// SPEC §28 gives the phone a different front door — a pinned scroll sequence,
// not this page at a narrower width — so both are rendered and the breakpoint
// picks one.
//
// **CSS, not `useIsPhone`.** This is the first paint of the first page an
// unauthenticated visitor sees, and `useIsPhone` starts `false` on the server
// and corrects in an effect: a JS-gated switch would render the desktop page at
// 390px for one paint on every cold load, which is the one place in the product
// where a flash is most visible and least forgivable.
//
// **The cost, stated honestly: both trees are in the DOM, and they DO share
// names** — the headline, "Start a trip" and "Look around a real trip" all
// appear twice. That is not an accessibility problem, because `hidden`
// resolves to `display: none` and a `display: none` subtree is not in the
// accessibility tree at all: a real browser at either width exposes exactly
// one. It IS a test problem, because jsdom applies no media queries and sees
// both — so the tests scope themselves to one tree by testid rather than
// querying the screen.
/** The landing page at `/`: the desktop sea and the phone front door, one shown per breakpoint. */
export function LandingScreen() {
  return (
    <>
      <LeaveLandingIfSignedIn />
      <PhoneFrontDoor closingQuote={LANDING_CLOSING_QUOTE} />
      <div data-testid="desktop-landing" className="hidden min-h-screen flex-col bg-paper text-ink md:flex">
      <FrontDoorHeader
        actions={
          <>
            {/* The playbook library is open without an account (ADR-061), so
                the front door links it: a visitor can browse real days before
                deciding to sign up. A plain link, so SPEC §14's "this page
                fetches nothing" still holds. */}
            <Link href="/playbooks" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "no-underline")}>
              Playbooks
            </Link>
            <Link href="#pricing" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "no-underline")}>
              Pricing
            </Link>
            <Link href="/signin" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "no-underline")}>
              Sign in
            </Link>
            <Link href="/signup" className={cn(buttonVariants({ variant: "primary", size: "sm" }), "no-underline")}>
              Start a trip
            </Link>
          </>
        }
      />

      <main className="flex flex-1 flex-col">
        <LandingSea
          hero={
            // On paper over the sea's first screen, which is all colour: the
            // cards behind are the noise, the headline the one quiet thing.
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-7">
              <div className="pointer-events-auto flex max-w-xl flex-col gap-5.5 rounded-lg border border-hairline bg-paper p-9 shadow-raised">
                <DataText size="xs" className="text-2xs tracking-widest uppercase">
                  Days worth reliving
                </DataText>

                <Heading level={1} className="text-4xl text-pretty">
                  Plan the trip together.
                </Heading>

                <Text as="p" variant="secondary" className="text-md text-pretty">
                  Caesura is a trip planner built on playbooks: real days from real trips, saved by the people
                  who lived them. Borrow a perfect day in Kyoto, plan the rest with your group, and relive it
                  all when you&rsquo;re home.
                </Text>

                <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
                  <Link href="/signup" className={cn(buttonVariants({ variant: "primary" }), "no-underline")}>
                    Start a trip
                  </Link>
                  {/* A plain link, not a fetch: `/demo` picks a demo, and each
                      `/demo/<slug>` is the real trip board, read-only, folded in
                      memory (ADR-031), so it works on every deploy and a fresh
                      clone, and a data-model change still cannot break the
                      front door. */}
                  <Link href={DEMO_PATH} className={cn(buttonVariants({ variant: "secondary" }), "no-underline")}>
                    Look around a real trip
                  </Link>
                </div>

                <Text as="p" variant="muted">
                  Invite the group with a link, nothing to install.
                </Text>
              </div>
            </div>
          }
        >
          {/* Second to last, so its prices sit just above the ask (M51
              decision 10). The `pricing` id lives here and only here; the
              phone front door scrolls to its own copy itself. */}
          <div className="rounded-lg border border-hairline bg-paper p-7 shadow-raised">
            <LandingPricing id="pricing" />
          </div>

          {/* **The closing cell**, the page's last: full width, a cell of the
              sea like any other, and the two ways in (Mitchell, on C2: *"the
              last page should be the CTA to signup/find a day to start
              with"*). */}
          <section
            aria-labelledby="landing-closing"
            className="landing-grain relative flex flex-col items-center gap-7 rounded-lg border border-hairline bg-paper px-7 py-19.5 text-center shadow-raised"
          >
            <Heading level={2} id="landing-closing" className="text-xl">
              Start the plan, then bring everyone.
            </Heading>

            <div className="flex flex-wrap items-center justify-center gap-2.5">
              <Link href="/signup" className={cn(buttonVariants({ variant: "primary" }), "no-underline")}>
                Start a trip
              </Link>
              <Link href="/playbooks" className={cn(buttonVariants({ variant: "secondary" }), "no-underline")}>
                Find a day to start with
              </Link>
            </div>
          </section>
        </LandingSea>
      </main>

      {/* Minimal and boring on purpose. Privacy and Terms are plain text, not
          links, until those pages exist — a footer link that 404s is worse
          than no link. Developers is a link because `/developers` exists: it
          is where a person setting up an agent learns how to get a token. */}
      <footer className="border-t border-hairline">
        <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-7 py-6">
          <Text as="span" variant="muted">&copy; 2026 Caesura</Text>
          <Text as="span" variant="muted" aria-hidden>&middot;</Text>
          <Text as="span" variant="muted">Privacy</Text>
          <Text as="span" variant="muted" aria-hidden>&middot;</Text>
          <Text as="span" variant="muted">Terms</Text>
          <Text as="span" variant="muted" aria-hidden>&middot;</Text>
          <Link href="/developers" className="text-xs text-slate">
            Developers
          </Link>
          <Text as="span" variant="muted" aria-hidden>&middot;</Text>
          <a href="mailto:mitchell@demarcosoftware.com" className="text-xs text-slate">
            mitchell@demarcosoftware.com
          </a>
        </div>
      </footer>
      </div>
    </>
  );
}
