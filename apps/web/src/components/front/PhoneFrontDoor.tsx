"use client";

import { type ReactNode, useEffect, useRef } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { buttonVariants } from "@/components/ui/button";
import { DataText } from "@/components/ui/data-text";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/cn";

// SPEC §28's phone front door.
//
// > The desktop landing's long scroll and rotating hero is the wrong shape at
// > 390px. The phone gets a **pinned sequence**: the map and the headline hold
// > still while four claims pass through underneath, then the map clears out
// > and the call to action arrives on empty paper.
//
// **Three notes the spec attaches to this, all of which read like they were
// paid for once**, and all three are load-bearing here:
//
//  1. **Progress is scroll position inside the pinned block, not time** — so
//     you can stop on one claim and it stays. A timed sequence on a front door
//     is a thing that moves while you are reading it.
//  2. **The rest state is authored into the markup** — the first chunk at
//     `opacity: 1`, the rest at `0` — or a cold load stacks all four on top of
//     each other before the first scroll event ever fires.
//  3. **No `requestAnimationFrame`.** In a throttled or hidden frame the
//     callback never runs, so the "already scheduled" guard latches forever and
//     silently kills the effect. Synchronous transform/opacity writes only.
//
// **Written to the DOM per scroll event, never to React state.** Sixty
// re-renders a second of a tree this size is the thing rAF is usually reached
// for, and the answer here is not to schedule the work but to not do work that
// needs scheduling: two style properties on five elements is cheap, and the
// browser coalesces the paint itself.

/**
 * Where the stage starts clearing, and over how much of the scroll. §28's "the
 * map clears out".
 *
 * **0.82, not 0.72.** Mitchell, on the preview: *"there needs to be more time
 * between the scroll transitions between blocks, right now the last few are
 * almost unreadable"* — and the tail is half of why. Everything before it is
 * shared by four claims, so ten points of scroll taken off the front is two and
 * a half points off each of them, and the LAST claim pays twice because the
 * clear-out lands on top of it. The pin is also three times longer now (see
 * `.front-door-pin`), which is the other half.
 */
const TAIL_START = 0.82;
const TAIL_LENGTH = 0.14;
/** How far the map drifts up across the whole pin, in px. */
const MAP_DRIFT = 74;
/**
 * The fraction of a chunk's own window spent fading in, and out.
 *
 * **The fades OVERLAP the segment boundary rather than sitting inside it**, and
 * that is the other half of *"the last few are almost unreadable"*. A claim used
 * to finish fading out exactly where the next one started fading in — so at
 * every boundary both were at zero and the stage went blank for a moment, four
 * times down the page. CodeRabbit found the same thing as arithmetic: at
 * `p = 0.25`, `0.5` and `0.75` neither neighbour was rendered.
 *
 * Now each claim is fully in by the start of its own segment and only begins to
 * leave at the end of it, fading out ACROSS the next one, which is what a
 * crossfade is.
 */
const EDGE = 0.16;
const ENTER_FROM = 30;
const LEAVE_TO = -26;

// `dc.html:7537`, trimmed to the two fields the phone card draws. The desktop
// blocks carry the same three stops with more on each; a 390px card has room
// for a time and a title.
const CLAIM_STOPS = [
  { time: "9:40 am", title: "Fushimi Inari, early" },
  { time: "1:15 pm", title: "Lunch at Nishiki Market" },
  { time: "4:00 pm", title: "Ryokan check-in, Higashiyama" },
] as const;

// `dc.html:7486`. Not the desktop block's `COST_ROWS` — that one is two rows
// totalling $550 and this is three totalling the $596 the paragraph above it
// names. Both are the design's own numbers for two different screens.
const CLAIM_COSTS = [
  { label: "Ryokan · Hakone", amount: "$380" },
  { label: "Dinner, all four", amount: "$164" },
  { label: "Romancecar seats", amount: "$52" },
] as const;

// A card under a claim, in the design's own shape: `--radius-xl` is 14px, which
// is the value `dc.html` draws these at.
function ExampleCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("block rounded-xl border border-hairline bg-surface p-3.5", className)}>{children}</span>
  );
}

/**
 * The four claims, each with the example the design draws under it.
 *
 * **The examples are the half the build shipped without**, and Mitchell said so
 * three times on the preview — *"missing the graphic"*, *"missing the graphic"*,
 * *"missing the example. Attached example of what it should look like"*. They
 * are not decoration: each claim is an assertion about what the product does,
 * and the card under it is the product doing it.
 *
 * It is also why two of those notes also said *"awkward wording"*. The
 * `Together` claim's body was `"Everyone moves the same day. Priya moved this
 * an hour later — everyone sees it."` — the design's headline and its card's
 * caption concatenated into one sentence, because the card they belonged to was
 * not built. Split back apart, both halves read.
 */
const CLAIMS: readonly { label: string; body: string; example?: ReactNode }[] = [
  {
    label: "One plan",
    body: "One shared plan your whole group can move around — days, times, costs, who's in.",
    // No card in the design either: the opening claim is the promise, and the
    // three that follow are the evidence.
  },
  {
    label: "Together",
    body: "Everyone moves the same day.",
    example: (
      <ExampleCard className="flex flex-col gap-2">
        {CLAIM_STOPS.map((stop) => (
          <span key={stop.title} className="flex items-baseline gap-2.5">
            <DataText size="xs" className="w-14 shrink-0 text-slate">
              {stop.time}
            </DataText>
            <Text as="span" className="truncate text-sm text-ink">
              {stop.title}
            </Text>
          </span>
        ))}
        {/* The caption that used to be stuck on the end of the headline. It is
            a change somebody else made, which is the whole claim, so it wears
            the brand tint and their initials rather than sitting in the list. */}
        <span className="flex items-center gap-2 rounded-lg bg-brand-tint px-2.5 py-2">
          <DataText
            size="xs"
            className="grid size-5 shrink-0 place-items-center rounded-full bg-brand text-surface"
          >
            PR
          </DataText>
          <Text as="span" className="text-xs text-brand-pressed">
            Priya moved this an hour later — everyone sees it.
          </Text>
        </span>
      </ExampleCard>
    ),
  },
  {
    // **"Write it up", not "Write about it".** Mitchell called the original
    // awkward and did not name a replacement; this is the smallest edit that
    // answers it — "write about it" is what you do to a topic, "write it up" is
    // what you do to a trip, and the sentence after it is unchanged.
    label: "Notebook",
    body: "Write it up. The numbers keep themselves right.",
    example: (
      <ExampleCard>
        <Text as="span" className="mb-2 block text-sm text-ink">
          Day 6 is the expensive one —{" "}
          {/* The product's own widget-value treatment, deliberately: this is a
              picture of a notebook, and a number that came from the trip rather
              than from the writer wears brand tint under a brand rule wherever
              it appears (`MacroView`'s `Segs`). A different treatment here would
              be advertising a thing the product does not do. */}
          <span className="rounded-sm border-b-2 border-brand bg-brand-tint px-1">$596</span> across four of us.
        </Text>
        {CLAIM_COSTS.map((row) => (
          <span
            key={row.label}
            className="flex items-baseline justify-between gap-2.5 border-t border-hairline py-1.5"
          >
            <Text as="span" className="truncate text-xs text-ink">
              {row.label}
            </Text>
            <DataText size="xs" className="shrink-0 text-slate">
              {row.amount}
            </DataText>
          </span>
        ))}
      </ExampleCard>
    ),
  },
  {
    // **"Borrow the perfect day"** — Mitchell's own suggestion on the preview,
    // against the design's "Borrow a day someone already got right". Shorter,
    // and it names what you get rather than describing where it came from.
    label: "Playbooks",
    body: "Borrow the perfect day.",
    example: (
      <ExampleCard className="flex flex-col gap-2.5">
        <span className="flex items-baseline justify-between gap-2.5">
          <Text as="span" className="text-sm font-semibold text-ink">
            A beach day in Phuket
          </Text>
          <DataText size="xs" className="shrink-0 text-slate">
            4.8 ★
          </DataText>
        </span>
        <Text as="span" className="text-xs text-slate">
          6 stops · Shared 214 times
        </Text>
        <span className="flex items-center gap-2 rounded-lg bg-moss px-2.5 py-2">
          <Text as="span" className="text-xs text-ink">
            Dropping in as Day 2 — times shift to fit.
          </Text>
        </span>
      </ExampleCard>
    ),
  },
];

export function PhoneFrontDoor() {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const pinRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<SVGSVGElement | null>(null);
  const chunkRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const pin = pinRef.current;
    if (scroller === null || pin === null) return;

    // Note 3: no rAF, no scheduling guard. This runs synchronously on the
    // event and does two writes per element.
    const paint = () => {
      const usable = Math.max(1, pin.offsetHeight - scroller.clientHeight);
      const p = Math.max(0, Math.min(1, scroller.scrollTop / usable));

      // The stage clears as ONE: the map and whatever claim is still on it go
      // together, so the pin releases onto empty paper rather than dropping the
      // background out from under a line of type still sitting there.
      const tail = p > TAIL_START ? Math.max(0, 1 - (p - TAIL_START) / TAIL_LENGTH) : 1;

      const map = mapRef.current;
      if (map !== null) {
        map.style.transform = `translate3d(0,${(-p * MAP_DRIFT).toFixed(1)}px,0)`;
        map.style.opacity = tail.toFixed(3);
      }

      const seg = 1 / CLAIMS.length;
      chunkRefs.current.forEach((chunk, i) => {
        if (chunk === null) return;
        const t = (p - i * seg) / seg;
        // The first claim is already there when you arrive and the last holds
        // to the end of the pin — only the ones between both enter and leave,
        // so the stage is never empty at either end.
        const first = i === 0;
        const last = i === CLAIMS.length - 1;
        let opacity: number;
        let dy: number;
        // The window a claim is visible in runs from `-EDGE` to `1 + EDGE` of
        // its own segment, so it is already at full when its segment begins and
        // only starts leaving when it ends. Both bounds widen with it, or the
        // early returns would blank the very frames the overlap exists for.
        if (t < -EDGE && !first) {
          opacity = 0;
          dy = ENTER_FROM;
        } else if (t > 1 + EDGE && !last) {
          opacity = 0;
          dy = LEAVE_TO;
        } else {
          const inF = first ? 1 : Math.min(1, Math.max(0, (t + EDGE) / EDGE));
          const outF = last ? 1 : Math.min(1, Math.max(0, (1 + EDGE - t) / EDGE));
          opacity = Math.min(inF, outF);
          dy = (1 - inF) * ENTER_FROM - (1 - outF) * -LEAVE_TO;
        }
        // **One rounded string decides both what is painted and what is
        // announced**, so the two can never disagree. A claim that is faded
        // out is still in the document, and nothing here removes it from the
        // accessibility tree — `opacity: 0` is a paint property, not a
        // presence one — so without this a screen reader read all four claims
        // stacked on each other, at every scroll position (CodeRabbit, PR 170).
        //
        // Read back off `toFixed(3)` rather than off `opacity * tail`: a value
        // that rounds to `0.000` is gone from the screen, and a claim nobody
        // can see is a claim nobody should hear. Nothing inside a claim is
        // focusable, so hiding one cannot strand the keyboard on it.
        const painted = (opacity * tail).toFixed(3);
        chunk.style.opacity = painted;
        if (Number(painted) > 0) chunk.removeAttribute("aria-hidden");
        else chunk.setAttribute("aria-hidden", "true");
        chunk.style.transform = `translate3d(0,${dy.toFixed(1)}px,0)`;
      });
    };

    // Once on mount as well as on scroll: arriving at this screen from another
    // route, or restoring a scroll position, both need one pass or the sections
    // render at their authored rest state and then jump on the first scroll.
    paint();
    scroller.addEventListener("scroll", paint, { passive: true });
    return () => scroller.removeEventListener("scroll", paint);
  }, []);

  return (
    <div ref={scrollerRef} className="h-dvh overflow-y-auto overflow-x-hidden md:hidden" data-testid="phone-front-door">
      {/* **The top bar, and the sign-in it carries** (`dc.html:3373`). Mitchell,
          on the preview: *"Missing the top of page signing CTA"* — this screen
          had no header at all, so a returning visitor on a phone had no way
          into their own account short of guessing a URL. The desktop landing
          has always had one; the phone front door was written without it.

          Outside the pinned block on purpose: the pin is a sticky stage that
          scrolls under itself, and a header inside it would slide away with the
          map. Here it scrolls off once, like a page header. */}
      <header className="flex items-center justify-between px-6 pt-6 pb-3">
        <span className="flex items-center gap-2.5">
          <BrandMark size={28} />
          <Text as="span" className="font-display text-md font-semibold text-ink">
            Caesura
          </Text>
        </span>
        {/* `size="touch"` is SPEC §13.1's 44px floor. Ghost, because the CTA
            this screen is actually selling is "Start a trip" at the foot — this
            is the door for somebody who already has an account. */}
        <Link
          href="/signin"
          className={cn(buttonVariants({ variant: "ghost", size: "touch" }), "no-underline")}
        >
          Sign in
        </Link>
      </header>
      {/* The pinned block. It is three viewports tall, and the sticky stage
          inside it is one — so scrolling it moves `scrollTop` without moving
          what you are looking at, which is the whole mechanic. */}
      <div ref={pinRef} data-testid="front-door-pin" className="front-door-pin relative">
        <div className="sticky top-0 flex h-dvh flex-col overflow-hidden">
          <svg
            ref={mapRef}
            viewBox="0 0 160 210"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden
            data-testid="front-door-map"
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            <rect x="-10" y="-10" width="180" height="230" className="fill-moss" />
            {[34, 76, 120, 164].map((y) => (
              <path key={`ew${y}`} d={`M-6 ${y} L 166 ${y - 7}`} strokeWidth="0.6" className="fill-none stroke-hairline" />
            ))}
            {[[44, 50], [108, 114]].map(([top, bottom]) => (
              <path key={`ns${top}`} d={`M${top} -6 L ${bottom} 216`} strokeWidth="0.6" className="fill-none stroke-hairline" />
            ))}
            <rect x="52" y="30" width="22" height="17" opacity="0.55" className="fill-surface" />
            <rect x="116" y="80" width="19" height="28" opacity="0.45" className="fill-surface" />
            <rect x="18" y="126" width="24" height="20" opacity="0.5" className="fill-surface" />
            {/* The route: one line through the city, with a stop on it. */}
            <path
              d="M30 6 C 52 34, 44 66, 68 92 S 104 126, 96 166 S 118 196, 128 214"
              strokeWidth="2.2"
              strokeLinecap="round"
              opacity="0.55"
              className="fill-none stroke-brand"
            />
            {[[30, 6], [68, 92], [96, 166], [128, 214]].map(([cx, cy]) => (
              <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3.4" className="fill-brand" />
            ))}
          </svg>
          {/* The paper veil (`dc.html:3401`): opaque where the headline and the
              claims sit, clear through the middle where the route shows. Without
              it the map is a flat block of moss behind text rather than ground
              the words are standing on. The gradient itself is in `globals.css`
              — see `.front-door-veil` for why it cannot be a class attribute. */}
          <div aria-hidden className="front-door-veil pointer-events-none absolute inset-0" />

          {/* The headline holds still while the claims pass underneath. */}
          <div className="relative px-6 pt-16">
            <Text variant="muted" className="uppercase tracking-widest">
              Trips, planned together
            </Text>
            <Heading level={1} className="mt-2 text-3xl">
              The trip everyone actually helped plan.
            </Heading>
          </div>

          <div className="relative mt-8 flex-1">
            {CLAIMS.map((claim, i) => (
              <div
                key={claim.label}
                ref={(el) => {
                  chunkRefs.current[i] = el;
                }}
                data-testid="front-door-claim"
                // The authored rest state's other half: the three claims that
                // start invisible start unannounced too, so the server's HTML
                // and the paint above agree before any effect has run.
                aria-hidden={i !== 0}
                className="absolute inset-0 flex flex-col justify-center px-6"
                // Note 2: the rest state is AUTHORED, not applied by the
                // effect. Without it a cold load — or a browser that fires no
                // scroll event because the page opens at the top — stacks all
                // four claims on top of each other.
                // eslint-disable-next-line no-restricted-syntax -- the authored rest state of a scroll-driven sequence; it is overwritten per scroll event and has no token equivalent.
                style={{ opacity: i === 0 ? 1 : 0, willChange: "transform, opacity" }}
              >
                {/* **The plate, which Mitchell reported missing by name** —
                    *"The mobile homepage styling is missing the background box
                    with gradiant"*. It is what keeps a claim legible while the
                    map moves under it. `-mx-1.5` is the design's `margin: 0
                    -6px`: the plate bleeds past the text's own gutter so the
                    words are never near its edge. */}
                <span className="front-door-plate -mx-1.5 flex flex-col gap-3 px-4 py-5">
                  <Text variant="muted" className="uppercase tracking-widest">
                    {claim.label}
                  </Text>
                  <Text className="text-lg text-ink">{claim.body}</Text>
                  {claim.example}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Empty paper. §28: "then the map clears out and the call to action
          arrives on empty paper" — so this sits AFTER the pin, in ordinary
          flow, with nothing behind it. */}
      <section className="flex min-h-dvh flex-col justify-center gap-4 bg-paper px-6">
        <Heading level={2} className="text-2xl">
          Start a trip.
        </Heading>
        <Text variant="secondary">Invite the group by link. Nothing to install.</Text>
        <Link
          href="/signup"
          className={cn(buttonVariants({ variant: "primary", size: "touch" }), "justify-center no-underline")}
        >
          Continue with Google
        </Link>
        <Link
          href="/demo"
          className={cn(buttonVariants({ variant: "secondary", size: "touch" }), "justify-center no-underline")}
        >
          Look around a real trip
        </Link>
        <Text variant="muted">Early access.</Text>
      </section>
    </div>
  );
}
