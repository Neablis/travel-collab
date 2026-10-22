"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { LandingPricing } from "@/components/front/LandingPricing";
import {
  SeaPlaced,
  layoutSea,
  measureSea,
  packedFor,
  paintMoments,
  seaDim,
  styleNumber,
  useMomentTops,
  useSeaMetrics,
  type SeaShape,
} from "@/components/front/LandingSea";
import { GAP, PAD, place } from "@/components/front/LandingSeaCells";
import { buttonVariants } from "@/components/ui/button";
import { DataText } from "@/components/ui/data-text";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { DEMO_PATH } from "@/lib/demoTrip";
import { cn } from "@/lib/cn";

// The phone's front door is the desktop's sea at a phone's width (M51
// decision 11, Mitchell: *"Could we keep the tiled background, and the
// embedded cards from the elements as i suggested in the mobile version?"*):
// the same library days on their regions' mats, the same four moments rising
// out of the sea as it dims, the pricing and the closing cell last. It
// replaced SPEC §28's pinned sequence, a map with four claims passing under
// one headline.
//
// **Two columns, not the prototype's four.** The prototype scaled a 260px card
// down into each 85px unit; a card here never scales itself to fit (M51
// decision 13, `building-from-the-design.md`), and a Discover card fills a
// unit some 170px wide as it does on the desktop's narrowest grid. Every
// moment is the grid's full width and three rows at most, so it fits one
// phone screen, and each lights two days, one above and one below it, apart.
//
// The screen is its own scroller under a sticky bar, as it was: the bar holds
// still, the `#pricing` hash is answered here, and the footer ends it. The
// scroll writes to the DOM as the desktop's does (SPEC §28's notes, which
// `LandingSea` follows): progress is the scroller's position, no
// `requestAnimationFrame`, the rest state in the markup, and only the scrim,
// the moments' panels and their lit days' veils written, never a card. Cells
// mount as the reader nears them in the scroller: iOS momentum scrolling
// stutters with the whole library mounted inside an `overflow-y-auto` box.

/** The phone's grid for the shared packer: all of it laid by `layoutSea`, the hero too, since it is always two columns. */
export const PHONE_SEA: SeaShape = {
  firstRows: 0,
  // The hero under one row of sea, the grid's width and three units tall:
  // 496px at 360, which holds the headline, its two calls and a line.
  hero: { row: 1, col: 0, w: 2, h: 3 },
  // Each moment three rows at every phone width (two from about 600px), so it
  // fits a 664px screen under the bar; its content fills it and fades at its
  // foot. Pricing's ladder stacks on a phone, its steps a column some 1100px
  // tall at 360, which they stretch to fill on a wider phone.
  heights: { "sea-find": 480, "sea-assistant": 480, "sea-crew": 480, "sea-notebook": 480, pricing: 1100, closing: 300 },
  fullWidth: true,
  litSize: 1,
  litCount: 2,
  tallest: 2,
};
/** What the server packs for: a 390×844 phone. A phone of another size packs again once mounted, below the first screen. */
const SERVER_METRICS = { cols: 2, unit: (390 - 2 * PAD - GAP) / 2, viewport: 844 };
/** The rows mounted at once, in the server's HTML: an 844px screen's, and more than a 932px one shows. */
const FIRST_SCREEN_ROWS = 6;
/** A story's padding on a phone: the desktop's 28px is a sixth of the cell's width here. */
const INSET = "gap-3 p-4";

/** The phone's front door: the sea of notebooks in its own scroller, under a sticky bar and over the footer. */
export function PhoneFrontDoor() {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const pricingRef = useRef<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrimRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const metrics = useSeaMetrics(gridRef, SERVER_METRICS, () => scrollerRef.current?.clientHeight ?? window.innerHeight);
  const layout = useMemo(() => layoutSea(metrics, PHONE_SEA), [metrics]);
  // The moments' places down this scroller, as the desktop caches its own
  // down the window: read per pack and resize, never on scroll.
  const [tops, refreshTops] = useMomentTops(rootRef, layout, () => {
    const scroller = scrollerRef.current;
    return scroller === null ? 0 : scroller.scrollTop - scroller.getBoundingClientRect().top;
  });

  // **`#pricing` is answered here, not by the browser.** The id belongs to the
  // desktop landing's section, since two elements cannot share it, and the
  // browser scrolls to that one, which is `display: none` at this width, so
  // nothing moves. On a wide screen this tree is the hidden one, every rect in
  // it is zero and the scroll goes nowhere, so the two never fight.
  //
  // **Only this scroller moves, and its "Pricing" line lands just under the
  // sticky bar**, the cell's padding scrolled under it. `scrollIntoView`
  // scrolls every ancestor: on a 390px phone it moved the window 374px as
  // well and took the bar with it.
  const toPricing = useCallback(() => {
    const scroller = scrollerRef.current;
    const pricing = pricingRef.current;
    if (window.location.hash !== "#pricing" || scroller === null || pricing === null) return;
    const below = pricing.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollTo({ top: scroller.scrollTop + below - (headerRef.current?.offsetHeight ?? 0) });
  }, []);
  useEffect(() => {
    window.addEventListener("hashchange", toPricing);
    return () => window.removeEventListener("hashchange", toPricing);
  }, [toPricing]);
  // **A page opened at `#pricing` waits for the sea packed for this screen.**
  // The server packs for 844px; a shorter phone, which is most of them with a
  // browser's toolbars showing, packs again once mounted and moves pricing up
  // by rows (366px at 390x664). Answered against the server's layout, the
  // hash landed past the whole Free step. Once only: a later re-pack, as a
  // toolbar folds away mid-scroll, does not pull the reader back.
  const opened = useRef(false);
  useEffect(() => {
    const grid = gridRef.current;
    if (opened.current || grid === null || scrollerRef.current === null) return;
    // Not yet laid out (the hidden tree, or jsdom): nothing will re-pack it.
    const now = measureSea(grid, scrollerRef.current.clientHeight);
    if (now !== null && !packedFor(metrics, now)) return;
    opened.current = true;
    toPricing();
  }, [metrics, toPricing]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const root = rootRef.current;
    const scrim = scrimRef.current;
    if (scroller === null || root === null || scrim === null) return;
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const paint = () => {
      const viewport = scroller.clientHeight;
      // Nothing to paint while this tree is the hidden one, on a wide screen.
      if (viewport === 0) return;
      const dim = seaDim(scroller.scrollTop, viewport);
      scrim.style.setProperty("--sea-dim", styleNumber(dim));
      const top = scroller.getBoundingClientRect().top;
      paintMoments(root, { viewport, scroll: scroller.scrollTop, top, dim, still: motion?.matches ?? false, tops: tops.current });
    };
    const onResize = () => {
      refreshTops();
      paint();
    };
    // Once on mount too: a restored scroll position paints before the first
    // scroll event, or the page would jump on it. The scroll listener needs
    // no gate on the breakpoint, as the desktop's does: it is on this
    // scroller, which cannot scroll while it is `display: none`.
    paint();
    scroller.addEventListener("scroll", paint, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", paint);
      window.removeEventListener("resize", onResize);
    };
  }, [tops, refreshTops]);

  return (
    <div ref={scrollerRef} className="h-dvh overflow-y-auto overflow-x-hidden md:hidden" data-testid="phone-front-door">
      {/* **The top bar, and the sign-in it carries**, on paper over the sea
          for the whole page (Mitchell: *"the header with the logo and site
          name and sign in button should still be visible"*). `z-10` over the
          moments and lit days, which stand above the scrim. Its top padding
          adds the status bar's inset (`.phone-front-door-header`). */}
      <header
        ref={headerRef}
        className="phone-front-door-header sticky top-0 z-10 flex items-center justify-between bg-paper px-6 pb-3"
      >
        <span className="flex items-center gap-2.5">
          <BrandMark size={28} />
          <Text as="span" className="font-display text-md font-semibold text-ink">
            Caesura
          </Text>
        </span>
        {/* `size="touch"` is SPEC §13.1's 44px floor. Ghost: this is the door
            for somebody who already has an account, and the library is
            browsable without one (ADR-061). */}
        <span className="flex items-center">
          <Link href="/playbooks" className={cn(buttonVariants({ variant: "ghost", size: "touch" }), "no-underline")}>
            Playbooks
          </Link>
          <Link href="/signin" className={cn(buttonVariants({ variant: "ghost", size: "touch" }), "no-underline")}>
            Sign in
          </Link>
        </span>
      </header>
      {/* The desktop tree has its own `main`; the two are never shown
          together (`hidden` is `display: none`), so a reader meets one. */}
      <main>
        <div ref={rootRef} data-testid="phone-sea" className="landing-sea landing-sea-phone bg-hairline">
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
            {/* First in the DOM, so a screen reader meets the headline first. */}
            <div
              data-testid="sea-hero"
              // eslint-disable-next-line no-restricted-syntax -- the hero's area on the sea's grid, `PHONE_SEA.hero`, which the packer lays the sea around
              style={place(PHONE_SEA.hero!)}
              className="landing-sea-hero flex min-h-0 flex-col justify-center gap-4 overflow-hidden rounded-2xl bg-paper p-5"
            >
              <DataText size="xs" className="text-2xs tracking-widest uppercase">
                Days worth reliving
              </DataText>
              {/* An <h2> that announces as level 1. The desktop tree holds this
                  headline as the document's one <h1>; CSS shows one tree per
                  breakpoint, and a crawler reads both. */}
              <Heading level={2} aria-level={1} className="text-3xl text-pretty">
                Plan the trip together.
              </Heading>
              <Text as="p" variant="secondary" className="text-pretty">
                Real days from real trips, saved by the people who lived them. Borrow one, plan the rest with your
                group, and relive it all when you&rsquo;re home.
              </Text>
              <div className="flex flex-col gap-2.5">
                <Link href="/signup" className={cn(buttonVariants({ variant: "primary", size: "touch" }), "justify-center no-underline")}>
                  Start a trip
                </Link>
                <Link href={DEMO_PATH} className={cn(buttonVariants({ variant: "secondary", size: "touch" }), "justify-center no-underline")}>
                  Look around a real trip
                </Link>
              </div>
              <Text as="p" variant="muted">
                Invite the group with a link, nothing to install.
              </Text>
            </div>
            <SeaPlaced
              layout={layout}
              firstRows={PHONE_SEA.firstRows}
              unit={metrics.unit}
              root={scrollerRef}
              eager={FIRST_SCREEN_ROWS}
              inset={INSET}
              aboveFirst
              pricing={<LandingPricing ref={pricingRef} />}
              closing={
                <section aria-labelledby="front-door-closing" className="flex min-w-0 flex-col justify-center gap-5">
                  <Heading level={2} id="front-door-closing" className="text-2xl text-pretty">
                    Start the plan, then bring everyone.
                  </Heading>
                  <div className="flex flex-col gap-2.5">
                    <Link href="/signup" className={cn(buttonVariants({ variant: "primary", size: "touch" }), "justify-center no-underline")}>
                      Start a trip
                    </Link>
                    <Link href="/playbooks" className={cn(buttonVariants({ variant: "secondary", size: "touch" }), "justify-center no-underline")}>
                      Find a day to start with
                    </Link>
                  </div>
                </section>
              }
            />
          </div>
        </div>
      </main>

      {/* The desktop landing's footer, same five items (see LandingScreen).
          It ends this screen's own scroller, so its bottom padding adds the
          home indicator's inset (`.phone-front-door-footer`): the last line
          stops above the indicator rather than under it. */}
      <footer className="phone-front-door-footer flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-hairline bg-paper px-6 pt-5">
        <Text as="span" variant="muted">&copy; 2026 Caesura</Text>
        <Text as="span" variant="muted" aria-hidden>&middot;</Text>
        <Text as="span" variant="muted">Privacy</Text>
        <Text as="span" variant="muted" aria-hidden>&middot;</Text>
        <Text as="span" variant="muted">Terms</Text>
        <Text as="span" variant="muted" aria-hidden>&middot;</Text>
        <Link href="/developers" className="text-xs text-slate">
          Developers
        </Link>
        <a href="mailto:mitchell@demarcosoftware.com" className="w-full text-xs text-slate">
          mitchell@demarcosoftware.com
        </a>
      </footer>
    </div>
  );
}
